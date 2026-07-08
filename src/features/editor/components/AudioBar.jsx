/**
 * AudioBar — Bottom timeline layer for audio tracks.
 *
 * Phase 2: Connected to Redux projectSlice.audioTracks[]
 * - add/update/delete/cut dispatch to Redux
 * - waveform data from real decoded audio (stored in track.waveform)
 * - undo/redo via historyMiddleware
 */

import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
  useContext,
  useImperativeHandle,
  useMemo,
} from 'react'
import { createPortal } from 'react-dom'
import { useDispatch, useSelector } from 'react-redux'
import { ThemeContext } from '../../../app/context/ThemeContext'
import { Music, Mic, Upload, Scissors, Volume2, VolumeX, Trash2, X } from 'lucide-react'
import {
  selectAudioTracks,
  addAudioTrack,
  updateAudioTrack,
  deleteAudioTrack,
  cutAudioTrack,
} from '../../../store/slices/projectSlice'
import { pause, seekBySeconds } from '../../../store/slices/playbackSlice'
import { uploadFile, enqueueUpload, cancelUpload } from '../../../store/slices/uploadsSlice'
import { checkAutoScroll, stopAutoScroll } from './ScenesBar'

// ─── Constants ───────────────────────────────────────────────────────────────

const BLOCK_HEIGHT = 32          // px — matches motion block visual height
const ROW_HEIGHT = BLOCK_HEIGHT + 4  // px — row height with top/bottom breathing room

// Cache to deduplicate on-the-fly audio decodes
const decodedWaveformPromises = {}

// Generate a pseudo-random hue from a block id for subtle color variation
function blockHue(id) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffffff
  return 260 + ((h % 40) - 20) // purple range: 240–280
}

// ─── AudioBlock component ─────────────────────────────────────────────────────

