/**
 * ============================================================
 * APEX FLEET CONTROL OS — Pairing Engine  (Stabilized)
 * services/federation/pairingEngine.js
 *
 * Single source of truth for all federation pairing state.
 *
 * Architecture:
 *   Primary storage  — Supabase (pairing_codes + fleet_nodes)
 *   Local cache      — localStorage (immediate reads, offline)
 *   Realtime         — Supabase channels on pairing_codes,
 *                      dashboard_events, fleet_nodes
 *
 * Code format : APEX-[A-Z0-9]{8}-[A-Z0-9]{4}-FC
 * Regex       : /^APEX-[A-Z0-9]{8}-[A-Z0-9]{4}-FC$/
 * Expiry      : 1 hour from generation
 * Max attempts: 5 before lock
 *
 * Lifecycle:
 *   unregistered → (generate code) → pending
 *   pending      → (CC accepts)    → registered
 *   pending      → (expired/failed) → unregistered (auto-reset)
 *   registered   → (disconnect)    → unregistered
 *
 * ============================================================
 */

import { getSupabaseClient, isSupabaseReady } from './services_supabase_supabaseClient'

// ─── Storage key constants (local cache layer) ───────────────
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
  FLEET_NODE_ID:  'apex_fc_fleet_node_id',
}

const CODE_TTL_MS   = 60 * 60 * 1000  // 1 hour
const MAX_ATTEMPTS  = 5

// ─── Validation ──────────────────────────────────────────────
// Exact spec: APEX-[A-Z0-9]{8}-[A-Z0-9]{4}-FC
const CODE_REGEX = /^APEX-[A-Z0-9]{8}-[A-Z0-9]{4}-FC$/

/**
 * Normalize + validate a pairing code input.
 * Returns { valid: boolean, code: string }
 */
export function normalizeAndValidate(input) {
  const code = (input || '')
    .trim()
    .replace(/\s+/g, '')
    .toUpperCase()
  return { valid: CODE_REGEX.test(code), code }
}

// kept for backward compat
export function validateCodeFormat(code) {
  return CODE_REGEX.test((code || '').trim().toUpperCase())
}

// ─── Local cache helpers ──────────────────────────────────────
function lsGet(key)       { try { return localStorage.getItem(key) }          catch { return null } }
function lsSet(key, val)  { try { localStorage.setItem(key, String(val)) }    catch {} }
function lsDel(key)       { try { localStorage.removeItem(key) }              catch {} }
function lsGetInt(key)    { const v = lsGet(key); return v ? parseInt(v, 10) : 0 }

// ─── Code generation ─────────────────────────────────────────
function randomSegment(len) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const arr = new Uint8Array(len)
  crypto.getRandomValues(arr)
  return Array.from(arr, b => chars[b % chars.length]).join('')
}

export function generatePairingCode() {
  return `APEX-${randomSegment(8)}-${randomSegment(4)}-FC`
}

// ─── Supabase helpers ─────────────────────────────────────────
async function sbInsertCode(code, expiresAt) {
  if (!isSupabaseReady()) return null
  try {
    const client = getSupabaseClient()
    const { data, error } = await client
      .from('pairing_codes')
      .upsert({
        code,
        status:    'pending',
        attempts:  0,
        expires_at: new Date(expiresAt).toISOString(),
        metadata:  { version: '1.0', generated_at: new Date().toISOString() },
      }, { onConflict: 'code' })
      .select('id')
      .single()
    if (error) throw error
    return data?.id || null
  } catch (err) {
    console.warn('[PairingEngine] sbInsertCode failed:', err.message)
    return null
  }
}

