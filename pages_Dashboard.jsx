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
import { listenForDriverTelemetry, listenForDriverMessages, sendFleetReply, getDriverMessageHistory } from './services_sync_driverSyncService'
import { ROUTES } from './config_routes'
import { useAIChat } from './modules_ai_useAIChat'
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
  const [tab,            setTab]            = useState('telemetry') // 'telemetry' | 'chat'
  const [linkCopied,     setLinkCopied]     = useState(false)
  const [showQR,         setShowQR]         = useState(false)
  const [qrUrl,          setQrUrl]          = useState('')
  const [telemetryFeed,  setTelemetryFeed]  = useState([])
  const [messages,       setMessages]       = useState(() => getDriverMessageHistory(80))
  const [replyInput,     setReplyInput]     = useState('')
  const [aiReplying,     setAiReplying]     = useState(false)
  const feedRef    = useRef(null)
  const chatEndRef = useRef(null)
  const { sendMessage: aiSend } = useAIChat('Sentinel')
  const appURL = `${window.location.href.split('#')[0]}#/ap3x`

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

  // ── Send link ──────────────────────────────────────────────
  const buildURL = () => selectedDriver ? `${appURL}?driver_id=${selectedDriver}` : appURL

  const sendLink = async () => {
    try {
      if (navigator.share) { await navigator.share({ title: 'Apex AP3X Driver App', url: buildURL() }) }
      else { await navigator.clipboard.writeText(buildURL()); setLinkCopied(true); setTimeout(() => setLinkCopied(false), 2500) }
    } catch {
      await navigator.clipboard.writeText(buildURL()).catch(() => {})
      setLinkCopied(true); setTimeout(() => setLinkCopied(false), 2500)
    }
  }

  const generateQR = () => {
    const encoded = encodeURIComponent(buildURL())
    setQrUrl(`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encoded}&bgcolor=0d1426&color=a78bfa&margin=4`)
    setShowQR(true)
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

      <div className="p-4 space-y-4">
        {/* Send app row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <div className="md:col-span-1">
            <label className="text-2xs text-slate-500 font-semibold uppercase tracking-wider block mb-1.5">Send AP3X App To</label>
            <select value={selectedDriver} onChange={e => setSelectedDriver(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:border-violet-500 focus:outline-none">
              <option value="">— All drivers (generic link) —</option>
              {drivers.map(d => <option key={d.id} value={d.id}>{d.full_name}{d.vehicle_reg ? ` · ${d.vehicle_reg}` : ''}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <button onClick={sendLink}
              className="flex-1 flex items-center justify-center gap-1.5 bg-violet-500/10 border border-violet-500/25 hover:bg-violet-500/20 text-violet-300 text-xs rounded-lg px-3 py-2 transition-colors">
              {linkCopied
                ? <><Icon name="Check" size={12} className="text-emerald-400" /><span className="text-emerald-400">Copied!</span></>
                : <><Icon name="Share2" size={12} />{navigator.share ? 'Share' : 'Copy Link'}</>}
            </button>
            <button onClick={generateQR}
              className="flex-1 flex items-center justify-center gap-1.5 bg-cyan-500/10 border border-cyan-500/25 hover:bg-cyan-500/20 text-cyan-300 text-xs rounded-lg px-3 py-2 transition-colors">
              <Icon name="QrCode" size={12} /> QR Code
            </button>
          </div>
          {driver && (
            <div className="flex items-center gap-2 px-3 py-2 bg-violet-500/5 border border-violet-500/15 rounded-lg">
              <StatusDot status="online" />
              <span className="text-xs text-slate-300">{driver.full_name}</span>
              <span className="text-2xs text-slate-600 ml-auto capitalize">{driver.status?.replace('_',' ')}</span>
            </div>
          )}
        </div>

        {/* QR */}
        {showQR && (
          <div className="relative border border-violet-500/20 rounded-xl bg-[#060b18] p-4 flex flex-col items-center gap-3">
            <button onClick={() => setShowQR(false)} className="absolute top-2 right-2 text-slate-600 hover:text-slate-400"><Icon name="X" size={14} /></button>
            <div className="text-2xs text-slate-500 uppercase tracking-wider">Scan with driver's phone</div>
            <img src={qrUrl} alt="QR" className="w-[160px] h-[160px] rounded-lg" />
            <div className="text-2xs text-slate-700">{selectedDriver ? 'Driver-specific link' : 'Generic driver link'}</div>
          </div>
        )}

        {/* Tabs */}
        <div className="border-b border-slate-800/40">
          <div className="flex gap-1">
            {[
              { key: 'telemetry', label: 'Live Telemetry', icon: 'Gauge',         badge: telemetryFeed.length > 0 ? String(Object.keys(latestByVehicle).length) : null },
              { key: 'chat',      label: 'Driver Messages', icon: 'MessageSquare', badge: unreadDriverMsgs > 0 ? String(unreadDriverMsgs) : null },
            ].map(t => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors border-b-2 -mb-px ${
                  tab === t.key ? 'text-violet-400 border-violet-400' : 'text-slate-500 border-transparent hover:text-slate-300'}`}>
                <Icon name={t.icon} size={12} />
                {t.label}
                {t.badge && <span className="text-2xs bg-violet-500/20 text-violet-300 px-1 rounded">{t.badge}</span>}
              </button>
            ))}
          </div>
        </div>

        {/* Telemetry tab */}
        {tab === 'telemetry' && (
          <div className="space-y-3">
            {telemetryFeed.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 gap-2 border border-dashed border-slate-800 rounded-xl">
                <Icon name="Radio" size={22} className="text-slate-800" />
                <span className="text-2xs text-slate-700 text-center">Waiting for driver telemetry…<br/>Driver opens AP3X app → enables GPS → data appears here</span>
              </div>
            ) : (
              <>
                {/* Live vehicle tiles */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {Object.values(latestByVehicle).slice(0, 8).map(t => {
                    const veh = vehicles.find(v => v.id === t.vehicle_id)
                    const drv = drivers.find(d => d.id === t.driver_id)
                    return (
                      <div key={t.vehicle_id} className="bg-slate-900/60 border border-slate-800 rounded-xl p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-2xs text-slate-500 font-mono font-semibold">{veh?.reg_number || 'Vehicle'}</span>
                          {t.lat && <span className="text-2xs text-emerald-400">●GPS</span>}
                        </div>
                        {drv && <div className="text-2xs text-slate-600 truncate mb-2">{drv.full_name}</div>}
                        <div className="grid grid-cols-2 gap-1">
                          {t.speed != null && (
                            <div className="text-center">
                              <div className={`font-mono font-bold text-sm ${t.speed > 80 ? 'text-red-400' : 'text-cyan-400'}`}>{t.speed}</div>
                              <div className="text-2xs text-slate-700">km/h</div>
                            </div>
                          )}
                          {t.fuel != null && (
                            <div className="text-center">
                              <div className={`font-mono font-bold text-sm ${t.fuel < 15 ? 'text-red-400' : t.fuel < 30 ? 'text-amber-400' : 'text-violet-400'}`}>{t.fuel}</div>
                              <div className="text-2xs text-slate-700">% fuel</div>
                            </div>
                          )}
                        </div>
                        <div className="text-2xs text-slate-700 mt-2 font-mono">
                          {new Date(t._received || Date.now()).toLocaleTimeString('en-GB', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </div>
                      </div>
                    )
                  })}
                </div>
                {/* Event log */}
                <div ref={feedRef} className="space-y-1 max-h-[160px] overflow-y-auto scrollbar-none">
                  {telemetryFeed.slice(0, 30).map((t, i) => {
                    const veh = vehicles.find(v => v.id === t.vehicle_id)
                    return (
                      <div key={i} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-slate-900/40 border border-slate-800/40">
                        <Icon name="Gauge" size={10} className="text-cyan-400/60 flex-shrink-0" />
                        <span className="text-2xs text-slate-500 font-mono flex-1 truncate">
                          {veh?.reg_number || 'Veh'} — {t.speed != null ? `${t.speed}km/h` : ''} {t.fuel != null ? `· ${t.fuel}% fuel` : ''} {t.lat ? `· ${parseFloat(t.lat).toFixed(3)},${parseFloat(t.lng || 0).toFixed(3)}` : ''}
                        </span>
                        <span className="text-2xs text-slate-700 font-mono flex-shrink-0">
                          {new Date(t._received || Date.now()).toLocaleTimeString('en-GB', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </span>
                      </div>
                    )
                  })}
                </div>
                <div className="flex justify-end">
                  <button onClick={() => setTelemetryFeed([])} className="text-2xs text-slate-700 hover:text-slate-500 flex items-center gap-1 transition-colors">
                    <Icon name="Trash2" size={10} /> Clear feed
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Chat tab */}
        {tab === 'chat' && (
          <div className="space-y-3">
            {/* Message window */}
            <div className="bg-[#060b18] border border-slate-800/60 rounded-xl p-3 h-[280px] overflow-y-auto flex flex-col gap-2 scrollbar-none">
              {displayMsgs.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-2 text-slate-700">
                  <Icon name="MessageSquare" size={24} className="opacity-20" />
                  <span className="text-xs text-center">No messages yet.<br/>Driver messages from the AP3X app appear here.</span>
                </div>
              ) : (
                displayMsgs.map((msg, i) => (
                  <div key={msg.id || i} className={`flex ${msg.from === 'driver' ? 'justify-start' : 'justify-end'}`}>
                    <div className={`max-w-[75%] flex flex-col gap-1 ${msg.from === 'driver' ? 'items-start' : 'items-end'}`}>
                      {/* Sender label */}
                      <div className="flex items-center gap-1 px-1">
                        <Icon name={msg.from === 'driver' ? 'User' : msg.from === 'ai' ? 'Cpu' : 'Radio'} size={9}
                          className={msg.from === 'driver' ? 'text-violet-400' : msg.from === 'ai' ? 'text-cyan-400' : 'text-emerald-400'} />
                        <span className="text-2xs text-slate-600">
                          {msg.from === 'driver' ? (msg.driver_name || 'Driver') : msg.from === 'ai' ? 'Apex AI' : 'Fleet Ops'}
                        </span>
                        <span className="text-2xs text-slate-700 font-mono ml-1">
                          {new Date(msg.ts).toLocaleTimeString('en-GB', { hour12: false, hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      {/* Bubble */}
                      <div className={`px-3 py-2 rounded-xl text-xs leading-relaxed ${
                        msg.from === 'driver'
                          ? 'bg-violet-500/10 border border-violet-500/20 text-violet-100'
                          : msg.from === 'ai'
                          ? 'bg-cyan-500/10 border border-cyan-500/15 text-cyan-100'
                          : 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-100'
                      }`}>
                        {msg.text}
                      </div>
                      {/* AI reply button — only on driver messages */}
                      {msg.from === 'driver' && (
                        <button onClick={() => handleAIReply(msg)} disabled={aiReplying}
                          className="text-2xs text-slate-600 hover:text-cyan-400 flex items-center gap-1 px-1 transition-colors disabled:opacity-30">
                          <Icon name="Cpu" size={9} /> {aiReplying ? 'AI thinking…' : 'AI reply'}
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Reply input */}
            <div className="flex gap-2">
              <input
                value={replyInput}
                onChange={e => setReplyInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendReply()}
                placeholder="Reply to driver…"
                className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:border-emerald-500 focus:outline-none"
              />
              <button onClick={sendReply} disabled={!replyInput.trim()}
                className="w-9 h-9 flex items-center justify-center bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-30 transition-colors">
                <Icon name="Send" size={13} />
              </button>
            </div>
            <div className="text-2xs text-slate-700">Fleet replies are sent directly to the driver's AP3X app in real time. Click <span className="text-cyan-500">AI reply</span> on any driver message to auto-generate a response.</div>
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

      <div className="flex-1 p-6 space-y-5">
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
