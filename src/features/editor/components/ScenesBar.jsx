import { Plus, Zap, ChevronDown } from 'lucide-react'
import { uid } from '../../../utils/ids'
import { useDispatch, useSelector } from 'react-redux'
import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { addScene, setCurrentScene, selectScenes, selectCurrentSceneId, reorderScene, updateScene, splitScene, deleteScene, selectProjectTimelineInfo, selectSceneMotionFlows, deleteSceneMotionStep, updateStepTiming } from '../../../store/slices/projectSlice'
import { clearLayerSelection } from '../../../store/slices/selectionSlice'
import { LAYER_TYPES } from '../../../store/models'


// Custom hook for debouncing values
function useDebounce(value, delay) {
  const [debouncedValue, setDebouncedValue] = React.useState(value)

  React.useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value)
    }, 200)

    return () => {
      clearTimeout(handler)
    }
  }, [value, delay])

  return debouncedValue
}

// Normalize layer fill/stroke to CSS color. Returns null for transparent/empty so we can show outline only.
function normalizeShapeColor(value) {
  if (value === undefined || value === null || value === '') return null
  if (value === 'transparent') return null
  if (typeof value === 'number') {
    return '#' + value.toString(16).padStart(6, '0').slice(-6)
  }
  return typeof value === 'string' ? value : null
}

const ScenePreview = React.memo(({ layers, cardWidth, cardHeight, backgroundColor }) => {
  // Default world dimensions (16:9 aspect ratio)
  const worldWidth = 1920
  const worldHeight = 1080

  // Calculate available space for preview
  // The label overlays on top, so we can use the full card height
  const availableWidth = cardWidth
  const availableHeight = cardHeight

  // Calculate scale to fit world dimensions in available space (maintaining aspect ratio)
  const scaleX = availableWidth / worldWidth
  const scaleY = availableHeight / worldHeight
  const scale = Math.min(scaleX, scaleY) // Maintain aspect ratio

  // Calculate actual preview dimensions
  const scaledPreviewWidth = worldWidth * scale
  const scaledPreviewHeight = worldHeight * scale

  // Calculate offsets to center the content within the full-width container
  const contentOffsetX = scale === scaleX ? 0 : (availableWidth - scaledPreviewWidth) / 2
  const contentOffsetY = scale === scaleY ? 0 : (availableHeight - scaledPreviewHeight) / 2

  // Convert backgroundColor from hex number to hex string for CSS
  const getBackgroundColorString = () => {
    if (backgroundColor !== undefined) {
      if (typeof backgroundColor === 'number') {
        return '#' + backgroundColor.toString(16).padStart(6, '0')
      }
      return backgroundColor
    }
    return '#ffffff' // Default to white
  }

  // Identify background layer and other layers
  const backgroundLayer = layers && layers.length > 0
    ? layers.find(layer => layer && layer.type === LAYER_TYPES.BACKGROUND)
    : null

  const visibleLayers = layers && layers.length > 0
    ? layers.filter(layer => layer && layer.visible !== false && layer.type !== LAYER_TYPES.BACKGROUND)
    : []

  const backgroundColorString = getBackgroundColorString()
  const backgroundImage = backgroundLayer?.data?.imageUrl || backgroundLayer?.data?.url || backgroundLayer?.data?.src || ''

  return (
    <div
      className="absolute inset-0 overflow-hidden rounded-lg"
      style={{
        width: `${cardWidth}px`,
        height: `${cardHeight}px`,
      }}
    >
      {/* Preview container that fills the entire card area to avoid white space */}
      <div
        style={{
          position: 'absolute',
          left: '0',
          top: '0',
          width: `${availableWidth}px`,
          height: `${availableHeight}px`,
          backgroundColor: backgroundColorString,
          overflow: 'hidden',
        }}
      >
        {/* Content container that holds the scaled preview content */}
        <div
          style={{
            position: 'absolute',
            left: `${contentOffsetX}px`,
            top: `${contentOffsetY}px`,
            width: `${scaledPreviewWidth}px`,
            height: `${scaledPreviewHeight}px`,
            pointerEvents: 'none',
          }}
        >
          {/* Background Image rendered inside the scaled content container for perfect alignment */}
          {backgroundImage && (
            <img
              src={backgroundImage}
              alt=""
              crossOrigin="anonymous"
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                pointerEvents: 'none',
              }}
              onError={(e) => {
                console.warn('ScenesBar: Failed to load background image:', backgroundImage);
                e.target.style.display = 'none';
              }}
            />
          )}

          {visibleLayers.map((layer) => {
            if (!layer) return null

            // Layer dimensions and transforms
            const layerWidth = (layer.width || 100) * (layer.scaleX || 1)
            const layerHeight = (layer.height || 100) * (layer.scaleY || 1)
            const isTextLayer = layer.type === LAYER_TYPES.TEXT
            const anchorX = isTextLayer ? 0 : (layer.anchorX !== undefined ? layer.anchorX : 0.5)
            const anchorY = isTextLayer ? 0 : (layer.anchorY !== undefined ? layer.anchorY : 0.5)
            const rotation = layer.rotation || 0
            const opacity = layer.opacity !== undefined ? layer.opacity : 1

            // Scale dimensions
            const width = layerWidth * scale
            const height = layerHeight * scale

            // Layer position in world coordinates (x, y is anchor point position)
            // World coordinates go from (0, 0) top-left to (worldWidth, worldHeight) bottom-right
            const worldX = layer.x || 0
            const worldY = layer.y || 0

            // Convert to preview coordinates (relative to preview container)
            // Account for anchor point offset
            const left = (worldX * scale) - (width * anchorX)
            const top = (worldY * scale) - (height * anchorY)

            const style = {
              position: 'absolute',
              left: `${left}px`,
              top: `${top}px`,
              width: `${Math.max(1, width)}px`,
              height: `${Math.max(1, height)}px`,
              transform: `rotate(${rotation}deg)`,
              transformOrigin: `${anchorX * 100}% ${anchorY * 100}%`,
              opacity,
              pointerEvents: 'none',
            }

            if (layer.type === LAYER_TYPES.TEXT) {
              const fontSize = Math.max(6, (layer.data?.fontSize || 16) * scale)
              return (
                <div
                  key={layer.id}
                  style={{
                    ...style,
                    fontSize: `${fontSize}px`,
                    color: layer.data?.color || '#000000',
                    fontFamily: layer.data?.fontFamily || 'Arial',
                    fontWeight: layer.data?.fontWeight || 'normal',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {layer.data?.content || 'Text'}
                </div>
              )
            } else if (layer.type === LAYER_TYPES.SHAPE) {
              const fillCss = normalizeShapeColor(layer.data?.fill)
              const strokeCss = normalizeShapeColor(layer.data?.stroke)
              const strokeWidth = (layer.data?.strokeWidth || 0) * scale
              const shapeType = layer.data?.shapeType || 'rect'
              const cornerRadius = (layer.data?.cornerRadius || 0) * scale

              // Transparent fill: show outline only so the shape is visible (no blue fallback)
              const hasFill = fillCss != null
              const hasStroke = strokeCss != null && strokeWidth > 0
              const outlineForTransparent = !hasFill && !hasStroke
                ? { border: '1px dashed rgba(156,163,175,0.7)', backgroundColor: 'transparent' }
                : {}

              // Triangle, hexagon, star: use SVG so stroke follows the shape outline (clip-path + div border fails for stroke-only)
              const svgShapes = ['triangle', 'hexagon', 'star']
              if (svgShapes.includes(shapeType)) {
                const polygonPoints = {
                  triangle: '50,0 100,100 0,100',
                  hexagon: '50,0 100,25 100,75 50,100 0,75 0,25',
                  star: '50,0 61,38 98,38 68,60 79,98 50,75 21,98 32,60 2,38 39,38',
                }
                const svgFill = hasFill ? fillCss : 'none'
                const svgStroke = hasStroke ? strokeCss : (outlineForTransparent.border ? 'rgba(156,163,175,0.7)' : 'none')
                const svgStrokeDasharray = outlineForTransparent.border ? '2,2' : 'none'
                // Stroke in viewBox units so it scales with the shape; min 2 for visibility
                const strokeInUnits = Math.max(2, 100 * (strokeWidth / Math.max(1, width)))

                return (
                  <div key={layer.id} style={{ ...style, overflow: 'hidden' }}>
                    <svg
                      viewBox="0 0 100 100"
                      preserveAspectRatio="none"
                      style={{
                        position: 'absolute',
                        inset: 0,
                        width: '100%',
                        height: '100%',
                        pointerEvents: 'none',
                      }}
                    >
                      <polygon
                        points={polygonPoints[shapeType]}
                        fill={svgFill}
                        stroke={svgStroke}
                        strokeWidth={hasStroke || outlineForTransparent.border ? strokeInUnits : 0}
                        strokeDasharray={svgStrokeDasharray}
                      />
                    </svg>
                  </div>
                )
              }

              // Rect, square, circle, line: use div (border works correctly for these)
              const baseShapeStyle = {
                ...style,
                ...outlineForTransparent,
                ...(hasFill ? { backgroundColor: fillCss } : {}),
                ...(hasStroke ? { border: `${Math.max(0.5, strokeWidth)}px solid ${strokeCss}` } : outlineForTransparent.border ? {} : { border: 'none' }),
                borderRadius: shapeType === 'circle' ? '50%' : (cornerRadius ? `${cornerRadius}px` : '0'),
              }

              return (
                <div
                  key={layer.id}
                  style={baseShapeStyle}
                />
              )
            } else if (layer.type === LAYER_TYPES.IMAGE || layer.type === LAYER_TYPES.VIDEO) {
              const imageUrl = layer.type === LAYER_TYPES.IMAGE
                ? (layer.data?.url || layer.data?.src || '')
                : (layer.data?.thumbnail || '')

              if (!imageUrl && layer.type === LAYER_TYPES.IMAGE) {
                // Placeholder for image without URL
                return (
                  <div
                    key={layer.id}
                    style={{
                      ...style,
                      backgroundColor: '#e5e7eb',
                      border: '1px solid #d1d5db',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '6px',
                      color: '#9ca3af',
                    }}
                  >
                    IMG
                  </div>
                )
              }

              if (!imageUrl && layer.type === LAYER_TYPES.VIDEO) {
                // Placeholder/Fallback for video without thumbnail
                return (
                  <div
                    key={layer.id}
                    style={{
                      ...style,
                      backgroundColor: '#1f2937',
                      border: '1px solid #374151',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '6px',
                      color: '#9ca3af',
                    }}
                  >
                    VIDEO
                  </div>
                )
              }

              return (
                <img
                  key={layer.id}
                  src={imageUrl}
                  alt=""
                  style={{
                    ...style,
                    objectFit: 'cover',
                  }}
                  onError={(e) => {
                    // Fallback to placeholder on error
                    e.target.style.display = 'none'
                  }}
                />
              )
            }

            return null
          })}
        </div>
      </div>
    </div>
  )
})

// Detect touch device for adaptive interaction sizing
const isTouchDevice = () => typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0)

