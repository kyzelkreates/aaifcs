/**
 * ============================================================
 * AP3X FLEET INTELLIGENCE — Routing Engine
 * engine/routing_engine.js
 *
 * GraphHopper ONLY for route + ETA calculation.
 * Falls back to Nominatim geocoding + straight-line estimation
 * when GraphHopper key is unavailable (graceful degradation).
 *
 * NO external AI. NO schema changes. NO side effects.
 *
 * INPUT:   driverLocation { lat, lng }
 *          pickupAddress  string
 *          dropoffAddress string (optional — for full journey ETA)
 *          vehicle        object (optional — for profile selection)
 *
 * OUTPUT:  RouteResult {
 *            distance_km:   number
 *            eta_minutes:   number
 *            confidence:    'graphhopper' | 'osrm' | 'estimated'
 *            route_data:    object | null   (GH path if available)
 *            pickup_coords: { lat, lng } | null
 *            error:         string | null   (non-fatal — engine never throws)
 *          }
 * ============================================================
 */

import { graphhopperAdapter } from '../intel_graphhopperAdapter'
import { getRuntimeKey, RUNTIME_KEYS } from '../services_maps_runtimeKeys'

const NOMINATIM = 'https://nominatim.openstreetmap.org/search'
const AVG_SPEED_KMH = 50   // conservative urban average for ETA fallback

// ─── Geocode a free-text address → { lat, lng } ───────────────
async function geocode(address) {
  if (!address?.trim()) return null
  try {
    const url = `${NOMINATIM}?q=${encodeURIComponent(address)}&format=json&limit=1`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'ApexAI-FleetOS/2.0 dispatch-intelligence' },
      signal:  AbortSignal.timeout(6000),
    })
    const data = await res.json()
    if (data?.[0]) {
      return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) }
    }
  } catch (e) {
    console.debug('[RoutingEngine] geocode failed:', e.message)
  }
  return null
}

// ─── Straight-line km → ETA (fallback only) ──────────────────
function haversineKm(a, b) {
  if (!a?.lat || !a?.lng || !b?.lat || !b?.lng) return null
  const R   = 6371
  const d2r = Math.PI / 180
  const dLat = (b.lat - a.lat) * d2r
  const dLng = (b.lng - a.lng) * d2r
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(a.lat * d2r) * Math.cos(b.lat * d2r) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.asin(Math.sqrt(s))
}

function straightLineEta(km) {
  // Road distance ≈ 1.4× straight-line (circuity factor)
  const roadKm = km * 1.4
  return { distance_km: Math.round(roadKm * 10) / 10, eta_minutes: Math.round((roadKm / AVG_SPEED_KMH) * 60) }
}

/**
 * calculateRoute(driverLocation, pickupAddress, dropoffAddress?, vehicle?)
 *
 * Primary path:  GraphHopper (if key available)
 * Secondary path: OSRM via graphhopperAdapter fallback
 * Tertiary path:  Haversine straight-line estimate
 */
export async function calculateRoute(driverLocation, pickupAddress, dropoffAddress = null, vehicle = null) {
  const result = {
    distance_km:    null,
    eta_minutes:    null,
    confidence:     'estimated',
    route_data:     null,
    pickup_coords:  null,
    dropoff_coords: null,
    error:          null,
  }

  // Step 1: resolve pickup address to coords
  let pickupCoords = null
  if (driverLocation?.lat && pickupAddress) {
    pickupCoords = await geocode(pickupAddress)
  }
  result.pickup_coords = pickupCoords

  // Step 2: resolve dropoff (optional — for full-trip ETA display)
  if (dropoffAddress) {
    result.dropoff_coords = await geocode(dropoffAddress)
  }

  // Step 3: if we have driver location + pickup coords, calculate route
  if (driverLocation?.lat && driverLocation?.lng && pickupCoords) {
    try {
      const routes = await graphhopperAdapter.fetchRoutes(
        { lat: driverLocation.lat, lng: driverLocation.lng },
        pickupCoords,
        vehicle || {},
        { alternatives: false, elevation: false }
      )

      if (routes?.length > 0) {
        const best = routes[0]
        const distM  = best.distance_m || best.distance || 0
        const durS   = best.duration_s || best.duration || 0
        result.distance_km  = Math.round((distM / 1000) * 10) / 10
        result.eta_minutes  = Math.round(durS / 60)
        result.confidence   = best.source === 'graphhopper' ? 'graphhopper' : 'osrm'
        result.route_data   = best
        return result
      }
    } catch (e) {
      console.debug('[RoutingEngine] Route fetch failed:', e.message)
      result.error = `Route calculation unavailable: ${e.message}`
    }
  }

  // Step 4: fallback — straight-line haversine estimate
  if (driverLocation?.lat && pickupCoords) {
    const km = haversineKm(driverLocation, pickupCoords)
    if (km !== null) {
      const est = straightLineEta(km)
      result.distance_km = est.distance_km
      result.eta_minutes = est.eta_minutes
      result.confidence  = 'estimated'
      result.error       = result.error || (!getRuntimeKey(RUNTIME_KEYS.GRAPHHOPPER)
        ? 'No GraphHopper API key — ETA is a straight-line estimate. Add key in Settings for precise routing.'
        : 'Route engine unavailable — using straight-line estimate.')
      return result
    }
  }

  // No location available at all
  result.error = driverLocation?.lat
    ? 'Could not geocode pickup address'
    : 'Driver has no GPS location — ETA unavailable'

  return result
}

/**
 * calculateRoutesForCandidates(task, scoredDrivers, driverLocations, vehicle?)
 *
 * Runs calculateRoute() for the top N drivers (default 3).
 * Returns the scored drivers list enriched with .route field.
 * Non-blocking — each driver's route is fetched in parallel.
 */
export async function calculateRoutesForCandidates(task, scoredDrivers, driverLocations = [], vehicle = null, topN = 3) {
  const locMap = new Map(driverLocations.map(l => [l.driver_id, l]))
  const candidates = scoredDrivers.slice(0, topN)

  const withRoutes = await Promise.all(
    candidates.map(async (sd) => {
      const loc  = locMap.get(sd.driver_id) || sd.location
      const dLoc = loc?.lat ? { lat: loc.lat, lng: loc.lng } : null

      const route = await calculateRoute(
        dLoc,
        task.pickup_address || task.origin || null,
        task.dropoff_address || task.destination || null,
        vehicle
      )

      return { ...sd, route }
    })
  )

  return withRoutes
}

export const routingEngine = { calculateRoute, calculateRoutesForCandidates }
export default routingEngine
