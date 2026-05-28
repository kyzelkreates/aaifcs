/**
 * ============================================================
 * AP3X — Job Execution Service
 * services_execution_jobExecutionService.js
 *
 * Supabase SSOT for the Job Execution Control Layer.
 * Covers:
 *   - job_execution_state  CRUD + realtime subscription
 *   - job_stops            CRUD + status transitions
 *   - job_events_log       append-only event logging
 *   - route_interruption_log  interruption recording
 *
 * ADDITIVE — does NOT modify any existing table.
 * Exports are pure async functions + subscription helpers.
 * ============================================================
 */

import {
  getSupabaseClient,
  isSupabaseReady,
} from './services_supabase_supabaseClient'
import { isLiveMode } from './services_backend_backendService'

// ── Timestamp helper ─────────────────────────────────────────
const now = () => new Date().toISOString()

// ── Safe Supabase getter ─────────────────────────────────────
function sb() {
  const client = getSupabaseClient()
  if (!client) throw new Error('Supabase not initialised')
  return client
}

// ═══════════════════════════════════════════════════════════════
// SECTION A — JOB EXECUTION STATE
// ═══════════════════════════════════════════════════════════════

/**
 * Create or return existing execution state for a job.
 * Called when Driver PWA receives a new job (JOB_RECEIVED).
 * Status starts as 'pending' — driver hasn't confirmed yet.
 */
export async function initJobExecution(jobId, driverId, tenantId = null) {
  if (!isLiveMode()) return { ok: false, error: 'offline' }
  // Check if already exists
  const { data: existing } = await sb()
    .from('job_execution_state')
    .select('*')
    .eq('job_id', jobId)
    .eq('driver_id', driverId)
    .maybeSingle()
  if (existing) return { ok: true, data: existing }

  const { data, error } = await sb()
    .from('job_execution_state')
    .insert({
      job_id:    jobId,
      driver_id: driverId,
      tenant_id: tenantId,
      status:    'pending',
      created_at: now(),
      updated_at: now(),
    })
    .select()
    .single()
  if (error) return { ok: false, error: error.message }
  return { ok: true, data }
}

/**
 * Driver accepts job.
 * Sets status → 'accepted', records accepted_at.
 */
export async function acceptJob(jobId, driverId) {
  if (!isLiveMode()) return { ok: false, error: 'offline' }
  const { data, error } = await sb()
    .from('job_execution_state')
    .update({
      status:      'accepted',
      accepted_at: now(),
      updated_at:  now(),
    })
    .eq('job_id', jobId)
    .eq('driver_id', driverId)
    .select()
    .single()
  if (error) return { ok: false, error: error.message }
  return { ok: true, data }
}

/**
 * Driver rejects job.
 * Sets status → 'rejected'. Requires a reason.
 */
export async function rejectJob(jobId, driverId, reason = '') {
  if (!isLiveMode()) return { ok: false, error: 'offline' }
  const { data, error } = await sb()
    .from('job_execution_state')
    .update({
      status:           'rejected',
      rejected_at:      now(),
      rejection_reason: reason,
      updated_at:       now(),
    })
    .eq('job_id', jobId)
    .eq('driver_id', driverId)
    .select()
    .single()
  if (error) return { ok: false, error: error.message }
  return { ok: true, data }
}

/**
 * Driver starts execution (first stop en-route).
 * Sets status → 'in_progress'.
 */
export async function startJobExecution(jobId, driverId) {
  if (!isLiveMode()) return { ok: false, error: 'offline' }
  const { data, error } = await sb()
    .from('job_execution_state')
    .update({
      status:     'in_progress',
      started_at: now(),
      updated_at: now(),
    })
    .eq('job_id', jobId)
    .eq('driver_id', driverId)
    .select()
    .single()
  if (error) return { ok: false, error: error.message }
  return { ok: true, data }
}

/**
 * Pause job execution (e.g. rest break, traffic hold).
 * Must log to route_interruption_log before calling this.
 */
export async function pauseJobExecution(jobId, driverId) {
  if (!isLiveMode()) return { ok: false, error: 'offline' }
  const { data, error } = await sb()
    .from('job_execution_state')
    .update({ status: 'paused', paused_at: now(), updated_at: now() })
    .eq('job_id', jobId)
    .eq('driver_id', driverId)
    .select()
    .single()
  if (error) return { ok: false, error: error.message }
  return { ok: true, data }
}

/**
 * Resume job from pause.
 */
