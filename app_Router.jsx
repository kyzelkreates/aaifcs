/**
 * ============================================================
 * APEX AI — Application Router (Local Auth Mode)
 * First-run redirects to /auth/setup to create accounts.
 * ============================================================
 */

import { createHashRouter, Navigate } from 'react-router-dom'

import AppShell      from './layouts_AppShell'
import AuthGuard     from './components_auth_AuthGuard'

// Auth Pages
import Login         from './pages_auth_Login'
import DriverLogin   from './pages_auth_DriverLogin'
import ResetConfirm  from './pages_auth_ResetConfirm'
import Setup         from './pages_auth_Setup'
import DriverImport  from './pages_DriverImport'
import DriverSetup  from './pages_DriverSetup'
import DriverApp    from './pages_DriverApp'

// App Pages
import Dashboard   from './pages_Dashboard'
import Fleet       from './pages_Fleet'
import Drivers     from './pages_Drivers'
import Vehicles    from './pages_Vehicles'
import Dispatch    from './pages_Dispatch'
import Navigation  from './pages_Navigation'
import AP3X        from './pages_AP3X'
import Compliance  from './pages_Compliance'
import Safety      from './pages_Safety'
import Analytics   from './pages_Analytics'
import Incidents   from './pages_Incidents'
import Messaging   from './pages_Messaging'
import Settings    from './pages_Settings'
import NotFound    from './pages_NotFound'
import AIPage      from './pages_AI'

// Helper — read setup flag without importing full service
const setupDone = () => localStorage.getItem('apex:setup_complete') === 'true'

// Root redirects: first-run → setup, otherwise → dashboard
const RootRedirect = () =>
  setupDone()
    ? <Navigate to="/dashboard" replace />
    : <Navigate to="/auth/setup" replace />

// Login redirect: if setup not done, go to setup first
const LoginOrSetup = ({ element }) =>
  !setupDone() ? <Navigate to="/auth/setup" replace /> : element

export const router = createHashRouter([

  // ── First-run Setup (public, before any account exists) ───
  { path: '/auth/setup',         element: <Setup /> },

  // ── Auth Routes (public) ──────────────────────────────────
  { path: '/auth/login',         element: <LoginOrSetup element={<Login />} /> },
  { path: '/auth/driver',        element: <LoginOrSetup element={<DriverLogin />} /> },
  { path: '/auth/reset-confirm', element: <ResetConfirm /> },
  { path: '/driver-import',       element: <DriverImport /> },
  { path: '/driver-app',          element: <DriverApp /> },
  { path: '/ap3x',               element: <AP3X /> },

  // ── Protected App Shell ────────────────────────────────────
  {
    path: '/',
    element: (
      <AuthGuard>
        <AppShell />
      </AuthGuard>
    ),
    children: [
      { index: true, element: <RootRedirect /> },

      // Core
      { path: 'dashboard',              element: <Dashboard /> },

      // Operations
      { path: 'fleet',                  element: <Fleet /> },
      { path: 'fleet/:vehicleId',       element: <Fleet /> },
      { path: 'drivers',                element: <Drivers /> },
      { path: 'drivers/:driverId',      element: <Drivers /> },
      { path: 'vehicles',               element: <Vehicles /> },
      { path: 'vehicles/:vehicleId',    element: <Vehicles /> },
      { path: 'dispatch',               element: <Dispatch /> },
      { path: 'driver-setup',           element: <DriverSetup /> },

      // Navigation
      { path: 'navigation',             element: <Navigation /> },
      // AP3X is a public standalone driver app — not in protected fleet shell

      // Intelligence
      { path: 'ai',                     element: <AIPage /> },
      { path: 'safety',                 element: <Safety /> },
      { path: 'compliance',             element: <Compliance /> },
      { path: 'analytics',              element: <Analytics /> },

      // Reporting
      { path: 'incidents',              element: <Incidents /> },
      { path: 'incidents/:incidentId',  element: <Incidents /> },
      { path: 'messaging',              element: <Messaging /> },

      // System
      { path: 'settings',               element: <Settings /> },
      { path: 'settings/:section',      element: <Settings /> },
    ]
  },

  // ── 404 ───────────────────────────────────────────────────
  { path: '*', element: <NotFound /> }
])

export default router
