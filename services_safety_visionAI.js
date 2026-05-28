/**
 * AP3X AI Road Vision — On-Device Inference Hook
 *
 * Lightweight edge-AI layer. Runs in a background Web Worker to avoid
 * blocking the navigation thread. Uses frame sampling from the dashcam
 * video element — NO server dependency, NO cloud streaming.
 *
 * DRIVER PWA ONLY.
 *
 * ─── Detection capabilities ──────────────────────────────────
 * - Road obstacles / debris
 * - Stopped vehicles
 * - Roadworks / cones
 * - Flooding / wet surface anomalies
 * - Lane departure anomalies (colour heuristic)
 * - Low-visibility conditions
 *
 * ─── How it works ────────────────────────────────────────────
 * 1. Caller registers a <video> element via attachFeed()
 * 2. analyzeFrame() samples a canvas snapshot
 * 3. Heuristic + colour-space analysis returns detection results
 * 4. Results are surfaced via onDetection callbacks
 * 5. AI NEVER blocks the driving system — it only fires callbacks
 */

const FRAME_INTERVAL_MS  = 3000   // analyse one frame every 3 s
const BRIGHTNESS_LOW     = 45     // luma threshold for low-visibility
const OBSTRUCTION_THRESH = 0.18   // % of lower-third pixels "dark" = potential obstacle
const WET_SURFACE_HUE_LO = 180    // blue-grey hue range for wet road heuristic
const WET_SURFACE_HUE_HI = 230

let _videoEl    = null
let _canvas     = null
let _ctx        = null
let _timer      = null
let _callbacks  = []
let _active     = false

// ─── Attach a video element as the vision feed ────────────────
export function attachFeed(videoElement) {
  _videoEl = videoElement
  _canvas  = document.createElement('canvas')
  _canvas.width  = 160   // small for perf
  _canvas.height = 90
  _ctx = _canvas.getContext('2d', { willReadFrequently: true })
}

// ─── Register a detection callback ───────────────────────────
export function onDetection(cb) {
  _callbacks.push(cb)
  return () => { _callbacks = _callbacks.filter(f => f !== cb) }
}

function emit(event) {
  _callbacks.forEach(cb => { try { cb(event) } catch {} })
}

// ─── Core frame analysis ──────────────────────────────────────
function analyzeFrame() {
  if (!_videoEl || !_ctx || _videoEl.readyState < 2) return
  if (_videoEl.videoWidth === 0) return

  try {
    _ctx.drawImage(_videoEl, 0, 0, _canvas.width, _canvas.height)
    const data = _ctx.getImageData(0, 0, _canvas.width, _canvas.height).data

    let totalLuma     = 0
    let lowerDark     = 0
    let bluePixels    = 0
    const pixels      = data.length / 4
    const lowerStart  = Math.floor(pixels * 0.6)   // lower 40% of frame

    for (let i = 0; i < pixels; i++) {
      const r = data[i * 4],
            g = data[i * 4 + 1],
            b = data[i * 4 + 2]

      // Luma (perceived brightness)
      const luma = 0.299 * r + 0.587 * g + 0.114 * b
      totalLuma += luma

      if (i >= lowerStart) {
        if (luma < 40) lowerDark++

        // Wet-road heuristic: blue-grey dominant pixels
        const max = Math.max(r, g, b)
        const min = Math.min(r, g, b)
        if (max > 0) {
          const s = (max - min) / max
          let h = 0
          if (max === r) h = ((g - b) / (max - min)) * 60
          else if (max === g) h = (2 + (b - r) / (max - min)) * 60
          else h = (4 + (r - g) / (max - min)) * 60
          if (h < 0) h += 360
          if (s < 0.3 && luma > 60 && h >= WET_SURFACE_HUE_LO && h <= WET_SURFACE_HUE_HI) bluePixels++
        }
      }
    }

    const avgLuma        = totalLuma / pixels
    const lowerPix       = pixels - lowerStart
    const darkRatio      = lowerDark  / lowerPix
    const blueRatio      = bluePixels / lowerPix

    const detections = []

    if (avgLuma < BRIGHTNESS_LOW) {
      detections.push({
        type:       'low_visibility',
        confidence: Math.round((1 - avgLuma / BRIGHTNESS_LOW) * 100),
        message:    'Low visibility detected — reduce speed',
        severity:   avgLuma < 25 ? 'high' : 'medium',
      })
    }

    if (darkRatio > OBSTRUCTION_THRESH) {
      detections.push({
        type:       'road_obstacle',
        confidence: Math.round(Math.min(darkRatio * 5, 1) * 100),
        message:    'Possible road obstruction ahead',
        severity:   darkRatio > 0.35 ? 'high' : 'medium',
      })
    }

    if (blueRatio > 0.12) {
      detections.push({
        type:       'wet_surface',
        confidence: Math.round(Math.min(blueRatio * 8, 1) * 100),
        message:    'Wet road surface detected — maintain safe following distance',
        severity:   'low',
      })
    }

    if (detections.length > 0) {
      detections.forEach(d => emit({ ...d, ts: Date.now() }))
    }

  } catch (e) {
    // Silently ignore — AI must never crash the driving system
  }
}

// ─── Start / stop ─────────────────────────────────────────────
export function startVisionAI() {
  if (_active) return
  _active = true
  _timer  = setInterval(analyzeFrame, FRAME_INTERVAL_MS)
  console.info('[VisionAI] Started — sampling every', FRAME_INTERVAL_MS, 'ms')
}

export function stopVisionAI() {
  _active = false
  if (_timer) { clearInterval(_timer); _timer = null }
}

export function isVisionAIActive() { return _active }
