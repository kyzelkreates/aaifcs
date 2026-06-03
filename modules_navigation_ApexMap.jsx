/**
 * ============================================================
 * APEX AI — ApexMap Component (Run 4 — Complete)
 * /src/modules/navigation/ApexMap.jsx
 *
 * Leaflet-based tactical map.
 * Tile chain: GraphHopper (OSM tiles) → Mapbox → OSM (always-on fallback)
 * MapAttribution MANDATORY — legally required on every render.
 * ============================================================
 */

import { useEffect, useRef, forwardRef, useImperativeHandle } from 'react'
import {
  MapContainer, TileLayer, Marker, Popup,
  Polyline, Circle, useMap, useMapEvents
} from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import MapAttribution from './components_map_MapAttribution'
import { useMapStore } from './core_storage'
import { MAP_PROVIDERS } from './services_maps_mapProviders'

// ─── Fix Leaflet default icon paths (Vite asset hashing issue) ─
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl:       'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl:     'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
})

// ─── Vehicle / Marker Icons ───────────────────────────────────
const STATUS_ICON_CONFIG = {
  active:      { ring: 'rgba(0,212,255,0.15)',  border: 'rgba(0,212,255,0.8)',  dot: '#00d4ff',  glow: 'rgba(0,212,255,0.5)' },
  idle:        { ring: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.6)', dot: '#f59e0b',  glow: 'none'  },
  maintenance: { ring: 'rgba(139,92,246,0.10)', border: 'rgba(139,92,246,0.5)', dot: '#8b5cf6',  glow: 'none'  },
  offline:     { ring: 'rgba(71,85,105,0.10)',  border: 'rgba(71,85,105,0.4)',  dot: '#475569',  glow: 'none'  },
  warning:     { ring: 'rgba(239,68,68,0.10)',  border: 'rgba(239,68,68,0.6)',  dot: '#ef4444',  glow: 'rgba(239,68,68,0.5)' },
}

// ─── Live Driver Icon (pulsing, distinct from fleet vehicles) ──
const makeDriverLiveIcon = (label = '', heading = 0) => {
  return L.divIcon({
    className:  '',
    iconSize:   [40, 52],
    iconAnchor: [20, 52],
    html: `
      <div style="display:flex;flex-direction:column;align-items:center;gap:3px;">
        <div style="
          width:40px;height:40px;border-radius:50%;
          background:rgba(167,139,250,0.15);
          border:2px solid rgba(167,139,250,0.9);
          display:flex;align-items:center;justify-content:center;
          box-shadow:0 0 18px rgba(167,139,250,0.6);
          position:relative;
          transform: rotate(${heading}deg);
        ">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(167,139,250,1)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="3 11 22 2 13 21 11 13 3 11"/>
          </svg>
          <div style="
            position:absolute;inset:-5px;border-radius:50%;
            border:1.5px solid rgba(167,139,250,0.4);
            animation:apex-pulse 1.5s ease-in-out infinite;
          "></div>
          <div style="
            position:absolute;inset:-10px;border-radius:50%;
            border:1px solid rgba(167,139,250,0.2);
            animation:apex-pulse 1.5s ease-in-out 0.5s infinite;
          "></div>
        </div>
        <div style="
          background:rgba(167,139,250,0.9);color:#fff;
          font-size:9px;font-weight:700;padding:2px 6px;
          border-radius:4px;white-space:nowrap;max-width:80px;
          overflow:hidden;text-overflow:ellipsis;
          box-shadow:0 2px 8px rgba(0,0,0,0.4);
          letter-spacing:0.03em;
        ">${label || 'DRIVER'}</div>
      </div>
    `,
  })
}

