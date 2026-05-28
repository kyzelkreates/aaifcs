/**
 * ============================================================
 * AP3X — Dispatch Service  (Fleet Control OS)
 * services/dispatch/dispatchService.js
 *
 * CONTRACT (LOCKED):
 *   - Supabase is the ONLY source of truth
 *   - No local state overrides backend
 *   - Tables: tasks · job_assignments · drivers · vehicles
 *   - Realtime subscriptions: tasks · job_assignments
 *   - Dispatcher role only: create tasks, assign tasks, monitor
 *
 * Task lifecycle:
 *   pending → assigned → accepted → in_progress → completed → cancelled
 * ============================================================
 */

import {
  createTask, getTasks, updateTask, assignTask,
  subscribeToTasks, subscribeToJobAssignments,
  getJobAssignments, isLiveMode,
} from './services_backend_backendService'
import { jobTable, subscribe as localSubscribe, DB_KEYS } from './services_local_localDB'

// ─── Task status constants (contract-locked) ──────────────────
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

  // ─── READ ──────────────────────────────────────────────────

  /**
   * Fetch tasks from Supabase.
   * Optional filters: { status, assigned_driver }
   */
  async fetchJobs(filters = {}) {
    return getTasks(filters)
  },

  getJob(id) {
    // Local read only (for optimistic UI in offline mode)
    return jobTable.get?.(id) || null
  },

  // ─── CREATE ────────────────────────────────────────────────

  /**
   * Create a new task.
   * Inserts into `tasks` with status = 'pending'.
   * If driver/vehicle provided at creation time, also calls assignTask.
   * Supabase Realtime fires → Driver PWA receives it.
   */
  async createJob(payload) {
    const result = await createTask({
      title:           payload.title,
      description:     payload.description    || null,
      priority:        payload.priority       || JOB_PRIORITY.NORMAL,
      stops:           payload.stops          || null,
      waypoints:       payload.waypoints      || null,
      pickup_address:  payload.pickup_address || payload.origin       || null,
      dropoff_address: payload.dropoff_address || payload.destination || null,
      vehicle_id:      payload.vehicle_id     || null,
      vehicle_reg:     payload.vehicle_reg    || null,
    })

    if (!result.ok) {
      console.error('[AP3X:Dispatch] createJob failed:', result.error)
      // Offline fallback — local only until reconnection
      if (!isLiveMode()) {
        return jobTable.create({
          ...payload,
          status:     JOB_STATUS.PENDING,
          created_at: new Date().toISOString(),
        })
      }
      throw new Error(result.error)
    }

    // If already assigned at creation time, wire the assignment
    if (payload.assigned_driver || payload.driver_id) {
      const driverId  = payload.assigned_driver || payload.driver_id
      const vehicleId = payload.vehicle_id || null
      const driverName = payload.assigned_driver_name || payload.driver_name || ''
      const vehicleReg = payload.vehicle_reg || ''
      await assignTask(result.data.id, driverId, vehicleId, driverName, vehicleReg)
    }

    return result.data
  },

  // ─── ASSIGN ────────────────────────────────────────────────

  /**
   * Assign an existing task to a driver.
   * Writes to job_assignments + updates tasks.
   * Supabase Realtime propagates to Driver PWA immediately.
   */
  async assignJob(taskId, driverId, vehicleId, driverName, vehicleReg) {
    const result = await assignTask(taskId, driverId, vehicleId, driverName, vehicleReg)
    if (!result.ok && !result.duplicate) throw new Error(result.error)
    return result.data
  },

  // ─── LIFECYCLE UPDATES ─────────────────────────────────────
  // All status transitions go through updateTask → Supabase.
  // Backend state is always the authority.

  async updateJob(taskId, patch) {
    const result = await updateTask(taskId, patch)
    if (!result.ok) throw new Error(result.error)
    return result.data
  },

  async completeJob(taskId, notes = '') {
    return this.updateJob(taskId, {
      status:           JOB_STATUS.COMPLETED,
      completed_at:     new Date().toISOString(),
      completion_notes: notes || null,
    })
  },

  async cancelJob(taskId, reason = '') {
    return this.updateJob(taskId, {
      status:        JOB_STATUS.CANCELLED,
      cancel_reason: reason || null,
      cancelled_at:  new Date().toISOString(),
    })
  },

  async startJob(taskId) {
    return this.updateJob(taskId, {
      status:     JOB_STATUS.IN_PROGRESS,
      started_at: new Date().toISOString(),
    })
  },

  deleteJob(taskId) {
    // Soft delete — mark cancelled rather than hard delete
    return this.cancelJob(taskId, 'Deleted by dispatcher')
  },

  // ─── SUBSCRIPTIONS ─────────────────────────────────────────

  /**
   * Subscribe to all task changes (fleet dispatch view).
   * Fires callback with latest tasks array on any change.
   */
  subscribeToJobs(callback) {
    return subscribeToTasks(callback)
  },

  /**
   * Subscribe to job_assignment changes (dispatcher audit view).
   * Fires callback with latest assignments array on any change.
   */
  subscribeToAssignments(callback) {
    return subscribeToJobAssignments(callback)
  },

  /**
   * Subscribe to tasks for a specific driver (Driver PWA use).
   * Filtered subscription — only fires for that driver's tasks.
   */
  subscribeToDriverJobs(driverId, callback) {
    return subscribeToTasks(callback, driverId)
  },

  // ─── JOB ASSIGNMENTS (audit log) ───────────────────────────

  async getAssignmentsForTask(taskId) {
    return getJobAssignments(taskId)
  },
}

export default dispatchService
