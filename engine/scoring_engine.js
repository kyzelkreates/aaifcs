/**
 * ============================================================
 * AP3X FLEET INTELLIGENCE — Scoring Engine
 * engine/scoring_engine.js
 *
 * Deterministic multi-factor driver scoring.
 * No AI, no external APIs, no side effects.
 *
 * INPUT:  task · drivers[] · driverLocations[] · allActiveTasks[]
 * OUTPUT: ScoredDriver[] sorted descending by score (top 3 downstream)
 *
 * SCORE FACTORS (all 0-100):
 *   distance_score    weight 0.35  — proximity to pickup (most important)
 *   availability      weight 0.25  — free + online
 *   priority_match    weight 0.15  — driver tier vs task priority
 *   workload          weight 0.15  — fewer active tasks = higher score
 *   reliability       weight 0.10  — neutral placeholder (future: trip history)
 *
 * FINAL SCORE: weighted average, 0-100
 * ============================================================
 */

// ─── Factor weights ───────────────────────────────────────────
const W = {
  distance:      0.35,
  availability:  0.25,
  priorityMatch: 0.15,
  workload:      0.15,
  reliability:   0.10,
}

// ─── Helpers ──────────────────────────────────────────────────
function clamp(v, lo = 0, hi = 100) {
  return Math.min(hi, Math.max(lo, Math.round(v)))
}

/**
 * Haversine distance (km) between two lat/lng points.
 * Returns null if either point is missing.
 */
function haversineKm(a, b) {
  if (!a?.lat || !a?.lng || !b?.lat || !b?.lng) return null
  const R  = 6371
  const d2r = Math.PI / 180
  const dLat = (b.lat - a.lat) * d2r
  const dLng = (b.lng - a.lng) * d2r
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(a.lat * d2r) * Math.cos(b.lat * d2r) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.asin(Math.sqrt(s))
}

/**
 * Convert raw distance (km) into a 0-100 score.
 * 0 km  → 100 (perfect)
 * 50 km → 0   (too far)
 * Linear decay clamped at 0.
 */
function distanceToScore(km) {
  if (km === null) return 50   // unknown — neutral
  return clamp(100 - (km / 50) * 100)
}

// ─── Active-task set (for workload scoring) ───────────────────
const ACTIVE_STATUSES = new Set(['assigned', 'accepted', 'in_progress'])

/**
 * scoreDrivers(task, drivers, driverLocations, allActiveTasks)
 *
 * @param {object}   task              — task record from Supabase
 * @param {object[]} drivers           — all available drivers (pre-filtered by rules engine)
 * @param {object[]} driverLocations   — driver_locations rows (may be empty)
 * @param {object[]} allActiveTasks    — all non-terminal tasks (for workload)
 *
 * @returns {ScoredDriver[]} sorted descending by score
 *
 * ScoredDriver shape:
 * {
 *   driver_id:    string
 *   driver:       object        — full driver row
 *   score:        number        — 0-100
 *   rank:         number        — 1-based
 *   factors: {
 *     distance_score:    number
 *     distance_km:       number | null
 *     availability:      number
 *     priority_match:    number
 *     workload:          number
 *     reliability:       number
 *   }
 *   explanation:  string[]      — human-readable breakdown
 *   location:     { lat, lng } | null
 * }
 */
export function scoreDrivers(task, drivers, driverLocations = [], allActiveTasks = []) {
  if (!drivers?.length) return []

  // Build fast lookup: driver_id → location
  const locMap = new Map(
    driverLocations.map(l => [l.driver_id, l])
  )

  // Pickup location
  const pickup = task.pickup_lat && task.pickup_lng
    ? { lat: task.pickup_lat, lng: task.pickup_lng }
    : null     // may be null if address wasn't geocoded yet

  // Active tasks per driver
  const activeCounts = {}
  for (const t of allActiveTasks) {
    if (t.assigned_driver && ACTIVE_STATUSES.has(t.status)) {
      activeCounts[t.assigned_driver] = (activeCounts[t.assigned_driver] || 0) + 1
    }
  }

  const scored = drivers.map(driver => {
    const loc  = locMap.get(driver.id)
    const dPos = loc?.lat && loc?.lng
      ? { lat: loc.lat, lng: loc.lng }
      : (driver.lat && driver.lng ? { lat: driver.lat, lng: driver.lng } : null)

    const explanation = []

    // ── FACTOR 1: Distance ──────────────────────────────────
    const distKm      = pickup && dPos ? haversineKm(dPos, pickup) : null
    const distScore   = distanceToScore(distKm)

    if (distKm !== null) {
      explanation.push(`${distKm.toFixed(1)} km from pickup → distance score ${distScore}`)
    } else {
      explanation.push('No GPS location — distance scored as neutral (50)')
    }

    // ── FACTOR 2: Availability ──────────────────────────────
    const status       = (driver.status || '').toLowerCase()
    const isOnline     = ['online', 'active', 'available', 'idle'].includes(status)
    const isOnBreak    = status === 'on_break'
    let availScore     = isOnline ? 100 : isOnBreak ? 55 : 10
    explanation.push(
      `Status '${driver.status}' → availability score ${availScore}`
    )

    // ── FACTOR 3: Priority match ────────────────────────────
    // All drivers equal in MVP — placeholder for future tiers
    const priorityScore = (() => {
      const taskP = task.priority || 'normal'
      const tier  = driver.tier || driver.driver_tier || 'standard'
      if (taskP === 'urgent')  return tier === 'senior' ? 100 : 70
      if (taskP === 'high')    return tier === 'senior' ? 95  : 80
      return 85  // normal/low — any driver is fine
    })()
    explanation.push(`Task priority '${task.priority || 'normal'}' → priority match ${priorityScore}`)

    // ── FACTOR 4: Workload ──────────────────────────────────
    const activeCount  = activeCounts[driver.id] || 0
    const workloadScore = clamp(100 - activeCount * 100)  // 0 tasks = 100, 1+ = 0
    explanation.push(
      `${activeCount} active task(s) → workload score ${workloadScore}`
    )

    // ── FACTOR 5: Reliability (neutral placeholder) ─────────
    const reliabilityScore = 70  // neutral — future: derive from completed trips
    explanation.push(`Reliability score ${reliabilityScore} (baseline — will improve with trip history)`)

    // ── Weighted total ──────────────────────────────────────
    const score = clamp(
      distScore      * W.distance
      + availScore   * W.availability
      + priorityScore * W.priorityMatch
      + workloadScore * W.workload
      + reliabilityScore * W.reliability
    )

    return {
      driver_id:  driver.id,
      driver,
      score,
      rank:       0,   // set below after sort
      factors: {
        distance_score:  distScore,
        distance_km:     distKm !== null ? Math.round(distKm * 10) / 10 : null,
        availability:    availScore,
        priority_match:  priorityScore,
        workload:        workloadScore,
        reliability:     reliabilityScore,
      },
      explanation,
      location: dPos,
    }
  })

  // Sort descending, assign rank
  scored.sort((a, b) => b.score - a.score)
  scored.forEach((d, i) => { d.rank = i + 1 })

  return scored
}

export const scoringEngine = { scoreDrivers }
export default scoringEngine
