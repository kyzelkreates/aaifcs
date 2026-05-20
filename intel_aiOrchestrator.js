/**
 * ============================================================
 * APEX INTELLIGENCE — AI Orchestrator (Master Decision Layer)
 * File: intel_aiOrchestrator.js
 *
 * Single entry point for all intelligence decisions.
 * Coordinates: GH Adapter → Scoring → Safety → Compliance
 *              → Driver Compatibility → Prediction → Decision
 *
 * FLOW:
 *   orchestrateRoute(origin, dest, vehicle, driver, job)
 *     → graphhopperAdapter.fetchRoutes()     (1-3 alternatives)
 *     → safetyEngine.analyseRoute()          (per route)
 *     → complianceEngine.checkDispatch()     (per route)
 *     → routeScoring.scoreRoute()            (per route)
 *     → predictionEngine.predictOnTime()     (per route)
 *     → efficiencyEngine.estimateFuel()      (per route)
 *     → rank + pick best
 *     → routeMemory context injected
 *     → return OrchestratedDecision
 *
 * All calls are async, cached where possible.
 * On any sub-module failure — degrades gracefully.
 * ============================================================
 */

import { graphhopperAdapter } from './intel_graphhopperAdapter'
import { routeScoring }       from './intel_routeScoring'
import { safetyEngine }       from './intel_safetyEngine'
import { complianceEngine }   from './intel_complianceEngine'
import { efficiencyEngine }   from './intel_efficiencyEngine'
import { predictionEngine }   from './intel_predictionEngine'
import { driverLearning }     from './intel_driverLearning'
import { fleetLearning }      from './intel_fleetLearning'
import routeMemory            from './intel_routeMemory'

// ─── Decision cache (session-only, not localStorage) ─────────
const _cache = new Map()
const CACHE_TTL = 5 * 60 * 1000  // 5 minutes

function cacheKey(origin, dest, vehicleId, driverId) {
  return `${origin.lat.toFixed(3)},${origin.lng.toFixed(3)}:${dest.lat.toFixed(3)},${dest.lng.toFixed(3)}:${vehicleId}:${driverId}`
}

function getCached(key) {
  const entry = _cache.get(key)
  if (!entry) return null
  if (Date.now() - entry.ts > CACHE_TTL) { _cache.delete(key); return null }
  return entry.value
}

function setCache(key, value) {
  _cache.set(key, { value, ts: Date.now() })
  if (_cache.size > 50) {
    // Evict oldest
    const oldest = [..._cache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0]
    _cache.delete(oldest[0])
  }
}

