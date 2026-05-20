/**
 * ============================================================
 * APEX AI — AI Command Panel (Run 15)
 * Chat interface for all 5 AI modules.
 * Streams responses · shows provider · tracks usage.
 * ============================================================
 */

import { useState, useRef, useEffect } from 'react'
import Icon from './components_ui_Icon'
import { useAIChat } from './modules_ai_useAIChat'
import { useAIStore } from './core_storage'
import { AI_MODULES } from './services_ai_aiConfig'
import { aiFallbackSystem } from './services_ai_aiFallbackSystem'
import { getRuntimeKey, RUNTIME_KEYS } from './services_maps_runtimeKeys'

// ─── Module definitions ───────────────────────────────────────
const MODULES = [
  {
    id:       null,
    key:      'general',
    label:    'General',
    icon:     'Brain',
    color:    'text-cyan-400',
    bg:       'bg-cyan-500/10',
    border:   'border-cyan-500/20',
    desc:     'General fleet intelligence assistant',
    starters: [
      'Summarise the current fleet status',
      'What are the top safety concerns this week?',
      'Suggest ways to reduce fuel costs',
    ],
  },
  {
    id:       AI_MODULES.APEX_SENTINEL,
    key:      'sentinel',
    label:    'Apex Sentinel',
    icon:     'ShieldAlert',
    color:    'text-red-400',
    bg:       'bg-red-500/10',
    border:   'border-red-500/20',
    desc:     'AI safety monitor — driver behaviour & risk',
    starters: [
      'Analyse recent safety alerts and identify patterns',
      'Which drivers have the highest collision risk?',
      'What proactive steps can reduce harsh braking incidents?',
    ],
  },
  {
    id:       AI_MODULES.APEX_ROUTEMIND,
    key:      'routemind',
    label:    'Apex RouteMind',
    icon:     'Navigation',
    color:    'text-violet-400',
    bg:       'bg-violet-500/10',
    border:   'border-violet-500/20',
    desc:     'AI route optimisation & ETA engine',
    starters: [
      'Optimise a route from Manchester to London avoiding motorways',
      'What time should a vehicle leave Birmingham to arrive by 09:00?',
      'How can we reduce average journey time by 15%?',
    ],
  },
  {
    id:       AI_MODULES.APEX_COMPLIANCE,
    key:      'compliance',
    label:    'Apex Compliance',
    icon:     'ClipboardCheck',
    color:    'text-emerald-400',
    bg:       'bg-emerald-500/10',
    border:   'border-emerald-500/20',
    desc:     'UK/EU regulatory compliance assistant',
    starters: [
      'What are the UK driver hours rules for HGV drivers?',
      'When does a tachograph card need to be replaced?',
      'List the documents an HGV driver must carry at all times',
    ],
  },
  {
    id:       AI_MODULES.APEX_PREDICT,
    key:      'predict',
    label:    'Apex Predict',
    icon:     'TrendingUp',
    color:    'text-amber-400',
    bg:       'bg-amber-500/10',
    border:   'border-amber-500/20',
    desc:     'Predictive analytics & maintenance forecasting',
    starters: [
      'Forecast which vehicles are likely to need maintenance soon',
      'Predict fuel spend for next month based on current usage',
      'Identify drivers at risk of hours violation this week',
    ],
  },
]

