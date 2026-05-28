/**
 * ============================================================
 * APEX AI — Analytics Dashboard
 * 100% real data — no mock, no seed generators, no fake numbers.
 * Sources:
 *   - Vehicles:      localDB / apex:db:vehicles (via fleetService)
 *   - Drivers:       localDB / apex:db:drivers  (via driverService)
 *   - Telemetry:     localDB / apex:db:telemetry + apex:telemetry BroadcastChannel
 *   - AI Reports:    localDB / apex:db:driver_ai_reports (pushAIReportToFleet)
 *   - Safety Alerts: localDB / apex:db:safety_alerts (safetyService)
 *   - Jobs:          localDB / apex:db:jobs (dispatchService)
 *   - Compliance:    localDB / apex:db:compliance (complianceService)
 * ============================================================
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  AreaChart, Area,
  BarChart, Bar,
  LineChart, Line,
  PieChart, Pie, Cell,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ReferenceLine
} from 'recharts'
import Icon from './components_ui_Icon'
import Badge from './components_ui_Badge'
import { useFleetStore, useDriverStore } from './core_storage'
import { fleetService }      from './services_fleet_fleetService'
import { driverService }     from './services_drivers_driverService'
import { safetyService }     from './services_safety_safetyService'
import { dispatchService }   from './services_dispatch_dispatchService'
import { complianceService } from './services_compliance_complianceService'
import { table }             from './services_local_localDB'
import {
  getDriverAIReportHistory,
  listenForDriverAIReports,
  listenForDriverTelemetry,
} from './services_sync_driverSyncService'

// ─── Palette ──────────────────────────────────────────────────
const C = {
  cyan:    '#00d4ff',
  violet:  '#8b5cf6',
  emerald: '#10b981',
  amber:   '#f59e0b',
  red:     '#ef4444',
  slate:   '#475569',
  blue:    '#3b82f6',
}

// ─── Local tables (direct reads — no service layer needed) ────
const telemetryTable  = table('apex:db:telemetry')
const aiReportTable   = table('apex:db:driver_ai_reports')
// Note: driver_ai_reports also has its own key used by driverSyncService
const AI_REPORT_KEY   = 'apex:db:driver_ai_reports'

// ─── Date helpers ─────────────────────────────────────────────
function daysBucket(isoTs) {
  const d = new Date(isoTs)
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}
function daysAgo(n) {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - n)
  return d
}
function withinDays(isoTs, days) {
  try { return new Date(isoTs) >= daysAgo(days) } catch { return false }
}

// ─── Build daily time-series from real telemetry rows ─────────
function buildTimeSeries(telemetryRows, safetyAlerts, period) {
  const buckets = {}
  const cutoff  = daysAgo(period)

  // Initialise every day in range
  for (let i = 0; i < period; i++) {
    const d = new Date()
    d.setDate(d.getDate() - (period - 1 - i))
    const label = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
    buckets[label] = {
      date: label,
      trips: 0,
      distance: 0,
      speed_samples: [],
      utilisation_vehicles: new Set(),
      total_vehicles: 0,
      incidents: 0,
    }
  }

  // Aggregate telemetry into buckets
  telemetryRows.forEach(row => {
    const ts = row.ts || row.created_at
    if (!ts || new Date(ts) < cutoff) return
    const label = daysBucket(ts)
    if (!buckets[label]) return
    const b = buckets[label]
    b.distance += (row.trip_dist_m || 0) / 1000   // metres → km
    if (row.speed > 0) b.speed_samples.push(row.speed)
    if (row.vehicle_id) b.utilisation_vehicles.add(row.vehicle_id)
  })

  // Count trips: a "trip" = first telemetry per driver per day with distance > 0
  const tripSeen = {}
  telemetryRows.forEach(row => {
    const ts = row.ts || row.created_at
    if (!ts || new Date(ts) < cutoff) return
    const label = daysBucket(ts)
    if (!buckets[label]) return
    const key = `${label}:${row.driver_id}`
    if (!tripSeen[key] && (row.trip_dist_m || 0) > 100) {
      tripSeen[key] = true
      buckets[label].trips++
    }
  })

  // Count incidents per day from safety alerts
  safetyAlerts.forEach(a => {
    const ts = a.created_at || a.ts
    if (!ts || new Date(ts) < cutoff) return
    const label = daysBucket(ts)
    if (buckets[label]) buckets[label].incidents++
  })

  // Compute vehicle count (for utilisation denominator)
  const totalVehs = new Set(telemetryRows.map(r => r.vehicle_id).filter(Boolean)).size || 1

  return Object.values(buckets).map(b => ({
    date:        b.date,
    trips:       b.trips,
    distance:    Math.round(b.distance),
    incidents:   b.incidents,
    avg_speed:   b.speed_samples.length
                   ? Math.round(b.speed_samples.reduce((s, v) => s + v, 0) / b.speed_samples.length)
                   : 0,
    utilisation: totalVehs > 0
                   ? Math.round((b.utilisation_vehicles.size / totalVehs) * 100)
                   : 0,
  }))
}

// ─── Shared tooltip ───────────────────────────────────────────
function ApexTooltip({ active, payload, label, formatter }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-[#0a0f1e] border border-slate-700/60 rounded-xl p-3 shadow-2xl min-w-[140px]">
      <div className="text-2xs text-slate-500 mb-2 font-medium">{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center justify-between gap-4 text-xs">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full" style={{ background: p.color }} />
            <span className="text-slate-400 capitalize">{p.name}</span>
          </div>
          <span className="font-mono font-bold text-white">
            {formatter ? formatter(p.value, p.name) : p.value}
          </span>
        </div>
      ))}
    </div>
  )
}

// ─── KPI Card ─────────────────────────────────────────────────
function KpiCard({ label, value, unit, sub, icon, color, sparkData, sparkKey, sparkColor }) {
  const sc = sparkColor || C.cyan
  return (
    <div className="bg-[#0d1426] border border-slate-800/60 rounded-xl p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-2xs text-slate-500 font-semibold tracking-widest uppercase">{label}</span>
        <div className="w-8 h-8 rounded-lg bg-slate-900/60 border border-slate-800/60 flex items-center justify-center">
          <Icon name={icon} size={14} className={color} />
        </div>
      </div>
      <div className="flex items-end justify-between gap-2">
        <div>
          <div className="flex items-baseline gap-1.5">
            <span className={`font-mono text-2xl font-bold ${color}`}>{value ?? '—'}</span>
            {unit && <span className="text-slate-600 text-xs">{unit}</span>}
          </div>
          {sub !== undefined && (
            <div className="text-2xs text-slate-600 mt-1">{sub}</div>
          )}
        </div>
        {sparkData?.length > 1 && sparkKey && (
          <div className="w-20 h-10 flex-shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={sparkData.slice(-10)} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id={`sp-${sparkKey}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={sc} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={sc} stopOpacity={0}   />
                  </linearGradient>
                </defs>
                <Area type="monotone" dataKey={sparkKey}
                  stroke={sc} strokeWidth={1.5} fill={`url(#sp-${sparkKey})`} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Chart Card ───────────────────────────────────────────────
function ChartCard({ title, subtitle, action, children, className = '' }) {
  return (
    <div className={`bg-[#0d1426] border border-slate-800/60 rounded-xl p-5 flex flex-col ${className}`}>
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-white">{title}</h3>
          {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  )
}

// ─── Empty state ──────────────────────────────────────────────
function EmptyState({ icon = 'Database', message = 'No data yet', sub }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-2 text-slate-700">
      <Icon name={icon} size={32} className="opacity-20" />
      <p className="text-xs text-slate-600">{message}</p>
      {sub && <p className="text-2xs text-slate-700 text-center max-w-xs">{sub}</p>}
    </div>
  )
}

// ─── Period selector ──────────────────────────────────────────
const PERIODS = [
  { key: 7,  label: '7D'  },
  { key: 14, label: '14D' },
  { key: 30, label: '30D' },
  { key: 90, label: '90D' },
]

// ─── Tab nav ──────────────────────────────────────────────────
const TABS = [
  { key: 'overview',  label: 'Overview',  icon: 'LayoutDashboard' },
  { key: 'fleet',     label: 'Fleet',     icon: 'Truck'           },
  { key: 'drivers',   label: 'Drivers',   icon: 'Users'           },
  { key: 'safety',    label: 'Safety',    icon: 'ShieldCheck'     },
  { key: 'ai',        label: 'AI Reports',icon: 'Cpu'             },
]

// ═══════════════════════════════════════════════════════════════
//  OVERVIEW TAB
// ═══════════════════════════════════════════════════════════════
function OverviewTab({ timeSeries, period, vehicles, drivers, aiReports, alerts }) {
  const totals = useMemo(() => timeSeries.reduce((a, d) => ({
    trips:     a.trips     + d.trips,
    distance:  a.distance  + d.distance,
    incidents: a.incidents + d.incidents,
  }), { trips: 0, distance: 0, incidents: 0 }), [timeSeries])

  const avgSpeed = useMemo(() => {
    const rows = timeSeries.filter(d => d.avg_speed > 0)
    return rows.length ? Math.round(rows.reduce((s, d) => s + d.avg_speed, 0) / rows.length) : 0
  }, [timeSeries])

  const avgUtil = useMemo(() => {
    const rows = timeSeries.filter(d => d.utilisation > 0)
    return rows.length ? Math.round(rows.reduce((s, d) => s + d.utilisation, 0) / rows.length) : 0
  }, [timeSeries])

  // Fleet status pie — from real vehicle records
  const fleetPie = useMemo(() => {
    if (!vehicles.length) return []
    const c = { active: 0, idle: 0, maintenance: 0, offline: 0 }
    vehicles.forEach(v => { if (c[v.status] !== undefined) c[v.status]++ })
    return Object.entries(c).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value }))
  }, [vehicles])

  const PIE_COLORS = {
    active: C.cyan, idle: C.amber, maintenance: C.violet, offline: C.slate,
  }

  const hasData = timeSeries.some(d => d.trips > 0 || d.distance > 0)

  return (
    <div className="space-y-5">
      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4">
        <KpiCard label="Fleet Size"   value={vehicles.length}        icon="Truck"       color="text-cyan-400"    sparkData={timeSeries} sparkKey="utilisation" sparkColor={C.cyan}    sub={`${drivers.length} drivers`} />
        <KpiCard label="Total Trips"  value={totals.trips}           icon="Route"       color="text-violet-400"  sparkData={timeSeries} sparkKey="trips"       sparkColor={C.violet}  sub={`${period}-day period`} />
        <KpiCard label="Distance"     value={`${(totals.distance / 1000).toFixed(1)}K`} unit="km" icon="Gauge"  color="text-emerald-400" sparkData={timeSeries} sparkKey="distance"   sparkColor={C.emerald} />
        <KpiCard label="Incidents"    value={totals.incidents}       icon="AlertTriangle" color={totals.incidents > 5 ? 'text-red-400' : 'text-amber-400'} sparkData={timeSeries} sparkKey="incidents" sparkColor={C.red} />
        <KpiCard label="Avg Speed"    value={avgSpeed}     unit="km/h" icon="Zap"       color="text-blue-400"    sparkData={timeSeries} sparkKey="avg_speed"   sparkColor={C.blue}    sub="when active" />
        <KpiCard label="Utilisation"  value={`${avgUtil}%`}          icon="Activity"    color="text-cyan-400"    sparkData={timeSeries} sparkKey="utilisation" sparkColor={C.cyan}    sub="avg fleet" />
      </div>

      {/* Daily activity + fleet pie */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2">
          <ChartCard title="Daily Activity" subtitle={`Trips & distance · last ${period} days`}>
            {!hasData
              ? <EmptyState icon="Route" message="No trip data yet" sub="Data appears here once drivers start using the AP3X app and GPS is active" />
              : <ResponsiveContainer width="100%" height={210}>
                  <AreaChart data={timeSeries} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                    <defs>
                      <linearGradient id="gTrips" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor={C.cyan}   stopOpacity={0.22} />
                        <stop offset="95%" stopColor={C.cyan}   stopOpacity={0}    />
                      </linearGradient>
                      <linearGradient id="gDist" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor={C.violet} stopOpacity={0.18} />
                        <stop offset="95%" stopColor={C.violet} stopOpacity={0}    />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" />
                    <XAxis dataKey="date" tick={{ fill: '#475569', fontSize: 9 }} tickLine={false} axisLine={false}
                      interval={Math.max(0, Math.floor(period / 7) - 1)} />
                    <YAxis yAxisId="left"  tick={{ fill: '#475569', fontSize: 10 }} tickLine={false} axisLine={false} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fill: '#475569', fontSize: 10 }} tickLine={false} axisLine={false} />
                    <Tooltip content={<ApexTooltip />} />
                    <Area yAxisId="left"  type="monotone" dataKey="trips"    name="trips"    stroke={C.cyan}   strokeWidth={2} fill="url(#gTrips)" dot={false} activeDot={{ r: 4 }} />
                    <Area yAxisId="right" type="monotone" dataKey="distance" name="dist km"  stroke={C.violet} strokeWidth={2} fill="url(#gDist)"  dot={false} activeDot={{ r: 4 }} />
                  </AreaChart>
                </ResponsiveContainer>
            }
          </ChartCard>
        </div>

        <ChartCard title="Fleet Status" subtitle="Live vehicle breakdown">
          {fleetPie.length === 0
            ? <EmptyState icon="Truck" message="No vehicles" sub="Add vehicles to see fleet status" />
            : <>
                <ResponsiveContainer width="100%" height={160}>
                  <PieChart>
                    <Pie data={fleetPie} cx="50%" cy="50%" innerRadius={46} outerRadius={72}
                      paddingAngle={3} dataKey="value" strokeWidth={0}>
                      {fleetPie.map((e, i) => (
                        <Cell key={i} fill={PIE_COLORS[e.name] || C.slate} />
                      ))}
                    </Pie>
                    <Tooltip content={<ApexTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 mt-2">
                  {fleetPie.map(e => (
                    <div key={e.name} className="flex items-center gap-1.5 text-2xs">
                      <div className="w-2 h-2 rounded-full" style={{ background: PIE_COLORS[e.name] || C.slate }} />
                      <span className="text-slate-500 capitalize">{e.name}</span>
                      <span className="font-mono text-white ml-auto">{e.value}</span>
                    </div>
                  ))}
                </div>
              </>
          }
        </ChartCard>
      </div>

      {/* Utilisation + incidents */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <ChartCard title="Fleet Utilisation" subtitle={`Daily % · ${period} days`}>
          {!hasData
            ? <EmptyState icon="Activity" message="No telemetry data" sub="Appears once AP3X driver app is active" />
            : <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={timeSeries} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                  <defs>
                    <linearGradient id="gUtil" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={C.blue} stopOpacity={0.2} />
                      <stop offset="95%" stopColor={C.blue} stopOpacity={0}   />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" />
                  <XAxis dataKey="date" tick={{ fill: '#475569', fontSize: 9 }} tickLine={false} axisLine={false}
                    interval={Math.max(0, Math.floor(period / 7) - 1)} />
                  <YAxis domain={[0, 100]} tick={{ fill: '#475569', fontSize: 10 }} tickLine={false} axisLine={false} />
                  <Tooltip content={<ApexTooltip formatter={v => `${v}%`} />} />
                  <ReferenceLine y={80} stroke={C.emerald} strokeDasharray="6 3" strokeOpacity={0.35} />
                  <Area type="monotone" dataKey="utilisation" stroke={C.blue} strokeWidth={2} fill="url(#gUtil)" dot={false} activeDot={{ r: 4 }} />
                </AreaChart>
              </ResponsiveContainer>
          }
        </ChartCard>

        <ChartCard title="Daily Incidents" subtitle={`Safety alerts triggered · ${period} days`}>
          {!timeSeries.some(d => d.incidents > 0)
            ? <EmptyState icon="ShieldCheck" message="No incidents recorded" sub="All clear! Incidents appear here when safety thresholds are breached" />
            : <ResponsiveContainer width="100%" height={180}>
                <BarChart data={timeSeries} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" />
                  <XAxis dataKey="date" tick={{ fill: '#475569', fontSize: 9 }} tickLine={false} axisLine={false}
                    interval={Math.max(0, Math.floor(period / 7) - 1)} />
                  <YAxis tick={{ fill: '#475569', fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip content={<ApexTooltip />} />
                  <Bar dataKey="incidents" fill={C.red} radius={[2,2,0,0]} opacity={0.85} />
                </BarChart>
              </ResponsiveContainer>
          }
        </ChartCard>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
//  FLEET TAB
// ═══════════════════════════════════════════════════════════════
function FleetTab({ timeSeries, period, vehicles }) {
  return (
    <div className="space-y-5">
      {/* Vehicle status table */}
      <ChartCard title="Vehicle Status Summary" subtitle="Current fleet state — live from database">
        {vehicles.length === 0
          ? <EmptyState icon="Truck" message="No vehicles in database" sub="Add vehicles via the Fleet page to see them here" />
          : <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-800/60">
                    {['Registration','Driver','Status','Fuel','Odometer','Last Service'].map(h => (
                      <th key={h} className="text-left text-2xs text-slate-600 tracking-wider uppercase pb-2 pr-4 font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/30">
                  {vehicles.map(v => (
                    <tr key={v.id} className="hover:bg-slate-800/20 transition-colors">
                      <td className="py-2 pr-4 font-mono font-bold text-white">{v.reg_number || v.registration || '—'}</td>
                      <td className="py-2 pr-4 text-slate-400">{v.driver_name || <span className="text-slate-700">—</span>}</td>
                      <td className="py-2 pr-4">
                        <span className={`px-2 py-0.5 rounded text-2xs font-semibold capitalize ${
                          v.status === 'active'      ? 'bg-cyan-500/10 text-cyan-400'    :
                          v.status === 'idle'        ? 'bg-amber-500/10 text-amber-400'  :
                          v.status === 'maintenance' ? 'bg-violet-500/10 text-violet-400':
                          'bg-slate-800 text-slate-500'
                        }`}>{v.status || 'unknown'}</span>
                      </td>
                      <td className="py-2 pr-4">
                        {v.fuel_level != null
                          ? <div className="flex items-center gap-2">
                              <div className="w-16 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                                <div className={`h-full rounded-full ${v.fuel_level > 40 ? 'bg-emerald-500' : v.fuel_level > 20 ? 'bg-amber-500' : 'bg-red-500'}`}
                                  style={{ width: `${v.fuel_level}%` }} />
                              </div>
                              <span className="font-mono text-slate-400">{v.fuel_level}%</span>
                            </div>
                          : <span className="text-slate-700">—</span>}
                      </td>
                      <td className="py-2 pr-4 font-mono text-slate-400">{v.odometer_km ? `${Number(v.odometer_km).toLocaleString()} km` : '—'}</td>
                      <td className="py-2 text-slate-500">{v.last_service || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
        }
      </ChartCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <ChartCard title="Fleet Utilisation Trend" subtitle={`${period} days vs 80% target`}>
          {!timeSeries.some(d => d.utilisation > 0)
            ? <EmptyState icon="Activity" message="No utilisation data" sub="Appears once drivers start using AP3X app" />
            : <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={timeSeries.map(d => ({ ...d, target: 80 }))} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                  <defs>
                    <linearGradient id="gUtil2" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={C.blue} stopOpacity={0.2} />
                      <stop offset="95%" stopColor={C.blue} stopOpacity={0}   />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" />
                  <XAxis dataKey="date" tick={{ fill: '#475569', fontSize: 9 }} tickLine={false} axisLine={false}
                    interval={Math.max(0, Math.floor(period / 7) - 1)} />
                  <YAxis domain={[0, 100]} tick={{ fill: '#475569', fontSize: 10 }} tickLine={false} axisLine={false} />
                  <Tooltip content={<ApexTooltip formatter={v => `${v}%`} />} />
                  <ReferenceLine y={80} stroke={C.emerald} strokeDasharray="6 3" strokeOpacity={0.4} label={{ value: '80% target', fill: '#10b981', fontSize: 9, position: 'insideTopRight' }} />
                  <Area type="monotone" dataKey="utilisation" stroke={C.blue} strokeWidth={2} fill="url(#gUtil2)" dot={false} activeDot={{ r: 4 }} />
                </AreaChart>
              </ResponsiveContainer>
          }
        </ChartCard>

        <ChartCard title="Average Speed Trend" subtitle={`Active hours avg speed · ${period} days`}>
          {!timeSeries.some(d => d.avg_speed > 0)
            ? <EmptyState icon="Gauge" message="No speed data" sub="Speed data flows in from the AP3X driver app GPS" />
            : <ResponsiveContainer width="100%" height={200}>
                <LineChart data={timeSeries} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" />
                  <XAxis dataKey="date" tick={{ fill: '#475569', fontSize: 9 }} tickLine={false} axisLine={false}
                    interval={Math.max(0, Math.floor(period / 7) - 1)} />
                  <YAxis tick={{ fill: '#475569', fontSize: 10 }} tickLine={false} axisLine={false} />
                  <Tooltip content={<ApexTooltip formatter={v => `${v} km/h`} />} />
                  <ReferenceLine y={90} stroke={C.red} strokeDasharray="4 2" strokeOpacity={0.4} />
                  <Line type="monotone" dataKey="avg_speed" name="avg speed" stroke={C.emerald} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
          }
        </ChartCard>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
//  DRIVERS TAB
// ═══════════════════════════════════════════════════════════════
function DriversTab({ drivers, aiReports, telemetryRows, period }) {
  // Build per-driver stats from telemetry
  const driverStats = useMemo(() => {
    const cutoff = daysAgo(period)
    const stats  = {}

    telemetryRows.forEach(row => {
      const ts = row.ts || row.created_at
      if (!ts || new Date(ts) < cutoff) return
      const id = row.driver_id
      if (!id) return
      if (!stats[id]) stats[id] = { driver_id: id, driver_name: row.driver_name, vehicle_reg: row.vehicle_reg, trips: 0, distance: 0, speeds: [], seen: new Set() }
      const s = stats[id]
      const dayKey = daysBucket(ts)
      if (!s.seen.has(dayKey) && (row.trip_dist_m || 0) > 100) { s.trips++; s.seen.add(dayKey) }
      s.distance += (row.trip_dist_m || 0) / 1000
      if (row.speed > 0) s.speeds.push(row.speed)
    })

    return stats
  }, [telemetryRows, period])

  // Build per-driver fatigue from AI reports
  const driverFatigue = useMemo(() => {
    let raw = []
    try { raw = JSON.parse(localStorage.getItem(AI_REPORT_KEY) || '[]') } catch {}
    const cutoff = daysAgo(period)
    const map = {}
    raw.forEach(r => {
      if (new Date(r.ts) < cutoff) return
      if (r.fatigueScore == null) return
      if (!map[r.driverId]) map[r.driverId] = []
      map[r.driverId].push(r.fatigueScore)
    })
    const result = {}
    Object.entries(map).forEach(([id, scores]) => {
      result[id] = Math.round(scores.reduce((s, v) => s + v, 0) / scores.length)
    })
    return result
  }, [period])

  const scoreColor = (s) =>
    s >= 90 ? C.emerald : s >= 75 ? C.cyan : s >= 60 ? C.amber : C.red

  // Merge drivers with their computed stats
  const enriched = useMemo(() => {
    const list = drivers.map(d => {
      const st = driverStats[d.id] || {}
      return {
        ...d,
        trips:      st.trips    || 0,
        distance:   Math.round(st.distance || 0),
        avg_speed:  st.speeds?.length ? Math.round(st.speeds.reduce((s, v) => s + v, 0) / st.speeds.length) : null,
        avg_fatigue: driverFatigue[d.id] ?? null,
      }
    }).sort((a, b) => (b.safety_score || 0) - (a.safety_score || 0))

    // Also include drivers seen in telemetry but not in fleet driver list
    const extra = []
    Object.values(driverStats).forEach(st => {
      if (!drivers.find(d => d.id === st.driver_id)) {
        extra.push({
          id:          st.driver_id,
          full_name:   st.driver_name || st.driver_id,
          vehicle_reg: st.vehicle_reg,
          safety_score: null,
          status:      'active',
          trips:        st.trips,
          distance:     Math.round(st.distance),
          avg_speed:    st.speeds?.length ? Math.round(st.speeds.reduce((s, v) => s + v, 0) / st.speeds.length) : null,
          avg_fatigue:  driverFatigue[st.driver_id] ?? null,
        })
      }
    })

    return [...list, ...extra]
  }, [drivers, driverStats, driverFatigue])

  if (enriched.length === 0) {
    return <EmptyState icon="Users" message="No driver data yet" sub="Drivers appear here once added to the fleet or once they log into the AP3X Driver app" />
  }

  return (
    <div className="space-y-5">
      <ChartCard title="Driver Performance" subtitle={`Real data · last ${period} days`}>
        <div className="space-y-3">
          {enriched.map((d, i) => {
            const score = d.safety_score ?? 0
            return (
              <div key={d.id} className="flex items-center gap-3 p-3 rounded-lg border border-slate-800/40 bg-slate-900/20 hover:bg-slate-800/20 transition-colors">
                {/* Rank */}
                <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold ${
                  i === 0 ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' :
                  i === 1 ? 'bg-slate-500/20 text-slate-300 border border-slate-500/30' :
                  i === 2 ? 'bg-orange-600/20 text-orange-400 border border-orange-600/30' :
                  'bg-slate-900 text-slate-600 border border-slate-800'
                }`}>
                  {i + 1}
                </div>

                {/* Name + score bar */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-semibold text-white truncate">{d.full_name}</span>
                    {d.safety_score != null
                      ? <span className="font-mono text-sm font-bold ml-2 flex-shrink-0" style={{ color: scoreColor(score) }}>{score}</span>
                      : <span className="text-slate-700 text-xs ml-2 flex-shrink-0">no score</span>
                    }
                  </div>
                  {d.safety_score != null && (
                    <div className="h-1.5 bg-slate-800/80 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${score}%`, background: scoreColor(score) }} />
                    </div>
                  )}
                </div>

                {/* Stats pills */}
                <div className="hidden sm:flex items-center gap-2 flex-shrink-0 text-2xs">
                  {d.trips > 0 && (
                    <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-mono">
                      {d.trips} trips
                    </span>
                  )}
                  {d.distance > 0 && (
                    <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-mono">
                      {d.distance} km
                    </span>
                  )}
                  {d.avg_fatigue != null && (
                    <span className={`px-1.5 py-0.5 rounded font-mono ${
                      d.avg_fatigue >= 75 ? 'bg-red-500/10 text-red-400' :
                      d.avg_fatigue >= 45 ? 'bg-amber-500/10 text-amber-400' :
                      'bg-emerald-500/10 text-emerald-400'
                    }`}>
                      fatigue {d.avg_fatigue}%
                    </span>
                  )}
                </div>

                {/* Status */}
                <span className={`text-2xs px-2 py-0.5 rounded font-medium capitalize flex-shrink-0 ${
                  d.status === 'active'   ? 'bg-cyan-500/10 text-cyan-400' :
                  d.status === 'off_duty' ? 'bg-slate-800 text-slate-500'  :
                  'bg-amber-500/10 text-amber-400'
                }`}>{d.status?.replace('_', ' ') || '—'}</span>
              </div>
            )
          })}
        </div>
      </ChartCard>

      {/* Trip distance per driver bar chart */}
      {enriched.some(d => d.distance > 0) && (
        <ChartCard title="Distance by Driver" subtitle={`Total km · last ${period} days`}>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart
              data={enriched.filter(d => d.distance > 0).map(d => ({ name: d.full_name?.split(' ')[0] || d.id.slice(0,6), distance: d.distance }))}
              margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" />
              <XAxis dataKey="name" tick={{ fill: '#475569', fontSize: 9 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fill: '#475569', fontSize: 10 }} tickLine={false} axisLine={false} />
              <Tooltip content={<ApexTooltip formatter={v => `${v} km`} />} />
              <Bar dataKey="distance" fill={C.violet} radius={[3,3,0,0]} opacity={0.85} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
//  SAFETY TAB
// ═══════════════════════════════════════════════════════════════
function SafetyTab({ timeSeries, period, alerts }) {
  const recent = useMemo(() =>
    alerts.filter(a => withinDays(a.created_at || a.ts, period))
          .slice(0, 50)
  , [alerts, period])

  // Alert type breakdown
  const byType = useMemo(() => {
    const m = {}
    recent.forEach(a => { m[a.type] = (m[a.type] || 0) + 1 })
    return Object.entries(m)
      .sort((a, b) => b[1] - a[1])
      .map(([name, value], i) => ({
        name: name.replace(/_/g, ' '),
        value,
        color: [C.red, C.amber, C.violet, C.blue, C.cyan, C.emerald][i % 6],
      }))
  }, [recent])

  // Alert severity breakdown
  const bySeverity = useMemo(() => {
    const m = { critical: 0, high: 0, medium: 0, low: 0 }
    recent.forEach(a => { if (m[a.severity] !== undefined) m[a.severity]++ })
    return Object.entries(m).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value }))
  }, [recent])

  const SEV_COLORS = { critical: C.red, high: C.amber, medium: C.violet, low: C.slate }

  const resolvedPct = recent.length
    ? Math.round((recent.filter(a => a.resolved).length / recent.length) * 100)
    : 0

  return (
    <div className="space-y-5">
      {/* Summary KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <KpiCard label="Total Alerts"    value={recent.length}           icon="AlertTriangle"  color="text-red-400"     sub={`last ${period} days`} />
        <KpiCard label="Critical"        value={bySeverity.find(b => b.name === 'critical')?.value || 0} icon="ShieldOff" color="text-red-400" sub="severity" />
        <KpiCard label="Resolved"        value={`${resolvedPct}%`}       icon="CheckCircle2"   color="text-emerald-400" sub="resolution rate" />
        <KpiCard label="Open"            value={recent.filter(a => !a.resolved).length} icon="AlertCircle" color="text-amber-400" sub="unresolved" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Alert type breakdown */}
        <ChartCard title="Alert Types" subtitle={`Breakdown · last ${period} days`}>
          {byType.length === 0
            ? <EmptyState icon="ShieldCheck" message="No alerts in this period" />
            : <div className="space-y-2.5 mt-1">
                {byType.map(a => {
                  const pct = recent.length ? Math.round((a.value / recent.length) * 100) : 0
                  return (
                    <div key={a.name} className="flex items-center gap-3">
                      <span className="text-xs text-slate-400 w-32 flex-shrink-0 capitalize">{a.name}</span>
                      <div className="flex-1 h-2 bg-slate-800/60 rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: a.color }} />
                      </div>
                      <span className="font-mono text-xs text-slate-300 w-6 text-right">{a.value}</span>
                      <span className="text-2xs text-slate-600 w-8 text-right">{pct}%</span>
                    </div>
                  )
                })}
              </div>
          }
        </ChartCard>

        {/* Severity pie */}
        <ChartCard title="Alert Severity" subtitle="By severity level">
          {bySeverity.length === 0
            ? <EmptyState icon="Shield" message="No severity data" />
            : <>
                <ResponsiveContainer width="100%" height={150}>
                  <PieChart>
                    <Pie data={bySeverity} cx="50%" cy="50%" innerRadius={38} outerRadius={60}
                      paddingAngle={3} dataKey="value" strokeWidth={0}>
                      {bySeverity.map(e => <Cell key={e.name} fill={SEV_COLORS[e.name] || C.slate} />)}
                    </Pie>
                    <Tooltip content={<ApexTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-wrap gap-3 justify-center mt-1">
                  {bySeverity.map(e => (
                    <div key={e.name} className="flex items-center gap-1.5 text-2xs">
                      <div className="w-2 h-2 rounded-full" style={{ background: SEV_COLORS[e.name] || C.slate }} />
                      <span className="text-slate-500 capitalize">{e.name}</span>
                      <span className="text-white font-mono">{e.value}</span>
                    </div>
                  ))}
                </div>
              </>
          }
        </ChartCard>
      </div>

      {/* Recent alerts log */}
      <ChartCard title="Recent Safety Alerts" subtitle={`Last ${recent.length} alerts · ${period} days`}>
        {recent.length === 0
          ? <EmptyState icon="ShieldCheck" message="No alerts recorded" sub="Safety alerts from the AP3X driver app will appear here" />
          : <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-800/60">
                    {['Time','Driver','Vehicle','Type','Severity','Status'].map(h => (
                      <th key={h} className="text-left text-2xs text-slate-600 tracking-wider uppercase pb-2 pr-4 font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/30">
                  {recent.slice(0, 20).map(a => (
                    <tr key={a.id} className="hover:bg-slate-800/20 transition-colors">
                      <td className="py-2 pr-4 font-mono text-slate-500 text-2xs">
                        {new Date(a.created_at || a.ts).toLocaleString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })}
                      </td>
                      <td className="py-2 pr-4 text-slate-400">{a.driver_name || '—'}</td>
                      <td className="py-2 pr-4 font-mono text-slate-400">{a.vehicle_reg || '—'}</td>
                      <td className="py-2 pr-4 text-slate-300 capitalize">{(a.type || '—').replace(/_/g,' ')}</td>
                      <td className="py-2 pr-4">
                        <span className={`px-1.5 py-0.5 rounded text-2xs font-semibold capitalize ${
                          a.severity === 'critical' ? 'bg-red-500/15 text-red-400'       :
                          a.severity === 'high'     ? 'bg-amber-500/15 text-amber-400'   :
                          a.severity === 'medium'   ? 'bg-violet-500/15 text-violet-400' :
                          'bg-slate-800 text-slate-500'
                        }`}>{a.severity || '—'}</span>
                      </td>
                      <td className="py-2">
                        <span className={`px-1.5 py-0.5 rounded text-2xs font-semibold ${
                          a.resolved ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'
                        }`}>{a.resolved ? 'resolved' : 'open'}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
        }
      </ChartCard>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
//  AI REPORTS TAB  (new — fed entirely from driver app AI output)
// ═══════════════════════════════════════════════════════════════
function AIReportsTab({ aiReports, period }) {
  const recent = useMemo(() =>
    aiReports.filter(r => withinDays(r.ts, period)).slice(0, 100)
  , [aiReports, period])

  // Module breakdown
  const byModule = useMemo(() => {
    const m = {}
    recent.forEach(r => { const k = r.module || 'unknown'; m[k] = (m[k] || 0) + 1 })
    return Object.entries(m).sort((a, b) => b[1] - a[1])
      .map(([name, value], i) => ({ name, value, color: [C.cyan, C.violet, C.emerald, C.amber][i % 4] }))
  }, [recent])

  // Fatigue trend (from sentinel reports)
  const fatigueTrend = useMemo(() => {
    const buckets = {}
    recent.filter(r => r.fatigueScore != null).forEach(r => {
      const d = daysBucket(r.ts)
      if (!buckets[d]) buckets[d] = []
      buckets[d].push(r.fatigueScore)
    })
    return Object.entries(buckets).map(([date, scores]) => ({
      date,
      avg_fatigue: Math.round(scores.reduce((s, v) => s + v, 0) / scores.length),
    }))
  }, [recent])

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <KpiCard label="AI Reports"      value={recent.length}        icon="Cpu"        color="text-cyan-400"    sub={`last ${period} days`} />
        <KpiCard label="Sentinel"        value={recent.filter(r => r.module === 'sentinel').length}     icon="Shield"     color="text-violet-400" sub="safety AI" />
        <KpiCard label="RouteMind"       value={recent.filter(r => r.module === 'routemind').length}    icon="Navigation" color="text-emerald-400" sub="navigation AI" />
        <KpiCard label="Avg Fatigue"     value={recent.filter(r => r.fatigueScore != null).length
          ? Math.round(recent.filter(r => r.fatigueScore != null).reduce((s, r) => s + r.fatigueScore, 0) / recent.filter(r => r.fatigueScore != null).length)
          : '—'} icon="Eye" color="text-amber-400" sub="fleet avg %" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Module breakdown */}
        <ChartCard title="AI Module Usage" subtitle="Reports by module">
          {byModule.length === 0
            ? <EmptyState icon="Cpu" message="No AI reports yet" sub="AI reports appear here when drivers use Apex Sentinel or RouteMind in the driver app" />
            : <div className="space-y-2.5 mt-1">
                {byModule.map(m => {
                  const pct = recent.length ? Math.round((m.value / recent.length) * 100) : 0
                  return (
                    <div key={m.name} className="flex items-center gap-3">
                      <span className="text-xs text-slate-400 w-24 capitalize">{m.name}</span>
                      <div className="flex-1 h-2 bg-slate-800/60 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: m.color }} />
                      </div>
                      <span className="font-mono text-xs text-white w-6 text-right">{m.value}</span>
                    </div>
                  )
                })}
              </div>
          }
        </ChartCard>

        {/* Fatigue trend */}
        <ChartCard title="Fleet Fatigue Trend" subtitle="Average fatigue score from Sentinel">
          {fatigueTrend.length < 2
            ? <EmptyState icon="Eye" message="Not enough fatigue data" sub="Fatigue scores reported by Apex Sentinel in the driver app" />
            : <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={fatigueTrend} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                  <defs>
                    <linearGradient id="gFatigue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={C.amber} stopOpacity={0.2} />
                      <stop offset="95%" stopColor={C.amber} stopOpacity={0}   />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" />
                  <XAxis dataKey="date" tick={{ fill: '#475569', fontSize: 9 }} tickLine={false} axisLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fill: '#475569', fontSize: 10 }} tickLine={false} axisLine={false} />
                  <Tooltip content={<ApexTooltip formatter={v => `${v}%`} />} />
                  <ReferenceLine y={75} stroke={C.red}   strokeDasharray="4 2" strokeOpacity={0.4} />
                  <ReferenceLine y={45} stroke={C.amber} strokeDasharray="4 2" strokeOpacity={0.35} />
                  <Area type="monotone" dataKey="avg_fatigue" stroke={C.amber} strokeWidth={2} fill="url(#gFatigue)" dot={false} activeDot={{ r: 4 }} />
                </AreaChart>
              </ResponsiveContainer>
          }
        </ChartCard>
      </div>

      {/* Recent AI report log */}
      <ChartCard title="AI Report Log" subtitle="Latest reports from driver app AI modules">
        {recent.length === 0
          ? <EmptyState icon="Cpu" message="No AI reports" sub="Sentinel and RouteMind insights from the AP3X driver app appear here in real time" />
          : <div className="space-y-2">
              {recent.slice(0, 20).map(r => (
                <div key={r.id} className="flex items-start gap-3 p-3 rounded-lg bg-slate-900/40 border border-slate-800/40 hover:bg-slate-800/20 transition-colors">
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    r.module === 'sentinel'  ? 'bg-violet-500/15 border border-violet-500/20' :
                    r.module === 'routemind' ? 'bg-emerald-500/15 border border-emerald-500/20' :
                    'bg-cyan-500/15 border border-cyan-500/20'
                  }`}>
                    <Icon name={r.module === 'sentinel' ? 'Shield' : r.module === 'routemind' ? 'Navigation' : 'Cpu'} size={12}
                      className={r.module === 'sentinel' ? 'text-violet-400' : r.module === 'routemind' ? 'text-emerald-400' : 'text-cyan-400'} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs font-semibold text-white">{r.driverName || r.driverId?.slice(0,8) || '—'}</span>
                      <span className="text-2xs text-slate-600 font-mono">{r.vehicleReg || '—'}</span>
                      <span className={`text-2xs px-1.5 py-0.5 rounded capitalize font-medium ml-auto flex-shrink-0 ${
                        r.module === 'sentinel'  ? 'bg-violet-500/10 text-violet-400'  :
                        r.module === 'routemind' ? 'bg-emerald-500/10 text-emerald-400' :
                        'bg-cyan-500/10 text-cyan-400'
                      }`}>{r.module || 'ai'}</span>
                    </div>
                    <p className="text-2xs text-slate-400 leading-relaxed line-clamp-2">{r.summary || r.text || '—'}</p>
                    {r.fatigueScore != null && (
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-2xs text-slate-600">Fatigue:</span>
                        <span className={`text-2xs font-mono font-bold ${
                          r.fatigueScore >= 75 ? 'text-red-400' : r.fatigueScore >= 45 ? 'text-amber-400' : 'text-emerald-400'
                        }`}>{r.fatigueScore}%</span>
                        {r.alertLevel && <span className="text-2xs text-slate-700 capitalize">{r.alertLevel}</span>}
                      </div>
                    )}
                  </div>
                  <div className="text-2xs text-slate-700 font-mono flex-shrink-0">
                    {new Date(r.ts).toLocaleString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })}
                  </div>
                </div>
              ))}
            </div>
        }
      </ChartCard>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
//  ANALYTICS ROOT
// ═══════════════════════════════════════════════════════════════
export default function Analytics() {
  const { vehicles } = useFleetStore(s => ({ vehicles: s.vehicles }))
  const { drivers  } = useDriverStore(s => ({ drivers:  s.drivers  }))

  const [tab,           setTab]          = useState('overview')
  const [period,        setPeriod]       = useState(30)
  const [loading,       setLoading]      = useState(true)
  const [telemetryRows, setTelemetryRows] = useState([])
  const [aiReports,     setAiReports]    = useState([])
  const [alerts,        setAlerts]       = useState([])

  // ── Load all real data ──────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true)
    try { await fleetService.fetchVehicles()  } catch {}
    try { await driverService.fetchDrivers()  } catch {}

    // Telemetry rows
    try {
      const rows = telemetryTable.list()
      setTelemetryRows(rows)
    } catch { setTelemetryRows([]) }

    // AI reports from driverSyncService key
    try {
      const raw = JSON.parse(localStorage.getItem(AI_REPORT_KEY) || '[]')
      setAiReports(raw)
    } catch { setAiReports([]) }

    // Safety alerts
    try {
      const a = safetyService.fetchAlerts({})
      setAlerts(a)
    } catch { setAlerts([]) }

    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // ── Live telemetry listener ─────────────────────────────────
  useEffect(() => {
    const unsub = listenForDriverTelemetry(pkg => {
      setTelemetryRows(prev => {
        const updated = [pkg, ...prev.filter(r => !(r.driver_id === pkg.driver_id && r.vehicle_id === pkg.vehicle_id && r.ts === pkg.ts))]
        return updated.slice(0, 5000)
      })
    })
    return unsub
  }, [])

  // ── Live AI report listener ─────────────────────────────────
  useEffect(() => {
    const unsub = listenForDriverAIReports(report => {
      setAiReports(prev => [report, ...prev].slice(0, 200))
    })
    return unsub
  }, [])

  // ── Build time series from real telemetry ───────────────────
  const timeSeries = useMemo(() =>
    buildTimeSeries(telemetryRows, alerts, period)
  , [telemetryRows, alerts, period])

  // Reload when period changes
  useEffect(() => { load() }, [period, load])

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-800/60 flex-shrink-0">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="font-display text-xl font-bold text-white">Analytics</h1>
            <p className="text-slate-500 text-xs mt-0.5">
              Live fleet intelligence · {telemetryRows.length.toLocaleString()} telemetry records · {aiReports.length} AI reports
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Tab nav */}
            <div className="hidden sm:flex items-center bg-slate-900 border border-slate-800 rounded-lg p-0.5 gap-0.5">
              {TABS.map(t => (
                <button key={t.key} onClick={() => setTab(t.key)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-all ${
                    tab === t.key ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-300'
                  }`}>
                  <Icon name={t.icon} size={11} />
                  {t.label}
                </button>
              ))}
            </div>
            {/* Period selector */}
            <div className="flex bg-slate-900 border border-slate-800 rounded-lg p-0.5 gap-0.5">
              {PERIODS.map(p => (
                <button key={p.key} onClick={() => setPeriod(p.key)}
                  className={`px-2.5 py-1.5 rounded text-xs font-medium transition-all ${
                    period === p.key ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-300'
                  }`}>
                  {p.label}
                </button>
              ))}
            </div>
            <button onClick={load} disabled={loading}
              className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-900 border border-slate-800 text-slate-500 hover:text-slate-300 transition-colors disabled:opacity-40">
              <Icon name="RefreshCw" size={13} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* Mobile tab selector */}
        <div className="sm:hidden flex gap-1 mt-3 overflow-x-auto pb-1">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all flex-shrink-0 ${
                tab === t.key ? 'bg-slate-700 text-white' : 'bg-slate-900 text-slate-500'
              }`}>
              <Icon name={t.icon} size={10} />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-3 sm:p-6">
        {loading
          ? <div className="flex items-center justify-center h-40 text-slate-600 gap-3">
              <Icon name="Loader2" size={20} className="animate-spin" />
              <span className="text-sm">Loading analytics…</span>
            </div>
          : <>
              {tab === 'overview' && <OverviewTab timeSeries={timeSeries} period={period} vehicles={vehicles} drivers={drivers} aiReports={aiReports} alerts={alerts} />}
              {tab === 'fleet'    && <FleetTab    timeSeries={timeSeries} period={period} vehicles={vehicles} />}
              {tab === 'drivers'  && <DriversTab  drivers={drivers} aiReports={aiReports} telemetryRows={telemetryRows} period={period} />}
              {tab === 'safety'   && <SafetyTab   timeSeries={timeSeries} period={period} alerts={alerts} />}
              {tab === 'ai'       && <AIReportsTab aiReports={aiReports} period={period} />}
            </>
        }
      </div>
    </div>
  )
}
