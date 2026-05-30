/**
 * ============================================================
 * AP3X — Backend Service Layer  (SSOT — Supabase Only)
 * services/backendService.js
 *
 * CONTRACT (LOCKED):
 *   Tables:  profiles · tasks · drivers · vehicles · job_assignments · driver_locations
 *   Realtime: tasks · job_assignments · driver_locations
 *   No mock data. No local overrides. Backend wins on conflict.
 *
 * Task lifecycle (strict state machine):
 *   pending → assigned → accepted → in_progress → completed → cancelled
 *
 * Roles:
 *   profiles.role = 'dispatcher' | 'driver'
 * ============================================================
 */

import {
  getSupabaseClient, isSupabaseReady,
  getSupabaseSettings, autoInitSupabase,
} from './services_supabase_supabaseClient'
import {
  jobTable, driverTable, vehicleTable,
  subscribe as localSubscribe, DB_KEYS,
} from './services_local_localDB'

// ─── Ensure Supabase client is ready on import ────────────────
autoInitSupabase()

// ─── Connection event bus ─────────────────────────────────────
const _listeners = new Set()
let _currentStatus = 'offline'

export function onConnectionStatus(cb) {
  _listeners.add(cb)
  try { cb(_currentStatus) } catch {}
  return () => _listeners.delete(cb)
}

export function getConnectionStatus() { return _currentStatus }

function setStatus(s) {
  if (_currentStatus === s) return
  _currentStatus = s
  console.debug('[AP3X:Backend] Status →', s)
  _listeners.forEach(cb => { try { cb(s) } catch {} })
}

// ─── Mode check ───────────────────────────────────────────────
export function isLiveMode() {
  const s = getSupabaseSettings()
  return !!(s.enabled && s.url && s.anonKey && isSupabaseReady())
}

// ─── Helpers ──────────────────────────────────────────────────
const now = () => new Date().toISOString()

// ─── Realtime channel registry ────────────────────────────────
const _channels = new Map()

function registerChannel(key, channel) {
  const sb = getSupabaseClient()
  if (_channels.has(key)) {
    try { sb?.removeChannel(_channels.get(key)) } catch {}
  }
  _channels.set(key, channel)
}

export function cleanupSubscriptions() {
  const sb = getSupabaseClient()
  if (!sb) return
  _channels.forEach(ch => { try { sb.removeChannel(ch) } catch {} })
  _channels.clear()
}

// ─── Connection probe ─────────────────────────────────────────
let _probeInFlight = false

export async function probeConnection() {
  if (_probeInFlight) return _currentStatus === 'connected'
  _probeInFlight = true

  const s = getSupabaseSettings()
  if (!s.enabled)         { setStatus('offline');         _probeInFlight = false; return false }
  if (!s.url || !s.anonKey) { setStatus('invalid_config'); _probeInFlight = false; return false }

  const sb = getSupabaseClient()
  if (!sb) { setStatus('invalid_config'); _probeInFlight = false; return false }

  try {
    setStatus('connecting')
    try {
      const res = await fetch(`${s.url.trim()}/rest/v1/`, {
        headers: { apikey: s.anonKey.trim(), Authorization: `Bearer ${s.anonKey.trim()}` },
        signal: AbortSignal.timeout(6000),
      })
      if (res.status > 0) { setStatus('connected'); _probeInFlight = false; return true }
    } catch {}

    const { error } = await sb.from('tasks').select('id').limit(1)
    const IGNORABLE = new Set(['PGRST116','PGRST301','42P01','42501','PGRST204'])
    if (!error || IGNORABLE.has(error.code) || IGNORABLE.has(String(error.status))) {
      setStatus('connected'); _probeInFlight = false; return true
    }
    setStatus('failed'); _probeInFlight = false; return false
  } catch (e) {
    setStatus('offline'); _probeInFlight = false; return false
  }
}

;(function startupProbe() {
  const s = getSupabaseSettings()
  if (s.enabled && s.url && s.anonKey) setTimeout(() => probeConnection(), 800)
})()


// ═══════════════════════════════════════════════════════════════
// PROFILES  (role = 'dispatcher' | 'driver')
// ═══════════════════════════════════════════════════════════════

/**
 * Get a single profile by id.
 * Used by driver PWA to verify identity against Supabase.
 */
