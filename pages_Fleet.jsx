/**
 * ============================================================
 * APEX AI — Fleet Management Page (Run 3)
 * ============================================================
 */

import { useState, useEffect, useCallback } from 'react'
import Icon from './components_ui_Icon'
import Badge from './components_ui_Badge'
import VehicleCard  from './modules_fleet_VehicleCard'
import VehicleTable from './modules_fleet_VehicleTable'
import VehicleModal from './modules_fleet_VehicleModal'
import { useFleetStore } from './core_storage'
import { fleetService, VEHICLE_STATUS, STATUS_COLORS } from './services_fleet_fleetService'

const STATUS_TABS = [
  { key: null,                        label: 'All' },
  { key: VEHICLE_STATUS.ACTIVE,       label: 'Active' },
  { key: VEHICLE_STATUS.IDLE,         label: 'Idle' },
  { key: VEHICLE_STATUS.MAINTENANCE,  label: 'Maintenance' },
  { key: VEHICLE_STATUS.OFFLINE,      label: 'Offline' },
]

export default function Fleet() {
  const { vehicles, activeView, isLoading, selectedIds, setActiveView, setSelectedIds } = useFleetStore(s => ({
    vehicles:      s.vehicles,
    activeView:    s.activeView,
    isLoading:     s.isLoading,
    selectedIds:   s.selectedIds,
    setActiveView: s.setActiveView,
    setSelectedIds: s.setSelectedIds,
  }))

  const [statusFilter, setStatusFilter] = useState(null)
  const [search,       setSearch]       = useState('')
  const [modal,        setModal]        = useState(null)  // null | 'create' | vehicle
  const [deleteTarget, setDeleteTarget] = useState(null)

  const load = useCallback(async () => {
    await fleetService.fetchVehicles({ status: statusFilter, search: search || undefined })
  }, [statusFilter, search])

  useEffect(() => { load() }, [load])

  const filtered = vehicles.filter(v => {
    if (statusFilter && v.status !== statusFilter) return false
    if (search && !v.reg_number?.toLowerCase().includes(search.toLowerCase()) &&
        !v.make?.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const statusCounts = STATUS_TABS.reduce((acc, t) => {
    acc[t.key] = t.key ? vehicles.filter(v => v.status === t.key).length : vehicles.length
    return acc
  }, {})

  const toggleSelect = (id) => {
    setSelectedIds(selectedIds.includes(id) ? selectedIds.filter(x => x !== id) : [...selectedIds, id])
  }
  const toggleAll = () => {
    setSelectedIds(selectedIds.length === filtered.length ? [] : filtered.map(v => v.id))
  }

  const handleDelete = async (v) => {
    if (!confirm(`Remove ${v.reg_number}? This cannot be undone.`)) return
    await fleetService.deleteVehicle(v.id)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-800/60 flex-shrink-0">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="font-display text-xl font-bold text-white">Fleet Control</h1>
            <p className="text-slate-500 text-xs mt-0.5">
              {vehicles.length} vehicles registered
            </p>
          </div>
          <button onClick={() => setModal('create')} className="btn-primary text-sm px-4 py-2">
            <Icon name="Plus" size={14} />
            Add Vehicle
          </button>
        </div>

        {/* Status tabs */}
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-none">
          {STATUS_TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setStatusFilter(tab.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-all ${
                statusFilter === tab.key
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/40'
              }`}
            >
              {tab.label}
              <span className={`text-2xs px-1.5 py-0.5 rounded-full ${
                statusFilter === tab.key ? 'bg-cyan-500/20 text-cyan-400' : 'bg-slate-800 text-slate-600'
              }`}>
                {statusCounts[tab.key] ?? 0}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Toolbar */}
      <div className="px-6 py-3 border-b border-slate-800/40 flex items-center gap-3 flex-shrink-0">
        {/* Search */}
        <div className="relative flex-1 max-w-xs">
          <Icon name="Search" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search vehicles..."
            className="apex-input pl-8 py-2 text-xs"
          />
        </div>

        <div className="flex-1" />

        {/* Bulk actions */}
        {selectedIds.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">{selectedIds.length} selected</span>
            <button className="btn-ghost text-xs px-2 py-1.5">
              <Icon name="Pencil" size={12} /> Edit
            </button>
            <button className="btn-ghost text-xs px-2 py-1.5 text-red-400 hover:bg-red-500/10">
              <Icon name="Trash2" size={12} /> Delete
            </button>
          </div>
        )}

        {/* View toggle */}
        <div className="flex items-center bg-slate-900 border border-slate-800 rounded-md p-0.5">
          {[['grid', 'LayoutGrid'], ['table', 'List']].map(([v, icon]) => (
            <button
              key={v}
              onClick={() => setActiveView(v)}
              className={`p-1.5 rounded transition-all ${
                activeView === v ? 'bg-slate-700 text-white' : 'text-slate-600 hover:text-slate-400'
              }`}
            >
              <Icon name={icon} size={14} />
            </button>
          ))}
        </div>

        {/* Refresh */}
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
        ) : activeView === 'grid' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtered.map(v => (
              <VehicleCard
                key={v.id}
                vehicle={v}
                selected={selectedIds.includes(v.id)}
                onSelect={() => toggleSelect(v.id)}
                onClick={() => setModal(v)}
              />
            ))}
            {filtered.length === 0 && (
              <div className="col-span-full flex flex-col items-center justify-center py-20 text-slate-600">
                <Icon name="Truck" size={40} className="mb-4 opacity-20" />
                <p className="text-sm">No vehicles match your filters</p>
              </div>
            )}
          </div>
        ) : (
          <div className="bg-[#0d1426] border border-slate-800/60 rounded-lg overflow-hidden">
            <VehicleTable
              vehicles={filtered}
              selectedIds={selectedIds}
              onSelect={toggleSelect}
              onSelectAll={toggleAll}
              onRowClick={v => setModal(v)}
              onEdit={v => setModal(v)}
              onDelete={handleDelete}
            />
          </div>
        )}
      </div>

      {/* Modal */}
      {modal && (
        <VehicleModal
          vehicle={modal === 'create' ? null : modal}
          onClose={() => setModal(null)}
          onSaved={load}
        />
      )}
    </div>
  )
}
