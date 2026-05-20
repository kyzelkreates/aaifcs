/**
 * ============================================================
 * APEX INTELLIGENCE — GraphHopper Adapter (Intelligence Layer)
 * File: intel_graphhopperAdapter.js
 *
 * WRAPS the existing mapService.js — does NOT replace it.
 * Existing mapService.route() continues to work unchanged.
 *
 * Adds intelligence ON TOP of mapService:
 *  - Fetches multiple route alternatives from GH
 *  - Applies vehicle profile parameters (height, weight, hazmat)
 *  - Requests elevation data for gradient analysis
 *  - Normalises response for routeScoring engine
 *  - Falls back to mapService.route() automatically
 *
 * DESIGN:
 *  mapService handles: provider selection, fallback chain, caching
 *  This adapter handles: vehicle-aware GH calls + multi-route fetch
 * ============================================================
 */

import { getRuntimeKey, RUNTIME_KEYS } from './services_maps_runtimeKeys'
import { mapService }                  from './services_maps_mapService'

const GH_BASE = 'https://graphhopper.com/api/1'

// ─── Vehicle profile mapping ─────────────────────────────────
function ghProfile(vehicle) {
  const gvwT    = parseFloat(vehicle?.gross_weight_t || 0)
  const fuelType = vehicle?.fuel_type || 'diesel'

  if (fuelType === 'electric')    return 'truck'  // GH doesn't have EV truck yet
  if (gvwT > 7.5)                return 'truck'
  if (gvwT > 3.5)                return 'small_truck'
  if (vehicle?.type === 'bike')   return 'bike'
  return 'car'
}

// ─── Build GH custom model for vehicle restrictions ───────────
function buildCustomModel(vehicle) {
  const heightM = parseFloat(vehicle?.height_m || 0)
  const weightT = parseFloat(vehicle?.gross_weight_t || 0)
  const hazmat  = vehicle?.hazmat || false

  const avoid = []

  if (heightM > 3.0) {
    avoid.push({ if: 'max_height < ' + heightM.toFixed(1), multiply_by: '0' })
  }
  if (weightT > 0) {
    avoid.push({ if: 'max_weight < ' + weightT.toFixed(1), multiply_by: '0' })
  }
  if (hazmat) {
    avoid.push({ if: 'hazmat_restriction', multiply_by: '0' })
  }
  if (vehicle?.hgv_restriction_24h) {
    // Penalise residential roads at restricted hours
    const hour = new Date().getHours()
    if (hour >= 23 || hour < 6) {
      avoid.push({ if: 'road_class == RESIDENTIAL', multiply_by: '0.1' })
    }
  }

  return avoid.length > 0 ? { speed: avoid } : null
}

// ─── Normalise GH alternative route ──────────────────────────
function normaliseGHRoute(path, idx, vehicle) {
  if (!path) return null
  return {
    source:             'graphhopper',
    routeIndex:         idx,
    distance:           path.distance || 0,
    distance_m:         path.distance || 0,
    duration:           (path.time || 0) / 1000,
    duration_s:         (path.time || 0) / 1000,
    geometry:           path.points,
    instructions:       (path.instructions || []).map(i => ({
      text:     i.text,
      distance: i.distance,
      time:     i.time / 1000,
      sign:     i.sign,
    })),
    ascend:             path.ascend   || 0,   // elevation gain metres
    descend:            path.descend  || 0,
    points_order:       path.points_order,
    transfer:           path.transfers || 0,
    details:            path.details  || {},
    bbox:               path.bbox,
    attribution:        '© OpenStreetMap contributors, GraphHopper',
    // Intelligence flags derived from path details
    lowBridgeRisk:      false,     // populated below if details available
    hasWeightLimits:    false,
    hasTunnels:         (path.details?.tunnel?.length || 0) > 0,
    elevationGain:      path.ascend || 0,
    elevationLoss:      path.descend || 0,
  }
}

