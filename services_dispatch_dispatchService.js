/**
 * ============================================================
 * APEX AI — Dispatch Service (Local DB — No Supabase)
 * ============================================================
 */

import { jobTable, subscribe, DB_KEYS } from './services_local_localDB'

export const JOB_STATUS = {
  PENDING:     'pending',
  ASSIGNED:    'assigned',
  IN_PROGRESS: 'in_progress',
  COMPLETED:   'completed',
  CANCELLED:   'cancelled',
}

export const JOB_PRIORITY = { LOW: 'low', NORMAL: 'normal', HIGH: 'high', URGENT: 'urgent' }

export const STATUS_COLORS = {
  pending:     'muted',
  assigned:    'cyan',
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

export const dispatchService = {

  fetchJobs(filters = {}) {
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
    return jobTable.create({
      status: JOB_STATUS.PENDING,
      priority: JOB_PRIORITY.NORMAL,
      created_at: new Date().toISOString(),
      ...payload,
    })
  },

  updateJob(id, payload) {
    return jobTable.update(id, payload)
  },

  assignJob(jobId, driverId, vehicleId, driverName, vehicleReg) {
    return this.updateJob(jobId, {
      driver_id:   driverId,
      vehicle_id:  vehicleId,
      driver_name: driverName,
      vehicle_reg: vehicleReg,
      status:      JOB_STATUS.ASSIGNED,
      assigned_at: new Date().toISOString(),
    })
  },

  startJob(id) {
    return this.updateJob(id, {
      status:     JOB_STATUS.IN_PROGRESS,
      started_at: new Date().toISOString(),
    })
  },

  completeJob(id, notes = '') {
    return this.updateJob(id, {
      status:       JOB_STATUS.COMPLETED,
      completed_at: new Date().toISOString(),
      completion_notes: notes,
    })
  },

  cancelJob(id, reason = '') {
    return this.updateJob(id, {
      status:       JOB_STATUS.CANCELLED,
      cancel_reason: reason,
      cancelled_at: new Date().toISOString(),
    })
  },

  deleteJob(id) {
    jobTable.delete(id)
  },

  subscribeToJobs(callback) {
    return subscribe(DB_KEYS.JOBS, (event) => callback(event))
  },
}

export default dispatchService
