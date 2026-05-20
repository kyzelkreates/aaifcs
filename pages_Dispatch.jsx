/**
 * ============================================================
 * APEX AI — Dispatch Center (Local DB + Driver Sync)
 * Create jobs, assign drivers, send to driver app via:
 *   Bluetooth · Email · Web Share (WiFi Direct/AirDrop) · QR · Link
 * Listens for live telemetry coming back from driver.
 * ============================================================
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import Icon from './components_ui_Icon'
import Badge from './components_ui_Badge'
import StatusDot from './components_ui_StatusDot'
import { dispatchService, JOB_STATUS, JOB_PRIORITY, STATUS_COLORS, PRIORITY_COLORS } from './services_dispatch_dispatchService'
import { useFleetStore, useDriverStore } from './core_storage'
import { fleetService } from './services_fleet_fleetService'
import { driverService } from './services_drivers_driverService'
import {
  getQRCodeURL, sendViaEmail, sendViaShare, copyToClipboard,
  connectBluetooth, sendViaBluetooth, bluetoothConnected, disconnectBluetooth,
  listenForDriverTelemetry,
} from './services_sync_driverSyncService'
import { formatDateTime } from './utils_format'

const PRIORITY_ICONS = { low: 'ArrowDown', normal: 'Minus', high: 'ArrowUp', urgent: 'AlertOctagon' }

// ─── Driver Sync Modal ────────────────────────────────────────
function DriverSyncModal({ job, onClose }) {
  const [tab,      setTab]      = useState('link')   // link | qr | email | bluetooth
  const [status,   setStatus]   = useState(null)     // {ok, msg}
  const [qr,       setQR]       = useState(null)
  const [bleConn,  setBleConn]  = useState(false)
  const [email,    setEmail]    = useState(job.driver_email || '')

  const driverId = job.driver_id
  if (!driverId) return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-[#0d1426] border border-slate-800/60 rounded-xl p-6 w-full max-w-sm text-center">
        <Icon name="AlertCircle" size={32} className="text-amber-400 mx-auto mb-3" />
        <p className="text-white font-semibold mb-1">No driver assigned</p>
        <p className="text-slate-500 text-xs mb-4">Assign a driver to this job before sending.</p>
        <button onClick={onClose} className="btn-primary w-full">Close</button>
      </div>
    </div>
  )

  const showStatus = (ok, msg) => {
    setStatus({ ok, msg })
    setTimeout(() => setStatus(null), 4000)
  }

  const handleLink = async () => {
    const r = await copyToClipboard(driverId)
    showStatus(r.ok, r.ok ? 'Link copied to clipboard!' : r.error)
  }

  const handleShare = async () => {
    const r = await sendViaShare(driverId)
    showStatus(r.ok, r.ok ? 'Shared successfully' : r.error)
  }

  const handleEmail = () => {
    const r = sendViaEmail(driverId, email)
    showStatus(r.ok, r.ok ? 'Email client opened' : r.error)
  }

  const handleQR = () => {
    const q = getQRCodeURL(driverId, 240)
    setQR(q)
  }

  const handleBLE = async () => {
    if (!bluetoothConnected()) {
      showStatus(null, 'Connecting via Bluetooth…')
      const conn = await connectBluetooth()
      if (!conn.ok) { showStatus(false, conn.error); return }
      setBleConn(true)
      showStatus(true, `Connected: ${conn.deviceName}`)
    }
    const r = await sendViaBluetooth(driverId)
    showStatus(r.ok, r.ok ? `Sent ${r.bytes} bytes via Bluetooth` : r.error)
  }

  const TABS = [
    { key: 'link',      label: 'Link',       icon: 'Link' },
    { key: 'qr',        label: 'QR Code',    icon: 'QrCode' },
    { key: 'email',     label: 'Email',      icon: 'Mail' },
    { key: 'bluetooth', label: 'Bluetooth',  icon: 'Bluetooth' },
  ]

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-[#0d1426] border border-slate-800/60 rounded-xl w-full max-w-md">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800/60">
          <div>
            <h2 className="font-display font-semibold text-white text-sm">Send to Driver</h2>
            <p className="text-slate-500 text-2xs mt-0.5 truncate max-w-[260px]">{job.title}</p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white p-1.5 rounded-md hover:bg-slate-800/60">
            <Icon name="X" size={16} />
          </button>
        </div>

        {/* Driver info */}
        <div className="px-5 pt-4 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
            <Icon name="User" size={14} className="text-violet-400" />
          </div>
          <div>
            <div className="text-white text-sm font-medium">{job.driver_name || 'Driver'}</div>
            <div className="text-slate-500 text-2xs">{job.vehicle_reg || 'No vehicle'}</div>
          </div>
          <div className="ml-auto">
            <span className={`text-2xs px-2 py-0.5 rounded border font-semibold uppercase ${
              job.priority === 'urgent' ? 'text-red-400 border-red-500/30 bg-red-500/5' :
              job.priority === 'high'   ? 'text-amber-400 border-amber-500/30 bg-amber-500/5' :
              'text-cyan-400 border-cyan-500/30 bg-cyan-500/5'
            }`}>{job.priority}</span>
          </div>
        </div>

        {/* Method tabs */}
        <div className="flex border-b border-slate-800/60 mt-4">
          {TABS.map(t => (
            <button key={t.key} onClick={() => { setTab(t.key); setQR(null); setStatus(null) }}
              className={`flex-1 flex flex-col items-center gap-1 py-3 text-xs transition-all ${
                tab === t.key
                  ? 'text-cyan-400 border-b-2 border-cyan-400'
                  : 'text-slate-500 hover:text-slate-300'
              }`}>
              <Icon name={t.icon} size={16} />
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="p-5 space-y-3 min-h-[180px]">

          {/* Status banner */}
          {status && (
            <div className={`flex items-center gap-2 rounded-lg px-3 py-2.5 text-xs ${
              status.ok === true  ? 'bg-emerald-500/10 border border-emerald-500/25 text-emerald-400' :
              status.ok === false ? 'bg-red-500/10 border border-red-500/25 text-red-400' :
              'bg-cyan-500/10 border border-cyan-500/25 text-cyan-400'
            }`}>
              <Icon name={status.ok === true ? 'CheckCircle' : status.ok === false ? 'AlertCircle' : 'Loader2'} size={13} className={status.ok === null ? 'animate-spin' : ''} />
              {status.msg}
            </div>
          )}

          {/* Link / Web Share */}
          {tab === 'link' && (
            <div className="space-y-3">
              <p className="text-slate-400 text-xs leading-relaxed">
                Copy a deep link. The driver opens it in their browser — jobs import automatically into the AP3X app.
                Works over <strong className="text-slate-300">WiFi, WiFi Direct, AirDrop, Nearby Share</strong> — anything that can open a URL.
              </p>
              <button onClick={handleLink}
                className="w-full bg-slate-800/60 border border-slate-700 text-white text-sm font-medium rounded-lg py-2.5 flex items-center justify-center gap-2 hover:bg-slate-800 transition-colors">
                <Icon name="Copy" size={15} /> Copy Link
              </button>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-px bg-slate-800" />
                <span className="text-slate-600 text-2xs">or</span>
                <div className="flex-1 h-px bg-slate-800" />
              </div>
              <button onClick={handleShare}
                className="w-full bg-cyan-500/10 border border-cyan-500/25 text-cyan-400 text-sm font-medium rounded-lg py-2.5 flex items-center justify-center gap-2 hover:bg-cyan-500/20 transition-colors">
                <Icon name="Share2" size={15} /> Share (WiFi Direct / AirDrop / Nearby Share)
              </button>
              <p className="text-slate-600 text-2xs text-center">Uses your device's native share sheet</p>
            </div>
          )}

          {/* QR Code */}
          {tab === 'qr' && (
            <div className="space-y-3 flex flex-col items-center">
              <p className="text-slate-400 text-xs leading-relaxed text-center">
                Driver scans this QR code with their phone camera. Jobs import automatically.
              </p>
              {!qr ? (
                <button onClick={handleQR}
                  className="bg-cyan-500/10 border border-cyan-500/25 text-cyan-400 text-sm font-medium rounded-lg py-2.5 px-6 flex items-center gap-2 hover:bg-cyan-500/20 transition-colors">
                  <Icon name="QrCode" size={15} /> Generate QR Code
                </button>
              ) : (
                <>
                  <div className="p-3 bg-[#0d1426] border border-cyan-500/20 rounded-xl">
                    <img src={qr.url} alt="Sync QR Code" width={200} height={200} className="rounded-lg" />
                  </div>
                  <p className="text-slate-600 text-2xs text-center">
                    Scan with phone camera · Opens in AP3X driver app
                  </p>
                  <a href={qr.link} className="text-cyan-400 text-2xs underline break-all text-center max-w-full"
                     target="_blank" rel="noreferrer">Open link</a>
                </>
              )}
            </div>
          )}

          {/* Email */}
          {tab === 'email' && (
            <div className="space-y-3">
              <p className="text-slate-400 text-xs leading-relaxed">
                Opens your email client with the job link and sync code pre-filled.
              </p>
              <div className="space-y-1">
                <label className="text-2xs text-slate-500 uppercase tracking-wider">Driver Email (optional)</label>
                <input
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  type="email"
                  placeholder="driver@fleet.io"
                  className="w-full bg-slate-900/60 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-700 outline-none focus:border-cyan-500/40"
                />
              </div>
              <button onClick={handleEmail}
                className="w-full bg-cyan-500/10 border border-cyan-500/25 text-cyan-400 text-sm font-medium rounded-lg py-2.5 flex items-center justify-center gap-2 hover:bg-cyan-500/20 transition-colors">
                <Icon name="Mail" size={15} /> Open Email Client
              </button>
            </div>
          )}

          {/* Bluetooth */}
          {tab === 'bluetooth' && (
            <div className="space-y-3">
              <p className="text-slate-400 text-xs leading-relaxed">
                Uses <strong className="text-slate-300">Web Bluetooth</strong> to push jobs directly to the driver's device.
                Requires Chrome on Android or desktop. Both devices must support BLE.
              </p>
              <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs ${
                bleConn
                  ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400'
                  : 'bg-slate-900/40 border-slate-800 text-slate-500'
              }`}>
                <Icon name="Bluetooth" size={13} />
                {bleConn ? 'Bluetooth connected' : 'Not connected'}
              </div>
              <button onClick={handleBLE}
                className="w-full bg-cyan-500/10 border border-cyan-500/25 text-cyan-400 text-sm font-medium rounded-lg py-2.5 flex items-center justify-center gap-2 hover:bg-cyan-500/20 transition-colors">
                <Icon name="Bluetooth" size={15} />
                {bluetoothConnected() ? 'Send Jobs via Bluetooth' : 'Connect & Send via Bluetooth'}
              </button>
              {bluetoothConnected() && (
                <button onClick={() => { disconnectBluetooth(); setBleConn(false) }}
                  className="w-full text-xs text-slate-500 hover:text-red-400 transition-colors">
                  Disconnect
                </button>
              )}
            </div>
          )}
        </div>

        <div className="px-5 pb-4">
          <button onClick={onClose}
            className="w-full bg-slate-800/40 border border-slate-700/60 text-slate-400 text-sm rounded-lg py-2 hover:bg-slate-800 transition-colors">
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Live Telemetry Feed ──────────────────────────────────────
function TelemetryFeed({ events }) {
  if (!events.length) return null
  return (
    <div className="bg-[#0a0f1e] border border-slate-800/40 rounded-xl p-3">
      <div className="flex items-center gap-2 mb-2">
        <StatusDot status="online" />
        <span className="text-2xs text-slate-400 font-semibold uppercase tracking-wider">Live Driver Telemetry</span>
      </div>
      <div className="space-y-1.5 max-h-40 overflow-y-auto scrollbar-none">
        {events.slice(0, 10).map((e, i) => (
          <div key={i} className="flex items-center gap-3 text-2xs text-slate-500">
            <span className="text-slate-700 font-mono flex-shrink-0">{new Date(e.ts).toLocaleTimeString('en-GB', { hour12: false })}</span>
            <span className="text-cyan-400 font-mono flex-shrink-0">{e.driver_id?.slice(0, 8)}</span>
            {e.speed != null && <span>🚗 {e.speed} km/h</span>}
            {e.fuel  != null && <span>⛽ {e.fuel}%</span>}
            {e.lat   != null && <span className="font-mono">{e.lat?.toFixed(4)}, {e.lng?.toFixed(4)}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Job Card ─────────────────────────────────────────────────
function JobCard({ job, onAssign, onCancel, onComplete, onSync }) {
  const priColor = PRIORITY_COLORS[job.priority] || 'muted'
  const stsColor = STATUS_COLORS[job.status] || 'muted'
  return (
    <div className={`bg-[#0d1426] border rounded-xl p-4 transition-all ${
      job.priority === 'urgent' ? 'border-red-500/30' : 'border-slate-800/60'
    }`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-white truncate">{job.title || `Job #${job.id?.slice(0,8)}`}</div>
          <div className="text-xs text-slate-500 mt-0.5 truncate">
            {job.origin || '—'} → {job.destination || '—'}
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <Badge variant={priColor} size="sm">
            <Icon name={PRIORITY_ICONS[job.priority] || 'Minus'} size={9} />
            {job.priority}
          </Badge>
          <Badge variant={stsColor} size="sm">{job.status?.replace('_', ' ')}</Badge>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs text-slate-500 mb-3">
        <div className="flex items-center gap-1.5">
          <Icon name="User" size={11} className="text-slate-600" />
          {job.driver_name || 'Unassigned'}
        </div>
        <div className="flex items-center gap-1.5">
          <Icon name="Truck" size={11} className="text-slate-600" />
          {job.vehicle_reg || 'No vehicle'}
        </div>
        {job.scheduled_at && (
          <div className="flex items-center gap-1.5 col-span-2">
            <Icon name="Clock" size={11} className="text-slate-600" />
            {formatDateTime(job.scheduled_at)}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {job.status === JOB_STATUS.PENDING && (
          <button onClick={() => onAssign?.(job)}
            className="flex-1 py-1.5 text-xs bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 rounded-lg hover:bg-cyan-500/20 transition-colors">
            <Icon name="UserCheck" size={11} className="inline mr-1" />Assign
          </button>
        )}
        {[JOB_STATUS.ASSIGNED, JOB_STATUS.IN_PROGRESS].includes(job.status) && (
          <>
            <button onClick={() => onSync?.(job)}
              className="flex-1 py-1.5 text-xs bg-violet-500/10 border border-violet-500/25 text-violet-400 rounded-lg hover:bg-violet-500/20 transition-colors">
              <Icon name="Send" size={11} className="inline mr-1" />Send to Driver
            </button>
            <button onClick={() => onComplete?.(job.id)}
              className="py-1.5 px-3 text-xs bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-lg hover:bg-emerald-500/20 transition-colors">
              <Icon name="Check" size={11} />
            </button>
          </>
        )}
        {![JOB_STATUS.COMPLETED, JOB_STATUS.CANCELLED].includes(job.status) && (
          <button onClick={() => onCancel?.(job.id)}
            className="py-1.5 px-2.5 text-xs text-red-400 border border-red-500/20 rounded-lg hover:bg-red-500/10 transition-colors">
            <Icon name="X" size={11} />
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Assign Modal ─────────────────────────────────────────────
function AssignModal({ job, drivers, vehicles, onClose, onSaved }) {
  const [driverId,  setDriverId]  = useState(job.driver_id  || '')
  const [vehicleId, setVehicleId] = useState(job.vehicle_id || '')
  const [saving,    setSaving]    = useState(false)

  const handleSubmit = (e) => {
    e.preventDefault(); setSaving(true)
    const driver  = drivers.find(d => d.id === driverId)
    const vehicle = vehicles.find(v => v.id === vehicleId)
    dispatchService.assignJob(job.id, driverId, vehicleId,
      driver?.full_name, vehicle?.reg_number)
    setSaving(false)
    onSaved?.(); onClose?.()
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-[#0d1426] border border-slate-800/60 rounded-xl w-full max-w-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800/60">
          <h2 className="font-semibold text-white text-sm">Assign Job</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-white p-1"><Icon name="X" size={15} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <p className="text-slate-400 text-xs truncate">{job.title}</p>
          <div className="space-y-1.5">
            <label className="text-xs text-slate-400">Driver</label>
            <select value={driverId} onChange={e => setDriverId(e.target.value)} required className="apex-input w-full">
              <option value="">Select driver…</option>
              {drivers.map(d => <option key={d.id} value={d.id}>{d.full_name}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-slate-400">Vehicle</label>
            <select value={vehicleId} onChange={e => setVehicleId(e.target.value)} className="apex-input w-full">
              <option value="">Select vehicle…</option>
              {vehicles.map(v => <option key={v.id} value={v.id}>{v.reg_number} — {v.make}</option>)}
            </select>
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="flex-1 btn-ghost text-sm py-2">Cancel</button>
            <button type="submit" disabled={saving || !driverId} className="flex-1 btn-primary text-sm py-2 disabled:opacity-40">
              Assign
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Create Job Modal ─────────────────────────────────────────
// ─── Nominatim geocode helper (used inside JobModal) ──────────
async function geocodeSingle(q) {
  if (!q || !q.trim()) return null
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1`,
      { headers: { 'User-Agent': 'ApexAI-FleetOS/2.0' } }
    )
    const d = await r.json()
    if (d[0]) return { lat: parseFloat(d[0].lat), lng: parseFloat(d[0].lon), label: d[0].display_name }
  } catch {}
  return null
}

// ─── Route summary helper (OSRM) ─────────────────────────────
async function calcRouteSummary(stops) {
  // stops = [{lat,lng}, ...]
  if (stops.length < 2) return null
  const coords = stops.map(s => `${s.lng},${s.lat}`).join(';')
  try {
    const r = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${coords}?overview=false`,
      { signal: AbortSignal.timeout(8000) }
    )
    const d = await r.json()
    if (d.routes?.[0]) {
      return { distance_m: d.routes[0].distance, duration_s: d.routes[0].duration }
    }
  } catch {}
  return null
}

// ─── Job Modal — Full Route Planner ──────────────────────────
function JobModal({ onClose, onSaved, vehicles, drivers }) {
  const [mode,   setMode]   = useState('single') // 'single' | 'multi'
  const [form,   setForm]   = useState({
    title: '', priority: JOB_PRIORITY.NORMAL, notes: '',
    driver_id: '', vehicle_id: '', scheduled_at: '',
    job_type: 'delivery',
    pickup_address: '',
    special_instructions: '',
  })
  const [stops,     setStops]    = useState([{ id: Date.now(), address: '', name: '', contact: '', ref: '', geocoded: null, geocoding: false }])
  const [routeSummary, setRouteSummary] = useState(null)
  const [calcRouting,  setCalcRouting]  = useState(false)
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState(null)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // Selected vehicle profile for routing context
  const vehicleProfile = vehicles.find(v => v.id === form.vehicle_id) || null

  // ── Stop management ──────────────────────────────────────────
  const addStop = () => setStops(s => [...s, { id: Date.now(), address: '', name: '', contact: '', ref: '', geocoded: null, geocoding: false }])
  const removeStop = (id) => setStops(s => s.filter(x => x.id !== id))
  const updateStop = (id, field, val) => setStops(s => s.map(x => x.id === id ? { ...x, [field]: val, geocoded: field === 'address' ? null : x.geocoded } : x))
  const moveStop = (id, dir) => {
    setStops(s => {
      const idx = s.findIndex(x => x.id === id)
      if (dir === 'up'   && idx === 0)           return s
      if (dir === 'down' && idx === s.length - 1) return s
      const next = [...s]
      const swapIdx = dir === 'up' ? idx - 1 : idx + 1
      ;[next[idx], next[swapIdx]] = [next[swapIdx], next[idx]]
      return next
    })
  }

  // Geocode a single stop address
  const geocodeStop = async (id) => {
    const stop = stops.find(s => s.id === id)
    if (!stop?.address?.trim()) return
    setStops(s => s.map(x => x.id === id ? { ...x, geocoding: true } : x))
    const result = await geocodeSingle(stop.address)
    setStops(s => s.map(x => x.id === id ? { ...x, geocoding: false, geocoded: result } : x))
  }

  // Calculate route summary when stops change
  const calcRoute = async () => {
    const geocoded = stops.filter(s => s.geocoded)
    if (geocoded.length < 2) { setRouteSummary(null); return }
    setCalcRouting(true)
    const summary = await calcRouteSummary(geocoded.map(s => s.geocoded))
    setRouteSummary(summary)
    setCalcRouting(false)
  }

  const fmtDist = m => m >= 1000 ? `${(m/1000).toFixed(1)} km` : `${Math.round(m)} m`
  const fmtDur  = s => { const h = Math.floor(s/3600), m = Math.floor((s%3600)/60); return h > 0 ? `${h}h ${m}m` : `${m} min` }

  const handleSubmit = () => {
    if (!form.title.trim())        { setError('Job title is required'); return }
    if (stops.every(s => !s.address.trim())) { setError('At least one stop address is required'); return }
    setSaving(true); setError(null)
    const driver  = drivers.find(d => d.id === form.driver_id)
    const vehicle = vehicles.find(v => v.id === form.vehicle_id)

    // Build stops array — driver app reads job.stops[]
    const stopsPayload = stops
      .filter(s => s.address.trim())
      .map((s, i) => ({
        idx:      i + 1,
        address:  s.address,
        name:     s.name    || `Stop ${i + 1}`,
        contact:  s.contact || '',
        ref:      s.ref     || '',
        geocoded: s.geocoded || null,
      }))

    // Derive origin + destination for backwards compat
    const origin      = form.pickup_address || stopsPayload[0]?.address || ''
    const destination = stopsPayload[stopsPayload.length - 1]?.address || ''

    const job = {
      ...form,
      driver_name:  driver?.full_name  || '',
      vehicle_reg:  vehicle?.reg_number || '',
      // Vehicle profile — full dimensions for routing
      vehicle_profile: vehicle ? {
        type:           vehicle.type,
        height_m:       vehicle.height_m,
        width_m:        vehicle.width_m,
        length_m:       vehicle.length_m,
        gross_weight_t: vehicle.gross_weight_t,
        axle_weight_t:  vehicle.axle_weight_t,
        num_axles:      vehicle.num_axles,
        hazmat:         vehicle.hazmat,
        hazmat_class:   vehicle.hazmat_class,
        tunnel_category:vehicle.tunnel_category,
        max_speed_kmh:  vehicle.max_speed_kmh,
        low_emission_zone: vehicle.low_emission_zone,
        fuel_type:      vehicle.fuel_type,
        euro_standard:  vehicle.euro_standard,
      } : null,
      origin,
      destination,
      stops:         stopsPayload,
      mode,
      route_summary: routeSummary,
      stop_count:    stopsPayload.length,
    }

    dispatchService.createJob(job)
    setSaving(false)
    onSaved?.(); onClose?.()
  }

  const allGeocoded = stops.filter(s => s.address.trim()).every(s => s.geocoded)

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-3">
      <div className="bg-[#0a0f1e] border border-slate-800/60 rounded-2xl w-full max-w-2xl max-h-[96vh] flex flex-col shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800/50 flex-shrink-0">
          <div>
            <h2 className="font-semibold text-white">New Dispatch Job</h2>
            <p className="text-2xs text-slate-600 mt-0.5">Route planner · Vehicle-profile aware · Syncs to driver app</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg text-slate-500 hover:text-white hover:bg-slate-800 transition-colors">
            <Icon name="X" size={15} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">

          {/* Job basics */}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1.5">
              <label className="text-xs text-slate-400 font-medium">Job Title <span className="text-red-400">*</span></label>
              <input className="apex-input w-full" value={form.title}
                onChange={e => set('title', e.target.value)}
                placeholder="e.g. Tesco Delivery — Manchester DC" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-slate-400 font-medium">Job Type</label>
              <select className="apex-input w-full" value={form.job_type} onChange={e => set('job_type', e.target.value)}>
                {['delivery','collection','transfer','multi-drop','return','service call'].map(t =>
                  <option key={t} value={t}>{t.charAt(0).toUpperCase()+t.slice(1)}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-slate-400 font-medium">Priority</label>
              <select className="apex-input w-full" value={form.priority} onChange={e => set('priority', e.target.value)}>
                {Object.entries(JOB_PRIORITY).map(([k, v]) => <option key={k} value={v}>{k}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-slate-400 font-medium">Scheduled Date / Time</label>
              <input type="datetime-local" className="apex-input w-full" value={form.scheduled_at}
                onChange={e => set('scheduled_at', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-slate-400 font-medium">Pickup / Origin Address</label>
              <input className="apex-input w-full" value={form.pickup_address}
                onChange={e => set('pickup_address', e.target.value)}
                placeholder="Where driver starts loading" />
            </div>
          </div>

          {/* Assign */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs text-slate-400 font-medium">Assign Driver</label>
              <select className="apex-input w-full" value={form.driver_id} onChange={e => set('driver_id', e.target.value)}>
                <option value="">— Unassigned —</option>
                {drivers.map(d => <option key={d.id} value={d.id}>{d.full_name}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-slate-400 font-medium">Assign Vehicle</label>
              <select className="apex-input w-full" value={form.vehicle_id} onChange={e => set('vehicle_id', e.target.value)}>
                <option value="">— None —</option>
                {vehicles.map(v => <option key={v.id} value={v.id}>{v.reg_number} {v.make} {v.model ? `· ${v.model}` : ''}</option>)}
              </select>
            </div>
          </div>

          {/* Vehicle profile summary (shown when vehicle selected) */}
          {vehicleProfile && (
            <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800/40 flex flex-wrap gap-3 text-2xs">
              <div className="flex items-center gap-1.5 text-slate-400">
                <Icon name="Truck" size={11} className="text-cyan-400" />
                <span className="font-semibold text-white">{vehicleProfile.reg_number}</span>
                <span>{vehicleProfile.make} {vehicleProfile.model}</span>
              </div>
              {vehicleProfile.height_m       && <span className="text-slate-500">H: <span className="text-amber-300 font-mono">{vehicleProfile.height_m}m</span></span>}
              {vehicleProfile.width_m        && <span className="text-slate-500">W: <span className="font-mono text-white">{vehicleProfile.width_m}m</span></span>}
              {vehicleProfile.length_m       && <span className="text-slate-500">L: <span className="font-mono text-white">{vehicleProfile.length_m}m</span></span>}
              {vehicleProfile.gross_weight_t && <span className="text-slate-500">GVW: <span className="font-mono text-white">{vehicleProfile.gross_weight_t}t</span></span>}
              {vehicleProfile.num_axles      && <span className="text-slate-500">Axles: <span className="font-mono text-white">{vehicleProfile.num_axles}</span></span>}
              {vehicleProfile.hazmat         && <span className="text-red-400 font-semibold">⚠ ADR Class {vehicleProfile.hazmat_class}</span>}
              {vehicleProfile.height_m && parseFloat(vehicleProfile.height_m) > 3.0 && (
                <span className="text-amber-400">Low bridges avoided</span>
              )}
              <span className="text-emerald-400 text-2xs">✓ Profile applied to routing</span>
            </div>
          )}

          {/* Journey mode */}
          <div>
            <div className="text-xs text-slate-400 font-medium mb-2">Journey Type</div>
            <div className="flex gap-2">
              {[
                { key: 'single', label: 'Single Drop',   icon: 'MapPin',    sub: 'One destination' },
                { key: 'multi',  label: 'Multi-Drop',    icon: 'GitCommit', sub: 'Multiple stops' },
              ].map(m => (
                <button key={m.key} type="button" onClick={() => { setMode(m.key); if (m.key === 'single' && stops.length > 1) setStops([stops[0]]) }}
                  className={`flex-1 flex items-center gap-2.5 p-3 rounded-xl border transition-all text-left ${
                    mode === m.key
                      ? 'border-cyan-500/40 bg-cyan-500/6 text-white'
                      : 'border-slate-800/60 text-slate-500 hover:border-slate-700 hover:text-slate-300'
                  }`}>
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${mode === m.key ? 'bg-cyan-500/15' : 'bg-slate-800'}`}>
                    <Icon name={m.icon} size={14} className={mode === m.key ? 'text-cyan-400' : 'text-slate-600'} />
                  </div>
                  <div>
                    <div className="text-xs font-semibold">{m.label}</div>
                    <div className="text-2xs text-slate-600">{m.sub}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Stops builder */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs text-slate-400 font-medium">
                {mode === 'single' ? 'Delivery Address' : `Stops (${stops.length})`}
              </div>
              {allGeocoded && stops.filter(s => s.address.trim()).length >= 2 && (
                <button type="button" onClick={calcRoute}
                  className="flex items-center gap-1 text-2xs text-cyan-400 hover:text-cyan-300 transition-colors">
                  <Icon name="RefreshCw" size={10} className={calcRouting ? 'animate-spin' : ''} />
                  {calcRouting ? 'Calculating…' : 'Calculate route'}
                </button>
              )}
            </div>

            <div className="space-y-2">
              {stops.map((stop, i) => (
                <div key={stop.id} className="rounded-xl border border-slate-800/50 bg-slate-900/30 overflow-hidden">
                  {/* Stop header */}
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-800/30 bg-slate-900/20">
                    <div className="w-5 h-5 rounded-full bg-cyan-500/15 border border-cyan-500/25 flex items-center justify-center flex-shrink-0">
                      <span className="text-2xs font-bold text-cyan-400">{i + 1}</span>
                    </div>
                    <span className="text-2xs font-semibold text-slate-400 flex-1">
                      {i === 0 ? 'First Stop' : i === stops.length - 1 ? 'Final Stop' : `Stop ${i + 1}`}
                    </span>
                    <div className="flex items-center gap-1">
                      {stops.length > 1 && i > 0 && (
                        <button type="button" onClick={() => moveStop(stop.id, 'up')}
                          className="p-1 rounded text-slate-700 hover:text-slate-400 transition-colors">
                          <Icon name="ChevronUp" size={12} />
                        </button>
                      )}
                      {stops.length > 1 && i < stops.length - 1 && (
                        <button type="button" onClick={() => moveStop(stop.id, 'down')}
                          className="p-1 rounded text-slate-700 hover:text-slate-400 transition-colors">
                          <Icon name="ChevronDown" size={12} />
                        </button>
                      )}
                      {stops.length > 1 && (
                        <button type="button" onClick={() => removeStop(stop.id)}
                          className="p-1 rounded text-slate-700 hover:text-red-400 transition-colors">
                          <Icon name="Trash2" size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                  {/* Stop fields */}
                  <div className="p-3 space-y-2">
                    {/* Address + geocode */}
                    <div className="flex gap-2">
                      <div className="flex-1 relative">
                        <input className="apex-input w-full pr-8 text-xs"
                          value={stop.address}
                          onChange={e => updateStop(stop.id, 'address', e.target.value)}
                          onBlur={() => stop.address.trim() && !stop.geocoded && geocodeStop(stop.id)}
                          placeholder="Full delivery address" />
                        {stop.geocoding && (
                          <div className="absolute right-2 top-1/2 -translate-y-1/2">
                            <div className="w-3 h-3 border border-cyan-500/30 border-t-cyan-400 rounded-full animate-spin" />
                          </div>
                        )}
                        {stop.geocoded && !stop.geocoding && (
                          <div className="absolute right-2 top-1/2 -translate-y-1/2">
                            <Icon name="CheckCircle2" size={12} className="text-emerald-400" />
                          </div>
                        )}
                      </div>
                      <button type="button" onClick={() => geocodeStop(stop.id)}
                        disabled={!stop.address.trim() || stop.geocoding}
                        className="px-2 py-1.5 rounded-lg border border-slate-700 text-slate-500 hover:text-cyan-400 hover:border-cyan-500/30 transition-colors disabled:opacity-30 flex-shrink-0">
                        <Icon name="Search" size={12} />
                      </button>
                    </div>
                    {stop.geocoded && (
                      <div className="text-2xs text-emerald-400/70 flex items-center gap-1 px-1">
                        <Icon name="MapPin" size={9} />
                        {stop.geocoded.label?.split(',').slice(0,3).join(', ')}
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      <input className="apex-input text-xs" value={stop.name}
                        onChange={e => updateStop(stop.id, 'name', e.target.value)}
                        placeholder="Location name (optional)" />
                      <input className="apex-input text-xs" value={stop.contact}
                        onChange={e => updateStop(stop.id, 'contact', e.target.value)}
                        placeholder="Contact name / phone" />
                    </div>
                    <input className="apex-input text-xs w-full" value={stop.ref}
                      onChange={e => updateStop(stop.id, 'ref', e.target.value)}
                      placeholder="Reference / PO number (optional)" />
                  </div>
                </div>
              ))}
            </div>

            {mode === 'multi' && (
              <button type="button" onClick={addStop}
                className="mt-2 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-dashed border-slate-700 text-slate-600 hover:text-cyan-400 hover:border-cyan-500/30 text-xs font-medium transition-colors">
                <Icon name="Plus" size={13} />
                Add Stop
              </button>
            )}

            {/* Route summary */}
            {routeSummary && (
              <div className="mt-3 flex items-center gap-4 p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/15">
                <Icon name="Route" size={14} className="text-emerald-400 flex-shrink-0" />
                <div className="flex gap-4 flex-wrap text-xs">
                  <span className="text-slate-400">Total distance: <span className="text-white font-mono font-semibold">{fmtDist(routeSummary.distance_m)}</span></span>
                  <span className="text-slate-400">Est. duration: <span className="text-white font-mono font-semibold">{fmtDur(routeSummary.duration_s)}</span></span>
                  {stops.filter(s=>s.address.trim()).length > 1 && (
                    <span className="text-slate-400">Stops: <span className="text-cyan-400 font-semibold">{stops.filter(s=>s.address.trim()).length}</span></span>
                  )}
                </div>
                {vehicleProfile?.height_m && parseFloat(vehicleProfile.height_m) > 3.0 && (
                  <span className="text-amber-400 text-2xs ml-auto flex items-center gap-1">
                    <Icon name="AlertTriangle" size={10} /> Low bridges excluded
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Notes / special instructions */}
          <div className="space-y-1.5">
            <label className="text-xs text-slate-400 font-medium">Special Instructions / Notes</label>
            <textarea className="apex-input w-full resize-none" rows={2}
              value={form.notes} onChange={e => set('notes', e.target.value)}
              placeholder="Loading bay info, access codes, timing restrictions, hazmat notes…" />
          </div>

          {error && (
            <div className="flex items-center gap-2 bg-red-500/5 border border-red-500/20 rounded-lg px-3 py-2">
              <Icon name="AlertCircle" size={13} className="text-red-400 flex-shrink-0" />
              <span className="text-red-400 text-xs">{error}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-800/50 flex-shrink-0">
          <div className="text-2xs text-slate-700">
            {stops.filter(s => s.address.trim()).length} stop{stops.filter(s => s.address.trim()).length !== 1 ? 's' : ''} · {allGeocoded ? '✓ all geocoded' : 'geocode to verify'}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm text-slate-500 hover:text-white hover:bg-slate-800 transition-colors">
              Cancel
            </button>
            <button type="button" onClick={handleSubmit} disabled={saving}
              className="flex items-center gap-2 px-5 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-black text-sm font-bold transition-colors disabled:opacity-40">
              <Icon name={saving ? 'Loader2' : 'Send'} size={13} className={saving ? 'animate-spin' : ''} />
              {saving ? 'Creating…' : 'Create & Dispatch'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Dispatch Page ────────────────────────────────────────────
export default function Dispatch() {
  const { vehicles } = useFleetStore(s => ({ vehicles: s.vehicles }))
  const { drivers }  = useDriverStore(s => ({ drivers: s.drivers }))
  const [jobs,       setJobs]      = useState([])
  const [loading,    setLoading]   = useState(false)
  const [createModal, setCreate]   = useState(false)
  const [assignJob,  setAssignJob] = useState(null)
  const [syncJob,    setSyncJob]   = useState(null)
  const [filter,     setFilter]    = useState(null)
  const [telEvents,  setTelEvents] = useState([])

  const load = useCallback(() => {
    setLoading(true)
    try { setJobs(dispatchService.fetchJobs()) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    load()
    fleetService.fetchVehicles()
    driverService.fetchDrivers()
    const unsub = dispatchService.subscribeToJobs(() => load())
    // Listen for incoming driver telemetry
    const unsubTel = listenForDriverTelemetry((pkg) => {
      setTelEvents(prev => [{ ...pkg, ts: Date.now() }, ...prev].slice(0, 50))
    })
    return () => { unsub?.(); unsubTel?.() }
  }, [load])

  const handleComplete = (id) => {
    dispatchService.completeJob(id)
    load()
  }

  const handleCancel = (id) => {
    if (!confirm('Cancel this job?')) return
    dispatchService.cancelJob(id, 'Cancelled by operator')
    load()
  }

  const counts = Object.values(JOB_STATUS).reduce((acc, s) => {
    acc[s] = jobs.filter(j => j.status === s).length
    return acc
  }, {})

  const filtered = jobs.filter(j => !filter || j.status === filter)

  const STATUS_TABS = [
    { key: null,                   label: 'All',         count: jobs.length },
    { key: JOB_STATUS.PENDING,     label: 'Pending',     count: counts.pending     || 0 },
    { key: JOB_STATUS.ASSIGNED,    label: 'Assigned',    count: counts.assigned    || 0 },
    { key: JOB_STATUS.IN_PROGRESS, label: 'In Progress', count: counts.in_progress || 0 },
    { key: JOB_STATUS.COMPLETED,   label: 'Completed',   count: counts.completed   || 0 },
  ]

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 py-4 border-b border-slate-800/60 flex-shrink-0">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="font-display text-xl font-bold text-white">Dispatch Center</h1>
            <p className="text-slate-500 text-xs mt-0.5">
              {jobs.length} job{jobs.length !== 1 ? 's' : ''} · {counts.pending || 0} pending
            </p>
          </div>
          <button onClick={() => setCreate(true)} className="btn-primary text-sm px-4 py-2 flex items-center gap-1.5">
            <Icon name="Plus" size={14} /> New Job
          </button>
        </div>
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-none">
          {STATUS_TABS.map(t => (
            <button key={t.key} onClick={() => setFilter(t.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-all ${
                filter === t.key ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/40'
              }`}>
              {t.label}
              <span className={`text-2xs px-1.5 py-0.5 rounded-full ${filter === t.key ? 'bg-cyan-500/20 text-cyan-400' : 'bg-slate-800 text-slate-600'}`}>
                {t.count}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-5 space-y-4">
        {/* Live telemetry feed */}
        <TelemetryFeed events={telEvents} />

        {/* Job grid */}
        {loading && filtered.length === 0 ? (
          <div className="flex items-center justify-center h-48">
            <div className="w-8 h-8 border-2 border-cyan-500/20 border-t-cyan-400 rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-slate-600">
            <Icon name="Radio" size={40} className="mb-4 opacity-20" />
            <p className="text-sm">No jobs yet</p>
            <p className="text-xs mt-1">Create a job and assign it to a driver</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map(j => (
              <JobCard key={j.id} job={j}
                onAssign={setAssignJob}
                onComplete={handleComplete}
                onCancel={handleCancel}
                onSync={setSyncJob}
              />
            ))}
          </div>
        )}
      </div>

      {/* Modals */}
      {createModal && (
        <JobModal
          onClose={() => setCreate(false)}
          onSaved={load}
          vehicles={vehicles}
          drivers={drivers}
        />
      )}
      {assignJob && (
        <AssignModal
          job={assignJob}
          drivers={drivers}
          vehicles={vehicles}
          onClose={() => setAssignJob(null)}
          onSaved={load}
        />
      )}
      {syncJob && (
        <DriverSyncModal
          job={syncJob}
          onClose={() => setSyncJob(null)}
        />
      )}
    </div>
  )
}
