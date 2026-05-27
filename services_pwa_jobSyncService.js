/**
 * ============================================================
 * AP3X — PWA Job Sync Service  (Supabase Realtime SSOT)
 * services/pwa/jobSyncService.js
 *
 * This is THE critical path for cross-device job delivery.
 * It replaces localStorage/BroadcastChannel job sync with
 * Supabase Realtime so jobs push instantly to any driver device.
 *
 * Responsibilities:
 *  1. On PWA init — fetch driver's assigned jobs from Supabase
 *  2. Subscribe to realtime changes on that driver's tasks
 *  3. Maintain an offline queue when connection is lost
 *  4. Flush offline updates when connection is restored
 *  5. Emit job events that DriverApp.jsx listens to
 *  6. Update job status back to Supabase (accept/start/complete)
 *  7. Register service worker message handlers for background sync
 *
 * Usage (in DriverApp.jsx):
 *   import { pwaJobSync } from './services_pwa_jobSyncService'
 *
 *   // Init once with the driver's UUID from Supabase
 *   pwaJobSync.init(driverId)
 *
 *   // Listen for job updates
 *   const unsub = pwaJobSync.onJobs(jobs => setJobs(jobs))
 *
 *   // Status updates (driver-side)
 *   await pwaJobSync.acceptJob(jobId)
 *   await pwaJobSync.startJob(jobId)
 *   await pwaJobSync.completeJob(jobId, notes)
 *
 *   // Teardown
 *   pwaJobSync.destroy()
 * ============================================================
 */

import {
  getSupabaseClient,
  isSupabaseReady,
  getSupabaseSettings,
  autoInitSupabase,
} from './services_supabase_supabaseClient'

// ─── Offline queue persistence key ───────────────────────────
const OFFLINE_QUEUE_KEY  = 'apex:pwa:offline_job_queue'
const CACHED_JOBS_KEY    = 'apex:pwa:cached_jobs'
const DRIVER_SESSION_KEY = 'apex:pwa:driver_session'

// ─── Helpers ──────────────────────────────────────────────────
const tsNow   = () => new Date().toISOString()
const readLS  = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback } catch { return fallback } }
const writeLS = (key, val)      => { try { localStorage.setItem(key, JSON.stringify(val)) } catch {} }

// ─── Job status constants ─────────────────────────────────────
export const PWA_JOB_STATUS = {
  PENDING:     'pending',
  ASSIGNED:    'assigned',
  ACCEPTED:    'accepted',
  IN_PROGRESS: 'in_progress',
  COMPLETED:   'completed',
  CANCELLED:   'cancelled',
}

// ─── Priority sort order ──────────────────────────────────────
const PRIORITY_ORDER = { urgent: 0, high: 1, normal: 2, low: 3 }

function sortJobs(jobs) {
  return [...jobs].sort((a, b) => {
    // Active jobs first
    const aActive = ['assigned', 'accepted', 'in_progress'].includes(a.status)
    const bActive = ['assigned', 'accepted', 'in_progress'].includes(b.status)
    if (aActive !== bActive) return aActive ? -1 : 1
    // Then by priority
    const pd = (PRIORITY_ORDER[a.priority] ?? 2) - (PRIORITY_ORDER[b.priority] ?? 2)
    if (pd !== 0) return pd
    // Then by assigned_at desc
    return new Date(b.assigned_at || b.created_at || 0) - new Date(a.assigned_at || a.created_at || 0)
  })
}

// ─── PWA Job Sync singleton ───────────────────────────────────
class PWAJobSyncService {
  constructor() {
    this._driverId     = null
    this._jobs         = []
    this._listeners    = new Set()
    this._statusListeners = new Set()
    this._channel      = null
    this._offlineQueue = []
    this._online       = navigator.onLine
    this._destroyed    = false
    this._retryTimer   = null
    this._flushTimer   = null
    this._pollTimer    = null
    this._status       = 'idle' // idle | connecting | connected | offline | error

    // Bind network listeners
    this._onOnline  = this._handleOnline.bind(this)
    this._onOffline = this._handleOffline.bind(this)
    window.addEventListener('online',  this._onOnline)
    window.addEventListener('offline', this._onOffline)
  }

  // ── Public API ─────────────────────────────────────────────

