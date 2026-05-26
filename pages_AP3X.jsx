/**
 * ============================================================
 * APEX AI — AP3X Driver Platform (Live — No Mock Data)
 * Pulls real jobs from localStorage dispatch store.
 * Pushes live telemetry back to fleet dashboard via
 * BroadcastChannel (same device) + localStorage.
 * ============================================================
 */

import { useState, useEffect, useRef, useCallback, Suspense, lazy } from 'react'
import Icon from './components_ui_Icon'
import Badge from './components_ui_Badge'
import StatusDot from './components_ui_StatusDot'
import TelemetryValue from './components_ui_TelemetryValue'
import { useAuthStore } from './core_storage'
import { dispatchService, JOB_STATUS, JOB_PRIORITY } from './services_dispatch_dispatchService'
import { pushTelemetryToFleet, importFromURL, importFromText, sendDriverMessage, listenForDriverMessages } from './services_sync_driverSyncService'
import { formatDateTime } from './utils_format'

const ApexMap = lazy(() => import('./modules_navigation_ApexMap'))

// ─── Map loader ───────────────────────────────────────────────
function MapLoader() {
  return (
    <div className="flex items-center justify-center h-full bg-[#050810]">
      <div className="w-8 h-8 border-2 border-violet-500/20 border-t-violet-400 rounded-full animate-spin" />
    </div>
  )
}

// ─── HUD Tile ─────────────────────────────────────────────────
function HUDTile({ label, value, unit, icon, color = 'text-cyan-400', warning = false }) {
  return (
    <div className={`flex flex-col items-center justify-center p-3 rounded-xl border ${
      warning
        ? 'bg-amber-500/5 border-amber-500/25'
        : 'bg-slate-900/50 border-slate-800/60'
    }`}>
      <Icon name={icon} size={14} className={warning ? 'text-amber-400 mb-1' : `${color} mb-1`} />
      <div className={`font-mono font-bold text-xl tabular-nums leading-none ${warning ? 'text-amber-400' : color}`}>
        {value}
      </div>
      {unit && <div className="text-2xs text-slate-600 mt-0.5">{unit}</div>}
      <div className="text-2xs text-slate-600 mt-1">{label}</div>
    </div>
  )
}

// ─── Active Job Card ──────────────────────────────────────────
function ActiveJobCard({ job, onStart, onComplete, onStatusUpdate }) {
  const priorityColor = {
    urgent: 'text-red-400 border-red-500/30 bg-red-500/5',
    high:   'text-amber-400 border-amber-500/30 bg-amber-500/5',
    normal: 'text-cyan-400 border-cyan-500/30 bg-cyan-500/5',
    low:    'text-slate-400 border-slate-700 bg-slate-900/40',
  }[job.priority] || 'text-slate-400 border-slate-700 bg-slate-900/40'

  return (
    <div className="bg-[#0d1426] border border-violet-500/20 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Icon name="Package" size={16} className="text-violet-400" />
          <span className="text-xs font-semibold text-violet-400 uppercase tracking-wider">Active Job</span>
        </div>
        <span className={`text-2xs px-2 py-0.5 rounded border font-semibold uppercase ${priorityColor}`}>
          {job.priority}
        </span>
      </div>

      <h3 className="font-semibold text-white text-sm mb-3 leading-snug">{job.title}</h3>

      <div className="space-y-2 mb-4">
        <div className="flex items-start gap-2 text-xs">
          <div className="w-2 h-2 rounded-full bg-emerald-400 mt-1 flex-shrink-0" />
          <div>
            <div className="text-slate-500 text-2xs uppercase tracking-wider mb-0.5">From</div>
            <div className="text-slate-300">{job.origin || '—'}</div>
          </div>
        </div>
        <div className="flex items-start gap-2 text-xs">
          <div className="w-2 h-2 rounded-full bg-red-400 mt-1 flex-shrink-0" />
          <div>
            <div className="text-slate-500 text-2xs uppercase tracking-wider mb-0.5">To</div>
            <div className="text-slate-300">{job.destination || '—'}</div>
          </div>
        </div>
      </div>

      {job.notes && (
        <div className="bg-slate-900/50 border border-slate-800/40 rounded-lg p-2.5 mb-3 text-xs text-slate-400">
          <Icon name="Info" size={11} className="inline mr-1 text-slate-600" />
          {job.notes}
        </div>
      )}

      <div className="flex gap-2">
        {job.status === JOB_STATUS.ASSIGNED && (
          <button onClick={() => onStart(job.id)}
            className="flex-1 bg-violet-500/15 border border-violet-500/30 text-violet-400 text-xs font-semibold rounded-lg py-2 hover:bg-violet-500/25 transition-colors flex items-center justify-center gap-1.5">
            <Icon name="Play" size={13} /> Start Drive
          </button>
        )}
        {job.status === JOB_STATUS.IN_PROGRESS && (
          <button onClick={() => onComplete(job.id)}
            className="flex-1 bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 text-xs font-semibold rounded-lg py-2 hover:bg-emerald-500/20 transition-colors flex items-center justify-center gap-1.5">
            <Icon name="CheckCircle" size={13} /> Mark Complete
          </button>
        )}
      </div>
    </div>
  )
}

