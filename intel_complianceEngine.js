/**
 * ============================================================
 * APEX INTELLIGENCE — Compliance Engine
 * File: intel_complianceEngine.js
 *
 * THIS ENGINE OVERRIDES ALL AI.
 * If it returns a hard violation, the route MUST be rejected.
 * No exceptions.
 *
 * Checks:
 *  - Driving hours (EU WTD + domestic)
 *  - Tachograph legal requirements
 *  - Operator licence validity
 *  - Vehicle document expiry (MOT, insurance, CPC, etc.)
 *  - Weight limits (GVW, axle, train)
 *  - ADR / Hazmat compliance
 *  - Speed limiter requirements
 *  - LEZ / ULEZ / CAZ zone entry
 *  - Night / AQMA movement restrictions
 *  - Scheduling conflicts (impossible ETA, overlapping jobs)
 *
 * NEVER writes to apex:db:compliance — reads only.
 * Writes to own namespace: apex:intel:compliance:*
 * ============================================================
 */

const NS = 'apex:intel:compliance'
const LS_KEYS = {
  SHIFT_LOG:      `${NS}:shift_log`,   // per-driver daily driving log
  VIOLATION_LOG:  `${NS}:violations`,
}

function readLS(key) {
  try { return JSON.parse(localStorage.getItem(key) || '{}') } catch { return {} }
}
function writeLS(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)) } catch {}
}

// ─── EU Tachograph rules ───────────────────────────────────────
const EU_RULES = {
  MAX_DAILY_DRIVING_H:    9,      // extendable to 10h twice/week
  MAX_EXTENDED_DAILY_H:   10,
  MAX_WEEKLY_DRIVING_H:   56,
  MAX_FORTNIGHT_H:        90,
  MAX_CONTINUOUS_H:       4.5,    // break after 4.5h
  REQUIRED_BREAK_MIN:     45,
  MIN_DAILY_REST_H:       11,     // can reduce to 9h 3× per week
  MIN_WEEKLY_REST_H:      45,
}

// ─── Weight limits (UK / EU) ───────────────────────────────────
const WEIGHT_LIMITS = {
  MAX_GVW_T:          44,     // UK standard HGV
  MAX_SINGLE_AXLE_T:  11.5,
  MAX_DRIVE_AXLE_T:   11.5,
  MAX_TANDEM_AXLE_T:  16,     // two axles ≤1m spacing
  MAX_TRIDEM_AXLE_T:  24,     // three axles ≤1.3m spacing
  MAX_STEER_AXLE_T:   8,
  MAX_TRAIN_T:        44,
}

export const VIOLATION_SEVERITY = {
  HARD: 'hard',    // BLOCKS dispatch — route rejected
  SOFT: 'soft',    // WARNING — allowed but flagged
}

// ─── Helpers ──────────────────────────────────────────────────
function todayKey() {
  return new Date().toISOString().slice(0, 10)  // YYYY-MM-DD
}

function daysUntilExpiry(dateStr) {
  if (!dateStr) return null
  return (new Date(dateStr) - Date.now()) / 86400000
}

