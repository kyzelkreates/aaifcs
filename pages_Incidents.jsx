/**
 * ============================================================
 * APEX AI — Incident Reports (Run 12 — Full Build)
 * Log · filter · create · edit · detail view
 * ============================================================
 */

import { useState, useEffect, useCallback } from 'react'
import Icon from './components_ui_Icon'
import Badge from './components_ui_Badge'
import StatusDot from './components_ui_StatusDot'
import { incidentTable } from './services_local_localDB'
import { formatDateTime } from './utils_format'

// ─── Enums ────────────────────────────────────────────────────
const STATUS   = { OPEN: 'open', INVESTIGATING: 'investigating', RESOLVED: 'resolved', CLOSED: 'closed' }
const SEVERITY = { LOW: 'low', MEDIUM: 'medium', HIGH: 'high', CRITICAL: 'critical' }
const TYPES    = { accident: 'Accident', breakdown: 'Breakdown', theft: 'Theft', cargo_damage: 'Cargo Damage', near_miss: 'Near Miss', traffic: 'Traffic', weather: 'Weather', other: 'Other' }

const SEV_STYLE = {
  low:      'bg-slate-800/60 text-slate-400 border-slate-700/40',
  medium:   'bg-amber-500/10 text-amber-400 border-amber-500/20',
  high:     'bg-red-500/10   text-red-400   border-red-500/20',
  critical: 'bg-red-500/15   text-red-300   border-red-500/40',
}
const STS_STYLE = {
  open:          'bg-red-500/10    text-red-400    border-red-500/20',
  investigating: 'bg-amber-500/10  text-amber-400  border-amber-500/20',
  resolved:      'bg-cyan-500/10   text-cyan-400   border-cyan-500/20',
  closed:        'bg-slate-800/60  text-slate-500  border-slate-700/40',
}
const TYPE_ICON = {
  accident: 'Car', breakdown: 'Wrench', theft: 'AlertOctagon',
  cargo_damage: 'Package', near_miss: 'AlertTriangle',
  traffic: 'Navigation', weather: 'CloudRain', other: 'FileText'
}

// ─── DB helpers ───────────────────────────────────────────────
function fetchIncidents(filters = {}) {
  try {
    let data = incidentTable.list()
    if (filters.status)   data = data.filter(r => r.status   === filters.status)
    if (filters.severity) data = data.filter(r => r.severity === filters.severity)
    data.sort((a,b) => new Date(b.created_at) - new Date(a.created_at))
    const error = null
    if (error || !data?.length) return []
    return data
  } catch { return [] }
}

function upsertIncident(payload, id) {
  if (id) return incidentTable.update(id, payload)
  return incidentTable.create(payload)
}

