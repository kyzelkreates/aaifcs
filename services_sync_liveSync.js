/**
 * ============================================================
 * APEX AI — Live Sync Service
 * Real-time bidirectional bridge between Driver App and Fleet OS
 *
 * LOCATION:  Driver → Fleet (GPS every 5s)
 * COMMANDS:  Fleet → Driver (dispatch, alerts, messages)
 * AI DATA:   Driver AI Agent → Fleet (fatigue, safety, sentinel)
 * ============================================================
 */

// ─── Storage keys ─────────────────────────────────────────────
export const LIVE_TEL_PREFIX   = 'apex:tel:'          // per vehicle telemetry
export const LIVE_LOC_PREFIX   = 'apex:loc:'          // per driver location
export const DRIVER_MSGS_KEY   = 'apex:driver_msgs'   // chat messages
export const FLEET_MSGS_KEY    = 'apex:fleet_msgs'    // fleet → driver commands
export const AI_REPORTS_KEY    = 'apex:ai_reports'    // sentinel + routemind reports
export const PAIRING_CODES_KEY = 'apex:pairing_codes' // active sync codes
export const ACTIVE_DRIVERS_KEY= 'apex:active_drivers'// paired + online drivers
export const SYNC_CHANNEL      = 'apex_fleet_sync'    // BroadcastChannel name

// ─── BroadcastChannel singleton ───────────────────────────────
let _channel = null
function getChannel() {
  if (!_channel && typeof BroadcastChannel !== 'undefined') {
    _channel = new BroadcastChannel(SYNC_CHANNEL)
  }
  return _channel
}

// ─── Helpers ──────────────────────────────────────────────────
const tsNow = () => new Date().toISOString()
const readJSON = (key, fallback = null) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback } catch { return fallback }
}
const writeJSON = (key, val) => {
  try { localStorage.setItem(key, JSON.stringify(val)) } catch {}
}

// ─── PAIRING CODE SYSTEM ──────────────────────────────────────
//
// HOW IT WORKS (cross-device safe)
// ─────────────────────────────────────────────────────────────
// The sync code is a SELF-CONTAINED token:
//   APXS-<base64url(JSON payload)>
//
// Payload: { v, d, n, r, e, k }
//   v = version (1)
//   d = driverId
//   n = driverName
//   r = vehicleReg
//   e = expiry (Unix seconds)
//   k = { apiKeyName: value, ... }  (runtime keys to inject)
//
// Validation is LOCAL — the driver app decodes the token itself.
// No shared localStorage or server needed.
// Fleet side also stores the record for tracking/revocation.
//
// ─────────────────────────────────────────────────────────────

const b64Encode = (str) => {
  try {
    return btoa(unescape(encodeURIComponent(str)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  } catch { return '' }
}

const b64Decode = (str) => {
  try {
    const pad = str.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - str.length % 4) % 4)
    return decodeURIComponent(escape(atob(pad)))
  } catch { return null }
}

/**
 * Build an APXS self-contained sync code.
 * Encodes driver identity + expiry + API keys into a base64url token.
 * Cross-device safe — driver app decodes locally, no shared storage needed.
 */
function buildToken(driverId, driverName, vehicleReg, ttlMinutes, apiKeys) {
  const payload = {
    v: 1,
    d: driverId,
    n: driverName,
    r: vehicleReg,
    e: Math.floor(Date.now() / 1000) + ttlMinutes * 60,
    k: apiKeys || {},
  }
  const encoded = b64Encode(JSON.stringify(payload))
  return `APXS-${encoded}`
}

/**
 * Decode and validate an APXS token.
 * Returns { ok, payload } or { ok: false, error }
 */
export function decodeToken(code) {
  const trimmed = (code || '').trim()
  if (!trimmed.startsWith('APXS-')) {
    return { ok: false, error: 'Invalid code format. Code must start with APXS-' }
  }
  const encoded = trimmed.slice(5)
  const json = b64Decode(encoded)
  if (!json) return { ok: false, error: 'Code is corrupted or incomplete' }
  let payload
  try { payload = JSON.parse(json) } catch { return { ok: false, error: 'Code is corrupted' } }
  if (payload.v !== 1) return { ok: false, error: 'Unsupported code version' }
  if (!payload.d || !payload.e) return { ok: false, error: 'Code is missing required fields' }
  if (Math.floor(Date.now() / 1000) > payload.e) {
    return { ok: false, error: 'Code has expired — ask your fleet manager for a new one' }
  }
  return { ok: true, payload }
}

