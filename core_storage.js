/**
 * ============================================================
 * APEX AI — SINGLE SOURCE OF TRUTH
 * /src/core/storage.js
 *
 * ALL system state reads and writes through this module.
 * NO secondary state engines.
 * NO duplicate localStorage keys.
 * NO hard-coded UI state outside this file.
 * ============================================================
 */

import { create } from 'zustand'

// ─── Storage Keys ─────────────────────────────────────────────
export const STORAGE_KEYS = {
  // App
  APP_THEME:          'apex:app:theme',
  APP_SIDEBAR:        'apex:app:sidebar',
  APP_LOCALE:         'apex:app:locale',

  // Auth
  AUTH_SESSION:       'apex:auth:session',
  AUTH_USER:          'apex:auth:user',
  AUTH_ROLE:          'apex:auth:role',

  // Fleet
  FLEET_ACTIVE_VIEW:  'apex:fleet:activeView',
  FLEET_FILTERS:      'apex:fleet:filters',
  FLEET_SELECTED:     'apex:fleet:selected',

  // Map
  MAP_PROVIDER:       'apex:map:provider',
  MAP_CENTER:         'apex:map:center',
  MAP_ZOOM:           'apex:map:zoom',
  MAP_LAYER:          'apex:map:layer',

  // AI
  AI_PROVIDER:        'apex:ai:provider',
  AI_MODEL:           'apex:ai:model',
  AI_CONFIG:          'apex:ai:config',

  // Driver
  DRIVER_SELECTED:    'apex:driver:selected',
  DRIVER_SESSION:     'apex:driver:session',

  // Navigation
  NAV_ROUTE:          'apex:nav:route',
  NAV_DESTINATION:    'apex:nav:destination',
  NAV_MODE:           'apex:nav:mode',

  // Notifications
  NOTIF_QUEUE:        'apex:notif:queue',
  NOTIF_PREFS:        'apex:notif:prefs',
}

// ─── Persist Helpers ──────────────────────────────────────────
const persist = {
  get: (key, fallback = null) => {
    try {
      const raw = localStorage.getItem(key)
      return raw !== null ? JSON.parse(raw) : fallback
    } catch {
      return fallback
    }
  },
  set: (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch (e) {
      console.warn('[Apex:Storage] persist.set failed:', key, e)
    }
  },
  remove: (key) => {
    try {
      localStorage.removeItem(key)
    } catch {
      // silent
    }
  },
  clear: (prefix = 'apex:') => {
    try {
      Object.keys(localStorage)
        .filter(k => k.startsWith(prefix))
        .forEach(k => localStorage.removeItem(k))
    } catch {
      // silent
    }
  }
}

// ─── App Store ────────────────────────────────────────────────
export const useAppStore = create((set, get) => ({
  // ── State ──
  theme:           persist.get(STORAGE_KEYS.APP_THEME, 'dark'),
  sidebarExpanded: false, // burger mode — always starts closed
  locale:          persist.get(STORAGE_KEYS.APP_LOCALE, 'en'),
  systemStatus:    'online',   // 'online' | 'offline' | 'degraded'
  notifications:   [],
  alerts:          [],

  // ── Actions ──
  setTheme: (theme) => {
    persist.set(STORAGE_KEYS.APP_THEME, theme)
    set({ theme })
  },
  toggleSidebar: () => {
    const next = !get().sidebarExpanded
    persist.set(STORAGE_KEYS.APP_SIDEBAR, next)
    set({ sidebarExpanded: next })
  },
  setSidebarExpanded: (val) => {
    persist.set(STORAGE_KEYS.APP_SIDEBAR, val)
    set({ sidebarExpanded: val })
  },
  closeSidebar: () => set({ sidebarExpanded: false }),
  openSidebar:  () => set({ sidebarExpanded: true }),
  setSystemStatus: (status) => set({ systemStatus: status }),
  addNotification: (notif) => set(s => ({
    notifications: [{ id: Date.now(), ...notif }, ...s.notifications].slice(0, 50)
  })),
  clearNotifications: () => set({ notifications: [] }),
  addAlert: (alert) => set(s => ({
    alerts: [{ id: Date.now(), ...alert }, ...s.alerts].slice(0, 20)
  })),
  dismissAlert: (id) => set(s => ({
    alerts: s.alerts.filter(a => a.id !== id)
  })),
}))

