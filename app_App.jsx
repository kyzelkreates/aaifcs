/**
 * ============================================================
 * APEX AI — Root App Component (Run 16 — System status wired)
 * /src/app/App.jsx
 * ============================================================
 */

import { RouterProvider } from 'react-router-dom'
import { router }         from './app_Router'
import AuthProvider       from './providers_AuthProvider'
import { useSystemStatus } from './hooks_useSystemStatus'
import { useEffect }      from 'react'
import { mountDashboardBridge } from './services_apex_apexBridge'

// Inner wrapper — hooks must be inside a component tree
function AppCore() {
  useSystemStatus()

  // ── Apex Command Center Bridge (additive — never breaks existing logic) ──
  useEffect(() => {
    const cleanup = mountDashboardBridge()
    return cleanup
  }, [])

  return <RouterProvider router={router} />
}

export default function App() {
  return (
    <AuthProvider>
      <AppCore />
    </AuthProvider>
  )
}
