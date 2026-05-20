/**
 * ============================================================
 * APEX AI — Route Registry (Run 15 — AI route added)
 * /src/config/routes.js
 * ============================================================
 */

export const ROUTES = {
  // ── Core ──────────────────────────────────────────────────
  ROOT:       '/',
  DASHBOARD:  '/dashboard',

  // ── Fleet ─────────────────────────────────────────────────
  FLEET:          '/fleet',
  FLEET_VEHICLE:  '/fleet/:vehicleId',

  // ── Drivers ───────────────────────────────────────────────
  DRIVERS:         '/drivers',
  DRIVER_PROFILE:  '/drivers/:driverId',

  // ── Vehicles ──────────────────────────────────────────────
  VEHICLES:        '/vehicles',
  VEHICLE_DETAIL:  '/vehicles/:vehicleId',

  // ── Dispatch ──────────────────────────────────────────────
  DISPATCH: '/dispatch',

  // ── Driver Setup ──────────────────────────────────────────
  DRIVER_SETUP: '/driver-setup',

  // ── Navigation / AP3X ─────────────────────────────────────
  NAVIGATION: '/navigation',
  AP3X:       '/ap3x',

  // ── AI Intelligence ───────────────────────────────────────
  AI: '/ai',    // Run 15

  // ── Compliance ────────────────────────────────────────────
  COMPLIANCE: '/compliance',

  // ── Safety AI ─────────────────────────────────────────────
  SAFETY: '/safety',

  // ── Analytics ─────────────────────────────────────────────
  ANALYTICS: '/analytics',

  // ── Incidents ─────────────────────────────────────────────
  INCIDENTS:        '/incidents',
  INCIDENT_DETAIL:  '/incidents/:incidentId',

  // ── Messaging ─────────────────────────────────────────────
  MESSAGING: '/messaging',

  // ── Settings ──────────────────────────────────────────────
  SETTINGS:               '/settings',
  SETTINGS_PROFILE:       '/settings/profile',
  SETTINGS_FLEET:         '/settings/fleet',
  SETTINGS_AI:            '/settings/ai',
  SETTINGS_SECURITY:      '/settings/security',
  SETTINGS_INTEGRATIONS:  '/settings/integrations',

  // ── Auth ──────────────────────────────────────────────────
  AUTH_LOGIN:   '/auth/login',
  AUTH_LOGOUT:  '/auth/logout',
  AUTH_DRIVER:  '/auth/driver',

  // ── Error ─────────────────────────────────────────────────
  NOT_FOUND: '*'
}

// ─── Nav structure for sidebar ────────────────────────────────
export const NAV_ITEMS = [
  {
    id:    'dashboard',
    label: 'Dashboard',
    route: ROUTES.DASHBOARD,
    icon:  'LayoutDashboard',
    group: 'core'
  },
  {
    id:    'fleet',
    label: 'Fleet Control',
    route: ROUTES.FLEET,
    icon:  'Truck',
    group: 'operations',
  },
  {
    id:    'drivers',
    label: 'Drivers',
    route: ROUTES.DRIVERS,
    icon:  'Users',
    group: 'operations'
  },
  {
    id:    'vehicles',
    label: 'Vehicles',
    route: ROUTES.VEHICLES,
    icon:  'Car',
    group: 'operations'
  },
  {
    id:    'dispatch',
    label: 'Dispatch',
    route: ROUTES.DISPATCH,
    icon:  'Radio',
    group: 'operations'
  },
  {
    id:        'driver-setup',
    label:     'Set Driver Up With App',
    route:     ROUTES.DRIVER_SETUP,
    icon:      'Smartphone',
    group:     'operations',
    highlight: true,
  },
  {
    id:    'navigation',
    label: 'Live Map',
    route: ROUTES.NAVIGATION,
    icon:  'Map',
    group: 'navigation'
  },
  // AP3X is a standalone driver-facing app — not a fleet ops nav item
  // Accessed at /#/driver-app or /#/ap3x (public, no auth required)
  {
    id:        'ai',
    label:     'AI Command',
    route:     ROUTES.AI,
    icon:      'Brain',
    group:     'intelligence',
    highlight: true   // glows in sidebar
  },
  {
    id:    'safety',
    label: 'Safety AI',
    route: ROUTES.SAFETY,
    icon:  'ShieldCheck',
    group: 'intelligence'
  },
  {
    id:    'compliance',
    label: 'Compliance',
    route: ROUTES.COMPLIANCE,
    icon:  'ClipboardCheck',
    group: 'intelligence'
  },
  {
    id:    'analytics',
    label: 'Analytics',
    route: ROUTES.ANALYTICS,
    icon:  'BarChart3',
    group: 'intelligence'
  },
  {
    id:    'incidents',
    label: 'Incidents',
    route: ROUTES.INCIDENTS,
    icon:  'AlertTriangle',
    group: 'reporting'
  },
  {
    id:    'messaging',
    label: 'Messaging',
    route: ROUTES.MESSAGING,
    icon:  'MessageSquare',
    group: 'reporting'
  },
  {
    id:    'settings',
    label: 'Settings',
    route: ROUTES.SETTINGS,
    icon:  'Settings',
    group: 'system'
  }
]

export const NAV_GROUPS = {
  core:         { label: null,            order: 0 },
  operations:   { label: 'Operations',    order: 1 },
  navigation:   { label: 'Navigation',    order: 2 },
  intelligence: { label: 'Intelligence',  order: 3 },
  reporting:    { label: 'Reporting',     order: 4 },
  system:       { label: 'System',        order: 5 }
}

export default ROUTES
