/**
 * ============================================================
 * APEX AI — Map Service (Run 2 — Provider Architecture)
 * /src/services/maps/mapService.js
 *
 * Provider-agnostic routing + geocoding abstraction.
 * Always falls back to OSM/OSRM if primary provider fails.
 * Live map tile rendering implemented in Run 4.
 * ============================================================
 */

import { getRuntimeKey, RUNTIME_KEYS } from './services_maps_runtimeKeys'
import {
  MAP_PROVIDERS,
  PROVIDER_DEFINITIONS,
  PROVIDER_FALLBACK_CHAIN,
  resolveProvider
} from './services_maps_mapProviders'
import { useMapStore } from './core_storage'

// ─── GraphHopper Adapter ──────────────────────────────────────
const graphHopperAdapter = {
  async route(origin, destination, options = {}) {
    const key = getRuntimeKey(RUNTIME_KEYS.GRAPHHOPPER)
    if (!key) throw new Error('GraphHopper API key not configured')
    const profile = options.profile || 'car'
    const url = new URL('https://graphhopper.com/api/1/route')
    url.searchParams.set('key', key)
    url.searchParams.set('vehicle', profile)
    url.searchParams.set('locale', 'en')
    url.searchParams.set('instructions', 'true')
    url.searchParams.set('calc_points', 'true')
    url.searchParams.set('points_encoded', 'false')
    url.searchParams.append('point', `${origin.lat},${origin.lng}`)
    url.searchParams.append('point', `${destination.lat},${destination.lng}`)

    const res = await fetch(url.toString())
    if (!res.ok) throw new Error(`GraphHopper error: ${res.status}`)
    const data = await res.json()
    return normalizeRoute(data, 'graphhopper')
  },

  async geocode(query) {
    const key = getRuntimeKey(RUNTIME_KEYS.GRAPHHOPPER)
    if (!key) throw new Error('GraphHopper API key not configured')
    const url = `https://graphhopper.com/api/1/geocode?q=${encodeURIComponent(query)}&key=${key}&limit=5`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`GraphHopper geocode error: ${res.status}`)
    const data = await res.json()
    return normalizeGeocode(data.hits || [], 'graphhopper')
  }
}

// ─── Google Maps Adapter ──────────────────────────────────────
const googleAdapter = {
  async route(origin, destination, options = {}) {
    const key  = getRuntimeKey(RUNTIME_KEYS.GOOGLE_MAPS)
    if (!key) throw new Error('Google Maps API key not configured')
    const mode = options.mode || 'driving'
    const url  = `https://maps.googleapis.com/maps/api/directions/json?origin=${origin.lat},${origin.lng}&destination=${destination.lat},${destination.lng}&mode=${mode}&key=${key}`
    const res  = await fetch(url)
    if (!res.ok) throw new Error(`Google Maps error: ${res.status}`)
    const data = await res.json()
    if (data.status !== 'OK') throw new Error(`Google Maps: ${data.status}`)
    return normalizeRoute(data, 'google')
  },

  async geocode(query) {
    const key = getRuntimeKey(RUNTIME_KEYS.GOOGLE_MAPS)
    if (!key) throw new Error('Google Maps API key not configured')
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${key}`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Google geocode error: ${res.status}`)
    const data = await res.json()
    return normalizeGeocode(data.results || [], 'google')
  }
}

