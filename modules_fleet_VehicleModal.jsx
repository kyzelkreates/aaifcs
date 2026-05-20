/**
 * ============================================================
 * APEX AI — Vehicle Modal  (Full Legal & Safety Compliance)
 *
 * SECTIONS
 *  1  Identity         — reg, fleet no, make/model/variant, year, first-reg date,
 *                        VIN, colour, body type, GB type-approval category
 *  2  Engine & Fuel    — engine, power, torque, fuel type, Euro standard,
 *                        AdBlue, DPF/SCR, transmission, CO₂, noise, fuel card
 *  3  Dimensions       — H/W/L, wheelbase, overhangs, turning radius
 *  4  Weight & Plating — GVW, Ministry plate weight, unladen, payload,
 *                        train weight, axle weights, plated date
 *  5  Axles & Tyres    — axle count/types, tyre sizes, spare tyre
 *  6  Route Restrictions— hazmat/ADR (class, UN, tunnel cat), bridge,
 *                        LEZ/ULEZ/CAZ, night restrictions, governed speed
 *  7  Cargo & Equipment— cargo type, temp-controlled, tail lift, crane,
 *                        curtainsider, double-deck, load restraint, trailer
 *  8  Driver & Tachograph— assigned driver, CPC, tacho card, tacho type,
 *                        calibration dates, download dates
 *  9  Operator Licence — O-licence type/number/area/expiry, operating centre,
 *                        transport manager, authorised vehicles
 * 10  Insurance & Breakdown— insurer, policy type, expiry, breakdown cover
 * 11  Safety Inspections  — DVSA 6-week interval, annual test, brake tests,
 *                        roller brake test result, PMI schedule
 * 12  Telematics & ADAS   — telematics unit, CCTV/DVS, blind spot,
 *                        AEBS, lane departure, side scan (DVS regs)
 * 13  Maintenance         — service dates/km, next service
 * ============================================================
 */

import { useState, useEffect } from 'react'
import Icon from './components_ui_Icon'
import { VEHICLE_STATUS, VEHICLE_TYPE, fleetService } from './services_fleet_fleetService'

// ─── Sections ────────────────────────────────────────────────
const SECTIONS = [
  { key: 'identity',     label: 'Identity',        icon: 'FileText'      },
  { key: 'engine',       label: 'Engine',           icon: 'Fuel'          },
  { key: 'dimensions',   label: 'Dimensions',       icon: 'Ruler'         },
  { key: 'weight',       label: 'Weight',           icon: 'Scale'         },
  { key: 'axles',        label: 'Axles & Tyres',    icon: 'CircleDot'     },
  { key: 'restrictions', label: 'Restrictions',     icon: 'AlertOctagon'  },
  { key: 'cargo',        label: 'Cargo',            icon: 'Package'       },
  { key: 'driver',       label: 'Driver & Tacho',   icon: 'User'          },
  { key: 'operator',     label: 'Operator Licence', icon: 'Briefcase'     },
  { key: 'insurance',    label: 'Insurance',        icon: 'Shield'        },
  { key: 'safety',       label: 'Inspections',      icon: 'ClipboardCheck'},
  { key: 'telematics',   label: 'Telematics',       icon: 'Wifi'          },
  { key: 'maintenance',  label: 'Maintenance',      icon: 'Wrench'        },
]

