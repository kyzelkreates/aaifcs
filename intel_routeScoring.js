/**
 * ============================================================
 * APEX INTELLIGENCE — Route Scoring Engine
 * File: intel_routeScoring.js
 *
 * Pure rule engine — NO external APIs, NO AI calls.
 * Scores every route across 9 dimensions then produces
 * a single weighted composite score (0-100, higher = better).
 *
 * Dimensions:
 *  safetyScore            weight 0.25  (highest — safety first)
 *  legalityScore          weight 0.20  (blocks illegal routes)
 *  efficiencyScore        weight 0.15  (time efficiency)
 *  fuelScore              weight 0.12  (fuel cost proxy)
 *  weatherScore           weight 0.08  (weather risk)
 *  trafficScore           weight 0.08  (congestion history)
 *  driverCompatScore      weight 0.05  (driver familiarity)
 *  vehicleCompatScore     weight 0.05  (vehicle suitability)
 *  profitabilityScore     weight 0.02  (basic cost model)
 *
 * NEVER imports from: mapService, localRoutingEngine, routeCache.
 * Reads from: intel_routeMemory, intel_safetyEngine,
 *             intel_complianceEngine (via injected context).
 * ============================================================
 */

import routeMemory from './intel_routeMemory'

// ─── Score weights ─────────────────────────────────────────────
const W = {
  safety:        0.25,
  legality:      0.20,
  efficiency:    0.15,
  fuel:          0.12,
  weather:       0.08,
  traffic:       0.08,
  driverCompat:  0.05,
  vehicleCompat: 0.05,
  profitability: 0.02,
}

// ─── Helpers ───────────────────────────────────────────────────
function clamp(v, min = 0, max = 100) {
  return Math.min(max, Math.max(min, Math.round(v)))
}

function weightedAvg(scores) {
  let total = 0
  let wsum  = 0
  for (const [key, weight] of Object.entries(W)) {
    const s = scores[key] ?? 50
    total  += s * weight
    wsum   += weight
  }
  return Math.round(total / wsum)
}

// ─── Individual scorers ────────────────────────────────────────

/**
 * SAFETY SCORE — based on route geometry + memory of dangerous segments
 * @param {object} route   - normalised route from mapService
 * @param {object} vehicle - vehicle record
 * @param {object} context - { dangerousSegments, weatherRisk, fatigueRisk, harshEvents }
 */
function scoreSafety(route, vehicle, context = {}) {
  let score = 100

  // Height restriction violations
  const heightM = parseFloat(vehicle?.height_m || 0)
  if (heightM > 3.0 && route?.lowBridgeRisk) score -= 40
  if (heightM > 4.5) score -= 20   // extra tall vehicle

  // Dangerous segments on or near route
  const dangerCount = context.dangerousSegments?.length || 0
  score -= Math.min(30, dangerCount * 8)

  // Weather risk (0-100 → invert penalty)
  const weatherRisk = context.weatherRisk || 0
  score -= Math.round(weatherRisk * 0.25)  // max -25

  // Driver fatigue risk (from intel_driverLearning)
  const fatigueRisk = context.fatigueRisk || 0
  score -= Math.round(fatigueRisk * 0.15)  // max -15

  // Harsh event history for this driver
  const harshRate = context.harshEventRate || 0   // events per 100km
  score -= Math.min(10, Math.round(harshRate * 2))

  // Night driving penalty (18:00–06:00)
  const hour = new Date().getHours()
  if (hour >= 22 || hour < 5) score -= 8
  else if (hour >= 18 || hour < 7) score -= 4

  // Route length penalty (very long routes = fatigue risk)
  const distKm = (route?.distance || route?.distance_m || 0) / 1000
  if (distKm > 500) score -= 15
  else if (distKm > 300) score -= 8
  else if (distKm > 200) score -= 3

  return clamp(score)
}

