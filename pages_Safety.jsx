/**
 * ============================================================
 * APEX AI — Safety AI Page (Run 8)
 * ============================================================
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import Icon from './components_ui_Icon'
import Badge from './components_ui_Badge'
import StatusDot from './components_ui_StatusDot'
import TelemetryValue from './components_ui_TelemetryValue'
import { safetyService, ALERT_SEVERITY, ALERT_TYPE, SEVERITY_COLORS } from './services_safety_safetyService'
import { formatDateTime } from './utils_format'
import { useAIChat }    from './modules_ai_useAIChat'
import { AI_MODULES }   from './services_ai_aiConfig'
import { getRuntimeKey, RUNTIME_KEYS } from './services_maps_runtimeKeys'


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


// ─── Apex Sentinel AI Chat Panel ─────────────────────────────
function SentinelAIPanel() {
  const { messages, streaming, error, sendMessage, clearMessages } = useAIChat(AI_MODULES.APEX_SENTINEL)
  const [input, setInput] = useState('')
  const [noKey, setNoKey]  = useState(false)
  const chatEndRef = useRef(null)

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages.length])
  useEffect(() => {
    // Check if any key is available
    const keys = [RUNTIME_KEYS.OPENAI, RUNTIME_KEYS.OPENROUTER, RUNTIME_KEYS.GROQ,
                  RUNTIME_KEYS.DEEPSEEK, RUNTIME_KEYS.MISTRAL, RUNTIME_KEYS.ANTHROPIC, RUNTIME_KEYS.GEMINI]
    setNoKey(!keys.some(k => !!getRuntimeKey(k)))
  }, [])

  const STARTERS = [
    'Analyse current driver safety scores and identify the highest risk drivers',
    'What are the most common harsh braking patterns this week?',
    'Generate a fatigue risk assessment for drivers on long shifts today',
    'Recommend safety training priorities based on recent incident data',
    'Which routes have the highest accident risk and why?',
  ]

  const handleSend = () => {
    if (!input.trim() || streaming) return
    sendMessage(input.trim())
    setInput('')
  }

  return (
    <div className="bg-[#0d1426] border border-red-500/20 rounded-xl overflow-hidden flex flex-col" style={{ height: '440px' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800/60 flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center justify-center">
            <Icon name="ShieldAlert" size={14} className="text-red-400" />
          </div>
          <div>
            <span className="text-sm font-semibold text-white">Apex Sentinel AI</span>
            <p className="text-2xs text-slate-500">Safety intelligence · Driver risk analysis</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {messages.length > 0 && (
            <button onClick={clearMessages} className="text-2xs text-slate-600 hover:text-slate-400 transition-colors">Clear</button>
          )}
          <div className={`w-2 h-2 rounded-full ${streaming ? 'bg-red-400 animate-pulse' : 'bg-emerald-400'}`} />
        </div>
      </div>

      {/* No key warning */}
      {noKey && (
        <div className="mx-3 mt-3 flex items-start gap-2 p-3 rounded-lg bg-amber-500/8 border border-amber-500/20 flex-shrink-0">
          <Icon name="AlertTriangle" size={13} className="text-amber-400 mt-0.5 flex-shrink-0" />
          <p className="text-2xs text-amber-300">
            No AI provider key set. Go to <strong>Settings → AI Providers</strong> and add an API key to enable Sentinel AI.
          </p>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-none">
        {messages.length === 0 && (
          <div className="space-y-2">
            <p className="text-2xs text-slate-600 uppercase tracking-widest font-medium mb-3">Quick questions</p>
            {STARTERS.map(s => (
              <button key={s} onClick={() => sendMessage(s)}
                className="w-full text-left px-3 py-2.5 rounded-lg bg-slate-800/30 border border-slate-700/30 hover:border-red-500/20 hover:bg-red-500/5 text-xs text-slate-400 hover:text-slate-200 transition-all">
                {s}
              </button>
            ))}
          </div>
        )}
        {messages.map(msg => (
          <div key={msg.id} className={`flex gap-2.5 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
            <div className={`w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5 ${
              msg.role === 'user' ? 'bg-slate-700 border border-slate-600' : 'bg-red-500/10 border border-red-500/20'
            }`}>
              <Icon name={msg.role === 'user' ? 'User' : 'ShieldAlert'} size={12}
                className={msg.role === 'user' ? 'text-slate-400' : 'text-red-400'} />
            </div>
            <div className={`flex-1 max-w-[88%] px-3 py-2.5 rounded-xl text-xs leading-relaxed ${
              msg.role === 'user'
                ? 'bg-slate-700/50 border border-slate-600/30 text-slate-200'
                : msg.error
                  ? 'bg-red-500/8 border border-red-500/15 text-red-300'
                  : 'bg-[#060b18] border border-slate-800/60 text-slate-300'
            }`} style={{ whiteSpace: 'pre-wrap' }}>
              {msg.content || (msg.streaming ? <span className="text-slate-600 animate-pulse">Sentinel AI thinking…</span> : '')}
            </div>
          </div>
        ))}
        <div ref={chatEndRef} />
      </div>

      {/* Input */}
      <div className="flex-shrink-0 p-3 border-t border-slate-800/60">
        {error && <p className="text-2xs text-red-400 mb-2 px-1">{error}</p>}
        <div className="flex gap-2">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
            placeholder="Ask Apex Sentinel about driver safety, risks, incidents…"
            className="flex-1 bg-slate-800/50 border border-slate-700/50 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 focus:border-red-500/40 focus:outline-none"
            disabled={streaming}
          />
          <button onClick={handleSend} disabled={streaming || !input.trim()}
            className="px-3 py-2 rounded-lg bg-red-500/15 border border-red-500/25 text-red-300 hover:bg-red-500/25 transition-all disabled:opacity-40 flex-shrink-0">
            <Icon name={streaming ? 'Loader2' : 'Send'} size={14} className={streaming ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>
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
          <div className="flex-1 overflow-auto p-3 sm:p-6" />
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

      <div className="flex-1 overflow-auto p-3 sm:p-6">
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
        <SentinelAIPanel />

    </div>
  )
}
