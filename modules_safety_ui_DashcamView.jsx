/**
 * AP3X Dashcam View
 * Live camera feed + clip recording via MediaDevices API.
 * Integrates on-device VisionAI and logs captures to the offline vault.
 *
 * DRIVER PWA ONLY — no Fleet OS coupling.
 */
import { useRef, useState, useEffect, useCallback } from 'react'
import Icon from './components_ui_Icon'
import { attachFeed, onDetection, startVisionAI, stopVisionAI } from './services_safety_visionAI'
import { logDashcamEvent } from './services_safety_offlineVault'

const ROLLING_BUFFER_MS = 8 * 1000  // keep last 8 s in rolling buffer slots

export default function DashcamView({ driverId, taskId, onBack }) {
  const videoRef     = useRef(null)
  const streamRef    = useRef(null)
  const recorderRef  = useRef(null)
  const chunksRef    = useRef([])
  const [active,     setActive]     = useState(false)
  const [recording,  setRecording]  = useState(false)
  const [clips,      setClips]      = useState([])
  const [aiAlerts,   setAIAlerts]   = useState([])
  const [error,      setError]      = useState(null)
  const [facingMode, setFacingMode] = useState('environment')
  const [aiEnabled,  setAIEnabled]  = useState(true)

  // ── Start camera ─────────────────────────────────────────────
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        // Wire vision AI
        attachFeed(videoRef.current)
        if (aiEnabled) startVisionAI()
      }
      streamRef.current = stream
      setActive(true)
      setError(null)
    } catch {
      setError('Camera access denied or unavailable on this device')
    }
  }, [facingMode, aiEnabled])

  const stopCamera = useCallback(() => {
    stopVisionAI()
    streamRef.current?.getTracks().forEach(t => t.stop())
    if (videoRef.current) videoRef.current.srcObject = null
    setActive(false)
    setRecording(false)
  }, [])

  // ── Mount / unmount ──────────────────────────────────────────
  useEffect(() => {
    startCamera()
    return stopCamera
  }, [startCamera, stopCamera])

  // ── AI detection listener ────────────────────────────────────
  useEffect(() => {
    const unsub = onDetection(detection => {
      setAIAlerts(prev => [detection, ...prev].slice(0, 5))
      // Auto-trigger a clip save on high-severity AI detection
      if (detection.severity === 'high' && recorderRef.current) {
        stopRecording('ai_hazard')
      }
    })
    return unsub
  }, [])

  // ── Recording ────────────────────────────────────────────────
  const startRecording = () => {
    if (!streamRef.current) return
    chunksRef.current = []
    const supported = ['video/webm;codecs=vp9', 'video/webm', 'video/mp4']
      .find(t => MediaRecorder.isTypeSupported(t)) || ''
    const rec = new MediaRecorder(streamRef.current, supported ? { mimeType: supported } : {})
    rec.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
    rec.onstop = () => {
      const blob    = new Blob(chunksRef.current, { type: rec.mimeType || 'video/webm' })
      const url     = URL.createObjectURL(blob)
      const clipKey = `clip_${Date.now()}`
      const clip    = { url, ts: Date.now(), size: blob.size, key: clipKey }
      setClips(prev => [clip, ...prev].slice(0, 10))
      // Log to offline vault
      logDashcamEvent({
        driver_id:      driverId,
        task_id:        taskId,
        trigger:        rec._trigger || 'manual',
        clip_local_key: clipKey,
        duration_secs:  Math.round(blob.size / 50000),
        captured_at:    new Date().toISOString(),
      }).catch(() => {})
    }
    recorderRef.current = rec
    recorderRef.current._trigger = 'manual'
    rec.start()
    setRecording(true)
  }

  const stopRecording = (trigger = 'manual') => {
    if (!recorderRef.current) return
    recorderRef.current._trigger = trigger
    recorderRef.current.stop()
    recorderRef.current = null
    setRecording(false)
  }

  const flipCamera = () => {
    stopCamera()
    setFacingMode(m => m === 'environment' ? 'user' : 'environment')
  }

  const toggleAI = () => {
    if (aiEnabled) { stopVisionAI(); setAIEnabled(false) }
    else           { startVisionAI(); setAIEnabled(true) }
  }

  return (
    <div className="flex flex-col h-full bg-black">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-slate-900/90 border-b border-slate-800 flex-shrink-0">
        <button onClick={onBack} className="text-slate-400 hover:text-white">
          <Icon name="ArrowLeft" size={18} />
        </button>
        <span className="text-sm font-semibold text-slate-200">Dashcam</span>
        <div className="ml-auto flex items-center gap-3">
          {recording && (
            <span className="flex items-center gap-1.5 text-xs text-red-400 font-mono">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" /> REC
            </span>
          )}
          <button
            onClick={toggleAI}
            className={`flex items-center gap-1 text-xs px-2 py-1 rounded-lg border ${
              aiEnabled ? 'border-violet-500/30 text-violet-400 bg-violet-500/10' : 'border-slate-700 text-slate-500'
            }`}
          >
            <Icon name="Cpu" size={11} /> AI
          </button>
        </div>
      </div>

      {/* Notice */}
      <div className="bg-slate-900/60 border-b border-slate-800/50 px-4 py-1.5 flex items-center gap-2 flex-shrink-0">
        <Icon name="Shield" size={11} className="text-cyan-500" />
        <span className="text-xs text-slate-500">Driver Safety Recording Active · On-Device AI Processing · Evidence Capture Mode</span>
      </div>

      {/* Camera feed */}
      <div className="relative flex-1 bg-black flex items-center justify-center min-h-0">
        <video
          ref={videoRef}
          autoPlay muted playsInline
          className="w-full h-full object-cover"
        />

        {/* Error overlay */}
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 text-red-400">
            <Icon name="CameraOff" size={32} />
            <span className="text-sm text-center px-6">{error}</span>
            <button onClick={startCamera} className="text-xs text-cyan-400 underline">Retry</button>
          </div>
        )}

        {/* AI alert overlay */}
        {aiAlerts.length > 0 && aiEnabled && (
          <div className="absolute top-2 left-2 right-2 space-y-1 pointer-events-none">
            {aiAlerts.slice(0, 2).map((a, i) => (
              <div key={i} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold
                ${a.severity === 'high' ? 'bg-red-900/80 text-red-300' : 'bg-amber-900/80 text-amber-300'}`}>
                <Icon name="AlertTriangle" size={12} />
                {a.message}
              </div>
            ))}
          </div>
        )}

        {/* Camera controls */}
        <div className="absolute bottom-4 left-0 right-0 flex items-center justify-center gap-5">
          <button
            onClick={flipCamera}
            className="bg-slate-800/80 p-3 rounded-full text-slate-300 hover:text-white"
          >
            <Icon name="RefreshCw" size={16} />
          </button>

          {recording ? (
            <button
              onClick={() => stopRecording('manual')}
              className="bg-red-600 p-4 rounded-full text-white shadow-lg shadow-red-900/50"
            >
              <Icon name="Square" size={20} />
            </button>
          ) : (
            <button
              onClick={startRecording}
              disabled={!active}
              className="bg-cyan-600 disabled:opacity-40 p-4 rounded-full text-white shadow-lg shadow-cyan-900/50"
            >
              <Icon name="Video" size={20} />
            </button>
          )}

          <button
            onClick={() => { if (recording) stopRecording('manual'); else startRecording() }}
            className="bg-slate-800/80 p-3 rounded-full text-slate-300 hover:text-white"
            title="Quick capture"
          >
            <Icon name="Camera" size={16} />
          </button>
        </div>
      </div>

      {/* Clips shelf */}
      {clips.length > 0 && (
        <div className="bg-slate-900 border-t border-slate-800 p-3 flex-shrink-0">
          <p className="text-xs text-slate-500 mb-2">Saved clips — {clips.length}</p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {clips.map(clip => (
              <a
                key={clip.key}
                href={clip.url}
                download={`ap3x_dashcam_${clip.ts}.webm`}
                className="flex-shrink-0 flex flex-col items-center gap-1 bg-slate-800 hover:bg-slate-700 rounded-lg p-2.5 text-xs"
              >
                <Icon name="Download" size={13} className="text-emerald-400" />
                <span className="text-slate-500">{(clip.size / 1024).toFixed(0)} KB</span>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
