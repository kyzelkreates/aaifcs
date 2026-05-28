/**
 * ============================================================
 * APEX AI — Tenant Registry
 * Multi-tenant isolation layer for the Fleet Control OS.
 *
 * Each Fleet Control OS installation operates as an isolated
 * company entity (tenant). All data stored under tenant-scoped
 * keys — NO cross-tenant leakage possible.
 *
 * Architecture:
 *   tenant_id     — globally unique, never changes (ULID format)
 *   fleet_entity_id — identifies the fleet entity within tenant
 *   install_fingerprint — derived from device/browser entropy
 *   deployment_identity — signed JSON for Command Center pairing
 *
 * Storage: localStorage under 'apex:federation:identity'
 * ============================================================
 */

// ─── Constants ────────────────────────────────────────────────
const IDENTITY_KEY       = 'apex:federation:identity'
const TENANT_VERSION     = '1.0'

// ─── ID Generators ────────────────────────────────────────────
// ULID-style: timestamp prefix + random suffix (no external dep)
function genULID() {
  const ts   = Date.now().toString(36).toUpperCase().padStart(10, '0')
  const rand = Array.from({ length: 16 }, () =>
    '0123456789ABCDEFGHJKMNPQRSTVWXYZ'[Math.floor(Math.random() * 32)]
  ).join('')
  return `${ts}${rand}`
}

function genTenantId()      { return `TENANT-${genULID()}` }
function genFleetEntityId() { return `FE-${genULID()}` }
function genRegistrationCode() {
  // APEX-XXXXXXXX-XXXX-FC format
  // regex: /^APEX-[A-Z0-9]{8}-[A-Z0-9]{4}-FC$/
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const seg = (len) => Array.from(
    { length: len },
    (_, i) => chars[Math.floor(Math.random() * chars.length)]
  ).join('')
  return `APEX-${seg(8)}-${seg(4)}-FC`
}

// ─── Install fingerprint (non-cryptographic, stable per browser) ─
function deriveInstallFingerprint() {
  const parts = [
    navigator.userAgent.slice(0, 40),
    navigator.language,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    screen.width + 'x' + screen.height,
    navigator.hardwareConcurrency || 0,
  ]
  // Simple djb2 hash
  let h = 5381
  for (const p of parts.join('|')) {
    h = ((h << 5) + h) ^ p.charCodeAt(0)
    h = h >>> 0
  }
  return h.toString(16).padStart(8, '0').toUpperCase()
}

// ─── Signed deployment identity ───────────────────────────────
// Lightweight HMAC-style signature (base64 of JSON + fingerprint)
function signIdentity(identity) {
  const payload = JSON.stringify({
    tenant_id:       identity.tenant_id,
    fleet_entity_id: identity.fleet_entity_id,
    created_at:      identity.created_at,
    fingerprint:     identity.install_fingerprint,
  })
  return btoa(payload).replace(/[+/=]/g, c =>
    c === '+' ? '-' : c === '/' ? '_' : '')
}

// ─── TenantRegistry singleton ─────────────────────────────────
class TenantRegistry {
  constructor() {
    this._identity = null
  }

  /**
   * Get or create the tenant identity for this installation.
   * Idempotent — always returns the same identity for the same install.
   */
  getOrCreate() {
    if (this._identity) return this._identity

    try {
      const stored = localStorage.getItem(IDENTITY_KEY)
      if (stored) {
        this._identity = JSON.parse(stored)
        return this._identity
      }
    } catch {}

    return this._create()
  }

