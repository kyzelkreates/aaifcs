/**
 * ============================================================
 * APEX AI — First-Run Setup Page
 * Creates the initial admin + driver accounts.
 * Shown only once — when apex:setup_complete is not set.
 * ============================================================
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Icon from './components_ui_Icon'
import { authService } from './services_supabase_authService'

const Field = ({ label, type = 'text', value, onChange, placeholder, required = true, show, onToggle }) => (
  <div className="space-y-1">
    <label className="text-xs text-slate-400 font-medium">{label}</label>
    <div className="relative">
      <input
        type={type === 'password' ? (show ? 'text' : 'password') : type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="input w-full text-sm"
      />
      {type === 'password' && onToggle && (
        <button
          type="button"
          onClick={onToggle}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
        >
          <Icon name={show ? 'EyeOff' : 'Eye'} size={14} />
        </button>
      )}
    </div>
  </div>
)

export default function Setup() {
  const navigate = useNavigate()
  const [step, setStep]   = useState(1) // 1 = admin, 2 = driver, 3 = confirm
  const [error, setError] = useState(null)
  const [showPass, setShowPass] = useState({})

  const toggle = (key) => setShowPass(p => ({ ...p, [key]: !p[key] }))

  const [admin, setAdmin] = useState({ username: '', email: '', password: '', confirm: '' })
  const [driver, setDriver] = useState({ username: '', email: '', password: '', confirm: '' })

  const setA = (k) => (v) => setAdmin(p => ({ ...p, [k]: v }))
  const setD = (k) => (v) => setDriver(p => ({ ...p, [k]: v }))

  const validateAdmin = () => {
    if (!admin.username.trim())       return 'Admin username is required.'
    if (admin.password.length < 6)   return 'Password must be at least 6 characters.'
    if (admin.password !== admin.confirm) return 'Passwords do not match.'
    return null
  }

  const validateDriver = () => {
    if (!driver.username.trim())        return 'Driver username is required.'
    if (driver.password.length < 6)    return 'Password must be at least 6 characters.'
    if (driver.password !== driver.confirm) return 'Passwords do not match.'
    if (driver.username.trim().toLowerCase() === admin.username.trim().toLowerCase())
      return 'Driver username must differ from admin.'
    return null
  }

  const handleNextStep1 = (e) => {
    e.preventDefault()
    const err = validateAdmin()
    if (err) { setError(err); return }
    setError(null)
    setStep(2)
  }

  const handleNextStep2 = (e) => {
    e.preventDefault()
    const err = validateDriver()
    if (err) { setError(err); return }
    setError(null)
    setStep(3)
  }

  const handleConfirm = () => {
    const result = authService.setupAccounts({
      adminUsername:  admin.username,
      adminPassword:  admin.password,
      adminEmail:     admin.email || admin.username,
      driverUsername: driver.username,
      driverPassword: driver.password,
      driverEmail:    driver.email || driver.username,
    })
    if (result.error) { setError(result.error.message); return }
    navigate('/auth/login', { replace: true })
  }

  return (
    <div className="min-h-[100dvh] bg-[#050810] flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute inset-0 grid-tactical opacity-20" />
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-96 h-80 bg-cyan-500/5 rounded-full blur-3xl pointer-events-none" />

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
            <p className="text-slate-500 text-xs tracking-widest uppercase mt-0.5">First-Run Setup</p>
          </div>
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-2 mb-6">
          {[1, 2, 3].map(s => (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                step === s ? 'bg-cyan-500 text-black'
                : step > s  ? 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-400'
                            : 'bg-slate-800 border border-slate-700 text-slate-600'
              }`}>
                {step > s ? <Icon name="Check" size={12} /> : s}
              </div>
              {s < 3 && <div className={`w-8 h-px ${step > s ? 'bg-emerald-500/40' : 'bg-slate-700'}`} />}
            </div>
          ))}
        </div>

        <div className="bg-[#0d1426] border border-slate-800/60 rounded-xl p-6">

          {/* ── Step 1: Admin Account ── */}
          {step === 1 && (
            <form onSubmit={handleNextStep1} className="space-y-4">
              <div>
                <h2 className="text-base font-semibold text-white mb-0.5">Admin Account</h2>
                <p className="text-slate-500 text-xs">Fleet Control OS administrator credentials</p>
              </div>
              <Field label="Username *"    value={admin.username} onChange={setA('username')} placeholder="e.g. admin" />
              <Field label="Email (optional)" type="email" value={admin.email}    onChange={setA('email')}    placeholder="admin@fleet.io" required={false} />
              <Field label="Password *"    type="password" value={admin.password} onChange={setA('password')} placeholder="Min 6 characters"
                     show={showPass.ap} onToggle={() => toggle('ap')} />
              <Field label="Confirm Password *" type="password" value={admin.confirm}  onChange={setA('confirm')}  placeholder="Repeat password"
                     show={showPass.ac} onToggle={() => toggle('ac')} />
              {error && <p className="text-red-400 text-xs bg-red-400/10 rounded-lg px-3 py-2">{error}</p>}
              <button type="submit" className="btn-primary w-full">
                Next — Driver Account <Icon name="ArrowRight" size={14} className="inline ml-1" />
              </button>
            </form>
          )}

          {/* ── Step 2: Driver Account ── */}
          {step === 2 && (
            <form onSubmit={handleNextStep2} className="space-y-4">
              <div className="flex items-center gap-2 mb-1">
                <button type="button" onClick={() => { setStep(1); setError(null) }}
                  className="text-slate-500 hover:text-slate-300">
                  <Icon name="ArrowLeft" size={14} />
                </button>
                <div>
                  <h2 className="text-base font-semibold text-white">Driver Account</h2>
                  <p className="text-slate-500 text-xs">AP3X navigation app credentials</p>
                </div>
              </div>
              <Field label="Username *"    value={driver.username} onChange={setD('username')} placeholder="e.g. driver1" />
              <Field label="Email (optional)" type="email" value={driver.email}    onChange={setD('email')}    placeholder="driver@fleet.io" required={false} />
              <Field label="Password *"    type="password" value={driver.password} onChange={setD('password')} placeholder="Min 6 characters"
                     show={showPass.dp} onToggle={() => toggle('dp')} />
              <Field label="Confirm Password *" type="password" value={driver.confirm}  onChange={setD('confirm')}  placeholder="Repeat password"
                     show={showPass.dc} onToggle={() => toggle('dc')} />
              {error && <p className="text-red-400 text-xs bg-red-400/10 rounded-lg px-3 py-2">{error}</p>}
              <button type="submit" className="btn-primary w-full">
                Review & Confirm <Icon name="ArrowRight" size={14} className="inline ml-1" />
              </button>
            </form>
          )}

          {/* ── Step 3: Confirm ── */}
          {step === 3 && (
            <div className="space-y-5">
              <div className="flex items-center gap-2 mb-1">
                <button type="button" onClick={() => { setStep(2); setError(null) }}
                  className="text-slate-500 hover:text-slate-300">
                  <Icon name="ArrowLeft" size={14} />
                </button>
                <div>
                  <h2 className="text-base font-semibold text-white">Confirm Setup</h2>
                  <p className="text-slate-500 text-xs">Review your accounts before saving</p>
                </div>
              </div>

              {/* Admin summary */}
              <div className="bg-cyan-500/5 border border-cyan-500/20 rounded-lg p-3 space-y-1">
                <div className="flex items-center gap-2 mb-2">
                  <Icon name="Shield" size={13} className="text-cyan-400" />
                  <span className="text-cyan-400 text-xs font-semibold uppercase tracking-wider">Fleet Admin</span>
                </div>
                <p className="text-white text-sm font-medium">{admin.username}</p>
                {admin.email && <p className="text-slate-500 text-xs">{admin.email}</p>}
              </div>

              {/* Driver summary */}
              <div className="bg-violet-500/5 border border-violet-500/20 rounded-lg p-3 space-y-1">
                <div className="flex items-center gap-2 mb-2">
                  <Icon name="Navigation" size={13} className="text-violet-400" />
                  <span className="text-violet-400 text-xs font-semibold uppercase tracking-wider">Driver</span>
                </div>
                <p className="text-white text-sm font-medium">{driver.username}</p>
                {driver.email && <p className="text-slate-500 text-xs">{driver.email}</p>}
              </div>

              <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-3">
                <div className="flex gap-2">
                  <Icon name="Info" size={13} className="text-amber-400 mt-0.5 shrink-0" />
                  <p className="text-amber-200/70 text-xs leading-relaxed">
                    Credentials are stored locally on this device. You can add more accounts later in Settings.
                  </p>
                </div>
              </div>

              {error && <p className="text-red-400 text-xs bg-red-400/10 rounded-lg px-3 py-2">{error}</p>}

              <button onClick={handleConfirm} className="btn-primary w-full">
                <Icon name="CheckCircle" size={14} className="inline mr-1.5" />
                Save & Launch Apex AI
              </button>
            </div>
          )}
        </div>

        <p className="text-center text-slate-700 text-xs mt-4">
          Credentials saved to this device only • No internet required
        </p>
      </div>
    </div>
  )
}
