/**
 * APEX AI — Telemetry Service (Local DB + BroadcastChannel)
 * Replaces Supabase realtime with localStorage + BroadcastChannel.
 */

import { telemetryTable, subscribe, DB_KEYS } from './services_local_localDB'
import { useFleetStore } from './core_storage'

export const telemetryService = {

  // Subscribe to live telemetry for a vehicle
  subscribeToVehicle(vehicleId, callback) {
    return subscribe(DB_KEYS.TELEMETRY, (event) => {
      if (event.payload?.vehicle_id === vehicleId) {
        callback(event.payload)
      }
    })
  },

  // Subscribe to all vehicle telemetry
  subscribeToAll(callback) {
    return subscribe(DB_KEYS.TELEMETRY, (event) => {
      if (event.event === 'INSERT') {
        const t = event.payload
        useFleetStore.getState().updateTelemetry(t.vehicle_id, t)
        callback(t)
      }
    })
  },

  // Store a telemetry snapshot
  recordSnapshot(vehicleId, data) {
    return telemetryTable.create({ vehicle_id: vehicleId, ...data })
  },

  // Get recent snapshots for a vehicle
  getHistory(vehicleId, limit = 50) {
    return telemetryTable
      .list({ vehicle_id: vehicleId })
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, limit)
  },

  // Get latest snapshot for a vehicle
  getLatest(vehicleId) {
    const rows = this.getHistory(vehicleId, 1)
    return rows[0] || null
  },

  // Inject a telemetry update directly (from driver app)
  inject(vehicleId, data) {
    const snap = this.recordSnapshot(vehicleId, data)
    useFleetStore.getState().updateTelemetry(vehicleId, data)
    return snap
  },
}

export default telemetryService