  /**
   * init(driverId)
   * Call once when the driver logs in to the PWA.
   * Fetches their jobs and subscribes to realtime updates.
   */
  async init(driverId) {
    if (!driverId) { console.warn('[PWAJobSync] No driverId — cannot init'); return }
    if (this._driverId === driverId && this._status === 'connected') return

    this._driverId = driverId
    this._destroyed = false
    this._offlineQueue = readLS(OFFLINE_QUEUE_KEY, [])

    console.info('[PWAJobSync] Initialising for driver:', driverId)
    this._setStatus('connecting')

    // Load cached jobs immediately (instant paint while fetching)
    const cached = readLS(CACHED_JOBS_KEY, [])
    if (cached.length) {
      this._jobs = cached
      this._emit()
    }

    // Ensure Supabase client is ready
    autoInitSupabase()

    if (isSupabaseReady()) {
      await this._fetchAndSubscribe()
    } else {
      console.warn('[PWAJobSync] Supabase not ready — using cached jobs + polling fallback')
      this._setStatus('offline')
      this._startPolling()
    }
  }

  /**
   * onJobs(callback)
   * Subscribe to job list updates. Returns unsub function.
   * callback receives: Job[] (sorted by priority/status)
   */
  onJobs(callback) {
    this._listeners.add(callback)
    // Fire immediately with current jobs
    if (this._jobs.length) {
      try { callback(sortJobs(this._jobs)) } catch {}
    }
    return () => this._listeners.delete(callback)
  }

  /**
   * onStatus(callback)
   * Subscribe to connection status changes.
   * callback receives: 'connecting' | 'connected' | 'offline' | 'error'
   */
  onStatus(callback) {
    this._statusListeners.add(callback)
    try { callback(this._status) } catch {}
    return () => this._statusListeners.delete(callback)
  }

  getJobs() { return sortJobs(this._jobs) }
  getStatus() { return this._status }

  // ── Driver status mutations ────────────────────────────────

  async acceptJob(jobId) {
    return this._updateJobStatus(jobId, PWA_JOB_STATUS.ACCEPTED, {
      accepted_at: tsNow(),
    })
  }

  async startJob(jobId) {
    return this._updateJobStatus(jobId, PWA_JOB_STATUS.IN_PROGRESS, {
      started_at: tsNow(),
    })
  }

  async completeJob(jobId, notes = '') {
    return this._updateJobStatus(jobId, PWA_JOB_STATUS.COMPLETED, {
      completed_at:     tsNow(),
      completion_notes: notes,
    })
  }

  async cancelJob(jobId, reason = '') {
    return this._updateJobStatus(jobId, PWA_JOB_STATUS.CANCELLED, {
      cancel_reason: reason,
      cancelled_at:  tsNow(),
    })
  }

  /**
   * destroy()
   * Clean up subscriptions, timers, and event listeners.
   */
  destroy() {
    this._destroyed = true
    this._teardownChannel()
    this._stopPolling()
    clearTimeout(this._retryTimer)
    clearTimeout(this._flushTimer)
    window.removeEventListener('online',  this._onOnline)
    window.removeEventListener('offline', this._onOffline)
    this._listeners.clear()
    this._statusListeners.clear()
    console.info('[PWAJobSync] Destroyed')
  }

  // ── Private internals ──────────────────────────────────────

  _setStatus(status) {
    if (this._status === status) return
    this._status = status
    console.debug('[PWAJobSync] Status →', status)
    this._statusListeners.forEach(cb => { try { cb(status) } catch {} })
  }

  _emit() {
    const sorted = sortJobs(this._jobs)
    // Persist to cache so next init has instant data
    writeLS(CACHED_JOBS_KEY, sorted)
    this._listeners.forEach(cb => { try { cb(sorted) } catch {} })
  }

  async _fetchAndSubscribe() {
    if (this._destroyed) return

    try {
      // 1. Fetch current jobs
      const jobs = await this._fetchJobs()
      this._jobs = jobs
      this._emit()
      this._setStatus('connected')

      // 2. Flush any offline queue
      await this._flushOfflineQueue()

      // 3. Subscribe to realtime
      this._subscribeRealtime()

    } catch (err) {
      console.error('[PWAJobSync] Init failed:', err)
      this._setStatus('error')
      this._scheduleRetry()
    }
  }

