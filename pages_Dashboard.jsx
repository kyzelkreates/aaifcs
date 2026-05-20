/**
 * ============================================================
 * APEX AI — Fleet Command Dashboard
 * Real-time data from localStorage. Empty state prompts add data.
 * Driver App panel: send nav app link + live telemetry feed.
 * ============================================================
 */

import { useState, useEffect, useCallback, useRef, Suspense, lazy } from 'react'
import { useNavigate } from 'react-router-dom'
import Icon from './components_ui_Icon'
import Badge from './components_ui_Badge'
import StatusDot from './components_ui_StatusDot'
import TelemetryValue from './components_ui_TelemetryValue'
import { useFleetStore, useDriverStore, useAppStore } from './core_storage'
import { fleetService, VEHICLE_STATUS } from './services_fleet_fleetService'
import { driverService, DRIVER_STATUS } from './services_drivers_driverService'
import { safetyService } from './services_safety_safetyService'
import { telemetryService } from './services_realtime_telemetryService'
import {
  listenForDriverTelemetry, listenForDriverMessages, sendFleetReply,
  getDriverMessageHistory, generatePairingCode, getActivePairingCodes,
  revokePairingCode, listenForDriverAIReports, getDriverAIReportHistory,
  listenForPairingEvents,
  sendViaWiFiDirect, sendViaNFC, getPairingCodeQR,
  copyPairingCode, sendPairingCodeEmail, sendPairingCodeWhatsApp,
} from './services_sync_driverSyncService'
import { ROUTES } from './config_routes'
import { useAIChat } from './modules_ai_useAIChat'
import { fleetLearning }   from './intel_fleetLearning'
import { complianceEngine } from './intel_complianceEngine'
import { safetyEngine }     from './intel_safetyEngine'
import { driverLearning }   from './intel_driverLearning'
import { formatDateTime } from './utils_format'

const ApexMap = lazy(() => import('./modules_navigation_ApexMap'))

// ─── Live clock ───────────────────────────────────────────────
function LiveClock() {
  const [time, setTime] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return (
    <div className="text-right">
      <div className="font-mono text-2xl font-bold text-white tabular-nums tracking-tight">
        {time.toLocaleTimeString('en-GB', { hour12: false })}
      </div>
      <div className="text-xs text-slate-500 mt-0.5">
        {time.toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
      </div>
    </div>
  )
}

// ─── KPI Card ─────────────────────────────────────────────────
function KpiCard({ label, value, sub, icon, color, bg, border, pulse, onClick }) {
  return (
    <div onClick={onClick}
      className={`${bg} border ${border} rounded-xl p-4 cursor-pointer hover:brightness-110 transition-all group relative overflow-hidden`}>
      {pulse && <div className="absolute top-3 right-3 w-2 h-2 rounded-full bg-red-400 animate-pulse" />}
      <div className="flex items-center justify-between mb-3">
        <span className="text-2xs text-slate-500 font-semibold tracking-widest uppercase">{label}</span>
        <div className={`w-8 h-8 rounded-lg ${bg} border ${border} flex items-center justify-center group-hover:scale-105 transition-transform`}>
          <Icon name={icon} size={14} className={color} />
        </div>
      </div>
      <div className={`font-mono text-3xl font-bold ${color} tabular-nums`}>{value ?? '—'}</div>
      {sub && <div className="text-2xs text-slate-600 mt-1.5">{sub}</div>}
    </div>
  )
}

// ─── Alert Row ────────────────────────────────────────────────
function AlertRow({ alert }) {
  const cfg = {
    critical: 'text-red-300 bg-red-500/8 border-red-500/25',
    high:     'text-red-400 bg-red-500/5 border-red-500/10',
    medium:   'text-amber-400 bg-amber-500/5 border-amber-500/20',
    low:      'text-slate-400 bg-slate-800/30 border-slate-800/60',
  }[alert.severity] || 'text-slate-400 bg-slate-800/30 border-slate-800/60'
  return (
    <div className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border ${cfg}`}>
      <Icon name="AlertTriangle" size={12} className="flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium truncate capitalize">{alert.type?.replace(/_/g, ' ')}</div>
        <div className="text-2xs text-slate-600 truncate">{alert.driver_name || 'Unknown'} · {alert.vehicle_reg || '—'}</div>
      </div>
      <span className="text-2xs text-slate-600 flex-shrink-0 font-mono">
        {new Date(alert.created_at).toLocaleTimeString('en-GB', { hour12: false, hour: '2-digit', minute: '2-digit' })}
      </span>
    </div>
  )
}

// ─── Vehicle Row ──────────────────────────────────────────────
function VehicleRow({ vehicle, onClick }) {
  const dot = vehicle.status === 'active' ? 'online' : vehicle.status === 'idle' ? 'idle' : vehicle.status === 'maintenance' ? 'warning' : 'offline'
  return (
    <div onClick={onClick}
      className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-slate-800/40 cursor-pointer transition-colors group">
      <StatusDot status={dot} />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-mono font-semibold text-white group-hover:text-cyan-200 transition-colors">{vehicle.reg_number}</div>
        <div className="text-2xs text-slate-600 truncate">{vehicle.driver_name || 'Unassigned'}</div>
      </div>
      {vehicle.speed != null && vehicle.status === 'active' && (
        <span className="text-2xs font-mono text-cyan-400/70">{vehicle.speed}km/h</span>
      )}
      {vehicle.fuel_level != null && (
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <div className="w-14 h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${vehicle.fuel_level > 40 ? 'bg-emerald-500' : vehicle.fuel_level > 20 ? 'bg-amber-500' : 'bg-red-500'}`}
              style={{ width: `${vehicle.fuel_level}%` }} />
          </div>
          <span className="text-2xs font-mono text-slate-500 w-7 text-right">{vehicle.fuel_level}%</span>
        </div>
      )}
    </div>
  )
}

// ─── Driver Row ───────────────────────────────────────────────
function DriverRow({ driver, onClick }) {
  const dot   = driver.status === DRIVER_STATUS.ACTIVE ? 'online' : driver.status === DRIVER_STATUS.ON_BREAK ? 'idle' : 'offline'
  const score = driver.safety_score ?? 0
  return (
    <div onClick={onClick}
      className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-slate-800/40 cursor-pointer transition-colors group">
      <StatusDot status={dot} />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold text-white group-hover:text-cyan-200 transition-colors truncate">{driver.full_name}</div>
        <div className="text-2xs text-slate-600 truncate capitalize">{driver.status?.replace('_', ' ')}</div>
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <div className="w-12 h-1.5 bg-slate-800 rounded-full overflow-hidden">
          <div className="h-full rounded-full" style={{ width: `${score}%`, background: score >= 85 ? '#10b981' : score >= 65 ? '#f59e0b' : '#ef4444' }} />
        </div>
        <span className={`text-2xs font-mono ${score >= 85 ? 'text-emerald-400' : score >= 65 ? 'text-amber-400' : 'text-red-400'}`}>{score}</span>
      </div>
    </div>
  )
}

