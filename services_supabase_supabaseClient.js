/**
 * ============================================================
 * AP3X — Centralized Supabase Client  (SSOT)
 * services/supabaseClient.js
 *
 * Single source of truth for all Supabase config across the app.
 * Storage key: 'apex:supabase:settings'  ← same key used by
 * Settings → Backend panel and backendService.
 *
 * Exports:
 *   getSupabaseSettings()      — read persisted config
 *   saveSupabaseSettings()     — persist config
 *   isConfigValid()            — validate config shape
 *   getSupabaseClient()        — singleton client (lazy-init)
 *   destroySupabaseClient()    — reset singleton
 *   isSupabaseReady()          — quick boolean check
 *   testSupabaseConnection()   — connectivity probe (Settings UI)
 *   autoInitSupabase()         — call once on app startup
 * ============================================================
 */

import { createClient } from '@supabase/supabase-js'

// ─── SSOT storage key — must match everywhere ─────────────────
export const SB_SETTINGS_KEY = 'apex:supabase:settings'

// ─── Singleton state ──────────────────────────────────────────
let _client    = null
let _configSig = null   // detects config changes between calls

// ─── Supabase error codes that still mean "connection works" ──
// These codes indicate the TCP/auth layer is fine but the query
// hit a table/RLS issue — that is a schema concern, not a conn fail.
const IGNORABLE_ERROR_CODES = new Set([
  'PGRST116',   // row not found
  'PGRST301',   // JWT expired (anon key still reached the server)
  'PGRST200',   // ambiguous relationship
  '42P01',      // table doesn't exist yet
  '42501',      // RLS permission denied — server is reachable
  'PGRST204',   // no content
  '406',        // not acceptable
])

// ─── Read persisted config ────────────────────────────────────
// Priority order:
//   1. localStorage (set via Settings → Backend panel by fleet operator)
//   2. VITE_ build-time env vars (baked in at build/deploy time)
//   3. Empty/disabled fallback
//
// This means the Driver PWA on a separate device will auto-connect
// as long as VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set
// in the .env file before the build, even without touching Settings.
export function getSupabaseSettings() {
  try {
    const raw = localStorage.getItem(SB_SETTINGS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      // If localStorage has a valid config, use it (fleet operator's explicit settings)
      if (parsed.url && parsed.anonKey) return parsed
    }
  } catch {}

  // Fallback to build-time env vars — works for Driver PWA on any device
  // without the operator needing to configure Settings on that device.
  const envUrl = typeof import.meta !== 'undefined'
    ? (import.meta.env?.VITE_SUPABASE_URL || '')
    : ''
  const envKey = typeof import.meta !== 'undefined'
    ? (import.meta.env?.VITE_SUPABASE_ANON_KEY || '')
    : ''

  if (envUrl && envKey) {
    console.debug('[AP3X:Supabase] Using VITE_ env var config (PWA device mode)')
    return { enabled: true, url: envUrl, anonKey: envKey, connectionStatus: 'offline', _fromEnv: true }
  }

  return { enabled: false, url: '', anonKey: '', connectionStatus: 'offline' }
}

export function saveSupabaseSettings(patch) {
  try {
    // Merge patch into existing settings to avoid clobbering fields
    const existing = getSupabaseSettings()
    const merged = { ...existing, ...patch }
    localStorage.setItem(SB_SETTINGS_KEY, JSON.stringify(merged))
    console.debug('[AP3X:Supabase] Settings saved:', {
      url:     merged.url ? merged.url.substring(0, 40) + '…' : '(empty)',
      hasKey:  !!merged.anonKey,
      enabled: merged.enabled,
    })
  } catch (e) {
    console.warn('[AP3X:Supabase] Failed to persist settings:', e)
  }
}

// ─── Config validity check ────────────────────────────────────
export function isConfigValid(settings) {
  const { url, anonKey, enabled } = settings || {}
  if (!enabled) return false
  if (!url || typeof url !== 'string' || url.trim() === '') return false
  if (!anonKey || typeof anonKey !== 'string' || anonKey.trim() === '') return false
  try { new URL(url.trim()) } catch { return false }
  return true
}

// ─── Singleton client factory ─────────────────────────────────
export function getSupabaseClient() {
  const settings = getSupabaseSettings()

  if (!isConfigValid(settings)) {
    console.debug('[AP3X:Supabase] Config invalid or disabled — client not created')
    return null
  }

  const url    = settings.url.trim()
  const anonKey = settings.anonKey.trim()
  const sig    = `${url}::${anonKey}`

  // Return cached client if config unchanged
  if (_client && _configSig === sig) {
    return _client
  }

  // Destroy stale client if config changed
  if (_client && _configSig !== sig) {
    destroySupabaseClient()
  }

  try {
    _client = createClient(url, anonKey, {
      auth: {
        persistSession:     true,
        autoRefreshToken:   true,
        detectSessionInUrl: false,
      },
      realtime: {
        params: { eventsPerSecond: 20 },
      },
    })
    _configSig = sig
    console.info('[AP3X:Supabase] ✓ Client initialized', {
      url: url.substring(0, 40) + '…',
      hasKey: true,
    })
    return _client
  } catch (e) {
    console.error('[AP3X:Supabase] Failed to create client:', e)
    _client    = null
    _configSig = null
    return null
  }
}

