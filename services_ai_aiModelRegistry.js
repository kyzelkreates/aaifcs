/**
 * ============================================================
 * APEX AI — AI Model Registry (Run 15 — Full Build)
 * /src/services/ai/aiModelRegistry.js
 *
 * Full registry of all supported models per provider.
 * Includes context window, capabilities, cost tier.
 * ============================================================
 */

import { AI_PROVIDERS } from './services_ai_aiConfig.js'

export const MODEL_REGISTRY = {
  [AI_PROVIDERS.OPENAI]: [
    { id: 'gpt-4o',           name: 'GPT-4o',           context: 128000, tier: 'premium',  stream: true,  vision: true  },
    { id: 'gpt-4o-mini',      name: 'GPT-4o Mini',      context: 128000, tier: 'standard', stream: true,  vision: true  },
    { id: 'gpt-4-turbo',      name: 'GPT-4 Turbo',      context: 128000, tier: 'premium',  stream: true,  vision: true  },
    { id: 'gpt-3.5-turbo',    name: 'GPT-3.5 Turbo',    context: 16385,  tier: 'budget',   stream: true,  vision: false },
  ],
  [AI_PROVIDERS.OPENROUTER]: [
    { id: 'anthropic/claude-3.5-sonnet',  name: 'Claude 3.5 Sonnet', context: 200000, tier: 'premium',  stream: true  },
    { id: 'anthropic/claude-3.5-haiku',   name: 'Claude 3.5 Haiku',  context: 200000, tier: 'standard', stream: true  },
    { id: 'google/gemini-flash-1.5',      name: 'Gemini Flash 1.5',  context: 1000000, tier: 'budget',  stream: true  },
    { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B', context: 131072, tier: 'budget', stream: true  },
    { id: 'deepseek/deepseek-chat',       name: 'DeepSeek Chat',     context: 64000,  tier: 'budget',   stream: true  },
  ],
  [AI_PROVIDERS.GROQ]: [
    { id: 'llama-3.3-70b-versatile',  name: 'Llama 3.3 70B',    context: 128000, tier: 'standard', stream: true  },
    { id: 'llama-3.1-8b-instant',     name: 'Llama 3.1 8B',     context: 128000, tier: 'budget',   stream: true  },
    { id: 'mixtral-8x7b-32768',       name: 'Mixtral 8x7B',     context: 32768,  tier: 'standard', stream: true  },
    { id: 'gemma2-9b-it',             name: 'Gemma 2 9B',       context: 8192,   tier: 'budget',   stream: true  },
  ],
  [AI_PROVIDERS.DEEPSEEK]: [
    { id: 'deepseek-chat',       name: 'DeepSeek Chat',    context: 64000,  tier: 'budget',   stream: false },
    { id: 'deepseek-reasoner',   name: 'DeepSeek Reasoner',context: 64000,  tier: 'standard', stream: false },
  ],
  [AI_PROVIDERS.MISTRAL]: [
    { id: 'mistral-large-latest', name: 'Mistral Large',   context: 32000,  tier: 'premium',  stream: true  },
    { id: 'mistral-small-latest', name: 'Mistral Small',   context: 32000,  tier: 'budget',   stream: true  },
    { id: 'codestral-latest',     name: 'Codestral',       context: 32000,  tier: 'standard', stream: true  },
  ],
  [AI_PROVIDERS.CLAUDE]: [
    { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', context: 200000, tier: 'premium',  stream: false },
    { id: 'claude-3-5-haiku-20241022',  name: 'Claude 3.5 Haiku',  context: 200000, tier: 'standard', stream: false },
    { id: 'claude-3-opus-20240229',     name: 'Claude 3 Opus',     context: 200000, tier: 'premium',  stream: false },
  ],
  [AI_PROVIDERS.GEMINI]: [
    { id: 'gemini-1.5-pro',     name: 'Gemini 1.5 Pro',   context: 2000000, tier: 'premium',  stream: false },
    { id: 'gemini-1.5-flash',   name: 'Gemini 1.5 Flash', context: 1000000, tier: 'budget',   stream: false },
    { id: 'gemini-2.0-flash-exp', name: 'Gemini 2.0 Flash Exp', context: 1000000, tier: 'standard', stream: false },
  ],
  [AI_PROVIDERS.OLLAMA]: [
    { id: 'llama3',   name: 'Llama 3',   context: 8192,  tier: 'local', stream: true  },
    { id: 'llama3.1', name: 'Llama 3.1', context: 131072, tier: 'local', stream: true },
    { id: 'mistral',  name: 'Mistral',   context: 32000, tier: 'local', stream: true  },
    { id: 'phi3',     name: 'Phi-3',     context: 128000, tier: 'local', stream: true },
    { id: 'gemma2',   name: 'Gemma 2',   context: 8192,  tier: 'local', stream: true  },
    { id: 'deepseek-r1', name: 'DeepSeek R1', context: 64000, tier: 'local', stream: true },
  ],
}

/**
 * Get all models for a provider.
 */
export function getModels(providerId) {
  return MODEL_REGISTRY[providerId] || []
}

/**
 * Get default model for a provider.
 */
export function getDefaultModel(providerId) {
  const models = getModels(providerId)
  return models.find(m => m.tier === 'standard') || models[0] || null
}

/**
 * Get a model by ID across all providers.
 */
export function findModel(modelId) {
  for (const models of Object.values(MODEL_REGISTRY)) {
    const found = models.find(m => m.id === modelId)
    if (found) return found
  }
  return null
}

export default MODEL_REGISTRY
