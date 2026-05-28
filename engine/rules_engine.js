/**
 * ============================================================
 * AP3X FLEET INTELLIGENCE — Rules Engine
 * engine/rules_engine.js
 *
 * PURE deterministic safety + legality validation layer.
 * No AI, no external APIs, no side effects, no Supabase writes.
 *
 * INPUT:  task · driver · vehicle? · allActiveTasks[]
 * OUTPUT: { pass: bool, failures: string[], warnings: string[] }
 *
 * HARD RULES (fail = driver is ineligible):
 *   R1 — Driver must be online
 *   R2 — Driver must have no active task (max 1 in MVP)
 *   R3 — Task must have a title and pickup address
 *   R4 — Task must be in 'pending' status
 *   R5 — Vehicle must not be under maintenance (if provided)
 *
 * SOFT RULES (warn = flag to dispatcher, don't block):
 *   W1 — Urgent task + driver is on_break
 *   W2 — High-priority task + driver has no GPS location
 *   W3 — Task has no dropoff address (open-ended route)
 *   W4 — Vehicle fuel level below 15% (if known)
 *   W5 — Driver's current_task has been running > 8h
 * ============================================================
 */

// ─── Status constants (mirrors task lifecycle) ────────────────
const ACTIVE_TASK_STATUSES = new Set(['assigned', 'accepted', 'in_progress'])

const DRIVER_ONLINE_STATUSES = new Set([
  'online', 'active', 'idle', 'on_break',
  // localDB variants
  'available',
])

const DRIVER_UNAVAILABLE_STATUSES = new Set([
  'offline', 'suspended', 'inactive', 'driving', 'in_use',
])

const VEHICLE_BLOCKED_STATUSES = new Set([
  'maintenance', 'decommissioned',
])

/**
 * validate(task, driver, vehicle?, allActiveTasks[])
 *
 * allActiveTasks: all tasks currently active in the system
 *   (used to compute driver workload — no extra Supabase call needed,
 *    caller passes the already-fetched task list)
 */
export function validate(task, driver, vehicle = null, allActiveTasks = []) {
  const failures  = []
  const warnings  = []

  // ── R1: Driver online ───────────────────────────────────────
  const driverStatus = (driver.status || '').toLowerCase()
  const isOnline     = DRIVER_ONLINE_STATUSES.has(driverStatus)
  const isBlocked    = DRIVER_UNAVAILABLE_STATUSES.has(driverStatus)

  if (isBlocked) {
    failures.push(`Driver is ${driver.status || 'unavailable'} — not eligible for dispatch`)
  } else if (!isOnline) {
    failures.push(`Driver status '${driver.status}' is unknown — confirm availability`)
  }

  // ── R2: Driver workload (max 1 active task in MVP) ──────────
  const driverActiveTasks = allActiveTasks.filter(t =>
    ACTIVE_TASK_STATUSES.has(t.status) &&
    t.assigned_driver === driver.id
  )
  if (driverActiveTasks.length >= 1) {
    const activeTask = driverActiveTasks[0]
    failures.push(
      `Driver already has an active task: "${activeTask.title || activeTask.id}" (${activeTask.status})`
    )
  }

  // ── R3: Task data completeness ──────────────────────────────
  if (!task.title || !task.title.trim()) {
    failures.push('Task is missing a title')
  }
  if (!task.pickup_address && !task.origin) {
    failures.push('Task has no pickup address — dispatcher must add one before dispatching')
  }

  // ── R4: Task status must be pending ──────────────────────────
  if (task.status && task.status !== 'pending') {
    failures.push(
      `Task status is '${task.status}' — only 'pending' tasks can be dispatched`
    )
  }

  // ── R5: Vehicle must not be blocked ──────────────────────────
  if (vehicle) {
    const vStatus = (vehicle.status || '').toLowerCase()
    if (VEHICLE_BLOCKED_STATUSES.has(vStatus)) {
      failures.push(
        `Vehicle ${vehicle.reg_number || vehicle.id} is '${vehicle.status}' — not available for dispatch`
      )
    }
  }

  // ── W1: Urgent task + driver on break ────────────────────────
  if (task.priority === 'urgent' && driverStatus === 'on_break') {
    warnings.push('Urgent task — driver is currently on break (confirm they can respond)')
  }

  // ── W2: High-priority + no GPS ──────────────────────────────
  if ((task.priority === 'high' || task.priority === 'urgent') && !driver.lat && !driver.lng) {
    warnings.push('No GPS location recorded for driver — ETA estimate will be approximate')
  }

  // ── W3: No dropoff address ────────────────────────────────────
  if (!task.dropoff_address && !task.destination) {
    warnings.push('Task has no dropoff address — route may be incomplete')
  }

  // ── W4: Low vehicle fuel ─────────────────────────────────────
  if (vehicle && typeof vehicle.fuel_level === 'number' && vehicle.fuel_level < 15) {
    warnings.push(
      `Vehicle fuel is low (${vehicle.fuel_level}%) — driver should refuel before departure`
    )
  }

  // ── W5: Long-running current task ────────────────────────────
  if (driver.current_task_started_at) {
    const hoursRunning =
      (Date.now() - new Date(driver.current_task_started_at).getTime()) / 3_600_000
    if (hoursRunning > 8) {
      warnings.push(`Driver has been on their current task for ${hoursRunning.toFixed(1)}h`)
    }
  }

  return {
    pass:     failures.length === 0,
    failures,
    warnings,
  }
}

/**
 * validateTask(task)
 * Validates the task itself — independent of any specific driver.
 * Used by the orchestrator before even fetching candidates.
 */
export function validateTask(task) {
  const failures = []
  const warnings = []

  if (!task.title?.trim())                        failures.push('Task has no title')
  if (!task.pickup_address && !task.origin)       failures.push('Task has no pickup address')
  if (!task.id)                                   failures.push('Task has no ID')
  if (task.status && task.status !== 'pending')   failures.push(`Task is already '${task.status}'`)
  if (!task.dropoff_address && !task.destination) warnings.push('No dropoff address specified')
  if (!task.priority)                             warnings.push('No priority level set — defaulting to normal')

  return { pass: failures.length === 0, failures, warnings }
}

export const rulesEngine = { validate, validateTask }
export default rulesEngine
