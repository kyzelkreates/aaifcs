/**
 * ============================================================
 * AP3X — Centralized Backend Service Layer  (SSOT data access)
 * services/backendService.js
 *
 * THE ONLY DATA ACCESS LAYER — no component calls Supabase directly.
 *
 * Live mode  → Supabase queries + realtime subscriptions
 * Local mode → localStorage via localDB (BroadcastChannel sync)
 *
 * On module load: auto-probes connection if settings.enabled === true.
 * ============================================================
 */

import { getSupabaseClient, isSupabaseReady, getSupabaseSettings, autoInitSupabase } from './services_supabase_supabaseClient'
import { jobTable, driverTable, vehicleTable, telemetryTable, subscribe as localSubscribe, DB_KEYS } from './services_local_localDB'

// ─── Ensure client is initialized before any call ────────────
autoInitSupabase()

// ─── Connection status event bus ──────────────────────────────
const _listeners = new Set()

export function onConnectionStatus(cb) {
  _listeners.add(cb)
  // Immediately fire with current status so new subscribers get state now
  try { cb(_currentStatus) } catch {}
  return () => _listeners.delete(cb)
}

function emitStatus(status) {
  _listeners.forEach(cb => { try { cb(status) } catch {} })
}

// Statuses: 'connected' | 'connecting' | 'offline' | 'invalid_config' | 'failed' | 'sync_delayed'
let _currentStatus = 'offline'

export function getConnectionStatus() { return _currentStatus }

function setStatus(status) {
  if (_currentStatus !== status) {
    _currentStatus = status
    console.debug('[AP3X:Backend] Status →', status)
    emitStatus(status)
  }
}

// ─── Mode check ───────────────────────────────────────────────
export function isLiveMode() {
  const settings = getSupabaseSettings()
  return !!(settings.enabled && settings.url && settings.anonKey && isSupabaseReady())
}

// ─── Timestamp helper ─────────────────────────────────────────
const now = () => new Date().toISOString()

// ─── Realtime channel registry (prevents duplicates) ─────────
const _channels = new Map()

function registerChannel(key, channel) {
  if (_channels.has(key)) {
    try {
      const sb = getSupabaseClient()
      sb?.removeChannel(_channels.get(key))
    } catch {}
  }
  _channels.set(key, channel)
}

export function cleanupSubscriptions() {
  const sb = getSupabaseClient()
  if (!sb) return
  _channels.forEach((ch) => { try { sb.removeChannel(ch) } catch {} })
  _channels.clear()
}

// ─── Startup connection probe ─────────────────────────────────
// Called automatically on module load and on demand.
// Sets the status that ConnectionStatusPill reflects.
let _probeInFlight = false

export async function probeConnection() {
  if (_probeInFlight) return _currentStatus === 'connected'
  _probeInFlight = true

  const settings = getSupabaseSettings()

  if (!settings.enabled) {
    setStatus('offline')
    _probeInFlight = false
    return false
  }

  if (!settings.url || !settings.anonKey) {
    setStatus('invalid_config')
    console.warn('[AP3X:Backend] Supabase enabled but URL/key missing — check Settings → Backend')
    _probeInFlight = false
    return false
  }

  const sb = getSupabaseClient()
  if (!sb) {
    setStatus('invalid_config')
    _probeInFlight = false
    return false
  }

  try {
    setStatus('connecting')
    console.debug('[AP3X:Backend] Probing Supabase connection…')

    // Try REST health endpoint first — fastest, no table needed
    try {
      const res = await fetch(`${settings.url.trim()}/rest/v1/`, {
        headers: {
          apikey:        settings.anonKey.trim(),
          Authorization: `Bearer ${settings.anonKey.trim()}`,
        },
        signal: AbortSignal.timeout(6000),
      })
      if (res.status > 0) {
        setStatus('connected')
        console.info('[AP3X:Backend] ✓ Connected via REST probe, status:', res.status)
        _probeInFlight = false
        return true
      }
    } catch (fetchErr) {
      console.debug('[AP3X:Backend] REST probe failed, falling back to SDK:', fetchErr.message)
    }

    // Fallback: SDK query
    const { error } = await sb.from('tasks').select('id').limit(1)
    const IGNORABLE = new Set(['PGRST116','PGRST301','42P01','42501','PGRST204'])
    if (!error || IGNORABLE.has(error.code) || IGNORABLE.has(String(error.status))) {
      setStatus('connected')
      console.info('[AP3X:Backend] ✓ Connected via SDK probe')
      _probeInFlight = false
      return true
    }

    console.warn('[AP3X:Backend] SDK probe error:', error?.message, '| code:', error?.code)
    setStatus('failed')
    _probeInFlight = false
    return false
  } catch (e) {
    console.warn('[AP3X:Backend] Connection probe threw:', e.message)
    setStatus('offline')
    _probeInFlight = false
    return false
  }
}