/**
 * LEGALITY SCORE — hard compliance check
 * Returns 0 if ANY hard legal violation detected.
 * Soft violations reduce score but don't zero it.
 * @param {object} route
 * @param {object} vehicle
 * @param {object} driver
 * @param {object} context - { estimatedDrivingHours, expiryFlags }
 */
function scoreLegality(route, vehicle, driver, context = {}) {
  let score = 100

  // ── Hard violations → immediately 0 ──────────────────────
  const violations = context.hardViolations || []
  if (violations.length > 0) return 0

  // ── Soft violations ───────────────────────────────────────

  // Driving hours (EU: max 9h/day, 10h twice/week; max 4.5h without break)
  const drivingHours = context.estimatedDrivingHours || 0
  if (drivingHours > 10) score -= 40  // over daily max
  else if (drivingHours > 9) score -= 20
  else if (drivingHours > 4.5) score -= 10  // needs break

  // Weight violation
  const gvw   = parseFloat(vehicle?.gross_weight_t || 0)
  const plated = parseFloat(vehicle?.plated_weight_t || vehicle?.gross_weight_t || 0)
  if (gvw > plated && plated > 0) score -= 30  // over plated weight

  // Expiry flags — each expired document = -15
  const expiryFlags = context.expiryFlags || []
  score -= Math.min(60, expiryFlags.length * 15)

  // ULEZ/LEZ compliance
  if (context.routeEntersLEZ && !vehicle?.ulez_compliant && !vehicle?.caz_compliant) {
    score -= 25
  }

  // Hazmat in restricted area
  if (vehicle?.hazmat && context.hazmatRestricted) score -= 35

  // No operator licence
  if (!vehicle?.operator_licence && gvw > 3.5) score -= 20

  // Tachograph compliance
  if (gvw > 3.5 && vehicle?.tacho_fitted === false) score -= 20

  return clamp(score)
}

/**
 * EFFICIENCY SCORE — time vs predicted / historical
 * @param {object} route
 * @param {object} context - { predictedDurationS, historicalAvgS, scheduledDeadlineTs }
 */
function scoreEfficiency(route, context = {}) {
  let score = 100
  const durationS  = route?.duration || route?.duration_s || 0
  const distKm     = (route?.distance || route?.distance_m || 0) / 1000

  // Predicted vs actual duration delta
  if (context.predictedDurationS && context.predictedDurationS > 0) {
    const delta = durationS - context.predictedDurationS
    const deltaPct = (delta / context.predictedDurationS) * 100
    if (deltaPct > 30) score -= 25       // significantly slower than predicted
    else if (deltaPct > 15) score -= 12
    else if (deltaPct < -10) score += 5  // faster than predicted — small bonus
  }

  // Historical average delta
  if (context.historicalAvgS && context.historicalAvgS > 0) {
    const histDelta = durationS - context.historicalAvgS
    const histPct   = (histDelta / context.historicalAvgS) * 100
    if (histPct > 25) score -= 15
    else if (histPct > 10) score -= 8
  }

  // Deadline feasibility
  if (context.scheduledDeadlineTs) {
    const nowSec      = Date.now() / 1000
    const deadlineSec = context.scheduledDeadlineTs / 1000
    const bufferS     = deadlineSec - nowSec - durationS
    if (bufferS < 0)        score -= 30  // will miss deadline
    else if (bufferS < 900) score -= 15  // <15 min buffer
    else if (bufferS < 1800) score -= 5  // <30 min buffer
  }

  // Speed efficiency: avg speed (penalise very slow routes)
  const avgSpeedKmh = durationS > 0 ? distKm / (durationS / 3600) : 0
  if (avgSpeedKmh > 0 && avgSpeedKmh < 20) score -= 20  // very congested
  else if (avgSpeedKmh < 35)               score -= 10

  return clamp(score)
}

/**
 * FUEL SCORE — based on distance, vehicle fuel efficiency, known avg
 * @param {object} route
 * @param {object} vehicle
 * @param {object} context - { vehicleAvgLPer100km }
 */
