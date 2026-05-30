/**
 * ============================================================
 * APEX INTELLIGENCE — Safety Engine
 * File: intel_safetyEngine.js
 *
 * Analyses routes and operational data for safety risks.
 * NEVER modifies existing safetyService.js.
 * NEVER writes to apex:db:safety_alerts — reads only.
 * Writes to own namespace: apex:intel:safety:*
 *
 * Analyses:
 *  - Dangerous junctions and accident-prone areas
 *  - Steep gradients (from GH elevation data)
 *  - School zones (time-of-day proximity)
 *  - Low bridge conflicts (vehicle height vs route)
 *  - Narrow roads / HGV restrictions
 *  - Unsafe weather conditions
 *  - Driver fatigue risk (session + hours)
 *  - Driver stress indicators (speed variance, harsh events)
 *  - Night driving risk
 *  - Overscheduling risk
 * ============================================================
 */

import routeMemory from './intel_routeMemory'

const NS      = 'apex:intel:safety'
const LS_KEYS = {
  JUNCTION_RISK:  `${NS}:junctions`,
  WEATHER_STATE:  `${NS}:weather`,
  DRIVER_STRESS:  `${NS}:driver_stress`,
}

// ─── Helpers ──────────────────────────────────────────────────
function readLS(key) {
  try { return JSON.parse(localStorage.getItem(key) || '{}') } catch { return {} }
}
function writeLS(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)) } catch {}
}

// ─── Risk levels ──────────────────────────────────────────────
export const RISK_LEVEL = {
  NONE:     'none',
  LOW:      'low',
  MODERATE: 'moderate',
  HIGH:     'high',
  CRITICAL: 'critical',
}

export function riskLevelFromScore(score) {
  if (score >= 80) return RISK_LEVEL.CRITICAL
  if (score >= 60) return RISK_LEVEL.HIGH
  if (score >= 40) return RISK_LEVEL.MODERATE
  if (score >= 20) return RISK_LEVEL.LOW
  return RISK_LEVEL.NONE
}

export function riskColor(level) {
  const map = {
    [RISK_LEVEL.NONE]:     'text-emerald-400',
    [RISK_LEVEL.LOW]:      'text-cyan-400',
    [RISK_LEVEL.MODERATE]: 'text-yellow-400',
    [RISK_LEVEL.HIGH]:     'text-amber-400',
    [RISK_LEVEL.CRITICAL]: 'text-red-400',
  }
  return map[level] || 'text-slate-400'
}