// ─── No Jobs State ─────────────────────────────────────────────
function NoJobs({ onImport }) {
  const [text, setText] = useState('')
  const [msg,  setMsg]  = useState(null)

  const handleImport = () => {
    if (!text.trim()) return
    const result = importFromText(text.trim())
    setMsg(result.ok
      ? { type: 'ok',  text: `Imported ${result.count} job${result.count !== 1 ? 's' : ''}.` }
      : { type: 'err', text: result.error }
    )
    if (result.ok) { setText(''); onImport?.() }
  }

  return (
    <div className="flex flex-col items-center justify-center h-48 gap-4 px-4">
      <div className="w-14 h-14 rounded-2xl bg-slate-900/60 border border-slate-800 flex items-center justify-center">
        <Icon name="Inbox" size={24} className="text-slate-600" />
      </div>
      <div className="text-center">
        <p className="text-slate-400 text-sm font-medium">No jobs assigned</p>
        <p className="text-slate-600 text-xs mt-1">Ask fleet to send your assignment via the sync options.</p>
      </div>

      {/* Manual import */}
      <div className="w-full max-w-sm">
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Paste sync code or deep link here…"
          rows={3}
          className="w-full bg-slate-900/60 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-300 placeholder:text-slate-700 resize-none outline-none focus:border-violet-500/40"
        />
        {msg && (
          <p className={`text-xs mt-1 ${msg.type === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}>{msg.text}</p>
        )}
        <button onClick={handleImport} disabled={!text.trim()}
          className="mt-2 w-full bg-violet-500/10 border border-violet-500/25 text-violet-400 text-xs font-semibold rounded-lg py-2 hover:bg-violet-500/20 disabled:opacity-30 transition-colors">
          Import Jobs
        </button>
      </div>
    </div>
  )
}

// ─── Job List ─────────────────────────────────────────────────
function JobList({ jobs, onSelect, activeId }) {
  return (
    <div className="space-y-2">
      {jobs.map(job => (
        <button key={job.id} onClick={() => onSelect(job)}
          className={`w-full text-left bg-[#0d1426] border rounded-xl p-3 transition-all ${
            job.id === activeId
              ? 'border-violet-500/40 bg-violet-500/5'
              : 'border-slate-800/60 hover:border-slate-700/60'
          }`}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-white truncate">{job.title}</span>
            <span className={`text-2xs px-1.5 py-0.5 rounded font-semibold uppercase ml-2 flex-shrink-0 ${
              job.status === 'in_progress' ? 'bg-amber-500/15 text-amber-400' :
              job.status === 'assigned'    ? 'bg-cyan-500/15 text-cyan-400'   :
              job.status === 'completed'   ? 'bg-emerald-500/15 text-emerald-400' :
              'bg-slate-800 text-slate-500'
            }`}>{job.status?.replace('_', ' ')}</span>
          </div>
          <div className="text-2xs text-slate-600 truncate">{job.destination || 'No destination'}</div>
        </button>
      ))}
    </div>
  )
}

// ─── AP3X Driver Page ─────────────────────────────────────────
export default function AP3X() {
  const user        = useAuthStore(s => s.user)
  const driverId    = user?.id || 'local-driver'
  const driverName  = user?.user_metadata?.username || user?.user_metadata?.full_name || 'Driver'

  const [jobs,        setJobs]        = useState([])
  const [activeJob,   setActiveJob]   = useState(null)
  const [telemetry,   setTelemetry]   = useState({ speed: 0, fuel: 0, heading: 0, engine: false, lat: null, lng: null })
  const [mapRoutes,   setMapRoutes]   = useState([])
  const [mapMarkers,  setMapMarkers]  = useState([])
  const [tab,         setTab]         = useState('job')  // 'job' | 'map' | 'chat' | 'all'
  const [chatInput,   setChatInput]   = useState('')
  const [chatMsgs,    setChatMsgs]    = useState([])
  const chatEndRef = useRef(null)
  const [gpsActive,   setGpsActive]   = useState(false)
  const watchRef = useRef(null)
  const mapRef   = useRef(null)

  // ── Load jobs ─────────────────────────────────────────────
  const loadJobs = useCallback(async () => {
    try {
      const result = await dispatchService.fetchJobs({ driver_id: driverId })
      const all = Array.isArray(result) ? result : []
      const active = all.find(j => j.status === JOB_STATUS.IN_PROGRESS) ||
                     all.find(j => j.status === JOB_STATUS.ASSIGNED)
      setJobs(all.filter(j => j.status !== JOB_STATUS.CANCELLED && j.status !== JOB_STATUS.COMPLETED))
      setActiveJob(prev => active || (prev?.id ? all.find(j => j.id === prev.id) || null : null))
    } catch (e) {
      console.error('[AP3X:AP3X] loadJobs error:', e)
    }
  }, [driverId])

  useEffect(() => {
    // Check for deep-link import on mount
    const imported = importFromURL()
    if (imported?.ok) loadJobs()

    loadJobs()
    const unsub = dispatchService.subscribeToJobs(() => loadJobs())
    return unsub
  }, [loadJobs])

  // ── GPS Tracking ──────────────────────────────────────────
  const startGPS = useCallback(() => {
    if (!navigator.geolocation) return
    setGpsActive(true)
    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const t = {
          lat:     pos.coords.latitude,
          lng:     pos.coords.longitude,
          speed:   pos.coords.speed ? Math.round(pos.coords.speed * 3.6) : telemetry.speed,
          heading: pos.coords.heading || telemetry.heading,
          fuel:    telemetry.fuel,
          engine:  true,
        }
        setTelemetry(t)
        // Push to fleet
        pushTelemetryToFleet(driverId, { ...t, vehicle_id: activeJob?.vehicle_id, job_id: activeJob?.id })
        // Update map marker
        setMapMarkers([{ id: 'driver', lat: t.lat, lng: t.lng, label: driverName.slice(0,2).toUpperCase(), status: 'active' }])
        mapRef.current?.flyTo([t.lat, t.lng], 16)
      },
      (err) => console.warn('[GPS]', err),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
    )
  }, [driverId, driverName, activeJob, telemetry.speed, telemetry.heading, telemetry.fuel])

  const stopGPS = useCallback(() => {
    if (watchRef.current != null) {
      navigator.geolocation.clearWatch(watchRef.current)
      watchRef.current = null
    }
    setGpsActive(false)
    setTelemetry(t => ({ ...t, engine: false, speed: 0 }))
  }, [])

  useEffect(() => () => { if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current) }, [])

  // ── Driver Chat: listen for fleet/AI replies ──────────────
  useEffect(() => {
    const unsub = listenForDriverMessages((msg) => {
      if (msg.from === 'fleet' || msg.from === 'ai') {
        setChatMsgs(prev => [...prev, msg])
        setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
      }
    })
    return unsub
  }, [])

  const sendChat = useCallback(() => {
    if (!chatInput.trim()) return
    const msg = sendDriverMessage(driverId, driverName, activeJob?.vehicle_id || null, activeJob?.vehicle_reg || null, chatInput.trim())
    setChatMsgs(prev => [...prev, msg])
    setChatInput('')
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
  }, [chatInput, driverId, driverName, activeJob])

  // ── Job Actions ───────────────────────────────────────────
  const handleStart = (id) => {
    dispatchService.startJob(id)
    loadJobs()
    startGPS()
  }

  const handleComplete = (id) => {
    dispatchService.completeJob(id)
    stopGPS()
    loadJobs()
  }

  const speedWarn = telemetry.speed > 80
  const fuelWarn  = telemetry.fuel > 0 && telemetry.fuel < 15

  return (
    <div className="flex flex-col h-full bg-[#050810]">

      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-800/60 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-violet-500/10 border border-violet-500/30 rounded-lg flex items-center justify-center">
              <Icon name="Navigation" size={15} className="text-violet-400" />
            </div>
            <div>
              <div className="font-display font-bold text-white text-sm">AP3X Driver</div>
              <div className="text-slate-500 text-2xs">{driverName}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={gpsActive ? stopGPS : startGPS}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                gpsActive
                  ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
                  : 'bg-slate-800/60 border border-slate-700 text-slate-400 hover:text-slate-300'
              }`}>
              <Icon name={gpsActive ? 'MapPin' : 'MapPinOff'} size={12} />
              {gpsActive ? 'GPS On' : 'GPS Off'}
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-800/60 flex-shrink-0">
        {[
          { key: 'job',  label: 'Current Job',           icon: 'Package'      },
          { key: 'map',  label: 'Map',                   icon: 'Map'          },
          { key: 'chat', label: 'Fleet Chat',            icon: 'MessageSquare'},
          { key: 'all',  label: `All Jobs (${jobs.length})`, icon: 'List'    },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-medium transition-all ${
              tab === t.key
                ? 'text-violet-400 border-b-2 border-violet-400'
                : 'text-slate-500 hover:text-slate-300'
            }`}>
            <Icon name={t.icon} size={13} />
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto scrollbar-none">

        {/* Live HUD — always visible */}
        <div className="grid grid-cols-4 gap-2 p-3">
          <HUDTile label="Speed"   value={telemetry.speed}   unit="km/h" icon="Gauge"       color="text-cyan-400"   warning={speedWarn} />
          <HUDTile label="Fuel"    value={telemetry.fuel || '—'}   unit={telemetry.fuel ? '%' : ''} icon="Fuel" color="text-violet-400" warning={fuelWarn} />
          <HUDTile label="Heading" value={telemetry.heading ? `${telemetry.heading}°` : '—'} icon="Compass"  color="text-emerald-400" />
          <HUDTile label="Engine"  value={telemetry.engine ? 'ON' : 'OFF'} icon="Cpu"      color={telemetry.engine ? 'text-emerald-400' : 'text-slate-600'} />
        </div>

        {/* Tab: Current Job */}
        {tab === 'job' && (
          <div className="px-3 pb-4 space-y-3">
            {activeJob ? (
              <ActiveJobCard
                job={activeJob}
                onStart={handleStart}
                onComplete={handleComplete}
              />
            ) : (
              <NoJobs onImport={loadJobs} />
            )}
          </div>
        )}

        {/* Tab: Map */}
        {tab === 'map' && (
          <div className="h-[60vh] mx-3 mb-3 rounded-xl overflow-hidden border border-slate-800/60">
            <Suspense fallback={<MapLoader />}>
              <ApexMap
                ref={mapRef}
                markers={mapMarkers}
                routes={mapRoutes}
                height="100%"
                className="w-full h-full"
              />
            </Suspense>
          </div>
        )}

        {/* Tab: All Jobs */}
        {tab === 'all' && (
          <div className="px-3 pb-4">
            {jobs.length === 0 ? (
              <NoJobs onImport={loadJobs} />
            ) : (
              <JobList
                jobs={jobs}
                activeId={activeJob?.id}
                onSelect={(job) => { setActiveJob(job); setTab('job') }}
              />
            )}
          </div>
        )}
      </div>

        {/* Tab: Fleet Chat */}
        {tab === 'chat' && (
          <div className="flex flex-col h-[calc(100vh-280px)] min-h-[300px] px-3 pb-2">
            {/* Message list */}
            <div className="flex-1 overflow-y-auto space-y-2 py-2 scrollbar-none">
              {chatMsgs.length === 0 && (
                <div className="flex flex-col items-center justify-center h-32 gap-2 text-slate-700">
                  <Icon name="MessageSquare" size={24} className="opacity-20" />
                  <span className="text-xs text-center">Send a message to fleet ops.<br/>Fleet can reply here in real time.</span>
                </div>
              )}
              {chatMsgs.map((msg, i) => (
                <div key={msg.id || i} className={`flex ${msg.from === 'driver' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] px-3 py-2 rounded-xl text-xs leading-relaxed ${
                    msg.from === 'driver'
                      ? 'bg-violet-500/15 border border-violet-500/25 text-violet-100 rounded-br-sm'
                      : msg.from === 'ai'
                      ? 'bg-cyan-500/10 border border-cyan-500/20 text-cyan-100 rounded-bl-sm'
                      : 'bg-slate-800/60 border border-slate-700/60 text-slate-200 rounded-bl-sm'
                  }`}>
                    {(msg.from === 'fleet' || msg.from === 'ai') && (
                      <div className="text-2xs text-slate-500 mb-1 flex items-center gap-1">
                        <Icon name={msg.from === 'ai' ? 'Cpu' : 'Radio'} size={9} />
                        {msg.from === 'ai' ? 'Apex AI' : 'Fleet Ops'}
                      </div>
                    )}
                    <div>{msg.text}</div>
                    <div className="text-2xs text-slate-600 mt-1 text-right">
                      {new Date(msg.ts).toLocaleTimeString('en-GB', { hour12: false, hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            {/* Input */}
            <div className="flex gap-2 pt-2 border-t border-slate-800/40">
              <input
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && sendChat()}
                placeholder="Message to fleet ops…"
                className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:border-violet-500 focus:outline-none"
              />
              <button onClick={sendChat} disabled={!chatInput.trim()}
                className="w-9 h-9 flex items-center justify-center bg-violet-500/15 border border-violet-500/25 rounded-xl text-violet-400 hover:bg-violet-500/25 disabled:opacity-30 transition-colors">
                <Icon name="Send" size={13} />
              </button>
            </div>
          </div>
        )}

      {/* Status bar */}
      <div className="px-4 py-2 border-t border-slate-800/60 flex items-center gap-3 flex-shrink-0">
        <StatusDot status={gpsActive ? 'online' : 'idle'} />
        <span className="text-2xs text-slate-600">
          {gpsActive ? 'Live GPS · sending telemetry to fleet' : 'GPS offline'}
        </span>
        {telemetry.lat && (
          <span className="ml-auto text-2xs text-slate-700 font-mono">
            {telemetry.lat.toFixed(4)}, {telemetry.lng.toFixed(4)}
          </span>
        )}
      </div>
    </div>
  )
}
