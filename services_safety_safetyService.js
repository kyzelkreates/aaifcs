/**
 * APEX AI — Safety Service (Local DB)
 * No Supabase dependency.
 */

import { table, subscribe, DB_KEYS } from './services_local_localDB'
import { useAppStore } from './core_storage'

const alertTable = table('apex:db:safety_alerts')

export const ALERT_SEVERITY  = { LOW: 'low', MEDIUM: 'medium', HIGH: 'high', CRITICAL: 'critical' }

export const SEVERITY_COLORS = {
  low:      'muted',
  medium:   'amber',
  high:     'red',
  critical: 'red',
}

export const ALERT_TYPE      = {
  SPEEDING:      'speeding',
  HARSH_BRAKE:   'harsh_braking',
  HARSH_ACCEL:   'harsh_acceleration',
  FATIGUE:       'fatigue',
  GEOFENCE:      'geofence_breach',
  MAINTENANCE:   'maintenance_due',
  LICENCE:       'licence_expiry',
  CUSTOM:        'custom',
}

export const safetyService = {

  fetchAlerts(filters = {}) {
    let rows = alertTable.list()
    if (filters.severity)   rows = rows.filter(a => a.severity   === filters.severity)
    if (filters.type)       rows = rows.filter(a => a.type       === filters.type)
    if (filters.vehicle_id) rows = rows.filter(a => a.vehicle_id === filters.vehicle_id)
    if (filters.driver_id)  rows = rows.filter(a => a.driver_id  === filters.driver_id)
    if (filters.resolved === false) rows = rows.filter(a => !a.resolved)
    return rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 100)
  },

  createAlert(payload) {
    const alert = alertTable.create(payload)
    useAppStore.getState().addAlert(alert)
    return alert
  },

  resolveAlert(id) {
    return alertTable.update(id, { resolved: true, resolved_at: new Date().toISOString() })
  },

  deleteAlert(id) {
    alertTable.delete(id)
  },

  // Evaluate a telemetry packet and auto-generate alerts.
  // Rule-based only — no AI calls. Reads from telemetry payload fields.
  evaluateTelemetry(telemetry) {
    const alerts = []

    // ── Speeding ────────────────────────────────────────────
    if (telemetry.speed != null && telemetry.speed > 90) {
      alerts.push(this.createAlert({
        type:        ALERT_TYPE.SPEEDING,
        severity:    telemetry.speed > 110 ? ALERT_SEVERITY.CRITICAL : ALERT_SEVERITY.HIGH,
        driver_id:   telemetry.driver_id,
        vehicle_id:  telemetry.vehicle_id,
        driver_name: telemetry.driver_name,
        vehicle_reg: telemetry.vehicle_reg,
        description: `Speed alert: ${telemetry.speed} km/h`,
        resolved:    false,
      }))
    }

    // ── Low fuel ────────────────────────────────────────────
    if (telemetry.fuel != null && telemetry.fuel < 10) {
      alerts.push(this.createAlert({
        type:        ALERT_TYPE.MAINTENANCE,
        severity:    ALERT_SEVERITY.MEDIUM,
        driver_id:   telemetry.driver_id,
        vehicle_id:  telemetry.vehicle_id,
        driver_name: telemetry.driver_name,
        vehicle_reg: telemetry.vehicle_reg,
        description: `Low fuel: ${telemetry.fuel}%`,
        resolved:    false,
      }))
    }

    // ── Fatigue (rule-based) ─────────────────────────────────
    // Triggered when telemetry payload carries fatigue_score or session_hours.
    // Fleet OS reads this — does NOT write source data; fatigue_score comes
    // from the Driver PWA via Federation OS sync payload (syncPayload.js).
    const fatigueScore  = telemetry.fatigue_score  ?? null
    const sessionHours  = telemetry.session_hours  ?? null

    // Derive score from session_hours if explicit score not present
    const derivedScore = fatigueScore != null
      ? fatigueScore
      : sessionHours != null
        ? Math.min(100, Math.round((parseFloat(sessionHours) / 9) * 100))
        : null

    if (derivedScore != null && derivedScore > 70) {
      alerts.push(this.createAlert({
        type:        ALERT_TYPE.FATIGUE,
        severity:    derivedScore > 85 ? ALERT_SEVERITY.CRITICAL : ALERT_SEVERITY.HIGH,
        driver_id:   telemetry.driver_id,
        vehicle_id:  telemetry.vehicle_id,
        driver_name: telemetry.driver_name,
        vehicle_reg: telemetry.vehicle_reg,
        description: `Fatigue alert: score ${derivedScore}/100${sessionHours != null ? ` (${parseFloat(sessionHours).toFixed(1)}h session)` : ''}`,
        resolved:    false,
      }))
    }

    return alerts
  },

  subscribeToAlerts(callback) {
    return subscribe('apex:db:safety_alerts', () => callback())
  },
}

export default safetyService
