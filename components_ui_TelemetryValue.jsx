/**
 * ============================================================
 * APEX AI — Telemetry Value Display
 * /src/components/ui/TelemetryValue.jsx
 * ============================================================
 */

import clsx from 'clsx'

export default function TelemetryValue({
  label,
  value,
  unit,
  trend,         // 'up' | 'down' | null
  status,        // 'nominal' | 'warning' | 'critical'
  size = 'md',
  className = ''
}) {
  const statusColors = {
    nominal:  'text-cyan-400',
    warning:  'text-amber-400',
    critical: 'text-red-400'
  }

  const sizeMap = {
    sm: { value: 'text-lg', label: 'text-2xs', unit: 'text-xs' },
    md: { value: 'text-2xl', label: 'text-xs', unit: 'text-sm' },
    lg: { value: 'text-4xl', label: 'text-sm', unit: 'text-base' }
  }

  const sz = sizeMap[size] || sizeMap.md

  return (
    <div className={clsx('flex flex-col gap-0.5', className)}>
      {label && (
        <span className={clsx(sz.label, 'text-slate-500 font-medium tracking-widest uppercase')}>
          {label}
        </span>
      )}
      <div className="flex items-end gap-1">
        <span className={clsx(sz.value, 'font-mono font-semibold tabular-nums', statusColors[status] || 'text-cyan-400')}>
          {value ?? '—'}
        </span>
        {unit && (
          <span className={clsx(sz.unit, 'text-slate-500 mb-0.5 font-mono')}>
            {unit}
          </span>
        )}
        {trend === 'up' && (
          <span className="text-emerald-400 text-xs mb-0.5">↑</span>
        )}
        {trend === 'down' && (
          <span className="text-red-400 text-xs mb-0.5">↓</span>
        )}
      </div>
    </div>
  )
}
