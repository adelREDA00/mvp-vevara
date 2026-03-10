/**
 * 
 * currently this file handles the resizing & rotaion and scaling logic & the purple highlight box during resize and rotate operations
 * this file shares usedragstate.js with useCanvasInteractions.js to handle the drag state and position overrides so we can show and hide boxes during drag operations 
 * This hook displays a purple selection outline with interactive handles that allow users to:
 * - Resize elements using corner and side handles
 * - Rotate elements using the rotation handle
 * - See visual feedback during interactions
 *
 * The selection box automatically updates its position and size to match the selected element,
 * including real-time updates during text editing and drag operations.
 *
 * @param {PIXI.Container} stageContainer - Main PIXI container for layers (with clipping mask)
 * @param {PIXI.Container} layersContainer - Parent container for selection UI (no clipping mask)
 * @param {Object} layer - Selected layer data from Redux store (position, size, rotation, etc.)
 * @param {PIXI.DisplayObject} layerObject - The actual PIXI object being selected (text, shape, etc.)
 * @param {PIXI.Viewport} viewport - Handles zoom and screen-to-canvas coordinate conversion
 * @param {Function} onUpdate - Callback function to update layer data in Redux store
 * @param {Map} layerObjectsMap - Map of layer IDs to PIXI objects for interaction coordination
 * @param {Object} layers - Map of layerId -> layer data from Redux store
 */

import { useEffect, useRef, useCallback, useState, useMemo } from 'react'
import * as PIXI from 'pixi.js'
import { getGlobalMotionEngine } from '../../engine/motion'
import { drawDashedRect } from '../../engine/pixi/dashUtils'
import { drawShapePath } from '../../engine/pixi/createLayer'
import { getRotatedCursor, calculateAdaptedScale } from '../utils/handleUtils'
import {
  removeDimensionsBadge,
  createDimensionsBadge,
  updateDimensionsBadge,
  createRotationBadge,
  updateRotationBadge,
  removeRotationBadge
} from '../utils/badgeUtils'
import { pauseViewportDragPlugin, resumeViewportDragPlugin } from '../utils/viewportUtils'
import { LAYER_TYPES } from '../../../store/models'
import { resolveAnchors, calculateTextDimensions, getTextDimensions, getEffectiveLayerDimensions } from '../utils/geometry'
import { applyCenterSnapping, applySafeZoneSnapping } from '../utils/centerSnapping'
import { getLayerFirstActionTime } from '../utils/animationUtils'

// Text dimension utilities moved to src/features/editor/utils/geometry.js

// "If we're dragging, use the dragged position; otherwise, stick with the normal position
// Consolidates position override logic that was duplicated in multiple places
function getPositionWithDragOverrides(baseX, baseY, cachedDragState) {
  if (cachedDragState?.isDragging && cachedDragState.hasPositionOverrides && cachedDragState.dragPosition) {
    return {
      x: cachedDragState.dragPosition.x,
      y: cachedDragState.dragPosition.y
    }
  }
  return { x: baseX, y: baseY }
}

// Get current interaction state
// Consolidates interaction state checking logic
//It creates a localIsResizing value that considers both resize AND rotate operations as "resizing"

function getCurrentInteractionState(dragStateAPI, interactionStateRef, rotationJustEndedRef = null) {
  const isResizing = dragStateAPI.isResizing()
  const isRotating = dragStateAPI.isRotating()
  const interactionLayerId = dragStateAPI.getInteractionLayerId()

  // Check local interaction state with rotation just ended override
  const localIsResizing = (!!interactionStateRef.current.resize || !!interactionStateRef.current.rotate) &&
    (!rotationJustEndedRef || !rotationJustEndedRef.current)

  return {
    isResizing,
    isRotating,
    interactionLayerId,
    localIsResizing
  }
}

// Manage selection box visibility based on interaction state
// Consolidates visibility management logic to prevent conflicts
// Helper to update selection box visibility and children visibility
// OPTIMIZATION: Keep selection box VISIBLE during interaction but hide handles/border
// This allows badges (children of selection box) to remain visible while the box itself is hidden
function updateSelectionBoxVisibility(selectionBox, isMoving, isResizing, layersContainer, isPlaying = false, isRotating = false, motionCaptureMode = null, sceneMotionFlow = null, layerId = null, isAnimated = false) {
  if (!selectionBox) return

  // Hide completely during playback
  if (isPlaying) {
    selectionBox.visible = false
    return
  }

  // Handle visibility in Normal Mode when past the base step
  const isCapture = motionCaptureMode?.isActive
  let isPastBaseStep = false

  if (!isPlaying && !isCapture) {
    const engine = getGlobalMotionEngine()
    const currentTime = engine?.masterTimeline?.time() || 0
    const sceneStartTime = sceneMotionFlow?.sceneStartOffset || 0

    // Check if we are past the base step
    if (Math.abs(currentTime - sceneStartTime) > 0.02) {
      isPastBaseStep = true
    }
  }

  // IMMEDIATELY HIDE during move/drag interaction to match normal mode behavior
  if (isMoving) {
    if (selectionBox.visible) {
      selectionBox.visible = false
    }
    return
  }

  const isLocked = isPastBaseStep && isAnimated

  if (isLocked) {
    // Show locked state: selection box is visible, handles are visible but locked
    selectionBox.visible = true
    for (let i = 0; i < selectionBox.children.length; i++) {
      const child = selectionBox.children[i]
      child.visible = true
      // Apply locked visual style to all handles and outlines
      if (child.label?.includes('handle') || child.label?.includes('outline') || child.label?.includes('hitarea')) {
        child.alpha = 0.4
      } else {
        child.alpha = 1.0
      }
    }
    if (!selectionBox.parent && layersContainer) {
      layersContainer.addChild(selectionBox)
      const topIndex = layersContainer.children.length - 1
      layersContainer.setChildIndex(selectionBox, topIndex)
    }
    return
  }

  if (isPastBaseStep) {
    // FOR STATIC LAYERS at t > 0: Show selection box fully editable
    selectionBox.visible = true
    for (let i = 0; i < selectionBox.children.length; i++) {
      const child = selectionBox.children[i]
      child.visible = true
      child.alpha = 1.0 // Fully visible for static layers
    }
    if (!selectionBox.parent && layersContainer) {
      layersContainer.addChild(selectionBox)
      const topIndex = layersContainer.children.length - 1
      layersContainer.setChildIndex(selectionBox, topIndex)
    }
    return
  }

  // During interaction (resizing or rotating)
  if (isResizing || isRotating) {
    // Keep container visible so badges works
    selectionBox.visible = true

    // Iterate children: Show badges, hide handles/border
    for (let i = 0; i < selectionBox.children.length; i++) {
      const child = selectionBox.children[i]
      // Check if it's a badge
      const isBadge = child.label && (child.label.includes('badge') || child.label.includes('guide'))

      if (isBadge) {
        child.visible = true
      } else {
        // Show handles only in MotionCaptureMode
        child.visible = false
      }
    }

    // Ensure it's in the layersContainer
    if (!selectionBox.parent && layersContainer) {
      layersContainer.addChild(selectionBox)
    }
  } else {
    // NORMAL STATE: Show handles and border
    if (!selectionBox.visible) {
      selectionBox.visible = true
    }

    // Show all handles/border
    for (let i = 0; i < selectionBox.children.length; i++) {
      const child = selectionBox.children[i]
      // Show everything by default
      child.visible = true
      child.alpha = 1.0 // Reset alpha to full opacity in normal state
    }

    // Ensure selection box is properly attached and positioned
    if (!selectionBox.parent && layersContainer) {
      layersContainer.addChild(selectionBox)
      const topIndex = layersContainer.children.length - 1
      layersContainer.setChildIndex(selectionBox, topIndex)
    }
  }
}

// =============================================================================
// MAIN HOOK - Core selection box functionality
// =============================================================================


