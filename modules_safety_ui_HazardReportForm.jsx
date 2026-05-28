/**
 * AP3X Hazard Report Form
 * Submit road hazards with geolocation.
 * Saves locally first (offline vault) then syncs to Supabase.
 *
 * DRIVER PWA ONLY.
 */
import { useState } from 'react'
import { getSupabaseClient } from './services_supabase_supabaseClient'
import { saveIncidentLocally } from './services_safety_offlineVault'
import Icon from './components_ui_Icon'

const HAZARD_TYPES = [
  { key: 'debris',     label: 'Road Debris',   icon: 'AlertTriangle' },
  { key: 'pothole',    label: 'Pothole',        icon: 'Circle' },
  { key: 'accident',   label: 'Accident Ahead', icon: 'Zap' },
  { key: 'congestion', label: 'Heavy Traffic',  icon: 'TrendingUp' },
  { key: 'weather',    label: 'Weather Hazard', icon: 'Cloud' },
  { key: 'flooding',   label: 'Flooding',       icon: 'Droplets' },
  { key: 'roadworks',  label: 'Roadworks',      icon: 'Construction' },
  { key: 'other',      label: 'Other',          icon: 'HelpCircle' },
]

export default function HazardReportForm({ driverId, taskId, onBack }) {
  const [type,   setType]   = useState('')
  const [notes,  setNotes]  = useState('')
  const [saving, setSaving] = useState(false)
  const [done,   setDone]   = useState(false)
  const [error,  setError]  = useState(null)

  const handleSubmit = async () => {
    if (!type) { setError('Select a hazard type'); return }
    setSaving(true); setError(null)

    let lat = null, lng = null
    try {
      const pos = await new Promise((res, rej) =>
        navigator.geolocation.getCurrentPosition(res, rej, { timeout: 5000, maximumAge: 10000 })
      )
      lat = pos.coords.latitude
      lng = pos.coords.longitude
    } catch { /* location unavailable — still submit */ }

    const record = {
      id:          crypto.randomUUID(),
      driver_id:   driverId,
      task_id:     taskId,
      type:        'hazard',
      subtype:     type,
      notes,
      lat,
      lng,
      source:      'manual',
      severity:    'medium',
      reported_at: new Date().toISOString(),
    }

    // Always save locally first
    await saveIncidentLocally(record).catch(() => {})

    // Try Supabase if online
    if (navigator.onLine) {
      try {
        const sb = getSupabaseClient()
        if (sb) {
          const { error: sbErr } = await sb.from('safety_incidents').upsert(record, { onConflict: 'id' })
          if (sbErr) console.warn('[Hazard] Supabase error (saved locally):', sbErr.message)
        }
      } catch { /* will sync later via safety sync service */ }
    }

    setSaving(false)
    setDone(true)
  }

  if (done) return (
    <div className="flex flex-col items-center justify-center h-full gap-4 px-8 text-center">
      <div className="w-16 h-16 rounded-full bg-emerald-500/15 flex items-center justify-center">
        <Icon name="CheckCircle" size={28} className="text-emerald-400" />
      </div>
      <p className="text-sm font-semibold text-slate-200">Hazard Reported</p>
      <p className="text-xs text-slate-500">
        {navigator.onLine ? 'Saved and synced to dispatch.' : 'Saved locally — will sync when online.'}
      </p>
      <button onClick={onBack} className="mt-2 text-xs text-cyan-400 underline">Back to Safety</button>
    </div>
  )

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-800 flex-shrink-0">
        <button onClick={onBack} className="text-slate-400 hover:text-white">
          <Icon name="ArrowLeft" size={18} />
        </button>
        <span className="text-sm font-semibold text-slate-200">Report Hazard</span>
        {!navigator.onLine && (
          <span className="ml-auto text-xs text-amber-400 flex items-center gap-1">
            <Icon name="WifiOff" size={11} /> Offline
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-6 space-y-4">
        <div>
          <p className="text-xs text-slate-500 mb-2">Hazard type</p>
          <div className="grid grid-cols-2 gap-2">
            {HAZARD_TYPES.map(h => (
              <button
                key={h.key}
                onClick={() => setType(h.key)}
                className={`flex items-center gap-2 p-3 rounded-xl border text-left text-xs transition-colors ${
                  type === h.key
                    ? 'border-amber-500/50 bg-amber-500/15 text-amber-400'
                    : 'border-slate-700 bg-slate-800/40 text-slate-400 hover:border-slate-600'
                }`}
              >
                <Icon name={h.icon} size={13} />
                {h.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs text-slate-500 mb-1">Notes (optional)</p>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={3}
            placeholder="Describe the hazard…"
            className="w-full bg-slate-800/60 border border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-200 placeholder-slate-600 resize-none focus:outline-none focus:border-amber-500/40"
          />
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}

        <button
          onClick={handleSubmit}
          disabled={saving}
          className="w-full py-3 rounded-xl bg-amber-500 disabled:opacity-50 text-black font-bold text-sm hover:bg-amber-400 transition-colors"
        >
          {saving ? 'Submitting…' : 'Submit Report'}
        </button>
      </div>
    </div>
  )
}
