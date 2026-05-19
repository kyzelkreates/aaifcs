/**
 * ============================================================
 * APEX AI — Driver Sync Service
 * Handles all Fleet ↔ Driver app communication methods:
 *
 *  1. QR Code          — encode sync package as QR, driver scans
 *  2. Email            — mailto: with JSON attachment encoded in body
 *  3. Web Share API    — native OS share sheet (WiFi Direct / AirDrop /
 *                        Nearby Share trigger this on Android/iOS)
 *  4. Bluetooth (BLE)  — Web Bluetooth API to write to a BLE characteristic
 *  5. Copy to clipboard — fallback for all platforms
 *  6. URL Deep Link    — #/driver-import?pkg=<base64> — opens in driver app
 *
 * JSON payload structure: see localDB.buildDriverSyncPackage()
 * ============================================================
 */

import { tenantRegistry } from './services_federation_tenantRegistry'
import { buildDriverSyncPackage, importDriverSyncPackage,
         buildTelemetryPackage, importTelemetryPackage,
         jobTable } from './services_local_localDB'

// ─── BLE constants (custom service / characteristic UUIDs) ────
// These must match whatever BLE peripheral the driver device runs.
// Using random UUIDs — change to match your hardware.
const BLE_SERVICE_UUID        = '12345678-1234-1234-1234-123456789abc'
const BLE_CHAR_FLEET_TO_DRIVER = 'aaaaaaaa-1234-1234-1234-123456789abc' // write
const BLE_CHAR_DRIVER_TO_FLEET = 'bbbbbbbb-1234-1234-1234-123456789abc' // notify

let bleDevice = null
let bleServer = null

// ─── Shared helpers ───────────────────────────────────────────
const pkg2b64 = (pkg) => btoa(unescape(encodeURIComponent(JSON.stringify(pkg))))
const b642pkg = (b64) => JSON.parse(decodeURIComponent(escape(atob(b64))))
const pkgStr  = (pkg) => JSON.stringify(pkg, null, 2)

// ─── 1. QR Code ───────────────────────────────────────────────
// Returns a URL for a QR code image using qrserver.com (free, no key needed)
export function getQRCodeURL(driverId, size = 256) {
  const pkg  = buildDriverSyncPackage(driverId)
  const b64  = pkg2b64(pkg)
  const link = `${window.location.href.split('#')[0]}#/driver-import?pkg=${encodeURIComponent(b64)}`
  const encoded = encodeURIComponent(link)
  return {
    url: `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encoded}&bgcolor=0d1426&color=00d4ff&margin=2`,
    link,
    pkg,
  }
}

// ─── 2. Email ─────────────────────────────────────────────────
export function sendViaEmail(driverId, driverEmail) {
  const pkg   = buildDriverSyncPackage(driverId)
  const b64   = pkg2b64(pkg)
  const link  = `${window.location.href.split('#')[0]}#/driver-import?pkg=${encodeURIComponent(b64)}`
  const jobs  = pkg.jobs.length
  const subj  = encodeURIComponent(`[Apex AI] ${jobs} job${jobs !== 1 ? 's' : ''} assigned to you`)
  const body  = encodeURIComponent(
    `Hi ${pkg.driver_name},\n\n` +
    `You have ${jobs} job${jobs !== 1 ? 's' : ''} assigned in Apex Fleet Control.\n\n` +
    `Open on your device:\n${link}\n\n` +
    `Or paste this sync code into the AP3X Driver app > Import Jobs:\n\n${pkgStr(pkg)}\n\n` +
    `— Apex Intelligent AI`
  )
  const mailto = `mailto:${driverEmail || ''}?subject=${subj}&body=${body}`
  window.open(mailto, '_blank')
  return { ok: true, link }
}

// ─── 3. Web Share API (WiFi Direct / AirDrop / Nearby Share) ──
export async function sendViaShare(driverId) {
  const pkg  = buildDriverSyncPackage(driverId)
  const b64  = pkg2b64(pkg)
  const link = `${window.location.href.split('#')[0]}#/driver-import?pkg=${encodeURIComponent(b64)}`
  const jobs = pkg.jobs.length

  if (!navigator.share) {
    return { ok: false, error: 'Web Share API not supported on this browser/device.' }
  }

  try {
    await navigator.share({
      title: `Apex AI — Jobs for ${pkg.driver_name}`,
      text:  `${jobs} job${jobs !== 1 ? 's' : ''} assigned. Open link in AP3X Driver app.`,
      url:   link,
    })
    return { ok: true, link }
  } catch (e) {
    if (e.name === 'AbortError') return { ok: false, error: 'Share cancelled.' }
    return { ok: false, error: e.message }
  }
}

