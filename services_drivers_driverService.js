/**
 * ============================================================
 * APEX AI — Driver Service (Local DB — No Supabase)
 * ============================================================
 */

import { driverTable, subscribe, DB_KEYS } from './services_local_localDB'
import { useDriverStore } from './core_storage'

export const DRIVER_STATUS = {
  ACTIVE:    'active',
  OFF_DUTY:  'off_duty',
  ON_BREAK:  'on_break',
  SUSPENDED: 'suspended',
  INACTIVE:  'inactive',
}

export const LICENCE_TYPE = { A: 'A', B: 'B', C: 'C', CE: 'CE', D: 'D', DE: 'DE', AM: 'AM' }

export const driverService = {

  fetchDrivers(filters = {}) {
    useDriverStore.getState().setLoading(true)
    try {
      let rows = driverTable.list()
      if (filters.status) rows = rows.filter(d => d.status === filters.status)
      if (filters.search) {
        const s = filters.search.toLowerCase()
        rows = rows.filter(d => d.full_name?.toLowerCase().includes(s) ||
                                d.employee_id?.toLowerCase().includes(s))
      }
      useDriverStore.getState().setDrivers(rows)
      return rows
    } finally {
      useDriverStore.getState().setLoading(false)
    }
  },

  getDriver(id) {
    return driverTable.get(id)
  },

  createDriver(payload) {
    const row = driverTable.create({ status: DRIVER_STATUS.OFF_DUTY, ...payload })
    this.fetchDrivers()
    return row
  },

  updateDriver(id, payload) {
    const row = driverTable.update(id, payload)
    useDriverStore.getState().setDrivers(
      useDriverStore.getState().drivers.map(d => d.id === id ? row : d)
    )
    return row
  },

  deleteDriver(id) {
    driverTable.delete(id)
    useDriverStore.getState().setDrivers(
      useDriverStore.getState().drivers.filter(d => d.id !== id)
    )
  },

  subscribeToDrivers(callback) {
    return subscribe(DB_KEYS.DRIVERS, () => {
      this.fetchDrivers()
      callback?.()
    })
  },
}

export default driverService
