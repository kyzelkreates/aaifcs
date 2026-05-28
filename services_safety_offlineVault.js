/**
 * AP3X Offline Safety Vault
 * IndexedDB-backed local store for safety events, route snapshots,
 * dashcam clip metadata, and AI detections.
 *
 * DRIVER PWA ONLY — no Fleet OS dependency.
 */

const DB_NAME    = 'ap3x_safety_vault'
const DB_VERSION = 1

const STORES = {
  INCIDENTS:  'incidents',    // safety events (hazards, harsh, fatigue)
  ROUTE_SNAPS:'route_snaps',  // route geometry snapshots
  DASHCAM:    'dashcam_meta', // dashcam clip metadata
  AI_LOG:     'ai_detections',// AI road vision log
  SYNC_QUEUE: 'sync_queue',   // pending Supabase uploads
}

// ─── Open / initialise DB ─────────────────────────────────────
let _db = null

function openDB() {
  if (_db) return Promise.resolve(_db)
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = e => {
      const db = e.target.result
      if (!db.objectStoreNames.contains(STORES.INCIDENTS)) {
        const s = db.createObjectStore(STORES.INCIDENTS, { keyPath: 'id', autoIncrement: false })
        s.createIndex('by_driver', 'driver_id')
        s.createIndex('by_task',   'task_id')
        s.createIndex('by_time',   'reported_at')
      }
      if (!db.objectStoreNames.contains(STORES.ROUTE_SNAPS)) {
        const s = db.createObjectStore(STORES.ROUTE_SNAPS, { keyPath: 'id', autoIncrement: false })
        s.createIndex('by_task', 'task_id')
      }
      if (!db.objectStoreNames.contains(STORES.DASHCAM)) {
        const s = db.createObjectStore(STORES.DASHCAM, { keyPath: 'id', autoIncrement: false })
        s.createIndex('by_task', 'task_id')
      }
      if (!db.objectStoreNames.contains(STORES.AI_LOG)) {
        const s = db.createObjectStore(STORES.AI_LOG, { keyPath: 'id', autoIncrement: false })
        s.createIndex('by_time', 'detected_at')
      }
      if (!db.objectStoreNames.contains(STORES.SYNC_QUEUE)) {
        const s = db.createObjectStore(STORES.SYNC_QUEUE, { keyPath: 'id', autoIncrement: false })
        s.createIndex('by_table', 'table_name')
      }
    }
    req.onsuccess = e => { _db = e.target.result; resolve(_db) }
    req.onerror   = e => reject(e.target.error)
  })
}

// ─── Generic helpers ──────────────────────────────────────────
async function put(storeName, record) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(storeName, 'readwrite')
    const req = tx.objectStore(storeName).put(record)
    req.onsuccess = () => resolve(req.result)
    req.onerror   = e => reject(e.target.error)
  })
}

async function getAll(storeName, indexName = null, query = null) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(storeName, 'readonly')
    const store = tx.objectStore(storeName)
    const src   = indexName ? store.index(indexName) : store
    const req   = query ? src.getAll(query) : src.getAll()
    req.onsuccess = () => resolve(req.result)
    req.onerror   = e => reject(e.target.error)
  })
}

async function del(storeName, key) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(storeName, 'readwrite')
    const req = tx.objectStore(storeName).delete(key)
    req.onsuccess = () => resolve()
    req.onerror   = e => reject(e.target.error)
  })
}

// ─── Public API ───────────────────────────────────────────────

/** Save an incident locally (always succeeds offline) */
export async function saveIncidentLocally(incident) {
  const record = { ...incident, id: incident.id || crypto.randomUUID(), _synced: false }
  await put(STORES.INCIDENTS, record)
  await put(STORES.SYNC_QUEUE, {
    id:         record.id,
    table_name: 'safety_incidents',
    payload:    record,
    queued_at:  new Date().toISOString(),
  })
  return record
}

/** Get all incidents for a driver (or all if no filter) */
export async function getLocalIncidents(driverId = null) {
  const all = await getAll(STORES.INCIDENTS)
  return driverId ? all.filter(r => r.driver_id === driverId) : all
}

/** Save a route snapshot locally */
export async function saveRouteSnapshot(snap) {
  const record = { ...snap, id: snap.id || crypto.randomUUID(), saved_at: new Date().toISOString() }
  await put(STORES.ROUTE_SNAPS, record)
  return record
}

/** Get route snapshot by task ID */
export async function getRouteSnapshot(taskId) {
  const all = await getAll(STORES.ROUTE_SNAPS, 'by_task', taskId)
  return all[0] || null
}

/** Log a dashcam capture event locally */
export async function logDashcamEvent(event) {
  const record = { ...event, id: event.id || crypto.randomUUID() }
  await put(STORES.DASHCAM, record)
  await put(STORES.SYNC_QUEUE, {
    id:         record.id,
    table_name: 'driver_dashcam_events',
    payload:    record,
    queued_at:  new Date().toISOString(),
  })
  return record
}

/** Log an AI detection */
export async function logAIDetection(detection) {
  const record = { ...detection, id: crypto.randomUUID(), detected_at: new Date().toISOString() }
  await put(STORES.AI_LOG, record)
  return record
}

/** Get all pending sync records */
export async function getSyncQueue() {
  return getAll(STORES.SYNC_QUEUE)
}

/** Remove a successfully synced item from the queue */
export async function removeSyncItem(id) {
  await del(STORES.SYNC_QUEUE, id)
}

/** Count unsynced items */
export async function unsyncedCount() {
  const q = await getSyncQueue()
  return q.length
}

export const VAULT_STORES = STORES