const AudioBlock = React.memo(function AudioBlock({
  block,
  totalDuration,
  isSelected,
  hasAnySelected,
  onSelect,
  onResize,
  onDelete,
  onContextMenu,
  isLight,
  calculateTimePosition,
  calculateWidthFromDuration,
  onDragStart,
  onDragEnd,
  onMotionPause,
}) {
  const [localStartOffset, setLocalStartOffset] = useState(block.startOffset)
  const [localDuration, setLocalDuration] = useState(block.duration)
  const [localTrimStart, setLocalTrimStart] = useState(block.trimStart || 0)

  const [isInteracting, setIsInteracting] = useState(false)

  const localStateRef = useRef({
    startOffset: block.startOffset,
    duration: block.duration,
    trimStart: block.trimStart || 0,
  })

  // Keep local state in sync when not interacting
  useEffect(() => {
    if (!isInteracting) {
      setLocalStartOffset(block.startOffset)
      setLocalDuration(block.duration)
      setLocalTrimStart(block.trimStart || 0)
      localStateRef.current = {
        startOffset: block.startOffset,
        duration: block.duration,
        trimStart: block.trimStart || 0,
      }
    }
  }, [block.startOffset, block.duration, block.trimStart, isInteracting])

  const currentStartOffset = isInteracting ? localStartOffset : block.startOffset
  const currentDuration = isInteracting ? localDuration : block.duration

  const leftPx = calculateTimePosition(currentStartOffset)
  const rightPx = calculateTimePosition(currentStartOffset + currentDuration)
  const blockPx = Math.max(8, rightPx - leftPx) // min width of 8px to keep handles grabable


  const dispatch = useDispatch()
  const blockOuterRef = useRef(null)
  const resizeScrollTimerRef = useRef(null)
  const startScrollLeftRef = useRef(0)
  const lastClientXRef = useRef(0)

  // Refs to avoid stale closures in event listeners
  const blockRef = useRef(block)
  const onDragEndRef = useRef(onDragEnd)
  const onSelectRef = useRef(onSelect)
  const onResizeRef = useRef(onResize)
  const onMotionPauseRef = useRef(onMotionPause)

  useEffect(() => {
    blockRef.current = block
    onDragEndRef.current = onDragEnd
    onSelectRef.current = onSelect
    onResizeRef.current = onResize
    onMotionPauseRef.current = onMotionPause
  }, [block, onDragEnd, onSelect, onResize, onMotionPause])

  // ── Decode waveform if missing ─────────────────────────────────────────────
  const waveformLength = block.waveform?.length || 0
  useEffect(() => {
    if (block.isUploading || !block.assetUrl) return
    if (waveformLength > 0) return

    const url = block.assetUrl
    if (!decodedWaveformPromises[url]) {
      decodedWaveformPromises[url] = (async () => {
        const ctx = new (window.AudioContext || window.webkitAudioContext)()
        try {
          const r = await fetch(url)
          if (!r.ok) throw new Error("Network response not ok")
          const buf = await r.arrayBuffer()
          const decoded = await ctx.decodeAudioData(buf)
          const channel = decoded.getChannelData(0)
          const sampleCount = 100
          const blockSize = Math.max(1, Math.floor(channel.length / sampleCount))
          const rawWaveform = []
          let maxVal = 0
          for (let i = 0; i < sampleCount; i++) {
            let sum = 0
            for (let j = 0; j < blockSize; j++) {
              const idx = i * blockSize + j
              if (idx < channel.length) {
                sum += Math.abs(channel[idx])
              }
            }
            const avg = sum / blockSize
            if (avg > maxVal) maxVal = avg
            rawWaveform.push(avg)
          }
          const normalized = maxVal > 0
            ? rawWaveform.map(v => Math.min(1, v / maxVal))
            : rawWaveform
          await ctx.close().catch(() => {})
          return { waveform: normalized, totalDuration: decoded.duration }
        } catch (err) {
          await ctx.close().catch(() => {})
          throw err
        }
      })()

      decodedWaveformPromises[url]
        .then(res => {
          dispatch(updateAudioTrack({
            id: block.id,
            waveform: res.waveform,
            totalDuration: res.totalDuration
          }))
        })
        .catch(err => {
          console.warn("Failed to generate waveform on the fly for", url, err)
        })
    }
  }, [block.id, block.assetUrl, waveformLength, block.isUploading, dispatch])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAutoScroll(resizeScrollTimerRef)
    }
  }, [])

  // ── Drag / resize state (local, no Redux during drag — commit on mouseup) ──
  const dragRef = useRef(null)
  const [isHovered, setIsHovered] = useState(false)
  const [showMobileCancel, setShowMobileCancel] = useState(false)
  const touchTimerRef = useRef(null)

  const handleTouchStart = useCallback(() => {
    if (!block.isUploading) return
    touchTimerRef.current = setTimeout(() => {
      setShowMobileCancel(true)
    }, 2000)
  }, [block.isUploading])

  const handleTouchEnd = useCallback(() => {
    if (touchTimerRef.current) {
      clearTimeout(touchTimerRef.current)
      touchTimerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!showMobileCancel) return
    const handler = () => {
      setShowMobileCancel(false)
    }
    document.addEventListener('pointerdown', handler)
    return () => document.removeEventListener('pointerdown', handler)
  }, [showMobileCancel])

  const startDrag = useCallback((e, type) => {
    if (blockRef.current.isUploading) return
    if (e.button !== undefined && e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()

    // PAUSE PLAYBACK IMMEDIATELY ON POINTER DOWN
    dispatch(pause())
    onMotionPauseRef.current?.()

    const startX = e.clientX
    const startY = e.clientY
    const startTimeMs = Date.now()

    let hasMoved = false
    let dragActive = false
    
    // Find nearest overflow-x scroll container
    const scrollContainer = blockOuterRef.current ? (() => {
      let el = blockOuterRef.current.parentElement
      while (el) {
        const style = window.getComputedStyle(el)
        if (style.overflowX === 'auto' || style.overflowX === 'scroll') {
          return el
        }
        el = el.parentElement
      }
      return null
    })() : null

    const selectAndBegin = () => {
      onSelectRef.current(blockRef.current.id)
      onDragStart?.()
      setIsInteracting(true)
    }

    startScrollLeftRef.current = scrollContainer ? scrollContainer.scrollLeft : 0
    lastClientXRef.current = e.clientX

    dragRef.current = {
      type,
      startX: e.clientX,
      origStart: blockRef.current.startOffset,
      origDuration: blockRef.current.duration,
      origTrimStart: blockRef.current.trimStart || 0,
    }

    const performAudioResize = (clientX) => {
      if (!dragRef.current) return
      const deltaX = clientX - dragRef.current.startX
      const scrollDelta = scrollContainer ? (scrollContainer.scrollLeft - startScrollLeftRef.current) : 0
      const adjustedDeltaX = deltaX + scrollDelta
      const secPerPx = 1.0 / calculateWidthFromDuration(1.0)
      const dSec = adjustedDeltaX * secPerPx

      let newStart = dragRef.current.origStart
      let newDuration = dragRef.current.origDuration
      let newTrimStart = dragRef.current.origTrimStart

      if (dragRef.current.type === 'move') {
        newStart = Math.max(0, dragRef.current.origStart + dSec)
      } else if (dragRef.current.type === 'resize-left') {
        const origStart = dragRef.current.origStart
        const origDuration = dragRef.current.origDuration
        const origTrimStart = dragRef.current.origTrimStart

        const minStart = Math.max(0, origStart - origTrimStart)
        const maxStart = origStart + origDuration - 0.3

        newStart = origStart + dSec
        newStart = Math.max(minStart, Math.min(newStart, maxStart))

        newDuration = origDuration - (newStart - origStart)
        newTrimStart = Math.max(0, origTrimStart + (newStart - origStart))
      } else if (dragRef.current.type === 'resize-right') {
        const origDuration = dragRef.current.origDuration
        const origStart = dragRef.current.origStart
        const origTrimStart = dragRef.current.origTrimStart
        const totalAssetDur = blockRef.current.totalDuration || (origDuration + origTrimStart)

        const maxDuration = Math.max(0.3, totalAssetDur - origTrimStart)

        newDuration = Math.max(
          0.3,
          Math.min(
            origDuration + dSec,
            maxDuration
          )
        )
      }

      setLocalStartOffset(newStart)
      setLocalDuration(newDuration)
      setLocalTrimStart(newTrimStart)
      localStateRef.current = {
        startOffset: newStart,
        duration: newDuration,
        trimStart: newTrimStart,
      }
    }

    // Set hold timer for drag initiation
    const holdTimer = setTimeout(() => {
      if (!hasMoved && !dragActive) {
        dragActive = true
        selectAndBegin()
        if (navigator.vibrate) {
          navigator.vibrate(30)
        }
      }
    }, 200)

    const onMove = (moveE) => {
      const clientX = moveE.touches ? moveE.touches[0].clientX : moveE.clientX
      const clientY = moveE.touches ? moveE.touches[0].clientY : moveE.clientY

      const dist = Math.sqrt(Math.pow(clientX - startX, 2) + Math.pow(clientY - startY, 2))
      if (dist > 5) {
        hasMoved = true
        if (!dragActive) {
          clearTimeout(holdTimer)
          dragActive = true
          selectAndBegin()
        }
      }

      if (!dragActive || !dragRef.current) return
      lastClientXRef.current = clientX
      performAudioResize(clientX)

      if (scrollContainer) {
        const deltaX = clientX - dragRef.current.startX
        const isShrinking = (dragRef.current.type === 'resize-right' && deltaX < 0) || (dragRef.current.type === 'resize-left' && deltaX > 0)
        const speedMultiplier = isShrinking ? 0 : 1.0
        checkAutoScroll(clientX, scrollContainer, resizeScrollTimerRef, () => {
          performAudioResize(lastClientXRef.current)
        }, speedMultiplier)
      }
    }

    const onUp = (upE) => {
      clearTimeout(holdTimer)
      stopAutoScroll(resizeScrollTimerRef)

      const durationMs = Date.now() - startTimeMs

      if (!dragActive && !hasMoved && durationMs < 300) {
        // Quick tap / click -> Select audio block AND snap playhead to clicked position
        const rect = blockOuterRef.current.parentElement.getBoundingClientRect()
        const clickX = startX - rect.left
        const secPerPx = 1.0 / calculateWidthFromDuration(1.0)
        const seekTime = clickX * secPerPx
        onSelectRef.current(blockRef.current.id, seekTime)
      } else if (dragActive) {
        // Drag/trim finished -> Snap playhead to start or end depending on operation
        const currentType = dragRef.current?.type
        const finalBlockState = {
          startOffset: localStateRef.current.startOffset,
          duration: localStateRef.current.duration,
          trimStart: localStateRef.current.trimStart,
        }

        // Commit final state to Redux synchronously so that the store updates before we trigger callbacks or history log
        onResizeRef.current(blockRef.current.id, finalBlockState)

        if (onDragEndRef.current) {
          onDragEndRef.current(currentType, finalBlockState)
        }
      }

      dragRef.current = null
      setIsInteracting(false)
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
    }

    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
  }, [calculateWidthFromDuration, onDragStart, dispatch])

  const isDefaultOrSelected = isSelected || !hasAnySelected

  const normalColor = isDefaultOrSelected
    ? isLight ? 'hsl(204, 86%, 53%)' : 'hsl(204, 70%, 45%)'
    : isLight ? 'hsl(204, 45%, 85%)' : 'hsl(204, 30%, 25%)'

  const dimmedColor = isLight ? 'hsl(204, 45%, 85%)' : 'hsl(204, 30%, 25%)'

  const blockBackground = block.isUploading
    ? `linear-gradient(to right, ${normalColor} ${block.progress || 0}%, ${dimmedColor} ${block.progress || 0}%)`
    : normalColor

  const blockBorder = isDefaultOrSelected
    ? isLight ? '1.5px solid hsl(204, 86%, 65%)' : '1.5px solid hsl(204, 80%, 55%)'
    : isLight ? '1px solid hsl(204, 40%, 75%)' : '1px solid hsl(204, 25%, 20%)'


  return (
    <div
      ref={blockOuterRef}
      data-audio-block
      className="absolute top-1/2 -translate-y-1/2 group/audio"
      style={{
        left: `${leftPx}px`,
        width: `${blockPx}px`,
        height: `${BLOCK_HEIGHT}px`,
        zIndex: isSelected ? 20 : 10,
        touchAction: 'none',
        userSelect: 'none',
      }}
      onClick={(e) => {
        e.stopPropagation()
      }}
      onContextMenu={(e) => {
        if (block.isUploading) return
        e.preventDefault()
        e.stopPropagation()
        onContextMenu?.(e, block)
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchMove={handleTouchEnd}
    >
      {/* ── Left resize handle ─── */}
      {!block.isUploading && (
        <div
          className="absolute top-0 bottom-0 left-0 z-30 flex items-center justify-center cursor-ew-resize"
          style={{ width: Math.min(blockPx * 0.3, 16) }}
          onPointerDown={(e) => startDrag(e, 'resize-left')}
        >
          <div
            className={`w-[3px] h-[14px] rounded-full transition-all duration-150 ${
              blockPx > 32 ? 'opacity-60 group-hover/audio:opacity-100' : 'opacity-0'
            }`}
            style={{ backgroundColor: isSelected ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.5)' }}
          />
        </div>
      )}

      {/* ── Block body ─── */}
      <div
        className={`absolute inset-0 rounded-[6px] overflow-hidden flex items-center gap-1.5 px-2 select-none transition-all duration-150 ${
          block.isUploading ? 'cursor-not-allowed' : 'cursor-grab active:cursor-grabbing'
        }`}
        style={{
          background: blockBackground,
          border: blockBorder,
          boxShadow: 'none',
        }}
        onPointerDown={(e) => {
          if (!block.isUploading) startDrag(e, 'move')
        }}
      >
        {/* Waveform — real data if available, deterministic fake otherwise */}
        <WaveformDisplay
          waveform={block.waveform}
          blockId={block.id}
          width={blockPx - 16}
          height={BLOCK_HEIGHT - 8}
          isSelected={isSelected}
          hasAnySelected={hasAnySelected}
          hue={204}
          blockTrimStart={isInteracting ? localTrimStart : (block.trimStart || 0)}
          blockDuration={currentDuration}
          blockTotalDuration={block.totalDuration}
          pixelsPerSecond={calculateWidthFromDuration(1.0)}
          isUploading={block.isUploading}
        />

        {/* Block label */}
        {blockPx > 60 && !isInteracting && !isHovered && (
          <span
            className={`text-[10px] font-semibold whitespace-nowrap overflow-hidden text-ellipsis pointer-events-none ${
              block.isUploading ? 'ml-0 w-full text-center' : 'absolute left-8'
            }`}
            style={{ color: 'rgba(255,255,255,0.85)', maxWidth: blockPx - 40 }}
          >
            {block.isUploading ? `Uploading ${block.progress || 0}%` : block.name}
          </span>
        )}
      </div>

      {/* ── Right resize handle ─── */}
      {!block.isUploading && (
        <div
          className="absolute top-0 bottom-0 right-0 z-30 flex items-center justify-center cursor-ew-resize"
          style={{ width: Math.min(blockPx * 0.3, 16) }}
          onPointerDown={(e) => startDrag(e, 'resize-right')}
        >
          <div
            className={`w-[3px] h-[14px] rounded-full transition-all duration-150 ${
              blockPx > 32 ? 'opacity-60 group-hover/audio:opacity-100' : 'opacity-0'
            }`}
            style={{ backgroundColor: isSelected ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.5)' }}
          />
        </div>
      )}
      {/* Cancel Overlay */}
      {block.isUploading && (isHovered || showMobileCancel) && (
        <button
          className="absolute inset-0 bg-black/60 flex items-center justify-center gap-1 text-[10px] text-white font-bold rounded-[6px] z-50 transition-all duration-150"
          style={{ cursor: 'pointer' }}
          onClick={(e) => {
            e.stopPropagation()
            e.preventDefault()
            dispatch(cancelUpload(block.id))
          }}
          onTouchStart={(e) => e.stopPropagation()}
        >
          <X className="h-3.5 w-3.5" />
          <span>Cancel</span>
        </button>
      )}
    </div>
  )
})

// ─── WaveformDisplay (Canvas 2D) ─────────────────────────────────────────────
// Uses real waveform array if provided; falls back to deterministic fake peaks.

const WaveformDisplay = React.memo(function WaveformDisplay({
  waveform,
  blockId,
  width,
  height,
  isSelected,
  hasAnySelected,
  hue,
  blockTrimStart,
  blockDuration,
  blockTotalDuration,
  pixelsPerSecond,
  isUploading,
}) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || width <= 0 || height <= 0) return
    const ctx = canvas.getContext('2d')
    const W = Math.max(1, Math.floor(width))
    const H = Math.max(1, Math.floor(height))
    canvas.width  = W
    canvas.height = H

    ctx.clearRect(0, 0, W, H)

    const hasReal = Array.isArray(waveform) && waveform.length > 0
    const bars = Math.floor(W / 3)
    const barW = W / bars

    const isDefaultOrSelected = isSelected || !hasAnySelected
    ctx.fillStyle = isUploading
      ? 'rgba(255, 255, 255, 0.4)'
      : isDefaultOrSelected
        ? `hsla(204, 90%, 88%, 0.65)`
        : `hsla(204, 50%, 70%, 0.25)`

    let maxVal = 0
    if (hasReal) {
      maxVal = Math.max(...waveform)
    }

    const trimStart = blockTrimStart || 0
    const duration = blockDuration
    const totalDuration = blockTotalDuration || (duration + trimStart)

    // Calculate timeline scale: pixels per second
    const pps = pixelsPerSecond || ((W + 16) / duration)

    const startAssetPx = trimStart * pps
    const firstBarAssetPx = Math.ceil(startAssetPx / 3) * 3

    for (let assetPx = firstBarAssetPx; assetPx < startAssetPx + W; assetPx += 3) {
      const x = assetPx - startAssetPx
      const timeInAsset = assetPx / pps
      const progress = totalDuration > 0 ? timeInAsset / totalDuration : 0
      const clampedProgress = Math.max(0, Math.min(1, progress))

      let amp
      if (hasReal) {
        const sampleIdx = Math.floor(clampedProgress * waveform.length)
        const rawAmp = waveform[sampleIdx] ?? 0
        amp = maxVal > 0 ? (rawAmp / maxVal) : 0
      } else {
        // Deterministic fake amplitude using stable asset time to avoid squish/stretch
        const barIndex = Math.floor(timeInAsset * 12)
        const seed = ((barIndex + blockId.charCodeAt(barIndex % blockId.length)) * 2654435761) >>> 0
        amp = 0.15 + 0.7 * ((seed % 1000) / 1000)
      }
      const bH = Math.max(2, amp * H)
      const y  = (H - bH) / 2
      ctx.fillRect(x, y, 2, bH) // 2px bar, 1px gap
    }
  }, [waveform, blockId, width, height, isSelected, hasAnySelected, hue, blockTrimStart, blockDuration, blockTotalDuration, pixelsPerSecond, isUploading])

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute left-2"
      style={{ top: '50%', transform: 'translateY(-50%)', opacity: 0.9 }}
    />
  )
})

