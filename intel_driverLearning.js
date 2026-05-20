/**
 * ============================================================
 * APEX INTELLIGENCE — Driver Learning Engine
 * File: intel_driverLearning.js
 *
 * Builds a risk + behaviour profile per driver from:
 *  - Harsh braking / acceleration events
 *  - Speeding history
 *  - Fatigue session patterns
 *  - Route performance (on-time rate, delay causes)
 *  - Delivery success rate
 *  - Safety alert history
 *  - Parking / reversing incidents
 *
 * Storage: apex:intel:driver:* (isolated namespace)
 * NO external APIs. NO AI calls. Pure rule engine.
 * ============================================================
 */

const NS = 'apex:intel:driver'

function readStore(key) {
  try { return JSON.parse(localStorage.getItem(key) || '[]') } catch { return [] }
}
function readObj(key) {
  try { return JSON.parse(localStorage.getItem(key) || '{}') } catch { return {} }
}
function writeStore(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)) } catch {}
}

function profileKey(driverId) { return `${NS}:profile:${driverId}` }
function eventsKey(driverId)  { return `${NS}:events:${driverId}`  }

const MAX_EVENTS = 500

// ─── Default profile ──────────────────────────────────────────
function blankProfile(driverId) {
  return {
    driver_id:           driverId,
    risk_score:          50,          // 0 = safest, 100 = highest risk
    safety_score:        50,          // 0 = dangerous, 100 = excellent
    efficiency_score:    50,
    reliability_score:   50,
    overall_grade:       'C',
    total_jobs:          0,
    on_time_count:       0,
    late_count:          0,
    harsh_brake_count:   0,
    harsh_accel_count:   0,
    harsh_corner_count:  0,
    speeding_count:      0,
    fatigue_alerts:      0,
    incidents:           0,
    total_km:            0,
    events_per_100km:    0,
    last_updated:        null,
  }
}

// ─── Grade from score ─────────────────────────────────────────
function gradeFromScore(score) {
  if (score >= 90) return 'A+'
  if (score >= 80) return 'A'
  if (score >= 70) return 'B'
  if (score >= 60) return 'C'
  if (score >= 50) return 'D'
  return 'F'
}

// ─── Recalculate scores from events ───────────────────────────
function recalcProfile(profile, events) {
  const last90days   = Date.now() - 90 * 86400000
  const recent       = events.filter(e => e.ts > last90days)
  const totalKm      = profile.total_km || 0

  // Events per 100km (normalised harsh event rate)
  const harshEvents  = recent.filter(e => ['harsh_brake','harsh_accel','harsh_corner'].includes(e.type))
  const eventsP100km = totalKm > 0 ? (harshEvents.length / totalKm) * 100 : 0

  // On-time rate
  const jobs         = recent.filter(e => e.type === 'job_complete')
  const onTimeJobs   = jobs.filter(e => e.data?.on_time)
  const onTimeRate   = jobs.length > 0 ? onTimeJobs.length / jobs.length : 0.5

  // Speeding rate
  const speedingEvt  = recent.filter(e => e.type === 'speeding')
  const speedingRate = totalKm > 0 ? (speedingEvt.length / totalKm) * 100 : 0

  // Fatigue alerts
  const fatigueAlerts = recent.filter(e => e.type === 'fatigue_alert').length

  // Safety score (100 = perfect)
  let safetyScore = 100
  safetyScore -= Math.min(40, eventsP100km * 8)   // harsh events penalty
  safetyScore -= Math.min(20, speedingRate * 5)    // speeding penalty
  safetyScore -= Math.min(20, fatigueAlerts * 5)   // fatigue penalty
  safetyScore -= Math.min(10, (profile.incidents || 0) * 5)
  safetyScore  = Math.max(0, Math.round(safetyScore))

  // Efficiency score
  let efficiencyScore = Math.round(onTimeRate * 80) + 20  // 20-100
  efficiencyScore     = Math.max(0, Math.min(100, efficiencyScore))

  // Reliability score (consistency over time)
  const totalJobs = profile.total_jobs || 0
  let reliabilityScore = totalJobs > 0
    ? Math.min(100, 50 + Math.round((totalJobs / 10) * 10))  // experience bonus
    : 50
  reliabilityScore -= Math.min(30, profile.late_count * 3)
  reliabilityScore  = Math.max(0, Math.min(100, reliabilityScore))

  // Risk score (higher = more risky — inverse of safety)
  const riskScore = Math.max(0, 100 - safetyScore)

  // Overall (weighted)
  const overall = Math.round(
    safetyScore      * 0.4 +
    efficiencyScore  * 0.3 +
    reliabilityScore * 0.3
  )

  return {
    ...profile,
    risk_score:       riskScore,
    safety_score:     safetyScore,
    efficiency_score: efficiencyScore,
    reliability_score: reliabilityScore,
    overall_grade:    gradeFromScore(overall),
    overall_score:    overall,
    events_per_100km: Math.round(eventsP100km * 10) / 10,
    speeding_rate:    Math.round(speedingRate * 10) / 10,
    on_time_rate:     Math.round(onTimeRate * 100),
    last_updated:     Date.now(),
  }
}