// ─── Auth Store ───────────────────────────────────────────────
export const useAuthStore = create((set) => ({
  // ── State ──
  session:       persist.get(STORAGE_KEYS.AUTH_SESSION, null),
  user:          persist.get(STORAGE_KEYS.AUTH_USER, null),
  role:          persist.get(STORAGE_KEYS.AUTH_ROLE, null),
  isLoading:     false,
  isAuthenticated: false,

  // ── Actions ──
  setSession: (session) => {
    persist.set(STORAGE_KEYS.AUTH_SESSION, session)
    set({ session, isAuthenticated: !!session })
  },
  setUser: (user) => {
    persist.set(STORAGE_KEYS.AUTH_USER, user)
    set({ user })
  },
  setRole: (role) => {
    persist.set(STORAGE_KEYS.AUTH_ROLE, role)
    set({ role })
  },
  setLoading: (isLoading) => set({ isLoading }),
  clearAuth: () => {
    persist.remove(STORAGE_KEYS.AUTH_SESSION)
    persist.remove(STORAGE_KEYS.AUTH_USER)
    persist.remove(STORAGE_KEYS.AUTH_ROLE)
    set({ session: null, user: null, role: null, isAuthenticated: false })
  }
}))

// ─── Fleet Store ──────────────────────────────────────────────
export const useFleetStore = create((set) => ({
  // ── State ──
  vehicles:      [],
  activeVehicle: null,
  activeView:    persist.get(STORAGE_KEYS.FLEET_ACTIVE_VIEW, 'grid'),
  filters:       persist.get(STORAGE_KEYS.FLEET_FILTERS, {}),
  selectedIds:   persist.get(STORAGE_KEYS.FLEET_SELECTED, []),
  isLoading:     false,
  telemetry:     {},

  // ── Actions ──
  setVehicles: (vehicles) => set({ vehicles }),
  setActiveVehicle: (v) => set({ activeVehicle: v }),
  setActiveView: (view) => {
    persist.set(STORAGE_KEYS.FLEET_ACTIVE_VIEW, view)
    set({ activeView: view })
  },
  setFilters: (filters) => {
    persist.set(STORAGE_KEYS.FLEET_FILTERS, filters)
    set({ filters })
  },
  setSelectedIds: (ids) => {
    persist.set(STORAGE_KEYS.FLEET_SELECTED, ids)
    set({ selectedIds: ids })
  },
  setLoading: (isLoading) => set({ isLoading }),
  updateTelemetry: (vehicleId, data) => set(s => ({
    telemetry: { ...s.telemetry, [vehicleId]: { ...s.telemetry[vehicleId], ...data, ts: Date.now() } }
  }))
}))

// ─── Map Store ────────────────────────────────────────────────
export const useMapStore = create((set) => ({
  // ── State ──
  provider:   persist.get(STORAGE_KEYS.MAP_PROVIDER, 'osm'),  // OSM is always-on; upgrades auto when GH/Google key set
  center:     persist.get(STORAGE_KEYS.MAP_CENTER, { lat: 51.5074, lng: -0.1278 }),
  zoom:       persist.get(STORAGE_KEYS.MAP_ZOOM, 11),
  layer:      persist.get(STORAGE_KEYS.MAP_LAYER, 'tactical'),
  isLoaded:   false,
  markers:    [],
  routes:     [],
  geofences:  [],

  // ── Actions ──
  setProvider: (provider) => {
    persist.set(STORAGE_KEYS.MAP_PROVIDER, provider)
    set({ provider })
  },
  setCenter: (center) => {
    persist.set(STORAGE_KEYS.MAP_CENTER, center)
    set({ center })
  },
  setZoom: (zoom) => {
    persist.set(STORAGE_KEYS.MAP_ZOOM, zoom)
    set({ zoom })
  },
  setLayer: (layer) => {
    persist.set(STORAGE_KEYS.MAP_LAYER, layer)
    set({ layer })
  },
  setLoaded: (isLoaded) => set({ isLoaded }),
  setMarkers: (markers) => set({ markers }),
  addMarker: (m) => set(s => ({ markers: [...s.markers, m] })),
  setRoutes: (routes) => set({ routes }),
  setGeofences: (geofences) => set({ geofences })
}))

// ─── AI Store ─────────────────────────────────────────────────
export const useAIStore = create((set) => ({
  // ── State ──
  provider:       persist.get(STORAGE_KEYS.AI_PROVIDER, 'openai'),
  model:          persist.get(STORAGE_KEYS.AI_MODEL, null),
  config:         persist.get(STORAGE_KEYS.AI_CONFIG, {}),
  status:         'idle',   // 'idle' | 'loading' | 'streaming' | 'error'
  activeModule:   null,
  tokenUsage:     { prompt: 0, completion: 0, total: 0 },
  costEstimate:   0,
  fallbackActive: false,

  // ── Actions ──
  setProvider: (provider) => {
    persist.set(STORAGE_KEYS.AI_PROVIDER, provider)
    set({ provider })
  },
  setModel: (model) => {
    persist.set(STORAGE_KEYS.AI_MODEL, model)
    set({ model })
  },
  setConfig: (config) => {
    persist.set(STORAGE_KEYS.AI_CONFIG, config)
    set({ config })
  },
  setStatus: (status) => set({ status }),
  setActiveModule: (module) => set({ activeModule: module }),
  updateTokenUsage: (usage) => set(s => ({
    tokenUsage: {
      prompt:     s.tokenUsage.prompt + (usage.prompt || 0),
      completion: s.tokenUsage.completion + (usage.completion || 0),
      total:      s.tokenUsage.total + (usage.total || 0)
    }
  })),
  setCostEstimate: (cost) => set({ costEstimate: cost }),
  setFallbackActive: (val) => set({ fallbackActive: val })
}))

