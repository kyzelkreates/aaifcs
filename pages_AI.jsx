/**
 * ============================================================
 * APEX AI — AI Intelligence Page (Run 15)
 * Hub for all 5 AI modules: General · Sentinel · RouteMind ·
 * Compliance · Predict
 * ============================================================
 */

import { useState } from 'react'
import Icon from './components_ui_Icon'
import AICommandPanel from './modules_ai_AICommandPanel'
import { useAIStore } from './core_storage'
import { aiFallbackSystem } from './services_ai_aiFallbackSystem'
import { AI_MODULES } from './services_ai_aiConfig'

// ─── Provider health strip ────────────────────────────────────
function ProviderHealthStrip() {
  const statuses = aiFallbackSystem.getStatus()
  const available = statuses.filter(s => s.available)

  if (available.length === 0) return null

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {available.map(s => (
        <div key={s.id} className={`flex items-center gap-1.5 text-2xs px-2 py-1 rounded-full border ${
          s.healthy
            ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-400'
            : 'bg-amber-500/5 border-amber-500/20 text-amber-400'
        }`}>
          <div className={`w-1.5 h-1.5 rounded-full ${s.healthy ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'}`} />
          <span className="font-mono capitalize">{s.id}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Module status cards ──────────────────────────────────────
const MODULE_CARDS = [
  { id: AI_MODULES.APEX_SENTINEL,   label: 'Apex Sentinel',   icon: 'ShieldAlert',    color: 'text-red-400',     bg: 'bg-red-500/5',     border: 'border-red-500/15',    desc: 'Real-time driver safety monitoring and risk scoring' },
  { id: AI_MODULES.APEX_ROUTEMIND,  label: 'Apex RouteMind',  icon: 'Navigation',     color: 'text-violet-400',  bg: 'bg-violet-500/5',  border: 'border-violet-500/15', desc: 'Intelligent route optimisation and ETA prediction'    },
  { id: AI_MODULES.APEX_COMPLIANCE, label: 'Apex Compliance', icon: 'ClipboardCheck', color: 'text-emerald-400', bg: 'bg-emerald-500/5', border: 'border-emerald-500/15',desc: 'UK/EU fleet regulatory compliance guidance'           },
  { id: AI_MODULES.APEX_PREDICT,    label: 'Apex Predict',    icon: 'TrendingUp',     color: 'text-amber-400',   bg: 'bg-amber-500/5',   border: 'border-amber-500/15',  desc: 'Predictive analytics and maintenance forecasting'    },
]

export default function AIPage() {
  const { tokenUsage, provider } = useAIStore(s => ({ tokenUsage: s.tokenUsage, provider: s.provider }))
  const [activeCard, setActiveCard] = useState(null)

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-800/60 flex-shrink-0">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 bg-cyan-500/10 border border-cyan-500/20 rounded-xl flex items-center justify-center">
                <Icon name="Brain" size={16} className="text-cyan-400" />
              </div>
              <h1 className="font-display text-xl font-bold text-white">AI Intelligence</h1>
            </div>
            <p className="text-slate-500 text-xs mt-1.5">5 AI modules · Multi-provider fallback chain · Streaming responses</p>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            {tokenUsage.total > 0 && (
              <div className="text-2xs text-slate-600 font-mono">{tokenUsage.total.toLocaleString()} tokens used</div>
            )}
            <div className="text-2xs text-slate-600 font-mono capitalize">
              Active: <span className="text-cyan-400">{provider || 'openai'}</span>
            </div>
          </div>
        </div>
        <ProviderHealthStrip />
      </div>

      {/* Main split layout */}
      <div className="flex-1 overflow-hidden flex">

        {/* Left — module cards + quick actions (hidden on small screens) */}
        <div className="hidden md:flex w-64 lg:w-72 flex-shrink-0 border-r border-slate-800/60 overflow-auto p-4 space-y-3 flex-col hidden lg:block">
          <div className="text-2xs text-slate-600 uppercase tracking-widest font-semibold mb-3">AI Modules</div>

          {MODULE_CARDS.map(mod => (
            <button key={mod.id} onClick={() => setActiveCard(activeCard === mod.id ? null : mod.id)}
              className={`w-full text-left p-4 rounded-xl border transition-all ${
                activeCard === mod.id
                  ? `${mod.bg} ${mod.border} shadow-[0_0_20px_rgba(0,0,0,0.3)]`
                  : 'bg-slate-900/30 border-slate-800/40 hover:border-slate-700/40 hover:bg-slate-800/20'
              }`}>
              <div className="flex items-center gap-2.5 mb-2">
                <div className={`w-7 h-7 rounded-lg ${mod.bg} border ${mod.border} flex items-center justify-center flex-shrink-0`}>
                  <Icon name={mod.icon} size={13} className={mod.color} />
                </div>
                <span className={`text-xs font-semibold ${activeCard === mod.id ? mod.color : 'text-white'}`}>{mod.label}</span>
              </div>
              <p className="text-2xs text-slate-500 leading-snug">{mod.desc}</p>
            </button>
          ))}

          {/* Usage stats */}
          {tokenUsage.total > 0 && (
            <div className="mt-4 pt-4 border-t border-slate-800/40 space-y-2">
              <div className="text-2xs text-slate-600 uppercase tracking-widest font-semibold">Session Usage</div>
              {[
                ['Prompt tokens',     tokenUsage.prompt     ],
                ['Completion tokens', tokenUsage.completion ],
                ['Total tokens',      tokenUsage.total      ],
              ].map(([l, v]) => (
                <div key={l} className="flex items-center justify-between text-2xs">
                  <span className="text-slate-600">{l}</span>
                  <span className="font-mono text-slate-400">{v.toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right — chat panel */}
        <div className="flex-1 overflow-hidden">
          <AICommandPanel defaultModule={activeCard} />
        </div>
      </div>
    </div>
  )
}
