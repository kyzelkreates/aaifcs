/**
 * ============================================================
 * AP3X — Sync Verification Service (READ-ONLY)
 * File: services_sync_syncVerificationService.js
 *
 * PURPOSE:
 *   Lightweight diagnostic layer that verifies REAL Supabase
 *   data flow by reading from the three most meaningful live
 *   signals in the locked schema:
 *
 *     1. dashboard_events  — explicit event log (type + payload)
 *     2. driver_locations  — live GPS updates (highest frequency)
 *     3. tasks             — operational task lifecycle events
 *
 *   NOTE ON TABLE NAMES:
 *   The AP3X spec references "events", "insights", "fleet_metrics"
 *   — none of those tables exist in the locked schema.
 *   The real equivalents used here are:
 *     - dashboard_events  → "events" equivalent
 *     - driver_locations  → live telemetry freshness signal
 *     - tasks             → operational event freshness signal
 *
 * HARD RULES (immutable):
 *   ✅ READ ONLY — no writes, no inserts, no updates
 *   ✅ Uses existing Supabase client — no new connections
 *   ✅ Does NOT modify Federation OS, Driver PWA, or event schema
 *   ✅ Gracefully degrades — all errors return safe fallback values
 *   ✅ Append-only contract maintained (no schema changes)
 *
 * SYNC HEALTH THRESHOLDS:
 *   LIVE     → last event < 60s ago
 *   DELAYED  → last event 60s–180s ago
 *   STALE    → last event > 180s ago
 *   UNKNOWN  → no events found or Supabase not configured
 * ============================================================
 */

import { getSupabaseClient, isSupabaseReady } from './services_supabase_supabaseClient'

// ─── Thresholds (ms) ─────────────────────────────────────────
export const SYNC_THRESHOLDS = {
  LIVE_MS:    60  * 1000,   //  60 seconds
  DELAYED_MS: 180 * 1000,   // 180 seconds (3 minutes)
}

// ─── Sync health levels ────────────────────────────────────────
export const SYNC_HEALTH = {
  LIVE:    'LIVE',
  DELAYED: 'DELAYED',
  STALE:   'STALE',
  UNKNOWN: 'UNKNOWN',
}

/**
 * Compute sync health label from a timestamp.
 * @param {string|null} isoTimestamp — ISO 8601 string or null
 * @returns {{ health: string, ageMs: number|null, ageLabel: string }}
 */
export function computeSyncHealth(isoTimestamp) {
  if (!isoTimestamp) {
    return { health: SYNC_HEALTH.UNKNOWN, ageMs: null, ageLabel: 'No data' }
  }
  const ts = new Date(isoTimestamp).getTime()
  if (isNaN(ts)) {
    return { health: SYNC_HEALTH.UNKNOWN, ageMs: null, ageLabel: 'Invalid timestamp' }
  }
  const ageMs = Date.now() - ts
  let health
  if (ageMs < SYNC_THRESHOLDS.LIVE_MS)         health = SYNC_HEALTH.LIVE
  else if (ageMs < SYNC_THRESHOLDS.DELAYED_MS)  health = SYNC_HEALTH.DELAYED
  else                                           health = SYNC_HEALTH.STALE

  return { health, ageMs, ageLabel: _formatAge(ageMs) }
}

/** Format age ms into a human-readable string */
function _formatAge(ageMs) {
  if (ageMs < 1000)          return 'just now'
  if (ageMs < 60_000)        return `${Math.floor(ageMs / 1000)}s ago`
  if (ageMs < 3_600_000)     return `${Math.floor(ageMs / 60_000)}m ago`
  return `${Math.floor(ageMs / 3_600_000)}h ago`
}

/**
 * Safe Supabase read helper.
 * Returns { data, error } — never throws.
 */
async function _safeRead(queryFn) {
  try {
    const result = await queryFn()
    return result
  } catch (e) {
    return { data: null, error: { message: e?.message ?? 'Unknown error' } }
  }
}

// ─── Source queries (READ ONLY) ───────────────────────────────

/**
 * Query latest dashboard_events record.
 * This is the "events" table equivalent in the locked schema.
 * Schema: { id, type, payload (jsonb), created_at }
 *
 * @returns {{ timestamp: string|null, type: string|null, source: string|null, preview: string|null }}
 */
async function _queryDashboardEvents(sb) {
  const { data, error } = await _safeRead(() =>
    sb
      .from('dashboard_events')
      .select('id, type, payload, created_at')
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
  )
  if (error || !data) return null
  return {
    timestamp: data.created_at,
    type:      data.type || 'dashboard_event',
    source:    (data.payload?.source) || 'fleet_os',
    preview:   _buildPreview(data.payload, data.type),
    table:     'dashboard_events',
  }
}

/**
 * Query latest driver_locations update.
 * driver_locations has updated_at and is the highest-frequency
 * live signal in the locked schema (GPS tick every ~5s).
 * Schema: { driver_id, lat, lng, speed, heading, status, updated_at }
 *
 * @returns {{ timestamp: string|null, type: string, source: string, preview: string|null }}
 */
async function _queryDriverLocations(sb) {
  const { data, error } = await _safeRead(() =>
    sb
      .from('driver_locations')
      .select('driver_id, lat, lng, speed, status, updated_at')
      .order('updated_at', { ascending: false })
      .limit(1)
      .single()
  )
  if (error || !data) return null
  return {
    timestamp: data.updated_at,
    type:      'DRIVER_LOCATION',
    source:    'driver_pwa',
    preview:   `Driver ${data.driver_id?.slice(0, 8)}… · ${data.speed ?? 0} km/h · ${data.status ?? 'unknown'}`,
    table:     'driver_locations',
  }
}

