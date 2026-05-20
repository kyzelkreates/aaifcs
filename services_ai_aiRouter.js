/**
 * ============================================================
 * APEX AI — AI Router (Run 15 — Full Build)
 * /src/services/ai/aiRouter.js
 *
 * Routes all AI requests through the active provider.
 * Auto-falls back on failure. Supports streaming.
 * All AI modules (Sentinel, RouteMind, Predict, etc.) route here.
 * ============================================================
 */

import { aiProviderManager } from './services_ai_aiProviderManager.js'
import { aiFallbackSystem }  from './services_ai_aiFallbackSystem.js'
import { getRuntimeKey, RUNTIME_KEYS } from './services_maps_runtimeKeys.js'


// ─── Adapters ─────────────────────────────────────────────────

async function callOpenAI(endpoint, apiKey, body) {
  const res = await fetch(`${endpoint}/chat/completions`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body:    JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error?.message || `HTTP ${res.status}`)
  }
  return res.json()
}

async function callOpenAIStream(endpoint, apiKey, body, onChunk) {
  const res = await fetch(`${endpoint}/chat/completions`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body:    JSON.stringify({ ...body, stream: true }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop()
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6)
      if (data === '[DONE]') return full
      try {
        const parsed = JSON.parse(data)
        const chunk  = parsed.choices?.[0]?.delta?.content || ''
        if (chunk) { full += chunk; onChunk?.(chunk, full) }
      } catch {}
    }
  }
  return full
}

async function callClaude(apiKey, body) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      body.model || 'claude-3-5-sonnet-20241022',
      max_tokens: body.max_tokens || 2048,
      messages:   body.messages.filter(m => m.role !== 'system'),
      system:     body.messages.find(m => m.role === 'system')?.content,
    }),
  })
  if (!res.ok) throw new Error(`Claude HTTP ${res.status}`)
  const data = await res.json()
  return {
    choices: [{ message: { role: 'assistant', content: data.content?.[0]?.text || '' }, finish_reason: 'stop' }],
    usage: data.usage,
  }
}

