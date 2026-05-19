/**
 * ============================================================
 * APEX AI — Vehicle Modal (Full HGV/Fleet Profile)
 *
 * SECTIONS:
 *  1. Identity       — reg, make, model, year, VIN, colour, body type
 *  2. Engine & Fuel  — engine, fuel, Euro standard, AdBlue, transmission
 *  3. Dimensions     — height, width, length, wheelbase, overhang
 *  4. Weight         — GVW, unladen, payload, axle weight, train weight
 *  5. Axles & Tyres  — axle count, driven axles, tyre size, spare
 *  6. Restrictions   — hazmat/ADR, tunnel cat, bridge, low bridge, LEZ/ULEZ
 *  7. Cargo          — cargo type, temp-controlled, tail lift, crane, curtain
 *  8. Compliance     — operator licence, insurance, MOT, tacho, speed limiter
 *  9. Maintenance    — last service, next service, MOT date, brake test
 * 10. Notes
 *
 * Every field is stored in localDB and passed to the routing
 * engine (OSRM vehicle profile / GraphHopper weighting) so
 * routes are planned correctly for the specific vehicle.
 * ============================================================
 */

import { useState, useEffect } from 'react'
import Icon from './components_ui_Icon'
import { VEHICLE_STATUS, VEHICLE_TYPE, fleetService } from './services_fleet_fleetService'

// ─── Section tab definitions ──────────────────────────────────
const SECTIONS = [
  { key: 'identity',    label: 'Identity',      icon: 'FileText'      },
  { key: 'engine',      label: 'Engine',        icon: 'Fuel'          },
  { key: 'dimensions',  label: 'Dimensions',    icon: 'Ruler'         },
  { key: 'weight',      label: 'Weight',        icon: 'Scale'         },
  { key: 'axles',       label: 'Axles & Tyres', icon: 'CircleDot'     },
  { key: 'restrictions',label: 'Restrictions',  icon: 'AlertOctagon'  },
  { key: 'cargo',       label: 'Cargo',         icon: 'Package'       },
  { key: 'compliance',  label: 'Compliance',    icon: 'ShieldCheck'   },
  { key: 'maintenance', label: 'Maintenance',   icon: 'Wrench'        },
]

// ─── Sub-components ───────────────────────────────────────────
function SectionHead({ icon, title, sub }) {
  return (
    <div className="flex items-center gap-2.5 mb-4 pb-2 border-b border-slate-800/50">
      <div className="w-7 h-7 rounded-lg bg-cyan-500/10 border border-cyan-500/15 flex items-center justify-center flex-shrink-0">
        <Icon name={icon} size={13} className="text-cyan-400" />
      </div>
      <div>
        <div className="text-sm font-semibold text-white">{title}</div>
        {sub && <div className="text-2xs text-slate-600 mt-0.5">{sub}</div>}
      </div>
    </div>
  )
}

function F({ label, sub, required, children, wide }) {
  return (
    <div className={`space-y-1.5${wide ? ' col-span-2' : ''}`}>
      <label className="text-xs text-slate-400 font-medium block">
        {label}
        {required && <span className="text-red-400 ml-0.5">*</span>}
        {sub && <span className="text-slate-700 font-normal ml-1.5 text-2xs">{sub}</span>}
      </label>
      {children}
    </div>
  )
}

