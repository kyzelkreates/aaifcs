/**
 * ============================================================
 * APEX AI — Command Center Bridge
 * Mounts on top of existing services via event subscription.
 * NEVER modifies any existing file — additive hooks only.
 *
 * Called ONCE from App.jsx on mount (Dashboard) and
 * ONCE from pages_DriverApp.jsx on driver login.
 *
 * Hooks:
 *  Dashboard:
 *    • Starts 60s heartbeat with live vehicle/driver counts
 *    • Subscribes to DB_KEYS.JOBS → fires routeComplete on completion
 *    • Subscribes to DB_KEYS.TELEMETRY → buffers vehicle_status events
 *
 *  Driver App:
 *    • driver_login event on profile load
 *    • route_started event on navigateToJob
 *    • route_complete event on completeJob (passed as callback)
 *    • GPS tick → vehicle_status via pushVehicleStatus
 *    • driver_logout on beforeunload / manual logout
 * ============================================================
 */

import apexClient from './services_apex_apexClient'
import { subscribe, DB_KEYS } from './services_local_localDB'
import { useFleetStore, useDriverStore } from './core_storage'

let _mounted = false

// ─── Dashboard bridge ─────────────────────────────────────────
export function mountDashboardBridge() {
  if (_mounted) return () => {}   // idempotent
  _mounted = true

  // Heartbeat — inject live counts from Zustand store
  const stopHeartbeat = apexClient.startHeartbeat(() => {
    const { vehicles } = useFleetStore.getState()
    const { drivers }  = useDriverStore.getState()
    const activeVehicles = vehicles.filter(v => v.status === 'en_route' || v.status === 'active').length
    const onlineDrivers  = drivers.filter(d => d.status === 'active' || d.status === 'driving').length
    return { activeVehicles, onlineDrivers }
  })

  // Batch timer
  const stopBatch = apexClient.startBatchTimer()

  // Job completions → routeComplete
  const unsubJobs = subscribe(DB_KEYS.JOBS, (event) => {
    try {
      if (event?.event !== 'UPDATE') return
      const job = event?.payload
      if (!job || job.status !== 'completed') return

      apexClient.routeComplete({
        vehicleId:                job.vehicle_id   || job.vehicle_reg || 'unknown',
        driverId:                 job.driver_id    || 'unknown',
        routeId:                  `rte_${job.id}`,
        distanceKm:               job.route_summary?.distance_m
                                    ? job.route_summary.distance_m / 1000 : 0,
        durationMin:              job.route_summary?.duration_s
                                    ? Math.round(job.route_summary.duration_s / 60) : 0,
        stops:                    job.stop_count   || (job.stops?.length ?? 1),
        fuelSavedL:               0,              // Apex will compute
        optimisationSavingPercent: 0,
        aiOptimised:              false,
        onTimeDelivery:           job.scheduled_at
                                    ? new Date(job.completed_at) <= new Date(job.scheduled_at)
                                    : true,
      })
    } catch {}
  })

  // Telemetry snapshots → vehicle_status events
  const unsubTel = subscribe(DB_KEYS.TELEMETRY, (event) => {
    try {
      if (event?.event !== 'INSERT') return
      const t = event?.payload
      if (!t) return
      apexClient.pushVehicleStatus({
        vehicleId: t.vehicle_id,
        driverId:  t.driver_id,
        speed:     t.speed    || 0,
        lat:       t.lat      || null,
        lng:       t.lng      || null,
        status:    t.status   || 'en_route',
        fuel:      t.fuel     || null,
        battery:   t.battery  || null,
      })
    } catch {}
  })

  // Online → flush retry queue
  const onOnline = () => apexClient.flushQueue()
  window.addEventListener('online', onOnline)

  // Flush queue once on mount
  apexClient.flushQueue()

  // Return cleanup
  return () => {
    stopHeartbeat()
    stopBatch()
    unsubJobs?.()
    unsubTel?.()
    window.removeEventListener('online', onOnline)
    _mounted = false
  }
}

// ─── Driver App bridge ────────────────────────────────────────
// Call this once after driver logs in.
// Returns { onGpsTick, onJobStart, onJobComplete, onLogout }
export function mountDriverBridge(profile) {
  if (!profile?.id) return null

  const driverId  = profile.id
  const vehicleId = profile.vehicle_id || profile.vehicleId || 'unknown'
  const shiftId   = `shift_${Date.now()}`

  // Announce login
  apexClient.pushDriverLogin(driverId, vehicleId, shiftId)
  apexClient.startBatchTimer()

  // Online → flush
  const onOnline = () => apexClient.flushQueue()
  window.addEventListener('online', onOnline)

  // Flush on mount
  apexClient.flushQueue()

  // Logout handler — call on driver logout / beforeunload
  const onLogout = (totalKm = 0) => {
    apexClient.pushDriverLogout(driverId, vehicleId, shiftId, totalKm)
    apexClient.flushBatch()        // flush remaining events immediately
    apexClient.stopBatchTimer()
  }

  // GPS tick — call from the driver app's GPS interval (5s)
  const onGpsTick = ({ lat, lng, speed, fuel, status }) => {
    apexClient.pushVehicleStatus({ vehicleId, driverId, lat, lng, speed, fuel, status })
  }

  // Route started — call when navigateToJob runs
  const onJobStart = (job) => {
    apexClient.pushRouteStarted(
      `rte_${job.id}`,
      driverId,
      vehicleId,
      job.stop_count || job.stops?.length || 1
    )
  }

  // Route complete — call from completeJob
  const onJobComplete = (job, tripDistKm = 0) => {
    // Estimate fuel saved: assume 10% optimisation saving over 8 L/100km avg
    const fuelSavedL = Math.round(tripDistKm * 0.08 * 0.10 * 10) / 10

    apexClient.routeComplete({
      vehicleId,
      driverId,
      routeId:                  `rte_${job.id}`,
      distanceKm:               tripDistKm || 0,
      durationMin:              0,  // Apex derives
      stops:                    job.stop_count || job.stops?.length || 1,
      fuelSavedL,
      aiOptimised:              true,   // we always use AI routing
      onTimeDelivery:           job.scheduled_at
                                  ? new Date() <= new Date(job.scheduled_at)
                                  : true,
    })

    apexClient.flushBatch()
    apexClient.flushQueue()
  }

  const cleanup = () => {
    window.removeEventListener('online', onOnline)
    apexClient.stopBatchTimer()
  }

  return { onGpsTick, onJobStart, onJobComplete, onLogout, cleanup }
}

export default { mountDashboardBridge, mountDriverBridge }
