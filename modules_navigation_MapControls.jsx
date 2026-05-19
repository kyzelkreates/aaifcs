/**
 * ============================================================
 * APEX AI — Map Controls Panel (Run 4 — Complete)
 * /src/modules/navigation/MapControls.jsx
 *
 * Zoom / locate / fullscreen / provider switcher.
 * All zoom/locate calls go through the mapRef forwarded from ApexMap.
 * ============================================================
 */

import { useState } from 'react'
import Icon from './components_ui_Icon'
import { useMapStore } from './core_storage'
import { MAP_PROVIDERS, PROVIDER_DEFINITIONS } from './services_maps_mapProviders'

export default function MapControls({
  mapRef,           // React ref forwarded from ApexMap via forwardRef
  onFullscreen,
  isFullscreen,
}) {
  const { provider, setProvider } = useMapStore(s => ({
    provider:    s.provider,
    setProvider: s.setProvider,
  }))
  const [showProviders, setShowProviders] = useState(false)

  const activeProvider = PROVIDER_DEFINITIONS[provider] || PROVIDER_DEFINITIONS[MAP_PROVIDERS.OSM]

  const zoomIn  = () => mapRef?.current?.zoomIn?.()
  const zoomOut = () => mapRef?.current?.zoomOut?.()
  const locate  = () => mapRef?.current?.locate?.()

  const btnBase = `
    flex items-center justify-center w-9 h-9
    bg-[#0d1426]/95 border border-slate-800/60
    text-slate-400 hover:text-white hover:bg-slate-800/60
    transition-all backdrop-blur-sm
  `

  return (
    <div className="absolute top-4 right-4 z-[999] flex flex-col gap-2">

      {/* Zoom */}
      <div className="flex flex-col rounded-lg overflow-hidden shadow-lg">
        <button onClick={zoomIn}  className={`${btnBase} rounded-t-lg border-b-0 hover:text-cyan-400`} title="Zoom in">
          <Icon name="Plus" size={14} />
        </button>
        <button onClick={zoomOut} className={`${btnBase} rounded-b-lg`} title="Zoom out">
          <Icon name="Minus" size={14} />
        </button>
      </div>

      {/* Locate */}
      <button onClick={locate} className={`${btnBase} rounded-lg shadow-lg`} title="Locate me">
        <Icon name="Locate" size={14} />
      </button>

      {/* Fullscreen */}
      <button
        onClick={onFullscreen}
        className={`${btnBase} rounded-lg shadow-lg`}
        title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
      >
        <Icon name={isFullscreen ? 'Minimize2' : 'Maximize2'} size={14} />
      </button>

      {/* Provider picker */}
      <div className="relative">
        <button
          onClick={() => setShowProviders(v => !v)}
          className={`${btnBase} rounded-lg shadow-lg ${showProviders ? 'text-cyan-400 border-cyan-500/30' : ''}`}
          title={`Map provider: ${activeProvider.name}`}
        >
          <Icon name="Layers" size={14} />
        </button>

        {showProviders && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShowProviders(false)} />
            <div className="absolute right-full top-0 mr-2 w-48 bg-[#0d1426] border border-slate-800/60 rounded-xl overflow-hidden shadow-2xl z-50">
              <div className="px-3 py-2 border-b border-slate-800/60">
                <span className="text-2xs text-slate-500 tracking-widest uppercase font-semibold">
                  Map Provider
                </span>
              </div>
              {Object.values(PROVIDER_DEFINITIONS).map(p => {
                const ready  = p.available()
                const active = provider === p.id
                return (
                  <button
                    key={p.id}
                    onClick={() => { setProvider(p.id); setShowProviders(false) }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-xs transition-colors ${
                      active
                        ? 'text-cyan-400 bg-cyan-500/5'
                        : 'text-slate-400 hover:text-white hover:bg-slate-800/40'
                    }`}
                  >
                    <Icon
                      name={ready ? 'CheckCircle2' : 'Circle'}
                      size={12}
                      className={ready ? 'text-emerald-400' : 'text-slate-700'}
                    />
                    <span className="flex-1 text-left">{p.name}</span>
                    {!ready && (
                      <span className="text-2xs text-slate-700">No key</span>
                    )}
                    {active && ready && (
                      <span className="text-2xs text-cyan-500">Active</span>
                    )}
                  </button>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
