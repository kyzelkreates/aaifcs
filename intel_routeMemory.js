/**
 * ============================================================
 * APEX INTELLIGENCE — Route Memory Engine
 * File: intel_routeMemory.js  (flat-build alias)
 *
 * Storage namespace: apex:intel:memory:*
 * NEVER writes to existing apex:db:* or apex:rcache:* keys.
 * NEVER imports from services that import from this file.
 *
 * Stores and retrieves:
 *  - Successful route outcomes
 *  - Failed route records
 *  - Delay patterns per OD corridor
 *  - Driver route preferences
 *  - Fuel performance history
 *  - Dangerous road segments
 *  - Weather-related failures
 *  - Customer delivery timing windows
 *  - Recurring traffic patterns (time-of-day heat map)
 *
 * All operations are synchronous localStorage reads/writes.
 * Cap per store: 1000 entries (LRU evict oldest on overflow).
 * ============================================================
 */

// ─── Storage keys (isolated namespace) ───────────────────────
const NS = 'apex:intel:memory'
const KEYS = {
  ROUTES_SUCCESS:  `${NS}:routes:success`,
  ROUTES_FAILED:   `${NS}:routes:failed`,
  DELAYS:          `${NS}:delays`,
  DANGEROUS:       `${NS}:dangerous`,
  FUEL_HISTORY:    `${NS}:fuel`,
  DRIVER_PREFS:    `${NS}:driver_prefs`,
  TRAFFIC:         `${NS}:traffic`,
  WEATHER_FAIL:    `${NS}:weather_fail`,
  DELIVERY_TIMING: `${NS}:delivery_timing`,
  FLEET_PATTERNS:  `${NS}:fleet_patterns`,
}

const MAX_ENTRIES = 1000

// ─── Helpers ──────────────────────────────────────────────────
function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function readStore(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || '[]')
  } catch {
    return []
  }
}

function writeStore(key, rows) {
  try {
    // LRU evict: keep newest MAX_ENTRIES
    const capped = rows.slice(-MAX_ENTRIES)
    localStorage.setItem(key, JSON.stringify(capped))
  } catch {}
}

function append(key, record) {
  const rows = readStore(key)
  rows.push({ id: uid(), ts: Date.now(), ...record })
  writeStore(key, rows)
}

/**
 * Build an OD corridor key at ~3 decimal degrees precision
 * (~100m resolution) so nearby routes match the same key.
 */
function odKey(origin, destination) {
  const r = (n) => Number(n).toFixed(3)
  return `${r(origin.lat)},${r(origin.lng)}→${r(destination.lat)},${r(destination.lng)}`
}

/**
 * Time-of-day bucket: 0-47 (each 30-min slot in a 24h day)
 */
function timeBucket(ts = Date.now()) {
  const d   = new Date(ts)
  const h   = d.getHours()
  const m   = d.getMinutes()
  return h * 2 + (m >= 30 ? 1 : 0)
}

/**
 * Day-of-week: 0=Sun, 6=Sat
 */
function dayOfWeek(ts = Date.now()) {
  return new Date(ts).getDay()
}

// ─── Public API ───────────────────────────────────────────────