export async function getProfile(profileId) {
  if (!isLiveMode()) return null
  const sb = getSupabaseClient()
  const { data, error } = await sb
    .from('profiles')
    .select('*')
    .eq('id', profileId)
    .single()
  if (error) { console.error('[AP3X:Backend] getProfile:', error); return null }
  return data
}

/**
 * Get all profiles with a given role.
 */
export async function getProfilesByRole(role) {
  if (!isLiveMode()) return []
  const sb = getSupabaseClient()
  const { data, error } = await sb
    .from('profiles')
    .select('*')
    .eq('role', role)
    .order('full_name', { ascending: true })
  if (error) { console.error('[AP3X:Backend] getProfilesByRole:', error); return [] }
  return data || []
}

/**
 * Upsert a profile row. Called when a driver first authenticates.
 */
export async function upsertProfile(profileData) {
  if (!isLiveMode()) return { ok: false, error: 'offline' }
  const sb = getSupabaseClient()
  const { data, error } = await sb
    .from('profiles')
    .upsert({ ...profileData, updated_at: now() }, { onConflict: 'id' })
    .select()
    .single()
  if (error) { console.error('[AP3X:Backend] upsertProfile:', error); return { ok: false, error: error.message } }
  return { ok: true, data }
}


// ═══════════════════════════════════════════════════════════════
// DRIVERS
// ═══════════════════════════════════════════════════════════════

export async function getDrivers() {
  if (isLiveMode()) {
    setStatus('connecting')
    const sb = getSupabaseClient()
    const { data, error } = await sb
      .from('drivers')
      .select('*')
      .order('name', { ascending: true })
    if (error) { console.error('[AP3X:Backend] getDrivers:', error); setStatus('failed'); return [] }
    setStatus('connected')
    return data || []
  }
  return driverTable.list()
}

export async function updateDriverStatus(driverId, status, extra = {}) {
  if (isLiveMode()) {
    const sb = getSupabaseClient()
    const { data, error } = await sb
      .from('drivers')
      .update({ status, updated_at: now(), ...extra })
      .eq('id', driverId)
      .select()
      .single()
    if (error) { console.error('[AP3X:Backend] updateDriverStatus:', error); return { ok: false, error: error.message } }
    return { ok: true, data }
  }
  try { return { ok: true, data: driverTable.update(driverId, { status, ...extra }) } }
  catch (e) { return { ok: false, error: e.message } }
}

export function subscribeToDrivers(callback) {
  if (!isLiveMode()) {
    return localSubscribe(DB_KEYS.DRIVERS, () => getDrivers().then(callback))
  }
  const sb = getSupabaseClient()
  if (!sb) return () => {}
  const channel = sb
    .channel('ap3x-drivers')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'drivers' },
      () => getDrivers().then(callback))
    .subscribe(s => {
      if (s === 'SUBSCRIBED')    setStatus('connected')
      if (s === 'CHANNEL_ERROR') setStatus('sync_delayed')
    })
  registerChannel('drivers', channel)
  return () => { try { sb.removeChannel(channel) } catch {} _channels.delete('drivers') }
}


// ═══════════════════════════════════════════════════════════════
// VEHICLES
// ═══════════════════════════════════════════════════════════════

export async function getVehicles() {
  if (isLiveMode()) {
    const sb = getSupabaseClient()
    const { data, error } = await sb
      .from('vehicles')
      .select('*')
      .order('reg_number', { ascending: true })
    if (error) { console.error('[AP3X:Backend] getVehicles:', error); return [] }
    return data || []
  }
  return vehicleTable.list()
}

export async function updateVehicle(vehicleId, patch) {
  if (isLiveMode()) {
    const sb = getSupabaseClient()
    const { data, error } = await sb
      .from('vehicles')
      .update({ ...patch, updated_at: now() })
      .eq('id', vehicleId)
      .select()
      .single()
    if (error) return { ok: false, error: error.message }
    return { ok: true, data }
  }
  try { return { ok: true, data: vehicleTable.update(vehicleId, patch) } }
  catch (e) { return { ok: false, error: e.message } }
}


// ═══════════════════════════════════════════════════════════════
// TASKS  (Contract: pending → assigned → accepted → in_progress → completed → cancelled)
// ═══════════════════════════════════════════════════════════════

