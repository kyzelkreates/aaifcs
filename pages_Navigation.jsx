/**
 * ============================================================
 * APEX AI — Live Navigation / Fleet Map Page (Run 4 — Complete)
 * ============================================================
 *
 * Features:
 * - Full-screen Leaflet tactical map (dark tiles)
 * - Live vehicle markers from fleet store
 * - Vehicle info panel on marker click
 * - Route planner (geocode + route via mapService)
 * - Fleet sidebar with active vehicle list
 * - Map controls: zoom / locate / fullscreen / provider
 * - MapAttribution always rendered (legal requirement)
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
import { formatDistance, formatDuration } from './utils_format'
import {
  subscribeToDriverLocations, getLiveDriverPositions,
} from './services_sync_liveSync'


// Lazy-load map to avoid SSR issues with Leaflet
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

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
          <TelemetryValue label="Speed"  value={vehicle.speed ?? '—'} unit="km/h" size="sm"
            status={vehicle.speed > 90 ? 'warning' : 'nominal'} />
          <TelemetryValue label="Fuel"   value={vehicle.fuel  ?? '—'} unit="%"    size="sm"
            status={vehicle.fuel < 20 ? 'critical' : vehicle.fuel < 35 ? 'warning' : 'nominal'} />
          <TelemetryValue label="Status" value={vehicle.status?.replace('_', ' ') || '—'} size="sm" />
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => onFocus?.(vehicle)}
            className="flex-1 py-1.5 text-xs bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 rounded hover:bg-cyan-500/15 transition-colors"
          >
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
        {/* Header */}
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

        {/* Search */}
        <div className="px-2 py-2 border-b border-slate-800/40">
          <div className="relative">
            <Icon name="Search" size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-600" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search..."
              className="w-full bg-slate-900/60 border border-slate-800/60 rounded text-xs text-slate-300 pl-7 pr-2 py-1.5 outline-none focus:border-slate-600/60 placeholder:text-slate-700"
            />
          </div>
        </div>

        {/* Vehicle list */}
        <div className="max-h-64 overflow-y-auto scrollbar-none">
          {filtered.length === 0 && (
            <div className="px-3 py-5 text-xs text-slate-700 text-center">
              {vehicles.length === 0 ? 'No vehicles in fleet' : 'No results'}
            </div>
          )}
          {filtered.map(v => {
            const dot = v.status === 'active' ? 'online' : v.status === 'idle' ? 'idle' : 'offline'
            return (
              <button
                key={v.id}
                onClick={() => onSelect(v)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors border-b border-slate-800/20 last:border-0 ${
                  activeId === v.id
                    ? 'bg-cyan-500/8 border-l-2 border-l-cyan-500'
                    : 'hover:bg-slate-800/40'
                }`}
              >
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

// ─── Route Planner ────────────────────────────────────────────
function RoutePlanner({ onRoute, onClear }) {
  const [from,    setFrom]    = useState('')
  const [to,      setTo]      = useState('')
  const [loading, setLoading] = useState(false)
  const [result,  setResult]  = useState(null)
  const [error,   setError]   = useState(null)
  const [open,    setOpen]    = useState(true)

  const plan = async () => {
    if (!from.trim() || !to.trim()) return
    setLoading(true); setError(null); setResult(null)
    try {
      const [origins, destinations] = await Promise.all([
        mapService.geocode(from),
        mapService.geocode(to)
      ])
      if (!origins?.length)      { setError('Origin not found');      return }
      if (!destinations?.length) { setError('Destination not found'); return }

      const route = await mapService.route(
        { lat: origins[0].lat,      lng: origins[0].lng },
        { lat: destinations[0].lat, lng: destinations[0].lng }
      )
      if (!route) { setError('No route found'); return }

      setResult({ route, origin: origins[0], destination: destinations[0] })
      onRoute?.(route, origins[0], destinations[0])
    } catch (err) {
      setError(err.message || 'Routing failed')
    } finally {
      setLoading(false)
    }
  }

  const clear = () => {
    setFrom(''); setTo(''); setResult(null); setError(null)
    onClear?.()
  }

  if (!open) {
    return (
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[999] pointer-events-auto">
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 px-4 py-2 bg-[#0d1426]/97 border border-slate-700/50 rounded-xl text-xs text-slate-400 hover:text-white backdrop-blur-sm shadow-xl transition-colors"
        >
          <Icon name="Route" size={12} className="text-cyan-400" />
          Route Planner
        </button>
      </div>
    )
  }

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[999] w-[420px] pointer-events-auto">
      <div className="bg-[#0d1426]/97 border border-slate-700/50 rounded-xl p-3 backdrop-blur-sm shadow-2xl">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Icon name="Route" size={12} className="text-cyan-400" />
            <span className="text-xs font-semibold text-slate-200">Route Planner</span>
          </div>
          <button onClick={() => setOpen(false)} className="text-slate-600 hover:text-slate-400 p-0.5">
            <Icon name="ChevronUp" size={13} />
          </button>
        </div>

        <div className="flex gap-2 items-end">
          {/* From/To inputs */}
          <div className="flex-1 flex flex-col gap-1.5">
            <div className="relative">
              <div className="absolute left-2.5 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-emerald-400 border border-emerald-400/40" />
              <input
                value={from}
                onChange={e => setFrom(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && plan()}
                placeholder="From: city, postcode or address"
                className="w-full bg-slate-900/70 border border-slate-800/60 rounded text-xs text-slate-300 pl-7 pr-2 py-2 outline-none focus:border-slate-600/80 placeholder:text-slate-700"
              />
            </div>
            <div className="relative">
              <div className="absolute left-2.5 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-red-400 border border-red-400/40" />
              <input
                value={to}
                onChange={e => setTo(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && plan()}
                placeholder="To: city, postcode or address"
                className="w-full bg-slate-900/70 border border-slate-800/60 rounded text-xs text-slate-300 pl-7 pr-2 py-2 outline-none focus:border-slate-600/80 placeholder:text-slate-700"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-1.5">
            <button
              onClick={plan}
              disabled={loading || !from.trim() || !to.trim()}
              className="h-8 px-3 bg-cyan-500/15 border border-cyan-500/25 text-cyan-400 rounded text-xs hover:bg-cyan-500/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              {loading
                ? <Icon name="Loader2" size={13} className="animate-spin" />
                : <Icon name="Route" size={13} />
              }
            </button>
            <button
              onClick={clear}
              className="h-8 px-3 bg-slate-800/60 border border-slate-700/40 text-slate-500 rounded text-xs hover:text-slate-300 transition-colors"
            >
              <Icon name="X" size={13} />
            </button>
          </div>
        </div>

        {/* Result */}
        {result && (
          <div className="mt-2 pt-2 border-t border-slate-800/40 flex items-center gap-4">
            <div className="flex items-center gap-1.5 text-xs text-slate-300">
              <Icon name="Route" size={11} className="text-cyan-400" />
              <span className="font-mono font-semibold">{formatDistance(result.route.distance)}</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-slate-300">
              <Icon name="Clock" size={11} className="text-cyan-400" />
              <span className="font-mono font-semibold">{formatDuration(result.route.duration)}</span>
            </div>
            <span className="text-2xs text-slate-600 ml-auto">
              via {result.route.source || 'OSM'}
            </span>
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
  )
}

// ─── Navigation Page ──────────────────────────────────────────
export default function Navigation() {
  const { vehicles, isLoading } = useFleetStore(s => ({
    vehicles:  s.vehicles,
    isLoading: s.isLoading
  }))
  const mapRef             = useRef(null)
  const [selectedVehicle,  setSelectedVehicle]  = useState(null)
  const [mapMarkers,       setMapMarkers]        = useState([])
  const [liveDrivers,   setLiveDrivers]       = useState(() => getLiveDriverPositions())
  const [mapRoutes,        setMapRoutes]         = useState([])
  const [flyTarget,        setFlyTarget]         = useState(null)
  const navigate = useNavigate()
  // Map is always full-screen — exit goes back to dashboard

  useEffect(() => { fleetService.fetchVehicles() }, [])

  // Build markers from fleet vehicles + live driver positions
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
    })).filter(m => m.lat != null && m.lng != null)

    // Merge live driver positions (override fleet vehicle if same vehicle_id)
    const driverMarkers = liveDrivers.map(pos => {
      const age = Date.now() - new Date(pos.ts).getTime()
      if (age > 5 * 60 * 1000) return null // stale > 5min
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

    // Fleet markers where no live driver overrides
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

  const handleRoute = useCallback((route, from, to) => {
    const coords = route?.geometry?.coordinates
    if (!coords?.length) return
    setMapRoutes([{ coordinates: coords, color: '#00d4ff', weight: 4 }])
    // Add origin + destination markers
    setMapMarkers(prev => {
      const filtered = prev.filter(m => !m._routePin)
      return [
        ...filtered,
        { id: 'route-from', lat: from.lat, lng: from.lng, label: 'A', status: 'active', _routePin: true },
        { id: 'route-to',   lat: to.lat,   lng: to.lng,   label: 'B', status: 'warning', isDestination: true, _routePin: true },
      ]
    })
  }, [])

  const handleClearRoute = useCallback(() => {
    setMapRoutes([])
    setMapMarkers(vehicles.map(v => ({
      id: v.id, lat: v.lat, lng: v.lng,
      label: v.reg_number, sublabel: v.driver_name,
      status: v.status, speed: v.speed, fuel: v.fuel_level,
    })).filter(m => m.lat != null && m.lng != null))
  }, [vehicles])

  const handleSelectVehicle = useCallback((v) => {
    setSelectedVehicle(v)
    if (v.lat && v.lng) setFlyTarget({ lat: v.lat, lng: v.lng })
  }, [])

  const handleFocusVehicle = useCallback((v) => {
    if (v.lat && v.lng) mapRef.current?.flyTo([v.lat, v.lng], 16)
  }, [])

  return (
    <div className="fixed inset-0 z-30 bg-[#050810] overflow-hidden">
      {/* Exit button — top right */}
      <button
        onClick={() => navigate('/dashboard')}
        className="absolute top-4 right-4 z-[1100] flex items-center gap-1.5
                   bg-[#0d1426]/95 border border-slate-700/60 text-slate-300
                   hover:text-white hover:border-slate-500/80 hover:bg-slate-800/80
                   rounded-lg px-3 py-2 text-xs font-medium backdrop-blur-sm
                   transition-all shadow-xl"
        aria-label="Exit map"
      >
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

        {/* Fleet Sidebar — top left */}
        <FleetSidebar
          vehicles={vehicles}
          activeId={selectedVehicle?.id}
          onSelect={handleSelectVehicle}
          isLoading={isLoading}
        />

        {/* Route Planner — top centre */}
        <RoutePlanner onRoute={handleRoute} onClear={handleClearRoute} />

        {/* Map Controls — top right */}
        <MapControls
          mapRef={mapRef}
          isFullscreen={true}
          onFullscreen={null}
        />

        {/* Vehicle detail panel — bottom centre */}
        {selectedVehicle && (
          <VehiclePanel
            vehicle={selectedVehicle}
            onClose={() => setSelectedVehicle(null)}
            onFocus={handleFocusVehicle}
          />
        )}

        {/* Live count badge — bottom right */}
        <div className="absolute bottom-10 right-4 z-[999] pointer-events-none">
          <div className="bg-[#0d1426]/95 border border-slate-800/60 rounded-lg px-3 py-1.5 backdrop-blur-sm flex items-center gap-2">
            <StatusDot status={vehicles.length > 0 ? 'online' : 'idle'} />
            <span className="text-2xs text-slate-400 font-mono">
              {vehicles.filter(v => v.status === 'active').length} active ·{' '}
              {vehicles.length} total
            </span>
          </div>
        </div>

      </div>
    </div>
  )
}