export function useSelectionBox(stageContainer, layer, layerObject, viewport, onUpdate, layerObjectsMap = null, dragStateAPI, layers, layersContainer, motionCaptureMode = null, isPlaying = false, sceneMotionFlow = null, onLockedInteraction = null) {
  // ===========================================================================
  // STATE MANAGEMENT - React refs and state variables for tracking interactions
  // ===========================================================================
  const [forceUpdate, setForceUpdate] = useState(0)
  const requestUpdateLoop = useCallback(() => {
    if (!isLoopActiveRef.current) {
      setForceUpdate(prev => prev + 1)
    }
  }, [])

  // Track latest props in refs to avoid stale closures and reduce effect dependencies
  const latestLayerRef = useRef(layer)
  const latestLayerObjectRef = useRef(layerObject)
  const latestViewportRef = useRef(viewport)
  const latestOnUpdateRef = useRef(onUpdate)
  const latestSceneMotionFlowRef = useRef(sceneMotionFlow)
  const latestMotionCaptureModeRef = useRef(motionCaptureMode)

  useEffect(() => {
    // If capture mode state changes (on/off), force a redraw of the selection system
    if (latestMotionCaptureModeRef.current?.isActive !== motionCaptureMode?.isActive) {
      forceRedrawRef.current = true
    }
    latestLayerRef.current = layer
    latestLayerObjectRef.current = layerObject
    latestViewportRef.current = viewport
    latestOnUpdateRef.current = onUpdate
    latestSceneMotionFlowRef.current = sceneMotionFlow
    latestMotionCaptureModeRef.current = motionCaptureMode
  }, [layer, layerObject, viewport, onUpdate, sceneMotionFlow, motionCaptureMode])

  // [FIX] BACKGROUND PROTECTION: Never show selection box for background layers
  // Backgrounds are static elements and should not have interactive handles
  if (layer?.type === 'background') {
    return null
  }

  // Track previous drag state to detect drag end transitions
  const previousIsMovingRef = useRef(false)
  const previousIsResizingRef = useRef(false) // Track resizing state
  const previousIsRotatingRef = useRef(false) // Track rotating state

  // Core PIXI.js object references
  const selectionBoxRef = useRef(null)
  const canvasRef = useRef(null)

  // Hover box for layer objects
  const hoverBoxRef = useRef(null) // Purple box shown during resize/rotate operations

  // Interaction state management
  const interactionStateRef = useRef({ resize: null, rotate: null })
  const isLoopActiveRef = useRef(false)

  // Flag to prevent hover box from staying visible after rotation ends
  // When rotation ends, this flag temporarily overrides the isResizing check
  // to ensure the selection box appears immediately instead of the hover box
  const rotationJustEndedRef = useRef(false)

  // Update throttling and pending updates
  const pendingUpdateRef = useRef(null)

  // Snapping guide references
  const vGuideRef = useRef(null)
  const hGuideRef = useRef(null)
  const alignmentGuidesMapRef = useRef(new Map())

  // Layer change tracking
  const previousLayerRef = useRef({ id: null, object: null })

  // Position and dimension tracking
  const cachedTextHeightRef = useRef(null)
  const lastTextWidthRef = useRef(null)
  const forceRedrawRef = useRef(false)
  const lastKnownHeightRef = useRef(100)
  const lastKnownWidthRef = useRef(100)
  const lastKnownScaleXRef = useRef(1)
  const lastKnownScaleYRef = useRef(1)
  const lastKnownRotationRef = useRef(0)

  // Performance optimization caches
  const lastCalculatedDimensionsRef = useRef(null)
  const lastLayerStateRef = useRef(null)
  const updateThrottleRef = useRef(null)
  const frameSkipCounterRef = useRef(0)
  const FRAME_SKIP_INTERVAL = 2 // Skip every 2nd frame for non-critical updates

  // PERFORMANCE OPTIMIZATION: Cache trigonometric values for resize operations
  const trigCacheRef = useRef(new Map())
  const getTrigValues = useCallback((rotationRad) => {
    const key = Math.round(rotationRad * 1000) / 1000 // Round to avoid floating point precision issues
    if (!trigCacheRef.current.has(key)) {
      trigCacheRef.current.set(key, {
        cos: Math.cos(-rotationRad),
        sin: Math.sin(-rotationRad),
        cosPos: Math.cos(rotationRad),
        sinPos: Math.sin(rotationRad)
      })
      // Limit cache size to prevent memory leaks
      if (trigCacheRef.current.size > 100) {
        const firstKey = trigCacheRef.current.keys().next().value
        trigCacheRef.current.delete(firstKey)
      }
    }
    return trigCacheRef.current.get(key)
  }, [])

  // ===========================================================================
  // TRANSFORM HELPERS - Consolidated logic for retrieving current layer state
  // These helpers prioritize motion capture session state over Redux state
  // ===========================================================================

  // Get current layer position, prioritizing captured visual state
  const getCurrentLayerPosition = useCallback((currentLayer, currentLayerObject, cachedDragState) => {
    const motionCaptureMode = latestMotionCaptureModeRef.current

    // Prioritize captured visual state during motion capture
    if (motionCaptureMode?.isActive) {
      const capturedLayer = motionCaptureMode.trackedLayers?.get(currentLayer.id)
      if (capturedLayer?.currentPosition) {
        return {
          x: capturedLayer.currentPosition.x,
          y: capturedLayer.currentPosition.y
        }
      }
    }

    if (motionCaptureMode?.isActive && currentLayerObject && !currentLayerObject.destroyed) {
      const targetObject = currentLayerObject._cachedSprite || currentLayerObject
      const motionX = targetObject._selectionBoxX ?? targetObject.x
      const motionY = targetObject._selectionBoxY ?? targetObject.y
      if (Number.isFinite(motionX) && Number.isFinite(motionY)) {
        return { x: motionX, y: motionY }
      }
    }

    // [FIX] In Normal Mode, if we are paused mid-animation (time > 0), 
    // we must follow the PIXI object's actual visual position.
    if (!motionCaptureMode?.isActive && currentLayerObject && !currentLayerObject.destroyed) {
      const engine = getGlobalMotionEngine()
      const currentTime = engine?.masterTimeline?.time() || 0
      if (currentTime !== 0) {
        const targetObject = currentLayerObject._cachedSprite || currentLayerObject
        return { x: targetObject.x, y: targetObject.y }
      }
    }

    return getPositionWithDragOverrides(currentLayer.x || 0, currentLayer.y || 0, cachedDragState)
  }, [layer?.id])

  // Get current scale, prioritizing captured state
  const getCurrentLayerScale = useCallback((currentLayer, currentLayerObject) => {
    const motionCaptureMode = latestMotionCaptureModeRef.current

    if (motionCaptureMode?.isActive && currentLayerObject && !currentLayerObject.destroyed) {
      const capturedLayer = motionCaptureMode.trackedLayers?.get(currentLayer.id)
      if (capturedLayer) {
        return {
          scaleX: capturedLayer.scaleX ?? (currentLayer.scaleX !== undefined ? currentLayer.scaleX : 1),
          scaleY: capturedLayer.scaleY ?? (currentLayer.scaleY !== undefined ? currentLayer.scaleY : 1)
        }
      }
    }
    // [FIX] In Normal Mode, if we are paused mid-animation, follow the PIXI object's actual scale.
    if (!motionCaptureMode?.isActive && currentLayerObject && !currentLayerObject.destroyed) {
      const engine = getGlobalMotionEngine()
      const currentTime = engine?.masterTimeline?.time() || 0
      if (currentTime !== 0) {
        const targetObject = currentLayerObject._cachedSprite || currentLayerObject
        return {
          scaleX: targetObject.scale.x,
          scaleY: targetObject.scale.y
        }
      }
    }

    return {
      scaleX: currentLayer.scaleX !== undefined ? currentLayer.scaleX : 1,
      scaleY: currentLayer.scaleY !== undefined ? currentLayer.scaleY : 1
    }
  }, [layer?.id])

  // Get current rotation, prioritizing captured state
  const getCurrentLayerRotation = useCallback((currentLayer, currentLayerObject) => {
    const motionCaptureMode = latestMotionCaptureModeRef.current

    if (motionCaptureMode?.isActive && currentLayerObject && !currentLayerObject.destroyed) {
      const capturedLayer = motionCaptureMode.trackedLayers?.get(currentLayer.id)
      if (capturedLayer) {
        return capturedLayer.rotation ?? (currentLayer.rotation || 0)
      }
    }
    // [FIX] In Normal Mode, if we are paused mid-animation, follow the PIXI object's actual rotation.
    if (!motionCaptureMode?.isActive && currentLayerObject && !currentLayerObject.destroyed) {
      const engine = getGlobalMotionEngine()
      const currentTime = engine?.masterTimeline?.time() || 0
      if (currentTime !== 0) {
        const targetObject = currentLayerObject._cachedSprite || currentLayerObject
        return (targetObject.rotation * 180) / Math.PI
      }
    }

    return currentLayer.rotation || 0
  }, [layer?.id])

  // Get current dimensions — single source of truth via getEffectiveLayerDimensions for media
  const getCurrentLayerDimensions = useCallback((currentLayer, currentLayerObject) => {
    const motionCaptureMode = latestMotionCaptureModeRef.current
    const isCaptureActive = motionCaptureMode?.isActive
    const trackedLayer = isCaptureActive ? motionCaptureMode.trackedLayers?.get(currentLayer.id) : null

    if (trackedLayer) {
      if (currentLayer.type === 'text' && currentLayerObject instanceof PIXI.Text) {
        return calculateTextDimensions(currentLayerObject, currentLayer)
      }
      return {
        width: trackedLayer.cropWidth ?? trackedLayer.width ?? 100,
        height: trackedLayer.cropHeight ?? trackedLayer.height ?? 100
      }
    }

    if (currentLayerObject instanceof PIXI.Text) {
      return calculateTextDimensions(currentLayerObject, currentLayer)
    }

    const isMediaElement = currentLayer.type === LAYER_TYPES.IMAGE || currentLayer.type === LAYER_TYPES.VIDEO
    if (isMediaElement && currentLayerObject && !currentLayerObject.destroyed) {
      const mediaDims = getEffectiveLayerDimensions(currentLayer, currentLayerObject, motionCaptureMode)
      if (mediaDims) {
        return { width: mediaDims.width, height: mediaDims.height }
      }
    }

    return {
      width: currentLayer.width || 100,
      height: currentLayer.height || 100
    }
  }, [calculateTextDimensions])

  // PERFORMANCE OPTIMIZATION: Pre-computed handle transformation functions
  const handleTransformCache = useRef({
    // Each handle type has a pre-computed transformation function
    e: (localDeltaX, localDeltaY, state, maintainAspectRatio, motionCaptureMode) => { // right edge
      const isCaptureMode = motionCaptureMode?.isActive // Enable center-scale for all including media crop
      const widthDelta = isCaptureMode ? (localDeltaX / state.scaleX) * 2 : localDeltaX / state.scaleX
      const newWidth = Math.max(10, state.startWidth + widthDelta)
      const localOffsetX = isCaptureMode ? 0 : (newWidth - state.startWidth) * state.scaleX * state.anchorX
      return { newWidth, newHeight: state.startHeight, widthDelta, heightDelta: 0, localOffsetX, localOffsetY: 0 }
    },
    w: (localDeltaX, localDeltaY, state, maintainAspectRatio, motionCaptureMode) => { // left edge
      const isCaptureMode = motionCaptureMode?.isActive // Enable center-scale for all including media crop
      const widthDelta = isCaptureMode ? (-localDeltaX / state.scaleX) * 2 : -localDeltaX / state.scaleX
      const newWidth = Math.max(10, state.startWidth + widthDelta)
      const localOffsetX = isCaptureMode ? 0 : -(newWidth - state.startWidth) * state.scaleX * (1 - state.anchorX)
      return { newWidth, newHeight: state.startHeight, widthDelta, heightDelta: 0, localOffsetX, localOffsetY: 0 }
    },
    n: (localDeltaX, localDeltaY, state, maintainAspectRatio, motionCaptureMode) => { // top edge
      const isCaptureMode = motionCaptureMode?.isActive // Enable center-scale for all including media crop
      const heightDelta = isCaptureMode ? (-localDeltaY / state.scaleY) * 2 : -localDeltaY / state.scaleY
      const newHeight = Math.max(10, state.startHeight + heightDelta)
      const localOffsetY = isCaptureMode ? 0 : -(newHeight - state.startHeight) * state.scaleY * (1 - state.anchorY)
      return { newWidth: state.startWidth, newHeight, widthDelta: 0, heightDelta, localOffsetX: 0, localOffsetY }
    },
    s: (localDeltaX, localDeltaY, state, maintainAspectRatio, motionCaptureMode) => { // bottom edge
      const isCaptureMode = motionCaptureMode?.isActive // Enable center-scale for all including media crop
      const heightDelta = isCaptureMode ? (localDeltaY / state.scaleY) * 2 : localDeltaY / state.scaleY
      const newHeight = Math.max(10, state.startHeight + heightDelta)
      const localOffsetY = isCaptureMode ? 0 : (newHeight - state.startHeight) * state.scaleY * state.anchorY
      return { newWidth: state.startWidth, newHeight, widthDelta: 0, heightDelta, localOffsetX: 0, localOffsetY }
    },
    nw: (localDeltaX, localDeltaY, state, maintainAspectRatio, motionCaptureMode) => { // top-left corner
      const isCaptureMode = motionCaptureMode?.isActive
      if (maintainAspectRatio) {
        let uniformScale
        if (isCaptureMode) {
          const tempWidthDelta = -localDeltaX / state.scaleX
          const tempHeightDelta = -localDeltaY / state.scaleY
          uniformScale = Math.max(tempWidthDelta / state.startWidth, tempHeightDelta / state.startHeight) * 2
        } else {
          const tempWidthDelta = -localDeltaX / state.scaleX
          const tempHeightDelta = -localDeltaY / state.scaleY
          uniformScale = Math.max(tempWidthDelta / state.startWidth, tempHeightDelta / state.startHeight)
        }

        const newWidth = Math.max(10, state.startWidth * (1 + uniformScale))
        const newHeight = Math.max(10, state.startHeight * (1 + uniformScale))
        const widthDelta = newWidth - state.startWidth
        const heightDelta = newHeight - state.startHeight
        const localOffsetX = isCaptureMode ? 0 : -(newWidth - state.startWidth) * state.scaleX * (1 - state.anchorX)
        const localOffsetY = isCaptureMode ? 0 : -(newHeight - state.startHeight) * state.scaleY * (1 - state.anchorY)
        return { newWidth, newHeight, widthDelta, heightDelta, localOffsetX, localOffsetY }
      } else {
        const widthDelta = isCaptureMode ? (-localDeltaX / state.scaleX) * 2 : -localDeltaX / state.scaleX
        const heightDelta = isCaptureMode ? (-localDeltaY / state.scaleY) * 2 : -localDeltaY / state.scaleY
        const newWidth = Math.max(10, state.startWidth + widthDelta)
        const newHeight = Math.max(10, state.startHeight + heightDelta)
        const localOffsetX = isCaptureMode ? 0 : -(newWidth - state.startWidth) * state.scaleX * (1 - state.anchorX)
        const localOffsetY = isCaptureMode ? 0 : -(newHeight - state.startHeight) * state.scaleY * (1 - state.anchorY)
        return { newWidth, newHeight, widthDelta, heightDelta, localOffsetX, localOffsetY }
      }
    },
    ne: (localDeltaX, localDeltaY, state, maintainAspectRatio, motionCaptureMode) => { // top-right corner
      const isCaptureMode = motionCaptureMode?.isActive
      if (maintainAspectRatio) {
        let uniformScale
        if (isCaptureMode) {
          const tempWidthDelta = localDeltaX / state.scaleX
          const tempHeightDelta = -localDeltaY / state.scaleY
          uniformScale = Math.max(tempWidthDelta / state.startWidth, tempHeightDelta / state.startHeight) * 2
        } else {
          const tempWidthDelta = localDeltaX / state.scaleX
          const tempHeightDelta = -localDeltaY / state.scaleY
          uniformScale = Math.max(tempWidthDelta / state.startWidth, tempHeightDelta / state.startHeight)
        }

        const newWidth = Math.max(10, state.startWidth * (1 + uniformScale))
        const newHeight = Math.max(10, state.startHeight * (1 + uniformScale))
        const widthDelta = newWidth - state.startWidth
        const heightDelta = newHeight - state.startHeight
        const localOffsetX = isCaptureMode ? 0 : (newWidth - state.startWidth) * state.scaleX * state.anchorX
        const localOffsetY = isCaptureMode ? 0 : -(newHeight - state.startHeight) * state.scaleY * (1 - state.anchorY)
        return { newWidth, newHeight, widthDelta, heightDelta, localOffsetX, localOffsetY }
      } else {
        const widthDelta = isCaptureMode ? (localDeltaX / state.scaleX) * 2 : localDeltaX / state.scaleX
        const heightDelta = isCaptureMode ? (-localDeltaY / state.scaleY) * 2 : -localDeltaY / state.scaleY
        const newWidth = Math.max(10, state.startWidth + widthDelta)
        const newHeight = Math.max(10, state.startHeight + heightDelta)
        const localOffsetX = isCaptureMode ? 0 : (newWidth - state.startWidth) * state.scaleX * state.anchorX
        const localOffsetY = isCaptureMode ? 0 : -(newHeight - state.startHeight) * state.scaleY * (1 - state.anchorY)
        return { newWidth, newHeight, widthDelta, heightDelta, localOffsetX, localOffsetY }
      }
    },
    sw: (localDeltaX, localDeltaY, state, maintainAspectRatio, motionCaptureMode) => { // bottom-left corner
      const isCaptureMode = motionCaptureMode?.isActive
      if (maintainAspectRatio) {
        let uniformScale
        if (isCaptureMode) {
          const tempWidthDelta = -localDeltaX / state.scaleX
          const tempHeightDelta = localDeltaY / state.scaleY
          uniformScale = Math.max(tempWidthDelta / state.startWidth, tempHeightDelta / state.startHeight) * 2
        } else {
          const tempWidthDelta = -localDeltaX / state.scaleX
          const tempHeightDelta = localDeltaY / state.scaleY
          uniformScale = Math.max(tempWidthDelta / state.startWidth, tempHeightDelta / state.startHeight)
        }

        const newWidth = Math.max(10, state.startWidth * (1 + uniformScale))
        const newHeight = Math.max(10, state.startHeight * (1 + uniformScale))
        const widthDelta = newWidth - state.startWidth
        const heightDelta = newHeight - state.startHeight
        const localOffsetX = isCaptureMode ? 0 : -(newWidth - state.startWidth) * state.scaleX * (1 - state.anchorX)
        const localOffsetY = isCaptureMode ? 0 : (newHeight - state.startHeight) * state.scaleY * state.anchorY
        return { newWidth, newHeight, widthDelta, heightDelta, localOffsetX, localOffsetY }
      } else {
        const widthDelta = isCaptureMode ? (-localDeltaX / state.scaleX) * 2 : -localDeltaX / state.scaleX
        const heightDelta = isCaptureMode ? (localDeltaY / state.scaleY) * 2 : localDeltaY / state.scaleY
        const newWidth = Math.max(10, state.startWidth + widthDelta)
        const newHeight = Math.max(10, state.startHeight + heightDelta)
        const localOffsetX = isCaptureMode ? 0 : -(newWidth - state.startWidth) * state.scaleX * (1 - state.anchorX)
        const localOffsetY = isCaptureMode ? 0 : (newHeight - state.startHeight) * state.scaleY * state.anchorY
        return { newWidth, newHeight, widthDelta, heightDelta, localOffsetX, localOffsetY }
      }
    },
    se: (localDeltaX, localDeltaY, state, maintainAspectRatio, motionCaptureMode) => { // bottom-right corner
      const isCaptureMode = motionCaptureMode?.isActive
      if (maintainAspectRatio) {
        let uniformScale
        if (isCaptureMode) {
          const tempWidthDelta = localDeltaX / state.scaleX
          const tempHeightDelta = localDeltaY / state.scaleY
          uniformScale = Math.max(tempWidthDelta / state.startWidth, tempHeightDelta / state.startHeight) * 2
        } else {
          const tempWidthDelta = localDeltaX / state.scaleX
          const tempHeightDelta = localDeltaY / state.scaleY
          uniformScale = Math.max(tempWidthDelta / state.startWidth, tempHeightDelta / state.startHeight)
        }

        const newWidth = Math.max(10, state.startWidth * (1 + uniformScale))
        const newHeight = Math.max(10, state.startHeight * (1 + uniformScale))
        const widthDelta = newWidth - state.startWidth
        const heightDelta = newHeight - state.startHeight
        const localOffsetX = isCaptureMode ? 0 : (newWidth - state.startWidth) * state.scaleX * state.anchorX
        const localOffsetY = isCaptureMode ? 0 : (newHeight - state.startHeight) * state.scaleY * state.anchorY
        return { newWidth, newHeight, widthDelta, heightDelta, localOffsetX, localOffsetY }
      } else {
        const widthDelta = isCaptureMode ? (localDeltaX / state.scaleX) * 2 : localDeltaX / state.scaleX
        const heightDelta = isCaptureMode ? (localDeltaY / state.scaleY) * 2 : localDeltaY / state.scaleY
        const newWidth = Math.max(10, state.startWidth + widthDelta)
        const newHeight = Math.max(10, state.startHeight + heightDelta)
        const localOffsetX = isCaptureMode ? 0 : (newWidth - state.startWidth) * state.scaleX * state.anchorX
        const localOffsetY = isCaptureMode ? 0 : (newHeight - state.startHeight) * state.scaleY * state.anchorY
        return { newWidth, newHeight, widthDelta, heightDelta, localOffsetX, localOffsetY }
      }
    }
  })

  // Object pooling for performance optimization
  const pooledObjectsRef = useRef({
    outline: null,
    handles: [null, null, null, null], // 4 corner handles - direct references for fast access
    hitArea: null
  })

  // Independent badge refs
  const dimensionsBadgeRef = useRef(null)
  const rotationBadgeRef = useRef(null)

  // Cached drag state to avoid multiple API calls per frame
  const cachedDragStateRef = useRef(null)

  // Ensure pooled objects are always initialized
  useEffect(() => {
    if (!pooledObjectsRef.current) {
      pooledObjectsRef.current = {
        outline: null,
        handles: [null, null, null, null],
        hitArea: null
      }
    }
  }, [])


  // Event handler references for cleanup
  // Removed pointer event handlers - drag logic moved to useCanvasInteractions


  // Note: Layer interaction mode is only disabled during active resize operations
  // and immediately restored afterward, rather than for the entire selection duration.

  latestLayerRef.current = layer
  latestLayerObjectRef.current = layerObject
  latestViewportRef.current = viewport
  latestOnUpdateRef.current = onUpdate


  // Update drag state API with layer objects map
  useEffect(() => {
    if (layerObjectsMap) {
      dragStateAPI.updateLayerObjectsMap(layerObjectsMap)
    }
  }, [layerObjectsMap, dragStateAPI])

  // ===========================================================================
  // PURPLE HIGHLIGHT OUTLINE BOX DURING  RESIZE AND ROTATE OPERATIONS  
  // ===========================================================================

  // Helper function to update purple highlight box synchronously with calculated values-( How to act )
  const updateHoverBox = useCallback((x, y, width, height, rotation, anchorX, anchorY, scaleX = 1, scaleY = 1, zoomScale = 1) => {
    if (isPlaying) return // Hide if playing
    if (!layersContainer) return // Use layersContainer instead of stageContainer to avoid mask clipping
    let hoverBox = hoverBoxRef.current
    if (!hoverBox) {
      hoverBox = new PIXI.Container()
      hoverBox.label = 'hover-box'
      hoverBox.eventMode = 'none'
      hoverBox.zIndex = 9998 // Slightly below drag box
      hoverBoxRef.current = hoverBox
      if (!hoverBox.parent) {
        layersContainer.addChild(hoverBox) // Add to layersContainer instead of stageContainer
      }
    }

    const scaledWidth = width * scaleX
    const scaledHeight = height * scaleY
    const localBoundsX = -scaledWidth * anchorX
    const localBoundsY = -scaledHeight * anchorY

    hoverBox.x = x
    hoverBox.y = y
    hoverBox.rotation = (rotation * Math.PI) / 180

    // Reuse existing graphics object instead of recreating (performance optimization)
    let outline = hoverBox.children[0]
    if (!outline) {
      outline = new PIXI.Graphics()
      outline.eventMode = 'none'
      hoverBox.addChild(outline)
    }

    // Clear and redraw the outline (much faster than recreating the graphics object)
    outline.clear()
    outline.rect(localBoundsX, localBoundsY, scaledWidth, scaledHeight)

    // [FIX] ZOOM ADAPTIVE: Keep outline visually consistent regardless of zoom
    const baseScale = calculateAdaptedScale(zoomScale)
    outline.stroke({ color: 0x8B5CF6, width: 1.5 * baseScale })
    hoverBox.visible = true
  }, [layersContainer, isPlaying])

  // Helper function to hide purple highlight box
  const hideHoverBox = useCallback(() => {
    const hoverBox = hoverBoxRef.current
    if (hoverBox) {
      hoverBox.visible = false
    }
  }, [])



  // IMMEDIATELY HIDE SELECTION BOX WHEN DRAGGING STARTS
  // This prevents the split-second delay before selection box disappears during drag
  useEffect(() => {
    const isDragging = dragStateAPI.isDragging()
    const draggingLayerId = dragStateAPI.getDraggingLayerId()

    // Only hide selection box if this is the layer being dragged and we're not resizing/rotating
    if (isDragging && draggingLayerId === layer?.id && !dragStateAPI.isResizing() && !dragStateAPI.isRotating()) {
      const selectionBox = selectionBoxRef.current
      if (selectionBox) {
        selectionBox.visible = false
        // Hide all handles during drag
        selectionBox.children?.forEach((child) => {
          if (child.label?.includes('handle') || child.label?.includes('resize')) {
            child.visible = false
          }
        })
      }
    }
  }, [dragStateAPI.isDragging(), dragStateAPI.getDraggingLayerId(), layer?.id, dragStateAPI])

  // ===========================================================================
  // HANDLE CREATION FUNCTIONS - Memoized with useCallback for optimal performance
  // ===========================================================================

  // Create interactive resize handles with visual feedback
  const createHandle = useCallback((rotation, handleResizeStart, hx, hy, cursor, handleType, zoomScale = 1, scaledWidth = 0, scaledHeight = 0, isLocked = false) => {
    const handle = new PIXI.Graphics()
    handle.alpha = isLocked ? 0.4 : 1.0
    const isCorner = ['nw', 'ne', 'sw', 'se'].includes(handleType)
    const isSide = ['n', 's', 'e', 'w'].includes(handleType)

    // Calculate rotated cursor based on element rotation
    const rotatedCursor = getRotatedCursor(handleType, rotation)

    // Use static handle dimensions

    // Draw handle at calculated size with small layer optimization for visuals
    const layerSizeRef = Math.min(scaledWidth, scaledHeight)
    // smallLayerScale applies to BOTH visuals and hit area logic
    const smallLayerScale = layerSizeRef < 60 ? Math.max(0.6, layerSizeRef / 60) : 1

    // [FIX] Use unified adapted scale helper
    const baseScale = calculateAdaptedScale(zoomScale)
    const scaledBase = baseScale * smallLayerScale

    if (isCorner) {
      // Corner handles: larger white circles with purple border
      const cornerRadius = 12 * scaledBase
      handle.circle(0, 0, cornerRadius)
      handle.fill({ color: 0xffffff })
      handle.stroke({ color: 0x8B5CF6, width: Math.max(1, 1.5 * scaledBase) })
    } else if (isSide) {
      // Side handles: badge/pill shape (rounded rectangle)
      const sideWidth = 32 * scaledBase
      const sideHeight = 12 * scaledBase
      const sideWidthVertical = 12 * scaledBase
      const sideHeightVertical = 32 * scaledBase

      if (handleType === 'n' || handleType === 's') {
        // Horizontal badge for top/bottom
        handle.roundRect(-sideWidth / 2, -sideHeight / 2, sideWidth, sideHeight, 5 * scaledBase)
      } else {
        // Vertical badge for left/right
        handle.roundRect(-sideWidthVertical / 2, -sideHeightVertical / 2, sideWidthVertical, sideHeightVertical, 5 * scaledBase)
      }
      handle.fill({ color: 0xffffff })
      handle.stroke({ color: 0x8B5CF6, width: Math.max(1, 1.5 * scaledBase) })
    }

    // No need to scale the handle itself since we calculated the size already
    // Keep scale at 1:1 for consistent rendering
    handle.scale.set(1, 1)

    handle.x = hx
    handle.y = hy
    handle.label = `selection-handle-${handleType}`
    handle.eventMode = 'static'
    handle.cursor = rotatedCursor

    const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0)
    // Much larger hit area for easier interaction, but scaled appropriately
    // Small layer optimization: reduce hit area if layer is very small to prevent overlap
    if (isCorner) {
      // Make corner hit areas generous but not overlapping on small layers
      const baseHitRadius = isTouch ? Math.max(48, 64 * baseScale) : Math.max(20, 32 * baseScale)
      const hitAreaRadius = baseHitRadius * smallLayerScale
      handle.hitArea = new PIXI.Circle(0, 0, hitAreaRadius)
    } else {
      // Make edge hit areas larger and more forgiving
      const baseHitSize = isTouch ? Math.max(64, 80 * baseScale) : Math.max(32, 60 * baseScale)
      const hitAreaSize = baseHitSize * smallLayerScale
      handle.hitArea = new PIXI.Rectangle(-hitAreaSize / 2, -hitAreaSize / 2, hitAreaSize, hitAreaSize)
    }
    handle.zIndex = 10001

    let isHovered = false

    handle.on('pointerenter', () => {
      if (isLocked || interactionStateRef.current.resize || interactionStateRef.current.rotate) return
      isHovered = true
      handle.clear()

      if (isCorner) {
        // Larger on hover
        const hoverCornerRadius = 16 * scaledBase
        handle.circle(0, 0, hoverCornerRadius)
        handle.fill({ color: 0x8B5CF6 })
        handle.stroke({ color: 0xffffff, width: Math.max(1, 1.5 * scaledBase) })
      } else if (isSide) {
        const hoverExtra = 6 * scaledBase
        const hoverSideWidth = 32 * scaledBase
        const hoverSideHeight = 12 * scaledBase
        const hoverSideWidthVertical = 12 * scaledBase
        const hoverSideHeightVertical = 32 * scaledBase

        if (handleType === 'n' || handleType === 's') {
          handle.roundRect(-(hoverSideWidth + hoverExtra) / 2, -(hoverSideHeight + hoverExtra) / 2, hoverSideWidth + hoverExtra, hoverSideHeight + hoverExtra, 5 * scaledBase)
        } else {
          handle.roundRect(-(hoverSideWidthVertical + hoverExtra) / 2, -(hoverSideHeightVertical + hoverExtra) / 2, hoverSideWidthVertical + hoverExtra, hoverSideHeightVertical + hoverExtra, 5 * scaledBase)
        }
        handle.fill({ color: 0x8B5CF6 })
        handle.stroke({ color: 0xffffff, width: Math.max(1, 1.5 * scaledBase) })
      }

      const canvasEl = canvasRef.current
      if (canvasEl) canvasEl.style.cursor = rotatedCursor
    })

    handle.on('pointerleave', () => {
      if (interactionStateRef.current.resize || interactionStateRef.current.rotate) return
      isHovered = false
      handle.clear()

      if (isCorner) {
        const normalCornerRadius = 12 * scaledBase
        handle.circle(0, 0, normalCornerRadius)
        handle.fill({ color: 0xffffff })
        handle.stroke({ color: 0x8B5CF6, width: Math.max(1, 1.5 * scaledBase) })
      } else if (isSide) {
        const normalSideWidth = 32 * scaledBase
        const normalSideHeight = 12 * scaledBase
        const normalSideWidthVertical = 12 * scaledBase
        const normalSideHeightVertical = 32 * scaledBase

        if (handleType === 'n' || handleType === 's') {
          handle.roundRect(-normalSideWidth / 2, -normalSideHeight / 2, normalSideWidth, normalSideHeight, 5 * scaledBase)
        } else {
          handle.roundRect(-normalSideWidthVertical / 2, -normalSideHeightVertical / 2, normalSideWidthVertical, normalSideHeightVertical, 5 * scaledBase)
        }
        handle.fill({ color: 0xffffff })
        handle.stroke({ color: 0x8B5CF6, width: Math.max(1, 1.5 * scaledBase) })
      }

      const canvasEl = canvasRef.current
      if (canvasEl) canvasEl.style.cursor = isLocked ? 'not-allowed' : 'default'
    })
    handle.on('pointerdown', (e) => {
      if (e.nativeEvent) {
        e.nativeEvent.preventDefault?.()
      }
      e.stopPropagation()
      e.stopImmediatePropagation?.()
      if (isLocked) {
        if (onLockedInteraction) onLockedInteraction(e)
        return
      }
      handleResizeStart(handleType, cursor, e)
    })

    return handle
  }, [])

  // Create invisible hit areas that span entire sides for easier interaction
  const createSideHitArea = useCallback((rotation, localBoundsX, localBoundsY, scaledWidth, scaledHeight, handleResizeStart, handleType, cursor, zoomScale = 1, isLocked = false) => {
    const hitArea = new PIXI.Graphics()
    hitArea.alpha = isLocked ? 0.4 : 1.0
    hitArea.label = `selection-hitarea-${handleType}`
    hitArea.eventMode = 'static'
    hitArea.cursor = getRotatedCursor(handleType, rotation)
    hitArea.zIndex = 10000 // Below handles but above outline

    // Use dynamic hit area thickness for better interaction, scaled by zoom
    // Small layer optimization: reduce thickness for small layers to prevent side overlap
    const layerSizeRef = Math.min(scaledWidth, scaledHeight)
    const smallLayerScale = layerSizeRef < 60 ? Math.max(0.6, layerSizeRef / 60) : 1
    const baseScale = calculateAdaptedScale(zoomScale)
    const scaledHitAreaThickness = Math.max(4, 12 * baseScale * smallLayerScale)

    // Create invisible hit area that spans the entire side
    if (handleType === 'n' || handleType === 's') {
      // Top or bottom: full width, thin height
      hitArea.rect(-scaledWidth / 2, -scaledHitAreaThickness / 2, scaledWidth, scaledHitAreaThickness)
    } else {
      // Left or right: thin width, full height
      hitArea.rect(-scaledHitAreaThickness / 2, -scaledHeight / 2, scaledHitAreaThickness, scaledHeight)
    }

    // Make it invisible but interactive
    hitArea.fill({ color: 0x000000, alpha: 0 })

    // Set hit area to match the drawn area
    if (handleType === 'n' || handleType === 's') {
      hitArea.hitArea = new PIXI.Rectangle(-scaledWidth / 2, -scaledHitAreaThickness, scaledWidth, scaledHitAreaThickness * 2)
    } else {
      hitArea.hitArea = new PIXI.Rectangle(-scaledHitAreaThickness, -scaledHeight / 2, scaledHitAreaThickness * 2, scaledHeight)
    }

    // Position the hit area
    if (handleType === 'n') {
      // Top edge
      hitArea.x = localBoundsX + scaledWidth / 2
      hitArea.y = localBoundsY
    } else if (handleType === 's') {
      // Bottom edge
      hitArea.x = localBoundsX + scaledWidth / 2
      hitArea.y = localBoundsY + scaledHeight
    } else if (handleType === 'w') {
      // Left edge
      hitArea.x = localBoundsX
      hitArea.y = localBoundsY + scaledHeight / 2
    } else if (handleType === 'e') {
      // Right edge
      hitArea.x = localBoundsX + scaledWidth
      hitArea.y = localBoundsY + scaledHeight / 2
    }

    // No need to scale since we calculated the size already
    hitArea.scale.set(1, 1)

    // Update cursor on hover
    hitArea.on('pointerenter', () => {
      if (interactionStateRef.current.resize || interactionStateRef.current.rotate) return
      const canvasEl = canvasRef.current
      if (canvasEl) canvasEl.style.cursor = rotatedCursor
    })

    hitArea.on('pointerleave', () => {
      if (interactionStateRef.current.resize || interactionStateRef.current.rotate) return
      const canvasEl = canvasRef.current
      if (canvasEl) canvasEl.style.cursor = 'default'
    })

    // Start resize when clicking anywhere on the side
    hitArea.on('pointerdown', (e) => {
      if (e.nativeEvent) {
        e.nativeEvent.preventDefault?.()
      }
      e.stopPropagation()
      e.stopImmediatePropagation?.()
      if (isLocked) {
        if (onLockedInteraction) onLockedInteraction(e)
        return
      }
      handleResizeStart(handleType, cursor, e)
    })

    return hitArea
  }, [])

  // Create rotation handle with icon
  const createRotationHandle = useCallback((localBoundsX, localBoundsY, scaledWidth, scaledHeight, handleRotateStart, zoomScale = 1, isLocked = false) => {
    const rotationHandle = new PIXI.Container()
    rotationHandle.alpha = isLocked ? 0.4 : 1.0
    const layerSizeRef = Math.min(scaledWidth, scaledHeight)
    const smallLayerScale = layerSizeRef < 60 ? Math.max(0.6, layerSizeRef / 60) : 1

    // Draw white circle background at calculated size
    const baseScale = calculateAdaptedScale(zoomScale)
    const scaledBase = baseScale * smallLayerScale
    const radius = Math.max(10, 18 * scaledBase)

    const distanceFromBottom = radius + (45 * scaledBase)
    const rotationX = localBoundsX + scaledWidth / 2
    const rotationY = localBoundsY + scaledHeight + distanceFromBottom

    const background = new PIXI.Graphics()
    background.circle(0, 0, radius)
    background.fill({ color: 0xffffff })
    background.stroke({ color: 0x8B5CF6, width: Math.max(1, 1.5 * scaledBase) })
    rotationHandle.addChild(background)

    // Create icon container
    const icon = new PIXI.Graphics()
    rotationHandle.addChild(icon)

    // Helper to draw the "two curved arrows" icon (Canva style)
    const drawArrows = (graphics, color, size) => {
      graphics.clear()
      const s = size / 2
      const r = s * 0.85
      const arrowSize = s * 0.5

      // Arc angles (in radians)
      const arcLength = Math.PI * 0.6
      const gap = Math.PI * 0.4

      // Top Arc
      const topStart = -Math.PI * 0.5 - arcLength / 2
      const topEnd = -Math.PI * 0.5 + arcLength / 2

      // Bottom Arc
      const bottomStart = Math.PI * 0.5 - arcLength / 2
      const bottomEnd = Math.PI * 0.5 + arcLength / 2

      // Draw Arcs
      graphics.beginPath()
      graphics.arc(0, 0, r, topStart, topEnd)
      graphics.stroke({ color, width: 2, cap: 'round' })

      graphics.beginPath()
      graphics.arc(0, 0, r, bottomStart, bottomEnd)
      graphics.stroke({ color, width: 2, cap: 'round' })

      // Helper to draw a sharp arrowhead at a specific point on the circle
      const drawHead = (angle, isClockwise = true) => {
        const x = Math.cos(angle) * r
        const y = Math.sin(angle) * r

        // The tangent angle at this point on the circle
        // For clockwise movement, tangent is angle + PI/2
        const tangent = angle + (isClockwise ? Math.PI / 2 : -Math.PI / 2)

        // Arrow "wings" angle (how wide the head is)
        const spread = 0.8 // ~45 degrees

        const x1 = x - arrowSize * Math.cos(tangent - spread)
        const y1 = y - arrowSize * Math.sin(tangent - spread)
        const x2 = x - arrowSize * Math.cos(tangent + spread)
        const y2 = y - arrowSize * Math.sin(tangent + spread)

        graphics.moveTo(x, y)
        graphics.lineTo(x1, y1)
        graphics.moveTo(x, y)
        graphics.lineTo(x2, y2)
      }

      // Draw arrowheads at the ends of the arcs
      drawHead(topEnd, true)
      drawHead(bottomEnd, true)
      graphics.stroke({ color, width: 2, cap: 'round' })
    }

    const iconSize = Math.max(14, 20 * baseScale)
    drawArrows(icon, 0x000000, iconSize)

    rotationHandle.x = rotationX
    rotationHandle.y = rotationY
    rotationHandle.label = 'rotation-handle'
    rotationHandle.eventMode = 'static'
    rotationHandle.cursor = 'grab'
    rotationHandle.zIndex = 10001

    // Sync hit area with visual radius
    rotationHandle.hitArea = new PIXI.Circle(0, 0, radius)

    rotationHandle.on('pointerenter', () => {
      if (interactionStateRef.current.resize || interactionStateRef.current.rotate) return

      background.clear()
      background.circle(0, 0, radius)
      background.fill({ color: 0xffffff })
      background.stroke({ color: 0x8B5CF6, width: Math.max(1, 1.5 * baseScale) })

      drawArrows(icon, 0xffffff, iconSize)

      const canvasEl = canvasRef.current
      if (canvasEl) canvasEl.style.cursor = 'grab'
    })

    rotationHandle.on('pointerleave', () => {
      if (interactionStateRef.current.resize || interactionStateRef.current.rotate) return

      background.clear()
      background.circle(0, 0, radius)
      background.fill({ color: 0xffffff })
      background.stroke({ color: 0x8B5CF6, width: Math.max(1, 1.5 * baseScale) })

      drawArrows(icon, 0x000000, iconSize)

      const canvasEl = canvasRef.current
      if (canvasEl) canvasEl.style.cursor = 'default'
    })

    rotationHandle.on('pointerdown', (e) => {
      if (e.nativeEvent) {
        e.nativeEvent.preventDefault?.()
      }
      e.stopPropagation()
      e.stopImmediatePropagation?.()
      if (isLocked) {
        if (onLockedInteraction) onLockedInteraction(e)
        return
      }
      handleRotateStart(e)
    })

    return rotationHandle
  }, [])


  // ===========================================================================
  // THROTTLED UPDATES - Efficiently syncs changes to Redux store (60fps max)
  // ===========================================================================

  const throttledUpdate = useCallback((updates) => {
    pendingUpdateRef.current = { ...updates }

    if (updateThrottleRef.current) return

    updateThrottleRef.current = requestAnimationFrame(() => {
      if (pendingUpdateRef.current && latestOnUpdateRef.current) {
        latestOnUpdateRef.current(pendingUpdateRef.current)
        pendingUpdateRef.current = null
      }
      updateThrottleRef.current = null
    })
  }, [])


  // ===========================================================================
  // IMMEDIATE TEXT UPDATE FUNCTION - For smooth visual feedback during resize
  // ===========================================================================

  const immediateTextUpdate = useCallback((textObject, newWidth, isCornerHandle, state, currentLayer) => {
    const isWidthOnly = !isCornerHandle

    if (isWidthOnly) {
      // Only adjust width, keep font size constant
      textObject.style.wordWrapWidth = newWidth
    } else if (isCornerHandle) {
      // Scale font size proportionally
      const widthScale = newWidth / state.startWidth
      const newFontSize = Math.max(8, state.startFontSize * widthScale)
      textObject.style.fontSize = newFontSize
      textObject.style.wordWrapWidth = newWidth
      textObject.style.lineHeight = newFontSize * 1.2 // Ensure line height scales for consistency
    }

    // Update text SYNCHRONOUSLY to ensure immediate bounds update for measuring
    textObject.updateText?.(true)
  }, [])


  // ===========================================================================
  // SYNC BOX VISUALS - Drawing logic that can be called synchronously
  // ===========================================================================

  const syncBoxVisuals = useCallback(() => {
    const currentLayer = latestLayerRef.current
    const currentLayerObject = latestLayerObjectRef.current
    const box = selectionBoxRef.current

    if (!currentLayer || !currentLayerObject || currentLayerObject.destroyed || !box) {
      return
    }

    const rs = interactionStateRef.current.resize
    const rotateState = interactionStateRef.current.rotate

    // Calculate current dimensions using unified helper
    const dims = getCurrentLayerDimensions(currentLayer, currentLayerObject)
    let currentWidth = dims.width
    let currentHeight = dims.height

    // [FIX] Explicitly lock text dimensions to exactly what updateHoverBox uses to fix offset issues.
    // NOTE: This must ONLY apply during Motion Capture Mode, otherwise it breaks live typing box size in Normal Mode.
    if (currentLayerObject instanceof PIXI.Text && latestMotionCaptureModeRef.current?.isActive) {
      const textDims = calculateTextDimensions(currentLayerObject, currentLayer)
      currentWidth = textDims.width
      currentHeight = textDims.height
    }

    // Live Resize Override
    if (rs) {
      if (rs._lastWidth !== undefined) currentWidth = rs._lastWidth
      if (rs._lastHeight !== undefined) currentHeight = rs._lastHeight
    }

    let rotation = getCurrentLayerRotation(currentLayer, currentLayerObject)
    if (rotateState) {
      if (rotateState._lastRotation !== undefined) rotation = rotateState._lastRotation
    }

    const { scaleX, scaleY } = getCurrentLayerScale(currentLayer, currentLayerObject)

    const dimensionsChanged = currentHeight !== lastKnownHeightRef.current || currentWidth !== lastKnownWidthRef.current
    const scaleChanged = scaleX !== lastKnownScaleXRef.current || scaleY !== lastKnownScaleYRef.current
    const rotationChanged = Math.abs(rotation - (lastKnownRotationRef?.current || 0)) > 0.01
    const shouldRedraw = forceRedrawRef.current || dimensionsChanged || scaleChanged || rotationChanged

    // CRITICAL FIX: Ensure position and rotation ALWAYS track true layer coords instantly
    const cachedDragState = dragStateAPI && currentLayer?.id ? dragStateAPI.getLayerDragState(currentLayer.id) : null
    const position = getCurrentLayerPosition(currentLayer, currentLayerObject, cachedDragState)
    let x = position.x
    let y = position.y

    if (rs) {
      if (rs._lastX !== undefined) x = rs._lastX
      if (rs._lastY !== undefined) y = rs._lastY
    }

    // For PIXI.Graphics shapes (rect, circle, triangle, hexagon, star, line, …) we do NOT
    // compute a local-bounds center offset here.  All shapes are drawn via drawShapePath with
    // their geometric center at local (0, 0) for anchor=0.5, and applyTransformInline no longer
    // applies a corrective scale on Graphics objects.  Using getLocalBounds() on an asymmetric
    // shape (like a 5-point star whose outer points don't span the full ±halfHeight range in Y)
    // produces a non-zero offset that shifts the selection box away from the hover box,
    // causing visual misalignment and the "jump" artefact during resize.
    //
    // For non-Graphics objects (Text, Sprite, Container/image/video) the offset is still
    // computed because their origin may legitimately differ from the visual centre.
    let boundsCenterX = 0
    let boundsCenterY = 0
    if (
      !(currentLayerObject instanceof PIXI.Graphics) &&
      !(currentLayerObject instanceof PIXI.Text) &&
      !(currentLayerObject instanceof PIXI.Sprite) &&
      !(currentLayerObject instanceof PIXI.Container && (currentLayerObject._imageSprite || currentLayerObject._videoSprite))
    ) {
      try {
        const actualBounds = currentLayerObject.getLocalBounds()
        boundsCenterX = actualBounds.x + actualBounds.width / 2
        boundsCenterY = actualBounds.y + actualBounds.height / 2
      } catch (e) {
        // Fallback silently
      }
    }

    box.x = x + boundsCenterX
    box.y = y + boundsCenterY
    box.rotation = (rotation * Math.PI) / 180

    if (shouldRedraw) {
      if (forceRedrawRef.current) forceRedrawRef.current = false
      lastKnownHeightRef.current = currentHeight
      lastKnownWidthRef.current = currentWidth
      lastKnownScaleXRef.current = scaleX
      lastKnownScaleYRef.current = scaleY
      if (lastKnownRotationRef) lastKnownRotationRef.current = rotation

      const { anchorX, anchorY } = resolveAnchors(currentLayer, currentLayerObject)
      const viewportScale = latestViewportRef.current?.scale?.x || 1
      const zoomScale = 1 / viewportScale

      const scaledWidth = currentWidth * scaleX
      const scaledHeight = currentHeight * scaleY
      const localBoundsX = -scaledWidth * anchorX
      const localBoundsY = -scaledHeight * anchorY

      // Synchronous visual update for outline and hitArea
      const outline = box.children.find(c => c.label === 'selection-outline')
      if (outline && !outline.destroyed) {
        outline.clear()
        outline.rect(localBoundsX, localBoundsY, scaledWidth, scaledHeight)

        // [FIX] ZOOM ADAPTIVE: Keep outline visually consistent regardless of zoom
        const baseScale = calculateAdaptedScale(zoomScale)
        outline.stroke({ color: 0x8B5CF6, width: 1.5 * baseScale })
      }

      // Update handle positions and rotation handle
      box.children.forEach(child => {
        if (!child.label) return

        if (child.label.startsWith('selection-handle-')) {
          const type = child.label.replace('selection-handle-', '')
          let hx = localBoundsX, hy = localBoundsY
          if (type.includes('e')) hx += scaledWidth
          else if (!type.includes('w')) hx += scaledWidth / 2

          if (type.includes('s')) hy += scaledHeight
          else if (!type.includes('n')) hy += scaledHeight / 2

          child.x = hx; child.y = hy
          child.cursor = getRotatedCursor(type, rotation)
        } else if (child.label.startsWith('selection-hitarea-')) {
          const type = child.label.replace('selection-hitarea-', '')
          // Use the helper logic to reposition hit areas (simpler to just follow the sides)
          if (type === 'n') { child.x = localBoundsX + scaledWidth / 2; child.y = localBoundsY }
          else if (type === 's') { child.x = localBoundsX + scaledWidth / 2; child.y = localBoundsY + scaledHeight }
          else if (type === 'w') { child.x = localBoundsX; child.y = localBoundsY + scaledHeight / 2 }
          else if (type === 'e') { child.x = localBoundsX + scaledWidth; child.y = localBoundsY + scaledHeight / 2 }
        } else if (child.label === 'rotation-handle') {
          const baseScale = calculateAdaptedScale(zoomScale)
          // Use the same small layer logic as creation for perfect sync
          const layerSizeRef = Math.min(scaledWidth, scaledHeight)
          const smallLayerScale = layerSizeRef < 60 ? Math.max(0.6, layerSizeRef / 60) : 1
          const radius = Math.max(10, 18 * baseScale * smallLayerScale)

          child.x = localBoundsX + scaledWidth / 2
          child.y = localBoundsY + scaledHeight + radius + (45 * baseScale)
        }
      })
    }
  }, [dragStateAPI, layersContainer, calculateTextDimensions, getCurrentLayerPosition, getCurrentLayerRotation, resolveAnchors, getCurrentLayerScale, getCurrentLayerDimensions])


  const handleResizeMove = useCallback((worldPos) => {
    const state = interactionStateRef.current.resize
    const currentLayerObject = latestLayerObjectRef.current
    const currentLayer = latestLayerRef.current

    if (!state || !currentLayerObject || currentLayerObject.destroyed || !currentLayer) {
      return
    }

    const worldDeltaX = worldPos.x - state.startMouseX
    const worldDeltaY = worldPos.y - state.startMouseY

    const trig = getTrigValues(state.rotationRad)
    const localDeltaX = worldDeltaX * trig.cos - worldDeltaY * trig.sin
    const localDeltaY = worldDeltaX * trig.sin + worldDeltaY * trig.cos

    const isCornerHandle = ['nw', 'ne', 'sw', 'se'].includes(state.handleType)
    const shiftKey = state.shiftKey || false
    const currentMotionCaptureMode = latestMotionCaptureModeRef.current
    const isCaptureMode = currentMotionCaptureMode?.isActive

    const maintainAspectRatio = (shiftKey && isCornerHandle) || (state.isTextElement && isCornerHandle) || (isCaptureMode && isCornerHandle) || (state.isMediaElement && isCornerHandle)

    const transformFunc = handleTransformCache.current[state.handleType]
    if (!transformFunc) return

    const transform = transformFunc(localDeltaX, localDeltaY, state, maintainAspectRatio, currentMotionCaptureMode)
    let { newWidth, newHeight, localOffsetX, localOffsetY } = transform

    const worldOffsetX = localOffsetX * trig.cosPos - localOffsetY * trig.sinPos
    const worldOffsetY = localOffsetX * trig.sinPos + localOffsetY * trig.cosPos

    let newX = state.startX + worldOffsetX
    let newY = state.startY + worldOffsetY

    const updates = {}
    if (Math.abs(newWidth - state.startWidth) > 0.01) updates.width = newWidth
    if (Math.abs(newHeight - state.startHeight) > 0.01) updates.height = newHeight
    if (Math.abs(newX - state.startX) > 0.01) updates.x = newX
    if (Math.abs(newY - state.startY) > 0.01) updates.y = newY

    const centerSnap = { x: newX, y: newY, alignmentGuides: [], releaseGuides: () => { } }
    const safeZoneSnap = { x: newX, y: newY, alignmentGuides: [], releaseGuides: () => { } }

    const snapShiftX = safeZoneSnap.x - newX
    const snapShiftY = safeZoneSnap.y - newY

    if (Math.abs(snapShiftX) > 0.01 || Math.abs(snapShiftY) > 0.01) {
      const allowsX = ['e', 'w', 'ne', 'nw', 'se', 'sw'].includes(state.handleType)
      const allowsY = ['n', 's', 'ne', 'nw', 'se', 'sw'].includes(state.handleType)
      const { anchorX, anchorY } = resolveAnchors(currentLayer, currentLayerObject)
      const { scaleX, scaleY } = getCurrentLayerScale(currentLayer, currentLayerObject)

      let snappedWidth = newWidth
      let snappedHeight = newHeight
      let didSnapX = false
      let didSnapY = false

      if (allowsX && Math.abs(snapShiftX) > 0.01) {
        if (['e', 'ne', 'se'].includes(state.handleType)) {
          snappedWidth = newWidth + snapShiftX / Math.abs(scaleX)
          didSnapX = true
        } else if (['w', 'nw', 'sw'].includes(state.handleType)) {
          snappedWidth = newWidth - snapShiftX / Math.abs(scaleX)
          didSnapX = true
        }
      }

      if (allowsY && Math.abs(snapShiftY) > 0.01) {
        if (['s', 'sw', 'se'].includes(state.handleType)) {
          snappedHeight = newHeight + snapShiftY / Math.abs(scaleY)
          didSnapY = true
        } else if (['n', 'nw', 'ne'].includes(state.handleType)) {
          snappedHeight = newHeight - snapShiftY / Math.abs(scaleY)
          didSnapY = true
        }
      }

      if (maintainAspectRatio && (didSnapX || didSnapY)) {
        const ratio = state.startWidth / state.startHeight
        if (didSnapX) snappedHeight = snappedWidth / ratio
        else if (didSnapY) snappedWidth = snappedHeight * ratio
      }

      snappedWidth = Math.max(1, snappedWidth)
      snappedHeight = Math.max(1, snappedHeight)

      if (Math.abs(snappedWidth - newWidth) > 0.01 || Math.abs(snappedHeight - newHeight) > 0.01) {
        newWidth = snappedWidth
        newHeight = snappedHeight

        let newLocalOffsetX = 0
        let newLocalOffsetY = 0

        if (['e', 'ne', 'se'].includes(state.handleType)) {
          newLocalOffsetX = (newWidth - state.startWidth) * state.scaleX * anchorX
        } else if (['w', 'nw', 'sw'].includes(state.handleType)) {
          newLocalOffsetX = -(newWidth - state.startWidth) * state.scaleX * (1 - anchorX)
        }

        if (['s', 'sw', 'se'].includes(state.handleType)) {
          newLocalOffsetY = (newHeight - state.startHeight) * state.scaleY * anchorY
        } else if (['n', 'nw', 'ne'].includes(state.handleType)) {
          newLocalOffsetY = -(newHeight - state.startHeight) * state.scaleY * (1 - anchorY)
        }

        if (isCaptureMode) {
          newLocalOffsetX = 0
          newLocalOffsetY = 0
        }

        const worldOffsetX = newLocalOffsetX * trig.cosPos - newLocalOffsetY * trig.sinPos
        const worldOffsetY = newLocalOffsetX * trig.sinPos + newLocalOffsetY * trig.cosPos

        newX = state.startX + worldOffsetX
        newY = state.startY + worldOffsetY

        updates.width = newWidth
        updates.height = newHeight
        updates.x = newX
        updates.y = newY
      }
    }

    const isMediaEdgeResize = state.isMediaElement && ['n', 's', 'e', 'w'].includes(state.handleType)

    if (isCaptureMode) {
      if (!isMediaEdgeResize) {
        // [FIX] Double-Scaling Prevention: When scaling in capture mode, 
        // keep _lastWidth/Height at start dimensions so syncBoxVisuals doesn't multiple scaled-base by scale again.
        state._lastWidth = state.startWidth
        state._lastHeight = state.startHeight
      } else {
        // For edge resizing (cropping), we update dimensions directly
        state._lastWidth = newWidth
        state._lastHeight = newHeight
      }
    } else {
      state._lastWidth = newWidth
      state._lastHeight = newHeight
    }
    state._lastX = newX
    state._lastY = newY

    syncBoxVisuals()
    updateSnappingGuides(centerSnap, safeZoneSnap)

    if (Object.keys(updates).length > 0) {
      const targetObject = currentLayerObject._cachedSprite || currentLayerObject
      const isMediaEdgeResize = state.isMediaElement && ['n', 's', 'e', 'w'].includes(state.handleType)

      if (isCaptureMode && !isMediaEdgeResize) {
        const newScaleX = (newWidth / state.startWidth) * state.scaleX
        const newScaleY = (newHeight / state.startHeight) * state.scaleY
        const align = currentLayer.data?.textAlign || 'left'
        const anchorX = align === 'center' ? 0.5 : (align === 'right' ? 1 : 0)

        if (targetObject instanceof PIXI.Container && targetObject._imageSprite) {
          targetObject.scale.set(newScaleX, newScaleY)
        } else if (targetObject instanceof PIXI.Sprite) {
          targetObject.width = newWidth * state.scaleX
          targetObject.height = newHeight * state.scaleY
        } else if (targetObject instanceof PIXI.Text) {
          targetObject.scale.set(newScaleX, newScaleY)
          targetObject.x = newX
          targetObject.y = newY
          targetObject._selectionBoxX = newX
          targetObject._selectionBoxY = newY
          targetObject.anchor.set(anchorX, 0)
          targetObject.pivot.set((0.5 - anchorX) * state.startWidth, state.startHeight / 2)
        } else {
          targetObject.scale.set(newScaleX, newScaleY)
          targetObject.x = newX
          targetObject.y = newY
        }
      } else if (!(currentLayerObject instanceof PIXI.Text)) {
        targetObject.x = newX
        targetObject.y = newY

        if (!state.isMediaElement || !isMediaEdgeResize) {
          if (targetObject instanceof PIXI.Sprite) {
            targetObject.width = newWidth * state.scaleX
            targetObject.height = newHeight * state.scaleY
          } else if (targetObject instanceof PIXI.Graphics) {
            const sx = newWidth / (state.startWidth || 100)
            const sy = newHeight / (state.startHeight || 100)
            targetObject.scale.set(sx * state.scaleX, sy * state.scaleY)
          } else if (targetObject instanceof PIXI.Container && targetObject._imageSprite) {
            // [SYNC FIX] Apply scale ONLY if NOT in capture mode edge resizing
            const sx = newWidth / (state.startWidth || 100)
            const sy = newHeight / (state.startHeight || 100)
            // DO NOT apply `.scale.set()` to the container for media in normal mode
            // Redux updates trigger createLayer to sync crop parameters internally
            if (isCaptureMode) {
              targetObject.scale.set(sx * state.scaleX, sy * state.scaleY)
            } else {
              // In normal mode, we simply update Redux state via the 'updates' object
              // container and sprite will sync automatically without double-scaling
            }
          }
        }
      }

      if (currentLayerObject instanceof PIXI.Text && !isCaptureMode) {
        const isCorner = ['nw', 'ne', 'sw', 'se'].includes(state.handleType)
        immediateTextUpdate(currentLayerObject, newWidth, isCorner, state, currentLayer)

        if (isCorner) {
          const widthScale = newWidth / state.startWidth
          const newFontSize = Math.max(8, state.startFontSize * widthScale)
          updates.data = { ...(updates.data || {}), ...currentLayer.data, fontSize: newFontSize }
        }

        const textDims = calculateTextDimensions(currentLayerObject, currentLayer, newWidth)
        if (Math.abs(textDims.height - state.startHeight) > 1) updates.height = textDims.height
        cachedTextHeightRef.current = textDims.height

        targetObject.x = newX
        targetObject.y = newY
        const align = currentLayer.data?.textAlign || 'left'
        const anchorX = align === 'center' ? 0.5 : (align === 'right' ? 1 : 0)
        targetObject.anchor.set(anchorX, 0)
        targetObject.pivot.set((0.5 - anchorX) * newWidth, textDims.height / 2)
        targetObject._selectionBoxX = newX
        targetObject._selectionBoxY = newY

        throttledUpdate(updates)
      } else if (currentLayerObject instanceof PIXI.Text && isCaptureMode) {
        if (currentMotionCaptureMode?.isActive) {
          const newScaleX = (newWidth / state.startWidth) * state.scaleX
          const newScaleY = (newHeight / state.startHeight) * state.scaleY
          const capturedLayer = currentMotionCaptureMode.trackedLayers?.get(currentLayer.id)
          const currentRotation = capturedLayer?.rotation ?? (currentLayer.rotation || 0)

          currentMotionCaptureMode.onPositionUpdate({
            layerId: currentLayer.id,
            x: newX,
            y: newY,
            scaleX: newScaleX,
            scaleY: newScaleY,
            rotation: currentRotation,
            interactionType: 'resize'
          })
        }
      } else if (isCaptureMode && (!state.isMediaElement || !isMediaEdgeResize)) {
        if (currentMotionCaptureMode?.isActive) {
          const newScaleX = (newWidth / state.startWidth) * state.scaleX
          const newScaleY = (newHeight / state.startHeight) * state.scaleY
          const capturedLayer = currentMotionCaptureMode.trackedLayers?.get(currentLayer.id)
          const currentRotation = capturedLayer?.rotation ?? (currentLayer.rotation || 0)

          currentMotionCaptureMode.onPositionUpdate({
            layerId: currentLayer.id,
            x: newX,
            y: newY,
            scaleX: newScaleX,
            scaleY: newScaleY,
            rotation: currentRotation,
            interactionType: 'resize'
          })
        }
      }

      if (state.isMediaElement) {
        const isEdgeHandle = ['n', 's', 'e', 'w'].includes(state.handleType)
        const sprite = currentLayerObject._imageSprite || currentLayerObject._videoSprite
        const cropMask = currentLayerObject._cropMask
        const shouldProcess = !isCaptureMode || isEdgeHandle

        if (shouldProcess) {
          if (isEdgeHandle && sprite && cropMask) {
            const widthDelta = newWidth - state.startWidth
            const heightDelta = newHeight - state.startHeight
            let newCropX = state.startCropX
            let newCropY = state.startCropY
            let newCropWidth = state.startCropWidth
            let newCropHeight = state.startCropHeight
            const minCropSize = 10

            if (isCaptureMode) {
              if (state.handleType === 'e' || state.handleType === 'w') {
                const rawCropWidth = state.startCropWidth + widthDelta
                const shift = widthDelta / 2
                const rawCropX = state.startCropX - shift
                newCropWidth = Math.max(minCropSize, Math.min(state.startMediaWidth, rawCropWidth))
                newCropX = Math.max(0, Math.min(state.startMediaWidth - newCropWidth, rawCropX))
                const startCenter = state.startCropX + state.startCropWidth / 2
                const currentCenter = newCropX + newCropWidth / 2
                const centerShiftX = currentCenter - startCenter
                newX = state.startX + centerShiftX * trig.cosPos
                newY = state.startY + centerShiftX * trig.sinPos
                newWidth = newCropWidth
              } else if (state.handleType === 's' || state.handleType === 'n') {
                const rawCropHeight = state.startCropHeight + heightDelta
                const shift = heightDelta / 2
                const rawCropY = state.startCropY - shift
                newCropHeight = Math.max(minCropSize, Math.min(state.startMediaHeight, rawCropHeight))
                newCropY = Math.max(0, Math.min(state.startMediaHeight - newCropHeight, rawCropY))
                const startCenter = state.startCropY + state.startCropHeight / 2
                const currentCenter = newCropY + newCropHeight / 2
                const centerShiftY = currentCenter - startCenter
                newX = state.startX - centerShiftY * trig.sinPos
                newY = state.startY + centerShiftY * trig.cosPos
                newHeight = newCropHeight
              }
            } else {
              if (state.handleType === 'e') newCropWidth = Math.max(minCropSize, Math.min(state.startMediaWidth - newCropX, state.startCropWidth + widthDelta))
              else if (state.handleType === 'w') {
                const shift = -(newWidth - state.startWidth)
                newCropX = Math.max(0, Math.min(state.startMediaWidth - minCropSize, state.startCropX + shift))
                newCropWidth = Math.max(minCropSize, Math.min(state.startMediaWidth - newCropX, state.startCropWidth - shift))
              } else if (state.handleType === 's') newCropHeight = Math.max(minCropSize, Math.min(state.startMediaHeight - newCropY, state.startCropHeight + heightDelta))
              else if (state.handleType === 'n') {
                const shift = -(newHeight - state.startHeight)
                newCropY = Math.max(0, Math.min(state.startMediaHeight - minCropSize, state.startCropY + shift))
                newCropHeight = Math.max(minCropSize, Math.min(state.startMediaHeight - newCropY, state.startCropHeight - shift))
              }
            }

            cropMask.clear().rect(0, 0, newCropWidth, newCropHeight).fill(0xffffff)
            sprite.x = -newCropX
            sprite.y = -newCropY
            currentLayerObject.pivot.set(newCropWidth * state.anchorX, newCropHeight * state.anchorY)

            if (isCaptureMode) {
              const liveLayer = latestMotionCaptureModeRef.current?.trackedLayers?.get(currentLayer.id)
              // [SCALE FIX] Preserve existing scale values when cropping - don't reset to 1
              // The scale should remain as it was set during previous scale operations
              const preservedScaleX = liveLayer?.scaleX ?? (state.scaleX ?? 1)
              const preservedScaleY = liveLayer?.scaleY ?? (state.scaleY ?? 1)

              currentMotionCaptureMode.onPositionUpdate({
                layerId: currentLayer.id, x: newX, y: newY, cropX: newCropX, cropY: newCropY,
                cropWidth: newCropWidth, cropHeight: newCropHeight, mediaWidth: state.startMediaWidth, mediaHeight: state.startMediaHeight,
                interactionType: 'crop'
              })
              if (liveLayer) {
                liveLayer.currentPosition = { x: newX, y: newY }
                liveLayer.cropX = newCropX; liveLayer.cropY = newCropY; liveLayer.cropWidth = newCropWidth; liveLayer.cropHeight = newCropHeight
                // [SCALE FIX] Preserve scale values instead of resetting to 1
                // This ensures that if the user scaled the layer before cropping, the scale is maintained
                liveLayer.scaleX = preservedScaleX
                liveLayer.scaleY = preservedScaleY
              }
              newWidth = newCropWidth; newHeight = newCropHeight
              updateHoverBox(newX, newY, newWidth, newHeight, state.rotation, state.anchorX, state.anchorY, preservedScaleX, preservedScaleY, latestViewportRef.current.scale.x)
            } else {
              updates.width = newCropWidth; updates.height = newCropHeight; updates.cropX = newCropX; updates.cropY = newCropY
              updates.cropWidth = newCropWidth; updates.cropHeight = newCropHeight; updates.mediaWidth = state.startMediaWidth; updates.mediaHeight = state.startMediaHeight
              // CRITICAL: Force scale to 1 in Redux since crop uses width/height directly
              updates.scaleX = 1; updates.scaleY = 1;
            }
          } else if (!isEdgeHandle && sprite) {
            const scaleRatio = newWidth / state.startWidth
            sprite.width = state.startMediaWidth * scaleRatio
            sprite.height = state.startMediaHeight * scaleRatio
            sprite.x = -(state.startCropX * scaleRatio)
            sprite.y = -(state.startCropY * scaleRatio)
            if (cropMask) cropMask.clear().rect(0, 0, state.startCropWidth * scaleRatio, state.startCropHeight * scaleRatio).fill(0xffffff)
            currentLayerObject.pivot.set(state.startCropWidth * scaleRatio * state.anchorX, state.startCropHeight * scaleRatio * state.anchorY)
            updates.width = state.startCropWidth * scaleRatio; updates.height = state.startCropHeight * scaleRatio
            updates.cropX = state.startCropX * scaleRatio; updates.cropY = state.startCropY * scaleRatio
            updates.cropWidth = state.startCropWidth * scaleRatio; updates.cropHeight = state.startCropHeight * scaleRatio
            updates.mediaWidth = state.startMediaWidth * scaleRatio; updates.mediaHeight = state.startMediaHeight * scaleRatio
            // CRITICAL: Force scale to 1 in Redux since resize uses width/height directly
            updates.scaleX = 1; updates.scaleY = 1;
          }
          currentLayerObject.x = newX
          currentLayerObject.y = newY
        }
      } else if (!isCaptureMode && currentLayerObject instanceof PIXI.Graphics && currentLayerObject._storedWidth !== undefined) {
        if (currentLayer?.data) {
          const shapeData = currentLayer.data
          currentLayerObject.scale.set(1, 1)
          const fill = shapeData.fill && shapeData.fill !== 'transparent' ? parseInt(shapeData.fill.replace('#', ''), 16) : null
          let stroke = shapeData.stroke ? parseInt(shapeData.stroke.replace('#', ''), 16) : (shapeData.strokeWidth > 0 ? 0 : null)
          const strokeWidth = shapeData.strokeWidth || 0
          const anchorOffsetX = -newWidth * state.anchorX
          const anchorOffsetY = -newHeight * state.anchorY
          const shapeType = shapeData.shapeType || 'rect'
          const isCircle = shapeType === 'circle'
          const centerX = anchorOffsetX + newWidth / 2
          const centerY = anchorOffsetY + newHeight / 2

          currentLayerObject.clear()
          // drawShapePath fills exactly newWidth × newHeight — keeps PIXI bbox in sync with layer dims
          drawShapePath(currentLayerObject, shapeType, centerX, centerY, newWidth, newHeight, shapeData.cornerRadius || 0)

          if (fill !== null) currentLayerObject.fill(fill)
          else currentLayerObject.fill({ color: 0, alpha: 0 })

          if (stroke !== null && strokeWidth > 0) {
            if (shapeData.strokeStyle === 'dashed' || shapeData.strokeStyle === 'dotted') {
              const dashLen = shapeData.strokeStyle === 'dotted' ? 0 : strokeWidth * 4
              const gapLen = strokeWidth * 2
              if (isCircle) {
                currentLayerObject.ellipse(centerX, centerY, newWidth / 2, newHeight / 2)
                currentLayerObject.stroke({ color: stroke, width: strokeWidth })
              } else {
                drawDashedRect(currentLayerObject, anchorOffsetX, anchorOffsetY, newWidth, newHeight, shapeData.cornerRadius || 0, stroke, strokeWidth, dashLen, gapLen)
              }
            } else {
              drawShapePath(currentLayerObject, shapeType, centerX, centerY, newWidth, newHeight, shapeData.cornerRadius || 0)
              currentLayerObject.stroke({ color: stroke, width: strokeWidth })
            }
          }
          currentLayerObject._storedWidth = newWidth; currentLayerObject._storedHeight = newHeight
          currentLayerObject.hitArea = fill === null ? (isCircle ? new PIXI.Ellipse(centerX, centerY, newWidth / 2, newHeight / 2) : new PIXI.Rectangle(anchorOffsetX, anchorOffsetY, newWidth, newHeight)) : null
        }
      }

      let hoverBoxHeight = newHeight
      if (currentLayerObject instanceof PIXI.Text) {
        hoverBoxHeight = calculateTextDimensions(currentLayerObject, latestLayerRef.current, newWidth).height
      }

      if (hoverBoxRef.current?.visible) {
        const viewportScale = latestViewportRef.current.scale.x
        const zoomScale = 1 / viewportScale
        if (isCaptureMode && !isMediaEdgeResize) {
          const currentScaleX = (newWidth / state.startWidth) * (state.scaleX || 1)
          const currentScaleY = (newHeight / state.startHeight) * (state.scaleY || 1)
          updateHoverBox(newX, newY, state.startWidth, state.initialTextHeight || state.startHeight, state.rotation, 0.5, 0.5, currentScaleX, currentScaleY, zoomScale)
        } else {
          updateHoverBox(newX, newY, newWidth, hoverBoxHeight, state.rotation, state.anchorX, state.anchorY, state.scaleX || 1, state.scaleY || 1, zoomScale)
        }
      }

      if (dimensionsBadgeRef.current) {
        const badge = dimensionsBadgeRef.current
        const zoomScale = 1 / latestViewportRef.current.scale.x
        badge.x = worldPos.x + (96 * zoomScale)
        badge.y = worldPos.y + (48 * zoomScale)
        updateDimensionsBadge(badge, { width: newWidth, height: hoverBoxHeight, zoomScale, viewportScale: latestViewportRef.current.scale.x })
      }
      if (!isCaptureMode) throttledUpdate(updates)
    }
  }, [syncBoxVisuals, immediateTextUpdate, calculateTextDimensions, updateHoverBox, throttledUpdate, resolveAnchors, getCurrentLayerScale, updateSnappingGuides, latestViewportRef])

  const handleResizeEnd = useCallback(() => {
    if (!interactionStateRef.current.resize) return

    const currentLayer = latestLayerRef.current
    const currentLayerObject = latestLayerObjectRef.current

    if (updateThrottleRef.current) {
      cancelAnimationFrame(updateThrottleRef.current)
      updateThrottleRef.current = null
    }
    if (pendingUpdateRef.current && latestOnUpdateRef.current) {
      const isMedia = currentLayer?.type === LAYER_TYPES.IMAGE || currentLayer?.type === LAYER_TYPES.VIDEO
      if (typeof console !== 'undefined' && console.log && isMedia && currentLayerObject) {
        console.log('[useSelectionBox] handleResizeEnd flushing pending (media)', {
          layerId: currentLayer?.id,
          pendingUpdate: pendingUpdateRef.current,
          pixiBefore: { x: currentLayerObject.x, y: currentLayerObject.y, pivotX: currentLayerObject.pivot?.x, pivotY: currentLayerObject.pivot?.y }
        })
      }
      latestOnUpdateRef.current(pendingUpdateRef.current)
      pendingUpdateRef.current = null
    }

    const currentViewport = latestViewportRef.current
    resumeViewportDragPlugin(currentViewport)

    const canvas = canvasRef.current
    if (canvas) canvas.style.cursor = 'default'

    if (currentLayerObject && !currentLayerObject.destroyed) {
      const isTextElement = currentLayerObject instanceof PIXI.Text
      const isImageElement = currentLayer?.type === LAYER_TYPES.IMAGE || currentLayer?.type === LAYER_TYPES.VIDEO

      if (isTextElement) {
        currentLayerObject.updateText?.(false)
        const finalDimensions = calculateTextDimensions(currentLayerObject, currentLayer)
        const finalUpdates = { height: finalDimensions.height }
        const currentWidth = currentLayer.width || 100
        if (currentLayerObject.style) {
          currentLayerObject.style.wordWrapWidth = currentWidth
          finalUpdates.width = currentWidth
        }

        if (latestOnUpdateRef.current) latestOnUpdateRef.current(finalUpdates)
        cachedTextHeightRef.current = finalDimensions.height
        lastTextWidthRef.current = currentWidth

        // Removed visual reversion to N-1 to prevent flicker before Redux update N arrives
      } else if (isImageElement) {
        // Handle image element resize end if needed,
        // but avoid forcefully reverting visual crop properties to currentLayer state
        // to prevent UI flicker before Redux update N arrives.
      }

      currentLayerObject._isResizing = false
      if (currentLayerObject._cachedSprite && !currentLayerObject._cachedSprite.destroyed) {
        currentLayerObject._cachedSprite._isResizing = false
      }

      const prev = interactionStateRef.current.resize.prevEventMode
      const restoredEventMode = prev !== undefined ? prev : 'static'
      currentLayerObject.eventMode = restoredEventMode
      if (currentLayerObject._cachedSprite && !currentLayerObject._cachedSprite.destroyed) {
        currentLayerObject._cachedSprite.eventMode = restoredEventMode
      }
    }

    interactionStateRef.current.resize = null
    dragStateAPI.setInteractionState(false, false)

    if (dimensionsBadgeRef.current) {
      if (dimensionsBadgeRef.current.parent) dimensionsBadgeRef.current.parent.removeChild(dimensionsBadgeRef.current)
      dimensionsBadgeRef.current.destroy({ children: true })
      dimensionsBadgeRef.current = null
    }

    hideHoverBox()
    setForceUpdate(prev => prev + 1)
  }, [dragStateAPI, calculateTextDimensions, hideHoverBox, setForceUpdate])


  const handleResizeStart = useCallback((handleType, cursor, startEvent) => {
    const currentLayer = latestLayerRef.current
    const currentLayerObject = latestLayerObjectRef.current
    const currentViewport = latestViewportRef.current
    const currentOnUpdate = latestOnUpdateRef.current
    const canvas = canvasRef.current

    if (!currentLayer || !currentLayerObject || currentLayerObject.destroyed || !currentViewport || !currentOnUpdate) {
      return
    }

    // Don't allow resizing background layers
    if (currentLayer.type === 'background') {
      return
    }

    startEvent.stopPropagation()
    if (startEvent.data?.originalEvent) {
      startEvent.data.originalEvent.stopPropagation()
      startEvent.data.originalEvent.preventDefault()
    }

    const startWorldPos = currentViewport.toWorld(startEvent.data.global.x, startEvent.data.global.y)

    const rotation = currentLayer.rotation || 0
    const rotationRad = (rotation * Math.PI) / 180

    const startFontSize = currentLayerObject instanceof PIXI.Text
      ? (currentLayer.data?.fontSize || currentLayerObject.style?.fontSize || 24)
      : null

    const isTextElement = currentLayerObject instanceof PIXI.Text
    const { anchorX: stateAnchorX, anchorY: stateAnchorY } = resolveAnchors(currentLayer, currentLayerObject)

    // Check for captured transform overrides during motion capture
    const currentMotionCaptureMode = latestMotionCaptureModeRef.current
    const capturedLayer = currentMotionCaptureMode?.isActive && currentMotionCaptureMode.trackedLayers?.get(currentLayer.id)

    // Use captured values if available, otherwise fallback to Redux state
    const currentSessionRotation = capturedLayer?.rotation ?? rotation
    const currentSessionRotationRad = (currentSessionRotation * Math.PI) / 180
    const currentSessionScaleX = capturedLayer?.scaleX ?? (currentLayer.scaleX !== undefined ? currentLayer.scaleX : 1)
    const currentSessionScaleY = capturedLayer?.scaleY ?? (currentLayer.scaleY !== undefined ? currentLayer.scaleY : 1)

    const isMediaElement = currentLayer.type === LAYER_TYPES.IMAGE || currentLayer.type === LAYER_TYPES.VIDEO
    const currentSessionWidth = isMediaElement
      ? (capturedLayer?.cropWidth ?? currentLayer.cropWidth ?? currentLayer.width ?? 100)
      : (capturedLayer?.initialTransform?.width ?? (currentLayer.width ?? 100))
    const currentSessionHeight = isMediaElement
      ? (capturedLayer?.cropHeight ?? currentLayer.cropHeight ?? currentLayer.height ?? 100)
      : (capturedLayer?.initialTransform?.height ?? (currentLayer.height ?? 100))

    const initialState = {
      handleType,
      cursor,
      prevEventMode: currentLayerObject?.eventMode,
      startWidth: currentSessionWidth,
      startHeight: currentSessionHeight,
      startX: capturedLayer?.currentPosition?.x ?? (currentLayer.x || 0),
      startY: capturedLayer?.currentPosition?.y ?? (currentLayer.y || 0),
      rotation: currentSessionRotation,
      rotationRad: currentSessionRotationRad,
      anchorX: stateAnchorX,
      anchorY: stateAnchorY,
      scaleX: currentSessionScaleX,
      scaleY: currentSessionScaleY,
      startMouseX: startWorldPos.x,
      startMouseY: startWorldPos.y,
      startFontSize,
      initialTextHeight: currentSessionHeight,
      isTextElement,
      isMediaElement,
      startCropX: capturedLayer?.cropX ?? currentLayer.cropX ?? 0,
      startCropY: capturedLayer?.cropY ?? currentLayer.cropY ?? 0,
      startCropWidth: capturedLayer?.cropWidth ?? currentLayer.cropWidth ?? currentSessionWidth,
      startCropHeight: capturedLayer?.cropHeight ?? currentLayer.cropHeight ?? currentSessionHeight,
      startMediaWidth: capturedLayer?.mediaWidth ?? currentLayer.mediaWidth ?? currentLayerObject._mediaWidth ?? currentLayerObject._originalWidth ?? currentSessionWidth,
      startMediaHeight: capturedLayer?.mediaHeight ?? currentLayer.mediaHeight ?? currentLayerObject._mediaHeight ?? currentLayerObject._originalHeight ?? currentSessionHeight,
      originalResolution: currentLayerObject.resolution
    }

    // Adaptive resolution boost for text
    if (isTextElement && currentMotionCaptureMode?.isActive) {
      const isCorner = ['nw', 'ne', 'sw', 'se'].includes(handleType)
      if (!isCorner) return

      const maxCurrentScale = Math.max(currentSessionScaleX, currentSessionScaleY)
      let targetResolution = 2 // Match base resolution
      if (maxCurrentScale > 1.1) {
        targetResolution = Math.max(2, 2 * maxCurrentScale)
      }

      // [SCALING FIX] Cap resolution to 4 and check against MAX_TEXTURE_SIZE
      const MAX_SAFE_RESOLUTION = 4
      const textureWidth = initialState.startWidth
      const textureHeight = initialState.startHeight
      const MAX_TEXTURE_SIZE = 4096 // Safe default for most GPUs
      const maxSafeResByPixels = MAX_TEXTURE_SIZE / Math.max(textureWidth, textureHeight)

      targetResolution = Math.min(MAX_SAFE_RESOLUTION, Math.min(targetResolution, maxSafeResByPixels))

      if (currentLayerObject.resolution < targetResolution) {
        currentLayerObject.resolution = targetResolution
        currentLayerObject.updateText?.(true)
      }
    }

    if (currentLayerObject instanceof PIXI.Text) {
      const dims = calculateTextDimensions(currentLayerObject, currentLayer, currentSessionWidth)
      cachedTextHeightRef.current = dims.height
      lastTextWidthRef.current = currentSessionWidth
      initialState.startHeight = dims.height
      initialState.initialTextHeight = dims.height
    }

    // Add dimensions badge
    if (layersContainer) {
      if (dimensionsBadgeRef.current) {
        if (dimensionsBadgeRef.current.parent) {
          dimensionsBadgeRef.current.parent.removeChild(dimensionsBadgeRef.current)
        }
        dimensionsBadgeRef.current.destroy({ children: true })
        dimensionsBadgeRef.current = null
      }

      const badge = createDimensionsBadge({
        width: initialState.startWidth,
        height: initialState.startHeight,
        zoomScale: 1 / currentViewport.scale.x
      })

      dimensionsBadgeRef.current = badge
      layersContainer.addChild(badge)

      const topIndex = layersContainer.children.length - 1
      layersContainer.setChildIndex(badge, topIndex)

      const worldPos = currentViewport.toWorld(startEvent.data.global.x, startEvent.data.global.y)
      badge.x = worldPos.x + (96 / currentViewport.scale.x)
      badge.y = worldPos.y + (48 / currentViewport.scale.x)

      updateDimensionsBadge(badge, {
        width: initialState.startWidth,
        height: initialState.startHeight,
        zoomScale: 1 / currentViewport.scale.x,
        viewportScale: currentViewport.scale.x
      })
    }

    interactionStateRef.current.resize = initialState
    requestUpdateLoop()

    dragStateAPI.setInteractionState(true, false, currentLayer.id)

    const initialDims = currentLayerObject instanceof PIXI.Text
      ? calculateTextDimensions(currentLayerObject, currentLayer)
      : {
        width: capturedLayer?.cropWidth ?? (initialState.isMediaElement ? (currentLayer.cropWidth ?? currentLayer.width ?? 100) : (currentLayer.width ?? 100)),
        height: capturedLayer?.cropHeight ?? (initialState.isMediaElement ? (currentLayer.cropHeight ?? currentLayer.height ?? 100) : (currentLayer.height ?? 100))
      }

    updateHoverBox(
      initialState.startX,
      initialState.startY,
      initialDims.width,
      initialDims.height,
      initialState.rotation,
      initialState.anchorX,
      initialState.anchorY,
      initialState.scaleX,
      initialState.scaleY,
      1 / currentViewport.scale.x
    )

    if (!currentLayerObject.destroyed) {
      currentLayerObject._isResizing = true
      currentLayerObject.eventMode = 'none'
      if (currentLayerObject._cachedSprite && !currentLayerObject._cachedSprite.destroyed) {
        currentLayerObject._cachedSprite._isResizing = true
        currentLayerObject._cachedSprite.eventMode = 'none'
      }
    }

    pauseViewportDragPlugin(currentViewport)

    const isMoving = dragStateAPI && currentLayer ? dragStateAPI.isLayerDragging(currentLayer.id) : false
    updateSelectionBoxVisibility(selectionBoxRef.current, isMoving, true, layersContainer, isPlaying)

    if (canvas) canvas.style.cursor = cursor

    const onMove = (e) => {
      if (!interactionStateRef.current.resize) return
      const v = latestViewportRef.current
      if (!v) return

      const shiftKey = e.data?.originalEvent?.shiftKey || false
      interactionStateRef.current.resize.shiftKey = shiftKey

      let gx, gy
      if (e.global) {
        gx = e.global.x
        gy = e.global.y
      } else if (e.data?.global) {
        gx = e.data.global.x
        gy = e.data.global.y
      } else {
        return
      }

      const wp = v.toWorld(gx, gy)
      handleResizeMove(wp)
    }

    const onEnd = () => {
      if (!interactionStateRef.current.resize) return
      handleResizeEnd()
      hideSnappingGuides()

      const v = latestViewportRef.current
      const rend = v?.parent?.parent?.renderer || v?.parent?.renderer
      if (rend?.events) {
        rend.events.off('globalpointermove', onMove)
        rend.events.off('pointerup', onEnd)
        rend.events.off('pointerupoutside', onEnd)
      } else {
        v?.off('globalpointermove', onMove)
        v?.off('pointermove', onMove)
        v?.off('pointerup', onEnd)
        v?.off('pointerupoutside', onEnd)
      }
    }

    const rend = currentViewport.parent?.parent?.renderer || currentViewport.parent?.renderer
    if (rend?.events) {
      rend.events.on('globalpointermove', onMove)
      rend.events.on('pointerup', onEnd)
      rend.events.on('pointerupoutside', onEnd)
    } else {
      currentViewport.on('globalpointermove', onMove)
      currentViewport.on('pointermove', onMove)
      currentViewport.on('pointerup', onEnd)
      currentViewport.on('pointerupoutside', onEnd)
    }
  }, [dragStateAPI, layersContainer, isPlaying, updateHoverBox, handleResizeMove, handleResizeEnd, requestUpdateLoop])


  const handleRotateStart = useCallback((startEvent) => {
    const currentLayer = latestLayerRef.current
    const currentLayerObject = latestLayerObjectRef.current
    const currentViewport = latestViewportRef.current
    const currentOnUpdate = latestOnUpdateRef.current
    const canvas = canvasRef.current

    if (!currentLayer || !currentLayerObject || currentLayerObject.destroyed || !currentViewport || !currentOnUpdate) {
      return
    }

    if (currentLayer.type === 'background') return

    startEvent.stopPropagation()
    if (startEvent.data?.originalEvent) {
      startEvent.data.originalEvent.stopPropagation()
      startEvent.data.originalEvent.preventDefault()
    }

    const startWorldPos = currentViewport.toWorld(startEvent.data.global.x, startEvent.data.global.y)
    const layerId = currentLayer.id
    const currentMotionCaptureMode = latestMotionCaptureModeRef.current
    const capturedLayer = currentMotionCaptureMode?.isActive && currentMotionCaptureMode.trackedLayers?.get(layerId)

    const layerCenterX = capturedLayer?.currentPosition?.x ?? (currentLayer.x || 0)
    const layerCenterY = capturedLayer?.currentPosition?.y ?? (currentLayer.y || 0)
    const startRotation = capturedLayer?.rotation ?? (currentLayer.rotation || 0)

    const dx = startWorldPos.x - layerCenterX
    const dy = startWorldPos.y - layerCenterY
    const startAngle = Math.atan2(dy, dx)

    dragStateAPI.setInteractionState(false, true, currentLayer.id)

    const isMediaElement = currentLayer.type === LAYER_TYPES.IMAGE || currentLayer.type === LAYER_TYPES.VIDEO
    const rotationDims = currentLayerObject instanceof PIXI.Text
      ? calculateTextDimensions(currentLayerObject, currentLayer)
      : {
        width: capturedLayer?.cropWidth ?? (isMediaElement ? (currentLayer.cropWidth ?? currentLayer.width ?? 100) : (currentLayer.width ?? 100)),
        height: capturedLayer?.cropHeight ?? (isMediaElement ? (currentLayer.cropHeight ?? currentLayer.height ?? 100) : (currentLayer.height ?? 100))
      }

    const { anchorX, anchorY } = resolveAnchors(currentLayer, currentLayerObject)

    updateHoverBox(
      layerCenterX, layerCenterY, rotationDims.width, rotationDims.height,
      startRotation, anchorX, anchorY,
      capturedLayer?.scaleX ?? currentLayer.scaleX ?? 1,
      capturedLayer?.scaleY ?? currentLayer.scaleY ?? 1,
      1 / currentViewport.scale.x
    )

    interactionStateRef.current.rotate = {
      layerId, layerCenterX, layerCenterY, startRotation, startAngle,
      prevEventMode: currentLayerObject?.eventMode,
    }
    requestUpdateLoop()

    if (layersContainer) {
      if (rotationBadgeRef.current) {
        if (rotationBadgeRef.current.parent) rotationBadgeRef.current.parent.removeChild(rotationBadgeRef.current)
        rotationBadgeRef.current.destroy({ children: true }); rotationBadgeRef.current = null
      }
      const rotationBadge = createRotationBadge({ rotation: startRotation, zoomScale: 1 / currentViewport.scale.x })
      rotationBadgeRef.current = rotationBadge
      layersContainer.addChild(rotationBadge)
      const topIdx = layersContainer.children.length - 1
      layersContainer.setChildIndex(rotationBadge, topIdx)

      const worldPos = currentViewport.toWorld(startEvent.data.global.x, startEvent.data.global.y)
      rotationBadge.x = worldPos.x + (96 / currentViewport.scale.x)
      rotationBadge.y = worldPos.y + (48 / currentViewport.scale.x)
      updateRotationBadge(rotationBadge, { rotation: startRotation, zoomScale: 1 / currentViewport.scale.x, viewportScale: currentViewport.scale.x })
    }

    if (!currentLayerObject.destroyed) {
      currentLayerObject._isRotating = true
      currentLayerObject.eventMode = 'none'
      if (currentLayerObject._cachedSprite && !currentLayerObject._cachedSprite.destroyed) {
        currentLayerObject._cachedSprite._isRotating = true
        currentLayerObject._cachedSprite.eventMode = 'none'
      }
    }

    pauseViewportDragPlugin(currentViewport)
    updateSelectionBoxVisibility(selectionBoxRef.current, false, false, layersContainer, false, true, latestMotionCaptureModeRef.current)
    if (canvas) canvas.style.cursor = 'grab'

    const onRotateMove = (e) => {
      if (!interactionStateRef.current.rotate) return
      const v = latestViewportRef.current
      if (!v) return

      const state = interactionStateRef.current.rotate
      const latestObj = latestLayerObjectRef.current
      const latestL = latestLayerRef.current
      if (!latestL || !latestObj || latestObj.destroyed || latestL.id !== state.layerId) return

      let gx, gy
      if (e.global) { gx = e.global.x; gy = e.global.y }
      else if (e.data?.global) { gx = e.data.global.x; gy = e.data.global.y }
      else return

      const worldPos = v.toWorld(gx, gy)
      const dx = worldPos.x - state.layerCenterX
      const dy = worldPos.y - state.layerCenterY
      const currentAngle = Math.atan2(dy, dx)
      let angleDelta = ((currentAngle - state.startAngle) * 180) / Math.PI
      if (angleDelta > 180) angleDelta -= 360
      if (angleDelta < -180) angleDelta += 360

      let newRotation = state.startRotation + angleDelta
      const SNAP_THRESHOLD = 3
      const snapPoints = [0, 90, 180, 270, 360, -90, -180, -270, -360]
      for (const p of snapPoints) {
        if (Math.abs(newRotation - p) <= SNAP_THRESHOLD) { newRotation = p; break }
      }

      state._lastRotation = newRotation
      syncBoxVisuals()

      const newRotationRad = (newRotation * Math.PI) / 180
      latestObj.rotation = newRotationRad
      if (selectionBoxRef.current) selectionBoxRef.current.rotation = newRotationRad

      const isCapture = latestMotionCaptureModeRef.current?.isActive
      const captured = isCapture && latestMotionCaptureModeRef.current.trackedLayers?.get(latestL.id)

      if (hoverBoxRef.current?.visible && latestObj && !latestObj.destroyed) {
        const isMedia = latestL.type === LAYER_TYPES.IMAGE || latestL.type === LAYER_TYPES.VIDEO
        const effectiveDims = isMedia
          ? getEffectiveLayerDimensions(latestL, latestObj, latestMotionCaptureModeRef.current)
          : null
        const dims = effectiveDims ?? {
          width: captured?.cropWidth ?? (latestL.cropWidth ?? latestL.width ?? 100),
          height: captured?.cropHeight ?? (latestL.cropHeight ?? latestL.height ?? 100)
        }
        updateHoverBox(latestObj.x, latestObj.y, dims.width, dims.height, newRotation, 0.5, 0.5, captured?.scaleX ?? latestL.scaleX ?? 1, captured?.scaleY ?? latestL.scaleY ?? 1, 1 / v.scale.x)
      }

      if (isCapture) {
        latestMotionCaptureModeRef.current.onPositionUpdate({ layerId: latestL.id, rotation: newRotation, interactionType: 'rotate' })
        const live = latestMotionCaptureModeRef.current.trackedLayers?.get(latestL.id)
        if (live) live.rotation = newRotation
      } else {
        throttledUpdate({ rotation: newRotation })
      }

      if (rotationBadgeRef.current) {
        const badge = rotationBadgeRef.current
        badge.x = worldPos.x + (96 / v.scale.x)
        badge.y = worldPos.y + (48 / v.scale.x)
        updateRotationBadge(badge, { rotation: newRotation, zoomScale: 1 / v.scale.x, viewportScale: v.scale.x })
      }
    }

    const onRotateEnd = () => {
      if (!interactionStateRef.current.rotate) return
      if (updateThrottleRef.current) { cancelAnimationFrame(updateThrottleRef.current); updateThrottleRef.current = null }
      if (pendingUpdateRef.current && latestOnUpdateRef.current) { latestOnUpdateRef.current(pendingUpdateRef.current); pendingUpdateRef.current = null }

      const v = latestViewportRef.current
      resumeViewportDragPlugin(v)

      const canvas = canvasRef.current
      if (canvas) canvas.style.cursor = 'default'

      const latestObj = latestLayerObjectRef.current
      const state = interactionStateRef.current.rotate
      if (latestObj && !latestObj.destroyed && state) {
        const latestL = latestLayerRef.current
        if (latestL && latestL.id === state.layerId) {
          const prev = state.prevEventMode
          const restoredEventMode = prev !== undefined ? prev : 'static'
          latestObj.eventMode = restoredEventMode
          latestObj._isRotating = false
          if (latestObj._cachedSprite && !latestObj._cachedSprite.destroyed) {
            latestObj._cachedSprite.eventMode = restoredEventMode
            latestObj._cachedSprite._isRotating = false
          }
        }
      }

      if (rotationBadgeRef.current) {
        if (rotationBadgeRef.current.parent) rotationBadgeRef.current.parent.removeChild(rotationBadgeRef.current)
        rotationBadgeRef.current.destroy({ children: true }); rotationBadgeRef.current = null
      }

      interactionStateRef.current.rotate = null
      dragStateAPI.setInteractionState(false, false)
      hideHoverBox()
      setForceUpdate(p => p + 1)

      const rend = v?.parent?.parent?.renderer || v?.parent?.renderer
      if (rend?.events) {
        rend.events.off('globalpointermove', onRotateMove)
        rend.events.off('pointerup', onRotateEnd)
        rend.events.off('pointerupoutside', onRotateEnd)
      } else {
        v?.off('globalpointermove', onRotateMove)
        v?.off('pointerup', onRotateEnd)
        v?.off('pointerupoutside', onRotateEnd)
      }
    }

    const rend = currentViewport.parent?.parent?.renderer || currentViewport.parent?.renderer
    if (rend?.events) {
      rend.events.on('globalpointermove', onRotateMove)
      rend.events.on('pointerup', onRotateEnd)
      rend.events.on('pointerupoutside', onRotateEnd)
    } else {
      currentViewport.on('globalpointermove', onRotateMove)
      currentViewport.on('pointerup', onRotateEnd)
      currentViewport.on('pointerupoutside', onRotateEnd)
    }
  }, [dragStateAPI, calculateTextDimensions, hideHoverBox, setForceUpdate, syncBoxVisuals, throttledUpdate, updateHoverBox, requestUpdateLoop])





  // ===========================================================================
  // UPDATE LOOP - Continuously updates selection box (async RAF)
  // ===========================================================================

  // Ticker management - logic now handled by PIXI.Ticker in useEffect

  // ===========================================================================
  // ANIMATION CONTROL - Starts/stops the update loop based on app state
  // ===========================================================================

  useEffect(() => {
    if (!layer || !layersContainer) return

    // [PERFORMANCE FIX] Use PIXI Ticker instead of manual requestAnimationFrame loop
    // This allows us to run at HIGH priority, matching the interaction ticker in useCanvasInteractions
    // and ensuring perfect visual sync without a 1-frame lag.
    const ticker = PIXI.Ticker.shared
    const tickerHandler = () => {
      // Call drawing logic
      syncBoxVisuals()

      const currentLayer = latestLayerRef.current
      const currentLayerObject = latestLayerObjectRef.current
      const box = selectionBoxRef.current
      if (!currentLayer || !currentLayerObject || !box) return

      const rs = interactionStateRef.current.resize
      const rotateState = interactionStateRef.current.rotate
      const isMoving = dragStateAPI && currentLayer?.id ? dragStateAPI.isLayerDragging(currentLayer.id) : false

      const engine = getGlobalMotionEngine()
      const currentTime = engine?.masterTimeline?.time() || 0
      const sceneStartTime = latestSceneMotionFlowRef.current?.sceneStartOffset || 0
      const isPastBaseStep = Math.abs(currentTime - sceneStartTime) > 0.02
      const isAnimated = getLayerFirstActionTime(currentLayer?.id, latestSceneMotionFlowRef.current) !== Infinity

      // Update visibility rules every frame to handle timeline scrubbing accurately
      updateSelectionBoxVisibility(
        box,
        isMoving,
        !!rs,
        layersContainer,
        isPlaying,
        !!rotateState,
        latestMotionCaptureModeRef.current,
        latestSceneMotionFlowRef.current,
        currentLayer?.id,
        isAnimated
      )
    }

    // Always keep active if layer is selected to ensure synchronization during timeline scrubbing
    ticker.add(tickerHandler, undefined, PIXI.UPDATE_PRIORITY.HIGH)

    // Force redraw when layer/scene changes
    forceRedrawRef.current = true

    return () => {
      ticker.remove(tickerHandler)
    }
  }, [layer?.id, layersContainer, syncBoxVisuals, isPlaying, dragStateAPI, updateSelectionBoxVisibility])

  // ===========================================================================
  // CLEANUP - Handles cleanup when layer selection changes or component unmounts
  // ===========================================================================

  useEffect(() => {
    return () => {
      if (updateThrottleRef.current) {
        cancelAnimationFrame(updateThrottleRef.current)
        updateThrottleRef.current = null
      }

      // Clean up hover box
      if (hoverBoxRef.current) {
        if (layersContainer && hoverBoxRef.current.parent) { // Use layersContainer
          layersContainer.removeChild(hoverBoxRef.current) // Use layersContainer
        }
        hoverBoxRef.current.destroy({ children: true })
        hoverBoxRef.current = null
      }

      // Ensure interaction flags are cleared when selection box unmounts
      if (latestLayerObjectRef.current) {
        latestLayerObjectRef.current._isResizing = false
        latestLayerObjectRef.current._isRotating = false
      }
    }
  }, [layersContainer]) // Update dependency

  // ===========================================================================
  // LAYER SWITCHING - Manages transitions when user selects different elements (layer change) Runs when switching layers, creates the entire selection box from scratch
  // ===========================================================================
  useEffect(() => {
    // If layer ID changed, clean up previous layer's handlers
    const currentLayerId = layer?.id
    if (currentLayerId !== previousLayerRef.current.id && previousLayerRef.current.id !== null) {
      const isResizing = !!interactionStateRef.current.resize
      const isMoving = false // Drag state now handled by useCanvasInteractions
      const isRotating = !!interactionStateRef.current.rotate

      // Only clean up if not in an active interaction
      if (!isResizing && !isMoving && !isRotating) {
        // Clean up handlers from previous layer object
        const prevLayerObj = previousLayerRef.current.object

        // Clean up previous selection box
        if (selectionBoxRef.current && layersContainer) { // Use layersContainer
          if (selectionBoxRef.current.parent === layersContainer) { // Use layersContainer
            layersContainer.removeChild(selectionBoxRef.current) // Use layersContainer
          }
          selectionBoxRef.current.destroy({ children: true })
          selectionBoxRef.current = null
        }


        // Clear state - IMPORTANT: always clear when switching elements
        interactionStateRef.current.resize = null
        interactionStateRef.current.rotate = null
        // REMOVED: move and isDraggingRef - drag logic moved to useCanvasInteractions
      }
    }

    // Update refs
    previousLayerRef.current.id = currentLayerId
    previousLayerRef.current.object = layerObject

    // Cleanup if no layer selected (but preserve state if interacting)
    if (!stageContainer || !layer || !layerObject || !viewport || layerObject.destroyed) {
      const isResizing = !!interactionStateRef.current.resize
      const isMoving = false // Drag state now handled by useCanvasInteractions
      const isRotating = !!interactionStateRef.current.rotate
      canvasRef.current = null

      // Only cleanup if not interacting (let interaction end handle cleanup)
      if (!isResizing && !isMoving && !isRotating) {
        if (selectionBoxRef.current) {
          // Hide selection box immediately
          selectionBoxRef.current.visible = false
          if (layersContainer && selectionBoxRef.current.parent) {
            layersContainer.removeChild(selectionBoxRef.current)
          }
          selectionBoxRef.current.destroy({ children: true })
          selectionBoxRef.current = null
        }

        // PERFORMANCE: Explicitly clean up badges and hover boxes when selection is cleared
        if (dimensionsBadgeRef.current) {
          if (dimensionsBadgeRef.current.parent) dimensionsBadgeRef.current.parent.removeChild(dimensionsBadgeRef.current)
          dimensionsBadgeRef.current.destroy({ children: true })
          dimensionsBadgeRef.current = null
        }
        if (rotationBadgeRef.current) {
          if (rotationBadgeRef.current.parent) rotationBadgeRef.current.parent.removeChild(rotationBadgeRef.current)
          rotationBadgeRef.current.destroy({ children: true })
          rotationBadgeRef.current = null
        }
        if (hoverBoxRef.current) {
          if (layersContainer && hoverBoxRef.current.parent) {
            layersContainer.removeChild(hoverBoxRef.current)
          }
          hoverBoxRef.current.destroy({ children: true })
          hoverBoxRef.current = null
        }

        interactionStateRef.current.resize = null
        interactionStateRef.current.rotate = null
        // REMOVED: move and isDraggingRef - drag logic moved to useCanvasInteractions
      } else {
        // Even if interacting, hide the selection box if layer is null
        // This handles the case where we're dragging text and selection box should be hidden
        if (selectionBoxRef.current) {
          selectionBoxRef.current.visible = false
        }
      }
      return
    }

    // Get canvas for cursor management
    let canvas = null
    try {
      const renderer = viewport.parent?.parent?.renderer || viewport.parent?.renderer
      if (renderer?.canvas) {
        canvas = renderer.canvas
      } else if (renderer?.view) {
        canvas = renderer.view
      }
    } catch (e) {
      // Canvas not available
    }
    canvasRef.current = canvas

    // Early return if layerObject is null to prevent errors during hot reload
    if (!layerObject) {
      return () => { } // Return empty cleanup function
    }

    // Use centralized drag state API
    const isMoving = dragStateAPI && layer ? dragStateAPI.isLayerDragging(layer.id) : false
    const isResizing = !!interactionStateRef.current.resize
    const isRotating = !!interactionStateRef.current.rotate

    // Skip ALL updates during active resize OR move OR rotate - don't recreate anything
    // IMPORTANT: Don't clear state here - it's still active!
    // handleResizeMove will handle all selection box updates during resize for smooth performance
    const isInteracting = isResizing || isRotating || isMoving

    if (isInteracting) {
      // Skip full update during interaction - handleResizeMove handles updates
      return () => {
        // Only cleanup when component unmounts or layer is deselected
        // DO NOT clear state here - it's still active during interaction
        if (!layer || !layerObject || layerObject.destroyed) {
          // Only cleanup if layer is actually deselected, not just during interaction
          if (selectionBoxRef.current) {
            if (layersContainer && selectionBoxRef.current.parent) { // Use layersContainer
              layersContainer.removeChild(selectionBoxRef.current) // Use layersContainer
            }
            selectionBoxRef.current.destroy({ children: true })
            selectionBoxRef.current = null
          }
          // Only clear state if layer is truly deselected (not just updating)
          if (!layer || !layerObject || layerObject.destroyed) {
            interactionStateRef.current.resize = null
            // REMOVED: move state - drag logic moved to useCanvasInteractions
            interactionStateRef.current.rotate = null
            // REMOVED: isDraggingRef - drag logic moved to useCanvasInteractions
          }
        }
      }
    }

    // Important: Ensure selection box is visible when layer is selected and not being dragged.
    // This handles the transition after drag operations end and keeps box visible during resize.
    if (!isMoving && layer && layerObject && !layerObject.destroyed) {
      // Not moving - ensure selection box is visible
      // Drag state is now managed centrally by useCanvasInteractions
    }

    if (isMoving && !isResizing) {
      // Hide existing selection box if any
      if (selectionBoxRef.current) selectionBoxRef.current.visible = false;
      return // Don't create selection box during move/drag
    }




    // Selection Box Creation & Update Logic starts here 





    // Create the main PIXI container that holds all selection box graphics


    let selectionBox = selectionBoxRef.current
    const isSameLayer = previousLayerRef.current.id === (layer?.id || currentLayerId)

    // Only destroy/recreate if layer changed significantly or doesn't exist
    if (selectionBox && !isSameLayer) {
      if (layersContainer && selectionBox.parent === layersContainer) {
        layersContainer.removeChild(selectionBox)
      }
      selectionBox.destroy({ children: true })
      selectionBox = null
      selectionBoxRef.current = null
    }

    if (!selectionBox) {
      selectionBox = new PIXI.Container()
      selectionBox.label = 'selection-box'
      selectionBox.eventMode = 'passive'
      selectionBox.interactiveChildren = true
      selectionBox.zIndex = 10000
      selectionBoxRef.current = selectionBox
    }

    // Ensure selection box is on top and properly added
    if (selectionBox.parent !== layersContainer) { // Add to layersContainer instead of stageContainer
      if (selectionBox.parent) {
        selectionBox.parent.removeChild(selectionBox)
      }
      layersContainer.addChild(selectionBox) // Add to layersContainer
    }

    // ALWAYS move selection box to the very top (after all layers)
    // This ensures it stays on top even when layers are reordered
    const currentIndex = layersContainer.getChildIndex(selectionBox) // Use layersContainer
    const topIndex = layersContainer.children.length - 1 // Use layersContainer
    if (currentIndex !== topIndex) {
      layersContainer.setChildIndex(selectionBox, topIndex) // Use layersContainer
    }

    // Initial visibility will be set by updateSelectionBoxVisibility at the end of this effect


    // Get layer properties
    const position = getCurrentLayerPosition(layer, layerObject)
    const x = position.x
    const y = position.y
    const rotation = getCurrentLayerRotation(layer, layerObject)

    const { anchorX, anchorY } = resolveAnchors(layer, layerObject)
    const { scaleX, scaleY } = getCurrentLayerScale(layer, layerObject)

    // Get layer dimensions - use actual bounds for shapes, layer data for text
    let width, height, boundsCenterX = 0, boundsCenterY = 0

    // [MOTION CAPTURE SYNC] Prioritize live dimensions from capture session
    const trackedLayer = motionCaptureMode?.isActive ? motionCaptureMode.trackedLayers?.get(layer.id) : null

    if (trackedLayer) {
      width = trackedLayer.cropWidth ?? trackedLayer.width ?? 100
      height = trackedLayer.cropHeight ?? trackedLayer.height ?? 100

      // For text elements, we still need to calculate the height based on word wrap
      if (layerObject instanceof PIXI.Text) {
        const textDims = calculateTextDimensions(layerObject, layer, width)
        height = textDims.height
      }
    } else if (layerObject instanceof PIXI.Text) {
      // Text layers: Use text area width (user-settable) for selection box, but actual text height
      const textDims = calculateTextDimensions(layerObject, layer)
      width = layer.width || 100
      height = textDims.height
    } else if (layerObject instanceof PIXI.Sprite || (layerObject instanceof PIXI.Container && (layerObject._imageSprite || layerObject._videoSprite))) {
      // Image and Video: single source of truth — cropped visible area (reactive PIXI or Redux)
      const mediaDims = getEffectiveLayerDimensions(layer, layerObject, motionCaptureMode)
      if (mediaDims) {
        width = mediaDims.width
        height = mediaDims.height
      } else {
        width = layer.cropWidth ?? layer.width ?? 100
        height = layer.cropHeight ?? layer.height ?? 100
      }
      if (typeof console !== 'undefined' && console.log) {
        const isVideo = layerObject._videoSprite != null
        console.log('[useSelectionBox] sync media layer', {
          layerId: layer?.id,
          isVideo,
          selectionBoxCenter: { x, y },
          layerObjectPos: { x: layerObject.x, y: layerObject.y },
          layerObjectPivot: layerObject.pivot ? { x: layerObject.pivot.x, y: layerObject.pivot.y } : null,
          width,
          height,
          tracked: !!trackedLayer
        })
      }
    } else {
      // For shapes, use actual visual bounds from PIXI object
      let actualBounds
      try {
        actualBounds = layerObject.getLocalBounds()
      } catch (e) {
        // Fallback to layer data if getLocalBounds fails
        actualBounds = {
          x: -(layer.width || 100) * anchorX,
          y: -(layer.height || 100) * anchorY,
          width: layer.width || 100,
          height: layer.height || 100
        }
      }

      width = actualBounds.width
      height = actualBounds.height

      // Calculate the bounds center offset for proper positioning of shapes
      boundsCenterX = actualBounds.x + actualBounds.width / 2
      boundsCenterY = actualBounds.y + actualBounds.height / 2
    }



    // Calculate bounds (in local space, before rotation)
    const scaledWidth = width * scaleX
    const scaledHeight = height * scaleY

    // Position the outline based on layer anchor
    let localBoundsX, localBoundsY
    if (layerObject instanceof PIXI.Text) {
      // Text layers use anchor-based positioning for predictable resizing
      localBoundsX = -(scaledWidth * anchorX)
      localBoundsY = -(scaledHeight * anchorY)
    } else {
      // For shapes, use the layer's anchor values for consistent positioning
      localBoundsX = -(scaledWidth * anchorX)
      localBoundsY = -(scaledHeight * anchorY)
    }

    // Get viewport zoom to keep handles at consistent screen size
    const viewportScale = viewport?.scale?.x || 1
    const zoomScale = 1 / viewportScale

    // Clear and redraw
    selectionBox.removeChildren()

    // Set selection box position and rotation to match layer, adjusted for bounds center
    // This ensures the selection box is centered on the visual center of the shape
    selectionBox.x = x + boundsCenterX
    selectionBox.y = y + boundsCenterY
    selectionBox.rotation = (rotation * Math.PI) / 180 // Convert degrees to radians

    // Determine if the layer is animated and if we are past the base step
    const engine = getGlobalMotionEngine()
    const currentTime = engine?.masterTimeline?.time() || 0
    const sceneStartTime = sceneMotionFlow?.sceneStartOffset || 0
    const isPastBaseStep = Math.abs(currentTime - sceneStartTime) > 0.02
    const isAnimated = getLayerFirstActionTime(layer.id, sceneMotionFlow) !== Infinity
    const isLocked = !motionCaptureMode?.isActive && isPastBaseStep && isAnimated

    // Draw outline - purple color (in local coordinates)
    const outline = new PIXI.Graphics()
    outline.label = 'selection-outline'
    outline.rect(localBoundsX, localBoundsY, scaledWidth, scaledHeight)
    outline.stroke({ color: 0x8B5CF6, width: 1.5 * zoomScale }) // Purple color
    outline.eventMode = 'none'
    selectionBox.addChild(outline)




    // Handle creation based on element type
    const isTextElement = layerObject instanceof PIXI.Text

    // Check if we should hide side handles in motion capture mode
    // We hide them if we're in capture mode AND it's a text element (no area adjustment during capture)
    // OR if the current step has a specific scale action
    const currentMotionCaptureMode = latestMotionCaptureModeRef.current
    const isScaleCaptureMode = currentMotionCaptureMode?.isActive && (
      isTextElement || // Always hide side handles for text in capture mode
      currentMotionCaptureMode.actions?.some(a => a.type === 'scale')
    )

    // Text elements: corner handles for scaling, side handles for width
    const textHandles = [
      createHandle(rotation, handleResizeStart, localBoundsX, localBoundsY, 'nw-resize', 'nw', zoomScale, scaledWidth, scaledHeight, isLocked), // nw corner
      createHandle(rotation, handleResizeStart, localBoundsX + scaledWidth, localBoundsY, 'ne-resize', 'ne', zoomScale, scaledWidth, scaledHeight, isLocked), // ne corner
      createHandle(rotation, handleResizeStart, localBoundsX, localBoundsY + scaledHeight, 'sw-resize', 'sw', zoomScale, scaledWidth, scaledHeight, isLocked), // sw corner
      createHandle(rotation, handleResizeStart, localBoundsX + scaledWidth, localBoundsY + scaledHeight, 'se-resize', 'se', zoomScale, scaledWidth, scaledHeight, isLocked), // se corner
      // Only add side handles if not in scale capture mode
      ...(!isScaleCaptureMode ? [
        createHandle(rotation, handleResizeStart, localBoundsX, localBoundsY + scaledHeight / 2, 'w-resize', 'w', zoomScale, scaledWidth, scaledHeight, isLocked), // left side
        createHandle(rotation, handleResizeStart, localBoundsX + scaledWidth, localBoundsY + scaledHeight / 2, 'e-resize', 'e', zoomScale, scaledWidth, scaledHeight, isLocked), // right side
      ] : [])
    ]

    // Shape elements: all handles (corners + sides)
    const shapeHandles = [
      createHandle(rotation, handleResizeStart, localBoundsX, localBoundsY, 'nw-resize', 'nw', zoomScale, scaledWidth, scaledHeight, isLocked),
      createHandle(rotation, handleResizeStart, localBoundsX + scaledWidth, localBoundsY, 'ne-resize', 'ne', zoomScale, scaledWidth, scaledHeight, isLocked),
      createHandle(rotation, handleResizeStart, localBoundsX, localBoundsY + scaledHeight, 'sw-resize', 'sw', zoomScale, scaledWidth, scaledHeight, isLocked),
      createHandle(rotation, handleResizeStart, localBoundsX + scaledWidth, localBoundsY + scaledHeight, 'se-resize', 'se', zoomScale, scaledWidth, scaledHeight, isLocked),
      // Only add side handles if not in scale capture mode
      ...(!isScaleCaptureMode ? [
        createHandle(rotation, handleResizeStart, localBoundsX + scaledWidth / 2, localBoundsY, 'n-resize', 'n', zoomScale, scaledWidth, scaledHeight, isLocked),
        createHandle(rotation, handleResizeStart, localBoundsX + scaledWidth / 2, localBoundsY + scaledHeight, 's-resize', 's', zoomScale, scaledWidth, scaledHeight, isLocked),
        createHandle(rotation, handleResizeStart, localBoundsX, localBoundsY + scaledHeight / 2, 'w-resize', 'w', zoomScale, scaledWidth, scaledHeight, isLocked),
        createHandle(rotation, handleResizeStart, localBoundsX + scaledWidth, localBoundsY + scaledHeight / 2, 'e-resize', 'e', zoomScale, scaledWidth, scaledHeight, isLocked),
      ] : [])
    ]

    // Add handles based on element type
    const handles = isTextElement ? textHandles : shapeHandles
    handles.forEach(handle => selectionBox.addChild(handle))

    // Side hit areas - text gets only left/right, shapes get all sides
    // Also skip if in scale capture mode
    const textSideHitAreas = !isScaleCaptureMode ? [
      createSideHitArea(rotation, localBoundsX, localBoundsY, scaledWidth, scaledHeight, handleResizeStart, 'w', 'w-resize', zoomScale, isLocked), // Left
      createSideHitArea(rotation, localBoundsX, localBoundsY, scaledWidth, scaledHeight, handleResizeStart, 'e', 'e-resize', zoomScale, isLocked), // Right
    ] : []

    const shapeSideHitAreas = !isScaleCaptureMode ? [
      createSideHitArea(rotation, localBoundsX, localBoundsY, scaledWidth, scaledHeight, handleResizeStart, 'n', 'n-resize', zoomScale, isLocked), // Top
      createSideHitArea(rotation, localBoundsX, localBoundsY, scaledWidth, scaledHeight, handleResizeStart, 's', 's-resize', zoomScale, isLocked), // Bottom
      createSideHitArea(rotation, localBoundsX, localBoundsY, scaledWidth, scaledHeight, handleResizeStart, 'w', 'w-resize', zoomScale, isLocked), // Left
      createSideHitArea(rotation, localBoundsX, localBoundsY, scaledWidth, scaledHeight, handleResizeStart, 'e', 'e-resize', zoomScale, isLocked), // Right
    ] : []

    const sideHitAreas = isTextElement ? textSideHitAreas : shapeSideHitAreas
    sideHitAreas.forEach(hitArea => selectionBox.addChild(hitArea))


    // Add rotation handle
    const rotationHandle = createRotationHandle(localBoundsX, localBoundsY, scaledWidth, scaledHeight, handleRotateStart, zoomScale, isLocked)
    selectionBox.addChild(rotationHandle)

    // [FIX] IMMEDIATELY apply visibility rules to avoid flickering handles when past base step
    // We call this after adding all children to ensure they are properly hidden if necessary.
    updateSelectionBoxVisibility(selectionBox, isMoving, isResizing, layersContainer, isPlaying, isRotating, currentMotionCaptureMode, sceneMotionFlow, layer?.id, isAnimated)

  }, [
    layersContainer,
    layer?.id,
    viewport, // Keep viewport for zoom scaling visibility
    layer?.width,
    layer?.height,
    layer?.cropWidth,
    layer?.cropHeight,
    layer?.rotation,
    layer?.anchorX,
    layer?.anchorY,
    layer?.scaleX,
    layer?.scaleY,
    layer?.data?.content,
    layer?.data?.fontSize,
    layer?.data?.fontFamily,
    layer?.type,
    forceUpdate,
    motionCaptureMode?.isActive, // Only recreate if capture mode state changes
  ])

  // =========================================================================
  // SNAPPING GUIDE RENDERING HELPERS
  // =========================================================================

  /**
   * Updates snapping guide lines based on snap results
   */
  function updateSnappingGuides(centerSnap, safeZoneSnap) {
    if (!layersContainer || isPlaying) return

    const worldWidth = latestViewportRef.current.worldWidth || 1920
    const worldHeight = latestViewportRef.current.worldHeight || 1080
    const viewport = latestViewportRef.current

    // 1. Update Center Snapping Guides (Full-canvas lines)
    const guideState = {
      showVGuide: centerSnap?.showVGuide || false,
      showHGuide: centerSnap?.showHGuide || false
    }

    // Vertical center guide
    if (guideState.showVGuide) {
      if (!vGuideRef.current) {
        vGuideRef.current = createSnappingGuideLine(true, layersContainer)
      }
      vGuideRef.current.visible = true
      updateSnappingGuideLine(vGuideRef.current, true, worldWidth, worldHeight, viewport)
    } else if (vGuideRef.current) {
      vGuideRef.current.visible = false
    }

    // Horizontal center guide
    if (guideState.showHGuide) {
      if (!hGuideRef.current) {
        hGuideRef.current = createSnappingGuideLine(false, layersContainer)
      }
      hGuideRef.current.visible = true
      updateSnappingGuideLine(hGuideRef.current, false, worldWidth, worldHeight, viewport)
    } else if (hGuideRef.current) {
      hGuideRef.current.visible = false
    }

    // 2. Update SafeZone/Alignment Snapping Guides
    const guides = safeZoneSnap?.alignmentGuides || []

    // Hide all current alignment guides first
    alignmentGuidesMapRef.current.forEach(guide => { guide.visible = false })

    // Render/update active guides
    guides.forEach((guideData, index) => {
      let guideGraphics = alignmentGuidesMapRef.current.get(index)
      if (!guideGraphics) {
        guideGraphics = new PIXI.Graphics()
        guideGraphics.eventMode = 'none'
        layersContainer.addChild(guideGraphics)
        alignmentGuidesMapRef.current.set(index, guideGraphics)
      }

      guideGraphics.visible = true
      guideGraphics.clear()

      // Use standard guide style
      const color = guideData.type === 'safeZone' ? 0x8B5CF6 : 0x8B5CF6
      const alpha = 0.8

      if (guideData.isVertical) {
        guideGraphics.moveTo(guideData.position, guideData.start)
        guideGraphics.lineTo(guideData.position, guideData.end)
      } else {
        guideGraphics.moveTo(guideData.start, guideData.position)
        guideGraphics.lineTo(guideData.end, guideData.position)
      }
      guideGraphics.stroke({ color, width: 2, alpha })
    })
  }

  function createSnappingGuideLine(isVertical, container) {
    const g = new PIXI.Graphics()
    g.eventMode = 'none'
    g.label = isVertical ? 'v-center-guide' : 'h-center-guide'
    container.addChild(g)
    return g
  }

  function updateSnappingGuideLine(g, isVertical, worldWidth, worldHeight, viewport) {
    g.clear()
    const color = 0x8B5CF6
    const alpha = 0.8

    if (isVertical) {
      const centerX = worldWidth / 2
      g.moveTo(centerX, 0)
      g.lineTo(centerX, worldHeight)
    } else {
      const centerY = worldHeight / 2
      g.moveTo(0, centerY)
      g.lineTo(worldWidth, centerY)
    }
    g.stroke({ color, width: 2, alpha })
  }

  function hideSnappingGuides() {
    if (vGuideRef.current) vGuideRef.current.visible = false
    if (hGuideRef.current) hGuideRef.current.visible = false
    alignmentGuidesMapRef.current.forEach(guide => { guide.visible = false })
  }

  // Early return if layerObject is null to prevent errors during hot reload
  if (!layerObject) {
    return null
  }

  return {
    selectionBox: selectionBoxRef.current,
    handleResizeStart,
    handleResizeMove,
    handleRotateStart,
    handleResizeEnd
  }
}
