/**
 * ============================================================
 * AP3X — PWA Job Sync Service  (Driver PWA — Supabase Realtime)
 * services/pwa/jobSyncService.js
 *
 * CONTRACT (LOCKED):
 *   - Supabase is the only source of truth
 *   - Driver can only see their own tasks (assigned_driver = driverId)
 *   - Subscribes to: tasks · driver_locations (write-only for GPS)
 *   - Driver cannot view all tasks or assign jobs
 *   - Status transitions: assigned → accepted → in_progress → completed
 *   - Backend wins on any conflict
 *
 * Usage:
 *   pwaJobSync.init(driverId)            — call on login
 *   pwaJobSync.onJobs(jobs => ...)       — subscribe to job updates
 *   pwaJobSync.acceptJob(id)             — driver accepts
 *   pwaJobSync.startJob(id)              — driver starts
 *   pwaJobSync.completeJob(id, notes)    — driver completes
 *   pwaJobSync.pushLocation(data)        — GPS upsert to driver_locations
 *   pwaJobSync.destroy()                 — cleanup on logout
 * ============================================================
 */

import {
  getSupabaseClient, isSupabaseReady, autoInitSupabase,
} from './services_supabase_supabaseClient'
import { upsertDriverLocation } from './services_backend_backendService'

// ─── Offline queue ────────────────────────────────────────────
const OFFLINE_QUEUE_KEY  = 'apex:pwa:offline_job_queue'
const CACHED_JOBS_KEY    = 'apex:pwa:cached_jobs'

const tsNow   = () => new Date().toISOString()
const readLS  = (k, fb) => { try { return JSON.parse(localStorage.getItem(k) ?? 'null') ?? fb } catch { return fb } }
const writeLS = (k, v)   => { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} }

// ─── Task status constants (contract-locked) ──────────────────
export const PWA_JOB_STATUS = {
  PENDING:     'pending',
  ASSIGNED:    'assigned',
  ACCEPTED:    'accepted',
  IN_PROGRESS: 'in_progress',
  COMPLETED:   'completed',
  CANCELLED:   'cancelled',
}

// ─── Sort: active first, then priority, then newest ──────────
const PRIORITY_ORDER = { urgent: 0, high: 1, normal: 2, low: 3 }

function sortJobs(jobs) {
  return [...jobs].sort((a, b) => {
    const aActive = ['assigned', 'accepted', 'in_progress'].includes(a.status)
    const bActive = ['assigned', 'accepted', 'in_progress'].includes(b.status)
    if (aActive !== bActive) return aActive ? -1 : 1
    const pd = (PRIORITY_ORDER[a.priority] ?? 2) - (PRIORITY_ORDER[b.priority] ?? 2)
    if (pd !== 0) return pd
    return new Date(b.assigned_at || b.created_at || 0) - new Date(a.assigned_at || a.created_at || 0)
  })
}

// ═══════════════════════════════════════════════════════════════
// PWA JOB SYNC SERVICE
// ═══════════════════════════════════════════════════════════════

class PWAJobSyncService {
  constructor() {
    this._driverId       = null
    this._jobs           = []
    this._listeners      = new Set()
    this._statusListeners = new Set()
    this._channel        = null
    this._offlineQueue   = []
    this._destroyed      = false
    this._retryTimer     = null
    this._pollTimer      = null
    this._status         = 'idle'

    this._onOnline  = this._handleOnline.bind(this)
    this._onOffline = this._handleOffline.bind(this)
    window.addEventListener('online',  this._onOnline)
    window.addEventListener('offline', this._onOffline)
  }

  // ── Public API ──────────────────────────────────────────────

  /**
   * init(driverId)
   * Call once on driver login. Fetches tasks + subscribes to Realtime.
   * driverId MUST be the Supabase driver/profile UUID.
   */
  async init(driverId) {
    if (!driverId) { console.warn('[PWAJobSync] No driverId'); return }
    if (this._driverId === driverId && this._status === 'connected') return

    this._driverId    = driverId
    this._destroyed   = false
    this._offlineQueue = readLS(OFFLINE_QUEUE_KEY, [])
    this._setStatus('connecting')

    // Paint instantly from cache while fetching
    const cached = readLS(CACHED_JOBS_KEY, [])
    if (cached.length) { this._jobs = cached; this._emit() }

    autoInitSupabase()

    if (isSupabaseReady()) {
      await this._fetchAndSubscribe()
    } else {
      console.warn('[PWAJobSync] Supabase not ready — polling fallback')
      this._setStatus('offline')
      this._startPolling()
    }
  }

