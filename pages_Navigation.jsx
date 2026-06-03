/**
 * ============================================================
 * APEX AI — Live Navigation / Fleet Map Page
 * ============================================================
 * Changes vs previous:
 *  - Live map crash fixed (NaN/null coordinate guards everywhere)
 *  - RoutePlanner now offers "Create Job from Route" after planning
 *  - CreateJobFromRouteModal: creates a real task in Dispatch
 *    via dispatchService.createJob — appears in Dispatch board
 *    immediately via Supabase Realtime
 *  - Stops input in Route Planner (add/remove waypoints)
 *  - AI routing label shown (GH / OSRM / GMaps)
 * ============================================================
 */

import { useState, useEffect, useCallback, useRef, Suspense, lazy } from 'react'
import { useNavigate } from 'react-router-dom'
import Icon from './components_ui_Icon'
import Badge from './components_ui_Badge'
import StatusDot from './components_ui_StatusDot'
import TelemetryValue from './components_ui_TelemetryValue'
import MapControls from './modules_navigation_MapControls'
import { useMapStore, useFleetStore } from './core_storage'
import { mapService } from './services_maps_mapService'
import { fleetService } from './services_fleet_fleetService'
import { dispatchService, JOB_PRIORITY } from './services_dispatch_dispatchService'
import { formatDistance, formatDuration } from './utils_format'
import {
  subscribeToDriverLocations, getLiveDriverPositions,
} from './services_sync_liveSync'
import { getDrivers, getVehicles } from './services_backend_backendService'

const ApexMap = lazy(() => import('./modules_navigation_ApexMap'))

// ─── Loading Spinner ──────────────────────────────────────────
function MapLoader() {
  return (
    <div className="flex flex-col items-center justify-center h-full bg-[#050810] gap-3">
      <div className="w-10 h-10 border-2 border-cyan-500/20 border-t-cyan-400 rounded-full animate-spin" />
      <span className="text-xs text-slate-600 font-mono tracking-widest">LOADING MAP</span>
    </div>
  )
}

