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

// Inner wrapper — hooks must be inside a component tree
function AppCore() {
  useSystemStatus()
  return <RouterProvider router={router} />
}

export default function App() {
  return (
    <AuthProvider>
      <AppCore />
    </AuthProvider>
  )
}