// ─── Sub-components ───────────────────────────────────────────
function SH({ icon, title, sub }) {
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

function F({ label, sub, required, children, wide, note }) {
  return (
    <div className={`space-y-1.5${wide ? ' col-span-2' : ''}`}>
      <label className="text-xs text-slate-400 font-medium block">
        {label}
        {required && <span className="text-red-400 ml-0.5">*</span>}
        {sub && <span className="text-slate-600 font-normal ml-1.5 text-2xs">{sub}</span>}
      </label>
      {children}
      {note && <p className="text-2xs text-slate-700 leading-relaxed mt-0.5">{note}</p>}
    </div>
  )
}

function InfoBox({ icon = 'Info', color = 'cyan', children }) {
  const cols = { cyan: 'bg-cyan-500/5 border-cyan-500/10 text-cyan-400', amber: 'bg-amber-500/5 border-amber-500/10 text-amber-400', red: 'bg-red-500/5 border-red-500/10 text-red-400', emerald: 'bg-emerald-500/5 border-emerald-500/10 text-emerald-400' }
  return (
    <div className={`flex items-start gap-2.5 p-3 rounded-lg border mb-3 ${cols[color]}`}>
      <Icon name={icon} size={12} className="flex-shrink-0 mt-0.5" />
      <p className="text-2xs text-slate-400 leading-relaxed">{children}</p>
    </div>
  )
}

function Toggle({ value, onChange, labelOn = 'Yes', labelOff = 'No', danger }) {
  return (
    <div className="flex items-center gap-2.5 pt-1">
      <button type="button" onClick={() => onChange(!value)}
        className="relative w-10 rounded-full border transition-all flex-shrink-0"
        style={{ height: 22, background: value ? (danger ? 'rgba(239,68,68,.15)' : 'rgba(0,212,255,.12)') : '', borderColor: value ? (danger ? 'rgba(239,68,68,.35)' : 'rgba(0,212,255,.35)') : 'rgb(51,65,85)' }}>
        <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full transition-all ${value ? `translate-x-4 ${danger ? 'bg-red-400' : 'bg-cyan-400'}` : 'bg-slate-600'}`} />
      </button>
      <span className={`text-xs ${value ? (danger ? 'text-red-400 font-semibold' : 'text-cyan-300') : 'text-slate-600'}`}>
        {value ? labelOn : labelOff}
      </span>
    </div>
  )
}

function ExpiryRow({ label, date }) {
  if (!date) return null
  const d = Math.round((new Date(date) - new Date()) / 86400000)
  const col = d < 0 ? 'text-red-400' : d < 14 ? 'text-red-400' : d < 30 ? 'text-amber-400' : d < 90 ? 'text-yellow-400' : 'text-emerald-400'
  const txt = d < 0 ? `EXPIRED ${Math.abs(d)}d ago` : `${d} days`
  return (
    <div className="flex items-center justify-between text-xs py-1 border-b border-slate-800/20 last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className={`font-semibold font-mono ${col}`}>{txt}</span>
    </div>
  )
}

// ─── Default blank form ───────────────────────────────────────
const BLANK = {
  // 1 Identity
  reg_number: '', fleet_number: '', make: '', model: '', variant: '',
  year: '', first_reg_date: '', vin: '', type: 'van', status: 'idle',
  colour: '', body_type: '', vehicle_category: '', country_of_reg: 'GB',
  // 2 Engine & Fuel
  engine_make: '', engine_model: '', engine_cc: '', engine_power_kw: '',
  engine_torque_nm: '', fuel_type: 'diesel', fuel_level: 100,
  fuel_tank_litres: '', adblue_tank_litres: '', adblue_level: '',
  euro_standard: '', dpf_fitted: false, scr_fitted: false,
  transmission: '', gears: '', co2_gkm: '', noise_db: '',
  odometer_km: 0, fuel_card_provider: '', fuel_card_number: '',
  // 3 Dimensions
  height_m: '', width_m: '', length_m: '', wheelbase_m: '',
  front_overhang_m: '', rear_overhang_m: '', turning_radius_m: '',
  // 4 Weight & Plating
  gross_weight_t: '', plated_weight_t: '', plate_date: '',
  unladen_weight_t: '', payload_kg: '', train_weight_t: '',
  front_axle_weight_t: '', rear_axle_weight_t: '', axle_weight_t: '',
  // 5 Axles & Tyres
  num_axles: '', drive_axles: '', steer_axles: '',
  lift_axle: false, tyre_size_front: '', tyre_size_rear: '', spare_tyre: false,
  // 6 Restrictions
  hazmat: false, hazmat_class: '', hazmat_un_number: '', tunnel_category: '',
  low_bridge_route: false, max_bridge_weight_t: '',
  low_emission_zone: '', ulez_compliant: false, caz_compliant: false,
  hgv_restriction_24h: false, max_speed_kmh: '', speed_limiter: false,
  // 7 Cargo
  cargo_type: '', temperature_controlled: false, temp_min_c: '', temp_max_c: '',
  tail_lift: false, tail_lift_kg: '', crane_fitted: false, crane_reach_m: '',
  curtainsider: false, double_deck: false,
  lashing_points: '', lashing_capacity_kg: '',
  load_restraint_equipment: '',
  trailer_capable: false, trailer_reg: '', trailer_length_m: '',
  trailer_weight_t: '', trailer_annual_test: '', trailer_plate_weight_t: '',
  trailer_brake_type: '',
  // 8 Driver & Tacho
  assigned_driver: '', assigned_driver_licence: '',
  driver_cpc_number: '', driver_cpc_expiry: '',
  driver_tacho_card: '', driver_tacho_expiry: '',
  tacho_fitted: false, tacho_serial: '', tacho_type: '',
  tacho_last_calibration: '', tacho_next_calibration: '',
  tacho_calibration_cert: '', tacho_seal_number: '',
  tacho_download_freq_days: '',
  tacho_last_remote_download: '', tacho_last_manual_download: '',
  working_time_rules: 'eu',
  // 9 Operator Licence
  operator_licence: '', operator_licence_type: '',
  operator_licence_expiry: '', operator_licence_area: '',
  operator_licence_auth_vehicles: '',
  operating_centre: '', transport_manager: '', transport_manager_cpc: '',
  // 10 Insurance
  insurance_policy: '', insurance_type: '', insurance_expiry: '',
  insurer_name: '', insurer_claims_phone: '',
  breakdown_provider: '', breakdown_phone: '', breakdown_policy: '',
  // 11 Safety Inspections
  safety_inspection_interval_weeks: '', safety_inspection_type: '',
  last_safety_inspection: '', next_safety_inspection: '',
  annual_test_due: '', annual_test_last: '',
  mot_expiry: '', vehicle_check_due: '',
  brake_test_date: '', brake_test_result: '',
  brake_efficiency_front: '', brake_efficiency_rear: '',
  // 12 Telematics & ADAS
  telematics_fitted: false, telematics_serial: '', telematics_imei: '',
  telematics_provider: '',
  cctv_fitted: false, cctv_system: '',
  dvs_side_scan: false, dvs_blind_spot: false,
  aebs_fitted: false, ldw_fitted: false,
  // 13 Maintenance
  last_service_date: '', last_service_km: '',
  next_service_date: '', next_service_km: '',
  notes: '',
}

export default function VehicleModal({ vehicle, onClose, onSaved }) {
  const isEdit = !!vehicle?.id
  const [form,    setForm]    = useState(() => vehicle ? { ...BLANK, ...vehicle } : { ...BLANK })
  const [section, setSection] = useState('identity')
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState(null)

  useEffect(() => { if (vehicle) setForm({ ...BLANK, ...vehicle }) }, [vehicle?.id])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSave = async () => {
    if (!form.reg_number?.trim()) { setError('Registration number is required'); return }
    if (!form.make?.trim())       { setError('Make is required'); return }
    setError(null); setSaving(true)
    try {
      if (isEdit) await fleetService.updateVehicle(vehicle.id, form)
      else        await fleetService.createVehicle(form)
      onSaved?.(); onClose?.()
    } catch (e) { setError(e.message || 'Failed to save') }
    finally { setSaving(false) }
  }

  // Expiry helper
  const ec = (d) => { if (!d) return 'text-slate-700'; const n = Math.round((new Date(d) - new Date()) / 86400000); return n < 0 ? 'text-red-400' : n < 30 ? 'text-amber-400' : n < 90 ? 'text-yellow-400' : 'text-emerald-400' }
  const el = (d) => { if (!d) return ''; const n = Math.round((new Date(d) - new Date()) / 86400000); return n < 0 ? `EXPIRED ${Math.abs(n)}d ago` : `${n}d left` }

  // All expiry dates for summary
  const allExpiries = [
    { l: 'MOT',                  d: form.mot_expiry },
    { l: 'Annual Test',          d: form.annual_test_due },
    { l: 'Insurance',            d: form.insurance_expiry },
    { l: 'Operator Licence',     d: form.operator_licence_expiry },
    { l: 'Driver CPC',           d: form.driver_cpc_expiry },
    { l: 'Driver Tacho Card',    d: form.driver_tacho_expiry },
    { l: 'Tacho Calibration',    d: form.tacho_next_calibration },
    { l: 'Safety Inspection',    d: form.next_safety_inspection },
    { l: 'Vehicle Check',        d: form.vehicle_check_due },
    { l: 'Next Service',         d: form.next_service_date },
    { l: 'Trailer Annual Test',  d: form.trailer_annual_test },
    { l: 'Breakdown Policy',     d: form.breakdown_policy },
  ].filter(r => r.d)

  const secIdx = SECTIONS.findIndex(s => s.key === section)

  // Shared input class
  const I = 'apex-input w-full'
  const S = 'apex-input w-full'

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-3">
      <div className="bg-[#080d1a] border border-slate-800/60 rounded-2xl w-full max-w-2xl max-h-[96vh] flex flex-col shadow-2xl">

        {/* ── Header ─────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800/50 flex-shrink-0">
          <div>
            <h2 className="font-semibold text-white text-sm">
              {isEdit ? `Edit — ${vehicle.reg_number}` : 'Add Vehicle'}
            </h2>
            <p className="text-2xs text-slate-600 mt-0.5">Full legal &amp; safety compliance · {SECTIONS.length} sections</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-slate-800 transition-colors">
            <Icon name="X" size={15} />
          </button>
        </div>

        {/* ── Section tabs (scrollable) ───────────────────── */}
        <div className="flex gap-0.5 px-4 pt-3 pb-1 overflow-x-auto flex-shrink-0 scrollbar-hide border-b border-slate-800/30">
          {SECTIONS.map(s => (
            <button key={s.key} onClick={() => setSection(s.key)}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-2xs font-medium whitespace-nowrap transition-all flex-shrink-0 ${
                section === s.key
                  ? 'bg-cyan-500/12 text-cyan-300 border border-cyan-500/20'
                  : 'text-slate-600 hover:text-slate-300 hover:bg-slate-800/40'
              }`}>
              <Icon name={s.icon} size={9} />
              {s.label}
            </button>
          ))}
        </div>

        {/* ── Body ───────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

          {/* ══════════════ 1. IDENTITY ══════════════ */}
          {section === 'identity' && (
            <>
              <SH icon="FileText" title="Vehicle Identity" sub="Registration, identification and type-approval" />
              <div className="grid grid-cols-2 gap-3">
                <F label="Registration Number" required>
                  <input className={I} value={form.reg_number} onChange={e => set('reg_number', e.target.value.toUpperCase())} placeholder="AB12 CDE" />
                </F>
                <F label="Fleet / Asset Number">
                  <input className={I} value={form.fleet_number} onChange={e => set('fleet_number', e.target.value)} placeholder="FLT-042" />
                </F>
                <F label="Make" required>
                  <input className={I} value={form.make} onChange={e => set('make', e.target.value)} placeholder="Mercedes / DAF / Ford" />
                </F>
                <F label="Model">
                  <input className={I} value={form.model} onChange={e => set('model', e.target.value)} placeholder="Actros / Transit / XF" />
                </F>
                <F label="Variant / Spec">
                  <input className={I} value={form.variant} onChange={e => set('variant', e.target.value)} placeholder="e.g. 2548 LS, L2H2" />
                </F>
                <F label="Year of Manufacture">
                  <input className={I} type="number" value={form.year} onChange={e => set('year', e.target.value)} placeholder="2023" min="1980" max="2030" />
                </F>
                <F label="First Registration Date" note="Required for MOT/annual test timing (HGV)">
                  <input className={I} type="date" value={form.first_reg_date} onChange={e => set('first_reg_date', e.target.value)} />
                </F>
                <F label="VIN" note="17 characters — matches log book and MOT/DVSA records">
                  <input className={I} value={form.vin} onChange={e => set('vin', e.target.value)} placeholder="17-character VIN" maxLength={17} />
                </F>
                <F label="Colour">
                  <input className={I} value={form.colour} onChange={e => set('colour', e.target.value)} placeholder="White / Silver / Red" />
                </F>
                <F label="Country of Registration">
                  <select className={S} value={form.country_of_reg} onChange={e => set('country_of_reg', e.target.value)}>
                    {['GB','IE','FR','DE','NL','BE','PL','ES','IT','PT','SE','DK','NO','CH','AT','CZ','HU','RO','BG','HR','SK','SI','LT','LV','EE'].map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </F>
                <F label="Vehicle Type">
                  <select className={S} value={form.type} onChange={e => set('type', e.target.value)}>
                    {Object.entries(VEHICLE_TYPE).map(([k, v]) => <option key={k} value={v}>{k}</option>)}
                  </select>
                </F>
                <F label="Body Type">
                  <select className={S} value={form.body_type} onChange={e => set('body_type', e.target.value)}>
                    {['','box','curtainsider','flatbed','tipper','tanker','reefer','skeletal','double-deck','livestock','car-transporter','low-loader','dropside','luton','minibus','other'].map(b => <option key={b} value={b}>{b || '— select —'}</option>)}
                  </select>
                </F>
                <F label="GB Type-Approval Category" note="N1 <3.5t van · N2 3.5-12t · N3 >12t HGV · M1 car · M2/M3 bus">
                  <select className={S} value={form.vehicle_category} onChange={e => set('vehicle_category', e.target.value)}>
                    {['','N1','N2','N3','M1','M2','M3','O1','O2','O3','O4','L'].map(c => <option key={c} value={c}>{c || '— select —'}</option>)}
                  </select>
                </F>
                <F label="Operational Status">
                  <select className={S} value={form.status} onChange={e => set('status', e.target.value)}>
                    {Object.entries(VEHICLE_STATUS).map(([k, v]) => <option key={k} value={v}>{k.replace('_',' ')}</option>)}
                  </select>
                </F>
              </div>
            </>
          )}

          {/* ══════════════ 2. ENGINE & FUEL ══════════════ */}
          {section === 'engine' && (
            <>
              <SH icon="Fuel" title="Engine & Fuel" sub="Emissions, performance specs — used for LEZ routing and fuel cost models" />
              <div className="grid grid-cols-2 gap-3">
                <F label="Engine Make">
                  <input className={I} value={form.engine_make} onChange={e => set('engine_make', e.target.value)} placeholder="Mercedes OM / Cummins" />
                </F>
                <F label="Engine Model">
                  <input className={I} value={form.engine_model} onChange={e => set('engine_model', e.target.value)} placeholder="OM471 / ISX12" />
                </F>
                <F label="Displacement" sub="cc">
                  <input className={I} type="number" value={form.engine_cc} onChange={e => set('engine_cc', e.target.value)} placeholder="12900" />
                </F>
                <F label="Power" sub="kW">
                  <input className={I} type="number" value={form.engine_power_kw} onChange={e => set('engine_power_kw', e.target.value)} placeholder="350" />
                </F>
                <F label="Torque" sub="Nm">
                  <input className={I} type="number" value={form.engine_torque_nm} onChange={e => set('engine_torque_nm', e.target.value)} placeholder="2500" />
                </F>
                <F label="Fuel Type">
                  <select className={S} value={form.fuel_type} onChange={e => set('fuel_type', e.target.value)}>
                    {['diesel','petrol','electric','hybrid','lng','cng','hydrogen','hvo','lpg'].map(f => <option key={f} value={f}>{f.toUpperCase()}</option>)}
                  </select>
                </F>
                <F label="Euro Emission Standard" note="Determines LEZ/ULEZ/CAZ eligibility">
                  <select className={S} value={form.euro_standard} onChange={e => set('euro_standard', e.target.value)}>
                    {['','euro3','euro4','euro5','euro6','euro6d','euro6d-temp'].map(e => <option key={e} value={e}>{e || 'Unknown'}</option>)}
                  </select>
                </F>
                <F label="Transmission">
                  <select className={S} value={form.transmission} onChange={e => set('transmission', e.target.value)}>
                    {['','manual','automatic','amt','cvt'].map(t => <option key={t} value={t}>{t || 'Unknown'}</option>)}
                  </select>
                </F>
                <F label="Number of Gears">
                  <input className={I} type="number" value={form.gears} onChange={e => set('gears', e.target.value)} placeholder="12" min="4" max="20" />
                </F>
                <F label="Fuel Tank Capacity" sub="litres">
                  <input className={I} type="number" value={form.fuel_tank_litres} onChange={e => set('fuel_tank_litres', e.target.value)} placeholder="400" />
                </F>
                <F label="Fuel Level" sub="%">
                  <input className={I} type="number" value={form.fuel_level} onChange={e => set('fuel_level', e.target.value)} placeholder="100" min="0" max="100" />
                </F>
                <F label="AdBlue Tank" sub="litres">
                  <input className={I} type="number" value={form.adblue_tank_litres} onChange={e => set('adblue_tank_litres', e.target.value)} placeholder="60" />
                </F>
                <F label="AdBlue Level" sub="%">
                  <input className={I} type="number" value={form.adblue_level} onChange={e => set('adblue_level', e.target.value)} placeholder="80" min="0" max="100" />
                </F>
                <F label="DPF Fitted" note="Diesel Particulate Filter">
                  <Toggle value={form.dpf_fitted} onChange={v => set('dpf_fitted', v)} labelOn="Yes — DPF fitted" labelOff="No DPF" />
                </F>
                <F label="SCR Fitted" note="Selective Catalytic Reduction (AdBlue)">
                  <Toggle value={form.scr_fitted} onChange={v => set('scr_fitted', v)} labelOn="Yes — SCR fitted" labelOff="No SCR" />
                </F>
                <F label="CO₂ Emissions" sub="g/km">
                  <input className={I} type="number" value={form.co2_gkm} onChange={e => set('co2_gkm', e.target.value)} placeholder="210" />
                </F>
                <F label="Noise Level" sub="dB(A) — type approval">
                  <input className={I} type="number" value={form.noise_db} onChange={e => set('noise_db', e.target.value)} placeholder="72" step="0.1" />
                </F>
                <F label="Odometer" sub="km">
                  <input className={I} type="number" value={form.odometer_km} onChange={e => set('odometer_km', e.target.value)} placeholder="0" min="0" />
                </F>
                <F label="Fuel Card Provider">
                  <input className={I} value={form.fuel_card_provider} onChange={e => set('fuel_card_provider', e.target.value)} placeholder="BP / Shell / Keyfuels / Fleetone" />
                </F>
                <F label="Fuel Card Number">
                  <input className={I} value={form.fuel_card_number} onChange={e => set('fuel_card_number', e.target.value)} placeholder="Card / account reference" />
                </F>
              </div>
            </>
          )}

          {/* ══════════════ 3. DIMENSIONS ══════════════ */}
          {section === 'dimensions' && (
            <>
              <SH icon="Ruler" title="Physical Dimensions" sub="All measurements in metres — height is critical for bridge clearance routing" />
              <InfoBox color="amber" icon="AlertTriangle">
                Height must be measured at the tallest point including roof-mounted equipment, aerials, and air-con units. This is used to exclude low-bridge routes automatically.
              </InfoBox>
              <div className="grid grid-cols-3 gap-3">
                <F label="Overall Height" sub="m ⚠">
                  <input className={I} type="number" value={form.height_m} onChange={e => set('height_m', e.target.value)} placeholder="4.20" step="0.01" min="1" max="6" />
                </F>
                <F label="Overall Width" sub="m">
                  <input className={I} type="number" value={form.width_m} onChange={e => set('width_m', e.target.value)} placeholder="2.55" step="0.01" min="1" max="4" />
                </F>
                <F label="Overall Length" sub="m">
                  <input className={I} type="number" value={form.length_m} onChange={e => set('length_m', e.target.value)} placeholder="12.00" step="0.1" min="2" max="30" />
                </F>
                <F label="Wheelbase" sub="m">
                  <input className={I} type="number" value={form.wheelbase_m} onChange={e => set('wheelbase_m', e.target.value)} placeholder="3.70" step="0.01" />
                </F>
                <F label="Front Overhang" sub="m">
                  <input className={I} type="number" value={form.front_overhang_m} onChange={e => set('front_overhang_m', e.target.value)} placeholder="1.20" step="0.01" />
                </F>
                <F label="Rear Overhang" sub="m">
                  <input className={I} type="number" value={form.rear_overhang_m} onChange={e => set('rear_overhang_m', e.target.value)} placeholder="1.80" step="0.01" />
                </F>
                <F label="Turning Radius" sub="m kerb-to-kerb">
                  <input className={I} type="number" value={form.turning_radius_m} onChange={e => set('turning_radius_m', e.target.value)} placeholder="8.50" step="0.1" />
                </F>
              </div>
              {(form.height_m || form.width_m || form.length_m) && (
                <div className="mt-2 p-3 rounded-xl bg-slate-900/50 border border-slate-800/40 flex flex-wrap gap-3 text-xs items-center">
                  <span className="text-slate-600 font-medium">Envelope:</span>
                  {form.height_m  && <span className="font-mono text-cyan-300">H {form.height_m}m</span>}
                  {form.width_m   && <span className="font-mono text-cyan-300">W {form.width_m}m</span>}
                  {form.length_m  && <span className="font-mono text-cyan-300">L {form.length_m}m</span>}
                  {form.height_m && parseFloat(form.height_m) > 3.0 && <span className="text-amber-400 font-semibold ml-2">⚠ Low bridge routes excluded</span>}
                </div>
              )}
            </>
          )}

          {/* ══════════════ 4. WEIGHT & PLATING ══════════════ */}
          {section === 'weight' && (
            <>
              <SH icon="Scale" title="Weight & Ministry Plating" sub="GVW, Ministry plate weight, axle loads — used for bridge / road weight restriction routing" />
              <InfoBox color="cyan" icon="Info">
                Ministry plate weight (plated weight) is the legal maximum for the vehicle as granted by DVSA type approval — it may differ from manufacturer GVW. Both are required for bridge restriction compliance.
              </InfoBox>
              <div className="grid grid-cols-2 gap-3">
                <F label="Gross Vehicle Weight (GVW)" sub="tonnes ⚠">
                  <input className={I} type="number" value={form.gross_weight_t} onChange={e => set('gross_weight_t', e.target.value)} placeholder="44.0" step="0.5" />
                </F>
                <F label="Ministry Plated Weight" sub="tonnes — from DVSA plate">
                  <input className={I} type="number" value={form.plated_weight_t} onChange={e => set('plated_weight_t', e.target.value)} placeholder="44.0" step="0.5" />
                </F>
                <F label="Ministry Plate Date">
                  <input className={I} type="date" value={form.plate_date} onChange={e => set('plate_date', e.target.value)} />
                </F>
                <F label="Unladen / Tare Weight" sub="tonnes">
                  <input className={I} type="number" value={form.unladen_weight_t} onChange={e => set('unladen_weight_t', e.target.value)} placeholder="12.5" step="0.5" />
                </F>
                <F label="Maximum Payload" sub="kg">
                  <input className={I} type="number" value={form.payload_kg} onChange={e => set('payload_kg', e.target.value)} placeholder="26000" step="100" />
                </F>
                <F label="Gross Train Weight" sub="tonnes (with trailer)">
                  <input className={I} type="number" value={form.train_weight_t} onChange={e => set('train_weight_t', e.target.value)} placeholder="44.0" step="0.5" />
                </F>
                <F label="Max Single Axle Weight" sub="tonnes">
                  <input className={I} type="number" value={form.axle_weight_t} onChange={e => set('axle_weight_t', e.target.value)} placeholder="11.5" step="0.5" />
                </F>
                <F label="Front Axle Weight" sub="tonnes">
                  <input className={I} type="number" value={form.front_axle_weight_t} onChange={e => set('front_axle_weight_t', e.target.value)} placeholder="7.5" step="0.5" />
                </F>
                <F label="Rear Axle Weight" sub="tonnes">
                  <input className={I} type="number" value={form.rear_axle_weight_t} onChange={e => set('rear_axle_weight_t', e.target.value)} placeholder="11.5" step="0.5" />
                </F>
              </div>
              {form.gross_weight_t && (
                <div className="mt-2 p-3 rounded-xl bg-slate-900/50 border border-slate-800/40 space-y-1.5 text-xs">
                  {form.unladen_weight_t && (
                    <div className="flex justify-between">
                      <span className="text-slate-600">Available payload</span>
                      <span className="font-mono text-white font-semibold">
                        {Math.round((parseFloat(form.gross_weight_t) - parseFloat(form.unladen_weight_t)) * 1000).toLocaleString()} kg
                      </span>
                    </div>
                  )}
                  {parseFloat(form.gross_weight_t) > 3.5 && <div className="text-amber-400 text-2xs">⚠ Over 3.5t — HGV rules apply (O-licence, tacho, annual test)</div>}
                  {parseFloat(form.gross_weight_t) > 7.5 && <div className="text-amber-400 text-2xs">⚠ Over 7.5t — Night driving AQMA restrictions may apply</div>}
                  {parseFloat(form.gross_weight_t) > 44  && <div className="text-red-400 text-2xs">⚠ Exceeds 44t — Special types order required</div>}
                </div>
              )}
            </>
          )}

          {/* ══════════════ 5. AXLES & TYRES ══════════════ */}
          {section === 'axles' && (
            <>
              <SH icon="CircleDot" title="Axles & Tyres" sub="Axle configuration affects bridge category, tunnel rules and road restrictions" />
              <div className="grid grid-cols-2 gap-3">
                <F label="Total Axle Count">
                  <select className={S} value={form.num_axles} onChange={e => set('num_axles', e.target.value)}>
                    <option value="">Unknown</option>
                    {[2,3,4,5,6,7,8,9,10].map(n => <option key={n} value={n}>{n} axles</option>)}
                  </select>
                </F>
                <F label="Drive / Powered Axles">
                  <select className={S} value={form.drive_axles} onChange={e => set('drive_axles', e.target.value)}>
                    <option value="">Unknown</option>
                    {[1,2,3,4].map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </F>
                <F label="Steer Axles">
                  <select className={S} value={form.steer_axles} onChange={e => set('steer_axles', e.target.value)}>
                    <option value="">Unknown</option>
                    {[1,2,3].map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </F>
                <F label="Lift Axle Fitted">
                  <Toggle value={form.lift_axle} onChange={v => set('lift_axle', v)} labelOn="Yes" labelOff="No" />
                </F>
                <F label="Front Tyre Size">
                  <input className={I} value={form.tyre_size_front} onChange={e => set('tyre_size_front', e.target.value)} placeholder="315/70 R22.5" />
                </F>
                <F label="Rear Tyre Size">
                  <input className={I} value={form.tyre_size_rear} onChange={e => set('tyre_size_rear', e.target.value)} placeholder="315/70 R22.5" />
                </F>
                <F label="Spare Tyre Carried">
                  <Toggle value={form.spare_tyre} onChange={v => set('spare_tyre', v)} labelOn="Yes" labelOff="No" />
                </F>
              </div>
            </>
          )}

          {/* ══════════════ 6. RESTRICTIONS ══════════════ */}
          {section === 'restrictions' && (
            <>
              <SH icon="AlertOctagon" title="Route Restrictions" sub="These flags control routing engine road / zone / tunnel avoidance" />
              {/* Hazmat */}
              <div className="p-4 rounded-xl border border-slate-800/40 bg-slate-900/20 space-y-3">
                <div className="flex items-center gap-2"><Icon name="AlertTriangle" size={13} className="text-red-400" /><span className="text-xs font-semibold text-slate-300">Hazardous Materials (ADR)</span></div>
                <div className="grid grid-cols-2 gap-3">
                  <F label="Carrying Hazmat / ADR">
                    <Toggle value={form.hazmat} onChange={v => set('hazmat', v)} labelOn="YES — ADR applies" labelOff="No" danger />
                  </F>
                  {form.hazmat && <>
                    <F label="ADR Class">
                      <select className={S} value={form.hazmat_class} onChange={e => set('hazmat_class', e.target.value)}>
                        <option value="">— select —</option>
                        <option value="1">1 — Explosives</option>
                        <option value="2">2 — Gases</option>
                        <option value="3">3 — Flammable Liquids</option>
                        <option value="4.1">4.1 — Flammable Solids</option>
                        <option value="4.2">4.2 — Spontaneously Combustible</option>
                        <option value="4.3">4.3 — Dangerous When Wet</option>
                        <option value="5.1">5.1 — Oxidising</option>
                        <option value="5.2">5.2 — Organic Peroxides</option>
                        <option value="6.1">6.1 — Toxic</option>
                        <option value="6.2">6.2 — Infectious</option>
                        <option value="7">7 — Radioactive</option>
                        <option value="8">8 — Corrosive</option>
                        <option value="9">9 — Miscellaneous</option>
                      </select>
                    </F>
                    <F label="UN Number">
                      <input className={I} value={form.hazmat_un_number} onChange={e => set('hazmat_un_number', e.target.value)} placeholder="UN1203" maxLength={8} />
                    </F>
                    <F label="ADR Tunnel Category">
                      <select className={S} value={form.tunnel_category} onChange={e => set('tunnel_category', e.target.value)}>
                        <option value="">None</option>
                        <option value="B">B — Explosives only</option>
                        <option value="C">C — B + flammable gases</option>
                        <option value="D">D — B+C + flammable liquids</option>
                        <option value="E">E — All dangerous goods</option>
                      </select>
                    </F>
                  </>}
                </div>
              </div>
              {/* Bridge */}
              <div className="p-4 rounded-xl border border-slate-800/40 bg-slate-900/20 space-y-3">
                <div className="flex items-center gap-2"><Icon name="Triangle" size={13} className="text-amber-400" /><span className="text-xs font-semibold text-slate-300">Bridge & Height</span></div>
                <div className="grid grid-cols-2 gap-3">
                  <F label="Avoid Low-Bridge Routes">
                    <Toggle value={form.low_bridge_route} onChange={v => set('low_bridge_route', v)} labelOn="Yes" labelOff="No" />
                  </F>
                  <F label="Min Permitted Bridge Weight" sub="t">
                    <input className={I} type="number" value={form.max_bridge_weight_t} onChange={e => set('max_bridge_weight_t', e.target.value)} placeholder="40.0" step="0.5" />
                  </F>
                </div>
              </div>
              {/* LEZ */}
              <div className="p-4 rounded-xl border border-slate-800/40 bg-slate-900/20 space-y-3">
                <div className="flex items-center gap-2"><Icon name="Wind" size={13} className="text-emerald-400" /><span className="text-xs font-semibold text-slate-300">Emission Zones (LEZ / ULEZ / CAZ)</span></div>
                <div className="grid grid-cols-2 gap-3">
                  <F label="Emission Standard">
                    <select className={S} value={form.low_emission_zone} onChange={e => set('low_emission_zone', e.target.value)}>
                      <option value="">Unknown</option>
                      <option value="euro6d">Euro 6d — compliant all zones</option>
                      <option value="euro6">Euro 6 — ULEZ / CAZ compliant</option>
                      <option value="euro5">Euro 5 — some zones restricted</option>
                      <option value="euro4">Euro 4 — most zones restricted</option>
                      <option value="euro3">Euro 3 — restricted all major zones</option>
                      <option value="exempt">Exempt — zero emission</option>
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
              <div className="p-4 rounded-xl border border-slate-800/40 bg-slate-900/20 space-y-3">
                <div className="flex items-center gap-2"><Icon name="Gauge" size={13} className="text-blue-400" /><span className="text-xs font-semibold text-slate-300">Speed & Night Restrictions</span></div>
                <div className="grid grid-cols-2 gap-3">
                  <F label="Max Governed Speed" sub="km/h">
                    <input className={I} type="number" value={form.max_speed_kmh} onChange={e => set('max_speed_kmh', e.target.value)} placeholder="90" min="40" max="130" />
                  </F>
                  <F label="Speed Limiter Fitted">
                    <Toggle value={form.speed_limiter} onChange={v => set('speed_limiter', v)} labelOn="Yes" labelOff="No" />
                  </F>
                  <F label="Night / AQMA Restrictions">
                    <Toggle value={form.hgv_restriction_24h} onChange={v => set('hgv_restriction_24h', v)} labelOn="Yes — restricted hours" labelOff="No" />
                  </F>
                </div>
              </div>
            </>
          )}

          {/* ══════════════ 7. CARGO & EQUIPMENT ══════════════ */}
          {section === 'cargo' && (
            <>
              <SH icon="Package" title="Cargo & Equipment" sub="Load type, restraint equipment, specialist fittings and trailer" />
              <div className="grid grid-cols-2 gap-3">
                <F label="Cargo / Load Type">
                  <select className={S} value={form.cargo_type} onChange={e => set('cargo_type', e.target.value)}>
                    {['','general','palletised','bulk-dry','bulk-liquid','refrigerated','frozen','hazmat','live-animals','oversized','container','express','mixed','other'].map(c => <option key={c} value={c}>{c || '— select —'}</option>)}
                  </select>
                </F>
                <F label="Temperature Controlled">
                  <Toggle value={form.temperature_controlled} onChange={v => set('temperature_controlled', v)} labelOn="Yes" labelOff="No" />
                </F>
                {form.temperature_controlled && <>
                  <F label="Min Temp" sub="°C">
                    <input className={I} type="number" value={form.temp_min_c} onChange={e => set('temp_min_c', e.target.value)} placeholder="-25" />
                  </F>
                  <F label="Max Temp" sub="°C">
                    <input className={I} type="number" value={form.temp_max_c} onChange={e => set('temp_max_c', e.target.value)} placeholder="8" />
                  </F>
                </>}
                <F label="Tail Lift Fitted">
                  <Toggle value={form.tail_lift} onChange={v => set('tail_lift', v)} labelOn="Yes" labelOff="No" />
                </F>
                {form.tail_lift && <F label="Tail Lift Capacity" sub="kg">
                  <input className={I} type="number" value={form.tail_lift_kg} onChange={e => set('tail_lift_kg', e.target.value)} placeholder="2000" />
                </F>}
                <F label="Crane Fitted">
                  <Toggle value={form.crane_fitted} onChange={v => set('crane_fitted', v)} labelOn="Yes" labelOff="No" />
                </F>
                {form.crane_fitted && <F label="Crane Reach" sub="m">
                  <input className={I} type="number" value={form.crane_reach_m} onChange={e => set('crane_reach_m', e.target.value)} placeholder="8.5" step="0.5" />
                </F>}
                <F label="Curtainsider Body">
                  <Toggle value={form.curtainsider} onChange={v => set('curtainsider', v)} labelOn="Yes" labelOff="No" />
                </F>
                <F label="Double Deck">
                  <Toggle value={form.double_deck} onChange={v => set('double_deck', v)} labelOn="Yes" labelOff="No" />
                </F>
                <F label="Lashing Points" sub="count">
                  <input className={I} type="number" value={form.lashing_points} onChange={e => set('lashing_points', e.target.value)} placeholder="20" />
                </F>
                <F label="Lashing Capacity" sub="kg per point">
                  <input className={I} type="number" value={form.lashing_capacity_kg} onChange={e => set('lashing_capacity_kg', e.target.value)} placeholder="2000" />
                </F>
                <F label="Load Restraint Equipment" wide>
                  <input className={I} value={form.load_restraint_equipment} onChange={e => set('load_restraint_equipment', e.target.value)} placeholder="e.g. ratchet straps, load bars, cargo net, airbags" />
                </F>
              </div>
              {/* Trailer */}
              <div className="mt-2 p-4 rounded-xl border border-slate-800/40 bg-slate-900/20 space-y-3">
                <div className="flex items-center gap-2"><Icon name="Truck" size={13} className="text-cyan-400" /><span className="text-xs font-semibold text-slate-300">Trailer</span></div>
                <div className="grid grid-cols-2 gap-3">
                  <F label="Trailer Capable">
                    <Toggle value={form.trailer_capable} onChange={v => set('trailer_capable', v)} labelOn="Yes" labelOff="No" />
                  </F>
                  {form.trailer_capable && <>
                    <F label="Trailer Registration">
                      <input className={I} value={form.trailer_reg} onChange={e => set('trailer_reg', e.target.value.toUpperCase())} placeholder="Trailer reg" />
                    </F>
                    <F label="Trailer Length" sub="m">
                      <input className={I} type="number" value={form.trailer_length_m} onChange={e => set('trailer_length_m', e.target.value)} placeholder="13.6" step="0.1" />
                    </F>
                    <F label="Trailer Weight" sub="t">
                      <input className={I} type="number" value={form.trailer_weight_t} onChange={e => set('trailer_weight_t', e.target.value)} placeholder="6.5" step="0.5" />
                    </F>
                    <F label="Trailer Plated Weight" sub="t — from DVSA plate">
                      <input className={I} type="number" value={form.trailer_plate_weight_t} onChange={e => set('trailer_plate_weight_t', e.target.value)} placeholder="38.0" step="0.5" />
                    </F>
                    <F label="Trailer Annual Test Due">
                      <div>
                        <input className={I} type="date" value={form.trailer_annual_test} onChange={e => set('trailer_annual_test', e.target.value)} />
                        {form.trailer_annual_test && <div className={`text-2xs mt-0.5 font-semibold ${ec(form.trailer_annual_test)}`}>{el(form.trailer_annual_test)}</div>}
                      </div>
                    </F>
                    <F label="Trailer Brake Type">
                      <select className={S} value={form.trailer_brake_type} onChange={e => set('trailer_brake_type', e.target.value)}>
                        {['','air','hydraulic','mechanical','electric'].map(b => <option key={b} value={b}>{b || '— select —'}</option>)}
                      </select>
                    </F>
                  </>}
                </div>
              </div>
            </>
          )}

          {/* ══════════════ 8. DRIVER & TACHO ══════════════ */}
          {section === 'driver' && (
            <>
              <SH icon="User" title="Driver & Tachograph" sub="Assigned driver CPC, tachograph calibration and download records" />
              <InfoBox color="amber" icon="AlertTriangle">
                GB law: digital tachograph must be calibrated every 2 years. Driver CPC card expires every 5 years (35 hours periodic training). Both are O-licence conditions.
              </InfoBox>
              <div className="grid grid-cols-2 gap-3">
                <F label="Assigned Driver Name">
                  <input className={I} value={form.assigned_driver} onChange={e => set('assigned_driver', e.target.value)} placeholder="Full name" />
                </F>
                <F label="Driver Licence Number">
                  <input className={I} value={form.assigned_driver_licence} onChange={e => set('assigned_driver_licence', e.target.value)} placeholder="DVLA licence number" />
                </F>
                <F label="Driver CPC Card Number" note="Certificate of Professional Competence">
                  <input className={I} value={form.driver_cpc_number} onChange={e => set('driver_cpc_number', e.target.value)} placeholder="CPC card / DQC number" />
                </F>
                <F label="Driver CPC Expiry">
                  <div>
                    <input className={I} type="date" value={form.driver_cpc_expiry} onChange={e => set('driver_cpc_expiry', e.target.value)} />
                    {form.driver_cpc_expiry && <div className={`text-2xs mt-0.5 font-semibold ${ec(form.driver_cpc_expiry)}`}>{el(form.driver_cpc_expiry)}</div>}
                  </div>
                </F>
                <F label="Driver Tachograph Card Number">
                  <input className={I} value={form.driver_tacho_card} onChange={e => set('driver_tacho_card', e.target.value)} placeholder="Tacho card number" />
                </F>
                <F label="Driver Tacho Card Expiry">
                  <div>
                    <input className={I} type="date" value={form.driver_tacho_expiry} onChange={e => set('driver_tacho_expiry', e.target.value)} />
                    {form.driver_tacho_expiry && <div className={`text-2xs mt-0.5 font-semibold ${ec(form.driver_tacho_expiry)}`}>{el(form.driver_tacho_expiry)}</div>}
                  </div>
                </F>
                <F label="Working Time Rules">
                  <select className={S} value={form.working_time_rules} onChange={e => set('working_time_rules', e.target.value)}>
                    <option value="eu">EU — 4.5h drive / 45min break</option>
                    <option value="domestic">Domestic (GB)</option>
                    <option value="mixed">Mixed — both apply</option>
                  </select>
                </F>
              </div>

              {/* Tachograph unit */}
              <div className="mt-2 p-4 rounded-xl border border-slate-800/40 bg-slate-900/20 space-y-3">
                <div className="flex items-center gap-2"><Icon name="Monitor" size={13} className="text-cyan-400" /><span className="text-xs font-semibold text-slate-300">Tachograph Unit</span></div>
                <div className="grid grid-cols-2 gap-3">
                  <F label="Tachograph Fitted">
                    <Toggle value={form.tacho_fitted} onChange={v => set('tacho_fitted', v)} labelOn="Yes" labelOff="No" />
                  </F>
                  {form.tacho_fitted && <>
                    <F label="Tacho Type">
                      <select className={S} value={form.tacho_type} onChange={e => set('tacho_type', e.target.value)}>
                        {['','analogue','digital','smart-digital'].map(t => <option key={t} value={t}>{t || 'Unknown'}</option>)}
                      </select>
                    </F>
                    <F label="Tacho Serial Number">
                      <input className={I} value={form.tacho_serial} onChange={e => set('tacho_serial', e.target.value)} placeholder="Unit serial number" />
                    </F>
                    <F label="Calibration Certificate Ref">
                      <input className={I} value={form.tacho_calibration_cert} onChange={e => set('tacho_calibration_cert', e.target.value)} placeholder="Certificate / seal reference" />
                    </F>
                    <F label="Seal Number">
                      <input className={I} value={form.tacho_seal_number} onChange={e => set('tacho_seal_number', e.target.value)} placeholder="Security seal number" />
                    </F>
                    <F label="Last Calibration Date" note="2-year interval required by law">
                      <input className={I} type="date" value={form.tacho_last_calibration} onChange={e => set('tacho_last_calibration', e.target.value)} />
                    </F>
                    <F label="Next Calibration Due">
                      <div>
                        <input className={I} type="date" value={form.tacho_next_calibration} onChange={e => set('tacho_next_calibration', e.target.value)} />
                        {form.tacho_next_calibration && <div className={`text-2xs mt-0.5 font-semibold ${ec(form.tacho_next_calibration)}`}>{el(form.tacho_next_calibration)}</div>}
                      </div>
                    </F>
                    <F label="Download Frequency" sub="days">
                      <input className={I} type="number" value={form.tacho_download_freq_days} onChange={e => set('tacho_download_freq_days', e.target.value)} placeholder="28" min="1" max="90" />
                    </F>
                    <F label="Last Remote Download Date">
                      <input className={I} type="date" value={form.tacho_last_remote_download} onChange={e => set('tacho_last_remote_download', e.target.value)} />
                    </F>
                    <F label="Last Manual Download Date">
                      <input className={I} type="date" value={form.tacho_last_manual_download} onChange={e => set('tacho_last_manual_download', e.target.value)} />
                    </F>
                  </>}
                </div>
              </div>
            </>
          )}

          {/* ══════════════ 9. OPERATOR LICENCE ══════════════ */}
          {section === 'operator' && (
            <>
              <SH icon="Briefcase" title="Operator Licence" sub="GB O-licence details — mandatory for vehicles over 3.5t GVW used commercially" />
              <InfoBox color="cyan" icon="AlertCircle">
                Vehicles over 3.5t GVW used for hire-or-reward or own-account carriage of goods require an Operator's Licence issued by the Traffic Commissioner.
              </InfoBox>
              <div className="grid grid-cols-2 gap-3">
                <F label="Operator Licence Number">
                  <input className={I} value={form.operator_licence} onChange={e => set('operator_licence', e.target.value)} placeholder="OC1234567" />
                </F>
                <F label="Licence Type">
                  <select className={S} value={form.operator_licence_type} onChange={e => set('operator_licence_type', e.target.value)}>
                    <option value="">— select —</option>
                    <option value="standard-international">Standard International</option>
                    <option value="standard-national">Standard National</option>
                    <option value="restricted">Restricted</option>
                  </select>
                </F>
                <F label="Licence Expiry">
                  <div>
                    <input className={I} type="date" value={form.operator_licence_expiry} onChange={e => set('operator_licence_expiry', e.target.value)} />
                    {form.operator_licence_expiry && <div className={`text-2xs mt-0.5 font-semibold ${ec(form.operator_licence_expiry)}`}>{el(form.operator_licence_expiry)}</div>}
                  </div>
                </F>
                <F label="Traffic Area">
                  <select className={S} value={form.operator_licence_area} onChange={e => set('operator_licence_area', e.target.value)}>
                    {['','North East','North West','West Midlands','East Midlands','Eastern','London & South East','South East & Metro','South Wales','West of England','Scotland','Northern Ireland'].map(a => <option key={a} value={a}>{a || '— select —'}</option>)}
                  </select>
                </F>
                <F label="Authorised Vehicles" sub="count on licence">
                  <input className={I} type="number" value={form.operator_licence_auth_vehicles} onChange={e => set('operator_licence_auth_vehicles', e.target.value)} placeholder="10" min="1" />
                </F>
                <F label="Operating Centre Address" wide>
                  <input className={I} value={form.operating_centre} onChange={e => set('operating_centre', e.target.value)} placeholder="Full address of operating centre" />
                </F>
                <F label="Transport Manager Name">
                  <input className={I} value={form.transport_manager} onChange={e => set('transport_manager', e.target.value)} placeholder="Full name" />
                </F>
                <F label="Transport Manager CPC Number">
                  <input className={I} value={form.transport_manager_cpc} onChange={e => set('transport_manager_cpc', e.target.value)} placeholder="TM CPC / certificate number" />
                </F>
              </div>
            </>
          )}

          {/* ══════════════ 10. INSURANCE ══════════════ */}
          {section === 'insurance' && (
            <>
              <SH icon="Shield" title="Insurance & Breakdown Cover" sub="Motor insurance, goods-in-transit and roadside breakdown" />
              <div className="grid grid-cols-2 gap-3">
                <F label="Insurer / Underwriter Name">
                  <input className={I} value={form.insurer_name} onChange={e => set('insurer_name', e.target.value)} placeholder="Aviva / Zurich / NIG / Hiscox" />
                </F>
                <F label="Insurance Type">
                  <select className={S} value={form.insurance_type} onChange={e => set('insurance_type', e.target.value)}>
                    {['','third-party','tpft','comprehensive','fleet','goods-in-transit','combined'].map(t => <option key={t} value={t}>{t || '— select —'}</option>)}
                  </select>
                </F>
                <F label="Policy Number">
                  <input className={I} value={form.insurance_policy} onChange={e => set('insurance_policy', e.target.value)} placeholder="Policy reference number" />
                </F>
                <F label="Insurance Expiry">
                  <div>
                    <input className={I} type="date" value={form.insurance_expiry} onChange={e => set('insurance_expiry', e.target.value)} />
                    {form.insurance_expiry && <div className={`text-2xs mt-0.5 font-semibold ${ec(form.insurance_expiry)}`}>{el(form.insurance_expiry)}</div>}
                  </div>
                </F>
                <F label="Insurer Claims Phone">
                  <input className={I} type="tel" value={form.insurer_claims_phone} onChange={e => set('insurer_claims_phone', e.target.value)} placeholder="0800 000 0000" />
                </F>
              </div>
              <div className="mt-2 p-4 rounded-xl border border-slate-800/40 bg-slate-900/20 space-y-3">
                <div className="flex items-center gap-2"><Icon name="PhoneCall" size={13} className="text-emerald-400" /><span className="text-xs font-semibold text-slate-300">Breakdown Cover</span></div>
                <div className="grid grid-cols-2 gap-3">
                  <F label="Breakdown Provider">
                    <input className={I} value={form.breakdown_provider} onChange={e => set('breakdown_provider', e.target.value)} placeholder="RAC / AA / Highways / Truck Assist" />
                  </F>
                  <F label="Breakdown Phone">
                    <input className={I} type="tel" value={form.breakdown_phone} onChange={e => set('breakdown_phone', e.target.value)} placeholder="0800 000 0000" />
                  </F>
                  <F label="Breakdown Policy Ref">
                    <input className={I} value={form.breakdown_policy} onChange={e => set('breakdown_policy', e.target.value)} placeholder="Policy / membership number" />
                  </F>
                </div>
              </div>
            </>
          )}

          {/* ══════════════ 11. SAFETY INSPECTIONS ══════════════ */}
          {section === 'safety' && (
            <>
              <SH icon="ClipboardCheck" title="Safety Inspections" sub="DVSA preventive maintenance inspections, annual test, brake test — O-licence conditions" />
              <InfoBox color="amber" icon="AlertTriangle">
                Operators must carry out regular safety inspections (PMIs) at intervals set by DVSA — typically every 4–13 weeks depending on vehicle use and type. Evidence of PMIs is required during a DVSA roadside check or operator audit.
              </InfoBox>
              <div className="grid grid-cols-2 gap-3">
                <F label="PMI Inspection Interval" sub="weeks" note="DVSA-agreed interval — 4 to 13 weeks">
                  <select className={S} value={form.safety_inspection_interval_weeks} onChange={e => set('safety_inspection_interval_weeks', e.target.value)}>
                    <option value="">Not set</option>
                    {[4,5,6,7,8,10,12,13].map(n => <option key={n} value={n}>{n} weeks</option>)}
                  </select>
                </F>
                <F label="Inspection Type">
                  <select className={S} value={form.safety_inspection_type} onChange={e => set('safety_inspection_type', e.target.value)}>
                    <option value="">Unknown</option>
                    <option value="dvsa-categorised">DVSA Categorised (A/B/C)</option>
                    <option value="manufacturer">Manufacturer schedule</option>
                    <option value="combined">Combined</option>
                  </select>
                </F>
                <F label="Last Safety Inspection (PMI)">
                  <input className={I} type="date" value={form.last_safety_inspection} onChange={e => set('last_safety_inspection', e.target.value)} />
                </F>
                <F label="Next Safety Inspection Due">
                  <div>
                    <input className={I} type="date" value={form.next_safety_inspection} onChange={e => set('next_safety_inspection', e.target.value)} />
                    {form.next_safety_inspection && <div className={`text-2xs mt-0.5 font-semibold ${ec(form.next_safety_inspection)}`}>{el(form.next_safety_inspection)}</div>}
                  </div>
                </F>
                <F label="MOT Expiry" note="Cars & vans under 3.5t">
                  <div>
                    <input className={I} type="date" value={form.mot_expiry} onChange={e => set('mot_expiry', e.target.value)} />
                    {form.mot_expiry && <div className={`text-2xs mt-0.5 font-semibold ${ec(form.mot_expiry)}`}>{el(form.mot_expiry)}</div>}
                  </div>
                </F>
                <F label="DVSA Annual Test Due" note="HGV / PSV annual test — different from car MOT">
                  <div>
                    <input className={I} type="date" value={form.annual_test_due} onChange={e => set('annual_test_due', e.target.value)} />
                    {form.annual_test_due && <div className={`text-2xs mt-0.5 font-semibold ${ec(form.annual_test_due)}`}>{el(form.annual_test_due)}</div>}
                  </div>
                </F>
                <F label="Last DVSA Annual Test Passed">
                  <input className={I} type="date" value={form.annual_test_last} onChange={e => set('annual_test_last', e.target.value)} />
                </F>
                <F label="Vehicle Check / Daily Walk-Round Due">
                  <div>
                    <input className={I} type="date" value={form.vehicle_check_due} onChange={e => set('vehicle_check_due', e.target.value)} />
                    {form.vehicle_check_due && <div className={`text-2xs mt-0.5 font-semibold ${ec(form.vehicle_check_due)}`}>{el(form.vehicle_check_due)}</div>}
                  </div>
                </F>
                <F label="Last Roller Brake Test Date" note="DVSA / MSVA roller brake test">
                  <input className={I} type="date" value={form.brake_test_date} onChange={e => set('brake_test_date', e.target.value)} />
                </F>
                <F label="Brake Test Result" note="Pass / Fail — or efficiency %">
                  <select className={S} value={form.brake_test_result} onChange={e => set('brake_test_result', e.target.value)}>
                    <option value="">Not recorded</option>
                    <option value="pass">Pass</option>
                    <option value="fail">Fail</option>
                    <option value="advisory">Advisory issued</option>
                  </select>
                </F>
                <F label="Brake Efficiency — Front" sub="% (min 50% service brake)">
                  <input className={I} type="number" value={form.brake_efficiency_front} onChange={e => set('brake_efficiency_front', e.target.value)} placeholder="65" min="0" max="100" />
                </F>
                <F label="Brake Efficiency — Rear" sub="% (min 25% secondary)">
                  <input className={I} type="number" value={form.brake_efficiency_rear} onChange={e => set('brake_efficiency_rear', e.target.value)} placeholder="45" min="0" max="100" />
                </F>
              </div>

              {/* Compliance summary */}
              {allExpiries.length > 0 && (
                <div className="mt-3 p-3 rounded-xl bg-slate-900/50 border border-slate-800/40">
                  <div className="text-2xs font-semibold text-slate-600 uppercase tracking-wider mb-2">All Expiry Dates</div>
                  {allExpiries.map(r => <ExpiryRow key={r.l} label={r.l} date={r.d} />)}
                </div>
              )}
            </>
          )}

          {/* ══════════════ 12. TELEMATICS & ADAS ══════════════ */}
          {section === 'telematics' && (
            <>
              <SH icon="Wifi" title="Telematics & ADAS" sub="Vehicle tracking, DVS camera compliance, safety assist systems" />
              <InfoBox color="cyan" icon="Info">
                From 2024, HGVs operating in Greater London require compliance with the Direct Vision Standard (DVS) — CCTV, side-scan sensors and blind spot mirrors are mandatory for permit holders.
              </InfoBox>
              <div className="grid grid-cols-2 gap-3">
                <F label="Telematics Unit Fitted">
                  <Toggle value={form.telematics_fitted} onChange={v => set('telematics_fitted', v)} labelOn="Yes" labelOff="No" />
                </F>
                {form.telematics_fitted && <>
                  <F label="Telematics Provider">
                    <input className={I} value={form.telematics_provider} onChange={e => set('telematics_provider', e.target.value)} placeholder="Microlise / Webfleet / Samsara" />
                  </F>
                  <F label="Unit Serial Number">
                    <input className={I} value={form.telematics_serial} onChange={e => set('telematics_serial', e.target.value)} placeholder="Unit serial" />
                  </F>
                  <F label="Unit IMEI">
                    <input className={I} value={form.telematics_imei} onChange={e => set('telematics_imei', e.target.value)} placeholder="15-digit IMEI" maxLength={15} />
                  </F>
                </>}
              </div>
              <div className="mt-2 p-4 rounded-xl border border-slate-800/40 bg-slate-900/20 space-y-3">
                <div className="flex items-center gap-2"><Icon name="Camera" size={13} className="text-cyan-400" /><span className="text-xs font-semibold text-slate-300">CCTV & DVS Compliance</span></div>
                <div className="grid grid-cols-2 gap-3">
                  <F label="CCTV System Fitted" note="Required for DVS permit in London">
                    <Toggle value={form.cctv_fitted} onChange={v => set('cctv_fitted', v)} labelOn="Yes" labelOff="No" />
                  </F>
                  {form.cctv_fitted && <F label="CCTV System / Brand">
                    <input className={I} value={form.cctv_system} onChange={e => set('cctv_system', e.target.value)} placeholder="Brigade / Safety Vision / Seeing Machines" />
                  </F>}
                  <F label="DVS Side-Scan Sensor Fitted" note="Direct Vision Standard — Class 6/7 HGV">
                    <Toggle value={form.dvs_side_scan} onChange={v => set('dvs_side_scan', v)} labelOn="Yes" labelOff="No" />
                  </F>
                  <F label="Blind Spot Sensor / Mirror Fitted">
                    <Toggle value={form.dvs_blind_spot} onChange={v => set('dvs_blind_spot', v)} labelOn="Yes" labelOff="No" />
                  </F>
                </div>
              </div>
              <div className="mt-2 p-4 rounded-xl border border-slate-800/40 bg-slate-900/20 space-y-3">
                <div className="flex items-center gap-2"><Icon name="Zap" size={13} className="text-blue-400" /><span className="text-xs font-semibold text-slate-300">Advanced Driver Assistance (ADAS)</span></div>
                <div className="grid grid-cols-2 gap-3">
                  <F label="AEBS Fitted" note="Advanced Emergency Braking System — mandatory for new N2/N3">
                    <Toggle value={form.aebs_fitted} onChange={v => set('aebs_fitted', v)} labelOn="Yes" labelOff="No" />
                  </F>
                  <F label="Lane Departure Warning (LDW)">
                    <Toggle value={form.ldw_fitted} onChange={v => set('ldw_fitted', v)} labelOn="Yes" labelOff="No" />
                  </F>
                </div>
              </div>
            </>
          )}

          {/* ══════════════ 13. MAINTENANCE ══════════════ */}
          {section === 'maintenance' && (
            <>
              <SH icon="Wrench" title="Maintenance Records" sub="Service history and upcoming scheduled work" />
              <div className="grid grid-cols-2 gap-3">
                <F label="Last Service Date">
                  <input className={I} type="date" value={form.last_service_date} onChange={e => set('last_service_date', e.target.value)} />
                </F>
                <F label="Last Service Odometer" sub="km">
                  <input className={I} type="number" value={form.last_service_km} onChange={e => set('last_service_km', e.target.value)} placeholder="0" min="0" />
                </F>
                <F label="Next Service Due Date">
                  <div>
                    <input className={I} type="date" value={form.next_service_date} onChange={e => set('next_service_date', e.target.value)} />
                    {form.next_service_date && <div className={`text-2xs mt-0.5 font-semibold ${ec(form.next_service_date)}`}>{el(form.next_service_date)}</div>}
                  </div>
                </F>
                <F label="Next Service Odometer" sub="km">
                  <input className={I} type="number" value={form.next_service_km} onChange={e => set('next_service_km', e.target.value)} placeholder="0" min="0" />
                </F>
              </div>
              <div className="space-y-1.5 mt-2">
                <label className="text-xs text-slate-400 font-medium">Notes / Known Defects</label>
                <textarea className={`${I} resize-none`} rows={4} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Known defects, repairs needed, operator notes…" />
              </div>
            </>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 bg-red-500/5 border border-red-500/20 rounded-lg px-3 py-2">
              <Icon name="AlertCircle" size={13} className="text-red-400 flex-shrink-0" />
              <span className="text-red-400 text-xs">{error}</span>
            </div>
          )}
        </div>

        {/* ── Footer ─────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 py-3.5 border-t border-slate-800/50 flex-shrink-0 gap-3">
          {/* Dot nav */}
          <div className="flex items-center gap-1 flex-wrap">
            {SECTIONS.map(s => (
              <button key={s.key} onClick={() => setSection(s.key)} title={s.label}
                className={`rounded-full transition-all ${s.key === section ? 'w-4 h-2 bg-cyan-400' : 'w-2 h-2 bg-slate-800 hover:bg-slate-600'}`} />
            ))}
          </div>
          {/* Prev / Next + Save */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {secIdx > 0 && (
              <button onClick={() => setSection(SECTIONS[secIdx - 1].key)}
                className="px-2.5 py-1.5 rounded-lg text-xs text-slate-500 hover:text-white hover:bg-slate-800 transition-colors flex items-center gap-1">
                <Icon name="ChevronLeft" size={11} /> Prev
              </button>
            )}
            {secIdx < SECTIONS.length - 1 && (
              <button onClick={() => setSection(SECTIONS[secIdx + 1].key)}
                className="px-2.5 py-1.5 rounded-lg text-xs text-slate-500 hover:text-white hover:bg-slate-800 transition-colors flex items-center gap-1">
                Next <Icon name="ChevronRight" size={11} />
              </button>
            )}
            <button onClick={onClose}
              className="px-3.5 py-2 rounded-lg text-xs text-slate-500 hover:text-white hover:bg-slate-800 transition-colors">
              Cancel
            </button>
            <button onClick={handleSave} disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-black text-xs font-bold transition-colors disabled:opacity-40">
              <Icon name={saving ? 'Loader2' : 'Check'} size={12} className={saving ? 'animate-spin' : ''} />
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Vehicle'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