// ─── Auto-probe on startup if live mode is configured ─────────
;(function startupProbe() {
  const settings = getSupabaseSettings()
  if (settings.enabled && settings.url && settings.anonKey) {
    // Small delay so module graph fully loads first
    setTimeout(() => probeConnection(), 800)
  }
})()

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

    if (error) {
      console.error('[AP3X:Backend] getDrivers error:', error)
      setStatus('failed')
      return []
    }
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

    if (error) {
      console.error('[AP3X:Backend] updateDriverStatus error:', error)
      return { ok: false, error: error.message }
    }
    return { ok: true, data }
  }
  try {
    const updated = driverTable.update(driverId, { status, ...extra })
    return { ok: true, data: updated }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

export function subscribeToDrivers(callback) {
  if (!isLiveMode()) {
    return localSubscribe(DB_KEYS.DRIVERS, () => getDrivers().then(callback))
  }

  const sb = getSupabaseClient()
  if (!sb) return () => {}

  const channel = sb
    .channel('ap3x-drivers')
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'drivers' },
      () => getDrivers().then(callback)
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') setStatus('connected')
      if (status === 'CHANNEL_ERROR') setStatus('sync_delayed')
    })

  registerChannel('drivers', channel)
  return () => { try { sb.removeChannel(channel) } catch {} _channels.delete('drivers') }
}

// ═══════════════════════════════════════════════════════════════
// TASKS / JOBS
// ═══════════════════════════════════════════════════════════════

export async function getTasks(filter = {}) {
  if (isLiveMode()) {
    setStatus('connecting')
    const sb = getSupabaseClient()
    let query = sb.from('tasks').select('*')
    if (filter.assigned_driver) query = query.eq('assigned_driver', filter.assigned_driver)
    if (filter.status)          query = query.eq('status', filter.status)

    const { data, error } = await query.order('created_at', { ascending: false })
    if (error) {
      console.error('[AP3X:Backend] getTasks error:', error)
      setStatus('failed')
      return []
    }
    setStatus('connected')
    return data || []
  }
  return jobTable.list(filter)
}

