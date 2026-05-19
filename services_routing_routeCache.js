/**
 * ============================================================
 * APEX AI — Route Cache (IndexedDB + localStorage fallback)
 *
 * Caches computed routes by OD pair key.
 * Indexed by tenant — no cross-tenant cache contamination.
 * TTL: 6 hours for traffic-sensitive routes, 24h for others.
 * Max entries: 500 (LRU eviction)
 * ============================================================
 */

import { tenantRegistry } from './services_federation_tenantRegistry'

const CACHE_TTL_MS   = 6 * 60 * 60 * 1000    // 6h — routing can change with traffic
const CACHE_TTL_LONG = 24 * 60 * 60 * 1000   // 24h — static routes
const MAX_ENTRIES    = 500
const LS_KEY_PREFIX  = 'apex:rcache'

class RouteCache {
  constructor() {
    this._idb  = null
    this._ls   = null
    this._ready = this._init()
  }

  async _init() {
    const tid    = tenantRegistry.getTenantId()
    const dbName = `apex-routes-${tid}`
    this._lsKey  = `${LS_KEY_PREFIX}:${tid}`

    if (!window.indexedDB) { this._ls = true; return }

    return new Promise((resolve) => {
      const req = indexedDB.open(dbName, 1)
      req.onupgradeneeded = (e) => {
        const db    = e.target.result
        if (!db.objectStoreNames.contains('routes')) {
          const s = db.createObjectStore('routes', { keyPath: 'od_key' })
          s.createIndex('accessed_at', 'accessed_at', { unique: false })
          s.createIndex('expires_at',  'expires_at',  { unique: false })
        }
      }
      req.onsuccess  = (e) => { this._idb = e.target.result; resolve() }
      req.onerror    = ()  => { this._ls = true; resolve() }
    })
  }

  async get(odKey) {
    await this._ready
    const entry = this._idb ? await this._idbGet(odKey) : this._lsGet(odKey)
    if (!entry) return null
    if (entry.expires_at < Date.now()) {
      await this.delete(odKey)
      return null
    }
    // Update access time (LRU)
    if (this._idb) this._idbTouch(odKey)
    return entry.route
  }

  async set(odKey, route, longTTL = false) {
    await this._ready
    const entry = {
      od_key:      odKey,
      route,
      created_at:  Date.now(),
      accessed_at: Date.now(),
      expires_at:  Date.now() + (longTTL ? CACHE_TTL_LONG : CACHE_TTL_MS),
      tenant_id:   tenantRegistry.getTenantId(),
    }
    if (this._idb) await this._idbSet(entry)
    else this._lsSet(odKey, entry)
  }

  async delete(odKey) {
    await this._ready
    if (this._idb) {
      const tx = this._idb.transaction('routes', 'readwrite')
      tx.objectStore('routes').delete(odKey)
    } else {
      const m = this._lsMap()
      delete m[odKey]
      this._lsWriteMap(m)
    }
  }

  async count() {
    await this._ready
    if (this._idb) {
      return new Promise((resolve) => {
        const tx  = this._idb.transaction('routes', 'readonly')
        const req = tx.objectStore('routes').count()
        req.onsuccess = () => resolve(req.result)
        req.onerror   = () => resolve(0)
      })
    }
    return Object.keys(this._lsMap()).length
  }

  // ── IDB helpers ──────────────────────────────────────────────
  async _idbGet(key) {
    return new Promise((resolve) => {
      const tx  = this._idb.transaction('routes', 'readonly')
      const req = tx.objectStore('routes').get(key)
      req.onsuccess = () => resolve(req.result || null)
      req.onerror   = () => resolve(null)
    })
  }
  async _idbSet(entry) {
    return new Promise((resolve) => {
      const tx = this._idb.transaction('routes', 'readwrite')
      tx.objectStore('routes').put(entry)
      tx.oncomplete = resolve
      tx.onerror    = resolve
    })
  }
  _idbTouch(key) {
    try {
      const tx  = this._idb.transaction('routes', 'readwrite')
      const req = tx.objectStore('routes').get(key)
      req.onsuccess = (e) => {
        if (e.target.result) tx.objectStore('routes').put({ ...e.target.result, accessed_at: Date.now() })
      }
    } catch {}
  }

  // ── localStorage helpers ────────────────────────────────────
  _lsMap()          { try { return JSON.parse(localStorage.getItem(this._lsKey) || '{}') } catch { return {} } }
  _lsWriteMap(m)    { try { localStorage.setItem(this._lsKey, JSON.stringify(m)) } catch {} }
  _lsGet(key)       { return this._lsMap()[key] || null }
  _lsSet(key, entry) {
    const m = this._lsMap()
    m[key]  = entry
    // LRU eviction
    const keys = Object.keys(m)
    if (keys.length > MAX_ENTRIES) delete m[keys[0]]
    this._lsWriteMap(m)
  }
}

export const routeCache = new RouteCache()