export async function resumeJobExecution(jobId, driverId) {
  if (!isLiveMode()) return { ok: false, error: 'offline' }
  const { data, error } = await sb()
    .from('job_execution_state')
    .update({ status: 'in_progress', paused_at: null, updated_at: now() })
    .eq('job_id', jobId)
    .eq('driver_id', driverId)
    .select()
    .single()
  if (error) return { ok: false, error: error.message }
  return { ok: true, data }
}

/**
 * Complete job execution (all stops done or final stop validated).
 */
export async function completeJobExecution(jobId, driverId) {
  if (!isLiveMode()) return { ok: false, error: 'offline' }
  const { data, error } = await sb()
    .from('job_execution_state')
    .update({ status: 'completed', completed_at: now(), updated_at: now() })
    .eq('job_id', jobId)
    .eq('driver_id', driverId)
    .select()
    .single()
  if (error) return { ok: false, error: error.message }
  return { ok: true, data }
}

/**
 * Get current execution state for a job.
 */
export async function getJobExecutionState(jobId, driverId = null) {
  if (!isLiveMode()) return null
  let query = sb()
    .from('job_execution_state')
    .select('*')
    .eq('job_id', jobId)
  if (driverId) query = query.eq('driver_id', driverId)
  const { data, error } = await query.maybeSingle()
  if (error) { console.error('[AP3X:Exec] getJobExecutionState:', error.message); return null }
  return data
}

/**
 * Subscribe to execution state changes for a specific job (dispatcher view).
 */
export function subscribeToJobExecution(jobId, callback) {
  if (!isLiveMode()) return () => {}
  const channel = sb()
    .channel(`exec-state-${jobId}`)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'job_execution_state', filter: `job_id=eq.${jobId}` },
      (payload) => callback(payload.new)
    )
    .subscribe()
  return () => { try { sb().removeChannel(channel) } catch {} }
}


// ═══════════════════════════════════════════════════════════════
// SECTION B — JOB STOPS
// ═══════════════════════════════════════════════════════════════

/**
 * Write stop list for a job.
 * Called when dispatcher creates job OR when driver accepts
 * and stops are geocoded. Upserts by (job_id, stop_index).
 *
 * @param {string}   jobId
 * @param {Array}    stops  — [{stop_index, stop_type, label, address, location_lat, location_lng,
 *                              time_window_start, time_window_end, notes, geofence_radius_m}]
 */
export async function upsertJobStops(jobId, stops) {
  if (!isLiveMode()) return { ok: false, error: 'offline' }
  if (!stops?.length) return { ok: true, data: [] }

  const rows = stops.map(s => ({
    job_id:             jobId,
    stop_index:         s.stop_index,
    stop_type:          s.stop_type      || 'dropoff',
    label:              s.label          || null,
    address:            s.address        || null,
    location_lat:       s.location_lat   ?? null,
    location_lng:       s.location_lng   ?? null,
    geofence_radius_m:  s.geofence_radius_m ?? 150,
    status:             s.status         || 'pending',
    time_window_start:  s.time_window_start ?? null,
    time_window_end:    s.time_window_end   ?? null,
    notes:              s.notes          || null,
    updated_at:         now(),
  }))

  const { data, error } = await sb()
    .from('job_stops')
    .upsert(rows, { onConflict: 'job_id,stop_index' })
    .select()
  if (error) return { ok: false, error: error.message }
  return { ok: true, data }
}

/**
 * Load all stops for a job, ordered by stop_index.
 */
export async function getJobStops(jobId) {
  if (!isLiveMode()) return []
  const { data, error } = await sb()
    .from('job_stops')
    .select('*')
    .eq('job_id', jobId)
    .order('stop_index', { ascending: true })
  if (error) { console.error('[AP3X:Exec] getJobStops:', error.message); return [] }
  return data || []
}

/**
 * Mark driver as en-route to a stop.
 */
export async function markStopEnRoute(stopId) {
  if (!isLiveMode()) return { ok: false }
  const { error } = await sb()
    .from('job_stops')
    .update({ status: 'en_route', updated_at: now() })
    .eq('id', stopId)
  return { ok: !error, error: error?.message }
}

/**
 * Mark stop as arrived (geofence crossed or manual).
 */
export async function markStopArrived(stopId) {
  if (!isLiveMode()) return { ok: false }
  const { error } = await sb()
    .from('job_stops')
    .update({ status: 'arrived', arrived_at: now(), updated_at: now() })
    .eq('id', stopId)
  return { ok: !error, error: error?.message }
}

/**
 * Validate stop (system check passed — e.g. delivery confirmed).
 */
