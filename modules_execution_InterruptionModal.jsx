/**
 * ============================================================
 * AP3X — Interruption Modal
 * modules_execution_InterruptionModal.jsx
 *
 * Step 6 of the Job Execution Control Layer.
 * Handles controlled mid-job interruptions:
 *   - Pause job
 *   - Resume job
 *   - Emergency stop
 *   - Route override (reason required)
 *
 * All actions write to route_interruption_log BEFORE
 * any state change. Zero silent actions.
 *
 * Props:
 *   jobId         — string
 *   driverId      — string
 *   tenantId      — string | null
 *   executionStatus — current job_execution_state.status
 *   driverPos     — [lat, lng] | null
 *   speed         — number
 *   onPause       — callback()
 *   onResume      — callback()
 *   onEmergency   — callback()
 *   onClose       — callback()
 * ============================================================
 */

import { useState } from 'react'
import Icon from './components_ui_Icon'
import {
  executeEmergencyStop,
  logInterruption,
  pauseJobExecution,
  resumeJobExecution,
  logJobEvent,
} from './services_execution_jobExecutionService'

const INTERRUPT_TYPES = [
  {
    key:   'job_pause',
    label: 'Pause Job',
    sub:   'Temporary hold — driver break, loading delay, etc.',
    icon:  'PauseCircle',
    color: 'text-amber-400',
    bg:    'bg-amber-500/10 border-amber-500/25',
    needsReason: false,
    showWhen: ['accepted','in_progress'],
  },
  {
    key:   'route_override',
    label: 'Route Override',
    sub:   'Deviation from planned route — must state reason.',
    icon:  'Navigation',
    color: 'text-cyan-400',
    bg:    'bg-cyan-500/10 border-cyan-500/25',
    needsReason: true,
    showWhen: ['accepted','in_progress','paused'],
  },
  {
    key:   'emergency_stop',
    label: 'Emergency Stop',
    sub:   'Immediate halt — vehicle fault, accident, medical.',
    icon:  'AlertOctagon',
    color: 'text-red-400',
    bg:    'bg-red-500/10 border-red-500/30',
    needsReason: true,
    showWhen: ['accepted','in_progress','paused'],
  },
  {
    key:   'job_cancel_request',
    label: 'Cancel Job',
    sub:   'Cannot complete this job — notify dispatcher.',
    icon:  'XCircle',
    color: 'text-red-500',
    bg:    'bg-red-600/10 border-red-600/25',
    needsReason: true,
    showWhen: ['accepted','in_progress','paused'],
  },
]

