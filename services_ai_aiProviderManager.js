/**
 * ============================================================
 * APEX AI — AI Provider Manager (Run 15 — Full Build)
 * /src/services/ai/aiProviderManager.js
 *
 * Singleton manager for all AI providers.
 * Handles registration, switching, config, and health.
 * ============================================================
 */

import { AI_PROVIDERS, DEFAULT_AI_CONFIG, PROVIDER_ENDPOINTS } from './services_ai_aiConfig.js'
import { getDefaultModel, getModels } from './services_ai_aiModelRegistry.js'
import { getRuntimeKey, RUNTIME_KEYS } from './services_maps_runtimeKeys.js'


class AIProviderManager {
  constructor() {
    this._config      = { ...DEFAULT_AI_CONFIG }
    this._active      = DEFAULT_AI_CONFIG.provider
    this._initialized = false
    this._usage       = { tokens: 0, cost: 0, calls: 0, errors: 0 }
  }

  /**
   * Initialize with saved config (called on app start from storage.js).
   */
  init(config = {}) {
    this._config      = { ...this._config, ...config }
    this._active      = config.provider || this._config.provider
    this._initialized = true
    console.info(`[AIProviderManager] Initialized · provider: ${this._active}`)
    return this
  }

  /**
   * Get the active provider ID.
   */
  getActiveProviderId() {
    return this._active
  }

  /**
   * Get the active provider's API endpoint.
   */
  getActiveEndpoint() {
    return PROVIDER_ENDPOINTS[this._active] || PROVIDER_ENDPOINTS[AI_PROVIDERS.OPENAI]
  }

  /**
   * Get active provider's API key from env.
   */
  getActiveApiKey() {
    const keyMap = {
      [AI_PROVIDERS.OPENAI]:     getRuntimeKey(RUNTIME_KEYS.OPENAI),
      [AI_PROVIDERS.OPENROUTER]: getRuntimeKey(RUNTIME_KEYS.OPENROUTER),
      [AI_PROVIDERS.GROQ]:       getRuntimeKey(RUNTIME_KEYS.GROQ),
      [AI_PROVIDERS.DEEPSEEK]:   getRuntimeKey(RUNTIME_KEYS.DEEPSEEK),
      [AI_PROVIDERS.MISTRAL]:    getRuntimeKey(RUNTIME_KEYS.MISTRAL),
      [AI_PROVIDERS.CLAUDE]:     getRuntimeKey(RUNTIME_KEYS.ANTHROPIC),
      [AI_PROVIDERS.GEMINI]:     getRuntimeKey(RUNTIME_KEYS.GEMINI),
      [AI_PROVIDERS.OLLAMA]:     getRuntimeKey('ollama') || 'http://localhost:11434',
    }
    return keyMap[this._active] || null
  }

  /**
   * Switch active provider.
   */
  switchProvider(providerId) {
    if (!Object.values(AI_PROVIDERS).includes(providerId)) {
      console.warn('[AIProviderManager] Unknown provider:', providerId)
      return false
    }
    this._active        = providerId
    this._config.provider = providerId
    console.info(`[AIProviderManager] Switched to ${providerId}`)
    return true
  }

  /**
   * Get current full config.
   */
  getConfig() {
    return { ...this._config }
  }

  /**
   * Update config (merges).
   */
  updateConfig(partial) {
    this._config = { ...this._config, ...partial }
    if (partial.provider) this._active = partial.provider
  }

  /**
   * Check if a provider has its API key set.
   */
  isProviderAvailable(providerId) {
    const checks = {
      [AI_PROVIDERS.OPENAI]:     !!getRuntimeKey(RUNTIME_KEYS.OPENAI),
      [AI_PROVIDERS.OPENROUTER]: !!getRuntimeKey(RUNTIME_KEYS.OPENROUTER),
      [AI_PROVIDERS.GROQ]:       !!getRuntimeKey(RUNTIME_KEYS.GROQ),
      [AI_PROVIDERS.DEEPSEEK]:   !!getRuntimeKey(RUNTIME_KEYS.DEEPSEEK),
      [AI_PROVIDERS.MISTRAL]:    !!getRuntimeKey(RUNTIME_KEYS.MISTRAL),
      [AI_PROVIDERS.CLAUDE]:     !!getRuntimeKey(RUNTIME_KEYS.ANTHROPIC),
      [AI_PROVIDERS.GEMINI]:     !!getRuntimeKey(RUNTIME_KEYS.GEMINI),
      [AI_PROVIDERS.OLLAMA]:     true,
    }
    return checks[providerId] ?? false
  }

  /**
   * Get all provider statuses.
   */
  getAllProviderStatus() {
    return Object.values(AI_PROVIDERS).map(id => ({
      id,
      available: this.isProviderAvailable(id),
      active:    id === this._active,
      models:    getModels(id),
      defaultModel: getDefaultModel(id),
    }))
  }

  /**
   * Track usage for cost/rate monitoring.
   */
  recordUsage(tokens = 0, cost = 0) {
    this._usage.tokens += tokens
    this._usage.cost   += cost
    this._usage.calls  += 1
  }

  recordError() {
    this._usage.errors += 1
  }

  getUsage() {
    return { ...this._usage }
  }

  resetUsage() {
    this._usage = { tokens: 0, cost: 0, calls: 0, errors: 0 }
  }

  /**
   * Health check — pings the active provider with a minimal request.
   */
  async checkHealth(providerId) {
    const id  = providerId || this._active
    const key = this.getActiveApiKey()
    if (!key && id !== AI_PROVIDERS.OLLAMA) {
      return { status: 'no_key', providerId: id, message: 'API key not configured' }
    }
    try {
      const endpoint = PROVIDER_ENDPOINTS[id]
      const res = await fetch(`${endpoint}/models`, {
        headers: key ? { 'Authorization': `Bearer ${key}` } : {},
        signal: AbortSignal.timeout(5000),
      })
      return { status: res.ok ? 'ok' : 'error', providerId: id, httpStatus: res.status }
    } catch (err) {
      return { status: 'unreachable', providerId: id, message: err.message }
    }
  }

  isInitialized() { return this._initialized }
}

export const aiProviderManager = new AIProviderManager()
export default aiProviderManager
