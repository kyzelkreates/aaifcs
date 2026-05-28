/**
 * ============================================================
 * AP3X — App Settings Service
 * services/settings/appSettingsService.js
 *
 * Persists fleet-wide settings (e.g. API keys, routing config)
 * to the Supabase `settings` table so ALL devices share them —
 * Fleet Control OS AND Driver PWA.
 *
 * Keys stored:
 *   graphhopper_api_key   — routing engine key
 *   routing_constraints   — default vehicle constraint prefs
 *
 * Falls back to localStorage when Supabase is unavailable.
 * ============================================================
 */

import { getSupabaseClient, isSupabaseReady } from './services_supabase_supabaseClient'
import { getRuntimeKey, setRuntimeKey, RUNTIME_KEYS } from './services_maps_runtimeKeys'

const SETTING_KEYS = {
  GH_API_KEY:          'graphhopper_api_key',
  ROUTING_CONSTRAINTS: 'routing_constraints',
}

// ─── Read a setting from Supabase settings table ─────────────
async function readSetting(key) {
  if (!isSupabaseReady()) return null
  try {
    const client = getSupabaseClient()
    const { data, error } = await client
      .from('settings')
      .select('value')
      .eq('key', key)
      .single()
    if (error || !data) return null
    return data.value
  } catch { return null }
}

// ─── Write a setting to Supabase settings table ──────────────
async function writeSetting(key, value) {
  if (!isSupabaseReady()) return false
  try {
    const client = getSupabaseClient()
    const { error } = await client
      .from('settings')
      .upsert({ key, value }, { onConflict: 'key' })
    return !error
  } catch { return false }
}

// ─────────────────────────────────────────────────────────────
// GraphHopper API Key
// ─────────────────────────────────────────────────────────────

/**
 * Save GraphHopper API key to both Supabase (fleet-wide) and
 * localStorage (instant local availability).
 */
export async function saveGraphHopperKey(apiKey) {
  const trimmed = (apiKey || '').trim()
  // Always save locally for immediate effect
  setRuntimeKey(RUNTIME_KEYS.GRAPHHOPPER, trimmed)
  // Also push to Supabase so Driver PWA gets it
  const ok = await writeSetting(SETTING_KEYS.GH_API_KEY, { key: trimmed })
  return ok
}

/**
 * Load GraphHopper API key — checks Supabase first, falls back
 * to localStorage / env var.
 */
export async function loadGraphHopperKey() {
  const remote = await readSetting(SETTING_KEYS.GH_API_KEY)
  if (remote?.key) {
    // Hydrate localStorage so local consumers see it immediately
    setRuntimeKey(RUNTIME_KEYS.GRAPHHOPPER, remote.key)
    return remote.key
  }
  // Fall back to locally cached value
  return getRuntimeKey(RUNTIME_KEYS.GRAPHHOPPER) || ''
}

/**
 * Test a GraphHopper API key by hitting the geocode endpoint.
 * Returns { ok: boolean, status: number|null, message: string }
 */
export async function testGraphHopperKey(apiKey) {
  const key = (apiKey || '').trim()
  if (!key) return { ok: false, message: 'No key provided' }
  try {
    const res = await fetch(
      `https://graphhopper.com/api/1/geocode?q=London&key=${key}&limit=1`,
      { signal: AbortSignal.timeout(8000) }
    )
    if (res.ok) {
      const data = await res.json()
      const hasHits = data?.hits?.length > 0
      return {
        ok: true,
        message: hasHits
          ? `✓ Key valid — GraphHopper responded (${data.hits.length} geocode hit)`
          : '✓ Key accepted — no results (quota OK)',
      }
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, status: res.status, message: '✗ Invalid or expired API key' }
    }
    if (res.status === 429) {
      return { ok: false, status: res.status, message: '✗ Rate limit hit — key valid but quota exceeded' }
    }
    return { ok: false, status: res.status, message: `✗ GraphHopper returned ${res.status}` }
  } catch (err) {
    return { ok: false, message: `✗ Network error: ${err.message}` }
  }
}

// ─────────────────────────────────────────────────────────────
// Routing Constraints (vehicle defaults)
// ─────────────────────────────────────────────────────────────

const DEFAULT_CONSTRAINTS = {
  enforceHeightRestrictions:  true,
  enforceWeightRestrictions:  true,
  enforceHazmatRestrictions:  true,
  avoidTollRoads:             false,
  avoidMotorways:             false,
  avoidFerries:               false,
  preferTruckRoutes:          true,
  requestAlternatives:        true,
  elevationAnalysis:          true,
}

export async function loadRoutingConstraints() {
  const remote = await readSetting(SETTING_KEYS.ROUTING_CONSTRAINTS)
  return { ...DEFAULT_CONSTRAINTS, ...(remote || {}) }
}

export async function saveRoutingConstraints(constraints) {
  const merged = { ...DEFAULT_CONSTRAINTS, ...constraints }
  await writeSetting(SETTING_KEYS.ROUTING_CONSTRAINTS, merged)
  // Cache locally
  try { localStorage.setItem('apex:routing:constraints', JSON.stringify(merged)) } catch {}
  return merged
}

export function getLocalRoutingConstraints() {
  try {
    const raw = localStorage.getItem('apex:routing:constraints')
    return raw ? { ...DEFAULT_CONSTRAINTS, ...JSON.parse(raw) } : { ...DEFAULT_CONSTRAINTS }
  } catch { return { ...DEFAULT_CONSTRAINTS } }
}

export default {
  saveGraphHopperKey,
  loadGraphHopperKey,
  testGraphHopperKey,
  loadRoutingConstraints,
  saveRoutingConstraints,
  getLocalRoutingConstraints,
  SETTING_KEYS,
}