// ─── Incident Form Modal ──────────────────────────────────────
function IncidentModal({ initial, onClose, onSaved }) {
  const isEdit = !!initial?.id
  const blank  = { title: '', type: 'other', severity: 'medium', status: 'open', location: '', driver_name: '', vehicle_reg: '', description: '', incident_date: new Date().toISOString().slice(0,16), injuries: false, property_damage: false }
  const [form,   setForm]   = useState(isEdit ? { ...blank, ...initial } : blank)
  const [saving, setSaving] = useState(false)
  const [err,    setErr]    = useState(null)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const submit = async (e) => {
    e.preventDefault(); if (!form.title.trim()) { setErr('Title required'); return }
    setSaving(true); setErr(null)
    try {
      await upsertIncident(form, isEdit ? initial.id : null)
      onSaved?.(); onClose?.()
    } catch (e) { setErr(e.message) }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-[#0d1426] border border-slate-700/60 rounded-2xl w-full max-w-lg max-h-[92vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800/60">
          <div className="flex items-center gap-2">
            <Icon name="FileText" size={15} className="text-cyan-400" />
            <h2 className="font-display font-semibold text-white">{isEdit ? 'Edit Incident' : 'Report Incident'}</h2>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-500 hover:text-slate-300 transition-colors">
            <Icon name="X" size={15} />
          </button>
        </div>

        <form onSubmit={submit} className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs text-slate-400 font-medium">Title <span className="text-red-400">*</span></label>
            <input value={form.title} onChange={e => set('title', e.target.value)} required
              className="apex-input" placeholder="Brief description of the incident" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs text-slate-400 font-medium">Type</label>
              <select value={form.type} onChange={e => set('type', e.target.value)} className="apex-input">
                {Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-slate-400 font-medium">Severity</label>
              <select value={form.severity} onChange={e => set('severity', e.target.value)} className="apex-input">
                {Object.entries(SEVERITY).map(([k, v]) => <option key={k} value={v}>{k}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-slate-400 font-medium">Status</label>
              <select value={form.status} onChange={e => set('status', e.target.value)} className="apex-input">
                {Object.entries(STATUS).map(([k, v]) => <option key={k} value={v}>{k.replace('_',' ')}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-slate-400 font-medium">Date & Time</label>
              <input type="datetime-local" value={form.incident_date} onChange={e => set('incident_date', e.target.value)} className="apex-input" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-slate-400 font-medium">Driver</label>
              <input value={form.driver_name} onChange={e => set('driver_name', e.target.value)} className="apex-input" placeholder="Driver name" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-slate-400 font-medium">Vehicle Reg</label>
              <input value={form.vehicle_reg} onChange={e => set('vehicle_reg', e.target.value)} className="apex-input" placeholder="e.g. AB12 CDE" />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-slate-400 font-medium">Location</label>
            <input value={form.location} onChange={e => set('location', e.target.value)} className="apex-input" placeholder="Where did this occur?" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-slate-400 font-medium">Description</label>
            <textarea value={form.description} onChange={e => set('description', e.target.value)} rows={3}
              className="apex-input resize-none" placeholder="Full details of what happened…" />
          </div>
          <div className="flex items-center gap-6">
            {[['injuries','Injuries Reported'],['property_damage','Property Damage']].map(([k,l]) => (
              <label key={k} className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={!!form[k]} onChange={e => set(k, e.target.checked)}
                  className="w-3.5 h-3.5 rounded accent-cyan-500" />
                <span className="text-xs text-slate-400">{l}</span>
              </label>
            ))}
          </div>
          {err && <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/5 border border-red-500/20 rounded-lg px-3 py-2">
            <Icon name="AlertCircle" size={13} />{err}
          </div>}
        </form>

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-800/60">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors">Cancel</button>
          <button onClick={submit} disabled={saving}
            className="px-4 py-2 text-sm bg-cyan-500/15 border border-cyan-500/25 text-cyan-400 rounded-lg hover:bg-cyan-500/20 disabled:opacity-40 transition-colors">
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Report'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Incident Detail Drawer ───────────────────────────────────
function IncidentDetail({ incident, onClose, onEdit }) {
  if (!incident) return null
  const icon = TYPE_ICON[incident.type] || 'FileText'
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}>
      <div className="bg-[#0d1426] border border-slate-700/60 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800/60 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center justify-center flex-shrink-0">
              <Icon name={icon} size={16} className="text-slate-400" />
            </div>
            <div>
              <h3 className="font-display font-bold text-white text-sm leading-tight">{incident.title}</h3>
              <div className="flex items-center gap-2 mt-1">
                <span className={`text-2xs px-2 py-0.5 rounded border font-semibold capitalize ${SEV_STYLE[incident.severity]}`}>{incident.severity}</span>
                <span className={`text-2xs px-2 py-0.5 rounded border font-semibold capitalize ${STS_STYLE[incident.status]}`}>{incident.status?.replace('_',' ')}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button onClick={onEdit} className="p-1.5 text-slate-500 hover:text-slate-300 transition-colors"><Icon name="Pencil" size={14} /></button>
            <button onClick={onClose} className="p-1.5 text-slate-500 hover:text-slate-300 transition-colors"><Icon name="X" size={14} /></button>
          </div>
        </div>

        <div className="p-6 space-y-4">
          {incident.description && (
            <p className="text-sm text-slate-300 leading-relaxed">{incident.description}</p>
          )}
          <div className="grid grid-cols-2 gap-3">
            {[
              ['Type',     TYPES[incident.type] || incident.type],
              ['Date',     formatDateTime(incident.incident_date || incident.created_at)],
              ['Driver',   incident.driver_name  || '—'],
              ['Vehicle',  incident.vehicle_reg   || '—'],
              ['Location', incident.location      || '—'],
              ['Logged',   formatDateTime(incident.created_at)],
            ].map(([l, v]) => (
              <div key={l} className="bg-slate-900/40 border border-slate-800/40 rounded-lg p-3">
                <div className="text-2xs text-slate-600 uppercase tracking-widest font-semibold mb-1">{l}</div>
                <div className="text-sm text-slate-300">{v}</div>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-3">
            {incident.injuries       && <span className="flex items-center gap-1.5 text-xs text-red-400 bg-red-500/5 border border-red-500/20 px-3 py-1.5 rounded-lg"><Icon name="AlertCircle" size={11} />Injuries</span>}
            {incident.property_damage && <span className="flex items-center gap-1.5 text-xs text-amber-400 bg-amber-500/5 border border-amber-500/20 px-3 py-1.5 rounded-lg"><Icon name="Package" size={11} />Property Damage</span>}
            {!incident.injuries && !incident.property_damage && <span className="text-xs text-slate-600">No injuries or property damage recorded</span>}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Incidents Page ───────────────────────────────────────────
export default function Incidents() {
  const [incidents, setIncidents] = useState([])
  const [loading,   setLoading]   = useState(true)
  const [modal,     setModal]     = useState(null)   // null | 'create' | incident object
  const [detail,    setDetail]    = useState(null)
  const [sevFilter, setSevFilter] = useState('')
  const [stsFilter, setStsFilter] = useState('')
  const [search,    setSearch]    = useState('')

  const load = useCallback(() => {
    setLoading(true)
    try { setIncidents(fetchIncidents({ severity: sevFilter || undefined, status: stsFilter || undefined })) }
    finally { setLoading(false) }
  }, [sevFilter, stsFilter])

  useEffect(() => { load() }, [load])

  const filtered = incidents.filter(i => {
    if (!search) return true
    const q = search.toLowerCase()
    return i.title?.toLowerCase().includes(q) ||
           i.driver_name?.toLowerCase().includes(q) ||
           i.vehicle_reg?.toLowerCase().includes(q) ||
           i.location?.toLowerCase().includes(q)
  })

  const openCount     = incidents.filter(i => i.status === 'open').length
  const criticalCount = incidents.filter(i => i.severity === 'critical').length

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-800/60 flex-shrink-0">
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <div>
            <h1 className="font-display text-xl font-bold text-white">Incidents</h1>
            <p className="text-slate-500 text-xs mt-0.5">{incidents.length} total · {openCount} open{criticalCount > 0 ? ` · ${criticalCount} critical` : ''}</p>
          </div>
          <div className="flex items-center gap-2">
            {criticalCount > 0 && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 border border-red-500/20 rounded-lg">
                <div className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                <span className="text-xs text-red-400 font-medium">{criticalCount} critical</span>
              </div>
            )}
            <button onClick={() => setModal('create')}
              className="flex items-center gap-2 px-4 py-2 bg-cyan-500/15 border border-cyan-500/25 text-cyan-400 text-sm rounded-lg hover:bg-cyan-500/20 transition-colors font-medium">
              <Icon name="Plus" size={14} />Report
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Icon name="Search" size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-600" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search incidents…"
              className="apex-input pl-7 py-1.5 text-xs w-52" />
          </div>
          <select value={sevFilter} onChange={e => setSevFilter(e.target.value)} className="apex-input py-1.5 text-xs w-auto">
            <option value="">All Severities</option>
            {Object.entries(SEVERITY).map(([k,v]) => <option key={k} value={v}>{k}</option>)}
          </select>
          <select value={stsFilter} onChange={e => setStsFilter(e.target.value)} className="apex-input py-1.5 text-xs w-auto">
            <option value="">All Statuses</option>
            {Object.entries(STATUS).map(([k,v]) => <option key={k} value={v}>{k.replace('_',' ')}</option>)}
          </select>
          <button onClick={load} disabled={loading}
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-900 border border-slate-800 text-slate-500 hover:text-slate-300 transition-colors">
            <Icon name="RefreshCw" size={13} className={loading ? 'animate-spin' : ''} />
          </button>
          {(sevFilter || stsFilter || search) && (
            <button onClick={() => { setSevFilter(''); setStsFilter(''); setSearch('') }}
              className="text-xs text-slate-500 hover:text-slate-300 transition-colors flex items-center gap-1">
              <Icon name="X" size={11} />Clear
            </button>
          )}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-auto p-3 sm:p-6">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-slate-600 gap-2">
            <Icon name="Loader2" size={18} className="animate-spin" />
            <span className="text-sm">Loading incidents…</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-600 gap-3">
            <Icon name="FileText" size={40} className="opacity-20" />
            <p className="text-sm">No incidents found</p>
            {(sevFilter || stsFilter || search) && (
              <button onClick={() => { setSevFilter(''); setStsFilter(''); setSearch('') }}
                className="text-xs text-cyan-400 hover:text-cyan-300">Clear filters</button>
            )}
          </div>
        ) : (
          <div className="space-y-2.5 max-w-4xl">
            {filtered.map(inc => {
              const isCritical = inc.severity === 'critical'
              const icon       = TYPE_ICON[inc.type] || 'FileText'
              return (
                <div key={inc.id} onClick={() => setDetail(inc)}
                  className={`bg-[#0d1426] border rounded-xl p-4 cursor-pointer hover:border-slate-700/60 transition-all group ${
                    isCritical
                      ? 'border-red-500/30 shadow-[0_0_20px_rgba(239,68,68,0.04)]'
                      : 'border-slate-800/60'
                  }`}>
                  <div className="flex items-start gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 border ${
                      isCritical ? 'bg-red-500/10 border-red-500/20' : 'bg-slate-900/60 border-slate-800'
                    }`}>
                      <Icon name={icon} size={15} className={isCritical ? 'text-red-400' : 'text-slate-500'} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-white group-hover:text-cyan-100 transition-colors">{inc.title}</span>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <span className={`text-2xs px-2 py-0.5 rounded border font-semibold capitalize ${SEV_STYLE[inc.severity] || ''}`}>{inc.severity}</span>
                          <span className={`text-2xs px-2 py-0.5 rounded border font-semibold capitalize ${STS_STYLE[inc.status] || ''}`}>{inc.status?.replace('_',' ')}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 mt-1.5 text-xs text-slate-500 flex-wrap">
                        {inc.driver_name && <span className="flex items-center gap-1"><Icon name="User" size={10} />{inc.driver_name}</span>}
                        {inc.vehicle_reg && <span className="flex items-center gap-1"><Icon name="Truck" size={10} />{inc.vehicle_reg}</span>}
                        {inc.location    && <span className="flex items-center gap-1 truncate max-w-[200px]"><Icon name="MapPin" size={10} />{inc.location}</span>}
                        <span className="ml-auto text-2xs font-mono">{formatDateTime(inc.incident_date || inc.created_at)}</span>
                      </div>
                      {inc.description && (
                        <p className="text-xs text-slate-600 mt-1.5 line-clamp-1">{inc.description}</p>
                      )}
                      {(inc.injuries || inc.property_damage) && (
                        <div className="flex items-center gap-2 mt-2">
                          {inc.injuries        && <span className="text-2xs text-red-400 bg-red-500/5 border border-red-500/20 px-2 py-0.5 rounded-full">Injuries</span>}
                          {inc.property_damage && <span className="text-2xs text-amber-400 bg-amber-500/5 border border-amber-500/20 px-2 py-0.5 rounded-full">Property Damage</span>}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Modals */}
      {modal && (
        <IncidentModal
          initial={modal === 'create' ? null : modal}
          onClose={() => setModal(null)}
          onSaved={load}
        />
      )}
      {detail && (
        <IncidentDetail
          incident={detail}
          onClose={() => setDetail(null)}
          onEdit={() => { setModal(detail); setDetail(null) }}
        />
      )}
    </div>
  )
}