// ─── OSM / OSRM Adapter (Fallback — No API Key) ───────────────
const osmAdapter = {
  async route(origin, destination) {
    const url = `https://router.project-osrm.org/route/v1/driving/${origin.lng},${origin.lat};${destination.lng},${destination.lat}?overview=full&geometries=geojson&steps=true`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`OSRM error: ${res.status}`)
    const data = await res.json()
    if (data.code !== 'Ok') throw new Error(`OSRM: ${data.code}`)
    return normalizeRoute(data, 'osrm')
  },

  async geocode(query) {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&addressdetails=1`
    const res = await fetch(url, {
      headers: { 'Accept-Language': 'en', 'User-Agent': 'ApexAI-FleetOS/1.0' }
    })
    if (!res.ok) throw new Error(`Nominatim error: ${res.status}`)
    const data = await res.json()
    return normalizeGeocode(data, 'nominatim')
  }
}

// ─── Response Normalizers ─────────────────────────────────────
function normalizeRoute(raw, source) {
  if (source === 'graphhopper') {
    const path = raw.paths?.[0]
    if (!path) return null
    return {
      source,
      distance:     path.distance,
      duration:     path.time / 1000,
      geometry:     path.points,
      instructions: (path.instructions || []).map(i => ({
        text:        i.text,
        distance:    i.distance,
        time:        i.time / 1000,
        sign:        i.sign,          // GH direction sign (-2=left, 0=straight, 2=right, etc.)
        exit_number: i.exit_number,   // roundabout exit
        interval:    i.interval,      // [start,end] waypoint index range
        street_name: i.street_name,   // street after the manoeuvre
      })),
      bbox:         path.bbox,
      attribution:  PROVIDER_DEFINITIONS[MAP_PROVIDERS.GRAPHHOPPER].attribution.text
    }
  }
  if (source === 'google') {
    const leg = raw.routes?.[0]?.legs?.[0]
    if (!leg) return null
    return {
      source,
      distance:     leg.distance.value,
      duration:     leg.duration.value,
      geometry:     raw.routes[0].overview_polyline?.points,
      instructions: (leg.steps || []).map(s => ({
        text:     s.html_instructions?.replace(/<[^>]*>/g, ''),
        distance: s.distance.value,
        time:     s.duration.value
      })),
      attribution: PROVIDER_DEFINITIONS[MAP_PROVIDERS.GOOGLE].attribution.text
    }
  }
  if (source === 'osrm') {
    const route = raw.routes?.[0]
    if (!route) return null
    return {
      source,
      distance:     route.distance,
      duration:     route.duration,
      geometry:     route.geometry,
      instructions: (route.legs?.[0]?.steps || []).map(s => ({
        text:     s.maneuver?.type,
        distance: s.distance,
        time:     s.duration
      })),
      attribution: PROVIDER_DEFINITIONS[MAP_PROVIDERS.OSM].attribution.text
    }
  }
  if (source === 'mapbox') {
    const route = raw.routes?.[0]
    if (!route) return null
    return {
      source,
      distance:     route.distance,
      duration:     route.duration,
      geometry:     route.geometry,   // GeoJSON LineString
      instructions: (route.legs?.[0]?.steps || []).map(s => ({
        text:     s.maneuver?.instruction || s.maneuver?.type,
        distance: s.distance,
        time:     s.duration,
        maneuver: s.maneuver,         // pass through for icon resolution
        name:     s.name,
      })),
      attribution: PROVIDER_DEFINITIONS[MAP_PROVIDERS.MAPBOX]?.attribution?.text || '© Mapbox'
    }
  }
  return raw
}

function normalizeGeocode(raw, source) {
  if (source === 'graphhopper') {
    return raw.map(h => ({
      source,
      name:    h.name,
      address: h.country ? `${h.name}, ${h.country}` : h.name,
      lat:     h.point.lat,
      lng:     h.point.lng
    }))
  }
  if (source === 'google') {
    return raw.map(r => ({
      source,
      name:    r.formatted_address,
      address: r.formatted_address,
      lat:     r.geometry.location.lat,
      lng:     r.geometry.location.lng
    }))
  }
  if (source === 'nominatim') {
    return raw.map(r => ({
      source,
      name:    r.display_name,
      address: r.display_name,
      lat:     parseFloat(r.lat),
      lng:     parseFloat(r.lon)
    }))
  }
  if (source === 'mapbox') {
    return (raw || []).map(f => ({
      source,
      name:    f.place_name,
      address: f.place_name,
      lat:     f.center[1],
      lng:     f.center[0],
    }))
  }
  return []
}

// ─── Mapbox Directions Adapter ───────────────────────────────
const mapboxAdapter = {
  async route(origin, destination, options = {}) {
    const token = getRuntimeKey(RUNTIME_KEYS.MAPBOX)
    if (!token) throw new Error('Mapbox token not configured')
    const profile = options.profile || 'driving'
    const url = `https://api.mapbox.com/directions/v5/mapbox/${profile}/${origin.lng},${origin.lat};${destination.lng},${destination.lat}?alternatives=false&geometries=geojson&steps=true&overview=full&access_token=${token}`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Mapbox error: ${res.status}`)
    const data = await res.json()
    if (!data.routes?.length) throw new Error('Mapbox: no routes returned')
    return normalizeRoute(data, 'mapbox')
  },

  async geocode(query) {
    const token = getRuntimeKey(RUNTIME_KEYS.MAPBOX)
    if (!token) throw new Error('Mapbox token not configured')
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${token}&limit=5`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Mapbox geocode error: ${res.status}`)
    const data = await res.json()
    return normalizeGeocode(data.features || [], 'mapbox')
  }
}