// ─── Upload Options popover ───────────────────────────────────────────────────

function UploadOptionsPopover({ anchorRect, onUploadDevice, onUploadEditor, onClose, isLight }) {
  useEffect(() => {
    const handler = (e) => {
      if (!e.target.closest('[data-audio-upload-popover]')) onClose()
    }
    document.addEventListener('mousedown', handler, { capture: true })
    return () => document.removeEventListener('mousedown', handler, { capture: true })
  }, [onClose])

  if (!anchorRect) return null

  return createPortal(
    <div
      data-audio-upload-popover
      className="fixed rounded-xl shadow-2xl py-1.5 min-w-[180px] overflow-hidden z-[10010]"
      style={{
        top: anchorRect.top - 8,
        left: anchorRect.left + anchorRect.width / 2,
        transform: 'translate(-50%, -100%)',
        backgroundColor: isLight ? 'rgba(255,255,255,0.97)' : 'rgba(18,18,24,0.97)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        border: isLight ? '1px solid rgba(0,0,0,0.08)' : '1px solid rgba(255,255,255,0.1)',
      }}
    >
      <button
        className={`w-full text-left px-4 py-2 text-[12px] font-medium flex items-center gap-2.5 transition-colors ${
          isLight ? 'text-gray-800 hover:bg-black/5' : 'text-white/85 hover:bg-white/8'
        }`}
        onClick={() => { onUploadDevice(); onClose() }}
      >
        <Upload className="h-3.5 w-3.5 text-purple-400" />
        Upload from device
      </button>
      <button
        className={`w-full text-left px-4 py-2 text-[12px] font-medium flex items-center gap-2.5 transition-colors ${
          isLight ? 'text-gray-800 hover:bg-black/5' : 'text-white/85 hover:bg-white/8'
        }`}
        onClick={() => { onUploadEditor(); onClose() }}
      >
        <Music className="h-3.5 w-3.5 text-purple-400" />
        From editor panel
      </button>
      <button
        className={`w-full text-left px-4 py-2 text-[12px] font-medium flex items-center gap-2.5 transition-colors ${
          isLight ? 'text-gray-800 hover:bg-black/5' : 'text-white/85 hover:bg-white/8'
        }`}
        onClick={() => { onUploadEditor(); onClose() }}
      >
        <Mic className="h-3.5 w-3.5 text-purple-400" />
        Voiceover (record)
      </button>
    </div>,
    document.body
  )
}

