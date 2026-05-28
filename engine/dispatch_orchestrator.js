/**
 * ============================================================
 * AP3X FLEET INTELLIGENCE — Dispatch Orchestrator
 * engine/dispatch_orchestrator.js
 *
 * CORE FLOW CONTROLLER — two strict modes:
 *
 *   MODE 1: SUGGESTION MODE (advisory, read-only)
 *     Triggered by: task creation (status=pending) or dispatcher opens panel
 *     Does NOT write to Supabase.
 *     Returns top-3 ranked drivers with scores + ETA.
 *
 *   MODE 2: CONFIRMED DISPATCH MODE (write path)
 *     Triggered by: dispatcher clicks "CONFIRM ASSIGNMENT"
 *     Writes: tasks.assigned_driver, job_assignments, tasks.status='assigned'
 *     Emits:  dashboard_events TASK_DISPATCHED
 *
 * HARD AUTHORITY RULE:
 *   The UI dispatcher always has final say.
 *   Engine NEVER auto-assigns. It ONLY acts after explicit confirmation.
 *   Dispatcher CAN override any suggestion — override is logged.
 *
 * CONTRACT: Supabase is SSOT. No schema changes. No new tables.
 *           Uses ONLY: tasks · drivers · job_assignments · driver_locations · dashboard_events
 * ============================================================
 */

import { rulesEngine }   from './rules_engine'
import { scoringEngine } from './scoring_engine'
import { routingEngine } from './routing_engine'
import {
  getDrivers, getTasks, getDriverLocations,
  assignTask, logDashboardEvent,
  isLiveMode,
} from '../services_backend_backendService'

// ─── Suggestion result shape ──────────────────────────────────
/**
 * SuggestionResult {
 *   task_id:          string
 *   task_valid:       boolean
 *   task_failures:    string[]
 *   task_warnings:    string[]
 *   candidates:       EnrichedCandidate[]   top 3 max
 *   skipped_drivers:  number                eligible drivers not in top 3
 *   total_drivers:    number
 *   computed_at:      string                ISO timestamp
 *   mode:             'suggestion'
 * }
 *
 * EnrichedCandidate {
 *   rank:             number                1-3
 *   driver_id:        string
 *   driver:           object                full driver row
 *   score:            number                0-100
 *   factors:          object                per-factor breakdown
 *   explanation:      string[]
 *   rules: {
 *     pass:           boolean
 *     failures:       string[]
 *     warnings:       string[]
 *   }
 *   route: {
 *     distance_km:    number | null
 *     eta_minutes:    number | null
 *     confidence:     string
 *     error:          string | null
 *   }
 *   location:         { lat, lng } | null
 * }
 */

/**
 * MODE 1: suggest(taskId)
 *
 * Fetches task + all drivers + locations from Supabase.
 * Runs: validateTask → rulesEngine → scoringEngine → routingEngine (top 3).
 * Returns SuggestionResult.
 * NO WRITES to Supabase.
 */
export async function suggest(taskId) {
  const startMs = Date.now()

  // ── 1. Fetch data from Supabase ────────────────────────────
  let allTasks, allDrivers, driverLocations

  try {
    ;[allTasks, allDrivers, driverLocations] = await Promise.all([
      getTasks(),
      getDrivers(),
      getDriverLocations(),
    ])
  } catch (e) {
    console.error('[Orchestrator] Data fetch failed:', e)
    return {
      task_id:       taskId,
      task_valid:    false,
      task_failures: [`Data fetch failed: ${e.message}`],
      task_warnings: [],
      candidates:    [],
      skipped_drivers: 0,
      total_drivers: 0,
      computed_at:   new Date().toISOString(),
      mode:          'suggestion',
    }
  }

  const task = allTasks.find(t => t.id === taskId)
  if (!task) {
    return {
      task_id:       taskId,
      task_valid:    false,
      task_failures: [`Task ${taskId} not found`],
      task_warnings: [],
      candidates:    [],
      skipped_drivers: 0,
      total_drivers: 0,
      computed_at:   new Date().toISOString(),
      mode:          'suggestion',
    }
  }

  // ── 2. Validate task itself ────────────────────────────────
  const taskValidation = rulesEngine.validateTask(task)

  // ── 3. Run Rules Engine — filter eligible drivers ─────────
  const eligibleDrivers = []
  const ineligibleReasons = []

  for (const driver of allDrivers) {
    const check = rulesEngine.validate(task, driver, null, allTasks)
    if (check.pass) {
      eligibleDrivers.push({ driver, rules: check })
    } else {
      ineligibleReasons.push({ driver_id: driver.id, reasons: check.failures })
    }
  }

  // ── 4. Score eligible drivers ──────────────────────────────
  const scored = scoringEngine.scoreDrivers(
    task,
    eligibleDrivers.map(e => e.driver),
    driverLocations,
    allTasks
  ).map(sd => {
    const ruleEntry = eligibleDrivers.find(e => e.driver.id === sd.driver_id)
    return { ...sd, rules: ruleEntry?.rules || { pass: true, failures: [], warnings: [] } }
  })

  // Top 3 only for routing (avoid excessive API calls)
  const top3 = scored.slice(0, 3)

  // ── 5. Calculate routes for top 3 ─────────────────────────
  const withRoutes = await routingEngine.calculateRoutesForCandidates(
    task, top3, driverLocations, null, 3
  )

  // ── 6. Merge warnings from rules into candidates ──────────
  const candidates = withRoutes.map(sd => ({
    rank:        sd.rank,
    driver_id:   sd.driver_id,
    driver:      sd.driver,
    score:       sd.score,
    factors:     sd.factors,
    explanation: sd.explanation,
    rules:       sd.rules,
    route:       sd.route || { distance_km: null, eta_minutes: null, confidence: 'estimated', error: 'No route data' },
    location:    sd.location,
  }))

  const elapsed = Date.now() - startMs
  console.info(`[Orchestrator] Suggestion computed in ${elapsed}ms — ${candidates.length} candidates from ${allDrivers.length} drivers`)

  return {
    task_id:         taskId,
    task:            task,
    task_valid:      taskValidation.pass,
    task_failures:   taskValidation.failures,
    task_warnings:   taskValidation.warnings,
    candidates,
    ineligible:      ineligibleReasons,
    skipped_drivers: Math.max(0, scored.length - 3),
    total_drivers:   allDrivers.length,
    eligible_count:  eligibleDrivers.length,
    computed_at:     new Date().toISOString(),
    elapsed_ms:      elapsed,
    mode:            'suggestion',
  }
}

