/**
 * APEX AI — Compliance Service (Local DB)
 * No Supabase dependency.
 */

import { table, DB_KEYS } from './services_local_localDB'

export const COMPLIANCE_STATUS = {
  PASS:    'pass',
  FAIL:    'fail',
  PENDING: 'pending',
  EXPIRED: 'expired',
  EXEMPT:  'exempt',
}

export const COMPLIANCE_CATEGORY = {
  LICENCE:        'licence',
  MOT:            'mot',
  INSURANCE:      'insurance',
  TACHO:          'tacho',
  OPERATOR:       'operator',
  DRIVER_CPC:     'driver_cpc',
  ROAD_TAX:       'road_tax',
  INSPECTION:     'inspection',
  OTHER:          'other',
}


const complianceTable = table('apex:db:compliance')

export const complianceService = {

  fetchRecords(filters = {}) {
    let rows = complianceTable.list()
    if (filters.vehicle_id) rows = rows.filter(r => r.vehicle_id === filters.vehicle_id)
    if (filters.driver_id)  rows = rows.filter(r => r.driver_id  === filters.driver_id)
    if (filters.status)     rows = rows.filter(r => r.status      === filters.status)
    return rows.sort((a, b) => new Date(a.expiry_date) - new Date(b.expiry_date))
  },

  createRecord(payload) {
    return complianceTable.create(payload)
  },

  updateRecord(id, payload) {
    return complianceTable.update(id, payload)
  },

  deleteRecord(id) {
    complianceTable.delete(id)
  },

  getExpiring(daysAhead = 30) {
    const cutoff = Date.now() + daysAhead * 86400000
    return complianceTable.list().filter(r => {
      if (!r.expiry_date) return false
      const exp = new Date(r.expiry_date).getTime()
      return exp <= cutoff && exp >= Date.now()
    })
  },

  getExpired() {
    return complianceTable.list().filter(r => {
      if (!r.expiry_date) return false
      return new Date(r.expiry_date).getTime() < Date.now()
    })
  },
}

export default complianceService
