/**
 * useAudioPlayback — In-editor audio preview using the Web Audio API.
 *
 * Zero external dependencies. Uses native AudioContext, AudioBufferSourceNode,
 * and GainNode. Designed to be lightweight and compatible with low-end devices.
 *
 * Features:
 *   - Plays/stops audio tracks in sync with the editor playhead
 *   - Handles multiple simultaneous tracks on different rows
 *   - Respects per-track volume and muted state
 *   - Caches decoded AudioBuffers to avoid re-decoding on every play
 *   - Handles trimStart (start offset within the source file)
 */

import { useRef, useCallback, useEffect } from 'react'
import { getGlobalMotionEngine } from '../../engine/motion'

// Lazily created — one per editor session. Suspended until first play
// to satisfy browsers that require user gesture before creating AudioContext.
let sharedAudioContext = null

function getAudioContext() {
  if (!sharedAudioContext || sharedAudioContext.state === 'closed') {
    sharedAudioContext = new (window.AudioContext || window.webkitAudioContext)()
  }
  return sharedAudioContext
}

/**
 * @param {Object} params
 * @param {Array}   params.audioTracks     — Array of audio track objects from Redux
 * @param {boolean} params.isPlaying       — Whether the editor is currently playing
 * @param {number}  params.playheadTime    — Current project time in seconds
 */
