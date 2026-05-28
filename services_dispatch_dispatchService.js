/**
 * ============================================================
 * AP3X — Dispatch Service  (Fleet Control OS)
 *
 * CONTRACT (LOCKED):
 *   - Supabase is the ONLY source of truth
 *   - No local state overrides backend
 *   - Tables: tasks · job_assignments · drivers · vehicles
 *             fleet_nodes · dashboard_events
 *   - Realtime: tasks · job_assignments · fleet_nodes
 *   - Dispatcher role only: create, assign, monitor
 *
 * Task lifecycle (strict — no reinterpretation):
 *   pending → assigned → accepted → in_progress → completed → cancelled
 * ============================================================
 */

import {
  createTask, getTasks, updateTask, assignTask,
  subscribeToTasks, subscribeToJobAssignments, subscribeToFleetNodes,
  getJobAssignments, logDashboardEvent, isLiveMode,
} from './services_backend_backendService'
import { jobTable } from './services_local_localDB'

// ─── Contract-locked status constants ────────────────────────
export const JOB_STATUS = {
  PENDING:     'pending',
  ASSIGNED:    'assigned',
  ACCEPTED:    'accepted',
  IN_PROGRESS: 'in_progress',
  COMPLETED:   'completed',
  CANCELLED:   'cancelled',
}

export const JOB_PRIORITY = { LOW: 'low', NORMAL: 'normal', HIGH: 'high', URGENT: 'urgent' }

export const STATUS_COLORS = {
  pending:     'muted',
  assigned:    'cyan',
  accepted:    'violet',
  in_progress: 'amber',
  completed:   'emerald',
  cancelled:   'red',
}

export const PRIORITY_COLORS = {
  low: 'muted', normal: 'cyan', high: 'amber', urgent: 'red',
}

// ═══════════════════════════════════════════════════════════════
// DISPATCH SERVICE
// ═══════════════════════════════════════════════════════════════

export const dispatchService = {

  // ─── READ ─────────────────────────────────────────────────

  async fetchJobs(filters = {}) {
    return getTasks(filters)
  },

  getJob(id) {
    return jobTable.get?.(id) || null
  },

  // ─── CREATE ───────────────────────────────────────────────

  /**
   * Step 0 of dispatch flow.
   * Inserts into tasks (status = 'pending') via Supabase.
   * Supabase Realtime → Driver PWA instantly.
   */
  async createJob(payload) {
    const result = await createTask({
      title:           payload.title,
      description:     payload.description     || null,
      priority:        payload.priority        || JOB_PRIORITY.NORMAL,
      stops:           payload.stops           || null,
      waypoints:       payload.waypoints       || null,
      pickup_address:  payload.pickup_address  || payload.origin      || null,
      dropoff_address: payload.dropoff_address || payload.destination || null,
      vehicle_id:      payload.vehicle_id      || null,
      vehicle_reg:     payload.vehicle_reg     || null,
    })

    if (!result.ok) {
      if (!isLiveMode()) {
        return jobTable.create({ ...payload, status: JOB_STATUS.PENDING, created_at: new Date().toISOString() })
      }
      throw new Error(result.error)
    }

    logDashboardEvent('task_created', {
      task_id: result.data.id, title: result.data.title, priority: result.data.priority,
    }).catch(() => {})

    // If driver was supplied at creation time, assign immediately
    if (payload.assigned_driver || payload.driver_id) {
      await assignTask(
        result.data.id,
        payload.assigned_driver || payload.driver_id,
        payload.vehicle_id  || null,
        payload.assigned_driver_name || payload.driver_name || '',
        payload.vehicle_reg || '',
      )
    }

    return result.data
  },

  // ─── ASSIGN  (dispatch flow step 1) ──────────────────────

  /**
   * Assigns task → writes job_assignments + tasks.assigned_driver.
   * tasks.status → 'assigned'.
   * Supabase Realtime → Driver PWA within ~200 ms.
   */
  async assignJob(taskId, driverId, vehicleId, driverName, vehicleReg) {
    const result = await assignTask(taskId, driverId, vehicleId || null, driverName || '', vehicleReg || '')
    if (!result.ok && !result.duplicate) throw new Error(result.error)

    logDashboardEvent('task_assigned', {
      task_id: taskId, driver_id: driverId, driver_name: driverName,
    }).catch(() => {})

    return result.data
  },

  // ─── LIFECYCLE UPDATES ────────────────────────────────────

  async updateJob(taskId, patch) {
    const result = await updateTask(taskId, patch)
    if (!result.ok) throw new Error(result.error)
    return result.data
  },

  async completeJob(taskId, notes = '') {
    const data = await this.updateJob(taskId, {
      status:           JOB_STATUS.COMPLETED,
      completed_at:     new Date().toISOString(),
      completion_notes: notes || null,
    })
    logDashboardEvent('task_completed', { task_id: taskId }).catch(() => {})
    return data
  },

  async cancelJob(taskId, reason = '') {
    const data = await this.updateJob(taskId, {
      status:        JOB_STATUS.CANCELLED,
      cancel_reason: reason || null,
      cancelled_at:  new Date().toISOString(),
    })
    logDashboardEvent('task_cancelled', { task_id: taskId, reason }).catch(() => {})
    return data
  },

  async startJob(taskId) {
    return this.updateJob(taskId, { status: JOB_STATUS.IN_PROGRESS, started_at: new Date().toISOString() })
  },

  deleteJob(taskId) {
    return this.cancelJob(taskId, 'Deleted by dispatcher')
  },

  // ─── SUBSCRIPTIONS ───────────────────────────────────────
  // Contract: tasks · job_assignments · fleet_nodes

  subscribeToJobs(callback) {
    return subscribeToTasks(callback)
  },

  subscribeToAssignments(callback) {
    return subscribeToJobAssignments(callback)
  },

  /** Contract: realtime on fleet_nodes */
  subscribeToFleet(callback) {
    return subscribeToFleetNodes(callback)
  },

  subscribeToDriverJobs(driverId, callback) {
    return subscribeToTasks(callback, driverId)
  },

  async getAssignmentsForTask(taskId) {
    return getJobAssignments(taskId)
  },
}

export default dispatchService
