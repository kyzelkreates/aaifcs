/**
 * APEX AI — Vehicle Table Component
 */

import Icon from './components_ui_Icon'
import Badge from './components_ui_Badge'
import StatusDot from './components_ui_StatusDot'
import { STATUS_COLORS } from './services_fleet_fleetService'
import { formatDistance } from './utils_format'

const COLS = [
  { key: 'reg_number', label: 'Vehicle',     width: 'w-36' },
  { key: 'status',     label: 'Status',      width: 'w-28' },
  { key: 'type',       label: 'Type',        width: 'w-24' },
  { key: 'driver',     label: 'Driver',      width: 'w-40' },
  { key: 'odometer',   label: 'Odometer',    width: 'w-28' },
  { key: 'fuel',       label: 'Fuel',        width: 'w-20' },
  { key: 'location',   label: 'Location',    width: 'flex-1' },
  { key: 'actions',    label: '',            width: 'w-16' },
]

function FuelBar({ value }) {
  const color = value > 50 ? 'bg-emerald-500' : value > 20 ? 'bg-amber-500' : 'bg-red-500'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} />
      </div>
      <span className="text-xs font-mono text-slate-400 w-8 text-right">{value}%</span>
    </div>
  )
}

export default function VehicleTable({ vehicles, selectedIds, onSelect, onSelectAll, onRowClick, onEdit, onDelete }) {
  const allSelected = vehicles.length > 0 && selectedIds.length === vehicles.length

  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-800/60">
            <th className="w-10 px-4 py-3">
              <div
                className={`w-4 h-4 rounded border cursor-pointer transition-all ${
                  allSelected ? 'bg-cyan-500 border-cyan-500' : 'border-slate-700 hover:border-slate-500'
                } flex items-center justify-center`}
                onClick={onSelectAll}
              >
                {allSelected && <Icon name="Check" size={10} className="text-white" />}
              </div>
            </th>
            {COLS.map(c => (
              <th key={c.key} className={`px-3 py-3 text-left text-2xs font-semibold tracking-widest uppercase text-slate-600 ${c.width}`}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {vehicles.map(v => {
            const sel    = selectedIds.includes(v.id)
            const dot    = v.status === 'active' ? 'online' : v.status === 'idle' ? 'idle' : v.status === 'maintenance' ? 'warning' : 'offline'
            const variant = STATUS_COLORS[v.status] || 'muted'
            return (
              <tr
                key={v.id}
                onClick={() => onRowClick?.(v)}
                className={`border-b border-slate-800/40 cursor-pointer transition-colors ${
                  sel ? 'bg-cyan-500/5' : 'hover:bg-slate-800/30'
                }`}
              >
                <td className="px-4 py-3" onClick={e => { e.stopPropagation(); onSelect?.(v.id) }}>
                  <div className={`w-4 h-4 rounded border transition-all ${
                    sel ? 'bg-cyan-500 border-cyan-500' : 'border-slate-700'
                  } flex items-center justify-center`}>
                    {sel && <Icon name="Check" size={10} className="text-white" />}
                  </div>
                </td>
                <td className="px-3 py-3">
                  <div className="font-mono font-semibold text-white">{v.reg_number || 'UNREG'}</div>
                  <div className="text-2xs text-slate-500">{v.make} {v.model}</div>
                </td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-1.5">
                    <StatusDot status={dot} />
                    <Badge variant={variant} size="sm">{v.status}</Badge>
                  </div>
                </td>
                <td className="px-3 py-3 text-xs text-slate-400 capitalize">{v.type || '—'}</td>
                <td className="px-3 py-3 text-xs text-slate-300">{v.driver_name || <span className="text-slate-600">Unassigned</span>}</td>
                <td className="px-3 py-3 text-xs font-mono text-slate-400">{v.odometer_km ? formatDistance(v.odometer_km * 1000) : '—'}</td>
                <td className="px-3 py-3 w-20">
                  {v.fuel_level != null ? <FuelBar value={v.fuel_level} /> : <span className="text-slate-600 text-xs">—</span>}
                </td>
                <td className="px-3 py-3 text-xs text-slate-500 truncate max-w-xs">{v.last_location || '—'}</td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-1">
                    <button onClick={e => { e.stopPropagation(); onEdit?.(v) }} className="p-1 rounded hover:bg-slate-800 text-slate-600 hover:text-slate-300 transition-colors">
                      <Icon name="Pencil" size={13} />
                    </button>
                    <button onClick={e => { e.stopPropagation(); onDelete?.(v) }} className="p-1 rounded hover:bg-red-500/10 text-slate-600 hover:text-red-400 transition-colors">
                      <Icon name="Trash2" size={13} />
                    </button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {vehicles.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-slate-600">
          <Icon name="Truck" size={32} className="mb-3 opacity-30" />
          <p className="text-sm">No vehicles found</p>
        </div>
      )}
    </div>
  )
}
