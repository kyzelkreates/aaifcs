/**
 * ============================================================
 * APEX AI — Runtime API Key Store
 * /src/services/maps/runtimeKeys.js
 *
 * Allows users to enter API keys in Settings at runtime,
 * storing them in localStorage so they survive reloads.
 * Keys are read by mapService adapters before env vars.
 * ============================================================
 */

const LS_PREFIX = 'apex:apikey:'

export const RUNTIME_KEYS = {
  GRAPHHOPPER: 'graphhopper',
  GOOGLE_MAPS: 'google_maps',
  MAPBOX:      'mapbox',
  OPENAI:      'openai',
  OPENROUTER:  'openrouter',
  GROQ:        'groq',
  DEEPSEEK:    'deepseek',
  MISTRAL:     'mistral',
  ANTHROPIC:   'anthropic',
  GEMINI:      'gemini',
  OLLAMA_URL:  'ollama_url',
}

/** Get a runtime key, falling back to env var */
export function getRuntimeKey(keyId) {
  try {
    const rt = localStorage.getItem(`${LS_PREFIX}${keyId}`)
    if (rt && rt.trim()) return rt.trim()
  } catch {}
  // Env var fallbacks
  const ENV_MAP = {
    [RUNTIME_KEYS.GRAPHHOPPER]: import.meta.env.VITE_GRAPHHOPPER_API_KEY,
    [RUNTIME_KEYS.GOOGLE_MAPS]: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
    [RUNTIME_KEYS.MAPBOX]:      import.meta.env.VITE_MAPBOX_TOKEN,
    [RUNTIME_KEYS.OPENAI]:      import.meta.env.VITE_OPENAI_API_KEY,
    [RUNTIME_KEYS.OPENROUTER]:  import.meta.env.VITE_OPENROUTER_API_KEY,
    [RUNTIME_KEYS.GROQ]:        import.meta.env.VITE_GROQ_API_KEY,
    [RUNTIME_KEYS.DEEPSEEK]:    import.meta.env.VITE_DEEPSEEK_API_KEY,
    [RUNTIME_KEYS.MISTRAL]:     import.meta.env.VITE_MISTRAL_API_KEY,
    [RUNTIME_KEYS.ANTHROPIC]:   import.meta.env.VITE_ANTHROPIC_API_KEY,
    [RUNTIME_KEYS.GEMINI]:      import.meta.env.VITE_GEMINI_API_KEY,
    [RUNTIME_KEYS.OLLAMA_URL]:  import.meta.env.VITE_OLLAMA_BASE_URL,
  }
  return ENV_MAP[keyId] || ''
}

/** Save a runtime key to localStorage */
export function setRuntimeKey(keyId, value) {
  try {
    if (value && value.trim()) {
      localStorage.setItem(`${LS_PREFIX}${keyId}`, value.trim())
    } else {
      localStorage.removeItem(`${LS_PREFIX}${keyId}`)
    }
  } catch {}
}

/** Check if a key is available (runtime or env) */
export function hasRuntimeKey(keyId) {
  return !!getRuntimeKey(keyId)
}

/** Clear all runtime keys */
export function clearRuntimeKeys() {
  try {
    Object.values(RUNTIME_KEYS).forEach(id =>
      localStorage.removeItem(`${LS_PREFIX}${id}`)
    )
  } catch {}
}

export default { getRuntimeKey, setRuntimeKey, hasRuntimeKey, clearRuntimeKeys, RUNTIME_KEYS }