/**
 * Fleet: generate a new self-contained sync code.
 * Collects runtime API keys from localStorage and embeds them.
 * Also stores a record locally for tracking and revocation.
 */
export function generateSyncCode(driverId = null, driverName = 'Driver', vehicleReg = '—', ttlMinutes = 60, apiKeys = null) {
  // Collect runtime API keys from fleet dashboard localStorage
  const runtimeKeys = apiKeys || {}
  if (!apiKeys) {
    const LS_MAP = {
      gh: 'apex_rk_graphhopper',
      gm: 'apex_rk_google_maps',
      mb: 'apex_rk_mapbox',
      oa: 'apex_rk_openai',
      or: 'apex_rk_openrouter',
      gq: 'apex_rk_groq',
      ds: 'apex_rk_deepseek',
      ms: 'apex_rk_mistral',
      an: 'apex_rk_anthropic',
      gn: 'apex_rk_gemini',
      ol: 'apex_rk_ollama_url',
    }
    Object.entries(LS_MAP).forEach(([k, lsKey]) => {
      const val = localStorage.getItem(lsKey)
      if (val) runtimeKeys[k] = val
    })
  }

  const resolvedDriverId = driverId || `guest-${Date.now()}`
  const code = buildToken(resolvedDriverId, driverName, vehicleReg, ttlMinutes, runtimeKeys)

  // Store record for fleet-side tracking / revocation
  const record = {
    code,
    driver_id:   resolvedDriverId,
    driver_name: driverName,
    vehicle_reg: vehicleReg,
    created_at:  tsNow(),
    expires_at:  new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString(),
    status:      'pending',
    paired_at:   null,
    last_seen:   null,
    telemetry:   null,
  }
  const existing = readJSON(PAIRING_CODES_KEY, [])
  const fresh = existing.filter(c => c.status !== 'revoked' && new Date(c.expires_at) > new Date())
  fresh.unshift(record)
  writeJSON(PAIRING_CODES_KEY, fresh.slice(0, 20))
  getChannel()?.postMessage({ type: 'CODE_CREATED', code: record })
  return code
}

export function getActiveSyncCodes() {
  const codes = readJSON(PAIRING_CODES_KEY, [])
  return codes.filter(c => c.status !== 'revoked' && new Date(c.expires_at) > new Date())
}

export function revokeSyncCode(code) {
  const codes = readJSON(PAIRING_CODES_KEY, [])
  writeJSON(PAIRING_CODES_KEY, codes.map(c => c.code === code ? { ...c, status: 'revoked' } : c))
  getChannel()?.postMessage({ type: 'CODE_REVOKED', code })
}

/**
 * Driver app: activate a sync code.
 * Decodes the self-contained APXS token — NO shared localStorage needed.
 * Works cross-device: the driver just needs the code string.
 */
