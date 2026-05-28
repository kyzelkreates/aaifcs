/**
 * ============================================================
 * APEX AI — Settings (Run 14)
 * Profile · Fleet · AI Providers · Security · Integrations
 * ============================================================
 */

import { useNavigate } from 'react-router-dom'
import Icon from './components_ui_Icon'
import Badge from './components_ui_Badge'
import { useState, useEffect, useCallback } from 'react'
import { useAppStore, useAuthStore, useAIStore, useMapStore } from './core_storage'
import { tenantRegistry } from './services_federation_tenantRegistry'
import {
  ensurePairingCode, refreshPairingCode, getPairingStatus, getRegisteredIdentity,
  markAsRegistered, disconnect, saveCommandCenterUrl, getCommandCenterUrl,
  testConnection, pollPairingStatus, FC_KEYS,
  subscribeFederationRealtime, reconcileFederationState, normalizeAndValidate,
} from './services_federation_pairingEngine'
import apexClient from './services_apex_apexClient'
import { apiUsageTracker } from './services_ai_aiUsageTracker'
import { localRoutingEngine } from './services_routing_localRoutingEngine'
import { authService } from './services_supabase_authService'
import { AI_PROVIDERS } from './services_ai_aiConfig'
import { MAP_PROVIDERS, PROVIDER_DEFINITIONS } from './services_maps_mapProviders'
import { getRuntimeKey, setRuntimeKey, RUNTIME_KEYS } from './services_maps_runtimeKeys'
import {
  saveGraphHopperKey, loadGraphHopperKey, testGraphHopperKey,
  loadRoutingConstraints, saveRoutingConstraints, getLocalRoutingConstraints,
} from './services_settings_appSettingsService'
import { ROUTES } from './config_routes'
import {
  getSupabaseSettings, saveSupabaseSettings, testSupabaseConnection, destroySupabaseClient,
} from './services_supabase_supabaseClient'
import { probeConnection, onConnectionStatus } from './services_backend_backendService'

// ─── Section tabs ─────────────────────────────────────────────
const TABS = [
  { key: 'profile',      label: 'Profile',       icon: 'User' },
  { key: 'fleet',        label: 'Fleet',         icon: 'Truck' },
  { key: 'ai',           label: 'AI Providers',  icon: 'Brain' },
  { key: 'map',          label: 'Map Config',    icon: 'Map' },
  { key: 'security',     label: 'Security',      icon: 'Shield' },
  { key: 'integrations', label: 'Integrations',  icon: 'Plug' },
  { key: 'federation',   label: 'Federation',    icon: 'Globe2' },
  { key: 'backend',      label: 'Backend',       icon: 'Database' },
]

