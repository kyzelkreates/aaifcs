/**
 * AP3X Safety Sync Service
 * Flushes the offline safety vault to Supabase when connectivity is restored.
 *
 * READ-ONLY integration with Fleet OS:
 *   - writes ONLY to driver-safety tables (safety_incidents, driver_dashcam_events)
 *   - never touches Fleet OS tables (tasks, job_assignments, driver_locations, etc.)
 *
 * DRIVER PWA ONLY.
 */

import { getSupabaseClient } from './services_supabase_supabaseClient'
import { getSyncQueue, removeSyncItem } from './services_safety_offlineVault'

let _syncTimer  = null
let _isSyncing  = false

const ALLOWED_TABLES = new Set([
  'safety_incidents',
  'driver_dashcam_events',
  'driver_route_memory',
  'driver_safety_exports',
])

/**
 * Flush all queued safety records to Supabase.
 * Safe to call repeatedly — skips if already running.
 */
export async function flushSafetyQueue() {
  if (_isSyncing) return { flushed: 0, failed: 0 }
  _isSyncing = true

  const sb = getSupabaseClient()
  if (!sb) { _isSyncing = false; return { flushed: 0, failed: 0 } }

  const queue   = await getSyncQueue()
  let flushed   = 0
  let failed    = 0

  for (const item of queue) {
    // Guard: never write to Fleet OS tables
    if (!ALLOWED_TABLES.has(item.table_name)) {
      console.warn('[SafetySync] Blocked write to non-safety table:', item.table_name)
      await removeSyncItem(item.id)
      continue
    }

    // Strip internal vault fields before upload
    const { _synced, ...payload } = item.payload || {}

    try {
      const { error } = await sb
        .from(item.table_name)
        .upsert(payload, { onConflict: 'id', ignoreDuplicates: false })

      if (error) {
        console.warn('[SafetySync] Upsert failed:', item.table_name, error.message)
        failed++
      } else {
        await removeSyncItem(item.id)
        flushed++
      }
    } catch (e) {
      console.warn('[SafetySync] Network error:', e.message)
      failed++
    }
  }

  _isSyncing = false
  return { flushed, failed }
}

/**
 * Start watching online/offline events and flush on reconnect.
 * Call once when the Driver PWA mounts.
 */
export function startSafetySync() {
  // Flush immediately if already online
  if (navigator.onLine) flushSafetyQueue()

  window.addEventListener('online', () => {
    console.info('[SafetySync] Back online — flushing safety queue')
    flushSafetyQueue()
  })

  // Also flush every 5 minutes while online
  _syncTimer = setInterval(() => {
    if (navigator.onLine) flushSafetyQueue()
  }, 5 * 60 * 1000)
}

/**
 * Stop the background sync timer.
 */
export function stopSafetySync() {
  if (_syncTimer) {
    clearInterval(_syncTimer)
    _syncTimer = null
  }
}
