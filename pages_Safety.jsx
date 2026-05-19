/**
 * ============================================================
 * APEX AI — Safety AI Page (Run 8)
 * ============================================================
 */

import { useState, useEffect, useCallback } from 'react'
import Icon from './components_ui_Icon'
import Badge from './components_ui_Badge'
import StatusDot from './components_ui_StatusDot'
import TelemetryValue from './components_ui_TelemetryValue'
import { safetyService, ALERT_SEVERITY, ALERT_TYPE, SEVERITY_COLORS } from './services_safety_safetyService'
import { formatDateTime } from './utils_format'

const ALERT_ICONS = {
  speeding: 'Gauge', harsh_brake: 'AlertOctagon', harsh_acceleration: 'Zap',
  fatigue: 'Eye', phone_use: 'Smartphone', seatbelt: 'AlertCircle',
  lane_departure: 'ArrowLeftRight', collision: 'Siren', geofence_breach: 'MapPin'
}

const SEV_TABS = [
  { key: null,                    label: 'All' },
  { key: ALERT_SEVERITY.CRITICAL, label: 'Critical' },
  { key: ALERT_SEVERITY.HIGH,     label: 'High' },
  { key: ALERT_SEVERITY.MEDIUM,   label: 'Medium' },
  { key: ALERT_SEVERITY.LOW,      label: 'Low' },
]

