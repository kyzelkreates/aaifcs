/**
 * ============================================================
 * AP3X — Centralized Backend Service Layer
 * services/backendService.js
 *
 * THIS IS THE ONLY DATA ACCESS LAYER FOR ALL COMPONENTS.
 *
 * - In live mode  → reads/writes Supabase + real-time subs
 * - In local mode → falls back to localStorage (localDB)
 * - NO component may call Supabase directly
 * - NO silent fake data injection in live mode
 * ============================================================
 */

import { getSupabaseClient, isSupabaseReady, getSupabaseSettings } from './services_supabase_supabaseClient'
import { jobTable, driverTable, vehicleTable, telemetryTable } from './services_local_localDB'

// ─── Status event bus (subscribe from UI) ────────────────────
const _listeners = new Set()

export function onConnectionStatus(cb) {
  _listeners.add(cb)
  return () => _listeners.delete(cb)
}

function emitStatus(status) {
  _listeners.forEach(cb => cb(status))
}

// Statuses: 'connected' | 'connecting' | 'offline' | 'invalid_config' | 'failed' | 'sync_delayed'
let _currentStatus = 'offline'

export function getConnectionStatus() { return _currentStatus }

function setStatus(status) {
  if (_currentStatus !== status) {
    _currentStatus = status
    emitStatus(status)
  }
}

// ─── Mode helper ─────────────────────────────────────────────
export function isLiveMode() {
  const settings = getSupabaseSettings()
  return settings.enabled && isSupabaseReady()
}

// ─── Timestamp helper ────────────────────────────────────────
const now = () => new Date().toISOString()

// ─── Active realtime subscriptions registry ──────────────────
const _channels = new Map()

function registerChannel(key, channel) {
  // Clean up existing channel for this key
  if (_channels.has(key)) {
    try {
      const existing = _channels.get(key)
      const sb = getSupabaseClient()
      sb?.removeChannel(existing)
    } catch {}
  }
  _channels.set(key, channel)
}

export function cleanupSubscriptions() {
  const sb = getSupabaseClient()
  if (!sb) return
  _channels.forEach((channel) => {
    try { sb.removeChannel(channel) } catch {}
  })
  _channels.clear()
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

    if (error) {
      console.error('[AP3X:Backend] getDrivers error:', error)
      setStatus('failed')
      return []
    }
    setStatus('connected')
    return data || []
  }

  // Local fallback
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
    // Local: subscribe via BroadcastChannel
    const { subscribe } = require('./services_local_localDB')
    return subscribe('apex:db:drivers', (event) => {
      getDrivers().then(callback)
    })
  }

  const sb = getSupabaseClient()
  if (!sb) return () => {}

  const channel = sb
    .channel('ap3x-drivers')
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'drivers' },
      (payload) => {
        console.info('[AP3X:Backend] drivers change:', payload.eventType)
        getDrivers().then(callback)
      }
    )
    .subscribe((status) => {
      console.info('[AP3X:Backend] drivers subscription:', status)
      if (status === 'SUBSCRIBED') setStatus('connected')
      if (status === 'CHANNEL_ERROR') setStatus('sync_delayed')
    })

  registerChannel('drivers', channel)

  return () => {
    try { sb.removeChannel(channel) } catch {}
    _channels.delete('drivers')
  }
}

// ═══════════════════════════════════════════════════════════════
// TASKS / JOBS
// ═══════════════════════════════════════════════════════════════

