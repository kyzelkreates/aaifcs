/**
 * ============================================================
 * APEX AI — AI Fallback System (Run 15 — Full Build)
 * /src/services/ai/aiFallbackSystem.js
 *
 * Tracks provider health, manages fallback order.
 * Automatic circuit-breaker: providers with 3+ consecutive
 * failures are moved to the back of the chain until recovered.
 * ============================================================
 */

import { DEFAULT_AI_CONFIG, AI_PROVIDERS } from './services_ai_aiConfig.js'

const FAILURE_THRESHOLD = 3
const RECOVERY_WINDOW   = 5 * 60 * 1000  // 5 minutes

class AIFallbackSystem {
  constructor() {
    this._baseOrder    = [...DEFAULT_AI_CONFIG.fallbackOrder]
    this._failures     = {}   // providerId -> { count, lastFailure }
    this._successes    = {}   // providerId -> { count }
  }

  /**
   * Record a provider failure.
   */
  recordFailure(providerId) {
    if (!this._failures[providerId]) {
      this._failures[providerId] = { count: 0, lastFailure: null }
    }
    this._failures[providerId].count++
    this._failures[providerId].lastFailure = Date.now()
    console.warn(`[AIFallback] ${providerId} failure #${this._failures[providerId].count}`)
  }

  /**
   * Record a provider success — resets failure count.
   */
  recordSuccess(providerId) {
    if (this._failures[providerId]) {
      this._failures[providerId].count = 0
    }
    if (!this._successes[providerId]) this._successes[providerId] = { count: 0 }
    this._successes[providerId].count++
  }

  /**
   * Check if a provider is currently healthy (within circuit-breaker rules).
   */
  isHealthy(providerId) {
    const f = this._failures[providerId]
    if (!f || f.count < FAILURE_THRESHOLD) return true
    // Auto-recover after recovery window
    if (Date.now() - f.lastFailure > RECOVERY_WINDOW) {
      f.count = 0
      return true
    }
    return false
  }

  /**
   * Get primary (first healthy) provider.
   */
  getPrimary() {
    return this.getOrder()[0]
  }

  /**
   * Get the full fallback order — healthy providers first,
   * degraded providers appended at the end.
   */
  getOrder() {
    // Build from available env keys
    const available = this._detectAvailable()
    if (!available.length) return this._baseOrder

    const healthy   = available.filter(id => this.isHealthy(id))
    const degraded  = available.filter(id => !this.isHealthy(id))
    return [...healthy, ...degraded]
  }

  /**
   * Returns which providers have their API keys set.
   */
  _detectAvailable() {
    const env = import.meta.env
    const keyMap = {
      [AI_PROVIDERS.OPENAI]:     env.VITE_OPENAI_API_KEY,
      [AI_PROVIDERS.OPENROUTER]: env.VITE_OPENROUTER_API_KEY,
      [AI_PROVIDERS.GROQ]:       env.VITE_GROQ_API_KEY,
      [AI_PROVIDERS.DEEPSEEK]:   env.VITE_DEEPSEEK_API_KEY,
      [AI_PROVIDERS.MISTRAL]:    env.VITE_MISTRAL_API_KEY,
      [AI_PROVIDERS.CLAUDE]:     env.VITE_CLAUDE_API_KEY,
      [AI_PROVIDERS.GEMINI]:     env.VITE_GEMINI_API_KEY,
      [AI_PROVIDERS.OLLAMA]:     env.VITE_OLLAMA_BASE_URL || 'http://localhost:11434', // always try
    }
    return this._baseOrder.filter(id => !!keyMap[id])
  }

  /**
   * Get status of all providers (for Settings UI).
   */
  getStatus() {
    return this._baseOrder.map(id => ({
      id,
      healthy:  this.isHealthy(id),
      failures: this._failures[id]?.count || 0,
      available: !!this._detectAvailable().includes(id),
    }))
  }

  /**
   * Manually reset all failure counters.
   */
  reset() {
    this._failures  = {}
    this._successes = {}
    console.info('[AIFallback] Circuit breakers reset')
  }
}

export const aiFallbackSystem = new AIFallbackSystem()
export default aiFallbackSystem
