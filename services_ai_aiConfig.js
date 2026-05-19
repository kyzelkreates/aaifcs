/**
 * ============================================================
 * APEX AI — AI Configuration
 * /src/services/ai/aiConfig.js
 *
 * Central config for all AI providers and models.
 * No provider logic lives here — only configuration.
 * ============================================================
 */

export const AI_PROVIDERS = {
  OPENAI:     'openai',
  OPENROUTER: 'openrouter',
  OLLAMA:     'ollama',
  LM_STUDIO:  'lm_studio',
  DEEPSEEK:   'deepseek',
  MISTRAL:    'mistral',
  GROQ:       'groq',
  CLAUDE:     'claude',
  GEMINI:     'gemini',
  LOCAL:      'local'
}

export const AI_MODES = {
  CLOUD:   'cloud',    // Cloud APIs (OpenAI, OpenRouter, etc.)
  SELF_HOSTED: 'self_hosted',  // Self-hosted (Ollama, LM Studio)
  LOCAL:   'local',   // Fully offline/local inference
  HYBRID:  'hybrid'   // Hybrid routing
}

export const AI_MODULES = {
  APEX_VISION:      'apex_vision',       // Visual AI
  APEX_SENTINEL:    'apex_sentinel',     // Safety AI
  APEX_COMPLIANCE:  'apex_compliance',   // Compliance AI
  APEX_ROUTEMIND:   'apex_routemind',    // Route optimisation AI
  APEX_PREDICT:     'apex_predict'       // Predictive analytics AI
}

export const DEFAULT_AI_CONFIG = {
  provider:     AI_PROVIDERS.OPENAI,
  mode:         AI_MODES.CLOUD,
  timeout:      30000,
  retries:      2,
  streaming:    true,
  fallbackEnabled: true,
  fallbackOrder: [
    AI_PROVIDERS.OPENAI,
    AI_PROVIDERS.OPENROUTER,
    AI_PROVIDERS.OLLAMA
  ],
  costLimitDaily:  10.00,
  tokenLimitDaily: 100000
}

export const PROVIDER_ENDPOINTS = {
  [AI_PROVIDERS.OPENAI]:     'https://api.openai.com/v1',
  [AI_PROVIDERS.OPENROUTER]: 'https://openrouter.ai/api/v1',
  [AI_PROVIDERS.OLLAMA]:     'http://localhost:11434/api',
  [AI_PROVIDERS.LM_STUDIO]:  'http://localhost:1234/v1',
  [AI_PROVIDERS.DEEPSEEK]:   'https://api.deepseek.com/v1',
  [AI_PROVIDERS.MISTRAL]:    'https://api.mistral.ai/v1',
  [AI_PROVIDERS.GROQ]:       'https://api.groq.com/openai/v1',
  [AI_PROVIDERS.CLAUDE]:     'https://api.anthropic.com/v1',
  [AI_PROVIDERS.GEMINI]:     'https://generativelanguage.googleapis.com/v1beta',
}

export default {
  AI_PROVIDERS,
  AI_MODES,
  AI_MODULES,
  DEFAULT_AI_CONFIG,
  PROVIDER_ENDPOINTS
}
