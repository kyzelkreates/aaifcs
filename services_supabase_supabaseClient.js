/**
 * ============================================================
 * AP3X — Centralized Supabase Client
 * services/supabaseClient.js
 *
 * - Reads URL + ANON KEY from settings storage (SSOT)
 * - Dynamically initializes Supabase client on demand
 * - Prevents duplicate client creation (singleton)
 * - Handles invalid/missing config safely
 * - Exports: getSupabaseClient(), isSupabaseReady(), SUPABASE_CONFIGURED
 * ============================================================
 */

import { createClient } from '@supabase/supabase-js'

// ─── Storage key (matches settings page persistence) ──────────
const SB_SETTINGS_KEY = 'apex:supabase:settings'

// ─── Singleton state ──────────────────────────────────────────
let _client    = null
let _configSig = null   // tracks last config to detect changes

// ─── Read persisted config ────────────────────────────────────
export function getSupabaseSettings() {
  try {
    const raw = localStorage.getItem(SB_SETTINGS_KEY)
    return raw ? JSON.parse(raw) : { enabled: false, url: '', anonKey: '', connectionStatus: 'offline' }
  } catch {
    return { enabled: false, url: '', anonKey: '', connectionStatus: 'offline' }
  }
}

export function saveSupabaseSettings(settings) {
  try {
    localStorage.setItem(SB_SETTINGS_KEY, JSON.stringify(settings))
  } catch (e) {
    console.warn('[AP3X:Supabase] Failed to persist settings:', e)
  }
}

// ─── Config validity check ────────────────────────────────────
export function isConfigValid(settings) {
  const { url, anonKey, enabled } = settings || {}
  if (!enabled) return false
  if (!url || typeof url !== 'string') return false
  if (!anonKey || typeof anonKey !== 'string') return false
  // Basic URL check
  try { new URL(url) } catch { return false }
  return true
}

// ─── Singleton client factory ─────────────────────────────────
export function getSupabaseClient() {
  const settings = getSupabaseSettings()

  if (!isConfigValid(settings)) {
    return null
  }

  const sig = `${settings.url}::${settings.anonKey}`

  // Return existing client if config hasn't changed
  if (_client && _configSig === sig) {
    return _client
  }

  // Config changed or first init — create new client
  try {
    _client    = createClient(settings.url.trim(), settings.anonKey.trim(), {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
      realtime: {
        params: { eventsPerSecond: 20 },
      },
    })
    _configSig = sig
    console.info('[AP3X:Supabase] Client initialized')
    return _client
  } catch (e) {
    console.error('[AP3X:Supabase] Failed to create client:', e)
    _client    = null
    _configSig = null
    return null
  }
}

// ─── Destroy client (called on settings change / disable) ─────
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

// ─── Test connection (Settings UI) ───────────────────────────
export async function testSupabaseConnection(url, anonKey) {
  try {
    const testClient = createClient(url.trim(), anonKey.trim(), {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { error } = await testClient
      .from('drivers')
      .select('id')
      .limit(1)
    if (error && error.code !== 'PGRST116' && error.code !== '42P01') {
      // PGRST116 = not found is OK, means connection works; 42P01 = table doesn't exist yet
      return { ok: false, error: error.message }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message || 'Connection failed' }
  }
}

// ─── Convenience export ───────────────────────────────────────
export const SUPABASE_CONFIGURED = isConfigValid(getSupabaseSettings())

// Default export for legacy imports
export default { getSupabaseClient, isSupabaseReady, getSupabaseSettings, saveSupabaseSettings }
