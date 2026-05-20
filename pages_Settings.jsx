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
} from './services_federation_pairingEngine'
import apexClient from './services_apex_apexClient'
import { apiUsageTracker } from './services_ai_aiUsageTracker'
import { localRoutingEngine } from './services_routing_localRoutingEngine'
import { authService } from './services_supabase_authService'
import { AI_PROVIDERS } from './services_ai_aiConfig'
import { MAP_PROVIDERS, PROVIDER_DEFINITIONS } from './services_maps_mapProviders'
import { getRuntimeKey, setRuntimeKey, RUNTIME_KEYS } from './services_maps_runtimeKeys'
import { ROUTES } from './config_routes'

// ─── Section tabs ─────────────────────────────────────────────
const TABS = [
  { key: 'profile',      label: 'Profile',       icon: 'User' },
  { key: 'fleet',        label: 'Fleet',         icon: 'Truck' },
  { key: 'ai',           label: 'AI Providers',  icon: 'Brain' },
  { key: 'map',          label: 'Map Config',    icon: 'Map' },
  { key: 'security',     label: 'Security',      icon: 'Shield' },
  { key: 'integrations', label: 'Integrations',  icon: 'Plug' },
  { key: 'federation',   label: 'Federation',    icon: 'Globe2' },
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
    model: s.model, setModel: s.setModel
  }))

  const envKeys = {
    openai:      import.meta.env.VITE_OPENAI_API_KEY,
    openrouter:  import.meta.env.VITE_OPENROUTER_API_KEY,
    groq:        import.meta.env.VITE_GROQ_API_KEY,
    deepseek:    import.meta.env.VITE_DEEPSEEK_API_KEY,
    mistral:     import.meta.env.VITE_MISTRAL_API_KEY,
    ollama:      import.meta.env.VITE_OLLAMA_BASE_URL,
  }

  const PROVIDERS_LIST = [
    { id: 'openai',     label: 'OpenAI',       models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'] },
    { id: 'openrouter', label: 'OpenRouter',   models: ['anthropic/claude-3.5-sonnet', 'google/gemini-pro', 'meta-llama/llama-3-70b'] },
    { id: 'groq',       label: 'Groq',         models: ['llama-3.3-70b-versatile', 'mixtral-8x7b-32768'] },
    { id: 'deepseek',   label: 'DeepSeek',     models: ['deepseek-chat', 'deepseek-reasoner'] },
    { id: 'mistral',    label: 'Mistral AI',   models: ['mistral-large-latest', 'mistral-small-latest'] },
    { id: 'ollama',     label: 'Ollama (Local)', models: ['llama3', 'mistral', 'phi3', 'gemma2'] },
  ]

  const currentModels = PROVIDERS_LIST.find(p => p.id === provider)?.models || []

  return (
    <div className="space-y-0">
      <SectionHead label="AI Provider" />
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
        {PROVIDERS_LIST.map(p => {
          const hasKey = !!envKeys[p.id]
          const active = provider === p.id
          return (
            <button key={p.id} onClick={() => { setProvider(p.id); setModel(p.models[0]) }}
              className={`p-3 rounded-xl border text-left transition-all ${
                active
                  ? 'bg-cyan-500/10 border-cyan-500/30 shadow-[0_0_20px_rgba(0,212,255,0.05)]'
                  : 'bg-slate-900/40 border-slate-800/60 hover:border-slate-700/60'
              }`}>
              <div className="flex items-center justify-between mb-2">
                <span className={`text-sm font-medium ${active ? 'text-cyan-400' : 'text-white'}`}>{p.label}</span>
                {hasKey
                  ? <Badge variant="cyan" size="sm"><Icon name="CheckCircle2" size={9} />Ready</Badge>
                  : <Badge variant="muted" size="sm">No key</Badge>}
              </div>
              {active && <div className="text-2xs text-slate-500">Active provider</div>}
            </button>
          )
        })}
      </div>

      <SectionHead label="Model" />
      <SettingRow label="Active Model" sub="Model used for all AI features">
        <select value={model || ''} onChange={e => setModel(e.target.value)} className="apex-input w-64 text-sm py-1.5">
          {currentModels.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </SettingRow>

      <SectionHead label="API Keys" />
      <div className="bg-slate-900/40 border border-slate-800/60 rounded-lg p-4 space-y-1">
        <p className="text-xs text-slate-500 mb-3">
          API keys are loaded from environment variables. Set them in your <code className="text-cyan-400 font-mono">.env</code> file.
        </p>
        {Object.entries(envKeys).map(([key, val]) => (
          <div key={key} className="flex items-center gap-2 text-xs">
            <Icon name={val ? 'CheckCircle2' : 'Circle'} size={12}
              className={val ? 'text-emerald-400' : 'text-slate-700'} />
            <code className="text-slate-400 font-mono">VITE_{key.toUpperCase()}_API_KEY</code>
            <span className={`ml-auto ${val ? 'text-emerald-400' : 'text-slate-700'}`}>
              {val ? 'Set' : 'Not set'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function MapPanel() {
  const { provider, setProvider } = useMapStore(s => ({ provider: s.provider, setProvider: s.setProvider }))
  const providers = Object.values(PROVIDER_DEFINITIONS)

  // Runtime API key state — reads from localStorage, updates live
  const [ghKey,   setGhKey]  = useState(() => getRuntimeKey(RUNTIME_KEYS.GRAPHHOPPER) || '')
  const [gmKey,   setGmKey]  = useState(() => getRuntimeKey(RUNTIME_KEYS.GOOGLE_MAPS) || '')
  const [mbKey,   setMbKey]  = useState(() => getRuntimeKey(RUNTIME_KEYS.MAPBOX) || '')
  const [saved,   setSaved]  = useState(false)
  const [testing, setTesting] = useState(null) // 'graphhopper'|'google'|null
  const [testRes, setTestRes] = useState({})   // { graphhopper: 'ok'|'fail', google: 'ok'|'fail' }

  const saveKeys = () => {
    setRuntimeKey(RUNTIME_KEYS.GRAPHHOPPER, ghKey)
    setRuntimeKey(RUNTIME_KEYS.GOOGLE_MAPS, gmKey)
    setRuntimeKey(RUNTIME_KEYS.MAPBOX,      mbKey)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
    // Force provider re-check
    if (ghKey && provider !== 'graphhopper') setProvider('graphhopper')
    else if (gmKey && provider === 'osm')    setProvider('google')
  }

  const testKey = async (which) => {
    setTesting(which)
    try {
      if (which === 'graphhopper') {
        const key = ghKey || getRuntimeKey(RUNTIME_KEYS.GRAPHHOPPER)
        const r = await fetch(`https://graphhopper.com/api/1/geocode?q=London&key=${key}&limit=1`)
        setTestRes(p => ({ ...p, graphhopper: r.ok ? 'ok' : 'fail' }))
      } else if (which === 'google') {
        const key = gmKey || getRuntimeKey(RUNTIME_KEYS.GOOGLE_MAPS)
        const r = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=London&key=${key}`)
        const d = await r.json()
        setTestRes(p => ({ ...p, google: d.status === 'OK' || d.status === 'ZERO_RESULTS' ? 'ok' : 'fail' }))
      }
    } catch { setTestRes(p => ({ ...p, [which]: 'fail' })) }
    setTesting(null)
  }

  const API_ENTRIES = [
    {
      id:    'graphhopper',
      label: 'GraphHopper API Key',
      desc:  'Primary routing engine — turn-by-turn, isochrones, matrix',
      link:  'https://graphhopper.com/#pricing',
      val:   ghKey, set: setGhKey,
      test:  () => testKey('graphhopper'),
      testState: testRes.graphhopper,
    },
    {
      id:    'google',
      label: 'Google Maps API Key',
      desc:  'Directions, Places, Geocoding API — enable in Google Cloud Console',
      link:  'https://console.cloud.google.com/apis',
      val:   gmKey, set: setGmKey,
      test:  () => testKey('google'),
      testState: testRes.google,
    },
    {
      id:    'mapbox',
      label: 'Mapbox Access Token',
      desc:  'Dark vector tiles + Mapbox Directions',
      link:  'https://account.mapbox.com/access-tokens',
      val:   mbKey, set: setMbKey,
      test:  null,
      testState: null,
    },
  ]

  return (
    <div className="space-y-0">
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

      <SectionHead label="API Keys" />
      <div className="space-y-4 mb-6">
        {API_ENTRIES.map(entry => (
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
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type="password"
                  value={entry.val}
                  onChange={e => entry.set(e.target.value)}
                  placeholder={entry.val ? '••••••••••••••••' : `Paste ${entry.label}…`}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 focus:border-cyan-500/60 focus:outline-none font-mono pr-8"
                />
                {entry.val && (
                  <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  </div>
                )}
              </div>
              {entry.test && (
                <button onClick={entry.test} disabled={!entry.val || testing === entry.id}
                  className={`px-3 py-2 rounded-lg border text-xs font-semibold transition-colors flex items-center gap-1.5 flex-shrink-0 ${
                    entry.testState === 'ok'   ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' :
                    entry.testState === 'fail' ? 'border-red-500/30 bg-red-500/10 text-red-400' :
                    'border-slate-700 bg-slate-800/60 text-slate-400 hover:text-slate-200'
                  } disabled:opacity-40`}>
                  {testing === entry.id
                    ? <Icon name="Loader2" size={11} className="animate-spin" />
                    : entry.testState === 'ok'
                    ? <Icon name="CheckCircle2" size={11} />
                    : entry.testState === 'fail'
                    ? <Icon name="XCircle" size={11} />
                    : <Icon name="Zap" size={11} />}
                  {entry.testState === 'ok' ? 'Valid' : entry.testState === 'fail' ? 'Failed' : 'Test'}
                </button>
              )}
            </div>
          </div>
        ))}

        <button onClick={saveKeys}
          className={`w-full py-2.5 rounded-xl border text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
            saved
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
              : 'border-cyan-500/30 bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/15'
          }`}>
          {saved ? <><Icon name="CheckCircle2" size={14} /> Saved!</> : <><Icon name="Save" size={14} /> Save API Keys</>}
        </button>
        <p className="text-2xs text-slate-700 text-center">
          Keys are stored in your browser (localStorage). They are never sent to any server other than the provider's own API.
        </p>
      </div>

      <SectionHead label="OSM / OSRM Fallback" />
      <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-4 flex items-center gap-3">
        <Icon name="CheckCircle2" size={16} className="text-emerald-400 flex-shrink-0" />
        <div>
          <div className="text-sm font-medium text-emerald-400">Always-on fallback active</div>
          <div className="text-xs text-slate-500 mt-0.5">
            OpenStreetMap + OSRM routing requires no API key and is always available as the final fallback.
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
    { name: 'Supabase',     icon: 'Database',   status: !!import.meta.env.VITE_SUPABASE_URL, desc: 'Database & realtime' },
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
function FederationPanel() {
  // ── Pairing state ──────────────────────────────────────────
  const [status,        setStatus]        = useState('unregistered')  // 'unregistered'|'pending'|'registered'
  const [pairingCode,   setPairingCode]   = useState(null)            // { code, expiresAt }
  const [identity,      setIdentity]      = useState(null)            // registered identity
  const [loading,       setLoading]       = useState(true)
  const [ccUrl,         setCcUrl]         = useState(() => getCommandCenterUrl())
  const [ccUrlInput,    setCcUrlInput]    = useState(() => getCommandCenterUrl())
  const [ccUrlSaved,    setCcUrlSaved]    = useState(false)
  const [ccTestState,   setCcTestState]   = useState(null)  // null|'testing'|'ok'|'fail'
  const [copied,        setCopied]        = useState(null)
  const [countdown,     setCountdown]     = useState('')
  const [regenConfirm,  setRegenConfirm]  = useState(false)
  const [regening,      setRegening]      = useState(false)

  // Manual complete-pairing modal
  const [showManual,    setShowManual]    = useState(false)
  const [manualTenant,  setManualTenant]  = useState('')
  const [manualFleet,   setManualFleet]   = useState('')
  const [manualToken,   setManualToken]   = useState('')
  const [manualErr,     setManualErr]     = useState('')
  const [manualSaving,  setManualSaving]  = useState(false)

  // Disconnect confirm
  const [showDisconn,   setShowDisconn]   = useState(false)

  // ── Init ───────────────────────────────────────────────────
  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const st = await getPairingStatus()
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

  useEffect(() => { reload() }, [reload])

  // ── Live countdown ─────────────────────────────────────────
  useEffect(() => {
    if (!pairingCode?.expiresAt) { setCountdown(''); return }
    const tick = () => {
      const rem = pairingCode.expiresAt - Date.now()
      if (rem <= 0) { setCountdown('Expired'); return }
      const m = String(Math.floor(rem / 60000)).padStart(2, '0')
      const s = String(Math.floor((rem % 60000) / 1000)).padStart(2, '0')
      setCountdown(`${m}:${s}`)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [pairingCode])

  // ── Poll for pairing completion every 10s while pending ───
  useEffect(() => {
    if (status !== 'pending') return
    const ccU = getCommandCenterUrl()
    if (!ccU || !pairingCode?.code) return
    const id = setInterval(async () => {
      const res = await pollPairingStatus(ccU, pairingCode.code)
      if (res.paired) reload()
    }, 10000)
    return () => clearInterval(id)
  }, [status, pairingCode, reload])

  // ── Helpers ────────────────────────────────────────────────
  const copyText = (text, key) => {
    navigator.clipboard?.writeText(text).catch(() => {})
    setCopied(key)
    setTimeout(() => setCopied(null), 2000)
  }

  const handleRegen = async () => {
    if (!regenConfirm) { setRegenConfirm(true); return }
    setRegenConfirm(false)
    setRegening(true)
    const code = await refreshPairingCode()
    setPairingCode(code)
    setStatus('pending')
    setRegening(false)
  }

  const handleSaveCcUrl = () => {
    try {
      const saved = saveCommandCenterUrl(ccUrlInput)
      setCcUrl(saved)
      setCcUrlSaved(true)
      setTimeout(() => setCcUrlSaved(false), 2000)
    } catch (err) {
      alert(err.message)
    }
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
    if (ccUrlInput) {
      try { saveCommandCenterUrl(ccUrlInput) } catch {}
    }
    setShowManual(false)
    setManualSaving(false)
    reload()
  }

  const handleDisconnect = () => {
    if (!showDisconn) { setShowDisconn(true); return }
    disconnect()
    setShowDisconn(false)
    reload()
  }

  // ── Formatted code display (spaced) ───────────────────────
  const displayCode = pairingCode?.code
    ? pairingCode.code.split('').join(' ')
    : '— — — —'

  // ── Status dot ────────────────────────────────────────────
  const statusDot = {
    registered:   { color: 'bg-emerald-400', pulse: true,  label: 'Connected to Apex Command Center',  sub: 'Your fleet is live and sending telemetry', textColor: 'text-emerald-300' },
    pending:      { color: 'bg-amber-400',   pulse: true,  label: 'Awaiting pairing in Command Center', sub: 'Enter the code below in Apex Command Center → Tenants → Register Fleet', textColor: 'text-amber-300' },
    unregistered: { color: 'bg-slate-500',   pulse: false, label: 'Not yet registered',                sub: 'Generate a code to begin pairing with Apex Command Center', textColor: 'text-slate-400' },
  }[status] || { color: 'bg-slate-500', pulse: false, label: 'Unknown', sub: '', textColor: 'text-slate-400' }

  // ── Collapsible how-to state ───────────────────────────────
  const [showHowTo, setShowHowTo] = useState(false)

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Icon name="Loader2" size={20} className="animate-spin text-violet-400" />
        <span className="ml-3 text-sm text-slate-500">Loading federation status…</span>
      </div>
    )
  }

  return (
    <div className="space-y-5">

      {/* ── Page header ─────────────────────────────────────── */}
      <div>
        <h2 className="text-sm font-bold text-white">Command Center Pairing</h2>
        <p className="text-xs text-slate-500 mt-1">
          Connect this Fleet Control OS to Apex Command Center for live telemetry, sustainability KPIs, and unified fleet management.
        </p>
      </div>

      {/* ── Connection status bar ────────────────────────────── */}
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
          <div className="text-2xs text-slate-500 mt-0.5 leading-relaxed">{statusDot.sub}</div>
        </div>
        {status === 'registered' && (
          <button onClick={handleDisconnect}
            className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-colors ${
              showDisconn
                ? 'bg-red-500/15 border-red-500/30 text-red-400'
                : 'border-slate-700 text-slate-500 hover:text-red-400 hover:border-red-500/30'
            }`}>
            <Icon name={showDisconn ? 'AlertTriangle' : 'Unplug'} size={11} />
            {showDisconn ? 'Confirm disconnect?' : 'Disconnect'}
          </button>
        )}
      </div>

      {/* ── UNREGISTERED / PENDING: Registration code card ───── */}
      {status !== 'registered' && (
        <div className="bg-[#0d1426] border border-violet-500/25 rounded-xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-5 pt-5 pb-3">
            <div>
              <div className="text-2xs font-semibold text-slate-500 uppercase tracking-[0.2em]">Registration Code</div>
              <div className="text-2xs text-slate-600 mt-0.5">Enter this in Apex Command Center → Tenants → Register Fleet</div>
            </div>
            {countdown && (
              <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-2xs font-mono font-semibold border ${
                countdown === 'Expired'
                  ? 'bg-red-500/10 border-red-500/20 text-red-400'
                  : 'bg-slate-900 border-slate-800 text-slate-400'
              }`}>
                <Icon name="Clock" size={10} />
                {countdown === 'Expired' ? 'Expired' : `Expires in ${countdown}`}
              </div>
            )}
          </div>

          {/* Code display */}
          <div className="px-5 pb-4">
            <div className="bg-slate-950/80 border border-violet-500/15 rounded-xl px-4 py-5 text-center select-all">
              {pairingCode?.code ? (
                <div className="font-mono font-bold text-violet-200 text-xl sm:text-2xl tracking-[0.35em] leading-relaxed break-all">
                  {displayCode}
                </div>
              ) : (
                <div className="text-slate-600 text-sm font-mono">Generating…</div>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 px-5 pb-5">
            <button
              onClick={() => pairingCode?.code && copyText(pairingCode.code, 'code')}
              disabled={!pairingCode?.code}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold border transition-colors flex-1 justify-center ${
                copied === 'code'
                  ? 'bg-emerald-500/15 border-emerald-500/25 text-emerald-400'
                  : 'bg-violet-500/10 border-violet-500/25 text-violet-300 hover:bg-violet-500/20 disabled:opacity-30'
              }`}>
              <Icon name={copied === 'code' ? 'CheckCircle2' : 'Copy'} size={12} />
              {copied === 'code' ? 'Copied!' : 'Copy Code'}
            </button>
            <button
              onClick={handleRegen}
              disabled={regening}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold border transition-colors ${
                regenConfirm
                  ? 'bg-amber-500/10 border-amber-500/25 text-amber-400'
                  : 'border-slate-700 text-slate-500 hover:text-slate-300 hover:border-slate-600'
              }`}>
              <Icon name={regening ? 'Loader2' : 'RefreshCw'} size={12} className={regening ? 'animate-spin' : ''} />
              {regenConfirm ? 'Confirm?' : 'Regenerate'}
            </button>
            <button
              onClick={() => setShowManual(true)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold border border-slate-700 text-slate-500 hover:text-slate-300 hover:border-slate-600 transition-colors">
              <Icon name="KeyRound" size={12} />
              Enter IDs
            </button>
          </div>

          {regenConfirm && (
            <div className="mx-5 mb-4 flex items-start gap-2 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
              <Icon name="AlertTriangle" size={12} className="text-amber-400 flex-shrink-0 mt-0.5" />
              <p className="text-2xs text-amber-300 leading-relaxed">
                Generate a new code? The current one will be invalidated and cannot be used for pairing.
              </p>
            </div>
          )}

          {/* Polling indicator */}
          {status === 'pending' && ccUrl && (
            <div className="mx-5 mb-5 flex items-center gap-2 p-2.5 rounded-lg bg-slate-900/60 border border-slate-800/40">
              <Icon name="Loader2" size={11} className="text-cyan-400 animate-spin flex-shrink-0" />
              <span className="text-2xs text-slate-500">Auto-checking Command Center every 10s…</span>
            </div>
          )}
        </div>
      )}

      {/* ── REGISTERED: Identity panel ────────────────────────── */}
      {status === 'registered' && identity && (
        <div className="bg-[#0d1426] border border-emerald-500/20 rounded-xl p-5 space-y-1">
          <div className="text-2xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Fleet Identity</div>

          {[
            { label: 'Tenant ID',           value: identity.tenantId,         key: 'tid'   },
            { label: 'Fleet Entity ID',      value: identity.fleetId,          key: 'fid'   },
            { label: 'Pairing Token',        value: identity.pairingToken,     key: 'token', mono: true, obscure: true },
            { label: 'Command Center',       value: identity.commandCenterUrl, key: 'ccurl' },
            { label: 'Connected Since',      value: identity.connectedSince ? new Date(identity.connectedSince).toLocaleString() : '—', key: null },
          ].map(row => (
            <div key={row.label} className="flex items-center justify-between py-2.5 border-b border-slate-800/40 last:border-0">
              <div className="min-w-0 flex-1">
                <div className="text-2xs text-slate-500 font-medium">{row.label}</div>
                <div className={`text-xs text-white mt-0.5 truncate ${row.mono ? 'font-mono' : ''}`}>
                  {row.obscure && row.value ? `${row.value.slice(0, 8)}••••••••${row.value.slice(-4)}` : (row.value || '—')}
                </div>
              </div>
              {row.key && row.value && (
                <button onClick={() => copyText(row.value, row.key)}
                  className={`ml-3 flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg border text-2xs transition-colors ${
                    copied === row.key ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/8' : 'border-slate-700 text-slate-500 hover:text-slate-300'
                  }`}>
                  <Icon name={copied === row.key ? 'CheckCircle2' : 'Copy'} size={10} />
                  {copied === row.key ? 'Copied' : 'Copy'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Command Center URL config ────────────────────────── */}
      <div className="bg-[#0d1426] border border-slate-800/60 rounded-xl p-5">
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Apex Command Center URL</div>
        <div className="flex gap-2 mb-2">
          <input
            value={ccUrlInput}
            onChange={e => setCcUrlInput(e.target.value)}
            placeholder="https://your-apex-cc.vercel.app"
            className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-white placeholder-slate-700 focus:border-violet-500 focus:outline-none min-w-0"
          />
          <button onClick={handleSaveCcUrl}
            className={`px-3 py-2 rounded-xl text-xs font-semibold border flex-shrink-0 transition-colors flex items-center gap-1.5 ${
              ccUrlSaved ? 'bg-emerald-500/15 border-emerald-500/25 text-emerald-400' : 'bg-slate-700/60 border-slate-700 text-white hover:bg-slate-700'
            }`}>
            <Icon name={ccUrlSaved ? 'CheckCircle2' : 'Save'} size={11} />
            {ccUrlSaved ? 'Saved' : 'Save'}
          </button>
          <button onClick={handleTestConnection} disabled={ccTestState === 'testing'}
            className={`px-3 py-2 rounded-xl text-xs font-semibold border flex-shrink-0 transition-colors flex items-center gap-1.5 ${
              ccTestState === 'ok'      ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400'
              : ccTestState === 'fail' ? 'bg-red-500/10 border-red-500/25 text-red-400'
              : ccTestState === 'testing' ? 'border-slate-700 text-slate-400'
              : 'border-slate-700 text-slate-400 hover:text-white'
            }`}>
            <Icon name={ccTestState === 'testing' ? 'Loader2' : ccTestState === 'ok' ? 'Wifi' : ccTestState === 'fail' ? 'WifiOff' : 'Zap'}
              size={11} className={ccTestState === 'testing' ? 'animate-spin' : ''} />
            {ccTestState === 'testing' ? 'Testing…' : ccTestState === 'ok' ? 'Connected' : ccTestState === 'fail' ? 'Unreachable' : 'Test'}
          </button>
        </div>
        <p className="text-2xs text-slate-700">Must start with https:// · no trailing slash · used for all API endpoints</p>
      </div>

      {/* ── How to pair (collapsible) ────────────────────────── */}
      <div className="bg-[#0d1426] border border-slate-800/60 rounded-xl overflow-hidden">
        <button onClick={() => setShowHowTo(v => !v)}
          className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-900/30 transition-colors">
          <div className="flex items-center gap-2">
            <Icon name="HelpCircle" size={14} className="text-cyan-400" />
            <span className="text-xs font-semibold text-white">How to pair with Apex Command Center</span>
          </div>
          <Icon name={showHowTo ? 'ChevronUp' : 'ChevronDown'} size={13} className="text-slate-500" />
        </button>
        {showHowTo && (
          <div className="px-5 pb-5 space-y-3 border-t border-slate-800/40">
            {[
              { n: 1, text: 'Copy your registration code using the button above' },
              { n: 2, text: 'Open Apex Command Center OS in your browser' },
              { n: 3, text: 'Go to Tenants → Register Fleet' },
              { n: 4, text: 'Paste your code and complete the fleet details form' },
              { n: 5, text: 'Command Center will display Tenant ID, Fleet ID, and Pairing Token — paste them back using the "Enter IDs" button, or wait for auto-detection (requires CC URL configured above)' },
            ].map(s => (
              <div key={s.n} className="flex items-start gap-3">
                <div className="w-5 h-5 rounded-full bg-violet-500/15 border border-violet-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-2xs font-bold text-violet-400">{s.n}</span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">{s.text}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Manual complete-pairing modal ────────────────────── */}
      {showManual && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#0d1426] border border-slate-800/60 rounded-xl w-full max-w-md">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800/60">
              <div>
                <div className="text-sm font-semibold text-white">Enter Pairing Credentials</div>
                <div className="text-2xs text-slate-500 mt-0.5">Copy from Apex Command Center after registering your fleet</div>
              </div>
              <button onClick={() => setShowManual(false)} className="text-slate-500 hover:text-white p-1">
                <Icon name="X" size={15} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              {[
                { label: 'Tenant ID',    placeholder: 'TENANT-…', val: manualTenant, set: setManualTenant },
                { label: 'Fleet ID',     placeholder: 'FE-… or fleet_…', val: manualFleet, set: setManualFleet },
                { label: 'Pairing Token', placeholder: 'Provided by Command Center', val: manualToken, set: setManualToken },
              ].map(f => (
                <div key={f.label} className="space-y-1.5">
                  <label className="text-2xs text-slate-500 font-medium block">{f.label}</label>
                  <input value={f.val} onChange={e => f.set(e.target.value)} placeholder={f.placeholder}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-white placeholder-slate-700 focus:border-violet-500 focus:outline-none" />
                </div>
              ))}
              {manualErr && (
                <div className="flex items-center gap-2 text-xs text-red-400">
                  <Icon name="AlertCircle" size={12} />
                  {manualErr}
                </div>
              )}
              <div className="flex gap-3 pt-1">
                <button onClick={() => setShowManual(false)} className="flex-1 px-4 py-2 rounded-xl border border-slate-700 text-slate-400 text-xs font-semibold hover:text-white transition-colors">Cancel</button>
                <button onClick={handleManualPair} disabled={manualSaving}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-violet-500/15 border border-violet-500/25 text-violet-300 text-xs font-semibold hover:bg-violet-500/25 transition-colors disabled:opacity-40">
                  <Icon name={manualSaving ? 'Loader2' : 'Link'} size={12} className={manualSaving ? 'animate-spin' : ''} />
                  {manualSaving ? 'Saving…' : 'Complete Pairing'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

// ─── Settings Page ────────────────────────────────────────────
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
  }

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <div className="w-52 flex-shrink-0 border-r border-slate-800/60 py-4">
        <div className="px-4 mb-4">
          <h1 className="font-display text-sm font-bold text-white">Settings</h1>
        </div>
        <nav className="space-y-0.5 px-2">
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
      <div className="flex-1 overflow-auto p-8">
        <div className="max-w-2xl">
          {panels[activeTab]}
        </div>
      </div>
    </div>
  )
}
