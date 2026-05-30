/**
 * ============================================================
 * APEX INTELLIGENCE — Fleet Learning Engine
 * File: intel_fleetLearning.js
 *
 * Fleet-wide pattern recognition and optimisation intelligence.
 * Learns from aggregated telemetry, job outcomes, and timing data.
 *
 * Learns:
 *  - Depot congestion patterns (by time of day)
 *  - Recurring bottleneck roads
 *  - Best dispatch times for each corridor
 *  - Loading bay inefficiencies
 *  - Traffic patterns (aggregated from routeMemory)
 *  - Seasonal delays
 *  - Fleet utilisation patterns
 *
 * Storage: apex:intel:fleet:* (isolated)
 * NO external APIs. NO AI calls.
 * ============================================================
 */

import routeMemory from './intel_routeMemory'

const NS = 'apex:intel:fleet'
const LS_KEYS = {
  DEPOT_CONGESTION:  `${NS}:depot`,
  DISPATCH_TIMING:   `${NS}:dispatch_timing`,
  LOADING_TIMES:     `${NS}:loading`,
  UTILISATION:       `${NS}:utilisation`,
  BOTTLENECKS:       `${NS}:bottlenecks`,
  FLEET_STATS:       `${NS}:stats`,
}

function readStore(key) {
  try { return JSON.parse(localStorage.getItem(key) || '[]') } catch { return [] }
}
function readObj(key) {
  try { return JSON.parse(localStorage.getItem(key) || '{}') } catch { return {} }
}
function writeStore(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)) } catch {}
}
function uid() { return `${Date.now()}-${Math.random().toString(36).slice(2,8)}` }