// ─── Public API ───────────────────────────────────────────────
export const driverLearning = {

  /**
   * Record a harsh event (brake, accel, corner).
   */
  recordHarshEvent(driverId, { type, severityG, lat, lng, speedKmh }) {
    const key    = eventsKey(driverId)
    const events = readStore(key)
    events.push({
      type: type || 'harsh_brake',  // harsh_brake|harsh_accel|harsh_corner
      ts:   Date.now(),
      data: { severity_g: severityG, lat, lng, speed_kmh: speedKmh },
    })
    writeStore(key, events.slice(-MAX_EVENTS))
    this._updateProfileCounter(driverId, type)
  },

  /**
   * Record a speeding event.
   */
  recordSpeeding(driverId, { speedKmh, limitKmh, lat, lng }) {
    const key    = eventsKey(driverId)
    const events = readStore(key)
    events.push({
      type: 'speeding',
      ts:   Date.now(),
      data: { speed_kmh: speedKmh, limit_kmh: limitKmh, over_by: speedKmh - limitKmh, lat, lng },
    })
    writeStore(key, events.slice(-MAX_EVENTS))
    const profile = this.getProfile(driverId)
    profile.speeding_count = (profile.speeding_count || 0) + 1
    this._saveProfile(driverId, profile)
  },

  /**
   * Record a fatigue alert.
   */
  recordFatigueAlert(driverId, { fatigueScore, sessionHours }) {
    const key    = eventsKey(driverId)
    const events = readStore(key)
    events.push({
      type: 'fatigue_alert',
      ts:   Date.now(),
      data: { fatigue_score: fatigueScore, session_hours: sessionHours },
    })
    writeStore(key, events.slice(-MAX_EVENTS))
    const profile = this.getProfile(driverId)
    profile.fatigue_alerts = (profile.fatigue_alerts || 0) + 1
    this._saveProfile(driverId, profile)
  },

  /**
   * Record job completion.
   */
  recordJobComplete(driverId, { jobId, distanceKm, onTime, delayMin, vehicleId }) {
    const key    = eventsKey(driverId)
    const events = readStore(key)
    events.push({
      type: 'job_complete',
      ts:   Date.now(),
      data: { job_id: jobId, distance_km: distanceKm, on_time: onTime, delay_min: delayMin, vehicle_id: vehicleId },
    })
    writeStore(key, events.slice(-MAX_EVENTS))

    const profile = this.getProfile(driverId)
    profile.total_jobs  = (profile.total_jobs  || 0) + 1
    profile.total_km    = (profile.total_km    || 0) + (distanceKm || 0)
    if (onTime) profile.on_time_count = (profile.on_time_count || 0) + 1
    else        profile.late_count    = (profile.late_count    || 0) + 1
    this._saveAndRecalc(driverId, profile, events)
  },

  /**
   * Record an incident (accident, near-miss, parking, reversing).
   */
  recordIncident(driverId, { type, description, severity = 'low' }) {
    const key    = eventsKey(driverId)
    const events = readStore(key)
    events.push({
      type: 'incident',
      ts:   Date.now(),
      data: { incident_type: type, description, severity },
    })
    writeStore(key, events.slice(-MAX_EVENTS))
    const profile = this.getProfile(driverId)
    profile.incidents = (profile.incidents || 0) + 1
    this._saveAndRecalc(driverId, profile, events)
  },

  /**
   * Get driver profile (creates blank if not exists).
   */
  getProfile(driverId) {
    const obj = readObj(profileKey(driverId))
    if (!obj.driver_id) return blankProfile(driverId)
    return obj
  },

  /**
   * Get risk summary for UI display.
   */
  getRiskSummary(driverId) {
    const p = this.getProfile(driverId)
    return {
      riskScore:        p.risk_score,
      safetyScore:      p.safety_score,
      efficiencyScore:  p.efficiency_score,
      reliabilityScore: p.reliability_score,
      overallGrade:     p.overall_grade,
      overallScore:     p.overall_score || 50,
      eventsPerKm:      p.events_per_100km,
      onTimeRate:       p.on_time_rate,
      totalJobs:        p.total_jobs,
      riskLevel:        p.risk_score >= 70 ? 'high' : p.risk_score >= 40 ? 'moderate' : 'low',
      riskColor:        p.risk_score >= 70 ? 'text-red-400' : p.risk_score >= 40 ? 'text-amber-400' : 'text-emerald-400',
    }
  },

  /**
   * Get recent events for a driver (for audit log).
   */
  getRecentEvents(driverId, limit = 30) {
    return readStore(eventsKey(driverId))
      .slice(-limit)
      .reverse()
  },

  /**
   * Rank all drivers by risk (highest risk first).
   * @param {string[]} driverIds
   */
  rankByRisk(driverIds) {
    return driverIds
      .map(id => ({ id, ...this.getRiskSummary(id) }))
      .sort((a, b) => b.riskScore - a.riskScore)
  },

  // ── Private ───────────────────────────────────────────────
  _updateProfileCounter(driverId, eventType) {
    const profile = this.getProfile(driverId)
    if (eventType === 'harsh_brake')  profile.harsh_brake_count  = (profile.harsh_brake_count  || 0) + 1
    if (eventType === 'harsh_accel')  profile.harsh_accel_count  = (profile.harsh_accel_count  || 0) + 1
    if (eventType === 'harsh_corner') profile.harsh_corner_count = (profile.harsh_corner_count || 0) + 1
    const events = readStore(eventsKey(driverId))
    this._saveAndRecalc(driverId, profile, events)
  },

  _saveProfile(driverId, profile) {
    writeStore(profileKey(driverId), profile)
  },

  _saveAndRecalc(driverId, profile, events) {
    const updated = recalcProfile(profile, events)
    writeStore(profileKey(driverId), updated)
  },
}

export default driverLearning