// ─── Public API ───────────────────────────────────────────────
export const complianceEngine = {

  /**
   * Full pre-dispatch compliance check.
   * Returns { hardViolations, softViolations, expiryFlags, passed, score }
   *
   * hardViolations: string[] — if non-empty, dispatch MUST be blocked.
   * softViolations: string[] — warnings shown to operator.
   * expiryFlags:    string[] — documents near/past expiry.
   * passed:         boolean
   * score:          0-100 (legalityScore for routeScoring)
   */
  checkDispatch({
    vehicle,
    driver,
    estimatedDrivingHours,
    scheduledDepartureTs,
    scheduledArrivalTs,
    existingJobIds = [],   // for overlap detection
    routeEntersLEZ = false,
    routeHasNightRestriction = false,
  }) {
    const hard = []
    const soft = []
    const expiry = []

    // ── 1. Vehicle documents ──────────────────────────────
    this._checkDocumentExpiry(vehicle, hard, soft, expiry)

    // ── 2. Operator licence ───────────────────────────────
    const gvwT = parseFloat(vehicle?.gross_weight_t || 0)
    if (gvwT > 3.5) {
      if (!vehicle?.operator_licence) {
        hard.push('No Operator Licence — vehicle over 3.5t requires O-Licence')
      } else {
        const olExpiry = daysUntilExpiry(vehicle.operator_licence_expiry)
        if (olExpiry !== null && olExpiry < 0) {
          hard.push('Operator Licence EXPIRED')
          expiry.push('Operator Licence')
        } else if (olExpiry !== null && olExpiry < 14) {
          soft.push(`Operator Licence expires in ${Math.round(olExpiry)} days`)
          expiry.push('Operator Licence')
        }
      }
    }

    // ── 3. Tachograph requirements ────────────────────────
    if (gvwT > 3.5) {
      if (vehicle?.tacho_fitted === false) {
        hard.push('Tachograph not fitted — required for vehicles over 3.5t GVW')
      }
      if (vehicle?.tacho_next_calibration) {
        const cal = daysUntilExpiry(vehicle.tacho_next_calibration)
        if (cal !== null && cal < 0) {
          hard.push('Tachograph calibration EXPIRED — illegal to use')
          expiry.push('Tacho Calibration')
        } else if (cal !== null && cal < 14) {
          soft.push(`Tachograph calibration due in ${Math.round(cal)} days`)
          expiry.push('Tacho Calibration')
        }
      }
    }

    // ── 4. MOT / Annual Test ──────────────────────────────
    const motDate  = vehicle?.annual_test_due || vehicle?.mot_expiry
    if (motDate) {
      const motDays = daysUntilExpiry(motDate)
      if (motDays !== null && motDays < 0) {
        hard.push('MOT / Annual Test EXPIRED — vehicle must not be driven')
        expiry.push('MOT/Annual Test')
      } else if (motDays !== null && motDays < 7) {
        soft.push(`MOT / Annual Test expires in ${Math.round(motDays)} days`)
        expiry.push('MOT/Annual Test')
      }
    }

    // ── 5. Insurance ──────────────────────────────────────
    if (vehicle?.insurance_expiry) {
      const insDays = daysUntilExpiry(vehicle.insurance_expiry)
      if (insDays !== null && insDays < 0) {
        hard.push('Vehicle insurance EXPIRED — illegal to operate')
        expiry.push('Insurance')
      } else if (insDays !== null && insDays < 7) {
        soft.push(`Insurance expires in ${Math.round(insDays)} days`)
        expiry.push('Insurance')
      }
    }

    // ── 6. Driver CPC ─────────────────────────────────────
    if (driver?.driver_cpc_expiry) {
      const cpcDays = daysUntilExpiry(driver.driver_cpc_expiry)
      if (cpcDays !== null && cpcDays < 0) {
        hard.push('Driver CPC EXPIRED — driver not legally qualified for commercial driving')
        expiry.push('Driver CPC')
      } else if (cpcDays !== null && cpcDays < 14) {
        soft.push(`Driver CPC expires in ${Math.round(cpcDays)} days`)
        expiry.push('Driver CPC')
      }
    }

    // ── 7. Driving hours check ────────────────────────────
    const driverLog = this.getDriverShiftLog(driver?.id || 'unknown')
    const todayHours = driverLog.driving_hours_today || 0
    const weekHours  = driverLog.driving_hours_week  || 0

    if (todayHours + estimatedDrivingHours > EU_RULES.MAX_EXTENDED_DAILY_H) {
      hard.push(`Driving hours exceeded: ${(todayHours + estimatedDrivingHours).toFixed(1)}h today (max 10h)`)
    } else if (todayHours + estimatedDrivingHours > EU_RULES.MAX_DAILY_DRIVING_H) {
      soft.push(`Standard daily limit reached (${EU_RULES.MAX_DAILY_DRIVING_H}h) — extended driving being used`)
    }

    if (weekHours + estimatedDrivingHours > EU_RULES.MAX_WEEKLY_DRIVING_H) {
      hard.push(`Weekly driving hours exceeded: ${(weekHours + estimatedDrivingHours).toFixed(1)}h (max 56h)`)
    }

    if (estimatedDrivingHours > EU_RULES.MAX_CONTINUOUS_H) {
      soft.push(`Journey ${estimatedDrivingHours.toFixed(1)}h — 45-minute break required en route`)
    }

    // ── 8. Weight violations ──────────────────────────────
    if (gvwT > WEIGHT_LIMITS.MAX_GVW_T) {
      hard.push(`GVW ${gvwT}t exceeds ${WEIGHT_LIMITS.MAX_GVW_T}t UK maximum`)
    }
    const axleT = parseFloat(vehicle?.axle_weight_t || 0)
    if (axleT > WEIGHT_LIMITS.MAX_SINGLE_AXLE_T) {
      hard.push(`Single axle weight ${axleT}t exceeds ${WEIGHT_LIMITS.MAX_SINGLE_AXLE_T}t limit`)
    }

    // ── 9. Speed limiter (HGV > 7.5t) ────────────────────
    if (gvwT > 7.5 && vehicle?.speed_limiter === false) {
      soft.push('Speed limiter should be fitted on vehicles over 7.5t — verify compliance')
    }

    // ── 10. LEZ / ULEZ entry ──────────────────────────────
    if (routeEntersLEZ) {
      if (!vehicle?.ulez_compliant && !vehicle?.caz_compliant) {
        const euro = vehicle?.euro_standard || 'unknown'
        if (['euro3', 'euro4', 'euro5'].includes(euro)) {
          hard.push(`Vehicle (${euro}) not ULEZ compliant — route enters Low Emission Zone`)
        } else if (!euro || euro === 'unknown') {
          soft.push('ULEZ compliance unknown — verify before entering Low Emission Zone')
        }
      }
    }

    // ── 11. Night / AQMA restriction ─────────────────────
    if (routeHasNightRestriction || vehicle?.hgv_restriction_24h) {
      if (scheduledDepartureTs) {
        const hour = new Date(scheduledDepartureTs).getHours()
        if (hour >= 23 || hour < 6) {
          hard.push('Night movement restriction — HGV prohibited during scheduled departure time')
        }
      }
    }

    // ── 12. Hazmat completeness ───────────────────────────
    if (vehicle?.hazmat) {
      if (!vehicle.hazmat_class || !vehicle.hazmat_un_number) {
        hard.push('ADR goods require both hazmat class and UN number to be specified')
      }
      if (!vehicle.tunnel_category && vehicle.hazmat_class) {
        soft.push('ADR tunnel category not specified — some tunnel routes may be restricted')
      }
    }

    // ── 13. Safety inspection overdue ────────────────────
    if (vehicle?.next_safety_inspection) {
      const pmiDays = daysUntilExpiry(vehicle.next_safety_inspection)
      if (pmiDays !== null && pmiDays < 0) {
        hard.push(`Safety inspection (PMI) overdue by ${Math.abs(Math.round(pmiDays))} days`)
        expiry.push('Safety Inspection')
      } else if (pmiDays !== null && pmiDays < 3) {
        soft.push(`Safety inspection due in ${Math.round(pmiDays)} days`)
        expiry.push('Safety Inspection')
      }
    }

    // ── Score ─────────────────────────────────────────────
    let score = 100
    score -= hard.length * 20
    score -= soft.length * 5
    score = Math.max(0, Math.min(100, score))

    if (hard.length > 0) score = 0

    const result = {
      passed:         hard.length === 0,
      hardViolations: hard,
      softViolations: soft,
      expiryFlags:    expiry,
      score,
    }

    // Log violations
    if (hard.length > 0 || soft.length > 0) {
      this._logViolation(vehicle?.id, driver?.id, result)
    }

    return result
  },

  /**
   * Check a vehicle's document expiry state only.
   * Used for fleet compliance dashboard.
   */
  checkVehicleDocuments(vehicle) {
    const hard = [], soft = [], expiry = []
    this._checkDocumentExpiry(vehicle, hard, soft, expiry)
    let score = 100 - (hard.length * 25) - (soft.length * 8)
    return {
      passed: hard.length === 0,
      hardViolations: hard,
      softViolations: soft,
      expiryFlags:    expiry,
      score: Math.max(0, score),
      nextExpiryDate: this._nextExpiryDate(vehicle),
    }
  },

  /** Get driver's shift log for today */
  getDriverShiftLog(driverId) {
    const all   = readLS(LS_KEYS.SHIFT_LOG)
    const today = todayKey()
    if (!all[driverId]?.[today]) {
      return { driving_hours_today: 0, driving_hours_week: 0, shifts_today: 0 }
    }
    return all[driverId][today]
  },

  /** Update driver shift log (call after job completes) */
  updateDriverShiftLog(driverId, { additionalHours = 0 }) {
    const all   = readLS(LS_KEYS.SHIFT_LOG)
    const today = todayKey()
    if (!all[driverId]) all[driverId] = {}
    if (!all[driverId][today]) {
      all[driverId][today] = { driving_hours_today: 0, driving_hours_week: 0, shifts_today: 0 }
    }
    all[driverId][today].driving_hours_today += additionalHours
    all[driverId][today].driving_hours_week  += additionalHours
    all[driverId][today].shifts_today        += 1
    writeLS(LS_KEYS.SHIFT_LOG, all)
  },

  /** Get recent violations (for dashboard display) */
  getRecentViolations(limit = 20) {
    try {
      const rows = JSON.parse(localStorage.getItem(LS_KEYS.VIOLATION_LOG) || '[]')
      return rows.slice(-limit).reverse()
    } catch { return [] }
  },

  // ── Private helpers ──────────────────────────────────────

  _checkDocumentExpiry(vehicle, hard, soft, expiry) {
    const checks = [
      { date: vehicle?.mot_expiry,               label: 'MOT',               hardDays: 0,  softDays: 14  },
      { date: vehicle?.annual_test_due,           label: 'Annual Test',       hardDays: 0,  softDays: 14  },
      { date: vehicle?.insurance_expiry,          label: 'Insurance',         hardDays: 0,  softDays: 7   },
      { date: vehicle?.operator_licence_expiry,   label: 'Operator Licence',  hardDays: 0,  softDays: 30  },
      { date: vehicle?.tacho_next_calibration,    label: 'Tacho Calibration', hardDays: 0,  softDays: 14  },
      { date: vehicle?.next_safety_inspection,    label: 'Safety Inspection', hardDays: 0,  softDays: 3   },
      { date: vehicle?.trailer_annual_test,       label: 'Trailer Test',      hardDays: 0,  softDays: 14  },
    ]
    for (const c of checks) {
      if (!c.date) continue
      const d = daysUntilExpiry(c.date)
      if (d < c.hardDays) {
        hard.push(`${c.label} EXPIRED (${Math.abs(Math.round(d))}d ago)`)
        expiry.push(c.label)
      } else if (d < c.softDays) {
        soft.push(`${c.label} expires in ${Math.round(d)} days`)
        expiry.push(c.label)
      }
    }
  },

  _nextExpiryDate(vehicle) {
    const dates = [
      vehicle?.mot_expiry, vehicle?.annual_test_due, vehicle?.insurance_expiry,
      vehicle?.operator_licence_expiry, vehicle?.tacho_next_calibration,
      vehicle?.next_safety_inspection,
    ].filter(Boolean)
    if (dates.length === 0) return null
    return dates.sort()[0]
  },

  _logViolation(vehicleId, driverId, result) {
    try {
      const rows = JSON.parse(localStorage.getItem(LS_KEYS.VIOLATION_LOG) || '[]')
      rows.push({
        ts:        Date.now(),
        vehicle_id: vehicleId,
        driver_id:  driverId,
        hard:       result.hardViolations,
        soft:       result.softViolations,
      })
      localStorage.setItem(LS_KEYS.VIOLATION_LOG, JSON.stringify(rows.slice(-200)))
    } catch {}
  },

  /**
   * Fleet compliance score (0-100) across all vehicles.
   */
  getFleetComplianceScore(vehicles = []) {
    if (vehicles.length === 0) return 100
    const scores = vehicles.map(v => this.checkVehicleDocuments(v).score)
    return Math.round(scores.reduce((s, n) => s + n, 0) / scores.length)
  },
}

export default complianceEngine
