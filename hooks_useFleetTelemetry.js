/**
 * APEX AI — Fleet Telemetry Hook (Run 16)
 * Subscribe to live telemetry for a vehicle or the whole fleet.
 */

import { useEffect } from 'react'
import { useFleetStore } from './core_storage'
import { telemetryService } from './services_realtime_telemetryService'

/**
 * Subscribe to live telemetry for a specific vehicle.
 * Returns current telemetry snapshot from store.
 */
export function useVehicleTelemetry(vehicleId, callback) {
  const telemetry = useFleetStore(s => vehicleId ? s.telemetry[vehicleId] : null)

  useEffect(() => {
    if (!vehicleId) return
    const unsub = telemetryService.subscribeToVehicle(vehicleId, callback)
    return unsub
  }, [vehicleId])

  return telemetry
}

/**
 * Subscribe to fleet-wide telemetry.
 * Useful for the live map page.
 */
export function useFleetTelemetry(callback) {
  const telemetry = useFleetStore(s => s.telemetry)

  useEffect(() => {
    const unsub = telemetryService.subscribeToAll(callback)
    return unsub
  }, [])

  return telemetry
}

export default useVehicleTelemetry