// ─── Empty placeholder block ──────────────────────────────────────────────────

const EmptyAudioPlaceholder = React.memo(function EmptyAudioPlaceholder({
  totalProjectWidth,
  isLight,
  onClick,
}) {
  return (
    <div
      className="absolute inset-y-1 cursor-pointer group/empty flex items-center justify-center rounded-[6px] transition-colors duration-200"
      style={{
        left: 0,
        width: `${totalProjectWidth}px`,
        border: isLight
          ? '1.5px solid rgba(0,0,0,0.12)'
          : '1.5px solid rgba(255,255,255,0.12)',
        backgroundColor: isLight ? 'rgba(0,0,0,0.025)' : 'rgba(255,255,255,0.025)',
      }}
      onClick={onClick}
      title="Click to upload audio"
    >
      <div className={`flex items-center gap-2 transition-opacity duration-200 ${
        isLight ? 'text-black/25 group-hover/empty:text-black/45' : 'text-white/20 group-hover/empty:text-white/40'
      }`}>
        <Upload className="h-3.5 w-3.5" />
        <span className="text-[11px] font-medium whitespace-nowrap">Upload audio from device</span>
      </div>
    </div>
  )
})

// ─── AudioBar (main export) ───────────────────────────────────────────────────

/**
 * Props:
 *   totalProjectWidth  number  — pixel width matching the ScenesBar card area
 *   totalDuration      number  — project duration in seconds
 *   playheadPosition   number  — pixel offset of the playhead (for visual sync)
 *   scrollLeft         number  — controlled scroll from ScenesBar
 *   onScrollChange     fn      — callback(scrollLeft) when this bar is scrolled
 *   selectedAudioBlockId  string|null
 *   onSelectAudioBlock    fn(id|null)
 *   isLight            boolean
 */
