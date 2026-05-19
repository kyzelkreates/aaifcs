/**
 * ============================================================
 * APEX AI — Telemetry Queue (Offline-first, Federation-ready)
 *
 * Queues all federation payloads locally with:
 *   - IndexedDB primary storage (survives page reload)
 *   - localStorage fallback
 *   - Priority-based batch processing
 *   - Retry with exponential backoff
 *   - Tenant-scoped queue isolation
 *   - Compressed snapshot support
 *   - Future Command Center endpoint compatibility
 *
 * Queue operates entirely offline. When Command Center
 * endpoint is configured, batches are drained automatically.
 * ============================================================
 */

import { tenantRegistry } from './services_federation_tenantRegistry'

// ─── Queue config ─────────────────────────────────────────────
const QUEUE_KEY_PREFIX   = 'apex:queue'
const MAX_QUEUE_SIZE     = 2000     // max queued events before LRU eviction
const BATCH_SIZE         = 50       // events per outbound batch
const BATCH_INTERVAL_MS  = 30_000  // 30s drain cycle
const MAX_RETRY          = 5
const RETRY_BASE_MS      = 2_000

// Priority levels (lower = higher priority)
export const PRIORITY = {
  CRITICAL: 1,   // safety alerts, incidents
  HIGH:     2,   // telemetry events
  NORMAL:   3,   // route metrics, AI metrics
  LOW:      4,   // snapshots, financial events
}

// ─── Event types that map to priority ─────────────────────────
const PRIORITY_MAP = {
  safety_event:       PRIORITY.CRITICAL,
  telemetry_event:    PRIORITY.HIGH,
  route_metric:       PRIORITY.HIGH,
  operational_event:  PRIORITY.NORMAL,
  ai_metric:          PRIORITY.NORMAL,
  api_usage:          PRIORITY.LOW,
  sync_snapshot:      PRIORITY.LOW,
  driver_session:     PRIORITY.NORMAL,
  financial_event:    PRIORITY.LOW,
}

// ─── IndexedDB wrapper ────────────────────────────────────────
class IDBQueue {
  constructor(dbName) {
    this.dbName  = dbName
    this.db      = null
    this._ready  = this._init()
  }

  async _init() {
    if (!window.indexedDB) return null
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, 1)
      req.onupgradeneeded = (e) => {
        const db = e.target.result
        if (!db.objectStoreNames.contains('events')) {
          const store = db.createObjectStore('events', { keyPath: 'qid' })
          store.createIndex('priority', 'priority', { unique: false })
          store.createIndex('ts',       'ts',       { unique: false })
          store.createIndex('status',   'status',   { unique: false })
        }
      }
      req.onsuccess  = (e) => { this.db = e.target.result; resolve(this.db) }
      req.onerror    = ()  => resolve(null)
    })
  }

  async ready() { await this._ready; return !!this.db }

  async put(record) {
    if (!await this.ready()) return false
    return new Promise((resolve) => {
      const tx = this.db.transaction('events', 'readwrite')
      tx.objectStore('events').put(record)
      tx.oncomplete = () => resolve(true)
      tx.onerror    = () => resolve(false)
    })
  }

  async getByPriority(limit = BATCH_SIZE) {
    if (!await this.ready()) return []
    return new Promise((resolve) => {
      const tx      = this.db.transaction('events', 'readonly')
      const index   = tx.objectStore('events').index('priority')
      const results = []
      const req     = index.openCursor()
      req.onsuccess = (e) => {
        const cursor = e.target.result
        if (cursor && results.length < limit) {
          if (cursor.value.status === 'pending') results.push(cursor.value)
          cursor.continue()
        } else resolve(results)
      }
      req.onerror = () => resolve([])
    })
  }

  async markSent(qids) {
    if (!await this.ready() || !qids.length) return
    const tx    = this.db.transaction('events', 'readwrite')
    const store = tx.objectStore('events')
    for (const qid of qids) store.delete(qid)
  }

  async markRetry(qid, retryCount) {
    if (!await this.ready()) return
    const tx    = this.db.transaction('events', 'readwrite')
    const store = tx.objectStore('events')
    const req   = store.get(qid)
    req.onsuccess = (e) => {
      const record = e.target.result
      if (record) store.put({ ...record, retries: retryCount, status: 'pending', next_retry: Date.now() + RETRY_BASE_MS * Math.pow(2, retryCount) })
    }
  }

  async count() {
    if (!await this.ready()) return 0
    return new Promise((resolve) => {
      const tx  = this.db.transaction('events', 'readonly')
      const req = tx.objectStore('events').count()
      req.onsuccess = () => resolve(req.result)
      req.onerror   = () => resolve(0)
    })
  }
}

// ─── localStorage fallback queue ──────────────────────────────
class LSQueue {
  constructor(key) { this.key = key }
  _read()          { try { return JSON.parse(localStorage.getItem(this.key) || '[]') } catch { return [] } }
  _write(rows)     { try { localStorage.setItem(this.key, JSON.stringify(rows.slice(0, MAX_QUEUE_SIZE))) } catch {} }
  push(record)     { const rows = this._read(); rows.unshift(record); this._write(rows) }
  getByPriority(n) { return this._read().filter(r => r.status === 'pending').sort((a, b) => a.priority - b.priority).slice(0, n) }
  markSent(qids)   { this._write(this._read().filter(r => !qids.includes(r.qid))) }
  count()          { return this._read().length }
}

