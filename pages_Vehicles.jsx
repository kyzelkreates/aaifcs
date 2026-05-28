/**
 * ============================================================
 * APEX AI — Vehicles Detail Page (Full Build)
 * Individual vehicle profile · telemetry · history · service log
 * Rendered from /vehicles route (browse) + /vehicles/:id (detail)
 * ============================================================
 */

import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Icon from './components_ui_Icon'
import Badge from './components_ui_Badge'
import StatusDot from './components_ui_StatusDot'
import TelemetryValue from './components_ui_TelemetryValue'
import VehicleModal from './modules_fleet_VehicleModal'
import { useFleetStore } from './core_storage'
import { fleetService, VEHICLE_STATUS } from './services_fleet_fleetService'
import { formatDate, formatDateTime } from './utils_format'

// ─── Vehicle Profile Card ─────────────────────────────────────
function VehicleProfile({ vehicle, onEdit }) {
  const statusDot = vehicle.status === VEHICLE_STATUS.ACTIVE ? 'online' : vehicle.status === VEHICLE_STATUS.IDLE ? 'idle' : vehicle.status === VEHICLE_STATUS.MAINTENANCE ? 'warning' : 'offline'
  const nextService = vehicle.next_service ? new Date(vehicle.next_service) : null
  const serviceDue  = nextService ? Math.ceil((nextService - Date.now()) / 86400000) : null

  return (
    <div className="bg-[#0d1426] border border-slate-800/60 rounded-xl p-6">
      <div className="flex items-start justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center justify-center">
            <Icon name="Truck" size={22} className="text-slate-500" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-mono font-bold text-xl text-white">{vehicle.reg_number}</h2>
              <StatusDot status={statusDot} />
            </div>
            <div className="text-sm text-slate-500 mt-0.5">{[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ')}</div>
          </div>
        </div>
        <button onClick={onEdit}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-400 border border-slate-800 rounded-lg hover:text-white hover:border-slate-700 transition-colors">
          <Icon name="Pencil" size={12} />Edit
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {[
          ['VIN',           vehicle.vin       || '—'],
          ['Type',          vehicle.type?.toUpperCase() || '—'],
          ['Fuel Type',     vehicle.fuel_type || '—'],
          ['Odometer',      vehicle.odometer_km ? `${vehicle.odometer_km.toLocaleString()} km` : '—'],
          ['Driver',        vehicle.driver_name || 'Unassigned'],
          ['Last Service',  vehicle.last_service ? formatDate(vehicle.last_service) : '—'],
        ].map(([l, v]) => (
          <div key={l} className="bg-slate-900/40 border border-slate-800/40 rounded-lg p-3">
            <div className="text-2xs text-slate-600 uppercase tracking-widest font-semibold mb-1">{l}</div>
            <div className="text-sm text-slate-300 font-medium">{v}</div>
          </div>
        ))}
      </div>

      {serviceDue !== null && (
        <div className={`mt-3 flex items-center gap-2 text-xs px-3 py-2 rounded-lg border ${
          serviceDue < 0  ? 'bg-red-500/5 border-red-500/20 text-red-400'    :
          serviceDue < 14 ? 'bg-amber-500/5 border-amber-500/20 text-amber-400' :
          'bg-emerald-500/5 border-emerald-500/20 text-emerald-400'
        }`}>
          <Icon name="Wrench" size={12} />
          {serviceDue < 0
            ? `Service overdue by ${Math.abs(serviceDue)} days`
            : serviceDue === 0 ? 'Service due today'
            : `Next service in ${serviceDue} days (${formatDate(vehicle.next_service)})`}
        </div>
      )}
    </div>
  )
}

// ─── Live Telemetry Card ──────────────────────────────────────
function TelemetryCard({ vehicle }) {
  const [live, setLive] = useState({
    speed:     vehicle.speed     ?? 0,
    fuel:      vehicle.fuel_level ?? 0,
    lat:       vehicle.lat       ?? null,
    lng:       vehicle.lng       ?? null,
  })

  useEffect(() => {
    if (vehicle.status !== VEHICLE_STATUS.ACTIVE) return
    const id = setInterval(() => {
      setLive(l => ({
        ...l,
        speed: Math.max(0, Math.min(90, l.speed + (Math.random() - 0.5) * 6)),
        fuel:  Math.max(0, l.fuel - 0.001),
      }))
    }, 3000)
    return () => clearInterval(id)
  }, [vehicle.status])

  return (
    <div className="bg-[#0d1426] border border-slate-800/60 rounded-xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <Icon name="Activity" size={14} className="text-cyan-400" />
        <span className="text-sm font-semibold text-white">Live Telemetry</span>
        {vehicle.status === VEHICLE_STATUS.ACTIVE && (
          <div className="ml-auto flex items-center gap-1.5 text-xs text-cyan-400 bg-cyan-500/5 border border-cyan-500/20 px-2 py-0.5 rounded-full">
            <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />Live
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <TelemetryValue label="Speed"  value={Math.round(live.speed)} unit="km/h" size="md" status={live.speed > 80 ? 'warning' : 'nominal'} />
        <TelemetryValue label="Fuel"   value={Math.round(live.fuel)}  unit="%"    size="md" status={live.fuel < 20 ? 'critical' : live.fuel < 35 ? 'warning' : 'nominal'} />
        <TelemetryValue label="Lat"    value={live.lat != null ? live.lat.toFixed(4) : '—'} size="md" />
        <TelemetryValue label="Lng"    value={live.lng != null ? live.lng.toFixed(4) : '—'} size="md" />
      </div>
      {vehicle.status !== VEHICLE_STATUS.ACTIVE && (
        <p className="text-xs text-slate-600 text-center mt-3">Telemetry streaming when vehicle is active</p>
      )}
    </div>
  )
}

// ─── Service History (demo) ───────────────────────────────────
function ServiceHistory({ vehicle }) {
  const demo = [
    { date: '2026-01-10', type: 'Full Service',      mileage: '122,400 km', notes: 'Oil, filters, brake fluid, tyres rotated' },
    { date: '2025-08-14', type: 'MOT',               mileage: '108,200 km', notes: 'Pass — advisory on front wiper blades'  },
    { date: '2025-03-02', type: 'Brake Service',     mileage: '98,500 km',  notes: 'Front pads and discs replaced'          },
    { date: '2024-09-20', type: 'Full Service',      mileage: '87,000 km',  notes: 'Annual service, new air filter'         },
  ]
  return (
    <div className="bg-[#0d1426] border border-slate-800/60 rounded-xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <Icon name="Wrench" size={14} className="text-slate-500" />
        <span className="text-sm font-semibold text-white">Service History</span>
        <span className="text-2xs text-slate-600 ml-auto">Demo data</span>
      </div>
      <div className="space-y-3">
        {demo.map((s, i) => (
          <div key={i} className="flex items-start gap-3">
            <div className="flex flex-col items-center flex-shrink-0">
              <div className="w-2 h-2 rounded-full bg-slate-700 mt-1.5" />
              {i < demo.length - 1 && <div className="w-px flex-1 bg-slate-800/60 my-1 min-h-[20px]" />}
            </div>
            <div className="pb-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-white">{s.type}</span>
                <span className="text-2xs text-slate-600 font-mono">{s.date}</span>
              </div>
              <div className="text-2xs text-slate-500 mt-0.5">{s.mileage} · {s.notes}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Browse view (no vehicle selected) ────────────────────────
function VehicleBrowse({ vehicles, isLoading, onSelect }) {
  const [search,      setSearch]      = useState('')
  const [statusFilter, setStatusFilter] = useState(null)

  const filtered = vehicles.filter(v => {
    if (statusFilter && v.status !== statusFilter) return false
    if (!search) return true
    const q = search.toLowerCase()
    return v.reg_number?.toLowerCase().includes(q) ||
           v.make?.toLowerCase().includes(q) ||
           v.driver_name?.toLowerCase().includes(q)
  })

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-slate-800/60 flex-shrink-0">
        <h1 className="font-display text-xl font-bold text-white mb-4">Vehicles</h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Icon name="Search" size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…" className="apex-input pl-8 py-1.5 text-xs" />
          </div>
          {[null, 'active', 'idle', 'maintenance'].map(s => (
            <button key={String(s)} onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-md text-xs capitalize transition-all ${
                statusFilter === s ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-300'
              }`}>{s || 'All'}</button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="flex items-center justify-center h-48 text-slate-600 gap-2">
            <Icon name="Loader2" size={18} className="animate-spin" /><span className="text-sm">Loading…</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map(v => {
              const dot = v.status === 'active' ? 'online' : v.status === 'idle' ? 'idle' : 'offline'
              return (
                <button key={v.id} onClick={() => onSelect(v)}
                  className="bg-[#0d1426] border border-slate-800/60 rounded-xl p-4 text-left hover:border-slate-700/60 hover:bg-slate-800/20 transition-all group">
                  <div className="flex items-center gap-2.5 mb-3">
                    <StatusDot status={dot} />
                    <span className="font-mono font-bold text-sm text-white group-hover:text-cyan-200 transition-colors">{v.reg_number}</span>
                    <span className={`ml-auto text-2xs px-2 py-0.5 rounded border capitalize ${
                      v.status === 'active'      ? 'bg-cyan-500/10 border-cyan-500/20 text-cyan-400'    :
                      v.status === 'idle'        ? 'bg-amber-500/10 border-amber-500/20 text-amber-400' :
                      v.status === 'maintenance' ? 'bg-violet-500/10 border-violet-500/20 text-violet-400':
                      'bg-slate-800 border-slate-700 text-slate-500'
                    }`}>{v.status}</span>
                  </div>
                  <div className="text-xs text-slate-500 mb-2">{[v.year, v.make, v.model].filter(Boolean).join(' ') || 'Unknown model'}</div>
                  {v.driver_name && <div className="text-xs text-slate-600 flex items-center gap-1"><Icon name="User" size={10} />{v.driver_name}</div>}
                  {v.fuel_level != null && (
                    <div className="mt-2.5 flex items-center gap-2">
                      <div className="flex-1 h-1 bg-slate-800 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${v.fuel_level > 40 ? 'bg-emerald-500' : v.fuel_level > 20 ? 'bg-amber-500' : 'bg-red-500'}`}
                          style={{ width: `${v.fuel_level}%` }} />
                      </div>
                      <span className="text-2xs font-mono text-slate-500">{v.fuel_level}%</span>
                    </div>
                  )}
                </button>
              )
            })}
            {filtered.length === 0 && (
              <div className="col-span-full flex flex-col items-center justify-center py-16 text-slate-600">
                <Icon name="Truck" size={36} className="mb-3 opacity-20" />
                <p className="text-sm">No vehicles found</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Vehicles Page Root ───────────────────────────────────────
export default function Vehicles() {
  const { vehicleId }  = useParams()
  const navigate       = useNavigate()
  const { vehicles, isLoading } = useFleetStore(s => ({ vehicles: s.vehicles, isLoading: s.isLoading }))
  const [modal, setModal] = useState(null)

  useEffect(() => { (async () => { await fleetService.fetchVehicles() })() }, [])

  const selected = vehicleId ? vehicles.find(v => v.id === vehicleId) || null : null

  if (!vehicleId || !selected) {
    return (
      <VehicleBrowse
        vehicles={vehicles}
        isLoading={isLoading}
        onSelect={v => navigate(`/vehicles/${v.id}`)}
      />
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-3.5 border-b border-slate-800/60 flex items-center gap-3 flex-shrink-0">
        <button onClick={() => navigate('/vehicles')}
          className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors">
          <Icon name="ChevronLeft" size={13} />Vehicles
        </button>
        <span className="text-slate-700">/</span>
        <span className="text-xs font-mono font-semibold text-white">{selected.reg_number}</span>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-4 max-w-4xl">
        <VehicleProfile vehicle={selected} onEdit={() => setModal(selected)} />
        <TelemetryCard vehicle={selected} />
        <ServiceHistory vehicle={selected} />
      </div>

      {modal && (
        <VehicleModal vehicle={modal} onClose={() => setModal(null)} onSaved={async () => { await fleetService.fetchVehicles(); setModal(null) }} />
      )}
    </div>
  )
}