const MotionStepsBar = React.memo(({ steps = [], activeStepId, onStepClick, onStepContextMenu, cardWidth, pageDuration = 5000, isMotionCaptureActive, sceneId }) => {
  const containerRef = useRef(null)
  const dispatch = useDispatch()
  const dragRef = useRef(null)
  const didDragRef = useRef(false)
  const [isDragging, setIsDragging] = useState(false)

  const pxToMs = cardWidth > 0 ? pageDuration / cardWidth : 0

  const getClientX = useCallback((e) => {
    if (e.touches && e.touches.length > 0) return e.touches[0].clientX
    if (e.changedTouches && e.changedTouches.length > 0) return e.changedTouches[0].clientX
    return e.clientX
  }, [])

  const handleStepPointerDown = useCallback((e, step, type) => {
    e.stopPropagation()
    e.preventDefault()
    didDragRef.current = false
    setIsDragging(true)

    const startX = getClientX(e)

    dragRef.current = {
      stepId: step.id,
      type,
      startX,
      origStartTime: step.startTime || 0,
      origDuration: step.duration || (pageDuration / (steps.length || 1)),
    }

    const handlePointerMove = (moveE) => {
      if (!dragRef.current) return
      const dx = getClientX(moveE) - dragRef.current.startX
      if (Math.abs(dx) > 2) didDragRef.current = true
      const msDelta = dx * pxToMs

      if (dragRef.current.type === 'resize-right') {
        dispatch(updateStepTiming({
          sceneId,
          stepId: dragRef.current.stepId,
          duration: Math.round(dragRef.current.origDuration + msDelta),
        }))
      } else if (dragRef.current.type === 'resize-left') {
        dispatch(updateStepTiming({
          sceneId,
          stepId: dragRef.current.stepId,
          startTime: Math.round(dragRef.current.origStartTime + msDelta),
          duration: Math.round(dragRef.current.origDuration - msDelta),
        }))
      } else {
        dispatch(updateStepTiming({
          sceneId,
          stepId: dragRef.current.stepId,
          startTime: Math.round(dragRef.current.origStartTime + msDelta),
        }))
      }
    }

    const handlePointerUp = () => {
      dragRef.current = null
      setIsDragging(false)
      document.removeEventListener('pointermove', handlePointerMove)
      document.removeEventListener('pointerup', handlePointerUp)
      document.removeEventListener('touchmove', handlePointerMove)
      document.removeEventListener('touchend', handlePointerUp)
    }

    document.addEventListener('pointermove', handlePointerMove)
    document.addEventListener('pointerup', handlePointerUp)
    document.addEventListener('touchmove', handlePointerMove, { passive: false })
    document.addEventListener('touchend', handlePointerUp)
  }, [pxToMs, pageDuration, steps.length, sceneId, dispatch, getClientX])

  return (
    <div
      ref={containerRef}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation() }}
      onMouseDown={(e) => e.stopPropagation()}
      className="absolute left-0 right-0 z-[120]"
      style={{
        top: '-36px',
        height: '36px',
        pointerEvents: 'auto',
      }}
    >
      {/* ── Base Block ── */}
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onStepClick?.('base') }}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onStepContextMenu?.(e, 'base') }}
        onMouseDown={(e) => e.stopPropagation()}
        data-step-id="base"
        title="Base pose (0s)"
        className={`absolute left-0 top-1/2 -translate-y-1/2 h-[24px] flex items-center justify-center rounded-[5px] transition-all duration-150 select-none group z-[110]
          ${(activeStepId === 'base' || !activeStepId)
            ? 'bg-zinc-700 text-white/90 shadow-sm ring-1 ring-zinc-500/40 w-[18px]'
            : 'bg-zinc-800 text-zinc-500 hover:bg-zinc-700 hover:text-white/80 hover:shadow-sm w-[16px]'
          }
          ${activeStepId === 'base' && isMotionCaptureActive ? 'ring-2 ring-purple-400 shadow-[0_0_10px_rgba(168,85,247,0.5)]' : ''}
        `}
        style={{ cursor: 'pointer', pointerEvents: steps.some(s => (s.startTime || 0) < 100) ? 'none' : 'auto' }}
      >
        <span className="text-[7px] font-bold leading-none opacity-80">B</span>
        <div className="hidden group-hover:block absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 bg-zinc-900 text-white text-[9px] px-2 py-1 rounded-md shadow-lg whitespace-nowrap pointer-events-none z-50 border border-white/10">
          Base pose
        </div>
      </button>

      {/* ── Step Blocks ── */}
      <div className="absolute inset-0 overflow-visible">
        {steps.map((step, i) => {
          const isActive = activeStepId === step.id
          const stepStart = step.startTime || 0
          const stepDur = step.duration || (pageDuration / (steps.length || 1))
          const leftPct = Math.min((stepStart / pageDuration) * 100, 100)
          const rawWidthPct = (stepDur / pageDuration) * 100
          const widthPct = Math.min(rawWidthPct, 100 - leftPct)
          const isManual = !!step.manual
          const blockPx = (stepDur / pageDuration) * cardWidth

          return (
            <div
              key={step.id || i}
              data-step-id={step.id}
              className="absolute top-1/2 -translate-y-1/2 group/step"
              style={{
                left: `${leftPct}%`,
                width: `${widthPct}%`,
                height: '24px',
              }}
            >
              {/* Left resize handle */}
              <div
                data-resize-handle="true"
                onPointerDown={(e) => {
                  if (e.button !== undefined && e.button !== 0) return
                  handleStepPointerDown(e, step, 'resize-left')
                }}
                onTouchStart={(e) => {
                  handleStepPointerDown(e, step, 'resize-left')
                }}
                className="absolute left-0 top-0 bottom-0 z-30 flex items-center justify-center"
                style={{
                  cursor: 'ew-resize',
                  touchAction: 'none',
                  width: `${Math.max(isTouchDevice() ? 16 : 8, Math.min(isTouchDevice() ? 20 : 14, Math.floor(blockPx * 0.25)))}px`,
                }}
              >
                <div className={`w-[3px] h-[10px] rounded-full transition-all duration-150 ${isActive ? 'bg-white/30 group-hover/step:bg-white/60' : 'bg-transparent group-hover/step:bg-purple-300/40'
                  }`} />
              </div>

              {/* Step body */}
              <button
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  if (!didDragRef.current) onStepClick?.(step.id)
                }}
                onContextMenu={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onStepContextMenu?.(e, step.id)
                }}
                onPointerDown={(e) => {
                  if ((e.button !== undefined && e.button !== 0) || e.target.dataset.resizeHandle) return
                  handleStepPointerDown(e, step, 'move')
                }}
                onTouchStart={(e) => {
                  if (e.target.dataset.resizeHandle) return
                  handleStepPointerDown(e, step, 'move')
                }}
                className={`w-full h-full text-[8px] font-semibold tracking-wider uppercase flex items-center justify-center rounded-[5px] select-none transition-all duration-100 relative overflow-hidden
                  ${isActive
                    ? 'text-white shadow-md z-10'
                    : 'text-purple-200 hover:text-white'
                  }
                  ${isActive && isMotionCaptureActive ? 'ring-[1.5px] ring-purple-300 shadow-[0_0_12px_rgba(168,85,247,0.5)]' : ''}
                `}
                style={{
                  cursor: isDragging ? 'grabbing' : 'grab',
                  touchAction: 'none',
                  backgroundColor: isActive ? '#7c3aed' : '#3b2667',
                  border: isActive ? '1px solid #a78bfa' : '1px solid #5b3a8c',
                }}
              >
                <span className="truncate px-1 relative z-10">
                  S{i + 1}
                  {isManual && <span className="text-[6px] opacity-40 ml-0.5">*</span>}
                </span>
              </button>

              {/* Right resize handle */}
              <div
                data-resize-handle="true"
                onPointerDown={(e) => {
                  if (e.button !== undefined && e.button !== 0) return
                  handleStepPointerDown(e, step, 'resize-right')
                }}
                onTouchStart={(e) => {
                  handleStepPointerDown(e, step, 'resize-right')
                }}
                className="absolute right-0 top-0 bottom-0 z-30 flex items-center justify-center"
                style={{
                  cursor: 'ew-resize',
                  touchAction: 'none',
                  width: `${Math.max(isTouchDevice() ? 16 : 8, Math.min(isTouchDevice() ? 20 : 14, Math.floor(blockPx * 0.25)))}px`,
                }}
              >
                <div className={`w-[3px] h-[10px] rounded-full transition-all duration-150 ${isActive ? 'bg-white/30 group-hover/step:bg-white/60' : 'bg-transparent group-hover/step:bg-purple-300/40'
                  }`} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
})



