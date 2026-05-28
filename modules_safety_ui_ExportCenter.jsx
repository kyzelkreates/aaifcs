/**
 * AP3X Export Center
 * Export session safety data (incidents, route, compliance) as JSON or CSV
 */
import { useState } from 'react'
import { getSupabaseClient } from './services_supabase_supabaseClient'
import Icon from './components_ui_Icon'

function toCSV(rows) {
  if (!rows.length) return ''
  const headers = Object.keys(rows[0])
  const lines = rows.map(r => headers.map(h => JSON.stringify(r[h] ?? '')).join(','))
  return [headers.join(','), ...lines].join('\n')
}

function download(filename, content, type = 'text/plain') {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([content], { type }))
  a.download = filename
  a.click()
}

export default function ExportCenter({ driverId, taskId, onBack }) {
  const [exporting, setExporting] = useState(null)
  const [done,      setDone]      = useState([])

  const exportData = async (kind) => {
    setExporting(kind)
    try {
      let data = []
      if (kind === 'incidents') {
        const q = getSupabaseClient().from('safety_incidents').select('*').order('reported_at', { ascending: true }).limit(500)
        if (driverId) q.eq('driver_id', driverId)
        if (taskId)   q.eq('task_id', taskId)
        const { data: d } = await q
        data = d || []
      } else if (kind === 'route') {
        const q = getSupabaseClient().from('driver_locations').select('*').order('recorded_at', { ascending: true }).limit(2000)
        if (driverId) q.eq('driver_id', driverId)
        if (taskId)   q.eq('task_id', taskId)
        const { data: d } = await q
        data = d || []
      } else if (kind === 'json') {
        const [inc, loc] = await Promise.all([
          getSupabaseClient().from('safety_incidents').select('*').eq('driver_id', driverId).limit(500),
          getSupabaseClient().from('driver_locations').select('*').eq('driver_id', driverId).limit(2000),
        ])
        const payload = {
          exported_at: new Date().toISOString(),
          driver_id: driverId,
          task_id: taskId,
          incidents: inc.data || [],
          route_points: loc.data || [],
        }
        download(`ap3x_session_${Date.now()}.json`, JSON.stringify(payload, null, 2), 'application/json')
        setDone(prev => [...prev, kind])
        setExporting(null)
        return
      }
      download(`ap3x_${kind}_${Date.now()}.csv`, toCSV(data), 'text/csv')
      setDone(prev => [...prev, kind])
    } catch {
      // silently fail — user will retry
    } finally {
      setExporting(null)
    }
  }

  const EXPORTS = [
    { key: 'incidents', icon: 'Zap',      label: 'Incident Report (CSV)',   desc: 'All safety events with timestamps & coordinates' },
    { key: 'route',     icon: 'MapPin',   label: 'Route Trace (CSV)',       desc: 'Full GPS breadcrumb trail for this session' },
    { key: 'json',      icon: 'Package',  label: 'Full Session (JSON)',     desc: 'Everything: incidents + route in one file' },
  ]

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-800">
        <button onClick={onBack} className="text-slate-400 hover:text-white">
          <Icon name="ArrowLeft" size={18} />
        </button>
        <span className="text-sm font-semibold text-slate-200">Export Evidence</span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        <p className="text-xs text-slate-500">Download session data for compliance, insurance, or review purposes.</p>

        {EXPORTS.map(ex => (
          <button
            key={ex.key}
            onClick={() => exportData(ex.key)}
            disabled={!!exporting}
            className={`w-full flex items-center gap-4 p-4 rounded-xl border text-left transition-colors
              ${done.includes(ex.key)
                ? 'border-emerald-500/30 bg-emerald-500/8'
                : 'border-slate-700 bg-slate-800/40 hover:border-slate-500'}`}
          >
            <div className={`flex-shrink-0 ${done.includes(ex.key) ? 'text-emerald-400' : 'text-slate-400'}`}>
              <Icon name={done.includes(ex.key) ? 'CheckCircle' : ex.icon} size={18} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-slate-200">{ex.label}</div>
              <div className="text-xs text-slate-500 mt-0.5">{ex.desc}</div>
            </div>
            {exporting === ex.key ? (
              <Icon name="Loader" size={16} className="text-cyan-400 animate-spin flex-shrink-0" />
            ) : done.includes(ex.key) ? (
              <span className="text-xs text-emerald-400 flex-shrink-0">Saved</span>
            ) : (
              <Icon name="Download" size={15} className="text-slate-500 flex-shrink-0" />
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
