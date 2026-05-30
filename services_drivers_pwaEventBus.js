/**
 * ============================================================
 * AP3X DRIVER PWA — Safe Event Emission Layer
 * File: services_drivers_pwaEventBus.js
 *
 * PURPOSE (ADD-ON ONLY):
 *   Wraps all Driver PWA → AP3X event system calls with:
 *     1. Structural validation  (non-blocking — logs & corrects)
 *     2. Guaranteed event format enforcement
 *     3. Offline queue (localStorage) with auto-flush on reconnect
 *     4. Retry mechanism for failed BroadcastChannel emissions
 *
 * ARCHITECTURE RULE:
 *   This file is a SENSOR-NODE WRAPPER ONLY.
 *   It NEVER interprets data, makes decisions, or generates insights.
 *   It ONLY: capture → validate → wrap → emit (or queue if offline).
 *
 * SYSTEM CONTRACT (IMMUTABLE):
 *   Driver PWA → eventBus → Federation OS → Supabase → Fleet OS → Dashboards
 *   This module emits to eventBus only. It does NOT touch Federation OS,
 *   Fleet OS, Supabase, or any intelligence layer.
 *
 * EVENT FORMAT (LOCKED — DO NOT MODIFY):
 *   {
 *     type:      string,          // e.g. 'DRIVER_LOCATION', 'AI_REPORT', 'SAFETY_ALERT'
 *     source:    "driver_pwa",    // always this literal string
 *     timestamp: number,          // epoch ms (Date.now())
 *     payload:   object           // event-specific data
 *   }
 *
 * EXISTING CODE IS NOT MODIFIED:
 *   pushTelemetryToFleet, pushAIReportToFleet, sendDriverMessage,
 *   pushDriverLocation, safetyService.createAlert — all unchanged.
 *   This layer sits ABOVE them as an optional safe-emit path.
 * ============================================================
 */

import { SYNC_CHANNEL } from './services_sync_liveSync'
import { getSupabaseClient, isSupabaseReady } from './services_supabase_supabaseClient'

// ─── Constants ────────────────────────────────────────────────
const OFFLINE_QUEUE_KEY  = 'apex:pwa:event_queue'
const MAX_QUEUE_SIZE     = 200          // max queued events (FIFO drop oldest)
const MAX_RETRY_ATTEMPTS = 3
const RETRY_BASE_DELAY   = 300          // ms — doubles per retry (300, 600, 1200)

// Supabase emit retry constants
const SB_MAX_RETRIES      = 3
const SB_RETRY_BASE_DELAY = 400   // ms — doubles per retry (400, 800, 1600)
const SB_OFFLINE_KEY      = 'apex:pwa:sb_event_queue'
const SB_MAX_QUEUE        = 150

// Valid event types the Driver PWA is allowed to emit (sensor-node contract)
const ALLOWED_EVENT_TYPES = new Set([
  'DRIVER_LOCATION',
  'DRIVER_TELEMETRY',
  'AI_REPORT',
  'SAFETY_ALERT',
  'JOB_EVENT',
  'DRIVER_PAIRED',
  'DRIVER_SESSION_START',
  'DRIVER_SESSION_END',
  'DRIVER_BREAK_START',
  'DRIVER_BREAK_END',
  'HAZARD_REPORT',
])

// ─── Internal helpers ─────────────────────────────────────────
const _readQueue = () => {
  try { return JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]') } catch { return [] }
}
const _writeQueue = (q) => {
  try { localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(q)) } catch {}
}
const _log = (tag, msg, data) => {
  // Non-blocking diagnostic — never throws
  try { console.debug(`[AP3X:PWAEventBus:${tag}]`, msg, data ?? '') } catch {}
}

// ─── 1. Event Validator ────────────────────────────────────────
/**
 * Validates and normalises a raw event object before emission.
 *
 * Rules:
 *   - type   : must be a non-empty string; normalised to UPPER_SNAKE_CASE
 *   - source : set to "driver_pwa" always (no overrides allowed)
 *   - timestamp : attached if missing or invalid
 *   - payload : must be an object; defaults to {} if missing
 *
 * Returns { ok: boolean, event: object|null, errors: string[] }
 * Non-blocking — NEVER throws.
 */
