/**
 * ============================================================
 * AP3X FLEET INTELLIGENCE — Dispatch Intelligence Panel (UI)
 * engine/DispatchIntelPanel.jsx
 *
 * "AI DISPATCH ENGINE" panel — Fleet Control OS only.
 *
 * MODES:
 *   Suggestion mode: shows top-3 ranked drivers with scores + ETA.
 *   Confirm mode:    dispatcher clicks "CONFIRM ASSIGNMENT" to dispatch.
 *
 * HARD RULES:
 *   - Engine never auto-assigns.
 *   - Dispatcher can override any suggestion.
 *   - Override is logged to dashboard_events.
 *   - This panel NEVER renders in Driver PWA context.
 *
 * USAGE:
 *   <DispatchIntelPanel
 *     task={taskRow}              — pending task from Supabase
 *     drivers={drivers}           — all drivers (for override picker)
 *     vehicles={vehicles}         — all vehicles (for vehicle assignment)
 *     onDispatched={fn}           — called after confirmed dispatch
 *     onClose={fn}                — called to close panel
 *   />
 * ============================================================
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import Icon      from '../components_ui_Icon'
import Badge     from '../components_ui_Badge'
import { dispatchOrchestrator } from './dispatch_orchestrator'

// ─── Score ring colour ─────────────────────────────────────────
function scoreColor(score) {
  if (score >= 80) return 'text-emerald-400'
  if (score >= 60) return 'text-cyan-400'
  if (score >= 40) return 'text-amber-400'
  return 'text-red-400'
}

function scoreBg(score) {
  if (score >= 80) return 'bg-emerald-500/10 border-emerald-500/20'
  if (score >= 60) return 'bg-cyan-500/10 border-cyan-500/20'
  if (score >= 40) return 'bg-amber-500/10 border-amber-500/20'
  return 'bg-red-500/10 border-red-500/20'
}

function confidenceBadge(conf) {
  switch (conf) {
    case 'graphhopper': return { label: 'GraphHopper', color: 'text-violet-400 bg-violet-500/10' }
    case 'osrm':        return { label: 'OSRM',        color: 'text-cyan-400 bg-cyan-500/10' }
    default:            return { label: 'Estimate',    color: 'text-amber-400 bg-amber-500/10' }
  }
}

// ─── Score bar ─────────────────────────────────────────────────
function ScoreBar({ label, value, weight }) {
  const pct = Math.round(value)
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between text-2xs text-slate-500">
        <span>{label}</span>
        <span className={scoreColor(pct)}>{pct}</span>
      </div>
      <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${pct}%`,
            background: pct >= 80 ? '#10b981' : pct >= 60 ? '#06b6d4' : pct >= 40 ? '#f59e0b' : '#ef4444',
          }}
        />
      </div>
    </div>
  )
}

// ─── Single candidate card ─────────────────────────────────────
function CandidateCard({ candidate, selected, onSelect, rank }) {
  const [expanded, setExpanded] = useState(false)
  const { driver, score, factors, route, rules, explanation } = candidate
  const name = driver?.full_name || driver?.name || `Driver ${driver?.id?.slice(0, 6)}`
  const hasWarnings = rules?.warnings?.length > 0
  const hasFails    = rules?.failures?.length > 0
  const conf        = confidenceBadge(route?.confidence)

  const rankColors = ['text-amber-400', 'text-slate-300', 'text-orange-600']
  const rankLabels = ['#1', '#2', '#3']

  return (
    <div
      className={`rounded-xl border transition-all cursor-pointer
        ${selected
          ? 'border-cyan-500/50 bg-cyan-500/5 ring-1 ring-cyan-500/30'
          : 'border-slate-700/60 bg-slate-900/40 hover:border-slate-600/60'}
        ${hasFails ? 'opacity-60 cursor-not-allowed' : ''}`}
      onClick={() => !hasFails && onSelect(candidate)}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-3 py-2.5">
        {/* Rank badge */}
        <div className={`text-lg font-black font-mono w-7 text-center ${rankColors[rank - 1] || 'text-slate-400'}`}>
          {rankLabels[rank - 1] || `#${rank}`}
        </div>

        {/* Driver info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-white truncate">{name}</span>
            <span className={`text-2xs px-1.5 py-0.5 rounded font-medium capitalize
              ${driver?.status === 'online' || driver?.status === 'active' || driver?.status === 'available'
                ? 'bg-emerald-500/15 text-emerald-400'
                : driver?.status === 'on_break'
                  ? 'bg-amber-500/15 text-amber-400'
                  : 'bg-slate-700/60 text-slate-400'}`}>
              {driver?.status || 'unknown'}
            </span>
            {hasWarnings && !hasFails && (
              <Icon name="AlertTriangle" size={11} className="text-amber-400 flex-shrink-0" />
            )}
          </div>
          <div className="text-2xs text-slate-500 mt-0.5 flex items-center gap-2">
            {route?.eta_minutes != null
              ? <span className="text-cyan-400 font-mono">{route.eta_minutes}m ETA</span>
              : <span className="text-slate-600">ETA unavailable</span>}
            {route?.distance_km != null && (
              <span className="text-slate-500">{route.distance_km} km</span>
            )}
            <span className={`px-1 py-0.5 rounded text-2xs font-medium ${conf.color}`}>{conf.label}</span>
          </div>
        </div>

        {/* Score ring */}
        <div className={`text-center px-2 py-1 rounded-lg border ${scoreBg(score)}`}>
          <div className={`text-base font-black font-mono leading-none ${scoreColor(score)}`}>{score}</div>
          <div className="text-2xs text-slate-600 mt-0.5">score</div>
        </div>

        {/* Expand toggle */}
        <button
          onClick={e => { e.stopPropagation(); setExpanded(!expanded) }}
          className="text-slate-600 hover:text-slate-400 p-0.5"
        >
          <Icon name={expanded ? 'ChevronUp' : 'ChevronDown'} size={13} />
        </button>
      </div>

      {/* Expanded scoring breakdown */}
      {expanded && (
        <div className="px-3 pb-3 border-t border-slate-800/60 pt-2.5 space-y-3">
          {/* Score bars */}
          <div className="space-y-1.5">
            <div className="text-2xs text-slate-600 uppercase tracking-wider mb-1">Score breakdown</div>
            <ScoreBar label="Distance to pickup" value={factors.distance_score} />
            <ScoreBar label="Availability"       value={factors.availability}   />
            <ScoreBar label="Priority match"     value={factors.priority_match} />
            <ScoreBar label="Workload"           value={factors.workload}       />
            <ScoreBar label="Reliability"        value={factors.reliability}    />
          </div>

          {/* ETA details */}
          <div>
            <div className="text-2xs text-slate-600 uppercase tracking-wider mb-1">Route to pickup</div>
            {route?.error ? (
              <p className="text-2xs text-amber-400">{route.error}</p>
            ) : (
              <div className="flex gap-4 text-xs">
                <span className="text-slate-400">Distance: <span className="text-white font-mono">{route?.distance_km ?? '—'} km</span></span>
                <span className="text-slate-400">ETA: <span className="text-cyan-400 font-mono">{route?.eta_minutes ?? '—'} min</span></span>
              </div>
            )}
          </div>

          {/* Reasoning */}
          <div>
            <div className="text-2xs text-slate-600 uppercase tracking-wider mb-1">Engine reasoning</div>
            <ul className="space-y-0.5">
              {explanation.map((line, i) => (
                <li key={i} className="text-2xs text-slate-500 flex items-start gap-1">
                  <Icon name="ChevronRight" size={9} className="flex-shrink-0 mt-0.5 text-slate-700" />
                  {line}
                </li>
              ))}
            </ul>
          </div>

          {/* Warnings */}
          {hasWarnings && (
            <div>
              <div className="text-2xs text-slate-600 uppercase tracking-wider mb-1">Warnings</div>
              {rules.warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-1.5 text-2xs text-amber-400">
                  <Icon name="AlertTriangle" size={10} className="flex-shrink-0 mt-0.5" />
                  {w}
                </div>
              ))}
            </div>
          )}

          {/* Failures */}
          {hasFails && (
            <div>
              <div className="text-2xs text-slate-600 uppercase tracking-wider mb-1">Ineligible — reasons</div>
              {rules.failures.map((f, i) => (
                <div key={i} className="flex items-start gap-1.5 text-2xs text-red-400">
                  <Icon name="XCircle" size={10} className="flex-shrink-0 mt-0.5" />
                  {f}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Selected indicator */}
      {selected && !hasFails && (
        <div className="px-3 pb-2.5 flex items-center gap-1.5 text-2xs text-cyan-400">
          <Icon name="CheckCircle" size={11} />
          Selected for dispatch
        </div>
      )}
    </div>
  )
}

// ─── Main panel ───────────────────────────────────────────────
export default function DispatchIntelPanel({ task, drivers = [], vehicles = [], onDispatched, onClose }) {
  const [result,        setResult]       = useState(null)   // SuggestionResult
  const [loading,       setLoading]      = useState(false)
  const [error,         setError]        = useState(null)
  const [selectedId,    setSelectedId]   = useState(null)   // chosen driver
  const [vehicleId,     setVehicleId]    = useState('')
  const [overrideMode,  setOverrideMode] = useState(false)  // manual override
  const [overrideId,    setOverrideId]   = useState('')
  const [overrideReason,setOverrideReason]= useState('')
  const [dispatching,   setDispatching]  = useState(false)
  const [dispatched,    setDispatched]   = useState(false)
  const hasRun = useRef(false)

  const run = useCallback(async () => {
    if (!task?.id) return
    setLoading(true)
    setError(null)
    setResult(null)
    hasRun.current = true
    try {
      const res = await dispatchOrchestrator.suggest(task.id)
      setResult(res)
      // Auto-select top candidate if it's eligible
      if (res.candidates?.[0]) {
        setSelectedId(res.candidates[0].driver_id)
      }
    } catch (e) {
      setError(`Engine error: ${e.message}`)
    } finally {
      setLoading(false)
    }
  }, [task?.id])

  useEffect(() => {
    if (!hasRun.current) run()
  }, [run])

  const handleConfirm = async () => {
    const finalDriverId = overrideMode ? overrideId : selectedId
    if (!finalDriverId) return

    setDispatching(true)
    try {
      // Detect if this is an override
      const suggestedIds = result?.candidates?.map(c => c.driver_id) || []
      const isOverride   = overrideMode || !suggestedIds.includes(finalDriverId)

      if (isOverride) {
        await dispatchOrchestrator.logOverride(
          task.id, suggestedIds, finalDriverId, overrideReason || 'Manual dispatcher override'
        )
      }

      const dispResult = await dispatchOrchestrator.confirmDispatch(
        task.id, finalDriverId, vehicleId || null,
        isOverride ? (overrideReason || 'Manual dispatcher override') : null
      )

      if (!dispResult.ok) {
        setError(`Dispatch failed: ${dispResult.error}`)
        return
      }

      setDispatched(true)
      setTimeout(() => onDispatched?.(), 1200)
    } catch (e) {
      setError(`Dispatch error: ${e.message}`)
    } finally {
      setDispatching(false)
    }
  }

  const selectedCandidate = result?.candidates?.find(c => c.driver_id === selectedId)
  const effectiveDriverId = overrideMode ? overrideId : selectedId

  return (
    <div className="flex flex-col h-full bg-[#080f1e] text-white">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-800/60 flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-violet-500/20 flex items-center justify-center">
            <Icon name="Cpu" size={13} className="text-violet-400" />
          </div>
          <div>
            <div className="text-xs font-semibold text-white tracking-wide">AI DISPATCH ENGINE</div>
            <div className="text-2xs text-slate-500 truncate max-w-[220px]">{task?.title || 'Unknown task'}</div>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={run}
            disabled={loading}
            className="text-slate-500 hover:text-slate-300 p-1.5 rounded hover:bg-slate-800/60 transition-colors"
            title="Re-run engine"
          >
            <Icon name={loading ? 'Loader' : 'RefreshCw'} size={13} className={loading ? 'animate-spin' : ''} />
          </button>
          {onClose && (
            <button onClick={onClose} className="text-slate-500 hover:text-white p-1 transition-colors">
              <Icon name="X" size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto min-h-0 px-4 py-3 space-y-4">

        {/* Task validation flags */}
        {result && (result.task_failures?.length > 0 || result.task_warnings?.length > 0) && (
          <div className="space-y-1">
            {result.task_failures.map((f, i) => (
              <div key={i} className="flex items-start gap-2 text-xs text-red-400 bg-red-500/5 border border-red-500/15 rounded-lg px-3 py-2">
                <Icon name="AlertOctagon" size={12} className="flex-shrink-0 mt-0.5" />
                {f}
              </div>
            ))}
            {result.task_warnings.map((w, i) => (
              <div key={i} className="flex items-start gap-2 text-xs text-amber-400 bg-amber-500/5 border border-amber-500/15 rounded-lg px-3 py-2">
                <Icon name="AlertTriangle" size={12} className="flex-shrink-0 mt-0.5" />
                {w}
              </div>
            ))}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-10 gap-3">
            <div className="relative">
              <div className="w-10 h-10 rounded-full border-2 border-violet-500/30 border-t-violet-500 animate-spin" />
            </div>
            <div className="text-xs text-slate-400 text-center">
              <div className="font-medium text-slate-300">Running Fleet Intelligence Engine</div>
              <div className="text-slate-600 mt-1">Scoring drivers · Calculating routes via GraphHopper</div>
            </div>
          </div>
        )}

        {/* Error */}
        {error && !loading && (
          <div className="flex items-start gap-2 text-xs text-red-400 bg-red-500/5 border border-red-500/15 rounded-xl px-3 py-3">
            <Icon name="XCircle" size={13} className="flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold">Engine error</div>
              <div className="text-red-500/80 mt-0.5">{error}</div>
            </div>
          </div>
        )}

        {/* Dispatched */}
        {dispatched && (
          <div className="flex flex-col items-center justify-center py-8 gap-2">
            <div className="w-12 h-12 rounded-full bg-emerald-500/20 flex items-center justify-center">
              <Icon name="CheckCircle" size={22} className="text-emerald-400" />
            </div>
            <div className="text-sm font-semibold text-white">Dispatched</div>
            <div className="text-xs text-slate-500">Task assigned · Driver notified via Supabase Realtime</div>
          </div>
        )}

        {/* Main results */}
        {!loading && !dispatched && result && (
          <>
            {/* Stats bar */}
            <div className="flex items-center gap-3 text-2xs text-slate-600 bg-slate-900/40 rounded-lg px-3 py-2">
              <span className="flex items-center gap-1">
                <Icon name="Users" size={10} />
                {result.total_drivers} drivers
              </span>
              <span className="text-slate-800">·</span>
              <span className="flex items-center gap-1 text-emerald-600">
                <Icon name="CheckCircle" size={10} />
                {result.eligible_count || result.candidates?.length || 0} eligible
              </span>
              {result.ineligible?.length > 0 && (
                <>
                  <span className="text-slate-800">·</span>
                  <span className="text-slate-600">{result.ineligible.length} ineligible</span>
                </>
              )}
              <span className="ml-auto text-slate-700">{result.elapsed_ms}ms</span>
            </div>

            {/* No candidates */}
            {result.candidates?.length === 0 && (
              <div className="flex flex-col items-center justify-center py-8 gap-2 text-center">
                <Icon name="UserX" size={24} className="text-slate-700" />
                <div className="text-sm text-slate-400 font-medium">No eligible drivers</div>
                <div className="text-xs text-slate-600 max-w-xs">
                  All available drivers are either offline, already on a task, or fail safety checks.
                  Use the override below to manually assign.
                </div>
              </div>
            )}

            {/* Top 3 candidates */}
            {result.candidates?.length > 0 && (
              <div className="space-y-2">
                <div className="text-2xs text-slate-600 uppercase tracking-wider">
                  Top {result.candidates.length} suggested driver{result.candidates.length > 1 ? 's' : ''} — click to select
                </div>
                {result.candidates.map((c, i) => (
                  <CandidateCard
                    key={c.driver_id}
                    candidate={c}
                    rank={c.rank}
                    selected={!overrideMode && selectedId === c.driver_id}
                    onSelect={c2 => { setSelectedId(c2.driver_id); setOverrideMode(false) }}
                  />
                ))}
                {result.skipped_drivers > 0 && (
                  <div className="text-2xs text-slate-700 text-center">
                    +{result.skipped_drivers} more eligible driver{result.skipped_drivers > 1 ? 's' : ''} not shown
                  </div>
                )}
              </div>
            )}

            {/* Vehicle picker */}
            <div className="space-y-1.5">
              <label className="text-2xs text-slate-500 uppercase tracking-wider">Vehicle assignment (optional)</label>
              <select
                value={vehicleId}
                onChange={e => setVehicleId(e.target.value)}
                className="apex-input w-full text-sm"
              >
                <option value="">No vehicle selected</option>
                {vehicles.map(v => (
                  <option key={v.id} value={v.id}>
                    {v.reg_number} — {v.make}{v.model ? ` ${v.model}` : ''}{v.status === 'maintenance' ? ' ⚠️' : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Dispatcher override section */}
            <div className="border border-slate-800/60 rounded-xl overflow-hidden">
              <button
                onClick={() => setOverrideMode(!overrideMode)}
                className="w-full flex items-center justify-between px-3 py-2.5 text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Icon name="UserCog" size={12} />
                  <span>Dispatcher override — manually select any driver</span>
                </div>
                <Icon name={overrideMode ? 'ChevronUp' : 'ChevronDown'} size={12} />
              </button>

              {overrideMode && (
                <div className="px-3 pb-3 pt-1 border-t border-slate-800/60 space-y-2.5">
                  <div className="text-2xs text-amber-400 flex items-center gap-1.5 mb-2">
                    <Icon name="AlertTriangle" size={10} />
                    Override will be logged in dashboard events
                  </div>
                  <div className="space-y-1">
                    <label className="text-2xs text-slate-500">Select driver</label>
                    <select
                      value={overrideId}
                      onChange={e => setOverrideId(e.target.value)}
                      className="apex-input w-full text-sm"
                    >
                      <option value="">Choose any driver…</option>
                      {drivers.map(d => (
                        <option key={d.id} value={d.id}>
                          {d.full_name || d.name} ({d.status || 'unknown'})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-2xs text-slate-500">Override reason (optional)</label>
                    <input
                      type="text"
                      value={overrideReason}
                      onChange={e => setOverrideReason(e.target.value)}
                      placeholder="e.g. Driver knows the area"
                      className="apex-input w-full text-xs"
                    />
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Sticky action bar */}
      {!dispatched && (
        <div className="flex-shrink-0 px-4 py-3 border-t border-slate-800/60 bg-[#080f1e]/95">
          {effectiveDriverId ? (
            <div className="space-y-2">
              {/* Who is being dispatched */}
              <div className="flex items-center gap-2 text-xs bg-slate-900/60 rounded-lg px-3 py-2">
                <Icon name="User" size={12} className="text-cyan-400" />
                <span className="text-slate-400">Dispatching to:</span>
                <span className="text-white font-medium">
                  {(() => {
                    const d = drivers.find(dr => dr.id === effectiveDriverId)
                    return d?.full_name || d?.name || effectiveDriverId.slice(0, 8)
                  })()}
                </span>
                {overrideMode && (
                  <span className="ml-auto text-amber-400 text-2xs flex items-center gap-1">
                    <Icon name="AlertTriangle" size={9} />
                    OVERRIDE
                  </span>
                )}
              </div>

              <button
                onClick={handleConfirm}
                disabled={dispatching || !effectiveDriverId}
                className="w-full btn-primary py-2.5 text-sm font-semibold disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {dispatching ? (
                  <>
                    <Icon name="Loader" size={14} className="animate-spin" />
                    Dispatching…
                  </>
                ) : (
                  <>
                    <Icon name="Send" size={14} />
                    CONFIRM ASSIGNMENT
                  </>
                )}
              </button>
            </div>
          ) : (
            <div className="text-center text-xs text-slate-600 py-1">
              Select a driver above to enable dispatch
            </div>
          )}
        </div>
      )}
    </div>
  )
}