function scoreFuel(route, vehicle, context = {}) {
  let score = 100
  const distKm = (route?.distance || route?.distance_m || 0) / 1000
  const avgL   = context.vehicleAvgLPer100km || 8.5   // default 8.5 L/100km

  const estFuelL = (distKm / 100) * avgL

  // Score degrades as fuel cost grows
  if (estFuelL > 100) score -= 30
  else if (estFuelL > 60)  score -= 18
  else if (estFuelL > 30)  score -= 8
  else if (estFuelL > 15)  score -= 3

  // EV/HVO/CNG bonus
  const cleanFuels = ['electric', 'hydrogen', 'hvo', 'cng', 'lng']
  if (cleanFuels.includes(vehicle?.fuel_type)) score = Math.min(100, score + 10)

  // Low fuel level penalty
  const fuelPct = parseFloat(vehicle?.fuel_level || 100)
  if (fuelPct < 10) score -= 25  // risk of running out
  else if (fuelPct < 20) score -= 10
  else if (fuelPct < 30) score -= 5

  // Euro standard bonus
  const euroBonus = { 'euro6d': 5, 'euro6': 3, 'euro5': 0, 'euro4': -2, 'euro3': -5 }
  score += euroBonus[vehicle?.euro_standard] || 0

  return clamp(score)
}

/**
 * WEATHER SCORE — risk based on weather failure history + season
 * @param {object} context - { weatherRisk 0-100, weatherFailuresOnCorridor }
 */
function scoreWeather(context = {}) {
  let score = 100
  const risk         = context.weatherRisk || 0
  const failureCount = context.weatherFailuresOnCorridor || 0

  score -= Math.round(risk * 0.6)              // direct weather risk
  score -= Math.min(25, failureCount * 8)      // historical weather failures

  // Winter season adjustment (Dec, Jan, Feb, Nov = higher risk)
  const month = new Date().getMonth()  // 0=Jan
  if ([11, 0, 1].includes(month)) score -= 10  // deep winter
  else if ([10, 2].includes(month)) score -= 5  // shoulder winter

  return clamp(score)
}

/**
 * TRAFFIC SCORE — based on historical traffic patterns for this corridor+time
 * @param {object} route
 * @param {object} origin
 * @param {object} destination
 * @param {object} context - { corridorDelay }
 */
function scoreTraffic(route, origin, destination, context = {}) {
  let score = 100

  const delay = context.corridorDelay
  if (delay) {
    // Historical average delay percentage
    score -= Math.min(40, delay.avg_delay_pct * 0.8)
    // Sample confidence: fewer samples → less penalty weight
    if (delay.samples < 3) score = Math.max(score, 60)
  }

  // Route duration relative to distance (speed proxy)
  const durationS = route?.duration || route?.duration_s || 0
  const distKm    = (route?.distance || route?.distance_m || 0) / 1000
  const avgSpeed  = durationS > 0 ? distKm / (durationS / 3600) : 0
  if (avgSpeed < 25 && distKm > 10) score -= 20  // very congested
  else if (avgSpeed < 40 && distKm > 10) score -= 10

  // Time-of-day rush hour penalty
  const hour = new Date().getHours()
  if ((hour >= 7 && hour <= 9) || (hour >= 16 && hour <= 19)) score -= 12

  return clamp(score)
}

/**
 * DRIVER COMPATIBILITY SCORE — familiarity with route
 * @param {string} driverId
 * @param {object} origin
 * @param {object} destination
 */
function scoreDriverCompat(driverId, origin, destination) {
  let score = 70   // base: moderate unfamiliarity
  const prefs = routeMemory.getDriverPreferences(driverId)
  const key   = `${Number(origin.lat).toFixed(3)},${Number(origin.lng).toFixed(3)}→${Number(destination.lat).toFixed(3)},${Number(destination.lng).toFixed(3)}`
  const pref  = prefs.find(p => p.od_key === key)
  if (pref) {
    score += Math.min(25, pref.count * 3)          // familiarity bonus (capped)
    if (pref.ai_overrides > 3) score -= 5          // driver often ignores AI
  }

  const success  = routeMemory.getSuccessHistory(origin, destination, 10)
  const driverSuc = success.filter(r => r.driver_id === driverId)
  score += Math.min(5, driverSuc.length * 2)

  return clamp(score)
}