const SceneCard = React.memo(({ scene, isActive = false, onClick, onContextMenu, layers, index, isDragging, dragOverIndex, draggedIndex, insertionIndex, onDragStart, onDragOver, onDragEnd, onDrop, cardWidth, onCardWidthChange, onResizeStart, onResizeEnd, previousCardWidths, minCardWidth, calculateDurationFromWidth, calculateWidthFromDuration, formatDuration, onMotionStop, hasMotionSteps = false, motionStepCount = 0, motionFlow = null, activeStepId = null, onStepClick, onStepContextMenu, isMotionCaptureActive }) => {
  // Get responsive card dimensions
  const getCardDimensions = () => {
    if (typeof window === 'undefined') return { width: 120, height: 44 }

    if (window.innerWidth >= 1024) {
      return { width: 120, height: 44 }
    } else if (window.innerWidth >= 640) {
      return { width: 110, height: 40 }
    } else {
      return { width: 100, height: 36 }
    }
  }

  const defaultDimensions = getCardDimensions()
  const defaultWidth = defaultDimensions.width
  const { height } = defaultDimensions

  // Track drag position for floating preview - minimize React state updates
  const [dragPosition, setDragPosition] = useState({ x: 0, y: 0 })
  const cardElementRef = useRef(null)
  const dragPositionRef = useRef({ x: 0, y: 0 })
  const previewElementRef = useRef(null)
  const isDraggingRef = useRef(false)

  // Consolidate resize state for better performance and fewer re-renders
  const [resizeState, setResizeState] = useState({
    isResizing: false,
    side: null,
    leftOffset: 0,
    gapSize: 0,
    duration: null,
    tooltipPosition: { top: 0, right: 0 }
  })

  const currentCardWidth = cardWidth || defaultWidth

  // Refs for state values to access in event handlers
  const isResizingRef = useRef(false)
  const resizeSideRef = useRef(null)
  const startXRef = useRef(0)
  const startWidthRef = useRef(0)
  const startLeftRef = useRef(0) // For left resize, track the left position
  const cardRef = useRef(null) // Ref for the card element to get position

  // Refs for event handlers to avoid stale closures
  const handleMouseMoveRef = useRef(null)
  const handleMouseUpRef = useRef(null)
  const handleDragRef = useRef(null)

  // Stable wrappers for event listeners
  const resizeMouseMoveWrapper = useCallback((e) => {
    if (handleMouseMoveRef.current) handleMouseMoveRef.current(e)
  }, [])

  const resizeMouseUpWrapper = useCallback((e) => {
    if (handleMouseUpRef.current) handleMouseUpRef.current(e)
  }, [])

  const dragMoveWrapper = useCallback((e) => {
    if (handleDragRef.current) handleDragRef.current(e)
  }, [])

  // Use cardWidth for display
  const width = currentCardWidth

  const isDropTarget = dragOverIndex === index && draggedIndex !== index
  const isDraggedItem = draggedIndex === index

  // Calculate if this card should move to make space for the dropped card
  // Use insertionIndex for more accurate positioning
  const shouldMoveLeft = draggedIndex !== null && insertionIndex !== null &&
    index >= insertionIndex && index < draggedIndex
  const shouldMoveRight = draggedIndex !== null && insertionIndex !== null &&
    index < insertionIndex && index > draggedIndex

  const handleDragStart = (e) => {
    // Set drag data first - this is required for drag to work
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', index.toString())
    }

    // Mark as dragging
    isDraggingRef.current = true

    // Track initial mouse position
    const initialPos = { x: e.clientX, y: e.clientY }
    dragPositionRef.current = initialPos

    // Set initial React state (only once at start)
    setDragPosition(initialPos)

    // Initialize preview position immediately
    if (previewElementRef.current) {
      const el = previewElementRef.current
      el.style.transform = `translate3d(${e.clientX}px,${e.clientY}px,0) translate(-50%,-50%)`
    }

    // Call parent handler to update state (this sets draggedIndex)
    onDragStart(index)
  }

  // Zero-lag drag tracking - immediate synchronous updates, no batching
  useEffect(() => {
    if (draggedIndex !== index) {
      isDraggingRef.current = false
      return
    }

    isDraggingRef.current = true
    const previewEl = previewElementRef.current
    if (!previewEl) return

    handleDragRef.current = (e) => {
      if (!isDraggingRef.current || !previewEl) return

      const x = e.clientX
      const y = e.clientY

      previewEl.style.transform = `translate3d(${x}px,${y}px,0) translate(-50%,-50%)`

      dragPositionRef.current.x = x
      dragPositionRef.current.y = y
    }

    // Use stable wrapper
    document.addEventListener('dragover', dragMoveWrapper, { passive: true, capture: true })
    document.addEventListener('mousemove', dragMoveWrapper, { passive: true, capture: true })
    document.addEventListener('pointermove', dragMoveWrapper, { passive: true, capture: true })

    return () => {
      isDraggingRef.current = false
      document.removeEventListener('dragover', dragMoveWrapper, { capture: true })
      document.removeEventListener('mousemove', dragMoveWrapper, { capture: true })
      document.removeEventListener('pointermove', dragMoveWrapper, { capture: true })
    }
  }, [draggedIndex, index, dragMoveWrapper])

  const handleDragOver = (e) => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    if (onDragOver) {
      onDragOver(index, e)
    }
  }

  const handleDragEnter = (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (onDragOver) {
      onDragOver(index, e)
    }
  }

  const handleDrop = (e) => {
    e.preventDefault()
    e.stopPropagation()
    const draggedIndex = parseInt(e.dataTransfer.getData('text/plain'), 10)
    if (draggedIndex !== index) {
      onDrop(draggedIndex, index)
    }
    onDragEnd()
  }

  const handleDragEnd = () => {
    isDraggingRef.current = false
    dragPositionRef.current = { x: 0, y: 0 }
    setDragPosition({ x: 0, y: 0 })
    if (onDragEnd) onDragEnd()
  }

  // Resize handlers - support both left and right side resizing (mouse + touch)
  const handleResizeMouseMove = (e) => {
    if (!isResizingRef.current || !resizeSideRef.current) {
      return
    }

    // Extract clientX from either mouse or touch events
    const clientX = e.touches ? e.touches[0].clientX : e.clientX
    const deltaX = clientX - startXRef.current
    let newWidth
    const cardPaddingRight = 4 // Gap between cards
    // Minimum width corresponds to 0.1 seconds duration
    const defaultWidth = getCardDimensions().width
    const minWidth = minCardWidth || (0.1 / 5.0) * defaultWidth

    let leftOffset = 0
    let gapSize = 0

    if (resizeSideRef.current === 'right') {
      newWidth = Math.max(minWidth, startWidthRef.current + deltaX)
    } else {
      newWidth = startWidthRef.current - deltaX
      if (deltaX >= 0) {
        newWidth = Math.max(minWidth, newWidth)
        const widthDecrease = startWidthRef.current - newWidth
        const maxTransform = Math.min(widthDecrease, cardPaddingRight * 1.5)
        const actualWidthDecrease = Math.min(widthDecrease, startWidthRef.current - minWidth)
        newWidth = startWidthRef.current - actualWidthDecrease
        newWidth = Math.max(minWidth, newWidth)
        const finalTransform = Math.min(actualWidthDecrease, maxTransform)
        leftOffset = finalTransform
        gapSize = finalTransform
      }
    }

    if (onMotionStop) onMotionStop()
    const newDuration = calculateDurationFromWidth(newWidth)

    // Batch UI updates
    let nextTooltipPos = resizeState.tooltipPosition
    if (cardRef.current) {
      const rect = cardRef.current.getBoundingClientRect()
      nextTooltipPos = {
        top: rect.top - 36,
        right: window.innerWidth - rect.right,
      }
    }

    // Consolidated ATOMIC state update
    setResizeState(prev => {
      // Small optimization: only update if something actually changed
      const hasChanged =
        prev.duration !== newDuration ||
        prev.width !== newWidth ||
        prev.leftOffset !== leftOffset ||
        prev.gapSize !== gapSize ||
        prev.tooltipPosition.top !== nextTooltipPos.top ||
        prev.tooltipPosition.right !== nextTooltipPos.right

      if (!hasChanged) return prev
      return {
        ...prev,
        duration: newDuration,
        width: newWidth,
        tooltipPosition: nextTooltipPos,
        leftOffset,
        gapSize
      }
    })

    if (onCardWidthChange) {
      onCardWidthChange(index, newWidth, resizeSideRef.current)
    }
  }

  const handleResizeMouseUp = () => {
    const wasLeftResize = resizeSideRef.current === 'left'
    const currentGapSize = resizeState.gapSize
    const currentWidth = currentCardWidth
    const originalWidth = startWidthRef.current

    setResizeState(prev => ({
      ...prev,
      isResizing: false,
      side: null,
      duration: null,
      width: null
    }))

    isResizingRef.current = false
    resizeSideRef.current = null

    // If there's a gap (from shrinking from left), we just clear the visual offset
    setResizeState(prev => ({
      ...prev,
      leftOffset: 0,
      gapSize: 0
    }))

    // Final sync for absolute precision (bypasses throttle)
    if (onCardWidthChange) {
      onCardWidthChange(index, currentWidth, wasLeftResize ? 'left' : 'right', true)
    }

    document.removeEventListener('mousemove', resizeMouseMoveWrapper)
    document.removeEventListener('mouseup', resizeMouseUpWrapper)
    document.removeEventListener('touchmove', resizeMouseMoveWrapper)
    document.removeEventListener('touchend', resizeMouseUpWrapper)

    if (onResizeEnd) onResizeEnd()
  }

  // Update refs on each render to avoid stale closures
  useEffect(() => {
    handleMouseMoveRef.current = handleResizeMouseMove
    handleMouseUpRef.current = handleResizeMouseUp
    isResizingRef.current = resizeState.isResizing
    resizeSideRef.current = resizeState.side
  })

  useEffect(() => {
    return () => {
      document.removeEventListener('mousemove', resizeMouseMoveWrapper)
      document.removeEventListener('mouseup', resizeMouseUpWrapper)
      document.removeEventListener('touchmove', resizeMouseMoveWrapper)
      document.removeEventListener('touchend', resizeMouseUpWrapper)
      document.removeEventListener('dragover', dragMoveWrapper, { capture: true })
      document.removeEventListener('mousemove', dragMoveWrapper, { capture: true })
      document.removeEventListener('pointermove', dragMoveWrapper, { capture: true })
    }
  }, [resizeMouseMoveWrapper, resizeMouseUpWrapper, dragMoveWrapper])

  const handleResizeMouseDown = (e, side) => {
    e.stopPropagation()
    e.preventDefault()

    const startX = e.clientX
    const startWidth = currentCardWidth

    if (side === 'left' && e.currentTarget.offsetParent) {
      startLeftRef.current = e.currentTarget.offsetParent.offsetLeft || 0
    }

    isResizingRef.current = true
    resizeSideRef.current = side
    startXRef.current = startX
    startWidthRef.current = startWidth

    const initialDuration = calculateDurationFromWidth(startWidth)
    const initialWidth = calculateWidthFromDuration(initialDuration)

    let initialTooltipPos = { top: 0, right: 0 }
    if (cardRef.current) {
      const rect = cardRef.current.getBoundingClientRect()
      initialTooltipPos = {
        top: rect.top - 36,
        right: window.innerWidth - rect.right,
      }
    }

    setResizeState({
      isResizing: true,
      side,
      duration: initialDuration,
      width: initialWidth, // Track width locally for zero-lag UI
      leftOffset: 0,
      gapSize: 0,
      tooltipPosition: initialTooltipPos
    })

    document.addEventListener('mousemove', resizeMouseMoveWrapper, { passive: false })
    document.addEventListener('mouseup', resizeMouseUpWrapper, { passive: false })
    document.addEventListener('touchmove', resizeMouseMoveWrapper, { passive: false })
    document.addEventListener('touchend', resizeMouseUpWrapper, { passive: false })

    if (onResizeStart) onResizeStart()
  }

  const handleCardClickWithResize = (e) => {
    if (e.target.classList.contains('resize-handle') || resizeState.isResizing) {
      return
    }
    if (e.target.closest('.resize-handle')) {
      return
    }
    if (onClick) {
      onClick()
    }
  }

  // Ensure width never goes below minimum (0.1 seconds)
  // Calculate fallback: width for 0.1s = (0.1/5) * defaultWidth
  const minWidthFallback = minCardWidth || (0.1 / 5.0) * defaultWidth

  // PERFORMANCE FIX: Use local width during interaction for 1:1 mouse tracking speed
  const interactionWidth = resizeState.isResizing && resizeState.width !== undefined ? resizeState.width : currentCardWidth
  const actualWidth = Math.max(interactionWidth, minWidthFallback)

  return (
    <div
      ref={cardRef}
      className="relative flex-shrink-0"
      onContextMenu={onContextMenu}
      style={{
        width: `${actualWidth}px`,
        minWidth: `${minWidthFallback}px`,
        overflow: 'visible',
        transition: resizeState.isResizing ? 'none' : 'width 0.1s ease-out, transform 0.2s ease-out',
        marginRight: '4px',
        transform: resizeState.leftOffset !== 0 ? `translateX(${resizeState.leftOffset}px)` : 'none',
        boxSizing: 'border-box',
      }}
    >
      {/* Ghost placeholder at original position when dragging */}
      {isDraggedItem && draggedIndex !== null && (
        <div
          className="absolute z-10 pointer-events-none"
          style={{
            left: '0',
            top: '0',
            width: `${width}px`,
            height: `${height}px`,
            backgroundColor: 'rgba(255,255,255,0.06)',
            borderRadius: '6px',
            border: '1px dashed rgba(255,255,255,0.15)',
            opacity: 1,
          }}
        />
      )}

      {/* Floating drag preview */}
      {isDraggedItem && draggedIndex !== null && typeof document !== 'undefined' && (
        createPortal(
          <div
            ref={previewElementRef}
            className="fixed pointer-events-none z-[9999]"
            style={{
              left: '0',
              top: '0',
              transform: `translate3d(${dragPosition.x}px,${dragPosition.y}px,0) translate(-50%,-50%)`,
              width: `${width}px`,
              height: `${height}px`,
              willChange: 'transform',
              transition: 'none',
              backfaceVisibility: 'hidden',
              contain: 'strict',
              isolation: 'isolate',
              transformOrigin: 'center center',
              pointerEvents: 'none',
              userSelect: 'none',
              WebkitUserSelect: 'none',
            }}
          >
            <div
              className="rounded-md overflow-hidden"
              style={{
                width: '100%',
                height: `${height}px`,
                border: '2px solid rgba(139,92,246,0.7)',
                boxShadow: '0 20px 40px -8px rgba(0,0,0,0.5), 0 0 20px rgba(139,92,246,0.3)',
                willChange: 'transform',
                transform: 'translateZ(0) scale(1.04)',
                backfaceVisibility: 'hidden',
              }}
            >
              <ScenePreview
                layers={layers}
                cardWidth={width}
                cardHeight={height}
                backgroundColor={scene.backgroundColor}
              />
            </div>
          </div>,
          document.body
        )
      )}

      <div
        ref={cardElementRef}
        className="relative group flex-shrink-0"
        style={{
          opacity: isDraggedItem ? 0 : 1,
          transition: isDraggedItem ? 'none' : 'opacity 0.15s ease-out, transform 0.15s cubic-bezier(0.4, 0, 0.2, 1)',
          transform: shouldMoveLeft ? 'translateX(-8px)' : shouldMoveRight ? 'translateX(8px)' : 'translateX(0)',
          overflow: 'visible',
          pointerEvents: 'auto',
        }}
        draggable={!resizeState.isResizing}
        onDragStart={(e) => {
          if (e.target.classList.contains('resize-handle') || e.target.closest('.resize-handle')) {
            e.preventDefault()
            e.stopPropagation()
            return false
          }
          if (resizeState.isResizing) {
            e.preventDefault()
            return false
          }
          if (handleDragStart) {
            handleDragStart(e)
          }
        }}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDrop={handleDrop}
      >
        <div
          onClick={handleCardClickWithResize}
          onContextMenu={onContextMenu}
          onMouseDown={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            const clickX = e.clientX - rect.left
            const cardWidth = rect.width

            if (clickX < 12 || clickX > cardWidth - 12) {
              e.stopPropagation()
            }
          }}
          onTouchStart={(e) => {
            const touch = e.touches[0]
            const startX = touch.clientX
            const startY = touch.clientY
            let hasMoved = false
            let isDragStarted = false

            // Long press timer for context menu
            const contextTimer = setTimeout(() => {
              if (!hasMoved) {
                onContextMenu({
                  preventDefault: () => { },
                  stopPropagation: () => { },
                  clientX: touch.clientX,
                  clientY: touch.clientY
                })
              }
            }, 600)

            // Drag initiation timer - shorter than context menu
            const dragTimer = setTimeout(() => {
              if (!hasMoved) {
                isDragStarted = true
                clearTimeout(contextTimer)
                onDragStart(index)
              }
            }, 250)

            const onTouchMove = (moveE) => {
              const dx = moveE.touches[0].clientX - startX
              const dy = moveE.touches[0].clientY - startY
              if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
                hasMoved = true
                clearTimeout(contextTimer)
                if (!isDragStarted) {
                  clearTimeout(dragTimer)
                }
              }
            }

            const onTouchEnd = () => {
              clearTimeout(contextTimer)
              clearTimeout(dragTimer)
              e.currentTarget.removeEventListener('touchmove', onTouchMove)
              e.currentTarget.removeEventListener('touchend', onTouchEnd)
            }

            e.currentTarget.addEventListener('touchmove', onTouchMove, { passive: true })
            e.currentTarget.addEventListener('touchend', onTouchEnd, { once: true })
          }}
          className="rounded-md touch-manipulation flex-shrink-0 relative"
          style={{
            width: '100%',
            height: `${height}px`,
            pointerEvents: 'auto',
            overflow: resizeState.isResizing ? 'visible' : 'hidden',
            cursor: isDraggingRef.current ? 'grabbing' : 'grab',
            border: isActive ? '2px solid rgba(139,92,246,0.8)' : '1px solid rgba(255,255,255,0.08)',
            borderRadius: '6px',
            boxShadow: isActive
              ? '0 0 0 1px rgba(139,92,246,0.2), 0 2px 8px rgba(0,0,0,0.3)'
              : '0 1px 4px rgba(0,0,0,0.2)',
            transition: resizeState.isResizing ? 'none' : 'border-color 0.2s, box-shadow 0.2s',
          }}
        >
          <ScenePreview
            layers={layers}
            cardWidth={width}
            cardHeight={height}
            backgroundColor={scene.backgroundColor}
          />
        </div>
        {/* Duration label */}
        <div
          className="absolute z-10 pointer-events-none"
          style={{
            bottom: '2px',
            left: '4px',
            fontSize: '8px',
            fontWeight: 500,
            color: '#000000',
            fontFamily: 'Inter, system-ui, sans-serif',
            letterSpacing: '0.02em',
          }}
        >
          {formatDuration(scene.duration || 0)}
        </div>
        {/* Motion indicator */}
        {hasMotionSteps && (
          <div
            className="absolute z-10 pointer-events-none"
            style={{ bottom: '2px', right: '4px' }}
            title={`${motionStepCount} animation step${motionStepCount !== 1 ? 's' : ''}`}
          >
            <Zap className="h-2.5 w-2.5 sm:h-3 sm:w-3 text-purple-400 fill-purple-400 opacity-80" />
          </div>
        )}
        {/* Motion Step Blocks */}
        <MotionStepsBar
          steps={motionFlow?.steps || []}
          activeStepId={isActive ? activeStepId : null}
          onStepClick={onStepClick}
          onStepContextMenu={onStepContextMenu}
          isMotionCaptureActive={isMotionCaptureActive}
          cardWidth={width}
          pageDuration={scene.duration ? scene.duration * 1000 : 5000}
          sceneId={scene.id}
        />
      </div>

      {/* Left resize handle */}
      <div
        className="resize-handle absolute left-0 top-0 bottom-0 cursor-ew-resize z-50 select-none"
        onMouseDown={(e) => {
          e.stopPropagation()
          e.preventDefault()
          e.nativeEvent.stopImmediatePropagation()
          handleResizeMouseDown(e, 'left')
        }}
        onTouchStart={(e) => {
          e.stopPropagation()
          const touch = e.touches[0]
          handleResizeMouseDown({
            clientX: touch.clientX,
            clientY: touch.clientY,
            currentTarget: e.currentTarget,
            stopPropagation: () => {},
            preventDefault: () => {},
            nativeEvent: { stopImmediatePropagation: () => {} }
          }, 'left')
        }}
        onDragStart={(e) => {
          e.preventDefault()
          e.stopPropagation()
        }}
        draggable={false}
        style={{
          cursor: 'ew-resize',
          touchAction: 'none',
          width: isTouchDevice() ? '16px' : '10px',
          left: isTouchDevice() ? '-4px' : '-2px',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          MozUserSelect: 'none',
          msUserSelect: 'none',
          pointerEvents: 'auto',
          zIndex: 50,
        }}
        title="Drag to resize"
      >
        <div
          style={{
            position: 'absolute',
            left: '2px',
            top: '50%',
            transform: 'translateY(-50%)',
            width: '3px',
            height: '16px',
            borderRadius: '2px',
            backgroundColor: resizeState.isResizing && resizeState.side === 'left'
              ? 'rgba(139,92,246,0.8)' : 'transparent',
            transition: 'background-color 0.15s',
            pointerEvents: 'none',
          }}
          className="group-hover:!bg-purple-400/50"
        />
      </div>

      {/* Right resize handle */}
      <div
        className="resize-handle absolute right-0 top-0 bottom-0 cursor-ew-resize z-50 select-none"
        onMouseDown={(e) => {
          e.stopPropagation()
          e.preventDefault()
          e.nativeEvent.stopImmediatePropagation()
          handleResizeMouseDown(e, 'right')
        }}
        onTouchStart={(e) => {
          e.stopPropagation()
          const touch = e.touches[0]
          handleResizeMouseDown({
            clientX: touch.clientX,
            clientY: touch.clientY,
            currentTarget: e.currentTarget,
            stopPropagation: () => {},
            preventDefault: () => {},
            nativeEvent: { stopImmediatePropagation: () => {} }
          }, 'right')
        }}
        onDragStart={(e) => {
          e.preventDefault()
          e.stopPropagation()
        }}
        draggable={false}
        style={{
          cursor: 'ew-resize',
          touchAction: 'none',
          width: isTouchDevice() ? '16px' : '10px',
          right: isTouchDevice() ? '-4px' : '-2px',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          MozUserSelect: 'none',
          msUserSelect: 'none',
          pointerEvents: 'auto',
          zIndex: 50,
        }}
        title="Drag to resize"
      >
        <div
          style={{
            position: 'absolute',
            right: '2px',
            top: '50%',
            transform: 'translateY(-50%)',
            width: '3px',
            height: '16px',
            borderRadius: '2px',
            backgroundColor: resizeState.isResizing && resizeState.side === 'right'
              ? 'rgba(139,92,246,0.8)' : 'transparent',
            transition: 'background-color 0.15s',
            pointerEvents: 'none',
          }}
          className="group-hover:!bg-purple-400/50"
        />
      </div>

      {/* Duration tooltip */}
      {
        resizeState.isResizing && resizeState.duration !== null && typeof document !== 'undefined'
          ? createPortal(
            <div
              className="fixed pointer-events-none"
              style={{
                top: `${resizeState.tooltipPosition.top}px`,
                right: `${resizeState.tooltipPosition.right}px`,
                transform: 'translateX(50%)',
                zIndex: 9999,
              }}
            >
              <div
                className="text-white px-2 py-1 rounded shadow-lg text-[10px] font-semibold whitespace-nowrap"
                style={{
                  backgroundColor: 'rgba(15,16,21,0.95)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  fontFamily: 'Inter, system-ui, sans-serif',
                }}
              >
                {formatDuration(resizeState.duration)}
              </div>
              <div
                className="absolute left-1/2 top-full transform -translate-x-1/2"
                style={{
                  width: '0',
                  height: '0',
                  borderLeft: '4px solid transparent',
                  borderRight: '4px solid transparent',
                  borderTop: '4px solid rgba(15,16,21,0.95)',
                }}
              />
            </div>,
            document.body
          )
          : null
      }
    </div >
  )
})

