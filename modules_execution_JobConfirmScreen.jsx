/**
 * ============================================================
 * AP3X — Job Confirmation Screen
 * modules_execution_JobConfirmScreen.jsx
 *
 * Step 2 of the Job Execution Control Layer.
 * Driver sees full job summary and must explicitly ACCEPT or REJECT.
 * No auto-start. No silent actions.
 *
 * Props:
 *   job         — task record from Supabase (tasks table)
 *   stops       — job_stops[] (may be empty if dispatcher didn't set stops)
 *   driverId    — string
 *   driverPos   — [lat, lng] | null
 *   onAccepted  — callback(executionState)
 *   onRejected  — callback()
 *   onDismiss   — callback() — close without deciding (only valid before any action)
 * ============================================================
 */

import { useState } from 'react'
import Icon from './components_ui_Icon'
import {
  executeJobAccept,
  executeJobReject,
  initJobExecution,
} from './services_execution_jobExecutionService'

// ── Priority config ───────────────────────────────────────────
const PRI = {
  urgent: { label: 'URGENT',  color: 'text-red-400',    bg: 'bg-red-500/10 border-red-500/30'    },
  high:   { label: 'HIGH',    color: 'text-amber-400',  bg: 'bg-amber-500/10 border-amber-500/30' },
  normal: { label: 'NORMAL',  color: 'text-cyan-400',   bg: 'bg-cyan-500/10 border-cyan-500/30'  },
  low:    { label: 'LOW',     color: 'text-slate-400',  bg: 'bg-slate-700 border-slate-600'      },
}

// ── Stop type icons ───────────────────────────────────────────
const STOP_ICON = {
  pickup:     'Package',
  dropoff:    'MapPin',
  depot:      'Home',
  inspection: 'ClipboardCheck',
  waypoint:   'Circle',
}