export default function InterruptionModal({ jobId, driverId, tenantId, executionStatus, driverPos, speed, onPause, onResume, onEmergency, onClose }) {
  const [selected,  setSelected]  = useState(null)
  const [reason,    setReason]    = useState('')
  const [busy,      setBusy]      = useState(false)
  const [done,      setDone]      = useState(null)   // {icon, message} after success
  const [error,     setError]     = useState(null)

  const isPaused = executionStatus === 'paused'
  const visibleTypes = INTERRUPT_TYPES.filter(t => t.showWhen.includes(executionStatus))

  const handleConfirm = async () => {
    if (!selected) return
    if (selected.needsReason && !reason.trim()) return
    setBusy(true); setError(null)

    const base = {
      job_id:         jobId,
      driver_id:      driverId,
      tenant_id:      tenantId,
      interruption_type: selected.key,
      reason:         reason.trim() || `${selected.label} — driver initiated`,
      driver_lat:     driverPos?.[0] ?? null,
      driver_lng:     driverPos?.[1] ?? null,
      speed_at_event: speed,
    }

    try {
      if (selected.key === 'emergency_stop') {
        await executeEmergencyStop({ ...base })
        setDone({ icon: 'AlertOctagon', message: 'Emergency stop logged. Fleet notified.' })
        onEmergency()

      } else if (selected.key === 'job_pause') {
        await logInterruption({ ...base, resolution: 'auto_approved' })
        await pauseJobExecution(jobId, driverId)
        await logJobEvent({
          job_id: jobId, driver_id: driverId, tenant_id: tenantId,
          event_type: 'JOB_PAUSED',
          driver_lat: driverPos?.[0], driver_lng: driverPos?.[1],
          payload: { reason: base.reason, paused_at: new Date().toISOString() },
        })
        setDone({ icon: 'PauseCircle', message: 'Job paused. Resume when ready.' })
        onPause()

      } else if (selected.key === 'route_override') {
        await logInterruption({ ...base, resolution: 'auto_approved' })
        await logJobEvent({
          job_id: jobId, driver_id: driverId, tenant_id: tenantId,
          event_type: 'ROUTE_INTERRUPTED',
          driver_lat: driverPos?.[0], driver_lng: driverPos?.[1],
          payload: { interruption_type: 'route_override', reason: base.reason },
        })
        setDone({ icon: 'Navigation', message: 'Route override logged.' })
        setTimeout(onClose, 1500)

      } else if (selected.key === 'job_cancel_request') {
        await logInterruption({ ...base, resolution: 'pending' })
        await logJobEvent({
          job_id: jobId, driver_id: driverId, tenant_id: tenantId,
          event_type: 'ROUTE_INTERRUPTED',
          driver_lat: driverPos?.[0], driver_lng: driverPos?.[1],
          payload: { interruption_type: 'job_cancel_request', reason: base.reason },
        })
        setDone({ icon: 'XCircle', message: 'Cancel request sent to dispatcher.' })
        setTimeout(onClose, 2000)
      }

    } catch (e) {
      setError('Failed to log interruption. Check connection.')
    }
    setBusy(false)
  }

  const handleResume = async () => {
    setBusy(true)
    await logInterruption({
      job_id:            jobId,
      driver_id:         driverId,
      tenant_id:         tenantId,
      interruption_type: 'job_pause',
      reason:            'Driver resumed job',
      driver_lat:        driverPos?.[0] ?? null,
      driver_lng:        driverPos?.[1] ?? null,
      resolution:        'auto_approved',
    })
    await resumeJobExecution(jobId, driverId)
    await logJobEvent({
      job_id: jobId, driver_id: driverId, tenant_id: tenantId,
      event_type: 'JOB_RESUMED',
      driver_lat: driverPos?.[0], driver_lng: driverPos?.[1],
      payload: { resumed_at: new Date().toISOString() },
    })
    setBusy(false)
    onResume()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center">
      <div className="w-full sm:max-w-md bg-[#0d1426] border border-slate-800/60 sm:rounded-2xl rounded-t-2xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800/60">
          <div className="flex items-center gap-2.5">
            <Icon name="AlertTriangle" size={16} className="text-amber-400" />
            <div>
              <div className="text-sm font-bold text-white">Job Interruption</div>
              <div className="text-2xs text-slate-500">All actions are logged to audit trail</div>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-600 hover:text-slate-400 hover:bg-slate-800/60 rounded-lg transition-colors">
            <Icon name="X" size={15} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">

          {/* Resume (if paused) */}
          {isPaused && !done && (
            <button onClick={handleResume} disabled={busy}
              className="w-full py-3.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-sm font-bold hover:bg-emerald-500/20 disabled:opacity-40 flex items-center justify-center gap-2 transition-all">
              {busy ? <span className="w-4 h-4 border-2 border-t-emerald-400 border-slate-700 rounded-full animate-spin" /> : <Icon name="Play" size={15} />}
              Resume Job
            </button>
          )}

          {/* Success state */}
          {done && (
            <div className="flex flex-col items-center gap-3 py-6">
              <Icon name={done.icon} size={32} className="text-amber-400" />
              <div className="text-sm font-semibold text-white text-center">{done.message}</div>
              <button onClick={onClose}
                className="px-6 py-2 rounded-xl border border-slate-700 text-slate-400 text-sm hover:bg-slate-800/60 transition-colors">
                Close
              </button>
            </div>
          )}

          {/* Type selection */}
          {!done && (
            <>
              {!selected ? (
                <div className="space-y-2">
                  {visibleTypes.map(t => (
                    <button key={t.key} onClick={() => { setSelected(t); setReason('') }}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-all hover:brightness-110 ${t.bg}`}>
                      <Icon name={t.icon} size={16} className={t.color} />
                      <div className="text-left flex-1 min-w-0">
                        <div className={`text-sm font-bold ${t.color}`}>{t.label}</div>
                        <div className="text-2xs text-slate-500 mt-0.5">{t.sub}</div>
                      </div>
                      <Icon name="ChevronRight" size={13} className="text-slate-600 flex-shrink-0" />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Selected type header */}
                  <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${selected.bg}`}>
                    <Icon name={selected.icon} size={16} className={selected.color} />
                    <div className="flex-1">
                      <div className={`text-sm font-bold ${selected.color}`}>{selected.label}</div>
                      <div className="text-2xs text-slate-500">{selected.sub}</div>
                    </div>
                    <button onClick={() => { setSelected(null); setReason('') }} className="text-slate-600 hover:text-slate-400">
                      <Icon name="X" size={13} />
                    </button>
                  </div>

                  {/* Reason input */}
                  {selected.needsReason && (
                    <div>
                      <label className="text-xs text-slate-400 font-medium mb-1.5 block">Reason (required for audit trail):</label>
                      <textarea
                        value={reason}
                        onChange={e => setReason(e.target.value)}
                        placeholder={
                          selected.key === 'emergency_stop'    ? 'e.g. Tyre blowout, collision, medical emergency…' :
                          selected.key === 'route_override'    ? 'e.g. Road closed ahead, diversion signed…' :
                          selected.key === 'job_cancel_request'? 'e.g. Vehicle breakdown, customer unreachable…' :
                          'Describe the reason for this action…'
                        }
                        rows={3}
                        autoFocus
                        className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:border-amber-500/40 focus:outline-none resize-none"
                      />
                    </div>
                  )}

                  {error && (
                    <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 flex items-center gap-1.5">
                      <Icon name="AlertCircle" size={12} /> {error}
                    </div>
                  )}

                  {/* Confirm */}
                  <button onClick={handleConfirm} disabled={busy || (selected.needsReason && !reason.trim())}
                    className={`w-full py-3.5 rounded-xl text-sm font-bold disabled:opacity-30 active:scale-[0.98] transition-all flex items-center justify-center gap-2 ${
                      selected.key === 'emergency_stop'
                        ? 'bg-red-500/20 border border-red-500/40 text-red-300 hover:bg-red-500/30'
                        : `${selected.bg} ${selected.color} hover:brightness-110`
                    }`}>
                    {busy
                      ? <span className="w-4 h-4 border-2 border-t-current border-slate-700 rounded-full animate-spin" />
                      : <Icon name={selected.icon} size={15} />
                    }
                    {busy ? 'Logging…' : `Confirm ${selected.label}`}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