export function validateEvent(raw) {
  const errors = []
  if (!raw || typeof raw !== 'object') {
    return { ok: false, event: null, errors: ['Event must be a plain object'] }
  }

  // ── type ──────────────────────────────────────────────────────
  let type = raw.type
  if (!type || typeof type !== 'string') {
    errors.push('Missing or invalid event.type — must be a non-empty string')
    type = 'UNKNOWN'
  } else {
    type = type.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_')
  }

  // Warn (non-blocking) if type is outside the allowed contract set
  if (!ALLOWED_EVENT_TYPES.has(type) && type !== 'UNKNOWN') {
    _log('VALIDATE', `Unrecognised event type "${type}" — emitting as-is (not blocked)`)
  }

  // ── source : always "driver_pwa" ─────────────────────────────
  const source = 'driver_pwa'
  if (raw.source && raw.source !== 'driver_pwa') {
    _log('VALIDATE', `source overridden from "${raw.source}" to "driver_pwa" (contract)`)
  }

  // ── timestamp ─────────────────────────────────────────────────
  let timestamp = raw.timestamp
  if (!timestamp || typeof timestamp !== 'number' || !isFinite(timestamp)) {
    timestamp = Date.now()
    if (raw.timestamp !== undefined) {
      errors.push(`Invalid timestamp "${raw.timestamp}" — replaced with Date.now()`)
    }
  }

  // ── payload ───────────────────────────────────────────────────
  let payload = raw.payload
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    errors.push('Missing or invalid event.payload — must be a plain object; defaulting to {}')
    payload = {}
  }

  const normalised = { type, source, timestamp, payload }
  const ok = errors.length === 0

  if (!ok) _log('VALIDATE', `${errors.length} validation issue(s) for type="${type}"`, errors)

  return { ok, event: normalised, errors }
}

// ─── 2. Offline Queue ─────────────────────────────────────────
/**
 * Queue an event for later delivery (offline scenario).
 * Events are stored to localStorage under OFFLINE_QUEUE_KEY.
 * Oldest events are dropped when MAX_QUEUE_SIZE is exceeded.
 */
export function queueOfflineEvent(event) {
  try {
    const q = _readQueue()
    q.push({ ...event, _queued_at: Date.now() })
    // FIFO eviction — drop oldest if over limit
    const trimmed = q.length > MAX_QUEUE_SIZE ? q.slice(q.length - MAX_QUEUE_SIZE) : q
    _writeQueue(trimmed)
    _log('QUEUE', `Queued event type="${event.type}" — queue depth: ${trimmed.length}`)
    return true
  } catch (e) {
    _log('QUEUE', 'Failed to queue event', e?.message)
    return false
  }
}

/**
 * Return the current offline queue depth (for diagnostics / UI badges).
 */
export function getOfflineQueueDepth() {
  return _readQueue().length
}

/**
 * Flush queued events to the eventBus (call when back online).
 * Emits each queued event through emitDriverEvent().
 * Successfully emitted events are removed from the queue.
 * Returns { flushed: number, failed: number }
 */
export async function flushOfflineQueue() {
  const q = _readQueue()
  if (q.length === 0) return { flushed: 0, failed: 0 }

  _log('FLUSH', `Flushing ${q.length} queued event(s)`)
  let flushed = 0
  let failed  = 0
  const remaining = []

  for (const event of q) {
    // Re-emit without re-queuing (pass _skipQueue flag)
    const result = await _emitToBroadcastChannel(event)
    if (result.ok) {
      flushed++
    } else {
      remaining.push(event)
      failed++
    }
  }

  _writeQueue(remaining)
  _log('FLUSH', `Flush complete — flushed: ${flushed}, failed: ${failed}, remaining: ${remaining.length}`)
  return { flushed, failed }
}

// ─── 3. BroadcastChannel Emission (internal) ─────────────────
/**
 * Low-level: emit a validated event to the AP3X SYNC_CHANNEL.
 * Returns { ok: boolean, error?: string }
 * Never throws.
 */
function _emitToBroadcastChannel(event) {
  try {
    if (typeof BroadcastChannel === 'undefined') {
      return { ok: false, error: 'BroadcastChannel not supported in this environment' }
    }
    const bc = new BroadcastChannel(SYNC_CHANNEL)
    bc.postMessage(event)
    bc.close()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e?.message ?? 'Unknown BroadcastChannel error' }
  }
}

// ─── 4. Retry Mechanism ───────────────────────────────────────
/**
 * Attempt to emit an event with exponential backoff retry.
 * MAX_RETRY_ATTEMPTS tries, doubling delay: 300ms, 600ms, 1200ms.
 * Returns { ok: boolean, attempts: number, error?: string }
 * Never throws.
 */
