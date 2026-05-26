/**
 * ============================================================
 * AP3X — Dispatch Service
 * services/dispatch/dispatchService.js
 *
 * - Routes ALL job operations through backendService (SSOT)
 * - Live mode  → Supabase realtime sync
 * - Local mode → localStorage via localDB
 * - Preserves existing API surface for Dispatch page components
 * ============================================================
 */

import { jobTable, subscribe, DB_KEYS } from './services_local_localDB'
import {
  getTasks, updateTask, assignJobToDriver as backendAssignJob,
  subscribeToTasks, isLiveMode,
} from './services_backend_backendService'
import { getSupabaseSettings } from './services_supabase_supabaseClient'

// ─── Re-export status constants (consumed by many components) ─
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
  low:    'muted',
  normal: 'cyan',
  high:   'amber',
  urgent: 'red',
}

// ─── Internal mode check ─────────────────────────────────────
function _liveMode() {
  const s = getSupabaseSettings()
  return s.enabled && !!s.url && !!s.anonKey
}

// ─── Dispatch service ─────────────────────────────────────────
export const dispatchService = {

  /**
   * Fetch jobs — live or local.
   * Returns a Promise in live mode, array in local mode.
   */
  async fetchJobs(filters = {}) {
    if (_liveMode()) {
      const filter = {}
      if (filters.status)    filter.status = filters.status
      if (filters.driver_id) filter.assigned_driver = filters.driver_id
      return await getTasks(filter)
    }

    let rows = jobTable.list()
    if (filters.status)    rows = rows.filter(j => j.status    === filters.status)
    if (filters.driver_id) rows = rows.filter(j => j.driver_id === filters.driver_id)
    if (filters.priority)  rows = rows.filter(j => j.priority  === filters.priority)
    return rows
  },

  getJob(id) {
    return jobTable.get(id)
  },

  createJob(payload) {
    // Always create locally first (optimistic); sync layer handles Supabase write
    return jobTable.create({
      status:     JOB_STATUS.PENDING,
      priority:   JOB_PRIORITY.NORMAL,
      created_at: new Date().toISOString(),
      ...payload,
    })
  },

  async updateJob(id, payload) {
    if (_liveMode()) {
      const result = await updateTask(id, payload)
      if (!result.ok) throw new Error(result.error)
      return result.data
    }
    return jobTable.update(id, payload)
  },

  /**
   * CRITICAL: Assign job to driver.
   * In live mode — writes to Supabase tasks table.
   * Supabase realtime then pushes the change to Driver PWA instantly.
   */
  async assignJob(jobId, driverId, vehicleId, driverName, vehicleReg) {
    if (_liveMode()) {
      const result = await backendAssignJob(jobId, driverId, driverName)
      if (!result.ok) {
        if (result.duplicate) return result.data // idempotent
        throw new Error(result.error)
      }
      // Also update local mirror so offline fallback stays fresh
      try {
        jobTable.update(jobId, {
          driver_id:   driverId,
          vehicle_id:  vehicleId,
          driver_name: driverName,
          vehicle_reg: vehicleReg,
          status:      JOB_STATUS.ASSIGNED,
          assigned_at: new Date().toISOString(),
        })
      } catch {}
      return result.data
    }

    // Local-only assignment
    return jobTable.update(jobId, {
      driver_id:   driverId,
      vehicle_id:  vehicleId,
      driver_name: driverName,
      vehicle_reg: vehicleReg,
      status:      JOB_STATUS.ASSIGNED,
      assigned_at: new Date().toISOString(),
    })
  },

  async startJob(id) {
    return this.updateJob(id, {
      status:     JOB_STATUS.IN_PROGRESS,
      started_at: new Date().toISOString(),
    })
  },

  async completeJob(id, notes = '') {
    return this.updateJob(id, {
      status:           JOB_STATUS.COMPLETED,
      completed_at:     new Date().toISOString(),
      completion_notes: notes,
    })
  },

  async cancelJob(id, reason = '') {
    return this.updateJob(id, {
      status:       JOB_STATUS.CANCELLED,
      cancel_reason: reason,
      cancelled_at:  new Date().toISOString(),
    })
  },

  deleteJob(id) {
    jobTable.delete(id)
  },

  /**
   * Subscribe to job changes.
   * In live mode — Supabase realtime channel.
   * In local mode — BroadcastChannel across tabs.
   *
   * Returns unsubscribe function.
   */
  subscribeToJobs(callback) {
    if (_liveMode()) {
      return subscribeToTasks(callback)
    }
    return subscribe(DB_KEYS.JOBS, (event) => callback(event))
  },

  /**
   * Subscribe to jobs for a specific driver (Driver PWA).
   * This is the critical path for the job assignment sync.
   */
  subscribeToDriverJobs(driverId, callback) {
    if (_liveMode()) {
      return subscribeToTasks(callback, driverId)
    }
    // Local: filter on broadcast events
    return subscribe(DB_KEYS.JOBS, () => {
      const rows = jobTable.list({ driver_id: driverId })
      callback(rows)
    })
  },
}

export default dispatchService
