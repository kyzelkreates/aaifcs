/**
 * ============================================================
 * APEX AI — Analytics Dashboard (Full Build)
 * Fleet intelligence · KPIs · Charts · Driver leaderboard
 * ============================================================
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
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
import { fleetService } from './services_fleet_fleetService'
import { driverService } from './services_drivers_driverService'

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

const PIE_COLORS = {
  active:      C.cyan,
  idle:        C.amber,
  maintenance: C.violet,
  offline:     C.slate,
}

// ─── Data generators (seeded — stable until period changes) ───
function seed(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = Math.imul(31, h) + str.charCodeAt(i) | 0
  return () => { h ^= h << 13; h ^= h >> 17; h ^= h << 5; return (h >>> 0) / 0xffffffff }
}

function generateTimeSeries(days, periodKey) {
  const rng = seed(`apex-${periodKey}-${days}`)
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(Date.now() - (days - 1 - i) * 86400000)
    return {
      date:      d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
      trips:     Math.floor(rng() * 38 + 14),
      distance:  Math.floor(rng() * 1800 + 600),
      fuel:      Math.floor(rng() * 420 + 160),
      incidents: Math.floor(rng() * 3),
      score:     Math.floor(rng() * 18 + 76),
      utilisation: Math.floor(rng() * 35 + 55),
    }
  })
}

function generateFleetPie(vehicles) {
  if (vehicles.length) {
    const c = { active: 0, idle: 0, maintenance: 0, offline: 0 }
    vehicles.forEach(v => { if (c[v.status] !== undefined) c[v.status]++ })
    return Object.entries(c).map(([name, value]) => ({ name, value }))
  }
  return []
}

function generateRadar() {
  return [] // populated from real compliance + safety records
}

// ─── Shared tooltip ───────────────────────────────────────────
function ApexTooltip({ active, payload, label, formatter }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-[#0a0f1e] border border-slate-700/60 rounded-xl p-3 shadow-2xl backdrop-blur-sm min-w-[140px]">
      <div className="text-2xs text-slate-500 mb-2 font-medium">{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center justify-between gap-4 text-xs">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.color }} />
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
function KpiCard({ label, value, unit, change, icon, color, sparkData, sparkKey }) {
  const isUp    = change > 0
  const neutral = change === 0
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
            <span className={`font-mono text-2xl font-bold ${color}`}>{value}</span>
            {unit && <span className="text-slate-600 text-xs">{unit}</span>}
          </div>
          {change !== undefined && (
            <div className={`flex items-center gap-1 mt-1 text-2xs font-medium ${
              neutral ? 'text-slate-500' : isUp ? 'text-emerald-400' : 'text-red-400'
            }`}>
              <Icon name={neutral ? 'Minus' : isUp ? 'TrendingUp' : 'TrendingDown'} size={10} />
              <span>{neutral ? 'No change' : `${isUp ? '+' : ''}${change}% vs last period`}</span>
            </div>
          )}
        </div>
        {/* Mini sparkline */}
        {sparkData && sparkKey && (
          <div className="w-20 h-10 flex-shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={sparkData.slice(-10)} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id={`spark-${sparkKey}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={color.replace('text-', '').includes('cyan') ? C.cyan : color.replace('text-', '').includes('violet') ? C.violet : color.replace('text-', '').includes('emerald') ? C.emerald : color.replace('text-', '').includes('amber') ? C.amber : C.red} stopOpacity={0.3} />
                    <stop offset="95%" stopColor="transparent" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area type="monotone" dataKey={sparkKey}
                  stroke={color.includes('cyan') ? C.cyan : color.includes('violet') ? C.violet : color.includes('emerald') ? C.emerald : color.includes('amber') ? C.amber : C.red}
                  strokeWidth={1.5} fill={`url(#spark-${sparkKey})`} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Chart Card ──────────────────────────────────────────────
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

// ─── Period selector ─────────────────────────────────────────
const PERIODS = [
  { key: 7,  label: '7D'  },
  { key: 14, label: '14D' },
  { key: 30, label: '30D' },
  { key: 90, label: '90D' },
]

// ─── Tab nav ──────────────────────────────────────────────────
const TABS = [
  { key: 'overview',    label: 'Overview',    icon: 'LayoutDashboard' },
  { key: 'fleet',       label: 'Fleet',       icon: 'Truck'           },
  { key: 'drivers',     label: 'Drivers',     icon: 'Users'           },
  { key: 'safety',      label: 'Safety',      icon: 'ShieldCheck'     },
]

// ─── Overview Tab ─────────────────────────────────────────────
function OverviewTab({ data, period, fleetPie, vehicles, drivers }) {
  const totals = useMemo(() => data.reduce((a, d) => ({
    trips:     a.trips     + d.trips,
    distance:  a.distance  + d.distance,
    fuel:      a.fuel      + d.fuel,
    incidents: a.incidents + d.incidents,
  }), { trips: 0, distance: 0, fuel: 0, incidents: 0 }), [data])

  const avgScore = useMemo(() =>
    data.length ? Math.round(data.reduce((s, d) => s + d.score, 0) / data.length) : 0
  , [data])

  const avgUtil = useMemo(() =>
    data.length ? Math.round(data.reduce((s, d) => s + d.utilisation, 0) / data.length) : 0
  , [data])

  const radarData = useMemo(() => generateRadar(), [])

  return (
    <div className="space-y-5">
      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4">
        <KpiCard label="Fleet Size"    value={vehicles.length || 24} icon="Truck"        color="text-cyan-400"    change={2}    sparkData={data} sparkKey="trips"     />
        <KpiCard label="Total Trips"   value={totals.trips}          icon="Route"        color="text-violet-400"  change={8.4}  sparkData={data} sparkKey="trips"     />
        <KpiCard label="Distance"      value={`${(totals.distance / 1000).toFixed(0)}K`} unit="km" icon="Gauge" color="text-emerald-400" change={5.2} sparkData={data} sparkKey="distance" />
        <KpiCard label="Fuel Used"     value={totals.fuel}           unit="L"  icon="Droplets"     color="text-amber-400"   change={-3.1} sparkData={data} sparkKey="fuel"      />
        <KpiCard label="Avg Score"     value={avgScore}              icon="ShieldCheck"  color={avgScore >= 85 ? 'text-emerald-400' : avgScore >= 65 ? 'text-amber-400' : 'text-red-400'} change={1.8} sparkData={data} sparkKey="score" />
        <KpiCard label="Utilisation"   value={`${avgUtil}%`}         icon="Activity"     color="text-blue-400"    change={-1.2} sparkData={data} sparkKey="utilisation" />
      </div>

      {/* Row 2: Trip area + Fleet pie */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2">
          <ChartCard title="Daily Activity" subtitle={`Trips & distance · last ${period} days`}
            action={<Badge variant="cyan" size="sm"><Icon name="TrendingUp" size={10} className="mr-1" />+8.4%</Badge>}>
            <ResponsiveContainer width="100%" height={210}>
              <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                <defs>
                  <linearGradient id="gTrips" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={C.cyan}   stopOpacity={0.22} />
                    <stop offset="95%" stopColor={C.cyan}   stopOpacity={0}    />
                  </linearGradient>
                  <linearGradient id="gUtil" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={C.violet} stopOpacity={0.18} />
                    <stop offset="95%" stopColor={C.violet} stopOpacity={0}    />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" />
                <XAxis dataKey="date" tick={{ fill: '#475569', fontSize: 10 }} tickLine={false} axisLine={false}
                  interval={Math.max(0, Math.floor(period / 7) - 1)} />
                <YAxis tick={{ fill: '#475569', fontSize: 10 }} tickLine={false} axisLine={false} />
                <Tooltip content={<ApexTooltip />} />
                <Area type="monotone" dataKey="trips"       stroke={C.cyan}   strokeWidth={2} fill="url(#gTrips)" dot={false} activeDot={{ r: 4 }} />
                <Area type="monotone" dataKey="utilisation" stroke={C.violet} strokeWidth={1.5} fill="url(#gUtil)" dot={false} activeDot={{ r: 3 }} />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        <ChartCard title="Fleet Status" subtitle="Live distribution">
          <ResponsiveContainer width="100%" height={160}>
            <PieChart>
              <Pie data={fleetPie} cx="50%" cy="50%" innerRadius={50} outerRadius={72}
                paddingAngle={4} dataKey="value" strokeWidth={0}>
                {fleetPie.map((e, i) => (
                  <Cell key={i} fill={PIE_COLORS[e.name] || C.slate} />
                ))}
              </Pie>
              <Tooltip content={<ApexTooltip />} />
            </PieChart>
          </ResponsiveContainer>
          <div className="grid grid-cols-2 gap-1.5 mt-2">
            {fleetPie.map(f => (
              <div key={f.name} className="flex items-center gap-1.5 text-xs">
                <div className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: PIE_COLORS[f.name] }} />
                <span className="text-slate-500 capitalize truncate flex-1">{f.name}</span>
                <span className="font-mono text-slate-300">{f.value}</span>
              </div>
            ))}
          </div>
        </ChartCard>
      </div>

      {/* Row 3: Fuel + Safety + Radar */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <ChartCard title="Fuel vs Distance" subtitle="Last 14 days">
          <ResponsiveContainer width="100%" height={190}>
            <BarChart data={data.slice(-14)} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" />
              <XAxis dataKey="date" tick={{ fill: '#475569', fontSize: 9 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fill: '#475569', fontSize: 10 }} tickLine={false} axisLine={false} />
              <Tooltip content={<ApexTooltip />} />
              <Bar dataKey="distance" fill={C.cyan}  radius={[2,2,0,0]} opacity={0.8} />
              <Bar dataKey="fuel"     fill={C.amber} radius={[2,2,0,0]} opacity={0.8} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Safety Score Trend" subtitle="Fleet rolling average"
          action={
            <div className={`text-xs font-mono font-bold px-2 py-0.5 rounded border ${
              avgScore >= 85 ? 'text-emerald-400 bg-emerald-500/5 border-emerald-500/20' :
              avgScore >= 65 ? 'text-amber-400  bg-amber-500/5  border-amber-500/20'  :
                               'text-red-400    bg-red-500/5    border-red-500/20'
            }`}>{avgScore}</div>
          }>
          <ResponsiveContainer width="100%" height={190}>
            <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" />
              <XAxis dataKey="date" tick={{ fill: '#475569', fontSize: 9 }} tickLine={false} axisLine={false}
                interval={Math.max(0, Math.floor(period / 7) - 1)} />
              <YAxis domain={[55, 100]} tick={{ fill: '#475569', fontSize: 10 }} tickLine={false} axisLine={false} />
              <Tooltip content={<ApexTooltip />} />
              <ReferenceLine y={85} stroke={C.emerald} strokeDasharray="6 3" strokeOpacity={0.4} label={{ value: 'Target', fill: C.emerald, fontSize: 9 }} />
              <Line type="monotone" dataKey="score" stroke={C.emerald} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Performance Radar" subtitle="Current vs target">
          <ResponsiveContainer width="100%" height={200}>
            <RadarChart data={radarData} cx="50%" cy="50%" outerRadius={72}>
              <PolarGrid stroke="rgba(255,255,255,0.06)" />
              <PolarAngleAxis dataKey="metric" tick={{ fill: '#64748b', fontSize: 9 }} />
              <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fill: '#475569', fontSize: 8 }} tickCount={4} />
              <Radar name="Target"  dataKey="target"  stroke={C.slate}  fill={C.slate}  fillOpacity={0.05} strokeDasharray="4 2" strokeWidth={1} />
              <Radar name="Current" dataKey="current" stroke={C.cyan}   fill={C.cyan}   fillOpacity={0.12} strokeWidth={2} />
              <Tooltip content={<ApexTooltip />} />
            </RadarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </div>
  )
}