// ─── Vehicle Detail Panel ─────────────────────────────────────
function VehiclePanel({ vehicle, onClose, onFocus }) {
  if (!vehicle) return null
  const statusDot = vehicle.status === 'active' ? 'online' : vehicle.status === 'idle' ? 'idle' : 'offline'
  return (
    <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-[999] w-80 pointer-events-auto">
      <div className="bg-[#0d1426]/97 border border-slate-700/60 rounded-xl p-4 backdrop-blur-sm shadow-2xl">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <StatusDot status={statusDot} />
            <div>
              <div className="font-mono font-bold text-cyan-400 text-sm">{vehicle.label}</div>
              <div className="text-xs text-slate-500">{vehicle.sublabel || 'No driver assigned'}</div>
            </div>
          </div>
          <button onClick={onClose} className="p-1 text-slate-600 hover:text-slate-400 transition-colors">
            <Icon name="X" size={14} />
          </button>
        </div>
        <div className="grid grid-cols-3 gap-3 mb-3">
          <TelemetryValue label="Speed" value={vehicle.speed ?? '—'} unit="km/h" size="sm"
            status={vehicle.speed > 90 ? 'warning' : 'nominal'} />
          <TelemetryValue label="Fuel" value={vehicle.fuel ?? '—'} unit="%" size="sm"
            status={vehicle.fuel < 20 ? 'critical' : vehicle.fuel < 35 ? 'warning' : 'nominal'} />
          <TelemetryValue label="Status" value={vehicle.status?.replace('_', ' ') || '—'} size="sm" />
        </div>
        <div className="flex gap-2">
          <button onClick={() => onFocus?.(vehicle)}
            className="flex-1 py-1.5 text-xs bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 rounded hover:bg-cyan-500/15 transition-colors">
            <Icon name="Crosshair" size={11} className="inline mr-1" />Focus
          </button>
          <button className="flex-1 py-1.5 text-xs bg-slate-800/60 border border-slate-700/40 text-slate-400 rounded hover:bg-slate-800 transition-colors">
            <Icon name="Route" size={11} className="inline mr-1" />Route To
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Fleet Sidebar ────────────────────────────────────────────
function FleetSidebar({ vehicles, activeId, onSelect, isLoading }) {
  const [search, setSearch] = useState('')
  const filtered = vehicles.filter(v =>
    !search || v.reg_number?.toLowerCase().includes(search.toLowerCase()) ||
    v.driver_name?.toLowerCase().includes(search.toLowerCase())
  )
  const activeCount = vehicles.filter(v => v.status === 'active').length

  return (
    <div className="absolute top-4 left-4 z-[999] w-60 pointer-events-auto">
      <div className="bg-[#0d1426]/97 border border-slate-700/50 rounded-xl overflow-hidden backdrop-blur-sm shadow-2xl">
        <div className="px-3 py-2.5 border-b border-slate-800/60 flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-200">Live Fleet</span>
          <div className="flex items-center gap-1.5">
            {isLoading
              ? <Icon name="Loader2" size={11} className="text-slate-600 animate-spin" />
              : <StatusDot status="online" />
            }
            <span className="text-2xs text-slate-500 font-mono">{activeCount}/{vehicles.length}</span>
          </div>
        </div>
        <div className="px-2 py-2 border-b border-slate-800/40">
          <div className="relative">
            <Icon name="Search" size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-600" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..."
              className="w-full bg-slate-900/60 border border-slate-800/60 rounded text-xs text-slate-300 pl-7 pr-2 py-1.5 outline-none focus:border-slate-600/60 placeholder:text-slate-700" />
          </div>
        </div>
        <div className="max-h-64 overflow-y-auto scrollbar-none">
          {filtered.length === 0 && (
            <div className="px-3 py-5 text-xs text-slate-700 text-center">
              {vehicles.length === 0 ? 'No vehicles in fleet' : 'No results'}
            </div>
          )}
          {filtered.map(v => {
            const dot = v.status === 'active' ? 'online' : v.status === 'idle' ? 'idle' : 'offline'
            return (
              <button key={v.id} onClick={() => onSelect(v)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors border-b border-slate-800/20 last:border-0 ${
                  activeId === v.id ? 'bg-cyan-500/8 border-l-2 border-l-cyan-500' : 'hover:bg-slate-800/40'
                }`}>
                <StatusDot status={dot} />
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-xs font-semibold text-white truncate">{v.reg_number}</div>
                  <div className="text-2xs text-slate-500 truncate">{v.driver_name || 'Unassigned'}</div>
                </div>
                {v.status === 'active' && v.speed != null && (
                  <span className="text-2xs font-mono text-cyan-400/70 flex-shrink-0">{v.speed}km/h</span>
                )}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── Create Job from Route Modal ──────────────────────────────
function CreateJobModal({ routeData, drivers, vehicles, onClose, onCreated }) {
  const [title,     setTitle]     = useState('')
  const [priority,  setPriority]  = useState(JOB_PRIORITY.NORMAL)
  const [driverId,  setDriverId]  = useState('')
  const [vehicleId, setVehicleId] = useState('')
  const [notes,     setNotes]     = useState('')
  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState(null)

  const { origin, destination, stops = [], route } = routeData

  const handleCreate = async () => {
    if (!title.trim()) { setError('Job title is required'); return }
    setSaving(true); setError(null)
    try {
      const driver  = drivers.find(d => d.id === driverId)
      const vehicle = vehicles.find(v => v.id === vehicleId)

      // Build stops payload — include all intermediate stops + destination
      const stopsPayload = [
        ...stops.map((s, i) => ({
          idx:     i + 1,
          address: s.address || s.name || '',
          name:    s.name || `Stop ${i + 1}`,
          geocoded: s.geocoded || null,
        })),
        {
          idx:     stops.length + 1,
          address: destination.address || destination.name || `${destination.lat},${destination.lng}`,
          name:    'Destination',
          geocoded: { lat: destination.lat, lng: destination.lng },
        },
      ]

      await dispatchService.createJob({
        title:           title.trim(),
        priority,
        notes:           notes.trim() || null,
        pickup_address:  origin.address || origin.name || `${origin.lat},${origin.lng}`,
        dropoff_address: destination.address || destination.name || `${destination.lat},${destination.lng}`,
        stops:           stopsPayload,
        driver_id:       driverId   || null,
        vehicle_id:      vehicleId  || null,
        driver_name:     driver?.full_name  || driver?.name  || '',
        vehicle_reg:     vehicle?.reg_number || '',
        route_summary: route ? {
          distance: route.distance,
          duration: route.duration,
          source:   route.source || route.activeProvider || 'osm',
        } : null,
      })
      onCreated?.()
      onClose?.()
    } catch (err) {
      setError(err.message || 'Failed to create job')
      setSaving(false)
    }
  }

  const fmtDist = m => m >= 1000 ? `${(m/1000).toFixed(1)} km` : `${Math.round(m)} m`
  const fmtDur  = s => { const h = Math.floor(s/3600), m = Math.floor((s%3600)/60); return h > 0 ? `${h}h ${m}m` : `${m} min` }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[1200] flex items-end sm:items-center justify-center sm:p-4">
      <div className="bg-[#0a0f1e] border border-slate-800/60 sm:rounded-2xl rounded-t-2xl w-full sm:max-w-lg shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800/50">
          <div>
            <h2 className="font-semibold text-white text-sm">Create Job from Route</h2>
            <p className="text-2xs text-slate-600 mt-0.5">This job will appear in the Dispatch board immediately</p>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-500 hover:text-white rounded-lg hover:bg-slate-800 transition-colors">
            <Icon name="X" size={15} />
          </button>
        </div>

        {/* Route summary strip */}
        {route && (
          <div className="px-5 py-2.5 bg-cyan-500/5 border-b border-cyan-500/10 flex items-center gap-4">
            <div className="flex items-center gap-1.5 text-xs text-slate-300">
              <Icon name="Route" size={11} className="text-cyan-400" />
              <span className="font-mono font-semibold text-cyan-400">{fmtDist(route.distance)}</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-slate-300">
              <Icon name="Clock" size={11} className="text-cyan-400" />
              <span className="font-mono font-semibold">{fmtDur(route.duration)}</span>
            </div>
            <span className="text-2xs text-slate-600 ml-auto font-mono uppercase tracking-wide">
              via {route.source || route.activeProvider || 'OSM'}
            </span>
          </div>
        )}

        {/* Origin → Destination */}
        <div className="px-5 py-3 border-b border-slate-800/40 space-y-1.5">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <div className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />
            <span className="truncate">{origin.address || origin.name || 'Origin'}</span>
          </div>
          {stops.map((s, i) => (
            <div key={i} className="flex items-center gap-2 text-xs text-slate-500 pl-1">
              <div className="w-5 h-5 rounded-full bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-[9px] font-bold text-amber-400 flex-shrink-0">{i+1}</div>
              <span className="truncate">{s.address || s.name}</span>
            </div>
          ))}
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <div className="w-2 h-2 rounded-full bg-red-400 flex-shrink-0" />
            <span className="truncate">{destination.address || destination.name || 'Destination'}</span>
          </div>
        </div>

        {/* Form */}
        <div className="px-5 py-4 space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs text-slate-400 font-medium">Job Title <span className="text-red-400">*</span></label>
            <input value={title} onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Delivery — Manchester DC"
              className="w-full bg-slate-900/70 border border-slate-800/60 rounded-lg text-xs text-slate-300 px-3 py-2 outline-none focus:border-cyan-500/40 placeholder:text-slate-700" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs text-slate-400 font-medium">Priority</label>
              <select value={priority} onChange={e => setPriority(e.target.value)}
                className="w-full bg-slate-900/70 border border-slate-800/60 rounded-lg text-xs text-slate-300 px-3 py-2 outline-none focus:border-cyan-500/40">
                {Object.entries(JOB_PRIORITY).map(([k, v]) => <option key={k} value={v}>{k}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-slate-400 font-medium">Assign Driver</label>
              <select value={driverId} onChange={e => setDriverId(e.target.value)}
                className="w-full bg-slate-900/70 border border-slate-800/60 rounded-lg text-xs text-slate-300 px-3 py-2 outline-none focus:border-cyan-500/40">
                <option value="">Select driver…</option>
                {drivers.map(d => <option key={d.id} value={d.id}>{d.full_name || d.name}</option>)}
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-slate-400 font-medium">Vehicle</label>
            <select value={vehicleId} onChange={e => setVehicleId(e.target.value)}
              className="w-full bg-slate-900/70 border border-slate-800/60 rounded-lg text-xs text-slate-300 px-3 py-2 outline-none focus:border-cyan-500/40">
              <option value="">Select vehicle…</option>
              {vehicles.map(v => <option key={v.id} value={v.id}>{v.reg_number} — {v.make || ''}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-slate-400 font-medium">Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              placeholder="Any special instructions…"
              className="w-full bg-slate-900/70 border border-slate-800/60 rounded-lg text-xs text-slate-300 px-3 py-2 outline-none focus:border-cyan-500/40 placeholder:text-slate-700 resize-none" />
          </div>

          {error && (
            <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/8 border border-red-500/20 rounded-lg px-3 py-2">
              <Icon name="AlertCircle" size={12} />
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-5 pb-5">
          <button onClick={onClose}
            className="flex-1 py-2.5 text-xs text-slate-400 border border-slate-700/60 rounded-lg hover:bg-slate-800/40 transition-colors">
            Cancel
          </button>
          <button onClick={handleCreate} disabled={saving || !title.trim()}
            className="flex-1 py-2.5 text-xs bg-cyan-500/15 border border-cyan-500/30 text-cyan-400 rounded-lg hover:bg-cyan-500/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors font-semibold flex items-center justify-center gap-2">
            {saving
              ? <><Icon name="Loader2" size={12} className="animate-spin" /> Creating…</>
              : <><Icon name="PlusCircle" size={12} /> Create Job</>
            }
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Route Planner ────────────────────────────────────────────
function RoutePlanner({ onRoute, onClear, drivers, vehicles }) {
  const [from,    setFrom]    = useState('')
  const [to,      setTo]      = useState('')
  const [stops,   setStops]   = useState([])          // intermediate stops
  const [loading, setLoading] = useState(false)
  const [result,  setResult]  = useState(null)
  const [error,   setError]   = useState(null)
  const [open,    setOpen]    = useState(true)
  const [showCreateJob, setShowCreateJob] = useState(false)
  const [jobCreated,    setJobCreated]    = useState(false)

  const addStop    = () => setStops(s => [...s, { id: Date.now(), address: '' }])
  const removeStop = (id) => setStops(s => s.filter(x => x.id !== id))
  const updateStop = (id, val) => setStops(s => s.map(x => x.id === id ? { ...x, address: val } : x))

  const plan = async () => {
    if (!from.trim() || !to.trim()) return
    setLoading(true); setError(null); setResult(null); setJobCreated(false)
    try {
      const [origins, destinations] = await Promise.all([
        mapService.geocode(from),
        mapService.geocode(to),
      ])
      if (!origins?.length)      { setError('Origin not found');      setLoading(false); return }
      if (!destinations?.length) { setError('Destination not found'); setLoading(false); return }

      // Geocode intermediate stops
      const geocodedStops = []
      for (const s of stops.filter(s => s.address.trim())) {
        try {
          const res = await mapService.geocode(s.address)
          if (res?.length) geocodedStops.push({ ...s, geocoded: { lat: res[0].lat, lng: res[0].lng, address: res[0].address || res[0].name } })
        } catch {}
      }

      // Route: origin → (stops) → destination — use first stop→dest only for display
      const route = await mapService.route(
        { lat: origins[0].lat,      lng: origins[0].lng },
        { lat: destinations[0].lat, lng: destinations[0].lng }
      )
      if (!route) { setError('No route found'); setLoading(false); return }

      const res = {
        route,
        origin:      { ...origins[0],      address: origins[0].address      || from },
        destination: { ...destinations[0], address: destinations[0].address || to   },
        stops:       geocodedStops,
      }
      setResult(res)
      onRoute?.(route, origins[0], destinations[0], geocodedStops)
    } catch (err) {
      setError(err.message || 'Routing failed')
    } finally {
      setLoading(false)
    }
  }

  const clear = () => {
    setFrom(''); setTo(''); setStops([]); setResult(null); setError(null); setJobCreated(false)
    onClear?.()
  }

  if (!open) {
    return (
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[999] pointer-events-auto">
        <button onClick={() => setOpen(true)}
          className="flex items-center gap-2 px-4 py-2 bg-[#0d1426]/97 border border-slate-700/50 rounded-xl text-xs text-slate-400 hover:text-white backdrop-blur-sm shadow-xl transition-colors">
          <Icon name="Route" size={12} className="text-cyan-400" />
          Route Planner
        </button>
      </div>
    )
  }

  return (
    <>
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[999] w-[440px] pointer-events-auto">
        <div className="bg-[#0d1426]/97 border border-slate-700/50 rounded-xl p-3 backdrop-blur-sm shadow-2xl">

          {/* Header */}
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Icon name="Route" size={12} className="text-cyan-400" />
              <span className="text-xs font-semibold text-slate-200">Route Planner</span>
              <span className="text-2xs text-slate-600 font-mono">GH → OSRM fallback</span>
            </div>
            <button onClick={() => setOpen(false)} className="text-slate-600 hover:text-slate-400 p-0.5">
              <Icon name="ChevronUp" size={13} />
            </button>
          </div>

          {/* Origin */}
          <div className="relative mb-1.5">
            <div className="absolute left-2.5 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-emerald-400 border border-emerald-400/40" />
            <input value={from} onChange={e => setFrom(e.target.value)} onKeyDown={e => e.key === 'Enter' && plan()}
              placeholder="From: city, postcode or address"
              className="w-full bg-slate-900/70 border border-slate-800/60 rounded text-xs text-slate-300 pl-7 pr-2 py-2 outline-none focus:border-slate-600/80 placeholder:text-slate-700" />
          </div>

          {/* Intermediate stops */}
          {stops.map((s, i) => (
            <div key={s.id} className="relative mb-1.5 flex items-center gap-1.5">
              <div className="relative flex-1">
                <div className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-[9px] font-bold text-amber-400">{i+1}</div>
                <input value={s.address} onChange={e => updateStop(s.id, e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && plan()}
                  placeholder={`Stop ${i+1}: address or postcode`}
                  className="w-full bg-slate-900/70 border border-amber-500/20 rounded text-xs text-slate-300 pl-7 pr-2 py-2 outline-none focus:border-amber-500/40 placeholder:text-slate-700" />
              </div>
              <button onClick={() => removeStop(s.id)} className="text-slate-600 hover:text-red-400 p-1 flex-shrink-0">
                <Icon name="Minus" size={12} />
              </button>
            </div>
          ))}

          {/* Destination */}
          <div className="relative mb-2">
            <div className="absolute left-2.5 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-red-400 border border-red-400/40" />
            <input value={to} onChange={e => setTo(e.target.value)} onKeyDown={e => e.key === 'Enter' && plan()}
              placeholder="To: city, postcode or address"
              className="w-full bg-slate-900/70 border border-slate-800/60 rounded text-xs text-slate-300 pl-7 pr-2 py-2 outline-none focus:border-slate-600/80 placeholder:text-slate-700" />
          </div>

          {/* Action row */}
          <div className="flex gap-1.5">
            <button onClick={addStop}
              className="px-2.5 py-1.5 text-xs bg-amber-500/8 border border-amber-500/20 text-amber-400 rounded hover:bg-amber-500/12 transition-colors flex items-center gap-1">
              <Icon name="Plus" size={11} />Stop
            </button>
            <button onClick={plan} disabled={loading || !from.trim() || !to.trim()}
              className="flex-1 py-1.5 text-xs bg-cyan-500/15 border border-cyan-500/25 text-cyan-400 rounded hover:bg-cyan-500/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1.5">
              {loading
                ? <><Icon name="Loader2" size={12} className="animate-spin" />Routing…</>
                : <><Icon name="Route" size={12} />Plan Route</>
              }
            </button>
            <button onClick={clear}
              className="px-2.5 py-1.5 bg-slate-800/60 border border-slate-700/40 text-slate-500 rounded text-xs hover:text-slate-300 transition-colors">
              <Icon name="X" size={12} />
            </button>
          </div>

          {/* Route result */}
          {result && (
            <div className="mt-2 pt-2 border-t border-slate-800/40">
              <div className="flex items-center gap-4 mb-2">
                <div className="flex items-center gap-1.5 text-xs text-slate-300">
                  <Icon name="Route" size={11} className="text-cyan-400" />
                  <span className="font-mono font-semibold">{formatDistance(result.route.distance)}</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-slate-300">
                  <Icon name="Clock" size={11} className="text-cyan-400" />
                  <span className="font-mono font-semibold">{formatDuration(result.route.duration)}</span>
                </div>
                <span className="text-2xs text-slate-600 ml-auto font-mono">
                  {result.route.source || result.route.activeProvider || 'osm'}
                </span>
              </div>

              {/* Create Job CTA */}
              {jobCreated ? (
                <div className="flex items-center gap-2 py-2 px-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-xs text-emerald-400">
                  <Icon name="CheckCircle" size={12} />
                  Job created and sent to Dispatch board
                </div>
              ) : (
                <button onClick={() => setShowCreateJob(true)}
                  className="w-full py-2 text-xs bg-violet-500/12 border border-violet-500/25 text-violet-400 rounded-lg hover:bg-violet-500/18 transition-colors flex items-center justify-center gap-1.5 font-semibold">
                  <Icon name="PlusCircle" size={12} />
                  Create Job Assignment from This Route
                </button>
              )}
            </div>
          )}

          {error && (
            <div className="mt-2 flex items-center gap-1.5 text-xs text-red-400">
              <Icon name="AlertCircle" size={11} />
              {error}
            </div>
          )}
        </div>
      </div>

      {/* Create Job Modal */}
      {showCreateJob && result && (
        <CreateJobModal
          routeData={result}
          drivers={drivers}
          vehicles={vehicles}
          onClose={() => setShowCreateJob(false)}
          onCreated={() => {
            setShowCreateJob(false)
            setJobCreated(true)
          }}
        />
      )}
    </>
  )
}

// ─── Navigation Page ──────────────────────────────────────────
export default function Navigation() {
  const { vehicles, isLoading } = useFleetStore(s => ({
    vehicles:  s.vehicles,
    isLoading: s.isLoading,
  }))
  const mapRef             = useRef(null)
  const [selectedVehicle,  setSelectedVehicle]  = useState(null)
  const [mapMarkers,       setMapMarkers]        = useState([])
  const [liveDrivers,      setLiveDrivers]       = useState(() => getLiveDriverPositions())
  const [mapRoutes,        setMapRoutes]         = useState([])
  const [flyTarget,        setFlyTarget]         = useState(null)
  const [drivers,          setDrivers]           = useState([])
  const [fleetVehicles,    setFleetVehicles]     = useState([])
  const navigate = useNavigate()

  useEffect(() => {
    fleetService.fetchVehicles().catch(console.error)
    // Load drivers + vehicles for job creation modal
    getDrivers().then(d => setDrivers(Array.isArray(d) ? d : [])).catch(() => {})
    getVehicles().then(v => setFleetVehicles(Array.isArray(v) ? v : [])).catch(() => {})
  }, [])

  // Build markers from fleet vehicles + live driver positions
  // Guard every lat/lng — Leaflet crashes on NaN/null
  useEffect(() => {
    const vehicleMarkers = vehicles.map(v => ({
      id:       v.id,
      lat:      v.lat,
      lng:      v.lng,
      label:    v.reg_number,
      sublabel: v.driver_name || 'Unassigned',
      status:   v.status,
      speed:    v.speed,
      fuel:     v.fuel_level,
      _type:    'fleet',
    })).filter(m =>
      m.lat != null && m.lng != null &&
      isFinite(Number(m.lat)) && isFinite(Number(m.lng))
    )

    const driverMarkers = liveDrivers.map(pos => {
      const age = Date.now() - new Date(pos.ts).getTime()
      if (age > 5 * 60 * 1000) return null
      if (!isFinite(pos.lat) || !isFinite(pos.lng)) return null
      return {
        id:       `driver-${pos.vehicle_id}`,
        lat:      pos.lat,
        lng:      pos.lng,
        label:    pos.vehicle_id || 'Driver',
        sublabel: `${pos.speed ?? 0} km/h · Live`,
        status:   'active',
        speed:    pos.speed,
        heading:  pos.heading,
        _type:    'driver',
        _live:    true,
      }
    }).filter(Boolean)

    const liveVehicleIds = new Set(liveDrivers.map(p => p.vehicle_id))
    const nonOverridden  = vehicleMarkers.filter(m => !liveVehicleIds.has(m.id))
    setMapMarkers([...driverMarkers, ...nonOverridden])
  }, [vehicles, liveDrivers])

  // Subscribe to live driver location updates
  useEffect(() => {
    const unsub = subscribeToDriverLocations((payload) => {
      if (payload._bulk) {
        setLiveDrivers(payload.positions)
      } else {
        setLiveDrivers(prev => {
          const idx = prev.findIndex(p => p.vehicle_id === payload.vehicle_id)
          if (idx >= 0) { const n = [...prev]; n[idx] = payload; return n }
          return [payload, ...prev]
        })
      }
    })
    return unsub
  }, [])

  const handleRoute = useCallback((route, from, to, stops = []) => {
    const coords = route?.geometry?.coordinates
    if (!coords?.length) return
    setMapRoutes([{ coordinates: coords, color: '#00d4ff', weight: 4 }])
    setMapMarkers(prev => {
      const filtered = prev.filter(m => !m._routePin)
      const stopPins = stops
        .filter(s => s.geocoded?.lat != null && isFinite(s.geocoded.lat))
        .map((s, i) => ({
          id: `stop-${i}`, lat: s.geocoded.lat, lng: s.geocoded.lng,
          label: String(i + 1), status: 'warning', _routePin: true,
        }))
      return [
        ...filtered,
        ...(isFinite(from.lat) && isFinite(from.lng) ? [{ id: 'route-from', lat: from.lat, lng: from.lng, label: 'A', status: 'active', _routePin: true }] : []),
        ...stopPins,
        ...(isFinite(to.lat) && isFinite(to.lng) ? [{ id: 'route-to', lat: to.lat, lng: to.lng, label: 'B', status: 'warning', isDestination: true, _routePin: true }] : []),
      ]
    })
  }, [])

  const handleClearRoute = useCallback(() => {
    setMapRoutes([])
    setMapMarkers(vehicles
      .map(v => ({ id: v.id, lat: v.lat, lng: v.lng, label: v.reg_number, sublabel: v.driver_name, status: v.status, speed: v.speed, fuel: v.fuel_level }))
      .filter(m => m.lat != null && m.lng != null && isFinite(Number(m.lat)) && isFinite(Number(m.lng)))
    )
  }, [vehicles])

  const handleSelectVehicle = useCallback((v) => {
    setSelectedVehicle(v)
    if (v.lat && v.lng && isFinite(v.lat) && isFinite(v.lng)) {
      setFlyTarget({ lat: v.lat, lng: v.lng })
    }
  }, [])

  const handleFocusVehicle = useCallback((v) => {
    if (v.lat && v.lng && isFinite(v.lat) && isFinite(v.lng)) {
      mapRef.current?.flyTo([v.lat, v.lng], 16)
    }
  }, [])

  return (
    <div className="fixed inset-0 z-30 bg-[#050810] overflow-hidden">
      {/* Exit button */}
      <button onClick={() => navigate('/dashboard')}
        className="absolute top-4 right-4 z-[1100] flex items-center gap-1.5
                   bg-[#0d1426]/95 border border-slate-700/60 text-slate-300
                   hover:text-white hover:border-slate-500/80 hover:bg-slate-800/80
                   rounded-lg px-3 py-2 text-xs font-medium backdrop-blur-sm transition-all shadow-xl"
        aria-label="Exit map">
        <Icon name="X" size={14} />
        <span>Exit Map</span>
      </button>

      <div className="relative w-full h-full">
        {/* Map */}
        <Suspense fallback={<MapLoader />}>
          <ApexMap
            ref={mapRef}
            markers={mapMarkers}
            routes={mapRoutes}
            flyTo={flyTarget}
            height="100%"
            className="w-full h-full absolute inset-0"
            onMarkerClick={handleSelectVehicle}
          />
        </Suspense>

        {/* Fleet Sidebar */}
        <FleetSidebar vehicles={vehicles} activeId={selectedVehicle?.id}
          onSelect={handleSelectVehicle} isLoading={isLoading} />

        {/* Route Planner — passes drivers + vehicles for job creation */}
        <RoutePlanner
          onRoute={handleRoute}
          onClear={handleClearRoute}
          drivers={drivers}
          vehicles={fleetVehicles}
        />

        {/* Map Controls */}
        <MapControls mapRef={mapRef} isFullscreen={true} onFullscreen={null} />

        {/* Vehicle detail panel */}
        {selectedVehicle && (
          <VehiclePanel
            vehicle={selectedVehicle}
            onClose={() => setSelectedVehicle(null)}
            onFocus={handleFocusVehicle}
          />
        )}

        {/* Live count badge */}
        <div className="absolute bottom-10 right-4 z-[999] pointer-events-none">
          <div className="bg-[#0d1426]/95 border border-slate-800/60 rounded-lg px-3 py-1.5 backdrop-blur-sm flex items-center gap-2">
            <StatusDot status={vehicles.length > 0 ? 'online' : 'idle'} />
            <span className="text-2xs text-slate-400 font-mono">
              {vehicles.filter(v => v.status === 'active').length} active · {vehicles.length} total
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
