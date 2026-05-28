/**
 * AP3X Route Memory Service (Driver-side, Local-first)
 *
 * Stores active route snapshots in IndexedDB, tracks deviations,
 * and syncs metadata-only to Supabase when online.
 *
 * DRIVER PWA ONLY — no Fleet OS coupling.
 */

import { saveRouteSnapshot, getRouteSnapshot } from './services_safety_offlineVault'
import { getSupabaseClient } from './services_supabase_supabaseClient'

const DEVIATION_THRESHOLD_M = 150  // metres off-route before flagging

// ─── Haversine distance (metres) ─────────────────────────────
function haversine(lat1, lng1, lat2, lng2) {
  const R   = 6371000
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a   = Math.sin(dLat / 2) ** 2 +
              Math.cos((lat1 * Math.PI) / 180) *
              Math.cos((lat2 * Math.PI) / 180) *
              Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ─── Find closest point on a polyline ────────────────────────
function closestPointDist(lat, lng, polyline) {
  let best = Infinity
  for (const pt of polyline) {
    const d = haversine(lat, lng, pt[0], pt[1])
    if (d < best) best = d
  }
  return best
}

// ─── Active session state ─────────────────────────────────────
let _session = null

/**
 * Start a new route memory session.
 * @param {string} taskId
 * @param {string} driverId
 * @param {Array}  routePolyline  - array of [lat, lng]
 * @param {Array}  stops          - stop objects
 */
export function startRouteMemory(taskId, driverId, routePolyline = [], stops = []) {
  _session = {
    id:           crypto.randomUUID(),
    task_id:      taskId,
    driver_id:    driverId,
    route_geometry: routePolyline,
    stops,
    deviations:   [],
    risk_flags:   [],
    completion_pct: 0,
    started_at:   new Date().toISOString(),
    completed_at: null,
    breadcrumbs:  [],
  }

  // Persist to IndexedDB immediately
  saveRouteSnapshot(_session).catch(() => {})

  console.info('[RouteMemory] Session started:', _session.id)
  return _session
}

/**
 * Record a GPS position update.
 * Detects deviations from the planned route.
 */
export function updatePosition(lat, lng, speedKmh = 0, heading = 0) {
  if (!_session) return

  const ts = Date.now()
  _session.breadcrumbs.push({ lat, lng, ts, speed: speedKmh, heading })

  // Deviation check
  if (_session.route_geometry.length > 1) {
    const dist = closestPointDist(lat, lng, _session.route_geometry)
    if (dist > DEVIATION_THRESHOLD_M) {
      const already = _session.deviations.some(d =>
        ts - d.ts < 30000 // deduplicate within 30 s
      )
      if (!already) {
        _session.deviations.push({ lat, lng, dist_m: Math.round(dist), ts })
        // Persist updated snapshot
        saveRouteSnapshot(_session).catch(() => {})
      }
    }
  }

  // Update completion estimate (simple: how far along the polyline we are)
  if (_session.route_geometry.length > 1 && _session.breadcrumbs.length > 1) {
    const first = _session.route_geometry[0]
    const last  = _session.route_geometry[_session.route_geometry.length - 1]
    const total = haversine(first[0], first[1], last[0], last[1]) || 1
    const done  = haversine(first[0], first[1], lat, lng)
    _session.completion_pct = Math.min(100, Math.round((done / total) * 100))
  }
}

/**
 * Flag a risk zone at current position.
 */
export function flagRiskZone(lat, lng, type = 'unknown', details = {}) {
  if (!_session) return
  _session.risk_flags.push({ lat, lng, type, ...details, ts: Date.now() })
  saveRouteSnapshot(_session).catch(() => {})
}

/**
 * Mark the route session as complete and sync to Supabase.
 */
export async function completeRouteMemory() {
  if (!_session) return null
  _session.completed_at  = new Date().toISOString()
  _session.completion_pct = 100

  await saveRouteSnapshot(_session)

  // Sync metadata (no geometry blob to keep payload small)
  if (navigator.onLine) {
    try {
      const sb = getSupabaseClient()
      if (sb) {
        const { breadcrumbs: _b, ...meta } = _session
        await sb.from('driver_route_memory').upsert(meta, { onConflict: 'id' })
      }
    } catch {}
  }

  const done = _session
  _session   = null
  return done
}

/** Get the current session snapshot */
export function getCurrentSession() { return _session }

/** Hydrate session from IndexedDB for a given task */
export async function loadRouteMemory(taskId) {
  return getRouteSnapshot(taskId)
}