export function activateSyncCode(code, driverProfile) {
  // Decode the self-contained token
  const { ok, payload, error } = decodeToken(code)
  if (!ok) return { ok: false, error }

  // Resolve driver identity (use profile override or token data)
  const driverId   = driverProfile?.id        || payload.d
  const driverName = driverProfile?.full_name  || payload.n
  const vehicleReg = driverProfile?.vehicle_reg || payload.r

  // ── Inject API keys into driver device localStorage ───────────
  const keyMap = {
    gh: 'apex_rk_graphhopper',
    gm: 'apex_rk_google_maps',
    mb: 'apex_rk_mapbox',
    oa: 'apex_rk_openai',
    or: 'apex_rk_openrouter',
    gq: 'apex_rk_groq',
    ds: 'apex_rk_deepseek',
    ms: 'apex_rk_mistral',
    an: 'apex_rk_anthropic',
    gn: 'apex_rk_gemini',
    ol: 'apex_rk_ollama_url',
  }
  const keyLabels = { gh:'GraphHopper',gm:'Google Maps',mb:'Mapbox',oa:'OpenAI',or:'OpenRouter',gq:'Groq',ds:'DeepSeek',ms:'Mistral',an:'Anthropic',gn:'Gemini',ol:'Ollama' }
  const injectedKeys = []
  if (payload.k && typeof payload.k === 'object') {
    Object.entries(payload.k).forEach(([k, val]) => {
      if (val && keyMap[k]) {
        try { localStorage.setItem(keyMap[k], val); injectedKeys.push(keyLabels[k] || k) } catch {}
      }
    })
  }

  // ── Store pairing record on driver device ─────────────────────
  const record = {
    code,
    driver_id:   driverId,
    driver_name: driverName,
    vehicle_reg: vehicleReg,
    paired_at:   tsNow(),
    expires_at:  new Date(payload.e * 1000).toISOString(),
    api_keys:    injectedKeys,
    status:      'active',
  }
  writeJSON('apex:sync_pairing', record)

  // ── Register as active driver (for fleet live map) ────────────
  const drivers = readJSON(ACTIVE_DRIVERS_KEY, {})
  drivers[driverId] = { ...record, online: true, last_seen: tsNow() }
  writeJSON(ACTIVE_DRIVERS_KEY, drivers)

  // ── Mark code as used on fleet side (best-effort, same device only) ──
  try {
    const codes = readJSON(PAIRING_CODES_KEY, [])
    const updated = codes.map(c => c.code === code ? { ...c, status: 'active', paired_at: tsNow() } : c)
    writeJSON(PAIRING_CODES_KEY, updated)
  } catch {}

  getChannel()?.postMessage({ type: 'DRIVER_PAIRED', record, injectedKeys })
  return { ok: true, record, injectedKeys }
}



// ─── LOCATION / TELEMETRY PUSH (Driver → Fleet) ───────────────
/**
 * Called by driver app every 5 seconds with fresh GPS data
 */
export function pushDriverLocation(driverId, vehicleId, locationData) {
  const payload = {
    driver_id:  driverId,
    vehicle_id: vehicleId,
    lat:        locationData.lat,
    lng:        locationData.lng,
    speed:      locationData.speed ?? 0,
    heading:    locationData.heading ?? 0,
    accuracy:   locationData.accuracy ?? 0,
    status:     locationData.status ?? 'en_route',
    ts:         tsNow(),
  }

  // Write to per-vehicle key (fleet map reads this — same-device fallback)
  writeJSON(`${LIVE_TEL_PREFIX}${vehicleId}`, payload)
  writeJSON(`${LIVE_LOC_PREFIX}${driverId}`, payload)

  // Update active driver registry
  const drivers = readJSON(ACTIVE_DRIVERS_KEY, {})
  if (drivers[driverId]) {
    drivers[driverId].last_seen = tsNow()
    drivers[driverId].online = true
    drivers[driverId].telemetry = payload
    writeJSON(ACTIVE_DRIVERS_KEY, drivers)
  }

  // ── Supabase upsert (cross-device GPS delivery to fleet map) ──
  // Fire-and-forget: don't await — GPS pushes every 5s and must not block UI
  if (isSupabaseReady()) {
    const sb = getSupabaseClient()
    if (sb) {
      sb.from('driver_locations')
        .upsert({
          driver_id:  driverId,
          lat:        locationData.lat,
          lng:        locationData.lng,
          speed:      locationData.speed ?? 0,
          heading:    locationData.heading ?? 0,
          accuracy:   locationData.accuracy ?? 0,
          status:     locationData.status ?? 'en_route',
          updated_at: tsNow(),
        }, { onConflict: 'driver_id' })
        .then(({ error }) => {
          if (error) console.debug('[LiveSync] driver_locations upsert error:', error.message)
        })
        .catch(() => {})
    }
  }

  // Broadcast to fleet map (same device / same-origin tabs)
  getChannel()?.postMessage({ type: 'DRIVER_LOCATION', payload })
  return payload
}

/**
 * Fleet map calls this to get all live driver positions
 */
export function getLiveDriverPositions() {
  const result = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(LIVE_TEL_PREFIX)) {
        const val = readJSON(key)
        if (val && val.lat != null && val.lng != null) {
          // Only include if seen in last 3 minutes
          const age = Date.now() - new Date(val.ts).getTime()
          if (age < 3 * 60 * 1000) result.push(val)
        }
      }
    }
  } catch {}
  return result
}

/**
 * Subscribe to live driver location updates
 * Returns unsubscribe function
 */