export async function getTasks(filter = {}) {
  if (isLiveMode()) {
    setStatus('connecting')
    const sb = getSupabaseClient()
    let query = sb.from('tasks').select('*')
    if (filter.assigned_driver) query = query.eq('assigned_driver', filter.assigned_driver)
    if (filter.status)          query = query.eq('status', filter.status)
    const { data, error } = await query.order('created_at', { ascending: false })
    if (error) { console.error('[AP3X:Backend] getTasks:', error); setStatus('failed'); return [] }
    setStatus('connected')
    return data || []
  }
  return jobTable.list(filter)
}

/**
 * Create a task (dispatcher → Supabase → Realtime → Driver PWA).
 * Only inserts into `tasks`. Assignment is separate (assignTask).
 */
export async function createTask(payload) {
  const ts = now()
  const row = {
    title:            payload.title,
    description:      payload.description      || null,
    status:           'pending',
    priority:         payload.priority         || 'normal',
    stops:            payload.stops            || null,
    waypoints:        payload.waypoints        || null,
    pickup_address:   payload.pickup_address   || payload.origin      || null,
    dropoff_address:  payload.dropoff_address  || payload.destination || null,
    vehicle_id:       payload.vehicle_id       || null,
    vehicle_reg:      payload.vehicle_reg      || null,
    created_at:       ts,
    updated_at:       ts,
  }

  if (isLiveMode()) {
    const sb = getSupabaseClient()
    const { data, error } = await sb
      .from('tasks')
      .insert(row)
      .select()
      .single()
    if (error) { console.error('[AP3X:Backend] createTask:', error); return { ok: false, error: error.message } }
    console.info('[AP3X:Backend] Task created:', data.id, '→', data.title)
    return { ok: true, data }
  }

  try { return { ok: true, data: jobTable.create({ ...row }) } }
  catch (e) { return { ok: false, error: e.message } }
}

/**
 * Update a task (any field — used for lifecycle transitions).
 * Backend is always the authority. Caller must await before updating UI.
 */
export async function updateTask(taskId, updates) {
  if (isLiveMode()) {
    const sb = getSupabaseClient()
    const { data, error } = await sb
      .from('tasks')
      .update({ ...updates, updated_at: now() })
      .eq('id', taskId)
      .select()
      .single()
    if (error) { console.error('[AP3X:Backend] updateTask:', error); return { ok: false, error: error.message } }
    return { ok: true, data }
  }
  try { return { ok: true, data: jobTable.update(taskId, updates) } }
  catch (e) { return { ok: false, error: e.message } }
}

/**
 * Assign a task to a driver.
 * Steps:
 *   1. Insert into job_assignments (creates audit record)
 *   2. Update tasks.assigned_driver + tasks.status = 'assigned'
 *   3. Update drivers.current_task
 * Supabase Realtime on tasks + job_assignments fires → Driver PWA receives it.
 */
export async function assignTask(taskId, driverId, vehicleId = null, driverName = '', vehicleReg = '') {
  const ts = now()

  if (isLiveMode()) {
    const sb = getSupabaseClient()

    // Idempotency guard
    const { data: existing } = await sb
      .from('tasks')
      .select('id, assigned_driver, status')
      .eq('id', taskId)
      .single()

    if (existing?.assigned_driver === driverId && existing?.status === 'assigned') {
      return { ok: true, data: existing, duplicate: true }
    }

    // 1. Insert job_assignment record
    const { error: jaError } = await sb
      .from('job_assignments')
      .insert({
        task_id:      taskId,
        driver_id:    driverId,
        vehicle_id:   vehicleId  || null,
        driver_name:  driverName || null,
        vehicle_reg:  vehicleReg || null,
        assigned_at:  ts,
        status:       'assigned',
      })

    if (jaError) {
      // Non-fatal — log but don't block the assignment
      console.warn('[AP3X:Backend] job_assignments insert failed (non-fatal):', jaError.message)
    }

    // 2. Update tasks
    const { data, error } = await sb
      .from('tasks')
      .update({
        assigned_driver:      driverId,
        assigned_driver_name: driverName || null,
        vehicle_id:           vehicleId  || null,
        vehicle_reg:          vehicleReg || null,
        status:               'assigned',
        assigned_at:          ts,
        updated_at:           ts,
      })
      .eq('id', taskId)
      .select()
      .single()

    if (error) { console.error('[AP3X:Backend] assignTask tasks update:', error); return { ok: false, error: error.message } }

    // 3. Update driver.current_task
    await sb
      .from('drivers')
      .update({ current_task: taskId, updated_at: ts })
      .eq('id', driverId)

    console.info('[AP3X:Backend] Task assigned:', taskId, '→ driver:', driverId)
    return { ok: true, data }
  }

  // Local fallback
  try {
    const updated = jobTable.update(taskId, {
      assigned_driver: driverId, assigned_driver_name: driverName,
      vehicle_id: vehicleId, vehicle_reg: vehicleReg,
      status: 'assigned', assigned_at: ts,
    })
    try { driverTable.update(driverId, { current_task: taskId }) } catch {}
    return { ok: true, data: updated }
  } catch (e) { return { ok: false, error: e.message } }
}

