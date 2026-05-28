/**
 * ============================================================
 * AP3X — Driver Service  (Supabase SSOT)
 *
 * CONTRACT (LOCKED):
 *   - Reads/writes Supabase `drivers` table in live mode
 *   - Falls back to localStorage only when Supabase unavailable
 *   - Zustand useDriverStore = UI cache ONLY, never source of truth
 *   - No mock data, no local-only overrides
 * ============================================================
 */

import { driverTable, subscribe, DB_KEYS } from './services_local_localDB'
import { useDriverStore } from './core_storage'
import {
  getDrivers as sbGetDrivers,
  updateDriverStatus as sbUpdateDriverStatus,
  subscribeToDrivers as sbSubscribeToDrivers,
  isLiveMode,
} from './services_backend_backendService'

export const DRIVER_STATUS = {
  ACTIVE:    'active',
  OFF_DUTY:  'off_duty',
  ON_BREAK:  'on_break',
  SUSPENDED: 'suspended',
  INACTIVE:  'inactive',
  ONLINE:    'online',
  OFFLINE:   'offline',
  DRIVING:   'driving',
  IDLE:      'idle',
}

export const LICENCE_TYPE = { A: 'A', B: 'B', C: 'C', CE: 'CE', D: 'D', DE: 'DE', AM: 'AM' }

export const driverService = {

  /**
   * fetchDrivers — Supabase SSOT in live mode, localStorage fallback.
   * Zustand store is a UI cache populated after every fetch.
   */
  async fetchDrivers(filters = {}) {
    useDriverStore.getState().setLoading(true)
    try {
      let rows = isLiveMode()
        ? await sbGetDrivers()
        : driverTable.list()

      if (filters.status) rows = rows.filter(d => d.status === filters.status)
      if (filters.search) {
        const s = filters.search.toLowerCase()
        rows = rows.filter(d =>
          (d.full_name || d.name)?.toLowerCase().includes(s) ||
          d.employee_id?.toLowerCase().includes(s)
        )
      }

      useDriverStore.getState().setDrivers(rows)
      return rows
    } catch (e) {
      console.error('[AP3X:DriverService] fetchDrivers:', e)
      return []
    } finally {
      useDriverStore.getState().setLoading(false)
    }
  },

  getDriver(id) {
    return useDriverStore.getState().drivers.find(d => d.id === id)
      || driverTable.get?.(id)
      || null
  },

  async createDriver(payload) {
    if (isLiveMode()) {
      const { getSupabaseClient } = await import('./services_supabase_supabaseClient')
      const sb = getSupabaseClient()
      const { data, error } = await sb
        .from('drivers')
        .insert({ status: 'offline', online: false, ...payload })
        .select()
        .single()
      if (error) throw new Error(error.message)
      await this.fetchDrivers()
      return data
    }
    const row = driverTable.create({ status: DRIVER_STATUS.OFF_DUTY, ...payload })
    await this.fetchDrivers()
    return row
  },

  async updateDriver(id, payload) {
    if (isLiveMode()) {
      const result = await sbUpdateDriverStatus(id, payload.status, payload)
      if (!result.ok) throw new Error(result.error)
      // Optimistic cache update
      useDriverStore.getState().setDrivers(
        useDriverStore.getState().drivers.map(d => d.id === id ? { ...d, ...result.data } : d)
      )
      return result.data
    }
    const row = driverTable.update(id, payload)
    useDriverStore.getState().setDrivers(
      useDriverStore.getState().drivers.map(d => d.id === id ? row : d)
    )
    return row
  },

  async deleteDriver(id) {
    if (isLiveMode()) {
      const { getSupabaseClient } = await import('./services_supabase_supabaseClient')
      const sb = getSupabaseClient()
      const { error } = await sb.from('drivers').delete().eq('id', id)
      if (error) throw new Error(error.message)
    } else {
      driverTable.delete(id)
    }
    useDriverStore.getState().setDrivers(
      useDriverStore.getState().drivers.filter(d => d.id !== id)
    )
  },

  /**
   * subscribeToDrivers
   * Live: Supabase Realtime on drivers table.
   * Fallback: BroadcastChannel via localDB.
   */
  subscribeToDrivers(callback) {
    if (isLiveMode()) {
      return sbSubscribeToDrivers(async () => {
        await this.fetchDrivers()
        callback?.()
      })
    }
    return subscribe(DB_KEYS.DRIVERS, () => {
      this.fetchDrivers()
      callback?.()
    })
  },
}

export default driverService