// ─── Destroy client ───────────────────────────────────────────
export function destroySupabaseClient() {
  if (_client) {
    try { _client.removeAllChannels() } catch {}
    _client    = null
    _configSig = null
    console.info('[AP3X:Supabase] Client destroyed')
  }
}

// ─── Ready check ─────────────────────────────────────────────
export function isSupabaseReady() {
  return getSupabaseClient() !== null
}

// ─── Connection test (Settings UI "Test Connection" button) ───
//
// Strategy: try multiple probes in order of reliability.
// We want to distinguish "server reachable" from "network error".
// Any response from Supabase (even a 4xx) means connection works.
export async function testSupabaseConnection(url, anonKey) {
  const cleanUrl = (url || '').trim()
  const cleanKey = (anonKey || '').trim()

  if (!cleanUrl || !cleanKey) {
    return { ok: false, error: 'URL and anon key are required' }
  }
  try { new URL(cleanUrl) } catch {
    return { ok: false, error: 'Invalid Supabase URL format' }
  }

  console.debug('[AP3X:Supabase] Testing connection to:', cleanUrl.substring(0, 40) + '…')

  let testClient
  try {
    testClient = createClient(cleanUrl, cleanKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
  } catch (e) {
    return { ok: false, error: `Client init failed: ${e.message}` }
  }

  // Probe 1: REST health endpoint (no table needed, no auth needed)
  try {
    const res = await fetch(`${cleanUrl}/rest/v1/`, {
      headers: {
        apikey:        cleanKey,
        Authorization: `Bearer ${cleanKey}`,
      },
      signal: AbortSignal.timeout(8000),
    })
    // Any HTTP response (200, 404, 401…) means the server is reachable
    if (res.status > 0) {
      console.info('[AP3X:Supabase] ✓ REST endpoint reachable, status:', res.status)
      return { ok: true }
    }
  } catch (fetchErr) {
    console.debug('[AP3X:Supabase] REST probe failed, trying SDK query:', fetchErr.message)
  }

  // Probe 2: SDK query against 'tasks' table (our primary table)
  try {
    const { error } = await testClient
      .from('tasks')
      .select('id')
      .limit(1)

    if (!error || IGNORABLE_ERROR_CODES.has(error.code) || IGNORABLE_ERROR_CODES.has(String(error.status))) {
      console.info('[AP3X:Supabase] ✓ SDK tasks query succeeded (or ignorable error)')
      return { ok: true }
    }

    // Probe 3: fallback to 'drivers' table
    const { error: e2 } = await testClient
      .from('drivers')
      .select('id')
      .limit(1)

    if (!e2 || IGNORABLE_ERROR_CODES.has(e2.code) || IGNORABLE_ERROR_CODES.has(String(e2.status))) {
      console.info('[AP3X:Supabase] ✓ SDK drivers query succeeded (or ignorable error)')
      return { ok: true }
    }

    console.warn('[AP3X:Supabase] Query test failed:', error?.message)
    return { ok: false, error: error?.message || 'Query failed' }
  } catch (e) {
    return { ok: false, error: e.message || 'Connection failed' }
  }
}

// ─── Auto-init on app startup ─────────────────────────────────
//
// Called ONCE from the app entry point (or backendService module load).
// If settings.enabled === true and config is valid, initializes the client
// so the singleton is ready before any component mounts.
let _autoInitDone = false

export function autoInitSupabase() {
  if (_autoInitDone) return
  _autoInitDone = true

  const settings = getSupabaseSettings()
  console.debug('[AP3X:Supabase] autoInit — enabled:', settings.enabled, '| url:', settings.url ? settings.url.substring(0, 30) + '…' : '(none)', '| hasKey:', !!settings.anonKey)

  if (isConfigValid(settings)) {
    const client = getSupabaseClient() // triggers singleton creation
    if (client) {
      console.info('[AP3X:Supabase] ✓ Auto-initialized on startup')
    }
  } else if (settings.enabled) {
    console.warn('[AP3X:Supabase] Enabled but config invalid — check URL and anon key in Settings → Backend')
  }
}

// ─── Convenience export ───────────────────────────────────────
export const SUPABASE_CONFIGURED = isConfigValid(getSupabaseSettings())

// Auto-init on module load (runs once when this file is first imported)
autoInitSupabase()

export default {
  getSupabaseClient,
  isSupabaseReady,
  getSupabaseSettings,
  saveSupabaseSettings,
  autoInitSupabase,
}
