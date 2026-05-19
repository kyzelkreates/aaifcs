/**
 * APEX AI — Vehicle Card Component
 */

import Icon from './components_ui_Icon'
import Badge from './components_ui_Badge'
import StatusDot from './components_ui_StatusDot'
import { VEHICLE_STATUS, STATUS_COLORS } from './services_fleet_fleetService'
import { formatDistance } from './utils_format'

const TYPE_ICONS = {
  hgv: 'Truck', van: 'Package', car: 'Car',
  tanker: 'Droplets', reefer: 'Thermometer',
  flatbed: 'Layers', minibus: 'Bus'
}

export default function VehicleCard({ vehicle, selected, onSelect, onClick }) {
  const icon    = TYPE_ICONS[vehicle.type] || 'Truck'
  const variant = STATUS_COLORS[vehicle.status] || 'muted'
  const statusDot = vehicle.status === 'active' ? 'online'
    : vehicle.status === 'idle'        ? 'idle'
    : vehicle.status === 'maintenance' ? 'warning'
    : 'offline'

  return (
    <div
      onClick={onClick}
      className={`
        relative bg-[#0d1426] border rounded-lg p-4 cursor-pointer
        transition-all duration-150 group
        ${selected
          ? 'border-cyan-500/50 shadow-[0_0_20px_rgba(0,212,255,0.08)]'
          : 'border-slate-800/60 hover:border-slate-700/60'}
      `}
    >
      {/* Select checkbox */}
      <div
        className="absolute top-3 right-3 z-10"
        onClick={e => { e.stopPropagation(); onSelect?.() }}
      >
        <div className={`w-4 h-4 rounded border transition-all ${
          selected ? 'bg-cyan-500 border-cyan-500' : 'border-slate-700 hover:border-slate-500'
        } flex items-center justify-center`}>
          {selected && <Icon name="Check" size={10} className="text-white" />}
        </div>
      </div>

      {/* Active indicator */}
      {vehicle.status === 'active' && (
        <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-transparent via-cyan-500/60 to-transparent rounded-t-lg" />
      )}

      {/* Header */}
      <div className="flex items-start gap-3 mb-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
          vehicle.status === 'active' ? 'bg-cyan-500/10 border border-cyan-500/20' : 'bg-slate-800/60 border border-slate-800'
        }`}>
          <Icon name={icon} size={18} className={vehicle.status === 'active' ? 'text-cyan-400' : 'text-slate-500'} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-mono text-sm font-semibold text-white truncate">
            {vehicle.reg_number || 'UNREG'}
          </div>
          <div className="text-xs text-slate-500 truncate">
            {vehicle.make} {vehicle.model} · {vehicle.year || '—'}
          </div>
        </div>
      </div>

      {/* Status + badge */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5">
          <StatusDot status={statusDot} />
          <Badge variant={variant} size="sm">
            {vehicle.status?.replace('_', ' ') || '—'}
          </Badge>
        </div>
        <span className="text-2xs text-slate-600 uppercase tracking-widest font-medium">
          {vehicle.type?.toUpperCase() || '—'}
        </span>
      </div>

      {/* Telemetry row */}
      <div className="grid grid-cols-3 gap-2 pt-3 border-t border-slate-800/60">
        {[
          { label: 'Odometer', value: vehicle.odometer_km ? formatDistance(vehicle.odometer_km * 1000) : '—' },
          { label: 'Fuel',     value: vehicle.fuel_level != null ? `${vehicle.fuel_level}%` : '—' },
          { label: 'Driver',   value: vehicle.driver_name || 'Unassigned' }
        ].map(({ label, value }) => (
          <div key={label} className="flex flex-col">
            <span className="text-2xs text-slate-600 uppercase tracking-widest">{label}</span>
            <span className="text-xs text-slate-300 font-mono truncate mt-0.5">{value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
