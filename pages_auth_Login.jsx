/**
 * ============================================================
 * APEX AI — Login Page (Local Auth Mode)
 * Accepts username or email + password.
 * No Supabase — validates against localStorage accounts.
 * ============================================================
 */

import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import Icon from './components_ui_Icon'
import { authService } from './services_supabase_authService'

export default function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const from     = location.state?.from?.pathname || '/dashboard'

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState(null)
  const [loading,  setLoading]  = useState(false)
  const [showPass, setShowPass] = useState(false)

  const handleLogin = async (e) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const { error: err } = await authService.signIn(username, password)
    setLoading(false)
    if (err) { setError(err.message); return }
    navigate(from, { replace: true })
  }

  return (
    <div className="min-h-[100dvh] bg-[#050810] flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute inset-0 grid-tactical opacity-30" />
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-96 h-96 bg-cyan-500/5 rounded-full blur-3xl pointer-events-none" />

      <div className="relative w-full max-w-sm">

        {/* Logo */}
        <div className="flex flex-col items-center gap-3 mb-8">
          <div className="relative">
            <div className="w-14 h-14 bg-cyan-500/10 border border-cyan-500/30 rounded-xl flex items-center justify-center">
              <span className="font-display font-bold text-cyan-400 text-xl tracking-wider">4P</span>
            </div>
            <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-emerald-400 rounded-full shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
          </div>
          <div className="text-center">
            <h1 className="font-display font-bold text-white text-xl">Apex Intelligent AI</h1>
            <p className="text-slate-500 text-xs tracking-widest uppercase mt-0.5">Fleet Control OS</p>
          </div>
        </div>

        <div className="bg-[#0d1426] border border-slate-800/60 rounded-xl p-6">
          <h2 className="text-base font-semibold text-white mb-1">Sign In</h2>
          <p className="text-slate-500 text-xs mb-5">Authorised personnel only</p>

          <form onSubmit={handleLogin} className="space-y-4">
            {/* Username */}
            <div className="space-y-1.5">
              <label className="text-xs text-slate-400 font-medium">Username or Email</label>
              <div className="relative">
                <Icon name="User" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" />
                <input
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  required
                  autoComplete="username"
                  placeholder="Enter your username"
                  className="w-full bg-[#090e1c] border border-slate-800 rounded-md pl-9 pr-3 py-2.5
                             text-sm text-white placeholder:text-slate-700
                             focus:outline-none focus:ring-1 focus:ring-cyan-500/40 focus:border-cyan-500/40 transition-all"
                />
              </div>
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <label className="text-xs text-slate-400 font-medium">Password</label>
              <div className="relative">
                <Icon name="Lock" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" />
                <input
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="w-full bg-[#090e1c] border border-slate-800 rounded-md pl-9 pr-9 py-2.5
                             text-sm text-white placeholder:text-slate-700
                             focus:outline-none focus:ring-1 focus:ring-cyan-500/40 focus:border-cyan-500/40 transition-all"
                />
                <button type="button" onClick={() => setShowPass(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-400">
                  <Icon name={showPass ? 'EyeOff' : 'Eye'} size={14} />
                </button>
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 bg-red-500/5 border border-red-500/20 rounded-md px-3 py-2.5">
                <Icon name="AlertCircle" size={14} className="text-red-400 shrink-0" />
                <span className="text-red-400 text-xs">{error}</span>
              </div>
            )}

            <button type="submit" disabled={loading}
              className="w-full bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 hover:border-cyan-500/60
                         text-cyan-400 text-sm font-semibold rounded-md py-2.5
                         flex items-center justify-center gap-2 transition-all duration-150
                         disabled:opacity-40 disabled:cursor-not-allowed">
              {loading ? (
                <><div className="w-3.5 h-3.5 border border-cyan-400/40 border-t-cyan-400 rounded-full animate-spin" />Authenticating...</>
              ) : (
                <><Icon name="LogIn" size={14} />Sign In</>
              )}
            </button>
          </form>

          <div className="mt-4 pt-4 border-t border-slate-800/50 flex items-center justify-between">
            <a href="#/auth/driver"
              className="text-xs text-violet-400/70 hover:text-violet-400 transition-colors flex items-center gap-1">
              <Icon name="Navigation" size={11} /> Driver Login
            </a>
            <span className="text-xs text-slate-700">Local auth • No internet required</span>
          </div>
        </div>
      </div>
    </div>
  )
}