async function _emitWithRetry(event) {
  let lastError = ''
  for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
    const result = _emitToBroadcastChannel(event)
    if (result.ok) {
      if (attempt > 1) _log('RETRY', `Succeeded on attempt ${attempt} for type="${event.type}"`)
      return { ok: true, attempts: attempt }
    }
    lastError = result.error
    _log('RETRY', `Attempt ${attempt}/${MAX_RETRY_ATTEMPTS} failed for type="${event.type}": ${lastError}`)
    if (attempt < MAX_RETRY_ATTEMPTS) {
      await new Promise(r => setTimeout(r, RETRY_BASE_DELAY * Math.pow(2, attempt - 1)))
    }
  }
  return { ok: false, attempts: MAX_RETRY_ATTEMPTS, error: lastError }
}

// ─── 5. Safe Emit — Public API ───────────────────────────────
/**
 * Primary public method. Safe, validated, retry-backed emission.
 *
 * Flow:
 *   1. Validate & normalise the raw event
 *   2. If offline (navigator.onLine === false) → queue locally, return
 *   3. Emit to BroadcastChannel (SYNC_CHANNEL) with retry
 *   4. If all retries fail → queue locally for later flush
 *
 * @param {object} rawEvent   - { type, payload, [timestamp] }
 * @param {object} [options]  - { skipOfflineQueue: boolean }
 * @returns {{ ok: boolean, event: object|null, errors: string[], queued: boolean }}
 */
export async function safeEmit(rawEvent, options = {}) {
  // ── Step 1: Validate ────────────────────────────────────────
  const { ok: valid, event, errors } = validateEvent(rawEvent)

  if (!event) {
    // Hard failure — event is completely malformed, cannot be sent or queued
    _log('EMIT', 'Dropping malformed event — cannot normalise', errors)
    return { ok: false, event: null, errors, queued: false }
  }

  // ── Step 2: Offline check ───────────────────────────────────
  const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false
  if (isOffline && !options.skipOfflineQueue) {
    _log('EMIT', `Offline — queuing type="${event.type}"`)
    queueOfflineEvent(event)
    return { ok: false, event, errors, queued: true }
  }

  // ── Step 3: Emit with retry ─────────────────────────────────
  const result = await _emitWithRetry(event)

  if (result.ok) {
    _log('EMIT', `Emitted type="${event.type}" (${result.attempts} attempt${result.attempts > 1 ? 's' : ''})`)
    return { ok: true, event, errors, queued: false }
  }

  // ── Step 4: Fallback queue ──────────────────────────────────
  if (!options.skipOfflineQueue) {
    _log('EMIT', `All retries failed for type="${event.type}" — queuing for later flush`)
    queueOfflineEvent(event)
    return { ok: false, event, errors, queued: true, error: result.error }
  }

  return { ok: false, event, errors, queued: false, error: result.error }
}

// ─── 6. Typed Convenience Emitters ───────────────────────────
// These are thin wrappers that build the correct event shape and
// call safeEmit(). They do NOT replace the existing service functions.
// They are an OPTIONAL improved path for new call sites.

/**
 * Emit a driver telemetry event.
 * Wraps the same data that pushTelemetryToFleet uses.
 */
export function emitTelemetryEvent(telemetryPayload) {
  return safeEmit({ type: 'DRIVER_TELEMETRY', payload: telemetryPayload })
}

/**
 * Emit a driver location update.
 * Wraps the same data that pushDriverLocation uses.
 */
export function emitLocationEvent(locationPayload) {
  return safeEmit({ type: 'DRIVER_LOCATION', payload: locationPayload })
}

/**
 * Emit a safety alert event.
 * Wraps the same data that safetyService.createAlert uses.
 */
export function emitSafetyAlert(alertPayload) {
  return safeEmit({ type: 'SAFETY_ALERT', payload: alertPayload })
}

/**
 * Emit an AI report event (Sentinel / RouteMind).
 * Wraps the same data that pushAIReportToFleet uses.
 */
export function emitAIReport(reportPayload) {
  return safeEmit({ type: 'AI_REPORT', payload: reportPayload })
}

/**
 * Emit a job lifecycle event.
 * Wraps the same data that logJobEvent uses.
 */
export function emitJobEvent(jobPayload) {
  return safeEmit({ type: 'JOB_EVENT', payload: jobPayload })
}

/**
 * Emit a driver session start event.
 */
export function emitSessionStart(sessionPayload) {
  return safeEmit({ type: 'DRIVER_SESSION_START', payload: sessionPayload })
}

/**
 * Emit a driver session end / summary event.
 */
export function emitSessionEnd(sessionPayload) {
  return safeEmit({ type: 'DRIVER_SESSION_END', payload: sessionPayload })
}

/**
 * Emit a break start event.
 */
