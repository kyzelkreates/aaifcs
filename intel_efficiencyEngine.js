/**
 * ============================================================
 * APEX INTELLIGENCE — Efficiency Engine
 * File: intel_efficiencyEngine.js
 *
 * Route and fleet efficiency analysis.
 * Computes fuel savings, time optimisation, and cost models.
 * NO external APIs. Pure calculations.
 * ============================================================
 */

import routeMemory from './intel_routeMemory'

// UK diesel price proxy (pence/litre) — operator can override in localStorage
const LS_DIESEL_PRICE = 'apex:intel:efficiency:diesel_ppl'
const DEFAULT_DIESEL_PPL = 158  // ~£1.58/litre

function getDieselPrice() {
  try {
    const v = parseFloat(localStorage.getItem(LS_DIESEL_PRICE) || '')
    return isNaN(v) ? DEFAULT_DIESEL_PPL : v
  } catch { return DEFAULT_DIESEL_PPL }
}

export const efficiencyEngine = {

  /**
   * Set the current diesel price (pence per litre).
   */
  setDieselPrice(ppl) {
    try { localStorage.setItem(LS_DIESEL_PRICE, String(ppl)) } catch {}
  },

  getDieselPrice,

  /**
   * Estimate fuel consumption for a route.
   * @param {object} route    - normalised route
   * @param {object} vehicle  - vehicle record
   * @param {number} loadKg   - current load in kg
   * @returns {object} FuelEstimate
   */
  estimateFuel(route, vehicle = {}, loadKg = 0) {
    const distKm       = (route?.distance || route?.distance_m || 0) / 1000
    const baseL100km   = routeMemory.getVehicleFuelAvg(vehicle.id) || this._baseL100km(vehicle)
    const loadFactor   = loadKg > 0 ? 1 + (loadKg / 26000) * 0.2 : 1  // max +20% at full load
    const l100km       = baseL100km * loadFactor
    const litres       = (distKm / 100) * l100km
    const costPounds   = (litres * getDieselPrice()) / 100
    const co2Kg        = litres * 2.68   // DEFRA diesel CO2 factor

    return {
      distKm:        Math.round(distKm * 10) / 10,
      l100km:        Math.round(l100km * 10) / 10,
      litres:        Math.round(litres * 10) / 10,
      costGBP:       Math.round(costPounds * 100) / 100,
      co2Kg:         Math.round(co2Kg * 10) / 10,
      loadFactor:    Math.round(loadFactor * 100) / 100,
      dieselPpl:     getDieselPrice(),
    }
  },

  /**
   * Calculate fuel saving vs unoptimised baseline (straight-line * 1.2).
   */
  calculateFuelSaving(optimisedRoute, vehicle, loadKg = 0) {
    const distKm    = (optimisedRoute?.distance || optimisedRoute?.distance_m || 0) / 1000
    const baseline  = distKm * 1.2   // assume unoptimised route is 20% longer
    const baseL100  = this._baseL100km(vehicle)
    const optFuel   = this.estimateFuel(optimisedRoute, vehicle, loadKg)
    const baseFuel  = (baseline / 100) * baseL100

    const savedL    = baseFuel - optFuel.litres
    const savedGBP  = (savedL * getDieselPrice()) / 100
    const savedCO2  = savedL * 2.68
    const savingPct = baseFuel > 0 ? Math.round((savedL / baseFuel) * 100) : 0

    return {
      savedLitres:  Math.max(0, Math.round(savedL * 10) / 10),
      savedGBP:     Math.max(0, Math.round(savedGBP * 100) / 100),
      savedCO2Kg:   Math.max(0, Math.round(savedCO2 * 10) / 10),
      savingPercent: Math.max(0, savingPct),
      treesEquiv:   Math.round(savedCO2 / 21 * 10) / 10,  // 1 tree ~21kg CO2/yr
    }
  },

  /**
   * Cost-per-km breakdown.
   */
  costPerKm(vehicle, loadKg = 0) {
    const l100km  = this._baseL100km(vehicle)
    const fuelCPK = (l100km * getDieselPrice()) / 100 / 100  // £/km
    // Driver cost: ~£15/h, assume 60km/h avg
    const driverCPK = 15 / 60
    // Tyre/maintenance proxy: £0.08/km for HGV
    const gvwT = parseFloat(vehicle?.gross_weight_t || 0)
    const maintCPK = gvwT > 7.5 ? 0.08 : gvwT > 3.5 ? 0.04 : 0.02

    return {
      fuel:          Math.round(fuelCPK * 100) / 100,
      driver:        Math.round(driverCPK * 100) / 100,
      maintenance:   maintCPK,
      total:         Math.round((fuelCPK + driverCPK + maintCPK) * 100) / 100,
      currency:      'GBP',
    }
  },

  /**
   * Efficiency rating for a completed journey.
   * Call after routeMemory.recordSuccess() to grade the trip.
   */
  rateCompletedJourney({ distanceM, durationS, fuelUsedL, vehicleId }) {
    const distKm    = distanceM / 1000
    const avgSpeed  = durationS > 0 ? distKm / (durationS / 3600) : 0
    const l100km    = distKm > 0 ? (fuelUsedL / distKm) * 100 : null
    const expected  = routeMemory.getVehicleFuelAvg(vehicleId) || 8.5

    let efficiencyScore = 100
    if (l100km !== null) {
      const fuelDelta = ((l100km - expected) / expected) * 100
      if (fuelDelta > 20)       efficiencyScore -= 20
      else if (fuelDelta > 10)  efficiencyScore -= 10
      else if (fuelDelta < -10) efficiencyScore += 5
    }
    if (avgSpeed < 40 && distKm > 10) efficiencyScore -= 15
    else if (avgSpeed < 55)           efficiencyScore -= 5

    return {
      efficiencyScore:  Math.max(0, Math.min(100, Math.round(efficiencyScore))),
      avgSpeedKmh:      Math.round(avgSpeed),
      l100km:           l100km ? Math.round(l100km * 10) / 10 : null,
      expectedL100km:   expected,
    }
  },

  /**
   * Base fuel consumption estimate by vehicle type.
   */
  _baseL100km(vehicle) {
    const gvwT = parseFloat(vehicle?.gross_weight_t || 0)
    const fuel = vehicle?.fuel_type

    if (fuel === 'electric')  return 0
    if (fuel === 'hydrogen')  return 0

    if (gvwT > 32)       return 32    // 6-axle artic
    if (gvwT > 18)       return 26    // rigid HGV
    if (gvwT > 7.5)      return 18    // 7.5t truck
    if (gvwT > 3.5)      return 11    // large van
    if (vehicle?.type === 'van') return 8.5

    const stored = routeMemory.getVehicleFuelAvg(vehicle?.id)
    return stored || 8.5
  },
}

export default efficiencyEngine