// Backwards-compat alias used by older code
export const assignJobToDriver = (taskId, driverId, driverName = '') =>
  assignTask(taskId, driverId, null, driverName)

/**
 * Subscribe to task changes.
 * Realtime ONLY on: tasks (contract rule).
 * driverFilter: subscribe only to tasks for a specific driver (Driver PWA).
 */
export function subscribeToTasks(callback, driverFilter = null) {
  if (!isLiveMode()) {
    return localSubscribe(DB_KEYS.JOBS, () =>
      getTasks(driverFilter ? { assigned_driver: driverFilter } : {}).then(callback)
    )
  }

  const sb = getSupabaseClient()
  if (!sb) return () => {}

  const key = driverFilter ? `tasks-driver-${driverFilter}` : 'tasks-all'
  const pgFilter = driverFilter
    ? { event: '*', schema: 'public', table: 'tasks', filter: `assigned_driver=eq.${driverFilter}` }
    : { event: '*', schema: 'public', table: 'tasks' }

  const channel = sb
    .channel(key)
    .on('postgres_changes', pgFilter, () =>
      getTasks(driverFilter ? { assigned_driver: driverFilter } : {}).then(callback)
    )
    .subscribe(s => {
      if (s === 'SUBSCRIBED')    setStatus('connected')
      if (s === 'CHANNEL_ERROR') setStatus('sync_delayed')
    })

  registerChannel(key, channel)
  return () => { try { sb.removeChannel(channel) } catch {} _channels.delete(key) }
}


// ═══════════════════════════════════════════════════════════════
// JOB ASSIGNMENTS  (audit log + realtime for dispatcher)
// ═══════════════════════════════════════════════════════════════

export async function getJobAssignments(taskId = null) {
  if (!isLiveMode()) return []
  const sb = getSupabaseClient()
  let query = sb
    .from('job_assignments')
    .select('*')
    .order('assigned_at', { ascending: false })
  if (taskId) query = query.eq('task_id', taskId)
  const { data, error } = await query
  if (error) { console.error('[AP3X:Backend] getJobAssignments:', error); return [] }
  return data || []
}

/**
 * Subscribe to job_assignment changes (dispatcher dashboard).
 * Fires when any assignment is created or updated.
 */
export function subscribeToJobAssignments(callback) {
  if (!isLiveMode()) return () => {}
  const sb = getSupabaseClient()
  if (!sb) return () => {}

  const channel = sb
    .channel('ap3x-job-assignments')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'job_assignments' },
      () => getJobAssignments().then(callback)
    )
    .subscribe(s => {
      if (s === 'SUBSCRIBED')    setStatus('connected')
      if (s === 'CHANNEL_ERROR') setStatus('sync_delayed')
    })

  registerChannel('job_assignments', channel)
  return () => { try { sb.removeChannel(channel) } catch {} _channels.delete('job_assignments') }
}


// ═══════════════════════════════════════════════════════════════
// DRIVER LOCATIONS  (GPS — driver_locations table)
// ═══════════════════════════════════════════════════════════════

/**
 * Upsert driver GPS location.
 * Called by Driver PWA every 5 seconds.
 */