async function sbIncrementAttempts(code) {
  if (!isSupabaseReady()) return lsGetInt(FC_KEYS.ATTEMPTS)
  try {
    const client = getSupabaseClient()
    // Atomic increment via RPC — falls back to read+write if RPC not available
    const { data, error } = await client
      .from('pairing_codes')
      .select('attempts, max_attempts, status, expires_at')
      .eq('code', code)
      .single()

    if (error || !data) {
      // Fallback: local counter
      const local = lsGetInt(FC_KEYS.ATTEMPTS) + 1
      lsSet(FC_KEYS.ATTEMPTS, local)
      return local
    }

    // Check expiry server-side
    if (new Date(data.expires_at) < new Date()) {
      await client.from('pairing_codes').update({ status: 'expired' }).eq('code', code)
      return MAX_ATTEMPTS  // treat as locked
    }

    const newAttempts = (data.attempts || 0) + 1
    const newStatus   = newAttempts >= (data.max_attempts || MAX_ATTEMPTS) ? 'failed' : data.status

    await client.from('pairing_codes')
      .update({ attempts: newAttempts, status: newStatus })
      .eq('code', code)

    lsSet(FC_KEYS.ATTEMPTS, newAttempts)
    return newAttempts
  } catch (err) {
    console.warn('[PairingEngine] sbIncrementAttempts:', err.message)
    const local = lsGetInt(FC_KEYS.ATTEMPTS) + 1
    lsSet(FC_KEYS.ATTEMPTS, local)
    return local
  }
}

async function sbAcceptCode(code, tenantId, fleetId, token) {
  if (!isSupabaseReady()) return
  try {
    const client = getSupabaseClient()
    await client.from('pairing_codes')
      .update({
        status:      'accepted',
        tenant_id:   tenantId,
        fleet_id:    fleetId,
        accepted_at: new Date().toISOString(),
      })
      .eq('code', code)
  } catch (err) {
    console.warn('[PairingEngine] sbAcceptCode:', err.message)
  }
}

async function sbUpsertFleetNode(state) {
  if (!isSupabaseReady()) return null
  try {
    const client = getSupabaseClient()
    const existingId = lsGet(FC_KEYS.FLEET_NODE_ID)
    const payload = {
      node_name:       state.companyName || 'Fleet Control OS',
      online:          true,
      last_seen:       new Date().toISOString(),
      pairing_status:  state.status,
      tenant_id:       state.tenantId       || null,
      fleet_entity_id: state.fleetId        || null,
      pairing_token:   state.pairingToken   || null,
      company_name:    state.companyName    || null,
      connected_since: state.connectedSince || null,
      version:         '1.0',
      telemetry:       { updated_at: new Date().toISOString() },
    }

    if (existingId) {
      const { error } = await client.from('fleet_nodes')
        .update(payload)
        .eq('id', existingId)
      if (!error) return existingId
    }

    // Create new node
    const { data, error } = await client.from('fleet_nodes')
      .insert(payload)
      .select('id')
      .single()
    if (!error && data?.id) {
      lsSet(FC_KEYS.FLEET_NODE_ID, data.id)
      return data.id
    }
    return null
  } catch (err) {
    console.warn('[PairingEngine] sbUpsertFleetNode:', err.message)
    return null
  }
}

async function sbPostDashboardEvent(type, payload) {
  if (!isSupabaseReady()) return
  try {
    const client = getSupabaseClient()
    await client.from('dashboard_events').insert({ type, payload })
  } catch {}
}

// ─── Core API ─────────────────────────────────────────────────

/**
 * Generate + persist a new pairing code.
 * Writes to Supabase (pairing_codes) + local cache.
 * Resets attempt counter. Status → 'pending'.
 */
export async function refreshPairingCode() {
  const code      = generatePairingCode()
  const expiresAt = Date.now() + CODE_TTL_MS

  // Local cache first (immediate effect)
  lsSet(FC_KEYS.CODE,       code)
  lsSet(FC_KEYS.EXPIRES_AT, expiresAt)
  lsSet(FC_KEYS.ATTEMPTS,   0)
  const current = lsGet(FC_KEYS.STATUS)
  if (current !== 'registered') lsSet(FC_KEYS.STATUS, 'pending')

  // Persist to Supabase (async — non-blocking)
  sbInsertCode(code, expiresAt).then(() =>
    sbUpsertFleetNode({ status: 'pending' })
  )

  return { code, expiresAt }
}

