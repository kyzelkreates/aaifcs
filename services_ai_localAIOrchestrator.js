/**
 * ============================================================
 * APEX AI — Local-First AI Orchestrator
 *
 * Execution hierarchy for all AI tasks:
 *
 *   Tier 1 — Local Heuristics      (zero latency, zero cost)
 *   Tier 2 — Local Small Models    (Ollama if available)
 *   Tier 3 — Open-Source AI        (Mistral, DeepSeek, Qwen free tiers)
 *   Tier 4 — Premium AI Fallback   (OpenAI, Anthropic, Gemini)
 *
 * Smart routing:
 *   - Route tasks DOWNWARD from heuristics to premium
 *   - Cache heuristic answers for repeated patterns
 *   - Track cost per provider per task type
 *   - Never call cloud AI for tasks solvable locally
 *
 * Supported modules:
 *   - ROUTING_HEURISTIC   → pure local (no AI needed)
 *   - FATIGUE_ASSESSMENT  → local rules first
 *   - DISPATCH_OPTIMISE   → local TSP first
 *   - SENTINEL_CHAT       → local rules → open-source → premium
 *   - ROUTEMIND           → local cache → open-source → premium
 *   - COMPLIANCE          → rule engine → open-source
 *   - ANOMALY_DETECT      → statistical → open-source
 * ============================================================
 */

import { aiRouter }        from './services_ai_aiRouter'
import { apiUsageTracker } from './services_ai_aiUsageTracker'

// ─── Tier definitions ─────────────────────────────────────────
export const AI_TIER = {
  LOCAL_HEURISTIC: 'local_heuristic',
  LOCAL_MODEL:     'local_model',       // Ollama
  OPEN_SOURCE:     'open_source',       // Mistral, DeepSeek, Qwen
  PREMIUM:         'premium',           // OpenAI, Anthropic, Gemini
}

// ─── Module configs — defines maximum tier allowed per module ─
const MODULE_MAX_TIER = {
  routing_heuristic:  AI_TIER.LOCAL_HEURISTIC,
  fatigue_assessment: AI_TIER.LOCAL_MODEL,
  dispatch_optimise:  AI_TIER.LOCAL_MODEL,
  sentinel_chat:      AI_TIER.PREMIUM,
  routemind:          AI_TIER.PREMIUM,
  compliance:         AI_TIER.OPEN_SOURCE,
  anomaly_detect:     AI_TIER.OPEN_SOURCE,
}

// ─── Provider tier mapping ────────────────────────────────────
const PROVIDER_TIERS = {
  local_heuristic:  [null],
  local_model:      ['ollama'],
  open_source:      ['mistral', 'deepseek', 'groq', 'openrouter'],
  premium:          ['openai', 'claude', 'gemini'],
}

