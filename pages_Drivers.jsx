/**
 * ============================================================
 * APEX AI — Driver Management Page (Run 5)
 * ============================================================
 */

import { useState, useEffect, useCallback } from 'react'
import Icon from './components_ui_Icon'
import Badge from './components_ui_Badge'
import DriverCard  from './modules_drivers_DriverCard'
import DriverModal from './modules_drivers_DriverModal'
import { useDriverStore } from './core_storage'
import { driverService, DRIVER_STATUS } from './services_drivers_driverService'
import { driverLearning } from './intel_driverLearning'

const STATUS_TABS = [
  { key: null,                       label: 'All' },
  { key: DRIVER_STATUS.ACTIVE,       label: 'Active' },
  { key: DRIVER_STATUS.OFF_DUTY,     label: 'Off Duty' },
  { key: DRIVER_STATUS.ON_BREAK,     label: 'On Break' },
  { key: DRIVER_STATUS.SUSPENDED,    label: 'Suspended' },
]

export default function Drivers() {
  const { drivers, isLoading } = useDriverStore(s => ({ drivers: s.drivers, isLoading: s.isLoading }))
  const [statusFilter, setStatusFilter] = useState(null)
  const [search, setSearch]   = useState('')
  const [modal,  setModal]    = useState(null)

  const load = useCallback(async () => await driverService.fetchDrivers({ status: statusFilter }), [statusFilter])
  useEffect(() => { load() }, [load])

  const filtered = drivers.filter(d => {
    if (statusFilter && d.status !== statusFilter) return false
    if (search && !d.full_name?.toLowerCase().includes(search.toLowerCase()) &&
        !d.employee_id?.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const counts = STATUS_TABS.reduce((acc, t) => {
    acc[t.key] = t.key ? drivers.filter(d => d.status === t.key).length : drivers.length
    return acc
  }, {})

  const avgScore    = drivers.length
    ? Math.round(drivers.reduce((s, d) => s + (d.safety_score || 0), 0) / drivers.length)
    : null
  const riskDrivers = drivers.length ? driverLearning.rankByRisk(drivers.map(d => d.id).filter(Boolean)).filter(d => d.riskScore > 60) : []

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-800/60 flex-shrink-0">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="font-display text-xl font-bold text-white">Driver Management</h1>
            <p className="text-slate-500 text-xs mt-0.5">
              {drivers.length} drivers · Avg safety score:&nbsp;
              <span className={`font-mono ${avgScore >= 85 ? 'text-emerald-400' : avgScore >= 65 ? 'text-amber-400' : 'text-red-400'}`}>
                {avgScore ?? '—'}
              </span>
            </p>
          </div>
          <button onClick={() => setModal('create')} className="btn-primary text-sm px-4 py-2">
            <Icon name="UserPlus" size={14} /> Add Driver
          </button>
        </div>
        {/* Status tabs */}
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-none">
          {STATUS_TABS.map(tab => (
            <button key={tab.key} onClick={() => setStatusFilter(tab.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-all ${
                statusFilter === tab.key ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/40'
              }`}
            >
              {tab.label}
              <span className={`text-2xs px-1.5 py-0.5 rounded-full ${statusFilter === tab.key ? 'bg-cyan-500/20 text-cyan-400' : 'bg-slate-800 text-slate-600'}`}>
                {counts[tab.key] ?? 0}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Toolbar */}
      <div className="px-6 py-3 border-b border-slate-800/40 flex items-center gap-3 flex-shrink-0">
        <div className="relative flex-1 max-w-xs">
          <Icon name="Search" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search drivers..."
            className="apex-input pl-8 py-2 text-xs" />
        </div>
        <div className="flex-1" />
        <button onClick={load} disabled={isLoading} className="btn-ghost p-2">
          <Icon name="RefreshCw" size={14} className={isLoading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-3 sm:p-6">
        {isLoading && filtered.length === 0 ? (
          <div className="flex items-center justify-center h-48">
            <div className="w-8 h-8 border-2 border-cyan-500/20 border-t-cyan-400 rounded-full animate-spin" />
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtered.map(d => (
              <DriverCard key={d.id} driver={d} onClick={() => setModal(d)} />
            ))}
            {filtered.length === 0 && (
              <div className="col-span-full flex flex-col items-center justify-center py-20 text-slate-600">
                <Icon name="Users" size={40} className="mb-4 opacity-20" />
                <p className="text-sm">No drivers found</p>
              </div>
            )}
          </div>
        )}
      </div>

      {modal && (
        <DriverModal
          driver={modal === 'create' ? null : modal}
          onClose={() => setModal(null)}
          onSaved={load}
        />
      )}
    </div>
  )
}