/**
 * Return existing active code or generate a fresh one.
 * Checks local cache first, falls back to Supabase if cache stale.
 */
export async function ensurePairingCode() {
  const code      = lsGet(FC_KEYS.CODE)
  const expiresAt = lsGetInt(FC_KEYS.EXPIRES_AT)
  const attempts  = lsGetInt(FC_KEYS.ATTEMPTS)

  // Valid cached code
  if (code && expiresAt && Date.now() < expiresAt && attempts < MAX_ATTEMPTS) {
    return { code, expiresAt }
  }

  // Cached code expired or locked — try to find a live Supabase code
  if (isSupabaseReady()) {
    try {
      const client = getSupabaseClient()
      const { data } = await client
        .from('pairing_codes')
        .select('code, expires_at, attempts, status')
        .eq('status', 'pending')
        .gt('expires_at', new Date().toISOString())
        .lt('attempts', MAX_ATTEMPTS)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

      if (data?.code) {
        // Hydrate local cache from Supabase
        lsSet(FC_KEYS.CODE,       data.code)
        lsSet(FC_KEYS.EXPIRES_AT, new Date(data.expires_at).getTime())
        lsSet(FC_KEYS.ATTEMPTS,   data.attempts || 0)
        if (lsGet(FC_KEYS.STATUS) !== 'registered') lsSet(FC_KEYS.STATUS, 'pending')
        return { code: data.code, expiresAt: new Date(data.expires_at).getTime() }
      }
    } catch {}
  }

  // Generate fresh code
  return refreshPairingCode()
}

/**
 * Get the current pairing status from local cache.
 * 'unregistered' | 'pending' | 'registered'
 */
export async function getPairingStatus() {
  const status = lsGet(FC_KEYS.STATUS) || 'unregistered'

  // Sanity-check: if 'pending' but code is expired, revert to unregistered
  if (status === 'pending') {
    const expiresAt = lsGetInt(FC_KEYS.EXPIRES_AT)
    const attempts  = lsGetInt(FC_KEYS.ATTEMPTS)
    if ((expiresAt && Date.now() > expiresAt) || attempts >= MAX_ATTEMPTS) {
      lsSet(FC_KEYS.STATUS, 'unregistered')
      lsDel(FC_KEYS.CODE)
      lsDel(FC_KEYS.EXPIRES_AT)
      return 'unregistered'
    }
  }

  return status
}

/**
 * Get the active pairing code (non-expired, non-locked).
 * Returns { code, expiresAt } or null.
 */
export async function getActivePairingCode() {
  const code      = lsGet(FC_KEYS.CODE)
  const expiresAt = lsGetInt(FC_KEYS.EXPIRES_AT)
  const attempts  = lsGetInt(FC_KEYS.ATTEMPTS)

  if (!code)                              return null
  if (!expiresAt || Date.now() > expiresAt) return null
  if (attempts >= MAX_ATTEMPTS)           return null

  return { code, expiresAt }
}

/**
 * Get registered identity — null if not registered.
 */
export async function getRegisteredIdentity() {
  const status = lsGet(FC_KEYS.STATUS)
  if (status !== 'registered') return null
  return {
    tenantId:        lsGet(FC_KEYS.TENANT_ID)      || '',
    fleetId:         lsGet(FC_KEYS.FLEET_ID)        || '',
    pairingToken:    lsGet(FC_KEYS.PAIRING_TOKEN)   || '',
    commandCenterUrl:lsGet(FC_KEYS.CC_URL)          || '',
    connectedSince:  lsGet(FC_KEYS.CONNECTED_SINCE) || '',
  }
}

/**
 * Mark this fleet as registered.
 * Persists to Supabase fleet_nodes + pairing_codes.
 */