export async function getTasks(filter = {}) {
  if (isLiveMode()) {
    setStatus('connecting')
    const sb = getSupabaseClient()
    let query = sb.from('tasks').select('*')

    if (filter.assigned_driver) {
      query = query.eq('assigned_driver', filter.assigned_driver)
    }
    if (filter.status) {
      query = query.eq('status', filter.status)
    }

    const { data, error } = await query.order('created_at', { ascending: false })

    if (error) {
      console.error('[AP3X:Backend] getTasks error:', error)
      setStatus('failed')
      return []
    }
    setStatus('connected')
    return data || []
  }

  // Local fallback
  const jobs = jobTable.list(filter)
  return jobs
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

    // Log dashboard event
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

// ─── CRITICAL: Job Assignment ─────────────────────────────────
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
      return { ok: false, error: 'Task already assigned to this driver', duplicate: true }
    }

    // Write assignment to tasks table
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

    // Update driver's current_task field
    await sb
      .from('drivers')
      .update({ current_task: taskId, updated_at: assignedAt })
      .eq('id', driverId)

    // Log to dashboard_events
    await _logDashboardEvent('job_assigned', {
      task_id:     taskId,
      driver_id:   driverId,
      driver_name: driverName,
      assigned_at: assignedAt,
    })

    return { ok: true, data }
  }

  // Local fallback
  try {
    const updated = jobTable.update(taskId, {
      driver_id:   driverId,
      driver_name: driverName,
      status:      'assigned',
      assigned_at: assignedAt,
    })
    driverTable.update(driverId, { current_task: taskId })
    return { ok: true, data: updated }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

export function subscribeToTasks(callback, driverFilter = null) {
  if (!isLiveMode()) {
    const { subscribe } = require('./services_local_localDB')
    return subscribe('apex:db:jobs', () => {
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
      console.info('[AP3X:Backend] tasks change:', payload.eventType, payload.new?.id)
      getTasks(driverFilter ? { assigned_driver: driverFilter } : {}).then(callback)
    })
    .subscribe((status) => {
      console.info('[AP3X:Backend] tasks subscription:', status)
      if (status === 'SUBSCRIBED') setStatus('connected')
      if (status === 'CHANNEL_ERROR') setStatus('sync_delayed')
    })

  registerChannel(channelKey, channel)

  return () => {
    try { sb.removeChannel(channel) } catch {}
    _channels.delete(channelKey)
  }
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

    if (error) {
      console.error('[AP3X:Backend] getFleetStatus error:', error)
      return []
    }
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

    if (error) {
      console.error('[AP3X:Backend] getFleetNodes error:', error)
      return []
    }
    return data || []
  }

  return vehicleTable.list()
}

export function subscribeToFleetNodes(callback) {
  if (!isLiveMode()) {
    const { subscribe } = require('./services_local_localDB')
    return subscribe('apex:db:vehicles', () => {
      getFleetNodes().then(callback)
    })
  }

  const sb = getSupabaseClient()
  if (!sb) return () => {}

  const channel = sb
    .channel('ap3x-fleet-nodes')
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'fleet_nodes' },
      () => getFleetNodes().then(callback)
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') setStatus('connected')
    })

  registerChannel('fleet_nodes', channel)

  return () => {
    try { sb.removeChannel(channel) } catch {}
    _channels.delete('fleet_nodes')
  }
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

  return driverId
    ? telemetryTable.list({ driver_id: driverId })
    : telemetryTable.list()
}

// ═══════════════════════════════════════════════════════════════
// DASHBOARD EVENTS (internal)
// ═══════════════════════════════════════════════════════════════

async function _logDashboardEvent(type, payload) {
  if (!isLiveMode()) return
  const sb = getSupabaseClient()
  try {
    await sb.from('dashboard_events').insert({
      type,
      payload,
      created_at: now(),
    })
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
// OFFLINE RECOVERY — Driver PWA
// ═══════════════════════════════════════════════════════════════

/**
 * Called when Driver PWA comes back online.
 * Pulls all tasks assigned to this driver and returns them.
 * Also reconciles any locally-pending status updates.
 */
export async function recoverOfflineTasks(driverId, pendingLocalUpdates = []) {
  if (!isLiveMode()) return { ok: false, tasks: [] }

  const sb = getSupabaseClient()

  // Pull current assigned tasks for this driver
  const { data: tasks, error } = await sb
    .from('tasks')
    .select('*')
    .eq('assigned_driver', driverId)
    .in('status', ['assigned', 'accepted', 'in_progress'])
    .order('assigned_at', { ascending: false })

  if (error) return { ok: false, tasks: [], error: error.message }

  // Push any local updates that happened while offline
  for (const update of pendingLocalUpdates) {
    try {
      await sb
        .from('tasks')
        .update({ status: update.status, updated_at: update.updated_at || now() })
        .eq('id', update.taskId)
        .eq('assigned_driver', driverId) // safety: only update own tasks
    } catch {}
  }

  return { ok: true, tasks: tasks || [] }
}

// ═══════════════════════════════════════════════════════════════
// CONNECTIVITY PROBE
// ═══════════════════════════════════════════════════════════════

export async function probeConnection() {
  if (!isSupabaseReady()) {
    setStatus('invalid_config')
    return false
  }

  try {
    setStatus('connecting')
    const sb = getSupabaseClient()
    const { error } = await sb.from('drivers').select('id').limit(1)
    if (error && error.code !== 'PGRST116' && error.code !== '42P01') {
      setStatus('failed')
      return false
    }
    setStatus('connected')
    return true
  } catch {
    setStatus('offline')
    return false
  }
}