// ─── Public API ───────────────────────────────────────────────
export const safetyEngine = {

  /**
   * Full route safety analysis.
   * @param {object} route     - normalised route from mapService
   * @param {object} vehicle   - vehicle record
   * @param {object} driver    - driver record
   * @param {object} options   - { scheduledDepartureTs, jobDurationH }
   * @returns {object} SafetyAssessment
   */
  analyseRoute(route, vehicle = {}, driver = {}, options = {}) {
    const risks = []
    let riskScore = 0   // 0-100 (higher = more dangerous)

    // ── 1. Height / Low Bridge ────────────────────────────
    const heightM = parseFloat(vehicle.height_m || 0)
    if (heightM > 0) {
      if (heightM > 4.5) {
        risks.push({ type: 'low_bridge', severity: 'critical',
          msg: `Vehicle height ${heightM}m — extreme low bridge risk. Verify clearance on ALL structures.` })
        riskScore += 35
      } else if (heightM > 3.0) {
        risks.push({ type: 'low_bridge', severity: 'high',
          msg: `Vehicle height ${heightM}m — low bridge routes must be excluded.` })
        riskScore += 20
      }
    }

    // ── 2. Weight / Road Restrictions ────────────────────
    const gvwT = parseFloat(vehicle.gross_weight_t || 0)
    if (gvwT > 7.5) {
      risks.push({ type: 'weight_restriction', severity: 'moderate',
        msg: `${gvwT}t GVW — verify weight limits on all bridges and road types.` })
      riskScore += 8
    }
    if (gvwT > 44) {
      risks.push({ type: 'overweight', severity: 'critical',
        msg: `${gvwT}t exceeds 44t GB legal max — Special Types Order required.` })
      riskScore += 40
    }

    // ── 3. HGV Restrictions (Night / AQMA) ───────────────
    if (vehicle.hgv_restriction_24h) {
      const hour = options.scheduledDepartureTs
        ? new Date(options.scheduledDepartureTs).getHours()
        : new Date().getHours()
      if (hour >= 23 || hour < 6) {
        risks.push({ type: 'night_restriction', severity: 'high',
          msg: 'Night movement restriction applies to this vehicle. Dispatch violates AQMA rules.' })
        riskScore += 25
      }
    }

    // ── 4. Hazmat / ADR ───────────────────────────────────
    if (vehicle.hazmat) {
      if (!vehicle.hazmat_class) {
        risks.push({ type: 'hazmat_incomplete', severity: 'critical',
          msg: 'Vehicle flagged hazmat but ADR class not specified. Route cannot be validated.' })
        riskScore += 30
      }
      if (vehicle.tunnel_category && vehicle.tunnel_category !== '') {
        risks.push({ type: 'tunnel_restriction', severity: 'high',
          msg: `ADR tunnel category ${vehicle.tunnel_category} — tunnels must be verified or avoided.` })
        riskScore += 15
      }
    }

    // ── 5. Driver Fatigue (hours-based) ──────────────────
    const distKm     = (route?.distance || route?.distance_m || 0) / 1000
    const estHours   = (route?.duration || route?.duration_s || 0) / 3600
    const jobDurH    = options.jobDurationH || 0
    const totalHours = estHours + jobDurH

    if (totalHours > 10) {
      risks.push({ type: 'fatigue_hours', severity: 'critical',
        msg: `Estimated ${totalHours.toFixed(1)}h shift exceeds 10h EU driving limit.` })
      riskScore += 30
    } else if (totalHours > 9) {
      risks.push({ type: 'fatigue_hours', severity: 'high',
        msg: `Estimated ${totalHours.toFixed(1)}h — approaching daily driving limit.` })
      riskScore += 15
    } else if (totalHours > 4.5) {
      risks.push({ type: 'break_required', severity: 'moderate',
        msg: 'Driver must take 45-minute break after 4.5 hours — plan rest stop.' })
      riskScore += 8
    }

    // ── 6. Night Driving ──────────────────────────────────
    const deptHour = options.scheduledDepartureTs
      ? new Date(options.scheduledDepartureTs).getHours()
      : new Date().getHours()
    const arrHour = (deptHour + Math.ceil(estHours)) % 24
    if (deptHour >= 22 || deptHour < 5 || arrHour >= 22 || arrHour < 5) {
      risks.push({ type: 'night_driving', severity: 'moderate',
        msg: 'Route involves night driving — increased fatigue and visibility risk.' })
      riskScore += 10
    }

    // ── 7. Very Long Journey ──────────────────────────────
    if (distKm > 500) {
      risks.push({ type: 'long_journey', severity: 'high',
        msg: `${Math.round(distKm)}km route — multiple mandatory rest breaks required.` })
      riskScore += 12
    }

    // ── 8. Historical Dangerous Segments ─────────────────
    if (route?.geometry?.coordinates) {
      let dangerCount = 0
      // Sample every 10th coordinate to avoid excessive LS reads
      const coords = route.geometry.coordinates
      const sample = coords.filter((_, i) => i % 10 === 0).slice(0, 50)
      for (const [lng, lat] of sample) {
        const segs = routeMemory.getDangerousSegmentsNear(lat, lng, 0.015)
        dangerCount += segs.length
      }
      if (dangerCount > 0) {
        risks.push({ type: 'dangerous_segments', severity: dangerCount > 3 ? 'high' : 'moderate',
          msg: `${dangerCount} recorded dangerous segment${dangerCount > 1 ? 's' : ''} near this route.` })
        riskScore += Math.min(20, dangerCount * 5)
      }
    }

    // ── 9. Driver Stress Indicators ─────────────────────
    if (driver?.id) {
      const stressData = this.getDriverStressState(driver.id)

      // Derive a live fatigue score from available session data.
      // Priority: explicit hours_today/session_hours field on driver record
      // → stored stress state (updated by Driver PWA events via Federation OS).
      // Rule: 9h = EU standard daily limit = 100 score. Linear scale, clamped 0-100.
      const sessionH = parseFloat(driver.hours_today ?? driver.session_hours ?? 0)
      const liveFatigueScore = sessionH > 0
        ? Math.min(100, Math.round((sessionH / 9) * 100))
        : (stressData.fatigueScore || 0)

      if (stressData.harshEventRate > 3) {
        risks.push({ type: 'driver_stress', severity: 'moderate',
          msg: `Driver has ${stressData.harshEventRate.toFixed(1)} harsh events/100km this week.` })
        riskScore += 10
      }
      if (liveFatigueScore > 70) {
        risks.push({ type: 'driver_fatigue', severity: 'high',
          msg: `Driver fatigue score is ${liveFatigueScore}/100 — consider reassigning.` })
        riskScore += 20
      } else if (liveFatigueScore > 50) {
        risks.push({ type: 'driver_fatigue', severity: 'moderate',
          msg: `Driver fatigue score is ${liveFatigueScore}/100 — monitor closely.` })
        riskScore += 8
      }
    }

    // ── 10. Vehicle Maintenance State ─────────────────────
    if (vehicle.next_service_date) {
      const daysTo = (new Date(vehicle.next_service_date) - new Date()) / 86400000
      if (daysTo < 0) {
        risks.push({ type: 'service_overdue', severity: 'high',
          msg: `Vehicle service overdue by ${Math.abs(Math.round(daysTo))} days.` })
        riskScore += 20
      } else if (daysTo < 7) {
        risks.push({ type: 'service_soon', severity: 'moderate',
          msg: `Vehicle service due in ${Math.round(daysTo)} days.` })
        riskScore += 8
      }
    }
    if (vehicle.mot_expiry || vehicle.annual_test_due) {
      const testDate  = vehicle.annual_test_due || vehicle.mot_expiry
      const daysToMOT = (new Date(testDate) - new Date()) / 86400000
      if (daysToMOT < 0) {
        risks.push({ type: 'mot_expired', severity: 'critical',
          msg: 'MOT / Annual Test EXPIRED — vehicle must not be driven until tested.' })
        riskScore += 50
      } else if (daysToMOT < 7) {
        risks.push({ type: 'mot_imminent', severity: 'high',
          msg: `MOT / Annual Test due in ${Math.round(daysToMOT)} days.` })
        riskScore += 15
      }
    }

    const clampedScore = Math.min(100, Math.max(0, riskScore))
    return {
      riskScore:  clampedScore,
      riskLevel:  riskLevelFromScore(clampedScore),
      risks,
      safeToDispatch: clampedScore < 40 && !risks.some(r => r.severity === 'critical'),
      criticalCount:  risks.filter(r => r.severity === 'critical').length,
      highCount:      risks.filter(r => r.severity === 'high').length,
    }
  },

  /**
   * Analyse a vehicle record for static compliance safety issues.
   * Does NOT evaluate a specific route.
   */
  analyseVehicle(vehicle) {
    const issues = []
    const now    = Date.now()

    const checkExpiry = (dateStr, label, criticalDays = 0) => {
      if (!dateStr) return
      const daysLeft = (new Date(dateStr) - now) / 86400000
      if (daysLeft < 0) {
        issues.push({ type: 'expired', label, daysLeft: Math.round(daysLeft), severity: 'critical' })
      } else if (daysLeft <= criticalDays) {
        issues.push({ type: 'expiring_soon', label, daysLeft: Math.round(daysLeft), severity: daysLeft < 7 ? 'high' : 'moderate' })
      }
    }

    checkExpiry(vehicle.mot_expiry,               'MOT',                   30)
    checkExpiry(vehicle.annual_test_due,           'Annual Test',           30)
    checkExpiry(vehicle.insurance_expiry,          'Insurance',             30)
    checkExpiry(vehicle.operator_licence_expiry,   'Operator Licence',      60)
    checkExpiry(vehicle.tacho_next_calibration,    'Tacho Calibration',     30)
    checkExpiry(vehicle.driver_cpc_expiry,         'Driver CPC',            60)
    checkExpiry(vehicle.next_service_date,         'Scheduled Service',     14)
    checkExpiry(vehicle.next_safety_inspection,    'Safety Inspection',     7)

    const gvwT = parseFloat(vehicle.gross_weight_t || 0)
    if (gvwT > 3.5 && !vehicle.operator_licence) {
      issues.push({ type: 'missing_doc', label: 'Operator Licence', severity: 'critical' })
    }
    if (gvwT > 3.5 && !vehicle.tacho_fitted) {
      issues.push({ type: 'missing_equipment', label: 'Tachograph Required', severity: 'high' })
    }
    if (vehicle.hazmat && !vehicle.hazmat_class) {
      issues.push({ type: 'incomplete_hazmat', label: 'ADR Class Missing', severity: 'critical' })
    }

    const overallRisk = Math.min(100, issues.reduce((s, i) => {
      return s + (i.severity === 'critical' ? 25 : i.severity === 'high' ? 12 : 5)
    }, 0))

    return {
      issues,
      overallRisk,
      riskLevel:      riskLevelFromScore(overallRisk),
      roadworthy:     !issues.some(i => i.severity === 'critical'),
      criticalCount:  issues.filter(i => i.severity === 'critical').length,
    }
  },

  /**
   * Estimate weather risk (0-100) based on season + time + optional external data.
   * This is a heuristic — no external weather API. Future: inject real data.
   */
  estimateWeatherRisk({ lat = 51.5, month = null, hour = null } = {}) {
    const m = month ?? new Date().getMonth()
    const h = hour  ?? new Date().getHours()
    let risk = 0

    // Winter months
    if ([11, 0, 1].includes(m)) risk += 30       // Dec/Jan/Feb
    else if ([10, 2].includes(m)) risk += 15     // Nov/Mar

    // Rain-heavy months in UK
    if ([9, 10, 11, 0, 1, 2].includes(m)) risk += 10

    // Early morning / night conditions (frost, fog)
    if (h >= 0 && h <= 6) risk += 20
    else if (h >= 20)     risk += 10

    // Northern latitudes have higher winter risk
    if (lat > 54) risk += 10   // Scotland / N England
    else if (lat > 52) risk += 5

    return Math.min(100, risk)
  },

  /**
   * Derive a rule-based fatigue score (0-100) from session hours.
   * Aligns with EU drivers' hours regulations.
   *
   * 0h   → 0   (fresh)
   * 4.5h → 50  (mandatory break threshold — moderate fatigue)
   * 9h   → 100 (EU standard daily limit)
   * >9h  → 100 (capped)
   *
   * @param {number} sessionHours — hours driven/on-duty this shift
   * @returns {{ fatigueScore: number, fatigueRisk: string, breaksNeeded: number }}
   */
  computeFatigueScore(sessionHours = 0) {
    const h = Math.max(0, parseFloat(sessionHours) || 0)
    const fatigueScore = Math.min(100, Math.round((h / 9) * 100))
    const fatigueRisk  = h > 10  ? 'critical'
                       : h > 9   ? 'high'
                       : h > 7   ? 'moderate'
                       : h > 4.5 ? 'low'
                       : 'none'
    return {
      fatigueScore,
      fatigueRisk,
      sessionHours:   Math.round(h * 10) / 10,
      remainingLegalH: Math.max(0, Math.round((9 - h) * 10) / 10),
      breaksNeeded:   Math.floor(h / 4.5),
      euLimitH:       9,
    }
  },

  /**
   * Get or update driver stress state in localStorage.
   */
  getDriverStressState(driverId) {
    const all    = readLS(LS_KEYS.DRIVER_STRESS)
    return all[driverId] || { harshEventRate: 0, fatigueScore: 0, speedingRate: 0, lastUpdated: null }
  },

  updateDriverStressState(driverId, { harshEventRate, fatigueScore, speedingRate }) {
    const all = readLS(LS_KEYS.DRIVER_STRESS)
    all[driverId] = {
      harshEventRate: harshEventRate ?? all[driverId]?.harshEventRate ?? 0,
      fatigueScore:   fatigueScore   ?? all[driverId]?.fatigueScore   ?? 0,
      speedingRate:   speedingRate   ?? all[driverId]?.speedingRate   ?? 0,
      lastUpdated:    Date.now(),
    }
    writeLS(LS_KEYS.DRIVER_STRESS, all)
  },

  /**
   * Generate overall fleet safety KPI summary.
   * Reads from existing safetyService alerts table (read-only).
   */
  getFleetSafetyKPIs(vehicles = [], drivers = []) {
    const vehicleIssues = vehicles.map(v => this.analyseVehicle(v))
    const criticalVehicles = vehicleIssues.filter(a => a.criticalCount > 0).length
    const highRiskVehicles  = vehicleIssues.filter(a => a.riskLevel === RISK_LEVEL.HIGH || a.riskLevel === RISK_LEVEL.CRITICAL).length
    // Average overallRisk across vehicles, then invert to safety score.
    // Clamp to 0-100 — high overallRisk on any single vehicle can push average above 100.
    const avgRisk = vehicleIssues.length > 0
      ? vehicleIssues.reduce((s, a) => s + Math.min(100, a.overallRisk), 0) / vehicleIssues.length
      : 0
    const fleetSafetyScore = vehicleIssues.length > 0
      ? Math.max(0, Math.min(100, Math.round(100 - avgRisk)))
      : 100

    return {
      fleetSafetyScore,
      criticalVehicles,
      highRiskVehicles,
      totalVehiclesAnalysed: vehicles.length,
      riskLevel: riskLevelFromScore(100 - fleetSafetyScore),
    }
  },
}

export default safetyEngine
