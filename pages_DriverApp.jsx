/**
 * ============================================================
 * APEX AP3X — Standalone Driver App  (Full Enterprise Build)
 * Route: /driver-app  (no auth guard — driver-side standalone)
 *
 * Features:
 *  ✅ OSM / OSRM navigation — live route, polyline, step-by-step turn guidance
 *  ✅ Live GPS telemetry push → fleet dashboard (BroadcastChannel + localStorage)
 *  ✅ Fatigue detection: session timer, behavioural signals (speed variance,
 *      heading jitter, stop patterns), EU 4.5h break enforcement
 *  ✅ Harsh-event detection (DeviceMotion: braking, acceleration, cornering)
 *  ✅ Speeding alerts → safetyService → fleet dashboard
 *  ✅ Apex Sentinel AI — live safety coaching + proactive alerts
 *  ✅ Apex RouteMind AI — route optimisation tips on destination set
 *  ✅ Fleet two-way chat (BroadcastChannel + localStorage persistence)
 *  ✅ Trip timer, odometer, heading compass
 *  ✅ Assigned jobs — pulled from dispatch store, tap to auto-navigate
 *  ✅ Live step-by-step navigation instructions from OSRM legs
 *  ✅ PIN-gated session with per-device profile + lockscreen
 *  ✅ EU driver hours compliance (4h30 continuous driving alert)
 *  ✅ Break logging — resets session timer + notifies fleet
 * ============================================================
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  MapContainer, TileLayer, Marker, Polyline, Circle, useMap,
} from 'react-leaflet'
import L from 'leaflet'
import Icon from './components_ui_Icon'
import {
  pushTelemetryToFleet,
  sendDriverMessage,
  listenForDriverMessages,
  sendFleetReply,
  pushAIReportToFleet,
  validatePairingCode,
  getDriverPairing,
  clearDriverPairing,
} from './services_sync_driverSyncService'
import { aiRouter }   from './services_ai_aiRouter'
import { mapService }  from './services_maps_mapService'
import { getRuntimeKey, RUNTIME_KEYS } from './services_maps_runtimeKeys'
import { safetyService, ALERT_TYPE, ALERT_SEVERITY } from './services_safety_safetyService'

// ── Fix default Leaflet marker icons ─────────────────────────
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

// ── Custom SVG icons ──────────────────────────────────────────
const mkDivIcon = (bg, border, size = 18) => new L.DivIcon({
  className: '',
  html: `<div style="width:${size}px;height:${size}px;background:${bg};border:3px solid ${border};border-radius:50%;box-shadow:0 0 14px ${border}88;"></div>`,
  iconSize: [size, size], iconAnchor: [size / 2, size / 2],
})
// 🚛 Truck icon (driver position)
const DRIVER_ICON = new L.DivIcon({
  className: '',
  html: `<div style="font-size:22px;line-height:1;filter:drop-shadow(0 0 6px #7c3aed88);">🚛</div>`,
  iconSize: [28, 28], iconAnchor: [14, 14],
})
// Destination marker
const DEST_ICON = new L.DivIcon({
  className: '',
  html: `<div style="width:18px;height:18px;background:#22d3ee;border:3px solid #0891b2;border-radius:50%;box-shadow:0 0 14px #0891b288;"></div>`,
  iconSize: [18, 18], iconAnchor: [9, 9],
})
// Waypoint / stop marker (numbered)
const makeStopIcon = (num) => new L.DivIcon({
  className: '',
  html: `<div style="width:22px;height:22px;background:#f59e0b;border:2px solid #d97706;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#000;box-shadow:0 0 10px #f59e0b66;">${num}</div>`,
  iconSize: [22, 22], iconAnchor: [11, 11],
})
const WAYPOINT_ICON = makeStopIcon('●')

// ── Fullscreen CSS — ensures the element fills screen on all browsers ──────
const FS_STYLE_ID = 'apex-fullscreen-style'
if (!document.getElementById(FS_STYLE_ID)) {
  const s = document.createElement('style')
  s.id = FS_STYLE_ID
  s.textContent = `
    :fullscreen                { width:100dvw!important; height:100dvh!important; background:#060b18; }
    :-webkit-full-screen       { width:100dvw!important; height:100dvh!important; background:#060b18; }
    :-moz-full-screen          { width:100dvw!important; height:100dvh!important; background:#060b18; }
    :-ms-fullscreen            { width:100dvw!important; height:100dvh!important; background:#060b18; }
    :fullscreen .leaflet-container { height:100%!important; }
    :-webkit-full-screen .leaflet-container { height:100%!important; }
  `
  document.head.appendChild(s)
}

// ── Constants ─────────────────────────────────────────────────
const OSRM_URL       = 'https://router.project-osrm.org/route/v1/driving'
const NOM_URL        = 'https://nominatim.openstreetmap.org/search'
const STORAGE_CREDS  = 'apex:local:driver_creds'
const STORAGE_SESSION= 'apex:driver:session'
const JOBS_KEY       = 'apex:db:dispatch_jobs'
const MSGS_KEY       = 'apex:db:driver_messages'
const EU_DRIVE_SECS  = 4.5 * 3600   // 4h 30m
const EU_BREAK_SECS  = 45 * 60      // 45 min break required

// ── Utility helpers ───────────────────────────────────────────
const fmtDist  = m  => m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`
const fmtDur   = s  => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h > 0 ? `${h}h ${m}m` : `${m} min` }
const fmtClock = s  => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sc = s % 60; return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sc).padStart(2,'0')}` }
const tsNow    = () => new Date().toISOString()

// ── Haversine distance (m) ────────────────────────────────────
function haversine([lat1, lng1], [lat2, lng2]) {
  const R = 6371000, rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ── OSRM manoeuvre → human instruction ───────────────────────
function stepInstruction(step) {
  if (!step) return ''
  const { maneuver, name } = step
  const road = name ? `onto ${name}` : ''
  const typeMap = {
    'turn-right':           `Turn right ${road}`,
    'turn-left':            `Turn left ${road}`,
    'turn-slight right':    `Bear right ${road}`,
    'turn-slight left':     `Bear left ${road}`,
    'turn-sharp right':     `Sharp right ${road}`,
    'turn-sharp left':      `Sharp left ${road}`,
    'roundabout':           `At the roundabout, take exit ${maneuver?.exit ?? ''} ${road}`,
    'rotary':               `At the roundabout, take exit ${maneuver?.exit ?? ''} ${road}`,
    'straight':             `Continue straight ${road}`,
    'merge':                `Merge ${road}`,
    'on ramp':              `Take the on-ramp ${road}`,
    'off ramp':             `Take the exit ${road}`,
    'fork':                 `Keep ${maneuver?.modifier ?? 'straight'} at the fork ${road}`,
    'depart':               `Head ${maneuver?.bearing_after != null ? bearingLabel(maneuver.bearing_after) : ''} ${road}`,
    'arrive':               `You have arrived at your destination`,
    'notification':         `Continue ${road}`,
    'new name':             `Continue onto ${name || ''}`,
    'end of road':          `Turn ${maneuver?.modifier ?? 'right'} at end of road ${road}`,
    'continue':             `Continue ${road}`,
    'use lane':             `Use lane ${road}`,
  }
  const key = maneuver ? `${maneuver.type}${maneuver.modifier ? '-' + maneuver.modifier : ''}` : ''
  const simpleKey = maneuver?.type || ''
  return typeMap[key] || typeMap[simpleKey] || (name ? `Continue on ${name}` : 'Continue')
}

function bearingLabel(b) {
  const dirs = ['north','northeast','east','southeast','south','southwest','west','northwest']
  return dirs[Math.round(b / 45) % 8]
}

// ── Manoeuvre → icon name ─────────────────────────────────────
function stepIcon(step) {
  const t = step?.maneuver?.type, m = step?.maneuver?.modifier
  if (t === 'arrive') return 'MapPin'
  if (t === 'depart') return 'Navigation2'
  if (t === 'roundabout' || t === 'rotary') return 'RefreshCw'
  if (m?.includes('right')) return 'CornerDownRight'
  if (m?.includes('left'))  return 'CornerDownLeft'
  return 'ArrowUp'
}

// ── Message persistence ───────────────────────────────────────
function persistMsg(msg) {
  try {
    const all = JSON.parse(localStorage.getItem(MSGS_KEY) || '[]')
    all.unshift(msg)
    localStorage.setItem(MSGS_KEY, JSON.stringify(all.slice(0, 300)))
  } catch {}
}
function loadMsgs() {
  try { return JSON.parse(localStorage.getItem(MSGS_KEY) || '[]').reverse() } catch { return [] }
}

// ── Load jobs for this driver ─────────────────────────────────
function loadJobs(driverId) {
  try {
    const all = JSON.parse(localStorage.getItem(JOBS_KEY) || '[]')
    // Show jobs assigned to this driver OR unassigned pending jobs
    return all.filter(j =>
      j.driver_id === driverId ||
      (!j.driver_id && (j.status === 'pending' || j.status === 'assigned'))
    ).sort((a, b) => {
      const pri = { urgent: 0, high: 1, normal: 2, low: 3 }
      return (pri[a.priority] ?? 2) - (pri[b.priority] ?? 2)
    }).slice(0, 20)
  } catch { return [] }
}

// ── Persist job status update back to store ───────────────────
function updateJobStatus(jobId, status, driverId) {
  try {
    const all = JSON.parse(localStorage.getItem(JOBS_KEY) || '[]')
    const idx = all.findIndex(j => j.id === jobId)
    if (idx !== -1) {
      all[idx] = { ...all[idx], status, driver_id: driverId, updated_at: tsNow() }
      localStorage.setItem(JOBS_KEY, JSON.stringify(all))
    }
  } catch {}
}

// ══════════════════════════════════════════════════════════════
//  MAP FOLLOW CONTROL
// ══════════════════════════════════════════════════════════════
function MapController({ pos, follow, zoom }) {
  const map = useMap()
  const lastPos = useRef(null)
  useEffect(() => {
    if (!follow || !pos) return
    if (!lastPos.current || haversine(lastPos.current, pos) > 5) {
      map.setView(pos, zoom ?? map.getZoom(), { animate: true, duration: 0.8 })
      lastPos.current = pos
    }
  }, [pos, follow])
  return null
}

// ── Reactive polyline renderer — handles route + multi-stop segments ──
// Uses imperative Leaflet so layers update correctly when state changes
function LivePolylines({ route, stopRoutes }) {
  const map = useMap()
  const layerGroupRef = useRef(null)

  useEffect(() => {
    // Clear old layers
    if (layerGroupRef.current) {
      layerGroupRef.current.clearLayers()
    } else {
      layerGroupRef.current = L.layerGroup().addTo(map)
    }

    const lg = layerGroupRef.current

    if (stopRoutes && stopRoutes.length > 0) {
      // Multi-stop: draw each segment with alternating colour/dash
      stopRoutes.forEach((seg, i) => {
        if (!seg || seg.length < 2) return
        L.polyline(seg, {
          color:     i === 0 ? '#22d3ee' : '#a78bfa',
          weight:    6,
          opacity:   0.92,
          lineCap:   'round',
          lineJoin:  'round',
          dashArray: i === 0 ? null : '10 6',
        }).addTo(lg)
        // White inner line for depth on first segment
        if (i === 0) {
          L.polyline(seg, {
            color: '#ffffff',
            weight: 2,
            opacity: 0.25,
            lineCap: 'round',
          }).addTo(lg)
        }
      })
    } else if (route && route.length > 1) {
      // Single route
      L.polyline(route, {
        color:   '#22d3ee',
        weight:  6,
        opacity: 0.92,
        lineCap: 'round',
        lineJoin:'round',
      }).addTo(lg)
      // White inner highlight
      L.polyline(route, {
        color:   '#ffffff',
        weight:  2,
        opacity: 0.25,
        lineCap: 'round',
      }).addTo(lg)
    }

    return () => {
      if (layerGroupRef.current) {
        layerGroupRef.current.clearLayers()
      }
    }
  }, [map, route, stopRoutes])

  return null
}

// ══════════════════════════════════════════════════════════════
//  FATIGUE MONITOR  (behavioural signals + session timer)
// ══════════════════════════════════════════════════════════════
function useFatigueMonitor({ enabled, speed, heading, onAlert, profileId }) {
  // Restore session from localStorage so breaks survive page reload
  const [sessionSecs,  setSessionSecs]  = useState(() => {
    try { return parseInt(localStorage.getItem(`${STORAGE_SESSION}:${profileId}`) || '0') } catch { return 0 }
  })
  const [fatigueScore, setFatigueScore] = useState(0)
  const [alertLevel,   setAlertLevel]   = useState('ok')

  const sessionRef  = useRef(sessionSecs)
  const speedHist   = useRef([])   // rolling 60 s window of speed values
  const headingHist = useRef([])   // rolling 60 s window of heading values
  const breakAlerted= useRef(false)

  useEffect(() => {
    if (!enabled) return
    const timer = setInterval(() => {
      sessionRef.current += 1
      setSessionSecs(s => {
        const ns = s + 1
        try { localStorage.setItem(`${STORAGE_SESSION}:${profileId}`, String(ns)) } catch {}
        return ns
      })

      // Collect behavioural signals
      if (speed != null) { speedHist.current.push(speed); if (speedHist.current.length > 60) speedHist.current.shift() }
      if (heading != null) { headingHist.current.push(heading); if (headingHist.current.length > 60) headingHist.current.shift() }

      // EU break alert (fire once)
      if (sessionRef.current >= EU_DRIVE_SECS && !breakAlerted.current) {
        breakAlerted.current = true
        onAlert({ type: 'break_due', text: '⚠️ EU regulations: 45-min break now required (4h 30m driving reached)' })
      }

      // ── Fatigue score calculation (multi-signal) ─────────────
      // Signal 1: session duration (40% weight) — linear 0→100 over 4.5h
      const durationScore = Math.min(100, (sessionRef.current / EU_DRIVE_SECS) * 100)

      // Signal 2: speed variance (30% weight) — high variance = erratic driving
      let varScore = 0
      if (speedHist.current.length >= 10) {
        const mean = speedHist.current.reduce((a, b) => a + b, 0) / speedHist.current.length
        const variance = speedHist.current.reduce((a, b) => a + (b - mean) ** 2, 0) / speedHist.current.length
        varScore = Math.min(100, Math.sqrt(variance) * 3) // stddev > 33 → 100
      }

      // Signal 3: heading instability (30% weight) — weaving indicator
      let headScore = 0
      if (headingHist.current.length >= 10) {
        let totalChange = 0
        for (let i = 1; i < headingHist.current.length; i++) {
          let diff = Math.abs(headingHist.current[i] - headingHist.current[i - 1])
          if (diff > 180) diff = 360 - diff
          totalChange += diff
        }
        const avgChange = totalChange / (headingHist.current.length - 1)
        headScore = Math.min(100, avgChange * 8) // avg >12.5° per sec → 100
      }

      const composite = Math.round(
        durationScore * 0.40 +
        varScore      * 0.30 +
        headScore     * 0.30
      )
      setFatigueScore(composite)

      const level = composite >= 75 ? 'danger' : composite >= 45 ? 'warn' : 'ok'
      setAlertLevel(level)

      // Periodic fatigue alerts (not every tick)
      if (composite >= 75 && sessionRef.current % 300 === 0) {
        onAlert({ type: 'fatigue_critical', text: '🚨 Critical fatigue level detected — pull over safely and rest now' })
      } else if (composite >= 45 && sessionRef.current % 600 === 0) {
        onAlert({ type: 'fatigue_warn', text: '⚠️ Fatigue building — plan a break at the next safe opportunity' })
      }
    }, 1000)
    return () => clearInterval(timer)
  }, [enabled, speed, heading])

  const resetSession = useCallback(() => {
    sessionRef.current = 0
    breakAlerted.current = false
    speedHist.current = []
    headingHist.current = []
    setSessionSecs(0)
    setFatigueScore(0)
    setAlertLevel('ok')
    try { localStorage.removeItem(`${STORAGE_SESSION}:${profileId}`) } catch {}
  }, [profileId])

  return { fatigueScore, sessionSecs, alertLevel, resetSession }
}

// ══════════════════════════════════════════════════════════════
//  HARSH EVENT DETECTOR  (DeviceMotion API)
// ══════════════════════════════════════════════════════════════
function useHarshEventDetector({ vehicleId, driverId, driverName, vehicleReg, onAlert }) {
  const lastEvt = useRef(0)

  useEffect(() => {
    const BRAKE  = 7.5   // m/s² deceleration
    const ACCEL  = 5.5   // m/s² acceleration
    const CORN   = 6.5   // m/s² lateral

    const handler = ({ acceleration }) => {
      if (!acceleration) return
      const now = Date.now()
      if (now - lastEvt.current < 2500) return // 2.5 s debounce

      const ax = Math.abs(acceleration.x || 0)
      const ay = Math.abs(acceleration.y || 0)

      let type = null, text = null, severity = ALERT_SEVERITY.MEDIUM

      if (ay >= BRAKE) {
        type = ALERT_TYPE.HARSH_BRAKE
        severity = ay >= 11 ? ALERT_SEVERITY.CRITICAL : ay >= 9 ? ALERT_SEVERITY.HIGH : ALERT_SEVERITY.MEDIUM
        text = `Harsh braking detected — ${ay.toFixed(1)} m/s²`
      } else if (ay >= ACCEL && ay < BRAKE) {
        type = ALERT_TYPE.HARSH_ACCEL
        severity = ALERT_SEVERITY.MEDIUM
        text = `Harsh acceleration — ${ay.toFixed(1)} m/s²`
      } else if (ax >= CORN) {
        type = 'harsh_cornering'
        severity = ALERT_SEVERITY.MEDIUM
        text = `Harsh cornering — ${ax.toFixed(1)} m/s²`
      } else return

      lastEvt.current = now
      onAlert({ type: 'harsh_event', text })

      try {
        safetyService.createAlert({
          type, severity,
          vehicle_id: vehicleId, driver_id: driverId,
          driver_name: driverName, vehicle_reg: vehicleReg,
          description: text, resolved: false,
        })
      } catch {}
    }

    window.addEventListener('devicemotion', handler)
    return () => window.removeEventListener('devicemotion', handler)
  }, [vehicleId, driverId, driverName, vehicleReg])
}

// ══════════════════════════════════════════════════════════════
//  SETUP SCREEN
// ══════════════════════════════════════════════════════════════
function SetupScreen({ onReady }) {
  const [step,     setStep]    = useState('code') // 'code' | 'profile'
  const [code,     setCode]    = useState('')
  const [paired,   setPaired]  = useState(null)
  const [name,     setName]    = useState('')
  const [pin,      setPin]     = useState('')
  const [err,      setErr]     = useState('')
  const [checking, setChecking] = useState(false)

  const submitCode = () => {
    if (code.length !== 6) return setErr('Enter the 6-digit code from fleet ops')
    setChecking(true); setErr('')
    const result = validatePairingCode(code.trim())
    setChecking(false)
    if (!result.ok) return setErr(result.error)
    setPaired(result)
    setName(result.driverName || '')
    setStep('profile')
  }

  const submitProfile = () => {
    if (!name.trim())   return setErr('Enter your full name')
    if (pin.length < 4) return setErr('PIN must be at least 4 digits')
    const reg = paired?.vehicleReg || 'UNKNOWN'
    const profile = {
      id:           paired?.driverId || `drv-${Date.now()}`,
      full_name:    name.trim(),
      pin,
      vehicle_reg:  reg.toUpperCase(),
      vehicle_id:   `veh-${reg.toLowerCase().replace(/\s+/g, '')}`,
      fleet_paired: true,
      created_at:   tsNow(),
    }
    localStorage.setItem(STORAGE_CREDS, JSON.stringify(profile))
    onReady(profile)
  }

  return (
    <div className="min-h-screen bg-[#060b18] flex items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-violet-500/10 border border-violet-500/30 flex items-center justify-center">
            <Icon name="Navigation" size={28} className="text-violet-400" />
          </div>
          <div className="text-2xl font-bold text-white tracking-tight">AP3X Driver</div>
          <div className="text-sm text-slate-500">Apex Intelligent Fleet Navigation</div>
        </div>

        {step === 'code' ? (
          <div className="bg-[#0d1426] border border-violet-500/15 rounded-2xl p-6 space-y-4">
            <div className="flex items-start gap-3 p-3 rounded-xl bg-violet-500/5 border border-violet-500/20">
              <Icon name="ShieldCheck" size={16} className="text-violet-400 flex-shrink-0 mt-0.5" />
              <div className="text-xs text-slate-400 leading-relaxed">
                Ask your fleet manager for a <span className="text-violet-300 font-semibold">6-digit pairing code</span>. This links your device to the fleet without giving access to fleet systems.
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-500 font-semibold uppercase tracking-wider block mb-1.5">Fleet Pairing Code</label>
              <input
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                type="text" inputMode="numeric" maxLength={6} autoFocus
                onKeyDown={e => e.key === 'Enter' && submitCode()}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-3 text-2xl text-[#4a4f5a] placeholder-slate-800 focus:border-violet-500 focus:outline-none font-mono tracking-[0.5em] text-center"
              />
            </div>
            {err && <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{err}</div>}
            <button onClick={submitCode} disabled={code.length !== 6 || checking}
              className="w-full bg-violet-500 hover:bg-violet-600 disabled:opacity-40 text-white font-semibold rounded-xl py-3 text-sm transition-colors">
              {checking ? 'Verifying…' : 'Verify Code'}
            </button>
          </div>
        ) : (
          <div className="bg-[#0d1426] border border-emerald-500/20 rounded-2xl p-6 space-y-4">
            <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-500/8 border border-emerald-500/20">
              <Icon name="CheckCircle2" size={16} className="text-emerald-400 flex-shrink-0" />
              <div>
                <div className="text-xs font-semibold text-emerald-300">Code verified ✓</div>
                <div className="text-2xs text-[#4a4f5a] font-mono">Vehicle: {paired?.vehicleReg || '—'}</div>
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-500 font-semibold uppercase tracking-wider block mb-1.5">Your Name</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Confirm your name"
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-[#4a4f5a] placeholder-slate-700 focus:border-violet-500 focus:outline-none" />
            </div>
            <div>
              <label className="text-xs text-slate-500 font-semibold uppercase tracking-wider block mb-1.5">Set a PIN (4+ digits)</label>
              <input value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} type="password"
                inputMode="numeric" maxLength={8} placeholder="••••"
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-[#4a4f5a] placeholder-slate-700 focus:border-violet-500 focus:outline-none" />
            </div>
            {err && <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{err}</div>}
            <button onClick={submitProfile}
              className="w-full bg-violet-500 hover:bg-violet-600 text-white font-semibold rounded-xl py-3 text-sm transition-colors">
              Start Driving
            </button>
          </div>
        )}
        <p className="text-center text-2xs text-slate-700">AP3X Driver · Secured by fleet pairing code · No fleet dashboard access</p>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════
//  LOGIN SCREEN
// ══════════════════════════════════════════════════════════════
function LoginScreen({ profile, onLogin, onReset }) {
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')

  const attempt = () => {
    if (pin === profile.pin) { setErr(''); onLogin() }
    else setErr('Incorrect PIN — try again')
  }

  return (
    <div className="min-h-screen bg-[#060b18] flex items-center justify-center p-6">
      <div className="w-full max-w-xs space-y-6">
        <div className="text-center">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-violet-500/10 border border-violet-500/30 flex items-center justify-center mb-3">
            <Icon name="Navigation" size={24} className="text-violet-400" />
          </div>
          <div className="text-xl font-bold text-white">Welcome back</div>
          <div className="text-sm text-slate-400 mt-1">{profile.full_name}</div>
          <div className="text-xs text-slate-600 font-mono">{profile.vehicle_reg}</div>
        </div>
        <div className="bg-[#0d1426] border border-violet-500/15 rounded-2xl p-5 space-y-4">
          <input value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
            type="password" inputMode="numeric" maxLength={8} placeholder="Enter PIN"
            onKeyDown={e => e.key === 'Enter' && attempt()}
            className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:border-violet-500 focus:outline-none text-center tracking-widest" />
          {err && <div className="text-xs text-red-400 text-center">{err}</div>}
          <button onClick={attempt}
            className="w-full bg-violet-500 hover:bg-violet-600 text-white font-semibold rounded-xl py-3 text-sm transition-colors">
            Unlock
          </button>
          <button onClick={onReset} className="w-full text-xs text-slate-600 hover:text-slate-400 py-1">
            Not you? Reset profile
          </button>
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════
//  MAIN DRIVER APP
// ══════════════════════════════════════════════════════════════
function DriverAppMain({ profile, onLogout }) {

  // ── GPS state ────────────────────────────────────────────────
  const [pos,      setPos]      = useState(null)
  const [speed,    setSpeed]    = useState(0)
  const [heading,  setHeading]  = useState(null)
  const [accuracy, setAccuracy] = useState(null)
  const [gpsState, setGpsState] = useState('waiting') // 'waiting'|'active'|'denied'
  const [tripDist, setTripDist] = useState(0)
  const prevPosRef = useRef(null)

  // ── Navigation state ─────────────────────────────────────────
  const [destination,  setDest]       = useState(null)
  const [destName,     setDestName]   = useState('')
  const [route,        setRoute]      = useState(null)      // [[lat,lng],...]
  const [routeInfo,    setRouteInfo]  = useState(null)      // {distance, duration}
  const [routeSteps,   setRouteSteps] = useState([])        // OSRM step objects
  const [stepIdx,      setStepIdx]    = useState(0)
  const [routeProvider,setRouteProv]  = useState('')
  const [routing,      setRouting]    = useState(false)
  const [follow,       setFollow]     = useState(true)
  const [showSearch,   setShowSearch] = useState(false)
  const [searchQ,      setSearchQ]    = useState('')
  const [searchRes,    setSearchRes]  = useState([])
  const [searching,    setSearching]  = useState(false)

  // ── UI tabs ───────────────────────────────────────────────────
  const [tab, setTab] = useState('map') // 'map'|'safety'|'chat'|'jobs'

  // ── Chat state ───────────────────────────────────────────────
  const [messages,    setMessages]   = useState(loadMsgs)
  const [chatInput,   setChatInput]  = useState('')
  const [unread,      setUnread]     = useState(0)
  const chatEndRef = useRef(null)

  // ── Safety / AI state ────────────────────────────────────────
  const [safetyAlerts, setSafetyAlerts]  = useState([])
  const [activeAlert,  setActiveAlert]   = useState(null)
  const [sentinelLog,  setSentinelLog]   = useState([])
  const [sentinelQ,    setSentinelQ]     = useState('')
  const [sentinelBusy, setSentinelBusy]  = useState(false)
  const alertTimerRef = useRef(null)

  // ── Jobs state ───────────────────────────────────────────────
  const [jobs,       setJobs]      = useState(() => loadJobs(profile.id))
  const [activeJob,  setActiveJob] = useState(null)
  const [jobStops,   setJobStops]  = useState([])    // [{lat,lng,name,idx}] all geocoded stops
  const [stopRoutes, setStopRoutes] = useState([])   // [[lat,lng]...] polylines per stop segment

  // ── Fullscreen state ─────────────────────────────────────────
  const [isFullscreen, setIsFullscreen] = useState(false)
  const appRef = useRef(null)

  const enterFullscreen = useCallback(async () => {
    // Try the root app div first, fall back to documentElement
    const el = appRef.current ?? document.documentElement
    try {
      if (el.requestFullscreen)            { await el.requestFullscreen();            return }
      if (el.webkitRequestFullscreen)      { el.webkitRequestFullscreen();            return }
      if (el.mozRequestFullScreen)         { el.mozRequestFullScreen();               return }
      if (el.msRequestFullscreen)          { el.msRequestFullscreen();                return }
    } catch (e) {
      console.warn('[FS] enter failed:', e.message)
    }
  }, [])

  const exitFullscreen = useCallback(async () => {
    try {
      if (document.exitFullscreen)         { await document.exitFullscreen();         return }
      if (document.webkitExitFullscreen)   { document.webkitExitFullscreen();         return }
      if (document.mozCancelFullScreen)    { document.mozCancelFullScreen();          return }
      if (document.msExitFullscreen)       { document.msExitFullscreen();             return }
    } catch (e) {
      console.warn('[FS] exit failed:', e.message)
    }
  }, [])

  // Sync state with browser fullscreen events (covers hardware back button,
  // Escape key, or any external fullscreen change)
  useEffect(() => {
    const sync = () => {
      const inFS = !!(
        document.fullscreenElement        ||
        document.webkitFullscreenElement  ||
        document.mozFullScreenElement     ||
        document.msFullscreenElement
      )
      setIsFullscreen(inFS)
    }
    const events = ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange']
    events.forEach(e => document.addEventListener(e, sync))
    return () => events.forEach(e => document.removeEventListener(e, sync))
  }, [])

  // ── Fleet link code state ───────────────────────────────────
  const [showFleetConnect, setShowFleetConnect] = useState(false)
  const [fleetLinkCode,    setFleetLinkCode]    = useState('')
  const [fleetLinkError,   setFleetLinkError]   = useState('')
  const [fleetLinkSuccess, setFleetLinkSuccess] = useState(false)

  const submitFleetCode = useCallback(() => {
    setFleetLinkError('')
    const result = validatePairingCode(fleetLinkCode.trim())
    if (!result.ok) {
      setFleetLinkError(result.error)
      return
    }
    setFleetLinkSuccess(true)
    setFleetLinkCode('')
    // Reload jobs after linking
    setTimeout(() => {
      setJobs(loadJobs(profile.id))
      setShowFleetConnect(false)
      setFleetLinkSuccess(false)
    }, 2000)
  }, [fleetLinkCode, profile.id])

  // ── GPS watch ────────────────────────────────────────────────
  useEffect(() => {
    if (!navigator.geolocation) { setGpsState('denied'); return }
    const wid = navigator.geolocation.watchPosition(
      ({ coords }) => {
        const { latitude: lat, longitude: lng, heading: h, speed: spd, accuracy: acc } = coords
        const p = [lat, lng]
        setPos(p)
        setHeading(Math.round(h ?? 0))
        setSpeed(spd != null ? Math.round(spd * 3.6) : 0)
        setAccuracy(Math.round(acc ?? 0))
        setGpsState('active')

        // Trip odometer
        if (prevPosRef.current) setTripDist(d => d + haversine(prevPosRef.current, p))
        prevPosRef.current = p

        // Step advancement — works with OSRM steps (maneuver.location)
        // and mapService normalised steps (distance-based threshold on polyline)
        if (route && routeSteps.length > 0) {
          const next = routeSteps[stepIdx]
          let advanced = false
          // OSRM: step has maneuver.location [lng, lat]
          if (next?.maneuver?.location) {
            const [lng2, lat2] = next.maneuver.location
            if (haversine(p, [lat2, lng2]) < 35) advanced = true
          }
          // GH/Google normalised: step has distance remaining — advance when close to route segment end
          if (!advanced && next?.distance != null && next.distance < 40) {
            advanced = true
          }
          if (advanced) setStepIdx(i => Math.min(i + 1, routeSteps.length - 1))
        }

        // Speeding alert
        const kmh = spd != null ? spd * 3.6 : 0
        if (kmh > 90) {
          fireSafetyAlert({
            type: ALERT_TYPE.SPEEDING, text: `⚠️ Speed: ${Math.round(kmh)} km/h — reduce speed`,
            severity: kmh > 110 ? ALERT_SEVERITY.CRITICAL : ALERT_SEVERITY.HIGH,
          })
        }
      },
      () => setGpsState('denied'),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 }
    )
    return () => navigator.geolocation.clearWatch(wid)
  }, [route, routeSteps, stepIdx])

  // ── Telemetry push every 5 s ──────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => {
      if (!pos) return
      const pkg = {
        driver_id: profile.id, driver_name: profile.full_name,
        vehicle_id: profile.vehicle_id, vehicle_reg: profile.vehicle_reg,
        lat: pos[0], lng: pos[1], speed, heading, accuracy,
        trip_dist_m: Math.round(tripDist),
        destination: destName || null,
        ts: tsNow(),
      }
      try { pushTelemetryToFleet(profile.id, pkg) } catch {}
      try { localStorage.setItem(`apex:tel:${profile.vehicle_id}`, JSON.stringify(pkg)) } catch {}
    }, 5000)
    return () => clearInterval(t)
  }, [pos, speed, heading, accuracy, tripDist, destName, profile])

  // ── Fleet chat listener ───────────────────────────────────────
  useEffect(() => {
    const unsub = listenForDriverMessages(msg => {
      if (msg.from === 'fleet' || msg.from === 'ai') {
        setMessages(prev => [...prev, msg])
        setUnread(u => u + 1)
        setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 80)
      }
    })
    return unsub
  }, [])

  // ── Refresh jobs when localStorage changes ────────────────────
  useEffect(() => {
    const onStorage = () => setJobs(loadJobs(profile.id))
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [profile.id])

  // ── Fatigue monitor ───────────────────────────────────────────
  const { fatigueScore, sessionSecs, alertLevel, resetSession } = useFatigueMonitor({
    enabled:   gpsState === 'active',
    speed,
    heading,
    onAlert:   a => fireSafetyAlert(a),
    profileId: profile.id,
  })

  // ── Harsh event detector ──────────────────────────────────────
  useHarshEventDetector({
    vehicleId:  profile.vehicle_id,
    driverId:   profile.id,
    driverName: profile.full_name,
    vehicleReg: profile.vehicle_reg,
    onAlert:    a => fireSafetyAlert(a),
  })

  // ── Safety alert helper ───────────────────────────────────────
  const fireSafetyAlert = useCallback((a) => {
    setActiveAlert(a)
    setSafetyAlerts(prev => [{ ...a, id: Date.now(), ts: tsNow() }, ...prev].slice(0, 60))
    clearTimeout(alertTimerRef.current)
    alertTimerRef.current = setTimeout(() => setActiveAlert(null), 9000)

    // Log speeding to safetyService so fleet sees it
    if (a.type === ALERT_TYPE.SPEEDING || a.type === ALERT_TYPE.HARSH_BRAKE) {
      try {
        safetyService.createAlert({
          type: a.type, severity: a.severity ?? ALERT_SEVERITY.MEDIUM,
          vehicle_id: profile.vehicle_id, driver_id: profile.id,
          driver_name: profile.full_name, vehicle_reg: profile.vehicle_reg,
          description: a.text, resolved: false,
        })
      } catch {}
    }
  }, [profile])


  // ── Decode Google/GH encoded polyline → [[lat,lng],...] ──────
  const decodePolyline = (encoded) => {
    let idx=0,lat=0,lng=0,res=[]
    while(idx<encoded.length){
      let b,shift=0,result=0
      do{b=encoded.charCodeAt(idx++)-63;result|=(b&0x1f)<<shift;shift+=5}while(b>=0x20)
      lat+=(result&1)?~(result>>1):(result>>1)
      shift=0;result=0
      do{b=encoded.charCodeAt(idx++)-63;result|=(b&0x1f)<<shift;shift+=5}while(b>=0x20)
      lng+=(result&1)?~(result>>1):(result>>1)
      res.push([lat/1e5,lng/1e5])
    }
    return res
  }

  // ── Parse normalised mapService route → coords + steps ───────
  const parseServiceRoute = (result) => {
    if (!result) return null
    let coords = []
    const src = result.source || result.activeProvider || ''
    if (src === 'graphhopper') {
      const geo = result.geometry
      if (geo?.type === 'LineString')
        coords = geo.coordinates.map(([lng,lat]) => [lat,lng])
      else if (typeof geo === 'string')
        coords = decodePolyline(geo)
    } else if (src === 'google') {
      if (typeof result.geometry === 'string')
        coords = decodePolyline(result.geometry)
    } else {
      // OSRM normalised
      const geo = result.geometry
      if (geo?.type === 'LineString')
        coords = geo.coordinates.map(([lng,lat]) => [lat,lng])
      else if (Array.isArray(geo))
        coords = geo
    }
    // Steps: normalised mapService format has {text, distance, time}
    // OSRM raw steps have {maneuver, name, distance}
    const steps = result.instructions || []
    return { coords, steps, distance: result.distance||0, duration: result.duration||0, provider: src }
  }

  // ── Routing: GraphHopper → Google → OSRM fallback ───────────
  const fetchRoute = useCallback(async (from, to) => {
    setRouting(true); setRoute(null); setRouteInfo(null); setRouteSteps([]); setStepIdx(0)
    let parsed = null

    // ── Try mapService (uses GH or Google if key present) ──────
    try {
      const result = await mapService.route(
        { lat: from[0], lng: from[1] },
        { lat: to[0],   lng: to[1]   }
      )
      if (result) {
        parsed = parseServiceRoute(result)
        if (parsed?.coords?.length > 1) {
          setRouteProv(parsed.provider || 'service')
          console.info('[DriverApp] Route via mapService:', parsed.provider)
        } else {
          parsed = null // coords were empty — fall through to OSRM
        }
      }
    } catch (e) {
      console.warn('[DriverApp] mapService routing failed:', e.message)
    }

    // ── OSRM direct fallback (always works, no key needed) ─────
    if (!parsed) {
      try {
        const url = `${OSRM_URL}/${from[1]},${from[0]};${to[1]},${to[0]}?overview=full&geometries=geojson&steps=true`
        const data = await fetch(url).then(r => r.json())
        if (data.code === 'Ok' && data.routes[0]) {
          const r     = data.routes[0]
          const coords = r.geometry.coordinates.map(([lng, lat]) => [lat, lng])
          const steps  = r.legs.flatMap(leg => leg.steps || [])
          parsed = { coords, steps, distance: r.distance, duration: r.duration, provider: 'osrm' }
          setRouteProv('osrm')
          console.info('[DriverApp] Route via OSRM fallback')
        }
      } catch (e) { console.error('[DriverApp] OSRM fallback failed:', e.message) }
    }

    if (parsed && parsed.coords?.length > 1) {
      setRoute(parsed.coords)
      setRouteSteps(parsed.steps)
      setRouteInfo({ distance: parsed.distance, duration: parsed.duration })
      setStepIdx(0)
      askRouteMind(to)  // non-blocking RouteMind tip
    }
    setRouting(false)
  }, [])

  // ── Geocode: mapService (GH/Google) → Nominatim fallback ─────
  const doSearch = useCallback(async () => {
    if (!searchQ.trim()) return
    setSearching(true); setSearchRes([])
    try {
      // Try mapService geocode (GH or Google if key present)
      const results = await mapService.geocode(searchQ)
      if (results?.length) {
        // Normalise to {display_name, lat, lon} format
        setSearchRes(results.map(r => ({
          display_name: r.address || r.name || '',
          lat: String(r.lat),
          lon: String(r.lng),
        })))
        setSearching(false)
        return
      }
    } catch (e) {
      console.warn('[DriverApp] mapService geocode failed:', e.message)
    }
    // Nominatim direct fallback
    try {
      const r = await fetch(
        `${NOM_URL}?q=${encodeURIComponent(searchQ)}&format=json&limit=6`,
        { headers: { 'Accept-Language': 'en', 'User-Agent': 'ApexAI-DriverApp/1.0' } }
      )
      setSearchRes(await r.json())
    } catch {}
    setSearching(false)
  }, [searchQ])

  const selectDest = useCallback((result) => {
    const to = [parseFloat(result.lat), parseFloat(result.lon)]
    setDest(to)
    setDestName(result.display_name.split(',').slice(0, 2).join(', '))
    setSearchRes([]); setShowSearch(false); setSearchQ('')
    if (pos) fetchRoute(pos, to)
  }, [pos, fetchRoute])

  const clearRoute = () => {
    setDest(null); setDestName(''); setRoute(null); setRouteInfo(null); setRouteSteps([]); setStepIdx(0)
    setJobStops([]); setStopRoutes([])
  }

  // ── RouteMind AI tip on new destination ──────────────────────
  // ── RouteMind AI tip on new destination ──────────────────────
  const askRouteMind = async (destCoords) => {
    try {
      const msg = `I'm driving to ${destName || destCoords?.join(',')}. Current position: ${pos?.join(',')}. Give me a 1-sentence efficient route tip.`
      const res = await aiRouter.routeModule('apex_routemind', msg)
      const tip = res?.content || res
      if (tip) {
        setSentinelLog(prev => [...prev, {
          role: 'assistant', module: 'routemind',
          text: `🧭 RouteMind: ${tip}`, ts: tsNow(),
        }])
        // Push RouteMind insight to fleet dashboard
        try {
          pushAIReportToFleet({
            driverId:    profile.id,
            driverName:  profile.full_name,
            vehicleReg:  profile.vehicle_reg,
            vehicleId:   profile.vehicle_id,
            module:      'routemind',
            summary:     tip,
            destination: destName || null,
            speed,
          })
        } catch {}
      }
    } catch {}
  }

  // ── Sentinel AI query ─────────────────────────────────────────
  const askSentinel = async (question) => {
    if (!question.trim() || sentinelBusy) return
    setSentinelBusy(true)
    setSentinelLog(prev => [...prev, { role: 'user', text: question, ts: tsNow() }])
    setSentinelQ('')
    try {
      const ctx = [
        `Driver: ${profile.full_name}`,
        `Vehicle: ${profile.vehicle_reg}`,
        `Session time: ${fmtClock(sessionSecs)}`,
        `Fatigue score: ${fatigueScore}/100 (${alertLevel})`,
        `Speed: ${speed} km/h`,
        `Trip distance: ${fmtDist(tripDist)}`,
        `Recent alerts: ${safetyAlerts.slice(0, 3).map(a => a.text).join('; ') || 'none'}`,
      ].join(', ')

      const res   = await aiRouter.routeModule('apex_sentinel', `${question}\n\nDriver context: ${ctx}`)
      const reply = res?.content || (typeof res === 'string' ? res : 'No response from Sentinel')
      setSentinelLog(prev => [...prev, { role: 'assistant', module: 'sentinel', text: reply, ts: tsNow() }])
      // Push Sentinel report to fleet dashboard
      try {
        pushAIReportToFleet({
          driverId:    profile.id,
          driverName:  profile.full_name,
          vehicleReg:  profile.vehicle_reg,
          vehicleId:   profile.vehicle_id,
          module:      'sentinel',
          question,
          summary:     reply,
          fatigueScore,
          alertLevel,
          speed,
          sessionSecs,
          destination: destName || null,
        })
      } catch {}
    } catch {
      setSentinelLog(prev => [...prev, {
        role: 'assistant', module: 'sentinel',
        text: 'Sentinel is offline — check your AI provider keys in Settings.',
        ts: tsNow(),
      }])
    }
    setSentinelBusy(false)
  }


  // ── Fleet chat send ───────────────────────────────────────────
  const sendChat = useCallback(() => {
    if (!chatInput.trim()) return
    const msg = sendDriverMessage(
      profile.id, profile.full_name,
      profile.vehicle_id, profile.vehicle_reg,
      chatInput.trim()
    )
    persistMsg(msg)
    setMessages(prev => [...prev, msg])
    setChatInput('')
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 80)
  }, [chatInput, profile])

  // ── Job: navigate ────────────────────────────────────────────
  // Geocode a single address string → [lat, lng] or null
  const geocodeAddr = useCallback(async (addr) => {
    try {
      const results = await mapService.geocode(addr)
      if (results?.length) return [results[0].lat, results[0].lng]
    } catch {}
    try {
      const r = await fetch(`${NOM_URL}?q=${encodeURIComponent(addr)}&format=json&limit=1`, {
        headers: { 'Accept-Language': 'en', 'User-Agent': 'ApexAI-DriverApp/1.0' }
      })
      const data = await r.json()
      if (data[0]) return [parseFloat(data[0].lat), parseFloat(data[0].lon)]
    } catch {}
    return null
  }, [])

  const navigateToJob = useCallback(async (job) => {
    setActiveJob(job)
    setJobStops([])
    setStopRoutes([])
    updateJobStatus(job.id, 'in_progress', profile.id)
    setTab('map')

    // Collect all stop addresses from the job object
    // Supports: stops[], waypoints[], pickup_address+dropoff_address, or single destination
    const rawStops = []
    if (Array.isArray(job.stops) && job.stops.length > 0) {
      job.stops.forEach(s => {
        const addr = typeof s === 'string' ? s : (s.address || s.name || '')
        if (addr.trim()) rawStops.push({ addr, name: typeof s === 'object' ? (s.name || addr) : addr })
      })
    } else if (Array.isArray(job.waypoints) && job.waypoints.length > 0) {
      job.waypoints.forEach((w, i) => {
        const addr = typeof w === 'string' ? w : (w.address || w.name || '')
        if (addr.trim()) rawStops.push({ addr, name: typeof w === 'object' ? (w.name || addr) : addr })
      })
    } else {
      const pickup  = job.pickup_address  || job.pickup  || ''
      const dropoff = job.dropoff_address || job.destination || job.address || ''
      if (pickup.trim())  rawStops.push({ addr: pickup,  name: 'Pickup'  })
      if (dropoff.trim()) rawStops.push({ addr: dropoff, name: 'Dropoff' })
    }

    if (rawStops.length === 0) return

    // Geocode all stops
    const geocoded = []
    for (let i = 0; i < rawStops.length; i++) {
      const coords = await geocodeAddr(rawStops[i].addr)
      if (coords) geocoded.push({ lat: coords[0], lng: coords[1], name: rawStops[i].name, idx: i + 1 })
    }

    if (geocoded.length === 0) return

    setJobStops(geocoded)

    // Route: pos → stop1 → stop2 → … → final stop (chained segments)
    const waypoints = geocoded.map(g => [g.lat, g.lng])
    const final = waypoints[waypoints.length - 1]

    // Set primary destination = last stop
    setDest(final)
    setDestName(geocoded[geocoded.length - 1]?.name || rawStops[rawStops.length - 1]?.addr || '')

    if (!pos) return

    // Fetch each segment and store polylines
    if (waypoints.length === 1) {
      // Single stop — just route normally
      fetchRoute(pos, waypoints[0])
    } else {
      // Multi-stop: chain segments pos→wp0, wp0→wp1, etc.
      const allPoints = [pos, ...waypoints]
      const segments = []
      const allPolylines = []
      try {
        for (let i = 0; i < allPoints.length - 1; i++) {
          const from = allPoints[i]
          const to   = allPoints[i + 1]
          const coords = `${from[1]},${from[0]};${to[1]},${to[0]}`
          const r = await fetch(`${OSRM_URL}/${coords}?overview=full&geometries=geojson&steps=true`)
          const data = await r.json()
          if (data.routes?.[0]) {
            const seg = data.routes[0].geometry.coordinates.map(([lng, lat]) => [lat, lng])
            allPolylines.push(seg)
          }
        }
        setStopRoutes(allPolylines)
        // Full flattened polyline for main route display
        const flat = allPolylines.flat()
        if (flat.length) setRoute(flat)
        // Steps from first segment
        const firstR = await fetch(`${OSRM_URL}/${pos[1]},${pos[0]};${waypoints[0][1]},${waypoints[0][0]}?overview=full&geometries=geojson&steps=true`)
        const firstD = await firstR.json()
        if (firstD.routes?.[0]) {
          const steps = firstD.routes[0].legs?.[0]?.steps || []
          setRouteSteps(steps)
          setStepIdx(0)
          const totDist = allPolylines.reduce((a, seg) => {
            // rough approx from first+last
            return a
          }, firstD.routes[0].distance)
          setRouteInfo({ distance: firstD.routes[0].distance, duration: firstD.routes[0].duration })
          setRouteProvider('osrm')
        }
      } catch (e) {
        console.warn('[multi-stop route]', e)
        fetchRoute(pos, final)
      }
    }
    askRouteMind(final)
  }, [pos, fetchRoute, geocodeAddr, profile.id])

  const completeJob = useCallback((job) => {
    updateJobStatus(job.id, 'completed', profile.id)
    setJobs(prev => prev.filter(j => j.id !== job.id))
    if (activeJob?.id === job.id) {
      setActiveJob(null)
      clearRoute()
    }
    // Notify fleet
    try {
      sendFleetReply(profile.id, `Job completed: ${job.title}`, false)
    } catch {}
  }, [activeJob, profile.id])

  // ── Computed ──────────────────────────────────────────────────
  const fatigueColor = alertLevel === 'danger' ? 'text-red-400' : alertLevel === 'warn' ? 'text-amber-400' : 'text-emerald-400'
  const fatigueBorder= alertLevel === 'danger' ? 'border-red-500/30 bg-red-500/8' : alertLevel === 'warn' ? 'border-amber-500/30 bg-amber-500/8' : 'border-emerald-500/20 bg-emerald-500/5'
  const currentStep  = routeSteps[stepIdx]
  const distToNext   = currentStep?.distance ? fmtDist(currentStep.distance) : null

  const TABS = [
    { key: 'map',    label: 'Nav',    icon: 'Map'           },
    { key: 'safety', label: 'Safety', icon: 'Shield'        },
    { key: 'chat',   label: 'Fleet',  icon: 'MessageSquare', badge: unread },
    { key: 'jobs',   label: 'Jobs',   icon: 'Package',       badge: jobs.filter(j=>j.status==='pending'||!j.status).length },
  ]

  // ════════════════════════════════════════════════════════════
  return (
    <div
      ref={appRef}
      className="h-screen w-screen bg-[#060b18] flex flex-col overflow-hidden text-white"
      style={{
        WebkitUserSelect: 'none',
        userSelect: 'none',
        // Ensure proper sizing in fullscreen on all browsers
        ...(isFullscreen ? { position: 'fixed', inset: 0, zIndex: 9999, height: '100dvh', width: '100dvw' } : {}),
      }}>

      {/* ── Top Bar ──────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-2 bg-[#0d1426] border-b border-violet-500/15 flex-shrink-0">
        {/* Logo + vehicle */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="w-7 h-7 rounded-lg bg-violet-500/15 border border-violet-500/25 flex items-center justify-center">
            <Icon name="Navigation" size={13} className="text-violet-400" />
          </div>
          <div>
            <div className="text-xs font-bold leading-none text-white">AP3X</div>
            <div className="text-2xs text-slate-600 font-mono leading-none">{profile.vehicle_reg}</div>
          </div>
        </div>

        <div className="flex-1" />

        {/* Active routing provider badge */}
        {routeProvider && (
          <div className="flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-800/50 bg-slate-900/60">
            <Icon name="Route" size={9} className={
              routeProvider === 'graphhopper' ? 'text-emerald-400' :
              routeProvider === 'google'      ? 'text-blue-400' :
              'text-slate-500'
            } />
            <span className="text-2xs font-mono text-slate-500 capitalize">{
              routeProvider === 'graphhopper' ? 'GH' :
              routeProvider === 'google'      ? 'GMaps' :
              'OSM'
            }</span>
          </div>
        )}

        {/* Speed pill */}
        <div className={`flex items-center gap-1 px-2 py-1 rounded-lg border text-xs font-mono tabular-nums ${
          speed > 90 ? 'border-red-500/40 bg-red-500/10 text-red-400' :
          speed > 70 ? 'border-amber-500/40 bg-amber-500/10 text-amber-400' :
          'border-slate-700/60 bg-slate-900/50 text-white'
        }`}>
          <span className="text-base font-bold">{speed}</span>
          <span className="text-slate-600 text-2xs">km/h</span>
        </div>

        {/* Fatigue badge */}
        <div className={`flex items-center gap-1 px-2 py-1 rounded-lg border text-2xs ${fatigueBorder}`}>
          <Icon name="Eye" size={10} className={fatigueColor} />
          <span className={`font-mono font-semibold ${fatigueColor}`}>{fatigueScore}%</span>
        </div>

        {/* GPS dot */}
        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
          gpsState === 'active' ? 'bg-emerald-400 animate-pulse' :
          gpsState === 'denied' ? 'bg-red-400' : 'bg-amber-400'
        }`} />

        {/* Fullscreen toggle */}
        <button
          onClick={isFullscreen ? exitFullscreen : enterFullscreen}
          className="w-7 h-7 flex items-center justify-center rounded-lg border border-slate-800 text-slate-600 hover:text-violet-400 hover:border-violet-500/30 transition-colors"
          title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}>
          <Icon name={isFullscreen ? 'Minimize2' : 'Maximize2'} size={12} />
        </button>

        {/* Logout */}
        <button onClick={onLogout} className="text-slate-700 hover:text-slate-400 transition-colors ml-1">
          <Icon name="LogOut" size={14} />
        </button>
      </div>

      {/* ── Alert Banner ─────────────────────────────────────── */}
      {activeAlert && (
        <div className={`flex items-center gap-2 px-4 py-2.5 flex-shrink-0 text-xs font-medium animate-pulse-once ${
          activeAlert.type === 'fatigue_critical' || activeAlert.type === ALERT_TYPE.SPEEDING
            ? 'bg-red-500/15 border-b border-red-500/30 text-red-200'
            : 'bg-amber-500/10 border-b border-amber-500/25 text-amber-200'
        }`}>
          <Icon name="AlertTriangle" size={13} className="flex-shrink-0" />
          <span className="flex-1 text-xs">{activeAlert.text}</span>
          <button onClick={() => setActiveAlert(null)} className="text-slate-500 hover:text-white">
            <Icon name="X" size={12} />
          </button>
        </div>
      )}

      {/* ── Tab Bar — hidden in fullscreen map mode for immersive driving ── */}
      {!(isFullscreen && tab === 'map') && (
        <div className="flex border-b border-slate-800/60 flex-shrink-0 bg-[#0a1020]">
          {TABS.map(t => (
            <button key={t.key}
              onClick={() => { setTab(t.key); if (t.key === 'chat') setUnread(0) }}
              className={`flex-1 flex items-center justify-center gap-1 py-2.5 text-2xs font-semibold uppercase tracking-wider transition-colors border-b-2 relative ${
                tab === t.key ? 'text-violet-400 border-violet-400 bg-violet-500/5' : 'text-slate-600 border-transparent hover:text-slate-400'
              }`}>
              <Icon name={t.icon} size={12} />
              <span>{t.label}</span>
              {t.badge > 0 && (
                <span className="absolute top-1.5 right-2 text-2xs bg-red-500 text-white px-1 rounded-full leading-none py-0.5">{t.badge}</span>
              )}
            </button>
          ))}
        </div>
      )}
      {/* Fullscreen map: show floating tab switcher strip at bottom */}
      {isFullscreen && tab === 'map' && (
        <div className="absolute bottom-0 left-0 right-0 z-[1001] flex border-t border-slate-800/40 bg-[#0a1020]/85 backdrop-blur-sm">
          {TABS.map(t => (
            <button key={t.key}
              onClick={() => { setTab(t.key); if (t.key === 'chat') setUnread(0) }}
              className={`flex-1 flex items-center justify-center gap-1 py-2 text-2xs font-semibold uppercase tracking-wider transition-colors border-t-2 relative ${
                tab === t.key ? 'text-violet-400 border-violet-400' : 'text-slate-700 border-transparent'
              }`}>
              <Icon name={t.icon} size={11} />
              {t.badge > 0 && (
                <span className="absolute top-1 right-2 text-2xs bg-red-500 text-white px-1 rounded-full leading-none py-0.5">{t.badge}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* ══════════ MAP TAB ══════════ */}
      {tab === 'map' && (
        <div className="flex-1 relative overflow-hidden">

          {/* Step instruction panel */}
          {currentStep && !showSearch && (
            <div className="absolute top-2 left-2 right-2 z-[1000]">
              <div className="flex items-center gap-3 bg-[#0a0f1e]/95 backdrop-blur border border-violet-500/30 rounded-xl px-3 py-2.5 shadow-xl">
                <div className="w-9 h-9 rounded-lg bg-violet-500/15 border border-violet-500/25 flex items-center justify-center flex-shrink-0">
                  <Icon name={stepIcon(currentStep)} size={16} className="text-violet-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-white leading-snug line-clamp-2">
                    {stepInstruction(currentStep)}
                  </div>
                  {distToNext && (
                    <div className="text-2xs text-slate-500 mt-0.5">in {distToNext}</div>
                  )}
                </div>
                <button onClick={() => setShowSearch(true)} className="text-slate-600 hover:text-slate-300 flex-shrink-0">
                  <Icon name="Search" size={14} />
                </button>
              </div>
              {/* Route summary strip */}
              {routeInfo && (
                <div className="flex items-center gap-3 bg-[#0d1426]/90 backdrop-blur border border-slate-800/60 rounded-xl px-3 py-1.5 mt-1 shadow-lg">
                  <Icon name="MapPin" size={11} className="text-cyan-400 flex-shrink-0" />
                  <span className="text-2xs text-slate-400 flex-1 truncate">{destName}</span>
                  <span className="text-2xs text-cyan-400 tabular-nums">{fmtDist(routeInfo.distance)}</span>
                  <span className="text-2xs text-slate-600">·</span>
                  <span className="text-2xs text-violet-400 tabular-nums">{fmtDur(routeInfo.duration)}</span>
                  <button onClick={clearRoute} className="text-slate-600 hover:text-red-400 ml-1">
                    <Icon name="X" size={12} />
                  </button>
                </div>
              )}
              {/* Multi-stop strip */}
              {jobStops.length > 1 && (
                <div className="flex items-center gap-1.5 bg-[#0d1426]/90 backdrop-blur border border-amber-500/20 rounded-xl px-3 py-1.5 mt-1 overflow-x-auto scrollbar-none shadow-lg">
                  {jobStops.map((stop, i) => (
                    <div key={i} className="flex items-center gap-1 flex-shrink-0">
                      <div className="w-4 h-4 rounded-full bg-amber-500 flex items-center justify-center text-[8px] font-bold text-black">{stop.idx}</div>
                      <span className="text-2xs text-slate-400 max-w-[80px] truncate">{stop.name}</span>
                      {i < jobStops.length - 1 && <Icon name="ChevronRight" size={10} className="text-slate-700 flex-shrink-0" />}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Search overlay */}
          {showSearch || (!currentStep && !destination) ? (
            <div className="absolute top-2 left-2 right-2 z-[1001]">
              {showSearch || !destination ? (
                <div className="bg-[#0d1426]/98 backdrop-blur border border-violet-500/25 rounded-xl shadow-2xl overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-2.5">
                    <Icon name="Search" size={13} className="text-violet-400 flex-shrink-0" />
                    <input autoFocus value={searchQ} onChange={e => setSearchQ(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && doSearch()}
                      placeholder="Search destination…"
                      className="flex-1 bg-transparent text-sm text-white placeholder-slate-600 focus:outline-none" />
                    {searching
                      ? <Icon name="Loader2" size={13} className="text-violet-400 animate-spin" />
                      : searchQ.trim()
                        ? <button onClick={doSearch}><Icon name="ArrowRight" size={13} className="text-violet-400" /></button>
                        : null}
                    {showSearch && (
                      <button onClick={() => { setShowSearch(false); setSearchRes([]) }} className="ml-1">
                        <Icon name="X" size={13} className="text-slate-500" />
                      </button>
                    )}
                  </div>
                  {searchRes.length > 0 && (
                    <div className="border-t border-slate-800/60 max-h-60 overflow-y-auto">
                      {searchRes.map((r, i) => (
                        <button key={i} onClick={() => selectDest(r)}
                          className="w-full text-left flex items-start gap-2 px-3 py-2.5 hover:bg-violet-500/10 border-b border-slate-800/30 last:border-0 transition-colors">
                          <Icon name="MapPin" size={12} className="text-violet-400 mt-0.5 flex-shrink-0" />
                          <div>
                            <div className="text-xs text-white line-clamp-1">{r.display_name.split(',').slice(0, 2).join(', ')}</div>
                            <div className="text-2xs text-slate-600 line-clamp-1">{r.display_name.split(',').slice(2, 5).join(', ')}</div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Routing spinner */}
          {routing && (
            <div className="absolute top-2 left-1/2 -translate-x-1/2 z-[1002] flex items-center gap-2 bg-[#0d1426]/95 border border-violet-500/25 rounded-xl px-4 py-2">
              <Icon name="Loader2" size={13} className="text-violet-400 animate-spin" />
              <span className="text-xs text-slate-400">Calculating route…</span>
            </div>
          )}

          {/* Leaflet map */}
          {pos ? (
            <MapContainer center={pos} zoom={16} style={{ width: '100%', height: '100%' }} zoomControl={false}>
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              {/* Reactive polylines — imperative Leaflet for reliable re-rendering */}
              <LivePolylines route={route} stopRoutes={stopRoutes} />
              {/* 🚛 Driver position — truck follows polyline */}
              <Marker position={pos} icon={DRIVER_ICON} />
              {/* GPS accuracy ring */}
              {accuracy && accuracy < 200 && (
                <Circle center={pos} radius={accuracy}
                  pathOptions={{ color: '#a78bfa', fillColor: '#a78bfa', fillOpacity: 0.05, weight: 1, dashArray: '4 4' }} />
              )}
              {/* Job stop markers (numbered) — shown when job is active with stops */}
              {jobStops.length > 0
                ? jobStops.map((stop, i) => (
                    <Marker key={`stop-${i}`} position={[stop.lat, stop.lng]} icon={makeStopIcon(stop.idx)} />
                  ))
                : destination && <Marker position={destination} icon={DEST_ICON} />
              }
              {/* Map follow controller */}
              <MapController pos={pos} follow={follow} zoom={16} />
            </MapContainer>
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              {gpsState === 'denied' ? (
                <>
                  <Icon name="MapPinOff" size={36} className="text-red-400/40" />
                  <div className="text-sm text-red-400">GPS access denied</div>
                  <div className="text-xs text-slate-600 text-center px-8">Enable location permission in your browser and reload the page.</div>
                </>
              ) : (
                <>
                  <Icon name="Loader2" size={32} className="text-violet-400 animate-spin" />
                  <div className="text-sm text-slate-400">Acquiring GPS signal…</div>
                </>
              )}
            </div>
          )}

          {/* Map overlay controls */}
          <div className="absolute right-3 bottom-28 z-[1000] flex flex-col gap-2">
            {/* Fullscreen toggle — always visible on the map */}
            <button
              onClick={isFullscreen ? exitFullscreen : enterFullscreen}
              className="w-10 h-10 rounded-xl border shadow-lg flex items-center justify-center transition-colors bg-[#0d1426]/90 border-slate-700 text-slate-400 hover:border-violet-500/40 hover:text-violet-400"
              title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'}>
              <Icon name={isFullscreen ? 'Minimize2' : 'Maximize2'} size={16} />
            </button>
            {/* Follow toggle */}
            <button onClick={() => setFollow(f => !f)}
              className={`w-10 h-10 rounded-xl border shadow-lg flex items-center justify-center transition-colors ${
                follow ? 'bg-violet-500/25 border-violet-500/50 text-violet-400' : 'bg-[#0d1426]/90 border-slate-700 text-slate-500'
              }`}>
              <Icon name="Crosshair" size={16} />
            </button>
          </div>

          {/* Bottom HUD */}
          <div className="absolute bottom-3 left-3 right-3 z-[1000] flex items-end justify-between pointer-events-none">
            {/* Speed + trip */}
            <div className="flex flex-col gap-1">
              <div className="bg-[#0d1426]/90 border border-slate-800/80 rounded-xl px-3 py-2 flex items-end gap-1.5 pointer-events-auto">
                <span className={`text-3xl font-bold font-mono tabular-nums leading-none ${
                  speed > 90 ? 'text-red-400' : speed > 70 ? 'text-amber-400' : 'text-white'
                }`}>{speed}</span>
                <span className="text-xs text-slate-600 mb-0.5">km/h</span>
              </div>
              <div className="bg-[#0d1426]/85 border border-slate-800/60 rounded-lg px-3 py-1 pointer-events-auto">
                <span className="text-2xs text-slate-500 font-mono">Trip: {fmtDist(tripDist)}</span>
              </div>
            </div>

            {/* OSM attribution */}
            <div className="pointer-events-auto">
              <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer"
                className="text-2xs text-slate-700 hover:text-slate-500">© OpenStreetMap</a>
            </div>
          </div>
        </div>
      )}

      {/* ══════════ SAFETY TAB ══════════ */}
      {tab === 'safety' && (
        <div className="flex-1 overflow-y-auto scrollbar-none p-4 space-y-4">

          {/* Live metric grid */}
          <div className="grid grid-cols-2 gap-3">

            {/* Fatigue */}
            <div className={`flex flex-col items-center gap-1.5 p-4 rounded-xl border ${fatigueBorder}`}>
              <Icon name="Eye" size={20} className={fatigueColor} />
              <div className={`text-4xl font-bold font-mono tabular-nums leading-none ${fatigueColor}`}>{fatigueScore}</div>
              <div className="text-2xs text-slate-500">Fatigue Score /100</div>
              <div className={`text-2xs font-bold uppercase tracking-widest ${fatigueColor}`}>
                {alertLevel === 'danger' ? '⚠ CRITICAL' : alertLevel === 'warn' ? '△ WARNING' : '✓ SAFE'}
              </div>
            </div>

            {/* Session timer */}
            <div className={`flex flex-col items-center gap-1.5 p-4 rounded-xl border ${
              sessionSecs >= EU_DRIVE_SECS ? 'border-red-500/30 bg-red-500/5' : 'border-slate-800/60 bg-slate-900/40'
            }`}>
              <Icon name="Clock" size={20} className={sessionSecs >= EU_DRIVE_SECS ? 'text-red-400' : 'text-cyan-400'} />
              <div className={`text-2xl font-bold font-mono tabular-nums leading-none ${sessionSecs >= EU_DRIVE_SECS ? 'text-red-400' : 'text-white'}`}>
                {fmtClock(sessionSecs)}
              </div>
              <div className="text-2xs text-slate-500">Session Time</div>
              <div className={`text-2xs font-semibold ${sessionSecs >= EU_DRIVE_SECS ? 'text-red-400' : 'text-slate-600'}`}>
                {sessionSecs >= EU_DRIVE_SECS
                  ? 'BREAK REQUIRED NOW'
                  : `Break in ${fmtDur(Math.max(0, EU_DRIVE_SECS - sessionSecs))}`}
              </div>
            </div>

            {/* Speed */}
            <div className={`flex flex-col items-center gap-1.5 p-4 rounded-xl border ${
              speed > 90 ? 'border-red-500/30 bg-red-500/5' :
              speed > 70 ? 'border-amber-500/30 bg-amber-500/5' :
              'border-slate-800/60 bg-slate-900/40'
            }`}>
              <Icon name="Gauge" size={20} className={speed > 90 ? 'text-red-400' : speed > 70 ? 'text-amber-400' : 'text-cyan-400'} />
              <div className={`text-4xl font-bold font-mono tabular-nums leading-none ${speed > 90 ? 'text-red-400' : speed > 70 ? 'text-amber-400' : 'text-white'}`}>{speed}</div>
              <div className="text-2xs text-slate-500">km/h</div>
            </div>

            {/* Trip distance */}
            <div className="flex flex-col items-center gap-1.5 p-4 rounded-xl border border-slate-800/60 bg-slate-900/40">
              <Icon name="Route" size={20} className="text-violet-400" />
              <div className="text-2xl font-bold font-mono tabular-nums leading-none text-white">{fmtDist(tripDist)}</div>
              <div className="text-2xs text-slate-500">Trip Distance</div>
              {heading != null && (
                <div className="text-2xs text-slate-600 font-mono">{heading}° {bearingLabel(heading)}</div>
              )}
            </div>
          </div>

          {/* Break button */}
          <button onClick={() => {
            resetSession()
            try { sendFleetReply(profile.id, `${profile.full_name} has taken a break — session timer reset`, false) } catch {}
          }}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/15 text-emerald-400 text-sm font-semibold transition-colors">
            <Icon name="Coffee" size={15} />
            Log Break Taken — Reset Session Timer
          </button>

          {/* Apex Sentinel AI panel */}
          <div className="bg-[#0d1426] border border-violet-500/15 rounded-xl overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-800/60">
              <div className="w-6 h-6 rounded bg-violet-500/15 border border-violet-500/25 flex items-center justify-center">
                <Icon name="Shield" size={12} className="text-violet-400" />
              </div>
              <span className="text-sm font-semibold text-violet-300">Apex Sentinel AI</span>
              {sentinelBusy && <Icon name="Loader2" size={12} className="text-violet-400 animate-spin ml-auto" />}
            </div>

            {/* Sentinel quick-action prompts */}
            {sentinelLog.length === 0 && (
              <div className="px-3 pt-3 pb-2 flex flex-wrap gap-1.5">
                {[
                  'Am I safe to keep driving?',
                  'What does UK law say about my break requirements?',
                  'How do I reduce fatigue on long hauls?',
                ].map(q => (
                  <button key={q} onClick={() => askSentinel(q)}
                    className="text-2xs bg-slate-800/60 border border-slate-700/50 text-slate-400 hover:text-violet-400 hover:border-violet-500/30 rounded-lg px-2.5 py-1.5 transition-colors text-left">
                    {q}
                  </button>
                ))}
              </div>
            )}

            {/* Message log */}
            <div className="max-h-48 overflow-y-auto p-3 space-y-2 scrollbar-none">
              {sentinelLog.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[88%] text-xs px-3 py-2 rounded-xl leading-relaxed ${
                    m.role === 'user'
                      ? 'bg-violet-500/15 border border-violet-500/20 text-violet-100'
                      : m.module === 'routemind'
                      ? 'bg-cyan-500/8 border border-cyan-500/20 text-cyan-100'
                      : 'bg-slate-800/60 border border-slate-700/40 text-slate-300'
                  }`}>
                    {m.role === 'assistant' && (
                      <div className="flex items-center gap-1 mb-1">
                        <Icon name={m.module === 'routemind' ? 'Navigation2' : 'Shield'} size={9}
                          className={m.module === 'routemind' ? 'text-cyan-400' : 'text-violet-400'} />
                        <span className={`text-2xs font-bold uppercase tracking-wider ${m.module === 'routemind' ? 'text-cyan-400' : 'text-violet-400'}`}>
                          {m.module === 'routemind' ? 'RouteMind' : 'Sentinel'}
                        </span>
                      </div>
                    )}
                    {m.text}
                  </div>
                </div>
              ))}
            </div>

            {/* Input */}
            <div className="flex gap-2 p-3 border-t border-slate-800/50">
              <input value={sentinelQ} onChange={e => setSentinelQ(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && askSentinel(sentinelQ)}
                placeholder="Ask Sentinel a safety question…"
                disabled={sentinelBusy}
                className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 focus:border-violet-500 focus:outline-none disabled:opacity-50" />
              <button onClick={() => askSentinel(sentinelQ)} disabled={!sentinelQ.trim() || sentinelBusy}
                className="w-9 h-9 flex items-center justify-center bg-violet-500/15 border border-violet-500/25 rounded-lg text-violet-400 hover:bg-violet-500/25 disabled:opacity-30 transition-colors">
                <Icon name="Send" size={13} />
              </button>
            </div>
          </div>

          {/* Alert history */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-2xs text-slate-600 font-semibold uppercase tracking-wider">Alert History</span>
              <span className="text-2xs text-slate-700">{safetyAlerts.length} this session</span>
            </div>
            {safetyAlerts.length === 0 ? (
              <div className="text-xs text-slate-700 text-center py-6 border border-slate-800/40 rounded-xl">
                ✓ No alerts this session
              </div>
            ) : (
              <div className="space-y-1.5">
                {safetyAlerts.slice(0, 20).map((a, i) => (
                  <div key={a.id || i} className="flex items-start gap-2 bg-slate-900/50 border border-slate-800/40 rounded-lg px-3 py-2">
                    <Icon name="AlertTriangle" size={11}
                      className={`flex-shrink-0 mt-0.5 ${a.type === 'fatigue_critical' || a.severity === 'critical' ? 'text-red-400' : 'text-amber-400'}`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-slate-300 leading-snug">{a.text}</div>
                      <div className="text-2xs text-slate-700 font-mono mt-0.5">
                        {new Date(a.ts).toLocaleTimeString('en-GB', { hour12: false })}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════ CHAT TAB ══════════ */}
      {tab === 'chat' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-3 space-y-2.5 scrollbar-none">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-700">
                <Icon name="MessageSquare" size={32} className="opacity-20" />
                <div className="text-xs text-center">No messages yet.<br />Messages with fleet ops will appear here.</div>
              </div>
            ) : messages.map((msg, i) => (
              <div key={msg.id || i} className={`flex ${msg.from === 'driver' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[82%] flex flex-col gap-0.5 ${msg.from === 'driver' ? 'items-end' : 'items-start'}`}>
                  <div className={`flex items-center gap-1 px-0.5`}>
                    <Icon name={msg.from === 'driver' ? 'User' : msg.from === 'ai' ? 'Cpu' : 'Radio'} size={9}
                      className={msg.from === 'driver' ? 'text-violet-400' : msg.from === 'ai' ? 'text-cyan-400' : 'text-emerald-400'} />
                    <span className="text-2xs text-slate-600">
                      {msg.from === 'driver' ? 'You' : msg.from === 'ai' ? 'Apex AI' : 'Fleet Ops'}
                    </span>
                    <span className="text-2xs text-slate-700 font-mono">
                      {new Date(msg.ts).toLocaleTimeString('en-GB', { hour12: false, hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div className={`px-3 py-2 rounded-2xl text-xs leading-relaxed ${
                    msg.from === 'driver'
                      ? 'bg-violet-500/15 border border-violet-500/20 text-violet-100 rounded-tr-sm'
                      : msg.from === 'ai'
                      ? 'bg-cyan-500/10 border border-cyan-500/20 text-cyan-100 rounded-tl-sm'
                      : 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-100 rounded-tl-sm'
                  }`}>{msg.text}</div>
                </div>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>

          <div className="flex gap-2 p-3 border-t border-slate-800/50 bg-[#0a1020] flex-shrink-0">
            <input value={chatInput} onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendChat()}
              placeholder="Message to fleet ops…"
              className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:border-violet-500 focus:outline-none" />
            <button onClick={sendChat} disabled={!chatInput.trim()}
              className="w-11 h-11 flex items-center justify-center bg-violet-500/15 border border-violet-500/25 rounded-xl text-violet-400 hover:bg-violet-500/25 disabled:opacity-30 transition-colors">
              <Icon name="Send" size={15} />
            </button>
          </div>
        </div>
      )}

      {/* ══════════ JOBS TAB ══════════ */}
      {tab === 'jobs' && (
        <div className="flex-1 overflow-y-auto scrollbar-none p-4 space-y-3">

          {/* Fleet connect + refresh row */}
          <div className="flex gap-2">
            <button onClick={() => setJobs(loadJobs(profile.id))}
              className="flex-1 flex items-center justify-center gap-2 py-2 rounded-xl border border-slate-800/60 text-slate-600 hover:text-slate-400 hover:border-slate-700 text-xs transition-colors">
              <Icon name="RefreshCw" size={11} />
              Refresh
            </button>
            <button onClick={() => setShowFleetConnect(v => !v)}
              className="flex-1 flex items-center justify-center gap-2 py-2 rounded-xl border border-violet-500/25 bg-violet-500/5 text-violet-400 hover:bg-violet-500/10 text-xs font-semibold transition-colors">
              <Icon name="Link2" size={11} />
              {showFleetConnect ? 'Cancel' : 'Link to Fleet'}
            </button>
          </div>

          {/* Fleet link code entry */}
          {showFleetConnect && (
            <div className="bg-[#0d1426] border border-violet-500/20 rounded-xl p-4 space-y-3">
              <div className="flex items-start gap-2">
                <Icon name="KeyRound" size={14} className="text-violet-400 flex-shrink-0 mt-0.5" />
                <div>
                  <div className="text-xs font-semibold text-white">Enter Fleet Pairing Code</div>
                  <div className="text-2xs text-slate-500 mt-0.5">Get a 6-digit code from your fleet manager to receive jobs and connect to the fleet dashboard.</div>
                </div>
              </div>
              <input
                value={fleetLinkCode}
                onChange={e => setFleetLinkCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                inputMode="numeric" maxLength={6}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-2xl font-mono tracking-[0.5em] text-[#4a4f5a] placeholder-slate-800 text-center focus:border-violet-500 focus:outline-none"
              />
              {fleetLinkError && (
                <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{fleetLinkError}</div>
              )}
              {fleetLinkSuccess && (
                <div className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
                  ✓ Linked to fleet as <span className="font-semibold">{profile.full_name}</span> · {profile.vehicle_reg}
                </div>
              )}
              <button
                onClick={submitFleetCode}
                disabled={fleetLinkCode.length !== 6}
                className="w-full py-2.5 rounded-xl bg-violet-500 hover:bg-violet-600 disabled:opacity-40 text-white text-sm font-semibold transition-colors">
                Connect to Fleet
              </button>
            </div>
          )}

          {jobs.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-12 text-slate-700">
              <Icon name="Package" size={36} className="opacity-15" />
              <div className="text-xs text-center text-slate-600">No jobs assigned.<br />Fleet ops will dispatch jobs from the dashboard.</div>
            </div>
          ) : (
            jobs.map(job => {
              const isActive = activeJob?.id === job.id
              const priColor = {
                urgent: 'text-red-400 border-red-500/30 bg-red-500/5',
                high:   'text-amber-400 border-amber-500/30 bg-amber-500/5',
                normal: 'text-cyan-400 border-cyan-500/30 bg-cyan-500/5',
                low:    'text-slate-500 border-slate-700 bg-slate-900/40',
              }[job.priority] || 'text-slate-500 border-slate-700 bg-slate-900/40'

              return (
                <div key={job.id}
                  className={`bg-[#0d1426] border rounded-xl p-4 transition-all ${
                    isActive ? 'border-violet-500/40 shadow-[0_0_16px_rgba(139,92,246,0.1)]' : 'border-slate-800/60'
                  }`}>

                  {/* Header */}
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Icon name="Package" size={13} className={isActive ? 'text-violet-400' : 'text-slate-600'} />
                      <span className="text-xs font-semibold text-white truncate">{job.title}</span>
                    </div>
                    <span className={`text-2xs px-2 py-0.5 rounded border font-bold uppercase flex-shrink-0 ${priColor}`}>
                      {job.priority || 'normal'}
                    </span>
                  </div>

                  {/* Details */}
                  {(job.destination || job.dropoff_address || job.address) && (
                    <div className="flex items-start gap-1.5 text-xs text-slate-500 mb-1">
                      <Icon name="MapPin" size={10} className="text-violet-400/60 mt-0.5 flex-shrink-0" />
                      <span className="line-clamp-1">{job.destination || job.dropoff_address || job.address}</span>
                    </div>
                  )}
                  {job.notes && (
                    <div className="text-2xs text-slate-600 mb-3 line-clamp-2">{job.notes}</div>
                  )}

                  {/* ETA if active and routing */}
                  {isActive && routeInfo && (
                    <div className="flex items-center gap-2 mb-3 px-2 py-1.5 rounded-lg bg-cyan-500/8 border border-cyan-500/15">
                      <Icon name="Navigation2" size={11} className="text-cyan-400" />
                      <span className="text-2xs text-cyan-300">{fmtDist(routeInfo.distance)}</span>
                      <span className="text-2xs text-slate-600">·</span>
                      <span className="text-2xs text-violet-300">{fmtDur(routeInfo.duration)} ETA</span>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex gap-2">
                    {!isActive ? (
                      <button onClick={() => navigateToJob(job)}
                        className="flex-1 py-2 text-xs font-semibold rounded-lg bg-violet-500/15 border border-violet-500/25 text-violet-400 hover:bg-violet-500/25 transition-colors flex items-center justify-center gap-1.5">
                        <Icon name="Navigation2" size={12} />
                        Navigate
                      </button>
                    ) : (
                      <>
                        <button onClick={() => { setActiveJob(null); clearRoute() }}
                          className="flex-1 py-2 text-xs font-semibold rounded-lg bg-slate-800 border border-slate-700 text-slate-400 hover:text-slate-200 transition-colors">
                          Cancel
                        </button>
                        <button onClick={() => completeJob(job)}
                          className="flex-1 py-2 text-xs font-semibold rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 transition-colors flex items-center justify-center gap-1.5">
                          <Icon name="CheckCircle" size={12} />
                          Complete
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════
//  ROOT — Auth gate
// ══════════════════════════════════════════════════════════════
export default function DriverApp() {
  const [profile,  setProfile]  = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_CREDS) || 'null') } catch { return null }
  })
  const [unlocked, setUnlocked] = useState(false)

  const reset = () => {
    localStorage.removeItem(STORAGE_CREDS)
    setProfile(null)
    setUnlocked(false)
  }

  if (!profile)  return <SetupScreen onReady={p => { setProfile(p); setUnlocked(true) }} />
  if (!unlocked) return <LoginScreen profile={profile} onLogin={() => setUnlocked(true)} onReset={reset} />
  return <DriverAppMain profile={profile} onLogout={() => setUnlocked(false)} />
}
