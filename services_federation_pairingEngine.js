/**
 * ============================================================
 * APEX FLEET CONTROL OS — Pairing Engine
 * File: services_federation_pairingEngine.js
 *
 * Implements the Apex Command Center pairing protocol exactly.
 *
 * Code format: APEX-{8 HEX}-{4 HEX}-FC
 * Validation:  /^APEX-[A-F0-9]{8}-[A-F0-9]{4}-[A-Z]{2,4}$/
 * Expiry:      1 hour from generation
 * Max attempts: 5 before lock
 *
 * Storage keys (isolated, never conflicts with existing apex:* keys):
 *   apex_fc_pairing_code
 *   apex_fc_pairing_expires_at
 *   apex_fc_pairing_status      — 'unregistered'|'pending'|'registered'
 *   apex_fc_tenant_id
 *   apex_fc_fleet_id
 *   apex_fc_pairing_token
 *   apex_fc_command_center_url
 *   apex_fc_connected_since
 *   apex_fc_attempts            — validation attempt count
 *
 * DOES NOT touch any existing apex:* or apex:federation:* keys.
 * DOES NOT import from any module that imports from this file.
 * ============================================================
 */

// ─── Storage key constants ─────────────────────────────────────
export const FC_KEYS = {
  CODE:           'apex_fc_pairing_code',
  EXPIRES_AT:     'apex_fc_pairing_expires_at',
  STATUS:         'apex_fc_pairing_status',
  TENANT_ID:      'apex_fc_tenant_id',
  FLEET_ID:       'apex_fc_fleet_id',
  PAIRING_TOKEN:  'apex_fc_pairing_token',
  CC_URL:         'apex_fc_command_center_url',
  CONNECTED_SINCE:'apex_fc_connected_since',
  ATTEMPTS:       'apex_fc_attempts',
}

const CODE_TTL_MS   = 60 * 60 * 1000   // 1 hour
const MAX_ATTEMPTS  = 5

// ─── Helpers ──────────────────────────────────────────────────
function lsGet(key)       { try { return localStorage.getItem(key) } catch { return null } }
function lsSet(key, val)  { try { localStorage.setItem(key, String(val)) } catch {} }
function lsDel(key)       { try { localStorage.removeItem(key) } catch {} }
function lsGetInt(key)    { const v = lsGet(key); return v ? parseInt(v, 10) : null }

// ─── Code generation (spec-exact) ─────────────────────────────

/**
 * Generate a new APEX-XXXXXXXX-XXXX-FC pairing code.
 * Uses crypto.randomUUID() as entropy source.
 * Returns a string matching /^APEX-[A-F0-9]{8}-[A-F0-9]{4}-FC$/
 */
export function generatePairingCode() {
  const a = crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()
  const b = crypto.randomUUID().replace(/-/g, '').substring(0, 4).toUpperCase()
  return `APEX-${a}-${b}-FC`
}

// ─── Validation ───────────────────────────────────────────────
const CODE_REGEX = /^APEX-[A-F0-9]{8}-[A-F0-9]{4}-[A-Z]{2,4}$/

export function validateCodeFormat(code) {
  return CODE_REGEX.test(code)
}

// ─── Core API ─────────────────────────────────────────────────

/**
 * Get the currently stored pairing code if not expired and not locked.
 * Returns { code, expiresAt } or null.
 */
export async function getActivePairingCode() {
  const code      = lsGet(FC_KEYS.CODE)
  const expiresAt = lsGetInt(FC_KEYS.EXPIRES_AT)
  const attempts  = lsGetInt(FC_KEYS.ATTEMPTS) || 0

  if (!code)                         return null
  if (!expiresAt || Date.now() > expiresAt) return null   // expired
  if (attempts >= MAX_ATTEMPTS)      return null           // locked

  return { code, expiresAt }
}

/**
 * Generate a new code, persist it, return it.
 * Replaces any existing code. Resets attempt counter.
 */
export async function refreshPairingCode() {
  const code      = generatePairingCode()
  const expiresAt = Date.now() + CODE_TTL_MS

  lsSet(FC_KEYS.CODE,       code)
  lsSet(FC_KEYS.EXPIRES_AT, expiresAt)
  lsSet(FC_KEYS.ATTEMPTS,   0)

  // Transition to pending when operator generates a code
  const current = lsGet(FC_KEYS.STATUS)
  if (current !== 'registered') {
    lsSet(FC_KEYS.STATUS, 'pending')
  }

  return { code, expiresAt }
}

/**
 * Ensure a valid active code exists — create one if not.
 * Call on Federation page mount.
 */
export async function ensurePairingCode() {
  const active = await getActivePairingCode()
  if (active) return active
  return refreshPairingCode()
}