// ─── Message bubble ───────────────────────────────────────────
function MessageBubble({ msg, activeModule }) {
  const isUser = msg.role === 'user'
  const mod    = MODULES.find(m => m.id === activeModule) || MODULES[0]

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      {/* Avatar */}
      <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${
        isUser
          ? 'bg-slate-700 border border-slate-600'
          : `${mod.bg} border ${mod.border}`
      }`}>
        {isUser
          ? <Icon name="User" size={13} className="text-slate-400" />
          : <Icon name={mod.icon} size={13} className={mod.color} />
        }
      </div>

      {/* Bubble */}
      <div className={`flex-1 max-w-[85%] ${isUser ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
        <div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
          isUser
            ? 'bg-slate-700/80 border border-slate-600/60 text-white rounded-tr-sm'
            : `${msg.error ? 'bg-red-500/5 border-red-500/20' : 'bg-[#0d1426] border border-slate-800/60'} text-slate-200 rounded-tl-sm`
        }`}>
          {msg.content || (msg.streaming && (
            <span className="flex items-center gap-1.5 text-slate-500">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-bounce" style={{ animationDelay: '300ms' }} />
            </span>
          ))}
          {msg.streaming && msg.content && (
            <span className="inline-block w-0.5 h-4 bg-cyan-400 animate-pulse ml-0.5 align-text-bottom" />
          )}
        </div>
        {/* Meta */}
        <div className={`flex items-center gap-2 px-1 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
          {msg.provider && !msg.streaming && (
            <span className="text-2xs text-slate-700 font-mono">{msg.provider}</span>
          )}
          <span className="text-2xs text-slate-700">
            {msg.ts?.toLocaleTimeString?.('en-GB', { hour12: false, hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      </div>
    </div>
  )
}

// ─── Starter chip ─────────────────────────────────────────────
function StarterChip({ text, onClick }) {
  return (
    <button onClick={() => onClick(text)}
      className="text-xs text-slate-400 border border-slate-800/60 rounded-xl px-3 py-2 bg-slate-900/40 hover:bg-slate-800/60 hover:text-white hover:border-slate-700/60 transition-all text-left leading-snug">
      {text}
    </button>
  )
}

// ─── AI Command Panel ─────────────────────────────────────────
export default function AICommandPanel({ defaultModule = null, compact = false }) {
  const [activeModIdx, setActiveModIdx] = useState(
    defaultModule ? Math.max(0, MODULES.findIndex(m => m.id === defaultModule)) : 0
  )
  const activeMod = MODULES[activeModIdx] || MODULES[0]

  const { messages, streaming, error, sendMessage, clearMessages } = useAIChat(activeMod.id)
  const { provider: storedProvider, tokenUsage } = useAIStore(s => ({
    provider:   s.provider,
    tokenUsage: s.tokenUsage,
  }))

  const [input, setInput] = useState('')
  const bottomRef  = useRef(null)
  const inputRef   = useRef(null)
  const providerStatus = aiFallbackSystem.getStatus()
  const anyAvailable   = providerStatus.some(p => p.available)

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = () => {
    if (!input.trim() || streaming) return
    sendMessage(input.trim())
    setInput('')
    inputRef.current?.focus()
  }

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  const handleModuleSwitch = (idx) => {
    setActiveModIdx(idx)
    clearMessages()
    setInput('')
  }

  return (
    <div className="flex flex-col h-full bg-[#080d1a]">
      {/* Module selector */}
      <div className="flex items-center gap-1 px-4 py-3 border-b border-slate-800/60 overflow-x-auto scrollbar-none flex-shrink-0">
        {MODULES.map((mod, idx) => (
          <button key={mod.key} onClick={() => handleModuleSwitch(idx)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all flex-shrink-0 ${
              activeModIdx === idx
                ? `${mod.bg} border ${mod.border} ${mod.color}`
                : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/40 border border-transparent'
            }`}>
            <Icon name={mod.icon} size={12} />
            {mod.label}
          </button>
        ))}

        {/* Token usage indicator */}
        {tokenUsage.total > 0 && (
          <div className="ml-auto flex-shrink-0 text-2xs text-slate-700 font-mono whitespace-nowrap">
            {tokenUsage.total.toLocaleString()} tokens
          </div>
        )}
      </div>

      {/* No API key warning */}
      {!anyAvailable && (
        <div className="mx-4 mt-3 flex-shrink-0 flex items-start gap-2.5 bg-amber-500/5 border border-amber-500/20 rounded-xl px-4 py-3">
          <Icon name="AlertTriangle" size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
          <div>
            <div className="text-xs font-semibold text-amber-400">No AI keys configured</div>
            <div className="text-xs text-slate-500 mt-0.5">
              Add at least one API key to your <code className="text-slate-400">.env</code> file to activate AI features.
              Go to <span className="text-cyan-400">Settings → AI Providers</span>.
            </div>
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-800">

        {/* Empty state — show starters */}
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-5 py-8">
            <div className={`w-14 h-14 rounded-2xl ${activeMod.bg} border ${activeMod.border} flex items-center justify-center`}>
              <Icon name={activeMod.icon} size={26} className={activeMod.color} />
            </div>
            <div className="text-center">
              <div className={`text-base font-bold ${activeMod.color}`}>{activeMod.label}</div>
              <div className="text-xs text-slate-500 mt-1">{activeMod.desc}</div>
            </div>
            <div className="grid grid-cols-1 gap-2 w-full max-w-md">
              {activeMod.starters.map((s, i) => (
                <StarterChip key={i} text={s} onClick={t => { sendMessage(t) }} />
              ))}
            </div>
          </div>
        )}

        {/* Message list */}
        {messages.map(msg => (
          <MessageBubble key={msg.id} msg={msg} activeModule={activeMod.id} />
        ))}

        {/* Error banner */}
        {error && (
          <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/5 border border-red-500/20 rounded-xl px-4 py-3">
            <Icon name="AlertCircle" size={13} className="flex-shrink-0" />
            {error}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="flex-shrink-0 border-t border-slate-800/60 px-4 py-3">
        {messages.length > 0 && (
          <div className="flex justify-end mb-2">
            <button onClick={clearMessages}
              className="text-2xs text-slate-600 hover:text-slate-400 flex items-center gap-1 transition-colors">
              <Icon name="Trash2" size={10} />Clear chat
            </button>
          </div>
        )}
          {!hasAnyKey && (
            <div className="mx-4 mb-3 flex items-start gap-2.5 p-3 rounded-xl bg-amber-500/8 border border-amber-500/20">
              <Icon name="AlertTriangle" size={14} className="text-amber-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-xs font-semibold text-amber-300">No AI Provider Configured</p>
                <p className="text-2xs text-amber-400/70 mt-1">
                  Add an API key in <strong className="text-amber-300">Settings → AI Providers</strong> to activate AI Intelligence.
                  Supported: OpenAI, Groq (free tier), OpenRouter, DeepSeek, Mistral, Claude, Gemini.
                </p>
              </div>
            </div>
          )}

        <div className={`flex items-end gap-2 bg-slate-900/60 border rounded-2xl px-4 py-2 transition-all ${
          streaming ? 'border-cyan-500/20' : 'border-slate-800/60 focus-within:border-slate-700/60'
        }`}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder={streaming ? 'Thinking…' : `Ask ${activeMod.label}…`}
            disabled={streaming || !anyAvailable}
            rows={1}
            className="flex-1 bg-transparent text-sm text-white placeholder-slate-600 resize-none outline-none leading-relaxed min-h-[24px] max-h-[120px] overflow-y-auto py-1 disabled:opacity-40"
            style={{ fieldSizing: 'content' }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || streaming || !anyAvailable}
            className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 transition-all ${
              input.trim() && !streaming && anyAvailable
                ? `${activeMod.bg} border ${activeMod.border} ${activeMod.color} hover:brightness-125`
                : 'bg-slate-800/60 border border-slate-800 text-slate-600'
            }`}>
            {streaming
              ? <Icon name="Loader2" size={14} className="animate-spin" />
              : <Icon name="ArrowUp" size={14} />
            }
          </button>
        </div>
        <div className="flex items-center justify-between mt-1.5 px-1">
          <span className="text-2xs text-slate-700">Enter to send · Shift+Enter for newline</span>
          <span className={`text-2xs font-mono ${
            anyAvailable ? 'text-slate-700' : 'text-amber-600'
          }`}>{storedProvider || 'openai'}</span>
        </div>
      </div>
    </div>
  )
}