// ─── CRITICAL: Create job → Supabase (pushes to Driver PWA) ──
// This is the single source of truth for job creation.
// In live mode: inserts into Supabase tasks table, which triggers
// Supabase Realtime → pwaJobSync on driver phones instantly.
// In local mode: writes to localStorage localDB.
export async function createTask(payload) {
  const ts = now()
  const jobData = {
    title:               payload.title,
    description:         payload.description         || null,
    status:              payload.status              || 'pending',
    priority:            payload.priority            || 'normal',
    assigned_driver:     payload.assigned_driver     || payload.driver_id || null,
    assigned_driver_name:payload.assigned_driver_name || payload.driver_name || null,
    assigned_at:         payload.assigned_driver ? ts : null,
    vehicle_id:          payload.vehicle_id          || null,
    vehicle_reg:         payload.vehicle_reg         || null,
    driver_name:         payload.driver_name         || null,
    stops:               payload.stops               || null,
    waypoints:           payload.waypoints           || null,
    pickup_address:      payload.pickup_address      || payload.origin || null,
    dropoff_address:     payload.dropoff_address     || payload.destination || null,
    cancel_reason:       null,
    completion_notes:    null,
    created_at:          ts,
    updated_at:          ts,
  }

  if (isLiveMode()) {
    const sb = getSupabaseClient()
    const { data, error } = await sb
      .from('tasks')
      .insert(jobData)
      .select()
      .single()

    if (error) {
      console.error('[AP3X:Backend] createTask error:', error)
      return { ok: false, error: error.message }
    }

    // If already assigned, update driver's current_task and log event
    if (data.assigned_driver) {
      await sb
        .from('drivers')
        .update({ current_task: data.id, updated_at: ts })
        .eq('id', data.assigned_driver)
    }

    await _logDashboardEvent('task_created', {
      task_id:     data.id,
      title:       data.title,
      driver_id:   data.assigned_driver,
      driver_name: data.assigned_driver_name,
      priority:    data.priority,
    })

    console.info('[AP3X:Backend] Task created in Supabase:', data.id, '→', data.title)
    return { ok: true, data }
  }

  // Local fallback
  try {
    const created = jobTable.create({ ...jobData, id: undefined })
    return { ok: true, data: created }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

export async function updateTask(taskId, updates) {
  if (isLiveMode()) {
    const sb = getSupabaseClient()
    const { data, error } = await sb
      .from('tasks')
      .update({ ...updates, updated_at: now() })
      .eq('id', taskId)
      .select()
      .single()

    if (error) {
      console.error('[AP3X:Backend] updateTask error:', error)
      return { ok: false, error: error.message }
    }
    await _logDashboardEvent('task_updated', { task_id: taskId, ...updates })
    return { ok: true, data }
  }
  try {
    const updated = jobTable.update(taskId, updates)
    return { ok: true, data: updated }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

// ─── CRITICAL: Job Assignment Flow ────────────────────────────
export async function assignJobToDriver(taskId, driverId, driverName = '') {
  const assignedAt = now()

  if (isLiveMode()) {
    const sb = getSupabaseClient()

    // Duplicate assignment guard
    const { data: existing } = await sb
      .from('tasks')
      .select('id, assigned_driver, status')
      .eq('id', taskId)
      .single()

    if (existing?.assigned_driver === driverId && existing?.status === 'assigned') {
      return { ok: false, error: 'Already assigned to this driver', duplicate: true }
    }

    const { data, error } = await sb
      .from('tasks')
      .update({
        assigned_driver:      driverId,
        assigned_driver_name: driverName,
        status:               'assigned',
        assigned_at:          assignedAt,
        updated_at:           assignedAt,
      })
      .eq('id', taskId)
      .select()
      .single()

    if (error) {
      console.error('[AP3X:Backend] assignJobToDriver error:', error)
      return { ok: false, error: error.message }
    }

    // Update driver's current_task
    await sb.from('drivers').update({ current_task: taskId, updated_at: assignedAt }).eq('id', driverId)

    // Audit event
    await _logDashboardEvent('job_assigned', {
      task_id: taskId, driver_id: driverId, driver_name: driverName, assigned_at: assignedAt,
    })

    return { ok: true, data }
  }

  // Local fallback
  try {
    const updated = jobTable.update(taskId, {
      driver_id: driverId, driver_name: driverName,
      status: 'assigned', assigned_at: assignedAt,
    })
    driverTable.update(driverId, { current_task: taskId })
    return { ok: true, data: updated }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

export function subscribeToTasks(callback, driverFilter = null) {
  if (!isLiveMode()) {
    return localSubscribe(DB_KEYS.JOBS, () => {
      getTasks(driverFilter ? { assigned_driver: driverFilter } : {}).then(callback)
    })
  }

  const sb = getSupabaseClient()
  if (!sb) return () => {}

  const channelKey = driverFilter ? `tasks-driver-${driverFilter}` : 'tasks-all'
  const filter = driverFilter
    ? { event: '*', schema: 'public', table: 'tasks', filter: `assigned_driver=eq.${driverFilter}` }
    : { event: '*', schema: 'public', table: 'tasks' }

  const channel = sb
    .channel(channelKey)
    .on('postgres_changes', filter, (payload) => {
      console.debug('[AP3X:Backend] tasks change:', payload.eventType, payload.new?.id)
      getTasks(driverFilter ? { assigned_driver: driverFilter } : {}).then(callback)
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') setStatus('connected')
      if (status === 'CHANNEL_ERROR') setStatus('sync_delayed')
    })

  registerChannel(channelKey, channel)
  return () => { try { sb.removeChannel(channel) } catch {} _channels.delete(channelKey) }
}

// ═══════════════════════════════════════════════════════════════
// FLEET / NODES
// ═══════════════════════════════════════════════════════════════

export async function getFleetStatus() {
  if (isLiveMode()) {
    const sb = getSupabaseClient()
    const { data, error } = await sb
      .from('drivers')
      .select('id, name, status, current_task, online, updated_at')
    if (error) { console.error('[AP3X:Backend] getFleetStatus error:', error); return [] }
    return data || []
  }
  return driverTable.list()
}

export async function getFleetNodes() {
  if (isLiveMode()) {
    const sb = getSupabaseClient()
    const { data, error } = await sb
      .from('fleet_nodes')
      .select('*')
      .order('node_name', { ascending: true })
    if (error) { console.error('[AP3X:Backend] getFleetNodes error:', error); return [] }
    return data || []
  }
  return vehicleTable.list()
}

export function subscribeToFleetNodes(callback) {
  if (!isLiveMode()) {
    return localSubscribe(DB_KEYS.VEHICLES, () => getFleetNodes().then(callback))
  }
  const sb = getSupabaseClient()
  if (!sb) return () => {}

  const channel = sb
    .channel('ap3x-fleet-nodes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'fleet_nodes' }, () => getFleetNodes().then(callback))
    .subscribe((status) => { if (status === 'SUBSCRIBED') setStatus('connected') })

  registerChannel('fleet_nodes', channel)
  return () => { try { sb.removeChannel(channel) } catch {} _channels.delete('fleet_nodes') }
}

// ═══════════════════════════════════════════════════════════════
// TELEMETRY
// ═══════════════════════════════════════════════════════════════

export async function getTelemetry(driverId = null) {
  if (isLiveMode()) {
    const sb = getSupabaseClient()
    let query = sb.from('fleet_nodes').select('id, node_name, telemetry, last_seen, online')
    if (driverId) query = query.eq('id', driverId)
    const { data, error } = await query
    if (error) return []
    return data || []
  }
  return driverId ? telemetryTable.list({ driver_id: driverId }) : telemetryTable.list()
}

// ═══════════════════════════════════════════════════════════════
// DASHBOARD EVENTS
// ═══════════════════════════════════════════════════════════════

async function _logDashboardEvent(type, payload) {
  if (!isLiveMode()) return
  const sb = getSupabaseClient()
  try {
    await sb.from('dashboard_events').insert({ type, payload, created_at: now() })
  } catch (e) {
    console.warn('[AP3X:Backend] dashboard_events insert failed:', e)
  }
}

export async function getDashboardEvents(limit = 50) {
  if (isLiveMode()) {
    const sb = getSupabaseClient()
    const { data, error } = await sb
      .from('dashboard_events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) return []
    return data || []
  }
  return []
}

// ═══════════════════════════════════════════════════════════════
// OFFLINE RECOVERY
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

  // Flush pending local updates
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
