/**
 * ============================================================
 * APEX AI — Driver Login (AP3X) — Local Auth Mode
 * Drivers log in with username or email + password.
 * ============================================================
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Icon from './components_ui_Icon'
import { authService } from './services_supabase_authService'

export default function DriverLogin() {
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState(null)
  const [loading,  setLoading]  = useState(false)
  const [showPass, setShowPass] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const { error: err } = await authService.signIn(username, password)
    setLoading(false)
    if (err) { setError(err.message); return }
    navigate('/ap3x', { replace: true })
  }

  return (
    <div className="min-h-[100dvh] bg-[#050810] flex items-center justify-center p-4 relative">
      <div className="absolute inset-0 grid-tactical opacity-20" />
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-80 h-80 bg-violet-500/5 rounded-full blur-3xl pointer-events-none" />

      <div className="relative w-full max-w-xs">
        <div className="flex flex-col items-center gap-3 mb-8">
          <div className="w-16 h-16 bg-violet-500/10 border border-violet-500/30 rounded-2xl flex items-center justify-center">
            <Icon name="Navigation" size={28} className="text-violet-400" />
          </div>
          <div className="text-center">
            <h1 className="font-display font-bold text-white text-xl">AP3X Driver</h1>
            <p className="text-slate-500 text-xs tracking-widest uppercase">Navigation Platform</p>
          </div>
        </div>

        <div className="bg-[#0d1426] border border-slate-800/60 rounded-xl p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs text-slate-400">Username or Email</label>
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
                             focus:outline-none focus:ring-1 focus:ring-violet-500/40 focus:border-violet-500/40 transition-all"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-slate-400">Password</label>
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
                             focus:outline-none focus:ring-1 focus:ring-violet-500/40 focus:border-violet-500/40 transition-all"
                />
                <button type="button" onClick={() => setShowPass(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-400">
                  <Icon name={showPass ? 'EyeOff' : 'Eye'} size={14} />
                </button>
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 bg-red-500/5 border border-red-500/20 rounded-md px-3 py-2">
                <Icon name="AlertCircle" size={13} className="text-red-400 shrink-0" />
                <span className="text-red-400 text-xs">{error}</span>
              </div>
            )}

            <button type="submit" disabled={loading}
              className="w-full bg-violet-500/10 hover:bg-violet-500/20 border border-violet-500/30 hover:border-violet-500/60
                         text-violet-400 text-sm font-semibold rounded-md py-2.5
                         flex items-center justify-center gap-2 transition-all
                         disabled:opacity-40 disabled:cursor-not-allowed">
              {loading ? (
                <><div className="w-3.5 h-3.5 border border-violet-400/40 border-t-violet-400 rounded-full animate-spin" />Authenticating...</>
              ) : (
                <><Icon name="Zap" size={14} />Start Drive Session</>
              )}
            </button>
          </form>

          <div className="mt-4 pt-4 border-t border-slate-800/50 text-center">
            <a href="#/auth/login" className="text-xs text-slate-600 hover:text-slate-400 transition-colors">
              ← Fleet admin login
            </a>
          </div>
        </div>

        <p className="text-center text-slate-700 text-xs mt-4">
          Local auth • No internet required
        </p>
      </div>
    </div>
  )
}
