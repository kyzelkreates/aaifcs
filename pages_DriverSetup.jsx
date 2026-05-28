import React from 'react'
/**
 * ============================================================
 * APEX AI — Set Driver Up With App
 * /pages/DriverSetup.jsx
 *
 * Full standalone page for:
 *   1. Generating & sharing driver pairing codes (QR, NFC,
 *      WhatsApp, Email, WiFi Direct, Copy)
 *   2. Live pairing status — which drivers are connected
 *   3. Driver AI telemetry feed (safety scores, fatigue)
 *   4. Fleet ↔ Driver message channel
 *   5. Driver AI performance reports
 * ============================================================
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import Icon       from './components_ui_Icon'
import Badge      from './components_ui_Badge'
import StatusDot  from './components_ui_StatusDot'
import { useDriverStore, useFleetStore } from './core_storage'
import { driverService, DRIVER_STATUS } from './services_drivers_driverService'
import { fleetService }                 from './services_fleet_fleetService'
import { formatDateTime }               from './utils_format'
import {
  listenForDriverTelemetry,
  listenForDriverMessages,
  sendFleetReply,
  getDriverMessageHistory,
  listenForDriverAIReports,
  getDriverAIReportHistory,
  listenForPairingEvents,
  sendViaWiFiDirect,
  sendViaNFC,
} from './services_sync_driverSyncService'
import {
  generateSyncCode,
  getActiveSyncCodes,
  revokeSyncCode,
  getSyncCodeQR,
  copySyncCode,
  shareSyncCodeWhatsApp,
  shareSyncCodeEmail,
  shareSyncCodeNative,
  subscribeToDriverEvents,
} from './services_sync_liveSync'


// ─── API Keys Badge ───────────────────────────────────────────
// Shows which API keys will be forwarded to the driver app on pairing
function ApiKeysBadge() {
  const [keys, setKeys] = React.useState([])
  React.useEffect(() => {
    const LS_KEYS = {
      graphhopper: { label: 'GraphHopper', icon: 'Map' },
      google_maps: { label: 'Google Maps', icon: 'Map' },
      openai:      { label: 'OpenAI', icon: 'Brain' },
      openrouter:  { label: 'OpenRouter', icon: 'Network' },
      groq:        { label: 'Groq', icon: 'Zap' },
      deepseek:    { label: 'DeepSeek', icon: 'Brain' },
      mistral:     { label: 'Mistral', icon: 'Brain' },
      anthropic:   { label: 'Anthropic', icon: 'Brain' },
      gemini:      { label: 'Gemini', icon: 'Brain' },
    }
    const found = Object.entries(LS_KEYS)
      .filter(([k]) => localStorage.getItem(`apex_rk_${k}`))
      .map(([, v]) => v.label)
    setKeys(found)
  }, [])

  if (keys.length === 0) return (
    <div className="mt-2 text-2xs text-amber-600 flex items-center gap-1">
      <span>⚠</span> No API keys configured — driver app will use OSM/OSRM only
    </div>
  )
  return (
    <div className="mt-2 flex flex-wrap gap-1 justify-center">
      <span className="text-2xs text-emerald-600">✓ Forwarding {keys.length} API key{keys.length > 1 ? 's' : ''} to driver app:</span>
      {keys.map(k => (
        <span key={k} className="text-2xs text-emerald-400 bg-emerald-500/8 border border-emerald-500/15 px-1.5 rounded font-mono">{k}</span>
      ))}
    </div>
  )
}


// ─── Section wrapper ──────────────────────────────────────────
function Panel({ title, icon, badge, children, className = '' }) {
  return (
    <div className={`bg-[#0d1426] border border-slate-800/60 rounded-xl overflow-hidden ${className}`}>
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-slate-800/50">
        <Icon name={icon} size={15} className="text-violet-400 flex-shrink-0" />
        <span className="text-sm font-semibold text-white flex-1">{title}</span>
        {badge != null && (
          <span className="text-2xs font-bold px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-300 border border-violet-500/20">
            {badge}
          </span>
        )}
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}

// ─── Share method button ──────────────────────────────────────
function ShareBtn({ icon, label, sub, onClick, status, disabled, color = 'violet' }) {
  const colorMap = {
    violet: { ring: 'border-violet-500/30', bg: 'bg-violet-500/10', text: 'text-violet-300', hbg: 'hover:bg-violet-500/20' },
    green:  { ring: 'border-emerald-500/30', bg: 'bg-emerald-500/10', text: 'text-emerald-300', hbg: 'hover:bg-emerald-500/20' },
    blue:   { ring: 'border-blue-500/30', bg: 'bg-blue-500/10', text: 'text-blue-300', hbg: 'hover:bg-blue-500/20' },
    amber:  { ring: 'border-amber-500/30', bg: 'bg-amber-500/10', text: 'text-amber-300', hbg: 'hover:bg-amber-500/20' },
    cyan:   { ring: 'border-cyan-500/30', bg: 'bg-cyan-500/10', text: 'text-cyan-300', hbg: 'hover:bg-cyan-500/20' },
  }
  const c = colorMap[color] || colorMap.violet
  const isOk   = status === 'ok'
  const isFail = status === 'fail'
  const isBusy = status === 'busy'
  return (
    <button
      onClick={onClick}
      disabled={disabled || isBusy}
      className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all
        ${isOk ? 'border-emerald-500/40 bg-emerald-500/8' : isFail ? 'border-red-500/30 bg-red-500/5' : `${c.ring} ${c.bg} ${c.hbg}`}
        disabled:opacity-40 disabled:cursor-not-allowed active:scale-95`}
    >
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
        isOk ? 'bg-emerald-500/20' : isFail ? 'bg-red-500/10' : 'bg-slate-800/60'
      }`}>
        {isBusy
          ? <Icon name="Loader2" size={16} className="text-slate-400 animate-spin" />
          : isOk
            ? <Icon name="CheckCircle2" size={16} className="text-emerald-400" />
            : isFail
              ? <Icon name="XCircle" size={16} className="text-red-400" />
              : <Icon name={icon} size={16} className={c.text} />
        }
      </div>
      <span className={`text-2xs font-semibold ${isOk ? 'text-emerald-300' : isFail ? 'text-red-300' : c.text}`}>
        {isBusy ? 'Sending…' : isOk ? 'Sent!' : isFail ? 'Failed' : label}
      </span>
      {sub && !isOk && !isFail && (
        <span className="text-2xs text-slate-700 text-center leading-tight">{sub}</span>
      )}
    </button>
  )
}

// ─── Active code row ──────────────────────────────────────────
function ActiveCodeRow({ code, onRevoke }) {
  const isExpired = new Date(code.expires_at) < new Date()
  return (
    <div className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border ${
      isExpired ? 'border-slate-800/30 bg-slate-900/20' : 'border-violet-500/15 bg-violet-500/5'
    }`}>
      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isExpired ? 'bg-slate-700' : 'bg-violet-400 shadow-[0_0_6px_rgba(167,139,250,0.7)]'}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono font-bold text-violet-200 truncate">{code.code}</span>
          {code.status === 'active' && <span className="text-2xs text-emerald-400 bg-emerald-500/10 px-1.5 rounded">Paired</span>}
        </div>
        <div className="text-2xs text-slate-600 mt-0.5">
          {code.driver_name || 'Guest'} ·{' '}
          {isExpired
            ? <span className="text-red-500/70">Expired</span>
            : `Expires ${new Date(code.expires_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`}
        </div>
      </div>
      <button
        onClick={() => onRevoke(code.code)}
        className="px-2 py-1 rounded text-2xs text-slate-600 hover:text-red-400 hover:bg-red-500/8 border border-slate-800/40 hover:border-red-500/20 transition-all"
      >
        Revoke
      </button>
    </div>
  )
}

// ─── AI Report card ───────────────────────────────────────────
function AIReportCard({ report }) {
  const score = report.safety_score ?? report.score ?? null
  const scoreColor = score == null ? 'text-slate-500'
    : score >= 85 ? 'text-emerald-400'
    : score >= 65 ? 'text-amber-400'
    : 'text-red-400'
  return (
    <div className="px-3 py-3 rounded-lg border border-slate-800/50 bg-slate-900/30 space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon name="BrainCircuit" size={12} className="text-violet-400" />
          <span className="text-xs font-semibold text-white">
            {report.driver_name || 'Driver'} · {report.vehicle_reg || '—'}
          </span>
        </div>
        {score != null && (
          <span className={`font-mono text-sm font-bold ${scoreColor}`}>{score}</span>
        )}
      </div>
      {report.summary && (
        <p className="text-2xs text-slate-400 leading-relaxed">{report.summary}</p>
      )}
      {report.events && report.events.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-1">
          {report.events.slice(0, 5).map((ev, i) => (
            <span key={i} className="text-2xs px-1.5 py-0.5 rounded bg-red-500/8 border border-red-500/15 text-red-400">
              {ev.type || ev}
            </span>
          ))}
        </div>
      )}
      <div className="text-2xs text-slate-700 pt-0.5">
        {formatDateTime(report.timestamp || report.created_at)}
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────
export default function DriverSetup() {
  const drivers  = useDriverStore(s => s.drivers)
  const vehicles = useFleetStore(s => s.vehicles)

  // ── Load data ─────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      driverService.fetchDrivers()
      await fleetService.fetchVehicles().catch(console.error)
    }
    load()
  }, [])

  // ── Tabs ──────────────────────────────────────────────────
  const [tab, setTab] = useState('setup')   // setup | paired | telemetry | messages | ai_reports

  // ── Code state ────────────────────────────────────────────
  const [codeGenDriver,    setCodeGenDriver]    = useState('')
  const [pairingCode,      setPairingCode]      = useState('')
  const [pairingQR,        setPairingQR]        = useState(null)
  const [pairingDriverName, setPairingDriverName] = useState('')
  const [pairingDriverReg,  setPairingDriverReg]  = useState('')
  const [pairingDriverAppURL, setPairingDriverAppURL] = useState('')
  const [codeExpiry,       setCodeExpiry]       = useState(null)
  const [activeCodes,      setActiveCodes]      = useState(() => getActiveSyncCodes())
  const [copiedCode,       setCopiedCode]       = useState(false)
  const [shareStatus,      setShareStatus]      = useState({})   // { method: 'ok'|'fail'|'busy' }
  const [nfcStatus,        setNfcStatus]        = useState(null)

  // ── Live feeds ────────────────────────────────────────────
  const [telemetry,   setTelemetry]   = useState([])
  const [messages,    setMessages]    = useState(() => getDriverMessageHistory(80))
  const [aiReports,   setAiReports]   = useState(() => getDriverAIReportHistory(80))
  const [replyInput,  setReplyInput]  = useState('')
  const [replyTarget, setReplyTarget] = useState(null)
  const chatEndRef = useRef(null)

  useEffect(() => {
    const u1 = listenForDriverTelemetry(d => setTelemetry(prev => [{ ...d, _ts: Date.now() }, ...prev].slice(0, 120)))
    const u2 = listenForDriverMessages(m => setMessages(prev => [m, ...prev].slice(0, 200)))
    const u3 = listenForDriverAIReports(r => setAiReports(prev => [r, ...prev].slice(0, 200)))
    const u4 = listenForPairingEvents(evt => {
      if (evt.type === 'paired') setActiveCodes(getActiveSyncCodes())
    })
    return () => { u1(); u2(); u3(); u4() }
  }, [])

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages.length])

  // ── Generate code ─────────────────────────────────────────
  const generateCode = useCallback(() => {
    const driver   = drivers.find(d => d.id === codeGenDriver) || null
    const driverId = codeGenDriver || `guest-${Date.now()}`
    const name     = driver?.full_name || 'Guest Driver'
    const reg      = driver?.vehicle_reg || driver?.license_plate || '—'
    const appURL   = `${window.location.origin}/#/driver-app`
    const code     = generateSyncCode(driverId, name, reg, 60)
    const qr       = getSyncCodeQR(code, 240)
    setPairingCode(code)
    setPairingDriverName(name)
    setPairingDriverReg(reg)
    setPairingDriverAppURL(appURL)
    setPairingQR(qr)
    setCodeExpiry(new Date(Date.now() + 60 * 60 * 1000))
    setActiveCodes(getActiveSyncCodes())
    setShareStatus({})
    setNfcStatus(null)
    setCopiedCode(false)
  }, [drivers, codeGenDriver])

  // ── Share handlers ────────────────────────────────────────
  const setMethodStatus = (method, state) =>
    setShareStatus(prev => ({ ...prev, [method]: state }))

  const handleCopy = async () => {
    await copySyncCode(pairingCode)
    setCopiedCode(true)
    setTimeout(() => setCopiedCode(false), 2500)
  }

  const handleWhatsApp = () => {
    shareSyncCodeWhatsApp(pairingCode, pairingDriverName, pairingDriverReg)
    setMethodStatus('whatsapp', 'ok')
    setTimeout(() => setMethodStatus('whatsapp', null), 3000)
  }

  const handleEmail = () => {
    shareSyncCodeEmail(pairingCode, pairingDriverName, pairingDriverReg)
    setMethodStatus('email', 'ok')
    setTimeout(() => setMethodStatus('email', null), 3000)
  }

  const handleWiFi = async () => {
    setMethodStatus('wifi', 'busy')
    const res = await shareSyncCodeNative(pairingCode, pairingDriverName, pairingDriverReg)
    setMethodStatus('wifi', res.ok ? 'ok' : 'fail')
    setTimeout(() => setMethodStatus('wifi', null), 4000)
  }

  const handleNFC = async () => {
    setMethodStatus('nfc', 'busy')
    setNfcStatus('scanning')
    const res = await sendViaNFC(pairingCode, pairingDriverName, st => setNfcStatus(st))
    setMethodStatus('nfc', res.ok ? 'ok' : 'fail')
    setTimeout(() => { setMethodStatus('nfc', null); setNfcStatus(null) }, 5000)
  }

  const handleRevoke = (code) => {
    revokeSyncCode(code)
    setActiveCodes(getActiveSyncCodes())
    if (pairingCode === code) setPairingCode('')
  }

  // ── Send fleet message ────────────────────────────────────
  const sendReply = () => {
    if (!replyInput.trim()) return
    const targetId = replyTarget || messages.find(m => m.from === 'driver')?.driver_id || null
    const msg = sendFleetReply(targetId, replyInput.trim(), false)
    setMessages(prev => [msg, ...prev])
    setReplyInput('')
  }

  // ── Derived ───────────────────────────────────────────────
  const latestByVehicle = telemetry.reduce((a, t) => { if (!a[t.vehicle_id]) a[t.vehicle_id] = t; return a }, {})
  const unreadMsgs      = messages.filter(m => m.from === 'driver').length
  const displayMsgs     = [...messages].reverse()
  const pairedCodes     = activeCodes.filter(c => c.status === 'active')
  const pendingCodes    = activeCodes.filter(c => !c.paired && new Date(c.expires_at) > new Date())

  const TABS = [
    { key: 'setup',      icon: 'KeyRound',     label: 'Setup & Share' },
    { key: 'paired',     icon: 'Link',         label: 'Paired Drivers', badge: pairedCodes.length || null },
    { key: 'telemetry',  icon: 'Gauge',        label: 'Live Telemetry', badge: Object.keys(latestByVehicle).length || null },
    { key: 'messages',   icon: 'MessageSquare',label: 'Messages',       badge: unreadMsgs || null },
    { key: 'ai_reports', icon: 'BrainCircuit', label: 'AI Reports',     badge: aiReports.length || null },
  ]

  return (
    <div className="min-h-full p-4 sm:p-6 space-y-6">

      {/* ── Page header ── */}
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 rounded-xl bg-violet-500/10 border border-violet-500/25 flex items-center justify-center flex-shrink-0">
          <Icon name="Smartphone" size={20} className="text-violet-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">Set Driver Up With App</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Generate pairing codes · share the AP3X Driver app · monitor live driver AI data
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {Object.keys(latestByVehicle).length > 0 && (
            <span className="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-500/8 border border-emerald-500/20 px-3 py-1.5 rounded-lg">
              <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
              {Object.keys(latestByVehicle).length} live
            </span>
          )}
          <span className="text-xs text-slate-600 bg-slate-800/40 border border-slate-700/30 px-3 py-1.5 rounded-lg">
            {pairedCodes.length} paired · {pendingCodes.length} pending
          </span>
        </div>
      </div>

      {/* ── Security notice ── */}
      <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-500/5 border border-amber-500/20">
        <Icon name="ShieldCheck" size={16} className="text-amber-400 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-slate-400 leading-relaxed">
          <strong className="text-amber-300">Security isolation active.</strong>{' '}
          Drivers use the standalone <span className="text-violet-300 font-mono font-semibold">AP3X Driver App</span> —
          a completely separate interface with no access to fleet management, vehicle data, or driver records.
          Pairing codes are one-time-use and expire in 60 minutes.{' '}
          <strong className="text-amber-300">Never share the fleet dashboard URL with drivers.</strong>
        </div>
      </div>

      {/* ── Tab bar ── */}
      <div className="border-b border-slate-800/50">
        <div className="flex gap-0.5 overflow-x-auto scrollbar-none">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold whitespace-nowrap border-b-2 -mb-px transition-all ${
                tab === t.key
                  ? 'text-violet-400 border-violet-400'
                  : 'text-slate-500 border-transparent hover:text-slate-300 hover:border-slate-600'
              }`}>
              <Icon name={t.icon} size={13} />
              {t.label}
              {t.badge != null && t.badge > 0 && (
                <span className={`text-2xs font-bold px-1.5 py-0.5 rounded-full ${
                  tab === t.key ? 'bg-violet-500/20 text-violet-300' : 'bg-slate-700 text-slate-400'
                }`}>{t.badge}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════
          TAB: SETUP & SHARE
      ══════════════════════════════════════════════════════ */}
      {tab === 'setup' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Left: Generate + share */}
          <div className="space-y-5">

            {/* Step 1: Select driver */}
            <Panel title="Step 1 — Select Driver" icon="Users">
              <div className="space-y-3">
                <div>
                  <label className="text-2xs text-slate-500 font-semibold uppercase tracking-wider block mb-1.5">
                    Assign to Driver (optional)
                  </label>
                  <select
                    value={codeGenDriver}
                    onChange={e => setCodeGenDriver(e.target.value)}
                    className="w-full bg-slate-800/60 border border-slate-700/50 rounded-lg px-3 py-2.5 text-sm text-white focus:border-violet-500/50 focus:outline-none"
                  >
                    <option value="">— Walk-in / Guest driver —</option>
                    {drivers.map(d => (
                      <option key={d.id} value={d.id}>
                        {d.full_name}{d.vehicle_reg ? ` · ${d.vehicle_reg}` : ''}
                      </option>
                    ))}
                  </select>
                  <p className="text-2xs text-slate-700 mt-1.5">
                    Assigning to a driver links their telemetry and AI reports to their profile automatically.
                  </p>
                </div>
                <button
                  onClick={generateCode}
                  className="w-full flex items-center justify-center gap-2.5 py-3 rounded-xl bg-violet-500/15 border border-violet-500/30 text-violet-300 text-sm font-semibold hover:bg-violet-500/25 active:scale-[0.99] transition-all"
                >
                  <Icon name="KeyRound" size={16} />
                  Generate Driver Pairing Code
                </button>
              </div>
            </Panel>

            {/* Step 2: Share code */}
            {pairingCode && (
              <Panel title="Step 2 — Share With Driver" icon="Share2">
                <div className="space-y-4">

                  {/* The code itself */}
                  <div className="bg-slate-950 border border-violet-500/25 rounded-xl p-4 text-center">
                    <div className="text-2xs text-slate-600 uppercase tracking-[0.25em] font-semibold mb-2">
                      AP3X Driver Pairing Code
                    </div>
                    <div className="font-mono font-bold text-violet-200 text-lg sm:text-xl tracking-wide break-all select-all leading-relaxed mb-2 text-sm">
                      {pairingCode}
                    </div>
                    {codeExpiry && (
                      <div className="text-2xs text-slate-700 font-mono">
                        Valid 60 min · expires {codeExpiry.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    )}
                    {pairingDriverName && pairingDriverName !== 'Guest Driver' && (
                      <div className="mt-2 text-2xs text-slate-500">
                        Assigned to <span className="text-slate-300 font-medium">{pairingDriverName}</span>
                        {pairingDriverReg !== '—' && <> · {pairingDriverReg}</>}
                      </div>
                    )}
                  </div>

                  {/* App URL copy */}
                  <div className="flex items-center gap-2 bg-slate-800/50 border border-slate-700/40 rounded-lg px-3 py-2">
                    <Icon name="Link" size={12} className="text-slate-500 flex-shrink-0" />
                    <span className="text-2xs text-slate-500 font-mono truncate flex-1">{pairingDriverAppURL}</span>
                    <button
                      onClick={() => navigator.clipboard?.writeText(pairingDriverAppURL)}
                      className="text-2xs text-slate-500 hover:text-cyan-400 transition-colors"
                    >
                      <Icon name="Copy" size={12} />
                    </button>
                  </div>

                  {/* Share methods grid */}
                  <div>
                    <p className="text-2xs text-slate-600 font-semibold uppercase tracking-wider mb-2.5">Share Via</p>
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                      <ShareBtn
                        icon={copiedCode ? 'CheckCircle2' : 'Copy'}
                        label={copiedCode ? 'Copied!' : 'Copy Code'}
                        sub="Clipboard"
                        onClick={handleCopy}
                        status={copiedCode ? 'ok' : null}
                        color="cyan"
                      />
                      <ShareBtn
                        icon="MessageCircle"
                        label="WhatsApp"
                        sub="Opens app"
                        onClick={handleWhatsApp}
                        status={shareStatus.whatsapp}
                        color="green"
                        disabled={!pairingCode}
                      />
                      <ShareBtn
                        icon="Mail"
                        label="Email"
                        sub="Opens client"
                        onClick={handleEmail}
                        status={shareStatus.email}
                        color="blue"
                        disabled={!pairingCode}
                      />
                      <ShareBtn
                        icon="Wifi"
                        label="WiFi Direct"
                        sub="AirDrop/Nearby"
                        onClick={handleWiFi}
                        status={shareStatus.wifi}
                        color="violet"
                        disabled={!pairingCode}
                      />
                      <ShareBtn
                        icon="Nfc"
                        label="NFC"
                        sub="Tap phones"
                        onClick={handleNFC}
                        status={shareStatus.nfc}
                        color="amber"
                        disabled={!pairingCode}
                      />
                      <ShareBtn
                        icon="QrCode"
                        label="QR Code"
                        sub="Scan to open"
                        onClick={() => setTab('_qr')}
                        status={null}
                        color="violet"
                        disabled={!pairingQR}
                      />
                    </div>
                    {nfcStatus === 'scanning' && (
                      <div className="mt-3 flex items-center gap-2 text-xs text-amber-300 bg-amber-500/8 border border-amber-500/20 rounded-lg px-3 py-2">
                        <Icon name="Loader2" size={13} className="animate-spin" />
                        Hold driver's phone to NFC sensor on this device…
                      </div>
                    )}
                  </div>

                  {/* Driver instructions */}
                  <div className="bg-slate-900/50 border border-slate-800/40 rounded-xl p-4 space-y-2">
                    <p className="text-2xs text-slate-500 font-semibold uppercase tracking-wider">Driver Instructions</p>
                    {[
                      { n: '1', text: 'Open the AP3X Driver App link on your phone' },
                      { n: '2', text: 'Tap "Enter Pairing Code" on the welcome screen' },
                      { n: '3', text: `Paste the full APXS-… code in the Driver App` },
                      { n: '4', text: 'Set a PIN and confirm your name — you\'re connected!' },
                    ].map(s => (
                      <div key={s.n} className="flex items-start gap-2.5">
                        <span className="w-5 h-5 rounded-full bg-violet-500/15 border border-violet-500/25 text-violet-400 text-2xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                          {s.n}
                        </span>
                        <span className="text-xs text-slate-400 leading-relaxed">{s.text}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </Panel>
            )}

            {!pairingCode && (
              <div className="flex flex-col items-center justify-center py-10 text-slate-700 gap-3">
                <Icon name="KeyRound" size={32} className="opacity-20" />
                <p className="text-sm">Generate a code above to share the driver app</p>
              </div>
            )}
          </div>

          {/* Right: QR + Active codes */}
          <div className="space-y-5">

            {/* QR Code */}
            {pairingQR?.qrUrl && (
              <Panel title="QR Code — Scan to Open App + Enter Code" icon="QrCode">
                <div className="flex flex-col items-center gap-4">
                  <div className="bg-white p-4 rounded-2xl shadow-[0_0_40px_rgba(167,139,250,0.15)]">
                    <img src={pairingQR.qrUrl} alt="Driver pairing QR code" className="w-52 h-52 block" />
                  </div>
                  <p className="text-2xs text-slate-600 text-center leading-relaxed">
                    Driver scans QR → opens AP3X Driver App → code pre-filled automatically
                  </p>
                  <a
                    href={pairingQR.qrUrl}
                    download={`apex-sync-code-${pairingCode}.png`}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs text-cyan-300 bg-cyan-500/10 border border-cyan-500/20 hover:bg-cyan-500/20 transition-colors"
                  >
                    <Icon name="Download" size={13} /> Download QR
                  </a>
                </div>
              </Panel>
            )}

            {/* Active / pending codes */}
            <Panel title="Active Pairing Codes" icon="Clock" badge={activeCodes.length}>
              {activeCodes.length === 0 ? (
                <p className="text-xs text-slate-700 text-center py-4">No active codes — generate one above</p>
              ) : (
                <div className="space-y-2">
                  {activeCodes.map(code => (
                    <ActiveCodeRow key={code.code} code={code} onRevoke={handleRevoke} />
                  ))}
                </div>
              )}
            </Panel>

            {/* How AP3X works */}
            <Panel title="How AP3X Driver App Works" icon="Info">
              <div className="space-y-3">
                {[
                  { icon: 'Lock', color: 'text-emerald-400', title: 'Secure isolation', desc: 'Driver app is completely separate from fleet management — drivers see only navigation and their own data' },
                  { icon: 'Gauge', color: 'text-cyan-400', title: 'Live telemetry', desc: 'GPS, speed, heading, and AI safety scores stream to fleet dashboard in real time' },
                  { icon: 'BrainCircuit', color: 'text-violet-400', title: 'AI Sentinel onboard', desc: 'Fatigue detection, harsh event monitoring, and driving performance AI run locally on the driver device' },
                  { icon: 'MessageSquare', color: 'text-blue-400', title: 'Two-way messaging', desc: 'Fleet operators and drivers can message each other directly through the paired channel' },
                  { icon: 'Navigation', color: 'text-amber-400', title: 'Smart navigation', desc: 'GraphHopper / Google Maps routing with AI-generated route guidance via Apex RouteMind' },
                ].map(f => (
                  <div key={f.title} className="flex items-start gap-3">
                    <div className="w-7 h-7 rounded-lg bg-slate-800/60 border border-slate-700/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Icon name={f.icon} size={13} className={f.color} />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-white">{f.title}</p>
                      <p className="text-2xs text-slate-500 mt-0.5 leading-relaxed">{f.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          TAB: PAIRED DRIVERS
      ══════════════════════════════════════════════════════ */}
      {tab === 'paired' && (
        <div className="space-y-4">
          {pairedCodes.length === 0 ? (
            <div className="flex flex-col items-center py-16 gap-3 text-slate-700">
              <Icon name="Link" size={36} className="opacity-15" />
              <p className="text-sm">No paired drivers yet</p>
              <button onClick={() => setTab('setup')} className="text-xs text-violet-400 hover:text-violet-300 transition-colors">
                → Go to Setup & Share
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {pairedCodes.map(code => {
                const latestTel = Object.values(latestByVehicle).find(t => t.driver_id === code.driver_id) || null
                return (
                  <div key={code.code} className="bg-[#0d1426] border border-emerald-500/20 rounded-xl p-4 space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                        <Icon name="User" size={16} className="text-emerald-400" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-white">{code.driver_name || 'Driver'}</p>
                        <p className="text-2xs text-slate-500">{code.vehicle_reg || '—'} · Paired</p>
                      </div>
                      <div className="ml-auto w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
                    </div>
                    {latestTel && (
                      <div className="grid grid-cols-3 gap-2">
                        <div className="text-center">
                          <div className="font-mono text-sm font-bold text-white">{latestTel.speed?.toFixed(0) || '—'}</div>
                          <div className="text-2xs text-slate-600">km/h</div>
                        </div>
                        <div className="text-center">
                          <div className={`font-mono text-sm font-bold ${
                            (latestTel.safety_score || 100) >= 85 ? 'text-emerald-400' :
                            (latestTel.safety_score || 100) >= 65 ? 'text-amber-400' : 'text-red-400'
                          }`}>{latestTel.safety_score?.toFixed(0) || '—'}</div>
                          <div className="text-2xs text-slate-600">Safety</div>
                        </div>
                        <div className="text-center">
                          <div className={`font-mono text-sm font-bold ${
                            (latestTel.fatigue_score || 0) < 40 ? 'text-emerald-400' :
                            (latestTel.fatigue_score || 0) < 70 ? 'text-amber-400' : 'text-red-400'
                          }`}>{latestTel.fatigue_score?.toFixed(0) || '—'}</div>
                          <div className="text-2xs text-slate-600">Fatigue</div>
                        </div>
                      </div>
                    )}
                    <button
                      onClick={() => { setReplyTarget(code.driver_id); setTab('messages') }}
                      className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-2xs text-slate-400 hover:text-violet-300 bg-slate-800/40 hover:bg-violet-500/10 border border-slate-700/30 hover:border-violet-500/20 transition-all"
                    >
                      <Icon name="MessageSquare" size={11} /> Message Driver
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          TAB: LIVE TELEMETRY
      ══════════════════════════════════════════════════════ */}
      {tab === 'telemetry' && (
        <div className="space-y-4">
          {/* Live vehicle cards */}
          {Object.keys(latestByVehicle).length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {Object.values(latestByVehicle).map(t => (
                <div key={t.vehicle_id} className="bg-[#0d1426] border border-cyan-500/15 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Icon name="Truck" size={14} className="text-cyan-400" />
                      <span className="text-sm font-semibold text-white">{t.vehicle_reg || t.vehicle_id}</span>
                    </div>
                    <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse shadow-[0_0_6px_rgba(52,211,153,0.8)]" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { label: 'Speed',    val: t.speed != null ? `${t.speed.toFixed(0)} km/h` : '—', color: 'text-white' },
                      { label: 'Safety',   val: t.safety_score != null ? t.safety_score.toFixed(0) : '—',
                        color: t.safety_score >= 85 ? 'text-emerald-400' : t.safety_score >= 65 ? 'text-amber-400' : 'text-red-400' },
                      { label: 'Fatigue',  val: t.fatigue_score != null ? t.fatigue_score.toFixed(0) : '—',
                        color: t.fatigue_score < 40 ? 'text-emerald-400' : t.fatigue_score < 70 ? 'text-amber-400' : 'text-red-400' },
                      { label: 'Heading',  val: t.heading != null ? `${t.heading.toFixed(0)}°` : '—', color: 'text-slate-300' },
                    ].map(m => (
                      <div key={m.label} className="bg-slate-900/50 rounded-lg p-2 text-center">
                        <div className={`font-mono text-sm font-bold ${m.color}`}>{m.val}</div>
                        <div className="text-2xs text-slate-600">{m.label}</div>
                      </div>
                    ))}
                  </div>
                  {t.driver_name && (
                    <p className="text-2xs text-slate-600 text-center">{t.driver_name}</p>
                  )}
                  {t._ts && (
                    <p className="text-2xs text-slate-800 text-center font-mono">
                      {new Date(t._ts).toLocaleTimeString('en-GB', { hour12: false })}
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center py-16 gap-3 text-slate-700">
              <Icon name="Gauge" size={36} className="opacity-15" />
              <p className="text-sm">No live telemetry yet</p>
              <p className="text-xs text-slate-800">Pair a driver and enable GPS in the AP3X Driver App</p>
            </div>
          )}

          {/* Raw feed */}
          {telemetry.length > 0 && (
            <Panel title="Raw Telemetry Feed" icon="Activity" badge={telemetry.length}>
              <div className="space-y-1 max-h-72 overflow-y-auto scrollbar-none">
                {telemetry.slice(0, 40).map((t, i) => (
                  <div key={i} className="flex items-center gap-3 px-2 py-1.5 rounded text-2xs font-mono hover:bg-slate-800/30">
                    <span className="text-slate-700">{new Date(t._ts || t.timestamp).toLocaleTimeString('en-GB')}</span>
                    <span className="text-slate-500">{t.vehicle_reg || t.vehicle_id}</span>
                    <span className="text-white">{t.speed?.toFixed(1)} km/h</span>
                    <span className={t.safety_score >= 85 ? 'text-emerald-400' : t.safety_score >= 65 ? 'text-amber-400' : 'text-red-400'}>
                      ⚡{t.safety_score?.toFixed(0)}
                    </span>
                    {t.lat && <span className="text-slate-700 ml-auto">{t.lat.toFixed(4)}, {t.lng.toFixed(4)}</span>}
                  </div>
                ))}
              </div>
            </Panel>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          TAB: MESSAGES
      ══════════════════════════════════════════════════════ */}
      {tab === 'messages' && (
        <div className="max-w-3xl space-y-4">
          <div className="bg-[#0d1426] border border-slate-800/60 rounded-xl overflow-hidden flex flex-col" style={{ height: '480px' }}>
            <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-none">
              {displayMsgs.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-2 text-slate-700">
                  <Icon name="MessageSquare" size={28} className="opacity-20" />
                  <p className="text-sm">No messages yet — driver messages appear here</p>
                </div>
              ) : (
                displayMsgs.map((msg, i) => {
                  const isFleet = msg.from === 'fleet'
                  return (
                    <div key={i} className={`flex gap-2.5 ${isFleet ? 'flex-row-reverse' : 'flex-row'}`}>
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${
                        isFleet ? 'bg-cyan-500/10 border border-cyan-500/20' : 'bg-violet-500/10 border border-violet-500/20'
                      }`}>
                        <Icon name={isFleet ? 'Building2' : 'User'} size={12}
                          className={isFleet ? 'text-cyan-400' : 'text-violet-400'} />
                      </div>
                      <div className={`max-w-[80%] flex flex-col gap-1 ${isFleet ? 'items-end' : 'items-start'}`}>
                        <div className={`px-3 py-2 rounded-xl text-xs leading-relaxed ${
                          isFleet
                            ? 'bg-cyan-500/10 border border-cyan-500/15 text-cyan-100'
                            : 'bg-[#060b18] border border-slate-800/60 text-slate-300'
                        }`}>
                          {msg.text || msg.content || ''}
                        </div>
                        <div className="flex items-center gap-2 text-2xs text-slate-700">
                          {!isFleet && msg.driver_name && <span>{msg.driver_name}</span>}
                          <span className="font-mono">{msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''}</span>
                          {!isFleet && (
                            <button
                              onClick={() => { setReplyTarget(msg.driver_id); setReplyInput(`@${msg.driver_name || 'Driver'} `) }}
                              className="text-slate-700 hover:text-violet-400 transition-colors"
                            >
                              Reply
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
              <div ref={chatEndRef} />
            </div>
            <div className="flex-shrink-0 p-3 border-t border-slate-800/50">
              {replyTarget && (
                <div className="flex items-center gap-2 text-2xs text-violet-400 mb-2">
                  <Icon name="CornerDownRight" size={11} />
                  Replying to {pairedCodes.find(c => c.driver_id === replyTarget)?.driver_name || 'driver'}
                  <button onClick={() => setReplyTarget(null)} className="ml-auto text-slate-600 hover:text-slate-400">✕</button>
                </div>
              )}
              <div className="flex gap-2">
                <input
                  value={replyInput}
                  onChange={e => setReplyInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply() } }}
                  placeholder="Message to driver…"
                  className="flex-1 bg-slate-800/50 border border-slate-700/50 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 focus:border-violet-500/40 focus:outline-none"
                />
                <button
                  onClick={sendReply}
                  disabled={!replyInput.trim()}
                  className="px-4 py-2 rounded-lg bg-violet-500/15 border border-violet-500/25 text-violet-300 hover:bg-violet-500/25 transition-all disabled:opacity-40"
                >
                  <Icon name="Send" size={14} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          TAB: AI REPORTS
      ══════════════════════════════════════════════════════ */}
      {tab === 'ai_reports' && (
        <div className="space-y-4">
          {aiReports.length === 0 ? (
            <div className="flex flex-col items-center py-16 gap-3 text-slate-700">
              <Icon name="BrainCircuit" size={36} className="opacity-15" />
              <p className="text-sm">No AI reports yet</p>
              <p className="text-xs text-slate-800">Driver AI Sentinel reports will appear here automatically</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {aiReports.map((r, i) => <AIReportCard key={i} report={r} />)}
            </div>
          )}
        </div>
      )}

    </div>
  )
}
