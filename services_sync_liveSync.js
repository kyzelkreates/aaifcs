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
/**
 * Generate a new sync code: APEX-XXXXXXXX-XXXX-FC
 * Stores it in pairing codes list with 1-hour TTL
 */
export function generateSyncCode(driverId = null, driverName = 'Driver', vehicleReg = '—', ttlMinutes = 60) {
  const rand = () => Math.random().toString(36).toUpperCase().replace(/[^A-Z0-9]/g, '').padEnd(4, '0').slice(0, 4)
  const code = `APEX-${rand()}${rand()}-${rand()}-FC`
  const record = {
    code,
    driver_id:   driverId || `guest-${Date.now()}`,
    driver_name: driverName,
    vehicle_reg: vehicleReg,
    created_at:  tsNow(),
    expires_at:  new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString(),
    status:      'pending',   // pending | active | revoked
    paired_at:   null,
    last_seen:   null,
    telemetry:   null,
  }
  const codes = readJSON(PAIRING_CODES_KEY, [])
  // Remove expired
  const fresh = codes.filter(c => c.status !== 'revoked' && new Date(c.expires_at) > new Date())
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
  const updated = codes.map(c => c.code === code ? { ...c, status: 'revoked' } : c)
  writeJSON(PAIRING_CODES_KEY, updated)
  getChannel()?.postMessage({ type: 'CODE_REVOKED', code })
}

/**
 * Driver app calls this to activate the sync code and pair with fleet
 */
export function activateSyncCode(code, driverProfile) {
  const codes = readJSON(PAIRING_CODES_KEY, [])
  const idx = codes.findIndex(c => c.code === code && c.status === 'pending')
  if (idx === -1) return { ok: false, error: 'Invalid or expired code' }
  if (new Date(codes[idx].expires_at) < new Date()) return { ok: false, error: 'Code expired' }

  codes[idx] = {
    ...codes[idx],
    status:    'active',
    paired_at: tsNow(),
    driver_id: driverProfile?.id || codes[idx].driver_id,
    driver_name: driverProfile?.full_name || codes[idx].driver_name,
    vehicle_reg: driverProfile?.vehicle_reg || codes[idx].vehicle_reg,
  }
  writeJSON(PAIRING_CODES_KEY, codes)

  // Register as active driver
  const drivers = readJSON(ACTIVE_DRIVERS_KEY, {})
  drivers[codes[idx].driver_id] = {
    ...codes[idx],
    online: true,
    last_seen: tsNow(),
  }
  writeJSON(ACTIVE_DRIVERS_KEY, drivers)
  getChannel()?.postMessage({ type: 'DRIVER_PAIRED', record: codes[idx] })
  return { ok: true, record: codes[idx] }
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

  // Write to per-vehicle key (fleet map reads this)
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
  if (!ch) return () => {}
  const handler = (evt) => {
    if (evt.data?.type === 'DRIVER_LOCATION') callback(evt.data.payload)
  }
  ch.addEventListener('message', handler)

  // Also poll localStorage for cross-session drivers (different device, same network)
  const interval = setInterval(() => {
    const positions = getLiveDriverPositions()
    if (positions.length > 0) callback({ _bulk: true, positions })
  }, 5000)

  return () => {
    ch.removeEventListener('message', handler)
    clearInterval(interval)
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