export function subscribeToDriverLocations(callback) {
  const ch = getChannel()
  let supabaseChannel = null

  // ── Supabase Realtime: cross-device live GPS (primary) ────────
  if (isSupabaseReady()) {
    const sb = getSupabaseClient()
    if (sb) {
      supabaseChannel = sb
        .channel('ap3x-driver-locations')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'driver_locations' },
          (payload) => {
            const row = payload.new
            if (row) callback({ ...row, _fromSupabase: true })
          }
        )
        .subscribe((status) => {
          console.debug('[LiveSync] driver_locations realtime:', status)
        })
    }
  }

  // ── BroadcastChannel: same-device fallback ────────────────────
  const handler = ch
    ? (evt) => { if (evt.data?.type === 'DRIVER_LOCATION') callback(evt.data.payload) }
    : null
  if (ch && handler) ch.addEventListener('message', handler)

  // ── Poll localStorage every 5s (cross-tab, offline fallback) ──
  const interval = setInterval(() => {
    const positions = getLiveDriverPositions()
    if (positions.length > 0) callback({ _bulk: true, positions })
  }, 5000)

  return () => {
    if (ch && handler) ch.removeEventListener('message', handler)
    clearInterval(interval)
    if (supabaseChannel) {
      try { getSupabaseClient()?.removeChannel(supabaseChannel) } catch {}
    }
  }
}

// ─── FLEET → DRIVER COMMANDS ──────────────────────────────────
/**
 * Fleet sends a command/message to a specific driver
 */
export function sendFleetCommand(driverId, type, payload) {
  const cmd = {
    id:        `cmd-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
    type,      // 'message' | 'dispatch' | 'alert' | 'recall' | 'waypoint'
    from:      'fleet',
    driver_id: driverId || 'all',
    payload,
    ts:        tsNow(),
    read:      false,
  }
  const existing = readJSON(FLEET_MSGS_KEY, [])
  writeJSON(FLEET_MSGS_KEY, [cmd, ...existing].slice(0, 500))
  getChannel()?.postMessage({ type: 'FLEET_COMMAND', cmd })
  return cmd
}

export function sendFleetMessage(driverId, text) {
  return sendFleetCommand(driverId, 'message', { text })
}

export function sendDispatchOrder(driverId, job) {
  return sendFleetCommand(driverId, 'dispatch', { job })
}

export function sendFleetAlert(driverId, alertText, severity = 'warning') {
  return sendFleetCommand(driverId, 'alert', { text: alertText, severity })
}

/**
 * Driver app subscribes to fleet commands
 */
export function subscribeToFleetCommands(driverId, callback) {
  const ch = getChannel()
  if (!ch) return () => {}
  const handler = (evt) => {
    const cmd = evt.data?.cmd
    if (evt.data?.type === 'FLEET_COMMAND' && cmd &&
        (cmd.driver_id === driverId || cmd.driver_id === 'all')) {
      callback(cmd)
    }
  }
  ch.addEventListener('message', handler)

  // Poll for queued commands
  let lastCheck = Date.now()
  const interval = setInterval(() => {
    const cmds = readJSON(FLEET_MSGS_KEY, [])
    const fresh = cmds.filter(c =>
      !c.read &&
      new Date(c.ts).getTime() > lastCheck &&
      (c.driver_id === driverId || c.driver_id === 'all')
    )
    fresh.forEach(c => callback(c))
    lastCheck = Date.now()
  }, 3000)

  return () => {
    ch.removeEventListener('message', handler)
    clearInterval(interval)
  }
}

// ─── AI AGENT REPORTS (Driver AI → Fleet) ────────────────────
/**
 * Driver AI agents push reports back to fleet
 */
export function pushAIReport(driverId, driverName, vehicleReg, reportType, data) {
  const report = {
    id:          `rpt-${Date.now()}-${Math.random().toString(36).slice(2,5)}`,
    driver_id:   driverId,
    driver_name: driverName,
    vehicle_reg: vehicleReg,
    type:        reportType,  // 'sentinel' | 'routemind' | 'harsh_event' | 'performance'
    data,
    ts:          tsNow(),
  }
  const existing = readJSON(AI_REPORTS_KEY, [])
  writeJSON(AI_REPORTS_KEY, [report, ...existing].slice(0, 200))
  getChannel()?.postMessage({ type: 'AI_REPORT', report })
  return report
}

export function subscribeToAIReports(callback) {
  const ch = getChannel()
  if (!ch) return () => {}
  const handler = (evt) => {
    if (evt.data?.type === 'AI_REPORT') callback(evt.data.report)
  }
  ch.addEventListener('message', handler)
  return () => ch.removeEventListener('message', handler)
}

export function getStoredAIReports(limit = 50) {
  return readJSON(AI_REPORTS_KEY, []).slice(0, limit)
}

// ─── ACTIVE DRIVERS ───────────────────────────────────────────
export function getActiveDrivers() {
  const drivers = readJSON(ACTIVE_DRIVERS_KEY, {})
  return Object.values(drivers).filter(d => {
    const age = Date.now() - new Date(d.last_seen || 0).getTime()
    return age < 5 * 60 * 1000 // seen in last 5 min = online
  })
}

export function subscribeToDriverEvents(callback) {
  const ch = getChannel()
  if (!ch) return () => {}
  const handler = (evt) => {
    if (['DRIVER_PAIRED', 'DRIVER_LOCATION', 'CODE_CREATED', 'CODE_REVOKED', 'AI_REPORT'].includes(evt.data?.type)) {
      callback(evt.data)
    }
  }
  ch.addEventListener('message', handler)
  return () => ch.removeEventListener('message', handler)
}


/**
 * Driver app: read the stored sync pairing record (set after activateSyncCode)
 */
export function getDriverSyncPairing() {
  return readJSON('apex:sync_pairing', null)
}

/**
 * Driver app: clear sync pairing (unpair from fleet)
 */
export function clearDriverSyncPairing() {
  try { localStorage.removeItem('apex:sync_pairing') } catch {}
}

// ─── QR & SHARE UTILITIES ─────────────────────────────────────
export function getSyncCodeQR(code, size = 240) {
  const deepLink = `${window.location.origin}${window.location.pathname}#/driver-app?sync=${encodeURIComponent(code)}`
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(deepLink)}&bgcolor=060b18&color=a78bfa&margin=3`
  return { qrUrl, deepLink, code }
}

export async function copySyncCode(code) {
  try {
    await navigator.clipboard.writeText(code)
    return { ok: true }
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = code; ta.style.position = 'fixed'; ta.style.opacity = '0'
      document.body.appendChild(ta); ta.select()
      document.execCommand('copy'); document.body.removeChild(ta)
      return { ok: true }
    } catch (e) { return { ok: false, error: e.message } }
  }
}

export function shareSyncCodeWhatsApp(code, driverName, vehicleReg) {
  const url = `${window.location.origin}${window.location.pathname}#/driver-app?sync=${encodeURIComponent(code)}`
  const msg = `*Apex AI Fleet Control — Driver Sync*\n\n🚛 Driver: ${driverName}\n🚘 Vehicle: ${vehicleReg}\n\n*Sync Code:*\n\`${code}\`\n\n📱 Open the AP3X Driver App and paste this code to connect, or tap:\n${url}\n\n_Code expires in 1 hour._`
  window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank', 'noopener,noreferrer')
}

