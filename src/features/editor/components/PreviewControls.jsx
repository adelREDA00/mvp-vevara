import { useCallback, useEffect, useRef, useState } from 'react'
import { Play, Pause, X, Loader2 } from 'lucide-react'

/**
 * PreviewControls — minimal, video-player-style overlay for Preview Mode.
 *
 * This is a UI-only layer: it renders existing playback state and calls the
 * existing handlers (onPlayPause / onSeek / onExit). It contains NO timeline,
 * playback, or rendering logic of its own — playback continues to be driven by
 * the shared MotionEngine, exactly as the normal editor does.
 *
 * Behaves like a media player: the controls + exit button auto-hide after a
 * short period of inactivity and fade back in on mouse move / interaction.
 */
function formatTime(seconds) {
  const s = Math.max(0, seconds || 0)
  const mins = Math.floor(s / 60)
  const secs = Math.floor(s % 60)
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
}

const IDLE_MS = 1000

function PreviewControls({
  isPlaying = false,
  isBuffering = false,
  currentTime = 0,
  totalTime = 0,
  onPlayPause,
  onSeek,
  onExit,
}) {
  const trackRef = useRef(null)
  const [isScrubbing, setIsScrubbing] = useState(false)
  const [visible, setVisible] = useState(true)
  const idleTimerRef = useRef(null)

  const progress = totalTime > 0 ? Math.min(1, Math.max(0, currentTime / totalTime)) : 0

  // ── Auto-hide on inactivity ───────────────────────────────────────────────
  const scheduleHide = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    idleTimerRef.current = setTimeout(() => setVisible(false), IDLE_MS)
  }, [])

  const revealControls = useCallback(() => {
    setVisible(true)
    scheduleHide()
  }, [scheduleHide])

  useEffect(() => {
    // Reveal on any user activity over the preview surface.
    const onActivity = () => revealControls()
    window.addEventListener('pointermove', onActivity)
    window.addEventListener('pointerdown', onActivity)
    window.addEventListener('keydown', onActivity)
    scheduleHide() // start the initial hide countdown
    return () => {
      window.removeEventListener('pointermove', onActivity)
      window.removeEventListener('pointerdown', onActivity)
      window.removeEventListener('keydown', onActivity)
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    }
  }, [revealControls, scheduleHide])

  // Keep controls visible while actively scrubbing.
  useEffect(() => {
    if (isScrubbing) {
      setVisible(true)
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    } else {
      scheduleHide()
    }
  }, [isScrubbing, scheduleHide])

  // ── Scrubbing ─────────────────────────────────────────────────────────────
  const seekFromClientX = useCallback((clientX) => {
    const track = trackRef.current
    if (!track || !onSeek || totalTime <= 0) return
    const rect = track.getBoundingClientRect()
    const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    onSeek(fraction * totalTime)
  }, [onSeek, totalTime])

  const handlePointerDown = useCallback((e) => {
    e.preventDefault()
    setIsScrubbing(true)
    seekFromClientX(e.clientX)
  }, [seekFromClientX])

  useEffect(() => {
    if (!isScrubbing) return
    const handleMove = (e) => seekFromClientX(e.clientX)
    const handleUp = () => setIsScrubbing(false)
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
    }
  }, [isScrubbing, seekFromClientX])

  const fadeClass = visible ? 'opacity-100' : 'opacity-0 pointer-events-none'

  return (
    <>
      {/* Exit button — floating top-right over the canvas */}
      <button
        onClick={onExit}
        className={`fixed top-3 right-3 z-[100] w-9 h-9 rounded-full flex items-center justify-center bg-black/55 hover:bg-black/75 text-white/90 hover:text-white backdrop-blur-md border border-white/10 transition-all duration-300 active:scale-95 ${fadeClass}`}
        title="Exit preview (Esc)"
        type="button"
      >
        <X className="h-4 w-4" />
      </button>

      {/* Bottom control bar — play/pause + scrub + time */}
      <div className="fixed bottom-0 left-0 right-0 z-[100] flex justify-center pointer-events-none pb-[max(10px,env(safe-area-inset-bottom))] px-3">
        <div className={`pointer-events-auto flex items-center gap-3 w-full max-w-2xl rounded-xl bg-black/55 backdrop-blur-xl border border-white/10 px-3 sm:px-4 py-1.5 shadow-[0_6px_30px_-12px_rgba(0,0,0,0.6)] transition-opacity duration-300 ${fadeClass}`}>
          {/* Play / Pause */}
          <button
            onClick={() => { if (!isBuffering && onPlayPause) onPlayPause() }}
            disabled={isBuffering}
            className={`flex-shrink-0 w-8 h-8 rounded-full bg-white flex items-center justify-center transition-all active:scale-90 ${isBuffering ? 'opacity-70 cursor-not-allowed' : 'hover:bg-white/90'}`}
            title={isBuffering ? 'Buffering…' : isPlaying ? 'Pause' : 'Play'}
            type="button"
          >
            {isBuffering ? (
              <Loader2 className="h-3.5 w-3.5 text-gray-900 animate-spin" />
            ) : isPlaying ? (
              <Pause className="h-3.5 w-3.5 text-gray-900" fill="currentColor" strokeWidth={2} />
            ) : (
              <Play className="h-3.5 w-3.5 text-gray-900 ml-0.5" fill="currentColor" strokeWidth={2} />
            )}
          </button>

          {/* Current time */}
          <span className="flex-shrink-0 text-[10px] sm:text-[11px] font-semibold tabular-nums text-white/70 w-9 text-right">
            {formatTime(currentTime)}
          </span>

          {/* Scrub bar */}
          <div
            ref={trackRef}
            onPointerDown={handlePointerDown}
            className="relative flex-1 h-5 flex items-center cursor-pointer group"
          >
            <div className="absolute left-0 right-0 h-1 rounded-full bg-white/20 overflow-hidden">
              <div
                className="h-full rounded-full bg-white"
                style={{ width: `${progress * 100}%` }}
              />
            </div>
            {/* Playhead handle */}
            <div
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-white shadow transition-transform group-hover:scale-110"
              style={{ left: `${progress * 100}%` }}
            />
          </div>

          {/* Total time */}
          <span className="flex-shrink-0 text-[10px] sm:text-[11px] font-semibold tabular-nums text-white/70 w-9 text-left">
            {formatTime(totalTime)}
          </span>
        </div>
      </div>
    </>
  )
}

export default PreviewControls
