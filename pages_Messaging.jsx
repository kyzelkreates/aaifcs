/**
 * ============================================================
 * APEX AI — Messaging Center (Run 12 — Full Build)
 * Real-time fleet comms · Supabase channels + demo fallback
 * ============================================================
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import Icon from './components_ui_Icon'
import StatusDot from './components_ui_StatusDot'
import { realtimeService, MESSAGE_TYPE } from './services_realtime_realtimeService'
import { useAuthStore } from './core_storage'
import { formatTime } from './utils_format'

// ─── Channel icon ─────────────────────────────────────────────
const CHANNEL_ICON = { ops: 'Radio', group: 'Users', safety: 'ShieldAlert', dispatch: 'Navigation', mgmt: 'Briefcase', default: 'MessageSquare' }

// ─── Time divider ─────────────────────────────────────────────
function TimeDivider({ label }) {
  return (
    <div className="flex items-center gap-3 my-4">
      <div className="flex-1 h-px bg-slate-800/60" />
      <span className="text-2xs text-slate-600 font-medium px-2">{label}</span>
      <div className="flex-1 h-px bg-slate-800/60" />
    </div>
  )
}

// ─── Message Bubble ───────────────────────────────────────────
function MessageBubble({ message, isOwn, showName }) {
  const isAlert  = message.type === MESSAGE_TYPE.ALERT  || message.type === 'alert'
  const isSystem = message.type === MESSAGE_TYPE.SYSTEM || message.type === 'system'

  if (isSystem) {
    return (
      <div className="flex justify-center my-1.5">
        <span className="text-2xs text-slate-600 bg-slate-900/50 border border-slate-800/40 px-3 py-1 rounded-full">
          {message.content}
        </span>
      </div>
    )
  }

  if (isAlert) {
    return (
      <div className="flex justify-center my-2">
        <div className="flex items-start gap-2.5 bg-amber-500/5 border border-amber-500/20 rounded-xl px-4 py-2.5 max-w-md w-full">
          <div className="w-6 h-6 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center flex-shrink-0 mt-0.5">
            <Icon name="AlertTriangle" size={12} className="text-amber-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-amber-300 leading-snug">{message.content}</div>
            <div className="text-2xs text-slate-600 mt-1">{message.sender_name} · {formatTime(message.created_at)}</div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={`flex gap-2.5 mb-1 ${isOwn ? 'flex-row-reverse' : 'flex-row'}`}>
      {/* Avatar */}
      {!isOwn && (
        <div className="w-7 h-7 rounded-full bg-slate-800 border border-slate-700/60 flex items-center justify-center flex-shrink-0 mt-auto mb-0.5">
          <span className="text-2xs font-bold text-slate-400">
            {(message.sender_name || 'U').slice(0,1).toUpperCase()}
          </span>
        </div>
      )}

      <div className={`flex flex-col max-w-[68%] ${isOwn ? 'items-end' : 'items-start'}`}>
        {showName && !isOwn && (
          <span className="text-2xs text-slate-600 mb-1 ml-1">{message.sender_name}</span>
        )}
        <div className={`px-3.5 py-2 text-sm leading-relaxed break-words ${
          isOwn
            ? 'bg-cyan-500/12 border border-cyan-500/20 text-white rounded-2xl rounded-br-sm'
            : 'bg-slate-800/60 border border-slate-700/40 text-slate-200 rounded-2xl rounded-bl-sm'
        }`}>
          {message.content}
        </div>
        <span className="text-2xs text-slate-700 mt-1 mx-1">{formatTime(message.created_at)}</span>
      </div>
    </div>
  )
}

// ─── Channel Item ─────────────────────────────────────────────
function ChannelItem({ channel, active, onClick }) {
  const icon = CHANNEL_ICON[channel.type] || CHANNEL_ICON.default
  return (
    <button onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-3 text-left transition-all border-b border-slate-800/30 last:border-0 relative ${
        active
          ? 'bg-cyan-500/5 border-l-[2px] border-l-cyan-500'
          : 'hover:bg-slate-800/30'
      }`}>
      {/* Icon */}
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
        active ? 'bg-cyan-500/10 border border-cyan-500/20' : 'bg-slate-800 border border-slate-700/60'
      }`}>
        <Icon name={icon} size={14} className={active ? 'text-cyan-400' : 'text-slate-500'} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-1">
          <span className={`text-sm font-semibold truncate ${active ? 'text-cyan-300' : 'text-white'}`}>
            {channel.name}
          </span>
          <span className="text-2xs text-slate-600 flex-shrink-0">{formatTime(channel.updated_at)}</span>
        </div>
        {channel.last_message && (
          <p className="text-xs text-slate-500 truncate mt-0.5">{channel.last_message}</p>
        )}
      </div>

      {channel.unread > 0 && (
        <div className="w-5 h-5 rounded-full bg-cyan-500 flex items-center justify-center flex-shrink-0">
          <span className="text-2xs font-bold text-black">{channel.unread}</span>
        </div>
      )}
    </button>
  )
}

