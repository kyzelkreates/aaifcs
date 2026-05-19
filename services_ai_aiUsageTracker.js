/**
 * ============================================================
 * APEX AI — API & AI Usage Tracker (Per-Tenant)
 *
 * Tracks every external API call and AI inference:
 *   - routing API calls (OSRM, GraphHopper, Google)
 *   - geocoding API calls (Nominatim, GraphHopper, Google)
 *   - AI inference (per provider, per module, token counts)
 *   - local vs cloud inference ratio
 *
 * All data stored under tenant-scoped key.
 * Structures are Command Center export-ready.
 * ============================================================
 */

import { tenantRegistry } from './services_federation_tenantRegistry'

const MAX_RECORDS = 1000

// ─── Storage key ──────────────────────────────────────────────
const usageKey = () =>
  `apex:usage:${tenantRegistry.getTenantId()}`

// ─── Read/write ───────────────────────────────────────────────
function readAll()       { try { return JSON.parse(localStorage.getItem(usageKey()) || '[]') } catch { return [] } }
function writeAll(rows)  { try { localStorage.setItem(usageKey(), JSON.stringify(rows.slice(0, MAX_RECORDS))) } catch {} }

// ─── APIUsageTracker singleton ────────────────────────────────
class APIUsageTracker {
  constructor() {
    this._session = {
      started_at:         new Date().toISOString(),
      routing_calls:      0,
      geocoding_calls:    0,
      ai_calls:           0,
      local_ai_calls:     0,
      cloud_ai_calls:     0,
      total_tokens:       0,
      total_cost_usd:     0,
      cache_hits:         0,
      api_errors:         0,
    }
  }

  /**
   * Record an external API call.
   * @param {object} event { api_type, provider, endpoint, success, latency_ms, cached, cost_units }
   */
  record(event) {
    const record = {
      id:              `u-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
      ts:              new Date().toISOString(),
      tenant_id:       tenantRegistry.getTenantId(),
      fleet_entity_id: tenantRegistry.getFleetEntityId(),
      api_type:        event.api_type,
      provider:        event.provider,
      endpoint:        event.endpoint || '',
      success:         event.success !== false,
      latency_ms:      event.latency_ms || 0,
      cached:          event.cached     || false,
      fallback:        event.fallback   || false,
      cost_units:      event.cost_units || 0,
      error_code:      event.error_code || null,
    }

    const all = readAll()
    all.unshift(record)
    writeAll(all)

    // Session counters
    if (event.cached) { this._session.cache_hits++; return record }
    if (!event.success) this._session.api_errors++

    if (event.api_type === 'routing')   this._session.routing_calls++
    if (event.api_type === 'geocoding') this._session.geocoding_calls++

    return record
  }

  /**
   * Record an AI inference event.
   */
  recordAI(event) {
    const isLocal = event.local_inference || event.provider === 'ollama' || event.provider === 'local'
    const record  = {
      id:              `ai-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
      ts:              new Date().toISOString(),
      tenant_id:       tenantRegistry.getTenantId(),
      fleet_entity_id: tenantRegistry.getFleetEntityId(),
      api_type:        'ai_inference',
      provider:        event.provider,
      model:           event.model || 'unknown',
      module:          event.module || 'unknown',
      prompt_tokens:   event.prompt_tokens   || 0,
      completion_tokens: event.completion_tokens || 0,
      total_tokens:    event.total_tokens    || 0,
      latency_ms:      event.latency_ms      || 0,
      local_inference: isLocal,
      cost_usd:        event.cost_usd        || 0,
      cached:          event.cached          || false,
      success:         event.success         !== false,
    }

    const all = readAll()
    all.unshift(record)
    writeAll(all)

    // Session counters
    this._session.ai_calls++
    this._session.total_tokens    += record.total_tokens
    this._session.total_cost_usd  += record.cost_usd
    if (isLocal) this._session.local_ai_calls++
    else         this._session.cloud_ai_calls++

    return record
  }

  /**
   * Get usage summary for a time period.
   */
  getSummary(days = 30) {
    const cutoff  = Date.now() - days * 86_400_000
    const all     = readAll().filter(r => new Date(r.ts).getTime() > cutoff)

    const byProvider = {}
    let routing = 0, geocoding = 0, ai = 0, totalTokens = 0, totalCost = 0
    let localAI = 0, cloudAI = 0, cacheHits = 0, errors = 0

    for (const r of all) {
      byProvider[r.provider] = (byProvider[r.provider] || 0) + 1
      if (r.api_type === 'routing')       routing++
      if (r.api_type === 'geocoding')     geocoding++
      if (r.api_type === 'ai_inference') {
        ai++
        totalTokens += r.total_tokens || 0
        totalCost   += r.cost_usd     || 0
        if (r.local_inference) localAI++
        else cloudAI++
      }
      if (r.cached)  cacheHits++
      if (!r.success) errors++
    }

    return {
      period_days:      days,
      total_calls:      all.length,
      routing_calls:    routing,
      geocoding_calls:  geocoding,
      ai_calls:         ai,
      local_ai_calls:   localAI,
      cloud_ai_calls:   cloudAI,
      local_ai_ratio:   ai ? Math.round((localAI / ai) * 100) + '%' : '—',
      total_tokens:     totalTokens,
      total_cost_usd:   totalCost.toFixed(4),
      cache_hits:       cacheHits,
      errors,
      by_provider:      byProvider,
      session:          this._session,
      tenant_id:        tenantRegistry.getTenantId(),
      fleet_entity_id:  tenantRegistry.getFleetEntityId(),
    }
  }

  /**
   * Get raw records — for export / Command Center ingestion.
   */
  getRecords(limit = 100) {
    return readAll().slice(0, limit)
  }

  /** Reset (test/dev only) */
  clear() { writeAll([]) }
}

export const apiUsageTracker = new APIUsageTracker()