async function callGemini(apiKey, body) {
  const model = body.model || 'gemini-1.5-flash'
  const url   = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
  const messages = body.messages.filter(m => m.role !== 'system')
  const systemMsg = body.messages.find(m => m.role === 'system')
  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      contents: messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      ...(systemMsg ? { systemInstruction: { parts: [{ text: systemMsg.content }] } } : {}),
    }),
  })
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`)
  const data = await res.json()
  return {
    choices: [{ message: { role: 'assistant', content: data.candidates?.[0]?.content?.parts?.[0]?.text || '' }, finish_reason: 'stop' }],
  }
}

// ─── AI Router ────────────────────────────────────────────────

export const aiRouter = {
  /**
   * Route a prompt to the active AI provider.
   * Falls back automatically if primary fails.
   *
   * @param {object} request
   * @param {Array}  request.messages    - [{role, content}]
   * @param {string} [request.model]     - override model
   * @param {string} [request.module]    - AI module ID (for logging)
   * @param {number} [request.maxTokens] - max response tokens
   * @param {number} [request.temperature] - 0–2
   * @returns {Promise<{content: string, provider: string, model: string, usage?: object}>}
   */
  async route(request) {
    const config    = aiProviderManager.getConfig()
    const providers = aiFallbackSystem.getOrder()

    let lastError = null

    for (const providerId of providers) {
      try {
        const result = await this._callProvider(providerId, request)
        aiFallbackSystem.recordSuccess(providerId)
        return result
      } catch (err) {
        console.warn(`[AIRouter] ${providerId} failed:`, err.message)
        aiFallbackSystem.recordFailure(providerId)
        lastError = err
        if (!config.fallbackEnabled) break
      }
    }

    throw lastError || new Error('All AI providers failed')
  },

  /**
   * Stream a response from the active provider.
   * Falls back to non-streaming if provider doesn't support it.
   *
   * @param {object}   request   - same as route()
   * @param {function} onChunk   - called with (chunk: string, accumulated: string)
   * @returns {Promise<string>}  full accumulated response
   */
  async stream(request, onChunk) {
    const providerId = aiFallbackSystem.getPrimary()
    try {
      return await this._streamProvider(providerId, request, onChunk)
    } catch (err) {
      console.warn(`[AIRouter] stream failed for ${providerId}, falling back to non-stream:`, err.message)
      const result = await this.route(request)
      onChunk?.(result.content, result.content)
      return result.content
    }
  },

  /**
   * Module-aware routing — adds system prompt for each AI module.
   */
  async routeModule(module, userMessage, context = {}) {
    const systemPrompts = {
      apex_sentinel:    'You are Apex Sentinel, an AI safety monitor for commercial fleet vehicles. Analyse driver behaviour, flag risks, and provide concise safety recommendations.',
      apex_compliance:  'You are Apex Compliance, an AI regulatory assistant for UK/EU fleet compliance. Provide accurate guidance on DVSA, tachograph, driver hours, and vehicle regulations.',
      apex_routemind:   'You are Apex RouteMind, an AI route optimisation engine. Suggest optimal routes, flag traffic risks, and calculate ETAs with efficiency in mind.',
      apex_predict:     'You are Apex Predict, a predictive analytics AI for fleet management. Identify trends, forecast maintenance needs, and surface actionable insights.',
      apex_vision:      'You are Apex Vision, a visual AI for fleet monitoring. Analyse dashcam feeds, detect incidents, and provide objective event descriptions.',
    }
    const system = systemPrompts[module] || 'You are an AI assistant for the Apex Fleet Control OS.'
    const messages = [
      { role: 'system',  content: system },
      ...(context.history || []),
      { role: 'user',    content: userMessage },
    ]
    return this.route({ messages, module })
  },

  // ─── Internal ───────────────────────────────────────────────

  async _callProvider(providerId, request) {
    const { messages, model, maxTokens = 2048, temperature = 0.7 } = request
    const env    = import.meta.env
    const body   = { messages, model, max_tokens: maxTokens, temperature }

    switch (providerId) {
      case 'openai': {
        const key = getRuntimeKey(RUNTIME_KEYS.OPENAI)
        if (!key) throw new Error('OpenAI API key not set — add it in Settings → AI Providers')
        body.model = model || 'gpt-4o-mini'
        const data = await callOpenAI('https://api.openai.com/v1', key, body)
        return { content: data.choices[0].message.content, provider: 'openai', model: body.model, usage: data.usage }
      }
      case 'openrouter': {
        const key = getRuntimeKey(RUNTIME_KEYS.OPENROUTER)
        if (!key) throw new Error('OpenRouter API key not set — add it in Settings → AI Providers')
        body.model = model || 'anthropic/claude-3.5-haiku'
        const data = await callOpenAI('https://openrouter.ai/api/v1', key, body)
        return { content: data.choices[0].message.content, provider: 'openrouter', model: body.model, usage: data.usage }
      }
      case 'groq': {
        const key = getRuntimeKey(RUNTIME_KEYS.GROQ)
        if (!key) throw new Error('Groq API key not set — add it in Settings → AI Providers')
        body.model = model || 'llama-3.3-70b-versatile'
        const data = await callOpenAI('https://api.groq.com/openai/v1', key, body)
        return { content: data.choices[0].message.content, provider: 'groq', model: body.model, usage: data.usage }
      }
      case 'deepseek': {
        const key = getRuntimeKey(RUNTIME_KEYS.DEEPSEEK)
        if (!key) throw new Error('DeepSeek API key not set — add it in Settings → AI Providers')
        body.model = model || 'deepseek-chat'
        const data = await callOpenAI('https://api.deepseek.com/v1', key, body)
        return { content: data.choices[0].message.content, provider: 'deepseek', model: body.model, usage: data.usage }
      }
      case 'mistral': {
        const key = getRuntimeKey(RUNTIME_KEYS.MISTRAL)
        if (!key) throw new Error('Mistral API key not set — add it in Settings → AI Providers')
        body.model = model || 'mistral-small-latest'
        const data = await callOpenAI('https://api.mistral.ai/v1', key, body)
        return { content: data.choices[0].message.content, provider: 'mistral', model: body.model, usage: data.usage }
      }
      case 'claude': {
        const key = getRuntimeKey(RUNTIME_KEYS.ANTHROPIC)
        if (!key) throw new Error('Anthropic/Claude API key not set — add it in Settings → AI Providers')
        const data = await callClaude(key, { ...body, model: model || 'claude-3-5-haiku-20241022' })
        return { content: data.choices[0].message.content, provider: 'claude', model: model || 'claude-3-5-haiku-20241022', usage: data.usage }
      }
      case 'gemini': {
        const key = getRuntimeKey(RUNTIME_KEYS.GEMINI)
        if (!key) throw new Error('Gemini API key not set — add it in Settings → AI Providers')
        const data = await callGemini(key, { ...body, model: model || 'gemini-1.5-flash' })
        return { content: data.choices[0].message.content, provider: 'gemini', model: model || 'gemini-1.5-flash' }
      }
      case 'ollama': {
        const base = (getRuntimeKey('ollama_url') || import.meta.env.VITE_OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/+$/, '')
        body.model = model || 'llama3.2'
        const data = await callOpenAI(`${base}/api`, null, body)
        return { content: data.choices[0].message.content, provider: 'ollama', model: body.model }
      }
      default:
        throw new Error(`Unknown provider: ${providerId}`)
    }
  },

  async _streamProvider(providerId, request, onChunk) {
    const { messages, model, maxTokens = 2048, temperature = 0.7 } = request
    const env  = import.meta.env
    const body = { messages, model, max_tokens: maxTokens, temperature }

    switch (providerId) {
      case 'openai': {
        const key = getRuntimeKey(RUNTIME_KEYS.OPENAI)
        if (!key) throw new Error('No OpenAI key')
        body.model = model || 'gpt-4o-mini'
        return callOpenAIStream('https://api.openai.com/v1', key, body, onChunk)
      }
      case 'openrouter': {
        const key = env.VITE_OPENROUTER_API_KEY
        if (!key) throw new Error('No OpenRouter key')
        body.model = model || 'anthropic/claude-3.5-haiku'
        return callOpenAIStream('https://openrouter.ai/api/v1', key, body, onChunk)
      }
      case 'groq': {
        const key = env.VITE_GROQ_API_KEY
        if (!key) throw new Error('No Groq key')
        body.model = model || 'llama-3.3-70b-versatile'
        return callOpenAIStream('https://api.groq.com/openai/v1', key, body, onChunk)
      }
      default:
        throw new Error(`Streaming not implemented for ${providerId}`)
    }
  },
}

export default aiRouter