// ─── New Channel Modal ────────────────────────────────────────
function NewChannelModal({ onClose, onCreated }) {
  const [name, setName]   = useState('')
  const [busy, setBusy]   = useState(false)

  const submit = async (e) => {
    e.preventDefault(); if (!name.trim()) return
    setBusy(true)
    try { realtimeService.createChannel(name.trim()); onCreated?.() } catch (e) { console.error(e) }
    finally { setBusy(false); onClose?.() }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-[#0d1426] border border-slate-700/60 rounded-2xl w-full max-w-sm p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-display font-semibold text-white">New Channel</h3>
          <button onClick={onClose} className="p-1.5 text-slate-500 hover:text-slate-300 transition-colors">
            <Icon name="X" size={14} />
          </button>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs text-slate-400 font-medium">Channel Name</label>
            <input value={name} onChange={e => setName(e.target.value)} autoFocus required
              placeholder="e.g. Night Shift, Depot 2…"
              className="apex-input" />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors">Cancel</button>
            <button type="submit" disabled={busy}
              className="px-4 py-2 text-sm bg-cyan-500/15 border border-cyan-500/25 text-cyan-400 rounded-lg hover:bg-cyan-500/20 disabled:opacity-40 transition-colors">
              {busy ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Messaging Page ───────────────────────────────────────────
export default function Messaging() {
  const { user } = useAuthStore(s => ({ user: s.user }))

  const [channels,      setChannels]      = useState([])
  const [activeChannel, setActiveChannel] = useState(null)
  const [messages,      setMessages]      = useState([])
  const [input,         setInput]         = useState('')
  const [sending,       setSending]       = useState(false)
  const [showNewChan,   setShowNewChan]   = useState(false)
  const [channelSearch, setChannelSearch] = useState('')
  const [usingLive,     setUsingLive]     = useState(false)

  const messagesEndRef  = useRef(null)
  const inputRef        = useRef(null)
  const subRef          = useRef(null)

  // Try to connect to Supabase realtime
  const loadChannels = useCallback(async () => {
    try {
      const live = realtimeService.fetchChannels()
      if (live?.length > 0) { setChannels(live); setUsingLive(true) }
    } catch { /* stay on demo */ }
  }, [])

  useEffect(() => { loadChannels() }, [loadChannels])

  // Switch channel
  useEffect(() => {
    if (!activeChannel) return
    if (subRef.current) { subRef.current.unsubscribe?.(); subRef.current = null }

    if (usingLive) {
      try { setMessages(realtimeService.fetchMessages(activeChannel.id)) } catch { setMessages([]) }
      subRef.current = realtimeService.subscribeToChannel(activeChannel.id, (msg) => {
        setMessages(prev => [...prev, msg])
      })
    } else {
      setMessages([])
    }

    return () => { if (subRef.current) subRef.current.unsubscribe?.() }
  }, [activeChannel, usingLive])

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMessage = async () => {
    const content = input.trim()
    if (!content || sending) return
    setInput(''); setSending(true)

    if (usingLive) {
      try { realtimeService.sendMessage(activeChannel.id, content, undefined, user?.username || 'Operator') }
      catch (e) { console.error('[Messaging] send failed:', e) }
    } else {
      setMessages(prev => [...prev, {
        id:          Date.now(),
        content,
        sender_name: user?.full_name || 'You',
        type:        'text',
        created_at:  new Date().toISOString(),
        _own:        true,
      }])
    }

    setSending(false)
    inputRef.current?.focus()
  }

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  }

  const filteredChannels = channels.filter(c =>
    !channelSearch || c.name.toLowerCase().includes(channelSearch.toLowerCase())
  )
  const totalUnread = channels.reduce((n, c) => n + (c.unread || 0), 0)

  const myName = user?.full_name || user?.user_metadata?.full_name || 'You'

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── Channel Sidebar ── */}
      <div className="w-64 flex-shrink-0 border-r border-slate-800/60 flex flex-col bg-[#090e1c]">
        {/* Header */}
        <div className="px-4 py-3.5 border-b border-slate-800/60 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-display font-semibold text-sm text-white">Channels</span>
            {totalUnread > 0 && (
              <div className="w-5 h-5 rounded-full bg-cyan-500 flex items-center justify-center">
                <span className="text-2xs font-bold text-black">{totalUnread}</span>
              </div>
            )}
          </div>
          <button onClick={() => setShowNewChan(true)}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-500 hover:text-cyan-400 hover:bg-slate-800 transition-colors">
            <Icon name="Plus" size={14} />
          </button>
        </div>

        {/* Search */}
        <div className="px-3 py-2.5 border-b border-slate-800/40">
          <div className="relative">
            <Icon name="Search" size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-600" />
            <input value={channelSearch} onChange={e => setChannelSearch(e.target.value)}
              placeholder="Search channels…"
              className="w-full bg-slate-900/60 border border-slate-800/60 rounded text-xs text-slate-300 pl-7 pr-2 py-1.5 outline-none focus:border-slate-600/60 placeholder:text-slate-700" />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto scrollbar-none p-3 sm:p-0">
          {filteredChannels.map(ch => (
            <ChannelItem key={ch.id} channel={ch} active={activeChannel?.id === ch.id}
              onClick={() => setActiveChannel(ch)} />
          ))}
          {filteredChannels.length === 0 && (
            <div className="px-4 py-6 text-xs text-slate-700 text-center">No channels</div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-slate-800/40 flex items-center gap-2">
          <StatusDot status={usingLive ? 'online' : 'idle'} />
          <span className="text-2xs text-slate-600">{usingLive ? 'Live · Supabase' : 'Demo mode'}</span>
        </div>
      </div>

      {/* ── Chat Area ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {activeChannel ? (
          <>
            {/* Chat header */}
            <div className="px-5 py-3.5 border-b border-slate-800/60 flex items-center justify-between flex-shrink-0 bg-[#090e1c]">
              <div className="flex items-center gap-3">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center border ${
                  activeChannel.type === 'safety'
                    ? 'bg-amber-500/10 border-amber-500/20'
                    : 'bg-cyan-500/10 border-cyan-500/20'
                }`}>
                  <Icon name={CHANNEL_ICON[activeChannel.type] || 'MessageSquare'} size={15}
                    className={activeChannel.type === 'safety' ? 'text-amber-400' : 'text-cyan-400'} />
                </div>
                <div>
                  <div className="text-sm font-semibold text-white">{activeChannel.name}</div>
                  <div className="text-2xs text-slate-600">{messages.length} messages</div>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <button className="w-8 h-8 flex items-center justify-center text-slate-600 hover:text-slate-300 hover:bg-slate-800 rounded-lg transition-colors">
                  <Icon name="Phone" size={14} />
                </button>
                <button className="w-8 h-8 flex items-center justify-center text-slate-600 hover:text-slate-300 hover:bg-slate-800 rounded-lg transition-colors">
                  <Icon name="Info" size={14} />
                </button>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-0.5 scrollbar-none">
              {messages.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-slate-600 gap-3">
                  <Icon name="MessageSquare" size={36} className="opacity-20" />
                  <p className="text-sm">No messages yet</p>
                  <p className="text-xs">Send the first message</p>
                </div>
              )}
              {messages.map((msg, i) => {
                const prev      = messages[i - 1]
                const isOwn     = msg._own || msg.sender_id === user?.id || msg.sender_name === myName
                const showName  = !isOwn && msg.sender_name !== prev?.sender_name
                const showTime  = !prev || new Date(msg.created_at) - new Date(prev.created_at) > 3600000
                return (
                  <div key={msg.id || i}>
                    {showTime && <TimeDivider label={new Date(msg.created_at).toLocaleString('en-GB', { hour12: false, weekday: 'short', hour: '2-digit', minute: '2-digit' })} />}
                    <MessageBubble message={msg} isOwn={isOwn} showName={showName} />
                  </div>
                )
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="px-4 py-3 border-t border-slate-800/60 flex-shrink-0 bg-[#090e1c]">
              <div className="flex items-end gap-2">
                <div className="flex-1 relative">
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={handleKey}
                    rows={1}
                    placeholder={`Message ${activeChannel.name}…`}
                    className="w-full bg-slate-900/60 border border-slate-800/60 rounded-xl text-sm text-slate-200 px-3.5 py-2.5 pr-10 outline-none focus:border-slate-700/60 placeholder:text-slate-700 resize-none transition-colors"
                    style={{ minHeight: '44px', maxHeight: '140px' }}
                  />
                  <button className="absolute right-3 bottom-2.5 text-slate-700 hover:text-slate-500 transition-colors">
                    <Icon name="Paperclip" size={14} />
                  </button>
                </div>
                <button
                  onClick={sendMessage}
                  disabled={!input.trim() || sending}
                  className="w-10 h-10 rounded-xl bg-cyan-500/15 border border-cyan-500/20 text-cyan-400 hover:bg-cyan-500/25 disabled:opacity-30 disabled:cursor-not-allowed transition-all flex items-center justify-center flex-shrink-0"
                >
                  {sending
                    ? <Icon name="Loader2" size={15} className="animate-spin" />
                    : <Icon name="Send" size={15} />
                  }
                </button>
              </div>
              <p className="text-center text-2xs text-slate-800 mt-1.5">Enter to send · Shift+Enter for new line</p>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-600 gap-3">
            <Icon name="MessageSquare" size={40} className="opacity-20" />
            <p className="text-sm">Select a channel to start</p>
          </div>
        )}
      </div>

      {showNewChan && (
        <NewChannelModal onClose={() => setShowNewChan(false)} onCreated={loadChannels} />
      )}
    </div>
  )
}
