/**
 * ============================================================
 * APEX AI — Map Attribution Banner
 * /src/components/map/MapAttribution.jsx
 *
 * MANDATORY: All map providers require attribution to be
 * displayed when their data or routing is used.
 *
 * - OpenStreetMap: required by ODbL license
 * - GraphHopper: required by terms of service
 * - Google Maps: required by Google Maps Platform ToS
 * - Mapbox: required by Mapbox ToS
 *
 * This component is always rendered on any map view.
 * DO NOT remove or hide this component.
 * ============================================================
 */

import { useMapStore } from './core_storage'
import { PROVIDER_DEFINITIONS, MAP_PROVIDERS } from './services_maps_mapProviders'

export default function MapAttribution({ className = '' }) {
  const provider  = useMapStore(s => s.provider)
  const provDef   = PROVIDER_DEFINITIONS[provider] || PROVIDER_DEFINITIONS[MAP_PROVIDERS.OSM]
  const osmDef    = PROVIDER_DEFINITIONS[MAP_PROVIDERS.OSM]

  return (
    <div
      className={`
        absolute bottom-0 right-0 z-10
        flex items-center gap-1.5 flex-wrap
        bg-black/70 backdrop-blur-sm
        px-2 py-1 text-[10px] text-slate-400
        rounded-tl-md
        ${className}
      `}
      aria-label="Map attribution"
    >
      {/* Provider-specific attribution */}
      {provDef.attribution?.url ? (
        <a
          href={provDef.attribution.url}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-cyan-400 transition-colors whitespace-nowrap"
        >
          {provDef.attribution.text}
        </a>
      ) : (
        <span className="whitespace-nowrap">{provDef.attribution?.text}</span>
      )}

      {/* OSM attribution — always shown when OSM tiles/data used */}
      {provider !== MAP_PROVIDERS.OSM && (
        <>
          <span className="text-slate-600">|</span>
          <a
            href={osmDef.attribution.url}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-cyan-400 transition-colors whitespace-nowrap"
          >
            © OpenStreetMap contributors
          </a>
        </>
      )}

      {/* OSM license link */}
      <span className="text-slate-600">|</span>
      <a
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noopener noreferrer"
        className="hover:text-cyan-400 transition-colors whitespace-nowrap"
      >
        ODbL
      </a>
    </div>
  )
}
