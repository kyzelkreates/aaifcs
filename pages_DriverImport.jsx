/**
 * ============================================================
 * APEX AI — Driver Import Page
 * Route: #/driver-import?pkg=<base64>
 * Handles QR code scans, deep links, and emailed links.
 * Auto-imports the sync package and redirects to AP3X.
 * ============================================================
 */

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Icon from './components_ui_Icon'
import { importFromURL, importFromText } from './services_sync_driverSyncService'

export default function DriverImport() {
  const navigate = useNavigate()
  const [state, setState] = useState('loading') // loading | success | error | manual
  const [msg,   setMsg]   = useState('')
  const [text,  setText]  = useState('')

  useEffect(() => {
    const result = importFromURL()
    if (!result) {
      setState('manual')
      return
    }
    if (result.ok) {
      setMsg(`${result.count} job${result.count !== 1 ? 's' : ''} imported for ${result.driver_name}`)
      setState('success')
      setTimeout(() => navigate('/ap3x', { replace: true }), 2000)
    } else {
      setMsg(result.error || 'Import failed')
      setState('error')
    }
  }, [])

  const handleManual = () => {
    if (!text.trim()) return
    const result = importFromText(text.trim())
    if (result.ok) {
      setMsg(`${result.count} job${result.count !== 1 ? 's' : ''} imported.`)
      setState('success')
      setTimeout(() => navigate('/ap3x', { replace: true }), 2000)
    } else {
      setMsg(result.error || 'Import failed')
      setState('error')
    }
  }

  return (
    <div className="min-h-[100dvh] bg-[#050810] flex items-center justify-center p-4">
      <div className="w-full max-w-xs">
        <div className="bg-[#0d1426] border border-slate-800/60 rounded-xl p-6 text-center space-y-4">

          {state === 'loading' && (
            <>
              <div className="w-12 h-12 border-2 border-violet-500/20 border-t-violet-400 rounded-full animate-spin mx-auto" />
              <p className="text-slate-400 text-sm">Importing jobs…</p>
            </>
          )}

          {state === 'success' && (
            <>
              <div className="w-12 h-12 bg-emerald-500/10 border border-emerald-500/25 rounded-full flex items-center justify-center mx-auto">
                <Icon name="CheckCircle" size={24} className="text-emerald-400" />
              </div>
              <p className="text-white font-semibold text-sm">{msg}</p>
              <p className="text-slate-500 text-xs">Redirecting to driver app…</p>
            </>
          )}

          {(state === 'error' || state === 'manual') && (
            <>
              {state === 'error' && (
                <div className="w-12 h-12 bg-red-500/10 border border-red-500/25 rounded-full flex items-center justify-center mx-auto">
                  <Icon name="AlertCircle" size={24} className="text-red-400" />
                </div>
              )}
              {state === 'manual' && (
                <div className="w-12 h-12 bg-violet-500/10 border border-violet-500/25 rounded-full flex items-center justify-center mx-auto">
                  <Icon name="Download" size={24} className="text-violet-400" />
                </div>
              )}
              <div>
                <p className="text-white font-semibold text-sm mb-1">
                  {state === 'error' ? 'Import Failed' : 'Paste Sync Code'}
                </p>
                {msg && <p className="text-red-400 text-xs">{msg}</p>}
              </div>
              <textarea
                value={text}
                onChange={e => setText(e.target.value)}
                placeholder="Paste sync code, JSON, or link here…"
                rows={4}
                className="w-full bg-slate-900/60 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-300 placeholder:text-slate-700 resize-none outline-none focus:border-violet-500/40"
              />
              <button onClick={handleManual} disabled={!text.trim()}
                className="w-full bg-violet-500/10 border border-violet-500/25 text-violet-400 text-sm font-semibold rounded-lg py-2.5 hover:bg-violet-500/20 disabled:opacity-30 transition-colors">
                Import
              </button>
              <button onClick={() => navigate('/ap3x')}
                className="w-full text-slate-600 text-xs hover:text-slate-400 transition-colors">
                Skip → Go to Driver App
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
