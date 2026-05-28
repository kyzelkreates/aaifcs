/**
 * AP3X Route Replay View
 * Pulls driver_locations history and replays the path on an inline map
 */
import { useEffect, useState, useRef } from 'react'
import { getSupabaseClient } from './services_supabase_supabaseClient'
import Icon from './components_ui_Icon'

export default function RouteReplayView({ driverId, taskId, onBack }) {
  const [points,   setPoints]   = useState([])
  const [loading,  setLoading]  = useState(true)
  const [playing,  setPlaying]  = useState(false)
  const [cursor,   setCursor]   = useState(0)
  const intervalRef = useRef(null)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      const query = supabase
        .from('driver_locations')
        .select('lat, lng, recorded_at, speed_kmh, heading')
        .order('recorded_at', { ascending: true })
        .limit(500)
      if (driverId) query.eq('driver_id', driverId)
      if (taskId)   query.eq('task_id', taskId)
      const { data } = await query
      setPoints(data || [])
      setLoading(false)
    }
    load()
    return () => clearInterval(intervalRef.current)
  }, [driverId, taskId])

  const play = () => {
    setPlaying(true)
    setCursor(0)
    intervalRef.current = setInterval(() => {
      setCursor(c => {
        if (c >= points.length - 1) { clearInterval(intervalRef.current); setPlaying(false); return c }
        return c + 1
      })
    }, 200)
  }

  const stop = () => {
    clearInterval(intervalRef.current)
    setPlaying(false)
  }

  const current = points[cursor]

  // Build simple SVG path from lat/lng
  const svgPath = () => {
    if (points.length < 2) return ''
    const lats = points.map(p => p.lat)
    const lngs = points.map(p => p.lng)
    const minLat = Math.min(...lats), maxLat = Math.max(...lats)
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs)
    const rangeX = (maxLng - minLng) || 0.001
    const rangeY = (maxLat - minLat) || 0.001
    const W = 300, H = 160, PAD = 10
    const toX = lng => PAD + ((lng - minLng) / rangeX) * (W - 2 * PAD)
    const toY = lat => H - PAD - ((lat - minLat) / rangeY) * (H - 2 * PAD)
    const d = points.slice(0, cursor + 1).map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(p.lng).toFixed(1)},${toY(p.lat).toFixed(1)}`).join(' ')
    const full = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(p.lng).toFixed(1)},${toY(p.lat).toFixed(1)}`).join(' ')
    const cx = current ? toX(current.lng).toFixed(1) : null
    const cy = current ? toY(current.lat).toFixed(1) : null
    return { d, full, cx, cy, W, H }
  }

  const svg = !loading && points.length > 1 ? svgPath() : null

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-800">
        <button onClick={onBack} className="text-slate-400 hover:text-white">
          <Icon name="ArrowLeft" size={18} />
        </button>
        <span className="text-sm font-semibold text-slate-200">Route Replay</span>
        {points.length > 0 && (
          <span className="ml-auto text-xs text-slate-500">{points.length} pts</span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {loading ? (
          <div className="flex items-center justify-center h-40 text-slate-500 text-sm">Loading route…</div>
        ) : points.length < 2 ? (
          <div className="flex flex-col items-center justify-center h-40 gap-2 text-slate-500">
            <Icon name="MapPin" size={24} />
            <span className="text-sm">No route data for this session</span>
          </div>
        ) : (
          <>
            {/* SVG mini-map */}
            <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
              <svg viewBox={`0 0 ${svg.W} ${svg.H}`} className="w-full" style={{ height: 160 }}>
                <path d={svg.full} fill="none" stroke="#334155" strokeWidth="2" strokeLinecap="round" />
                <path d={svg.d}    fill="none" stroke="#06b6d4" strokeWidth="2.5" strokeLinecap="round" />
                {svg.cx && (
                  <circle cx={svg.cx} cy={svg.cy} r="5" fill="#06b6d4" stroke="#0e7490" strokeWidth="2" />
                )}
              </svg>
            </div>

            {/* Stats */}
            {current && (
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'Speed',   value: `${Math.round(current.speed_kmh || 0)} km/h` },
                  { label: 'Heading', value: `${Math.round(current.heading || 0)}°` },
                  { label: 'Point',   value: `${cursor + 1}/${points.length}` },
                ].map(s => (
                  <div key={s.label} className="bg-slate-800/60 border border-slate-700 rounded-xl p-2 text-center">
                    <div className="text-xs text-slate-500">{s.label}</div>
                    <div className="text-sm font-bold text-cyan-400">{s.value}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Scrubber */}
            <input
              type="range" min={0} max={points.length - 1} value={cursor}
              onChange={e => { stop(); setCursor(Number(e.target.value)) }}
              className="w-full accent-cyan-500"
            />

            {/* Controls */}
            <div className="flex gap-3">
              {playing ? (
                <button onClick={stop} className="flex-1 py-2.5 rounded-xl bg-red-500/15 border border-red-500/30 text-red-400 text-sm font-semibold">
                  ■ Stop
                </button>
              ) : (
                <button onClick={play} className="flex-1 py-2.5 rounded-xl bg-cyan-500/15 border border-cyan-500/30 text-cyan-400 text-sm font-semibold">
                  ▶ Play Replay
                </button>
              )}
              <button onClick={() => setCursor(0)} className="px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-slate-400 text-sm">
                <Icon name="RotateCcw" size={14} />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