const AudioBar = React.forwardRef(function AudioBar(
  {
    totalProjectWidth = 600,
    totalDuration     = 10,
    selectedAudioBlockId,
    onSelectAudioBlock,
    calculateTimePosition,
    calculateWidthFromDuration,
    onMotionPause,
    onDragStart,
    onDragEnd,
  },
  ref
) {
  const { theme } = useContext(ThemeContext)
  const isLight = theme === 'light'

  const dispatch = useDispatch()
  const audioTracks = useSelector(selectAudioTracks)
  const uploadQueue = useSelector(state => state.uploads?.uploadQueue || {})
  const fileInputRef = useRef(null)

  const tracksContainerRef = useRef(null)
  const [draggedOverRow, setDraggedOverRow] = useState(null)
  const lastHoveredRowRef = useRef(null)

  useEffect(() => {
    const handleCustomDragMove = (e) => {
      const asset = window.activeDraggedAsset
      if (!asset || asset.type !== 'audio') {
        if (lastHoveredRowRef.current !== null) {
          lastHoveredRowRef.current = null
          setDraggedOverRow(null)
        }
        return
      }

      if (!tracksContainerRef.current) return

      const rect = tracksContainerRef.current.getBoundingClientRect()
      const { x, y } = e.detail

      // Check if pointer is over sidebar/panel
      const elem = document.elementFromPoint(x, y)
      if (elem && (
        elem.closest('.editor-panel-container') || 
        elem.closest('[class*="Sidebar"]') || 
        elem.closest('[class*="sidebar"]') ||
        elem.closest('[data-panel]') ||
        elem.closest('.left-sidebar')
      )) {
        if (lastHoveredRowRef.current !== null) {
          lastHoveredRowRef.current = null
          setDraggedOverRow(null)
        }
        return
      }

      const isOver = 
        x >= rect.left && 
        x <= rect.right && 
        y >= rect.top - 10 && 
        y <= rect.bottom + 10

      if (isOver) {
        // Find the lowest rowIndex not currently occupied (matches existing projectSlice logic)
        const usedRows = new Set(audioTracks.map(t => t.rowIndex ?? 0))
        let targetRowIndex = 0
        while (usedRows.has(targetRowIndex)) targetRowIndex++

        if (targetRowIndex !== lastHoveredRowRef.current) {
          lastHoveredRowRef.current = targetRowIndex
          setDraggedOverRow(targetRowIndex)
        }
      } else {
        if (lastHoveredRowRef.current !== null) {
          lastHoveredRowRef.current = null
          setDraggedOverRow(null)
        }
      }
    }

    const handleCustomDragDrop = (e) => {
      const asset = window.activeDraggedAsset
      if (!asset || asset.type !== 'audio') return

      if (!tracksContainerRef.current) return

      const rect = tracksContainerRef.current.getBoundingClientRect()
      const { x, y } = e.detail

      // Check if dropped inside a sidebar or panel container
      const elem = document.elementFromPoint(x, y)
      if (elem && (
        elem.closest('.editor-panel-container') || 
        elem.closest('[class*="Sidebar"]') || 
        elem.closest('[class*="sidebar"]') ||
        elem.closest('[data-panel]') ||
        elem.closest('.left-sidebar')
      )) {
        lastHoveredRowRef.current = null
        setDraggedOverRow(null)
        return
      }

      const isOver = 
        x >= rect.left && 
        x <= rect.right && 
        y >= rect.top - 10 && 
        y <= rect.bottom + 10

      if (isOver) {
        dispatch(addAudioTrack({
          assetId: asset.id,
          assetUrl: asset.url,
          name: asset.name || 'Audio',
          duration: asset.duration || 0,
          waveform: asset.waveform || [],
          // By not passing rowIndex, we let the reducer use its existing insertion logic
        }))
      }

      lastHoveredRowRef.current = null
      setDraggedOverRow(null)
    }

    window.addEventListener('asset-drag-move', handleCustomDragMove)
    window.addEventListener('asset-drag-drop', handleCustomDragDrop)
    return () => {
      window.removeEventListener('asset-drag-move', handleCustomDragMove)
      window.removeEventListener('asset-drag-drop', handleCustomDragDrop)
    }
  }, [dispatch, audioTracks])

  const audioTracksWithProgress = useMemo(() => {
    return audioTracks.map(track => {
      if (track.isUploading) {
        const queueItem = Object.values(uploadQueue).find(q => q.tempId === track.id || q.id === track.id)
        return {
          ...track,
          progress: queueItem ? queueItem.progress : (track.progress || 0)
        }
      }
      return track
    })
  }, [audioTracks, uploadQueue])

  const handleFileChange = useCallback(async (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    const tempId = crypto.randomUUID()
    const url = URL.createObjectURL(file)
    const audio = new Audio(url)
    audio.addEventListener('loadedmetadata', () => {
      const duration = audio.duration || 5
      URL.revokeObjectURL(url)

      dispatch(addAudioTrack({
        id: tempId,
        assetId: null,
        assetUrl: '',
        name: file.name,
        duration: Math.min(duration, totalDuration),
        totalDuration: duration,
        waveform: [],
        isUploading: true,
        progress: 0,
      }))

      dispatch(enqueueUpload({
        tempId,
        name: file.name,
        size: file.size,
        type: file.type,
      }))

      dispatch(uploadFile({ tempId, file, isPublic: true, assetType: 'audio' })).unwrap().then(({ data }) => {
        dispatch(updateAudioTrack({
          id: tempId,
          assetId: data._id,
          assetUrl: data.url,
          waveform: data.metadata?.waveform || [],
          isUploading: false,
          progress: 100,
        }))
      }).catch(err => {
        console.error('Audio upload failed:', err)
        dispatch(deleteAudioTrack(tempId))
      })
    })

    e.target.value = ''
  }, [dispatch, totalDuration])

  const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0, block: null })

  // ── Click outside context menu to close ──────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if (e.target.closest('[data-audio-context-menu]')) return
      setContextMenu(prev => prev.visible ? { ...prev, visible: false } : prev)
    }
    document.addEventListener('mousedown', handler, { capture: true })
    document.addEventListener('click', handler, { capture: true })
    document.addEventListener('contextmenu', handler, { capture: true })
    return () => {
      document.removeEventListener('mousedown', handler, { capture: true })
      document.removeEventListener('click', handler, { capture: true })
      document.removeEventListener('contextmenu', handler, { capture: true })
    }
  }, [])

  // ── Expose API via ref ────────────────────────────────────────────────────
  useImperativeHandle(ref, () => ({
    // Read the currently selected block (for CanvasControls audio pill)
    getSelectedBlock: () => {
      if (!selectedAudioBlockId) return null
      return audioTracks.find(t => t.id === selectedAudioBlockId) ?? null
    },
    // Update a block's properties from CanvasControls callbacks
    updateBlock: (id, updates) => {
      dispatch(updateAudioTrack({ id, ...updates }))
    },
    // Delete a block from CanvasControls
    deleteBlock: (id) => {
      dispatch(pause())
      onMotionPause?.()
      dispatch(deleteAudioTrack(id))
      if (selectedAudioBlockId === id) onSelectAudioBlock?.(null)
    },
    // Add a block from sidebar panel (or inline click)
    addBlock: (assetId, assetUrl, name, duration, waveform) => {
      dispatch(addAudioTrack({
        assetId: assetId || null,
        assetUrl: assetUrl || '',
        name: name || 'Audio',
        duration: Math.min(duration || 5, totalDuration),
        waveform: waveform || [],
      }))
    },
    // Cut selected block at playhead
    cutBlock: (id, cutAtSeconds) => {
      dispatch(pause())
      onMotionPause?.()
      dispatch(cutAudioTrack({ id, cutAtSeconds }))
    },
  }), [audioTracks, selectedAudioBlockId, totalDuration, dispatch, onSelectAudioBlock, onMotionPause])

  // ── Resize / update a block (dispatches to Redux) ─────────────────────────
  const handleResize = useCallback((id, updates) => {
    dispatch(updateAudioTrack({ id, ...updates }))
  }, [dispatch])

  // ── Delete a block ────────────────────────────────────────────────────────
  const handleDelete = useCallback((id) => {
    dispatch(pause())
    onMotionPause?.()
    dispatch(deleteAudioTrack(id))
    if (selectedAudioBlockId === id) onSelectAudioBlock?.(null)
  }, [dispatch, selectedAudioBlockId, onSelectAudioBlock, onMotionPause])

  // ── Click on empty track area ─────────────────────────────────────────────
  const handleTrackClick = useCallback((e) => {
    e.stopPropagation()
    fileInputRef.current?.click()
  }, [])

  // ── Deselect on click outside blocks ─────────────────────────────────────
  const handleContainerClick = useCallback((e) => {
    if (!e.target.closest('[data-audio-block]')) {
      onSelectAudioBlock?.(null)
    }
  }, [onSelectAudioBlock])

  // Group tracks by rowIndex to correctly render each row
  const maxRow = audioTracksWithProgress.length > 0
    ? Math.max(...audioTracksWithProgress.map(t => t.rowIndex ?? 0))
    : -1

  const rows = []
  for (let r = 0; r <= maxRow; r++) {
    rows.push(audioTracksWithProgress.filter(t => (t.rowIndex ?? 0) === r))
  }
  // Always show at least one empty row at the bottom
  rows.push([]) // empty "add" row

  const hasAnySelected = !!selectedAudioBlockId

  return (
    <div
      className="flex flex-col flex-shrink-0 relative"
      style={{ width: '100%', marginTop: '2px' }}
      onClick={handleContainerClick}
    >
      <div
        ref={tracksContainerRef}
        style={{
          marginLeft: '16px',
          width: `${totalProjectWidth}px`,
          position: 'relative',
        }}
      >
        {rows.map((rowTracks, rowIdx) => {
          const isEmptyRow = rowTracks.length === 0

          return (
            <div
              key={rowIdx}
              className="relative flex-shrink-0 transition-colors"
              style={{
                height: `${ROW_HEIGHT}px`,
                width: '100%',
              }}
            >
              {draggedOverRow === rowIdx && (
                <div 
                  className="absolute inset-0 bg-sky-400/20 border border-sky-400/35 rounded-lg pointer-events-none z-[5]"
                />
              )}
              {isEmptyRow ? (
                <EmptyAudioPlaceholder
                  totalProjectWidth={totalProjectWidth}
                  isLight={isLight}
                  onClick={handleTrackClick}
                />
              ) : (
                rowTracks.map(block => (
                  <AudioBlock
                    key={block.id}
                    block={block}
                    totalDuration={totalDuration}
                    isSelected={selectedAudioBlockId === block.id}
                    hasAnySelected={hasAnySelected}
                    onSelect={(id, seekTime) => onSelectAudioBlock?.(id, seekTime)}
                    onResize={handleResize}
                    onDelete={handleDelete}
                    onContextMenu={(e, blk) => {
                      setContextMenu({
                        visible: true,
                        x: e.clientX,
                        y: e.clientY,
                        block: blk,
                      })
                    }}
                    isLight={isLight}
                    calculateTimePosition={calculateTimePosition}
                    calculateWidthFromDuration={calculateWidthFromDuration}
                    onDragStart={() => {
                      dispatch(pause())
                      onMotionPause?.()
                      onDragStart?.()
                    }}
                    onDragEnd={onDragEnd}
                    onMotionPause={onMotionPause}
                  />
                ))
              )}
            </div>
          )
        })}
      </div>

      {/* Hidden file input for uploading audio directly */}
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />

      {/* Context Menu for Audio Blocks */}
      {contextMenu.visible && contextMenu.block && createPortal(
        <div
          data-audio-context-menu
          className="fixed rounded-lg shadow-2xl py-1 z-[10005] min-w-[150px] overflow-hidden"
          style={{
            top: `${contextMenu.y}px`,
            left: `${contextMenu.x}px`,
            backgroundColor: isLight ? 'rgba(255, 255, 255, 0.92)' : 'rgba(20, 20, 24, 0.92)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            border: isLight ? '1px solid rgba(0,0,0,0.08)' : '1px solid rgba(255,255,255,0.08)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className={`w-full text-left px-3.5 py-2 text-[11px] ${isLight ? 'text-gray-800 hover:bg-black/5' : 'text-white/85 hover:text-white hover:bg-white/8'} flex items-center gap-2.5 transition-colors rounded-md mx-0.5 my-0.5`}
            style={{ width: 'calc(100% - 4px)' }}
            onClick={() => {
              dispatch(updateAudioTrack({ id: contextMenu.block.id, muted: !contextMenu.block.muted }))
              setContextMenu(prev => ({ ...prev, visible: false }))
            }}
          >
            {contextMenu.block.muted ? (
              <>
                <Volume2 className="h-3.5 w-3.5 text-purple-400" />
                <span>Unmute</span>
              </>
            ) : (
              <>
                <VolumeX className="h-3.5 w-3.5 text-purple-400" />
                <span>Mute</span>
              </>
            )}
          </button>

          <div className={`h-px ${isLight ? 'bg-black/5' : 'bg-white/5'} my-0.5 mx-2.5`} />

          <button
            className={`w-full text-left px-3.5 py-2 text-[11px] ${isLight ? 'text-red-600 hover:bg-red-50' : 'text-red-400/90 hover:bg-red-500/15 hover:text-red-300'} flex items-center gap-2.5 transition-colors rounded-md mx-0.5 my-0.5`}
            style={{ width: 'calc(100% - 4px)' }}
            onClick={() => {
              handleDelete(contextMenu.block.id)
              setContextMenu(prev => ({ ...prev, visible: false }))
            }}
          >
            <Trash2 className="h-3.5 w-3.5 text-red-500" />
            <span>Delete Audio</span>
          </button>
        </div>,
        document.body
      )}
    </div>
  )
})

