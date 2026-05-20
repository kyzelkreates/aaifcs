/**
 * ============================================================
 * APEX AI — Command Center Client
 * Pushes data to the Apex Control Center OS via HTTP.
 *
 * DESIGN RULES (safe integration):
 *  ✅ Zero coupling — never imported by any existing service.
 *     Existing services are unchanged. This file is imported
 *     ONLY by apexBridge.js which hooks into events.
 *  ✅ Never throws — every call is fire-and-forget with try/catch.
 *     A dead/unconfigured Apex endpoint can never break the app.
 *  ✅ Config is runtime (localStorage) — no build-time secrets.
 *     Operators enter credentials in Settings → no redeploy needed.
 *  ✅ Offline queue — failed payloads are queued in localStorage
 *     and retried with exponential backoff on reconnect.
 *  ✅ Rate-safe — heartbeat is throttled to max 1/30s,
 *     telemetry batch flushes at most 1/60s or at 50 events.
 * ============================================================
 */

// ─── Config keys (localStorage) ──────────────────────────────
const LS = {
  BASE_URL:  'apex:cc:baseUrl',      // https://apexcontrolos.vercel.app
  API_KEY:   'apex:cc:apiKey',       // axk_xxxxxxxxxxxxxxxx
  TENANT_ID: 'apex:cc:tenantId',     // ten_xxxxxxxxxxxxxxxx
  FLEET_ID:  'apex:cc:fleetId',      // flt_xxxxxxxxxxxxxxxx
  QUEUE:     'apex:cc:queue',        // offline retry queue (JSON array)
  ENABLED:   'apex:cc:enabled',      // 'true' | 'false'
}

// ─── Read config at call time (always fresh from localStorage) ─
function cfg() {
  return {
    baseUrl:  localStorage.getItem(LS.BASE_URL)  || '',
    apiKey:   localStorage.getItem(LS.API_KEY)   || '',
    tenantId: localStorage.getItem(LS.TENANT_ID) || '',
    fleetId:  localStorage.getItem(LS.FLEET_ID)  || '',
    enabled:  localStorage.getItem(LS.ENABLED)   !== 'false', // default on
  }
}

function isConfigured(c) {
  return !!(c.baseUrl && c.apiKey && c.tenantId && c.fleetId)
}

function headers(c) {
  return {
    'Content-Type': 'application/json',
    'X-Apex-Key':   c.apiKey,
    'X-Tenant-Id':  c.tenantId,
    'X-Fleet-Id':   c.fleetId,
  }
}

// ─── Offline queue ────────────────────────────────────────────
function readQueue() {
  try { return JSON.parse(localStorage.getItem(LS.QUEUE) || '[]') } catch { return [] }
}
function writeQueue(q) {
  try { localStorage.setItem(LS.QUEUE, JSON.stringify(q.slice(-200))) } catch {}  // cap at 200
}
function enqueue(path, body) {
  const q = readQueue()
  q.push({ path, body, ts: Date.now(), retries: 0 })
  writeQueue(q)
}

// ─── Core POST helper with retry queue ───────────────────────
async function post(path, body, retryOnFail = true) {
  const c = cfg()
  if (!c.enabled || !isConfigured(c)) return null

  try {
    const res = await fetch(`${c.baseUrl}${path}`, {
      method: 'POST',
      headers: headers(c),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    })
    if (res.ok) return res.json().catch(() => ({}))
    // 4xx = don't queue (caller error), 5xx = queue for retry
    if (retryOnFail && res.status >= 500) {
      enqueue(path, body)
    }
    return null
  } catch {
    // Network error → queue
    if (retryOnFail) enqueue(path, body)
    return null
  }
}

// ─── Retry queued payloads (called on reconnect + app init) ──
let _retrying = false
async function flushQueue() {
  if (_retrying) return
  _retrying = true
  const c = cfg()
  if (!isConfigured(c)) { _retrying = false; return }

  const q = readQueue()
  if (q.length === 0) { _retrying = false; return }

  const remaining = []
  for (const item of q) {
    if (item.retries >= 5) continue           // drop after 5 attempts
    try {
      const res = await fetch(`${c.baseUrl}${item.path}`, {
        method: 'POST',
        headers: headers(c),
        body: JSON.stringify(item.body),
        signal: AbortSignal.timeout(6000),
      })
      if (!res.ok && res.status >= 500) {
        remaining.push({ ...item, retries: item.retries + 1 })
      }
      // 2xx → drop from queue (success)
    } catch {
      remaining.push({ ...item, retries: item.retries + 1 })
    }
    await new Promise(r => setTimeout(r, 500)) // gentle pacing
  }
  writeQueue(remaining)
  _retrying = false
}

// ─── Heartbeat (throttled — max 1 per 30s) ───────────────────
let _lastHeartbeat = 0
let _hbInterval   = null

function buildHeartbeatPayload(extra = {}) {
  const c = cfg()
  return {
    tenantId:       c.tenantId,
    fleetId:        c.fleetId,
    timestamp:      Date.now(),
    version:        '2.4.1',
    status:         navigator.onLine ? 'online' : 'degraded',
    region:         'EU',
    ...extra,
  }
}

// ─── Telemetry batch buffer ───────────────────────────────────
const _eventBuffer = []
let   _batchTimer  = null

function bufferEvent(evt) {
  _eventBuffer.push({ ...evt, timestamp: evt.timestamp || Date.now() })
  if (_eventBuffer.length >= 50) flushBatch()  // flush early at 50 events
}

