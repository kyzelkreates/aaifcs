/**
 * ============================================================
 * APEX AI — App Configuration
 * /src/config/app.js
 * ============================================================
 */

export const APP_CONFIG = {
  name:        'Apex Intelligent AI',
  shortName:   'Apex AI',
  version:     '1.0.0',
  buildStage:  'Run 1 — Foundation',
  tagline:     'Enterprise Fleet Intelligence Ecosystem',

  products: {
    fleetOS: {
      name:   '4P3X Intelligent AI Fleet Control OS',
      short:  'Fleet Control OS',
      route:  '/dashboard'
    },
    navPlatform: {
      name:   '4P3X Intelligent AI Navigation Platform',
      short:  'AP3X Navigation',
      route:  '/ap3x'
    }
  },

  theme: {
    default: 'dark',
    options: ['dark']
  },

  features: {
    // Enabled in Run 1
    sidebar:      true,
    topnav:       true,
    pwa:          true,
    routing:      true,

    // Future runs
    auth:         false,
    maps:         false,
    ai:           false,
    realtime:     false,
    offline:      false,
    notifications: false
  }
}

export default APP_CONFIG