  async _fetchJobs() {
    const sb = getSupabaseClient()
    if (!sb) throw new Error('Supabase client not available')

    const { data, error } = await sb
      .from('tasks')
      .select('*')
      .eq('assigned_driver', this._driverId)
      .not('status', 'in', '("completed","cancelled")')
      .order('assigned_at', { ascending: false })
      .limit(50)

    if (error) throw new Error(error.message)
    console.info(`[PWAJobSync] Fetched ${(data || []).length} jobs for driver ${this._driverId}`)
    return data || []
  }

  _subscribeRealtime() {
    if (this._destroyed) return
    this._teardownChannel()

    const sb = getSupabaseClient()
    if (!sb) { this._scheduleRetry(); return }

    const channelKey = `pwa-jobs-${this._driverId}`

    try {
      this._channel = sb
        .channel(channelKey)
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
          console.debug('[PWAJobSync] Channel status:', status, err || '')

          if (status === 'SUBSCRIBED') {
            this._setStatus('connected')
            this._stopPolling()
          }

          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.warn('[PWAJobSync] Channel error — falling back to polling')
            this._setStatus('offline')
            this._startPolling()
          }

          if (status === 'CLOSED') {
            if (!this._destroyed) {
              this._setStatus('offline')
              this._scheduleRetry()
            }
          }
        })

      console.info('[PWAJobSync] Subscribed to realtime channel:', channelKey)
    } catch (err) {
      console.error('[PWAJobSync] Channel setup failed:', err)
      this._setStatus('error')
      this._startPolling()
    }
  }

  _handleRealtimeEvent(payload) {
    if (this._destroyed) return
    const { eventType, new: newRow, old: oldRow } = payload

    console.debug('[PWAJobSync] Realtime event:', eventType, newRow?.id)

    if (eventType === 'INSERT' || eventType === 'UPDATE') {
      const job = newRow
      if (!job) return

      // Optimistic local update
      const idx = this._jobs.findIndex(j => j.id === job.id)
      if (idx >= 0) {
        this._jobs[idx] = job
      } else {
        this._jobs.unshift(job)
      }

      // Show browser notification for new job assignments
      if (eventType === 'INSERT' || (eventType === 'UPDATE' && job.status === 'assigned')) {
        this._showJobNotification(job)
      }

      this._emit()
    }

    if (eventType === 'DELETE') {
      const id = oldRow?.id
      if (id) {
        this._jobs = this._jobs.filter(j => j.id !== id)
        this._emit()
      }
    }
  }

  async _updateJobStatus(jobId, status, extra = {}) {
    // Optimistic local update first (instant UI response)
    const idx = this._jobs.findIndex(j => j.id === jobId)
    if (idx >= 0) {
      this._jobs[idx] = { ...this._jobs[idx], status, ...extra, updated_at: tsNow() }
      this._emit()
    }

    const update = { status, updated_at: tsNow(), ...extra }

    if (!isSupabaseReady() || !this._online) {
      // Queue for later
      this._queueOfflineUpdate(jobId, update)
      return { ok: true, queued: true }
    }

    try {
      const sb = getSupabaseClient()
      const { data, error } = await sb
        .from('tasks')
        .update(update)
        .eq('id', jobId)
        .eq('assigned_driver', this._driverId)
        .select()
        .single()

      if (error) {
        console.warn('[PWAJobSync] Update failed, queuing:', error.message)
        this._queueOfflineUpdate(jobId, update)
        return { ok: false, queued: true, error: error.message }
      }

      // Reconcile with server response
      if (idx >= 0 && data) this._jobs[idx] = data
      this._emit()
      return { ok: true, data }

    } catch (err) {
      console.error('[PWAJobSync] Update threw:', err)
      this._queueOfflineUpdate(jobId, update)
      return { ok: false, queued: true, error: err.message }
    }
  }

  // ── Offline queue ──────────────────────────────────────────

  _queueOfflineUpdate(jobId, update) {
    // Deduplicate — keep only the latest update per jobId
    this._offlineQueue = this._offlineQueue.filter(q => q.jobId !== jobId)
    this._offlineQueue.push({ jobId, update, ts: tsNow() })
    writeLS(OFFLINE_QUEUE_KEY, this._offlineQueue)
    console.info('[PWAJobSync] Queued offline update for job:', jobId, update.status)
  }

  async _flushOfflineQueue() {
    const queue = [...this._offlineQueue]
    if (!queue.length) return

    console.info(`[PWAJobSync] Flushing ${queue.length} offline updates…`)
    const sb = getSupabaseClient()
    if (!sb) return

    const flushed = []

    for (const item of queue) {
      try {
        const { error } = await sb
          .from('tasks')
          .update({ ...item.update, updated_at: tsNow() })
          .eq('id', item.jobId)
          .eq('assigned_driver', this._driverId)

        if (!error) {
          flushed.push(item.jobId)
          console.debug('[PWAJobSync] Flushed:', item.jobId, item.update.status)
        } else {
          console.warn('[PWAJobSync] Flush failed:', item.jobId, error.message)
        }
      } catch {}
    }

    // Remove successfully flushed items
    this._offlineQueue = this._offlineQueue.filter(q => !flushed.includes(q.jobId))
    writeLS(OFFLINE_QUEUE_KEY, this._offlineQueue)

    if (flushed.length) {
      // Refresh from server after flush
      const freshJobs = await this._fetchJobs()
      this._jobs = freshJobs
      this._emit()
    }
  }

  // ── Polling fallback (when realtime is unavailable) ────────

  _startPolling(intervalMs = 15000) {
    this._stopPolling()
    console.info('[PWAJobSync] Starting polling fallback every', intervalMs / 1000, 's')
    this._pollTimer = setInterval(async () => {
      if (this._destroyed) return
      if (!isSupabaseReady()) return
      try {
        const jobs = await this._fetchJobs()
        this._jobs = jobs
        this._emit()
      } catch {}
    }, intervalMs)
  }

  _stopPolling() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer)
      this._pollTimer = null
    }
  }

  // ── Retry logic ────────────────────────────────────────────

  _scheduleRetry(delayMs = 8000) {
    clearTimeout(this._retryTimer)
    this._retryTimer = setTimeout(async () => {
      if (this._destroyed) return
      console.info('[PWAJobSync] Retrying connection…')
      autoInitSupabase()
      if (isSupabaseReady()) {
        await this._fetchAndSubscribe()
      } else {
        this._scheduleRetry(Math.min(delayMs * 2, 60000)) // exponential backoff
      }
    }, delayMs)
  }

  _teardownChannel() {
    if (this._channel) {
      try {
        const sb = getSupabaseClient()
        sb?.removeChannel(this._channel)
      } catch {}
      this._channel = null
    }
  }

  // ── Network events ─────────────────────────────────────────

  _handleOnline() {
    this._online = true
    console.info('[PWAJobSync] Network restored — reconnecting…')
    if (this._destroyed) return
    clearTimeout(this._retryTimer)
    this._setStatus('connecting')
    this._fetchAndSubscribe()
  }

  _handleOffline() {
    this._online = false
    console.info('[PWAJobSync] Network lost — offline mode')
    this._setStatus('offline')
    this._teardownChannel()
    this._startPolling(30000) // slower poll when offline (will mostly fail, but tries)
  }

  // ── Browser notifications ──────────────────────────────────

  _showJobNotification(job) {
    if (!('Notification' in window)) return
    if (Notification.permission !== 'granted') {
      Notification.requestPermission()
      return
    }
    try {
      const title = `🚛 New Job: ${job.title || 'Dispatched'}`
      const body  = [
        job.description ? job.description.slice(0, 80) : '',
        job.priority && job.priority !== 'normal' ? `Priority: ${job.priority.toUpperCase()}` : '',
      ].filter(Boolean).join(' · ')

      const n = new Notification(title, {
        body:    body || 'A new job has been assigned to you.',
        icon:    '/icons/icon-192x192.png',
        badge:   '/icons/icon-192x192.png',
        tag:     `job-${job.id}`,
        renotify: true,
        vibrate: [200, 100, 200],
      })

      // Tap notification → focus the PWA
      n.onclick = () => {
        window.focus()
        n.close()
      }
    } catch (err) {
      console.warn('[PWAJobSync] Notification failed:', err)
    }
  }

  /**
   * requestNotificationPermission()
   * Call this from a user gesture (button tap) in the PWA.
   */
  async requestNotificationPermission() {
    if (!('Notification' in window)) return 'not_supported'
    if (Notification.permission === 'granted') return 'granted'
    const result = await Notification.requestPermission()
    return result
  }
}

// ─── Export singleton ─────────────────────────────────────────
export const pwaJobSync = new PWAJobSyncService()
export default pwaJobSync
