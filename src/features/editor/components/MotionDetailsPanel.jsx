import React, { useContext, useCallback, useRef, useMemo } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { ThemeContext } from '../../../app/context/ThemeContext'
import { updateSceneMotionActionTiming, setTimelineDragging, resolveStepLayout } from '../../../store/slices/projectSlice'
import { selectSelectedLayerIds, selectSelectedActionType, selectSelectedActionStepId, setSelectedAction } from '../../../store/slices/selectionSlice'
import { PRESET_REGISTRY } from '../../engine/motion/presets.js'
import { snapMotionBlock } from '../utils/timelineSnapping'

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const LABEL_COL_WIDTH = 220 // px — desktop fixed label column width
const MOBILE_LABEL_WIDTH = 80 // px — mobile sticky label width
const ROW_HEIGHT = 28 // px — height of each action row
const ROW_GAP = 3 // px — gap between rows
const ROW_TOTAL = ROW_HEIGHT + ROW_GAP // 31px per row slot

// Human-readable action type labels
const ACTION_LABELS = {
  move: 'Move',
  fade: 'Fade',
  scale: 'Scale',
  rotate: 'Rotate',
  blur: 'Blur',
  cornerRadius: 'Radius',
  color: 'Color',
  crop: 'Crop',
  tilt: 'Tilt',
  typewriter: 'Reveal',
  flip: 'Flip',
}

const getActionLabel = (type) => ACTION_LABELS[type] || type

const getLayerTypeLabel = (type) => {
  if (!type) return 'Layer'
  const lower = type.toLowerCase()
  if (lower === 'text') return 'Text'
  if (lower === 'shape') return 'Shape'
  if (lower === 'image') return 'Image'
  if (lower === 'video') return 'Video'
  if (lower === 'frame') return 'Frame'
  return type.charAt(0).toUpperCase() + type.slice(1)
}

// Detect touch device
const isTouchDevice = () =>
  typeof window !== 'undefined' &&
  ('ontouchstart' in window || navigator.maxTouchPoints > 0)

// ─────────────────────────────────────────────────────────────────────────────
// MotionActionBlock — draggable/resizable block for a single action in one step
// ─────────────────────────────────────────────────────────────────────────────