// ─── Public API ───────────────────────────────────────────────
export const aiOrchestrator = {

  /**
   * Full route orchestration — main entry point.
   *
   * @param {object} origin      - { lat, lng }
   * @param {object} destination - { lat, lng }
   * @param {object} vehicle     - vehicle record from fleetService
   * @param {object} driver      - driver record from driverService
   * @param {object} job         - job record from dispatchService (optional)
   * @param {object} options     - { forceRefresh, alternatives }
   * @returns {Promise<OrchestratedDecision>}
   */
  async orchestrateRoute(origin, destination, vehicle = {}, driver = {}, job = {}, options = {}) {
    const key = cacheKey(origin, destination, vehicle?.id || '', driver?.id || '')
    if (!options.forceRefresh) {
      const cached = getCached(key)
      if (cached) return { ...cached, fromCache: true }
    }

    // ── Step 1: Fetch route alternatives ─────────────────────
    let routes = []
    try {
      routes = await graphhopperAdapter.fetchRoutes(origin, destination, vehicle, {
        alternatives: options.alternatives !== false,
        elevation:    true,
      })
    } catch (err) {
      console.warn('[Orchestrator] Route fetch failed:', err.message)
    }

    if (routes.length === 0) {
      return this._errorDecision('No routes available from any provider')
    }

    // ── Step 2: Build shared context ─────────────────────────
    const estHours  = (routes[0]?.duration_s || 0) / 3600
    const driverId  = driver?.id || ''
    const vehicleId = vehicle?.id || ''

    const corridorDelay = routeMemory.getCorridorDelay(origin, destination, {
      dow:    new Date().getDay(),
      bucket: new Date().getHours() * 2 + (new Date().getMinutes() >= 30 ? 1 : 0),
    })

    const predictedDurationS = routeMemory.predictDuration(origin, destination)
    const historicalAvgS     = corridorDelay
      ? (routes[0]?.duration_s || 0) + (corridorDelay.avg_delay_s || 0)
      : null
    const fuelAvg            = routeMemory.getVehicleFuelAvg(vehicleId)
    const vehicleAvgL100km   = fuelAvg || efficiencyEngine._baseL100km(vehicle)
    const weatherRisk        = safetyEngine.estimateWeatherRisk({ lat: origin.lat })
    const driverStress       = safetyEngine.getDriverStressState(driverId)
    const driverProfile      = driverLearning.getProfile(driverId)

    // Dangerous segments near origin+dest
    const dangerNearOrigin = routeMemory.getDangerousSegmentsNear(origin.lat, origin.lng, 0.03)
    const dangerNearDest   = routeMemory.getDangerousSegmentsNear(destination.lat, destination.lng, 0.03)
    const dangerousSegments = [...dangerNearOrigin, ...dangerNearDest]

    const scheduledDeadlineTs = job?.scheduled_at ? new Date(job.scheduled_at).getTime() : null
    const loadKg              = parseFloat(job?.load_kg || 0)

    // ── Step 3: Compliance check (shared for all routes) ─────
    let complianceResult = { passed: true, hardViolations: [], softViolations: [], expiryFlags: [], score: 100 }
    try {
      complianceResult = complianceEngine.checkDispatch({
        vehicle,
        driver,
        estimatedDrivingHours:      estHours,
        scheduledDepartureTs:       Date.now(),
        scheduledArrivalTs:         Date.now() + (routes[0]?.duration_s || 0) * 1000,
      })
    } catch {}

    // ── Step 4: Score each route ──────────────────────────────
    const scoredRoutes = routes.map(route => {
      let safetyResult = { riskScore: 0, risks: [], safeToDispatch: true }
      try {
        safetyResult = safetyEngine.analyseRoute(route, vehicle, driver, {
          scheduledDepartureTs: Date.now(),
          jobDurationH: 0,
        })
      } catch {}

      const ghGradient = graphhopperAdapter.analyseGradient(route)
      const loBridgeRisk = graphhopperAdapter.detectLowBridgeRisk(route, parseFloat(vehicle?.height_m || 0))

      const context = {
        origin, destination,
        dangerousSegments,
        weatherRisk,
        weatherFailuresOnCorridor: routeMemory.getFailureHistory(origin, destination, 10)
          .filter(f => f.reason === 'weather').length,
        fatigueRisk:              driverStress.fatigueScore || 0,
        harshEventRate:           driverProfile.events_per_100km || 0,
        hardViolations:           complianceResult.hardViolations,
        expiryFlags:              complianceResult.expiryFlags,
        estimatedDrivingHours:    estHours,
        predictedDurationS,
        historicalAvgS,
        scheduledDeadlineTs,
        corridorDelay,
        vehicleAvgLPer100km:      vehicleAvgL100km,
        routeHasLowBridges:       loBridgeRisk,
        gradientRisk:             ghGradient.riskScore,
        estimatedFuelCostGBP:     efficiencyEngine.estimateFuel(route, vehicle, loadKg).costGBP,
      }

      const scored = routeScoring.scoreRoute(route, vehicle, driver, context)

      // Fuel estimate
      let fuelEstimate = null
      try { fuelEstimate = efficiencyEngine.estimateFuel(route, vehicle, loadKg) } catch {}
      let fuelSaving = null
      try { fuelSaving = efficiencyEngine.calculateFuelSaving(route, vehicle, loadKg) } catch {}

      // Delivery prediction
      let deliveryPrediction = null
      if (job?.id) {
        try { deliveryPrediction = predictionEngine.predictOnTime(job, origin, destination, route) } catch {}
      }

      return {
        ...scored,
        safetyAnalysis:    safetyResult,
        fuelEstimate,
        fuelSaving,
        deliveryPrediction,
        gradientAnalysis:  ghGradient,
      }
    })

    // ── Step 5: Filter rejected + rank ────────────────────────
    const validRoutes   = scoredRoutes.filter(r => !r.rejected)
    const rejectedRoutes = scoredRoutes.filter(r => r.rejected)
    const ranked        = validRoutes.sort((a, b) => b.composite - a.composite)

    const bestRoute = ranked[0] || null

    // ── Step 6: Build fleet intelligence context ──────────────
    let depotForecast = null
    try { depotForecast = predictionEngine.predictDepotOverload() } catch {}

    // ── Step 7: Build final decision ──────────────────────────
    const decision = {
      // Core decision
      approved:           complianceResult.passed && !!bestRoute,
      blockedReason:      !complianceResult.passed
                            ? complianceResult.hardViolations[0]
                            : (!bestRoute ? 'No viable routes found' : null),

      // Best route
      bestRoute:          bestRoute?.route || null,
      bestScore:          bestRoute?.composite || null,
      bestGrade:          bestRoute?.grade || null,
      bestScores:         bestRoute?.scores || null,
      warnings:           bestRoute?.warnings || [],
      safetyAnalysis:     bestRoute?.safetyAnalysis || null,
      fuelEstimate:       bestRoute?.fuelEstimate || null,
      fuelSaving:         bestRoute?.fuelSaving || null,
      deliveryPrediction: bestRoute?.deliveryPrediction || null,
      gradientAnalysis:   bestRoute?.gradientAnalysis || null,

      // All alternatives (for UI to offer choice)
      allRoutes:          ranked,
      rejectedRoutes,

      // Compliance
      compliance:         complianceResult,

      // Intelligence
      corridorDelay,
      depotForecast,
      driverProfile:      driverLearning.getRiskSummary(driverId),

      // Meta
      fromCache:          false,
      timestamp:          Date.now(),
      routeCount:         routes.length,
    }

    setCache(key, decision)
    return decision
  },

  /**
   * Quick fleet health check — no routing, just current state.
   */
  async getFleetIntelligence(vehicles = [], drivers = [], jobs = []) {
    const safetyKPIs     = safetyEngine.getFleetSafetyKPIs(vehicles, drivers)
    const complianceScore = complianceEngine.getFleetComplianceScore(vehicles)
    const fleetStats     = fleetLearning.getFleetStats()
    const intelligence   = fleetLearning.getIntelligenceSummary()
    const memoryStats    = routeMemory.getStats()

    const riskDrivers    = driverLearning
      .rankByRisk(drivers.map(d => d.id).filter(Boolean))
      .filter(d => d.riskScore > 60)

    const pendingJobs    = jobs.filter(j => j.status === 'pending' || !j.status)
    const scheduleRisks  = pendingJobs.length > 0
      ? predictionEngine.assessScheduleRisk(pendingJobs, { lat: 51.5074, lng: -0.1278 })
          .filter(r => r.riskLevel !== 'low')
      : []

    return {
      safetyKPIs,
      complianceScore,
      fleetStats,
      intelligence,
      riskDrivers,
      scheduleRisks,
      memoryStats,
      timestamp: Date.now(),
    }
  },

  /**
   * Record outcome after a job completes.
   * Call this from dispatchService.completeJob() hook.
   */
  recordOutcome({ origin, destination, vehicle, driver, job, route, actualDurationS, fuelUsedL }) {
    try {
      const distanceM = route?.distance || route?.distance_m || 0
      const planned   = route?.duration || route?.duration_s || 0

      routeMemory.recordSuccess({
        origin, destination,
        vehicleId:  vehicle?.id,
        driverId:   driver?.id,
        distanceM,
        durationS:  actualDurationS || planned,
        fuelUsedL:  fuelUsedL || 0,
        provider:   route?.source || 'unknown',
        stops:      job?.stops?.length || 1,
      })

      if (actualDurationS && planned) {
        routeMemory.recordDelay({
          origin, destination,
          vehicleId:        vehicle?.id,
          driverId:         driver?.id,
          plannedDurationS: planned,
          actualDurationS,
          cause:            actualDurationS > planned * 1.2 ? 'traffic' : 'none',
        })
      }

      if (fuelUsedL) {
        routeMemory.recordFuelPerformance({
          vehicleId:  vehicle?.id,
          driverId:   driver?.id,
          distanceM,
          fuelUsedL,
          provider:   route?.source,
        })

        const efficiency = efficiencyEngine.rateCompletedJourney({
          distanceM, durationS: actualDurationS || planned, fuelUsedL, vehicleId: vehicle?.id,
        })
        console.info('[Orchestrator] Journey efficiency:', efficiency)
      }

      driverLearning.recordJobComplete(driver?.id, {
        jobId:      job?.id,
        distanceKm: distanceM / 1000,
        onTime:     job?.on_time ?? true,
        delayMin:   actualDurationS && planned ? Math.round((actualDurationS - planned) / 60) : 0,
        vehicleId:  vehicle?.id,
      })

      complianceEngine.updateDriverShiftLog(driver?.id, {
        additionalHours: (actualDurationS || planned) / 3600,
      })

      fleetLearning.updateFleetStats({
        jobsCompleted: 1,
        kmDriven:      distanceM / 1000,
      })
    } catch (err) {
      console.warn('[Orchestrator] recordOutcome error:', err.message)
    }
  },

  _errorDecision(reason) {
    return {
      approved: false,
      blockedReason: reason,
      bestRoute: null,
      bestScore: null,
      allRoutes: [],
      rejectedRoutes: [],
      compliance: { passed: false, hardViolations: [reason], softViolations: [], expiryFlags: [] },
      timestamp: Date.now(),
    }
  },

  clearCache() { _cache.clear() },
}

export default aiOrchestrator