/**
 * VEHICLE COMPATIBILITY SCORE — suitability for this specific route
 * @param {object} vehicle
 * @param {object} route
 * @param {object} context - { routeHasLowBridges, routeHasWeightLimits, maxWeightOnRoute }
 */
function scoreVehicleCompat(vehicle, route, context = {}) {
  let score = 90  // base: assume compatible
  const heightM = parseFloat(vehicle?.height_m || 0)
  const gvwT    = parseFloat(vehicle?.gross_weight_t || 0)

  // Low bridge risk
  if (heightM > 3.0 && context.routeHasLowBridges) score -= 35

  // Weight limit on route
  if (context.maxWeightOnRoute && gvwT > 0) {
    if (gvwT > context.maxWeightOnRoute) score -= 40
  }

  // Very long vehicle on tight route
  const lengthM = parseFloat(vehicle?.length_m || 0)
  if (lengthM > 15 && context.routeHasTightTurns) score -= 15

  // Vehicle due for service
  if (vehicle?.next_service_date) {
    const daysToService = (new Date(vehicle.next_service_date) - new Date()) / 86400000
    if (daysToService < 0)   score -= 20  // overdue service
    else if (daysToService < 7) score -= 10
  }

  // ULEZ/LEZ if route enters zone
  if (context.routeEntersLEZ && !vehicle?.ulez_compliant) score -= 20

  return clamp(score)
}

/**
 * PROFITABILITY SCORE — simple cost model
 * @param {object} route
 * @param {object} context - { jobValueGBP, estimatedFuelCostGBP, tolls }
 */
function scoreProfitability(route, context = {}) {
  let score = 50   // neutral base when no financial data
  const jobValue = context.jobValueGBP || 0
  const fuelCost = context.estimatedFuelCostGBP || 0
  const tolls    = context.tollsGBP || 0

  if (jobValue > 0) {
    const margin = (jobValue - fuelCost - tolls) / jobValue
    if (margin > 0.7)       score = 95
    else if (margin > 0.5)  score = 85
    else if (margin > 0.3)  score = 70
    else if (margin > 0.1)  score = 55
    else if (margin > 0)    score = 40
    else                    score = 10   // losing money
  }

  return clamp(score)
}

// ─── Public API ───────────────────────────────────────────────