/**
 * Query latest tasks record (updated_at).
 * Tasks represent the operational lifecycle — any status change
 * (pending→assigned→completed) is a sync signal.
 * Schema: { id, status, updated_at }
 *
 * @returns {{ timestamp: string|null, type: string, source: string, preview: string|null }}
 */
async function _queryTasks(sb) {
  const { data, error } = await _safeRead(() =>
    sb
      .from('tasks')
      .select('id, status, updated_at')
      .order('updated_at', { ascending: false })
      .limit(1)
      .single()
  )
  if (error || !data) return null
  return {
    timestamp: data.updated_at,
    type:      `TASK_${(data.status || 'update').toUpperCase()}`,
    source:    'fleet_os',
    preview:   `Task ${data.id?.slice(0, 8)}… — status: ${data.status ?? '—'}`,
    table:     'tasks',
  }
}

/**
 * Build a short human-readable preview string from a JSONB payload.
 * Safe — never throws. Truncated to 80 chars.
 */
function _buildPreview(payload, type) {
  if (!payload || typeof payload !== 'object') return type || null
  try {
    const keys = Object.keys(payload).slice(0, 3)
    if (keys.length === 0) return type || null
    const parts = keys.map(k => {
      const v = payload[k]
      const str = typeof v === 'object' ? JSON.stringify(v) : String(v ?? '')
      return `${k}: ${str.slice(0, 20)}`
    })
    const full = parts.join(' · ')
    return full.length > 80 ? `${full.slice(0, 77)}…` : full
  } catch {
    return null
  }
}

// ─── Main export ──────────────────────────────────────────────

/**
 * Run a full sync verification check.
 *
 * Queries all three data sources in parallel and returns
 * the combined result with the freshest event signal surfaced first.
 *
 * @returns {Promise<SyncVerificationResult>}
 *
 * @typedef {object} SyncVerificationResult
 * @property {boolean}      supabaseReady     — Supabase client is configured and ready
 * @property {object|null}  latestEvent       — { timestamp, type, source, preview, table }
 * @property {string}       lastEventType     — event type string (or 'UNKNOWN')
 * @property {string}       lastEventSource   — source identifier (or 'unknown')
 * @property {string|null}  lastEventTimestamp — ISO timestamp string or null
 * @property {string}       health            — LIVE | DELAYED | STALE | UNKNOWN
 * @property {number|null}  ageMs             — ms since last event
 * @property {string}       ageLabel          — human-readable age string
 * @property {string[]|null} sources          — which tables had data
 * @property {string|null}  error             — error message if query failed
 */
export async function runSyncVerification() {
  // ── Guard: check Supabase is configured ─────────────────────
  if (!isSupabaseReady()) {
    return {
      supabaseReady:      false,
      latestEvent:        null,
      lastEventType:      'UNKNOWN',
      lastEventSource:    'unknown',
      lastEventTimestamp: null,
      health:             SYNC_HEALTH.UNKNOWN,
      ageMs:              null,
      ageLabel:           'Supabase not configured',
      sources:            null,
      error:              'Supabase not configured — check Settings → Backend',
    }
  }

  const sb = getSupabaseClient()
  if (!sb) {
    return {
      supabaseReady:      false,
      latestEvent:        null,
      lastEventType:      'UNKNOWN',
      lastEventSource:    'unknown',
      lastEventTimestamp: null,
      health:             SYNC_HEALTH.UNKNOWN,
      ageMs:              null,
      ageLabel:           'No Supabase client',
      sources:            null,
      error:              'Supabase client unavailable',
    }
  }

  // ── Query all three sources in parallel (read-only) ──────────
  const [dashResult, locResult, taskResult] = await Promise.allSettled([
    _queryDashboardEvents(sb),
    _queryDriverLocations(sb),
    _queryTasks(sb),
  ])

  const dash    = dashResult.status  === 'fulfilled' ? dashResult.value  : null
  const loc     = locResult.status   === 'fulfilled' ? locResult.value   : null
  const task    = taskResult.status  === 'fulfilled' ? taskResult.value  : null

  // ── Pick the freshest event signal ──────────────────────────
  // Compare timestamps from all three sources; surface the most recent.
  const candidates = [dash, loc, task].filter(Boolean)
  const sources = candidates.map(c => c.table)

  let latestEvent = null
  if (candidates.length > 0) {
    latestEvent = candidates.reduce((best, cur) => {
      if (!best) return cur
      if (!cur.timestamp) return best
      if (!best.timestamp) return cur
      return new Date(cur.timestamp) > new Date(best.timestamp) ? cur : best
    }, null)
  }

  const timestamp = latestEvent?.timestamp ?? null
  const { health, ageMs, ageLabel } = computeSyncHealth(timestamp)

  return {
    supabaseReady:      true,
    latestEvent,
    lastEventType:      latestEvent?.type    ?? 'UNKNOWN',
    lastEventSource:    latestEvent?.source  ?? 'unknown',
    lastEventTimestamp: timestamp,
    health,
    ageMs,
    ageLabel,
    sources:            sources.length > 0 ? sources : null,
    error:              null,
  }
}

export default { runSyncVerification, computeSyncHealth, SYNC_HEALTH, SYNC_THRESHOLDS }
