/**
 * ============================================================
 * APEX AI — Password Reset Confirmation
 * /src/pages/auth/ResetConfirm.jsx
 * ============================================================
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Icon from './components_ui_Icon'
import { authService } from './services_supabase_authService'

export default function ResetConfirm() {
  const navigate    = useNavigate()
  const [password,  setPassword]  = useState('')
  const [confirm,   setConfirm]   = useState('')
  const [error,     setError]     = useState(null)
  const [loading,   setLoading]   = useState(false)
  const [success,   setSuccess]   = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (password !== confirm) { setError('Passwords do not match'); return }
    if (password.length < 8)  { setError('Password must be at least 8 characters'); return }
    setLoading(true)
    const { error: err } = await authService.updatePassword(password)
    setLoading(false)
    if (err) { setError(err.message); return }
    setSuccess(true)
    setTimeout(() => navigate('/auth/login', { replace: true }), 2500)
  }

  return (
    <div className="min-h-[100dvh] bg-[#050810] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center gap-3 mb-8">
          <div className="w-12 h-12 bg-cyan-500/10 border border-cyan-500/30 rounded-xl flex items-center justify-center">
            <Icon name="KeyRound" size={22} className="text-cyan-400" />
          </div>
          <h1 className="font-display font-bold text-white text-lg">Set New Password</h1>
        </div>

        <div className="bg-[#0d1426] border border-slate-800/60 rounded-xl p-6">
          {success ? (
            <div className="flex flex-col items-center gap-3 py-4">
              <Icon name="CheckCircle2" size={32} className="text-emerald-400" />
              <p className="text-slate-300 text-sm text-center">Password updated. Redirecting...</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400">New Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  placeholder="Min. 8 characters"
                  className="w-full bg-[#090e1c] border border-slate-800 rounded-md px-3 py-2.5 text-sm text-white
                             focus:outline-none focus:ring-1 focus:ring-cyan-500/40 focus:border-cyan-500/40"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400">Confirm Password</label>
                <input
                  type="password"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  required
                  placeholder="Repeat password"
                  className="w-full bg-[#090e1c] border border-slate-800 rounded-md px-3 py-2.5 text-sm text-white
                             focus:outline-none focus:ring-1 focus:ring-cyan-500/40 focus:border-cyan-500/40"
                />
              </div>
              {error && (
                <div className="flex items-center gap-2 bg-red-500/5 border border-red-500/20 rounded-md px-3 py-2">
                  <Icon name="AlertCircle" size={13} className="text-red-400" />
                  <span className="text-red-400 text-xs">{error}</span>
                </div>
              )}
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30
                           text-cyan-400 text-sm font-semibold rounded-md py-2.5
                           flex items-center justify-center gap-2 transition-all disabled:opacity-40"
              >
                {loading ? 'Saving...' : 'Update Password'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