// ─── Setting Row ──────────────────────────────────────────────
function SettingRow({ label, sub, children }) {
  return (
    <div className="flex items-center justify-between py-4 border-b border-slate-800/40 last:border-0">
      <div className="min-w-0 flex-1 mr-6">
        <div className="text-sm font-medium text-white">{label}</div>
        {sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  )
}

// ─── Toggle ───────────────────────────────────────────────────
function Toggle({ value, onChange }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={`relative w-10 h-5.5 rounded-full border transition-all ${
        value ? 'bg-cyan-500/20 border-cyan-500/40' : 'bg-slate-800 border-slate-700'
      }`}
      style={{ height: '22px' }}
    >
      <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full transition-all ${
        value ? 'translate-x-4 bg-cyan-400' : 'bg-slate-600'
      }`} />
    </button>
  )
}

// ─── Section heading ──────────────────────────────────────────
function SectionHead({ label }) {
  return (
    <div className="text-2xs text-slate-600 tracking-widest uppercase font-semibold mb-3 mt-6 first:mt-0">
      {label}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Tab panels
// ──────────────────────────────────────────────────────────────

function ProfilePanel({ user }) {
  const [form,   setForm]   = useState({ full_name: user?.full_name || '', email: user?.email || '', phone: user?.phone || '' })
  const [saved,  setSaved]  = useState(false)
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSave = async () => {
    setSaving(true)
    try {
      await authService.updateProfile(form)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) { console.error(e) }
    finally { setSaving(false) }
  }

  return (
    <div className="space-y-4">
      <SectionHead label="Account" />
      {[
        { k: 'full_name', l: 'Full Name', t: 'text' },
        { k: 'email',     l: 'Email',     t: 'email' },
        { k: 'phone',     l: 'Phone',     t: 'tel' },
      ].map(({ k, l, t }) => (
        <div key={k} className="space-y-1.5">
          <label className="text-xs text-slate-400 font-medium">{l}</label>
          <input type={t} value={form[k]} onChange={e => set(k, e.target.value)} className="apex-input" />
        </div>
      ))}
      <div className="flex items-center gap-3 pt-2">
        <button onClick={handleSave} disabled={saving} className="btn-primary text-sm px-4 py-2 disabled:opacity-40">
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
        {saved && (
          <span className="text-xs text-emerald-400 flex items-center gap-1">
            <Icon name="CheckCircle2" size={13} /> Saved
          </span>
        )}
      </div>
    </div>
  )
}

function FleetPanel() {
  const [orgName, setOrgName] = useState('')
  const [timezone, setTimezone] = useState('Europe/London')
  const [units, setUnits] = useState('metric')

  return (
    <div className="space-y-0">
      <SectionHead label="Organisation" />
      <SettingRow label="Organisation Name" sub="Shown in reports and exports">
        <input value={orgName} onChange={e => setOrgName(e.target.value)}
          className="apex-input w-56 text-sm py-1.5" placeholder="Your fleet company" />
      </SettingRow>
      <SettingRow label="Default Timezone" sub="Used for scheduling and reports">
        <select value={timezone} onChange={e => setTimezone(e.target.value)} className="apex-input w-48 text-sm py-1.5">
          <option value="Europe/London">Europe/London</option>
          <option value="Europe/Paris">Europe/Paris</option>
          <option value="America/New_York">America/New_York</option>
          <option value="America/Chicago">America/Chicago</option>
          <option value="America/Los_Angeles">America/Los_Angeles</option>
          <option value="Asia/Dubai">Asia/Dubai</option>
        </select>
      </SettingRow>
      <SectionHead label="Display" />
      <SettingRow label="Unit System" sub="Distance and speed units">
        <div className="flex bg-slate-900 border border-slate-800 rounded p-0.5">
          {['metric', 'imperial'].map(u => (
            <button key={u} onClick={() => setUnits(u)}
              className={`px-3 py-1 rounded text-xs font-medium capitalize transition-all ${
                units === u ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-300'
              }`}>
              {u}
            </button>
          ))}
        </div>
      </SettingRow>
    </div>
  )
}


function AIPanel() {
  const { provider, setProvider, model, setModel } = useAIStore(s => ({
    provider: s.provider, setProvider: s.setProvider,
    model:    s.model,    setModel:    s.setModel,
  }))

  // ── Provider catalogue ─────────────────────────────────────
  const AI_PROVIDERS_CFG = [
    {
      id: 'openai', label: 'OpenAI', rk: RUNTIME_KEYS.OPENAI,
      icon: 'Brain', color: 'text-emerald-400', bg: 'bg-emerald-500/8', border: 'border-emerald-500/20',
      placeholder: 'sk-proj-…  or  sk-…',
      keyUrl: 'https://platform.openai.com/api-keys',
      keyLabel: 'platform.openai.com/api-keys',
      models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
      testUrl: 'https://api.openai.com/v1/models',
      testAuth: 'bearer',
      desc: 'GPT-4o · GPT-4o-mini · GPT-4-turbo',
    },
    {
      id: 'openrouter', label: 'OpenRouter', rk: RUNTIME_KEYS.OPENROUTER,
      icon: 'GitBranch', color: 'text-violet-400', bg: 'bg-violet-500/8', border: 'border-violet-500/20',
      placeholder: 'sk-or-v1-…',
      keyUrl: 'https://openrouter.ai/keys',
      keyLabel: 'openrouter.ai/keys',
      models: ['anthropic/claude-3.5-sonnet', 'google/gemini-pro', 'meta-llama/llama-3-70b', 'openai/gpt-4o'],
      testUrl: 'https://openrouter.ai/api/v1/models',
      testAuth: 'bearer',
      desc: 'Unified gateway — 300+ models',
    },
    {
      id: 'groq', label: 'Groq', rk: RUNTIME_KEYS.GROQ,
      icon: 'Zap', color: 'text-amber-400', bg: 'bg-amber-500/8', border: 'border-amber-500/20',
      placeholder: 'gsk_…',
      keyUrl: 'https://console.groq.com/keys',
      keyLabel: 'console.groq.com/keys',
      models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768', 'gemma2-9b-it'],
      testUrl: 'https://api.groq.com/openai/v1/models',
      testAuth: 'bearer',
      desc: 'Ultra-fast inference — free tier available',
    },
    {
      id: 'deepseek', label: 'DeepSeek', rk: RUNTIME_KEYS.DEEPSEEK,
      icon: 'Search', color: 'text-blue-400', bg: 'bg-blue-500/8', border: 'border-blue-500/20',
      placeholder: 'sk-…',
      keyUrl: 'https://platform.deepseek.com',
      keyLabel: 'platform.deepseek.com',
      models: ['deepseek-chat', 'deepseek-reasoner'],
      testUrl: 'https://api.deepseek.com/v1/models',
      testAuth: 'bearer',
      desc: 'DeepSeek-V3 · R1 Reasoner',
    },
    {
      id: 'mistral', label: 'Mistral AI', rk: RUNTIME_KEYS.MISTRAL,
      icon: 'Wind', color: 'text-orange-400', bg: 'bg-orange-500/8', border: 'border-orange-500/20',
      placeholder: 'your-mistral-key',
      keyUrl: 'https://console.mistral.ai/api-keys',
      keyLabel: 'console.mistral.ai/api-keys',
      models: ['mistral-large-latest', 'mistral-small-latest', 'open-mixtral-8x22b', 'codestral-latest'],
      testUrl: 'https://api.mistral.ai/v1/models',
      testAuth: 'bearer',
      desc: 'Mistral Large · Codestral · Mixtral',
    },
    {
      id: 'claude', label: 'Anthropic Claude', rk: RUNTIME_KEYS.ANTHROPIC,
      icon: 'Shield', color: 'text-rose-400', bg: 'bg-rose-500/8', border: 'border-rose-500/20',
      placeholder: 'sk-ant-api03-…',
      keyUrl: 'https://console.anthropic.com/settings/keys',
      keyLabel: 'console.anthropic.com/settings/keys',
      models: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'],
      testUrl: null,  // special — tested via messages endpoint
      testAuth: 'anthropic',
      desc: 'Claude 3.5 Sonnet · Haiku · Opus',
    },
    {
      id: 'gemini', label: 'Google Gemini', rk: RUNTIME_KEYS.GEMINI,
      icon: 'Sparkles', color: 'text-sky-400', bg: 'bg-sky-500/8', border: 'border-sky-500/20',
      placeholder: 'AIzaSy…',
      keyUrl: 'https://aistudio.google.com/app/apikey',
      keyLabel: 'aistudio.google.com/app/apikey',
      models: ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'],
      testUrl: null,  // key goes in query param
      testAuth: 'gemini',
      desc: 'Gemini 2.0 Flash · 1.5 Pro · 1.5 Flash',
    },
    {
      id: 'ollama', label: 'Ollama (Local)', rk: 'ollama_url',
      icon: 'Server', color: 'text-slate-400', bg: 'bg-slate-500/8', border: 'border-slate-500/20',
      placeholder: 'http://localhost:11434',
      keyUrl: 'https://ollama.com',
      keyLabel: 'ollama.com — install locally',
      models: ['llama3.2', 'llama3.1', 'mistral', 'phi3', 'gemma2', 'qwen2.5', 'deepseek-r1'],
      testUrl: null,
      testAuth: 'ollama',
      desc: 'Fully local — no API key required',
      isUrl: true,
    },
  ]

  // ── State ──────────────────────────────────────────────────
  const [keys,     setKeys]     = useState(() => {
    const init = {}
    AI_PROVIDERS_CFG.forEach(p => {
      init[p.id] = getRuntimeKey(p.rk) || ''
    })
    return init
  })
  const [saved,    setSaved]    = useState({})   // { id: bool }
  const [showKey,  setShowKey]  = useState({})   // { id: bool }
  const [testing,  setTesting]  = useState(null)
  const [testRes,  setTestRes]  = useState({})   // { id: 'ok'|'fail'|'no_key' }
  const [saveAll,  setSaveAll]  = useState(false)
  const [expanded, setExpanded] = useState({})   // { id: bool } — which cards are open

  // ── Helpers ────────────────────────────────────────────────
  const handleChange = (id, val) => setKeys(prev => ({ ...prev, [id]: val }))

  const handleSave = (p) => {
    setRuntimeKey(p.rk, keys[p.id])
    setSaved(prev => ({ ...prev, [p.id]: true }))
    setTimeout(() => setSaved(prev => ({ ...prev, [p.id]: false })), 2200)
  }

  const handleSaveAll = () => {
    AI_PROVIDERS_CFG.forEach(p => {
      if (keys[p.id] !== undefined) setRuntimeKey(p.rk, keys[p.id])
    })
    setSaveAll(true)
    setTimeout(() => setSaveAll(false), 2200)
  }

  const handleClear = (p) => {
    setRuntimeKey(p.rk, '')
    setKeys(prev => ({ ...prev, [p.id]: '' }))
    setTestRes(prev => ({ ...prev, [p.id]: undefined }))
  }

  const handleTest = async (p) => {
    const key = keys[p.id].trim() || getRuntimeKey(p.rk)
    if (!key && p.id !== 'ollama') {
      setTestRes(prev => ({ ...prev, [p.id]: 'no_key' }))
      return
    }
    setTesting(p.id)
    try {
      let ok = false
      if (p.testAuth === 'bearer' && p.testUrl) {
        const res = await fetch(p.testUrl, {
          headers: { Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(9000),
        })
        ok = res.ok
      } else if (p.testAuth === 'anthropic') {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': key,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'claude-3-haiku-20240307', max_tokens: 1,
            messages: [{ role: 'user', content: 'ping' }],
          }),
          signal: AbortSignal.timeout(9000),
        })
        ok = res.status !== 401 && res.status !== 403
      } else if (p.testAuth === 'gemini') {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`,
          { signal: AbortSignal.timeout(9000) }
        )
        ok = res.ok
      } else if (p.testAuth === 'ollama') {
        const base = (keys[p.id].trim() || 'http://localhost:11434').replace(/\/$/, '')
        const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(5000) })
        ok = res.ok
      }
      setTestRes(prev => ({ ...prev, [p.id]: ok ? 'ok' : 'fail' }))
    } catch {
      setTestRes(prev => ({ ...prev, [p.id]: 'fail' }))
    } finally {
      setTesting(null)
    }
  }

  const toggleExpand = (id) => setExpanded(prev => ({ ...prev, [id]: !prev[id] }))

  const configuredCount = AI_PROVIDERS_CFG.filter(p => !!getRuntimeKey(p.rk)).length
  const currentModels   = AI_PROVIDERS_CFG.find(p => p.id === provider)?.models || []

  // ── Render ─────────────────────────────────────────────────
  return (
    <div className="space-y-0">

      {/* ── Section header ── */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <SectionHead label="AI Provider Keys" />
          <p className="text-2xs text-slate-600 mt-1">
            {configuredCount > 0
              ? <><span className="text-emerald-400 font-semibold">{configuredCount}</span> provider{configuredCount !== 1 ? 's' : ''} configured — keys stored locally in your browser</>
              : 'No keys configured — add at least one provider key to enable AI features'}
          </p>
        </div>
        <button
          onClick={handleSaveAll}
          className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all flex items-center gap-2 flex-shrink-0 ${
            saveAll
              ? 'bg-emerald-500/20 border border-emerald-500/30 text-emerald-300'
              : 'bg-cyan-500/15 border border-cyan-500/25 text-cyan-300 hover:bg-cyan-500/25'
          }`}
        >
          <Icon name={saveAll ? 'CheckCircle2' : 'Save'} size={13} />
          {saveAll ? 'All Saved!' : 'Save All'}
        </button>
      </div>

      {/* ── No-key alert ── */}
      {configuredCount === 0 && (
        <div className="mb-5 flex items-start gap-3 p-4 rounded-xl bg-amber-500/6 border border-amber-500/20">
          <Icon name="AlertTriangle" size={16} className="text-amber-400 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-amber-300 mb-1">AI Features Disabled</p>
            <p className="text-xs text-amber-400/70 leading-relaxed">
              Enter at least one API key below. <strong className="text-amber-300">Groq</strong> has a generous free tier —
              create an account at <a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer"
                className="underline text-amber-300 hover:text-amber-200">console.groq.com/keys</a> and paste the key to get started instantly.
            </p>
          </div>
        </div>
      )}

      {/* ── Provider cards ── */}
      <div className="space-y-2 mb-6">
        {AI_PROVIDERS_CFG.map(p => {
          const storedKey  = getRuntimeKey(p.rk)
          const hasKey     = !!storedKey
          const isActive   = provider === p.id
          const tr         = testRes[p.id]
          const isExpanded = expanded[p.id] !== false  // default open
          const keyVal     = keys[p.id] ?? ''
          const isTesting  = testing === p.id

          return (
            <div key={p.id} className={`rounded-xl border overflow-hidden transition-all ${
              isActive
                ? `${p.bg} ${p.border}`
                : hasKey
                  ? 'bg-slate-900/50 border-slate-700/50 hover:border-slate-600/60'
                  : 'bg-slate-900/30 border-slate-800/50 hover:border-slate-700/40'
            }`}>

              {/* ── Card header ── */}
              <div className="flex items-center gap-3 px-4 py-3">
                {/* Status dot */}
                <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                  tr === 'ok'   ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]' :
                  tr === 'fail' ? 'bg-red-400' :
                  hasKey        ? 'bg-emerald-400/60' :
                                  'bg-slate-700'
                }`} />

                {/* Provider icon + name */}
                <div className="flex-1 flex items-center gap-3 min-w-0">
                  <div className={`w-7 h-7 rounded-lg ${p.bg} border ${p.border} flex items-center justify-center flex-shrink-0`}>
                    <Icon name={p.icon} size={14} className={p.color} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-sm font-semibold ${isActive ? p.color : 'text-white'}`}>{p.label}</span>
                      {isActive && (
                        <span className={`text-2xs px-1.5 py-0.5 rounded ${p.bg} border ${p.border} ${p.color} font-semibold`}>
                          Active
                        </span>
                      )}
                      {hasKey && tr !== 'ok' && tr !== 'fail' && (
                        <span className="text-2xs text-emerald-400/80">Key set</span>
                      )}
                      {tr === 'ok'   && <span className="text-2xs text-emerald-400 font-medium">✓ Verified</span>}
                      {tr === 'fail' && <span className="text-2xs text-red-400 font-medium">✗ Invalid key</span>}
                      {tr === 'no_key' && <span className="text-2xs text-amber-400 font-medium">Enter a key first</span>}
                    </div>
                    <p className="text-2xs text-slate-600 truncate">{p.desc}</p>
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {/* Set as active */}
                  {!isActive && (
                    <button
                      onClick={() => { setProvider(p.id); setModel(p.models[0]) }}
                      className="px-2.5 py-1.5 rounded-lg text-2xs font-medium text-slate-500 hover:text-slate-200 bg-slate-800/40 hover:bg-slate-700/60 border border-slate-700/30 transition-colors"
                    >
                      Set Active
                    </button>
                  )}
                  {/* Test */}
                  <button
                    onClick={() => handleTest(p)}
                    disabled={isTesting}
                    className="px-2.5 py-1.5 rounded-lg text-2xs font-medium text-slate-400 hover:text-slate-200 bg-slate-800/40 hover:bg-slate-700/60 border border-slate-700/30 transition-colors disabled:opacity-40"
                  >
                    {isTesting
                      ? <Icon name="Loader2" size={11} className="animate-spin" />
                      : 'Test'}
                  </button>
                  {/* Expand toggle */}
                  <button
                    onClick={() => toggleExpand(p.id)}
                    className="w-7 h-7 rounded-lg text-slate-600 hover:text-slate-300 bg-slate-800/40 hover:bg-slate-700/60 border border-slate-700/30 flex items-center justify-center transition-colors"
                  >
                    <Icon name={isExpanded ? 'ChevronUp' : 'ChevronDown'} size={13} />
                  </button>
                </div>
              </div>

              {/* ── Expanded: key input ── */}
              {isExpanded && (
                <div className="px-4 pb-4 border-t border-slate-800/40 pt-3 space-y-3">

                  {/* Key / URL input row */}
                  <div>
                    <label className="text-2xs text-slate-500 font-medium mb-1.5 block">
                      {p.isUrl ? 'Base URL' : 'API Key'}
                    </label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <input
                          type={showKey[p.id] || p.isUrl ? 'text' : 'password'}
                          value={keyVal}
                          onChange={e => handleChange(p.id, e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') { handleSave(p); e.target.blur() } }}
                          placeholder={p.placeholder}
                          autoComplete="off"
                          spellCheck={false}
                          className={`w-full bg-slate-800/70 border rounded-lg px-3 py-2.5 text-xs text-white placeholder-slate-700 font-mono focus:outline-none transition-colors ${
                            tr === 'ok'   ? 'border-emerald-500/40 focus:border-emerald-500/60' :
                            tr === 'fail' ? 'border-red-500/40 focus:border-red-500/60' :
                                            'border-slate-700/60 focus:border-cyan-500/50'
                          } ${p.isUrl ? '' : 'pr-9'}`}
                        />
                        {!p.isUrl && (
                          <button
                            onClick={() => setShowKey(prev => ({ ...prev, [p.id]: !prev[p.id] }))}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-700 hover:text-slate-400 transition-colors"
                          >
                            <Icon name={showKey[p.id] ? 'EyeOff' : 'Eye'} size={13} />
                          </button>
                        )}
                      </div>

                      {/* Save */}
                      <button
                        onClick={() => handleSave(p)}
                        className={`px-4 py-2.5 rounded-lg text-xs font-semibold transition-all flex-shrink-0 flex items-center gap-1.5 ${
                          saved[p.id]
                            ? 'bg-emerald-500/20 border border-emerald-500/30 text-emerald-300'
                            : 'bg-cyan-500/15 border border-cyan-500/25 text-cyan-300 hover:bg-cyan-500/25 active:scale-95'
                        }`}
                      >
                        <Icon name={saved[p.id] ? 'Check' : 'Save'} size={12} />
                        {saved[p.id] ? 'Saved' : 'Save'}
                      </button>

                      {/* Clear */}
                      {hasKey && (
                        <button
                          onClick={() => handleClear(p)}
                          className="px-3 py-2.5 rounded-lg text-xs text-slate-600 hover:text-red-400 bg-slate-800/40 hover:bg-red-500/8 border border-slate-700/30 hover:border-red-500/20 transition-all flex-shrink-0"
                          title="Clear key"
                        >
                          <Icon name="Trash2" size={13} />
                        </button>
                      )}
                    </div>

                    {/* Subtext */}
                    <div className="flex items-center justify-between mt-2">
                      <p className="text-2xs text-slate-800">
                        {p.isUrl
                          ? 'Ollama must be running locally with CORS enabled'
                          : 'Stored in browser localStorage · encrypted at rest · never leaves your device'}
                      </p>
                      <a
                        href={p.keyUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-2xs text-slate-700 hover:text-cyan-400 transition-colors font-mono flex items-center gap-1"
                      >
                        <Icon name="ExternalLink" size={10} />
                        {p.keyLabel}
                      </a>
                    </div>
                  </div>

                  {/* Model selector (shown when this provider is active) */}
                  {isActive && (
                    <div className="pt-2 border-t border-slate-800/40">
                      <label className="text-2xs text-slate-500 font-medium mb-1.5 block">Active Model</label>
                      <select
                        value={model || ''}
                        onChange={e => setModel(e.target.value)}
                        className="w-full bg-slate-800/70 border border-slate-700/60 rounded-lg px-3 py-2 text-xs text-white focus:border-cyan-500/50 focus:outline-none"
                      >
                        {p.models.map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* ── Fallback chain info ── */}
      <div className="rounded-xl border border-slate-800/50 bg-slate-900/30 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Icon name="GitBranch" size={13} className="text-slate-500" />
          <span className="text-xs font-semibold text-slate-400">Automatic Fallback Chain</span>
        </div>
        <p className="text-2xs text-slate-600 leading-relaxed">
          If the active provider fails, Apex AI automatically tries the next available provider in order.
          Providers with 3+ consecutive failures enter a 5-minute cooldown before retrying.
          Configure multiple keys for maximum AI uptime.
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          {AI_PROVIDERS_CFG.filter(p => p.id !== 'ollama').map((p, i) => {
            const active = !!getRuntimeKey(p.rk)
            return (
              <div key={p.id} className="flex items-center gap-1.5">
                {i > 0 && <Icon name="ChevronRight" size={11} className="text-slate-800" />}
                <div className={`flex items-center gap-1 text-2xs px-2 py-1 rounded-md border ${
                  active
                    ? `${p.bg} ${p.border} ${p.color}`
                    : 'bg-slate-900/60 border-slate-800/40 text-slate-700'
                }`}>
                  <div className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-current' : 'bg-slate-800'}`} />
                  {p.label}
                </div>
              </div>
            )
          })}
        </div>
      </div>

    </div>
  )
}