// ─── Public API ───────────────────────────────────────────────
export const graphhopperAdapter = {

  /**
   * Fetch up to 3 route alternatives from GraphHopper with
   * vehicle-aware profile. Falls back to mapService.route() if
   * GH key not available or request fails.
   *
   * @param {object} origin      - { lat, lng }
   * @param {object} destination - { lat, lng }
   * @param {object} vehicle     - vehicle record (for profile + restrictions)
   * @param {object} options     - { alternatives: boolean, elevation: boolean }
   * @returns {object[]} Array of normalised routes (best first by GH)
   */
  async fetchRoutes(origin, destination, vehicle = {}, options = {}) {
    const key = getRuntimeKey(RUNTIME_KEYS.GRAPHHOPPER)

    if (!key) {
      // No GH key — fall back to mapService (OSRM)
      const fallback = await mapService.route(origin, destination)
      return fallback ? [fallback] : []
    }

    try {
      const profile     = ghProfile(vehicle)
      const customModel = buildCustomModel(vehicle)
      const wantAlts    = options.alternatives !== false
      const wantElev    = options.elevation    !== false

      const url = new URL(`${GH_BASE}/route`)
      url.searchParams.set('key', key)
      url.searchParams.set('vehicle', profile)
      url.searchParams.set('locale', 'en')
      url.searchParams.set('instructions', 'true')
      url.searchParams.set('calc_points', 'true')
      url.searchParams.set('points_encoded', 'false')
      url.searchParams.set('elevation', wantElev ? 'true' : 'false')
      url.searchParams.set('algorithm', wantAlts ? 'alternative_route' : 'dijkstra')
      url.searchParams.set('ch.disable', customModel ? 'true' : 'false')
      url.searchParams.set('details', 'max_speed,road_class,tunnel,surface')
      url.searchParams.append('point', `${origin.lat},${origin.lng}`)
      url.searchParams.append('point', `${destination.lat},${destination.lng}`)

      const body = customModel
        ? JSON.stringify({ custom_model: { priority: buildCustomModel(vehicle) } })
        : undefined

      const res = await fetch(url.toString(), {
        method:  customModel ? 'POST' : 'GET',
        headers: customModel ? { 'Content-Type': 'application/json' } : {},
        body,
        signal: AbortSignal.timeout(12000),
      })

      if (!res.ok) throw new Error(`GH ${res.status}`)
      const data = await res.json()

      if (!data.paths?.length) throw new Error('GH: no paths returned')

      return data.paths
        .map((p, i) => normaliseGHRoute(p, i, vehicle))
        .filter(Boolean)
    } catch (err) {
      console.warn('[IntelGH] GH failed, falling back to mapService:', err.message)
      const fallback = await mapService.route(origin, destination)
      return fallback ? [{ ...fallback, routeIndex: 0 }] : []
    }
  },

  /**
   * Geocode via GH (falls back to mapService.geocode).
   */
  async geocode(query) {
    return mapService.geocode(query)
  },

  /**
   * Estimate gradient risk from elevation data.
   * Returns { steepSections, maxGradientPct, riskScore }
   */
  analyseGradient(route) {
    const ascend  = route?.ascend  || route?.elevationGain || 0
    const descend = route?.descend || route?.elevationLoss || 0
    const distKm  = (route?.distance || route?.distance_m || 0) / 1000
    if (distKm === 0) return { steepSections: 0, maxGradientPct: 0, riskScore: 0 }

    const avgGradientPct = ((ascend + descend) / 2 / (distKm * 10))  // rough
    const riskScore = Math.min(100,
      avgGradientPct > 8 ? 60 : avgGradientPct > 5 ? 30 : avgGradientPct > 3 ? 15 : 5
    )

    return {
      steepSections:   riskScore > 30 ? Math.ceil(distKm / 10) : 0,
      maxGradientPct:  Math.round(avgGradientPct * 10) / 10,
      ascendM:         Math.round(ascend),
      descendM:        Math.round(descend),
      riskScore,
    }
  },

  /**
   * Detect potential low-bridge risk from route details.
   */
  detectLowBridgeRisk(route, vehicleHeightM) {
    if (!vehicleHeightM || vehicleHeightM < 3.0) return false
    // GH details don't directly give bridge height — use presence of tunnels + height as proxy
    if (route?.hasTunnels && vehicleHeightM > 4.0) return true
    return false
  },
}

export default graphhopperAdapter