const MotionActionBlock = React.memo(({
  action,
  step,
  layerId,
  sceneId,
  leftPct,
  widthPct,
  sceneWidthPx,
  pageDuration,    // ms — total scene duration
  onMotionPause,
  isActive,        // whether this action's step is currently active (playhead inside)
  isLight,
  onSeek,
  sceneStartTime = 0,
  onSeekInstant,
  isMotionCaptureActive = false,
  onPlayheadInteractionDuringCapture = null,
  editingStepId = null,
  isSelected = false,
  liveSteps = [],
}) => {
  const dispatch = useDispatch()
  const dragRef = useRef(null)

  const isEditing = isMotionCaptureActive && editingStepId === step.id

  // Resolve action's effective offset/duration within the parent step
  const stepDuration = step.duration || 1000
  const actionStartOffset = action.actionStartOffset !== undefined ? action.actionStartOffset : 0
  const actionDuration = action.actionDuration !== undefined ? action.actionDuration : stepDuration

  const blockWidth = Math.max(4, (widthPct / 100) * sceneWidthPx)
  const pxToMs = sceneWidthPx > 0 ? pageDuration / sceneWidthPx : 0

  const { prevEnd, nextStart } = useMemo(() => {
    if (!liveSteps || !step) return { prevEnd: 0, nextStart: pageDuration }
    const idx = liveSteps.findIndex(s => s.id === step.id)
    if (idx === -1) return { prevEnd: 0, nextStart: pageDuration }
    const prevStep = idx > 0 ? liveSteps[idx - 1] : null
    const nextStep = idx < liveSteps.length - 1 ? liveSteps[idx + 1] : null

    const pEnd = prevStep ? ((prevStep.startTime || 0) + (prevStep.duration || 1000)) : 0
    const nStart = nextStep ? (nextStep.startTime || 0) : pageDuration
    return { prevEnd: pEnd, nextStart: nStart }
  }, [liveSteps, step, pageDuration])

  const getClientX = useCallback((e) => {
    if (e.touches && e.touches.length > 0) return e.touches[0].clientX
    if (e.changedTouches && e.changedTouches.length > 0) return e.changedTouches[0].clientX
    return e.clientX
  }, [])

  const handlePointerDown = useCallback((e, dragType) => {
    if (e.pointerType === 'touch') return
    e.stopPropagation()
    e.preventDefault()

    dispatch(setSelectedAction({ layerId, actionType: action.type, stepId: step.id }))

    // [MOTION INTERACTION DURING CAPTURE] Exit capture mode if active
    if (isMotionCaptureActive && onPlayheadInteractionDuringCapture) {
      onPlayheadInteractionDuringCapture()
    }

    if (typeof onMotionPause === 'function') onMotionPause()

    dispatch(setTimelineDragging(true))

    const startX = getClientX(e)
    const stepStart = step.startTime || 0
    const origAbsoluteStartTime = stepStart + actionStartOffset
    const origAbsoluteEndTime = origAbsoluteStartTime + actionDuration
    let didMoveFar = false

    dragRef.current = { type: dragType, startX, origAbsoluteStartTime, origAbsoluteEndTime }

    // rAF-throttled seek for canvas sync during operation
    const seekRafRef = { current: null }

    // Snap playhead immediately
    let finalSeekTime = sceneStartTime + (origAbsoluteEndTime - 5) / 1000
    if (dragType === 'resize-left') {
      finalSeekTime = sceneStartTime + (origAbsoluteStartTime + 5) / 1000
    }

    if (onSeekInstant) {
      onSeekInstant(finalSeekTime)
    }
    if (onSeek) {
      onSeek(finalSeekTime)
    }

    const handleMove = (moveE) => {
      if (!dragRef.current) return
      const dx = getClientX(moveE) - dragRef.current.startX
      if (Math.abs(dx) > 3) didMoveFar = true
      const msDelta = Math.round(dx * pxToMs)

      let proposedStart = dragRef.current.origAbsoluteStartTime
      let proposedDuration = dragRef.current.origAbsoluteEndTime - dragRef.current.origAbsoluteStartTime

      if (dragRef.current.type === 'resize-left') {
        proposedStart = dragRef.current.origAbsoluteStartTime + msDelta
      } else if (dragRef.current.type === 'resize-right') {
        proposedDuration = (dragRef.current.origAbsoluteEndTime - dragRef.current.origAbsoluteStartTime) + msDelta
      } else {
        proposedStart = dragRef.current.origAbsoluteStartTime + msDelta
      }

      const snapped = snapMotionBlock({
        type: dragRef.current.type,
        proposedStart,
        proposedDuration,
        step,
        layerId,
        actionId: action.id,
        pageDuration,
        sceneWidthPx,
      })

      if (dragRef.current.type === 'resize-left') {
        const newStart = Math.max(prevEnd, Math.min(dragRef.current.origAbsoluteEndTime - 50, snapped.start))
        finalSeekTime = sceneStartTime + (newStart + 5) / 1000

        if (onSeekInstant) {
          onSeekInstant(finalSeekTime)
        }
        if (onSeek) {
          if (seekRafRef.current === null) {
            seekRafRef.current = requestAnimationFrame(() => {
              seekRafRef.current = null
              onSeek(finalSeekTime)
            })
          }
        }

        const newDuration = dragRef.current.origAbsoluteEndTime - newStart
        dispatch(updateSceneMotionActionTiming({
          sceneId, stepId: step.id, layerId, actionId: action.id,
          absoluteStartTime: newStart,
          absoluteDuration: newDuration,
        }))
      } else if (dragRef.current.type === 'resize-right') {
        const newDuration = Math.max(50, snapped.duration)
        const requestedAbsoluteEndTime = dragRef.current.origAbsoluteStartTime + newDuration
        const newEnd = Math.max(dragRef.current.origAbsoluteStartTime + 50, Math.min(nextStart, requestedAbsoluteEndTime))
        finalSeekTime = sceneStartTime + (newEnd - 5) / 1000

        if (onSeekInstant) {
          onSeekInstant(finalSeekTime)
        }
        if (onSeek) {
          if (seekRafRef.current === null) {
            seekRafRef.current = requestAnimationFrame(() => {
              seekRafRef.current = null
              onSeek(finalSeekTime)
            })
          }
        }

        const finalDuration = newEnd - dragRef.current.origAbsoluteStartTime
        dispatch(updateSceneMotionActionTiming({
          sceneId, stepId: step.id, layerId, actionId: action.id,
          absoluteStartTime: dragRef.current.origAbsoluteStartTime,
          absoluteDuration: finalDuration,
        }))
      } else {
        const newStart = Math.max(prevEnd, Math.min(nextStart - actionDuration, snapped.start))
        finalSeekTime = sceneStartTime + (newStart + actionDuration - 5) / 1000

        if (onSeekInstant) {
          onSeekInstant(finalSeekTime)
        }
        if (onSeek) {
          if (seekRafRef.current === null) {
            seekRafRef.current = requestAnimationFrame(() => {
              seekRafRef.current = null
              onSeek(finalSeekTime)
            })
          }
        }

        dispatch(updateSceneMotionActionTiming({
          sceneId, stepId: step.id, layerId, actionId: action.id,
          absoluteStartTime: newStart,
          absoluteDuration: actionDuration,
          isMove: true,
        }))
      }
    }

    const handleUp = () => {
      const currentDragType = dragRef.current?.type
      dragRef.current = null
      dispatch(setTimelineDragging(false))
      document.removeEventListener('pointermove', handleMove)
      document.removeEventListener('pointerup', handleUp)

      // On simple click (no movement): snap playhead based on handle clicked
      if (!didMoveFar) {
        const targetSeekTime = currentDragType === 'resize-left'
          ? sceneStartTime + (origAbsoluteStartTime + 5) / 1000
          : sceneStartTime + (origAbsoluteEndTime - 5) / 1000
        if (onSeekInstant) onSeekInstant(targetSeekTime)
        if (onSeek) onSeek(targetSeekTime)
      } else {
        if (onSeek) onSeek(finalSeekTime)
        // Trigger auto-save during motion capture mode on drag/trim end
        if (isMotionCaptureActive && onPlayheadInteractionDuringCapture) {
          onPlayheadInteractionDuringCapture()
        }
      }
    }

    document.addEventListener('pointermove', handleMove)
    document.addEventListener('pointerup', handleUp)
  }, [action.id, actionStartOffset, actionDuration, step.id, step.startTime, stepDuration, layerId, sceneId, pxToMs, dispatch, onMotionPause, getClientX, onSeek, onSeekInstant, sceneStartTime, isMotionCaptureActive, onPlayheadInteractionDuringCapture, prevEnd, nextStart])

  const handleTouchStart = useCallback((e, dragType) => {
    e.stopPropagation()

    dispatch(setSelectedAction({ layerId, actionType: action.type, stepId: step.id }))

    // [MOTION INTERACTION DURING CAPTURE] Exit capture mode if active
    if (isMotionCaptureActive && onPlayheadInteractionDuringCapture) {
      onPlayheadInteractionDuringCapture()
    }

    const touch = e.touches[0]
    const startX = touch.clientX
    let hasMoved = false
    const seekRafRef = { current: null }
    const stepStart = step.startTime || 0
    const origAbsoluteStartTime = stepStart + actionStartOffset
    const origAbsoluteEndTime = origAbsoluteStartTime + actionDuration

    let finalSeekTime = sceneStartTime + (origAbsoluteEndTime - 5) / 1000
    if (dragType === 'resize-left') {
      finalSeekTime = sceneStartTime + (origAbsoluteStartTime + 5) / 1000
    }

    if (onSeekInstant) {
      onSeekInstant(finalSeekTime)
    }
    if (onSeek) {
      onSeek(finalSeekTime)
    }

    const onTouchMove = (moveE) => {
      const touchX = moveE.touches[0].clientX
      const dx = touchX - startX

      if (!hasMoved) {
        if (Math.abs(dx) > 4) {
          hasMoved = true
          if (typeof onMotionPause === 'function') onMotionPause()
          dispatch(setTimelineDragging(true))
        }
      }

      if (hasMoved) {
        if (moveE.cancelable) moveE.preventDefault()
        const msDelta = Math.round(dx * pxToMs)

        let proposedStart = origAbsoluteStartTime
        let proposedDuration = origAbsoluteEndTime - origAbsoluteStartTime

        if (dragType === 'resize-left') {
          proposedStart = origAbsoluteStartTime + msDelta
        } else if (dragType === 'resize-right') {
          proposedDuration = (origAbsoluteEndTime - origAbsoluteStartTime) + msDelta
        } else {
          proposedStart = origAbsoluteStartTime + msDelta
        }

        const snapped = snapMotionBlock({
          type: dragType,
          proposedStart,
          proposedDuration,
          step,
          layerId,
          actionId: action.id,
          pageDuration,
          sceneWidthPx,
        })

        if (dragType === 'resize-left') {
          const newStart = Math.max(prevEnd, Math.min(origAbsoluteEndTime - 50, snapped.start))
          finalSeekTime = sceneStartTime + (newStart + 5) / 1000

          if (onSeekInstant) {
            onSeekInstant(finalSeekTime)
          }
          if (onSeek) {
            if (seekRafRef.current === null) {
              seekRafRef.current = requestAnimationFrame(() => {
                seekRafRef.current = null
                onSeek(finalSeekTime)
              })
            }
          }

          const newDuration = origAbsoluteEndTime - newStart
          dispatch(updateSceneMotionActionTiming({
            sceneId, stepId: step.id, layerId, actionId: action.id,
            absoluteStartTime: newStart,
            absoluteDuration: newDuration,
          }))
        } else if (dragType === 'resize-right') {
          const newDuration = Math.max(50, snapped.duration)
          const requestedAbsoluteEndTime = origAbsoluteStartTime + newDuration
          const newEnd = Math.max(origAbsoluteStartTime + 50, Math.min(nextStart, requestedAbsoluteEndTime))
          finalSeekTime = sceneStartTime + (newEnd - 5) / 1000

          if (onSeekInstant) {
            onSeekInstant(finalSeekTime)
          }
          if (onSeek) {
            if (seekRafRef.current === null) {
              seekRafRef.current = requestAnimationFrame(() => {
                seekRafRef.current = null
                onSeek(finalSeekTime)
              })
            }
          }

          const finalDuration = newEnd - origAbsoluteStartTime
          dispatch(updateSceneMotionActionTiming({
            sceneId, stepId: step.id, layerId, actionId: action.id,
            absoluteStartTime: origAbsoluteStartTime,
            absoluteDuration: finalDuration,
          }))
        } else {
          const newStart = Math.max(prevEnd, Math.min(nextStart - actionDuration, snapped.start))
          finalSeekTime = sceneStartTime + (newStart + actionDuration - 5) / 1000

          if (onSeekInstant) {
            onSeekInstant(finalSeekTime)
          }
          if (onSeek) {
            if (seekRafRef.current === null) {
              seekRafRef.current = requestAnimationFrame(() => {
                seekRafRef.current = null
                onSeek(finalSeekTime)
              })
            }
          }

          dispatch(updateSceneMotionActionTiming({
            sceneId, stepId: step.id, layerId, actionId: action.id,
            absoluteStartTime: newStart,
            absoluteDuration: actionDuration,
            isMove: true,
          }))
        }
      }
    }

    const onTouchEnd = () => {
      if (hasMoved) {
        dispatch(setTimelineDragging(false))
        if (isMotionCaptureActive && onPlayheadInteractionDuringCapture) {
          onPlayheadInteractionDuringCapture()
        }
      } else {
        const targetSeekTime = dragType === 'resize-left'
          ? sceneStartTime + (origAbsoluteStartTime + 5) / 1000
          : sceneStartTime + (origAbsoluteEndTime - 5) / 1000
        if (onSeekInstant) onSeekInstant(targetSeekTime)
        if (onSeek) onSeek(targetSeekTime)
      }
      document.removeEventListener('touchmove', onTouchMove)
      document.removeEventListener('touchend', onTouchEnd)
      document.removeEventListener('touchcancel', onTouchEnd)

      if (onSeek) {
        onSeek(finalSeekTime)
      }
    }

    document.addEventListener('touchmove', onTouchMove, { passive: false })
    document.addEventListener('touchend', onTouchEnd, { once: true })
    document.addEventListener('touchcancel', onTouchEnd, { once: true })
  }, [action.id, actionStartOffset, actionDuration, step.id, step.startTime, stepDuration, layerId, sceneId, pxToMs, dispatch, onMotionPause, onSeek, onSeekInstant, sceneStartTime, isMotionCaptureActive, onPlayheadInteractionDuringCapture, prevEnd, nextStart])

  const handleWidth = isTouchDevice()
    ? Math.max(20, Math.min(blockWidth * 0.4, 32))
    : Math.min(blockWidth * 0.4, 14)

  return (
    <div
      className="absolute top-1/2 -translate-y-1/2 group/action overflow-visible select-none pointer-events-auto"
      style={{
        left: `${leftPct}%`,
        width: `${widthPct}%`,
        height: `${ROW_HEIGHT - 6}px`,
        zIndex: 10,
      }}
    >
      {/* Left resize handle */}
      <div
        data-resize-handle="true"
        onPointerDown={(e) => {
          if (e.button !== undefined && e.button !== 0) return
          handlePointerDown(e, 'resize-left')
        }}
        onTouchStart={(e) => handleTouchStart(e, 'resize-left')}
        className="absolute top-0 bottom-0 z-30 flex items-center justify-center"
        style={{
          cursor: 'ew-resize',
          touchAction: 'none',
          width: `${handleWidth}px`,
          left: isTouchDevice() ? `${-handleWidth / 2}px` : '0px',
        }}
      >
        <div
          className={`${blockWidth < 28 ? 'hidden' : 'w-[3px] h-[12px] rounded-full transition-all duration-150'} opacity-0 group-hover/action:opacity-100`}
          style={{ backgroundColor: 'white' }}
        />
      </div>

      {/* Main draggable body */}
      <div
        onPointerDown={(e) => {
          if ((e.button !== undefined && e.button !== 0) || e.target.dataset.resizeHandle) return
          handlePointerDown(e, 'move')
        }}
        onTouchStart={(e) => {
          if (e.target.dataset.resizeHandle) return
          handleTouchStart(e, 'move')
        }}
        className="w-full h-full rounded-[5px] flex items-center justify-center text-[9px] font-semibold tracking-wider uppercase transition-all duration-100 relative overflow-hidden select-none"
        style={{
          cursor: 'grab',
          touchAction: 'none',
          backgroundColor: isEditing
            ? (isLight ? '#7a40ed' : '#633cc4')
            : isActive
              ? (isLight ? '#cab3f8' : '#4c3b70')
              : (isLight ? '#d7d7db' : '#25232d'),
          outline: isSelected
            ? (isLight ? '2px solid #7c4af0' : '2px solid #a78bfa')
            : 'none',
          outlineOffset: '1.5px',
        }}
      />

      {/* Right resize handle */}
      <div
        data-resize-handle="true"
        onPointerDown={(e) => {
          if (e.button !== undefined && e.button !== 0) return
          handlePointerDown(e, 'resize-right')
        }}
        onTouchStart={(e) => handleTouchStart(e, 'resize-right')}
        className="absolute top-0 bottom-0 z-30 flex items-center justify-center"
        style={{
          cursor: 'ew-resize',
          touchAction: 'none',
          width: `${handleWidth}px`,
          right: isTouchDevice() ? `${-handleWidth / 2}px` : '0px',
        }}
      >
        <div
          className={`${blockWidth < 28 ? 'hidden' : 'w-[3px] h-[12px] rounded-full transition-all duration-150'} opacity-0 group-hover/action:opacity-100`}
          style={{ backgroundColor: 'white' }}
        />
      </div>
    </div>
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// MotionDetailsRow — one row per (layerId, actionType) pair
// ─────────────────────────────────────────────────────────────────────────────

const MotionDetailsRow = React.memo(({
  row,
  layerType: layerTypeProp,
  actionType: actionTypeProp,
  rowEntries: rowEntriesProp,        // [{ step, action, layerId }]
  sceneId,
  pageDuration,
  sceneWidthPx,      // px width of the current scene block
  stepLeftBaseOffset, // px offset where the scene block starts (leftOffset)
  labelWidth = 120,
  isMobile,
  onMotionPause,
  activeStepId,
  isLight,
  onSeek,
  sceneStartTime = 0,
  onSeekInstant,
  leftOffset = 16,
  isMotionCaptureActive = false,
  onPlayheadInteractionDuringCapture = null,
  editingStepId = null,
  isSelected = false,
  liveSteps = [],
  selectedActionStepId = null,
}) => {
  const dispatch = useDispatch()
  const layerType = row?.layerType || layerTypeProp
  const actionType = row?.actionType || actionTypeProp
  const rowEntries = row?.entries || rowEntriesProp || []

  // Sort by step startTime
  const sortedEntries = useMemo(() => {
    if (!Array.isArray(rowEntries)) return []
    return [...rowEntries].sort((a, b) => (a.step.startTime || 0) - (b.step.startTime || 0))
  }, [rowEntries])

  const layerTypeLabel = useMemo(() => getLayerTypeLabel(layerType), [layerType])

  return (
    <div
      className="absolute inset-0 overflow-visible"
    >
      {/* Desktop: sticky label */}
      {!isMobile && (
        <div
          className="absolute flex items-center px-3 pointer-events-auto cursor-pointer"
          onClick={() => dispatch(setSelectedAction({ layerId: row.layerId, actionType: row.actionType }))}
          style={{
            width: `${labelWidth}px`,
            position: 'sticky',
            left: 0,
            zIndex: 100,
            backgroundColor: isSelected
              ? (isLight ? '#ede8f9' : 'rgba(237, 232, 249, 0.1)')
              : (isLight ? '#f3f4f7' : '#090a0d'),
            borderRight: `1px solid ${isLight ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.08)'}`,
            top: '-2px',
            height: `${ROW_TOTAL}px`,
          }}
        >
          <span
            className="truncate font-bold uppercase text-left w-full"
            style={{
              fontSize: '13px',
              color: isSelected
                ? (isLight ? '#7c4af0' : '#a78bfa')
                : (isLight ? 'rgba(0,0,0,0.75)' : 'rgba(255,255,255,0.75)'),
              fontFamily: 'Inter, system-ui, sans-serif',
              letterSpacing: '0.04em',
            }}
            title={`${layerTypeLabel} • ${row?.isPreset ? actionType : getActionLabel(actionType)}`}
          >
            {layerTypeLabel}
            <span style={{ opacity: 0.65 }}> • {row?.isPreset ? actionType : getActionLabel(actionType)}</span>
          </span>
        </div>
      )}

      {/* Mobile: sticky label */}
      {isMobile && (
        <div
          className="absolute inset-y-0 pointer-events-none"
          style={{
            left: `${stepLeftBaseOffset}px`,
            width: `${sceneWidthPx}px`,
          }}
        >
          <div
            className="z-20 pointer-events-none select-none"
            style={{
              width: `${MOBILE_LABEL_WIDTH}px`,
              position: 'sticky',
              left: '0px',
              display: 'flex',
              alignItems: 'center',
              height: '100%',
              zIndex: 70,
            }}
          >
            <span
              className="truncate font-semibold w-full"
              style={{
                fontSize: '10px',
                color: isSelected
                  ? (isLight ? '#7c4af0' : '#a78bfa')
                  : (isLight ? 'rgba(0,0,0,0.48)' : 'rgba(255,255,255,0.48)'),
                fontFamily: 'Inter, system-ui, sans-serif',
                letterSpacing: '0.02em',
                lineHeight: 'normal',
              }}
            >
              {layerTypeLabel}
              <span style={{ opacity: 0.8 }}> • {row?.isPreset ? actionType : getActionLabel(actionType)}</span>
            </span>
          </div>
        </div>
      )}

      {/* Action blocks container locked 1:1 with scene card width */}
      <div
        className="absolute inset-y-0 overflow-visible pointer-events-none"
        style={{
          left: `${stepLeftBaseOffset}px`,
          width: `${sceneWidthPx}px`,
        }}
      >
        {sortedEntries.map(({ step, action, layerId: lid }) => {
          const stepStartMs = step.startTime || 0
          const actionOffsetMs = action.actionStartOffset !== undefined ? action.actionStartOffset : 0
          const actionDurationMs = action.actionDuration !== undefined ? action.actionDuration : (step.duration || 1000)

          const absStartMs = stepStartMs + actionOffsetMs

          const leftPct = pageDuration > 0 ? (absStartMs / pageDuration) * 100 : 0
          const widthPct = pageDuration > 0 ? (actionDurationMs / pageDuration) * 100 : 0

          return (
            <MotionActionBlock
              key={`${step.id}-${action.id}`}
              action={action}
              step={step}
              layerId={lid}
              sceneId={sceneId}
              leftPct={leftPct}
              widthPct={widthPct}
              sceneWidthPx={sceneWidthPx}
              pageDuration={pageDuration}
              onMotionPause={onMotionPause}
              isActive={activeStepId === step.id}
              isLight={isLight}
              onSeek={onSeek}
              sceneStartTime={sceneStartTime}
              onSeekInstant={onSeekInstant}
              isMotionCaptureActive={isMotionCaptureActive}
              onPlayheadInteractionDuringCapture={onPlayheadInteractionDuringCapture}
              editingStepId={editingStepId}
              isSelected={isSelected && (selectedActionStepId ? selectedActionStepId === step.id : activeStepId === step.id)}
              liveSteps={liveSteps}
            />
          )
        })}
      </div>
    </div>
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// MotionDetailsPanel — main panel rendered below the moment blocks row
// ─────────────────────────────────────────────────────────────────────────────

const MotionDetailsPanel = React.memo(({
  currentScene,         // scene object (with .id, .layers)
  sceneMotionFlows,     // all flows { [sceneId]: { steps, pageDuration } }
  layers,               // all layers map
  cardWidths,           // { [sceneIndex]: px }
  sceneIndex,           // index of the current scene in the scenes array
  leftOffset,           // px — left offset matching the main timeline ruler
  labelWidth = 120,     // px — width of sticky labels
  onMotionPause,
  activeStepId,         // currently highlighted step ID
  totalProjectWidth,    // px — width of the full timeline content area
  onSeek,
  sceneStartTime = 0,
  sceneLeftOffset = 0,  // px — horizontal offset of current scene card
  onSeekInstant,
  isMotionCaptureActive = false,
  onPlayheadInteractionDuringCapture = null,
  calculateDurationFromWidth = null,
  editingStepId = null,
}) => {
  const { theme } = useContext(ThemeContext)
  const isLight = theme === 'light'
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 1024

  const selectedLayerIds = useSelector(selectSelectedLayerIds)
  const selectedActionType = useSelector(selectSelectedActionType)
  const selectedActionStepId = useSelector(selectSelectedActionStepId)

  const motionFlow = currentScene ? sceneMotionFlows?.[currentScene.id] : null
  const steps = motionFlow?.steps || []
  const sceneWidthPx = cardWidths[sceneIndex] || 180
  const activeSceneLeftPx = leftOffset + (sceneLeftOffset || 0)

  const effectivePageDurationMs = useMemo(() => {
    if (calculateDurationFromWidth && sceneWidthPx > 0) {
      return Math.max(100, Math.round(calculateDurationFromWidth(sceneWidthPx) * 1000))
    }
    return motionFlow?.pageDuration || 5000
  }, [calculateDurationFromWidth, sceneWidthPx, motionFlow?.pageDuration])

  // Derive live steps during scene card trimming for 60fps visual stability
  const liveSteps = useMemo(() => {
    if (!steps || steps.length === 0) return []

    // Deep clone steps to resolve live layout without mutating Redux store
    const clonedSteps = JSON.parse(JSON.stringify(steps))
    const oldStepDurations = new Map(clonedSteps.map(s => [s.id, s.duration || 1000]))

    resolveStepLayout(clonedSteps, effectivePageDurationMs)

    // Apply proportional child rescaling during live card resizing
    clonedSteps.forEach(step => {
      if (!step.layerActions) step.layerActions = {}
      const effectiveDuration = step.duration || 1000
      const oldStepDuration = oldStepDurations.get(step.id) || effectiveDuration
      const scaleRatio = (oldStepDuration > 0 && oldStepDuration !== effectiveDuration) ? effectiveDuration / oldStepDuration : 1
      const MIN_ACTION_DURATION = 50

      Object.keys(step.layerActions).forEach(layerId => {
        const actions = step.layerActions[layerId]
        if (!Array.isArray(actions)) return
        actions.forEach(action => {
          const oldOffset = action.actionStartOffset !== undefined ? action.actionStartOffset : 0
          const oldDur = action.actionDuration !== undefined ? action.actionDuration : oldStepDuration

          let newOffset = oldOffset
          let newDur = oldDur

          if (scaleRatio !== 1) {
            newOffset = Math.round(oldOffset * scaleRatio)
            newDur = Math.max(MIN_ACTION_DURATION, Math.round(oldDur * scaleRatio))
          } else {
            newOffset = Math.min(oldOffset, Math.max(0, effectiveDuration - MIN_ACTION_DURATION))
            newDur = Math.min(oldDur, Math.max(MIN_ACTION_DURATION, effectiveDuration - newOffset))
          }

          action.actionStartOffset = Math.min(newOffset, effectiveDuration - MIN_ACTION_DURATION)
          action.actionDuration = Math.min(newDur, effectiveDuration - action.actionStartOffset)
        })
      })

      if (step.layerPresets) {
        Object.keys(step.layerPresets).forEach(layerId => {
          const preset = step.layerPresets[layerId]
          if (!preset) return
          const oldOffset = preset.actionStartOffset !== undefined ? preset.actionStartOffset : 0
          const oldDur = preset.actionDuration !== undefined ? preset.actionDuration : oldStepDuration

          let newOffset = oldOffset
          let newDur = oldDur

          if (scaleRatio !== 1) {
            newOffset = Math.round(oldOffset * scaleRatio)
            newDur = Math.max(MIN_ACTION_DURATION, Math.round(oldDur * scaleRatio))
          } else {
            newOffset = Math.min(oldOffset, Math.max(0, effectiveDuration - MIN_ACTION_DURATION))
            newDur = Math.min(oldDur, Math.max(MIN_ACTION_DURATION, effectiveDuration - newOffset))
          }

          preset.actionStartOffset = Math.min(newOffset, effectiveDuration - MIN_ACTION_DURATION)
          preset.actionDuration = Math.min(newDur, effectiveDuration - preset.actionStartOffset)
        })
      }
    })

    return clonedSteps
  }, [steps, effectivePageDurationMs])

  // Derive rows: (layerId, actionType) pairs in PositionPanel layer order
  const rows = useMemo(() => {
    if (!currentScene || !layers || !motionFlow) return []

    const orderedLayerIds = (currentScene.layers || [])
      .filter(lid => {
        const layer = layers[lid]
        return layer && layer.type !== 'background'
      })
      .reverse()

    const rowMap = new Map()

    liveSteps.forEach(step => {
      const stepDuration = step.duration || 1000
      const layerActions = step.layerActions || {}
      const layerPresets = step.layerPresets || {}

      // 1. Custom actions from layerActions
      Object.entries(layerActions).forEach(([layerId, actions]) => {
        if (!Array.isArray(actions)) return
        actions.forEach(action => {
          const key = `${layerId}::${action.type}`
          if (!rowMap.has(key)) {
            const layer = layers[layerId]
            const isBg = layer?.type === 'background'
            const idx = orderedLayerIds.indexOf(layerId)
            const layerOrder = isBg ? 9999 : (idx !== -1 ? idx : 999)
            rowMap.set(key, {
              layerId,
              layerType: layer?.type || 'layer',
              actionType: action.type,
              isPreset: false,
              entries: [],
              layerOrder,
            })
          }
          rowMap.get(key).entries.push({ step, action, layerId })
        })
      })

      // 2. Preset actions from layerPresets (rendered as 1 row per preset)
      Object.entries(layerPresets).forEach(([layerId, preset]) => {
        if (!preset || !PRESET_REGISTRY[preset.id]) return
        const presetDef = PRESET_REGISTRY[preset.id]
        const key = `${layerId}::preset`
        if (!rowMap.has(key)) {
          const layer = layers[layerId]
          const isBg = layer?.type === 'background'
          const idx = orderedLayerIds.indexOf(layerId)
          const layerOrder = isBg ? 9999 : (idx !== -1 ? idx : 999)
          rowMap.set(key, {
            layerId,
            layerType: layer?.type || 'layer',
            actionType: presetDef.name || preset.id,
            isPreset: true,
            entries: [],
            layerOrder,
          })
        }

        const presetStartOffset = preset.actionStartOffset !== undefined ? preset.actionStartOffset : 0
        const presetDuration = preset.actionDuration !== undefined ? preset.actionDuration : stepDuration

        const actionObj = {
          id: `preset_${preset.id}_${step.id}`,
          type: presetDef.name || preset.id,
          actionStartOffset: presetStartOffset,
          actionDuration: presetDuration,
          isPreset: true,
          presetId: preset.id,
        }
        rowMap.get(key).entries.push({ step, action: actionObj, layerId })
      })
    })

    return Array.from(rowMap.values())
      .filter(row => row.entries.length > 0)
      .sort((a, b) => {
        const orderDiff = a.layerOrder - b.layerOrder
        if (orderDiff !== 0) return orderDiff
        return a.actionType.localeCompare(b.actionType)
      })
  }, [currentScene, layers, motionFlow, liveSteps])


  const totalHeight = rows.length * ROW_TOTAL

  return (
    <div
      className="relative flex-shrink-0"
      style={{
        height: `${totalHeight + 8}px`,
        paddingTop: '4px',
        paddingBottom: '4px',
        minWidth: '100%',
        width: `${Math.max(totalProjectWidth || 0, 200)}px`,
      }}
    >


      {/* ── Row lane backgrounds (restricted strictly to active scene duration) ── */}
      {(() => {
        const activeStepIndex = liveSteps.findIndex(s => s.id === activeStepId)
        const activeMomentBounds = (() => {
          if (activeStepIndex === -1) return null
          const prevStep = activeStepIndex > 0 ? liveSteps[activeStepIndex - 1] : null
          const nextStep = activeStepIndex < liveSteps.length - 1 ? liveSteps[activeStepIndex + 1] : null

          const startMs = prevStep ? ((prevStep.startTime || 0) + (prevStep.duration || 1000)) : 0
          const endMs = nextStep ? (nextStep.startTime || 0) : effectivePageDurationMs

          const startPct = effectivePageDurationMs > 0 ? startMs / effectivePageDurationMs : 0
          const endPct = effectivePageDurationMs > 0 ? endMs / effectivePageDurationMs : 1

          return {
            left: activeSceneLeftPx + startPct * sceneWidthPx,
            width: (endPct - startPct) * sceneWidthPx,
          }
        })()

        return rows.map((row, i) => {
          const isSelected = selectedLayerIds && selectedLayerIds.includes(row.layerId) &&
            (selectedActionType === null || selectedActionType === row.actionType)

          if (!activeMomentBounds) return null

          return (
            <div
              key={`bg-${row.layerId}::${row.actionType}`}
              className="absolute pointer-events-auto cursor-pointer transition-all duration-150"
              onClick={() => dispatch(setSelectedAction({ layerId: row.layerId, actionType: row.actionType }))}
              style={{
                top: `${4 + i * ROW_TOTAL}px`,
                left: `${activeMomentBounds.left}px`,
                width: `${activeMomentBounds.width}px`,
                height: `${ROW_HEIGHT}px`,
                borderRadius: '4px',
                boxSizing: 'border-box',
                backgroundColor: isSelected
                  ? (isLight ? '#ede8f9' : 'rgba(237, 232, 249, 0.1)')
                  : (isLight ? 'rgba(0,0,0,0.025)' : 'rgba(255,255,255,0.025)'),
                border: 'none',
              }}
            />
          )
        })
      })()}

      {rows.map((row, i) => {
        const isSelectedLeft = selectedLayerIds && selectedLayerIds.includes(row.layerId) &&
          (selectedActionType === null || selectedActionType === row.actionType)

        return (
          <div
            key={`row-${row.layerId}::${row.actionType}`}
            className="absolute overflow-visible"
            style={{
              top: `${4 + i * ROW_TOTAL}px`,
              left: 0,
              right: 0,
              height: `${ROW_HEIGHT}px`,
            }}
          >
            <MotionDetailsRow
              key={`${row.layerId}::${row.actionType}`}
              row={row}
              sceneId={currentScene.id}
              pageDuration={effectivePageDurationMs}
              sceneWidthPx={sceneWidthPx}
              stepLeftBaseOffset={activeSceneLeftPx}
              labelWidth={labelWidth}
              isMobile={isMobile}
              onMotionPause={onMotionPause}
              activeStepId={activeStepId}
              editingStepId={editingStepId}
              isSelected={isSelectedLeft}
              selectedActionStepId={selectedActionStepId}
              isLight={isLight}
              onSeek={onSeek}
              sceneStartTime={sceneStartTime}
              onSeekInstant={onSeekInstant}
              leftOffset={leftOffset}
              isMotionCaptureActive={isMotionCaptureActive}
              onPlayheadInteractionDuringCapture={onPlayheadInteractionDuringCapture}
              liveSteps={liveSteps}
            />
          </div>
        )
      })}

    </div>
  )
})

MotionDetailsPanel.displayName = 'MotionDetailsPanel'

export default MotionDetailsPanel

// Export constants for ScenesBar to calculate panel height
export { ROW_TOTAL, LABEL_COL_WIDTH }
