/**
 * APEX AI — AP3X Driver HUD
 */

import TelemetryValue from './components_ui_TelemetryValue'
import StatusDot from './components_ui_StatusDot'
import Icon from './components_ui_Icon'

export default function DriverHUD({ position, speed, heading, eta, distanceLeft, nextInstruction }) {
  return (
    <div className="flex flex-col gap-3">
      {/* Speed + heading */}
      <div className="bg-[#0d1426]/95 border border-slate-800/60 rounded-xl p-4 backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <TelemetryValue label="Speed" value={speed ?? '—'} unit="km/h" size="lg" status={speed > 90 ? 'warning' : 'nominal'} />
          <div className="flex flex-col items-end gap-1">
            <TelemetryValue label="Heading" value={heading != null ? `${heading}°` : '—'} size="md" />
            {position && (
              <span className="text-2xs font-mono text-slate-600">
                {position.lat?.toFixed(4)}, {position.lng?.toFixed(4)}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Next instruction */}
      {nextInstruction && (
        <div className="bg-cyan-500/5 border border-cyan-500/20 rounded-xl p-4 backdrop-blur-sm flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center flex-shrink-0">
            <Icon name="Navigation" size={18} className="text-cyan-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-white truncate">{nextInstruction.text}</div>
            <div className="text-xs text-slate-500">{nextInstruction.distance ? `In ${(nextInstruction.distance / 1000).toFixed(1)}km` : ''}</div>
          </div>
        </div>
      )}

      {/* ETA + Distance */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-[#0d1426]/95 border border-slate-800/60 rounded-xl p-3 backdrop-blur-sm">
          <TelemetryValue label="ETA" value={eta ? new Date(eta).toLocaleTimeString('en-GB', { hour12: false, hour: '2-digit', minute: '2-digit' }) : '—'} size="md" />
        </div>
        <div className="bg-[#0d1426]/95 border border-slate-800/60 rounded-xl p-3 backdrop-blur-sm">
          <TelemetryValue label="Remaining" value={distanceLeft ? `${(distanceLeft / 1000).toFixed(1)}` : '—'} unit="km" size="md" />
        </div>
      </div>
    </div>
  )
}