// ─── 4. Bluetooth (Web Bluetooth API) ─────────────────────────
export async function connectBluetooth() {
  if (!navigator.bluetooth) {
    return { ok: false, error: 'Web Bluetooth not supported. Use Chrome on Android/Desktop.' }
  }
  try {
    bleDevice = await navigator.bluetooth.requestDevice({
      filters: [{ services: [BLE_SERVICE_UUID] }],
      optionalServices: [BLE_SERVICE_UUID],
    })
    bleServer = await bleDevice.gatt.connect()
    bleDevice.addEventListener('gattserverdisconnected', () => {
      bleDevice = null; bleServer = null
    })
    return { ok: true, deviceName: bleDevice.name || 'Unknown device' }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

export function bluetoothConnected() {
  return !!(bleDevice?.gatt?.connected)
}

export function disconnectBluetooth() {
  bleDevice?.gatt?.disconnect()
  bleDevice = null
  bleServer = null
}

export async function sendViaBluetooth(driverId) {
  if (!bluetoothConnected()) {
    const conn = await connectBluetooth()
    if (!conn.ok) return conn
  }
  try {
    const pkg     = buildDriverSyncPackage(driverId)
    const json    = JSON.stringify(pkg)
    const service = await bleServer.getPrimaryService(BLE_SERVICE_UUID)
    const char    = await service.getCharacteristic(BLE_CHAR_FLEET_TO_DRIVER)

    // Write in 512-byte chunks (BLE MTU limit)
    const encoder = new TextEncoder()
    const bytes   = encoder.encode(json)
    const CHUNK   = 512
    for (let i = 0; i < bytes.length; i += CHUNK) {
      await char.writeValueWithoutResponse(bytes.slice(i, i + CHUNK))
    }
    return { ok: true, bytes: bytes.length }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

// Subscribe to telemetry coming back from driver via BLE
export async function subscribeBLETelemetry(callback) {
  if (!bluetoothConnected()) return { ok: false, error: 'Not connected' }
  try {
    const service = await bleServer.getPrimaryService(BLE_SERVICE_UUID)
    const char    = await service.getCharacteristic(BLE_CHAR_DRIVER_TO_FLEET)
    await char.startNotifications()
    let buffer = ''
    char.addEventListener('characteristicvaluechanged', (e) => {
      const chunk = new TextDecoder().decode(e.target.value)
      buffer += chunk
      try {
        const pkg = JSON.parse(buffer)
        buffer = ''
        const result = importTelemetryPackage(pkg)
        if (result.ok) callback(pkg)
      } catch { /* accumulating */ }
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

// ─── 5. Copy to clipboard ─────────────────────────────────────
export async function copyToClipboard(driverId) {
  const pkg  = buildDriverSyncPackage(driverId)
  const b64  = pkg2b64(pkg)
  const link = `${window.location.href.split('#')[0]}#/driver-import?pkg=${encodeURIComponent(b64)}`
  try {
    await navigator.clipboard.writeText(link)
    return { ok: true, link }
  } catch {
    return { ok: false, link, error: 'Clipboard write failed — copy the link manually.' }
  }
}

// ─── 6. Import from deep-link / QR scan ──────────────────────
export function importFromURL() {
  const hash = window.location.hash || ''
  const match = hash.match(/[#?&]pkg=([^&]+)/)
  if (!match) return null
  try {
    const pkg = b642pkg(decodeURIComponent(match[1]))
    return importDriverSyncPackage(pkg)
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

// ─── Driver → Fleet telemetry push ───────────────────────────
// Called from the AP3X driver app to push telemetry back.
// Uses BroadcastChannel (same device) or stores locally for later sync.
export function pushTelemetryToFleet(driverId, telemetry) {
  const pkg = buildTelemetryPackage(driverId, telemetry)
  // Same-device: broadcast directly
  try {
    const bc = new BroadcastChannel('apex:telemetry')
    bc.postMessage(pkg)
    bc.close()
  } catch {}
  // Also persist so fleet can pick it up
  importTelemetryPackage(pkg)
  return { ok: true }
}

// Fleet side: listen for driver telemetry
export function listenForDriverTelemetry(callback) {
  let bc
  try {
    bc = new BroadcastChannel('apex:telemetry')
    bc.onmessage = (e) => callback(e.data)
  } catch {}
  return () => bc?.close()
}

// ─── Driver: import package pasted/typed manually ─────────────
export function importFromText(text) {
  try {
    // Try direct JSON
    const pkg = JSON.parse(text)
    return importDriverSyncPackage(pkg)
  } catch {
    // Try base64
    try {
      const pkg = b642pkg(text.trim())
      return importDriverSyncPackage(pkg)
    } catch (e) {
      return { ok: false, error: 'Invalid sync package. Paste the full JSON or link.' }
    }
  }
}

// Export helpers for driver side
export { importDriverSyncPackage, b642pkg, pkg2b64 }

// ─── Driver ↔ Fleet Chat Channel ─────────────────────────────
// Driver sends a message → fleet receives it in real time.
// Fleet sends a reply → driver receives it in real time.

const DRIVER_CHAT_CHANNEL = 'apex:driver:chat'

// Driver side: send a message to fleet
export function sendDriverMessage(driverId, driverName, vehicleId, vehicleReg, text) {
  const msg = {
    id:          `msg-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
    from:        'driver',
    driver_id:   driverId,
    driver_name: driverName,
    vehicle_id:  vehicleId,
    vehicle_reg: vehicleReg,
    text,
    ts:          new Date().toISOString(),
  }
  try {
    const bc = new BroadcastChannel(DRIVER_CHAT_CHANNEL)
    bc.postMessage(msg)
    bc.close()
  } catch {}
  // Persist so fleet can read even if not open right now
  try {
    const key = 'apex:db:driver_messages'
    const all = JSON.parse(localStorage.getItem(key) || '[]')
    all.unshift(msg)
    localStorage.setItem(key, JSON.stringify(all.slice(0, 200)))
  } catch {}
  return msg
}

// Fleet side: send a reply to driver
export function sendFleetReply(driverId, text, isAI = false) {
  const msg = {
    id:          `msg-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
    from:        isAI ? 'ai' : 'fleet',
    driver_id:   driverId,
    text,
    ts:          new Date().toISOString(),
  }
  try {
    const bc = new BroadcastChannel(DRIVER_CHAT_CHANNEL)
    bc.postMessage(msg)
    bc.close()
  } catch {}
  try {
    const key = 'apex:db:driver_messages'
    const all = JSON.parse(localStorage.getItem(key) || '[]')
    all.unshift(msg)
    localStorage.setItem(key, JSON.stringify(all.slice(0, 200)))
  } catch {}
  return msg
}

// Listen for all messages on the chat channel
export function listenForDriverMessages(callback) {
  let bc
  try {
    bc = new BroadcastChannel(DRIVER_CHAT_CHANNEL)
    bc.onmessage = (e) => callback(e.data)
  } catch {}
  return () => bc?.close()
}

// Get persisted message history
export function getDriverMessageHistory(limit = 80) {
  try {
    const all = JSON.parse(localStorage.getItem('apex:db:driver_messages') || '[]')
    return all.slice(0, limit)
  } catch { return [] }
}


// ══════════════════════════════════════════════════════════════
//  FLEET PAIRING CODE SYSTEM
//  Fleet generates a 6-digit code → driver enters it in driver app
//  No URL to the fleet dashboard is ever given to a driver
// ══════════════════════════════════════════════════════════════

const CODE_KEY    = 'apex:fleet:pairing_codes'   // fleet side
const PAIRED_KEY  = 'apex:driver:fleet_paired'   // driver side

/** Fleet: generate a 6-digit time-limited pairing code for a driver */
export function generatePairingCode(driverId, driverName, vehicleReg, validMinutes = 60) {
  const code    = Math.floor(100000 + Math.random() * 900000).toString()
  const expires = Date.now() + validMinutes * 60 * 1000
  const entry   = { code, driverId, driverName, vehicleReg, expires, created: Date.now() }
  try {
    const all = JSON.parse(localStorage.getItem(CODE_KEY) || '[]')
    // Remove expired + same driver
    const cleaned = all.filter(e => e.expires > Date.now() && e.driverId !== driverId)
    cleaned.unshift(entry)
    localStorage.setItem(CODE_KEY, JSON.stringify(cleaned))
  } catch {}
  return code
}

/** Fleet: get all active pairing codes */
export function getActivePairingCodes() {
  try {
    const all = JSON.parse(localStorage.getItem(CODE_KEY) || '[]')
    return all.filter(e => e.expires > Date.now())
  } catch { return [] }
}

/** Fleet: revoke a pairing code */
export function revokePairingCode(code) {
  try {
    const all = JSON.parse(localStorage.getItem(CODE_KEY) || '[]')
    localStorage.setItem(CODE_KEY, JSON.stringify(all.filter(e => e.code !== code)))
  } catch {}
}

/**
 * Driver: validate a pairing code entered by the driver.
 * Returns { ok, driverId, driverName, vehicleReg } or { ok: false, error }
 * Works on same device (localStorage) or cross-device via BroadcastChannel reply.
 */
export function validatePairingCode(code) {
  // Same-device check (fleet dashboard open on same browser)
  try {
    const all = JSON.parse(localStorage.getItem(CODE_KEY) || '[]')
    const entry = all.find(e => e.code === code && e.expires > Date.now())
    if (entry) {
      // Mark code as used
      localStorage.setItem(CODE_KEY, JSON.stringify(all.filter(e => e.code !== code)))
      // Save pairing on driver side
      localStorage.setItem(PAIRED_KEY, JSON.stringify({
        driverId:   entry.driverId,
        driverName: entry.driverName,
        vehicleReg: entry.vehicleReg,
        paired_at:  new Date().toISOString(),
      }))
      // Broadcast successful pairing to fleet
      try {
        const bc = new BroadcastChannel('apex:pairing')
        bc.postMessage({ type: 'paired', ...entry })
        bc.close()
      } catch {}
      return { ok: true, driverId: entry.driverId, driverName: entry.driverName, vehicleReg: entry.vehicleReg }
    }
  } catch {}
  return { ok: false, error: 'Invalid or expired code. Ask fleet ops for a new one.' }
}

/** Driver: get current pairing (if any) */
export function getDriverPairing() {
  try { return JSON.parse(localStorage.getItem(PAIRED_KEY) || 'null') } catch { return null }
}

/** Driver: clear pairing (unlink from fleet) */
export function clearDriverPairing() {
  try { localStorage.removeItem(PAIRED_KEY) } catch {}
}

/** Fleet: listen for pairing events */
export function listenForPairingEvents(callback) {
  let bc
  try {
    bc = new BroadcastChannel('apex:pairing')
    bc.onmessage = (e) => callback(e.data)
  } catch {}
  return () => bc?.close()
}

// ══════════════════════════════════════════════════════════════
//  DRIVER AI REPORT → FLEET DASHBOARD
//  Driver app Sentinel/RouteMind AI results pushed to fleet
// ══════════════════════════════════════════════════════════════

const AI_REPORT_CHANNEL = 'apex:driver:ai_reports'
const AI_REPORT_KEY     = 'apex:db:driver_ai_reports'

/**
 * Driver app: push an AI report to the fleet dashboard.
 * @param {object} report - { driverId, driverName, vehicleReg, module, summary, fatigueScore, alertLevel, speed, sessionSecs }
 */
export function pushAIReportToFleet(report) {
  const entry = {
    id:       `air-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
    ts:       new Date().toISOString(),
    type:     'ai_report',
    ...report,
  }
  // BroadcastChannel (same device, instant)
  try {
    const bc = new BroadcastChannel(AI_REPORT_CHANNEL)
    bc.postMessage(entry)
    bc.close()
  } catch {}
  // localStorage (cross-reload persistence)
  try {
    const all = JSON.parse(localStorage.getItem(AI_REPORT_KEY) || '[]')
    all.unshift(entry)
    localStorage.setItem(AI_REPORT_KEY, JSON.stringify(all.slice(0, 200)))
  } catch {}
  return entry
}

/** Fleet: listen for incoming driver AI reports */
export function listenForDriverAIReports(callback) {
  let bc
  try {
    bc = new BroadcastChannel(AI_REPORT_CHANNEL)
    bc.onmessage = (e) => callback(e.data)
  } catch {}
  return () => bc?.close()
}

/** Fleet: get persisted AI report history */
export function getDriverAIReportHistory(limit = 100) {
  try {
    const all = JSON.parse(localStorage.getItem(AI_REPORT_KEY) || '[]')
    return all.slice(0, limit)
  } catch { return [] }
}
