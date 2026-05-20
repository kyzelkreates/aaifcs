/**
 * ============================================================
 * APEX AI — Local Database (No Supabase)
 * Full CRUD over localStorage for all entities.
 * Real-time sync via BroadcastChannel across tabs/windows.
 * Used by: fleet, drivers, dispatch, incidents, messaging,
 *          telemetry, analytics, AP3X driver app.
 *
 * Storage keys:
 *   apex:db:vehicles      apex:db:drivers      apex:db:jobs
 *   apex:db:incidents     apex:db:messages     apex:db:telemetry
 *   apex:db:channels      apex:db:analytics
 * ============================================================
 */

// ─── Key registry ─────────────────────────────────────────────
export const DB_KEYS = {
  VEHICLES:  'apex:db:vehicles',
  DRIVERS:   'apex:db:drivers',
  JOBS:      'apex:db:jobs',
  INCIDENTS: 'apex:db:incidents',
  MESSAGES:  'apex:db:messages',
  CHANNELS:  'apex:db:channels',
  TELEMETRY: 'apex:db:telemetry',
  ANALYTICS: 'apex:db:analytics',
  SYNC_PKG:  'apex:sync:package',      // cross-device sync payload
}

// ─── Helpers ──────────────────────────────────────────────────
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2,8)}`

const now = () => new Date().toISOString()

// Broadcast changes to other tabs
let bc = null
try { bc = new BroadcastChannel('apex:db') } catch {}

function broadcast(event, table, payload) {
  bc?.postMessage({ event, table, payload, ts: Date.now() })
}

// ─── Generic table CRUD ───────────────────────────────────────
export function table(key) {
  const read = () => {
    try { return JSON.parse(localStorage.getItem(key) || '[]') } catch { return [] }
  }
  const write = (rows) => {
    localStorage.setItem(key, JSON.stringify(rows))
  }

  return {
    list(filter = {}) {
      let rows = read()
      for (const [k, v] of Object.entries(filter)) {
        rows = rows.filter(r => r[k] === v)
      }
      return rows
    },

    get(id) {
      return read().find(r => r.id === id) || null
    },

    create(data) {
      const rows = read()
      const row = { id: uid(), created_at: now(), updated_at: now(), ...data }
      rows.unshift(row)
      write(rows)
      broadcast('INSERT', key, row)
      return row
    },

    update(id, data) {
      const rows = read()
      const idx  = rows.findIndex(r => r.id === id)
      if (idx === -1) throw new Error(`Record ${id} not found in ${key}`)
      rows[idx] = { ...rows[idx], ...data, updated_at: now() }
      write(rows)
      broadcast('UPDATE', key, rows[idx])
      return rows[idx]
    },

    delete(id) {
      const rows = read().filter(r => r.id !== id)
      write(rows)
      broadcast('DELETE', key, { id })
    },

    clear() {
      write([])
      broadcast('CLEAR', key, {})
    },
  }
}


// ─── Named tables ─────────────────────────────────────────────
export const vehicleTable   = table(DB_KEYS.VEHICLES)
export const driverTable    = table(DB_KEYS.DRIVERS)
export const jobTable       = table(DB_KEYS.JOBS)
export const incidentTable  = table(DB_KEYS.INCIDENTS)
export const messageTable   = table(DB_KEYS.MESSAGES)
export const channelTable   = table(DB_KEYS.CHANNELS)
export const telemetryTable = table(DB_KEYS.TELEMETRY)

// ─── Real-time subscription ───────────────────────────────────
export function subscribe(tableKey, callback) {
  const handler = (e) => {
    if (e.data?.table === tableKey) callback(e.data)
  }
  bc?.addEventListener('message', handler)
  return () => bc?.removeEventListener('message', handler)
}

// ─── Cross-device sync package ────────────────────────────────
// Creates a JSON blob containing jobs assigned to a specific driver.
// Can be sent via email, QR, Web Share, or BLE characteristic.
export function buildDriverSyncPackage(driverId) {
  const jobs = jobTable.list().filter(j =>
    j.driver_id === driverId &&
    ['assigned', 'in_progress', 'pending'].includes(j.status)
  )
  const driver = driverTable.get(driverId)
  return {
    version:    '1.0',
    generated:  now(),
    driver_id:  driverId,
    driver_name: driver?.full_name || 'Driver',
    jobs,
    // Signature (simple — not cryptographic)
    sig: btoa(JSON.stringify({ driverId, ts: Date.now() })).slice(0, 16),
  }
}

// Import a sync package on the driver side
export function importDriverSyncPackage(pkg) {
  try {
    const parsed = typeof pkg === 'string' ? JSON.parse(pkg) : pkg
    if (!parsed?.jobs || !Array.isArray(parsed.jobs)) throw new Error('Invalid package')
    // Merge jobs (upsert by id)
    const existing = jobTable.list()
    parsed.jobs.forEach(job => {
      const exists = existing.find(j => j.id === job.id)
      if (exists) {
        jobTable.update(job.id, job)
      } else {
        // Insert with fixed id
        const rows = JSON.parse(localStorage.getItem(DB_KEYS.JOBS) || '[]')
        rows.unshift({ ...job, updated_at: now() })
        localStorage.setItem(DB_KEYS.JOBS, JSON.stringify(rows))
      }
    })
    return { ok: true, count: parsed.jobs.length, driver_name: parsed.driver_name }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

// Build a telemetry update package (driver → fleet)
export function buildTelemetryPackage(driverId, telemetry) {
  let tid = 'unknown', eid = 'unknown', sid = 'unknown'
  try {
    const id = JSON.parse(localStorage.getItem('apex:federation:identity') || '{}')
    tid = id.tenant_id       || tid
    eid = id.fleet_entity_id || eid
    sid = id.sync_identity   || sid
  } catch {}
  return {
    version:         '1.0',
    type:            'telemetry',
    ts:              now(),
    driver_id:       driverId,
    tenant_id:       tid,
    fleet_entity_id: eid,
    sync_identity:   sid,
    device_id:       localStorage.getItem('apex:device:id') || 'unknown',
    ...telemetry,
  }
}

// Import telemetry on the fleet side
export function importTelemetryPackage(pkg) {
  try {
    const parsed = typeof pkg === 'string' ? JSON.parse(pkg) : pkg
    if (parsed?.type !== 'telemetry') throw new Error('Not a telemetry package')
    telemetryTable.create({ ...parsed, id: undefined })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}