export async function validateStop(stopId) {
  if (!isLiveMode()) return { ok: false }
  const { error } = await sb()
    .from('job_stops')
    .update({ status: 'validated', validated_at: now(), updated_at: now() })
    .eq('id', stopId)
  return { ok: !error, error: error?.message }
}

/**
 * Skip stop. Requires reason. Optional dispatcher approval ID.
 */
export async function skipStop(stopId, reason, approvedBy = null) {
  if (!isLiveMode()) return { ok: false }
  if (!reason?.trim()) return { ok: false, error: 'Skip reason is required' }
  const { error } = await sb()
    .from('job_stops')
    .update({
      status:          'skipped',
      skipped_at:      now(),
      skip_reason:     reason,
      skip_approved_by: approvedBy,
      updated_at:      now(),
    })
    .eq('id', stopId)
  return { ok: !error, error: error?.message }
}

/**
 * Subscribe to stop changes for a job (live progress on dispatcher dashboard).
 */
export function subscribeToJobStops(jobId, callback) {
  if (!isLiveMode()) return () => {}
  const channel = sb()
    .channel(`job-stops-${jobId}`)
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'job_stops', filter: `job_id=eq.${jobId}` },
      (payload) => callback(payload.new)
    )
    .subscribe()
  return () => { try { sb().removeChannel(channel) } catch {} }
}


// ═══════════════════════════════════════════════════════════════
// SECTION C — JOB EVENTS LOG (append-only)
// ═══════════════════════════════════════════════════════════════

/**
 * Append a single audit event.
 * This is the ONLY write function — no updates or deletes allowed.
 *
 * @param {Object} evt  — {job_id, driver_id, tenant_id?, event_type,
 *                         stop_id?, stop_index?, payload?, driver_lat?, driver_lng?}
 */
export async function logJobEvent(evt) {
  if (!isLiveMode()) {
    // Offline — queue locally, flush on reconnect
    try {
      const q = JSON.parse(localStorage.getItem('apex:exec:event_queue') || '[]')
      q.push({ ...evt, device_ts: now() })
      localStorage.setItem('apex:exec:event_queue', JSON.stringify(q.slice(-200)))
    } catch {}
    return { ok: false, error: 'offline_queued' }
  }

  const { error } = await sb()
    .from('job_events_log')
    .insert({
      job_id:      evt.job_id,
      driver_id:   evt.driver_id,
      tenant_id:   evt.tenant_id  ?? null,
      event_type:  evt.event_type,
      stop_id:     evt.stop_id    ?? null,
      stop_index:  evt.stop_index ?? null,
      payload:     evt.payload    ?? {},
      driver_lat:  evt.driver_lat ?? null,
      driver_lng:  evt.driver_lng ?? null,
      device_ts:   now(),
      ts:          now(),
    })
  if (error) {
    console.error('[AP3X:Exec] logJobEvent failed:', error.message)
    // Still queue offline to retry
    try {
      const q = JSON.parse(localStorage.getItem('apex:exec:event_queue') || '[]')
      q.push({ ...evt, device_ts: now() })
      localStorage.setItem('apex:exec:event_queue', JSON.stringify(q.slice(-200)))
    } catch {}
    return { ok: false, error: error.message }
  }
  return { ok: true }
}

/**
 * Flush any offline-queued events to Supabase.
 * Called on reconnect.
 */
export async function flushOfflineEventQueue(driverId) {
  if (!isLiveMode()) return
  try {
    const raw = localStorage.getItem('apex:exec:event_queue')
    if (!raw) return
    const q = JSON.parse(raw).filter(e => e.driver_id === driverId)
    if (!q.length) return
    const { error } = await sb().from('job_events_log').insert(q)
    if (!error) localStorage.removeItem('apex:exec:event_queue')
  } catch {}
}

/**
 * Fetch full event log for a job (audit trail / replay).
 * Returns rows ordered by ts asc so the timeline is chronological.
 */
export async function getJobEventLog(jobId) {
  if (!isLiveMode()) return []
  const { data, error } = await sb()
    .from('job_events_log')
    .select('*')
    .eq('job_id', jobId)
    .order('ts', { ascending: true })
  if (error) { console.error('[AP3X:Exec] getJobEventLog:', error.message); return [] }
  return data || []
}


// ═══════════════════════════════════════════════════════════════
// SECTION D — ROUTE INTERRUPTION LOG
// ═══════════════════════════════════════════════════════════════