// ─── GraphHopper + Map Config Panel ──────────────────────────
function MapPanel() {
  const { provider, setProvider } = useMapStore(s => ({ provider: s.provider, setProvider: s.setProvider }))
  const providers = Object.values(PROVIDER_DEFINITIONS)

  // ── GraphHopper key state ────────────────────────────────
  const [ghKey,     setGhKey]     = useState(() => getRuntimeKey(RUNTIME_KEYS.GRAPHHOPPER) || '')
  const [ghSaving,  setGhSaving]  = useState(false)
  const [ghSaved,   setGhSaved]   = useState(false)
  const [ghTesting, setGhTesting] = useState(false)
  const [ghResult,  setGhResult]  = useState(null)  // { ok, message }

  // ── Other map keys ───────────────────────────────────────
  const [gmKey, setGmKey] = useState(() => getRuntimeKey(RUNTIME_KEYS.GOOGLE_MAPS) || '')
  const [mbKey, setMbKey] = useState(() => getRuntimeKey(RUNTIME_KEYS.MAPBOX) || '')
  const [mapKeySaved, setMapKeySaved] = useState(false)

  // ── Routing constraints ──────────────────────────────────
  const [constraints, setConstraints] = useState(() => getLocalRoutingConstraints())
  const [constraintsSaved, setConstraintsSaved] = useState(false)

  // Load from Supabase on mount
  useEffect(() => {
    loadGraphHopperKey().then(k => { if (k) setGhKey(k) })
    loadRoutingConstraints().then(c => setConstraints(c))
  }, [])

  const handleSaveGH = async () => {
    setGhSaving(true)
    setGhResult(null)
    await saveGraphHopperKey(ghKey)
    if (ghKey && provider !== 'graphhopper') setProvider('graphhopper')
    setGhSaving(false)
    setGhSaved(true)
    setTimeout(() => setGhSaved(false), 3000)
  }

  const handleTestGH = async () => {
    setGhTesting(true)
    setGhResult(null)
    const result = await testGraphHopperKey(ghKey)
    setGhResult(result)
    setGhTesting(false)
  }

  const handleSaveMapKeys = () => {
    setRuntimeKey(RUNTIME_KEYS.GOOGLE_MAPS, gmKey)
    setRuntimeKey(RUNTIME_KEYS.MAPBOX, mbKey)
    setMapKeySaved(true)
    setTimeout(() => setMapKeySaved(false), 2500)
    if (gmKey && provider === 'osm') setProvider('google')
  }

  const handleSaveConstraints = async () => {
    await saveRoutingConstraints(constraints)
    setConstraintsSaved(true)
    setTimeout(() => setConstraintsSaved(false), 2500)
  }

  const CONSTRAINT_DEFS = [
    { key: 'enforceHeightRestrictions', label: 'Enforce height restrictions',   sub: 'Avoid roads with clearance below vehicle height' },
    { key: 'enforceWeightRestrictions', label: 'Enforce weight restrictions',   sub: 'Avoid roads with weight limits below vehicle GVW' },
    { key: 'enforceHazmatRestrictions', label: 'Enforce hazmat restrictions',   sub: 'Avoid hazmat-prohibited roads for flagged vehicles' },
    { key: 'preferTruckRoutes',         label: 'Prefer designated truck routes', sub: 'Route via HGV-friendly corridors where available' },
    { key: 'requestAlternatives',       label: 'Fetch alternative routes',      sub: 'Show up to 3 route options ranked by safety score' },
    { key: 'elevationAnalysis',         label: 'Gradient / elevation analysis', sub: 'Flag steep sections for heavy vehicles' },
    { key: 'avoidTollRoads',            label: 'Avoid toll roads',              sub: 'Prefer toll-free routes (may add journey time)' },
    { key: 'avoidMotorways',            label: 'Avoid motorways',               sub: 'Local/A-road routing only — not recommended for HGV' },
    { key: 'avoidFerries',              label: 'Avoid ferries',                 sub: 'Keep routing land-only' },
  ]

  return (
    <div className="space-y-0">

      {/* ── GraphHopper — Primary Routing Engine ─────────────── */}
      <SectionHead label="GraphHopper — Intelligent Routing Engine" />
      <div className="bg-slate-900/60 border border-cyan-500/20 rounded-xl p-5 mb-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Icon name="Route" size={16} className="text-cyan-400" />
              <span className="text-sm font-semibold text-white">GraphHopper API Key</span>
              {ghKey && <span className="text-2xs bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 rounded-full px-2 py-0.5">Key saved</span>}
            </div>
            <p className="text-xs text-slate-500 leading-relaxed">
              Required for intelligent vehicle-aware routing — enforces height, weight, hazmat and legal restrictions.
              Saved to Supabase so Fleet OS and all Driver PWAs share it automatically.
            </p>
          </div>
          <a href="https://graphhopper.com/#pricing" target="_blank" rel="noopener noreferrer"
            className="text-2xs text-cyan-500 hover:text-cyan-400 flex items-center gap-1 flex-shrink-0 mt-1 whitespace-nowrap">
            Get key <Icon name="ExternalLink" size={9} />
          </a>
        </div>

        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type="password"
              value={ghKey}
              onChange={e => { setGhKey(e.target.value); setGhResult(null) }}
              placeholder="Paste your GraphHopper API key…"
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5 text-xs text-white placeholder-slate-600 focus:border-cyan-500/60 focus:outline-none font-mono pr-8"
            />
            {ghKey && (
              <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleTestGH}
            disabled={!ghKey || ghTesting}
            className={`flex-1 py-2.5 rounded-lg border text-xs font-semibold transition-all flex items-center justify-center gap-2 disabled:opacity-40 ${
              ghResult?.ok === true  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' :
              ghResult?.ok === false ? 'border-red-500/30 bg-red-500/10 text-red-400' :
              'border-slate-700 bg-slate-800/60 text-slate-300 hover:text-white'
            }`}>
            {ghTesting
              ? <><Icon name="Loader2" size={12} className="animate-spin" /> Testing…</>
              : ghResult?.ok === true
              ? <><Icon name="CheckCircle2" size={12} /> Valid</>
              : ghResult?.ok === false
              ? <><Icon name="XCircle" size={12} /> Failed</>
              : <><Icon name="Zap" size={12} /> Test Key</>}
          </button>
          <button
            onClick={handleSaveGH}
            disabled={!ghKey || ghSaving}
            className={`flex-1 py-2.5 rounded-lg border text-xs font-semibold transition-all flex items-center justify-center gap-2 disabled:opacity-40 ${
              ghSaved
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                : 'border-cyan-500/30 bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/15'
            }`}>
            {ghSaving
              ? <><Icon name="Loader2" size={12} className="animate-spin" /> Saving…</>
              : ghSaved
              ? <><Icon name="CheckCircle2" size={12} /> Saved to Fleet!</>
              : <><Icon name="Save" size={12} /> Save to Fleet</>}
          </button>
        </div>

        {ghResult && (
          <div className={`flex items-start gap-2 text-xs rounded-lg p-3 ${
            ghResult.ok
              ? 'bg-emerald-500/8 border border-emerald-500/20 text-emerald-400'
              : 'bg-red-500/8 border border-red-500/20 text-red-400'
          }`}>
            <Icon name={ghResult.ok ? 'CheckCircle2' : 'AlertCircle'} size={13} className="flex-shrink-0 mt-0.5" />
            <span>{ghResult.message}</span>
          </div>
        )}

        <div className="text-2xs text-slate-700 flex items-center gap-1.5">
          <Icon name="Cloud" size={10} />
          Key is saved to Supabase — Fleet OS and Driver PWA automatically pick it up.
        </div>
      </div>

      {/* ── Vehicle Routing Constraints ───────────────────────── */}
      <SectionHead label="Intelligent Routing Constraints" />
      <div className="bg-slate-900/40 border border-slate-800/60 rounded-xl overflow-hidden mb-6">
        <div className="px-4 py-3 border-b border-slate-800/60 flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold text-white">Vehicle & Legal Constraints</div>
            <div className="text-2xs text-slate-600 mt-0.5">Applied fleet-wide when GraphHopper plans routes</div>
          </div>
          <button
            onClick={handleSaveConstraints}
            className={`px-3 py-1.5 rounded-lg border text-2xs font-semibold transition-all flex items-center gap-1.5 ${
              constraintsSaved
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                : 'border-cyan-500/30 bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/15'
            }`}>
            {constraintsSaved
              ? <><Icon name="CheckCircle2" size={10} /> Saved</>
              : <><Icon name="Save" size={10} /> Save</>}
          </button>
        </div>
        {CONSTRAINT_DEFS.map(({ key, label, sub }) => (
          <div key={key} className="flex items-center justify-between px-4 py-3 border-b border-slate-800/40 last:border-0">
            <div>
              <div className="text-xs font-medium text-white">{label}</div>
              <div className="text-2xs text-slate-600 mt-0.5">{sub}</div>
            </div>
            <Toggle
              value={!!constraints[key]}
              onChange={v => setConstraints(p => ({ ...p, [key]: v }))}
            />
          </div>
        ))}
      </div>

      {/* ── Map Provider ──────────────────────────────────────── */}
      <SectionHead label="Map Provider" />
      <div className="grid grid-cols-2 gap-3 mb-6">
        {providers.map(p => {
          const available = p.available()
          const active    = provider === p.id
          return (
            <button key={p.id} onClick={() => setProvider(p.id)}
              className={`p-3 rounded-xl border text-left transition-all ${
                active
                  ? 'bg-cyan-500/10 border-cyan-500/30'
                  : 'bg-slate-900/40 border-slate-800/60 hover:border-slate-700/60'
              }`}>
              <div className="flex items-center justify-between mb-1">
                <span className={`text-sm font-medium ${active ? 'text-cyan-400' : 'text-white'}`}>{p.name}</span>
                {available
                  ? <Badge variant="cyan"  size="sm">Ready</Badge>
                  : <Badge variant="muted" size="sm">No key</Badge>}
              </div>
              <p className="text-2xs text-slate-600 line-clamp-2">{p.attribution?.text || ''}</p>
            </button>
          )
        })}
      </div>

      {/* ── Other API Keys ────────────────────────────────────── */}
      <SectionHead label="Other Map API Keys" />
      <div className="space-y-4 mb-6">
        {[
          { id: 'google', label: 'Google Maps API Key', desc: 'Directions, Places, Geocoding — Google Cloud Console', link: 'https://console.cloud.google.com/apis', val: gmKey, set: setGmKey },
          { id: 'mapbox', label: 'Mapbox Access Token',  desc: 'Dark vector tiles + Mapbox Directions', link: 'https://account.mapbox.com/access-tokens', val: mbKey, set: setMbKey },
        ].map(entry => (
          <div key={entry.id} className="bg-slate-900/40 border border-slate-800/60 rounded-xl p-4 space-y-2.5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-white">{entry.label}</div>
                <div className="text-2xs text-slate-600 mt-0.5">{entry.desc}</div>
              </div>
              <a href={entry.link} target="_blank" rel="noopener noreferrer"
                className="text-2xs text-cyan-500 hover:text-cyan-400 flex items-center gap-1 flex-shrink-0 mt-0.5">
                Get key <Icon name="ExternalLink" size={9} />
              </a>
            </div>
            <input
              type="password"
              value={entry.val}
              onChange={e => entry.set(e.target.value)}
              placeholder={`Paste ${entry.label}…`}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 focus:border-cyan-500/60 focus:outline-none font-mono"
            />
          </div>
        ))}
        <button onClick={handleSaveMapKeys}
          className={`w-full py-2.5 rounded-xl border text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
            mapKeySaved
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
              : 'border-slate-700 bg-slate-800/60 text-slate-300 hover:border-slate-600'
          }`}>
          {mapKeySaved ? <><Icon name="CheckCircle2" size={14} /> Saved!</> : <><Icon name="Save" size={14} /> Save Map Keys</>}
        </button>
        <p className="text-2xs text-slate-700 text-center">
          These keys are stored in your browser only. GraphHopper key above is synced fleet-wide via Supabase.
        </p>
      </div>

      {/* ── OSM Fallback ─────────────────────────────────────── */}
      <SectionHead label="OSM / OSRM Fallback" />
      <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-4 flex items-center gap-3">
        <Icon name="CheckCircle2" size={16} className="text-emerald-400 flex-shrink-0" />
        <div>
          <div className="text-sm font-medium text-emerald-400">Always-on fallback active</div>
          <div className="text-xs text-slate-500 mt-0.5">
            OpenStreetMap + OSRM requires no API key and activates automatically if GraphHopper is unavailable.
          </div>
        </div>
      </div>
    </div>
  )
}

function SecurityPanel({ user }) {
  const navigate = useNavigate()
  const [changing, setChanging] = useState(false)
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' })
  const [msg, setMsg] = useState(null)

  const handlePasswordChange = async (e) => {
    e.preventDefault()
    if (pw.next !== pw.confirm) { setMsg({ type: 'error', text: 'Passwords do not match' }); return }
    setChanging(true)
    try {
      await authService.updatePassword(pw.next)
      setMsg({ type: 'success', text: 'Password updated' })
      setPw({ current: '', next: '', confirm: '' })
    } catch (err) {
      setMsg({ type: 'error', text: err.message })
    } finally { setChanging(false) }
  }

  const handleSignOut = async () => {
    await authService.signOut()
    navigate(ROUTES.AUTH_LOGIN)
  }

  return (
    <div className="space-y-0">
      <SectionHead label="Password" />
      <form onSubmit={handlePasswordChange} className="space-y-3 mb-6">
        {[
          { k: 'current', l: 'Current Password' },
          { k: 'next',    l: 'New Password' },
          { k: 'confirm', l: 'Confirm New Password' },
        ].map(({ k, l }) => (
          <div key={k} className="space-y-1.5">
            <label className="text-xs text-slate-400 font-medium">{l}</label>
            <input type="password" value={pw[k]} onChange={e => setPw(p => ({ ...p, [k]: e.target.value }))}
              className="apex-input" placeholder="••••••••" />
          </div>
        ))}
        {msg && (
          <div className={`flex items-center gap-2 text-xs rounded p-2 ${
            msg.type === 'error' ? 'bg-red-500/5 border border-red-500/20 text-red-400' : 'bg-emerald-500/5 border border-emerald-500/20 text-emerald-400'
          }`}>
            <Icon name={msg.type === 'error' ? 'AlertCircle' : 'CheckCircle2'} size={13} />
            {msg.text}
          </div>
        )}
        <button type="submit" disabled={changing} className="btn-primary text-sm px-4 py-2 disabled:opacity-40">
          {changing ? 'Updating...' : 'Update Password'}
        </button>
      </form>

      <SectionHead label="Session" />
      <SettingRow label="Sign Out" sub="End your current session">
        <button onClick={handleSignOut}
          className="px-4 py-2 text-sm text-red-400 border border-red-500/20 rounded-lg hover:bg-red-500/10 transition-colors">
          Sign Out
        </button>
      </SettingRow>
    </div>
  )
}

function IntegrationsPanel() {
  const integrations = [
    { name: 'Supabase',     icon: 'Database',   status: (() => { try { const s = JSON.parse(localStorage.getItem('apex:supabase:settings') || '{}'); return !!(s.enabled && s.url && s.anonKey); } catch { return !!import.meta.env.VITE_SUPABASE_URL; } })(), desc: 'Database & realtime' },
    { name: 'GraphHopper',  icon: 'Route',       status: !!import.meta.env.VITE_GRAPHHOPPER_API_KEY, desc: 'Primary routing' },
    { name: 'Google Maps',  icon: 'Map',         status: !!import.meta.env.VITE_GOOGLE_MAPS_API_KEY, desc: 'Secondary mapping' },
    { name: 'Mapbox',       icon: 'Globe',       status: !!import.meta.env.VITE_MAPBOX_TOKEN, desc: 'Tile provider' },
    { name: 'OpenAI',       icon: 'Sparkles',    status: !!import.meta.env.VITE_OPENAI_API_KEY, desc: 'AI provider' },
    { name: 'OpenRouter',   icon: 'Shuffle',     status: !!import.meta.env.VITE_OPENROUTER_API_KEY, desc: 'Multi-model AI' },
    { name: 'Groq',         icon: 'Zap',         status: !!import.meta.env.VITE_GROQ_API_KEY, desc: 'Fast inference' },
    { name: 'OSM / OSRM',   icon: 'Navigation',  status: true, desc: 'Always-on fallback' },
  ]

  return (
    <div className="space-y-0">
      <SectionHead label="Connected Services" />
      <div className="space-y-2">
        {integrations.map(i => (
          <div key={i.name} className="flex items-center gap-3 p-3 bg-slate-900/40 border border-slate-800/60 rounded-lg">
            <div className={`w-8 h-8 rounded-lg border flex items-center justify-center flex-shrink-0 ${
              i.status ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-slate-800 border-slate-700'
            }`}>
              <Icon name={i.icon} size={14} className={i.status ? 'text-emerald-400' : 'text-slate-600'} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-white">{i.name}</div>
              <div className="text-xs text-slate-600">{i.desc}</div>
            </div>
            <Badge variant={i.status ? 'cyan' : 'muted'} size="sm">
              {i.status ? 'Connected' : 'Not configured'}
            </Badge>
          </div>
        ))}
      </div>
      <div className="mt-4 text-xs text-slate-600 text-center">
        Add API keys to your <code className="text-cyan-400 font-mono">.env</code> file to enable services.
      </div>
    </div>
  )
}


// ─────────────────────────────────────────────────────────────
// Federation Panel — Apex Command Center Pairing Protocol
// Code format: APEX-XXXXXXXX-XXXX-FC
// ─────────────────────────────────────────────────────────────
// ─── Federation Panel (Stabilized) ───────────────────────────
function FederationPanel() {
  const [status,       setStatus]       = useState('unregistered')
  const [pairingCode,  setPairingCode]  = useState(null)
  const [identity,     setIdentity]     = useState(null)
  const [loading,      setLoading]      = useState(true)
  const [ccUrl,        setCcUrl]        = useState(() => getCommandCenterUrl())
  const [ccUrlInput,   setCcUrlInput]   = useState(() => getCommandCenterUrl())
  const [ccUrlSaved,   setCcUrlSaved]   = useState(false)
  const [ccTestState,  setCcTestState]  = useState(null)
  const [copied,       setCopied]       = useState(null)
  const [countdown,    setCountdown]    = useState('')
  const [regenConfirm, setRegenConfirm] = useState(false)
  const [regening,     setRegening]     = useState(false)
  const [showManual,   setShowManual]   = useState(false)
  const [manualTenant, setManualTenant] = useState('')
  const [manualFleet,  setManualFleet]  = useState('')
  const [manualToken,  setManualToken]  = useState('')
  const [manualErr,    setManualErr]    = useState('')
  const [manualSaving, setManualSaving] = useState(false)
  const [showDisconn,  setShowDisconn]  = useState(false)
  const [showHowTo,    setShowHowTo]    = useState(false)
  const [realtimeOk,   setRealtimeOk]  = useState(false)
  const [reconciling,  setReconciling] = useState(false)

  const reload = useCallback(async (reconcile = false) => {
    setLoading(true)
    try {
      let st
      if (reconcile) {
        setReconciling(true)
        st = await reconcileFederationState()
        setReconciling(false)
      } else {
        st = await getPairingStatus()
      }
      setStatus(st)
      if (st === 'registered') {
        const id = await getRegisteredIdentity()
        setIdentity(id)
        setPairingCode(null)
      } else {
        const code = await ensurePairingCode()
        setPairingCode(code)
        setIdentity(null)
      }
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => { reload(true) }, [reload])

  // Realtime federation sync
  useEffect(() => {
    const unsub = subscribeFederationRealtime((newStatus) => {
      setRealtimeOk(true)
      setStatus(newStatus)
      if (newStatus === 'registered') {
        getRegisteredIdentity().then(id => { setIdentity(id); setPairingCode(null) })
      } else {
        setIdentity(null)
        ensurePairingCode().then(c => setPairingCode(c))
      }
    })
    const t = setTimeout(() => setRealtimeOk(true), 1000)
    return () => { unsub(); clearTimeout(t) }
  }, [status])

  // Reconcile on window focus
  useEffect(() => {
    const onFocus = () => reload(true)
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [reload])

  // Countdown
  useEffect(() => {
    if (!pairingCode?.expiresAt) { setCountdown(''); return }
    const tick = () => {
      const rem = pairingCode.expiresAt - Date.now()
      if (rem <= 0) { setCountdown('Expired'); reload(false); return }
      const m = String(Math.floor(rem / 60000)).padStart(2, '0')
      const s = String(Math.floor((rem % 60000) / 1000)).padStart(2, '0')
      setCountdown(`${m}:${s}`)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [pairingCode, reload])

  // Poll CC URL when pending
  useEffect(() => {
    if (status !== 'pending') return
    const ccU = getCommandCenterUrl()
    if (!ccU || !pairingCode?.code) return
    const id = setInterval(async () => {
      const res = await pollPairingStatus(ccU, pairingCode.code)
      if (res.paired) reload(false)
    }, 10000)
    return () => clearInterval(id)
  }, [status, pairingCode, reload])

  const copyText = (text, key) => {
    navigator.clipboard?.writeText(text).catch(() => {})
    setCopied(key); setTimeout(() => setCopied(null), 2000)
  }

  const handleRegen = async () => {
    if (!regenConfirm) { setRegenConfirm(true); return }
    setRegenConfirm(false); setRegening(true)
    const code = await refreshPairingCode()
    setPairingCode(code); setStatus('pending'); setRegening(false)
  }

  const handleSaveCcUrl = () => {
    try {
      const saved = saveCommandCenterUrl(ccUrlInput)
      setCcUrl(saved); setCcUrlSaved(true)
      setTimeout(() => setCcUrlSaved(false), 2000)
    } catch (err) { alert(err.message) }
  }

  const handleTestConnection = async () => {
    setCcTestState('testing')
    const res = await testConnection(ccUrlInput || ccUrl)
    setCcTestState(res.ok ? 'ok' : 'fail')
    setTimeout(() => setCcTestState(null), 4000)
  }

  const handleManualPair = async () => {
    setManualErr('')
    if (!manualTenant || !manualFleet || !manualToken) {
      setManualErr('All three fields are required.'); return
    }
    setManualSaving(true)
    await markAsRegistered(manualTenant.trim(), manualFleet.trim(), manualToken.trim())
    if (ccUrlInput) { try { saveCommandCenterUrl(ccUrlInput) } catch {} }
    setShowManual(false); setManualSaving(false); reload(false)
  }

  const handleDisconnect = async () => {
    if (!showDisconn) { setShowDisconn(true); return }
    await disconnect(); setShowDisconn(false); reload(false)
  }

  const isExpired = countdown === 'Expired' || !pairingCode?.expiresAt
  const attempts  = parseInt(localStorage.getItem(FC_KEYS.ATTEMPTS) || '0', 10)
  const isLocked  = attempts >= 5

  const statusDot = {
    registered:   { color: 'bg-emerald-400', pulse: true,  label: 'Connected to Apex Command Center',   sub: 'Fleet is live and syncing telemetry via Supabase',                          textColor: 'text-emerald-300' },
    pending:      { color: 'bg-amber-400',   pulse: true,  label: 'Awaiting pairing in Command Center',  sub: 'Enter the code in Apex Command Center → Tenants → Register Fleet',          textColor: 'text-amber-300' },
    unregistered: { color: 'bg-slate-500',   pulse: false, label: 'Not yet registered',                  sub: 'Generate a pairing code to connect this fleet',                             textColor: 'text-slate-400' },
  }[status] || { color: 'bg-slate-500', pulse: false, label: 'Unknown', sub: '', textColor: 'text-slate-400' }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Icon name="Loader2" size={20} className="animate-spin text-violet-400" />
        <span className="ml-3 text-sm text-slate-500">
          {reconciling ? 'Reconciling federation state from Supabase…' : 'Loading federation status…'}
        </span>
      </div>
    )
  }

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-sm font-bold text-white">Command Center Pairing</h2>
          <p className="text-xs text-slate-500 mt-1">Connect this Fleet Control OS to Apex Command Center.</p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0 ml-4">
          <div className={`w-1.5 h-1.5 rounded-full ${realtimeOk ? 'bg-cyan-400 animate-pulse' : 'bg-slate-600'}`} />
          <span className="text-2xs text-slate-600">{realtimeOk ? 'Realtime sync active' : 'Connecting…'}</span>
        </div>
      </div>

      {/* Status bar */}
      <div className={`flex items-center gap-3 p-4 rounded-xl border ${
        status === 'registered' ? 'bg-emerald-500/5 border-emerald-500/20'
        : status === 'pending'  ? 'bg-amber-500/5 border-amber-500/20'
        : 'bg-slate-900/40 border-slate-800/60'
      }`}>
        <div className="relative flex-shrink-0">
          <div className={`w-3 h-3 rounded-full ${statusDot.color}`} />
          {statusDot.pulse && (
            <div className={`absolute inset-0 w-3 h-3 rounded-full ${statusDot.color} opacity-60 animate-ping`} />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className={`text-sm font-semibold ${statusDot.textColor}`}>{statusDot.label}</div>
          <div className="text-2xs text-slate-500 mt-0.5">{statusDot.sub}</div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {status === 'registered' && (
            <button onClick={handleDisconnect}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                showDisconn ? 'bg-red-500/15 border-red-500/30 text-red-400' : 'border-slate-700 text-slate-500 hover:text-red-400 hover:border-red-500/30'
              }`}>
              <Icon name={showDisconn ? 'AlertTriangle' : 'Unplug'} size={11} />
              {showDisconn ? 'Confirm?' : 'Disconnect'}
            </button>
          )}
          <button onClick={() => reload(true)}
            className="p-1.5 rounded-lg border border-slate-800 text-slate-600 hover:text-slate-400 hover:border-slate-700 transition-colors"
            title="Reconcile from Supabase">
            <Icon name="RefreshCw" size={11} />
          </button>
        </div>
      </div>

      {/* Registered identity */}
      {status === 'registered' && identity && (
        <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-5 space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <Icon name="CheckCircle2" size={15} className="text-emerald-400" />
            <span className="text-sm font-semibold text-emerald-300">Fleet Registered</span>
          </div>
          {[
            { label: 'Tenant ID',  val: identity.tenantId },
            { label: 'Fleet ID',   val: identity.fleetId },
            { label: 'Connected',  val: identity.connectedSince ? new Date(identity.connectedSince).toLocaleString() : '—' },
            { label: 'CC Endpoint',val: identity.commandCenterUrl || '(not set)' },
          ].filter(r => r.val).map(({ label, val }) => (
            <div key={label} className="flex items-center justify-between py-2 border-b border-emerald-500/10 last:border-0">
              <span className="text-2xs text-slate-500 uppercase tracking-wider">{label}</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-300 font-mono truncate max-w-[200px]">{val}</span>
                {label !== 'Connected' && (
                  <button onClick={() => copyText(val, label)} className="text-slate-600 hover:text-slate-400">
                    <Icon name={copied === label ? 'Check' : 'Copy'} size={11} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pairing code */}
      {status !== 'registered' && (
        <div className="bg-slate-900/60 border border-slate-800/60 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold text-white">Pairing Code</div>
              <div className="text-2xs text-slate-600 mt-0.5">Saved to Supabase · Expires in 60 min · Max 5 attempts</div>
            </div>
            <div className="flex items-center gap-2">
              {pairingCode?.expiresAt && !isExpired && (
                <div className="flex items-center gap-1 text-2xs text-slate-500">
                  <Icon name="Clock" size={10} />{countdown}
                </div>
              )}
              {isExpired && <span className="text-2xs text-red-400 flex items-center gap-1"><Icon name="AlertCircle" size={10} />Expired</span>}
              {isLocked && <span className="text-2xs text-red-400 flex items-center gap-1"><Icon name="Lock" size={10} />Locked ({attempts}/5)</span>}
            </div>
          </div>

          <div className={`bg-slate-950 border rounded-xl p-4 flex items-center justify-between gap-3 ${
            isExpired || isLocked ? 'border-red-500/20 opacity-60' : 'border-slate-700/60'
          }`}>
            <span className={`font-mono text-sm tracking-widest select-all ${isExpired || isLocked ? 'text-slate-600' : 'text-cyan-300'}`}>
              {pairingCode?.code || '—'}
            </span>
            <button
              onClick={() => pairingCode?.code && copyText(pairingCode.code, 'code')}
              disabled={!pairingCode?.code || isExpired || isLocked}
              className="flex-shrink-0 p-2 rounded-lg border border-slate-700 text-slate-500 hover:text-slate-200 hover:border-slate-600 disabled:opacity-30 transition-colors">
              <Icon name={copied === 'code' ? 'Check' : 'Copy'} size={13} />
            </button>
          </div>

          <p className="text-2xs text-slate-700 text-center font-mono">APEX-[A-Z0-9]{"{8}"}-[A-Z0-9]{"{4}"}-FC</p>

          <button onClick={handleRegen} disabled={regening}
            className={`w-full py-2.5 rounded-xl border text-xs font-semibold transition-all flex items-center justify-center gap-2 disabled:opacity-40 ${
              regenConfirm ? 'border-amber-500/30 bg-amber-500/10 text-amber-400' : 'border-slate-700 bg-slate-800/60 text-slate-400 hover:text-slate-200'
            }`}>
            {regening ? <><Icon name="Loader2" size={12} className="animate-spin" />Generating…</>
            : regenConfirm ? <><Icon name="AlertTriangle" size={12} />Confirm regenerate?</>
            : <><Icon name="RefreshCw" size={12} />Regenerate Code</>}
          </button>
        </div>
      )}

      {/* CC URL */}
      <div className="bg-slate-900/40 border border-slate-800/60 rounded-xl p-4 space-y-3">
        <div className="text-xs font-semibold text-white">Command Center URL</div>
        <div className="flex gap-2">
          <input type="url" value={ccUrlInput} onChange={e => setCcUrlInput(e.target.value)}
            placeholder="https://command.apex.ai"
            className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 focus:border-cyan-500/60 focus:outline-none font-mono" />
          <button onClick={handleTestConnection} disabled={ccTestState === 'testing'}
            className={`px-3 py-2 rounded-lg border text-xs font-semibold transition-colors flex items-center gap-1.5 flex-shrink-0 ${
              ccTestState === 'ok'   ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' :
              ccTestState === 'fail' ? 'border-red-500/30 bg-red-500/10 text-red-400' :
              'border-slate-700 text-slate-400 hover:text-slate-200'
            }`}>
            {ccTestState === 'testing' ? <Icon name="Loader2" size={11} className="animate-spin" />
            : ccTestState === 'ok'     ? <Icon name="CheckCircle2" size={11} />
            : ccTestState === 'fail'   ? <Icon name="XCircle" size={11} />
            : <Icon name="Wifi" size={11} />}
            {ccTestState === 'ok' ? 'Online' : ccTestState === 'fail' ? 'Offline' : 'Test'}
          </button>
          <button onClick={handleSaveCcUrl}
            className={`px-3 py-2 rounded-lg border text-xs font-semibold transition-colors flex-shrink-0 ${
              ccUrlSaved ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' : 'border-cyan-500/30 bg-cyan-500/10 text-cyan-400'
            }`}>
            {ccUrlSaved ? <Icon name="Check" size={11} /> : <Icon name="Save" size={11} />}
          </button>
        </div>
      </div>

      {/* Manual pairing */}
      <div>
        <button onClick={() => setShowManual(p => !p)}
          className="flex items-center gap-2 text-xs text-slate-600 hover:text-slate-400 transition-colors">
          <Icon name={showManual ? 'ChevronUp' : 'ChevronDown'} size={12} />
          Manual pairing (advanced)
        </button>
        {showManual && (
          <div className="mt-3 bg-slate-900/40 border border-slate-800/60 rounded-xl p-4 space-y-3">
            <p className="text-2xs text-slate-600">Enter credentials provided by Apex Command Center manually.</p>
            {[
              { label: 'Tenant ID',    val: manualTenant, set: setManualTenant, ph: 'TENANT-…' },
              { label: 'Fleet ID',     val: manualFleet,  set: setManualFleet,  ph: 'FE-…' },
              { label: 'Pairing Token',val: manualToken,  set: setManualToken,  ph: 'Pairing token from Command Center' },
            ].map(({ label, val, set, ph }) => (
              <div key={label} className="space-y-1">
                <label className="text-2xs text-slate-500 uppercase tracking-wider">{label}</label>
                <input type="text" value={val} onChange={e => set(e.target.value)} placeholder={ph}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 focus:border-violet-500/60 focus:outline-none font-mono" />
              </div>
            ))}
            {manualErr && (
              <div className="text-2xs text-red-400 flex items-center gap-1.5">
                <Icon name="AlertCircle" size={11} />{manualErr}
              </div>
            )}
            <button onClick={handleManualPair} disabled={manualSaving}
              className="w-full py-2 rounded-lg border border-violet-500/30 bg-violet-500/10 text-violet-400 text-xs font-semibold hover:bg-violet-500/15 disabled:opacity-40 transition-colors flex items-center justify-center gap-2">
              {manualSaving ? <><Icon name="Loader2" size={11} className="animate-spin" />Saving…</> : 'Complete Pairing'}
            </button>
          </div>
        )}
      </div>

      {/* How it works */}
      <div>
        <button onClick={() => setShowHowTo(p => !p)}
          className="flex items-center gap-2 text-xs text-slate-600 hover:text-slate-400 transition-colors">
          <Icon name={showHowTo ? 'ChevronUp' : 'ChevronDown'} size={12} />
          How federation pairing works
        </button>
        {showHowTo && (
          <div className="mt-3 bg-slate-900/40 border border-slate-800/60 rounded-xl p-4 space-y-2">
            {[
              ['1', 'A pairing code is generated and saved to Supabase (60 min TTL, 5-attempt lock)'],
              ['2', 'In Apex Command Center → Tenants → Register Fleet, enter the code'],
              ['3', 'Command Center validates format: APEX-[A-Z0-9]{8}-[A-Z0-9]{4}-FC'],
              ['4', 'On acceptance, Supabase realtime notifies this panel automatically'],
              ['5', 'Fleet node registered — telemetry, KPIs, and dispatch sync live'],
            ].map(([n, txt]) => (
              <div key={n} className="flex gap-3">
                <span className="text-2xs font-bold text-violet-400 flex-shrink-0 w-4">{n}</span>
                <span className="text-2xs text-slate-500">{txt}</span>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  )
}

function BackendPanel() {
  const stored = getSupabaseSettings()
  const [url,        setUrl]        = useState(stored.url || '')
  const [anonKey,    setAnonKey]    = useState(stored.anonKey || '')
  const [enabled,    setEnabled]    = useState(stored.enabled || false)
  const [connStatus, setConnStatus] = useState(stored.connectionStatus || 'offline')
  const [testing,    setTesting]    = useState(false)
  const [saveMsg,    setSaveMsg]    = useState(null)
  const [showKey,    setShowKey]    = useState(false)

  // Subscribe to live status events from backendService
  useEffect(() => {
    const unsub = onConnectionStatus((s) => setConnStatus(s))
    return unsub
  }, [])

  // Auto-probe on mount if settings are already saved and enabled
  useEffect(() => {
    const s = getSupabaseSettings()
    if (s.enabled && s.url && s.anonKey) {
      probeConnection()
    }
  }, [])

  const STATUS_CFG = {
    connected:      { color: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/8', label: 'Connected' },
    connecting:     { color: 'text-cyan-400 border-cyan-500/30 bg-cyan-500/8', label: 'Connecting…' },
    offline:        { color: 'text-slate-400 border-slate-700 bg-slate-800/40', label: 'Offline' },
    invalid_config: { color: 'text-amber-400 border-amber-500/30 bg-amber-500/8', label: 'Invalid Config' },
    failed:         { color: 'text-red-400 border-red-500/30 bg-red-500/8', label: 'Connection Failed' },
    sync_delayed:   { color: 'text-amber-400 border-amber-500/30 bg-amber-500/8', label: 'Sync Delayed' },
  }
  const sc = STATUS_CFG[connStatus] || STATUS_CFG.offline

  const handleSave = () => {
    const trimUrl = url.trim()
    const trimKey = anonKey.trim()
    saveSupabaseSettings({ enabled, url: trimUrl, anonKey: trimKey, connectionStatus: connStatus })
    if (enabled && trimUrl && trimKey) {
      // Re-init client with new/saved config then probe
      destroySupabaseClient()
      setTimeout(() => probeConnection(), 200)
    } else if (!enabled) {
      destroySupabaseClient()
      setConnStatus('offline')
    }
    setSaveMsg('Saved')
    setTimeout(() => setSaveMsg(null), 2500)
  }

  const handleTest = async () => {
    const trimUrl = url.trim()
    const trimKey = anonKey.trim()
    if (!trimUrl || !trimKey) {
      setConnStatus('invalid_config')
      return
    }
    setTesting(true)
    setConnStatus('connecting')
    const { ok, error } = await testSupabaseConnection(trimUrl, trimKey)
    if (ok) {
      // Save with enabled=true so probeConnection can init client
      saveSupabaseSettings({ enabled: true, url: trimUrl, anonKey: trimKey, connectionStatus: 'connected' })
      setEnabled(true)
      // Reinit singleton with saved credentials then probe for global status
      destroySupabaseClient()
      await probeConnection()
      setConnStatus('connected')
    } else {
      setConnStatus('failed')
      console.warn('[AP3X:Backend] Connection test failed:', error)
    }
    setTesting(false)
  }

  const handleToggle = (val) => {
    setEnabled(val)
    if (!val) {
      destroySupabaseClient()
      setConnStatus('offline')
    }
  }

  return (
    <div className="space-y-0">
      <SectionHead label="Backend Configuration" />

      {/* Warning */}
      <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20 mb-4">
        <Icon name="AlertTriangle" size={14} className="text-amber-400 mt-0.5 flex-shrink-0" />
        <p className="text-xs text-amber-300/80">
          Live backend mode connects AP3X systems to external Supabase infrastructure.
          Only use your project&apos;s <strong>anon/public key</strong> — never the service_role key.
        </p>
      </div>

      {/* Status badge */}
      <SettingRow label="Connection Status" sub="Real-time backend sync state">
        <span className={`text-xs px-3 py-1 rounded-full border font-semibold uppercase tracking-wide ${sc.color}`}>
          {sc.label}
        </span>
      </SettingRow>

      {/* Enable toggle */}
      <SettingRow label="Enable Live Backend" sub="Connect Fleet Control OS and Driver PWA to Supabase">
        <Toggle value={enabled} onChange={handleToggle} />
      </SettingRow>

      <SectionHead label="Supabase Credentials" />

      {/* URL field */}
      <div className="space-y-1.5 py-2">
        <label className="text-xs text-slate-400 font-medium">Supabase Project URL</label>
        <input
          type="url"
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="https://xxxxxxxxxxxx.supabase.co"
          className="apex-input w-full font-mono text-sm"
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      {/* Anon key field */}
      <div className="space-y-1.5 py-2">
        <div className="flex items-center justify-between">
          <label className="text-xs text-slate-400 font-medium">Supabase Anon Key (public)</label>
          <button
            onClick={() => setShowKey(v => !v)}
            className="text-xs text-slate-600 hover:text-slate-400 flex items-center gap-1"
          >
            <Icon name={showKey ? 'EyeOff' : 'Eye'} size={12} />
            {showKey ? 'Hide' : 'Show'}
          </button>
        </div>
        <input
          type={showKey ? 'text' : 'password'}
          value={anonKey}
          onChange={e => setAnonKey(e.target.value)}
          placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…"
          className="apex-input w-full font-mono text-xs"
          autoComplete="new-password"
          spellCheck={false}
        />
        <p className="text-2xs text-slate-600">
          Found in: Supabase Dashboard → Project Settings → API → Project API keys (anon public)
        </p>
      </div>

      {/* Buttons */}
      <div className="flex items-center gap-3 pt-3">
        <button
          onClick={handleSave}
          className="btn-primary text-sm px-4 py-2"
        >
          Save Configuration
        </button>
        <button
          onClick={handleTest}
          disabled={testing || !url.trim() || !anonKey.trim()}
          className="text-sm px-4 py-2 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800/60 transition-all disabled:opacity-40 flex items-center gap-2"
        >
          {testing && <span className="w-3 h-3 border border-t-cyan-400 border-slate-600 rounded-full animate-spin" />}
          {testing ? 'Testing…' : 'Test Connection'}
        </button>
        {saveMsg && (
          <span className="text-xs text-emerald-400 flex items-center gap-1">
            <Icon name="CheckCircle2" size={13} /> {saveMsg}
          </span>
        )}
      </div>

      <SectionHead label="Database Schema" />
      <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-800/60 text-xs text-slate-500 font-mono space-y-1">
        <div className="text-slate-400 font-semibold mb-1.5">Required tables:</div>
        {['drivers', 'tasks', 'fleet_nodes', 'dashboard_events', 'settings'].map(t => (
          <div key={t} className="flex items-center gap-2">
            <Icon name="Table2" size={10} className="text-slate-600" />
            <span>{t}</span>
          </div>
        ))}
        <div className="text-slate-600 mt-2 font-sans">See supabase_schema.sql for full schema</div>
      </div>
    </div>
  )
}

export default function Settings() {
  const { user } = useAuthStore(s => ({ user: s.user }))
  const [activeTab, setActiveTab] = useState('profile')

  const panels = {
    profile:      <ProfilePanel user={user} />,
    fleet:        <FleetPanel />,
    ai:           <AIPanel />,
    map:          <MapPanel />,
    security:     <SecurityPanel user={user} />,
    integrations: <IntegrationsPanel />,
    federation:   <FederationPanel />,
    backend:      <BackendPanel />,
  }

  return (
    <div className="flex flex-col sm:flex-row h-full min-h-0">
      {/* Sidebar */}
      <div className="w-full sm:w-48 lg:w-52 flex-shrink-0 sm:border-r border-b sm:border-b-0 border-slate-800/60 py-2 sm:py-4 overflow-x-auto sm:overflow-y-auto">
        <div className="px-4 mb-4">
          <h1 className="font-display text-sm font-bold text-white">Settings</h1>
        </div>
        <nav className="flex sm:flex-col gap-0.5 sm:gap-0 px-2 overflow-x-auto sm:overflow-visible scrollbar-none">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setActiveTab(t.key)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === t.key
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/40'
              }`}>
              <Icon name={t.icon} size={14} />
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4 sm:p-6 lg:p-8">
        <div className="max-w-2xl">
          {panels[activeTab]}
        </div>
      </div>
    </div>
  )
}