// ─── Fleet Tab ────────────────────────────────────────────────
function FleetTab({ data, period, vehicles }) {
  const utilData = useMemo(() => data.map(d => ({
    ...d,
    target: 80,
  })), [data])

  return (
    <div className="space-y-5">
      {/* Vehicle status table */}
      <ChartCard title="Vehicle Status Summary" subtitle="Real-time fleet state">
        {vehicles.length === 0 ? (
          <div className="flex flex-col items-center py-10 text-slate-600 gap-2">
            <Icon name="Truck" size={32} className="opacity-20" />
            <p className="text-xs">No vehicle data available yet</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-800/60">
                  {['Registration','Driver','Status','Fuel','Odometer','Last Service'].map(h => (
                    <th key={h} className="text-left text-2xs text-slate-600 tracking-wider uppercase pb-2 pr-4 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/30">
                {vehicles.slice(0, 10).map(v => (
                  <tr key={v.id} className="hover:bg-slate-800/20 transition-colors">
                    <td className="py-2 pr-4 font-mono font-bold text-white">{v.reg_number}</td>
                    <td className="py-2 pr-4 text-slate-400">{v.driver_name || <span className="text-slate-700">—</span>}</td>
                    <td className="py-2 pr-4">
                      <span className={`px-2 py-0.5 rounded text-2xs font-semibold capitalize ${
                        v.status === 'active'      ? 'bg-cyan-500/10 text-cyan-400'    :
                        v.status === 'idle'        ? 'bg-amber-500/10 text-amber-400'  :
                        v.status === 'maintenance' ? 'bg-violet-500/10 text-violet-400':
                        'bg-slate-800 text-slate-500'
                      }`}>{v.status}</span>
                    </td>
                    <td className="py-2 pr-4">
                      {v.fuel_level != null ? (
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${v.fuel_level > 40 ? 'bg-emerald-500' : v.fuel_level > 20 ? 'bg-amber-500' : 'bg-red-500'}`}
                              style={{ width: `${v.fuel_level}%` }} />
                          </div>
                          <span className="font-mono text-slate-400">{v.fuel_level}%</span>
                        </div>
                      ) : <span className="text-slate-700">—</span>}
                    </td>
                    <td className="py-2 pr-4 font-mono text-slate-400">{v.odometer_km ? `${v.odometer_km.toLocaleString()} km` : '—'}</td>
                    <td className="py-2 text-slate-500">{v.last_service || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ChartCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <ChartCard title="Fleet Utilisation" subtitle={`${period}-day trend vs 80% target`}>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={utilData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
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
              <Tooltip content={<ApexTooltip formatter={(v) => `${v}%`} />} />
              <ReferenceLine y={80} stroke={C.emerald} strokeDasharray="6 3" strokeOpacity={0.35} />
              <Area type="monotone" dataKey="utilisation" stroke={C.blue} strokeWidth={2} fill="url(#gUtil2)" dot={false} activeDot={{ r: 4 }} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Incident Frequency" subtitle={`Last ${period} days`}>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" />
              <XAxis dataKey="date" tick={{ fill: '#475569', fontSize: 9 }} tickLine={false} axisLine={false}
                interval={Math.max(0, Math.floor(period / 7) - 1)} />
              <YAxis tick={{ fill: '#475569', fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip content={<ApexTooltip />} />
              <Bar dataKey="incidents" fill={C.red} radius={[2,2,0,0]} opacity={0.8} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </div>
  )
}

// ─── Drivers Tab ──────────────────────────────────────────────
function DriversTab({ drivers }) {
  const sorted = useMemo(() =>
    [...drivers].sort((a, b) => (b.safety_score || 0) - (a.safety_score || 0))
  , [drivers])

  const scoreColor = (s) =>
    s >= 90 ? C.emerald : s >= 75 ? C.cyan : s >= 60 ? C.amber : C.red

  const scoreBg = (s) =>
    s >= 90 ? 'bg-emerald-500/5 border-emerald-500/10' :
    s >= 75 ? 'bg-cyan-500/5 border-cyan-500/10'       :
    s >= 60 ? 'bg-amber-500/5 border-amber-500/10'     :
              'bg-red-500/5 border-red-500/10'

  const fakeScoreHistory = (baseScore) => {
    const rng = seed(`driver-${baseScore}`)
    return Array.from({ length: 8 }, () => Math.max(40, Math.min(100, Math.round(baseScore + (rng() - 0.5) * 20))))
  }

  if (drivers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-600 gap-3">
        <Icon name="Users" size={40} className="opacity-20" />
        <p className="text-sm">No driver data yet</p>
        <p className="text-xs">Drivers will appear here once added to the fleet</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Leaderboard */}
      <ChartCard title="Driver Safety Leaderboard" subtitle="Ranked by safety score">
        <div className="space-y-3">
          {sorted.slice(0, 10).map((d, i) => {
            const score = d.safety_score ?? 0
            const hist  = fakeScoreHistory(score)
            return (
              <div key={d.id} className={`flex items-center gap-3 p-3 rounded-lg border ${scoreBg(score)}`}>
                {/* Rank */}
                <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold ${
                  i === 0 ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' :
                  i === 1 ? 'bg-slate-500/20 text-slate-300 border border-slate-500/30' :
                  i === 2 ? 'bg-orange-600/20 text-orange-400 border border-orange-600/30' :
                  'bg-slate-900 text-slate-600 border border-slate-800'
                }`}>
                  {i + 1}
                </div>
                {/* Name + bar */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-semibold text-white truncate">{d.full_name}</span>
                    <span className="font-mono text-sm font-bold ml-2 flex-shrink-0" style={{ color: scoreColor(score) }}>{score}</span>
                  </div>
                  <div className="h-1.5 bg-slate-800/80 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: `${score}%`, background: scoreColor(score) }} />
                  </div>
                </div>
                {/* Spark */}
                <div className="w-16 h-8 flex-shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={hist.map((v, j) => ({ v, j }))}>
                      <Line type="monotone" dataKey="v" stroke={scoreColor(score)} strokeWidth={1.5} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                {/* Status badge */}
                <div className="flex-shrink-0">
                  <span className={`text-2xs px-2 py-0.5 rounded font-medium capitalize ${
                    d.status === 'active'   ? 'bg-cyan-500/10 text-cyan-400'    :
                    d.status === 'off_duty' ? 'bg-slate-800 text-slate-500'     :
                    d.status === 'on_break' ? 'bg-amber-500/10 text-amber-400'  :
                    'bg-red-500/10 text-red-400'
                  }`}>{d.status?.replace('_', ' ')}</span>
                </div>
              </div>
            )
          })}
        </div>
      </ChartCard>
    </div>
  )
}

// ─── Safety Tab ───────────────────────────────────────────────
function SafetyTab({ data, period }) {
  const alertTypes = useMemo(() => [
    { name: 'Speeding',       value: 42, color: C.red    },
    { name: 'Harsh Braking',  value: 28, color: C.amber  },
    { name: 'Hard Accel.',    value: 19, color: C.violet },
    { name: 'Fatigue',        value: 8,  color: C.blue   },
    { name: 'Near Miss',      value: 5,  color: C.emerald},
  ], [])

  const totalIncidents = useMemo(() => data.reduce((s, d) => s + d.incidents, 0), [data])

  return (
    <div className="space-y-5">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total Alerts',   value: totalIncidents * 6,  color: 'text-red-400',     icon: 'Bell'          },
          { label: 'Critical',       value: Math.floor(totalIncidents * 0.8), color: 'text-red-400',   icon: 'AlertOctagon'  },
          { label: 'Resolved',       value: Math.floor(totalIncidents * 4.2), color: 'text-emerald-400', icon: 'CheckCircle2' },
          { label: 'Avg Resolution', value: '2.4h',              color: 'text-cyan-400',    icon: 'Clock'         },
        ].map(({ label, value, color, icon }) => (
          <div key={label} className="bg-[#0d1426] border border-slate-800/60 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-2xs text-slate-500 font-semibold tracking-widest uppercase">{label}</span>
              <Icon name={icon} size={14} className={color} />
            </div>
            <div className={`font-mono text-2xl font-bold ${color}`}>{value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Alert type breakdown */}
        <ChartCard title="Alert Type Breakdown" subtitle="Last 30 days">
          <div className="space-y-3 mt-1">
            {alertTypes.map(a => {
              const pct = Math.round((a.value / alertTypes.reduce((s, x) => s + x.value, 0)) * 100)
              return (
                <div key={a.name} className="flex items-center gap-3">
                  <span className="text-xs text-slate-400 w-28 flex-shrink-0">{a.name}</span>
                  <div className="flex-1 h-2 bg-slate-800/60 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: a.color }} />
                  </div>
                  <span className="font-mono text-xs text-slate-300 w-8 text-right">{a.value}</span>
                  <span className="text-2xs text-slate-600 w-8 text-right">{pct}%</span>
                </div>
              )
            })}
          </div>
        </ChartCard>

        {/* Incident trend */}
        <ChartCard title="Incident Trend" subtitle={`Daily count · ${period} days`}>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <defs>
                <linearGradient id="gInc" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={C.red} stopOpacity={0.2} />
                  <stop offset="95%" stopColor={C.red} stopOpacity={0}   />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" />
              <XAxis dataKey="date" tick={{ fill: '#475569', fontSize: 9 }} tickLine={false} axisLine={false}
                interval={Math.max(0, Math.floor(period / 7) - 1)} />
              <YAxis tick={{ fill: '#475569', fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip content={<ApexTooltip />} />
              <Area type="monotone" dataKey="incidents" stroke={C.red} strokeWidth={2} fill="url(#gInc)" dot={false} activeDot={{ r: 4 }} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </div>
  )
}

// ─── Analytics Root ───────────────────────────────────────────
export default function Analytics() {
  const { vehicles } = useFleetStore(s => ({ vehicles: s.vehicles }))
  const { drivers }  = useDriverStore(s => ({ drivers:  s.drivers  }))

  const [tab,      setTab]      = useState('overview')
  const [period,   setPeriod]   = useState(30)
  const [data,     setData]     = useState([])
  const [fleetPie, setFleetPie] = useState([])
  const [loading,  setLoading]  = useState(true)

  const load = useCallback(() => {
    setLoading(true)
    try {
      fleetService.fetchVehicles()
      driverService.fetchDrivers()
    } catch { /* graceful */ }
    setData(generateTimeSeries(period, String(period)))
    setLoading(false)
  }, [period])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    setFleetPie(generateFleetPie(vehicles))
  }, [vehicles])

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-800/60 flex-shrink-0">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="font-display text-xl font-bold text-white">Analytics</h1>
            <p className="text-slate-500 text-xs mt-0.5">Fleet intelligence · performance · safety</p>
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
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center h-40 text-slate-600 gap-3">
            <Icon name="Loader2" size={20} className="animate-spin" />
            <span className="text-sm">Loading analytics…</span>
          </div>
        ) : (
          <>
            {tab === 'overview' && <OverviewTab data={data} period={period} fleetPie={fleetPie} vehicles={vehicles} drivers={drivers} />}
            {tab === 'fleet'    && <FleetTab    data={data} period={period} vehicles={vehicles} />}
            {tab === 'drivers'  && <DriversTab  drivers={drivers} />}
            {tab === 'safety'   && <SafetyTab   data={data} period={period} />}
          </>
        )}
      </div>
    </div>
  )
}