/**
 * MODE 2: confirmDispatch(taskId, driverId, vehicleId?, overrideReason?)
 *
 * Called ONLY when dispatcher clicks "CONFIRM ASSIGNMENT".
 * Writes to Supabase:
 *   1. tasks.assigned_driver + tasks.status = 'assigned'
 *   2. job_assignments INSERT
 *   3. dashboard_events: TASK_DISPATCHED
 *
 * overrideReason: if dispatcher picked a driver NOT in top-3 suggestions,
 *   pass the reason string. This is logged in dashboard_events.
 */
export async function confirmDispatch(taskId, driverId, vehicleId = null, overrideReason = null) {
  if (!taskId || !driverId) {
    return { ok: false, error: 'taskId and driverId are required' }
  }

  // Fetch minimal data to fill in names for job_assignments
  let driverName  = ''
  let vehicleReg  = ''

  try {
    const drivers = await getDrivers()
    const driver  = drivers.find(d => d.id === driverId)
    driverName    = driver?.full_name || driver?.name || ''

    if (vehicleId) {
      // Vehicles already in Zustand cache via fleetService — fetch fresh if needed
      const { getVehicles } = await import('../services_backend_backendService')
      const vehicles = await getVehicles()
      const vehicle  = vehicles.find(v => v.id === vehicleId)
      vehicleReg     = vehicle?.reg_number || ''
    }
  } catch (e) {
    console.warn('[Orchestrator] Could not enrich dispatch names:', e.message)
  }

  try {
    const result = await assignTask(taskId, driverId, vehicleId, driverName, vehicleReg)

    if (!result.ok && !result.duplicate) {
      return { ok: false, error: result.error }
    }

    // Log to dashboard_events
    await logDashboardEvent('TASK_DISPATCHED', {
      task_id:         taskId,
      driver_id:       driverId,
      driver_name:     driverName,
      vehicle_id:      vehicleId  || null,
      vehicle_reg:     vehicleReg || null,
      override:        !!overrideReason,
      override_reason: overrideReason || null,
      dispatched_at:   new Date().toISOString(),
      source:          'fleet_intelligence_engine',
    })

    console.info('[Orchestrator] Dispatch confirmed:', taskId, '→', driverId, overrideReason ? `(OVERRIDE: ${overrideReason})` : '')

    return { ok: true, data: result.data }
  } catch (e) {
    console.error('[Orchestrator] confirmDispatch failed:', e)
    return { ok: false, error: e.message }
  }
}

/**
 * logOverride(taskId, suggestedDriverId, selectedDriverId, reason)
 *
 * Called when dispatcher picks a driver OUTSIDE the top-3 suggestions.
 * Writes to dashboard_events — does NOT block the dispatch flow.
 */
export async function logOverride(taskId, suggestedDriverIds = [], selectedDriverId, reason = '') {
  await logDashboardEvent('DISPATCHER_OVERRIDE', {
    task_id:             taskId,
    suggested_driver_ids: suggestedDriverIds,
    selected_driver_id:  selectedDriverId,
    reason:              reason || 'No reason provided',
    overridden_at:       new Date().toISOString(),
  }).catch(() => {})
}

export const dispatchOrchestrator = { suggest, confirmDispatch, logOverride }
export default dispatchOrchestrator
