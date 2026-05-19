/**
 * APEX AI — Driver Create/Edit Modal
 */

import { useState, useEffect } from 'react'
import Icon from './components_ui_Icon'
import { driverService, DRIVER_STATUS, LICENCE_TYPE } from './services_drivers_driverService'

export default function DriverModal({ driver, onClose, onSaved }) {
  const isEdit = !!driver?.id
  const [form,   setForm]   = useState({ full_name: '', email: '', phone: '', employee_id: '', licence_type: 'B', licence_expiry: '', status: DRIVER_STATUS.ACTIVE, emergency_contact: '', notes: '' })
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState(null)

  useEffect(() => { if (driver) setForm(f => ({ ...f, ...driver })) }, [driver])
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true); setError(null)
    try {
      if (isEdit) await driverService.updateDriver(driver.id, form)
      else await driverService.createDriver(form)
      onSaved?.(); onClose?.()
    } catch (err) { setError(err.message) }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-[#0d1426] border border-slate-800/60 rounded-xl w-full max-w-xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800/60">
          <h2 className="font-display font-semibold text-white">{isEdit ? 'Edit Driver' : 'Add Driver'}</h2>
          <button onClick={onClose} className="p-1.5 rounded text-slate-500 hover:text-white hover:bg-slate-800 transition-colors">
            <Icon name="X" size={16} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            {[
              { k: 'full_name', l: 'Full Name', req: true },
              { k: 'email',     l: 'Email',     req: false, t: 'email' },
              { k: 'phone',     l: 'Phone',     req: false },
              { k: 'employee_id', l: 'Employee ID', req: false },
            ].map(({ k, l, req, t }) => (
              <div key={k} className="space-y-1.5">
                <label className="text-xs text-slate-400 font-medium">{l}{req && <span className="text-red-400 ml-0.5">*</span>}</label>
                <input type={t || 'text'} value={form[k] ?? ''} onChange={e => set(k, e.target.value)} required={req} className="apex-input" />
              </div>
            ))}
            <div className="space-y-1.5">
              <label className="text-xs text-slate-400 font-medium">Licence Type</label>
              <select value={form.licence_type} onChange={e => set('licence_type', e.target.value)} className="apex-input">
                {Object.keys(LICENCE_TYPE).map(k => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-slate-400 font-medium">Licence Expiry</label>
              <input type="date" value={form.licence_expiry ?? ''} onChange={e => set('licence_expiry', e.target.value)} className="apex-input" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-slate-400 font-medium">Status</label>
              <select value={form.status} onChange={e => set('status', e.target.value)} className="apex-input">
                {Object.entries(DRIVER_STATUS).map(([k, v]) => <option key={k} value={v}>{k.replace('_', ' ')}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-slate-400 font-medium">Emergency Contact</label>
              <input value={form.emergency_contact ?? ''} onChange={e => set('emergency_contact', e.target.value)} className="apex-input" />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-slate-400 font-medium">Notes</label>
            <textarea value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} rows={3} className="apex-input resize-none" />
          </div>
          {error && <div className="flex items-center gap-2 bg-red-500/5 border border-red-500/20 rounded px-3 py-2 text-red-400 text-xs"><Icon name="AlertCircle" size={13} />{error}</div>}
        </form>
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-800/60">
          <button onClick={onClose} className="btn-ghost text-sm px-4 py-2">Cancel</button>
          <button onClick={handleSubmit} disabled={saving} className="btn-primary text-sm px-4 py-2 disabled:opacity-40">
            {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Add Driver'}
          </button>
        </div>
      </div>
    </div>
  )
}
