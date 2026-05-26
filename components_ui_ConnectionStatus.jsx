/**
 * ============================================================
 * AP3X — Global Connection Status Indicator
 * components/ui/ConnectionStatus.jsx
 *
 * Three exports:
 *   ConnectionStatusPill   — compact pill for TopNav header
 *   BackendWarningBanner   — full-width alert for AppShell
 *   DriverConnectionRow    — compact row for Driver PWA
 *
 * On mount: triggers probeConnection() if live mode is configured,
 * so the status reflects reality immediately on page load.
 * ============================================================
 */

import { useState, useEffect } from 'react'
import { onConnectionStatus, getConnectionStatus, probeConnection } from './services_backend_backendService'
import { getSupabaseSettings } from './services_supabase_supabaseClient'
import Icon from './components_ui_Icon'

const STATUS_CONFIG = {
  connected: {
    icon:  'Wifi',
    label: 'Live',
    color: 'text-emerald-400',
    dot:   'bg-emerald-400',
    pulse: true,
  },
  connecting: {
    icon:  'Loader2',
    label: 'Connecting',
    color: 'text-cyan-400',
    dot:   'bg-cyan-400',
    pulse: false,
    spin:  true,
  },
  offline: {
    icon:  'WifiOff',
    label: 'Offline',
    color: 'text-slate-500',
    dot:   'bg-slate-600',
    pulse: false,
  },
  invalid_config: {
    icon:  'AlertCircle',
    label: 'Config',
    color: 'text-amber-400',
    dot:   'bg-amber-400',
    pulse: false,
  },
  failed: {
    icon:  'WifiOff',
    label: 'Failed',
    color: 'text-red-400',
    dot:   'bg-red-400',
    pulse: false,
  },
  sync_delayed: {
    icon:  'Clock',
    label: 'Delayed',
    color: 'text-amber-400',
    dot:   'bg-amber-400',
    pulse: false,
  },
}

// ─── Shared init hook ─────────────────────────────────────────
// Probes connection on mount if settings are enabled.
// Returns [status, setStatus].
function useConnectionStatus() {
  const [status, setStatus] = useState(getConnectionStatus)

  useEffect(() => {
    // Subscribe to status changes from backendService
    const unsub = onConnectionStatus(setStatus)

    // Trigger probe if live mode is configured and status isn't already known
    const settings = getSupabaseSettings()
    if (settings.enabled && settings.url && settings.anonKey) {
      const current = getConnectionStatus()
      if (current === 'offline' || current === 'failed') {
        probeConnection()
      }
    }

    return unsub
  }, [])

  return status
}

/**
 * Compact pill for the TopNav header.
 * Renders nothing if Supabase is not enabled (local mode is silent).
 */
export function ConnectionStatusPill({ className = '' }) {
  const status = useConnectionStatus()
  const settings = getSupabaseSettings()

  // Don't render if live mode is disabled
  if (!settings.enabled) return null

  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.offline

  return (
    <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full bg-slate-900/60 border border-slate-800/60 ${className}`}>
      <span className="relative flex h-2 w-2">
        {cfg.pulse && (
          <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${cfg.dot} opacity-60`} />
        )}
        <span className={`relative inline-flex rounded-full h-2 w-2 ${cfg.dot}`} />
      </span>
      <Icon
        name={cfg.icon}
        size={11}
        className={`${cfg.color} ${cfg.spin ? 'animate-spin' : ''}`}
      />
      <span className={`text-2xs font-semibold ${cfg.color}`}>{cfg.label}</span>
    </div>
  )
}

/**
 * Full-width warning banner — shown when backend is down in live mode.
 * Only renders when there's an actionable problem to surface.
 * Does NOT render when connected or connecting.
 */
export function BackendWarningBanner() {
  const status = useConnectionStatus()
  const settings = getSupabaseSettings()

  if (!settings.enabled) return null
  if (status === 'connected' || status === 'connecting') return null

  const messages = {
    offline:        'Backend offline — displaying last known local data. Changes will not sync.',
    invalid_config: 'Supabase config incomplete. Go to Settings → Backend to add your URL and anon key.',
    failed:         'Backend connection failed. Retrying… Live sync unavailable.',
    sync_delayed:   'Sync delayed — some data may be stale.',
  }

  const msg = messages[status]
  if (!msg) return null

  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 text-xs text-amber-300 flex-shrink-0">
      <Icon name="AlertTriangle" size={13} className="text-amber-400 flex-shrink-0" />
      <span>{msg}</span>
    </div>
  )
}

/**
 * Compact status row for the Driver PWA.
 */
export function DriverConnectionRow({ className = '' }) {
  const status = useConnectionStatus()
  const settings = getSupabaseSettings()

  if (!settings.enabled) return null

  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.offline

  return (
    <div className={`flex items-center justify-between p-2 rounded-lg bg-slate-900/40 border border-slate-800/60 ${className}`}>
      <div className="flex items-center gap-2">
        <Icon name="Database" size={12} className="text-slate-500" />
        <span className="text-xs text-slate-500">Fleet Backend</span>
      </div>
      <div className={`flex items-center gap-1.5 ${cfg.color}`}>
        <span className={`inline-flex rounded-full h-1.5 w-1.5 ${cfg.dot}`} />
        <span className="text-2xs font-semibold">{cfg.label}</span>
      </div>
    </div>
  )
}

export default ConnectionStatusPill