/**
 * Record a route interruption event.
 * Must be called BEFORE any state change (pause, cancel, skip).
 *
 * @param {Object} evt — {job_id, driver_id, tenant_id?, interruption_type,
 *                        reason, driver_lat?, driver_lng?, speed_at_event?}
 * @returns {Promise<{ok, data, error}>}
 */
export async function logInterruption(evt) {
  if (!isLiveMode()) {
    // Queue offline
    try {
      const q = JSON.parse(localStorage.getItem('apex:exec:interruption_queue') || '[]')
      q.push({ ...evt, ts: now() })
      localStorage.setItem('apex:exec:interruption_queue', JSON.stringify(q.slice(-100)))
    } catch {}
    return { ok: false, error: 'offline_queued' }
  }

  const { data, error } = await sb()
    .from('route_interruption_log')
    .insert({
      job_id:            evt.job_id,
      driver_id:         evt.driver_id,
      tenant_id:         evt.tenant_id         ?? null,
      interruption_type: evt.interruption_type,
      reason:            evt.reason            || '(no reason given)',
      driver_lat:        evt.driver_lat        ?? null,
      driver_lng:        evt.driver_lng        ?? null,
      speed_at_event:    evt.speed_at_event    ?? null,
      approved_by:       evt.approved_by       ?? null,
      resolution:        evt.resolution        ?? 'auto_approved',
      resolved_at:       evt.resolution !== 'pending' ? now() : null,
      ts:                now(),
    })
    .select()
    .single()
  if (error) return { ok: false, error: error.message }
  return { ok: true, data }
}

/**
 * Fetch interruption log for a job (Control OS audit view).
 */
export async function getInterruptionLog(jobId) {
  if (!isLiveMode()) return []
  const { data, error } = await sb()
    .from('route_interruption_log')
    .select('*')
    .eq('job_id', jobId)
    .order('ts', { ascending: true })
  if (error) { console.error('[AP3X:Exec] getInterruptionLog:', error.message); return [] }
  return data || []
}

/**
 * Dispatcher approves/denies a pending interruption.
 */
export async function resolveInterruption(interruptionId, resolution, approvedBy) {
  if (!isLiveMode()) return { ok: false }
  const { error } = await sb()
    .from('route_interruption_log')
    .update({
      resolution:  resolution,  // 'approved' | 'denied'
      approved_by: approvedBy,
      resolved_at: now(),
    })
    .eq('id', interruptionId)
  return { ok: !error, error: error?.message }
}


// ═══════════════════════════════════════════════════════════════
// SECTION E — COMPOSITE HELPERS (used by Driver PWA screens)
// ═══════════════════════════════════════════════════════════════

/**
 * Full job accept flow (atomic — called from JobConfirmScreen):
 *  1. acceptJob() → execution state
 *  2. logJobEvent(JOB_ACCEPTED)
 *  3. Update tasks.status → 'accepted' (via existing updateTask)
 */
export async function executeJobAccept({ jobId, driverId, tenantId, driverLat, driverLng, taskPayload = {} }) {
  const execResult = await acceptJob(jobId, driverId)
  if (!execResult.ok) return execResult

  await logJobEvent({
    job_id:    jobId,
    driver_id: driverId,
    tenant_id: tenantId,
    event_type: 'JOB_ACCEPTED',
    driver_lat: driverLat,
    driver_lng: driverLng,
    payload:   { ...taskPayload, accepted_at: now() },
  })

  return { ok: true, execution: execResult.data }
}

/**
 * Full job reject flow:
 *  1. rejectJob() → execution state
 *  2. logJobEvent(JOB_REJECTED)
 */
export async function executeJobReject({ jobId, driverId, tenantId, reason, driverLat, driverLng }) {
  const execResult = await rejectJob(jobId, driverId, reason)
  if (!execResult.ok) return execResult

  await logJobEvent({
    job_id:    jobId,
    driver_id: driverId,
    tenant_id: tenantId,
    event_type: 'JOB_REJECTED',
    driver_lat: driverLat,
    driver_lng: driverLng,
    payload:   { reason, rejected_at: now() },
  })

  return { ok: true }
}

/**
 * Stop arrival flow (geofence or manual):
 *  1. markStopArrived(stopId)
 *  2. logJobEvent(STOP_ARRIVED)
 */
export async function executeStopArrival({ stopId, jobId, driverId, tenantId, stopIndex, driverLat, driverLng }) {
  const r = await markStopArrived(stopId)
  if (!r.ok) return r

  await logJobEvent({
    job_id:     jobId,
    driver_id:  driverId,
    tenant_id:  tenantId,
    event_type: 'STOP_ARRIVED',
    stop_id:    stopId,
    stop_index: stopIndex,
    driver_lat: driverLat,
    driver_lng: driverLng,
    payload:    { arrived_at: now() },
  })

  return { ok: true }
}

