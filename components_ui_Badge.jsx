/**
 * ============================================================
 * APEX AI — Badge Component
 * /src/components/ui/Badge.jsx
 * ============================================================
 */

import clsx from 'clsx'

const VARIANTS = {
  cyan:    'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20',
  green:   'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
  red:     'bg-red-500/10 text-red-400 border border-red-500/20',
  amber:   'bg-amber-500/10 text-amber-400 border border-amber-500/20',
  violet:  'bg-violet-500/10 text-violet-400 border border-violet-500/20',
  muted:   'bg-slate-800 text-slate-400',
  default: 'bg-slate-800 text-slate-300 border border-slate-700'
}

export default function Badge({ children, variant = 'default', className = '' }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold tracking-wider uppercase',
        VARIANTS[variant] || VARIANTS.default,
        className
      )}
    >
      {children}
    </span>
  )
}