function flushBatch() {
  if (_eventBuffer.length === 0) return
  const events = _eventBuffer.splice(0)         // drain buffer
  const c = cfg()
  if (!isConfigured(c)) return
  const payload = {
    batchId:  `bat_${Date.now()}`,
    tenantId: c.tenantId,
    fleetId:  c.fleetId,
    events,
  }
  post('/api/telemetry/batch', payload)
}

// ─── Public API ───────────────────────────────────────────────
export const apexClient = {

  // ── Configuration helpers ─────────────────────────────────
  getConfig:     cfg,
  isConfigured:  () => isConfigured(cfg()),
  CONFIG_KEYS:   LS,

  saveConfig({ baseUrl, apiKey, tenantId, fleetId }) {
    if (baseUrl  !== undefined) localStorage.setItem(LS.BASE_URL,  baseUrl.trim())
    if (apiKey   !== undefined) localStorage.setItem(LS.API_KEY,   apiKey.trim())
    if (tenantId !== undefined) localStorage.setItem(LS.TENANT_ID, tenantId.trim())
    if (fleetId  !== undefined) localStorage.setItem(LS.FLEET_ID,  fleetId.trim())
  },

  setEnabled(v) { localStorage.setItem(LS.ENABLED, v ? 'true' : 'false') },

  // ── 1. Fleet Heartbeat ────────────────────────────────────
  heartbeat(extra = {}) {
    const now = Date.now()
    if (now - _lastHeartbeat < 30_000) return   // throttle
    _lastHeartbeat = now
    return post('/api/fleet-heartbeat', buildHeartbeatPayload(extra))
  },

  // Start automatic heartbeat every 60s
  startHeartbeat(getExtra = () => ({})) {
    if (_hbInterval) clearInterval(_hbInterval)
    // Fire once immediately
    post('/api/fleet-heartbeat', buildHeartbeatPayload(getExtra()))
    _lastHeartbeat = Date.now()
    _hbInterval = setInterval(() => {
      post('/api/fleet-heartbeat', buildHeartbeatPayload(getExtra()))
      _lastHeartbeat = Date.now()
      flushQueue()  // attempt retry on each heartbeat cycle
    }, 60_000)
    return () => { clearInterval(_hbInterval); _hbInterval = null }
  },

  stopHeartbeat() { clearInterval(_hbInterval); _hbInterval = null },

  // ── 2. Route Complete ─────────────────────────────────────
  routeComplete({
    vehicleId, driverId, routeId,
    distanceKm, durationMin, stops,
    fuelSavedL = 0, co2SavedKg, fuelCostSavedUSD,
    optimisationSavingPercent = 0,
    aiOptimised = false,
    onTimeDelivery = true,
  }) {
    const c = cfg()
    const payload = {
      tenantId:                  c.tenantId,
      fleetId:                   c.fleetId,
      vehicleId:                 vehicleId  || 'unknown',
      driverId:                  driverId   || 'unknown',
      routeId:                   routeId    || `rte_${Date.now()}`,
      distanceKm:                Math.round((distanceKm || 0) * 10) / 10,
      durationMin:               Math.round(durationMin || 0),
      stops:                     stops      || 1,
      fuelSavedL:                Math.round((fuelSavedL || 0) * 10) / 10,
      co2SavedKg:                co2SavedKg  ?? Math.round(fuelSavedL * 2.68 * 10) / 10,
      fuelCostSavedUSD:          fuelCostSavedUSD ?? Math.round(fuelSavedL * 1.35 * 100) / 100,
      optimisationSavingPercent: Math.round(optimisationSavingPercent * 10) / 10,
      aiOptimised,
      onTimeDelivery,
    }
    return post('/api/route-complete', payload, true)  // critical — always queue
  },

  // ── 3. Telemetry events (buffered, auto-flushed) ──────────
  pushEvent(type, data) {
    bufferEvent({ type, ...data })
  },

  pushVehicleStatus({ vehicleId, driverId, speed, lat, lng, status, fuel, battery }) {
    bufferEvent({
      type:      'vehicle_status',
      vehicleId: vehicleId || 'unknown',
      driverId:  driverId  || 'unknown',
      data:      { speed, lat, lng, status: status || 'en_route', fuel: fuel ?? null, battery: battery ?? null },
    })
  },

  pushDriverLogin(driverId, vehicleId, shiftId) {
    bufferEvent({ type: 'driver_login', vehicleId, driverId, data: { shiftId: shiftId || `shift_${Date.now()}` } })
  },

  pushDriverLogout(driverId, vehicleId, shiftId, totalKm) {
    bufferEvent({ type: 'driver_logout', vehicleId, driverId, data: { shiftId, totalKm: totalKm || 0 } })
  },

  pushRouteStarted(routeId, driverId, vehicleId, stops) {
    bufferEvent({ type: 'route_started', vehicleId, driverId, data: { routeId, stops: stops || 1 } })
  },

  pushAlert(alertType, severity, message, vehicleId) {
    bufferEvent({ type: 'alert_triggered', vehicleId: vehicleId || 'unknown', data: { alertType, severity, message } })
  },

  pushIdleDetected(vehicleId, idleMin) {
    bufferEvent({ type: 'idle_detected', vehicleId, data: { idleMin } })
  },

  // Manually flush (for test / settings page)
  flushBatch,
  flushQueue,
  getQueueLength: () => readQueue().length,

  // Start automatic 60s batch timer
  startBatchTimer() {
    if (_batchTimer) clearInterval(_batchTimer)
    _batchTimer = setInterval(flushBatch, 60_000)
    return () => { clearInterval(_batchTimer); _batchTimer = null }
  },
  stopBatchTimer() { clearInterval(_batchTimer); _batchTimer = null },
}

export default apexClient
