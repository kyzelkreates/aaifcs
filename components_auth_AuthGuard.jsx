/**
 * ============================================================
 * APEX AI — Auth Guard
 * /src/components/auth/AuthGuard.jsx
 *
 * Protects routes from unauthenticated access.
 * Redirects to /auth/login if no session exists.
 * Checks role permissions if requiredRole is provided.
 *
 * Safe with no Supabase config — resolves immediately to login.
 * ============================================================
 */

import { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from './core_storage'
import { authService, hasPermission } from './services_supabase_authService'
import Icon from './components_ui_Icon'

export default function AuthGuard({ children, requiredRole = null }) {
  const location = useLocation()
  const { role, isAuthenticated } = useAuthStore(s => ({
    role:            s.role,
    isAuthenticated: s.isAuthenticated,
  }))
  const [checking, setChecking] = useState(true)

  // Validate session on mount — always resolves (null client is safe)
  useEffect(() => {
    let cancelled = false
    const timeout = setTimeout(() => {
      // Hard safety — never hang more than 3s
      if (!cancelled) setChecking(false)
    }, 3000)

    authService.getSession()
      .catch(() => {})
      .finally(() => {
        if (!cancelled) {
          clearTimeout(timeout)
          setChecking(false)
        }
      })

    return () => { cancelled = true; clearTimeout(timeout) }
  }, [])

  // ── Loading splash ──────────────────────────────────────────
  if (checking) {
    return (
      <div className="flex items-center justify-center h-[100dvh] bg-[#050810]">
        <div className="flex flex-col items-center gap-4">
          {/* Apex logo mark */}
          <div className="relative mb-2">
            <div className="w-14 h-14 bg-cyan-500/10 border border-cyan-500/30 rounded-xl flex items-center justify-center">
              <span className="font-display font-bold text-cyan-400 text-xl tracking-wider">4P</span>
            </div>
            <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-emerald-400 rounded-full shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
          </div>
          <div className="w-8 h-8 border-2 border-cyan-500/20 border-t-cyan-400 rounded-full animate-spin" />
          <span className="text-slate-500 text-xs font-medium tracking-[0.25em] uppercase mt-1">
            Authenticating
          </span>
        </div>
      </div>
    )
  }

  // ── Not authenticated → login ───────────────────────────────
  if (!isAuthenticated) {
    return <Navigate to="/auth/login" state={{ from: location }} replace />
  }

  // ── Insufficient role ───────────────────────────────────────
  if (requiredRole && !hasPermission(role, requiredRole)) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[60vh] gap-6">
        <div className="w-16 h-16 rounded-2xl bg-red-500/5 border border-red-500/20 flex items-center justify-center">
          <Icon name="ShieldOff" size={28} className="text-red-400" />
        </div>
        <div className="text-center">
          <h2 className="font-display text-xl font-bold text-white mb-2">Access Denied</h2>
          <p className="text-slate-500 text-sm">
            You don't have permission to access this section.
          </p>
          <p className="text-slate-600 text-xs mt-1">
            Required role: <span className="text-amber-400">{requiredRole}</span>
          </p>
        </div>
      </div>
    )
  }

  return children
}
