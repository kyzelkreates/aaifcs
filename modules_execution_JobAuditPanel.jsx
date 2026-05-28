/**
 * ============================================================
 * AP3X — Job Audit Panel (Fleet OS + Control OS)
 * modules_execution_JobAuditPanel.jsx
 *
 * Dispatcher-side view for a single job's execution:
 *   - Live execution state + stop progress
 *   - Full event audit trail (chronological, replayable)
 *   - Interruption history
 *
 * Props:
 *   jobId     — string
 *   jobTitle  — string (display only)
 *   onClose   — callback
 * ============================================================
 */

import { useState, useEffect, useCallback } from 'react'
import Icon from './components_ui_Icon'
import {
  getJobExecutionState,
  getJobStops,
  getJobEventLog,
  getInterruptionLog,
  subscribeToJobExecution,
  subscribeToJobStops,
} from './services_execution_jobExecutionService'

// ── Helpers ───────────────────────────────────────────────────
function fmtTs(ts) {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('en-GB', {
    day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}
function fmtShort(ts) {
  if (!ts) return '—'
  return new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

const EXEC_STATUS_CFG = {
  pending:     { color: 'text-slate-400',   bg: 'bg-slate-800/60 border-slate-700',         icon: 'Clock'          },
  accepted:    { color: 'text-cyan-400',    bg: 'bg-cyan-500/10 border-cyan-500/25',         icon: 'CheckCircle'    },
  rejected:    { color: 'text-red-400',     bg: 'bg-red-500/10 border-red-500/25',           icon: 'XCircle'        },
  in_progress: { color: 'text-violet-400',  bg: 'bg-violet-500/10 border-violet-500/25',     icon: 'Navigation2'    },
  paused:      { color: 'text-amber-400',   bg: 'bg-amber-500/10 border-amber-500/25',       icon: 'PauseCircle'    },
  completed:   { color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/25',   icon: 'CheckCircle2'   },
  cancelled:   { color: 'text-red-500',     bg: 'bg-red-600/10 border-red-600/25',           icon: 'XOctagon'       },
}

const STOP_STATUS_CFG = {
  pending:   { color: 'text-slate-500',   icon: 'Clock'         },
  en_route:  { color: 'text-cyan-400',    icon: 'Navigation2'   },
  arrived:   { color: 'text-amber-400',   icon: 'MapPin'        },
  validated: { color: 'text-emerald-400', icon: 'CheckCircle2'  },
  skipped:   { color: 'text-red-400',     icon: 'SkipForward'   },
  failed:    { color: 'text-red-500',     icon: 'XCircle'       },
}

const EVENT_CFG = {
  JOB_RECEIVED:      { icon: 'Package',        color: 'text-slate-400',   label: 'Job Received'      },
  JOB_ACCEPTED:      { icon: 'CheckCircle',    color: 'text-emerald-400', label: 'Accepted'          },
  JOB_REJECTED:      { icon: 'XCircle',        color: 'text-red-400',     label: 'Rejected'          },
  JOB_STARTED:       { icon: 'Play',           color: 'text-cyan-400',    label: 'Execution Started' },
  JOB_PAUSED:        { icon: 'PauseCircle',    color: 'text-amber-400',   label: 'Paused'            },
  JOB_RESUMED:       { icon: 'PlayCircle',     color: 'text-cyan-400',    label: 'Resumed'           },
  JOB_COMPLETED:     { icon: 'CheckCircle2',   color: 'text-emerald-400', label: 'Completed'         },
  JOB_CANCELLED:     { icon: 'XOctagon',       color: 'text-red-500',     label: 'Cancelled'         },
  STOP_EN_ROUTE:     { icon: 'Navigation2',    color: 'text-cyan-400',    label: 'En Route to Stop'  },
  STOP_ARRIVED:      { icon: 'MapPin',         color: 'text-amber-400',   label: 'Arrived at Stop'   },
  STOP_VALIDATED:    { icon: 'CheckCircle2',   color: 'text-emerald-400', label: 'Stop Validated'    },
  STOP_SKIPPED:      { icon: 'SkipForward',    color: 'text-red-400',     label: 'Stop Skipped'      },
  STOP_FAILED:       { icon: 'XCircle',        color: 'text-red-500',     label: 'Stop Failed'       },
  ROUTE_DEVIATION:   { icon: 'AlertTriangle',  color: 'text-amber-400',   label: 'Route Deviation'   },
  ROUTE_INTERRUPTED: { icon: 'AlertOctagon',   color: 'text-red-400',     label: 'Route Interrupted' },
  EMERGENCY_STOP:    { icon: 'AlertOctagon',   color: 'text-red-500',     label: 'Emergency Stop'    },
  GEOFENCE_ENTERED:  { icon: 'Circle',         color: 'text-violet-400',  label: 'Geofence Entered'  },
  GEOFENCE_EXITED:   { icon: 'Circle',         color: 'text-slate-500',   label: 'Geofence Exited'   },
}

const INTERRUPT_TYPE_LABEL = {
  route_override:      'Route Override',
  job_pause:           'Job Pause/Resume',
  emergency_stop:      'Emergency Stop',
  stop_reorder:        'Stop Reorder',
  stop_skip_request:   'Stop Skip',
  job_cancel_request:  'Cancel Request',
}

export default function JobAuditPanel({ jobId, jobTitle, onClose }) {
  const [tab,           setTab]          = useState('progress')  // 'progress' | 'events' | 'interruptions'
  const [execState,     setExecState]    = useState(null)
  const [stops,         setStops]        = useState([])
  const [events,        setEvents]       = useState([])
  const [interruptions, setInterruptions]= useState([])
  const [loading,       setLoading]      = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const [state, stopsData, eventsData, intData] = await Promise.all([
      getJobExecutionState(jobId),
      getJobStops(jobId),
      getJobEventLog(jobId),
      getInterruptionLog(jobId),
    ])
    setExecState(state)
    setStops(stopsData)
    setEvents(eventsData)
    setInterruptions(intData)
    setLoading(false)
  }, [jobId])

  useEffect(() => { load() }, [load])

  // Subscribe to live updates
  useEffect(() => {
    const u1 = subscribeToJobExecution(jobId, (updated) => setExecState(updated))
    const u2 = subscribeToJobStops(jobId, (updatedStop) => {
      setStops(prev => prev.map(s => s.id === updatedStop.id ? updatedStop : s))
    })
    return () => { u1(); u2() }
  }, [jobId])

  const execCfg = EXEC_STATUS_CFG[execState?.status] || EXEC_STATUS_CFG.pending
  const completedStops = stops.filter(s => s.status === 'validated' || s.status === 'skipped').length

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-[#0d1426] border border-slate-800/60 rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800/60 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
              <Icon name="Activity" size={14} className="text-violet-400" />
            </div>
            <div>
              <div className="text-sm font-bold text-white truncate max-w-[220px]">{jobTitle || 'Job Audit Trail'}</div>
              <div className="text-2xs text-slate-500 font-mono">{jobId?.slice(0, 8)}…</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={load} className="w-7 h-7 flex items-center justify-center rounded-lg border border-slate-800 text-slate-600 hover:text-slate-300 transition-colors">
              <Icon name="RefreshCw" size={12} className={loading ? 'animate-spin' : ''} />
            </button>
            <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg border border-slate-800 text-slate-600 hover:text-slate-400 transition-colors">
              <Icon name="X" size={14} />
            </button>
          </div>
        </div>

        {/* Execution status strip */}
        {execState && (
          <div className={`mx-5 mt-4 flex items-center gap-3 px-4 py-3 rounded-xl border ${execCfg.bg}`}>
            <Icon name={execCfg.icon} size={16} className={execCfg.color} />
            <div className="flex-1">
              <div className={`text-sm font-bold capitalize ${execCfg.color}`}>
                {execState.status.replace('_', ' ')}
              </div>
              <div className="text-2xs text-slate-500">
                Driver: {execState.driver_id?.slice(0, 8)}… ·{' '}
                {execState.accepted_at ? `Accepted ${fmtShort(execState.accepted_at)}` :
                 execState.rejected_at ? `Rejected ${fmtShort(execState.rejected_at)}` :
                 `Created ${fmtShort(execState.created_at)}`}
              </div>
            </div>
            {stops.length > 0 && (
              <div className="text-right flex-shrink-0">
                <div className={`text-lg font-bold font-mono ${execCfg.color}`}>{completedStops}/{stops.length}</div>
                <div className="text-2xs text-slate-600">stops</div>
              </div>
            )}
          </div>
        )}

        {/* Tabs */}
        <div className="flex border-b border-slate-800/60 mt-4 flex-shrink-0">
          {[
            { key: 'progress',      label: 'Stop Progress', icon: 'MapPin',       badge: stops.length        },
            { key: 'events',        label: 'Event Log',     icon: 'Activity',     badge: events.length       },
            { key: 'interruptions', label: 'Interruptions', icon: 'AlertTriangle',badge: interruptions.length },
          ].map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-xs transition-all border-b-2 ${
                tab === t.key ? 'text-cyan-400 border-cyan-400' : 'text-slate-500 border-transparent hover:text-slate-300'
              }`}>
              <Icon name={t.icon} size={12} />
              {t.label}
              {t.badge > 0 && (
                <span className={`text-2xs px-1.5 py-0.5 rounded-full font-mono font-bold ${
                  tab === t.key ? 'bg-cyan-500/20 text-cyan-300' : 'bg-slate-800 text-slate-500'
                }`}>{t.badge}</span>
              )}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">

          {loading && (
            <div className="flex items-center justify-center py-10 gap-2 text-slate-600">
              <Icon name="Loader2" size={16} className="animate-spin" />
              <span className="text-xs">Loading…</span>
            </div>
          )}

          {/* ── Stop Progress Tab ──────────────────────────── */}
          {!loading && tab === 'progress' && (
            stops.length === 0 ? (
              <div className="flex flex-col items-center py-10 text-slate-700 gap-2">
                <Icon name="MapPin" size={28} className="opacity-20" />
                <span className="text-xs">No structured stops for this job</span>
              </div>
            ) : (
              <div className="space-y-2">
                {/* Progress bar */}
                <div className="flex items-center gap-2 mb-3">
                  <div className="flex-1 h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-full bg-violet-500 rounded-full transition-all"
                      style={{ width: stops.length > 0 ? `${(completedStops / stops.length) * 100}%` : '0%' }} />
                  </div>
                  <span className="text-2xs font-mono text-slate-500">{completedStops}/{stops.length} done</span>
                </div>

                {stops.map(s => {
                  const sc = STOP_STATUS_CFG[s.status] || STOP_STATUS_CFG.pending
                  return (
                    <div key={s.id} className="flex items-start gap-3 px-3 py-3 rounded-xl bg-slate-900/40 border border-slate-800/40">
                      <div className="w-6 h-6 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <span className="text-2xs font-bold text-slate-400">{s.stop_index}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-semibold text-white truncate">{s.label || s.address || `Stop ${s.stop_index}`}</span>
                          <span className={`text-2xs font-semibold capitalize flex-shrink-0 ${sc.color}`}>
                            <Icon name={sc.icon} size={10} className="inline mr-0.5" />{s.status.replace('_', ' ')}
                          </span>
                        </div>
                        {s.address && s.label && <div className="text-2xs text-slate-600 truncate">{s.address}</div>}
                        <div className="flex items-center gap-3 mt-1 flex-wrap">
                          {s.arrived_at   && <span className="text-2xs text-amber-500">Arrived: {fmtShort(s.arrived_at)}</span>}
                          {s.validated_at && <span className="text-2xs text-emerald-500">Validated: {fmtShort(s.validated_at)}</span>}
                          {s.skipped_at   && <span className="text-2xs text-red-400">Skipped: {fmtShort(s.skipped_at)}</span>}
                          {s.skip_reason  && <span className="text-2xs text-red-400/70">Reason: {s.skip_reason}</span>}
                          {s.time_window_start && (
                            <span className="text-2xs text-slate-600">
                              Window: {new Date(s.time_window_start).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                              {s.time_window_end && ` – ${new Date(s.time_window_end).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`}
                            </span>
                          )}
                        </div>
                      </div>
                      <span className="text-2xs capitalize text-slate-600 flex-shrink-0">{s.stop_type}</span>
                    </div>
                  )
                })}
              </div>
            )
          )}

          {/* ── Event Log Tab ─────────────────────────────── */}
          {!loading && tab === 'events' && (
            events.length === 0 ? (
              <div className="flex flex-col items-center py-10 text-slate-700 gap-2">
                <Icon name="Activity" size={28} className="opacity-20" />
                <span className="text-xs">No events logged yet</span>
              </div>
            ) : (
              <div className="space-y-1">
                {events.map((e, i) => {
                  const cfg = EVENT_CFG[e.event_type] || { icon: 'Circle', color: 'text-slate-500', label: e.event_type }
                  return (
                    <div key={e.id || i} className="flex items-start gap-3 px-3 py-2.5 rounded-lg hover:bg-slate-800/20 transition-colors">
                      <div className={`w-6 h-6 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center flex-shrink-0 mt-0.5`}>
                        <Icon name={cfg.icon} size={10} className={cfg.color} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-semibold ${cfg.color}`}>{cfg.label}</span>
                          {e.stop_index != null && (
                            <span className="text-2xs text-slate-600">Stop {e.stop_index}</span>
                          )}
                        </div>
                        {/* Show key payload fields */}
                        {e.payload && Object.keys(e.payload).filter(k => !['ts','accepted_at','rejected_at','started_at','completed_at','paused_at','validated_at','arrived_at','skipped_at'].includes(k)).map(k => (
                          <div key={k} className="text-2xs text-slate-500 truncate">
                            <span className="text-slate-600">{k}: </span>{String(e.payload[k])}
                          </div>
                        ))}
                        {e.driver_lat && (
                          <div className="text-2xs text-slate-700 font-mono">
                            GPS: {e.driver_lat.toFixed(5)}, {e.driver_lng?.toFixed(5)}
                          </div>
                        )}
                      </div>
                      <div className="text-2xs text-slate-700 font-mono flex-shrink-0">{fmtShort(e.ts)}</div>
                    </div>
                  )
                })}
              </div>
            )
          )}

          {/* ── Interruptions Tab ─────────────────────────── */}
          {!loading && tab === 'interruptions' && (
            interruptions.length === 0 ? (
              <div className="flex flex-col items-center py-10 text-slate-700 gap-2">
                <Icon name="AlertTriangle" size={28} className="opacity-20" />
                <span className="text-xs">No interruptions recorded</span>
              </div>
            ) : (
              <div className="space-y-2">
                {interruptions.map((r, i) => (
                  <div key={r.id || i} className={`px-3 py-3 rounded-xl border ${
                    r.interruption_type === 'emergency_stop'
                      ? 'bg-red-500/8 border-red-500/20'
                      : 'bg-slate-900/40 border-slate-800/40'
                  }`}>
                    <div className="flex items-center gap-2 mb-1">
                      <Icon name={
                        r.interruption_type === 'emergency_stop'    ? 'AlertOctagon' :
                        r.interruption_type === 'job_pause'         ? 'PauseCircle'  :
                        r.interruption_type === 'route_override'    ? 'Navigation'   :
                        r.interruption_type === 'stop_skip_request' ? 'SkipForward'  :
                        'AlertTriangle'
                      } size={12} className={
                        r.interruption_type === 'emergency_stop' ? 'text-red-400' :
                        r.interruption_type === 'job_pause'      ? 'text-amber-400' :
                        'text-slate-400'
                      } />
                      <span className="text-xs font-semibold text-white">
                        {INTERRUPT_TYPE_LABEL[r.interruption_type] || r.interruption_type}
                      </span>
                      <span className={`text-2xs px-1.5 py-0.5 rounded font-semibold capitalize ml-auto flex-shrink-0 ${
                        r.resolution === 'approved'      ? 'text-emerald-400 bg-emerald-500/10' :
                        r.resolution === 'denied'        ? 'text-red-400 bg-red-500/10'         :
                        r.resolution === 'auto_approved' ? 'text-cyan-400 bg-cyan-500/10'       :
                        'text-amber-400 bg-amber-500/10'
                      }`}>{r.resolution || 'pending'}</span>
                    </div>
                    <div className="text-xs text-slate-400 leading-relaxed">{r.reason}</div>
                    <div className="flex items-center gap-3 mt-1.5 text-2xs text-slate-600">
                      <span className="font-mono">{fmtTs(r.ts)}</span>
                      {r.speed_at_event != null && <span>{r.speed_at_event} km/h</span>}
                      {r.driver_lat     != null && <span className="font-mono">{r.driver_lat.toFixed(4)}, {r.driver_lng?.toFixed(4)}</span>}
                      {r.approved_by    && <span>Approved by: {r.approved_by.slice(0, 8)}…</span>}
                    </div>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  )
}