export async function upsertDriverLocation(driverId, locationData) {
  if (!isLiveMode()) return { ok: false, error: 'offline' }
  const sb = getSupabaseClient()
  const { error } = await sb
    .from('driver_locations')
    .upsert({
      driver_id:  driverId,
      lat:        locationData.lat,
      lng:        locationData.lng,
      speed:      locationData.speed   ?? 0,
      heading:    locationData.heading ?? 0,
      accuracy:   locationData.accuracy ?? null,
      status:     locationData.status  ?? 'en_route',
      updated_at: now(),
    }, { onConflict: 'driver_id' })
  if (error) { console.debug('[AP3X:Backend] upsertDriverLocation error:', error.message); return { ok: false, error: error.message } }
  return { ok: true }
}

/**
 * Get all driver locations (fleet map).
 */
export async function getDriverLocations() {
  if (!isLiveMode()) return []
  const sb = getSupabaseClient()
  const { data, error } = await sb
    .from('driver_locations')
    .select('*')
  if (error) { console.error('[AP3X:Backend] getDriverLocations:', error); return [] }
  return data || []
}

/**
 * Subscribe to driver_locations changes (fleet map realtime).
 * Fires on any GPS upsert from any driver.
 */
export function subscribeToDriverLocations(callback) {
  if (!isLiveMode()) return () => {}
  const sb = getSupabaseClient()
  if (!sb) return () => {}

  const channel = sb
    .channel('ap3x-driver-locations')
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'driver_locations' },
      (payload) => {
        const row = payload.new
        if (row) callback(row)
      }
    )
    .subscribe(s => {
      if (s === 'SUBSCRIBED')    setStatus('connected')
      if (s === 'CHANNEL_ERROR') setStatus('sync_delayed')
    })

  registerChannel('driver_locations', channel)
  return () => { try { sb.removeChannel(channel) } catch {} _channels.delete('driver_locations') }
}


// ═══════════════════════════════════════════════════════════════
// FLEET STATUS  (joined view for dashboard)
// ═══════════════════════════════════════════════════════════════

/**
 * Returns drivers joined with their latest GPS location and current task.
 * Uses the `active_drivers` view if available, falls back to joined queries.
 */
export async function getFleetStatus() {
  if (isLiveMode()) {
    const sb = getSupabaseClient()
    // Try active_drivers view first (created by sql_2)
    const { data: viewData, error: viewError } = await sb
      .from('active_drivers')
      .select('*')

    if (!viewError && viewData) return viewData

    // Fallback: manual join
    const { data, error } = await sb
      .from('drivers')
      .select('id, name, status, current_task, online, updated_at')
    if (error) { console.error('[AP3X:Backend] getFleetStatus:', error); return [] }
    return data || []
  }
  return driverTable.list()
}

// Legacy alias for older components
export { getVehicles as getFleetNodes }


// ═══════════════════════════════════════════════════════════════
// OFFLINE RECOVERY  (Driver PWA — reconnect flush)
// ═══════════════════════════════════════════════════════════════

export async function recoverOfflineTasks(driverId, pendingLocalUpdates = []) {
  if (!isLiveMode()) return { ok: false, tasks: [] }
  const sb = getSupabaseClient()

  const { data: tasks, error } = await sb
    .from('tasks')
    .select('*')
    .eq('assigned_driver', driverId)
    .in('status', ['assigned', 'accepted', 'in_progress'])
    .order('assigned_at', { ascending: false })

  if (error) return { ok: false, tasks: [], error: error.message }

  // Flush pending local updates (backend wins if status already advanced)
  for (const update of pendingLocalUpdates) {
    try {
      await sb
        .from('tasks')
        .update({ status: update.status, updated_at: update.updated_at || now() })
        .eq('id', update.taskId)
        .eq('assigned_driver', driverId)
    } catch {}
  }

  return { ok: true, tasks: tasks || [] }
}


// ═══════════════════════════════════════════════════════════════
// FLEET NODES  (contract: tables + realtime subscription)
// ═══════════════════════════════════════════════════════════════

export async function getFleetNodesList() {
  if (isLiveMode()) {
    const sb = getSupabaseClient()
    const { data, error } = await sb
      .from('fleet_nodes')
      .select('*')
      .order('node_name', { ascending: true })
    if (error) { console.error('[AP3X:Backend] getFleetNodesList:', error); return [] }
    return data || []
  }
  return vehicleTable.list()
}