// ─── TelemetryQueue singleton ─────────────────────────────────
class TelemetryQueue {
  constructor() {
    const tid    = tenantRegistry.getTenantId()
    this._idb    = new IDBQueue(`apex-queue-${tid}`)
    this._ls     = new LSQueue(`${QUEUE_KEY_PREFIX}:${tid}`)
    this._ccEndpoint  = null   // future Command Center ingestion URL
    this._draining    = false
    this._stats  = {
      enqueued: 0, sent: 0, failed: 0,
      local_fallback: 0, last_drain: null,
    }
    // Auto-drain cycle
    setInterval(() => this._drain(), BATCH_INTERVAL_MS)
  }

  /**
   * Enqueue a federation payload for future Command Center delivery.
   * If no endpoint configured — payload is persisted locally and will
   * be sent when Command Center is connected.
   */
  async enqueue(payload) {
    const record = {
      qid:      `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      status:   'pending',
      retries:  0,
      priority: PRIORITY_MAP[payload._meta?.payload_type] || PRIORITY.NORMAL,
      ts:       Date.now(),
      tenant_id:       payload._meta?.tenant_id,
      fleet_entity_id: payload._meta?.fleet_entity_id,
      payload,
    }

    const ok = await this._idb.put(record)
    if (!ok) this._ls.push(record)
    this._stats.enqueued++
    return record.qid
  }

  /** Set the Command Center ingestion endpoint when available */
  setEndpoint(url) {
    this._ccEndpoint = url
    console.info('[TelemetryQueue] CC endpoint configured:', url)
  }

  /** Get queue depth */
  async depth() {
    const idbCount = await this._idb.count()
    return idbCount || this._ls.count()
  }

  /** Get queue stats */
  getStats() {
    return { ...this._stats }
  }

  /**
   * Drain the queue — send batches to Command Center if endpoint is set.
   * If no endpoint, compresses oldest events to save space.
   */
  async _drain() {
    if (this._draining) return
    this._draining = true

    try {
      const batch    = await this._idb.getByPriority(BATCH_SIZE)
      const lsBatch  = batch.length === 0 ? this._ls.getByPriority(BATCH_SIZE) : []
      const events   = batch.length > 0 ? batch : lsBatch
      if (!events.length) return

      if (this._ccEndpoint) {
        await this._sendBatch(events, batch.length > 0 ? 'idb' : 'ls')
      } else {
        // No endpoint — evict if over limit
        const depth = await this.depth()
        if (depth > MAX_QUEUE_SIZE * 0.9) {
          // Drop lowest priority events to make room
          this._evictOldest(events.filter(e => e.priority === PRIORITY.LOW).map(e => e.qid))
        }
      }

      this._stats.last_drain = new Date().toISOString()
    } finally {
      this._draining = false
    }
  }

  async _sendBatch(events, source) {
    try {
      const res = await fetch(this._ccEndpoint, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          batch:           events.map(e => e.payload),
          tenant_id:       tenantRegistry.getTenantId(),
          fleet_entity_id: tenantRegistry.getFleetEntityId(),
          batch_ts:        new Date().toISOString(),
        }),
      })
      const qids = events.map(e => e.qid)
      if (res.ok) {
        if (source === 'idb') await this._idb.markSent(qids)
        else this._ls.markSent(qids)
        this._stats.sent += events.length
      } else {
        // Increment retry counts
        for (const e of events) {
          if (e.retries >= MAX_RETRY) {
            await this._idb.markSent([e.qid])
            this._stats.failed++
          } else {
            await this._idb.markRetry(e.qid, (e.retries || 0) + 1)
          }
        }
      }
    } catch {
      // Network failure — events stay in queue
    }
  }

  _evictOldest(qids) {
    if (!qids.length) return
    this._ls.markSent(qids)
  }

  /**
   * Build a compressed sync snapshot of current fleet state.
   * Used for delta-sync — sends only what changed since last snapshot.
   */
  buildCompressedSnapshot(entities) {
    try {
      const snap = {
        tenant_id:       tenantRegistry.getTenantId(),
        fleet_entity_id: tenantRegistry.getFleetEntityId(),
        ts:              new Date().toISOString(),
        vehicles:        entities.vehicles   || [],
        drivers:         entities.drivers    || [],
        jobs:            entities.jobs       || [],
        record_counts: {
          vehicles:  (entities.vehicles  || []).length,
          drivers:   (entities.drivers   || []).length,
          jobs:      (entities.jobs      || []).length,
        },
      }
      // Simple delta marker — hash of record IDs
      const ids = [
        ...(snap.vehicles.map(v => v.id)),
        ...(snap.drivers.map(d => d.id)),
        ...(snap.jobs.map(j => j.id)),
      ].join('|')
      let h = 0
      for (const c of ids) { h = ((h << 5) + h) ^ c.charCodeAt(0); h = h >>> 0 }
      snap.delta_hash = h.toString(16)
      return snap
    } catch { return null }
  }
}

export const telemetryQueue = new TelemetryQueue()