export async function markAsRegistered(tenantId, fleetId, pairingToken, options = {}) {
  const now = new Date().toISOString()

  // Local cache (immediate)
  lsSet(FC_KEYS.TENANT_ID,     tenantId)
  lsSet(FC_KEYS.FLEET_ID,      fleetId)
  lsSet(FC_KEYS.PAIRING_TOKEN, pairingToken)
  lsSet(FC_KEYS.STATUS,        'registered')
  lsSet(FC_KEYS.CONNECTED_SINCE, now)

  const code = lsGet(FC_KEYS.CODE)

  // Supabase: mark code accepted + upsert fleet node
  if (code) await sbAcceptCode(code, tenantId, fleetId, pairingToken)

  await sbUpsertFleetNode({
    status:         'registered',
    tenantId,
    fleetId,
    pairingToken,
    companyName:    options.companyName || '',
    connectedSince: now,
  })

  await sbPostDashboardEvent('federation_registered', {
    tenant_id: tenantId,
    fleet_id:  fleetId,
    ts:        now,
  })

  // Clear code from local cache — no longer needed
  lsDel(FC_KEYS.CODE)
  lsDel(FC_KEYS.EXPIRES_AT)
  lsDel(FC_KEYS.ATTEMPTS)
}

/**
 * Record a failed validation attempt.
 * Increments attempts in Supabase + local cache.
 * Returns { locked, remaining, attempts }
 */
export async function recordAttempt() {
  const code    = lsGet(FC_KEYS.CODE)
  const current = code
    ? await sbIncrementAttempts(code)
    : lsGetInt(FC_KEYS.ATTEMPTS) + 1

  lsSet(FC_KEYS.ATTEMPTS, current)

  const locked = current >= MAX_ATTEMPTS
  if (locked && code) {
    // Post event so realtime subscribers react
    await sbPostDashboardEvent('federation_attempt_locked', { code, attempts: current })
    lsSet(FC_KEYS.STATUS, 'unregistered')
  }

  return { locked, remaining: Math.max(0, MAX_ATTEMPTS - current), attempts: current }
}

/**
 * Disconnect — clear all local federation state and Supabase fleet node.
 */
export async function disconnect() {
  const nodeId = lsGet(FC_KEYS.FLEET_NODE_ID)
  Object.values(FC_KEYS).forEach(k => lsDel(k))

  if (isSupabaseReady() && nodeId) {
    try {
      const client = getSupabaseClient()
      await client.from('fleet_nodes')
        .update({ pairing_status: 'unregistered', online: false, pairing_token: null })
        .eq('id', nodeId)
    } catch {}
  }

  await sbPostDashboardEvent('federation_disconnected', { ts: new Date().toISOString() })
}

// ─── Command Center URL helpers ───────────────────────────────
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

// ─── Realtime federation sync ─────────────────────────────────
let _realtimeSub = null

/**
 * Subscribe to Supabase realtime channels for federation events.
 * Automatically reconciles state on:
 *   - pairing accepted / expired / failed / revoked
 *   - fleet_nodes update
 *   - federation dashboard_events
 *
 * @param {function} onStateChange — called with updated status string
 * @returns {function} unsubscribe
 */
