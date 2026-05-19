/**
 * ============================================================
 * APEX AI — Status Dot
 * /src/components/ui/StatusDot.jsx
 * ============================================================
 */

import clsx from 'clsx'

const STATUS_STYLES = {
  online:  'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]',
  offline: 'bg-red-500',
  idle:    'bg-amber-400 animate-pulse',
  warning: 'bg-amber-400 animate-pulse',
  error:   'bg-red-500 animate-pulse',
  syncing: 'bg-cyan-400 animate-pulse',
  unknown: 'bg-slate-500'
}

export default function StatusDot({ status = 'unknown', className = '' }) {
  return (
    <span
      className={clsx(
        'inline-block w-2 h-2 rounded-full',
        STATUS_STYLES[status] || STATUS_STYLES.unknown,
        className
      )}
    />
  )
}
