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
  listenForDriverTelemetry,
  listenForDriverMessages,
  getActivePairingCodes,
  listenForPairingEvents,
} from './services_sync_driverSyncService'
import { ROUTES } from './config_routes'
import { fleetLearning }   from './intel_fleetLearning'
import { complianceEngine } from './intel_complianceEngine'
import { safetyEngine }     from './intel_safetyEngine'
import { driverLearning }   from './intel_driverLearning'
import { formatDateTime } from './utils_format'
import {
  generateSyncCode, getActiveSyncCodes, revokeSyncCode,
  getSyncCodeQR, copySyncCode, shareSyncCodeWhatsApp,
  shareSyncCodeEmail, shareSyncCodeNative,
  subscribeToDriverLocations, subscribeToAIReports,
  getStoredAIReports, getActiveDrivers, subscribeToDriverEvents,
  sendFleetMessage, sendFleetAlert, sendDispatchOrder,
  getLiveDriverPositions,
} from './services_sync_liveSync'
import { runSyncVerification, SYNC_HEALTH } from './services_sync_syncVerificationService'
import { subscribeToDashboardEvents } from './services_backend_backendService'


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
function DriverOnlineDot({ online }) {
  return (
    <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${
      online ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]' : 'bg-slate-600'
    }`} />
  )
}

// ─── Sync code card ───────────────────────────────────────────
function SyncCodeCard({ code, expiry, qr, driverName, vehicleReg, onRevoke, onCopy, copied }) {
  const [timeLeft, setTimeLeft] = useState('')
  useEffect(() => {
    if (!expiry) return
    const tick = () => {
      const diff = new Date(expiry) - new Date()
      if (diff <= 0) { setTimeLeft('Expired'); return }
      const m = Math.floor(diff / 60000)
      const s = Math.floor((diff % 60000) / 1000)
      setTimeLeft(`${m}m ${s}s`)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [expiry])

  return (
    <div className="bg-[#060b18] border border-violet-500/30 rounded-xl p-4 space-y-3">
      {/* Code display */}
      <div className="flex items-center gap-3">
        <div className="flex-1 font-mono text-violet-300 text-sm bg-violet-500/5 border border-violet-500/20 rounded-lg px-3 py-2 tracking-widest select-all break-all">
          {code}
        </div>
        <button
          onClick={onCopy}
          className={`flex-shrink-0 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
            copied
              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
              : 'bg-violet-500/15 text-violet-300 border border-violet-500/25 hover:bg-violet-500/25'
          }`}
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
        <button
          onClick={onRevoke}
          className="flex-shrink-0 p-2 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 border border-slate-700/40 transition-colors"
          title="Revoke code"
        >
          <Icon name="X" size={14} />
        </button>
      </div>

      {/* QR */}
      {qr && (
        <div className="flex gap-4 items-start">
          <div className="rounded-lg overflow-hidden border border-violet-500/20 flex-shrink-0 bg-[#060b18] p-1">
            <img src={qr.qrUrl} alt="Sync QR" width={96} height={96} className="block" />
          </div>
          <div className="flex-1 space-y-1.5 min-w-0">
            <div className="flex items-center gap-1.5 text-xs text-slate-400">
              <Icon name="User" size={11} className="text-slate-500 flex-shrink-0" />
              <span className="truncate">{driverName}</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-slate-400">
              <Icon name="Truck" size={11} className="text-slate-500 flex-shrink-0" />
              <span className="truncate">{vehicleReg}</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <Icon name="Clock" size={11} className="flex-shrink-0" />
              <span>{timeLeft}</span>
            </div>
            <p className="text-2xs text-slate-600 leading-relaxed">
              Scan QR or paste code in AP3X Driver App to connect
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Active driver row ────────────────────────────────────────
function ActiveDriverRow({ driver, onMessage, onAlert }) {
  const tel = driver.telemetry
  const age = driver.last_seen
    ? Math.floor((Date.now() - new Date(driver.last_seen).getTime()) / 1000)
    : null
  const online = age != null && age < 60

  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-[#060b18] border border-slate-800/50 hover:border-slate-700/60 transition-colors">
      <DriverOnlineDot online={online} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-white truncate">{driver.driver_name}</span>
          <span className="text-2xs text-slate-600 bg-slate-800/60 px-1.5 py-0.5 rounded font-mono">{driver.vehicle_reg}</span>
        </div>
        {tel ? (
          <div className="flex items-center gap-3 mt-0.5">
            <span className="text-2xs text-cyan-400 font-mono">{tel.speed ?? 0} km/h</span>
            <span className="text-2xs text-slate-500">
              {tel.lat?.toFixed(4)}, {tel.lng?.toFixed(4)}
            </span>
            <span className="text-2xs text-slate-600">
              {age != null ? (age < 60 ? `${age}s ago` : `${Math.floor(age/60)}m ago`) : '—'}
            </span>
          </div>
        ) : (
          <span className="text-2xs text-slate-600">No telemetry yet</span>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => onMessage(driver)}
          className="p-1.5 rounded-md text-slate-500 hover:text-cyan-400 hover:bg-cyan-500/10 transition-colors"
          title="Send message"
        >
          <Icon name="MessageSquare" size={13} />
        </button>
        <button
          onClick={() => onAlert(driver)}
          className="p-1.5 rounded-md text-slate-500 hover:text-amber-400 hover:bg-amber-500/10 transition-colors"
          title="Send alert"
        >
          <Icon name="AlertTriangle" size={13} />
        </button>
      </div>
    </div>
  )
}

// ─── AI Report card ───────────────────────────────────────────
function AIReportCard({ report }) {
  const TYPE_CONFIG = {
    sentinel:    { label: 'Sentinel AI', color: 'violet', icon: 'Shield' },
    routemind:   { label: 'RouteMind AI', color: 'cyan',  icon: 'Navigation' },
    harsh_event: { label: 'Harsh Event', color: 'red',    icon: 'AlertOctagon' },
    performance: { label: 'Performance', color: 'emerald', icon: 'TrendingUp' },
  }
  const cfg = TYPE_CONFIG[report.type] || { label: 'AI Report', color: 'slate', icon: 'Cpu' }
  const col = {
    violet:  { bg: 'bg-violet-500/10',  border: 'border-violet-500/20',  text: 'text-violet-300'  },
    cyan:    { bg: 'bg-cyan-500/10',    border: 'border-cyan-500/20',    text: 'text-cyan-300'    },
    red:     { bg: 'bg-red-500/10',     border: 'border-red-500/20',     text: 'text-red-300'     },
    emerald: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', text: 'text-emerald-300' },
    slate:   { bg: 'bg-slate-800/50',   border: 'border-slate-700/40',   text: 'text-slate-400'   },
  }[cfg.color]

  return (
    <div className={`${col.bg} border ${col.border} rounded-lg p-3 space-y-1.5`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Icon name={cfg.icon} size={12} className={col.text} />
          <span className={`text-2xs font-semibold uppercase tracking-wider ${col.text}`}>{cfg.label}</span>
        </div>
        <span className="text-2xs text-slate-600 font-mono">
          {new Date(report.ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </span>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-slate-300 font-medium">{report.driver_name}</span>
        <span className="text-2xs text-slate-600">{report.vehicle_reg}</span>
      </div>
      {report.data && (
        <div className="flex gap-3 flex-wrap">
          {report.data.fatigue_score   != null && <span className="text-2xs text-slate-400">Fatigue: <span className={report.data.fatigue_score > 70 ? 'text-red-400' : report.data.fatigue_score > 40 ? 'text-amber-400' : 'text-emerald-400'}>{report.data.fatigue_score}%</span></span>}
          {report.data.safety_score    != null && <span className="text-2xs text-slate-400">Safety: <span className={report.data.safety_score  < 50 ? 'text-red-400' : report.data.safety_score  < 75 ? 'text-amber-400' : 'text-emerald-400'}>{report.data.safety_score}%</span></span>}
          {report.data.speed           != null && <span className="text-2xs text-slate-400">Speed: <span className="text-slate-300">{report.data.speed} km/h</span></span>}
          {report.data.route_adherence != null && <span className="text-2xs text-slate-400">Route: <span className="text-slate-300">{report.data.route_adherence}%</span></span>}
          {report.data.fuel_efficiency != null && <span className="text-2xs text-slate-400">Fuel: <span className="text-slate-300">{report.data.fuel_efficiency} mpg</span></span>}
          {report.data.event           != null && <span className="text-2xs text-red-300 font-semibold">{report.data.event}</span>}
          {report.data.summary         != null && <span className="text-2xs text-slate-400 w-full">{report.data.summary}</span>}
        </div>
      )}
    </div>
  )
}

// ─── Main Driver Sync Section ─────────────────────────────────
function DriverSyncSection({ drivers = [], vehicles = [] }) {
  const [tab, setTab]                     = useState('sync')    // 'sync' | 'live' | 'commands' | 'ai'
  const [syncCode, setSyncCode]           = useState('')
  const [syncExpiry, setSyncExpiry]       = useState(null)
  const [syncQR, setSyncQR]              = useState(null)
  const [syncDriver, setSyncDriver]       = useState('')
  const [syncDriverName, setSyncDriverName] = useState('')
  const [syncVehicleReg, setSyncVehicleReg] = useState('')
  const [activeCodes, setActiveCodes]     = useState(() => getActiveSyncCodes())
  const [activeDrivers, setActiveDrivers] = useState(() => getActiveDrivers())
  const [livePositions, setLivePositions] = useState(() => getLiveDriverPositions())
  const [aiReports, setAIReports]         = useState(() => getStoredAIReports(30))
  const [copied, setCopied]               = useState(false)
  const [shareStatus, setShareStatus]     = useState(null)
  const [cmdDriver, setCmdDriver]         = useState('')
  const [cmdText, setCmdText]             = useState('')
  const [cmdType, setCmdType]             = useState('message')
  const [cmdSent, setCmdSent]             = useState(false)

  // ── Subscribe to live events ───────────────────────────────
  useEffect(() => {
    const unsub = subscribeToDriverEvents((evt) => {
      if (evt.type === 'DRIVER_PAIRED' || evt.type === 'CODE_CREATED' || evt.type === 'CODE_REVOKED') {
        setActiveCodes(getActiveSyncCodes())
        setActiveDrivers(getActiveDrivers())
      }
    })
    return unsub
  }, [])

  useEffect(() => {
    const unsub = subscribeToDriverLocations((payload) => {
      if (payload._bulk) {
        setLivePositions(payload.positions)
      } else {
        setLivePositions(prev => {
          const idx = prev.findIndex(p => p.vehicle_id === payload.vehicle_id)
          if (idx >= 0) { const n = [...prev]; n[idx] = payload; return n }
          return [...prev, payload]
        })
      }
      setActiveDrivers(getActiveDrivers())
    })
    return unsub
  }, [])

  useEffect(() => {
    const unsub = subscribeToAIReports((report) => {
      setAIReports(prev => [report, ...prev].slice(0, 100))
    })
    return unsub
  }, [])

  // ── Refresh every 10s ──────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => {
      setActiveCodes(getActiveSyncCodes())
      setActiveDrivers(getActiveDrivers())
      setLivePositions(getLiveDriverPositions())
    }, 10000)
    return () => clearInterval(id)
  }, [])

  // ── Generate code ──────────────────────────────────────────
  const handleGenerate = () => {
    const driver = drivers?.find(d => d.id === syncDriver) || null
    const name   = driver?.full_name || syncDriverName || 'Driver'
    const reg    = driver?.vehicle_reg || driver?.license_plate || syncVehicleReg || '—'
    const code   = generateSyncCode(syncDriver || null, name, reg, 60)
    const qr     = getSyncCodeQR(code, 200)
    setSyncCode(code)
    setSyncDriverName(name)
    setSyncVehicleReg(reg)
    setSyncQR(qr)
    setSyncExpiry(new Date(Date.now() + 60 * 60 * 1000).toISOString())
    setActiveCodes(getActiveSyncCodes())
    setShareStatus(null)
    setCopied(false)
  }

  const handleCopy = async () => {
    await copySyncCode(syncCode)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  const handleShare = async (method) => {
    setShareStatus({ method, state: 'busy' })
    let res
    if (method === 'whatsapp') {
      shareSyncCodeWhatsApp(syncCode, syncDriverName, syncVehicleReg)
      res = { ok: true }
    } else if (method === 'email') {
      shareSyncCodeEmail(syncCode, syncDriverName, syncVehicleReg)
      res = { ok: true }
    } else if (method === 'native') {
      res = await shareSyncCodeNative(syncCode, syncDriverName, syncVehicleReg)
    }
    setShareStatus({ method, state: res?.ok ? 'ok' : 'fail', msg: res?.error })
    setTimeout(() => setShareStatus(null), 3500)
  }

  const handleSendCommand = () => {
    if (!cmdText.trim()) return
    const targetId = cmdDriver || 'all'
    if (cmdType === 'message') sendFleetMessage(targetId, cmdText.trim())
    else if (cmdType === 'alert') sendFleetAlert(targetId, cmdText.trim(), 'warning')
    else if (cmdType === 'dispatch') sendDispatchOrder(targetId, { description: cmdText.trim(), ts: new Date().toISOString() })
    setCmdSent(true)
    setCmdText('')
    setTimeout(() => setCmdSent(false), 2000)
  }

  const TABS = [
    { key: 'sync',     label: 'Sync Code',   icon: 'LinkIcon'      },
    { key: 'live',     label: 'Live Drivers', icon: 'Radio',        badge: livePositions.length || null },
    { key: 'commands', label: 'Commands',     icon: 'Send'          },
    { key: 'ai',       label: 'AI Reports',   icon: 'Cpu',          badge: aiReports.length || null },
  ]

  return (
    <div className="bg-[#0d1426] border border-violet-500/20 rounded-xl overflow-hidden">
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 sm:px-5 py-3.5 border-b border-slate-800/60">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-violet-500/15 border border-violet-500/25 flex items-center justify-center flex-shrink-0">
            <Icon name="Wifi" size={15} className="text-violet-400" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white font-display">Driver Sync</h2>
            <p className="text-2xs text-slate-500">Fleet ↔ Driver App live bridge</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-2xs text-slate-600 bg-slate-800/60 px-2 py-1 rounded-md font-mono">
            {livePositions.length} live · {activeCodes.length} codes
          </span>
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${livePositions.length > 0 ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)] animate-pulse' : 'bg-slate-600'}`} />
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="flex border-b border-slate-800/60 overflow-x-auto scrollbar-none">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-shrink-0 flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-all ${
              tab === t.key
                ? 'border-violet-400 text-violet-300'
                : 'border-transparent text-slate-500 hover:text-slate-300'
            }`}
          >
            <Icon name={t.icon} size={13} />
            {t.label}
            {t.badge ? (
              <span className="ml-1 bg-violet-500/25 text-violet-300 text-2xs font-bold px-1.5 py-0.5 rounded-full">{t.badge}</span>
            ) : null}
          </button>
        ))}
      </div>

      <div className="p-4 sm:p-5">

        {/* ══ TAB: SYNC CODE ══ */}
        {tab === 'sync' && (
          <div className="space-y-4">
            {/* Generator */}
            <div className="space-y-3">
              <p className="text-xs text-slate-400 leading-relaxed">
                Generate a secure sync code to pair the AP3X Driver App with this Fleet Control OS. The driver enters the code once — all data flows automatically.
              </p>

              {/* Driver + Vehicle selectors */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-2xs text-slate-500 mb-1.5 font-medium uppercase tracking-wider">Driver</label>
                  {drivers?.length > 0 ? (
                    <select
                      value={syncDriver}
                      onChange={e => {
                        setSyncDriver(e.target.value)
                        const d = drivers.find(dr => dr.id === e.target.value)
                        setSyncDriverName(d?.full_name || '')
                        setSyncVehicleReg(d?.vehicle_reg || d?.license_plate || '')
                      }}
                      className="w-full bg-slate-800/50 border border-slate-700/50 rounded-lg px-3 py-2 text-sm text-white focus:border-violet-500/50 focus:outline-none appearance-none"
                    >
                      <option value="">— Guest Driver —</option>
                      {drivers.map(d => (
                        <option key={d.id} value={d.id}>{d.full_name}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={syncDriverName}
                      onChange={e => setSyncDriverName(e.target.value)}
                      placeholder="Driver name"
                      className="w-full bg-slate-800/50 border border-slate-700/50 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:border-violet-500/50 focus:outline-none"
                    />
                  )}
                </div>
                <div>
                  <label className="block text-2xs text-slate-500 mb-1.5 font-medium uppercase tracking-wider">Vehicle Reg</label>
                  <input
                    value={syncVehicleReg}
                    onChange={e => setSyncVehicleReg(e.target.value)}
                    placeholder="e.g. AB12 CDE"
                    className="w-full bg-slate-800/50 border border-slate-700/50 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:border-violet-500/50 focus:outline-none font-mono"
                  />
                </div>
              </div>

              {/* Generate button */}
              <button
                onClick={handleGenerate}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-violet-500/20 border border-violet-500/30 text-violet-300 text-sm font-semibold hover:bg-violet-500/30 transition-all"
              >
                <Icon name="Zap" size={15} />
                Generate Sync Code
              </button>
            </div>

            {/* Code card */}
            {syncCode && (
              <>
                <SyncCodeCard
                  code={syncCode}
                  expiry={syncExpiry}
                  qr={syncQR}
                  driverName={syncDriverName}
                  vehicleReg={syncVehicleReg}
                  onRevoke={() => { revokeSyncCode(syncCode); setSyncCode(''); setSyncQR(null); setActiveCodes(getActiveSyncCodes()) }}
                  onCopy={handleCopy}
                  copied={copied}
                />

                {/* Share buttons */}
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { method: 'whatsapp', icon: 'MessageCircle', label: 'WhatsApp', color: 'emerald' },
                    { method: 'email',    icon: 'Mail',           label: 'Email',    color: 'blue'    },
                    { method: 'native',   icon: 'Share2',         label: 'Share',    color: 'slate'   },
                  ].map(b => (
                    <button
                      key={b.method}
                      onClick={() => handleShare(b.method)}
                      disabled={shareStatus?.state === 'busy'}
                      className={`flex flex-col items-center gap-1.5 px-2 py-2.5 rounded-lg border text-xs font-medium transition-all ${
                        shareStatus?.method === b.method && shareStatus.state === 'ok'
                          ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                          : 'bg-slate-800/40 border-slate-700/40 text-slate-400 hover:text-slate-200 hover:bg-slate-800/70'
                      }`}
                    >
                      <Icon name={b.icon} size={16} />
                      {b.label}
                    </button>
                  ))}
                </div>

                {shareStatus && (
                  <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${
                    shareStatus.state === 'ok'   ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20' :
                    shareStatus.state === 'fail' ? 'bg-red-500/10 text-red-300 border border-red-500/20' :
                    'bg-slate-800/50 text-slate-400 border border-slate-700/40'
                  }`}>
                    {shareStatus.state === 'busy' && <Icon name="Loader2" size={12} className="animate-spin" />}
                    {shareStatus.state === 'ok'   && <Icon name="CheckCircle" size={12} />}
                    {shareStatus.state === 'fail' && <Icon name="XCircle" size={12} />}
                    {shareStatus.state === 'ok'   ? 'Sent successfully' :
                     shareStatus.state === 'fail' ? (shareStatus.msg || 'Failed') :
                     'Sending…'}
                  </div>
                )}
              </>
            )}

            {/* Active codes */}
            {activeCodes.length > 0 && (
              <div>
                <p className="text-2xs text-slate-600 font-medium uppercase tracking-wider mb-2">Active Codes ({activeCodes.length})</p>
                <div className="space-y-2">
                  {activeCodes.map(c => (
                    <div key={c.code} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-slate-800/30 border border-slate-700/30">
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${c.status === 'active' ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                      <span className="font-mono text-xs text-slate-300 flex-1 truncate">{c.code}</span>
                      <span className="text-2xs text-slate-500 truncate">{c.driver_name}</span>
                      <span className={`text-2xs font-semibold px-1.5 py-0.5 rounded ${c.status === 'active' ? 'text-emerald-300 bg-emerald-500/10' : 'text-amber-300 bg-amber-500/10'}`}>
                        {c.status}
                      </span>
                      <button onClick={() => { revokeSyncCode(c.code); setActiveCodes(getActiveSyncCodes()) }}
                        className="p-1 text-slate-600 hover:text-red-400 transition-colors">
                        <Icon name="X" size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* How it works */}
            <div className="bg-slate-800/20 border border-slate-700/30 rounded-lg p-3 space-y-2">
              <p className="text-2xs font-semibold text-slate-400 uppercase tracking-wider">How Sync Works</p>
              {[
                ['1', 'Generate a sync code above and share it with the driver'],
                ['2', 'Driver opens AP3X Driver App → taps "Enter Sync Code"'],
                ['3', 'Driver app pairs instantly — location streams to fleet map'],
                ['4', 'AI agents (Sentinel + RouteMind) send reports back here'],
                ['5', 'Send commands, alerts, and dispatch orders from the Commands tab'],
              ].map(([n, txt]) => (
                <div key={n} className="flex items-start gap-2">
                  <span className="w-4 h-4 rounded-full bg-violet-500/20 text-violet-400 text-2xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{n}</span>
                  <span className="text-2xs text-slate-400 leading-relaxed">{txt}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ══ TAB: LIVE DRIVERS ══ */}
        {tab === 'live' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-400">Real-time driver positions from paired apps</p>
              <span className="text-2xs text-slate-600">Updates every 5s</span>
            </div>

            {activeDrivers.length === 0 && livePositions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 gap-3">
                <div className="w-12 h-12 rounded-full bg-slate-800/60 border border-slate-700/40 flex items-center justify-center">
                  <Icon name="MapPin" size={20} className="text-slate-600" />
                </div>
                <p className="text-sm text-slate-500">No drivers connected</p>
                <p className="text-2xs text-slate-600 text-center max-w-xs">
                  Generate a sync code on the Sync Code tab and share it with a driver to see their live location here
                </p>
              </div>
            ) : (
              <>
                {/* Live position cards */}
                {livePositions.map(pos => {
                  const age = Math.floor((Date.now() - new Date(pos.ts).getTime()) / 1000)
                  return (
                    <div key={pos.vehicle_id} className="bg-[#060b18] border border-cyan-500/20 rounded-lg p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_6px_rgba(0,212,255,0.8)] animate-pulse" />
                          <span className="text-sm font-medium text-white">{pos.driver_id}</span>
                          <span className="text-2xs text-slate-600 font-mono">{pos.vehicle_id}</span>
                        </div>
                        <span className="text-2xs text-slate-600">{age < 60 ? `${age}s ago` : `${Math.floor(age/60)}m ago`}</span>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="text-center bg-slate-800/30 rounded-lg py-1.5">
                          <div className="text-xs font-bold text-cyan-400 font-mono">{pos.speed ?? 0}</div>
                          <div className="text-2xs text-slate-600">km/h</div>
                        </div>
                        <div className="text-center bg-slate-800/30 rounded-lg py-1.5">
                          <div className="text-xs font-bold text-slate-300 font-mono">{pos.lat?.toFixed(5)}</div>
                          <div className="text-2xs text-slate-600">lat</div>
                        </div>
                        <div className="text-center bg-slate-800/30 rounded-lg py-1.5">
                          <div className="text-xs font-bold text-slate-300 font-mono">{pos.lng?.toFixed(5)}</div>
                          <div className="text-2xs text-slate-600">lng</div>
                        </div>
                      </div>
                      <div className="mt-2 flex items-center gap-2 text-2xs text-slate-500">
                        <Icon name="Navigation" size={10} />
                        <span>Heading {pos.heading ?? 0}° · Accuracy ±{pos.accuracy ?? 0}m · {pos.status ?? 'en_route'}</span>
                      </div>
                    </div>
                  )
                })}

                {/* Active driver rows */}
                {activeDrivers.map(d => (
                  <ActiveDriverRow
                    key={d.driver_id || d.code}
                    driver={d}
                    onMessage={(drv) => { setCmdDriver(drv.driver_id); setCmdType('message'); setTab('commands') }}
                    onAlert={(drv) =>   { setCmdDriver(drv.driver_id); setCmdType('alert');   setTab('commands') }}
                  />
                ))}

                <p className="text-2xs text-slate-600 text-center pt-1">
                  Live positions also visible on the <button onClick={() => {}} className="text-cyan-400 hover:underline">Fleet Map</button> — go to Navigation
                </p>
              </>
            )}
          </div>
        )}

        {/* ══ TAB: COMMANDS ══ */}
        {tab === 'commands' && (
          <div className="space-y-4">
            <p className="text-xs text-slate-400">Send real-time commands, alerts, and dispatch orders to connected drivers</p>

            {/* Target driver */}
            <div>
              <label className="block text-2xs text-slate-500 mb-1.5 font-medium uppercase tracking-wider">Target Driver</label>
              <select
                value={cmdDriver}
                onChange={e => setCmdDriver(e.target.value)}
                className="w-full bg-slate-800/50 border border-slate-700/50 rounded-lg px-3 py-2 text-sm text-white focus:border-violet-500/50 focus:outline-none appearance-none"
              >
                <option value="">— Broadcast to All Drivers —</option>
                {activeDrivers.map(d => (
                  <option key={d.driver_id} value={d.driver_id}>{d.driver_name} ({d.vehicle_reg})</option>
                ))}
                {drivers?.map(d => (
                  <option key={d.id} value={d.id}>{d.full_name}</option>
                ))}
              </select>
            </div>

            {/* Command type */}
            <div>
              <label className="block text-2xs text-slate-500 mb-1.5 font-medium uppercase tracking-wider">Command Type</label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { key: 'message',  icon: 'MessageSquare', label: 'Message',  color: 'cyan'  },
                  { key: 'alert',    icon: 'AlertTriangle', label: 'Alert',    color: 'amber' },
                  { key: 'dispatch', icon: 'Package',       label: 'Dispatch', color: 'violet'},
                ].map(t => (
                  <button
                    key={t.key}
                    onClick={() => setCmdType(t.key)}
                    className={`flex flex-col items-center gap-1.5 py-2.5 rounded-lg border text-xs font-medium transition-all ${
                      cmdType === t.key
                        ? t.color === 'cyan'   ? 'bg-cyan-500/15 border-cyan-500/30 text-cyan-300'     :
                          t.color === 'amber'  ? 'bg-amber-500/15 border-amber-500/30 text-amber-300'  :
                          'bg-violet-500/15 border-violet-500/30 text-violet-300'
                        : 'bg-slate-800/30 border-slate-700/30 text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    <Icon name={t.icon} size={15} />
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Message input */}
            <div>
              <label className="block text-2xs text-slate-500 mb-1.5 font-medium uppercase tracking-wider">
                {cmdType === 'message' ? 'Message' : cmdType === 'alert' ? 'Alert Text' : 'Job / Instruction'}
              </label>
              <textarea
                value={cmdText}
                onChange={e => setCmdText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendCommand() } }}
                placeholder={
                  cmdType === 'message'  ? 'Type a message to the driver…' :
                  cmdType === 'alert'    ? 'e.g. Road closure on A1, take M6 alternate' :
                  'e.g. Pick up at Unit 4, Parkway Industrial Estate — Ref: JB-2042'
                }
                rows={3}
                className="w-full bg-slate-800/50 border border-slate-700/50 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:border-violet-500/50 focus:outline-none resize-none"
              />
            </div>

            <button
              onClick={handleSendCommand}
              disabled={!cmdText.trim()}
              className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold transition-all ${
                cmdSent
                  ? 'bg-emerald-500/20 border border-emerald-500/30 text-emerald-300'
                  : 'bg-violet-500/20 border border-violet-500/30 text-violet-300 hover:bg-violet-500/30 disabled:opacity-40 disabled:cursor-not-allowed'
              }`}
            >
              {cmdSent ? <><Icon name="CheckCircle" size={15} /> Sent!</> : <><Icon name="Send" size={15} /> Send {cmdType === 'message' ? 'Message' : cmdType === 'alert' ? 'Alert' : 'Dispatch Order'}</>}
            </button>

            {/* Quick command buttons */}
            <div>
              <p className="text-2xs text-slate-600 mb-2 uppercase tracking-wider font-medium">Quick Commands</p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: 'Return to base',          type: 'alert',   text: 'Return to base immediately.' },
                  { label: 'Check in required',       type: 'message', text: 'Please check in — confirm your current status.' },
                  { label: 'Speed advisory',          type: 'alert',   text: 'Reduce speed — road conditions ahead.' },
                  { label: 'Delivery confirmed',      type: 'message', text: '✓ Delivery confirmed by control. Proceed to next stop.' },
                ].map(q => (
                  <button
                    key={q.label}
                    onClick={() => { setCmdType(q.type); setCmdText(q.text) }}
                    className="text-left px-3 py-2 rounded-lg bg-slate-800/30 border border-slate-700/30 text-2xs text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition-colors"
                  >
                    {q.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ══ TAB: AI REPORTS ══ */}
        {tab === 'ai' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-400">Live AI agent reports from all connected driver apps</p>
              <button
                onClick={() => { localStorage.removeItem('apex:ai_reports'); setAIReports([]) }}
                className="text-2xs text-slate-600 hover:text-slate-400 transition-colors"
              >Clear</button>
            </div>

            {/* KPI strip */}
            {aiReports.length > 0 && (() => {
              const sentinels = aiReports.filter(r => r.type === 'sentinel')
              const avgFatigue = sentinels.length ? Math.round(sentinels.reduce((s, r) => s + (r.data?.fatigue_score ?? 0), 0) / sentinels.length) : null
              const avgSafety  = sentinels.length ? Math.round(sentinels.reduce((s, r) => s + (r.data?.safety_score  ?? 0), 0) / sentinels.length) : null
              const harshCount = aiReports.filter(r => r.type === 'harsh_event').length
              const drivers    = new Set(aiReports.map(r => r.driver_id)).size
              return (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { label: 'Avg Fatigue', val: avgFatigue != null ? `${avgFatigue}%` : '—', color: avgFatigue > 70 ? 'red' : avgFatigue > 40 ? 'amber' : 'emerald' },
                    { label: 'Avg Safety',  val: avgSafety  != null ? `${avgSafety}%`  : '—', color: avgSafety  < 50 ? 'red' : avgSafety  < 75 ? 'amber' : 'emerald' },
                    { label: 'Harsh Events',val: harshCount,  color: harshCount > 0 ? 'red' : 'slate' },
                    { label: 'Active AIs',  val: drivers,     color: 'violet' },
                  ].map(k => (
                    <div key={k.label} className={`text-center py-2.5 rounded-lg border ${
                      k.color === 'red'     ? 'bg-red-500/8 border-red-500/20'         :
                      k.color === 'amber'   ? 'bg-amber-500/8 border-amber-500/20'     :
                      k.color === 'emerald' ? 'bg-emerald-500/8 border-emerald-500/20' :
                      k.color === 'violet'  ? 'bg-violet-500/8 border-violet-500/20'   :
                      'bg-slate-800/30 border-slate-700/30'
                    }`}>
                      <div className={`text-lg font-bold font-mono ${
                        k.color === 'red'     ? 'text-red-400'     :
                        k.color === 'amber'   ? 'text-amber-400'   :
                        k.color === 'emerald' ? 'text-emerald-400' :
                        k.color === 'violet'  ? 'text-violet-400'  : 'text-slate-400'
                      }`}>{k.val}</div>
                      <div className="text-2xs text-slate-600 mt-0.5">{k.label}</div>
                    </div>
                  ))}
                </div>
              )
            })()}

            {aiReports.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 gap-3">
                <div className="w-12 h-12 rounded-full bg-slate-800/60 border border-slate-700/40 flex items-center justify-center">
                  <Icon name="Cpu" size={20} className="text-slate-600" />
                </div>
                <p className="text-sm text-slate-500">No AI reports yet</p>
                <p className="text-2xs text-slate-600 text-center max-w-xs">
                  Connect a driver app to see Sentinel AI fatigue scores, RouteMind reports, and harsh event alerts in real time
                </p>
              </div>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto scrollbar-none">
                {aiReports.map(r => <AIReportCard key={r.id} report={r} />)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}



// ─── Driver App Summary Card (Dashboard widget) ───────────────
function DriverAppSummaryCard({ drivers }) {
  const [telemetryCount, setTelemetryCount] = useState(0)
  const [msgCount,       setMsgCount]       = useState(0)
  const [activeCodes,    setActiveCodes]    = useState(() => getActivePairingCodes())
  const navigate = useNavigate()

  useEffect(() => {
    const u1 = listenForDriverTelemetry(() => setTelemetryCount(n => n + 1))
    const u2 = listenForDriverMessages(m => { if (m.from === 'driver') setMsgCount(n => n + 1) })
    const u3 = listenForPairingEvents(() => setActiveCodes(getActivePairingCodes()))
    return () => { u1(); u2(); u3() }
  }, [])

  const paired  = activeCodes.filter(c => c.paired).length
  const pending = activeCodes.filter(c => !c.paired && new Date(c.expires_at) > new Date()).length

  return (
    <div className="bg-[#0d1426] border border-violet-500/20 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
            <Icon name="Smartphone" size={14} className="text-violet-400" />
          </div>
          <div>
            <span className="text-sm font-semibold text-white">AP3X Driver App</span>
            <p className="text-2xs text-slate-500 mt-0.5">Set up, pair and monitor driver devices</p>
          </div>
        </div>
        <button
          onClick={() => navigate(ROUTES.DRIVER_SETUP)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-violet-300 bg-violet-500/10 border border-violet-500/20 hover:bg-violet-500/20 transition-all"
        >
          <Icon name="ArrowRight" size={12} /> Open
        </button>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Paired',    val: paired,         icon: 'Link',          color: paired > 0  ? 'text-emerald-400' : 'text-slate-600' },
          { label: 'Pending',   val: pending,        icon: 'Clock',         color: pending > 0 ? 'text-amber-400'  : 'text-slate-600' },
          { label: 'New Msgs',  val: msgCount,       icon: 'MessageSquare', color: msgCount > 0 ? 'text-violet-400' : 'text-slate-600' },
        ].map(s => (
          <div key={s.label} className="bg-slate-900/40 rounded-lg p-3 text-center">
            <Icon name={s.icon} size={14} className={`${s.color} mx-auto mb-1`} />
            <div className={`font-mono text-lg font-bold ${s.color}`}>{s.val}</div>
            <div className="text-2xs text-slate-600">{s.label}</div>
          </div>
        ))}
      </div>
      <button
        onClick={() => navigate(ROUTES.DRIVER_SETUP)}
        className="mt-4 w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-violet-500/20 bg-violet-500/5 hover:bg-violet-500/10 text-xs font-semibold text-violet-300 transition-all"
      >
        <Icon name="KeyRound" size={13} /> Generate Driver Code &amp; Set Up Driver App
      </button>
    </div>
  )
}

// ─── Sync Verification Hook ───────────────────────────────────
/**
 * useSyncVerification — hybrid realtime + polling Supabase data-flow check.
 *
 * Realtime path  : subscribeToDashboardEvents fires instantly on every INSERT.
 * Polling path   : runSyncVerification() every 30s catches driver_locations
 *                  and tasks updates that are not in dashboard_events.
 * Both paths are READ ONLY. Safe — never throws, never writes.
 */
function useSyncVerification() {
  const [syncState, setSyncState] = useState({
    supabaseReady:      false,
    health:             SYNC_HEALTH.UNKNOWN,
    lastEventType:      null,
    lastEventSource:    null,
    lastEventTimestamp: null,
    ageLabel:           '—',
    preview:            null,
    sources:            null,
    error:              null,
    loading:            true,
    liveUpdates:        0,        // count of realtime inserts received this session
  })

  // ── Full verification poll (covers all three table sources) ───
  const runCheck = useCallback(async () => {
    try {
      const result = await runSyncVerification()
      setSyncState(prev => ({
        ...prev,
        supabaseReady:      result.supabaseReady,
        health:             result.health,
        lastEventType:      result.lastEventType,
        lastEventSource:    result.lastEventSource,
        lastEventTimestamp: result.lastEventTimestamp,
        ageLabel:           result.ageLabel,
        preview:            result.latestEvent?.preview ?? null,
        sources:            result.sources,
        error:              result.error,
        loading:            false,
      }))
    } catch {
      setSyncState(prev => ({ ...prev, loading: false }))
    }
  }, [])

  // ── Realtime: instant update on every dashboard_events INSERT ─
  useEffect(() => {
    // Run an initial poll immediately
    runCheck()

    // Subscribe to dashboard_events realtime (READ ONLY)
    const unsub = subscribeToDashboardEvents((row) => {
      if (!row) return
      const ts = row.created_at || new Date().toISOString()
      const { health, ageLabel } = { health: SYNC_HEALTH.LIVE, ageLabel: 'just now' }
      setSyncState(prev => ({
        ...prev,
        supabaseReady:      true,
        health,
        lastEventType:      row.type      ?? prev.lastEventType,
        lastEventSource:    row.payload?.source ?? 'fleet_os',
        lastEventTimestamp: ts,
        ageLabel,
        preview:            row.payload
                              ? Object.keys(row.payload).slice(0,3)
                                  .map(k => `${k}: ${String(row.payload[k]).slice(0,20)}`)
                                  .join(' · ')
                              : null,
        sources:            prev.sources ?? ['dashboard_events'],
        error:              null,
        loading:            false,
        liveUpdates:        prev.liveUpdates + 1,
      }))
    })

    // Poll every 30s for driver_locations + tasks (not in dashboard_events stream)
    const id = setInterval(runCheck, 30_000)

    return () => {
      unsub()
      clearInterval(id)
    }
  }, [runCheck])

  return { ...syncState, refresh: runCheck }
}

// ─── Sync Status Panel Component ──────────────────────────────
/**
 * SyncStatusPanel — non-intrusive diagnostic row.
 * Shows Supabase sync health, last event type, and data age.
 * Renders nothing if Supabase is not configured (local mode).
 *
 * Placement: below Intel KPI strip, above empty-state / main grid.
 * Design: matches existing dark-theme card style exactly.
 */
function SyncStatusPanel() {
  const { supabaseReady, health, lastEventType, lastEventSource,
          lastEventTimestamp, ageLabel, preview, sources, error, loading, liveUpdates, refresh } = useSyncVerification()

  // Don't render if Supabase is not set up at all
  if (!supabaseReady && !loading) return null

  const HEALTH_CONFIG = {
    [SYNC_HEALTH.LIVE]:    { label: 'LIVE',    dot: 'bg-emerald-400', pulse: true,  color: 'text-emerald-400', border: 'border-emerald-500/15', bg: 'bg-emerald-500/5' },
    [SYNC_HEALTH.DELAYED]: { label: 'DELAYED', dot: 'bg-amber-400',   pulse: false, color: 'text-amber-400',   border: 'border-amber-500/15',   bg: 'bg-amber-500/5'   },
    [SYNC_HEALTH.STALE]:   { label: 'STALE',   dot: 'bg-red-400',     pulse: false, color: 'text-red-400',     border: 'border-red-500/15',     bg: 'bg-red-500/5'     },
    [SYNC_HEALTH.UNKNOWN]: { label: 'UNKNOWN', dot: 'bg-slate-600',   pulse: false, color: 'text-slate-500',   border: 'border-slate-800/60',   bg: 'bg-slate-900/40'  },
  }
  const cfg = HEALTH_CONFIG[health] ?? HEALTH_CONFIG[SYNC_HEALTH.UNKNOWN]

  return (
    <div className="bg-[#0d1426] border border-slate-800/60 rounded-xl p-4">
      {/* Panel header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Icon name="Radio" size={13} className="text-slate-600" />
          <span className="text-sm font-semibold text-white">Sync Verification</span>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          title="Re-check sync"
          className="w-6 h-6 flex items-center justify-center rounded-md bg-slate-900 border border-slate-800 text-slate-600 hover:text-slate-300 transition-colors">
          <Icon name="RefreshCw" size={11} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Status row */}
      <div className="flex flex-wrap items-center gap-3">

        {/* Sync Health Badge */}
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${cfg.bg} ${cfg.border}`}>
          <span className="relative flex h-2 w-2">
            {cfg.pulse && <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${cfg.dot} opacity-60`} />}
            <span className={`relative inline-flex rounded-full h-2 w-2 ${cfg.dot}`} />
          </span>
          <span className={`text-xs font-bold font-mono ${cfg.color}`}>{cfg.label}</span>
        </div>

        {/* Last Event Received */}
        <div className="flex items-center gap-1.5">
          <Icon name="Clock" size={11} className="text-slate-600" />
          <span className="text-2xs text-slate-500">Last event:</span>
          <span className="text-2xs font-mono text-slate-300">
            {loading ? '…' : (ageLabel ?? '—')}
          </span>
        </div>

        {/* Last Event Type */}
        {lastEventType && lastEventType !== 'UNKNOWN' && (
          <div className="flex items-center gap-1.5">
            <Icon name="Tag" size={11} className="text-slate-600" />
            <span className="text-2xs text-slate-500">Type:</span>
            <span className="text-2xs font-mono text-cyan-400">{lastEventType}</span>
          </div>
        )}

        {/* Source */}
        {lastEventSource && lastEventSource !== 'unknown' && (
          <div className="flex items-center gap-1.5">
            <Icon name="Cpu" size={11} className="text-slate-600" />
            <span className="text-2xs text-slate-500">Source:</span>
            <span className="text-2xs font-mono text-slate-400">{lastEventSource}</span>
          </div>
        )}

        {/* Sources checked */}
        {sources && sources.length > 0 && (
          <div className="flex items-center gap-1.5 ml-auto">
            <Icon name="Database" size={10} className="text-slate-700" />
            <span className="text-2xs text-slate-700">{sources.join(' · ')}</span>
          </div>
        )}

        {/* Live update counter — shows realtime inserts received this session */}
        {liveUpdates > 0 && (
          <div className="flex items-center gap-1.5">
            <Icon name="Zap" size={10} className="text-cyan-600" />
            <span className="text-2xs font-mono text-cyan-700">{liveUpdates} live</span>
          </div>
        )}
      </div>

      {/* Payload preview — only show when health is not LIVE (diagnostic context) */}
      {preview && health !== SYNC_HEALTH.LIVE && (
        <div className="mt-2.5 px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-800/40">
          <span className="text-2xs text-slate-600 font-mono break-all">{preview}</span>
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <div className="mt-2 flex items-center gap-2 text-2xs text-amber-400">
          <Icon name="AlertCircle" size={10} />
          <span>{error}</span>
        </div>
      )}
    </div>
  )
}

export default function Dashboard() {
  const navigate = useNavigate()
  const { vehicles } = useFleetStore(s => ({ vehicles: s.vehicles }))
  const { drivers }  = useDriverStore(s => ({ drivers:  s.drivers  }))
  const [alerts,  setAlerts]  = useState([])
  const [loading, setLoading] = useState(true)
  const mapRef = useRef(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      await Promise.all([
        fleetService.fetchVehicles(),
        driverService.fetchDrivers(),
      ])
      const fresh = safetyService.fetchAlerts({ resolved: false })
      setAlerts(Array.isArray(fresh) ? fresh : [])
    } catch (err) {
      console.error('Dashboard load error:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Live telemetry → update vehicle positions in store (NO full reload).
  // telemetryService.subscribeToAll already calls useFleetStore.updateTelemetry internally.
  // A full load() on every GPS tick causes cascading Supabase fetches — avoided here.
  // The 15s interval below is the correct cadence for full data refresh.
  useEffect(() => {
    const unsub = telemetryService.subscribeToAll(() => {
      // Telemetry is already pushed into useFleetStore by the service itself.
      // No load() needed here — vehicle positions update reactively via the store.
    })
    return () => unsub?.()
  }, [])

  // Subscribe to structural changes (new vehicles / drivers added or removed).
  // These are low-frequency — a full load() is appropriate.
  useEffect(() => {
    const u1 = fleetService.subscribeToVehicles(() => load())
    const u2 = driverService.subscribeToDrivers(() => load())
    return () => { u1?.(); u2?.() }
  }, [load])

  // Full data refresh every 30s — balanced cadence for live fleet operations.
  // 15s was too aggressive when Supabase is the backend (doubles request rate).
  useEffect(() => {
    const id = setInterval(load, 30000)
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

  // ── Apex Intelligence KPIs ─────────────────────────────────
  // Recompute when vehicle/driver DATA changes, not just count changes.
  // Stable fingerprint: join vehicle ids+status+fuel and driver ids+score.
  // This avoids stale KPIs when records update in-place (same count, new values).
  const vehicleFingerprint = vehicles.map(v => `${v.id}:${v.status}:${v.fuel_level ?? ''}`).join('|')
  const driverFingerprint  = drivers.map(d => `${d.id}:${d.safety_score ?? ''}:${d.status}`).join('|')
  const alertFingerprint   = alerts.length

  const [intelKPIs, setIntelKPIs] = useState(null)
  useEffect(() => {
    try {
      const fleetStats   = fleetLearning.getFleetStats()
      const intelligence = fleetLearning.getIntelligenceSummary()
      const compScore    = complianceEngine.getFleetComplianceScore(vehicles)
      const safetyKPIs   = safetyEngine.getFleetSafetyKPIs(vehicles, drivers)
      const riskDrivers  = driverLearning.rankByRisk(drivers.map(d => d.id).filter(Boolean)).filter(d => d.riskScore > 60)
      setIntelKPIs({ fleetStats, intelligence, compScore, safetyKPIs, riskDrivers })
    } catch (err) {
      console.warn('[Dashboard] intelKPIs compute error:', err.message)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleFingerprint, driverFingerprint, alertFingerprint])

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

        {/* ── Sync Verification Panel ─────────────────────────────
             Read-only Supabase data-flow diagnostic. Shows last
             received event, type, source, and sync health.
             Renders nothing when Supabase is not configured.     */}
        <SyncStatusPanel />

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

        {/* Driver App — slim summary card */}
        <DriverAppSummaryCard drivers={drivers} />

        {/* Quick actions */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
          {[
            { label: 'Set Driver Up',      icon: 'Smartphone',     color: 'text-violet-400',  route: ROUTES.DRIVER_SETUP },
            { label: 'New Dispatch Job',   icon: 'Radio',          color: 'text-cyan-400',    route: ROUTES.DISPATCH    },
            { label: 'Report Incident',    icon: 'FileText',       color: 'text-red-400',     route: ROUTES.INCIDENTS   },
            { label: 'Safety AI',          icon: 'ShieldAlert',    color: 'text-amber-400',   route: ROUTES.SAFETY      },
            { label: 'Compliance AI',      icon: 'ClipboardCheck', color: 'text-emerald-400', route: ROUTES.COMPLIANCE  },
            { label: 'AI Intelligence',    icon: 'Brain',          color: 'text-violet-400',  route: ROUTES.AI          },
            { label: 'Live Fleet Map',     icon: 'Map',            color: 'text-cyan-400',    route: ROUTES.NAVIGATION  },
            { label: 'Fleet Control',      icon: 'Truck',          color: 'text-slate-400',   route: ROUTES.FLEET       },
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