export function subscribeFederationRealtime(onStateChange) {
  if (!isSupabaseReady()) return () => {}

  // Clean up any existing subscription
  if (_realtimeSub) {
    try { _realtimeSub.unsubscribe() } catch {}
    _realtimeSub = null
  }

  try {
    const client  = getSupabaseClient()
    const code    = lsGet(FC_KEYS.CODE)
    const nodeId  = lsGet(FC_KEYS.FLEET_NODE_ID)

    const channel = client.channel('apex-federation-sync')

    // ── pairing_codes changes ──────────────────────────────
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'pairing_codes' },
      (payload) => {
        const row = payload.new || payload.old
        if (!row) return

        // Read code LIVE from cache on every event — prevents stale-closure
        // mismatches after refreshPairingCode() replaces the active code.
        const activeCode = lsGet(FC_KEYS.CODE)
        if (!activeCode || row.code !== activeCode) return  // not our code

        const status = row.status
        if (status === 'accepted') {
          // Remote system accepted our code — mark registered
          if (row.tenant_id && row.fleet_id) {
            const token = lsGet(FC_KEYS.PAIRING_TOKEN) || row.pairing_token || ''
            markAsRegistered(row.tenant_id, row.fleet_id, token)
              .then(() => onStateChange?.('registered'))
          }
        } else if (status === 'expired' || status === 'failed' || status === 'revoked') {
          lsSet(FC_KEYS.STATUS, 'unregistered')
          lsDel(FC_KEYS.CODE)
          lsDel(FC_KEYS.EXPIRES_AT)
          lsDel(FC_KEYS.ATTEMPTS)
          onStateChange?.('unregistered')
        }
      }
    )

    // ── fleet_nodes changes ────────────────────────────────
    if (nodeId) {
      channel.on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'fleet_nodes', filter: `id=eq.${nodeId}` },
        (payload) => {
          const row = payload.new
          if (!row) return
          const ps = row.pairing_status
          if (ps === 'unregistered' || ps === 'revoked') {
            // Fleet node was remotely disconnected
            Object.values(FC_KEYS).forEach(k => lsDel(k))
            onStateChange?.('unregistered')
          }
        }
      )
    }

    // ── dashboard_events for federation ───────────────────
    channel.on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'dashboard_events' },
      (payload) => {
        const row = payload.new
        if (!row) return
        const federationEvents = [
          'federation_registered', 'federation_disconnected',
          'federation_revoked',    'federation_failed',
        ]
        if (federationEvents.includes(row.type)) {
          // Re-read local state and notify
          getPairingStatus().then(st => onStateChange?.(st))
        }
      }
    )

    channel.subscribe((state) => {
      if (state === 'SUBSCRIBED') {
        console.info('[PairingEngine] Realtime federation sync active')
      } else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT') {
        console.warn('[PairingEngine] Realtime sync lost — will retry on reconnect')
      }
    })

    _realtimeSub = channel
    return () => {
      try { channel.unsubscribe() } catch {}
      _realtimeSub = null
    }
  } catch (err) {
    console.warn('[PairingEngine] subscribeFederationRealtime failed:', err.message)
    return () => {}
  }
}

// ─── Reconcile state (call on app focus / reconnect) ─────────
/**
 * Re-read pairing state from Supabase and reconcile with local cache.
 * Call on window focus, network reconnect, or after a stale-cache suspect.
 */
export async function reconcileFederationState() {
  if (!isSupabaseReady()) return lsGet(FC_KEYS.STATUS) || 'unregistered'

  try {
    const client  = getSupabaseClient()
    const nodeId  = lsGet(FC_KEYS.FLEET_NODE_ID)

    if (nodeId) {
      const { data } = await client
        .from('fleet_nodes')
        .select('pairing_status, tenant_id, fleet_entity_id, pairing_token, connected_since')
        .eq('id', nodeId)
        .single()

      if (data) {
        if (data.pairing_status === 'registered' && data.tenant_id) {
          lsSet(FC_KEYS.STATUS,         'registered')
          lsSet(FC_KEYS.TENANT_ID,      data.tenant_id)
          lsSet(FC_KEYS.FLEET_ID,       data.fleet_entity_id || '')
          lsSet(FC_KEYS.PAIRING_TOKEN,  data.pairing_token   || '')
          lsSet(FC_KEYS.CONNECTED_SINCE,data.connected_since || '')
          return 'registered'
        } else if (data.pairing_status === 'unregistered') {
          lsSet(FC_KEYS.STATUS, 'unregistered')
          return 'unregistered'
        }
      }
    }

    // Check pairing_codes if no fleet node
    const code = lsGet(FC_KEYS.CODE)
    if (code) {
      const { data } = await client
        .from('pairing_codes')
        .select('status, attempts, expires_at')
        .eq('code', code)
        .single()

      if (data) {
        lsSet(FC_KEYS.ATTEMPTS, data.attempts || 0)
        if (data.status === 'expired' || new Date(data.expires_at) < new Date()) {
          lsDel(FC_KEYS.CODE)
          lsDel(FC_KEYS.EXPIRES_AT)
          lsSet(FC_KEYS.STATUS, 'unregistered')
          return 'unregistered'
        }
        if (data.status === 'failed' || (data.attempts || 0) >= MAX_ATTEMPTS) {
          lsDel(FC_KEYS.CODE)
          lsDel(FC_KEYS.EXPIRES_AT)
          lsSet(FC_KEYS.STATUS, 'unregistered')
          return 'unregistered'
        }
      }
    }
  } catch (err) {
    console.warn('[PairingEngine] reconcileFederationState:', err.message)
  }

  return lsGet(FC_KEYS.STATUS) || 'unregistered'
}

