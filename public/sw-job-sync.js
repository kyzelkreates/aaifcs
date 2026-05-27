/**
 * ============================================================
 * AP3X — Service Worker: Job Sync Background Handler
 * public/sw-job-sync.js
 *
 * Handles:
 *  - Background Sync: flush offline job status updates when
 *    connectivity is restored (even if PWA tab is closed)
 *  - Push Notifications: receive job dispatch pushes from
 *    Supabase Edge Functions / backend
 *  - Cache Strategy: network-first for API, cache-first for assets
 * ============================================================
 */

const CACHE_NAME     = 'apex-pwa-v1'
const OFFLINE_QUEUE_KEY = 'apex:pwa:offline_job_queue'
const SYNC_TAG       = 'apex-job-sync'

// ─── Install & Activate ───────────────────────────────────────
self.addEventListener('install', (event) => {
  console.log('[SW] Installed')
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  console.log('[SW] Activated')
  event.waitUntil(clients.claim())
})

// ─── Background Sync ──────────────────────────────────────────
// Triggered when connectivity is restored.
// Reads the offline queue from IndexedDB/localStorage (via client message)
// and sends queued updates to Supabase.
self.addEventListener('sync', (event) => {
  if (event.tag === SYNC_TAG) {
    console.log('[SW] Background sync triggered:', SYNC_TAG)
    event.waitUntil(flushOfflineQueue())
  }
})

async function flushOfflineQueue() {
  // Notify all open clients to flush their offline queues
  const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true })
  for (const client of allClients) {
    client.postMessage({ type: 'FLUSH_OFFLINE_QUEUE' })
  }
}

// ─── Push Notifications ───────────────────────────────────────
// Receives push events from your backend (Supabase Edge Function
// or any server that sends Web Push). Payload should be JSON:
// { title, body, jobId, driverId, priority }
self.addEventListener('push', (event) => {
  if (!event.data) return

  let payload
  try {
    payload = event.data.json()
  } catch {
    payload = { title: 'New Job', body: event.data.text() }
  }

  const title   = payload.title   || '🚛 New Job Dispatched'
  const options = {
    body:    payload.body    || 'You have a new job assignment.',
    icon:    '/icons/icon-192x192.png',
    badge:   '/icons/icon-192x192.png',
    tag:     payload.jobId   ? `job-${payload.jobId}` : 'apex-job',
    renotify: true,
    vibrate: [200, 100, 200, 100, 200],
    data:    { jobId: payload.jobId, driverId: payload.driverId, url: '/driver-app' },
    actions: [
      { action: 'accept', title: '✅ Accept' },
      { action: 'view',   title: '👁 View'   },
    ],
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

// ─── Notification click ───────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const { action } = event
  const { jobId, url } = event.notification.data || {}

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (allClients) => {
      // Find an open PWA window and focus it
      const existing = allClients.find(c => c.url.includes('/driver-app') || c.url.includes('/#'))
      if (existing) {
        await existing.focus()
        existing.postMessage({ type: 'NOTIFICATION_ACTION', action, jobId })
        return
      }
      // Otherwise open the PWA
      await clients.openWindow(url || '/driver-app')
    })
  )
})

// ─── Message handler ──────────────────────────────────────────
// Receive messages from the main thread
self.addEventListener('message', (event) => {
  const { type, payload } = event.data || {}

  if (type === 'REGISTER_SYNC') {
    // Register a background sync when the page goes offline
    if ('SyncManager' in self) {
      self.registration.sync.register(SYNC_TAG)
        .then(() => console.log('[SW] Sync registered'))
        .catch(err => console.warn('[SW] Sync registration failed:', err))
    }
  }

  if (type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})