export function emitBreakStart(breakPayload) {
  return safeEmit({ type: 'DRIVER_BREAK_START', payload: breakPayload })
}

/**
 * Emit a break end event.
 */
export function emitBreakEnd(breakPayload) {
  return safeEmit({ type: 'DRIVER_BREAK_END', payload: breakPayload })
}

/**
 * Emit a hazard report event.
 */
export function emitHazardReport(hazardPayload) {
  return safeEmit({ type: 'HAZARD_REPORT', payload: hazardPayload })
}

// ─── 7. Online recovery auto-flush ───────────────────────────
// Attach a window listener to auto-flush the offline queue when
// the browser goes back online. Listener is registered once,
// safely — never re-registered on hot reload.
if (typeof window !== 'undefined') {
  const _FLUSH_LISTENER_KEY = '__apex_pwa_flush_attached'
  if (!window[_FLUSH_LISTENER_KEY]) {
    window.addEventListener('online', () => {
      // Flush BroadcastChannel offline queue
      const bcDepth = getOfflineQueueDepth()
      if (bcDepth > 0) {
        _log('ONLINE', `Connection restored — auto-flushing ${bcDepth} BC queued event(s)`)
        flushOfflineQueue().then(({ flushed, failed }) => {
          _log('ONLINE', `BC auto-flush: flushed=${flushed}, failed=${failed}`)
        }).catch(() => {})
      }
      // Flush Supabase offline queue
      const sbDepth = getSupabaseQueueDepth()
      if (sbDepth > 0) {
        _log('ONLINE', `Connection restored — auto-flushing ${sbDepth} Supabase queued event(s)`)
        flushSupabaseQueue().then(({ flushed, failed }) => {
          _log('ONLINE', `SB auto-flush: flushed=${flushed}, failed=${failed}`)
        }).catch(() => {})
      }
    })
    window[_FLUSH_LISTENER_KEY] = true
  }
}

// ═══════════════════════════════════════════════════════════════
// SUPABASE EMIT PATH — Driver PWA → Supabase dashboard_events
// ═══════════════════════════════════════════════════════════════
// This is the REALTIME-COMPATIBLE emit path.
// Inserts a validated event row into dashboard_events so Supabase
// Realtime can propagate it to Fleet OS subscribers.
//
// Schema used (existing, append-only):
//   dashboard_events: { id (uuid, auto), type, payload (jsonb), created_at (auto) }
//
// CONTRACT:
//   - Driver PWA is the INSERT source only — no reads, no updates, no deletes
//   - Event format: { type, source: "driver_pwa", timestamp, payload }
//     stored as: type = event.type, payload = full event object
//   - Falls back to offline queue if Supabase unavailable
//   - Auto-flushes queue on reconnect (window 'online' event)
// ═══════════════════════════════════════════════════════════════

// ── Supabase offline queue helpers ───────────────────────────
const _readSbQueue  = () => { try { return JSON.parse(localStorage.getItem(SB_OFFLINE_KEY) || '[]') } catch { return [] } }
const _writeSbQueue = (q) => { try { localStorage.setItem(SB_OFFLINE_KEY, JSON.stringify(q)) } catch {} }

/**
 * Queue an event for Supabase delivery when offline.
 * Separate queue from BroadcastChannel queue (different delivery path).
 */
function _queueForSupabase(event) {
  try {
    const q = _readSbQueue()
    q.push({ ...event, _sb_queued_at: Date.now() })
    const trimmed = q.length > SB_MAX_QUEUE ? q.slice(q.length - SB_MAX_QUEUE) : q
    _writeSbQueue(trimmed)
    _log('SB_QUEUE', `Queued for Supabase: type="${event.type}" — depth: ${trimmed.length}`)
    return true
  } catch (e) {
    _log('SB_QUEUE', 'Failed to queue for Supabase', e?.message)
    return false
  }
}

/**
 * Low-level: insert a single validated event into dashboard_events.
 * Returns { ok: boolean, error?: string }.
 * Never throws.
 */
async function _insertToDashboardEvents(event) {
  try {
    if (!isSupabaseReady()) {
      return { ok: false, error: 'Supabase not configured' }
    }
    const sb = getSupabaseClient()
    if (!sb) return { ok: false, error: 'No Supabase client' }

    // Row format: type = event.type, payload = full event object (includes source + timestamp)
    const { error } = await sb
      .from('dashboard_events')
      .insert({ type: event.type, payload: event })

    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e?.message ?? 'Unknown insert error' }
  }
}

/**
 * Insert with exponential backoff retry.
 * SB_MAX_RETRIES attempts: 400ms, 800ms, 1600ms.
 */