const makeVehicleIcon = (status = 'active', label = '') => {
  const cfg = STATUS_ICON_CONFIG[status] || STATUS_ICON_CONFIG.offline
  return L.divIcon({
    className:  '',
    iconSize:   [36, 46],
    iconAnchor: [18, 46],
    html: `
      <div style="display:flex;flex-direction:column;align-items:center;gap:2px;">
        <div style="
          width:36px;height:36px;border-radius:50%;
          background:${cfg.ring};border:2px solid ${cfg.border};
          display:flex;align-items:center;justify-content:center;
          box-shadow:0 0 14px ${cfg.glow};
          position:relative;
        ">
          <div style="
            width:12px;height:12px;border-radius:50%;
            background:${cfg.dot};
            box-shadow:0 0 8px ${cfg.glow};
          "></div>
          ${status === 'active' ? `
            <div style="
              position:absolute;inset:-4px;border-radius:50%;
              border:1px solid ${cfg.border};opacity:0.4;
              animation:apex-pulse 2s infinite;
            "></div>` : ''}
        </div>
        ${label ? `<div style="
          background:rgba(9,14,28,0.95);border:1px solid rgba(255,255,255,0.08);
          border-radius:3px;padding:1px 5px;
          font-size:9px;font-family:monospace;font-weight:700;
          color:#e2e8f0;white-space:nowrap;
          box-shadow:0 2px 6px rgba(0,0,0,0.5);
        ">${label}</div>` : ''}
      </div>`
  })
}

const makeDestinationIcon = () => L.divIcon({
  className:  '',
  iconSize:   [20, 20],
  iconAnchor: [10, 20],
  html: `<div style="
    width:20px;height:20px;
    background:rgba(239,68,68,0.15);border:2px solid rgba(239,68,68,0.8);
    border-radius:50% 50% 50% 0;transform:rotate(-45deg);
    box-shadow:0 0 10px rgba(239,68,68,0.4);
  "></div>`
})

// ─── Inject pulse keyframes ───────────────────────────────────
if (!document.getElementById('apex-leaflet-styles')) {
  const s = document.createElement('style')
  s.id = 'apex-leaflet-styles'
  s.textContent = `
    @keyframes apex-pulse {
      0%   { transform: scale(1);   opacity: 0.5; }
      70%  { transform: scale(1.6); opacity: 0;   }
      100% { transform: scale(1.6); opacity: 0;   }
    }
    .map-tiles-dark {
      filter: invert(100%) hue-rotate(180deg) brightness(92%) contrast(88%) saturate(80%) !important;
    }
    .leaflet-container { background: #050810 !important; }
    .apex-map-popup .leaflet-popup-content-wrapper,
    .apex-map-popup .leaflet-popup-content {
      background: transparent !important; border: none !important;
      box-shadow: none !important; padding: 0 !important; margin: 0 !important;
    }
    .apex-map-popup .leaflet-popup-tip-container { display: none !important; }
    .leaflet-control-zoom, .leaflet-control-attribution { display: none !important; }
  `
  document.head.appendChild(s)
}

// ─── Tile URL resolver ────────────────────────────────────────
function resolveTileUrl(provider) {
  const mapboxToken = import.meta.env.VITE_MAPBOX_TOKEN
  if (provider === MAP_PROVIDERS.MAPBOX && mapboxToken) {
    return `https://api.mapbox.com/styles/v1/mapbox/dark-v11/tiles/{z}/{x}/{y}?access_token=${mapboxToken}`
  }
  // GraphHopper routing uses OSM tiles — same for Google fallback
  return 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
}

// ─── Map ref forwarder (exposes map instance to parent) ───────
function MapRefSync({ mapRef, onMoveEnd, onMapClick }) {
  const map = useMap()

  useEffect(() => {
    if (mapRef) mapRef.current = map
  }, [map, mapRef])

  useMapEvents({
    moveend: () => {
      const c = map.getCenter()
      onMoveEnd?.({ lat: c.lat, lng: c.lng }, map.getZoom())
    },
    click: (e) => {
      onMapClick?.({ lat: e.latlng.lat, lng: e.latlng.lng })
    }
  })

  return null
}

// ─── Center updater (flies to center when prop changes) ───────
function CenterUpdater({ center, zoom }) {
  const map = useMap()
  const prevCenter = useRef(null)

  useEffect(() => {
    if (!center) return
    if (center.lat == null || center.lng == null) return
    if (!isFinite(center.lat) || !isFinite(center.lng)) return
    const key = `${center.lat},${center.lng}`
    if (key === prevCenter.current) return
    prevCenter.current = key
    map.flyTo([center.lat, center.lng], zoom || map.getZoom(), { duration: 0.8 })
  }, [center, zoom, map])

  return null
}

// ─── ApexMap ──────────────────────────────────────────────────
const ApexMap = forwardRef(function ApexMap({
  markers    = [],
  routes     = [],
  geofences  = [],
  center,
  zoom,
  flyTo,
  onMapClick,
  onMarkerClick,
  height     = '100%',
  className  = ''
}, ref) {
  const mapInstanceRef = useRef(null)
  const { provider, center: storeCenter, zoom: storeZoom, setCenter, setZoom } = useMapStore(s => ({
    provider:  s.provider,
    center:    s.center,
    zoom:      s.zoom,
    setCenter: s.setCenter,
    setZoom:   s.setZoom
  }))

  // Guard: ensure mapCenter always has valid finite numbers — Leaflet crashes on NaN/null
  const rawCenter = center || storeCenter || { lat: 51.5074, lng: -0.1278 }
  const mapCenter = {
    lat: (rawCenter?.lat != null && isFinite(rawCenter.lat)) ? rawCenter.lat : 51.5074,
    lng: (rawCenter?.lng != null && isFinite(rawCenter.lng)) ? rawCenter.lng : -0.1278,
  }
  const mapZoom   = zoom  || storeZoom   || 11
  const tileUrl   = resolveTileUrl(provider)

  // Expose map control methods to parent via ref
  useImperativeHandle(ref, () => ({
    zoomIn:  () => mapInstanceRef.current?.zoomIn(),
    zoomOut: () => mapInstanceRef.current?.zoomOut(),
    flyTo:   (latlng, z) => mapInstanceRef.current?.flyTo(latlng, z, { duration: 1 }),
    locate:  () => mapInstanceRef.current?.locate({ setView: true, maxZoom: 15 }),
    getMap:  () => mapInstanceRef.current,
  }))

  return (
    <div className={`relative overflow-hidden ${className}`} style={{ height }}>
      <MapContainer
        center={[
          isFinite(mapCenter.lat) ? mapCenter.lat : 51.5074,
          isFinite(mapCenter.lng) ? mapCenter.lng : -0.1278,
        ]}
        zoom={isFinite(mapZoom) ? mapZoom : 11}
        className="w-full h-full"
        zoomControl={false}
        attributionControl={false}
        scrollWheelZoom
      >
        {/* Tile Layer */}
        <TileLayer
          url={tileUrl}
          subdomains={['a','b','c']}
          maxZoom={19}
          className="map-tiles-dark"
        />

        {/* Internal hooks */}
        <MapRefSync
          mapRef={mapInstanceRef}
          onMoveEnd={(c, z) => { setCenter(c); setZoom(z) }}
          onMapClick={onMapClick}
        />
        {flyTo && <CenterUpdater center={flyTo} zoom={zoom} />}

        {/* Vehicle / asset markers */}
        {markers.map((m, i) => (
          m.lat != null && m.lng != null && isFinite(m.lat) && isFinite(m.lng) && (
            <Marker
              key={m.id || i}
              position={[m.lat, m.lng]}
              icon={m.isDestination
                ? makeDestinationIcon()
                : m._live
                  ? makeDriverLiveIcon(m.label, m.heading || 0)
                  : makeVehicleIcon(m.status, m.label)
              }
              eventHandlers={{ click: () => onMarkerClick?.(m) }}
            >
              <Popup className="apex-map-popup" offset={[0, -36]}>
                <div className="bg-[#0d1426] border border-slate-700/60 rounded-lg p-3 shadow-xl min-w-[160px]">
                  <div className="font-mono font-bold text-cyan-400 text-sm">{m.label || 'Vehicle'}</div>
                  {m.sublabel && <div className="text-slate-400 text-xs mt-0.5">{m.sublabel}</div>}
                  {m.speed != null && (
                    <div className="flex items-center justify-between mt-2 text-xs text-slate-500">
                      <span>Speed</span>
                      <span className="font-mono text-white">{m.speed} km/h</span>
                    </div>
                  )}
                  {m.fuel != null && (
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span>Fuel</span>
                      <span className={`font-mono ${m.fuel < 20 ? 'text-red-400' : 'text-white'}`}>{m.fuel}%</span>
                    </div>
                  )}
                </div>
              </Popup>
            </Marker>
          )
        ))}

        {/* Route polylines */}
        {routes.map((route, i) => route?.coordinates?.length > 0 && (
          <Polyline
            key={i}
            positions={route.coordinates.map(c =>
              Array.isArray(c) ? [c[1], c[0]] : [c.lat, c.lng]
            )}
            color={route.color   || '#00d4ff'}
            weight={route.weight || 3}
            opacity={route.opacity ?? 0.85}
            dashArray={route.dashed ? '10,6' : undefined}
          />
        ))}

        {/* Geofence circles */}
        {geofences.map((gf, i) => (
          <Circle
            key={i}
            center={[gf.lat, gf.lng]}
            radius={gf.radius || 500}
            color={gf.color || '#f59e0b'}
            fillColor={gf.fillColor || '#f59e0b'}
            fillOpacity={0.06}
            weight={1.5}
            opacity={0.5}
          />
        ))}
      </MapContainer>

      {/* MANDATORY attribution — always rendered */}
      <MapAttribution />
    </div>
  )
})

export default ApexMap