// ─── Local heuristic engine ───────────────────────────────────
const heuristics = {
  /** Fatigue assessment — EU rules + behavioural signals */
  fatigue(ctx) {
    const { sessionSecs = 0, fatigueScore = 0, speed = 0, alertLevel = 'safe' } = ctx
    const hours   = sessionSecs / 3600
    const euBreak = hours >= 4.5

    if (euBreak || fatigueScore >= 85 || alertLevel === 'critical') {
      return `⛔ CRITICAL: Immediate break required. ${euBreak ? `${hours.toFixed(1)}h of continuous driving exceeds EU 4.5h limit.` : `Fatigue score ${fatigueScore}% is critical.`} Pull over safely as soon as possible.`
    }
    if (fatigueScore >= 65 || alertLevel === 'high') {
      return `⚠️ HIGH FATIGUE: Score ${fatigueScore}%. Recommend break within 30 minutes. Find a safe stopping point.`
    }
    if (fatigueScore >= 40 || hours >= 3.5) {
      return `📊 MODERATE: ${hours.toFixed(1)}h session, fatigue at ${fatigueScore}%. Monitor closely. Plan break soon.`
    }
    return `✅ Normal: ${hours.toFixed(1)}h session, fatigue ${fatigueScore}%. Continue monitoring.`
  },

  /** Speeding assessment */
  speeding(ctx) {
    const { speed = 0, speedLimit = 90 } = ctx
    const excess = speed - speedLimit
    if (excess > 30)  return `🚨 CRITICAL SPEED: ${speed} km/h — ${excess} km/h over limit. Immediate reduction required.`
    if (excess > 15)  return `⚠️ SPEED ALERT: ${speed} km/h — ${excess} km/h over the ${speedLimit} km/h limit.`
    if (excess > 0)   return `📌 SLIGHT OVER: ${speed} km/h — ${excess} km/h above ${speedLimit} km/h limit.`
    return null
  },

  /** Route optimisation suggestion (heuristic level) */
  routeHint(ctx) {
    const { distance_m = 0, duration_s = 0, congestion = 0 } = ctx
    const km  = (distance_m / 1000).toFixed(1)
    const min = Math.round(duration_s / 60)
    if (congestion > 0.7) return `🚦 High congestion detected on this route (${km}km, ${min}min). Consider departure delay or alternate route.`
    if (distance_m > 100_000) return `📍 Long route: ${km}km / ${min}min. Consider intermediate stops for driver breaks (EU compliance).`
    return `🗺️ Route: ${km}km, estimated ${min} minutes. Clear conditions.`
  },

  /** Dispatch optimisation hint */
  dispatchHint(ctx) {
    const { jobCount = 0, vehicleCount = 0 } = ctx
    const ratio = vehicleCount ? (jobCount / vehicleCount).toFixed(1) : 0
    if (ratio > 5) return `🔴 HIGH LOAD: ${jobCount} jobs across ${vehicleCount} vehicles (${ratio} per vehicle). Consider adding capacity or extending delivery windows.`
    if (ratio > 3) return `🟡 MODERATE LOAD: ${ratio} jobs per vehicle. Optimise route batching to reduce total distance.`
    return `🟢 NORMAL LOAD: ${ratio} jobs per vehicle. Fleet is within optimal range.`
  },

  /** Compliance check */
  complianceCheck(ctx) {
    const issues = []
    if (ctx.licenceExpirySoon)    issues.push(`Licence expires in ${ctx.licenceDaysLeft} days`)
    if (ctx.vehicleServiceDue)    issues.push(`Vehicle ${ctx.vehicleReg} service overdue`)
    if (ctx.drivingHoursExceeded) issues.push(`Weekly driving hours exceeded by ${ctx.excessHours}h`)
    if (!issues.length)           return '✅ All compliance checks passed.'
    return `⚠️ Compliance issues: ${issues.join('; ')}.`
  },
}

// ─── LocalAIOrchestrator ──────────────────────────────────────
class LocalAIOrchestrator {
  constructor() {
    this._cache = new Map()   // simple in-memory prompt → response cache
  }

