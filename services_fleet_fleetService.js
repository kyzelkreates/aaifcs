/**
 * ============================================================
 * APEX AI — Fleet Service (Local DB — No Supabase)
 * All vehicle CRUD over localStorage via localDB.
 * Writes state to useFleetStore (SSOT).
 * ============================================================
 */

import { vehicleTable, subscribe, DB_KEYS } from './services_local_localDB'
import { useFleetStore } from './core_storage'

export const VEHICLE_STATUS = {
  ACTIVE:          'active',
  IDLE:            'idle',
  MAINTENANCE:     'maintenance',
  OFFLINE:         'offline',
  DECOMMISSIONED:  'decommissioned',
}

export const VEHICLE_TYPE = {
  HGV:     'hgv',
  VAN:     'van',
  CAR:     'car',
  TANKER:  'tanker',
  REEFER:  'reefer',
  FLATBED: 'flatbed',
  MINIBUS: 'minibus',
}

export const STATUS_COLORS = {
  active:         'cyan',
  idle:           'amber',
  maintenance:    'orange',
  offline:        'red',
  decommissioned: 'slate',
}

export const fleetService = {

  fetchVehicles(filters = {}) {
    useFleetStore.getState().setLoading(true)
    try {
      let rows = vehicleTable.list()
      if (filters.status) rows = rows.filter(v => v.status === filters.status)
      if (filters.type)   rows = rows.filter(v => v.type   === filters.type)
      if (filters.search) {
        const s = filters.search.toLowerCase()
        rows = rows.filter(v =>
          v.reg_number?.toLowerCase().includes(s) ||
          v.make?.toLowerCase().includes(s) ||
          v.model?.toLowerCase().includes(s)
        )
      }
      useFleetStore.getState().setVehicles(rows)
      return rows
    } finally {
      useFleetStore.getState().setLoading(false)
    }
  },

  getVehicle(id) {
    return vehicleTable.get(id)
  },

  createVehicle(payload) {
    const row = vehicleTable.create({ status: VEHICLE_STATUS.IDLE, ...payload })
    this.fetchVehicles()
    return row
  },

  updateVehicle(id, payload) {
    const row = vehicleTable.update(id, payload)
    useFleetStore.getState().setVehicles(
      useFleetStore.getState().vehicles.map(v => v.id === id ? row : v)
    )
    return row
  },

  deleteVehicle(id) {
    vehicleTable.delete(id)
    useFleetStore.getState().setVehicles(
      useFleetStore.getState().vehicles.filter(v => v.id !== id)
    )
  },

  updateStatus(id, status) {
    return this.updateVehicle(id, { status })
  },

  updateTelemetry(vehicleId, telemetry) {
    useFleetStore.getState().updateTelemetry(vehicleId, telemetry)
    this.updateVehicle(vehicleId, {
      lat:       telemetry.lat,
      lng:       telemetry.lng,
      speed:     telemetry.speed,
      fuel_level: telemetry.fuel,
      last_seen: new Date().toISOString(),
    })
  },

  // Subscribe to real-time vehicle changes via BroadcastChannel
  subscribeToVehicles(callback) {
    return subscribe(DB_KEYS.VEHICLES, (event) => {
      this.fetchVehicles()
      callback?.(event)
    })
  },

  subscribeToTelemetry(vehicleId, callback) {
    return subscribe(DB_KEYS.TELEMETRY, (event) => {
      if (event.payload?.vehicle_id === vehicleId) {
        useFleetStore.getState().updateTelemetry(vehicleId, event.payload)
        callback?.(event.payload)
      }
    })
  },
}

export default fleetService
