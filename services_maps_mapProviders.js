/**
 * ============================================================
 * APEX AI — Map Provider Registry
 * /src/services/maps/mapProviders.js
 *
 * Defines all supported map providers with:
 * - tile endpoints
 * - routing endpoints
 * - required attribution (LEGAL REQUIREMENT)
 * - fallback chain
 *
 * Attribution banners are MANDATORY per provider license.
 * OSM attribution is always shown as base fallback.
 * ============================================================
 */

import { getRuntimeKey, RUNTIME_KEYS } from './services_maps_runtimeKeys'

export const MAP_PROVIDERS = {
  GRAPHHOPPER: 'graphhopper',
  GOOGLE:      'google',
  MAPBOX:      'mapbox',
  OSM:         'osm'        // Always the fallback
}

// ─── Provider Definitions ─────────────────────────────────────
export const PROVIDER_DEFINITIONS = {

  [MAP_PROVIDERS.GRAPHHOPPER]: {
    id:          MAP_PROVIDERS.GRAPHHOPPER,
    name:        'GraphHopper',
    type:        'routing',    // routing engine, pairs with OSM tiles
    available:   () => !!(getRuntimeKey(RUNTIME_KEYS.GRAPHHOPPER) || import.meta.env.VITE_GRAPHHOPPER_API_KEY),
    apiKeyEnv:   'VITE_GRAPHHOPPER_API_KEY',
    routing: {
      baseUrl:   'https://graphhopper.com/api/1',
      endpoint:  '/route',
      geocode:   '/geocode'
    },
    tiles: null,               // GH uses OSM tiles for rendering
    attribution: {
      text: 'Routing by GraphHopper | Map data © OpenStreetMap contributors',
      url:  'https://www.graphhopper.com',
      osmUrl: 'https://www.openstreetmap.org/copyright',
      required: true
    },
    features: {
      routing:     true,
      geocoding:   true,
      isochrones:  true,
      matrix:      true,
      offline:     false
    }
  },

  [MAP_PROVIDERS.GOOGLE]: {
    id:        MAP_PROVIDERS.GOOGLE,
    name:      'Google Maps',
    type:      'full',
    available: () => !!(getRuntimeKey(RUNTIME_KEYS.GOOGLE_MAPS) || import.meta.env.VITE_GOOGLE_MAPS_API_KEY),
    apiKeyEnv: 'VITE_GOOGLE_MAPS_API_KEY',
    routing: {
      baseUrl:  'https://maps.googleapis.com/maps/api',
      endpoint: '/directions/json',
      geocode:  '/geocode/json',
      places:   '/place'
    },
    tiles: {
      url: (x, y, z, key) =>
        `https://maps.googleapis.com/maps/vt?lyrs=m&x=${x}&y=${y}&z=${z}&key=${key}`
    },
    attribution: {
      text:     'Map data ©2024 Google',
      url:      'https://maps.google.com',
      required: true,
      // Google provides its own attribution UI — we still render our banner
      googleManaged: true
    },
    features: {
      routing:     true,
      geocoding:   true,
      places:      true,
      streetview:  true,
      traffic:     true,
      offline:     false
    }
  },

  [MAP_PROVIDERS.MAPBOX]: {
    id:        MAP_PROVIDERS.MAPBOX,
    name:      'Mapbox',
    type:      'full',
    available: () => !!(getRuntimeKey(RUNTIME_KEYS.MAPBOX) || import.meta.env.VITE_MAPBOX_TOKEN),
    apiKeyEnv: 'VITE_MAPBOX_TOKEN',
    routing: {
      baseUrl:  'https://api.mapbox.com',
      endpoint: '/directions/v5/mapbox',
      geocode:  '/geocoding/v5/mapbox.places'
    },
    tiles: {
      style: 'mapbox://styles/mapbox/dark-v11'
    },
    attribution: {
      text:     '© Mapbox © OpenStreetMap contributors',
      url:      'https://www.mapbox.com/about/maps',
      osmUrl:   'https://www.openstreetmap.org/copyright',
      required: true
    },
    features: {
      routing:   true,
      geocoding: true,
      offline:   false,
      traffic:   true
    }
  },

  [MAP_PROVIDERS.OSM]: {
    id:        MAP_PROVIDERS.OSM,
    name:      'OpenStreetMap',
    type:      'tiles',
    available: () => true,     // Always available — no API key needed
    apiKeyEnv: null,
    routing: {
      // OSRM public demo — replace with self-hosted for production
      baseUrl:  'https://router.project-osrm.org',
      endpoint: '/route/v1/driving'
    },
    tiles: {
      url:         'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      subdomains:  ['a', 'b', 'c'],
      maxZoom:     19,
      tileSize:    256
    },
    attribution: {
      text:     '© OpenStreetMap contributors',
      url:      'https://www.openstreetmap.org/copyright',
      required: true,          // ALWAYS required when using OSM data
      osmLicense: 'ODbL'       // Open Database License
    },
    features: {
      routing:   true,
      geocoding: false,        // Nominatim available separately
      offline:   true          // Tiles can be cached
    }
  }
}

// ─── Fallback Chain ───────────────────────────────────────────
// Order: preferred → fallback → OSM (always last)
export const PROVIDER_FALLBACK_CHAIN = [
  MAP_PROVIDERS.GRAPHHOPPER,
  MAP_PROVIDERS.GOOGLE,
  MAP_PROVIDERS.MAPBOX,
  MAP_PROVIDERS.OSM         // Final fallback — always works
]

/**
 * Resolve the best available provider from the fallback chain.
 * @param {string} preferred - desired provider ID
 * @returns {object} resolved provider definition
 */
export const resolveProvider = (preferred) => {
  // Try preferred first
  const pref = PROVIDER_DEFINITIONS[preferred]
  if (pref && pref.available()) return pref

  // Walk fallback chain
  for (const id of PROVIDER_FALLBACK_CHAIN) {
    const def = PROVIDER_DEFINITIONS[id]
    if (def && def.available()) return def
  }

  // OSM is always the guaranteed fallback
  return PROVIDER_DEFINITIONS[MAP_PROVIDERS.OSM]
}

export default { MAP_PROVIDERS, PROVIDER_DEFINITIONS, PROVIDER_FALLBACK_CHAIN, resolveProvider }
