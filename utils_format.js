/**
 * ============================================================
 * APEX AI — Format Utilities
 * /src/utils/format.js
 * ============================================================
 */

/** Format a distance in metres to human-readable */
export const formatDistance = (metres) => {
  if (metres == null) return '—'
  if (metres < 1000) return `${Math.round(metres)}m`
  return `${(metres / 1000).toFixed(1)}km`
}

/** Format seconds to human-readable duration */
export const formatDuration = (seconds) => {
  if (seconds == null) return '—'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

/** Format speed */
export const formatSpeed = (kmh) => {
  if (kmh == null) return '—'
  return `${Math.round(kmh)} km/h`
}

/** Format fuel level */
export const formatFuel = (percent) => {
  if (percent == null) return '—'
  return `${Math.round(percent)}%`
}

/** Format coordinates */
export const formatCoords = (lat, lng) => {
  if (lat == null || lng == null) return '—'
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`
}

/** Truncate string */
export const truncate = (str, max = 32) => {
  if (!str) return ''
  return str.length > max ? str.slice(0, max) + '…' : str
}

/** Format timestamp */
export const formatTime = (ts) => {
  if (!ts) return '—'
  return new Date(ts).toLocaleTimeString('en-GB', { hour12: false })
}

export const formatDate = (ts) => {
  if (!ts) return '—'
  return new Date(ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export const formatDateTime = (ts) => {
  if (!ts) return '—'
  return `${formatDate(ts)} ${formatTime(ts)}`
}

export default {
  formatDistance, formatDuration, formatSpeed,
  formatFuel, formatCoords, truncate,
  formatTime, formatDate, formatDateTime
}