async function _insertWithRetry(event) {
  let lastError = ''
  for (let attempt = 1; attempt <= SB_MAX_RETRIES; attempt++) {
    const result = await _insertToDashboardEvents(event)
    if (result.ok) {
      if (attempt > 1) _log('SB_RETRY', `Supabase insert succeeded on attempt ${attempt} for type="${event.type}"`)
      return { ok: true, attempts: attempt }
    }
    lastError = result.error
    _log('SB_RETRY', `Attempt ${attempt}/${SB_MAX_RETRIES} failed for type="${event.type}": ${lastError}`)
    if (attempt < SB_MAX_RETRIES) {
      await new Promise(r => setTimeout(r, SB_RETRY_BASE_DELAY * Math.pow(2, attempt - 1)))
    }
  }
  return { ok: false, attempts: SB_MAX_RETRIES, error: lastError }
}

/**
 * Flush Supabase offline queue.
 * Retries each queued event via _insertWithRetry.
 * Called automatically on window 'online' event.
 * Returns { flushed: number, failed: number }.
 */
export async function flushSupabaseQueue() {
  const q = _readSbQueue()
  if (q.length === 0) return { flushed: 0, failed: 0 }

  _log('SB_FLUSH', `Flushing ${q.length} queued Supabase event(s)`)
  let flushed = 0
  const remaining = []

  for (const event of q) {
    const result = await _insertWithRetry(event)
    if (result.ok) {
      flushed++
      _log('SB_FLUSH', `Flushed type="${event.type}" (was queued ${Math.round((Date.now() - (event._sb_queued_at || 0)) / 1000)}s ago)`)
    } else {
      remaining.push(event)
    }
  }

  _writeSbQueue(remaining)
  _log('SB_FLUSH', `SB flush done — flushed: ${flushed}, remaining: ${remaining.length}`)
  return { flushed, failed: remaining.length }
}

/**
 * Get current Supabase offline queue depth.
 */
export function getSupabaseQueueDepth() {
  return _readSbQueue().length
}

/**
 * Primary Supabase emit method.
 * Validates the event, inserts into dashboard_events with retry.
 * If offline or all retries fail → queues to localStorage for later flush.
 *
 * This is the realtime-compatible path:
 *   Driver PWA → dashboard_events INSERT → Supabase Realtime → Fleet OS
 *
 * @param {object} rawEvent - { type, payload, [timestamp] }
 * @param {object} [options] - { skipQueue: boolean }
 * @returns {Promise<{ ok: boolean, event, queued: boolean, error?: string }>}
 */
export async function supabaseEmit(rawEvent, options = {}) {
  // Validate + normalise using the existing validateEvent (same format contract)
  const { ok: valid, event, errors } = validateEvent(rawEvent)

  if (!event) {
    _log('SB_EMIT', 'Dropping malformed event — cannot normalise', errors)
    return { ok: false, event: null, errors, queued: false }
  }

  // Offline check
  const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false
  if (isOffline && !options.skipQueue) {
    _log('SB_EMIT', `Offline — queuing Supabase emit for type="${event.type}"`)
    _queueForSupabase(event)
    return { ok: false, event, errors, queued: true }
  }

  // Attempt insert with retry
  const result = await _insertWithRetry(event)

  if (result.ok) {
    _log('SB_EMIT', `✓ Inserted to dashboard_events: type="${event.type}" (${result.attempts} attempt${result.attempts > 1 ? 's' : ''})`)
    return { ok: true, event, errors, queued: false }
  }

  // All retries failed — queue for later
  if (!options.skipQueue) {
    _log('SB_EMIT', `All retries failed for type="${event.type}" — queuing for Supabase flush`)
    _queueForSupabase(event)
    return { ok: false, event, errors, queued: true, error: result.error }
  }

  return { ok: false, event, errors, queued: false, error: result.error }
}

// ─── Default export (namespace) ──────────────────────────────
export const pwaEventBus = {
  // BroadcastChannel path (same-device / cross-tab)
  validateEvent,
  safeEmit,
  queueOfflineEvent,
  flushOfflineQueue,
  getOfflineQueueDepth,
  emitTelemetryEvent,
  emitLocationEvent,
  emitSafetyAlert,
  emitAIReport,
  emitJobEvent,
  emitSessionStart,
  emitSessionEnd,
  emitBreakStart,
  emitBreakEnd,
  emitHazardReport,
  // Supabase path (cross-device realtime → Fleet OS)
  supabaseEmit,
  flushSupabaseQueue,
  getSupabaseQueueDepth,
}

export default pwaEventBus