  /** Subscribe to job list updates. Returns unsub function. */
  onJobs(callback) {
    this._listeners.add(callback)
    if (this._jobs.length) {
      try { callback(sortJobs(this._jobs)) } catch {}
    }
    return () => this._listeners.delete(callback)
  }

  /** Subscribe to connection status. Returns unsub function. */
  onStatus(callback) {
    this._statusListeners.add(callback)
    try { callback(this._status) } catch {}
    return () => this._statusListeners.delete(callback)
  }

  getJobs()   { return sortJobs(this._jobs) }
  getStatus() { return this._status }

  // ── Status transitions (driver-side only) ───────────────────

  /** Driver accepts an assigned task → status: accepted */
  async acceptJob(jobId) {
    return this._updateStatus(jobId, PWA_JOB_STATUS.ACCEPTED, { accepted_at: tsNow() })
  }

  /** Driver starts navigation → status: in_progress */
  async startJob(jobId) {
    return this._updateStatus(jobId, PWA_JOB_STATUS.IN_PROGRESS, { started_at: tsNow() })
  }

  /** Driver completes task → status: completed */
  async completeJob(jobId, notes = '') {
    return this._updateStatus(jobId, PWA_JOB_STATUS.COMPLETED, {
      completed_at:     tsNow(),
      completion_notes: notes || null,
    })
  }

  /** Driver rejects an assigned task before accepting → status: cancelled */
  async rejectJob(jobId, reason = '') {
    return this._updateStatus(jobId, PWA_JOB_STATUS.CANCELLED, {
      cancel_reason:  reason || 'Driver rejected',
      cancelled_at:   tsNow(),
      rejection_note: reason || null,
    })
  }

  /** Driver cancels an in-progress task → status: cancelled */
  async cancelJob(jobId, reason = '') {
    return this._updateStatus(jobId, PWA_JOB_STATUS.CANCELLED, {
      cancel_reason: reason || null,
      cancelled_at:  tsNow(),
    })
  }

  /**
   * pushLocation(locationData)
   * Upsert GPS to driver_locations table.
   * Fire-and-forget — does not block GPS loop.
   * locationData: { lat, lng, speed, heading, accuracy, status }
   */
  pushLocation(locationData) {
    if (!this._driverId) return
    upsertDriverLocation(this._driverId, locationData)
      .catch(() => {}) // never throw
  }

  /** Cleanup — call on driver logout */
  destroy() {
    this._destroyed = true
    this._teardownChannel()
    this._stopPolling()
    clearTimeout(this._retryTimer)
    window.removeEventListener('online',  this._onOnline)
    window.removeEventListener('offline', this._onOffline)
    this._listeners.clear()
    this._statusListeners.clear()
    this._driverId = null
    console.info('[PWAJobSync] Destroyed')
  }

  async requestNotificationPermission() {
    if (!('Notification' in window)) return 'not_supported'
    if (Notification.permission === 'granted') return 'granted'
    return Notification.requestPermission()
  }

  // ── Private internals ───────────────────────────────────────

  _setStatus(s) {
    if (this._status === s) return
    this._status = s
    console.debug('[PWAJobSync] Status →', s)
    this._statusListeners.forEach(cb => { try { cb(s) } catch {} })
  }

  _emit() {
    const sorted = sortJobs(this._jobs)
    writeLS(CACHED_JOBS_KEY, sorted)
    this._listeners.forEach(cb => { try { cb(sorted) } catch {} })
  }

  async _fetchAndSubscribe() {
    if (this._destroyed) return
    try {
      this._jobs = await this._fetchJobs()
      this._emit()
      this._setStatus('connected')
      await this._flushOfflineQueue()
      this._subscribeRealtime()
    } catch (err) {
      console.error('[PWAJobSync] Init error:', err)
      this._setStatus('error')
      this._scheduleRetry()
    }
  }