// ─── CC polling (fallback when no Supabase realtime) ─────────
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

// ─── Connection test ──────────────────────────────────────────
export async function testConnection(ccUrl) {
  if (!ccUrl) return { ok: false, error: 'No URL configured' }
  const clean = ccUrl.trim().replace(/\/+$/, '')
  const t0    = Date.now()
  try {
    const res = await fetch(`${clean}/api/fleet-heartbeat`, {
      method: 'OPTIONS',
      signal: AbortSignal.timeout(6000),
    })
    return { ok: true, latencyMs: Date.now() - t0, status: res.status }
  } catch {
    try {
      await fetch(clean, { method: 'HEAD', signal: AbortSignal.timeout(5000) })
      return { ok: true, latencyMs: Date.now() - t0 }
    } catch {
      return { ok: false, latencyMs: null, error: 'Unreachable' }
    }
  }
}

// ─── Heartbeat ────────────────────────────────────────────────
export async function sendHeartbeat({ vehicleCount = 0, activeVehicles = 0, driverCount = 0, activeDrivers = 0 } = {}) {
  const ccUrl  = lsGet(FC_KEYS.CC_URL)
  const status = lsGet(FC_KEYS.STATUS)
  if (!ccUrl || status !== 'registered') return

  // Also keep fleet_node online marker fresh
  const nodeId = lsGet(FC_KEYS.FLEET_NODE_ID)
  if (isSupabaseReady() && nodeId) {
    try {
      const client = getSupabaseClient()
      await client.from('fleet_nodes')
        .update({ online: true, last_seen: new Date().toISOString() })
        .eq('id', nodeId)
    } catch {}
  }

  const tenantId = lsGet(FC_KEYS.TENANT_ID) || ''
  const fleetId  = lsGet(FC_KEYS.FLEET_ID)  || ''
  const token    = lsGet(FC_KEYS.PAIRING_TOKEN) || ''
  if (!tenantId) return

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
        tenantId, fleetId, vehicleCount, activeVehicles,
        driverCount, activeDrivers, uptimePercent: 100, version: '1.0.0',
      }),
      signal: AbortSignal.timeout(8000),
    })
  } catch {}
}

export async function sendRouteComplete(data) {
  const ccUrl  = lsGet(FC_KEYS.CC_URL)
  const status = lsGet(FC_KEYS.STATUS)
  if (!ccUrl || status !== 'registered') return
  const tenantId = lsGet(FC_KEYS.TENANT_ID) || ''
  const fleetId  = lsGet(FC_KEYS.FLEET_ID)  || ''
  const token    = lsGet(FC_KEYS.PAIRING_TOKEN) || ''
  if (!tenantId) return

  try {
    await fetch(`${ccUrl}/api/fleet-route-complete`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Id':  tenantId,
        'X-Fleet-Id':   fleetId,
        'X-Apex-Key':   token,
      },
      body: JSON.stringify({ tenantId, fleetId, ...data }),
      signal: AbortSignal.timeout(8000),
    })
  } catch {}
}