// Time bucket (0-47 per day, 30-min slots)
function timeBucket(ts = Date.now()) {
  const d = new Date(ts); return d.getHours() * 2 + (d.getMinutes() >= 30 ? 1 : 0)
}
function dayOfWeek(ts = Date.now()) { return new Date(ts).getDay() }
function timeLabel(bucket) {
  const h = Math.floor(bucket / 2)
  const m = (bucket % 2) * 30
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`
}

// ─── Public API ───────────────────────────────────────────────
export const fleetLearning = {

  // ── 1. Depot congestion ───────────────────────────────────
  recordDepotEvent({
    depotId = 'main',
    eventType,    // 'vehicle_in'|'vehicle_out'|'loading_start'|'loading_end'|'queue_formed'
    vehicleCount, // total vehicles at depot at this moment
    waitMinutes = 0,
  }) {
    const rows  = readStore(LS_KEYS.DEPOT_CONGESTION)
    const b     = timeBucket()
    const dow   = dayOfWeek()
    const key   = `${depotId}:${dow}:${b}`

    const existing = rows.find(r => r.pattern_key === key)
    if (existing) {
      existing.event_count = (existing.event_count || 1) + 1
      const n = existing.event_count
      existing.avg_vehicles = Math.round((existing.avg_vehicles * (n - 1) + (vehicleCount || 0)) / n)
      existing.avg_wait_min = Math.round((existing.avg_wait_min * (n - 1) + waitMinutes) / n)
      existing.last_ts = Date.now()
      writeStore(LS_KEYS.DEPOT_CONGESTION, rows)
    } else {
      rows.push({
        id: uid(), pattern_key: key, depot_id: depotId,
        dow, bucket: b, time_label: timeLabel(b),
        event_type: eventType,
        avg_vehicles: vehicleCount || 0,
        avg_wait_min: waitMinutes,
        event_count: 1,
        ts: Date.now(), last_ts: Date.now(),
      })
      writeStore(LS_KEYS.DEPOT_CONGESTION, rows.slice(-1000))
    }
  },

  getDepotCongestionForecast(depotId = 'main', ts = Date.now()) {
    const b   = timeBucket(ts)
    const dow = dayOfWeek(ts)
    const rows = readStore(LS_KEYS.DEPOT_CONGESTION)

    // Exact slot
    const exact = rows.find(r => r.depot_id === depotId && r.dow === dow && r.bucket === b)
    if (exact && exact.event_count >= 2) {
      return {
        congestionLevel: exact.avg_vehicles > 5 ? 'high' : exact.avg_vehicles > 3 ? 'moderate' : 'low',
        avgVehicles:     exact.avg_vehicles,
        avgWaitMin:      exact.avg_wait_min,
        samples:         exact.event_count,
        timeLabel:       timeLabel(b),
      }
    }

    // Adjacent slots
    const near = rows.filter(r =>
      r.depot_id === depotId && r.dow === dow && Math.abs(r.bucket - b) <= 2
    )
    if (near.length > 0) {
      const avgV = Math.round(near.reduce((s, r) => s + r.avg_vehicles, 0) / near.length)
      const avgW = Math.round(near.reduce((s, r) => s + r.avg_wait_min, 0) / near.length)
      return {
        congestionLevel: avgV > 5 ? 'high' : avgV > 3 ? 'moderate' : 'low',
        avgVehicles: avgV, avgWaitMin: avgW, samples: near.length, timeLabel: timeLabel(b),
      }
    }

    return { congestionLevel: 'unknown', samples: 0, timeLabel: timeLabel(b) }
  },

  getBestDispatchTime(depotId = 'main', dow = dayOfWeek()) {
    const rows = readStore(LS_KEYS.DEPOT_CONGESTION)
      .filter(r => r.depot_id === depotId && r.dow === dow)

    if (rows.length === 0) return null

    // Find bucket with lowest average vehicle count (least congestion)
    const best = rows.reduce((min, r) => r.avg_vehicles < min.avg_vehicles ? r : min, rows[0])
    return {
      bucket:         best.bucket,
      timeLabel:      timeLabel(best.bucket),
      avgVehicles:    best.avg_vehicles,
      congestionLevel: best.avg_vehicles > 5 ? 'high' : best.avg_vehicles > 3 ? 'moderate' : 'low',
    }
  },

  // ── 2. Loading time tracking ──────────────────────────────
  recordLoadingTime({ depotId = 'main', vehicleId, durationMin, cargoType }) {
    const rows = readStore(LS_KEYS.LOADING_TIMES)
    rows.push({
      id: uid(), depot_id: depotId, vehicle_id: vehicleId,
      duration_min: durationMin, cargo_type: cargoType || 'general',
      bucket: timeBucket(), dow: dayOfWeek(), ts: Date.now(),
    })
    writeStore(LS_KEYS.LOADING_TIMES, rows.slice(-500))
  },

  getAvgLoadingTime(depotId = 'main', cargoType = null) {
    let rows = readStore(LS_KEYS.LOADING_TIMES).filter(r => r.depot_id === depotId)
    if (cargoType) rows = rows.filter(r => r.cargo_type === cargoType)
    if (rows.length === 0) return null
    const avg = rows.reduce((s, r) => s + r.duration_min, 0) / rows.length
    return { avg_min: Math.round(avg), samples: rows.length, cargoType }
  },

  // ── 3. Bottleneck detection ───────────────────────────────
  recordBottleneck({ lat, lng, delayMinutes, cause = 'traffic', vehicleId }) {
    const key  = `${Number(lat).toFixed(3)},${Number(lng).toFixed(3)}`
    const rows = readStore(LS_KEYS.BOTTLENECKS)
    const existing = rows.find(r => r.location_key === key)
    if (existing) {
      existing.hit_count  = (existing.hit_count || 1) + 1
      const n             = existing.hit_count
      existing.avg_delay  = Math.round((existing.avg_delay * (n - 1) + delayMinutes) / n)
      existing.last_ts    = Date.now()
      existing.severity   = existing.avg_delay > 30 ? 'high' : existing.avg_delay > 10 ? 'moderate' : 'low'
      writeStore(LS_KEYS.BOTTLENECKS, rows)
    } else {
      rows.push({
        id: uid(), location_key: key,
        lat: Number(lat).toFixed(4), lng: Number(lng).toFixed(4),
        avg_delay: delayMinutes, hit_count: 1, cause,
        severity: delayMinutes > 30 ? 'high' : delayMinutes > 10 ? 'moderate' : 'low',
        vehicle_id: vehicleId, ts: Date.now(), last_ts: Date.now(),
      })
      writeStore(LS_KEYS.BOTTLENECKS, rows.slice(-500))
    }
    // Also record in routeMemory for route-level scoring
    try { routeMemory.recordFleetPattern({ patternType: 'bottleneck', locationKey: key, severityScore: Math.min(100, delayMinutes * 2) }) } catch {}
  },

  getBottlenecks({ minHits = 2 } = {}) {
    return readStore(LS_KEYS.BOTTLENECKS)
      .filter(r => r.hit_count >= minHits)
      .sort((a, b) => b.avg_delay - a.avg_delay)
  },

  // ── 4. Fleet utilisation ──────────────────────────────────
  recordUtilisationSnapshot({ activeVehicles, totalVehicles, activeDrivers, totalDrivers }) {
    const obj  = readObj(LS_KEYS.UTILISATION)
    const b    = timeBucket()
    const dow  = dayOfWeek()
    const key  = `${dow}:${b}`
    if (!obj[key]) obj[key] = { samples: 0, avg_vehicle_util: 0, avg_driver_util: 0 }
    const n    = obj[key].samples + 1
    const vUtil = totalVehicles > 0 ? (activeVehicles / totalVehicles) * 100 : 0
    const dUtil = totalDrivers  > 0 ? (activeDrivers  / totalDrivers)  * 100 : 0
    obj[key].avg_vehicle_util = Math.round((obj[key].avg_vehicle_util * (n - 1) + vUtil) / n)
    obj[key].avg_driver_util  = Math.round((obj[key].avg_driver_util  * (n - 1) + dUtil) / n)
    obj[key].samples          = n
    writeStore(LS_KEYS.UTILISATION, obj)
  },

  getUtilisationForecast(ts = Date.now()) {
    const obj = readObj(LS_KEYS.UTILISATION)
    const key = `${dayOfWeek(ts)}:${timeBucket(ts)}`
    const slot = obj[key]
    if (!slot || slot.samples < 2) return null
    return {
      avgVehicleUtil: slot.avg_vehicle_util,
      avgDriverUtil:  slot.avg_driver_util,
      samples:        slot.samples,
      timeLabel:      timeLabel(timeBucket(ts)),
    }
  },

  // ── 5. Fleet-wide statistics ──────────────────────────────
  updateFleetStats({ jobsCompleted = 0, jobsFailed = 0, kmDriven = 0, alertsGenerated = 0 }) {
    const obj = readObj(LS_KEYS.FLEET_STATS)
    obj.jobs_completed   = (obj.jobs_completed   || 0) + jobsCompleted
    obj.jobs_failed      = (obj.jobs_failed      || 0) + jobsFailed
    obj.total_km         = (obj.total_km         || 0) + kmDriven
    obj.alerts_generated = (obj.alerts_generated || 0) + alertsGenerated
    obj.last_updated     = Date.now()
    writeStore(LS_KEYS.FLEET_STATS, obj)
  },

  getFleetStats() {
    const obj  = readObj(LS_KEYS.FLEET_STATS)
    const done = Math.max(0, parseInt(obj.jobs_completed, 10) || 0)
    const fail = Math.max(0, parseInt(obj.jobs_failed,    10) || 0)
    const total = done + fail
    // successRate: null when no recorded jobs (UI renders "—")
    // Never returns NaN — explicit guard.
    const successRate = total > 0
      ? Math.min(100, Math.max(0, Math.round((done / total) * 100)))
      : null
    return {
      jobsCompleted:   done,
      jobsFailed:      fail,
      totalKm:         Math.max(0, parseFloat(obj.total_km) || 0),
      alertsGenerated: Math.max(0, parseInt(obj.alerts_generated, 10) || 0),
      successRate,
      lastUpdated:     obj.last_updated || null,
    }
  },

  // ── 6. Intelligence summary (for dashboard) ───────────────
  getIntelligenceSummary() {
    const bottlenecks = this.getBottlenecks({ minHits: 3 })
    const stats       = this.getFleetStats()
    const bestDispatch = this.getBestDispatchTime()
    const forecast    = this.getDepotCongestionForecast()

    return {
      activeBottlenecks:     bottlenecks.length,
      highSeverityBottlenecks: bottlenecks.filter(b => b.severity === 'high').length,
      bestDispatchTime:      bestDispatch?.timeLabel || null,
      currentCongestion:     forecast.congestionLevel,
      fleetSuccessRate:      stats.successRate,
      totalKmLearned:        stats.totalKm,
    }
  },

  clearAll() {
    Object.values(LS_KEYS).forEach(k => {
      try { localStorage.removeItem(k) } catch {}
    })
  },
}

export default fleetLearning