// ─── Adapter Map ──────────────────────────────────────────────
const ADAPTERS = {
  [MAP_PROVIDERS.GRAPHHOPPER]: graphHopperAdapter,
  [MAP_PROVIDERS.GOOGLE]:      googleAdapter,
  [MAP_PROVIDERS.MAPBOX]:      mapboxAdapter,
  [MAP_PROVIDERS.OSM]:         osmAdapter
}

// ─── Map Service ──────────────────────────────────────────────
export const mapService = {

  /**
   * Calculate a route, with automatic fallback to OSM.
   * @param {object} origin      - { lat, lng }
   * @param {object} destination - { lat, lng }
   * @param {object} options     - { profile, mode }
   * @returns Normalised route object
   */
  async route(origin, destination, options = {}) {
    // Build ordered list: stored preference first, then fallback chain (skipping dupes)
    // But ONLY include providers that have adapters AND available keys
    const stored    = useMapStore.getState().provider
    const ordered   = [stored, ...PROVIDER_FALLBACK_CHAIN.filter(p => p !== stored)]

    for (const id of ordered) {
      const def     = PROVIDER_DEFINITIONS[id]
      const adapter = ADAPTERS[id]
      // Skip if no adapter or key not available
      if (!adapter || !def?.available()) continue
      try {
        console.info(`[MapService] Routing via: ${id}`)
        const result = await adapter.route(origin, destination, options)
        if (result) {
          // Update stored provider to reflect what actually worked
          useMapStore.getState().setProvider(id)
          return { ...result, activeProvider: id }
        }
      } catch (err) {
        console.warn(`[MapService] ${id} routing failed:`, err.message)
        // continue to next
      }
    }

    // Guaranteed OSM/OSRM fallback (no key needed, always works)
    try {
      console.info('[MapService] Routing via: osrm (final fallback)')
      return await osmAdapter.route(origin, destination)
    } catch (err) {
      console.error('[MapService] All routing providers failed:', err)
      return null
    }
  },

  /**
   * Geocode an address, with automatic fallback to Nominatim.
   * @param {string} query
   * @returns Array of normalised results
   */
  async geocode(query) {
    const stored    = useMapStore.getState().provider
    const ordered   = [stored, ...PROVIDER_FALLBACK_CHAIN.filter(p => p !== stored)]

    for (const id of ordered) {
      const def     = PROVIDER_DEFINITIONS[id]
      const adapter = ADAPTERS[id]
      if (!adapter || !def?.available()) continue
      try {
        const results = await adapter.geocode(query)
        if (results?.length) return results
      } catch (err) {
        console.warn(`[MapService] ${id} geocode failed:`, err.message)
      }
    }

    // Nominatim fallback (always free, no key)
    try {
      return await osmAdapter.geocode(query)
    } catch {
      return []
    }
  },

  /**
   * Reverse geocode coordinates.
   * Uses Nominatim (always free).
   */
  async reverseGeocode(lat, lng) {
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`
      const res = await fetch(url, {
        headers: { 'Accept-Language': 'en', 'User-Agent': 'ApexAI-FleetOS/1.0' }
      })
      if (!res.ok) return null
      const data = await res.json()
      return {
        address:     data.display_name,
        lat, lng,
        source:      'nominatim',
        attribution: PROVIDER_DEFINITIONS[MAP_PROVIDERS.OSM].attribution.text
      }
    } catch {
      return null
    }
  },

  /** Get the active provider definition */
  getActiveProvider() {
    const id = useMapStore.getState().provider
    return resolveProvider(id)
  },

  /** Switch provider and persist to store */
  setProvider(id) {
    useMapStore.getState().setProvider(id)
  }
}

export default mapService