function Toggle({ value, onChange, labelOn = 'Yes', labelOff = 'No', danger }) {
  return (
    <div className="flex items-center gap-2.5 pt-1">
      <button type="button" onClick={() => onChange(!value)}
        className="relative w-10 rounded-full border transition-all flex-shrink-0"
        style={{
          height: '22px',
          background:   value ? (danger ? 'rgba(239,68,68,0.15)'  : 'rgba(0,212,255,0.12)') : '',
          borderColor:  value ? (danger ? 'rgba(239,68,68,0.35)'  : 'rgba(0,212,255,0.35)') : 'rgb(51,65,85)',
        }}>
        <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full transition-all ${
          value ? `translate-x-4 ${danger ? 'bg-red-400' : 'bg-cyan-400'}` : 'bg-slate-600'
        }`} />
      </button>
      <span className={`text-xs ${value ? (danger ? 'text-red-400 font-semibold' : 'text-cyan-300') : 'text-slate-600'}`}>
        {value ? labelOn : labelOff}
      </span>
    </div>
  )
}

// Default blank form — every field the routing engine may read
const BLANK = {
  // ── 1. Identity ──────────────────────────────────────────
  reg_number:         '',
  fleet_number:       '',
  make:               '',
  model:              '',
  variant:            '',
  year:               '',
  vin:                '',
  type:               'van',
  status:             'idle',
  colour:             '',
  body_type:          '',           // box, curtainsider, flatbed, tipper, tanker…
  // ── 2. Engine & Fuel ─────────────────────────────────────
  engine_make:        '',
  engine_model:       '',
  engine_cc:          '',           // displacement cc
  engine_power_kw:    '',           // kW
  engine_torque_nm:   '',           // Nm
  fuel_type:          'diesel',
  fuel_level:         100,
  fuel_tank_litres:   '',           // tank capacity
  adblue_tank_litres: '',
  adblue_level:       '',
  euro_standard:      '',           // euro3..euro6d
  transmission:       '',           // manual / auto / AMT
  gears:              '',
  odometer_km:        0,
  // ── 3. Dimensions ────────────────────────────────────────
  height_m:           '',           // CRITICAL — bridge clearance
  width_m:            '',           // road width restrictions
  length_m:           '',           // total vehicle length
  wheelbase_m:        '',           // axle spacing for turning radius
  front_overhang_m:   '',
  rear_overhang_m:    '',
  turning_radius_m:   '',           // kerb-to-kerb
  // ── 4. Weight ────────────────────────────────────────────
  gross_weight_t:     '',           // GVW tonnes — bridge/road weight limits
  unladen_weight_t:   '',           // tare weight
  payload_kg:         '',           // max payload kg
  train_weight_t:     '',           // gross train weight if towing
  front_axle_weight_t:'',
  rear_axle_weight_t: '',
  axle_weight_t:      '',           // heaviest single axle
  // ── 5. Axles & Tyres ─────────────────────────────────────
  num_axles:          '',           // total axle count
  drive_axles:        '',           // powered axles
  steer_axles:        '',
  lift_axle:          false,
  tyre_size_front:    '',
  tyre_size_rear:     '',
  spare_tyre:         false,
  // ── 6. Restrictions ──────────────────────────────────────
  hazmat:             false,
  hazmat_class:       '',           // ADR class 1-9
  hazmat_un_number:   '',           // UN number e.g. UN1203
  tunnel_category:    '',           // ADR B/C/D/E
  low_bridge_route:   false,        // operator knows it uses low-bridge routes
  max_bridge_weight_t:'',           // operator-set weight for bridge restriction override
  low_emission_zone:  '',           // euro4/5/6/exempt
  ulez_compliant:     false,
  caz_compliant:      false,
  hgv_restriction_24h:false,       // night movement restrictions
  max_speed_kmh:      '',           // governed speed
  speed_limiter:      false,
  // ── 7. Cargo ─────────────────────────────────────────────
  cargo_type:         '',
  temperature_controlled: false,
  temp_min_c:         '',
  temp_max_c:         '',
  tail_lift:          false,
  tail_lift_kg:       '',
  crane_fitted:       false,
  crane_reach_m:      '',
  curtainsider:       false,
  double_deck:        false,
  trailer_capable:    false,
  trailer_reg:        '',
  trailer_length_m:   '',
  trailer_weight_t:   '',
  // ── 8. Compliance ────────────────────────────────────────
  operator_licence:   '',
  operator_licence_expiry: '',
  insurance_policy:   '',
  insurance_expiry:   '',
  mot_expiry:         '',
  tacho_fitted:       false,
  tacho_serial:       '',
  tacho_type:         '',           // analogue / digital / smart
  working_time_rules: 'eu',         // eu / domestic
  // ── 9. Maintenance ───────────────────────────────────────
  last_service_date:  '',
  last_service_km:    '',
  next_service_date:  '',
  next_service_km:    '',
  last_brake_test:    '',
  last_safety_inspection: '',
  vehicle_check_due:  '',
  // ── 10. Notes ────────────────────────────────────────────
  notes:              '',
}

export default function VehicleModal({ vehicle, onClose, onSaved }) {
  const isEdit = !!vehicle?.id

  const [form,    setForm]    = useState(() => vehicle ? { ...BLANK, ...vehicle } : { ...BLANK })
  const [section, setSection] = useState('identity')
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    if (vehicle) setForm({ ...BLANK, ...vehicle })
  }, [vehicle?.id])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSave = async () => {
    if (!form.reg_number?.trim()) { setError('Registration number is required'); return }
    if (!form.make?.trim())       { setError('Make is required');               return }
    setError(null)
    setSaving(true)
    try {
      if (isEdit) await fleetService.updateVehicle(vehicle.id, form)
      else        await fleetService.createVehicle(form)
      onSaved?.()
      onClose?.()
    } catch (err) {
      setError(err.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  // ── Option lists ─────────────────────────────────────────────
  const EURO_STANDARDS = ['','euro3','euro4','euro5','euro6','euro6d','euro6d-temp']
  const TRANSMISSIONS  = ['','manual','automatic','amt','cvt']
  const TUNNEL_CATS    = ['','B','C','D','E']
  const HAZMAT_CLASSES = ['','1','2','3','4.1','4.2','4.3','5.1','5.2','6.1','6.2','7','8','9']
  const BODY_TYPES     = ['','box','curtainsider','flatbed','tipper','tanker','reefer','skeletal','double-deck','livestock','car-transporter','low-loader','other']
  const CARGO_TYPES    = ['','general','palletised','bulk-dry','bulk-liquid','refrigerated','frozen','hazmat','live-animals','oversized','container','other']
  const TACHO_TYPES    = ['','analogue','digital','smart-digital']

  // ── Expiry colour helper ─────────────────────────────────────
  const expiryColor = (date) => {
    if (!date) return 'text-slate-700'
    const d = Math.round((new Date(date) - new Date()) / 86400000)
    return d < 0 ? 'text-red-400' : d < 30 ? 'text-amber-400' : d < 90 ? 'text-yellow-400' : 'text-emerald-400'
  }
  const expiryLabel = (date) => {
    if (!date) return ''
    const d = Math.round((new Date(date) - new Date()) / 86400000)
    return d < 0 ? `Expired ${Math.abs(d)}d ago` : `${d} days left`
  }

  // ── Current section index for dot nav ───────────────────────
  const secIdx = SECTIONS.findIndex(s => s.key === section)

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-[#0a0f1e] border border-slate-800/60 rounded-2xl w-full max-w-2xl max-h-[94vh] flex flex-col shadow-2xl">

        {/* ── Header ─────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800/50 flex-shrink-0">
          <div>
            <h2 className="font-semibold text-white text-base">
              {isEdit ? `Edit — ${vehicle.reg_number}` : 'Add Vehicle'}
            </h2>
            <p className="text-2xs text-slate-600 mt-0.5">
              All fields feed vehicle-profile routing · {SECTIONS.length} sections
            </p>
          </div>
          <button onClick={onClose}
            className="p-2 rounded-lg text-slate-500 hover:text-white hover:bg-slate-800 transition-colors">
            <Icon name="X" size={15} />
          </button>
        </div>

        {/* ── Section tab strip ───────────────────────────────── */}
        <div className="flex gap-0.5 px-5 pt-3 pb-0 overflow-x-auto flex-shrink-0 scrollbar-hide">
          {SECTIONS.map(s => (
            <button key={s.key} onClick={() => setSection(s.key)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-2xs font-medium whitespace-nowrap transition-all flex-shrink-0 ${
                section === s.key
                  ? 'bg-cyan-500/12 text-cyan-300 border border-cyan-500/20'
                  : 'text-slate-600 hover:text-slate-300 hover:bg-slate-800/50'
              }`}>
              <Icon name={s.icon} size={10} />
              {s.label}
            </button>
          ))}
        </div>

        {/* ── Body ───────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          {/* ════════════════ 1. IDENTITY ════════════════ */}
          {section === 'identity' && (
            <>
              <SectionHead icon="FileText" title="Vehicle Identity" sub="Registration, make, model, body type" />
              <div className="grid grid-cols-2 gap-3">
                <F label="Registration Number" required>
                  <input className="apex-input" value={form.reg_number}
                    onChange={e => set('reg_number', e.target.value.toUpperCase())}
                    placeholder="AB12 CDE" />
                </F>
                <F label="Fleet / Asset Number">
                  <input className="apex-input" value={form.fleet_number}
                    onChange={e => set('fleet_number', e.target.value)}
                    placeholder="e.g. FLT-042" />
                </F>
                <F label="Make" required>
                  <input className="apex-input" value={form.make}
                    onChange={e => set('make', e.target.value)}
                    placeholder="Mercedes / DAF / Volvo / Ford" />
                </F>
                <F label="Model">
                  <input className="apex-input" value={form.model}
                    onChange={e => set('model', e.target.value)}
                    placeholder="Actros / XF / Transit" />
                </F>
                <F label="Variant / Spec">
                  <input className="apex-input" value={form.variant}
                    onChange={e => set('variant', e.target.value)}
                    placeholder="e.g. 2548 LS, 330 M, Custom L2H2" />
                </F>
                <F label="Year">
                  <input className="apex-input" type="number" value={form.year}
                    onChange={e => set('year', e.target.value)}
                    placeholder="2023" min="1980" max="2030" />
                </F>
                <F label="VIN">
                  <input className="apex-input" value={form.vin}
                    onChange={e => set('vin', e.target.value)}
                    placeholder="17-character VIN" maxLength={17} />
                </F>
                <F label="Colour">
                  <input className="apex-input" value={form.colour}
                    onChange={e => set('colour', e.target.value)}
                    placeholder="White / Red / Blue" />
                </F>
                <F label="Vehicle Type">
                  <select className="apex-input" value={form.type} onChange={e => set('type', e.target.value)}>
                    {Object.entries(VEHICLE_TYPE).map(([k, v]) => <option key={k} value={v}>{k}</option>)}
                  </select>
                </F>
                <F label="Body Type">
                  <select className="apex-input" value={form.body_type} onChange={e => set('body_type', e.target.value)}>
                    {BODY_TYPES.map(b => <option key={b} value={b}>{b || '— select —'}</option>)}
                  </select>
                </F>
                <F label="Operational Status">
                  <select className="apex-input" value={form.status} onChange={e => set('status', e.target.value)}>
                    {Object.entries(VEHICLE_STATUS).map(([k, v]) => <option key={k} value={v}>{k.replace('_',' ')}</option>)}
                  </select>
                </F>
              </div>
            </>
          )}

          {/* ════════════════ 2. ENGINE & FUEL ════════════════ */}
          {section === 'engine' && (
            <>
              <SectionHead icon="Fuel" title="Engine & Fuel"
                sub="Engine specs, fuel type, emissions standard — used for fuel cost estimates & LEZ routing" />
              <div className="grid grid-cols-2 gap-3">
                <F label="Engine Make">
                  <input className="apex-input" value={form.engine_make}
                    onChange={e => set('engine_make', e.target.value)}
                    placeholder="Mercedes OM / Cummins / Paccar" />
                </F>
                <F label="Engine Model">
                  <input className="apex-input" value={form.engine_model}
                    onChange={e => set('engine_model', e.target.value)}
                    placeholder="OM471 / ISX12 / MX-13" />
                </F>
                <F label="Displacement" sub="cc">
                  <input className="apex-input" type="number" value={form.engine_cc}
                    onChange={e => set('engine_cc', e.target.value)}
                    placeholder="12900" min="500" />
                </F>
                <F label="Power Output" sub="kW">
                  <input className="apex-input" type="number" value={form.engine_power_kw}
                    onChange={e => set('engine_power_kw', e.target.value)}
                    placeholder="350" min="0" />
                </F>
                <F label="Torque" sub="Nm">
                  <input className="apex-input" type="number" value={form.engine_torque_nm}
                    onChange={e => set('engine_torque_nm', e.target.value)}
                    placeholder="2500" min="0" />
                </F>
                <F label="Fuel Type">
                  <select className="apex-input" value={form.fuel_type} onChange={e => set('fuel_type', e.target.value)}>
                    {['diesel','petrol','electric','hybrid','lng','cng','hydrogen','hvo'].map(f =>
                      <option key={f} value={f}>{f.toUpperCase()}</option>)}
                  </select>
                </F>
                <F label="Euro Emission Standard">
                  <select className="apex-input" value={form.euro_standard} onChange={e => set('euro_standard', e.target.value)}>
                    <option value="">Unknown</option>
                    {EURO_STANDARDS.filter(e => e).map(e =>
                      <option key={e} value={e}>{e.toUpperCase()}</option>)}
                  </select>
                </F>
                <F label="Transmission">
                  <select className="apex-input" value={form.transmission} onChange={e => set('transmission', e.target.value)}>
                    <option value="">Unknown</option>
                    {TRANSMISSIONS.filter(t => t).map(t =>
                      <option key={t} value={t}>{t.toUpperCase()}</option>)}
                  </select>
                </F>
                <F label="Number of Gears">
                  <input className="apex-input" type="number" value={form.gears}
                    onChange={e => set('gears', e.target.value)}
                    placeholder="12" min="4" max="20" />
                </F>
                <F label="Fuel Tank Capacity" sub="litres">
                  <input className="apex-input" type="number" value={form.fuel_tank_litres}
                    onChange={e => set('fuel_tank_litres', e.target.value)}
                    placeholder="400" min="0" />
                </F>
                <F label="Fuel Level" sub="%">
                  <input className="apex-input" type="number" value={form.fuel_level}
                    onChange={e => set('fuel_level', e.target.value)}
                    placeholder="100" min="0" max="100" />
                </F>
                <F label="AdBlue Tank" sub="litres">
                  <input className="apex-input" type="number" value={form.adblue_tank_litres}
                    onChange={e => set('adblue_tank_litres', e.target.value)}
                    placeholder="60" min="0" />
                </F>
                <F label="AdBlue Level" sub="%">
                  <input className="apex-input" type="number" value={form.adblue_level}
                    onChange={e => set('adblue_level', e.target.value)}
                    placeholder="80" min="0" max="100" />
                </F>
                <F label="Odometer" sub="km">
                  <input className="apex-input" type="number" value={form.odometer_km}
                    onChange={e => set('odometer_km', e.target.value)}
                    placeholder="0" min="0" />
                </F>
              </div>
            </>
          )}

          {/* ════════════════ 3. DIMENSIONS ════════════════ */}
          {section === 'dimensions' && (
            <>
              <SectionHead icon="Ruler" title="Physical Dimensions"
                sub="All dimensions in metres — used for bridge clearance, road width & routing restrictions" />
              <div className="p-3 rounded-lg bg-cyan-500/5 border border-cyan-500/10 mb-1">
                <div className="flex items-start gap-2">
                  <Icon name="AlertCircle" size={12} className="text-cyan-400 mt-0.5 flex-shrink-0" />
                  <p className="text-2xs text-slate-400 leading-relaxed">
                    Height is the most critical field — it controls bridge & tunnel clearance routing.
                    Measure at the highest point including any roof-mounted equipment, aerials or air conditioning units.
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <F label="Overall Height" sub="metres ⚠">
                  <input className="apex-input" type="number" value={form.height_m}
                    onChange={e => set('height_m', e.target.value)}
                    placeholder="4.20" step="0.01" min="1" max="6" />
                </F>
                <F label="Overall Width" sub="metres">
                  <input className="apex-input" type="number" value={form.width_m}
                    onChange={e => set('width_m', e.target.value)}
                    placeholder="2.55" step="0.01" min="1" max="4" />
                </F>
                <F label="Overall Length" sub="metres">
                  <input className="apex-input" type="number" value={form.length_m}
                    onChange={e => set('length_m', e.target.value)}
                    placeholder="12.00" step="0.1" min="2" max="30" />
                </F>
                <F label="Wheelbase" sub="metres">
                  <input className="apex-input" type="number" value={form.wheelbase_m}
                    onChange={e => set('wheelbase_m', e.target.value)}
                    placeholder="3.70" step="0.01" min="1" max="12" />
                </F>
                <F label="Front Overhang" sub="metres">
                  <input className="apex-input" type="number" value={form.front_overhang_m}
                    onChange={e => set('front_overhang_m', e.target.value)}
                    placeholder="1.20" step="0.01" min="0" max="5" />
                </F>
                <F label="Rear Overhang" sub="metres">
                  <input className="apex-input" type="number" value={form.rear_overhang_m}
                    onChange={e => set('rear_overhang_m', e.target.value)}
                    placeholder="1.80" step="0.01" min="0" max="6" />
                </F>
                <F label="Turning Radius" sub="metres (kerb-to-kerb)">
                  <input className="apex-input" type="number" value={form.turning_radius_m}
                    onChange={e => set('turning_radius_m', e.target.value)}
                    placeholder="8.50" step="0.1" min="3" max="25" />
                </F>
              </div>
              {/* Live dimension summary */}
              {(form.height_m || form.width_m || form.length_m) && (
                <div className="mt-2 p-3 rounded-lg bg-slate-900/60 border border-slate-800/40 flex items-center gap-4 flex-wrap text-xs">
                  <span className="text-slate-600 font-medium">Envelope:</span>
                  {form.height_m  && <span className="text-cyan-300 font-mono">H {form.height_m}m</span>}
                  {form.width_m   && <span className="text-cyan-300 font-mono">W {form.width_m}m</span>}
                  {form.length_m  && <span className="text-cyan-300 font-mono">L {form.length_m}m</span>}
                  {form.height_m && parseFloat(form.height_m) > 3.0 && (
                    <span className="text-amber-400 font-semibold">⚠ Low bridge routes avoided</span>
                  )}
                </div>
              )}
            </>
          )}

          {/* ════════════════ 4. WEIGHT ════════════════ */}
          {section === 'weight' && (
            <>
              <SectionHead icon="Scale" title="Weight Parameters"
                sub="Used for bridge / road weight restrictions and axle-load routing rules" />
              <div className="grid grid-cols-2 gap-3">
                <F label="Gross Vehicle Weight (GVW)" sub="tonnes ⚠ critical">
                  <input className="apex-input" type="number" value={form.gross_weight_t}
                    onChange={e => set('gross_weight_t', e.target.value)}
                    placeholder="44.0" step="0.5" min="0" max="200" />
                </F>
                <F label="Unladen / Tare Weight" sub="tonnes">
                  <input className="apex-input" type="number" value={form.unladen_weight_t}
                    onChange={e => set('unladen_weight_t', e.target.value)}
                    placeholder="12.5" step="0.5" min="0" max="100" />
                </F>
                <F label="Maximum Payload" sub="kg">
                  <input className="apex-input" type="number" value={form.payload_kg}
                    onChange={e => set('payload_kg', e.target.value)}
                    placeholder="26000" step="100" min="0" />
                </F>
                <F label="Gross Train Weight" sub="tonnes (with trailer)">
                  <input className="apex-input" type="number" value={form.train_weight_t}
                    onChange={e => set('train_weight_t', e.target.value)}
                    placeholder="44.0" step="0.5" min="0" max="250" />
                </F>
                <F label="Max Single Axle Weight" sub="tonnes">
                  <input className="apex-input" type="number" value={form.axle_weight_t}
                    onChange={e => set('axle_weight_t', e.target.value)}
                    placeholder="11.5" step="0.5" min="0" max="30" />
                </F>
                <F label="Front Axle Weight" sub="tonnes">
                  <input className="apex-input" type="number" value={form.front_axle_weight_t}
                    onChange={e => set('front_axle_weight_t', e.target.value)}
                    placeholder="7.5" step="0.5" min="0" max="20" />
                </F>
                <F label="Rear Axle Weight" sub="tonnes">
                  <input className="apex-input" type="number" value={form.rear_axle_weight_t}
                    onChange={e => set('rear_axle_weight_t', e.target.value)}
                    placeholder="11.5" step="0.5" min="0" max="30" />
                </F>
              </div>
              {/* Weight summary */}
              {form.gross_weight_t && (
                <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-800/40 text-xs space-y-1">
                  <div className="flex justify-between">
                    <span className="text-slate-600">GVW</span>
                    <span className={`font-mono font-bold ${parseFloat(form.gross_weight_t) > 44 ? 'text-red-400' : parseFloat(form.gross_weight_t) > 26 ? 'text-amber-400' : 'text-emerald-400'}`}>
                      {form.gross_weight_t}t
                    </span>
                  </div>
                  {form.unladen_weight_t && form.payload_kg && (
                    <div className="flex justify-between">
                      <span className="text-slate-600">Available payload</span>
                      <span className="font-mono text-white">
                        {Math.round((parseFloat(form.gross_weight_t)*1000 - parseFloat(form.unladen_weight_t)*1000)).toLocaleString()} kg
                      </span>
                    </div>
                  )}
                  {parseFloat(form.gross_weight_t) > 3.5 && (
                    <div className="text-amber-400 text-2xs mt-1">
                      ⚠ HGV — bridge weight limits apply to routing
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* ════════════════ 5. AXLES & TYRES ════════════════ */}
          {section === 'axles' && (
            <>
              <SectionHead icon="CircleDot" title="Axles & Tyres"
                sub="Axle configuration affects tunnel / bridge category rules and road restrictions" />
              <div className="grid grid-cols-2 gap-3">
                <F label="Total Axle Count">
                  <select className="apex-input" value={form.num_axles} onChange={e => set('num_axles', e.target.value)}>
                    <option value="">Unknown</option>
                    {[2,3,4,5,6,7,8,9,10].map(n => <option key={n} value={n}>{n} axles</option>)}
                  </select>
                </F>
                <F label="Driven / Drive Axles">
                  <select className="apex-input" value={form.drive_axles} onChange={e => set('drive_axles', e.target.value)}>
                    <option value="">Unknown</option>
                    {[1,2,3,4].map(n => <option key={n} value={n}>{n} drive axle{n>1?'s':''}</option>)}
                  </select>
                </F>
                <F label="Steer Axles">
                  <select className="apex-input" value={form.steer_axles} onChange={e => set('steer_axles', e.target.value)}>
                    <option value="">Unknown</option>
                    {[1,2,3].map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </F>
                <F label="Lift Axle Fitted">
                  <Toggle value={form.lift_axle} onChange={v => set('lift_axle', v)}
                    labelOn="Yes — lift axle" labelOff="No" />
                </F>
                <F label="Front Tyre Size">
                  <input className="apex-input" value={form.tyre_size_front}
                    onChange={e => set('tyre_size_front', e.target.value)}
                    placeholder="315/70 R22.5" />
                </F>
                <F label="Rear Tyre Size">
                  <input className="apex-input" value={form.tyre_size_rear}
                    onChange={e => set('tyre_size_rear', e.target.value)}
                    placeholder="315/70 R22.5" />
                </F>
                <F label="Spare Tyre Carried">
                  <Toggle value={form.spare_tyre} onChange={v => set('spare_tyre', v)}
                    labelOn="Yes" labelOff="No" />
                </F>
              </div>
            </>
          )}

          {/* ════════════════ 6. RESTRICTIONS ════════════════ */}
          {section === 'restrictions' && (
            <>
              <SectionHead icon="AlertOctagon" title="Route Restrictions"
                sub="These flags control which roads, tunnels and zones the routing engine will use or avoid" />
              <div className="space-y-4">

                {/* Hazmat / ADR */}
                <div className="p-4 rounded-xl border border-slate-800/40 bg-slate-900/30 space-y-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Icon name="AlertTriangle" size={13} className="text-red-400" />
                    <span className="text-xs font-semibold text-slate-300">Hazardous Materials (ADR)</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <F label="Carrying Hazmat">
                      <Toggle value={form.hazmat} onChange={v => set('hazmat', v)}
                        labelOn="YES — ADR applies" labelOff="No hazmat" danger />
                    </F>
                    {form.hazmat && <>
                      <F label="ADR Hazmat Class">
                        <select className="apex-input" value={form.hazmat_class} onChange={e => set('hazmat_class', e.target.value)}>
                          <option value="">— select class —</option>
                          <option value="1">Class 1 — Explosives</option>
                          <option value="2">Class 2 — Gases</option>
                          <option value="3">Class 3 — Flammable Liquids</option>
                          <option value="4.1">Class 4.1 — Flammable Solids</option>
                          <option value="4.2">Class 4.2 — Spontaneously Combustible</option>
                          <option value="4.3">Class 4.3 — Dangerous When Wet</option>
                          <option value="5.1">Class 5.1 — Oxidising</option>
                          <option value="5.2">Class 5.2 — Organic Peroxides</option>
                          <option value="6.1">Class 6.1 — Toxic</option>
                          <option value="6.2">Class 6.2 — Infectious</option>
                          <option value="7">Class 7 — Radioactive</option>
                          <option value="8">Class 8 — Corrosive</option>
                          <option value="9">Class 9 — Miscellaneous</option>
                        </select>
                      </F>
                      <F label="UN Number">
                        <input className="apex-input" value={form.hazmat_un_number}
                          onChange={e => set('hazmat_un_number', e.target.value)}
                          placeholder="e.g. UN1203" maxLength={8} />
                      </F>
                      <F label="ADR Tunnel Category">
                        <select className="apex-input" value={form.tunnel_category} onChange={e => set('tunnel_category', e.target.value)}>
                          <option value="">None / no restriction</option>
                          <option value="B">Cat B — Explosives only</option>
                          <option value="C">Cat C — B + flammable gases/liquids</option>
                          <option value="D">Cat D — B+C + flammable liquids flashpoint ≤ 60°C</option>
                          <option value="E">Cat E — All dangerous goods</option>
                        </select>
                      </F>
                    </>}
                  </div>
                </div>

                {/* Height / bridge */}
                <div className="p-4 rounded-xl border border-slate-800/40 bg-slate-900/30 space-y-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Icon name="Triangle" size={13} className="text-amber-400" />
                    <span className="text-xs font-semibold text-slate-300">Bridge & Height Restrictions</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <F label="Uses Low-Bridge Routes">
                      <Toggle value={form.low_bridge_route} onChange={v => set('low_bridge_route', v)}
                        labelOn="Yes — avoid low bridges" labelOff="No" />
                    </F>
                    <F label="Min Bridge Weight Limit" sub="tonnes (avoid under this)">
                      <input className="apex-input" type="number" value={form.max_bridge_weight_t}
                        onChange={e => set('max_bridge_weight_t', e.target.value)}
                        placeholder="40.0" step="0.5" min="0" max="200" />
                    </F>
                  </div>
                </div>

                {/* Emissions zones */}
                <div className="p-4 rounded-xl border border-slate-800/40 bg-slate-900/30 space-y-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Icon name="Wind" size={13} className="text-emerald-400" />
                    <span className="text-xs font-semibold text-slate-300">Emission Zones (LEZ / ULEZ / CAZ)</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <F label="Emission Standard">
                      <select className="apex-input" value={form.low_emission_zone} onChange={e => set('low_emission_zone', e.target.value)}>
                        <option value="">Unknown</option>
                        <option value="euro6d">Euro 6d — fully compliant all zones</option>
                        <option value="euro6">Euro 6 — ULEZ/CAZ compliant</option>
                        <option value="euro5">Euro 5 — some zones restricted</option>
                        <option value="euro4">Euro 4 — most zones restricted</option>
                        <option value="euro3">Euro 3 — restricted in all major zones</option>
                        <option value="exempt">Exempt — electric/hydrogen/zero emission</option>
                      </select>
                    </F>
                    <F label="ULEZ Compliant">
                      <Toggle value={form.ulez_compliant} onChange={v => set('ulez_compliant', v)} labelOn="Yes" labelOff="No" />
                    </F>
                    <F label="CAZ Compliant">
                      <Toggle value={form.caz_compliant} onChange={v => set('caz_compliant', v)} labelOn="Yes" labelOff="No" />
                    </F>
                  </div>
                </div>

                {/* Speed */}
                <div className="p-4 rounded-xl border border-slate-800/40 bg-slate-900/30 space-y-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Icon name="Gauge" size={13} className="text-blue-400" />
                    <span className="text-xs font-semibold text-slate-300">Speed & Movement</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <F label="Max Governed Speed" sub="km/h">
                      <input className="apex-input" type="number" value={form.max_speed_kmh}
                        onChange={e => set('max_speed_kmh', e.target.value)}
                        placeholder="90" min="40" max="130" />
                    </F>
                    <F label="Speed Limiter Fitted">
                      <Toggle value={form.speed_limiter} onChange={v => set('speed_limiter', v)} labelOn="Yes" labelOff="No" />
                    </F>
                    <F label="Night Movement Restrictions">
                      <Toggle value={form.hgv_restriction_24h} onChange={v => set('hgv_restriction_24h', v)}
                        labelOn="Yes — restricted hours" labelOff="No restriction" />
                    </F>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ════════════════ 7. CARGO ════════════════ */}
          {section === 'cargo' && (
            <>
              <SectionHead icon="Package" title="Cargo & Equipment"
                sub="Cargo type and equipment flags are passed to the AI routing engine for load-specific routing" />
              <div className="grid grid-cols-2 gap-3">
                <F label="Cargo Type">
                  <select className="apex-input" value={form.cargo_type} onChange={e => set('cargo_type', e.target.value)}>
                    {CARGO_TYPES.map(c => <option key={c} value={c}>{c || '— select —'}</option>)}
                  </select>
                </F>
                <F label="Temperature Controlled">
                  <Toggle value={form.temperature_controlled} onChange={v => set('temperature_controlled', v)}
                    labelOn="Yes — temp controlled" labelOff="No" />
                </F>
                {form.temperature_controlled && <>
                  <F label="Min Temp" sub="°C">
                    <input className="apex-input" type="number" value={form.temp_min_c}
                      onChange={e => set('temp_min_c', e.target.value)}
                      placeholder="-25" min="-40" max="30" />
                  </F>
                  <F label="Max Temp" sub="°C">
                    <input className="apex-input" type="number" value={form.temp_max_c}
                      onChange={e => set('temp_max_c', e.target.value)}
                      placeholder="8" min="-40" max="30" />
                  </F>
                </>}
                <F label="Tail Lift Fitted">
                  <Toggle value={form.tail_lift} onChange={v => set('tail_lift', v)} labelOn="Yes" labelOff="No" />
                </F>
                {form.tail_lift && (
                  <F label="Tail Lift Capacity" sub="kg">
                    <input className="apex-input" type="number" value={form.tail_lift_kg}
                      onChange={e => set('tail_lift_kg', e.target.value)}
                      placeholder="2000" min="0" />
                  </F>
                )}
                <F label="Crane Fitted">
                  <Toggle value={form.crane_fitted} onChange={v => set('crane_fitted', v)} labelOn="Yes" labelOff="No" />
                </F>
                {form.crane_fitted && (
                  <F label="Crane Reach" sub="metres">
                    <input className="apex-input" type="number" value={form.crane_reach_m}
                      onChange={e => set('crane_reach_m', e.target.value)}
                      placeholder="8.5" step="0.5" min="0" />
                  </F>
                )}
                <F label="Curtainsider Body">
                  <Toggle value={form.curtainsider} onChange={v => set('curtainsider', v)} labelOn="Yes" labelOff="No" />
                </F>
                <F label="Double-Deck">
                  <Toggle value={form.double_deck} onChange={v => set('double_deck', v)} labelOn="Yes" labelOff="No" />
                </F>
                <F label="Trailer Capable">
                  <Toggle value={form.trailer_capable} onChange={v => set('trailer_capable', v)} labelOn="Yes" labelOff="No" />
                </F>
                {form.trailer_capable && <>
                  <F label="Trailer Registration">
                    <input className="apex-input" value={form.trailer_reg}
                      onChange={e => set('trailer_reg', e.target.value.toUpperCase())}
                      placeholder="Trailer reg number" />
                  </F>
                  <F label="Trailer Length" sub="metres">
                    <input className="apex-input" type="number" value={form.trailer_length_m}
                      onChange={e => set('trailer_length_m', e.target.value)}
                      placeholder="13.6" step="0.1" min="0" max="20" />
                  </F>
                  <F label="Trailer Weight" sub="tonnes">
                    <input className="apex-input" type="number" value={form.trailer_weight_t}
                      onChange={e => set('trailer_weight_t', e.target.value)}
                      placeholder="6.5" step="0.5" min="0" max="50" />
                  </F>
                </>}
              </div>
            </>
          )}

          {/* ════════════════ 8. COMPLIANCE ════════════════ */}
          {section === 'compliance' && (
            <>
              <SectionHead icon="ShieldCheck" title="Operator Compliance"
                sub="Licence, insurance, MOT — expiry warnings generated automatically" />
              <div className="grid grid-cols-2 gap-3">
                <F label="Operator Licence Number">
                  <input className="apex-input" value={form.operator_licence}
                    onChange={e => set('operator_licence', e.target.value)}
                    placeholder="OC1234567" />
                </F>
                <F label="Operator Licence Expiry">
                  <div className="space-y-1">
                    <input className="apex-input" type="date" value={form.operator_licence_expiry}
                      onChange={e => set('operator_licence_expiry', e.target.value)} />
                    {form.operator_licence_expiry && (
                      <div className={`text-2xs font-semibold ${expiryColor(form.operator_licence_expiry)}`}>
                        {expiryLabel(form.operator_licence_expiry)}
                      </div>
                    )}
                  </div>
                </F>
                <F label="Insurance Policy Number">
                  <input className="apex-input" value={form.insurance_policy}
                    onChange={e => set('insurance_policy', e.target.value)}
                    placeholder="Policy reference" />
                </F>
                <F label="Insurance Expiry">
                  <div className="space-y-1">
                    <input className="apex-input" type="date" value={form.insurance_expiry}
                      onChange={e => set('insurance_expiry', e.target.value)} />
                    {form.insurance_expiry && (
                      <div className={`text-2xs font-semibold ${expiryColor(form.insurance_expiry)}`}>
                        {expiryLabel(form.insurance_expiry)}
                      </div>
                    )}
                  </div>
                </F>
                <F label="MOT / Road Tax Expiry">
                  <div className="space-y-1">
                    <input className="apex-input" type="date" value={form.mot_expiry}
                      onChange={e => set('mot_expiry', e.target.value)} />
                    {form.mot_expiry && (
                      <div className={`text-2xs font-semibold ${expiryColor(form.mot_expiry)}`}>
                        {expiryLabel(form.mot_expiry)}
                      </div>
                    )}
                  </div>
                </F>
                <F label="Tachograph Fitted">
                  <Toggle value={form.tacho_fitted} onChange={v => set('tacho_fitted', v)} labelOn="Yes" labelOff="No" />
                </F>
                {form.tacho_fitted && <>
                  <F label="Tacho Serial Number">
                    <input className="apex-input" value={form.tacho_serial}
                      onChange={e => set('tacho_serial', e.target.value)}
                      placeholder="Serial / cert number" />
                  </F>
                  <F label="Tacho Type">
                    <select className="apex-input" value={form.tacho_type} onChange={e => set('tacho_type', e.target.value)}>
                      <option value="">Unknown</option>
                      {TACHO_TYPES.filter(t=>t).map(t =>
                        <option key={t} value={t}>{t.charAt(0).toUpperCase()+t.slice(1)}</option>)}
                    </select>
                  </F>
                </>}
                <F label="Working Time Rules">
                  <select className="apex-input" value={form.working_time_rules} onChange={e => set('working_time_rules', e.target.value)}>
                    <option value="eu">EU (4.5h drive / 45min break)</option>
                    <option value="domestic">Domestic (GB rules)</option>
                    <option value="mixed">Mixed — both apply</option>
                  </select>
                </F>
              </div>

              {/* Compliance summary */}
              {[
                { l: 'Operator Licence', d: form.operator_licence_expiry },
                { l: 'Insurance',        d: form.insurance_expiry },
                { l: 'MOT / Tax',        d: form.mot_expiry },
              ].filter(r => r.d).length > 0 && (
                <div className="mt-2 p-3 rounded-xl bg-slate-900/50 border border-slate-800/40 space-y-2">
                  <div className="text-2xs text-slate-600 font-semibold uppercase tracking-wider mb-2">Expiry Overview</div>
                  {[
                    { l: 'Operator Licence', d: form.operator_licence_expiry },
                    { l: 'Insurance',        d: form.insurance_expiry },
                    { l: 'MOT / Tax',        d: form.mot_expiry },
                  ].filter(r => r.d).map(r => (
                    <div key={r.l} className="flex items-center justify-between text-xs">
                      <span className="text-slate-500">{r.l}</span>
                      <div className="text-right">
                        <span className="font-mono text-slate-300 mr-2">{r.d}</span>
                        <span className={`font-semibold ${expiryColor(r.d)}`}>{expiryLabel(r.d)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* ════════════════ 9. MAINTENANCE ════════════════ */}
          {section === 'maintenance' && (
            <>
              <SectionHead icon="Wrench" title="Maintenance & Inspections"
                sub="Service records and upcoming scheduled checks" />
              <div className="grid grid-cols-2 gap-3">
                <F label="Last Service Date">
                  <input className="apex-input" type="date" value={form.last_service_date}
                    onChange={e => set('last_service_date', e.target.value)} />
                </F>
                <F label="Last Service Odometer" sub="km">
                  <input className="apex-input" type="number" value={form.last_service_km}
                    onChange={e => set('last_service_km', e.target.value)}
                    placeholder="0" min="0" />
                </F>
                <F label="Next Service Due Date">
                  <div className="space-y-1">
                    <input className="apex-input" type="date" value={form.next_service_date}
                      onChange={e => set('next_service_date', e.target.value)} />
                    {form.next_service_date && (
                      <div className={`text-2xs font-semibold ${expiryColor(form.next_service_date)}`}>
                        {expiryLabel(form.next_service_date)}
                      </div>
                    )}
                  </div>
                </F>
                <F label="Next Service Odometer" sub="km">
                  <input className="apex-input" type="number" value={form.next_service_km}
                    onChange={e => set('next_service_km', e.target.value)}
                    placeholder="0" min="0" />
                </F>
                <F label="Last Brake Test Date">
                  <input className="apex-input" type="date" value={form.last_brake_test}
                    onChange={e => set('last_brake_test', e.target.value)} />
                </F>
                <F label="Last Safety Inspection">
                  <input className="apex-input" type="date" value={form.last_safety_inspection}
                    onChange={e => set('last_safety_inspection', e.target.value)} />
                </F>
                <F label="Vehicle Check Due Date">
                  <div className="space-y-1">
                    <input className="apex-input" type="date" value={form.vehicle_check_due}
                      onChange={e => set('vehicle_check_due', e.target.value)} />
                    {form.vehicle_check_due && (
                      <div className={`text-2xs font-semibold ${expiryColor(form.vehicle_check_due)}`}>
                        {expiryLabel(form.vehicle_check_due)}
                      </div>
                    )}
                  </div>
                </F>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-slate-400 font-medium">Notes / Defects</label>
                <textarea className="apex-input resize-none" rows={3}
                  value={form.notes} onChange={e => set('notes', e.target.value)}
                  placeholder="Known defects, restrictions, operator notes…" />
              </div>
            </>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 bg-red-500/5 border border-red-500/20 rounded-lg px-3 py-2">
              <Icon name="AlertCircle" size={14} className="text-red-400 flex-shrink-0" />
              <span className="text-red-400 text-xs">{error}</span>
            </div>
          )}
        </div>

        {/* ── Footer ─────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-800/50 flex-shrink-0 gap-4">
          {/* Dot nav */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {SECTIONS.map((s, i) => (
              <button key={s.key} onClick={() => setSection(s.key)}
                title={s.label}
                className={`rounded-full transition-all ${
                  s.key === section
                    ? 'w-4 h-2 bg-cyan-400'
                    : 'w-2 h-2 bg-slate-700 hover:bg-slate-600'
                }`} />
            ))}
          </div>
          {/* Actions */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Prev / Next section */}
            {secIdx > 0 && (
              <button onClick={() => setSection(SECTIONS[secIdx - 1].key)}
                className="px-3 py-2 rounded-lg text-xs text-slate-500 hover:text-white hover:bg-slate-800 transition-colors flex items-center gap-1">
                <Icon name="ChevronLeft" size={12} /> Prev
              </button>
            )}
            {secIdx < SECTIONS.length - 1 && (
              <button onClick={() => setSection(SECTIONS[secIdx + 1].key)}
                className="px-3 py-2 rounded-lg text-xs text-slate-500 hover:text-white hover:bg-slate-800 transition-colors flex items-center gap-1">
                Next <Icon name="ChevronRight" size={12} />
              </button>
            )}
            <button onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm text-slate-500 hover:text-white hover:bg-slate-800 transition-colors">
              Cancel
            </button>
            <button onClick={handleSave} disabled={saving}
              className="flex items-center gap-2 px-5 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-black text-sm font-bold transition-colors disabled:opacity-40">
              <Icon name={saving ? 'Loader2' : 'Check'} size={13} className={saving ? 'animate-spin' : ''} />
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Vehicle'}
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}