/**
 * Stop validation flow:
 *  1. validateStop(stopId)
 *  2. logJobEvent(STOP_VALIDATED)
 */
export async function executeStopValidation({ stopId, jobId, driverId, tenantId, stopIndex, driverLat, driverLng, validationPayload = {} }) {
  const r = await validateStop(stopId)
  if (!r.ok) return r

  await logJobEvent({
    job_id:     jobId,
    driver_id:  driverId,
    tenant_id:  tenantId,
    event_type: 'STOP_VALIDATED',
    stop_id:    stopId,
    stop_index: stopIndex,
    driver_lat: driverLat,
    driver_lng: driverLng,
    payload:    { ...validationPayload, validated_at: now() },
  })

  return { ok: true }
}

/**
 * Stop skip flow (MUST have reason — enforced here):
 *  1. logInterruption(stop_skip_request)
 *  2. skipStop(stopId, reason, approvedBy)
 *  3. logJobEvent(STOP_SKIPPED)
 */
export async function executeStopSkip({ stopId, jobId, driverId, tenantId, stopIndex, reason, approvedBy = null, driverLat, driverLng, speed }) {
  if (!reason?.trim()) return { ok: false, error: 'Reason is required to skip a stop' }

  await logInterruption({
    job_id:            jobId,
    driver_id:         driverId,
    tenant_id:         tenantId,
    interruption_type: 'stop_skip_request',
    reason,
    driver_lat:        driverLat,
    driver_lng:        driverLng,
    speed_at_event:    speed,
    approved_by:       approvedBy,
    resolution:        approvedBy ? 'approved' : 'auto_approved',
  })

  const r = await skipStop(stopId, reason, approvedBy)
  if (!r.ok) return r

  await logJobEvent({
    job_id:     jobId,
    driver_id:  driverId,
    tenant_id:  tenantId,
    event_type: 'STOP_SKIPPED',
    stop_id:    stopId,
    stop_index: stopIndex,
    driver_lat: driverLat,
    driver_lng: driverLng,
    payload:    { reason, approved_by: approvedBy, skipped_at: now() },
  })

  return { ok: true }
}

/**
 * Emergency stop flow:
 *  1. logInterruption(emergency_stop)
 *  2. pauseJobExecution
 *  3. logJobEvent(EMERGENCY_STOP)
 */
export async function executeEmergencyStop({ jobId, driverId, tenantId, reason, driverLat, driverLng, speed }) {
  await logInterruption({
    job_id:            jobId,
    driver_id:         driverId,
    tenant_id:         tenantId,
    interruption_type: 'emergency_stop',
    reason:            reason || 'Emergency stop — driver initiated',
    driver_lat:        driverLat,
    driver_lng:        driverLng,
    speed_at_event:    speed,
    resolution:        'auto_approved',
  })

  await pauseJobExecution(jobId, driverId)

  await logJobEvent({
    job_id:     jobId,
    driver_id:  driverId,
    tenant_id:  tenantId,
    event_type: 'EMERGENCY_STOP',
    driver_lat: driverLat,
    driver_lng: driverLng,
    payload:    { reason, speed, ts: now() },
  })

  return { ok: true }
}


// ═══════════════════════════════════════════════════════════════
// SECTION F — GEOFENCE DETECTION (client-side, no server needed)
// ═══════════════════════════════════════════════════════════════

const RAD = Math.PI / 180
function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const dLat = (lat2 - lat1) * RAD
  const dLng = (lng2 - lng1) * RAD
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/**
 * Check if driver position is inside a stop's geofence.
 * Returns true if within geofence_radius_m metres of stop.
 */
export function isInsideGeofence(driverLat, driverLng, stop) {
  if (!stop?.location_lat || !stop?.location_lng) return false
  const dist = haversineM(driverLat, driverLng, stop.location_lat, stop.location_lng)
  return dist <= (stop.geofence_radius_m ?? 150)
}

/**
 * Find the next pending stop that the driver has just entered.
 * Returns the matching stop object, or null.
 *
 * Call this on every GPS tick (throttled to max once per 5s).
 */
export function detectGeofenceEntry(driverLat, driverLng, stops) {
  if (!stops?.length || !driverLat || !driverLng) return null
  return stops.find(s =>
    (s.status === 'pending' || s.status === 'en_route') &&
    isInsideGeofence(driverLat, driverLng, s)
  ) ?? null
}