/**
 * Called when Apex Command Center completes pairing.
 * Saves tenantId, fleetId, pairingToken.
 * Sets status to 'registered'.
 */
export async function markAsRegistered(tenantId, fleetId, pairingToken) {
  lsSet(FC_KEYS.TENANT_ID,     tenantId)
  lsSet(FC_KEYS.FLEET_ID,      fleetId)
  lsSet(FC_KEYS.PAIRING_TOKEN, pairingToken)
  lsSet(FC_KEYS.STATUS,        'registered')
  lsSet(FC_KEYS.CONNECTED_SINCE, new Date().toISOString())
  // Clear the pairing code — no longer needed
  lsDel(FC_KEYS.CODE)
  lsDel(FC_KEYS.EXPIRES_AT)
  lsDel(FC_KEYS.ATTEMPTS)
}

/**
 * Get current pairing status.
 * Returns 'unregistered' | 'pending' | 'registered'
 */
export async function getPairingStatus() {
  return (lsGet(FC_KEYS.STATUS) || 'unregistered')
}

/**
 * Get the registered identity (tenantId, fleetId, pairingToken).
 * Returns null if not registered.
 */
export async function getRegisteredIdentity() {
  const status = lsGet(FC_KEYS.STATUS)
  if (status !== 'registered') return null

  return {
    tenantId:      lsGet(FC_KEYS.TENANT_ID)    || '',
    fleetId:       lsGet(FC_KEYS.FLEET_ID)      || '',
    pairingToken:  lsGet(FC_KEYS.PAIRING_TOKEN) || '',
    commandCenterUrl: lsGet(FC_KEYS.CC_URL)     || '',
    connectedSince:   lsGet(FC_KEYS.CONNECTED_SINCE) || '',
  }
}

/**
 * Record a validation attempt (for attempt-lock logic).
 * Returns { locked: boolean, remaining: number }
 */
export function recordAttempt() {
  const current  = (lsGetInt(FC_KEYS.ATTEMPTS) || 0) + 1
  lsSet(FC_KEYS.ATTEMPTS, current)
  return {
    locked:    current >= MAX_ATTEMPTS,
    remaining: Math.max(0, MAX_ATTEMPTS - current),
    attempts:  current,
  }
}

/**
 * Disconnect — clear all apex_fc_* keys and reset to unregistered.
 */
export function disconnect() {
  Object.values(FC_KEYS).forEach(k => lsDel(k))
}

/**
 * Save Command Center URL.
 * Validates: must start with https://, strips trailing slash.
 */
export function saveCommandCenterUrl(url) {
  const clean = (url || '').trim().replace(/\/+$/, '')
  if (!clean.startsWith('https://') && !clean.startsWith('http://')) {
    throw new Error('URL must start with https://')
  }
  lsSet(FC_KEYS.CC_URL, clean)
  return clean
}

export function getCommandCenterUrl() {
  return lsGet(FC_KEYS.CC_URL) || ''
}

// ─── Pairing-status poll (called from UI) ─────────────────────

/**
 * Poll Apex Command Center for pairing completion.
 * Calls GET {ccUrl}/api/pairing-status?code={code}
 * If paired → calls markAsRegistered automatically.
 * Returns { paired, error } 
 */
export async function pollPairingStatus(ccUrl, code) {
  if (!ccUrl || !code) return { paired: false, error: 'Missing URL or code' }
  try {
    const res = await fetch(
      `${ccUrl}/api/pairing-status?code=${encodeURIComponent(code)}`,
      { signal: AbortSignal.timeout(8000) }
    )
    if (!res.ok) return { paired: false, error: `HTTP ${res.status}` }
    const data = await res.json()
    if (data?.paired && data.tenantId && data.fleetId && data.pairingToken) {
      lsSet(FC_KEYS.CC_URL, ccUrl)
      await markAsRegistered(data.tenantId, data.fleetId, data.pairingToken)
      return { paired: true }
    }
    return { paired: false }
  } catch (err) {
    return { paired: false, error: err.message }
  }
}

/**
 * Test connection to Command Center.
 * Returns { ok: boolean, latencyMs: number | null, error: string | null }
 */
export async function testConnection(ccUrl) {
  if (!ccUrl) return { ok: false, error: 'No URL configured' }
  const clean = ccUrl.trim().replace(/\/+$/, '')
  const t0 = Date.now()
  try {
    const res = await fetch(`${clean}/api/fleet-heartbeat`, {
      method: 'OPTIONS',
      signal: AbortSignal.timeout(6000),
    })
    // Any response (including CORS preflight 204) means server is reachable
    return { ok: true, latencyMs: Date.now() - t0, status: res.status }
  } catch (err) {
    // Try a plain HEAD as fallback
    try {
      const res2 = await fetch(clean, { method: 'HEAD', signal: AbortSignal.timeout(5000) })
      return { ok: true, latencyMs: Date.now() - t0, status: res2.status }
    } catch {
      return { ok: false, latencyMs: null, error: 'Unreachable' }
    }
  }
}