// ─── Activity Feed ────────────────────────────────────────────
function ActivityFeed({ vehicles, alerts, drivers }) {
  const events = [
    ...alerts.slice(0, 4).map(a => ({
      id: `alert-${a.id}`, icon: 'AlertTriangle',
      color: a.severity === 'critical' ? 'text-red-400' : a.severity === 'high' ? 'text-red-400' : 'text-amber-400',
      text: `${a.type?.replace(/_/g,' ')} — ${a.driver_name || 'Unknown'}`,
      sub: a.vehicle_reg || '', time: a.created_at,
    })),
    ...vehicles.filter(v => v.status === 'active').slice(0, 3).map(v => ({
      id: `veh-${v.id}`, icon: 'Truck', color: 'text-cyan-400',
      text: `${v.reg_number} active`, sub: v.driver_name || 'Unassigned',
      time: v.last_seen || new Date().toISOString(),
    })),
    ...drivers.filter(d => d.status === DRIVER_STATUS.ACTIVE).slice(0, 2).map(d => ({
      id: `drv-${d.id}`, icon: 'User', color: 'text-violet-400',
      text: `${d.full_name} on duty`, sub: d.vehicle_reg || '',
      time: d.updated_at || new Date().toISOString(),
    })),
  ].sort((a, b) => new Date(b.time) - new Date(a.time)).slice(0, 8)

  if (events.length === 0) return (
    <div className="flex flex-col items-center py-8 text-slate-700 gap-2">
      <Icon name="Activity" size={24} className="opacity-20" />
      <span className="text-xs">No activity yet — add vehicles and drivers to get started</span>
    </div>
  )
  return (
    <div className="space-y-1">
      {events.map(e => (
        <div key={e.id} className="flex items-start gap-2.5 px-2 py-2 rounded-lg hover:bg-slate-800/30 transition-colors">
          <div className="w-6 h-6 rounded-md bg-slate-900 border border-slate-800/60 flex items-center justify-center flex-shrink-0 mt-0.5">
            <Icon name={e.icon} size={11} className={e.color} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs text-slate-300 truncate">{e.text}</div>
            {e.sub && <div className="text-2xs text-slate-600 truncate">{e.sub}</div>}
          </div>
          <span className="text-2xs text-slate-700 font-mono flex-shrink-0">
            {new Date(e.time).toLocaleTimeString('en-GB', { hour12: false, hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      ))}
    </div>
  )
}

// ─── Empty State ──────────────────────────────────────────────
function EmptyFleet({ navigate }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 gap-4">
      <div className="w-14 h-14 rounded-2xl bg-cyan-500/5 border border-cyan-500/15 flex items-center justify-center">
        <Icon name="Truck" size={24} className="text-cyan-500/40" />
      </div>
      <div className="text-center">
        <div className="text-sm font-semibold text-white mb-1">No fleet data yet</div>
        <div className="text-2xs text-slate-600 max-w-[200px] mx-auto">Add your vehicles and drivers to start tracking your fleet in real time</div>
      </div>
      <div className="flex gap-2">
        <button onClick={() => navigate(ROUTES.FLEET)}
          className="text-2xs text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 px-3 py-1.5 rounded-lg hover:bg-cyan-500/15 transition-colors flex items-center gap-1">
          <Icon name="Plus" size={11} /> Add Vehicle
        </button>
        <button onClick={() => navigate(ROUTES.DRIVERS)}
          className="text-2xs text-violet-400 bg-violet-500/10 border border-violet-500/20 px-3 py-1.5 rounded-lg hover:bg-violet-500/15 transition-colors flex items-center gap-1">
          <Icon name="Plus" size={11} /> Add Driver
        </button>
      </div>
    </div>
  )
}

// ─── Section wrapper ──────────────────────────────────────────
function Section({ title, icon, action, children, className = '' }) {
  return (
    <div className={`bg-[#0d1426] border border-slate-800/60 rounded-xl flex flex-col ${className}`}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800/40">
        <div className="flex items-center gap-2">
          <Icon name={icon} size={13} className="text-slate-600" />
          <span className="text-sm font-semibold text-white">{title}</span>
        </div>
        {action}
      </div>
      <div className="flex-1 p-3 overflow-y-auto scrollbar-none">{children}</div>
    </div>
  )
}

// ─── System bar ───────────────────────────────────────────────
function SystemBar({ vehicles, alerts, loading }) {
  const online   = vehicles.filter(v => v.status === 'active').length
  const critical = alerts.filter(a => a.severity === 'critical').length
  return (
    <div className="flex items-center gap-4 text-2xs text-slate-500">
      <span className="flex items-center gap-1.5">
        <div className={`w-1.5 h-1.5 rounded-full ${loading ? 'bg-amber-400 animate-pulse' : 'bg-emerald-500'}`} />
        {loading ? 'Syncing…' : 'Live'}
      </span>
      <span>{online} online</span>
      {critical > 0 && <span className="text-red-400 font-semibold">{critical} critical</span>}
    </div>
  )
}

// ─── Driver App Panel ─────────────────────────────────────────
function DriverAppPanel({ drivers, vehicles }) {
  const [selectedDriver, setSelectedDriver] = useState('')
  const [tab,            setTab]            = useState('pairing')   // 'pairing'|'telemetry'|'chat'|'ai_reports'
  const [telemetryFeed,  setTelemetryFeed]  = useState([])
  const [messages,       setMessages]       = useState(() => getDriverMessageHistory(80))
  const [replyInput,     setReplyInput]     = useState('')
  const [aiReplying,     setAiReplying]     = useState(false)
  const [aiReports,      setAiReports]      = useState(() => getDriverAIReportHistory(80))
  const [pairingCode,         setPairingCode]         = useState('')
  const [codeExpiry,          setCodeExpiry]          = useState(null)
  const [activeCodes,         setActiveCodes]         = useState(() => getActivePairingCodes())
  const [codeGenDriver,       setCodeGenDriver]       = useState('')
  const [pairingQR,           setPairingQR]           = useState(null)  // { url, deepLink }
  const [pairingDriverName,   setPairingDriverName]   = useState('')
  const [pairingDriverReg,    setPairingDriverReg]    = useState('')
  const [pairingDriverAppURL, setPairingDriverAppURL] = useState('')
  const [shareStatus,         setShareStatus]         = useState(null)   // null | { method, state: 'ok'|'fail'|'busy', msg }
  const [nfcStatus,           setNfcStatus]           = useState(null)   // null | 'scanning' | 'written' | 'error'
  const [copiedCode,          setCopiedCode]          = useState(false)
  const feedRef    = useRef(null)
  const chatEndRef = useRef(null)
  const { sendMessage: aiSend } = useAIChat('Sentinel')

  // ── Live telemetry ─────────────────────────────────────────
  useEffect(() => {
    const unsub = listenForDriverTelemetry((data) => {
      setTelemetryFeed(prev => [{ ...data, _received: new Date().toISOString() }, ...prev].slice(0, 100))
    })
    return unsub
  }, [])

  // ── Driver messages ────────────────────────────────────────
  useEffect(() => {
    const unsub = listenForDriverMessages((msg) => {
      setMessages(prev => {
        const next = [msg, ...prev].slice(0, 200)
        return next
      })
      if (msg.from === 'driver') {
        setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 60)
      }
    })
    return unsub
  }, [])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  // ── Driver AI reports ──────────────────────────────────────
  useEffect(() => {
    const unsub = listenForDriverAIReports((report) => {
      setAiReports(prev => [report, ...prev].slice(0, 200))
    })
    return unsub
  }, [])

  // ── Pairing events (driver paired successfully) ────────────
  useEffect(() => {
    const unsub = listenForPairingEvents((evt) => {
      if (evt.type === 'paired') {
        setActiveCodes(getActivePairingCodes())
      }
    })
    return unsub
  }, [])

  // ── Pairing code generator ─────────────────────────────────
  const generateCode = () => {
    const driver   = drivers?.find(d => d.id === codeGenDriver) || null
    const driverId = codeGenDriver || `guest-${Date.now()}`
    const name     = driver?.full_name || 'Driver'
    const reg      = driver?.vehicle_reg || driver?.license_plate || '—'
    const driverAppURL = `${window.location.origin}/#/driver-app`
    const code = generatePairingCode(driverId, name, reg, 60)
    const qr   = getPairingCodeQR(code, 220)
    setPairingCode(code)
    setPairingDriverName(name)
    setPairingDriverReg(reg)
    setPairingDriverAppURL(driverAppURL)
    setPairingQR(qr)
    setCodeExpiry(new Date(Date.now() + 60 * 60 * 1000))
    setActiveCodes(getActivePairingCodes())
    setShareStatus(null)
    setNfcStatus(null)
    setCopiedCode(false)
  }

  // ── Share handlers ─────────────────────────────────────────
  const handleCopy = async () => {
    await copyPairingCode(pairingCode)
    setCopiedCode(true)
    setTimeout(() => setCopiedCode(false), 2500)
  }

  const handleWhatsApp = () => {
    sendPairingCodeWhatsApp(pairingCode, pairingDriverName, pairingDriverReg)
  }

  const handleEmail = () => {
    sendPairingCodeEmail(pairingCode, pairingDriverName, pairingDriverReg)
  }

  const handleWiFiDirect = async () => {
    setShareStatus({ method: 'wifi', state: 'busy', msg: 'Opening share sheet…' })
    const res = await sendViaWiFiDirect(pairingCode, pairingDriverName, pairingDriverReg)
    setShareStatus(res.ok
      ? { method: 'wifi', state: 'ok',   msg: 'Shared via WiFi Direct / AirDrop / Nearby Share' }
      : { method: 'wifi', state: 'fail', msg: res.error })
    setTimeout(() => setShareStatus(null), 4000)
  }

  const handleNFC = async () => {
    setNfcStatus('scanning')
    setShareStatus({ method: 'nfc', state: 'busy', msg: 'Hold driver phone to NFC sensor on this device…' })
    const res = await sendViaNFC(pairingCode, pairingDriverName, (st) => setNfcStatus(st))
    setShareStatus(res.ok
      ? { method: 'nfc', state: 'ok',   msg: 'Code written to NFC — driver phone received it!' }
      : { method: 'nfc', state: 'fail', msg: res.error })
    setTimeout(() => { setShareStatus(null); setNfcStatus(null) }, 5000)
  }

  // ── Send fleet reply ───────────────────────────────────────
  const sendReply = () => {
    if (!replyInput.trim()) return
    const targetId = selectedDriver || messages.find(m => m.from === 'driver')?.driver_id || null
    const msg = sendFleetReply(targetId, replyInput.trim(), false)
    setMessages(prev => [msg, ...prev])
    setReplyInput('')
  }

  // ── AI auto-reply ──────────────────────────────────────────
  const handleAIReply = async (driverMsg) => {
    setAiReplying(true)
    try {
      const prompt = `Driver message: "${driverMsg.text}" | Driver: ${driverMsg.driver_name || 'Unknown'} | Vehicle: ${driverMsg.vehicle_reg || '—'} | Reply as fleet AI co-pilot in 1-2 short sentences.`
      const result = await aiSend(prompt)
      // aiSend returns via hook state — extract last assistant message
      // Since we use the hook, just send a fleet reply manually via our channel
      // We build the reply from the raw API instead
      const fleetMsg = sendFleetReply(driverMsg.driver_id, '[AI processing — configure API keys in Settings to enable auto-responses]', true)
      setMessages(prev => [fleetMsg, ...prev])
    } catch {
      const fleetMsg = sendFleetReply(driverMsg.driver_id, 'AI unavailable. Configure API keys in Settings.', true)
      setMessages(prev => [fleetMsg, ...prev])
    } finally {
      setAiReplying(false)
    }
  }

  const driver           = drivers.find(d => d.id === selectedDriver)
  const latestByVehicle  = telemetryFeed.reduce((a, t) => { if (!a[t.vehicle_id]) a[t.vehicle_id] = t; return a }, {})
  const unreadDriverMsgs = messages.filter(m => m.from === 'driver').length
  const displayMsgs      = [...messages].reverse() // oldest first for chat display

  return (
    <div className="bg-[#0d1426] border border-violet-500/20 rounded-xl flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-violet-500/10">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
            <Icon name="Smartphone" size={12} className="text-violet-400" />
          </div>
          <span className="text-sm font-semibold text-white">Driver App Panel</span>
          <span className="text-2xs text-violet-400 bg-violet-500/10 border border-violet-500/20 px-1.5 py-0.5 rounded-full">AP3X</span>
        </div>
        <div className="flex items-center gap-3">
          {telemetryFeed.length > 0 && (
            <span className="flex items-center gap-1 text-2xs text-emerald-400">
              <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse inline-block" />
              Live telemetry
            </span>
          )}
          {unreadDriverMsgs > 0 && (
            <span className="flex items-center gap-1 text-2xs text-violet-300 bg-violet-500/10 border border-violet-500/20 px-2 py-0.5 rounded-full">
              <Icon name="MessageSquare" size={10} />
              {unreadDriverMsgs} driver msg{unreadDriverMsgs > 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      <div className="p-3 sm:p-4 lg:p-6 space-y-4">
        {/* Tabs */}
        <div className="border-b border-slate-800/40">
          <div className="flex gap-0.5 overflow-x-auto scrollbar-none">
            {[
              { key: 'pairing',    label: 'Pair Driver',      icon: 'KeyRound'      },
              { key: 'telemetry',  label: 'Telemetry',        icon: 'Gauge',        badge: telemetryFeed.length > 0 ? String(Object.keys(latestByVehicle).length) : null },
              { key: 'ai_reports', label: 'AI Reports',       icon: 'BrainCircuit', badge: aiReports.length > 0 ? String(aiReports.length) : null },
              { key: 'chat',       label: 'Messages',         icon: 'MessageSquare',badge: unreadDriverMsgs > 0 ? String(unreadDriverMsgs) : null },
            ].map(t => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`flex items-center gap-1.5 px-3 py-2 text-2xs font-semibold whitespace-nowrap transition-colors border-b-2 -mb-px ${
                  tab === t.key ? 'text-violet-400 border-violet-400' : 'text-slate-500 border-transparent hover:text-slate-300'}`}>
                <Icon name={t.icon} size={11} />
                {t.label}
                {t.badge && <span className="text-2xs bg-violet-500/20 text-violet-300 px-1 rounded">{t.badge}</span>}
              </button>
            ))}
          </div>
        </div>

        {/* ── Pairing tab ─────────────────────────────────── */}
        {/* ── Pairing tab ─────────────────────────────────── */}
        {tab === 'pairing' && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-3 rounded-xl bg-amber-500/5 border border-amber-500/20">
              <Icon name="ShieldAlert" size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="text-xs text-slate-400 leading-relaxed">
                Generate a unique <span className="font-mono text-violet-300 font-semibold">APEX-…-DA</span> driver pairing code. Share via QR, NFC, WhatsApp, email, or WiFi Direct.
                <span className="text-amber-300 font-semibold"> Never share the fleet dashboard URL</span> — drivers use the separate AP3X Driver app only.
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-2xs text-slate-500 font-semibold uppercase tracking-wider block mb-1.5">Assign to Driver</label>
                <select value={codeGenDriver} onChange={e => setCodeGenDriver(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:border-violet-500 focus:outline-none">
                  <option value="">— Guest / walk-in driver —</option>
                  {drivers.map(d => <option key={d.id} value={d.id}>{d.full_name}{d.vehicle_reg ? ` · ${d.vehicle_reg}` : ''}</option>)}
                </select>
              </div>
              <div className="flex items-end">
                <button onClick={generateCode}
                  className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-violet-500/15 border border-violet-500/30 text-violet-300 text-xs font-semibold hover:bg-violet-500/25 transition-colors">
                  <Icon name="KeyRound" size={13} /> Generate Driver Code
                </button>
              </div>
            </div>
            {pairingCode && (
              <div className="flex flex-col items-center gap-4 p-5 bg-[#060b18] border border-violet-500/25 rounded-xl">
                <div className="w-full bg-slate-950 border border-violet-500/20 rounded-2xl px-4 py-4 text-center">
                  <div className="text-2xs text-slate-600 uppercase tracking-[0.25em] font-semibold mb-2">Driver Pairing Code</div>
                  <div className="font-mono font-bold text-violet-200 text-base sm:text-lg tracking-[0.12em] leading-relaxed break-all select-all">
                    {pairingCode}
                  </div>
                  {codeExpiry && (
                    <div className="text-2xs text-slate-600 mt-2 font-mono">
                      Valid 60 min · expires {codeExpiry.toLocaleTimeString('en-GB', { hour12: false, hour: '2-digit', minute: '2-digit' })}
                    </div>
                  )}
                </div>
                {pairingQR?.url && (
                  <div className="flex flex-col items-center gap-2">
                    <div className="text-2xs text-slate-600 uppercase tracking-wider font-semibold">Scan to open + auto-fill code</div>
                    <img src={pairingQR.url} alt="Driver App QR" className="w-[180px] h-[180px] rounded-xl border border-violet-500/20" />
                    <div className="text-2xs text-slate-700">Scan opens AP3X Driver app with code pre-filled</div>
                  </div>
                )}
                {shareStatus && (
                  <div className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border text-xs ${shareStatus.state === 'ok' ? 'bg-emerald-500/8 border-emerald-500/20 text-emerald-300' : shareStatus.state === 'fail' ? 'bg-red-500/8 border-red-500/20 text-red-300' : 'bg-violet-500/8 border-violet-500/20 text-violet-300'}`}>
                    <Icon name={shareStatus.state === 'ok' ? 'CheckCircle2' : shareStatus.state === 'fail' ? 'AlertCircle' : 'Loader2'} size={13} className={shareStatus.state === 'busy' ? 'animate-spin' : ''} />
                    {shareStatus.msg}
                  </div>
                )}
                {nfcStatus === 'scanning' && (
                  <div className="w-full flex flex-col items-center gap-2 py-3 px-4 rounded-xl bg-cyan-500/5 border border-cyan-500/20">
                    <Icon name="Wifi" size={24} className="text-cyan-400 animate-pulse" />
                    <div className="text-xs text-cyan-300 font-semibold">Hold driver's phone to NFC sensor</div>
                    <div className="text-2xs text-slate-500">APEX-…-DA code will be written to their device</div>
                  </div>
                )}
                <div className="w-full grid grid-cols-3 sm:grid-cols-5 gap-2">
                  <button onClick={handleCopy} className={`flex flex-col items-center gap-1.5 px-2 py-3 rounded-xl border text-xs transition-colors ${copiedCode ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:text-white hover:border-slate-500'}`}>
                    <Icon name={copiedCode ? 'CheckCircle2' : 'Copy'} size={15} />
                    <span className="text-2xs">{copiedCode ? 'Copied!' : 'Copy'}</span>
                  </button>
                  <a href={pairingQR?.url} target="_blank" rel="noopener noreferrer"
                    className="flex flex-col items-center gap-1.5 px-2 py-3 rounded-xl bg-violet-500/8 border border-violet-500/20 text-violet-400 hover:bg-violet-500/15 text-xs transition-colors no-underline">
                    <Icon name="QrCode" size={15} />
                    <span className="text-2xs">QR Code</span>
                  </a>
                  <button onClick={handleWhatsApp} className="flex flex-col items-center gap-1.5 px-2 py-3 rounded-xl bg-[#25d366]/8 border border-[#25d366]/25 text-[#25d366] hover:bg-[#25d366]/15 text-xs transition-colors">
                    <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 2C6.48 2 2 6.48 2 12c0 1.85.5 3.58 1.37 5.07L2 22l5.07-1.35C8.46 21.51 10.2 22 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2zm0 18c-1.69 0-3.27-.47-4.63-1.28l-.33-.2-3.01.8.82-2.96-.22-.35C3.47 14.76 3 13.44 3 12 3 7.03 7.03 3 12 3s9 4.03 9 9-4.03 9-9 9z"/></svg>
                    <span className="text-2xs">WhatsApp</span>
                  </button>
                  <button onClick={handleEmail} className="flex flex-col items-center gap-1.5 px-2 py-3 rounded-xl bg-blue-500/8 border border-blue-500/20 text-blue-400 hover:bg-blue-500/15 text-xs transition-colors">
                    <Icon name="Mail" size={15} />
                    <span className="text-2xs">Email</span>
                  </button>
                  <button onClick={handleWiFiDirect} disabled={shareStatus?.state === 'busy' && shareStatus?.method === 'wifi'}
                    className="flex flex-col items-center gap-1.5 px-2 py-3 rounded-xl bg-cyan-500/8 border border-cyan-500/20 text-cyan-400 hover:bg-cyan-500/15 text-xs transition-colors disabled:opacity-40">
                    <Icon name="Share2" size={15} />
                    <span className="text-2xs">Share</span>
                  </button>
                </div>
                {'NDEFReader' in window && (
                  <button onClick={handleNFC} disabled={nfcStatus === 'scanning'}
                    className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border text-xs font-semibold transition-colors ${nfcStatus === 'scanning' ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400 animate-pulse' : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:text-white hover:border-slate-500'}`}>
                    <Icon name="Wifi" size={13} />
                    {nfcStatus === 'scanning' ? 'Hold driver phone to NFC sensor…' : 'Send via NFC tap'}
                  </button>
                )}
                <div className="text-2xs text-slate-700 text-center">Driver opens AP3X Driver app → enters APEX-…-DA code → paired instantly</div>
              </div>
            )}
            {activeCodes.length > 0 && (
              <div>
                <div className="text-2xs text-slate-600 font-semibold uppercase tracking-wider mb-2">Active Codes ({activeCodes.length})</div>
                <div className="space-y-1.5">
                  {activeCodes.map(entry => (
                    <div key={entry.code} className="flex items-center gap-3 px-3 py-2 bg-slate-900/50 border border-slate-800/50 rounded-lg">
                      <div className="flex-1 min-w-0">
                        <span className="font-mono text-xs font-bold text-violet-300 tracking-wider">{entry.code}</span>
                        <div className="text-2xs text-slate-600 mt-0.5 truncate">
                          {entry.driverName || 'Guest'} · {entry.vehicleReg || '—'} · expires {new Date(entry.expires).toLocaleTimeString('en-GB', { hour12: false, hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                      <button onClick={() => { revokePairingCode(entry.code); setActiveCodes(getActivePairingCodes()) }}
                        className="text-slate-700 hover:text-red-400 transition-colors flex-shrink-0" title="Revoke">
                        <Icon name="X" size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── AI Intelligence tab ─────────────────────────── */}
        {tab === 'ai_reports' && (
          <div className="space-y-3">
            {aiReports.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 gap-3 border border-dashed border-slate-800 rounded-xl">
                <Icon name="BrainCircuit" size={28} className="text-slate-800" />
                <div className="text-center">
                  <div className="text-xs text-slate-600 font-semibold">No driver AI reports yet</div>
                  <div className="text-2xs text-slate-700 mt-1">Sentinel fatigue · RouteMind performance · safety events stream here in real time</div>
                </div>
              </div>
            ) : (
              <>
                {(() => {
                  const latest = aiReports.slice(0, 20)
                  const fSet = latest.filter(r => r.fatigueScore != null)
                  const sSet = latest.filter(r => r.safetyScore  != null)
                  const avgF = fSet.length ? Math.round(fSet.reduce((s,r) => s + r.fatigueScore, 0) / fSet.length) : null
                  const avgS = sSet.length ? Math.round(sSet.reduce((s,r) => s + r.safetyScore,  0) / sSet.length) : null
                  const crit = latest.filter(r => r.alertLevel === 'danger').length
                  const drv  = [...new Set(latest.map(r => r.driverId).filter(Boolean))].length
                  return (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {[
                        { label: 'Avg Fatigue',     value: avgF != null ? `${avgF}%`  : '—', color: avgF > 70 ? 'text-red-400' : avgF > 40 ? 'text-amber-400' : 'text-emerald-400' },
                        { label: 'Avg Safety',      value: avgS != null ? `${avgS}%`  : '—', color: avgS < 60 ? 'text-red-400' : avgS < 80 ? 'text-amber-400' : 'text-emerald-400' },
                        { label: 'Critical Alerts', value: crit,  color: crit > 0 ? 'text-red-400' : 'text-slate-400' },
                        { label: 'Active Drivers',  value: drv,   color: 'text-cyan-400' },
                      ].map(k => (
                        <div key={k.label} className="bg-slate-900/60 border border-slate-800/60 rounded-xl p-3 text-center">
                          <div className={`text-lg font-bold font-mono ${k.color}`}>{k.value}</div>
                          <div className="text-2xs text-slate-600 mt-0.5 leading-tight">{k.label}</div>
                        </div>
                      ))}
                    </div>
                  )
                })()}
                <div className="space-y-2 max-h-[340px] overflow-y-auto scrollbar-none pr-1">
                  {aiReports.map((r, i) => {
                    const isSentinel = r.module === 'sentinel'
                    const isHarsh    = r.module === 'harsh_event'
                    const modColor   = isSentinel ? 'text-violet-400' : isHarsh ? 'text-red-400' : 'text-cyan-400'
                    const modBg      = isSentinel ? 'bg-violet-500/5 border-violet-500/15' : isHarsh ? 'bg-red-500/5 border-red-500/15' : 'bg-cyan-500/5 border-cyan-500/15'
                    const modIcon    = isSentinel ? 'Shield' : isHarsh ? 'AlertOctagon' : 'Navigation2'
                    const modLabel   = isSentinel ? 'Sentinel AI' : isHarsh ? 'Harsh Event' : r.module === 'performance' ? 'Performance' : 'RouteMind AI'
                    return (
                      <div key={r.id || i} className={`p-3 rounded-xl border ${modBg}`}>
                        <div className="flex items-center gap-2 mb-2">
                          <Icon name={modIcon} size={11} className={modColor} />
                          <span className={`text-2xs font-bold uppercase tracking-wider ${modColor}`}>{modLabel}</span>
                          {r.alertLevel === 'danger' && <span className="text-2xs px-1.5 py-0.5 rounded bg-red-500/15 border border-red-500/25 text-red-400 font-bold">CRITICAL</span>}
                          {r.alertLevel === 'warn'   && <span className="text-2xs px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-amber-400 font-semibold">WARN</span>}
                          <span className="text-2xs text-slate-600 font-mono ml-auto">{new Date(r.ts).toLocaleTimeString('en-GB', { hour12: false, hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          {r.driverName && <span className="text-2xs text-white font-semibold flex items-center gap-1"><Icon name="User" size={9} className="text-slate-600" />{r.driverName}</span>}
                          {r.vehicleReg && <span className="text-2xs text-slate-400 font-mono flex items-center gap-1"><Icon name="Truck" size={9} className="text-slate-600" />{r.vehicleReg}</span>}
                        </div>
                        <div className="flex flex-wrap gap-1.5 mb-2">
                          {r.fatigueScore  != null && <span className={`text-2xs px-2 py-0.5 rounded-full border font-semibold ${r.fatigueScore > 70 ? 'bg-red-500/10 border-red-500/20 text-red-400' : r.fatigueScore > 40 ? 'bg-amber-500/10 border-amber-500/20 text-amber-400' : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'}`}>Fatigue {r.fatigueScore}%</span>}
                          {r.safetyScore   != null && <span className="text-2xs px-2 py-0.5 rounded-full border bg-violet-500/10 border-violet-500/20 text-violet-300 font-semibold">Safety {r.safetyScore}%</span>}
                          {r.speed         != null && <span className={`text-2xs px-2 py-0.5 rounded-full border font-mono ${r.speed > 100 ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-slate-800/60 border-slate-700 text-slate-400'}`}>{r.speed} km/h</span>}
                          {r.sessionMinutes!= null && <span className="text-2xs px-2 py-0.5 rounded-full border bg-slate-800/60 border-slate-700 text-slate-500">{Math.floor(r.sessionMinutes/60)}h {r.sessionMinutes%60}m shift</span>}
                          {r.fuelEfficiency!= null && <span className="text-2xs px-2 py-0.5 rounded-full border bg-cyan-500/10 border-cyan-500/20 text-cyan-400">{r.fuelEfficiency} L/100km</span>}
                          {r.routeAdherence!= null && <span className="text-2xs px-2 py-0.5 rounded-full border bg-emerald-500/10 border-emerald-500/20 text-emerald-400">Route {r.routeAdherence}%</span>}
                        </div>
                        {r.summary   && <div className="text-xs text-slate-300 leading-relaxed">{r.summary}</div>}
                        {r.question  && <div className="text-2xs text-slate-500 italic mt-1">Driver query: “{r.question}”</div>}
                        {r.destination && <div className="text-2xs text-slate-600 mt-1 flex items-center gap-1"><Icon name="MapPin" size={9} />→ {r.destination}</div>}
                      </div>
                    )
                  })}
                </div>
                <div className="flex justify-end">
                  <button onClick={() => { try { localStorage.removeItem('apex:db:driver_ai_reports') } catch {} window.location.reload() }}
                    className="text-2xs text-slate-700 hover:text-red-400 flex items-center gap-1 transition-colors">
                    <Icon name="Trash2" size={10} /> Clear reports
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}


// ─── Dashboard ────────────────────────────────────────────────
export default function Dashboard() {
  const navigate = useNavigate()
  const { vehicles } = useFleetStore(s => ({ vehicles: s.vehicles }))
  const { drivers }  = useDriverStore(s => ({ drivers:  s.drivers  }))
  const [alerts,  setAlerts]  = useState([])
  const [loading, setLoading] = useState(true)
  const mapRef = useRef(null)

  const load = useCallback(() => {
    setLoading(true)
    try {
      fleetService.fetchVehicles()
      driverService.fetchDrivers()
      const fresh = safetyService.fetchAlerts({ resolved: false })
      setAlerts(Array.isArray(fresh) ? fresh : [])
    } catch (err) {
      console.error('Dashboard load error:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Live telemetry → refresh vehicle positions
  useEffect(() => {
    const unsub = telemetryService.subscribeToAll(() => load())
    return () => unsub?.()
  }, [load])

  // Also subscribe to vehicle/driver changes
  useEffect(() => {
    const u1 = fleetService.subscribeToVehicles(() => load())
    const u2 = driverService.subscribeToDrivers(() => load())
    return () => { u1?.(); u2?.() }
  }, [load])

  // Auto-refresh every 15s
  useEffect(() => {
    const id = setInterval(load, 15000)
    return () => clearInterval(id)
  }, [load])

  // Derived stats
  const activeVehicles = vehicles.filter(v => v.status === VEHICLE_STATUS.ACTIVE).length
  const idleVehicles   = vehicles.filter(v => v.status === VEHICLE_STATUS.IDLE).length
  const maintenanceVeh = vehicles.filter(v => v.status === VEHICLE_STATUS.MAINTENANCE).length
  const activeDrivers  = drivers.filter(d => d.status === DRIVER_STATUS.ACTIVE).length
  const criticalAlerts = alerts.filter(a => a.severity === 'critical').length
  const lowFuel        = vehicles.filter(v => v.fuel_level != null && v.fuel_level < 20).length
  const avgScore       = drivers.length
    ? Math.round(drivers.reduce((s, d) => s + (d.safety_score || 0), 0) / drivers.length) : null

  // ── Apex Intelligence KPIs (lazy — computed once on load) ───
  const [intelKPIs, setIntelKPIs] = useState(null)
  useEffect(() => {
    try {
      const fleetStats   = fleetLearning.getFleetStats()
      const intelligence = fleetLearning.getIntelligenceSummary()
      const compScore    = complianceEngine.getFleetComplianceScore(vehicles)
      const safetyKPIs   = safetyEngine.getFleetSafetyKPIs(vehicles, drivers)
      const riskDrivers  = driverLearning.rankByRisk(drivers.map(d => d.id).filter(Boolean)).filter(d => d.riskScore > 60)
      setIntelKPIs({ fleetStats, intelligence, compScore, safetyKPIs, riskDrivers })
    } catch {}
  }, [vehicles.length, drivers.length, alerts.length])

  const mapMarkers = vehicles
    .filter(v => v.lat && v.lng)
    .map(v => ({ id: v.id, lat: v.lat, lng: v.lng, label: v.reg_number, status: v.status, speed: v.speed, fuel: v.fuel_level }))

  const isEmpty = vehicles.length === 0 && drivers.length === 0

  return (
    <div className="flex flex-col h-full overflow-auto">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-800/60 flex-shrink-0">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-xl font-bold text-white">Fleet Command</h1>
            <div className="mt-1">
              <SystemBar vehicles={vehicles} alerts={alerts} loading={loading} />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={load} disabled={loading}
              className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-900 border border-slate-800 text-slate-500 hover:text-slate-300 transition-colors">
              <Icon name="RefreshCw" size={13} className={loading ? 'animate-spin' : ''} />
            </button>
            <LiveClock />
          </div>
        </div>
      </div>

      <div className="flex-1 p-3 sm:p-6 space-y-4 sm:space-y-5">
        {/* KPI Row */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          <KpiCard label="Active Vehicles" value={activeVehicles}  sub={`of ${vehicles.length} total`}  icon="Truck"       color="text-cyan-400"    bg="bg-cyan-500/5"    border="border-cyan-500/10"   onClick={() => navigate(ROUTES.FLEET)} />
          <KpiCard label="Idle"            value={idleVehicles}    sub="vehicles idle"                   icon="PauseCircle" color="text-amber-400"   bg="bg-amber-500/5"   border="border-amber-500/10"  onClick={() => navigate(ROUTES.FLEET)} />
          <KpiCard label="Maintenance"     value={maintenanceVeh}  sub="off the road"                    icon="Wrench"      color="text-violet-400"  bg="bg-violet-500/5"  border="border-violet-500/10" onClick={() => navigate(ROUTES.FLEET)} />
          <KpiCard label="Active Drivers"  value={activeDrivers}   sub={`of ${drivers.length} total`}   icon="Users"       color="text-emerald-400" bg="bg-emerald-500/5" border="border-emerald-500/10" onClick={() => navigate(ROUTES.DRIVERS)} />
          <KpiCard label="Open Alerts"     value={alerts.length}   sub={criticalAlerts > 0 ? `${criticalAlerts} critical` : 'all clear'}
            icon="Bell" color={criticalAlerts > 0 ? 'text-red-400' : 'text-slate-400'}
            bg={criticalAlerts > 0 ? 'bg-red-500/5' : 'bg-slate-900/40'} border={criticalAlerts > 0 ? 'border-red-500/15' : 'border-slate-800/60'} pulse={criticalAlerts > 0} onClick={() => navigate(ROUTES.SAFETY)} />
          <KpiCard label="Low Fuel"        value={lowFuel}         sub="below 20%"
            icon="Droplets" color={lowFuel > 0 ? 'text-red-400' : 'text-slate-500'}
            bg={lowFuel > 0 ? 'bg-red-500/5' : 'bg-slate-900/40'} border={lowFuel > 0 ? 'border-red-500/10' : 'border-slate-800/60'} onClick={() => navigate(ROUTES.FLEET)} />
        </div>


        {/* ── Apex Intelligence Strip ──────────────────────────── */}
        {intelKPIs && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {/* Fleet Safety Score */}
            <div className="bg-[#0d1426] border border-slate-800/60 rounded-xl p-3 flex flex-col gap-1">
              <div className="flex items-center gap-1.5 mb-0.5">
                <Icon name="ShieldCheck" size={11} className="text-emerald-400" />
                <span className="text-2xs text-slate-500 font-medium">Fleet Safety</span>
              </div>
              <div className={`text-xl font-bold font-mono ${intelKPIs.safetyKPIs.fleetSafetyScore >= 80 ? 'text-emerald-400' : intelKPIs.safetyKPIs.fleetSafetyScore >= 60 ? 'text-amber-400' : 'text-red-400'}`}>
                {intelKPIs.safetyKPIs.fleetSafetyScore}<span className="text-xs text-slate-600 font-normal">/100</span>
              </div>
              <div className="text-2xs text-slate-600">{intelKPIs.safetyKPIs.criticalVehicles > 0 ? `${intelKPIs.safetyKPIs.criticalVehicles} critical issues` : 'All clear'}</div>
            </div>
            {/* Compliance Score */}
            <div className="bg-[#0d1426] border border-slate-800/60 rounded-xl p-3 flex flex-col gap-1">
              <div className="flex items-center gap-1.5 mb-0.5">
                <Icon name="ClipboardCheck" size={11} className="text-cyan-400" />
                <span className="text-2xs text-slate-500 font-medium">Compliance</span>
              </div>
              <div className={`text-xl font-bold font-mono ${intelKPIs.compScore >= 80 ? 'text-cyan-400' : intelKPIs.compScore >= 60 ? 'text-amber-400' : 'text-red-400'}`}>
                {intelKPIs.compScore}<span className="text-xs text-slate-600 font-normal">/100</span>
              </div>
              <div className="text-2xs text-slate-600">Docs &amp; legality</div>
            </div>
            {/* Routes Learned */}
            <div className="bg-[#0d1426] border border-slate-800/60 rounded-xl p-3 flex flex-col gap-1">
              <div className="flex items-center gap-1.5 mb-0.5">
                <Icon name="Brain" size={11} className="text-violet-400" />
                <span className="text-2xs text-slate-500 font-medium">Routes Learned</span>
              </div>
              <div className="text-xl font-bold font-mono text-violet-400">
                {(intelKPIs.fleetStats.jobsCompleted || 0).toLocaleString()}
              </div>
              <div className="text-2xs text-slate-600">{intelKPIs.fleetStats.totalKm > 0 ? `${Math.round(intelKPIs.fleetStats.totalKm).toLocaleString()} km` : 'No data yet'}</div>
            </div>
            {/* Success Rate */}
            <div className="bg-[#0d1426] border border-slate-800/60 rounded-xl p-3 flex flex-col gap-1">
              <div className="flex items-center gap-1.5 mb-0.5">
                <Icon name="TrendingUp" size={11} className="text-emerald-400" />
                <span className="text-2xs text-slate-500 font-medium">Success Rate</span>
              </div>
              <div className={`text-xl font-bold font-mono ${intelKPIs.fleetStats.successRate == null ? 'text-slate-600' : intelKPIs.fleetStats.successRate >= 90 ? 'text-emerald-400' : 'text-amber-400'}`}>
                {intelKPIs.fleetStats.successRate != null ? `${intelKPIs.fleetStats.successRate}%` : '—'}
              </div>
              <div className="text-2xs text-slate-600">Job completion</div>
            </div>
            {/* Bottlenecks */}
            <div className="bg-[#0d1426] border border-slate-800/60 rounded-xl p-3 flex flex-col gap-1">
              <div className="flex items-center gap-1.5 mb-0.5">
                <Icon name="AlertTriangle" size={11} className="text-amber-400" />
                <span className="text-2xs text-slate-500 font-medium">Bottlenecks</span>
              </div>
              <div className={`text-xl font-bold font-mono ${intelKPIs.intelligence.highSeverityBottlenecks > 0 ? 'text-amber-400' : 'text-slate-600'}`}>
                {intelKPIs.intelligence.activeBottlenecks}
              </div>
              <div className="text-2xs text-slate-600">{intelKPIs.intelligence.highSeverityBottlenecks} high severity</div>
            </div>
            {/* High Risk Drivers */}
            <div className="bg-[#0d1426] border border-slate-800/60 rounded-xl p-3 flex flex-col gap-1">
              <div className="flex items-center gap-1.5 mb-0.5">
                <Icon name="UserX" size={11} className={intelKPIs.riskDrivers.length > 0 ? 'text-red-400' : 'text-slate-500'} />
                <span className="text-2xs text-slate-500 font-medium">High Risk</span>
              </div>
              <div className={`text-xl font-bold font-mono ${intelKPIs.riskDrivers.length > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                {intelKPIs.riskDrivers.length}
              </div>
              <div className="text-2xs text-slate-600">drivers flagged</div>
            </div>
          </div>
        )}

        {/* Empty state OR main grid */}
        {isEmpty ? (
          <div className="bg-[#0d1426] border border-slate-800/60 rounded-xl">
            <EmptyFleet navigate={navigate} />
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
            {/* Left: vehicles + drivers */}
            <div className="flex flex-col gap-5">
              <Section title="Active Fleet" icon="Truck" className="flex-1 min-h-[220px]"
                action={
                  <button onClick={() => navigate(ROUTES.FLEET)}
                    className="text-2xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1 transition-colors">
                    View all <Icon name="ArrowRight" size={10} />
                  </button>
                }>
                {vehicles.filter(v => v.status === 'active').slice(0, 7).map(v => (
                  <VehicleRow key={v.id} vehicle={v} onClick={() => navigate(ROUTES.FLEET)} />
                ))}
                {vehicles.filter(v => v.status === 'active').length === 0 && (
                  <div className="flex flex-col items-center py-6 text-slate-700 gap-1.5">
                    <Icon name="Truck" size={24} className="opacity-20" />
                    <span className="text-xs">No active vehicles — set status to Active in Fleet</span>
                  </div>
                )}
              </Section>

              <Section title="On-Duty Drivers" icon="Users" className="flex-1 min-h-[180px]"
                action={
                  <button onClick={() => navigate(ROUTES.DRIVERS)}
                    className="text-2xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1 transition-colors">
                    View all <Icon name="ArrowRight" size={10} />
                  </button>
                }>
                {drivers.filter(d => d.status === DRIVER_STATUS.ACTIVE).slice(0, 5).map(d => (
                  <DriverRow key={d.id} driver={d} onClick={() => navigate(ROUTES.DRIVERS)} />
                ))}
                {drivers.filter(d => d.status === DRIVER_STATUS.ACTIVE).length === 0 && (
                  <div className="flex flex-col items-center py-6 text-slate-700 gap-1.5">
                    <Icon name="Users" size={24} className="opacity-20" />
                    <span className="text-xs">No active drivers — set status to Active in Drivers</span>
                  </div>
                )}
              </Section>
            </div>

            {/* Centre: live map */}
            <div className="xl:col-span-1">
              <div className="bg-[#0d1426] border border-slate-800/60 rounded-xl overflow-hidden h-full min-h-[460px] flex flex-col">
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800/40">
                  <div className="flex items-center gap-2">
                    <Icon name="Map" size={13} className="text-slate-600" />
                    <span className="text-sm font-semibold text-white">Live Map</span>
                    {mapMarkers.length > 0 && (
                      <span className="text-2xs text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 px-1.5 py-0.5 rounded-full font-mono">
                        {mapMarkers.length}
                      </span>
                    )}
                  </div>
                  <button onClick={() => navigate(ROUTES.NAVIGATION)}
                    className="text-2xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1 transition-colors">
                    Full map <Icon name="ArrowRight" size={10} />
                  </button>
                </div>
                <div className="flex-1">
                  {mapMarkers.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-700">
                      <Icon name="MapPin" size={28} className="opacity-20" />
                      <span className="text-xs text-center px-8">No vehicles with GPS coordinates yet.<br/>GPS comes from the driver AP3X app.</span>
                    </div>
                  ) : (
                    <Suspense fallback={
                      <div className="flex items-center justify-center h-full bg-[#050810] text-slate-700 gap-2">
                        <Icon name="Loader2" size={16} className="animate-spin" /><span className="text-xs">Loading map…</span>
                      </div>
                    }>
                      <ApexMap ref={mapRef} markers={mapMarkers} height="100%" className="h-full" />
                    </Suspense>
                  )}
                </div>
              </div>
            </div>

            {/* Right: alerts + activity */}
            <div className="flex flex-col gap-5">
              <Section title="Safety Alerts" icon="ShieldAlert" className="flex-1 min-h-[220px]"
                action={alerts.length > 0 ? (
                  <button onClick={() => navigate(ROUTES.SAFETY)}
                    className="text-2xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1 transition-colors">
                    View all <Icon name="ArrowRight" size={10} />
                  </button>
                ) : null}>
                {alerts.slice(0, 5).map(a => <AlertRow key={a.id} alert={a} />)}
                {alerts.length === 0 && (
                  <div className="flex flex-col items-center py-6 text-slate-700 gap-1.5">
                    <Icon name="ShieldCheck" size={24} className="opacity-20" />
                    <span className="text-xs">All systems nominal</span>
                  </div>
                )}
              </Section>

              <Section title="Activity Feed" icon="Activity" className="flex-1 min-h-[180px]">
                <ActivityFeed vehicles={vehicles} alerts={alerts} drivers={drivers} />
              </Section>
            </div>
          </div>
        )}

        {/* Driver App Panel */}
        <DriverAppPanel drivers={drivers} vehicles={vehicles} />

        {/* Quick actions */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'New Dispatch Job', icon: 'Radio',       color: 'text-cyan-400',   route: ROUTES.DISPATCH  },
            { label: 'Report Incident',  icon: 'FileText',    color: 'text-red-400',    route: ROUTES.INCIDENTS },
            { label: 'Safety Alerts',    icon: 'ShieldAlert', color: 'text-amber-400',  route: ROUTES.SAFETY    },
            { label: 'Open Analytics',   icon: 'BarChart3',   color: 'text-violet-400', route: ROUTES.ANALYTICS },
          ].map(a => (
            <button key={a.label} onClick={() => navigate(a.route)}
              className="flex items-center gap-2.5 bg-[#0d1426] border border-slate-800/60 rounded-xl px-4 py-3.5 hover:border-slate-700/60 hover:bg-slate-800/20 transition-all text-left group">
              <Icon name={a.icon} size={15} className={`${a.color} group-hover:scale-110 transition-transform`} />
              <span className="text-xs font-medium text-slate-400 group-hover:text-white transition-colors">{a.label}</span>
              <Icon name="ArrowRight" size={11} className="text-slate-700 group-hover:text-slate-500 ml-auto transition-colors" />
            </button>
          ))}
        </div>

        {/* Fleet health bar */}
        {!isEmpty && (
          <div className="bg-[#0d1426] border border-slate-800/60 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <Icon name="Activity" size={14} className="text-slate-600" />
              <span className="text-sm font-semibold text-white">Fleet Health</span>
              {avgScore != null && (
                <div className={`ml-auto flex items-center gap-1.5 text-xs font-mono font-bold px-2.5 py-1 rounded-lg border ${
                  avgScore >= 85 ? 'text-emerald-400 bg-emerald-500/5 border-emerald-500/15' :
                  avgScore >= 65 ? 'text-amber-400  bg-amber-500/5  border-amber-500/15' :
                                   'text-red-400    bg-red-500/5    border-red-500/15'
                }`}>
                  Safety avg {avgScore}
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: 'Operational',   val: vehicles.filter(v => v.status !== 'maintenance' && v.status !== 'decommissioned').length, total: vehicles.length, color: 'bg-cyan-500' },
                { label: 'On Route',      val: vehicles.filter(v => v.status === 'active').length,      total: vehicles.length, color: 'bg-emerald-500' },
                { label: 'Maintenance',   val: maintenanceVeh,                                           total: vehicles.length, color: 'bg-amber-500' },
                { label: 'Open Alerts',   val: alerts.length,                                            total: Math.max(alerts.length, 10), color: 'bg-red-500' },
              ].map(s => (
                <div key={s.label}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-2xs text-slate-600">{s.label}</span>
                    <span className="text-2xs font-mono text-slate-400">{s.val}/{s.total}</span>
                  </div>
                  <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div className={`h-full ${s.color} rounded-full transition-all`}
                      style={{ width: s.total > 0 ? `${Math.min(100,(s.val/s.total)*100)}%` : '0%' }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
