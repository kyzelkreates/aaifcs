/**
 * AP3X Safety Dashboard Hub
 * Safety sub-nav — entry point for all safety screens
 */
import Icon from './components_ui_Icon'

const SAFETY_CARDS = [
  { key: 'dashcam',   icon: 'Camera',        label: 'Dashcam',        desc: 'Live camera + clip recording',     clr: 'text-cyan-400',    bg: 'bg-cyan-500/10 border-cyan-500/20' },
  { key: 'hazards',   icon: 'AlertTriangle', label: 'Report Hazard',  desc: 'Log road hazards with location',   clr: 'text-amber-400',   bg: 'bg-amber-500/10 border-amber-500/20' },
  { key: 'incidents', icon: 'Zap',           label: 'Incident Log',   desc: 'View all incidents this session',  clr: 'text-red-400',     bg: 'bg-red-500/10 border-red-500/20' },
  { key: 'playback',  icon: 'Play',          label: 'Route Replay',   desc: 'Replay completed route paths',     clr: 'text-violet-400',  bg: 'bg-violet-500/10 border-violet-500/20' },
  { key: 'export',    icon: 'Download',      label: 'Export Evidence',desc: 'Download reports & incident data', clr: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20' },
]

export default function SafetyDashboard({ fatigueScore = 0, alertLevel = 'ok', onNavigate }) {
  const alertColor = alertLevel === 'danger' ? 'text-red-400' : alertLevel === 'warn' ? 'text-amber-400' : 'text-emerald-400'
  const alertBg    = alertLevel === 'danger' ? 'border-red-500/30 bg-red-500/8' : alertLevel === 'warn' ? 'border-amber-500/30 bg-amber-500/8' : 'border-emerald-500/30 bg-emerald-500/8'
  const alertLabel = alertLevel === 'danger' ? '⚠ CRITICAL — TAKE BREAK NOW' : alertLevel === 'warn' ? '△ FATIGUE WARNING' : '✓ SAFE TO DRIVE'

  return (
    <div className="px-4 pt-3 pb-4">
      <div className={`flex items-center justify-between px-4 py-2.5 rounded-xl border mb-4 ${alertBg}`}>
        <div className="flex items-center gap-2">
          <Icon name="Shield" size={14} className={alertColor} />
          <span className={`text-xs font-bold ${alertColor}`}>{alertLabel}</span>
        </div>
        <span className={`text-sm font-bold font-mono ${alertColor}`}>{fatigueScore}/100</span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {SAFETY_CARDS.map(card => (
          <button
            key={card.key}
            onClick={() => onNavigate?.(card.key)}
            className={`flex flex-col items-start gap-1.5 p-3 rounded-xl border ${card.bg} hover:opacity-80 transition-opacity text-left`}
          >
            <Icon name={card.icon} size={16} className={card.clr} />
            <div className="text-xs font-semibold text-slate-200">{card.label}</div>
            <div className="text-xs text-slate-500 leading-snug">{card.desc}</div>
          </button>
        ))}
      </div>
    </div>
  )
}