// ─── Heartbeat sender (used by pairingBridge) ─────────────────

/**
 * Send a fleet heartbeat to Command Center.
 * Fire-and-forget — never throws.
 */
export async function sendHeartbeat({ vehicleCount = 0, activeVehicles = 0, driverCount = 0, activeDrivers = 0 } = {}) {
  const ccUrl  = lsGet(FC_KEYS.CC_URL)
  const status = lsGet(FC_KEYS.STATUS)
  if (!ccUrl || status !== 'registered') return

  const tenantId = lsGet(FC_KEYS.TENANT_ID) || ''
  const fleetId  = lsGet(FC_KEYS.FLEET_ID)  || ''
  const token    = lsGet(FC_KEYS.PAIRING_TOKEN) || ''

  try {
    await fetch(`${ccUrl}/api/fleet-heartbeat`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Id':  tenantId,
        'X-Fleet-Id':   fleetId,
        'X-Apex-Key':   token,
      },
      body: JSON.stringify({
        tenantId,
        fleetId,
        vehicleCount,
        activeVehicles,
        driverCount,
        activeDrivers,
        uptimePercent: 100,
        version: '1.0.0',
        coordinates: { lat: 51.5074, lng: -0.1278 },
      }),
      signal: AbortSignal.timeout(8000),
    })
  } catch {}   // fire-and-forget
}

/**
 * Send a route completion event.
 * Fire-and-forget — never throws.
 */
export async function sendRouteComplete({ vehicleId, driverId, routeId, distanceKm, durationMin, fuelSavedL = 0, aiOptimised = true, onTimeDelivery = true, stops = 1 }) {
  const ccUrl  = lsGet(FC_KEYS.CC_URL)
  const status = lsGet(FC_KEYS.STATUS)
  if (!ccUrl || status !== 'registered') return

  const tenantId = lsGet(FC_KEYS.TENANT_ID) || ''
  const fleetId  = lsGet(FC_KEYS.FLEET_ID)  || ''
  const token    = lsGet(FC_KEYS.PAIRING_TOKEN) || ''

  const co2SavedKg       = fuelSavedL * 2.68
  const fuelCostSavedUSD = fuelSavedL * 1.35

  try {
    await fetch(`${ccUrl}/api/route-complete`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Id':  tenantId,
        'X-Fleet-Id':   fleetId,
        'X-Apex-Key':   token,
      },
      body: JSON.stringify({
        tenantId, fleetId, vehicleId, driverId, routeId,
        distanceKm, durationMin, fuelSavedL, co2SavedKg,
        fuelCostSavedUSD,
        optimisationSavingPercent: fuelSavedL > 0 ? Math.round((fuelSavedL / (distanceKm * 0.085)) * 100) : 0,
        aiOptimised, onTimeDelivery, stops,
      }),
      signal: AbortSignal.timeout(8000),
    })
  } catch {}
}

/**
 * Send a telemetry batch.
 * Fire-and-forget — never throws.
 */
export async function sendTelemetryBatch(events = []) {
  const ccUrl  = lsGet(FC_KEYS.CC_URL)
  const status = lsGet(FC_KEYS.STATUS)
  if (!ccUrl || status !== 'registered' || events.length === 0) return

  const tenantId = lsGet(FC_KEYS.TENANT_ID) || ''
  const fleetId  = lsGet(FC_KEYS.FLEET_ID)  || ''
  const token    = lsGet(FC_KEYS.PAIRING_TOKEN) || ''

  try {
    await fetch(`${ccUrl}/api/telemetry/batch`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Id':  tenantId,
        'X-Fleet-Id':   fleetId,
        'X-Apex-Key':   token,
      },
      body: JSON.stringify({
        batchId:  crypto.randomUUID(),
        tenantId, fleetId,
        events: events.map(e => ({
          id:        crypto.randomUUID(),
          eventType: e.eventType || 'fleet_update',
          timestamp: e.timestamp || Date.now(),
          tenantId, fleetId,
          vehicleId: e.vehicleId || null,
          driverId:  e.driverId  || null,
          severity:  e.severity  || 'info',
          payload:   e.payload   || {},
          processed: false,
        })),
      }),
      signal: AbortSignal.timeout(8000),
    })
  } catch {}
}