// ─── Driver Store ─────────────────────────────────────────────
export const useDriverStore = create((set) => ({
  // ── State ──
  drivers:        [],
  activeDriver:   persist.get(STORAGE_KEYS.DRIVER_SELECTED, null),
  driverSession:  persist.get(STORAGE_KEYS.DRIVER_SESSION, null),
  scores:         {},
  isLoading:      false,

  // ── Actions ──
  setDrivers: (drivers) => set({ drivers }),
  setActiveDriver: (driver) => {
    persist.set(STORAGE_KEYS.DRIVER_SELECTED, driver)
    set({ activeDriver: driver })
  },
  setDriverSession: (session) => {
    persist.set(STORAGE_KEYS.DRIVER_SESSION, session)
    set({ driverSession: session })
  },
  updateScore: (driverId, score) => set(s => ({
    scores: { ...s.scores, [driverId]: score }
  })),
  setLoading: (isLoading) => set({ isLoading })
}))

// ─── Navigation Store ─────────────────────────────────────────
export const useNavStore = create((set) => ({
  // ── State ──
  route:          persist.get(STORAGE_KEYS.NAV_ROUTE, null),
  destination:    persist.get(STORAGE_KEYS.NAV_DESTINATION, null),
  mode:           persist.get(STORAGE_KEYS.NAV_MODE, 'drive'),
  isNavigating:   false,
  currentPosition: null,
  eta:            null,
  distanceLeft:   null,
  turnInstructions: [],

  // ── Actions ──
  setRoute: (route) => {
    persist.set(STORAGE_KEYS.NAV_ROUTE, route)
    set({ route })
  },
  setDestination: (dest) => {
    persist.set(STORAGE_KEYS.NAV_DESTINATION, dest)
    set({ destination: dest })
  },
  setMode: (mode) => {
    persist.set(STORAGE_KEYS.NAV_MODE, mode)
    set({ mode })
  },
  setNavigating: (val) => set({ isNavigating: val }),
  setCurrentPosition: (pos) => set({ currentPosition: pos }),
  setEta: (eta) => set({ eta }),
  setDistanceLeft: (dist) => set({ distanceLeft: dist }),
  setTurnInstructions: (instr) => set({ turnInstructions: instr }),
  clearNavigation: () => {
    persist.remove(STORAGE_KEYS.NAV_ROUTE)
    persist.remove(STORAGE_KEYS.NAV_DESTINATION)
    set({ route: null, destination: null, isNavigating: false, eta: null, distanceLeft: null, turnInstructions: [] })
  }
}))

// ─── Realtime Store ───────────────────────────────────────────
export const useRealtimeStore = create((set) => ({
  connected:       false,
  channelStatuses: {},
  livePositions:   {},
  liveEvents:      [],

  setConnected: (connected) => set({ connected }),
  setChannelStatus: (channel, status) => set(s => ({
    channelStatuses: { ...s.channelStatuses, [channel]: status }
  })),
  updateLivePosition: (vehicleId, position) => set(s => ({
    livePositions: { ...s.livePositions, [vehicleId]: { ...position, ts: Date.now() } }
  })),
  addLiveEvent: (event) => set(s => ({
    liveEvents: [{ id: Date.now(), ...event }, ...s.liveEvents].slice(0, 100)
  })),
  clearLiveEvents: () => set({ liveEvents: [] })
}))

// ─── Root Storage API ─────────────────────────────────────────
// Unified access to persist helpers
export const Storage = persist

// ─── Store Selectors (convenience) ───────────────────────────
export const selectors = {
  app: {
    theme:           s => s.theme,
    sidebarExpanded: s => s.sidebarExpanded,
    systemStatus:    s => s.systemStatus,
    notifications:   s => s.notifications,
    alerts:          s => s.alerts,
  },
  auth: {
    user:            s => s.user,
    role:            s => s.role,
    isAuthenticated: s => s.isAuthenticated,
    isLoading:       s => s.isLoading,
  },
  fleet: {
    vehicles:        s => s.vehicles,
    activeVehicle:   s => s.activeVehicle,
    telemetry:       s => s.telemetry,
    isLoading:       s => s.isLoading,
  },
  ai: {
    provider:        s => s.provider,
    model:           s => s.model,
    status:          s => s.status,
    fallbackActive:  s => s.fallbackActive,
    tokenUsage:      s => s.tokenUsage,
  }
}

export default {
  STORAGE_KEYS,
  Storage,
  useAppStore,
  useAuthStore,
  useFleetStore,
  useMapStore,
  useAIStore,
  useDriverStore,
  useNavStore,
  useRealtimeStore,
  selectors
}