export default function JobConfirmScreen({ job, stops = [], driverId, driverPos, onAccepted, onRejected, onDismiss }) {
  const [phase,        setPhase]       = useState('review')   // 'review' | 'rejecting' | 'loading' | 'error'
  const [rejectReason, setRejectReason] = useState('')
  const [error,        setError]       = useState(null)

  const pri = PRI[job?.priority] || PRI.normal

  // ── Accept ────────────────────────────────────────────────
  const handleAccept = async () => {
    setPhase('loading'); setError(null)

    // Ensure execution state row exists first
    await initJobExecution(job.id, driverId, job.tenant_id ?? null)

    const result = await executeJobAccept({
      jobId:      job.id,
      driverId,
      tenantId:   job.tenant_id ?? null,
      driverLat:  driverPos?.[0] ?? null,
      driverLng:  driverPos?.[1] ?? null,
      taskPayload: {
        title:    job.title,
        priority: job.priority,
        stops:    stops.length,
      },
    })

    if (!result.ok) {
      setError(result.error || 'Failed to accept job — check connection and try again.')
      setPhase('review')
      return
    }
    onAccepted(result.execution)
  }

  // ── Reject ────────────────────────────────────────────────
  const handleReject = async () => {
    if (!rejectReason.trim()) return
    setPhase('loading'); setError(null)

    await initJobExecution(job.id, driverId, job.tenant_id ?? null)

    const result = await executeJobReject({
      jobId:     job.id,
      driverId,
      tenantId:  job.tenant_id ?? null,
      reason:    rejectReason.trim(),
      driverLat: driverPos?.[0] ?? null,
      driverLng: driverPos?.[1] ?? null,
    })

    if (!result.ok) {
      setError(result.error || 'Failed to submit rejection — check connection.')
      setPhase('rejecting')
      return
    }
    onRejected()
  }

  if (!job) return null

  return (
    <div className="fixed inset-0 z-50 bg-[#060b18]/95 backdrop-blur-sm flex items-end sm:items-center justify-center">
      <div className="w-full sm:max-w-md bg-[#0d1426] border border-violet-500/20 sm:rounded-2xl rounded-t-2xl shadow-2xl overflow-hidden">

        {/* ── Header ─────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800/60">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
              <Icon name="Package" size={17} className="text-violet-400" />
            </div>
            <div>
              <div className="text-xs font-bold text-white uppercase tracking-widest">New Job Assigned</div>
              <div className="text-2xs text-slate-500 mt-0.5">Review before accepting</div>
            </div>
          </div>
          {onDismiss && phase === 'review' && (
            <button onClick={onDismiss} className="p-1.5 rounded-lg text-slate-600 hover:text-slate-400 hover:bg-slate-800/60 transition-colors">
              <Icon name="X" size={15} />
            </button>
          )}
        </div>

        {/* ── Job summary ─────────────────────────────────── */}
        <div className="px-5 py-4 space-y-3">

          {/* Title + priority */}
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <h2 className="text-base font-bold text-white leading-tight">{job.title || '(Untitled Job)'}</h2>
              {job.notes && <p className="text-xs text-slate-400 mt-1 leading-relaxed line-clamp-3">{job.notes}</p>}
            </div>
            <span className={`text-2xs px-2 py-1 rounded-lg border font-bold uppercase flex-shrink-0 ${pri.bg} ${pri.color}`}>
              {pri.label}
            </span>
          </div>

          {/* Route info row */}
          <div className="grid grid-cols-2 gap-2">
            {job.pickup_address && (
              <div className="flex items-start gap-2 bg-slate-900/50 rounded-lg p-2.5">
                <Icon name="Package" size={12} className="text-emerald-400 mt-0.5 flex-shrink-0" />
                <div>
                  <div className="text-2xs text-slate-500 uppercase tracking-wider font-semibold">Pickup</div>
                  <div className="text-xs text-slate-300 mt-0.5 line-clamp-2">{job.pickup_address}</div>
                </div>
              </div>
            )}
            {(job.dropoff_address || job.destination || job.address) && (
              <div className="flex items-start gap-2 bg-slate-900/50 rounded-lg p-2.5">
                <Icon name="MapPin" size={12} className="text-violet-400 mt-0.5 flex-shrink-0" />
                <div>
                  <div className="text-2xs text-slate-500 uppercase tracking-wider font-semibold">Dropoff</div>
                  <div className="text-xs text-slate-300 mt-0.5 line-clamp-2">{job.dropoff_address || job.destination || job.address}</div>
                </div>
              </div>
            )}
          </div>

          {/* Time window */}
          {(job.scheduled_for || job.time_window_end) && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/5 border border-amber-500/20">
              <Icon name="Clock" size={13} className="text-amber-400 flex-shrink-0" />
              <div className="text-xs text-amber-300">
                {job.scheduled_for
                  ? `Scheduled: ${new Date(job.scheduled_for).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`
                  : job.time_window_end
                  ? `Deadline: ${new Date(job.time_window_end).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`
                  : null
                }
              </div>
            </div>
          )}

          {/* Stops preview */}
          {stops.length > 0 && (
            <div className="space-y-1">
              <div className="text-2xs text-slate-500 uppercase tracking-wider font-semibold mb-1.5">
                {stops.length} Stop{stops.length > 1 ? 's' : ''} — Locked sequence
              </div>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {stops.map((s, i) => (
                  <div key={s.id || i} className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg bg-slate-900/40 border border-slate-800/40">
                    <div className="w-5 h-5 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center flex-shrink-0">
                      <span className="text-2xs font-bold text-slate-400">{s.stop_index}</span>
                    </div>
                    <Icon name={STOP_ICON[s.stop_type] || 'MapPin'} size={11}
                      className={s.stop_type === 'pickup' ? 'text-emerald-400' : s.stop_type === 'inspection' ? 'text-amber-400' : 'text-violet-400'} />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-slate-300 truncate">{s.label || s.address || `Stop ${s.stop_index}`}</div>
                      {s.time_window_start && (
                        <div className="text-2xs text-slate-600">
                          Window: {new Date(s.time_window_start).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                          {s.time_window_end && ` – ${new Date(s.time_window_end).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`}
                        </div>
                      )}
                    </div>
                    <span className={`text-2xs px-1.5 py-0.5 rounded font-medium capitalize flex-shrink-0 ${
                      s.stop_type === 'pickup'     ? 'text-emerald-400 bg-emerald-500/10' :
                      s.stop_type === 'inspection' ? 'text-amber-400 bg-amber-500/10'    :
                      'text-violet-400 bg-violet-500/10'
                    }`}>{s.stop_type}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Warning if no stops */}
          {stops.length === 0 && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800/40 border border-slate-700/40">
              <Icon name="Info" size={12} className="text-slate-500" />
              <span className="text-2xs text-slate-500">No structured stops — navigate using destination address above</span>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/25 text-xs text-red-400">
              <Icon name="AlertCircle" size={12} />
              {error}
            </div>
          )}
        </div>

        {/* ── Actions ─────────────────────────────────────── */}
        <div className="px-5 pb-5 space-y-2">

          {phase === 'review' && (
            <>
              {/* Accept */}
              <button onClick={handleAccept}
                className="w-full py-3.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-sm font-bold hover:bg-emerald-500/25 active:scale-[0.98] transition-all flex items-center justify-center gap-2">
                <Icon name="CheckCircle" size={16} />
                Accept Job
              </button>
              {/* Reject */}
              <button onClick={() => setPhase('rejecting')}
                className="w-full py-3 rounded-xl border border-slate-700/60 text-slate-500 text-sm font-semibold hover:text-red-400 hover:border-red-500/30 hover:bg-red-500/5 active:scale-[0.98] transition-all flex items-center justify-center gap-2">
                <Icon name="XCircle" size={15} />
                Reject Job
              </button>
            </>
          )}

          {phase === 'rejecting' && (
            <>
              <div className="text-xs text-slate-400 mb-1.5 font-medium">Reason for rejection (required):</div>
              <textarea
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                placeholder="e.g. Vehicle fault, hours exceeded, route inaccessible…"
                rows={3}
                autoFocus
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:border-red-500/50 focus:outline-none resize-none"
              />
              <div className="flex gap-2 mt-1">
                <button onClick={() => { setPhase('review'); setRejectReason('') }}
                  className="flex-1 py-2.5 rounded-xl border border-slate-700 text-slate-400 text-sm font-semibold hover:bg-slate-800/60 transition-colors">
                  Back
                </button>
                <button onClick={handleReject} disabled={!rejectReason.trim()}
                  className="flex-1 py-2.5 rounded-xl bg-red-500/15 border border-red-500/30 text-red-400 text-sm font-bold hover:bg-red-500/20 disabled:opacity-30 transition-all">
                  Confirm Reject
                </button>
              </div>
            </>
          )}

          {phase === 'loading' && (
            <div className="flex items-center justify-center gap-2 py-4">
              <div className="w-4 h-4 border-2 border-t-violet-400 border-slate-700 rounded-full animate-spin" />
              <span className="text-sm text-slate-400">Processing…</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
