/**
 * AP3X Incident Timeline
 * Shows all incidents logged during this session, pulled from Supabase
 */
import { useEffect, useState } from 'react'
import { getSupabaseClient } from './services_supabase_supabaseClient'
import Icon from './components_ui_Icon'

const TYPE_CONFIG = {
  hazard:        { icon: 'AlertTriangle', clr: 'text-amber-400',  bg: 'bg-amber-500/10'  },
  harsh_brake:   { icon: 'Zap',          clr: 'text-red-400',    bg: 'bg-red-500/10'    },
  harsh_accel:   { icon: 'TrendingUp',   clr: 'text-orange-400', bg: 'bg-orange-500/10' },
  speeding:      { icon: 'Gauge',        clr: 'text-red-400',    bg: 'bg-red-500/10'    },
  fatigue_alert: { icon: 'Moon',         clr: 'text-violet-400', bg: 'bg-violet-500/10' },
  collision:     { icon: 'Shield',       clr: 'text-red-500',    bg: 'bg-red-600/15'    },
  other:         { icon: 'HelpCircle',   clr: 'text-slate-400',  bg: 'bg-slate-500/10'  },
}

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export default function IncidentTimeline({ driverId, taskId, onBack }) {
  const [incidents, setIncidents] = useState([])
  const [loading,   setLoading]   = useState(true)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      const query = supabase
        .from('safety_incidents')
        .select('*')
        .order('reported_at', { ascending: false })
        .limit(50)
      if (driverId) query.eq('driver_id', driverId)
      if (taskId)   query.eq('task_id', taskId)
      const { data, error } = await query
      if (!error && data) setIncidents(data)
      setLoading(false)
    }
    load()
  }, [driverId, taskId])

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-800">
        <button onClick={onBack} className="text-slate-400 hover:text-white">
          <Icon name="ArrowLeft" size={18} />
        </button>
        <span className="text-sm font-semibold text-slate-200">Incident Log</span>
        {incidents.length > 0 && (
          <span className="ml-auto text-xs text-slate-500">{incidents.length} events</span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-slate-500 text-sm">Loading…</div>
        ) : incidents.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2 text-slate-500">
            <Icon name="CheckCircle" size={24} className="text-emerald-500/50" />
            <span className="text-sm">No incidents recorded</span>
          </div>
        ) : (
          <div className="px-4 py-3 space-y-2">
            {incidents.map(inc => {
              const cfg = TYPE_CONFIG[inc.type] || TYPE_CONFIG.other
              return (
                <div key={inc.id} className={`flex items-start gap-3 p-3 rounded-xl border border-slate-700/50 ${cfg.bg}`}>
                  <div className={`mt-0.5 flex-shrink-0 ${cfg.clr}`}>
                    <Icon name={cfg.icon} size={15} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-xs font-semibold ${cfg.clr} capitalize`}>
                        {(inc.subtype || inc.type).replace(/_/g, ' ')}
                      </span>
                      <span className="text-xs text-slate-500 flex-shrink-0">{fmtTime(inc.reported_at)}</span>
                    </div>
                    {inc.notes && <p className="text-xs text-slate-400 mt-0.5 truncate">{inc.notes}</p>}
                    {(inc.lat && inc.lng) && (
                      <p className="text-xs text-slate-600 mt-0.5">
                        {inc.lat.toFixed(5)}, {inc.lng.toFixed(5)}
                      </p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
