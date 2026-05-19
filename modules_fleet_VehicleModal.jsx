/**
 * APEX AI — Vehicle Create/Edit Modal
 */

import { useState, useEffect } from 'react'
import Icon from './components_ui_Icon'
import { VEHICLE_STATUS, VEHICLE_TYPE, fleetService } from './services_fleet_fleetService'

const FIELDS = [
  { key: 'reg_number',   label: 'Registration Number', type: 'text',   required: true,  placeholder: 'e.g. AB12 CDE' },
  { key: 'make',         label: 'Make',                type: 'text',   required: true,  placeholder: 'e.g. Mercedes' },
  { key: 'model',        label: 'Model',               type: 'text',   required: false, placeholder: 'e.g. Actros' },
  { key: 'year',         label: 'Year',                type: 'number', required: false, placeholder: '2022' },
  { key: 'vin',          label: 'VIN',                 type: 'text',   required: false, placeholder: 'Vehicle identification number' },
  { key: 'fuel_type',    label: 'Fuel Type',           type: 'text',   required: false, placeholder: 'diesel / petrol / electric' },
  { key: 'odometer_km',  label: 'Odometer (km)',       type: 'number', required: false, placeholder: '0' },
  { key: 'fuel_level',   label: 'Fuel Level (%)',      type: 'number', required: false, placeholder: '100' },
  { key: 'notes',        label: 'Notes',               type: 'textarea', required: false, placeholder: 'Any additional notes...' },
]

export default function VehicleModal({ vehicle, onClose, onSaved }) {
  const isEdit = !!vehicle?.id
  const [form, setForm]   = useState({
    reg_number:  '', make: '', model: '', year: '',
    vin: '', type: VEHICLE_TYPE.VAN, status: VEHICLE_STATUS.IDLE,
    fuel_type: 'diesel', odometer_km: 0, fuel_level: 100, notes: ''
  })
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState(null)

  useEffect(() => {
    if (vehicle) setForm({ ...form, ...vehicle })
  }, [vehicle])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setSaving(true)
    try {
      if (isEdit) {
        await fleetService.updateVehicle(vehicle.id, form)
      } else {
        await fleetService.createVehicle(form)
      }
      onSaved?.()
      onClose?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-[#0d1426] border border-slate-800/60 rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800/60">
          <h2 className="font-display font-semibold text-white">
            {isEdit ? 'Edit Vehicle' : 'Add Vehicle'}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded text-slate-500 hover:text-white hover:bg-slate-800 transition-colors">
            <Icon name="X" size={16} />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Type + Status */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs text-slate-400 font-medium">Vehicle Type</label>
              <select value={form.type} onChange={e => set('type', e.target.value)} className="apex-input">
                {Object.entries(VEHICLE_TYPE).map(([k, v]) => (
                  <option key={k} value={v}>{k}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-slate-400 font-medium">Status</label>
              <select value={form.status} onChange={e => set('status', e.target.value)} className="apex-input">
                {Object.entries(VEHICLE_STATUS).map(([k, v]) => (
                  <option key={k} value={v}>{k.replace('_', ' ')}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Dynamic fields */}
          <div className="grid grid-cols-2 gap-4">
            {FIELDS.filter(f => f.type !== 'textarea').map(f => (
              <div key={f.key} className="space-y-1.5">
                <label className="text-xs text-slate-400 font-medium">
                  {f.label}{f.required && <span className="text-red-400 ml-0.5">*</span>}
                </label>
                <input
                  type={f.type}
                  value={form[f.key] ?? ''}
                  onChange={e => set(f.key, e.target.value)}
                  placeholder={f.placeholder}
                  required={f.required}
                  className="apex-input"
                />
              </div>
            ))}
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <label className="text-xs text-slate-400 font-medium">Notes</label>
            <textarea
              value={form.notes ?? ''}
              onChange={e => set('notes', e.target.value)}
              rows={3}
              placeholder="Any additional notes..."
              className="apex-input resize-none"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 bg-red-500/5 border border-red-500/20 rounded-md px-3 py-2">
              <Icon name="AlertCircle" size={14} className="text-red-400" />
              <span className="text-red-400 text-xs">{error}</span>
            </div>
          )}
        </form>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-800/60">
          <button onClick={onClose} className="btn-ghost text-sm px-4 py-2">Cancel</button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="btn-primary text-sm px-4 py-2 disabled:opacity-40"
          >
            {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Add Vehicle'}
          </button>
        </div>
      </div>
    </div>
  )
}
