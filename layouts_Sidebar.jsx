/**
 * ============================================================
 * APEX AI — Sidebar (Burger Drawer)
 * Slides in from the left as a fixed overlay drawer.
 * Closes on nav, on overlay click, or on X button.
 * ============================================================
 */

import { useLocation, useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import Icon from './components_ui_Icon'
import StatusDot from './components_ui_StatusDot'
import { useAppStore } from './core_storage'
import { NAV_ITEMS, NAV_GROUPS } from './config_routes'

// ─── Logo ─────────────────────────────────────────────────────
function ApexLogo({ onClose }) {
  return (
    <div className="flex items-center justify-between px-4 py-4 border-b border-slate-800/60">
      <div className="flex items-center gap-3">
        <div className="relative flex-shrink-0">
          <div className="w-8 h-8 bg-cyan-500/10 border border-cyan-500/30 rounded flex items-center justify-center">
            <span className="font-display font-bold text-cyan-400 text-xs tracking-wider">4P</span>
          </div>
          <div className="absolute -bottom-0.5 -right-0.5 w-2 h-2 bg-emerald-400 rounded-full shadow-[0_0_6px_rgba(52,211,153,0.8)]" />
        </div>
        <div className="min-w-0">
          <div className="font-display font-bold text-white text-sm leading-tight">Apex AI</div>
          <div className="text-slate-500 text-2xs tracking-widest uppercase">Fleet Control OS</div>
        </div>
      </div>
      {/* Close X */}
      <button
        onClick={onClose}
        className="p-1.5 rounded-md text-slate-500 hover:text-white hover:bg-slate-800/60 transition-colors"
        aria-label="Close menu"
      >
        <Icon name="X" size={16} />
      </button>
    </div>
  )
}

// ─── Nav Group Label ──────────────────────────────────────────
function NavGroupLabel({ label }) {
  if (!label) return null
  return (
    <div className="px-3 pt-4 pb-1">
      <span className="text-2xs font-semibold tracking-widest uppercase text-slate-600">
        {label}
      </span>
    </div>
  )
}

// ─── Nav Item ─────────────────────────────────────────────────
function NavItem({ item, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-all duration-150 cursor-pointer group relative',
        active
          ? 'text-white bg-slate-800/80'
          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
      )}
    >
      {/* Active indicator */}
      {active && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-cyan-400 rounded-r shadow-[0_0_8px_rgba(0,212,255,0.8)]" />
      )}
      <Icon
        name={item.icon}
        size={16}
        className={clsx(
          'flex-shrink-0 transition-colors',
          active ? 'text-cyan-400' : 'text-slate-500 group-hover:text-slate-300'
        )}
      />
      <span className="truncate">{item.label}</span>
      {item.highlight && (
        <span className="ml-auto w-1.5 h-1.5 rounded-full bg-cyan-400 shadow-[0_0_6px_rgba(0,212,255,0.8)] flex-shrink-0" />
      )}
      {item.badge && (
        <span className="ml-auto bg-red-500 text-white text-2xs font-bold px-1.5 py-0.5 rounded-full flex-shrink-0">
          {item.badge}
        </span>
      )}
    </button>
  )
}

// ─── Footer ───────────────────────────────────────────────────
function SidebarFooter() {
  return (
    <div className="px-3 py-3 border-t border-slate-800/60">
      <div className="flex items-center gap-2">
        <StatusDot status="online" />
        <span className="text-xs text-slate-500">Systems Nominal</span>
        <span className="ml-auto text-2xs text-slate-700 font-mono">v1.0.0</span>
      </div>
    </div>
  )
}

// ─── Sidebar Root ─────────────────────────────────────────────
export default function Sidebar() {
  const location  = useLocation()
  const navigate  = useNavigate()
  const isOpen    = useAppStore(s => s.sidebarExpanded)
  const close     = useAppStore(s => s.closeSidebar)

  const groupOrder = Object.entries(NAV_GROUPS)
    .sort(([, a], [, b]) => a.order - b.order)
    .map(([key]) => key)

  const grouped = groupOrder.reduce((acc, group) => {
    const items = NAV_ITEMS.filter(i => i.group === group)
    if (items.length) acc[group] = items
    return acc
  }, {})

  const handleNav = (route) => {
    navigate(route)
    close()
  }

  return (
    <aside
      className={clsx(
        // Fixed overlay drawer
        'fixed top-0 left-0 h-full z-50',
        'flex flex-col bg-[#090e1c] border-r border-slate-800/60',
        'w-72 transition-transform duration-300 ease-in-out',
        isOpen ? 'translate-x-0' : '-translate-x-full'
      )}
    >
      <ApexLogo onClose={close} />

      <nav className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-none px-2 py-2">
        {groupOrder.map(group => {
          const items = grouped[group]
          if (!items) return null
          return (
            <div key={group}>
              <NavGroupLabel label={NAV_GROUPS[group].label} />
              <div className="space-y-0.5">
                {items.map(item => (
                  <NavItem
                    key={item.id}
                    item={item}
                    active={
                      location.pathname === item.route ||
                      location.pathname.startsWith(item.route + '/')
                    }
                    onClick={() => handleNav(item.route)}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </nav>

      {/* Pairing code shortcut — for fleet ops only */}
      <div className="px-3 pb-2">
        <a href="#/driver-setup" className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-violet-500/25 bg-violet-500/8 hover:bg-violet-500/15 transition-colors group">
          <Icon name="Smartphone" size={14} className="text-violet-400 flex-shrink-0" />
          <span className="text-xs font-semibold text-violet-300 flex-1">Set Driver Up With App</span>
          <Icon name="ChevronRight" size={11} className="text-violet-600 group-hover:text-violet-400 transition-colors" />
        </a>
      </div>

      <SidebarFooter />
    </aside>
  )
}