  async _fetchJobs() {
    const sb = getSupabaseClient()
    if (!sb) throw new Error('Supabase not available')

    // Driver ONLY sees their own assigned tasks (contract rule)
    const { data, error } = await sb
      .from('tasks')
      .select('*')
      .eq('assigned_driver', this._driverId)
      .not('status', 'in', '("completed","cancelled")')
      .order('assigned_at', { ascending: false })
      .limit(50)

    if (error) throw new Error(error.message)
    console.info(`[PWAJobSync] Fetched ${(data || []).length} tasks for driver ${this._driverId}`)
    return data || []
  }

  _subscribeRealtime() {
    if (this._destroyed) return
    this._teardownChannel()

    const sb = getSupabaseClient()
    if (!sb) { this._scheduleRetry(); return }

    const key = `pwa-tasks-${this._driverId}`

    try {
      this._channel = sb
        .channel(key)
        .on(
          'postgres_changes',
          {
            event:  '*',
            schema: 'public',
            table:  'tasks',
            filter: `assigned_driver=eq.${this._driverId}`,
          },
          (payload) => this._handleRealtimeEvent(payload)
        )
        .subscribe((status, err) => {
          if (this._destroyed) return
          if (status === 'SUBSCRIBED') {
            this._setStatus('connected')
            this._stopPolling()
          }
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.warn('[PWAJobSync] Channel error — polling fallback')
            this._setStatus('offline')
            this._startPolling()
          }
          if (status === 'CLOSED' && !this._destroyed) {
            this._setStatus('offline')
            this._scheduleRetry()
          }
        })

      console.info('[PWAJobSync] Subscribed to tasks realtime for driver:', this._driverId)
    } catch (err) {
      console.error('[PWAJobSync] Channel setup failed:', err)
      this._setStatus('error')
      this._startPolling()
    }
  }

  _handleRealtimeEvent(payload) {
    if (this._destroyed) return
    const { eventType, new: newRow, old: oldRow } = payload

    if (eventType === 'INSERT' || eventType === 'UPDATE') {
      if (!newRow) return
      // Backend wins — replace or add
      const idx = this._jobs.findIndex(j => j.id === newRow.id)
      if (idx >= 0) {
        this._jobs[idx] = newRow
      } else {
        this._jobs.push(newRow)
      }
      this._emit()

      // Notify driver of new assignments
      if (eventType === 'INSERT' || (eventType === 'UPDATE' && newRow.status === 'assigned')) {
        this._showNotification(newRow)
      }
    }

    if (eventType === 'DELETE') {
      const id = oldRow?.id
      if (id) {
        this._jobs = this._jobs.filter(j => j.id !== id)
        this._emit()
      }
    }
  }

  /**
   * Core status update — writes to Supabase tasks table.
   * Driver can only update tasks assigned to them.
   * On failure: queues offline update; UI shows queued state.
   * Backend is always the authority on reconnect.
   */
  async _updateStatus(jobId, status, extra = {}) {
    const update = { status, updated_at: tsNow(), ...extra }

    // Optimistic local update
    const idx = this._jobs.findIndex(j => j.id === jobId)
    if (idx >= 0) {
      this._jobs[idx] = { ...this._jobs[idx], ...update }
      this._emit()
    }

    if (!isSupabaseReady()) {
      this._queueOfflineUpdate(jobId, update)
      return { ok: false, queued: true }
    }

    try {
      const sb = getSupabaseClient()
      const { data, error } = await sb
        .from('tasks')
        .update(update)
        .eq('id', jobId)
        .eq('assigned_driver', this._driverId)   // driver can only update own tasks
        .select()
        .single()

      if (error) {
        console.warn('[PWAJobSync] Update failed, queuing:', error.message)
        this._queueOfflineUpdate(jobId, update)
        return { ok: false, queued: true, error: error.message }
      }

      // Reconcile with server response (backend wins)
      if (data && idx >= 0) this._jobs[idx] = data
      this._emit()
      return { ok: true, data }

    } catch (err) {
      console.error('[PWAJobSync] Update threw:', err)
      this._queueOfflineUpdate(jobId, update)
      return { ok: false, queued: true, error: err.message }
    }
  }

  // ── Offline queue ───────────────────────────────────────────

  _queueOfflineUpdate(jobId, update) {
    this._offlineQueue = this._offlineQueue.filter(q => q.jobId !== jobId)
    this._offlineQueue.push({ jobId, update, ts: tsNow() })
    writeLS(OFFLINE_QUEUE_KEY, this._offlineQueue)
    console.info('[PWAJobSync] Queued offline update:', jobId, update.status)
  }

  async _flushOfflineQueue() {
    const queue = [...this._offlineQueue]
    if (!queue.length) return

    const sb = getSupabaseClient()
    if (!sb) return

    console.info(`[PWAJobSync] Flushing ${queue.length} offline updates…`)
    const flushed = []

    for (const item of queue) {
      try {
        const { error } = await sb
          .from('tasks')
          .update({ ...item.update, updated_at: tsNow() })
          .eq('id', item.jobId)
          .eq('assigned_driver', this._driverId)
        if (!error) { flushed.push(item.jobId) }
        else { console.warn('[PWAJobSync] Flush failed:', item.jobId, error.message) }
      } catch {}
    }

    this._offlineQueue = this._offlineQueue.filter(q => !flushed.includes(q.jobId))
    writeLS(OFFLINE_QUEUE_KEY, this._offlineQueue)

    if (flushed.length) {
      // Re-fetch from Supabase — backend wins after flush
      this._jobs = await this._fetchJobs()
      this._emit()
    }
  }

  // ── Polling fallback ────────────────────────────────────────

  _startPolling(ms = 15000) {
    this._stopPolling()
    this._pollTimer = setInterval(async () => {
      if (this._destroyed || !isSupabaseReady()) return
      try { this._jobs = await this._fetchJobs(); this._emit() } catch {}
    }, ms)
  }

  _stopPolling() {
    if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null }
  }

  // ── Retry ───────────────────────────────────────────────────

  _scheduleRetry(delay = 4000) {   // exponential backoff: 4s → 8s → 16s → ... → 64s
    clearTimeout(this._retryTimer)
    this._retryTimer = setTimeout(async () => {
      if (this._destroyed) return
      autoInitSupabase()
      if (isSupabaseReady()) await this._fetchAndSubscribe()
      else this._scheduleRetry(Math.min(delay * 2, 64000))  // cap at 64s
    }, delay)
  }

  _teardownChannel() {
    if (this._channel) {
      try { getSupabaseClient()?.removeChannel(this._channel) } catch {}
      this._channel = null
    }
  }

  // ── Network events ──────────────────────────────────────────

  _handleOnline() {
    if (this._destroyed) return
    console.info('[PWAJobSync] Network restored')
    clearTimeout(this._retryTimer)
    this._setStatus('connecting')
    this._fetchAndSubscribe()
  }

  _handleOffline() {
    console.info('[PWAJobSync] Network lost')
    this._setStatus('offline')
    this._teardownChannel()
    this._startPolling(30000)
  }

  // ── Browser notifications ───────────────────────────────────

  _showNotification(job) {
    if (!('Notification' in window) || Notification.permission !== 'granted') {
      if (Notification.permission !== 'denied') Notification.requestPermission()
      return
    }
    try {
      const n = new Notification(`🚛 New Job: ${job.title || 'Job Assigned'}`, {
        body:    [
          job.pickup_address  ? `From: ${job.pickup_address}`  : '',
          job.dropoff_address ? `To: ${job.dropoff_address}`   : '',
          job.priority && job.priority !== 'normal' ? `Priority: ${job.priority.toUpperCase()}` : '',
        ].filter(Boolean).join(' · ') || 'A job has been assigned to you.',
        icon:    '/icons/icon-192x192.png',
        badge:   '/icons/icon-192x192.png',
        tag:     `job-${job.id}`,
        renotify: true,
        vibrate: [200, 100, 200],
      })
      n.onclick = () => { window.focus(); n.close() }
    } catch (e) {
      console.warn('[PWAJobSync] Notification error:', e)
    }
  }
}

// ─── Singleton export ─────────────────────────────────────────
export const pwaJobSync = new PWAJobSyncService()
export default pwaJobSync