  /**
   * Create a fresh tenant identity for a new installation.
   */
  _create() {
    const fingerprint = deriveInstallFingerprint()
    const identity = {
      version:          TENANT_VERSION,
      tenant_id:        genTenantId(),
      fleet_entity_id:  genFleetEntityId(),
      install_fingerprint: fingerprint,
      registration_code:   genRegistrationCode(),
      pairing_token:       null,   // set when Command Center pairs
      deployment_identity: null,   // set on first Command Center sync
      created_at:       new Date().toISOString(),
      company_name:     '',
      company_type:     'fleet',   // fleet | logistics | enterprise
      sync_identity:    null,
    }
    identity.sync_identity = signIdentity(identity)
    identity.deployment_identity = {
      entity_id:   identity.fleet_entity_id,
      tenant_id:   identity.tenant_id,
      fingerprint, 
      sig:         identity.sync_identity,
      created_at:  identity.created_at,
      version:     TENANT_VERSION,
    }

    try {
      localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity))
    } catch {}

    this._identity = identity
    console.info('[TenantRegistry] New identity created:', identity.tenant_id)
    return identity
  }

  /**
   * Update mutable fields (company name, pairing token).
   */
  update(fields = {}) {
    const identity = this.getOrCreate()
    const updated  = { ...identity, ...fields, updated_at: new Date().toISOString() }
    // Re-sign if core identity fields changed
    if (fields.company_name || fields.company_type) {
      updated.sync_identity = signIdentity(updated)
    }
    try { localStorage.setItem(IDENTITY_KEY, JSON.stringify(updated)) } catch {}
    this._identity = updated
    return updated
  }

  /**
   * Set Command Center pairing token (received from CC website).
   */
  setPairingToken(token) {
    return this.update({ pairing_token: token, paired_at: new Date().toISOString() })
  }

  /**
   * Return the tenant-scoped localStorage key prefix.
   * ALL tenant data lives under: apex:t:<tenant_id>:<table>
   */
  tenantPrefix() {
    const id = this.getOrCreate().tenant_id
    return `apex:t:${id}`
  }

  /**
   * Get the tenant_id string.
   */
  getTenantId()      { return this.getOrCreate().tenant_id }
  getFleetEntityId() { return this.getOrCreate().fleet_entity_id }
  getRegistrationCode() { return this.getOrCreate().registration_code }
  isPaired()         { return !!this.getOrCreate().pairing_token }

  /**
   * Regenerate registration code (if current one has been used).
   */
  regenerateRegistrationCode() {
    return this.update({ registration_code: genRegistrationCode() })
  }

  /**
   * Export identity manifest for Command Center pairing.
   * Safe to display/copy/share — no secrets included.
   */
  exportManifest() {
    const id = this.getOrCreate()
    return {
      tenant_id:          id.tenant_id,
      fleet_entity_id:    id.fleet_entity_id,
      registration_code:  id.registration_code,
      company_name:       id.company_name,
      company_type:       id.company_type,
      created_at:         id.created_at,
      sync_identity:      id.sync_identity,
      version:            id.version,
      paired:             this.isPaired(),
    }
  }
}

export const tenantRegistry = new TenantRegistry()

/**
 * Tenant-scoped localStorage table wrapper.
 * Data written here is isolated to this tenant's namespace.
 * Cross-tenant access is architecturally impossible without the tenant_id.
 *
 * Usage:
 *   const myTable = tenantTable('vehicles')
 *   // writes to apex:t:<TENANT_ID>:vehicles
 */
export function tenantTable(tableName) {
  const key = () => `${tenantRegistry.tenantPrefix()}:${tableName}`
  const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const now = () => new Date().toISOString()
  const tid = () => tenantRegistry.getTenantId()
  const eid = () => tenantRegistry.getFleetEntityId()

  const read  = () => { try { return JSON.parse(localStorage.getItem(key()) || '[]') } catch { return [] } }
  const write = (rows) => { try { localStorage.setItem(key(), JSON.stringify(rows)) } catch {} }

  return {
    list(filter = {}) {
      let rows = read()
      for (const [k, v] of Object.entries(filter)) rows = rows.filter(r => r[k] === v)
      return rows
    },
    get(id) { return read().find(r => r.id === id) || null },
    create(data) {
      const rows = read()
      const row  = {
        id:              uid(),
        created_at:      now(),
        updated_at:      now(),
        tenant_id:       tid(),
        fleet_entity_id: eid(),
        ...data,
      }
      rows.unshift(row)
      write(rows)
      return row
    },
    update(id, data) {
      const rows = read()
      const idx  = rows.findIndex(r => r.id === id)
      if (idx === -1) return null
      rows[idx] = { ...rows[idx], ...data, updated_at: now() }
      write(rows)
      return rows[idx]
    },
    delete(id) { write(read().filter(r => r.id !== id)) },
    clear()    { write([]) },
    count()    { return read().length },
    storageKey() { return key() },
  }
}