  /**
   * Intelligent task router.
   * Tries tiers from cheapest to most expensive until one succeeds.
   *
   * @param {string} module  - module name (fatigue_assessment, sentinel_chat, etc.)
   * @param {string} prompt  - user/system prompt
   * @param {object} ctx     - context object for heuristics
   * @param {object} options - { forceCloud, maxTier }
   * @returns {{ content, tier, provider, cached, latency_ms }}
   */
  async route(module, prompt, ctx = {}, options = {}) {
    const maxTier  = options.maxTier || MODULE_MAX_TIER[module] || AI_TIER.PREMIUM
    const cacheKey = `${module}:${prompt.slice(0, 80)}`
    const t0       = Date.now()

    // Cache check
    if (!options.forceCloud && this._cache.has(cacheKey)) {
      return { ...this._cache.get(cacheKey), cached: true, latency_ms: 0 }
    }

    // ── TIER 1: Local Heuristics ──────────────────────────────
    if (!options.forceCloud) {
      const answer = this._runHeuristic(module, ctx)
      if (answer) {
        const result = { content: answer, tier: AI_TIER.LOCAL_HEURISTIC, provider: 'local', cached: false, latency_ms: Date.now() - t0 }
        if (this._isCacheable(module)) this._cache.set(cacheKey, result)
        apiUsageTracker.recordAI({ provider: 'local', model: 'heuristic', module, local_inference: true, latency_ms: result.latency_ms, success: true })
        return result
      }
    }

    // ── TIER 2: Local Model (Ollama) ─────────────────────────
    if (this._tierAllowed(maxTier, AI_TIER.LOCAL_MODEL) && !options.forceCloud) {
      try {
        const ollamaUrl = localStorage.getItem('apex:ai:ollama_url') || 'http://localhost:11434'
        const model     = localStorage.getItem('apex:ai:ollama_model') || 'mistral'
        const res = await fetch(`${ollamaUrl}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, prompt: this._buildSystemPrompt(module) + '\n' + prompt, stream: false }),
          signal: AbortSignal.timeout(10_000),
        })
        if (res.ok) {
          const data = await res.json()
          const content = data.response || data.message?.content || ''
          if (content) {
            const result = { content, tier: AI_TIER.LOCAL_MODEL, provider: 'ollama', model, cached: false, latency_ms: Date.now() - t0 }
            apiUsageTracker.recordAI({ provider: 'ollama', model, module, local_inference: true, latency_ms: result.latency_ms, success: true })
            return result
          }
        }
      } catch { /* Ollama not available — continue to next tier */ }
    }

    // ── TIER 3 + 4: Cloud AI via existing aiRouter ────────────
    if (this._tierAllowed(maxTier, AI_TIER.OPEN_SOURCE) || options.forceCloud) {
      try {
        const t1  = Date.now()
        const res = await aiRouter.routeModule(module, prompt)
        const content = typeof res === 'string' ? res : (res?.content || res?.message || JSON.stringify(res))
        const ms  = Date.now() - t1
        const provider = aiRouter.getActiveProvider?.() || 'cloud'
        const result   = {
          content,
          tier:      provider === 'ollama' ? AI_TIER.LOCAL_MODEL : AI_TIER.PREMIUM,
          provider,
          cached:    false,
          latency_ms: ms,
        }
        apiUsageTracker.recordAI({ provider, model: 'unknown', module, local_inference: false, latency_ms: ms, success: true })
        return result
      } catch (err) {
        return { content: `[${module}] AI unavailable. ${this._runHeuristic(module, ctx) || 'Please check your AI provider settings.'}`, tier: 'error', provider: 'none', cached: false, latency_ms: Date.now() - t0 }
      }
    }

    return { content: `[${module}] Task type not permitted above ${maxTier} tier.`, tier: 'blocked', provider: 'none', cached: false, latency_ms: 0 }
  }

  _runHeuristic(module, ctx) {
    if (module === 'fatigue_assessment' && ctx.fatigueScore !== undefined) return heuristics.fatigue(ctx)
    if (module === 'speeding'           && ctx.speed        !== undefined) return heuristics.speeding(ctx)
    if (module === 'routing_heuristic'  && ctx.distance_m   !== undefined) return heuristics.routeHint(ctx)
    if (module === 'dispatch_optimise'  && ctx.jobCount      !== undefined) return heuristics.dispatchHint(ctx)
    if (module === 'compliance'         && ctx.licenceExpirySoon !== undefined) return heuristics.complianceCheck(ctx)
    return null
  }

  _buildSystemPrompt(module) {
    const prompts = {
      sentinel_chat:      'You are Apex Sentinel, an AI safety assistant for commercial drivers. Be concise and safety-focused.',
      routemind:          'You are Apex RouteMind, a routing AI for fleet vehicles. Give brief, actionable route advice.',
      compliance:         'You are a fleet compliance advisor. Focus on UK/EU transport regulations. Be precise.',
      anomaly_detect:     'You are a fleet telemetry analyst. Identify anomalies in driving data. Be brief.',
      fatigue_assessment: 'You are a driver fatigue monitor. Apply EU 4.5h rule. Prioritise driver safety.',
      dispatch_optimise:  'You are a dispatch optimiser. Suggest efficient job batching and routing.',
    }
    return prompts[module] || 'You are an Apex AI Fleet assistant. Be concise and helpful.'
  }

  _tierAllowed(maxTier, tier) {
    const order = [AI_TIER.LOCAL_HEURISTIC, AI_TIER.LOCAL_MODEL, AI_TIER.OPEN_SOURCE, AI_TIER.PREMIUM]
    return order.indexOf(tier) <= order.indexOf(maxTier)
  }

  _isCacheable(module) {
    return ['routing_heuristic', 'dispatch_optimise', 'compliance'].includes(module)
  }

  /** Clear in-memory cache */
  clearCache() { this._cache.clear() }
}

export const localAIOrchestrator = new LocalAIOrchestrator()
