/**
 * ============================================================
 * AP3X — Fleet Service  (Supabase SSOT)
 *
 * CONTRACT (LOCKED):
 *   - Reads/writes Supabase `vehicles` table in live mode
 *   - Falls back to localStorage only when Supabase unavailable
 *   - Zustand useFleetStore = UI cache ONLY, never source of truth
 *   - Supabase Realtime on fleet_nodes refreshes vehicle list
 *   - No mock data, no local-only overrides
 * ============================================================
 */

import { vehicleTable, subscribe, DB_KEYS } from './services_local_localDB'
import { useFleetStore } from './core_storage'
import {
  getVehicles as sbGetVehicles,
  updateVehicle as sbUpdateVehicle,
  subscribeToFleetNodes,
  isLiveMode,
} from './services_backend_backendService'

export const VEHICLE_STATUS = {
  ACTIVE:         'active',
  IDLE:           'idle',
  MAINTENANCE:    'maintenance',
  OFFLINE:        'offline',
  DECOMMISSIONED: 'decommissioned',
  AVAILABLE:      'available',
  IN_USE:         'in_use',
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
  available:      'cyan',
  idle:           'amber',
  in_use:         'violet',
  maintenance:    'orange',
  offline:        'red',
  decommissioned: 'slate',
}

export const fleetService = {

  /**
   * fetchVehicles — Supabase SSOT in live mode, localStorage fallback.
   * Zustand store is a UI cache populated after every fetch.
   */
  async fetchVehicles(filters = {}) {
    useFleetStore.getState().setLoading(true)
    try {
      let rows = isLiveMode()
        ? await sbGetVehicles()
        : vehicleTable.list()

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
    } catch (e) {
      console.error('[AP3X:FleetService] fetchVehicles:', e)
      return []
    } finally {
      useFleetStore.getState().setLoading(false)
    }
  },

  getVehicle(id) {
    return useFleetStore.getState().vehicles.find(v => v.id === id)
      || vehicleTable.get?.(id)
      || null
  },

  async createVehicle(payload) {
    if (isLiveMode()) {
      const { getSupabaseClient } = await import('./services_supabase_supabaseClient')
      const sb = getSupabaseClient()
      const { data, error } = await sb
        .from('vehicles')
        .insert({ status: VEHICLE_STATUS.AVAILABLE, ...payload })
        .select()
        .single()
      if (error) throw new Error(error.message)
      await this.fetchVehicles()
      return data
    }
    const row = vehicleTable.create({ status: VEHICLE_STATUS.IDLE, ...payload })
    await this.fetchVehicles()
    return row
  },

  async updateVehicle(id, payload) {
    if (isLiveMode()) {
      const result = await sbUpdateVehicle(id, payload)
      if (!result.ok) throw new Error(result.error)
      // Optimistic cache update
      useFleetStore.getState().setVehicles(
        useFleetStore.getState().vehicles.map(v => v.id === id ? { ...v, ...result.data } : v)
      )
      return result.data
    }
    const row = vehicleTable.update(id, payload)
    useFleetStore.getState().setVehicles(
      useFleetStore.getState().vehicles.map(v => v.id === id ? row : v)
    )
    return row
  },

  async deleteVehicle(id) {
    if (isLiveMode()) {
      const { getSupabaseClient } = await import('./services_supabase_supabaseClient')
      const sb = getSupabaseClient()
      const { error } = await sb.from('vehicles').delete().eq('id', id)
      if (error) throw new Error(error.message)
    } else {
      vehicleTable.delete(id)
    }
    useFleetStore.getState().setVehicles(
      useFleetStore.getState().vehicles.filter(v => v.id !== id)
    )
  },

  updateStatus(id, status) {
    return this.updateVehicle(id, { status })
  },

  updateTelemetry(vehicleId, telemetry) {
    useFleetStore.getState().updateTelemetry(vehicleId, telemetry)
    // Non-blocking Supabase write
    this.updateVehicle(vehicleId, {
      lat:        telemetry.lat,
      lng:        telemetry.lng,
      speed:      telemetry.speed,
      fuel_level: telemetry.fuel,
      last_seen:  new Date().toISOString(),
    }).catch(() => {})
  },

  /**
   * subscribeToVehicles
   * Live: Supabase Realtime on fleet_nodes (contract: subscribe to fleet_nodes).
   * Fallback: BroadcastChannel via localDB.
   */
  subscribeToVehicles(callback) {
    if (isLiveMode()) {
      return subscribeToFleetNodes(async () => {
        await this.fetchVehicles()
        callback?.()
      })
    }
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
