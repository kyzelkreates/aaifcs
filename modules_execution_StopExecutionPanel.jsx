/**
 * ============================================================
 * AP3X — Stop Execution Panel
 * modules_execution_StopExecutionPanel.jsx
 *
 * Step 4 of the Job Execution Control Layer.
 * Renders the current stop card + action buttons during execution.
 * Handles: arrive, validate, skip (with reason).
 * Detects geofence entry from GPS position prop.
 *
 * Props:
 *   stops         — job_stops[] ordered by stop_index
 *   currentStop   — job_stops row (the active one)
 *   driverPos     — [lat, lng] | null
 *   jobId         — string
 *   driverId      — string
 *   tenantId      — string | null
 *   speed         — number (km/h)
 *   onStopUpdate  — callback(updatedStop) — parent refreshes stops list
 *   onJobComplete — callback() — all stops done
 *   onInterrupt   — callback() — open interruption modal
 * ============================================================
 */

import { useState, useEffect, useRef } from 'react'
import Icon from './components_ui_Icon'
import {
  executeStopArrival,
  executeStopValidation,
  executeStopSkip,
  detectGeofenceEntry,
  startJobExecution,
  completeJobExecution,
  logJobEvent,
} from './services_execution_jobExecutionService'

const STOP_TYPE_CFG = {
  pickup:     { icon: 'Package',        color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20', label: 'Pickup'     },
  dropoff:    { icon: 'MapPin',         color: 'text-violet-400',  bg: 'bg-violet-500/10 border-violet-500/20',  label: 'Dropoff'    },
  depot:      { icon: 'Home',           color: 'text-cyan-400',    bg: 'bg-cyan-500/10 border-cyan-500/20',      label: 'Depot'      },
  inspection: { icon: 'ClipboardCheck', color: 'text-amber-400',   bg: 'bg-amber-500/10 border-amber-500/20',   label: 'Inspection' },
  waypoint:   { icon: 'Circle',         color: 'text-slate-400',   bg: 'bg-slate-800/60 border-slate-700',      label: 'Waypoint'   },
}

const STATUS_CFG = {
  pending:   { color: 'text-slate-400',   bg: 'bg-slate-800/60 border-slate-700', icon: 'Clock'         },
  en_route:  { color: 'text-cyan-400',    bg: 'bg-cyan-500/10 border-cyan-500/20', icon: 'Navigation2'  },
  arrived:   { color: 'text-amber-400',   bg: 'bg-amber-500/10 border-amber-500/20', icon: 'MapPin'     },
  validated: { color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20', icon: 'CheckCircle2' },
  skipped:   { color: 'text-red-400',     bg: 'bg-red-500/10 border-red-500/20', icon: 'SkipForward'   },
  failed:    { color: 'text-red-400',     bg: 'bg-red-500/10 border-red-500/20', icon: 'XCircle'       },
}

// ── Haversine (m) ─────────────────────────────────────────────
const RAD = Math.PI / 180
function dist(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const a = Math.sin(((lat2-lat1)*RAD)/2)**2 + Math.cos(lat1*RAD)*Math.cos(lat2*RAD)*Math.sin(((lng2-lng1)*RAD)/2)**2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
}

export default function StopExecutionPanel({ stops = [], currentStop, driverPos, jobId, driverId, tenantId, speed, onStopUpdate, onJobComplete, onInterrupt }) {
  const [busy,           setBusy]          = useState(false)
  const [showSkipForm,   setShowSkipForm]  = useState(false)
  const [skipReason,     setSkipReason]    = useState('')
  const [geofenceAlerted, setGeofenceAlerted] = useState({})   // stopId → true once alerted
  const [arrivedConfirm, setArrivedConfirm] = useState(null)  // stopId awaiting confirmation
  const lastGeofenceCheck = useRef(0)

  // ── Geofence polling (every 5s) ───────────────────────────
  useEffect(() => {
    if (!driverPos || !currentStop) return
    const now = Date.now()
    if (now - lastGeofenceCheck.current < 5000) return
    lastGeofenceCheck.current = now

    if (
      (currentStop.status === 'pending' || currentStop.status === 'en_route') &&
      !geofenceAlerted[currentStop.id] &&
      currentStop.location_lat && currentStop.location_lng
    ) {
      const inside = dist(driverPos[0], driverPos[1], currentStop.location_lat, currentStop.location_lng)
        <= (currentStop.geofence_radius_m ?? 150)

      if (inside) {
        setGeofenceAlerted(p => ({ ...p, [currentStop.id]: true }))
        setArrivedConfirm(currentStop.id)
      }
    }
  }, [driverPos])

  const totalStops     = stops.length
  const completedCount = stops.filter(s => s.status === 'validated' || s.status === 'skipped').length
  const allDone        = totalStops > 0 && completedCount === totalStops

  // ── Arrive ────────────────────────────────────────────────
  const handleArrive = async (stop) => {
    setBusy(true)
    // First stop → start job execution if still accepted
    if (stop.stop_index === 1) {
      await startJobExecution(jobId, driverId)
      await logJobEvent({
        job_id: jobId, driver_id: driverId, tenant_id: tenantId,
        event_type: 'JOB_STARTED',
        driver_lat: driverPos?.[0], driver_lng: driverPos?.[1],
        payload: { started_at: new Date().toISOString() },
      })
    }

    const result = await executeStopArrival({
      stopId:    stop.id,
      jobId,
      driverId,
      tenantId,
      stopIndex: stop.stop_index,
      driverLat: driverPos?.[0] ?? null,
      driverLng: driverPos?.[1] ?? null,
    })

    setBusy(false)
    setArrivedConfirm(null)
    if (result.ok) onStopUpdate({ ...stop, status: 'arrived' })
  }

  // ── Validate ──────────────────────────────────────────────
  const handleValidate = async (stop) => {
    setBusy(true)
    const result = await executeStopValidation({
      stopId:    stop.id,
      jobId,
      driverId,
      tenantId,
      stopIndex: stop.stop_index,
      driverLat: driverPos?.[0] ?? null,
      driverLng: driverPos?.[1] ?? null,
    })
    setBusy(false)

    if (result.ok) {
      const updated = { ...stop, status: 'validated' }
      onStopUpdate(updated)
      // Check if last stop
      const remaining = stops.filter(s => s.id !== stop.id && s.status !== 'validated' && s.status !== 'skipped')
      if (remaining.length === 0) {
        await completeJobExecution(jobId, driverId)
        await logJobEvent({
          job_id: jobId, driver_id: driverId, tenant_id: tenantId,
          event_type: 'JOB_COMPLETED',
          driver_lat: driverPos?.[0], driver_lng: driverPos?.[1],
          payload: { completed_at: new Date().toISOString(), total_stops: totalStops },
        })
        onJobComplete()
      }
    }
  }

  // ── Skip ──────────────────────────────────────────────────
  const handleSkip = async (stop) => {
    if (!skipReason.trim()) return
    setBusy(true)
    const result = await executeStopSkip({
      stopId:    stop.id,
      jobId,
      driverId,
      tenantId,
      stopIndex: stop.stop_index,
      reason:    skipReason.trim(),
      driverLat: driverPos?.[0] ?? null,
      driverLng: driverPos?.[1] ?? null,
      speed,
    })
    setBusy(false)
    setShowSkipForm(false)
    setSkipReason('')

    if (result.ok) {
      const updated = { ...stop, status: 'skipped', skip_reason: skipReason.trim() }
      onStopUpdate(updated)
      const remaining = stops.filter(s => s.id !== stop.id && s.status !== 'validated' && s.status !== 'skipped')
      if (remaining.length === 0) {
        await completeJobExecution(jobId, driverId)
        onJobComplete()
      }
    }
  }

  if (!currentStop && !allDone) return null

  // ── All stops done ────────────────────────────────────────
  if (allDone) {
    return (
      <div className="bg-emerald-500/10 border border-emerald-500/25 rounded-2xl p-5 text-center space-y-2">
        <Icon name="CheckCircle2" size={32} className="text-emerald-400 mx-auto" />
        <div className="text-base font-bold text-emerald-300">All stops complete</div>
        <div className="text-2xs text-emerald-600">{completedCount}/{totalStops} stops validated or skipped</div>
        <button onClick={onJobComplete}
          className="mt-2 w-full py-3 rounded-xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-sm font-bold hover:bg-emerald-500/30 transition-colors">
          Complete Job
        </button>
      </div>
    )
  }

  const typeCfg   = STOP_TYPE_CFG[currentStop.stop_type] || STOP_TYPE_CFG.dropoff
  const statusCfg = STATUS_CFG[currentStop.status] || STATUS_CFG.pending

  // Distance to current stop
  const distToStop = (driverPos && currentStop.location_lat && currentStop.location_lng)
    ? dist(driverPos[0], driverPos[1], currentStop.location_lat, currentStop.location_lng)
    : null
  const distLabel = distToStop != null
    ? distToStop < 1000 ? `${Math.round(distToStop)} m` : `${(distToStop / 1000).toFixed(1)} km`
    : null

  return (
    <div className="space-y-2">

      {/* ── Progress bar ─────────────────────────────────── */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 bg-slate-800/60 rounded-full overflow-hidden">
          <div className="h-full bg-violet-500 rounded-full transition-all"
            style={{ width: totalStops > 0 ? `${(completedCount / totalStops) * 100}%` : '0%' }} />
        </div>
        <span className="text-2xs font-mono text-slate-500">{completedCount}/{totalStops}</span>
      </div>

      {/* ── Stop list mini-strip ─────────────────────────── */}
      <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none pb-0.5">
        {stops.map(s => {
          const isCurrent = s.id === currentStop.id
          const sc = STATUS_CFG[s.status] || STATUS_CFG.pending
          return (
            <div key={s.id}
              className={`flex items-center gap-1 px-2 py-1 rounded-lg border text-2xs flex-shrink-0 transition-all ${
                isCurrent
                  ? 'bg-violet-500/15 border-violet-500/30 text-violet-300'
                  : s.status === 'validated' ? 'bg-emerald-500/8 border-emerald-500/15 text-emerald-500'
                  : s.status === 'skipped'   ? 'bg-red-500/8 border-red-500/15 text-red-500'
                  : 'bg-slate-900/40 border-slate-800 text-slate-600'
              }`}>
              <Icon name={sc.icon} size={9} />
              <span className="font-mono font-bold">{s.stop_index}</span>
            </div>
          )
        })}
      </div>

      {/* ── Geofence arrival prompt ──────────────────────── */}
      {arrivedConfirm === currentStop.id && currentStop.status !== 'arrived' && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-bold text-amber-300">You've arrived at stop {currentStop.stop_index}</div>
            <div className="text-2xs text-amber-600">Geofence entered — confirm arrival</div>
          </div>
          <button onClick={() => handleArrive(currentStop)} disabled={busy}
            className="px-3 py-1.5 rounded-lg bg-amber-500/20 border border-amber-500/30 text-amber-300 text-xs font-bold hover:bg-amber-500/30 flex-shrink-0 transition-colors">
            Confirm
          </button>
        </div>
      )}

      {/* ── Current stop card ────────────────────────────── */}
      <div className={`rounded-2xl border p-4 space-y-3 ${typeCfg.bg}`}>

        {/* Stop header */}
        <div className="flex items-start gap-3">
          <div className={`w-9 h-9 rounded-xl border flex items-center justify-center flex-shrink-0 ${typeCfg.bg}`}>
            <Icon name={typeCfg.icon} size={16} className={typeCfg.color} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-2xs px-2 py-0.5 rounded-full border font-bold uppercase ${typeCfg.color} ${typeCfg.bg}`}>{typeCfg.label}</span>
              <span className="text-2xs text-slate-500">Stop {currentStop.stop_index} of {totalStops}</span>
              {distLabel && <span className="text-2xs text-slate-500 font-mono">{distLabel} away</span>}
            </div>
            <div className="text-sm font-semibold text-white mt-1 line-clamp-2">
              {currentStop.label || currentStop.address || `Stop ${currentStop.stop_index}`}
            </div>
            {currentStop.address && currentStop.label && (
              <div className="text-2xs text-slate-500 mt-0.5 line-clamp-1">{currentStop.address}</div>
            )}
          </div>
          {/* Status badge */}
          <span className={`text-2xs px-2 py-1 rounded-lg border font-semibold capitalize flex-shrink-0 ${statusCfg.bg} ${statusCfg.color}`}>
            {currentStop.status.replace('_', ' ')}
          </span>
        </div>

        {/* Time window */}
        {currentStop.time_window_start && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-500/5 border border-amber-500/15">
            <Icon name="Clock" size={11} className="text-amber-400 flex-shrink-0" />
            <span className="text-2xs text-amber-300">
              Window: {new Date(currentStop.time_window_start).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
              {currentStop.time_window_end && ` – ${new Date(currentStop.time_window_end).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`}
            </span>
          </div>
        )}

        {/* Notes */}
        {currentStop.notes && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-slate-900/40 border border-slate-800/40">
            <Icon name="FileText" size={11} className="text-slate-500 mt-0.5 flex-shrink-0" />
            <span className="text-2xs text-slate-400 leading-relaxed">{currentStop.notes}</span>
          </div>
        )}

        {/* ── Action buttons ─────────────────────────────── */}
        <div className="space-y-2 pt-1">

          {/* Arrive (manual) */}
          {(currentStop.status === 'pending' || currentStop.status === 'en_route') && !showSkipForm && (
            <button onClick={() => handleArrive(currentStop)} disabled={busy}
              className="w-full py-3 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-300 text-sm font-bold hover:bg-amber-500/20 disabled:opacity-40 active:scale-[0.98] transition-all flex items-center justify-center gap-2">
              {busy ? <span className="w-4 h-4 border-2 border-t-amber-400 border-slate-700 rounded-full animate-spin" />
                    : <Icon name="MapPin" size={15} />}
              I've Arrived
            </button>
          )}

          {/* Validate */}
          {currentStop.status === 'arrived' && !showSkipForm && (
            <button onClick={() => handleValidate(currentStop)} disabled={busy}
              className="w-full py-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-sm font-bold hover:bg-emerald-500/20 disabled:opacity-40 active:scale-[0.98] transition-all flex items-center justify-center gap-2">
              {busy ? <span className="w-4 h-4 border-2 border-t-emerald-400 border-slate-700 rounded-full animate-spin" />
                    : <Icon name="CheckCircle2" size={15} />}
              Confirm &amp; Validate Stop
            </button>
          )}

          {/* Skip / cancel skip form */}
          {(currentStop.status === 'pending' || currentStop.status === 'en_route' || currentStop.status === 'arrived') && (
            !showSkipForm ? (
              <button onClick={() => setShowSkipForm(true)}
                className="w-full py-2 rounded-xl border border-slate-700/60 text-slate-500 text-xs font-semibold hover:text-red-400 hover:border-red-500/30 hover:bg-red-500/5 transition-all flex items-center justify-center gap-1.5">
                <Icon name="SkipForward" size={12} />
                Skip This Stop
              </button>
            ) : (
              <div className="space-y-2 pt-1">
                <div className="text-xs text-slate-400 font-medium">Reason for skipping (required):</div>
                <textarea
                  value={skipReason}
                  onChange={e => setSkipReason(e.target.value)}
                  placeholder="e.g. Location inaccessible, customer not present, road closed…"
                  rows={2}
                  autoFocus
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:border-red-500/40 focus:outline-none resize-none"
                />
                <div className="flex gap-2">
                  <button onClick={() => { setShowSkipForm(false); setSkipReason('') }}
                    className="flex-1 py-2 rounded-xl border border-slate-700 text-slate-400 text-xs font-semibold hover:bg-slate-800/60 transition-colors">
                    Cancel
                  </button>
                  <button onClick={() => handleSkip(currentStop)} disabled={!skipReason.trim() || busy}
                    className="flex-1 py-2 rounded-xl bg-red-500/15 border border-red-500/30 text-red-400 text-xs font-bold hover:bg-red-500/20 disabled:opacity-30 transition-all">
                    {busy ? 'Logging…' : 'Confirm Skip'}
                  </button>
                </div>
              </div>
            )
          )}

          {/* Interrupt button — always visible during execution */}
          <button onClick={onInterrupt}
            className="w-full py-2 rounded-xl border border-slate-700/40 text-slate-600 text-2xs hover:text-amber-400 hover:border-amber-500/30 hover:bg-amber-500/5 transition-all flex items-center justify-center gap-1.5">
            <Icon name="AlertTriangle" size={11} />
            Interruption / Emergency
          </button>
        </div>
      </div>
    </div>
  )
}