const ScenesBar = React.memo(({
  currentTime = 0,
  totalTime = 12,
  worldWidth = 1920,
  worldHeight = 1080,
  onSeek,
  onMotionStop,
  currentTimeStepId = null,
  isMotionCaptureActive,
  onStepClick,
  onStepEdit, // Explicit edit action (context menu "Update Step")
  bottomSectionHeight = null, // Dynamic height from EditorPage
  onPlay, // Optional: to resume playback after split
  onPause // Optional: to pause during split
}) => {
  const dispatch = useDispatch()
  const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0, sceneId: null })
  const [stepContextMenu, setStepContextMenu] = useState({ visible: false, x: 0, y: 0, sceneId: null, stepId: null })
  const scenes = useSelector(selectScenes)
  const currentSceneId = useSelector(selectCurrentSceneId)
  const timelineInfo = useSelector(selectProjectTimelineInfo)
  const allLayers = useSelector(state => state.project.layers)
  const sceneMotionFlows = useSelector(selectSceneMotionFlows)

  // [PERFORMANCE] Debounce layers update to prevent live re-renders of all scene cards
  // during active transforms on the canvas. Previews will catch up after 500ms of inactivity.
  const debouncedLayers = useDebounce(allLayers, 500)

  const [draggedIndex, setDraggedIndex] = useState(null)
  const [dragOverIndex, setDragOverIndex] = useState(null)
  const [insertionIndex, setInsertionIndex] = useState(null) // More precise: where to insert
  const [isDraggingPlayhead, setIsDraggingPlayhead] = useState(false)
  const [isHoveringPlayhead, setIsHoveringPlayhead] = useState(false)
  const [playheadTooltipTime, setPlayheadTooltipTime] = useState(null)
  const [playheadTooltipPosition, setPlayheadTooltipPosition] = useState({ top: 0, left: 0 })
  const timelineRef = useRef(null)
  const cardsContainerRef = useRef(null)
  const playheadElementRef = useRef(null) // Ref for direct DOM manipulation

  // Track card widths - initialize with default widths
  const getDefaultCardWidth = useCallback(() => {
    if (typeof window === 'undefined') return 120
    if (window.innerWidth >= 1024) return 120
    if (window.innerWidth >= 640) return 110
    return 100
  }, [])

  // Calculate duration from width (default width = 5 seconds)
  const calculateDurationFromWidth = useCallback((width) => {
    const defaultWidth = getDefaultCardWidth()
    const defaultDuration = 5.0 // 5 seconds for default width
    return (width / defaultWidth) * defaultDuration
  }, [getDefaultCardWidth])

  // Calculate width from duration (default width = 5 seconds)
  const calculateWidthFromDuration = useCallback((duration) => {
    const defaultWidth = getDefaultCardWidth()
    const defaultDuration = 5.0 // 5 seconds for default width
    return (duration / defaultDuration) * defaultWidth
  }, [getDefaultCardWidth])

  const getDefaultCardHeight = useCallback(() => {
    if (typeof window === 'undefined') return 44
    if (window.innerWidth >= 1024) return 44
    if (window.innerWidth >= 640) return 40
    return 36
  }, [])

  // Utility Formatters
  const formatTimeLabel = useCallback((seconds) => {
    if (seconds === 0) return '0'
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    if (mins === 0) {
      return `0:${secs.toString().padStart(2, '0')}`
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }, [])

  const formatDuration = useCallback((seconds) => {
    return `${seconds.toFixed(2)}s`
  }, [])

  const formatTime = useCallback((seconds) => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }, [])

  // Get minimum width based on 0.1 seconds minimum duration
  const getMinCardWidth = useCallback(() => {
    return calculateWidthFromDuration(0.1)
  }, [calculateWidthFromDuration])

  // Track scene IDs to preserve widths across reordering/deletion
  const [sceneIdToWidth, setSceneIdToWidth] = useState(() => {
    const mapping = {}
    scenes.forEach((scene) => {
      mapping[scene.id] = calculateWidthFromDuration(scene.duration || 5.0)
    })
    return mapping
  })

  // Track last dispatched duration to avoid Redux updates
  const lastDispatchedDurationRef = useRef({})

  // Track which scene is currently being resized to skip Redux -> local sync for it
  const resizingSceneIdRef = useRef(null)

  const handleContextMenu = useCallback((e, sceneId) => {
    e.preventDefault()
    e.stopPropagation()
    // Explicitly close the other menu type to ensure exclusivity
    setStepContextMenu(prev => ({ ...prev, visible: false }))

    // Position menu at top-right of cursor
    setContextMenu({
      visible: true,
      x: e.clientX + 5,
      y: e.clientY - 120, // Adjusted offset for taller menu
      sceneId
    })
  }, [])

  const handleStepContextMenu = useCallback((e, sceneId, stepId) => {
    e.preventDefault()
    e.stopPropagation()
    // Explicitly close the other menu type to ensure exclusivity
    setContextMenu(prev => ({ ...prev, visible: false }))

    // Position menu at top-right of cursor
    setStepContextMenu({
      visible: true,
      x: e.clientX + 5,
      y: e.clientY - 120,
      sceneId,
      stepId
    })
  }, [])

  const handleCutPage = useCallback(() => {
    if (!contextMenu.sceneId) return

    const sceneInfo = timelineInfo.find(s => s.id === contextMenu.sceneId)
    if (!sceneInfo) return

    // Calculate time relative to the scene being cut
    const timeInScene = currentTime - sceneInfo.startTime

    // [FIX] Frame Snapping: Align split to 60fps boundary
    // This ensures that video offsets and scene durations are perfectly frame-aligned.
    const snappedSplitTime = Math.round(timeInScene * 60) / 60
    const snappedPlayheadTime = sceneInfo.startTime + snappedSplitTime

    // Safety: Only split if within bounds
    if (timeInScene <= 0.1 || timeInScene >= sceneInfo.endTime - sceneInfo.startTime - 0.1) {
      alert("Move playhead inside the page to split it.")
      setContextMenu(prev => ({ ...prev, visible: false }))
      return
    }

    if (onPause) onPause()

    dispatch(splitScene({
      sceneId: contextMenu.sceneId,
      splitTime: snappedSplitTime
    }))

    // [FIX] Auto-seek 0.001s past split point (using snapped time)
    // This ensures we land on the first frame of the new scene
    if (onSeek) onSeek(snappedPlayheadTime + 0.001)

    setContextMenu(prev => ({ ...prev, visible: false }))
  }, [contextMenu, currentTime, timelineInfo, dispatch, onPause, onSeek])

  useEffect(() => {
    const handleClick = () => {
      setContextMenu(prev => ({ ...prev, visible: false }))
      setStepContextMenu(prev => ({ ...prev, visible: false }))
    }
    if (contextMenu.visible || stepContextMenu.visible) {
      window.addEventListener('click', handleClick)
    }
    return () => window.removeEventListener('click', handleClick)
  }, [contextMenu.visible, stepContextMenu.visible])

  // Update scene ID to width mapping when scenes change
  useEffect(() => {
    setSceneIdToWidth(prev => {
      const newMapping = { ...prev }
      let changed = false

      // Add/Update mappings for scenes
      scenes.forEach(scene => {
        // SKIP if this scene is currently being resized by the user
        // (we prioritize local interaction state over store state during resize)
        if (resizingSceneIdRef.current === scene.id) return

        const expectedWidth = calculateWidthFromDuration(scene.duration || 5.0)
        // Only update if the width is meaningfully different (> 0.5px)
        // to prevent rounding noise loops
        if (newMapping[scene.id] === undefined || Math.abs(newMapping[scene.id] - expectedWidth) > 0.5) {
          newMapping[scene.id] = expectedWidth
          changed = true
        }
      })

      // Remove mappings for deleted scenes
      const sceneIds = new Set(scenes.map(s => s.id))
      Object.keys(newMapping).forEach(sceneId => {
        if (!sceneIds.has(sceneId)) {
          delete newMapping[sceneId]
          changed = true
        }
      })

      return changed ? newMapping : prev
    })
  }, [scenes, calculateWidthFromDuration])

  // Consolidated source of truth for card widths
  const cardWidths = useMemo(() => {
    const defaultWidth = getDefaultCardWidth()
    const widths = {}
    scenes.forEach((scene, index) => {
      widths[index] = sceneIdToWidth[scene.id] || calculateWidthFromDuration(scene.duration || 5.0)
    })
    return widths
  }, [scenes, sceneIdToWidth, calculateWidthFromDuration, getDefaultCardWidth])

  // Throttle Redux updates during interaction
  const lastDispatchTimeRef = useRef(0)
  const lastLocalUpdateTimeRef = useRef(0)
  const THROTTLE_MS = 100 // 10 Redux updates per second max during resize
  const LOCAL_THROTTLE_MS = 32 // ~30fps for parent layout during resize


  // Handle card width change - update the card and calculate duration
  const handleCardWidthChange = useCallback((index, newWidth, side = 'right', isFinal = false) => {
    const minWidth = getMinCardWidth()
    const clampedWidth = Math.max(newWidth, minWidth)

    const scene = scenes[index]
    if (!scene) return

    // Update local state for visual responsiveness (throttled for parent layout)
    const nowLocal = Date.now()
    const shouldUpdateLocal = isFinal || (nowLocal - lastLocalUpdateTimeRef.current >= LOCAL_THROTTLE_MS)

    if (shouldUpdateLocal) {
      setSceneIdToWidth(prev => {
        if (prev[scene.id] === clampedWidth) return prev
        return { ...prev, [scene.id]: clampedWidth }
      })
      lastLocalUpdateTimeRef.current = nowLocal
    }

    // Throttle Redux dispatch to avoid overwhelming the store
    const now = Date.now()
    const timeSinceLastDispatch = now - lastDispatchTimeRef.current

    // Calculate new duration
    const newDuration = calculateDurationFromWidth(clampedWidth)
    const roundedDuration = Math.round(newDuration * 10) / 10

    const lastDispatched = lastDispatchedDurationRef.current[scene.id] || scene.duration
    const durationDelta = Math.abs(lastDispatched - roundedDuration)

    // Dispatch if:
    // 1. Duration changed enough (>= 0.1s) AND enough time passed (100ms)
    // 2. OR it's the final update
    // 3. OR if it's been a while since last update and there's ANY change
    if (isFinal || (durationDelta >= 0.1 && timeSinceLastDispatch >= THROTTLE_MS) || durationDelta >= 1.0) {
      lastDispatchTimeRef.current = now
      lastDispatchedDurationRef.current[scene.id] = roundedDuration

      let trimStartDelta = 0
      if (side === 'left') {
        const oldWidth = calculateWidthFromDuration(scene.duration)
        const widthDelta = oldWidth - clampedWidth
        trimStartDelta = calculateDurationFromWidth(widthDelta)
      }

      dispatch(updateScene({
        id: scene.id,
        duration: roundedDuration,
        trimStartDelta
      }))
    }
  }, [scenes, dispatch, getMinCardWidth, calculateDurationFromWidth, calculateWidthFromDuration])

  const handleResizeStart = useCallback((index) => {
    const scene = scenes[index]
    if (scene) {
      resizingSceneIdRef.current = scene.id
    }
  }, [scenes])

  const handleResizeEnd = useCallback(() => {
    resizingSceneIdRef.current = null
    // Trigger a final sync to ensure exact values
    if (onMotionStop) onMotionStop()
  }, [onMotionStop])

  // Calculate offsets for fast lookups
  const cumulativeOffsets = useMemo(() => {
    const offsets = []
    let accumulatedTime = 0
    let accumulatedWidth = 0
    const cardPaddingRight = 4

    scenes.forEach((scene, i) => {
      const duration = scene.duration || 5.0
      const width = cardWidths[i] || getDefaultCardWidth()

      offsets.push({
        startTime: accumulatedTime,
        startWidth: accumulatedWidth,
        duration,
        width
      })

      accumulatedTime += duration
      accumulatedWidth += width + (i < scenes.length - 1 ? cardPaddingRight : 0)
    })

    return {
      scenes: offsets,
      totalTime: accumulatedTime,
      totalWidth: accumulatedWidth
    }
  }, [scenes, cardWidths, getDefaultCardWidth])

  const totalCardsWidth = cumulativeOffsets.totalWidth

  // Calculate playhead position based on actual card widths and current time
  const calculatePlayheadPosition = (time) => {
    const { scenes: sceneOffsets, totalTime: tTime, totalWidth: tWidth } = cumulativeOffsets
    if (tTime <= 0 || sceneOffsets.length === 0) return 0

    const clampedTime = Math.max(0, Math.min(time, tTime))

    // Find the scene containing this time
    const sceneIndex = sceneOffsets.findIndex(s => clampedTime <= s.startTime + s.duration)
    const targetScene = sceneIndex !== -1 ? sceneOffsets[sceneIndex] : sceneOffsets[sceneOffsets.length - 1]

    if (!targetScene) return 0

    const timeInScene = clampedTime - targetScene.startTime
    const progressInScene = targetScene.duration > 0 ? timeInScene / targetScene.duration : 0
    return targetScene.startWidth + (targetScene.width * progressInScene)
  }

  const playheadPositionPx = useMemo(() => {
    return calculatePlayheadPosition(currentTime)
  }, [currentTime, cumulativeOffsets])

  // Clamp playhead position to never exceed the end of the last card
  const playheadPosition = useMemo(() => {
    return Math.min(playheadPositionPx, totalCardsWidth)
  }, [playheadPositionPx, totalCardsWidth])

  // Calculate pixel position for a given time
  const calculateTimePosition = useCallback((time) => {
    return calculatePlayheadPosition(time)
  }, [cumulativeOffsets])

  // Grouped Memoized Markers for performance
  const markersData = useMemo(() => {
    const major = []
    const minor = []
    const maxMarkersTime = Math.max(Math.ceil(totalTime / 5) * 5, 5)

    for (let i = 0; i <= maxMarkersTime; i += 5) {
      if (i > totalTime) break

      const pos = calculateTimePosition(i)
      major.push({
        time: i,
        position: pos,
        label: formatTimeLabel(i)
      })

      // Add minor markers for this major interval
      if (i < totalTime) {
        for (let j = 1; j <= 4; j++) {
          const mTime = i + j
          if (mTime >= totalTime) break
          minor.push({
            time: mTime,
            position: calculateTimePosition(mTime)
          })
        }
      }
    }
    return { major, minor }
  }, [totalTime, calculateTimePosition, formatTimeLabel])

  const majorMarkers = markersData.major
  const minorMarkers = markersData.minor

  // Sync playhead position when dragging (for smooth dragging)
  useEffect(() => {
    if (isDraggingPlayhead && playheadElementRef.current) {
      // During drag, update position directly for instant feedback
      const newLeft = `${16 + playheadPosition}px`
      playheadElementRef.current.style.left = newLeft
    }
  }, [playheadPosition, isDraggingPlayhead])


  const handleTimelineClick = (e) => {
    if (!timelineRef.current || !onSeek || isDraggingPlayhead) return

    const rect = timelineRef.current.getBoundingClientRect()
    const padding = 16 // 16px padding on each side
    const clickX = e.clientX - rect.left - padding
    const availableWidth = rect.width - (padding * 2)
    const percentage = Math.max(0, Math.min(1, clickX / availableWidth))
    const seekTime = percentage * totalTime
    onSeek(seekTime)
  }

  const handlePlayheadMouseDown = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDraggingPlayhead(true)
  }

  // Add global mouse event listeners for dragging
  useEffect(() => {
    if (!isDraggingPlayhead) return

    const handleMouseMove = (e) => {
      if (!cardsContainerRef.current || !onSeek) return

      // Calculate position based on actual card container, not timeline ruler
      const containerRect = cardsContainerRef.current.getBoundingClientRect()
      const mouseX = e.clientX - containerRect.left

      // Clamp to container bounds
      const clampedX = Math.max(0, Math.min(mouseX, totalCardsWidth))

      // Convert pixel position to time using cumulative offsets (no loop)
      const { scenes: sceneOffsets, totalTime: tTime } = cumulativeOffsets
      let seekTime = 0

      // Find which scene the mouse is over
      const sceneIndex = sceneOffsets.findIndex(s => clampedX <= s.startWidth + s.width)
      const targetScene = sceneIndex !== -1 ? sceneOffsets[sceneIndex] : sceneOffsets[sceneOffsets.length - 1]

      if (targetScene) {
        const positionInCard = Math.max(0, clampedX - targetScene.startWidth)
        const progressInCard = Math.min(1, positionInCard / targetScene.width)
        seekTime = targetScene.startTime + (progressInCard * targetScene.duration)
      } else {
        seekTime = tTime
      }

      // Update playhead position directly for instant feedback
      if (playheadElementRef.current) {
        playheadElementRef.current.style.left = `${16 + clampedX}px`
      }

      // Update tooltip time and position
      setPlayheadTooltipTime(seekTime)
      if (timelineRef.current) {
        const timelineRect = timelineRef.current.getBoundingClientRect()
        // Position tooltip above the caret tip (caret is -1.5rem = -6px, plus caret height ~10px = -16px from top)
        setPlayheadTooltipPosition({
          top: timelineRect.top - 16 - 28, // 16px for caret tip, 28px for tooltip height + spacing
          left: timelineRect.left + 16 + clampedX, // 16px padding + playhead position
        })
      }

      // Update time state
      onSeek(seekTime)
    }

    const handleMouseUp = () => {
      setIsDraggingPlayhead(false)
      setPlayheadTooltipTime(null)
    }

    // Prevent text selection while dragging
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'grabbing'

    document.addEventListener('mousemove', handleMouseMove, { passive: false })
    document.addEventListener('mouseup', handleMouseUp)
    document.addEventListener('touchmove', (e) => handleMouseMove({ clientX: e.touches[0].clientX }), { passive: false })
    document.addEventListener('touchend', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.removeEventListener('touchmove', handleMouseMove)
      document.removeEventListener('touchend', handleMouseUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
  }, [isDraggingPlayhead, totalTime, totalCardsWidth, onSeek, scenes, cardWidths])

  const handleAddScene = () => {
    const newSceneId = uid()
    dispatch(addScene({
      id: newSceneId,
      name: `Scene ${scenes.length + 1}`,
      duration: 5.0, // Default duration is 5 seconds
      transition: 'None',
      width: worldWidth,
      height: worldHeight,
    }))

    // Auto-switch to the new scene (behavior similar to handleSwitchScene)
    // This triggers the scene switch effect in EditorPage that cancels motion capture
    if (onMotionStop) onMotionStop()
    dispatch(clearLayerSelection())
    dispatch(setCurrentScene(newSceneId))
  }

  const handleSwitchScene = (sceneId) => {
    // Stop playback if switching scenes manually
    if (onMotionStop) onMotionStop()

    // Clear layer selection when switching scenes to prevent selection box flash
    dispatch(clearLayerSelection())
    dispatch(setCurrentScene(sceneId))

    // Automatically seek the playhead to the global start time of the selected scene
    // This ensures that the engine and UI are perfectly synced to the new scene
    if (timelineInfo && onSeek) {
      const sceneInfo = timelineInfo.find(s => s.id === sceneId)
      if (sceneInfo) {
        console.log(`🎯 [ScenesBar] Manually switching to scene: ${sceneId}, startTime: ${sceneInfo.startTime}s. TimelineInfo length: ${timelineInfo.length}`)
        onSeek(sceneInfo.startTime)
      } else {
        console.error(`❌ [ScenesBar] FAILED to find sceneInfo for sceneId: ${sceneId}. Available IDs:`, timelineInfo.map(s => s.id))
      }
    }
  }

  // Get layers for each scene
  const getSceneLayers = (sceneId) => {
    const scene = scenes.find(s => s.id === sceneId)
    if (!scene) return []
    // Use debounced layers for the preview content
    return scene.layers.map(layerId => debouncedLayers[layerId]).filter(Boolean)
  }

  // Simplified and robust insertion index calculation
  // Uses the center of the dragged card (mouse position) to determine drop position
  // Much larger drop zones for first/last positions to make them easy to target
  const calculateInsertionIndex = (clientX) => {
    if (!cardsContainerRef.current || draggedIndex === null) {
      return null
    }

    const container = cardsContainerRef.current
    const containerRect = container.getBoundingClientRect()
    const cardCenterX = clientX - containerRect.left

    const gap = 4
    const firstLastDropZone = 200 // Large drop zone for first/last positions

    // Build positions array excluding dragged card
    const positions = []
    let currentX = 0

    for (let i = 0; i < scenes.length; i++) {
      if (i === draggedIndex) continue

      const cardWidth = cardWidths[i] || getDefaultCardWidth()
      positions.push({
        originalIndex: i,
        leftEdge: currentX,
        rightEdge: currentX + cardWidth,
        center: currentX + (cardWidth / 2)
      })

      currentX += cardWidth + gap
    }

    if (positions.length === 0) {
      return 0
    }

    const firstPos = positions[0]
    const lastPos = positions[positions.length - 1]
    const tolerance = 2

    // FIRST: Check middle positions (cards and gaps between them)
    // This must happen BEFORE first/last checks to avoid false positives
    for (let i = 0; i < positions.length; i++) {
      const pos = positions[i]
      const nextPos = positions[i + 1]

      // Check if center is in gap between cards (with tolerance)
      if (nextPos) {
        const gapStart = pos.rightEdge - tolerance
        const gapEnd = nextPos.leftEdge + tolerance

        if (cardCenterX >= gapStart && cardCenterX < gapEnd) {
          // In gap - use gap center to decide
          const gapCenter = pos.rightEdge + (gap / 2)
          if (cardCenterX < gapCenter) {
            // Insert before next card
            return draggedIndex < nextPos.originalIndex ? nextPos.originalIndex - 1 : nextPos.originalIndex
          } else {
            // Insert after current card
            return draggedIndex < pos.originalIndex ? pos.originalIndex : pos.originalIndex + 1
          }
        }
      }

      // Check if center is over a card (with tolerance)
      const cardStart = pos.leftEdge - tolerance
      const cardEnd = pos.rightEdge + tolerance

      if (cardCenterX >= cardStart && cardCenterX < cardEnd) {
        // Use card center as threshold
        if (cardCenterX < pos.center) {
          // Insert before this card
          return draggedIndex < pos.originalIndex ? pos.originalIndex - 1 : pos.originalIndex
        } else {
          // Insert after this card
          if (draggedIndex < pos.originalIndex) {
            // Dragging from left: after removal, this card moves left by 1, insert after it
            return pos.originalIndex
          } else {
            // Dragging from right: this card's index doesn't change
            // After removal, we want to insert after this card
            // If this is the last card in positions array, we want to insert at the end
            // Otherwise, insert at the next position
            if (i === positions.length - 1) {
              // This is the last visible card, insert at the end
              return scenes.length - 1
            } else {
              // Insert after this card
              return pos.originalIndex + 1
            }
          }
        }
      }
    }

    // SECOND: Check first/last positions with extended drop zones
    // Only trigger if card center is clearly outside the middle card area
    // Use extended zones to make first/last positions easy to target

    // First position: extended zone to the left of first card
    // If center is to the left of first card (even slightly), and within extended zone
    if (cardCenterX < firstPos.leftEdge + firstLastDropZone) {
      return 0
    }

    // Last position: extended zone to the right of last card
    // If center is to the right of last card (even slightly), trigger last position
    // Use tolerance to make it easy to trigger when near the right edge
    if (cardCenterX > lastPos.rightEdge - tolerance) {
      return scenes.length - 1
    }

    // Fallback - if we somehow didn't match anything, use last position
    return scenes.length - 1
  }

  // Use mouse and touch events to track drag position and handle drop via move/end events
  useEffect(() => {
    if (draggedIndex === null) return

    const handleMove = (e) => {
      // Handle both MouseEvent and TouchEvent
      const clientX = e.type.startsWith('touch') ? e.touches[0].clientX : e.clientX
      // Calculate insertion index based on position during drag
      const newIndex = calculateInsertionIndex(clientX)
      if (newIndex !== insertionIndex) {
        setInsertionIndex(newIndex)
      }
    }

    const handleEnd = (e) => {
      // For touch, we may need to look at changedTouches
      const clientX = e.type.startsWith('touch') ? (e.changedTouches[0]?.clientX || 0) : e.clientX
      // Calculate the final insertion index based on final position
      const finalInsertionIndex = calculateInsertionIndex(clientX)

      // Perform the drop operation if we have a valid insertion index
      if (finalInsertionIndex !== null && finalInsertionIndex !== draggedIndex) {
        handleDrop(draggedIndex, finalInsertionIndex)
      }

      // Always reset drag state
      handleDragEnd()
    }

    // Listen for mouse and touch events during drag
    document.addEventListener('mousemove', handleMove, { passive: true })
    document.addEventListener('mouseup', handleEnd, { passive: false })
    document.addEventListener('touchmove', handleMove, { passive: false })
    document.addEventListener('touchend', handleEnd, { passive: false })

    return () => {
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleEnd)
      document.removeEventListener('touchmove', handleMove)
      document.removeEventListener('touchend', handleEnd)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draggedIndex, insertionIndex])

  const handleDragStart = (index) => {
    setDraggedIndex(index)
    setInsertionIndex(null)
  }

  const handleDragOver = (index, e) => {
    if (draggedIndex === null) return

    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'

    // Immediate calculation - no delays
    const newInsertionIndex = calculateInsertionIndex(e.clientX)

    if (newInsertionIndex !== null && newInsertionIndex !== draggedIndex) {
      setDragOverIndex(index)
      setInsertionIndex(newInsertionIndex)
    } else if (draggedIndex === index) {
      setDragOverIndex(null)
      setInsertionIndex(null)
    }
  }

  const handleDragEnd = () => {
    setDraggedIndex(null)
    setDragOverIndex(null)
    setInsertionIndex(null)
  }

  const handleDrop = (fromIndex, toIndex) => {
    // Always use insertionIndex if available (most accurate), otherwise use toIndex
    let finalIndex = insertionIndex !== null ? insertionIndex : toIndex

    // Clamp finalIndex to valid range (reorderScene requires toIndex < scenes.length)
    if (finalIndex >= scenes.length) {
      finalIndex = scenes.length - 1
    }

    // Ensure we have valid indices and they're different
    if (fromIndex !== null && finalIndex !== null &&
      fromIndex !== finalIndex &&
      fromIndex >= 0 && finalIndex >= 0 &&
      fromIndex < scenes.length && finalIndex < scenes.length) {

      // Stop playback on reorder
      if (onMotionStop) onMotionStop()

      dispatch(reorderScene({
        fromIndex,
        toIndex: finalIndex
      }))

      // Update sceneIdToWidth mapping to match new scene order
      // The widths stay with their respective scenes during reordering
      setSceneIdToWidth(prev => ({ ...prev }))
    }

    setDraggedIndex(null)
    setDragOverIndex(null)
    setInsertionIndex(null)
  }

  return (
    <div
      className="relative flex items-center gap-1.5 sm:gap-2 md:gap-2.5 px-1.5 sm:px-2 md:px-2.5 pb-2 flex-shrink-0"
      style={{
        minWidth: '100%',
        width: `${Math.max(totalCardsWidth + 32, 100)}px`,
        backgroundColor: '#0f1015',
      }}
    >
      {/* Timeline Ruler */}
      <div
        className="absolute top-0 left-0 z-20"
        ref={timelineRef}
        style={{
          height: '16px',
          pointerEvents: 'none',
          width: `${totalCardsWidth + 32}px`,
          minWidth: '100%',
        }}
      >
        {majorMarkers.map((marker) => (
          <div
            key={`major-${marker.time}`}
            className="absolute top-0 flex flex-col items-center"
            style={{
              left: `${16 + marker.position}px`,
              transform: 'translateX(-50%)',
              height: '100%',
            }}
          >
            <div
              className="whitespace-nowrap"
              style={{
                color: 'rgba(255,255,255,0.45)',
                fontSize: '9px',
                fontWeight: 600,
                fontFamily: 'Inter, system-ui, sans-serif',
                letterSpacing: '0.03em',
                lineHeight: '12px',
              }}
            >
              {marker.label}
            </div>
            <div style={{
              width: '1px',
              height: '4px',
              backgroundColor: 'rgba(255,255,255,0.15)',
              marginTop: '1px',
            }} />
          </div>
        ))}

        {minorMarkers.map((marker) => (
          <div
            key={`minor-${marker.time}`}
            className="absolute"
            style={{
              left: `${16 + marker.position}px`,
              transform: 'translateX(-50%)',
              bottom: '0',
              width: '1px',
              height: '3px',
              backgroundColor: 'rgba(255,255,255,0.1)'
            }}
          />
        ))}

        {/* Seek overlay */}
        {!isDraggingPlayhead && !isHoveringPlayhead && (
          <div
            className="absolute top-0 left-0 right-0 cursor-pointer"
            onClick={handleTimelineClick}
            onTouchStart={(e) => {
              const touch = e.touches[0]
              handleTimelineClick({ clientX: touch.clientX, preventDefault: () => { }, stopPropagation: () => { } })
            }}
            style={{
              zIndex: 10,
              height: '30px',
              pointerEvents: 'auto',
              touchAction: 'none',
            }}
          />
        )}
      </div>

      {/* Playhead */}
      <div
        ref={playheadElementRef}
        className="absolute top-0 bottom-0"
        style={{
          left: `${16 + playheadPosition}px`,
          transform: 'translateX(-50%)',
          cursor: isDraggingPlayhead ? 'grabbing' : 'grab',
          zIndex: 50,
          width: '16px',
          userSelect: 'none',
          touchAction: 'none',
          pointerEvents: 'auto',
          willChange: 'transform, left',
        }}
        onMouseDown={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setIsDraggingPlayhead(true)

          setPlayheadTooltipTime(currentTime)
          if (timelineRef.current) {
            const timelineRect = timelineRef.current.getBoundingClientRect()
            setPlayheadTooltipPosition({
              top: timelineRect.top - 16 - 28,
              left: timelineRect.left + 16 + playheadPosition,
            })
          }
        }}
        onMouseEnter={() => {
          setIsHoveringPlayhead(true)
        }}
        onMouseLeave={() => {
          setIsHoveringPlayhead(false)
        }}
        onTouchStart={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setIsDraggingPlayhead(true)
          const touch = e.touches[0]
          setPlayheadTooltipTime(currentTime)
          if (timelineRef.current) {
            const timelineRect = timelineRef.current.getBoundingClientRect()
            setPlayheadTooltipPosition({
              top: timelineRect.top - 16 - 28,
              left: touch.clientX,
            })
          }
        }}
      >
        {/* Playhead diamond/triangle marker at top */}
        <div className="absolute left-1/2 -translate-x-1/2 pointer-events-none" style={{ top: '-2px' }}>
          <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
            <path d="M5 8L0.5 0H9.5L5 8Z" fill="#fff" />
          </svg>
        </div>

        {/* Playhead line */}
        <div
          className="absolute bottom-0 left-1/2 transform -translate-x-1/2 pointer-events-none"
          style={{
            backgroundColor: '#ffffff',
            width: isDraggingPlayhead ? '2.5px' : '2px',
            top: '6px',
            borderRadius: '1px',
            boxShadow: isDraggingPlayhead ? '0 0 6px rgba(255,255,255,0.4)' : '0 0 3px rgba(255,255,255,0.2)',
            transition: 'width 0.1s, box-shadow 0.1s',
          }}
        />
      </div>

      {/* Scene Cards */}
      <div
        ref={cardsContainerRef}
        className="flex flex-shrink-0 relative z-10 items-center"
        onContextMenu={(e) => {
          e.preventDefault()
        }}
        style={{
          gap: 0,
          marginTop: bottomSectionHeight ? `${Math.max(56, 56 + (bottomSectionHeight - 170))}px` : '56px',
          paddingBottom: '6px',
          minWidth: 'max-content',
          width: 'max-content',
        }}
      >

        {scenes.map((scene, index) => {
          const sceneLayers = getSceneLayers(scene.id)
          const isCurrentScene = currentSceneId === scene.id

          // Calculate position for button at the center of gap between cards
          // Card wrapper: width = cardWidth (content), marginRight = 4px
          // The gap is the 4px marginRight between cards
          const cardPaddingRight = 4 // Gap size between cards (marginRight)

          // Calculate the right edge of the current card's content (before gap)
          let rightEdgeOfContent = 0
          for (let i = 0; i <= index; i++) {
            if (i < scenes.length) {
              // Add card content width
              rightEdgeOfContent += cardWidths[i] || getDefaultCardWidth()
              // Add gap for previous cards (marginRight between cards)
              if (i < index) {
                rightEdgeOfContent += cardPaddingRight
              }
            }
          }
          // Center of gap = right edge of content + half of gap (2px)
          // This positions the button exactly in the middle of the 4px gap
          const buttonPosition = rightEdgeOfContent + (cardPaddingRight / 2)

          return (
            <React.Fragment key={scene.id}>
              <div
                data-scene-card-wrapper
                className="transition-all duration-300 ease-out"
              >
                <SceneCard
                  key={scene.id}
                  index={index}
                  scene={scene}
                  isActive={isCurrentScene}
                  onClick={() => handleSwitchScene(scene.id)}
                  layers={getSceneLayers(scene.id)}
                  isDragging={draggedIndex === index}
                  draggedIndex={draggedIndex}
                  dragOverIndex={dragOverIndex}
                  insertionIndex={insertionIndex}
                  onDragStart={handleDragStart}
                  onDragOver={handleDragOver}
                  onDragEnd={handleDragEnd}
                  onDrop={handleDrop}
                  cardWidth={cardWidths[index]}
                  onCardWidthChange={handleCardWidthChange}
                  onResizeStart={() => handleResizeStart(index)}
                  onResizeEnd={handleResizeEnd}
                  previousCardWidths={cardWidths}
                  minCardWidth={getMinCardWidth()}
                  calculateDurationFromWidth={calculateDurationFromWidth}
                  calculateWidthFromDuration={calculateWidthFromDuration}
                  formatDuration={formatDuration}
                  onMotionStop={onMotionStop}
                  hasMotionSteps={sceneMotionFlows?.[scene.id]?.steps?.length > 0}
                  motionStepCount={sceneMotionFlows?.[scene.id]?.steps?.length || 0}
                  motionFlow={sceneMotionFlows?.[scene.id]}
                  activeStepId={isCurrentScene ? currentTimeStepId : null}
                  onStepClick={(stepId) => {
                    if (!isCurrentScene) {
                      handleSwitchScene(scene.id)
                    }
                    if (onStepClick) onStepClick(stepId)
                  }}
                  onStepContextMenu={(e, stepId) => {
                    if (!isCurrentScene) {
                      handleSwitchScene(scene.id)
                    }
                    handleStepContextMenu(e, scene.id, stepId)
                  }}
                  isMotionCaptureActive={isMotionCaptureActive && isCurrentScene}
                  onContextMenu={(e) => handleContextMenu(e, scene.id)}
                />
              </div>
              {/* Transition button */}
              {index < scenes.length - 1 && (
                <div
                  key={`gap-button-${index}`}
                  className="absolute z-40"
                  style={{
                    left: `${buttonPosition}px`,
                    bottom: '0px',
                    transform: 'translateX(-50%)',
                    pointerEvents: 'auto',
                  }}
                >
                  <button
                    className="w-5 h-5 rounded-full flex items-center justify-center transition-all duration-150"
                    style={{
                      backgroundColor: '#2a2a30',
                      border: '1px solid #3f3f46',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = '#3f3f46'
                      e.currentTarget.style.borderColor = '#52525b'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = '#2a2a30'
                      e.currentTarget.style.borderColor = '#3f3f46'
                    }}
                    onClick={(e) => {
                      e.stopPropagation()
                    }}
                    title="Add transition"
                  >
                    <Plus className="h-3 w-3 text-zinc-400" strokeWidth={2} />
                  </button>
                </div>
              )}
            </React.Fragment>
          )
        })}

        {/* Drop indicator - precise positioning based on insertionIndex */}
        {draggedIndex !== null && insertionIndex !== null && insertionIndex !== draggedIndex && (
          <div
            className="absolute z-30 pointer-events-none"
            style={{
              left: (() => {
                const gap = 4
                // Calculate position by iterating through card widths
                // We need to account for the gap and the absolute position within the scrollable container
                let x = 0
                let visibleCardCount = 0

                for (let i = 0; i < scenes.length; i++) {
                  if (i === draggedIndex) continue

                  // If this is the spot where we want to insert, return the current x
                  if (visibleCardCount === insertionIndex) {
                    // Adjust by half gap to center it (except at the very start)
                    return visibleCardCount === 0 ? '0px' : `${x - (gap / 2)}px`
                  }

                  const cardWidth = cardWidths[i] || getDefaultCardWidth()
                  x += cardWidth + gap
                  visibleCardCount++
                }

                // If we reach the end, return the final x - adjustment
                return `${x - (gap / 2)}px`
              })(),
              top: '0',
              bottom: '8px',
              width: '2px',
              backgroundColor: '#3b82f6',
              borderRadius: '1px',
              boxShadow: '0 0 6px rgba(59, 130, 246, 0.5)',
              transform: 'translateX(-50%)', // Center the line on the gap
              transition: 'left 0.1s cubic-bezier(0.2, 0.8, 0.2, 1)',
              zIndex: 100,
            }}
          />
        )}

        {/* Add Scene Button */}
        <div className="flex items-center gap-2 ml-2 flex-shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation()
              handleAddScene()
            }}
            onMouseDown={(e) => {
              e.stopPropagation()
            }}
            className="flex items-center justify-center touch-manipulation rounded-md transition-all duration-150"
            title="Add Scene"
            style={{
              cursor: 'pointer',
              zIndex: 30,
              position: 'relative',
              pointerEvents: 'auto',
              width: '36px',
              height: `${getDefaultCardHeight()}px`,
              backgroundColor: 'rgba(255,255,255,0.04)',
              border: '1px dashed rgba(255,255,255,0.12)',
              borderRadius: '6px',
            }}
          >
            <Plus className="h-4 w-4 text-white/30 hover:text-white/60 pointer-events-none" strokeWidth={1.5} />
          </button>

        </div>
      </div>

      {/* Playhead time tooltip */}
      {isDraggingPlayhead && playheadTooltipTime !== null && typeof document !== 'undefined'
        ? createPortal(
          <div
            className="fixed pointer-events-none"
            style={{
              top: `${playheadTooltipPosition.top}px`,
              left: `${playheadTooltipPosition.left}px`,
              transform: 'translateX(-50%)',
              zIndex: 9999,
            }}
          >
            <div
              className="text-white px-2 py-1 rounded shadow-lg text-[10px] font-semibold whitespace-nowrap"
              style={{
                backgroundColor: 'rgba(15,16,21,0.95)',
                border: '1px solid rgba(255,255,255,0.1)',
                fontFamily: 'Inter, system-ui, sans-serif',
              }}
            >
              {formatTime(playheadTooltipTime)}
            </div>
            <div
              className="absolute left-1/2 top-full transform -translate-x-1/2"
              style={{
                width: '0',
                height: '0',
                borderLeft: '4px solid transparent',
                borderRight: '4px solid transparent',
                borderTop: '4px solid rgba(15,16,21,0.95)',
              }}
            />
          </div>,
          document.body
        )
        : null}

      {/* Context Menu for Scene Cards */}
      {contextMenu.visible && createPortal(
        <div
          className="fixed rounded-lg shadow-2xl py-1 z-[10005] min-w-[170px] overflow-hidden"
          style={{
            top: `${contextMenu.y}px`,
            left: `${contextMenu.x}px`,
            backgroundColor: 'rgba(20, 20, 24, 0.92)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            border: '1px solid rgba(255,255,255,0.08)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="w-full text-left px-3.5 py-2 text-[11px] text-white/85 hover:text-white hover:bg-white/8 flex items-center gap-2.5 transition-colors rounded-md mx-0.5 my-0.5"
            style={{ width: 'calc(100% - 4px)' }}
            onClick={handleCutPage}
          >
            <Plus className="h-3.5 w-3.5 rotate-45 text-purple-400" />
            <span>Split at Playhead</span>
          </button>

          <div className="h-px bg-white/5 my-0.5 mx-2.5" />

          <button
            className="w-full text-left px-3.5 py-2 text-[11px] text-red-400/90 hover:bg-red-500/15 hover:text-red-300 flex items-center gap-2.5 transition-colors rounded-md mx-0.5 my-0.5"
            style={{ width: 'calc(100% - 4px)' }}
            onClick={() => {
              dispatch(deleteScene(contextMenu.sceneId))
              setContextMenu(prev => ({ ...prev, visible: false }))
            }}
          >
            <span>Delete Page</span>
          </button>
        </div>,
        document.body
      )}

      {/* Context Menu for Motion Steps */}
      {stepContextMenu.visible && createPortal(
        <div
          className="fixed rounded-lg shadow-2xl py-1 z-[10005] min-w-[170px] overflow-hidden"
          style={{
            top: `${stepContextMenu.y}px`,
            left: `${stepContextMenu.x}px`,
            backgroundColor: 'rgba(20, 20, 24, 0.92)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            border: '1px solid rgba(255,255,255,0.08)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {stepContextMenu.stepId !== 'base' && (
            <button
              className="w-full text-left px-3.5 py-2 text-[11px] text-white/85 hover:text-white hover:bg-white/8 flex items-center gap-2.5 transition-colors font-medium rounded-md mx-0.5 my-0.5"
              style={{ width: 'calc(100% - 4px)' }}
              onClick={() => {
                if (onStepEdit) onStepEdit(stepContextMenu.stepId)
                setStepContextMenu(prev => ({ ...prev, visible: false }))
              }}
            >
              <Zap className="h-3.5 w-3.5 text-purple-400" />
              <span>Update Step</span>
            </button>
          )}

          {stepContextMenu.stepId === 'base' && (
            <button
              className="w-full text-left px-3.5 py-2 text-[11px] text-white/85 hover:text-white hover:bg-white/8 flex items-center gap-2.5 transition-colors font-medium rounded-md mx-0.5 my-0.5"
              style={{ width: 'calc(100% - 4px)' }}
              onClick={() => {
                if (onStepClick) onStepClick('base')
                setStepContextMenu(prev => ({ ...prev, visible: false }))
              }}
            >
              <Zap className="h-3.5 w-3.5 text-purple-400" />
              <span>Select Base State</span>
            </button>
          )}

          {stepContextMenu.stepId !== 'base' && (
            <>
              <div className="h-px bg-white/5 my-0.5 mx-2.5" />
              <button
                className="w-full text-left px-3.5 py-2 text-[11px] text-red-400/90 hover:bg-red-500/15 hover:text-red-300 flex items-center gap-2.5 transition-colors font-medium rounded-md mx-0.5 my-0.5"
                style={{ width: 'calc(100% - 4px)' }}
                onClick={() => {
                  dispatch(deleteSceneMotionStep({
                    sceneId: stepContextMenu.sceneId,
                    stepId: stepContextMenu.stepId
                  }))
                  setStepContextMenu(prev => ({ ...prev, visible: false }))
                }}
              >
                <span>Delete Step</span>
              </button>
            </>
          )}
        </div>,
        document.body
      )}
    </div>
  )
})

export default ScenesBar