function AlertCard({ alert, onResolve }) {
  const sev   = SEVERITY_COLORS[alert.severity] || SEVERITY_COLORS.low
  const icon  = ALERT_ICONS[alert.type] || 'AlertTriangle'
  return (
    <div className={`bg-[#0d1426] border rounded-lg p-4 transition-all ${
      alert.resolved ? 'border-slate-800/30 opacity-50' : `border-slate-800/60 ${alert.severity === 'critical' ? 'border-l-2 border-l-red-500' : ''}`
    }`}>
      <div className="flex items-start gap-3">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
          alert.severity === 'critical' ? 'bg-red-500/10 border border-red-500/20' :
          alert.severity === 'high'     ? 'bg-red-500/5  border border-red-500/10' :
          alert.severity === 'medium'   ? 'bg-amber-500/5 border border-amber-500/20' :
          'bg-slate-800/60 border border-slate-800'
        }`}>
          <Icon name={icon} size={16} className={
            alert.severity === 'critical' ? 'text-red-400' :
            alert.severity === 'high'     ? 'text-red-400' :
            alert.severity === 'medium'   ? 'text-amber-400' : 'text-slate-500'
          } />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-sm font-medium text-white capitalize">
              {alert.type?.replace(/_/g, ' ')}
            </span>
            <Badge variant={sev.variant} size="sm">{alert.severity}</Badge>
          </div>
          <div className="text-xs text-slate-500 mb-1 truncate">
            {alert.driver_name || 'Unknown Driver'} · {alert.vehicle_reg || '—'}
          </div>
          <div className="text-xs text-slate-600">{formatDateTime(alert.created_at)}</div>
          {alert.description && <div className="text-xs text-slate-500 mt-1 line-clamp-2">{alert.description}</div>}
        </div>
        {!alert.resolved && (
          <button onClick={() => onResolve(alert.id)}
            className="px-2 py-1 text-xs text-emerald-400 border border-emerald-500/20 rounded hover:bg-emerald-500/10 transition-colors flex-shrink-0">
            Resolve
          </button>
        )}
        {alert.resolved && <Icon name="CheckCircle2" size={16} className="text-emerald-400/50 flex-shrink-0" />}
      </div>
    </div>
  )
}

function SafetyStatCard({ label, value, sub, icon, color }) {
  return (
    <div className="bg-[#0d1426] border border-slate-800/60 rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-slate-500 font-medium tracking-widest uppercase">{label}</span>
        <Icon name={icon} size={14} className={color || 'text-slate-600'} />
      </div>
      <div className={`font-mono text-2xl font-bold ${color || 'text-white'}`}>{value}</div>
      {sub && <div className="text-xs text-slate-600 mt-1">{sub}</div>}
    </div>
  )
}

export default function Safety() {
  const [alerts,       setAlerts]       = useState([])
  const [loading,      setLoading]      = useState(true)
  const [sevFilter,    setSevFilter]    = useState(null)
  const [showResolved, setShowResolved] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    try {
      const data = safetyService.fetchAlerts({ severity: sevFilter, resolved: showResolved ? undefined : false })
      setAlerts(data)
    } finally { setLoading(false) }
  }, [sevFilter, showResolved])

  useEffect(() => { load() }, [load])

  // Subscribe to live alerts
  useEffect(() => {
    const sub = safetyService.subscribeToAlerts(newAlert => {
      setAlerts(prev => [newAlert, ...prev].slice(0, 100))
    })
    return () => sub.unsubscribe()
  }, [])

  const handleResolve = async (id) => {
    safetyService.resolveAlert(id)
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, resolved: true } : a))
  }

  const activeAlerts   = alerts.filter(a => !a.resolved)
  const critical       = activeAlerts.filter(a => a.severity === ALERT_SEVERITY.CRITICAL).length
  const high           = activeAlerts.filter(a => a.severity === ALERT_SEVERITY.HIGH).length
  const filtered       = alerts.filter(a => {
    if (!showResolved && a.resolved) return false
    if (sevFilter && a.severity !== sevFilter) return false
    return true
  })

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-slate-800/60 flex-shrink-0">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="font-display text-xl font-bold text-white">Safety AI</h1>
            <p className="text-slate-500 text-xs mt-0.5">Real-time safety monitoring and alerts</p>
          </div>
          <div className="flex items-center gap-2">
            {critical > 0 && (
              <div className="flex items-center gap-1.5 bg-red-500/10 border border-red-500/30 rounded-full px-3 py-1">
                <div className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                <span className="text-xs text-red-400 font-semibold">{critical} Critical</span>
              </div>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <SafetyStatCard label="Active Alerts"  value={activeAlerts.length} icon="Bell"        color="text-cyan-400" />
          <SafetyStatCard label="Critical"       value={critical}            icon="AlertOctagon" color="text-red-400" />
          <SafetyStatCard label="High Priority"  value={high}                icon="AlertTriangle" color="text-amber-400" />
          <SafetyStatCard label="Resolved Today" value={alerts.filter(a => a.resolved).length} icon="CheckCircle2" color="text-emerald-400" />
        </div>

        {/* Tabs + controls */}
        <div className="flex items-center gap-2 flex-wrap">
          {SEV_TABS.map(t => (
            <button key={t.key} onClick={() => setSevFilter(t.key)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                sevFilter === t.key ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/40'
              }`}>
              {t.label}
            </button>
          ))}
          <div className="flex-1" />
          <label className="flex items-center gap-2 text-xs text-slate-500 cursor-pointer">
            <input type="checkbox" checked={showResolved} onChange={e => setShowResolved(e.target.checked)}
              className="w-3.5 h-3.5 rounded" />
            Show resolved
          </label>
          <button onClick={load} disabled={loading} className="btn-ghost p-2">
            <Icon name="RefreshCw" size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {loading && filtered.length === 0 ? (
          <div className="flex items-center justify-center h-48">
            <div className="w-8 h-8 border-2 border-cyan-500/20 border-t-cyan-400 rounded-full animate-spin" />
          </div>
        ) : (
          <div className="space-y-3 max-w-3xl">
            {filtered.map(a => <AlertCard key={a.id} alert={a} onResolve={handleResolve} />)}
            {filtered.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 text-slate-600">
                <Icon name="ShieldCheck" size={40} className="mb-4 opacity-20" />
                <p className="text-sm">No alerts {sevFilter ? `for severity: ${sevFilter}` : ''}</p>
                <p className="text-xs mt-1">All systems nominal</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