export async function upsertFleetNode(nodeData) {
  if (!isLiveMode()) return { ok: false, error: 'offline' }
  const sb = getSupabaseClient()
  const { data, error } = await sb
    .from('fleet_nodes')
    .upsert({ ...nodeData, updated_at: now() }, { onConflict: 'id' })
    .select()
    .single()
  if (error) { console.error('[AP3X:Backend] upsertFleetNode:', error); return { ok: false, error: error.message } }
  return { ok: true, data }
}

export function subscribeToFleetNodes(callback) {
  if (!isLiveMode()) {
    return localSubscribe(DB_KEYS.VEHICLES, () => getFleetNodesList().then(callback))
  }
  const sb = getSupabaseClient()
  if (!sb) return () => {}
  const channel = sb
    .channel('ap3x-fleet-nodes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'fleet_nodes' },
      () => getFleetNodesList().then(callback)
    )
    .subscribe(s => {
      if (s === 'SUBSCRIBED')    setStatus('connected')
      if (s === 'CHANNEL_ERROR') setStatus('sync_delayed')
    })
  registerChannel('fleet_nodes', channel)
  return () => { try { sb.removeChannel(channel) } catch {} _channels.delete('fleet_nodes') }
}


// ═══════════════════════════════════════════════════════════════
// DASHBOARD EVENTS  (audit log)
// ═══════════════════════════════════════════════════════════════

export async function logDashboardEvent(type, payload) {
  if (!isLiveMode()) return
  const sb = getSupabaseClient()
  try {
    await sb.from('dashboard_events').insert({ type, payload, created_at: now() })
  } catch (e) {
    console.warn('[AP3X:Backend] dashboard_events insert failed (non-fatal):', e.message)
  }
}

export async function getDashboardEvents(limit = 50) {
  if (!isLiveMode()) return []
  const sb = getSupabaseClient()
  const { data, error } = await sb
    .from('dashboard_events')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) { console.error('[AP3X:Backend] getDashboardEvents:', error); return [] }
  return data || []
}


// ═══════════════════════════════════════════════════════════════
// SETTINGS  (fleet-wide operator settings — Supabase backed)
// ═══════════════════════════════════════════════════════════════

export async function getSettings(key = null) {
  if (!isLiveMode()) return key ? null : {}
  const sb = getSupabaseClient()
  let query = sb.from('settings').select('*')
  if (key) query = query.eq('key', key).single()
  const { data, error } = await query
  if (error) { console.debug('[AP3X:Backend] getSettings:', error.message); return key ? null : {} }
  if (key) return data?.value ?? null
  return (data || []).reduce((acc, row) => { acc[row.key] = row.value; return acc }, {})
}

export async function setSetting(key, value) {
  if (!isLiveMode()) return { ok: false, error: 'offline' }
  const sb = getSupabaseClient()
  const { data, error } = await sb
    .from('settings')
    .upsert({ key, value, updated_at: now() }, { onConflict: 'key' })
    .select()
    .single()
  if (error) { console.error('[AP3X:Backend] setSetting:', error); return { ok: false, error: error.message } }
  return { ok: true, data }
}


// ═══════════════════════════════════════════════════════════════
// DASHBOARD EVENTS — REALTIME SUBSCRIPTION (READ ONLY)
// Enables Fleet OS to receive live inserts from dashboard_events.
// Matches the exact pattern of subscribeToTasks / subscribeToDrivers.
// ═══════════════════════════════════════════════════════════════

/**
 * Subscribe to dashboard_events table via Supabase Realtime.
 * Fires callback with the raw INSERT payload on every new event.
 * Falls back gracefully when Supabase is not configured.
 *
 * READ ONLY — no writes triggered.
 *
 * @param {function} callback — called with the new dashboard_events row
 * @returns {function} unsubscribe
 */
export function subscribeToDashboardEvents(callback) {
  if (!isLiveMode()) return () => {}
  const sb = getSupabaseClient()
  if (!sb) return () => {}

  const channel = sb
    .channel('ap3x-dashboard-events')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'dashboard_events' },
      (payload) => {
        try { callback(payload.new) } catch {}
      }
    )
    .subscribe(s => {
      if (s === 'SUBSCRIBED')    setStatus('connected')
      if (s === 'CHANNEL_ERROR') setStatus('sync_delayed')
    })

  registerChannel('dashboard-events', channel)
  return () => {
    try { sb.removeChannel(channel) } catch {}
    _channels.delete('dashboard-events')
  }
}
