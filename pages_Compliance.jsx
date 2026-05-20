/**
 * ============================================================
 * APEX AI — Compliance Engine Page (Run 9)
 * ============================================================
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import Icon from './components_ui_Icon'
import Badge from './components_ui_Badge'
import StatusDot from './components_ui_StatusDot'
import { complianceService, COMPLIANCE_STATUS, COMPLIANCE_CATEGORY } from './services_compliance_complianceService'
import { formatDate } from './utils_format'
import { useAIChat }    from './modules_ai_useAIChat'
import { AI_MODULES }   from './services_ai_aiConfig'
import { getRuntimeKey, RUNTIME_KEYS } from './services_maps_runtimeKeys'


const STATUS_VARIANTS = {
  pass:    'cyan',
  fail:    'red',
  warning: 'amber',
  pending: 'muted',
  expired: 'red'
}

const CAT_ICONS = {
  licence: 'CreditCard', vehicle: 'Truck', hours: 'Clock',
  tachograph: 'Activity', insurance: 'Shield', mot: 'Wrench',
  tax: 'Receipt', training: 'BookOpen'
}

function ComplianceRow({ record, onEdit }) {
  const variant = STATUS_VARIANTS[record.status] || 'muted'
  const icon    = CAT_ICONS[record.category] || 'FileCheck'
  const daysLeft = record.expiry_date
    ? Math.ceil((new Date(record.expiry_date) - Date.now()) / 86400000)
    : null

  return (
    <tr className="border-b border-slate-800/40 hover:bg-slate-800/20 transition-colors cursor-pointer" onClick={() => onEdit?.(record)}>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <Icon name={icon} size={14} className="text-slate-500" />
          <span className="text-sm text-white capitalize">{record.name || record.category?.replace('_', ' ')}</span>
        </div>
      </td>
      <td className="px-4 py-3 text-xs text-slate-400 capitalize">{record.category?.replace('_', ' ')}</td>
      <td className="px-4 py-3 text-xs text-slate-400">{record.entity_name || '—'}</td>
      <td className="px-4 py-3"><Badge variant={variant} size="sm">{record.status}</Badge></td>
      <td className="px-4 py-3 text-xs text-slate-400">{record.expiry_date ? formatDate(record.expiry_date) : '—'}</td>
      <td className="px-4 py-3 text-xs font-mono">
        {daysLeft !== null ? (
          <span className={daysLeft < 0 ? 'text-red-400' : daysLeft < 14 ? 'text-amber-400' : 'text-slate-500'}>
            {daysLeft < 0 ? `${Math.abs(daysLeft)}d expired` : daysLeft === 0 ? 'Expires today' : `${daysLeft}d`}
          </span>
        ) : '—'}
      </td>
      <td className="px-4 py-3 text-xs text-slate-500 max-w-xs truncate">{record.notes || '—'}</td>
    </tr>
  )
}

function ComplianceModal({ record, onClose, onSaved }) {
  const isEdit = !!record?.id
  const [form, setForm] = useState({
    name: '', category: COMPLIANCE_CATEGORY.LICENCE, entity_name: '',
    status: COMPLIANCE_STATUS.PASS, expiry_date: '', document_ref: '', notes: ''
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => { if (record) setForm(f => ({ ...f, ...record })) }, [record])
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e) => {
    e.preventDefault(); setSaving(true)
    try {
      if (isEdit) complianceService.updateRecord(record.id, form)
      else complianceService.createRecord(form)
      onSaved?.(); onClose?.()
    } catch (err) { console.error(err) }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-[#0d1426] border border-slate-800/60 rounded-xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800/60">
          <h2 className="font-display font-semibold text-white">{isEdit ? 'Edit Record' : 'Add Compliance Record'}</h2>
          <button onClick={onClose} className="btn-ghost p-1.5"><Icon name="X" size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              { k: 'name',        l: 'Record Name',  req: true },
              { k: 'entity_name', l: 'Entity (Driver/Vehicle)', req: false },
              { k: 'document_ref', l: 'Document Ref', req: false },
              { k: 'expiry_date', l: 'Expiry Date',  req: false, t: 'date' },
            ].map(({ k, l, req, t }) => (
              <div key={k} className="space-y-1.5">
                <label className="text-xs text-slate-400 font-medium">{l}{req && <span className="text-red-400 ml-0.5">*</span>}</label>
                <input type={t || 'text'} value={form[k] ?? ''} onChange={e => set(k, e.target.value)} required={req} className="apex-input" />
              </div>
            ))}
            <div className="space-y-1.5">
              <label className="text-xs text-slate-400 font-medium">Category</label>
              <select value={form.category} onChange={e => set('category', e.target.value)} className="apex-input">
                {Object.entries(COMPLIANCE_CATEGORY).map(([k, v]) => <option key={k} value={v}>{k.replace('_', ' ')}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-slate-400 font-medium">Status</label>
              <select value={form.status} onChange={e => set('status', e.target.value)} className="apex-input">
                {Object.entries(COMPLIANCE_STATUS).map(([k, v]) => <option key={k} value={v}>{k}</option>)}
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-slate-400 font-medium">Notes</label>
            <textarea value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} rows={2} className="apex-input resize-none" />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-ghost text-sm px-4 py-2">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary text-sm px-4 py-2 disabled:opacity-40">
              {saving ? 'Saving...' : isEdit ? 'Save' : 'Add Record'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}


// ─── Apex Compliance AI Chat Panel ───────────────────────────
function ComplianceAIPanel() {
  const { messages, streaming, error, sendMessage, clearMessages } = useAIChat(AI_MODULES.APEX_COMPLIANCE)
  const [input, setInput] = useState('')
  const [noKey, setNoKey]  = useState(false)
  const chatEndRef = useRef(null)

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages.length])
  useEffect(() => {
    const keys = [RUNTIME_KEYS.OPENAI, RUNTIME_KEYS.OPENROUTER, RUNTIME_KEYS.GROQ,
                  RUNTIME_KEYS.DEEPSEEK, RUNTIME_KEYS.MISTRAL, RUNTIME_KEYS.ANTHROPIC, RUNTIME_KEYS.GEMINI]
    setNoKey(!keys.some(k => !!getRuntimeKey(k)))
  }, [])

  const STARTERS = [
    'What are the current UK driver hours rules for HGV drivers?',
    'Explain EU tachograph regulations and when breaks are required',
    'What documents must an HGV driver carry at all times?',
    'When does a driver card need to be renewed and what is the process?',
    'What are the penalties for exceeding driving hours limits in the UK?',
    'Explain DVSA roadworthiness requirements for fleet vehicles',
  ]

  const handleSend = () => {
    if (!input.trim() || streaming) return
    sendMessage(input.trim())
    setInput('')
  }

  return (
    <div className="bg-[#0d1426] border border-emerald-500/20 rounded-xl overflow-hidden flex flex-col" style={{ height: '440px' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800/60 flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
            <Icon name="ClipboardCheck" size={14} className="text-emerald-400" />
          </div>
          <div>
            <span className="text-sm font-semibold text-white">Apex Compliance AI</span>
            <p className="text-2xs text-slate-500">UK/EU regulatory guidance · DVSA · Tachograph · Driver hours</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {messages.length > 0 && (
            <button onClick={clearMessages} className="text-2xs text-slate-600 hover:text-slate-400 transition-colors">Clear</button>
          )}
          <div className={`w-2 h-2 rounded-full ${streaming ? 'bg-emerald-400 animate-pulse' : 'bg-emerald-400'}`} />
        </div>
      </div>

      {/* No key warning */}
      {noKey && (
        <div className="mx-3 mt-3 flex items-start gap-2 p-3 rounded-lg bg-amber-500/8 border border-amber-500/20 flex-shrink-0">
          <Icon name="AlertTriangle" size={13} className="text-amber-400 mt-0.5 flex-shrink-0" />
          <p className="text-2xs text-amber-300">
            No AI provider key set. Go to <strong>Settings → AI Providers</strong> and add an API key to enable Compliance AI.
          </p>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-none">
        {messages.length === 0 && (
          <div className="space-y-2">
            <p className="text-2xs text-slate-600 uppercase tracking-widest font-medium mb-3">Common compliance questions</p>
            {STARTERS.map(s => (
              <button key={s} onClick={() => sendMessage(s)}
                className="w-full text-left px-3 py-2.5 rounded-lg bg-slate-800/30 border border-slate-700/30 hover:border-emerald-500/20 hover:bg-emerald-500/5 text-xs text-slate-400 hover:text-slate-200 transition-all">
                {s}
              </button>
            ))}
          </div>
        )}
        {messages.map(msg => (
          <div key={msg.id} className={`flex gap-2.5 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
            <div className={`w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5 ${
              msg.role === 'user' ? 'bg-slate-700 border border-slate-600' : 'bg-emerald-500/10 border border-emerald-500/20'
            }`}>
              <Icon name={msg.role === 'user' ? 'User' : 'ClipboardCheck'} size={12}
                className={msg.role === 'user' ? 'text-slate-400' : 'text-emerald-400'} />
            </div>
            <div className={`flex-1 max-w-[88%] px-3 py-2.5 rounded-xl text-xs leading-relaxed ${
              msg.role === 'user'
                ? 'bg-slate-700/50 border border-slate-600/30 text-slate-200'
                : msg.error
                  ? 'bg-red-500/8 border border-red-500/15 text-red-300'
                  : 'bg-[#060b18] border border-slate-800/60 text-slate-300'
            }`} style={{ whiteSpace: 'pre-wrap' }}>
              {msg.content || (msg.streaming ? <span className="text-slate-600 animate-pulse">Compliance AI thinking…</span> : '')}
            </div>
          </div>
        ))}
        <div ref={chatEndRef} />
      </div>

      {/* Input */}
      <div className="flex-shrink-0 p-3 border-t border-slate-800/60">
        {error && <p className="text-2xs text-red-400 mb-2 px-1">{error}</p>}
        <div className="flex gap-2">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
            placeholder="Ask about driver hours, tachograph, DVSA, HGV regulations…"
            className="flex-1 bg-slate-800/50 border border-slate-700/50 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 focus:border-emerald-500/40 focus:outline-none"
            disabled={streaming}
          />
          <button onClick={handleSend} disabled={streaming || !input.trim()}
            className="px-3 py-2 rounded-lg bg-emerald-500/15 border border-emerald-500/25 text-emerald-300 hover:bg-emerald-500/25 transition-all disabled:opacity-40 flex-shrink-0">
            <Icon name={streaming ? 'Loader2' : 'Send'} size={14} className={streaming ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Compliance() {
  const [records,  setRecords]  = useState([])
  const [loading,  setLoading]  = useState(true)
  const [modal,    setModal]    = useState(null)
  const [catFilter, setCatFilter] = useState(null)
  const [stsFilter, setStsFilter] = useState(null)

  const load = useCallback(() => {
    setLoading(true)
    try { setRecords(complianceService.fetchRecords({ category: catFilter, status: stsFilter })) }
    finally { setLoading(false) }
  }, [catFilter, stsFilter])

  useEffect(() => { load() }, [load])

  const expiring = complianceService.getExpiring(30)
  const passing  = records.filter(r => r.status === 'pass').length
  const failing  = records.filter(r => ['fail', 'expired'].includes(r.status)).length

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-slate-800/60 flex-shrink-0">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="font-display text-xl font-bold text-white">Compliance Engine</h1>
            <p className="text-slate-500 text-xs mt-0.5">Regulatory compliance tracking and audit</p>
          </div>
          <button onClick={() => setModal('create')} className="btn-primary text-sm px-4 py-2">
            <Icon name="Plus" size={14} /> Add Record
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          {[
            { label: 'Total',    value: records.length, color: 'text-white' },
            { label: 'Passing',  value: passing,        color: 'text-emerald-400' },
            { label: 'Failing',  value: failing,        color: 'text-red-400' },
            { label: 'Expiring', value: expiring.length, color: 'text-amber-400' },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-[#0d1426] border border-slate-800/60 rounded-lg p-3 text-center">
              <div className={`font-mono text-xl font-bold ${color}`}>{value}</div>
              <div className="text-2xs text-slate-600 uppercase tracking-widest mt-0.5">{label}</div>
            </div>
          ))}
        </div>

        {/* Expiring soon banner */}
        {expiring.length > 0 && (
          <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg px-4 py-2.5 flex items-center gap-2 mb-4">
            <Icon name="AlertTriangle" size={14} className="text-amber-400" />
            <span className="text-xs text-amber-400 font-medium">{expiring.length} record{expiring.length > 1 ? 's' : ''} expiring within 30 days</span>
          </div>
        )}

        {/* Filters */}
        <div className="flex items-center gap-2 flex-wrap">
          <select value={catFilter || ''} onChange={e => setCatFilter(e.target.value || null)} className="apex-input py-1.5 text-xs w-auto">
            <option value="">All Categories</option>
            {Object.entries(COMPLIANCE_CATEGORY).map(([k, v]) => <option key={k} value={v}>{k.replace('_', ' ')}</option>)}
          </select>
          <select value={stsFilter || ''} onChange={e => setStsFilter(e.target.value || null)} className="apex-input py-1.5 text-xs w-auto">
            <option value="">All Statuses</option>
            {Object.entries(COMPLIANCE_STATUS).map(([k, v]) => <option key={k} value={v}>{k}</option>)}
          </select>
          <button onClick={load} disabled={loading} className="btn-ghost p-2">
            <Icon name="RefreshCw" size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-3 sm:p-0">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[#090e1c] z-10">
            <tr className="border-b border-slate-800/60">
              {['Name', 'Category', 'Entity', 'Status', 'Expiry', 'Days Left', 'Notes'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-2xs font-semibold tracking-widest uppercase text-slate-600">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {records.map(r => <ComplianceRow key={r.id} record={r} onEdit={r => setModal(r)} />)}
          </tbody>
        </table>
        {records.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center py-20 text-slate-600">
            <Icon name="ClipboardCheck" size={36} className="mb-3 opacity-20" />
            <p className="text-sm">No compliance records</p>
          </div>
        )}
      </div>

      {modal && <ComplianceModal record={modal === 'create' ? null : modal} onClose={() => setModal(null)} onSaved={load} />}
        <ComplianceAIPanel />

    </div>
  )
}
