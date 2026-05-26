/**
 * ============================================================
 * APEX AI — Top Navigation Bar (Run 2 — Auth integrated)
 * /src/layouts/TopNav.jsx
 * ============================================================
 */

import React, { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import Icon from './components_ui_Icon'
import StatusDot from './components_ui_StatusDot'
import { useAppStore } from './core_storage'
import { useAuth } from './hooks_useAuth'
import { NAV_ITEMS } from './config_routes'
import { ConnectionStatusPill, BackendWarningBanner } from './components_ui_ConnectionStatus'

// ─── Breadcrumb ───────────────────────────────────────────────
function Breadcrumb({ pathname }) {
  const item = NAV_ITEMS.find(n =>
    pathname === n.route || pathname.startsWith(n.route + '/')
  )
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-slate-600">Fleet Control OS</span>
      <Icon name="ChevronRight" size={14} className="text-slate-700" />
      <span className="text-slate-300 font-medium">
        {item?.label || 'Dashboard'}
      </span>
    </div>
  )
}

// ─── System Status Pill ───────────────────────────────────────
function SystemStatusPill({ status }) {
  return (
    <div className="flex items-center gap-2 bg-slate-900/60 border border-slate-800/60 rounded-full px-3 py-1.5">
      <StatusDot status={status} />
      <span className="text-xs text-slate-400 font-medium">
        {status === 'online'   ? 'All Systems Nominal' :
         status === 'degraded' ? 'Degraded' : 'Offline'}
      </span>
    </div>
  )
}

// ─── Live Clock ───────────────────────────────────────────────
function LiveClock() {
  const [time, setTime] = React.useState(() => new Date())
  React.useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="flex flex-col items-end">
      <span className="font-mono text-cyan-400 text-sm tabular-nums">
        {time.toLocaleTimeString('en-GB', { hour12: false })}
      </span>
      <span className="text-slate-600 text-2xs tabular-nums">
        {time.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
      </span>
    </div>
  )
}

// ─── User Menu ────────────────────────────────────────────────
function UserMenu({ user, roleLabel, signOut }) {
  const [open, setOpen] = useState(false)
  const navigate        = useNavigate()
  const initials        = user?.user_metadata?.full_name
    ? user.user_metadata.full_name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
    : (user?.email?.[0] || 'U').toUpperCase()

  const handleSignOut = async () => {
    await signOut()
    navigate('/auth/login', { replace: true })
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 p-1 rounded-md hover:bg-slate-800/60 transition-colors"
      >
        <div className="w-7 h-7 rounded-md bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
          <span className="text-cyan-400 text-xs font-bold">{initials}</span>
        </div>
        <Icon name="ChevronDown" size={12} className="text-slate-600" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 w-56 bg-[#0d1426] border border-slate-800/60 rounded-xl shadow-xl z-50 overflow-hidden">
            {/* User info */}
            <div className="px-4 py-3 border-b border-slate-800/60">
              <p className="text-sm font-medium text-white truncate">
                {user?.user_metadata?.full_name || 'Operator'}
              </p>
              <p className="text-xs text-slate-500 truncate">{user?.email}</p>
              <span className="inline-block mt-1 text-2xs text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/20">
                {roleLabel}
              </span>
            </div>

            {/* Menu items */}
            <div className="py-1">
              <button
                onClick={() => { navigate('/settings/profile'); setOpen(false) }}
                className="w-full flex items-center gap-3 px-4 py-2 text-sm text-slate-400 hover:text-white hover:bg-slate-800/40 transition-colors"
              >
                <Icon name="User" size={14} />
                My Profile
              </button>
              <button
                onClick={() => { navigate('/settings'); setOpen(false) }}
                className="w-full flex items-center gap-3 px-4 py-2 text-sm text-slate-400 hover:text-white hover:bg-slate-800/40 transition-colors"
              >
                <Icon name="Settings" size={14} />
                Settings
              </button>
            </div>

            <div className="border-t border-slate-800/60 py-1">
              <button
                onClick={handleSignOut}
                className="w-full flex items-center gap-3 px-4 py-2 text-sm text-red-400 hover:bg-red-500/5 transition-colors"
              >
                <Icon name="LogOut" size={14} />
                Sign Out
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ─── TopNav Root ──────────────────────────────────────────────
export default function TopNav() {
  const location        = useLocation()
  const toggleSidebar   = useAppStore(s => s.toggleSidebar)
  const sidebarExpanded = useAppStore(s => s.sidebarExpanded)
  const systemStatus    = useAppStore(s => s.systemStatus)
  const notifications   = useAppStore(s => s.notifications)
  const { user, roleLabel, signOut } = useAuth()

  const unreadCount = notifications.filter(n => !n.read).length

  return (
    <header className="flex items-center justify-between h-13 px-4 border-b border-slate-800/60 bg-[#090e1c]/95 backdrop-blur-sm flex-shrink-0">

      {/* Left: Toggle + Breadcrumb */}
      <div className="flex items-center gap-4">
        <button
          onClick={toggleSidebar}
          className="p-2 rounded-md text-slate-400 hover:text-white hover:bg-slate-800/60 transition-colors"
          aria-label="Open menu"
        >
          <Icon name="Menu" size={20} />
        </button>
        <Breadcrumb pathname={location.pathname} />
      </div>

      {/* Right */}
      <div className="flex items-center gap-3">
        <div className="hidden md:flex">
          <SystemStatusPill status={systemStatus} />
        </div>
        <div className="hidden sm:flex">
          <ConnectionStatusPill />
        </div>
        <div className="hidden lg:flex items-center gap-2 bg-violet-500/5 border border-violet-500/20 rounded-full px-3 py-1.5">
          <Icon name="Cpu" size={12} className="text-violet-400" />
          <span className="text-xs text-violet-400 font-medium">AI Ready</span>
        </div>
        <div className="flex">
          <LiveClock />
        </div>
        <button className="relative p-2 rounded-md text-slate-500 hover:text-slate-300 hover:bg-slate-800/60 transition-colors">
          <Icon name="Bell" size={16} />
          {unreadCount > 0 && (
            <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-red-500" />
          )}
        </button>
        <UserMenu user={user} roleLabel={roleLabel} signOut={signOut} />
      </div>
    </header>
  )
}