export const routeScoring = {

  /**
   * Score a single route across all 9 dimensions.
   *
   * @param {object} route      - Normalised route from mapService
   * @param {object} vehicle    - Vehicle record from fleetService
   * @param {object} driver     - Driver record from driverService
   * @param {object} context    - Full scoring context (see below)
   * @returns {object} ScoredRoute
   *
   * context shape:
   * {
   *   origin, destination,
   *   dangerousSegments,      // from routeMemory
   *   weatherRisk,            // 0-100
   *   weatherFailuresOnCorridor,
   *   fatigueRisk,            // 0-100
   *   harshEventRate,         // per 100km
   *   hardViolations,         // string[]
   *   expiryFlags,            // string[]
   *   estimatedDrivingHours,
   *   routeEntersLEZ,
   *   hazmatRestricted,
   *   predictedDurationS,
   *   historicalAvgS,
   *   scheduledDeadlineTs,
   *   corridorDelay,          // from routeMemory
   *   vehicleAvgLPer100km,
   *   routeHasLowBridges,
   *   routeHasWeightLimits,
   *   maxWeightOnRoute,
   *   routeHasTightTurns,
   *   jobValueGBP,
   *   estimatedFuelCostGBP,
   *   tollsGBP,
   * }
   */
  scoreRoute(route, vehicle = {}, driver = {}, context = {}) {
    const origin      = context.origin      || {}
    const destination = context.destination || {}

    const scores = {
      safety:        scoreSafety(route, vehicle, context),
      legality:      scoreLegality(route, vehicle, driver, context),
      efficiency:    scoreEfficiency(route, context),
      fuel:          scoreFuel(route, vehicle, context),
      weather:       scoreWeather(context),
      traffic:       scoreTraffic(route, origin, destination, context),
      driverCompat:  scoreDriverCompat(driver?.id || '', origin, destination),
      vehicleCompat: scoreVehicleCompat(vehicle, route, context),
      profitability: scoreProfitability(route, context),
    }

    const composite = weightedAvg(scores)

    // Hard legality override — if legality is 0, composite cannot exceed 5
    const finalComposite = scores.legality === 0
      ? Math.min(composite, 5)
      : composite

    return {
      route,
      scores,
      composite:    finalComposite,
      grade:        this.grade(finalComposite),
      rejected:     scores.legality === 0,
      rejectedReason: scores.legality === 0
        ? (context.hardViolations?.[0] || 'Legal violation')
        : null,
      warnings:     this._buildWarnings(scores, context),
      timestamp:    Date.now(),
    }
  },

  /**
   * Score multiple routes and return ranked array (best first).
   */
  rankRoutes(routes, vehicle, driver, context) {
    return routes
      .map(r => this.scoreRoute(r, vehicle, driver, context))
      .filter(r => !r.rejected)
      .sort((a, b) => b.composite - a.composite)
  },

  /**
   * Return letter grade for a composite score.
   */
  grade(composite) {
    if (composite >= 90) return 'A+'
    if (composite >= 80) return 'A'
    if (composite >= 70) return 'B'
    if (composite >= 60) return 'C'
    if (composite >= 50) return 'D'
    return 'F'
  },

  /**
   * Colour class for a score (Tailwind).
   */
  scoreColor(composite) {
    if (composite >= 80) return 'text-emerald-400'
    if (composite >= 65) return 'text-cyan-400'
    if (composite >= 50) return 'text-yellow-400'
    if (composite >= 35) return 'text-amber-400'
    return 'text-red-400'
  },

  scoreBg(composite) {
    if (composite >= 80) return 'bg-emerald-500/10 border-emerald-500/20'
    if (composite >= 65) return 'bg-cyan-500/10 border-cyan-500/20'
    if (composite >= 50) return 'bg-yellow-500/10 border-yellow-500/20'
    if (composite >= 35) return 'bg-amber-500/10 border-amber-500/20'
    return 'bg-red-500/10 border-red-500/20'
  },

  /** Build user-facing warning list from score breakdown */
  _buildWarnings(scores, context) {
    const warnings = []
    if (scores.safety < 60)       warnings.push({ level: 'danger', msg: 'High safety risk on this route' })
    if (scores.legality < 70 && scores.legality > 0) warnings.push({ level: 'warn',   msg: 'Compliance issues detected' })
    if (scores.efficiency < 50)   warnings.push({ level: 'warn',   msg: 'Route is slower than historical average' })
    if (scores.fuel < 50)         warnings.push({ level: 'info',   msg: 'Higher than average fuel consumption expected' })
    if (scores.weather < 50)      warnings.push({ level: 'warn',   msg: 'Weather risk on this corridor' })
    if (scores.traffic < 50)      warnings.push({ level: 'info',   msg: 'Expected congestion delays' })
    if (scores.driverCompat < 50) warnings.push({ level: 'info',   msg: 'Driver unfamiliar with this route' })
    if (scores.vehicleCompat < 60) warnings.push({ level: 'warn',  msg: 'Vehicle may not be suitable for this route' })
    if (context.predictedDurationS && context.scheduledDeadlineTs) {
      const slack = (context.scheduledDeadlineTs - Date.now()) / 1000 - (context.predictedDurationS || 0)
      if (slack < 0) warnings.push({ level: 'danger', msg: 'Will miss scheduled delivery time' })
    }
    return warnings
  },

  /** Weights (for display in UI) */
  getWeights: () => ({ ...W }),
}

export default routeScoring
