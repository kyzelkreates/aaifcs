/**
 * ============================================================
 * APEX AI — 404 Not Found
 * /src/pages/NotFound.jsx
 * ============================================================
 */

import { useNavigate } from 'react-router-dom'
import Icon from './components_ui_Icon'

export default function NotFound() {
  const navigate = useNavigate()
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[60vh] gap-6 animate-fade-in">
      <div className="w-20 h-20 rounded-2xl bg-red-500/5 border border-red-500/20 flex items-center justify-center">
        <Icon name="AlertOctagon" size={36} className="text-red-400" />
      </div>
      <div className="text-center">
        <div className="font-mono text-6xl font-bold text-slate-800 mb-2">404</div>
        <p className="text-slate-400 text-sm">Route not found in Apex AI OS</p>
      </div>
      <button
        onClick={() => navigate('/dashboard')}
        className="btn-primary"
      >
        <Icon name="Home" size={14} />
        Return to Dashboard
      </button>
    </div>
  )
}