export default AudioBar

// ─── Audio Controls for CanvasControls ───────────────────────────────────────
// A standalone pill content fragment to be embedded in CanvasControls when
// an audio block is selected. Exported so CanvasControls can import it directly.

export function AudioControlsContent({
  block,
  onMute,
  onVolumeChange,
  onDelete,
  onCut,
  isLight,
}) {
  const [showVolumeSlider, setShowVolumeSlider] = useState(false)
  const [localVolume, setLocalVolume] = useState(block?.volume ?? 1)
  const isMuted = block?.muted ?? false

  // Keep local volume in sync when block changes
  useEffect(() => { setLocalVolume(block?.volume ?? 1) }, [block?.volume])

  if (!block) return null

  return (
    <>
      {/* Volume / Mute */}
      <div className="relative flex-shrink-0 flex items-center">
        <button
          onClick={() => setShowVolumeSlider(v => !v)}
          className={`h-8 px-2 rounded-[8px] transition-all flex items-center justify-center touch-manipulation border ${
            showVolumeSlider
              ? isLight
                ? 'bg-purple-50 border-purple-200 text-purple-600'
                : 'bg-white/15 border-white/20 text-white'
              : isLight
                ? 'text-gray-700 hover:bg-gray-100 border-transparent hover:border-gray-200'
                : 'text-white hover:bg-white/10 border-transparent hover:border-white/10'
          }`}
          title="Volume & Mute"
        >
          {isMuted
            ? <VolumeX className="h-4 w-4" strokeWidth={2} />
            : <Volume2 className="h-4 w-4" strokeWidth={2} />
          }
        </button>

        {/* Volume slider */}
        {showVolumeSlider && (
          <div
            className="absolute bottom-full mb-2 left-0 rounded-lg px-3 py-2 flex items-center gap-3"
            style={{
              backgroundColor: isLight ? 'rgba(255,255,255,0.97)' : 'rgba(18,18,24,0.97)',
              backdropFilter: 'blur(20px)',
              border: isLight ? '1px solid rgba(0,0,0,0.08)' : '1px solid rgba(255,255,255,0.1)',
              boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
              minWidth: 160,
              zIndex: 9999,
            }}
          >
            {/* Speaker icon inside the panel */}
            <button
              onClick={() => onMute?.(!isMuted)}
              className={`p-1 rounded transition-colors ${
                isLight ? 'hover:bg-black/5 text-gray-700' : 'hover:bg-white/10 text-white'
              }`}
              title={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted ? (
                <VolumeX className="h-4 w-4 text-amber-500" strokeWidth={2} />
              ) : (
                <Volume2 className="h-4 w-4" strokeWidth={2} />
              )}
            </button>

            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={isMuted ? 0 : localVolume}
              disabled={isMuted}
              onChange={(e) => {
                const v = parseFloat(e.target.value)
                setLocalVolume(v)
                onVolumeChange?.(v)
                if (isMuted) onMute?.(false)
              }}
              className="flex-1 h-1.5 appearance-none rounded-full"
              style={{ accentColor: '#7c4af0', opacity: isMuted ? 0.5 : 1 }}
            />
          </div>
        )}
      </div>

      {/* Separator */}
      <div className={`w-px h-5 flex-shrink-0 ${isLight ? 'bg-black/10' : 'bg-white/10'}`} />

      {/* Cut at playhead */}
      <button
        onClick={onCut}
        className={`h-8 px-2 rounded-[8px] transition-all flex items-center justify-center touch-manipulation border ${
          isLight
            ? 'text-gray-700 hover:bg-gray-100 border-transparent hover:border-gray-200'
            : 'text-white hover:bg-white/10 border-transparent hover:border-white/10'
        }`}
        title="Cut at playhead"
      >
        <Scissors className="h-4 w-4" strokeWidth={2} />
      </button>

      {/* Delete */}
      <button
        onClick={onDelete}
        className={`h-8 px-2 rounded-[8px] transition-all flex items-center justify-center touch-manipulation border ${
          isLight
            ? 'text-red-500 hover:bg-red-50 border-transparent hover:border-red-200'
            : 'text-red-400 hover:bg-red-500/15 border-transparent hover:border-red-500/25'
        }`}
        title="Delete audio block"
      >
        <Trash2 className="h-4 w-4" strokeWidth={2} />
      </button>
    </>
  )
}
