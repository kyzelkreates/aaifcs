/**
 * APEX AI — Driver Card
 */

import Icon from './components_ui_Icon'
import Badge from './components_ui_Badge'
import StatusDot from './components_ui_StatusDot'

const STATUS_DOT = { active: 'online', off_duty: 'offline', on_break: 'idle', suspended: 'warning', inactive: 'offline' }
const STATUS_VARIANT = { active: 'cyan', off_duty: 'muted', on_break: 'amber', suspended: 'red', inactive: 'muted' }

function ScoreRing({ score }) {
  const color = score >= 85 ? '#10b981' : score >= 65 ? '#f59e0b' : '#ef4444'
  const radius = 18, circ = 2 * Math.PI * radius
  const dash = (score / 100) * circ
  return (
    <div className="relative w-12 h-12 flex items-center justify-center flex-shrink-0">
      <svg className="absolute inset-0 -rotate-90" width="48" height="48" viewBox="0 0 48 48">
        <circle cx="24" cy="24" r={radius} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="3" />
        <circle cx="24" cy="24" r={radius} fill="none" stroke={color} strokeWidth="3"
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" />
      </svg>
      <span className="font-mono font-bold text-xs" style={{ color }}>{score ?? '—'}</span>
    </div>
  )
}

export default function DriverCard({ driver, onClick }) {
  const dot     = STATUS_DOT[driver.status] || 'offline'
  const variant = STATUS_VARIANT[driver.status] || 'muted'
  const initials = (driver.full_name || 'UN').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()

  return (
    <div
      onClick={onClick}
      className="bg-[#0d1426] border border-slate-800/60 hover:border-slate-700/60 rounded-lg p-4 cursor-pointer transition-all group"
    >
      <div className="flex items-center gap-3 mb-3">
        {/* Avatar */}
        <div className="w-10 h-10 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center flex-shrink-0">
          <span className="text-sm font-bold text-slate-300">{initials}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-white truncate">{driver.full_name || 'Unknown'}</div>
          <div className="text-xs text-slate-500 truncate">ID: {driver.employee_id || driver.id?.slice(0,8)}</div>
        </div>
        <ScoreRing score={driver.safety_score} />
      </div>

      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5">
          <StatusDot status={dot} />
          <Badge variant={variant} size="sm">{driver.status?.replace('_', ' ')}</Badge>
        </div>
        <span className="text-2xs text-slate-600 font-mono uppercase">
          {driver.licence_type || '—'}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 pt-3 border-t border-slate-800/60">
        {[
          { label: 'Assigned Vehicle', value: driver.vehicle_reg || 'None' },
          { label: 'Hours This Week',  value: driver.hours_this_week != null ? `${driver.hours_this_week}h` : '—' },
        ].map(({ label, value }) => (
          <div key={label}>
            <div className="text-2xs text-slate-600 tracking-widest uppercase">{label}</div>
            <div className="text-xs text-slate-300 font-mono mt-0.5 truncate">{value}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