export function useAudioPlayback({ audioTracks, isPlaying, playheadTime, globalVolume = 1, globalMuted = false }) {
  // Cache of decoded AudioBuffer keyed by assetUrl
  const bufferCache = useRef({})

  // Active source nodes: { [trackId]: { source: AudioBufferSourceNode, gain: GainNode } }
  const activeSources = useRef({})

  // Ref copies so callbacks always access latest values without re-creating functions
  const audioTracksRef = useRef(audioTracks)
  const isPlayingRef   = useRef(isPlaying)
  const playheadRef    = useRef(playheadTime)
  const globalVolumeRef = useRef(globalVolume)
  const globalMutedRef = useRef(globalMuted)

  useEffect(() => { audioTracksRef.current = audioTracks }, [audioTracks])
  useEffect(() => { isPlayingRef.current   = isPlaying   }, [isPlaying])
  useEffect(() => { playheadRef.current    = playheadTime }, [playheadTime])
  useEffect(() => { globalVolumeRef.current = globalVolume }, [globalVolume])
  useEffect(() => { globalMutedRef.current = globalMuted }, [globalMuted])

  // ── Stop all active sources ───────────────────────────────────────────────
  const stopAll = useCallback(() => {
    const sources = activeSources.current
    for (const id of Object.keys(sources)) {
      try { sources[id].source.stop() } catch (_) {}
      try { sources[id].gain.disconnect() } catch (_) {}
    }
    activeSources.current = {}
  }, [])

  // ── Decode and cache audio buffer ─────────────────────────────────────────
  const getBuffer = useCallback(async (url) => {
    if (bufferCache.current[url]) return bufferCache.current[url]

    try {
      const response = await fetch(url)
      const arrayBuffer = await response.arrayBuffer()
      const ctx = getAudioContext()
      const decoded = await ctx.decodeAudioData(arrayBuffer)
      bufferCache.current[url] = decoded
      return decoded
    } catch (err) {
      console.warn('[useAudioPlayback] Failed to decode audio:', url, err)
      return null
    }
  }, [])

  // ── Start playback for all applicable tracks ──────────────────────────────
  const startPlayback = useCallback((currentTime) => {
    const tracks = audioTracksRef.current
    if (!tracks || tracks.length === 0) return

    const ctx = getAudioContext()
    const resumePromise = ctx.state === 'suspended' ? ctx.resume() : Promise.resolve()

    for (const track of tracks) {
      if (track.muted || !track.assetUrl) continue

      // Track's active window in project-time: [startOffset, startOffset + duration]
      const trackStart = track.startOffset || 0
      const trackEnd   = trackStart + (track.duration || 0)

      // Skip tracks that have already ended
      if (currentTime >= trackEnd) continue

      // Load buffers asynchronously without blocking other tracks or the main thread
      getBuffer(track.assetUrl).then((buffer) => {
        if (!buffer) return

        // Ensure AudioContext is fully resumed before reading ctx.currentTime and scheduling
        resumePromise.then(() => {
          // Safety check: is the editor still playing?
          if (!isPlayingRef.current) return

          const actualTime = playheadRef.current
          const trackStart = track.startOffset || 0
          const trackEnd   = trackStart + (track.duration || 0)

          // Skip if the playhead has already moved past this track during load
          if (actualTime >= trackEnd) return

          const contextNow = ctx.currentTime

          // How far into the track we are (accounting for trimStart in source file)
          const trimStart = track.trimStart || 0
          let offsetInTrack = 0
          let sourceOffset = trimStart
          let durationLeft = track.duration || 0
          let startTimeInContext = contextNow

          if (actualTime >= trackStart) {
            offsetInTrack = actualTime - trackStart
            sourceOffset = trimStart + offsetInTrack
            durationLeft = (track.duration || 0) - offsetInTrack
            startTimeInContext = contextNow
          } else {
            offsetInTrack = 0
            sourceOffset = trimStart
            durationLeft = track.duration || 0
            startTimeInContext = contextNow + (trackStart - actualTime)
          }

          if (durationLeft <= 0 || sourceOffset >= buffer.duration) return

          try {
            const gain   = ctx.createGain()
            gain.gain.value = (globalMutedRef.current || track.muted) ? 0 : (track.volume ?? 1) * globalVolumeRef.current
            gain.connect(ctx.destination)

            const source = ctx.createBufferSource()
            source.buffer = buffer
            source.connect(gain)

            // Schedule: start at startTimeInContext, begin reading from sourceOffset in the buffer
            source.start(startTimeInContext, sourceOffset, durationLeft)

            // Auto cleanup when track finishes naturally
            source.onended = () => {
              try { gain.disconnect() } catch (_) {}
              if (activeSources.current[track.id]?.source === source) {
                delete activeSources.current[track.id]
              }
            }

            // Clean up any previously active playback for this track before replacing it
            // (to prevent double playing/overlapping if startPlayback is triggered in quick succession)
            if (activeSources.current[track.id]) {
              try { activeSources.current[track.id].source.stop() } catch (_) {}
              try { activeSources.current[track.id].gain.disconnect() } catch (_) {}
            }

            activeSources.current[track.id] = { source, gain }
          } catch (err) {
            console.warn('[useAudioPlayback] Failed to start source for track:', track.id, err)
          }
        })
      }).catch((err) => {
        console.warn('[useAudioPlayback] Buffer load failed for track:', track.id, err)
      })
    }
  }, [getBuffer])

  // ── React to play/pause state changes ────────────────────────────────────
  useEffect(() => {
    const engine = getGlobalMotionEngine()
    const isFastPreview = engine?._muteVideosForFastPreview === true

    if (isPlaying && !isFastPreview) {
      startPlayback(playheadRef.current)
    } else {
      stopAll()
    }
    // We only react to isPlaying toggling, not every playheadTime change
    // (to avoid restarting audio on every animation frame)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying])

  // ── React to track changes while playing (mute/unmute, delete) or global volume/mute changes ────
  useEffect(() => {
    if (!isPlaying) return

    // Mute/unmute active tracks
    const tracks = audioTracks
    const sources = activeSources.current
    for (const track of tracks) {
      const active = sources[track.id]
      if (active) {
        active.gain.gain.value = (globalMuted || track.muted) ? 0 : (track.volume ?? 1) * globalVolume
      }
    }
  }, [audioTracks, isPlaying, globalVolume, globalMuted])

  // ── React to block position/timing changes while playing (move/trim) ──────
  const prevTracksRef = useRef([])
  useEffect(() => {
    if (!isPlaying) {
      prevTracksRef.current = audioTracks
      return
    }

    const engine = getGlobalMotionEngine()
    const isFastPreview = engine?._muteVideosForFastPreview === true
    if (isFastPreview) return

    let hasTimingChanged = false
    if (prevTracksRef.current.length !== audioTracks.length) {
      hasTimingChanged = true
    } else {
      for (let i = 0; i < audioTracks.length; i++) {
        const t = audioTracks[i]
        const prev = prevTracksRef.current.find(p => p.id === t.id)
        if (
          !prev ||
          prev.startOffset !== t.startOffset ||
          prev.duration !== t.duration ||
          prev.trimStart !== t.trimStart
        ) {
          hasTimingChanged = true
          break
        }
      }
    }

    prevTracksRef.current = audioTracks

    if (hasTimingChanged) {
      stopAll()
      startPlayback(playheadRef.current)
    }
  }, [audioTracks, isPlaying, stopAll, startPlayback])

  // Pre-decode buffers for all tracks to prevent initial play delay
  useEffect(() => {
    if (!audioTracks || audioTracks.length === 0) return
    for (const track of audioTracks) {
      if (track.assetUrl && !track.isUploading) {
        getBuffer(track.assetUrl).catch(() => {})
      }
    }
  }, [audioTracks, getBuffer])

  // ── Stop everything on unmount ────────────────────────────────────────────
  useEffect(() => {
    return () => { stopAll() }
  }, [stopAll])

  return {
    /** Seek to a new time — stops current playback and restarts from new position */
    seekAndPlay: useCallback((newTime) => {
      stopAll()
      const engine = getGlobalMotionEngine()
      const isFastPreview = engine?._muteVideosForFastPreview === true
      if (isPlayingRef.current && !isFastPreview) {
        startPlayback(newTime)
      }
    }, [stopAll, startPlayback]),

    /** Force stop all audio (called on export, cleanup, etc.) */
    stopAll,
  }
}