export const routeMemory = {

  // ── Successful route outcome ─────────────────────────────
  recordSuccess({
    origin, destination,
    vehicleId, driverId,
    distanceM, durationS,
    fuelUsedL, provider,
    stops = 1,
    routePolylineHash = null,   // optional fingerprint of geometry
    tags = [],                  // e.g. ['hgv','night','motorway']
  }) {
    const key = odKey(origin, destination)
    append(KEYS.ROUTES_SUCCESS, {
      od_key:    key,
      vehicle_id: vehicleId,
      driver_id:  driverId,
      distance_m: distanceM,
      duration_s: durationS,
      fuel_l:     fuelUsedL,
      provider,
      stops,
      polyline_hash: routePolylineHash,
      bucket:     timeBucket(),
      dow:        dayOfWeek(),
      tags,
    })
    // Also update traffic pattern for this corridor + time slot
    this._updateTrafficPattern(key, durationS, distanceM)
  },

  // ── Failed route record ──────────────────────────────────
  recordFailure({
    origin, destination,
    vehicleId, driverId,
    reason,            // 'breakdown'|'accident'|'closure'|'weather'|'fatigue'|'overloaded'|other
    delayMinutes = 0,
    tags = [],
  }) {
    const key = odKey(origin, destination)
    append(KEYS.ROUTES_FAILED, {
      od_key:      key,
      vehicle_id:  vehicleId,
      driver_id:   driverId,
      reason,
      delay_min:   delayMinutes,
      bucket:      timeBucket(),
      dow:         dayOfWeek(),
      tags,
    })
    // Flag as weather-related failure if applicable
    if (reason === 'weather') {
      append(KEYS.WEATHER_FAIL, {
        od_key:    key,
        delay_min: delayMinutes,
        bucket:    timeBucket(),
        dow:       dayOfWeek(),
      })
    }
  },

  // ── Delay record ─────────────────────────────────────────
  recordDelay({
    origin, destination,
    vehicleId, driverId,
    plannedDurationS, actualDurationS,
    cause = 'unknown',  // 'traffic'|'customer'|'loading'|'breakdown'|'weather'|other
  }) {
    const key       = odKey(origin, destination)
    const delayS    = Math.max(0, actualDurationS - plannedDurationS)
    const delayPct  = plannedDurationS > 0
      ? Math.round((delayS / plannedDurationS) * 100)
      : 0
    append(KEYS.DELAYS, {
      od_key:        key,
      vehicle_id:    vehicleId,
      driver_id:     driverId,
      planned_s:     plannedDurationS,
      actual_s:      actualDurationS,
      delay_s:       delayS,
      delay_pct:     delayPct,
      cause,
      bucket:        timeBucket(),
      dow:           dayOfWeek(),
    })
  },

  // ── Dangerous road segment ───────────────────────────────
  recordDangerousSegment({
    lat, lng,
    reason,    // 'accident'|'low_bridge'|'steep'|'narrow'|'school_zone'|'hgv_ban'|other
    severity,  // 1-10
    vehicleId, driverId,
  }) {
    const key = `${Number(lat).toFixed(3)},${Number(lng).toFixed(3)}`
    const rows = readStore(KEYS.DANGEROUS)
    // Update existing or add new
    const existing = rows.find(r => r.segment_key === key && r.reason === reason)
    if (existing) {
      existing.hit_count = (existing.hit_count || 1) + 1
      existing.last_ts   = Date.now()
      existing.severity  = Math.max(existing.severity, severity)
      writeStore(KEYS.DANGEROUS, rows)
    } else {
      append(KEYS.DANGEROUS, {
        segment_key: key,
        lat: Number(lat).toFixed(4),
        lng: Number(lng).toFixed(4),
        reason,
        severity,
        hit_count: 1,
        vehicle_id: vehicleId,
        driver_id:  driverId,
      })
    }
  },

  // ── Fuel history ─────────────────────────────────────────
  recordFuelPerformance({
    vehicleId, driverId,
    distanceM, fuelUsedL,
    speedAvgKmh,
    loadKg = 0,
    provider,
  }) {
    const lPer100km = distanceM > 0
      ? (fuelUsedL / (distanceM / 1000)) * 100
      : null
    append(KEYS.FUEL_HISTORY, {
      vehicle_id:    vehicleId,
      driver_id:     driverId,
      distance_m:    distanceM,
      fuel_l:        fuelUsedL,
      l_per_100km:   lPer100km ? Math.round(lPer100km * 10) / 10 : null,
      speed_avg:     speedAvgKmh,
      load_kg:       loadKg,
      provider,
      bucket:        timeBucket(),
      dow:           dayOfWeek(),
    })
  },

  // ── Driver route preferences ─────────────────────────────
  recordDriverPreference({
    driverId,
    origin, destination,
    preferredProvider,   // which routing provider they effectively used
    tags = [],           // route characteristics they used
    overrodeAI = false,  // driver ignored AI recommendation
  }) {
    const key = odKey(origin, destination)
    const rows = readStore(KEYS.DRIVER_PREFS)
    const existing = rows.find(r => r.driver_id === driverId && r.od_key === key)
    if (existing) {
      existing.count = (existing.count || 1) + 1
      existing.last_ts = Date.now()
      existing.preferred_provider = preferredProvider
      if (overrodeAI) existing.ai_overrides = (existing.ai_overrides || 0) + 1
      writeStore(KEYS.DRIVER_PREFS, rows)
    } else {
      append(KEYS.DRIVER_PREFS, {
        driver_id:          driverId,
        od_key:             key,
        count:              1,
        preferred_provider: preferredProvider,
        tags,
        ai_overrides:       overrodeAI ? 1 : 0,
      })
    }
  },

  // ── Delivery timing patterns ─────────────────────────────
  recordDeliveryTiming({
    customerId, address,
    scheduledTs, actualTs,
    onTime,
    timeWindowStart, timeWindowEnd,  // customer's accepted window (ISO strings)
  }) {
    const delayMin = actualTs
      ? Math.round((actualTs - scheduledTs) / 60000)
      : 0
    append(KEYS.DELIVERY_TIMING, {
      customer_id:   customerId || 'unknown',
      address,
      scheduled_ts:  scheduledTs,
      actual_ts:     actualTs,
      delay_min:     delayMin,
      on_time:       onTime,
      window_start:  timeWindowStart,
      window_end:    timeWindowEnd,
      bucket:        timeBucket(scheduledTs),
      dow:           dayOfWeek(scheduledTs),
    })
  },

  // ── Internal: traffic pattern update ────────────────────
  _updateTrafficPattern(odKey, durationS, distanceM) {
    const rows   = readStore(KEYS.TRAFFIC)
    const bucket = timeBucket()
    const dow    = dayOfWeek()
    const key    = `${odKey}:${dow}:${bucket}`
    const existing = rows.find(r => r.pattern_key === key)
    if (existing) {
      // Rolling average
      existing.sample_count = (existing.sample_count || 1) + 1
      const n = existing.sample_count
      existing.avg_duration_s = Math.round(
        (existing.avg_duration_s * (n - 1) + durationS) / n
      )
      existing.last_ts = Date.now()
      writeStore(KEYS.TRAFFIC, rows)
    } else {
      append(KEYS.TRAFFIC, {
        pattern_key:   key,
        od_key:        odKey,
        dow,
        bucket,
        avg_duration_s: durationS,
        sample_count:  1,
      })
    }
  },

  // ── Fleet-wide pattern ───────────────────────────────────
  recordFleetPattern({
    patternType,  // 'depot_congestion'|'bottleneck'|'dispatch_timing'|'loading_delay'
    locationKey,  // lat,lng or depot name
    severityScore, // 0-100
    data = {},
  }) {
    const rows = readStore(KEYS.FLEET_PATTERNS)
    const existing = rows.find(r => r.pattern_type === patternType && r.location_key === locationKey)
    if (existing) {
      existing.hit_count    = (existing.hit_count || 1) + 1
      existing.last_ts      = Date.now()
      existing.severity_score = Math.max(existing.severity_score, severityScore)
      existing.data         = { ...existing.data, ...data }
      writeStore(KEYS.FLEET_PATTERNS, rows)
    } else {
      append(KEYS.FLEET_PATTERNS, {
        pattern_type:   patternType,
        location_key:   locationKey,
        severity_score: severityScore,
        hit_count:      1,
        data,
      })
    }
  },

  // ── Query methods ─────────────────────────────────────────

  /**
   * Get historical success records for an OD pair.
   * Returns array sorted newest-first, capped at limit.
   */
  getSuccessHistory(origin, destination, limit = 20) {
    const key  = odKey(origin, destination)
    const rows = readStore(KEYS.ROUTES_SUCCESS)
    return rows
      .filter(r => r.od_key === key)
      .sort((a, b) => b.ts - a.ts)
      .slice(0, limit)
  },

  /**
   * Get failure history for an OD pair.
   */
  getFailureHistory(origin, destination, limit = 10) {
    const key  = odKey(origin, destination)
    const rows = readStore(KEYS.ROUTES_FAILED)
    return rows
      .filter(r => r.od_key === key)
      .sort((a, b) => b.ts - a.ts)
      .slice(0, limit)
  },

  /**
   * Get average delay for an OD corridor, optionally filtered by
   * day-of-week and time bucket.
   */
  getCorridorDelay(origin, destination, { dow, bucket } = {}) {
    const key  = odKey(origin, destination)
    const rows = readStore(KEYS.DELAYS)
    let filtered = rows.filter(r => r.od_key === key)
    if (dow    !== undefined) filtered = filtered.filter(r => r.dow    === dow)
    if (bucket !== undefined) filtered = filtered.filter(r => r.bucket === bucket)
    if (filtered.length === 0) return null
    const avgDelay = filtered.reduce((s, r) => s + r.delay_s, 0) / filtered.length
    const avgPct   = filtered.reduce((s, r) => s + r.delay_pct, 0) / filtered.length
    return {
      samples:       filtered.length,
      avg_delay_s:   Math.round(avgDelay),
      avg_delay_pct: Math.round(avgPct),
      max_delay_s:   Math.max(...filtered.map(r => r.delay_s)),
    }
  },

  /**
   * Get dangerous segments near a lat/lng within radiusDeg (~0.01° ≈ 1km).
   */
  getDangerousSegmentsNear(lat, lng, radiusDeg = 0.02) {
    const rows = readStore(KEYS.DANGEROUS)
    return rows.filter(r => {
      const dlat = Math.abs(parseFloat(r.lat) - lat)
      const dlng = Math.abs(parseFloat(r.lng) - lng)
      return dlat <= radiusDeg && dlng <= radiusDeg
    }).sort((a, b) => b.severity - a.severity)
  },

  /**
   * Get average fuel consumption for a vehicle.
   */
  getVehicleFuelAvg(vehicleId, limit = 30) {
    const rows = readStore(KEYS.FUEL_HISTORY)
      .filter(r => r.vehicle_id === vehicleId)
      .slice(-limit)
    if (rows.length === 0) return null
    const valid = rows.filter(r => r.l_per_100km != null)
    if (valid.length === 0) return null
    return Math.round(
      valid.reduce((s, r) => s + r.l_per_100km, 0) / valid.length * 10
    ) / 10
  },

  /**
   * Get driver's preferred route characteristics.
   */
  getDriverPreferences(driverId) {
    const rows = readStore(KEYS.DRIVER_PREFS)
    return rows
      .filter(r => r.driver_id === driverId)
      .sort((a, b) => b.count - a.count)
  },

  /**
   * Predict expected duration for an OD pair at current time,
   * using historical traffic patterns.
   * Returns null if no data.
   */
  predictDuration(origin, destination, ts = Date.now()) {
    const key    = odKey(origin, destination)
    const bucket = timeBucket(ts)
    const dow    = dayOfWeek(ts)
    const rows   = readStore(KEYS.TRAFFIC)
    // Exact match first
    const exact  = rows.find(r => r.pattern_key === `${key}:${dow}:${bucket}`)
    if (exact && exact.sample_count >= 2) return exact.avg_duration_s
    // Nearby bucket (±1 slot)
    const near = rows.filter(r =>
      r.od_key === key && r.dow === dow &&
      Math.abs(r.bucket - bucket) <= 1
    )
    if (near.length > 0) {
      const totalSamples = near.reduce((s, r) => s + r.sample_count, 0)
      const weightedSum  = near.reduce((s, r) => s + r.avg_duration_s * r.sample_count, 0)
      return Math.round(weightedSum / totalSamples)
    }
    return null
  },

  /**
   * Get the overall success rate for an OD corridor (0-1).
   */
  getCorridorReliability(origin, destination) {
    const successes = this.getSuccessHistory(origin, destination, 50).length
    const failures  = this.getFailureHistory(origin, destination, 50).length
    const total     = successes + failures
    if (total === 0) return null
    return Math.round((successes / total) * 100) / 100
  },

  /**
   * Get fleet-wide patterns of a given type.
   */
  getFleetPatterns(patternType) {
    const rows = readStore(KEYS.FLEET_PATTERNS)
    return rows
      .filter(r => !patternType || r.pattern_type === patternType)
      .sort((a, b) => b.severity_score - a.severity_score)
  },

  /**
   * Get delivery timing reliability for a customer.
   */
  getCustomerTimingStats(customerId, limit = 20) {
    const rows = readStore(KEYS.DELIVERY_TIMING)
      .filter(r => r.customer_id === customerId)
      .slice(-limit)
    if (rows.length === 0) return null
    const onTimeCount = rows.filter(r => r.on_time).length
    const avgDelay    = rows.reduce((s, r) => s + (r.delay_min || 0), 0) / rows.length
    return {
      samples:      rows.length,
      on_time_rate: Math.round((onTimeCount / rows.length) * 100),
      avg_delay_min: Math.round(avgDelay),
    }
  },

  /**
   * Diagnostics — how much data is stored.
   */
  getStats() {
    return Object.entries(KEYS).map(([name, key]) => ({
      store:   name,
      entries: readStore(key).length,
    }))
  },

  /**
   * Clear all intelligence memory (operator reset).
   */
  clearAll() {
    Object.values(KEYS).forEach(k => {
      try { localStorage.removeItem(k) } catch {}
    })
  },
}

export default routeMemory