export function shareSyncCodeEmail(code, driverName, vehicleReg, email = '') {
  const url = `${window.location.origin}${window.location.pathname}#/driver-app?sync=${encodeURIComponent(code)}`
  const subj = encodeURIComponent(`[Apex AI] Sync Code — ${driverName} / ${vehicleReg}`)
  const body = encodeURIComponent(
    `Hi ${driverName},\n\nYour Apex AI Fleet Control sync code is ready.\n\n` +
    `Sync Code: ${code}\n\nSteps:\n` +
    `1. Open the AP3X Driver App on your device\n` +
    `2. Tap "Enter Sync Code"\n` +
    `3. Paste: ${code}\n\n` +
    `Or tap this link to auto-fill: ${url}\n\n` +
    `This code expires in 1 hour.\n\n— Apex Intelligent AI Fleet Control OS`
  )
  window.open(`mailto:${email}?subject=${subj}&body=${body}`, '_blank')
}

export async function shareSyncCodeNative(code, driverName, vehicleReg) {
  const url = `${window.location.origin}${window.location.pathname}#/driver-app?sync=${encodeURIComponent(code)}`
  if (!navigator.share) return { ok: false, error: 'Web Share not supported' }
  try {
    await navigator.share({ title: 'Apex AI — Driver Sync', text: `Sync code: ${code} | Driver: ${driverName}`, url })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'Cancelled' : e.message }
  }
}
