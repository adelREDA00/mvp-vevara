// =============================================================================
// IMPORTS
// =============================================================================

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import * as PIXI from 'pixi.js'
// TODO: Consider lazy loading PIXI.js for better initial bundle size:
// const PIXI = React.lazy(() => import('pixi.js'))
// This would require wrapping PIXI usage in useEffect and handling loading state
import {
  Copy,
  Layers,
  Layers3,
  Trash2,
  Image as ImageIcon,
  Unlink,
  ChevronUp,
  ChevronDown,
} from 'lucide-react'
import { useDispatch, useSelector } from 'react-redux'
import { createSelector } from '@reduxjs/toolkit'
import { useContainerResize } from '../hooks/useContainerResize'
import { useWorldDimensions } from '../hooks/useWorldDimensions'
import { usePixiCanvas } from '../hooks/usePixiCanvas'
import { useCanvasLayers } from '../hooks/useCanvasLayers'
import { useSimpleMotion } from '../hooks/useSimpleMotion'
import { useCanvasInteractions } from '../hooks/useCanvasInteractions'
import { useSelectionBox } from '../hooks/useSelectionBox'
import { useDragState } from '../hooks/useDragState'
import { useDragSelectionBox } from '../hooks/useDragSelectionBox'
import { useMultiSelectionBox } from '../hooks/useMultiSelectionBox'
import TextEditOverlay from './TextEditOverlay'
import { isLayerCompletelyOutside } from '../utils/geometry'
import { findLayerIdFromObject } from '../utils/layerUtils'
import { clearLayerSelection, setSelectedLayer, selectSelectedLayerIds, selectSelectedCanvas } from '../../../store/slices/selectionSlice'
import { selectLayers, duplicateLayer, bringLayerToFront, sendLayerToBack, bringLayerForward, sendLayerBackward, updateLayer, deleteLayer, selectCurrentSceneId, selectCurrentScene, selectSceneMotionFlows, selectScenes, setBackgroundImage, removeBackgroundImage, detachBackgroundImage, selectProjectTimelineInfo } from '../../../store/slices/projectSlice'

// =============================================================================
// MEMOIZED SELECTORS
// =============================================================================

// Combined selector for stage-related state to prevent unnecessary re-renders
const selectStageState = createSelector(
  [selectSelectedLayerIds, selectSelectedCanvas, selectLayers, selectCurrentSceneId, selectCurrentScene, selectSceneMotionFlows, selectScenes, selectProjectTimelineInfo],
  (selectedLayerIds, selectedCanvas, layers, currentSceneId, currentScene, sceneMotionFlows, scenes, timelineInfo) => ({
    selectedLayerIds,
    selectedCanvas,
    layers,
    currentSceneId,
    currentScene,
    sceneMotionFlows,
    scenes,
    timelineInfo
  })
)

// =============================================================================
// CONSTANTS
// =============================================================================

const CAMERA_CONTROLS = {
  ZOOM_FACTOR_IN: 0.9,
  ZOOM_FACTOR_OUT: 1.1,
  MIN_ZOOM: 10,
  MAX_ZOOM: 400,
  PAN_SPEED_MULTIPLIER: 0.5,
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

// Calculate the zoom level that fits the artboard in the container with padding
const calculateFitZoom = (stageSize, worldWidth, worldHeight, roundToNearest5 = false) => {
  if (stageSize.width <= 0 || stageSize.height <= 0) return 100

  // Calculate zoom that fits the artboard in the current container with padding
  const padding = 0.1 // 10% padding around artboard
  const availableWidth = stageSize.width * (1 - padding)
  const availableHeight = stageSize.height * (1 - padding)

  const scaleX = availableWidth / worldWidth
  const scaleY = availableHeight / worldHeight
  const fitScale = Math.min(scaleX, scaleY)

  // Convert to zoom percentage
  const calculatedFitZoom = fitScale * 100

  // Clamp to reasonable bounds
  const clampedZoom = Math.max(10, Math.min(500, calculatedFitZoom))

  // Round to nearest 5% for clean display if requested
  return roundToNearest5 ? Math.round(clampedZoom / 5) * 5 : Math.round(clampedZoom)
}



// =============================================================================
// COMPONENT DEFINITION & PROPS
// =============================================================================

function Stage({
  aspectRatio,
  showGrid,
  showSafeArea,
  activeTool = 'select',
  onRightClick,
  zoom = 100,
  onZoomChange,
  onViewportChange, // Add onViewportChange prop
  topToolbarHeight = 0,
  onReady, // Callback fired when PIXI canvas is initialized
  //motion capture mode & playback controls
  motionCaptureMode = null,
  onMotionStateChange,
  editingStepId = null,
  // text editing
  editingTextLayerId,
  onTextChange,
  onFinishEditing,
  onStartTextEditing,
  totalTime = 0,
}, ref) { // Add ref parameter
  // =============================================================================
  // STATE MANAGEMENT
  // =============================================================================

  const dispatch = useDispatch()


  // Component state
  const [contextMenu, setContextMenu] = useState(null)
  const [lockedTooltip, setLockedTooltip] = useState(null) // { x, y }
  const lockedTooltipTimeoutRef = useRef(null)

  // Refs
  const containerRef = useRef(null)
  const canvasWrapperRef = useRef(null)
  const stageContainerRef = useRef(null)
  const viewportInitializedRef = useRef(false)
  const prevAspectRatioRef = useRef(aspectRatio)

  // Cache PIXI objects to avoid recreating them
  const maskRef = useRef(null)

  // Debouncing refs for zoom and pan operations
  const zoomDebounceRef = useRef(null)
  const panDebounceRef = useRef(null)

  // Camera control optimization refs - initialized with defaults, updated by effect
  const zoomScaleRef = useRef(1) // Default zoom scale (100%)
  const panSpeedRef = useRef(1) // Default pan speed
  const wheelPanSpeedRef = useRef(CAMERA_CONTROLS.PAN_SPEED_MULTIPLIER) // Default wheel pan speed

  // Refs for viewport and onZoomChange to reduce effect dependencies
  const viewportRef = useRef(null)
  const onZoomChangeRef = useRef(null)
  const interactionsAPIRef = useRef(null)

  // Redux state - memoized combined selectors for optimal performance
  const { selectedLayerIds, selectedCanvas, layers, currentSceneId, currentScene, sceneMotionFlows, scenes, timelineInfo } = useSelector(selectStageState)

  // =============================================================================
  // CANVAS DIMENSIONS & ASPECT RATIO
  // =============================================================================

  // Calculate world dimensions using shared hook
  const { worldWidth, worldHeight } = useWorldDimensions(aspectRatio)

  // Use container resize hook to get actual available space
  const containerDimensions = useContainerResize(stageContainerRef)

  // Memoize stage size calculation to prevent recalculation on every render
  const stageSize = useMemo(() => {
    return containerDimensions.width > 0 && containerDimensions.height > 0
      ? { width: containerDimensions.width, height: containerDimensions.height }
      : containerDimensions.height > 0
        ? { width: Math.max(containerDimensions.width, 800), height: containerDimensions.height }
        : { width: 800, height: 600 } // Fallback for initial render
  }, [containerDimensions.width, containerDimensions.height])


  // =============================================================================
  // ZOOM & CAMERA MANAGEMENT
  // =============================================================================

  // Calculate fit zoom - memoized for performance
  const fitZoom = useMemo(() => {
    return calculateFitZoom(stageSize, worldWidth, worldHeight, false)
  }, [stageSize.width, stageSize.height, worldWidth, worldHeight])

  // Initial zoom calculation moved to consolidated effect

  // Memoize effectiveZoom to prevent recalculation on every render
  const effectiveZoom = useMemo(() => zoom === -1 ? fitZoom : zoom, [zoom, fitZoom])

  // Memoize zoom scale for performance - used in multiple places
  const zoomScale = useMemo(() => effectiveZoom / 100, [effectiveZoom])


  // =============================================================================
  // PIXI CANVAS INITIALIZATION
  // =============================================================================

  // Initialize Pixi canvas
  // Screen dimensions match container, world dimensions are fixed
  const { viewport, stageContainer, layersContainer, pixiApp, isReady, error, retry } = usePixiCanvas(containerRef, {
    width: stageSize.width || 800,
    height: stageSize.height || 600,
    worldWidth,
    worldHeight,
    zoom: effectiveZoom, // Pass zoom for camera scaling
  })

  const getViewportSyncData = useCallback(() => {
    if (!viewport) return null
    const vp = viewport

    // Explicitly calculate world coordinates
    const calculatedLeft = (0 - vp.x) / vp.scale.x
    const calculatedTop = (0 - vp.y) / vp.scale.y
    const calculatedRight = calculatedLeft + vp.screenWidth / vp.scale.x
    const calculatedBottom = calculatedTop + vp.screenHeight / vp.scale.y

    const data = {
      x: vp.x,
      y: vp.y,
      scale: vp.scale.x,
      worldWidth,
      worldHeight,
      screenWidth: vp.screenWidth,
      screenHeight: vp.screenHeight,
      left: calculatedLeft,
      top: calculatedTop,
      right: calculatedRight,
      bottom: calculatedBottom
    }

    return data
  }, [viewport, worldWidth, worldHeight])

  const triggerViewportChange = useCallback(() => {
    if (onViewportChange && viewport) {
      const data = getViewportSyncData()
      if (data) onViewportChange(data)
    }
  }, [viewport, onViewportChange, getViewportSyncData])

  // Fire onReady prop when Pixi canvas is initialized
  useEffect(() => {
    if (isReady && onReady) {
      onReady()
    }
  }, [isReady, onReady])

  // Expose viewport controls to parent
  React.useImperativeHandle(ref, () => ({
    setViewportPosition: (x, y) => {
      if (viewport) {
        viewport.moveCenter(x, y)
        triggerViewportChange()
      }
    },
    getViewportData: () => {
      return getViewportSyncData()
    },
    // Expose PixiJS objects for thumbnail capture and external rendering
    getApp: () => pixiApp,
    getLayersContainer: () => layersContainer,
  }), [viewport, worldWidth, worldHeight, onViewportChange, getViewportSyncData, triggerViewportChange, pixiApp, layersContainer])

  // Create shared drag state API for both canvas interactions and selection box
  const dragStateAPI = useDragState()


  // =============================================================================
  // LAYER MANAGEMENT & SYNCHRONIZATION
  // =============================================================================



  // Sync layers from Redux store to canvas
  const { layerObjects, layerObjectsVersion } = useCanvasLayers(stageContainer, isReady, pixiApp, worldWidth, worldHeight, dragStateAPI, motionCaptureMode, editingTextLayerId, zoom, editingStepId)


  // Stage.jsx passes layerObjects to useSimpleMotion
  // Motion playback hook - now uses scene-based motion flows
  const { playAll, pauseAll, stopAndSeekToSceneStart, pausePlayback, stopAll, seek, tweenTo, isPlaying, isBuffering } = useSimpleMotion(layerObjects, currentSceneId, totalTime, null, motionCaptureMode)

  // Helper to get current transforms from PIXI objects (for accurate motion capture sync)
  const getLayerCurrentTransforms = useCallback(() => {
    if (!layerObjects) return new Map()

    const transforms = new Map()
    layerObjects.forEach((obj, id) => {
      // Prioritize checking if there's a cached sprite or similar structure
      // but usually obj is the Container or Sprite directly
      transforms.set(id, {
        x: obj.x,
        y: obj.y,
        scaleX: obj.scale?.x ?? 1,
        scaleY: obj.scale?.y ?? 1,
        rotation: (obj.rotation * 180) / Math.PI, // Convert rad to deg for consistent logic
        alpha: obj.alpha,
        cropX: obj.cropX ?? obj._storedCropX ?? 0,
        cropY: obj.cropY ?? obj._storedCropY ?? 0,
        cropWidth: obj.cropWidth ?? obj._storedCropWidth ?? obj._originalWidth ?? obj.width ?? 100,
        cropHeight: obj.cropHeight ?? obj._storedCropHeight ?? obj._originalHeight ?? obj.height ?? 100,
        mediaWidth: obj.mediaWidth ?? obj._storedMediaWidth ?? obj._mediaWidth ?? obj._originalWidth ?? obj.width ?? 100,
        mediaHeight: obj.mediaHeight ?? obj._storedMediaHeight ?? obj._mediaHeight ?? obj._originalHeight ?? obj.height ?? 100
      })
    })
    return transforms
  }, [layerObjects])

  // Helper to handle locked interaction feedback
  const handleLockedInteraction = useCallback((e) => {
    // Show tooltip at mouse position
    const x = e.data?.global?.x || e.clientX || 0
    const y = e.data?.global?.y || e.clientY || 0
    setLockedTooltip({ x, y })

    // Auto-hide after 3 seconds - clear existing timeout to prevent flickering
    if (lockedTooltipTimeoutRef.current) {
      clearTimeout(lockedTooltipTimeoutRef.current)
    }
    lockedTooltipTimeoutRef.current = setTimeout(() => {
      setLockedTooltip(null)
      lockedTooltipTimeoutRef.current = null
    }, 3000)
  }, [])

  // Close locked tooltip on any click outside
  useEffect(() => {
    if (!lockedTooltip) return

    const handleGlobalClick = (e) => {
      // Check if clicking inside the tooltip - if so, don't close here, let the button's onClick handle it
      if (e.target.closest('.locked-interaction-tooltip')) return

      setLockedTooltip(null)
      if (lockedTooltipTimeoutRef.current) {
        clearTimeout(lockedTooltipTimeoutRef.current)
        lockedTooltipTimeoutRef.current = null
      }
    }

    window.addEventListener('pointerdown', handleGlobalClick, { capture: true })
    return () => window.removeEventListener('pointerdown', handleGlobalClick, { capture: true })
  }, [lockedTooltip])

  // Pass motion controls up to parent
  // [PERFORMANCE FIX] Memoize the motion state object to prevent unnecessary 
  // re-renders in EditorPage when Stage re-renders due to internal layer updates.
  const motionState = useMemo(() => ({
    playAll,
    pauseAll,
    stopAndSeekToSceneStart,
    stopAll,
    seek,
    tweenTo,
    isPlaying,
    isBuffering,
    getLayerCurrentTransforms,
    layerObjects
  }), [playAll, pauseAll, stopAndSeekToSceneStart, stopAll, seek, tweenTo, isPlaying, isBuffering, getLayerCurrentTransforms, layerObjects])

  useEffect(() => {
    if (onMotionStateChange) {
      onMotionStateChange(motionState)
    }
  }, [onMotionStateChange, motionState])

  // [PREVIEW FIX] Track motion capture state transitions to avoid auto-pausing during apply/cancel previews
  const wasMotionCaptureActiveRef = useRef(false)
  const prevIsPlayingRef = useRef(isPlaying)

  // Pause playback when selecting layers/canvas while playing
  useEffect(() => {
    const isCurrentlyActive = !!motionCaptureMode?.isActive
    const isTransitioning = !!motionCaptureMode?.isTransitioning
    const selectionChanged = (selectedLayerIds && selectedLayerIds.length > 0) || selectedCanvas
    const playheadJustStarted = isPlaying && !prevIsPlayingRef.current

    // Update ref for next run
    prevIsPlayingRef.current = isPlaying

    // If we just exited capture mode AND we are currently playing,
    // it's likely the auto-preview from handleApplyMotion/handleCancelMotion.
    // We should NOT pause in this specific transition.
    if (wasMotionCaptureActiveRef.current && !isCurrentlyActive && isPlaying) {
      wasMotionCaptureActiveRef.current = isCurrentlyActive
      return
    }
    wasMotionCaptureActiveRef.current = isCurrentlyActive

    // [SCENE SYNC FIX] Skip auto-pause when playhead JUST started.
    // This avoids the loop where starting playback with a selection 
    // immediately triggers a pause before the 'clearLayerSelection' effect below can run.
    if (playheadJustStarted) return

    // [BUG 1 FIX] Skip auto-pause when Add Step is transitioning (fast-play preview).
    // During the transition, isActive is false but isTransitioning is true.
    // Without this guard, the effect would pause the tween, preventing onComplete
    // from firing and leaving the editor in a broken state.
    if (selectionChanged && isPlaying && !isCurrentlyActive && !isTransitioning) {
      pausePlayback()
    }
  }, [selectedLayerIds, selectedCanvas, isPlaying, motionCaptureMode, pausePlayback])

  // Clear selection boxes when playback starts for clean animation preview
  useEffect(() => {
    if (isPlaying) {
      dispatch(clearLayerSelection())
    }
  }, [isPlaying, dispatch])

  // Clear selection when scene changes to ensure no stale selection boxes or invisible layers are selected
  useEffect(() => {
    dispatch(clearLayerSelection())
  }, [currentSceneId, dispatch])


  // =============================================================================
  // MEMOIZED CALCULATIONS & LAYER SELECTIONS
  // =============================================================================

  // Memoize selected layer ID to avoid array access on every render
  const selectedLayerId = useMemo(() => selectedLayerIds[0], [selectedLayerIds])

  // Memoize selected layer lookup - only recalculates when ID or layers change
  const selectedLayer = useMemo(() =>
    selectedLayerId ? layers[selectedLayerId] : null,
    [selectedLayerId, layers]
  )

  // Memoize scene membership check - only recalculates when selectedLayer or scene changes
  const belongsToCurrentScene = useMemo(() =>
    selectedLayer && selectedLayer.sceneId === currentSceneId,
    [selectedLayer, currentSceneId]
  )

  // Memoize effective selected layer - only recalculates when scene membership or layer changes
  const effectiveSelectedLayer = useMemo(() =>
    belongsToCurrentScene && selectedLayerIds.length === 1 ? selectedLayer : null,
    [belongsToCurrentScene, selectedLayer, selectedLayerIds.length]
  )

  // Memoize selected layer object lookup - only recalculates when scene membership, layerObjects, or ID changes
  const selectedLayerObject = useMemo(() =>
    belongsToCurrentScene && layerObjects ? layerObjects.get(selectedLayerId) : null,
    [belongsToCurrentScene, layerObjects, selectedLayerId]
  )

  // Combined selected layer data for backward compatibility
  const selectedLayerData = useMemo(() => ({
    selectedLayerId,
    selectedLayer,
    belongsToCurrentScene,
    effectiveSelectedLayer,
    selectedLayerObject
  }), [selectedLayerId, selectedLayer, belongsToCurrentScene, effectiveSelectedLayer, selectedLayerObject])

  // [FIX] BACKGROUND OPTIMIZATION: Memoize background layer lookup to avoid finding it on every render/effect run
  const backgroundLayer = useMemo(() => {
    if (!currentScene?.layers || !layers) return null
    const bgId = currentScene.layers.find(id => layers[id]?.type === 'background')
    return bgId ? layers[bgId] : null
  }, [currentScene?.layers, layers])

  // Update background layer dimensions when world dimensions change
  const lastSyncedBgRef = useRef(null)
  useEffect(() => {
    if (!isReady || !backgroundLayer) return

    // [FIX] Double-check against ref to prevent potential update loops
    const currentSig = `${backgroundLayer.id}-${worldWidth}-${worldHeight}`
    if (lastSyncedBgRef.current === currentSig) return

    // Ensure background matches world dimensions exactly
    if (Math.abs(backgroundLayer.width - worldWidth) > 0.1 || Math.abs(backgroundLayer.height - worldHeight) > 0.1) {
      lastSyncedBgRef.current = currentSig
      dispatch(updateLayer({
        id: backgroundLayer.id,
        width: worldWidth,
        height: worldHeight
      }))
    }
  }, [worldWidth, worldHeight, backgroundLayer?.id, backgroundLayer?.width, backgroundLayer?.height, isReady, dispatch])

  // =============================================================================
  // CANVAS RENDERING & MASKS
  // =============================================================================

  // Add clipping overlay to layersContainer to hide parts of layers outside canvas
  // while still allowing interaction (clicks pass through overlay to hidden layer parts)
  useEffect(() => {
    if (!stageContainer || !layersContainer || !isReady) return

    // Create or reuse cached overlay frame
    let overlay = maskRef.current
    if (!overlay || overlay.destroyed) {
      overlay = new PIXI.Graphics()
      overlay.eventMode = 'none' // CRITICAL: Allow clicks to pass through to layers underneath
      overlay.x = 0
      overlay.y = 0
      overlay.label = 'stage-clipping-overlay'
      maskRef.current = overlay
    }

    // Clear previous graphics and redraw with new dimensions
    // We use 4 rectangles to create a frame around the world bounds.
    // This is highly performant (only 8 triangles) and stable on all hardware.
    overlay.clear()
    const margin = 50000 // Large margin to cover screen during zoom/pan
    const bgColor = 0x0f1015 // Match app background color

    // Top
    overlay.rect(-margin, -margin, worldWidth + margin * 2, margin)
    // Bottom
    overlay.rect(-margin, worldHeight, worldWidth + margin * 2, margin)
    // Left
    overlay.rect(-margin, 0, margin, worldHeight)
    // Right
    overlay.rect(worldWidth, 0, margin, worldHeight)
    overlay.fill(bgColor)

    // Ensure stageContainer has NO mask so interactions work outside world bounds
    if (stageContainer.mask) {
      stageContainer.mask = null
    }

    // Add overlay to layersContainer (parent of stageContainer) so it's on top of layers
    if (!overlay.parent) {
      layersContainer.addChild(overlay)
    }

    // Optional: Ensure it stays at the correct depth (above stage but below UI)
    // But usually addChild order is sufficient

    return () => {
      // No need to cleanup on every re-run to avoid flicker
    }
  }, [stageContainer, layersContainer, isReady, worldWidth, worldHeight])

  // Cleanup cached objects and timeouts on unmount
  useEffect(() => {
    return () => {
      // Clear debounce timeouts
      if (zoomDebounceRef.current) {
        clearTimeout(zoomDebounceRef.current)
      }
      if (panDebounceRef.current) {
        clearTimeout(panDebounceRef.current)
      }

      // Cleanup cached PIXI objects
      if (maskRef.current && !maskRef.current.destroyed && maskRef.current.parent) {
        maskRef.current.parent.removeChild(maskRef.current)
        maskRef.current.destroy()
        maskRef.current = null
      }
    }
  }, [])

  // Memoize current scene motion flow for visibility checks
  const currentSceneMotionFlow = useMemo(() => {
    const flow = sceneMotionFlows[currentSceneId] || { steps: [], pageDuration: 6000 }

    // Inject scene start offset for base-step visibility logic
    const sceneInfo = timelineInfo?.find(ti => ti.id === currentSceneId)
    return {
      ...flow,
      sceneStartOffset: sceneInfo?.startTime || 0
    }
  }, [sceneMotionFlows, currentSceneId, timelineInfo])

  // Show multi-selection box only when multiple layers are selected
  const multiSelectionAPI = useMultiSelectionBox(
    selectedLayerIds.length > 1 ? stageContainer : null,
    layersContainer,
    selectedLayerIds,
    layerObjects,
    layers,
    viewport,
    worldWidth,
    worldHeight,
    isPlaying, // Pass playing state to hide multi-selection box during playback
    motionCaptureMode, // Pass motion capture mode for real-time updates
    interactionsAPIRef, // Pass interactions API ref for direct arrow synchronization
    currentSceneId, // Pass current scene ID for filtering
    currentSceneMotionFlow, // Pass scene motion flow for visibility logic
    handleLockedInteraction // Pass locked interaction callback
  )

  // =============================================================================
  // CANVAS INTERACTIONS
  // =============================================================================

  // Memoize interaction parameters to reduce hook re-initialization
  const interactionParams = useMemo(() => ({
    layers,
    selectedLayerIds,
    activeTool,
    worldWidth,
    worldHeight,
    effectiveZoom,
    sceneMotionFlows,
    currentSceneId
  }), [layers, selectedLayerIds, activeTool, worldWidth, worldHeight, effectiveZoom, sceneMotionFlows, currentSceneId])

  // Set up interactions (selection, drag)
  const interactionsAPI = useCanvasInteractions(
    stageContainer,
    layersContainer,
    layerObjects,
    interactionParams,
    viewport,
    dragStateAPI,
    onStartTextEditing,
    motionCaptureMode,
    pausePlayback,
    isPlaying,
    multiSelectionAPI,
    handleLockedInteraction, // Pass locked interaction callback
    layerObjectsVersion // [Bug 3 Fix] Force rebind when async layers resolve
  )

  // Store interaction API in ref for use by other hooks
  useEffect(() => {
    interactionsAPIRef.current = interactionsAPI
  }, [interactionsAPI])

  // Conditional drag selection box - only when select tool is active
  useDragSelectionBox(
    activeTool === 'select' ? stageContainer : null,
    layerObjects,
    layers,
    viewport,
    selectedLayerIds,
    activeTool,
    isPlaying, // Pass playing state to hide drag selection during playback
    motionCaptureMode, // Pass motion capture mode for real-time updates
    currentSceneId // Pass current scene ID for filtering
  )

  // =============================================================================
  // SELECTION SYSTEM
  // =============================================================================

  // Handle layer update from selection box
  // [PERFORMANCE FIX] Use refs for frequently changing data to stabilize the callback
  const latestSelectedLayerDataRef = useRef(selectedLayerData)
  useEffect(() => {
    latestSelectedLayerDataRef.current = selectedLayerData
  }, [selectedLayerData])

  const handleLayerUpdate = useCallback((updates) => {
    const data = latestSelectedLayerDataRef.current
    if (!data.selectedLayerId) {
      return
    }

    // Create updated layer object for checking
    const updatedLayer = { ...data.selectedLayer, ...updates }
    const layerObject = layerObjects.get(data.selectedLayerId)

    // Check if layer is completely outside canvas after update
    if (isLayerCompletelyOutside(updatedLayer, layerObject, worldWidth, worldHeight)) {
      // Layer is completely outside canvas - delete it
      dispatch(deleteLayer(data.selectedLayerId))
      dispatch(clearLayerSelection())
    } else {
      // Layer is still inside or partially inside - update it
      // Simplified data merging: always preserve existing data and merge updates
      const updatePayload = {
        id: data.selectedLayerId,
        ...updates
      }

      dispatch(updateLayer(updatePayload))
    }
  }, [layerObjects, worldWidth, worldHeight, dispatch])

  useSelectionBox(
    stageContainer,
    effectiveSelectedLayer,
    selectedLayerObject,
    viewport,
    handleLayerUpdate,
    layerObjects, // Pass layer objects map for drag state updates
    dragStateAPI,
    layers, // Pass layers map for hover box during resize/rotate operations
    layersContainer, // Pass layersContainer so selection/hover boxes aren't clipped by stageContainer mask
    motionCaptureMode,
    isPlaying, // Pass playing state to hide selection box during playback
    currentSceneMotionFlow, // Pass scene motion flow for visibility logic
    handleLockedInteraction // Pass locked interaction callback
  )

  // =============================================================================
  // CAMERA CONTROLS
  // =============================================================================

  // Update zoom calculation refs when zoomScale changes
  useEffect(() => {
    zoomScaleRef.current = zoomScale
    panSpeedRef.current = 1 / zoomScale
    wheelPanSpeedRef.current = CAMERA_CONTROLS.PAN_SPEED_MULTIPLIER / zoomScale
  }, [zoomScale])

  // Update viewport and onZoomChange refs to reduce effect dependencies
  useEffect(() => {
    viewportRef.current = viewport
  }, [viewport])

  useEffect(() => {
    onZoomChangeRef.current = onZoomChange
  }, [onZoomChange])



  const handleWheel = useCallback((e) => {
    e.preventDefault()

    // Check if Ctrl/Cmd is pressed for zoom, otherwise pan
    if (e.ctrlKey || e.metaKey) {
      // Debounce zoom operations to prevent excessive updates
      if (zoomDebounceRef.current) {
        clearTimeout(zoomDebounceRef.current)
      }

      zoomDebounceRef.current = setTimeout(() => {
        // Calculate new zoom level using current zoom from ref
        const currentZoom = zoomScaleRef.current * 100
        const zoomFactor = e.deltaY > 0 ? CAMERA_CONTROLS.ZOOM_FACTOR_IN : CAMERA_CONTROLS.ZOOM_FACTOR_OUT
        const newZoom = Math.max(CAMERA_CONTROLS.MIN_ZOOM, Math.min(CAMERA_CONTROLS.MAX_ZOOM, currentZoom * zoomFactor))

        // Update the React state to reflect the zoom change
        if (onZoomChangeRef.current) {
          onZoomChangeRef.current(newZoom)
        }
      }, 16) // ~60fps debounce
    } else {
      // Pan with mouse wheel using cached calculations
      const panSpeed = wheelPanSpeedRef.current

      if (e.shiftKey) {
        // Shift + wheel = horizontal pan
        if (viewportRef.current) viewportRef.current.x -= e.deltaY * panSpeed
      } else {
        // Wheel alone = vertical pan
        if (viewportRef.current) viewportRef.current.y -= e.deltaY * panSpeed
      }

      // Explicitly trigger sync after manual pan
      triggerViewportChange()
    }
  }, [triggerViewportChange]) // No dependencies needed - using refs instead

  // Stable camera control handlers - use refs to avoid recreation
  const cameraControlStateRef = useRef({
    isSpacePressed: false,
    isMiddleMouseDown: false,
    lastMousePos: { x: 0, y: 0 }
  })

  // Stable event handlers using useCallback with minimal dependencies
  const keyDownHandler = useCallback((e) => {
    if (e.code === 'Space' && !e.repeat) {
      cameraControlStateRef.current.isSpacePressed = true
      if (containerRef.current) containerRef.current.style.cursor = 'grab'
    }
  }, [])

  const keyUpHandler = useCallback((e) => {
    if (e.code === 'Space') {
      cameraControlStateRef.current.isSpacePressed = false
      if (containerRef.current) containerRef.current.style.cursor = ''
    }
  }, [])

  const mouseDownHandler = useCallback((e) => {
    if (e.button === 1) { // Middle mouse button
      cameraControlStateRef.current.isMiddleMouseDown = true
      cameraControlStateRef.current.lastMousePos = { x: e.clientX, y: e.clientY }
      if (containerRef.current) containerRef.current.style.cursor = 'grabbing'
      e.preventDefault()
    } else if (cameraControlStateRef.current.isSpacePressed && e.button === 0) { // Left mouse with space
      cameraControlStateRef.current.lastMousePos = { x: e.clientX, y: e.clientY }
      if (containerRef.current) containerRef.current.style.cursor = 'grabbing'
      e.preventDefault()
    }
  }, [])

  const mouseMoveHandler = useCallback((e) => {
    const state = cameraControlStateRef.current
    if (state.isMiddleMouseDown || (state.isSpacePressed && e.buttons & 1)) {
      // Debounce pan operations for smoother performance
      if (panDebounceRef.current) {
        clearTimeout(panDebounceRef.current)
      }

      panDebounceRef.current = setTimeout(() => {
        const deltaX = e.clientX - state.lastMousePos.x
        const deltaY = e.clientY - state.lastMousePos.y

        // Get current pan speed from zoom scale ref
        const panSpeed = panSpeedRef.current

        // Pan the viewport
        if (viewport) {
          viewport.x -= deltaX * panSpeed
          viewport.y -= deltaY * panSpeed
          // Explicitly trigger sync after manual pan
          triggerViewportChange()
        }

        state.lastMousePos = { x: e.clientX, y: e.clientY }
      }, 8) // Faster debounce for panning (~120fps)

      e.preventDefault()
    }
  }, [viewport, triggerViewportChange])

  const mouseUpHandler = useCallback((e) => {
    const state = cameraControlStateRef.current
    if (e.button === 1) {
      state.isMiddleMouseDown = false
      if (containerRef.current) containerRef.current.style.cursor = state.isSpacePressed ? 'grab' : ''
    } else if (state.isSpacePressed && e.button === 0) {
      if (containerRef.current) containerRef.current.style.cursor = 'grab'
    }
  }, [])

  // Memoized handlers object for the effect
  const cameraControlHandlers = useMemo(() => ({
    keyDownHandler,
    keyUpHandler,
    mouseDownHandler,
    mouseMoveHandler,
    mouseUpHandler
  }), [keyDownHandler, keyUpHandler, mouseDownHandler, mouseMoveHandler, mouseUpHandler])

  // Memoized context menu to prevent recreation on every render
  // Get background image for current scene
  const currentSceneBackgroundLayer = useMemo(() => {
    if (!currentScene) return null
    return currentScene.layers
      .map(id => layers[id])
      .find(l => l?.type === 'background')
  }, [currentScene, layers])

  const contextMenuElement = useMemo(() => (
    contextMenu && createPortal(
      <>
        <div
          className="fixed z-[10010] bg-[#0f1015]/80 backdrop-blur-2xl rounded-xl shadow-[0_8px_32px_rgba(0,0,0,0.4)] border border-white/10 py-1.5 min-w-[180px] overflow-hidden transition-all duration-200 animate-in fade-in zoom-in-95"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseLeave={() => setContextMenu(null)}
        >
          {selectedLayerIds.length > 0 ? (
            <>
              <button
                onClick={() => {
                  if (selectedLayerIds[0]) {
                    dispatch(duplicateLayer(selectedLayerIds[0]))
                    setContextMenu(null)
                  }
                }}
                className="w-full px-3.5 py-2 text-left text-[13px] font-medium text-white/80 hover:text-white hover:bg-white/10 transition-colors flex items-center gap-2.5"
              >
                <Copy className="h-3.5 w-3.5 opacity-60" />
                Duplicate
              </button>
              {selectedLayer?.type === 'image' && (
                <button
                  onClick={() => {
                    const imageUrl = selectedLayer?.data?.url || selectedLayer?.data?.src
                    if (selectedLayerIds[0] && imageUrl) {
                      dispatch(setBackgroundImage({
                        sceneId: currentSceneId,
                        imageUrl: imageUrl,
                        originalWidth: selectedLayer.width,
                        originalHeight: selectedLayer.height,
                        originalScaleX: selectedLayer.scaleX,
                        originalScaleY: selectedLayer.scaleY
                      }))
                      dispatch(deleteLayer(selectedLayerIds[0]))
                      dispatch(clearLayerSelection())
                      setContextMenu(null)
                    }
                  }}
                  className="w-full px-3.5 py-2 text-left text-[13px] font-medium text-white/80 hover:text-white hover:bg-white/10 transition-colors flex items-center gap-2.5"
                >
                  <ImageIcon className="h-3.5 w-3.5 opacity-60" />
                  Set as Background
                </button>
              )}
              <button
                onClick={() => {
                  if (selectedLayerIds[0]) {
                    dispatch(bringLayerToFront(selectedLayerIds[0]))
                    setContextMenu(null)
                  }
                }}
                className="w-full px-3.5 py-2 text-left text-[13px] font-medium text-white/80 hover:text-white hover:bg-white/10 transition-colors flex items-center gap-2.5 border-t border-white/5 mt-1 pt-2.5"
              >
                <Layers className="h-3.5 w-3.5 opacity-60" />
                Bring to Front
              </button>
              <button
                onClick={() => {
                  if (selectedLayerIds[0]) {
                    dispatch(bringLayerForward(selectedLayerIds[0]))
                    setContextMenu(null)
                  }
                }}
                className="w-full px-3.5 py-2 text-left text-[13px] font-medium text-white/80 hover:text-white hover:bg-white/10 transition-colors flex items-center gap-2.5"
              >
                <ChevronUp className="h-3.5 w-3.5 opacity-60" />
                Bring Forward
              </button>
              <button
                onClick={() => {
                  if (selectedLayerIds[0]) {
                    dispatch(sendLayerBackward(selectedLayerIds[0]))
                    setContextMenu(null)
                  }
                }}
                className="w-full px-3.5 py-2 text-left text-[13px] font-medium text-white/80 hover:text-white hover:bg-white/10 transition-colors flex items-center gap-2.5"
              >
                <ChevronDown className="h-3.5 w-3.5 opacity-60" />
                Send Backward
              </button>
              <button
                onClick={() => {
                  if (selectedLayerIds[0]) {
                    dispatch(sendLayerToBack(selectedLayerIds[0]))
                    setContextMenu(null)
                  }
                }}
                className="w-full px-3.5 py-2 text-left text-[13px] font-medium text-white/80 hover:text-white hover:bg-white/10 transition-colors flex items-center gap-2.5"
              >
                <Layers3 className="h-3.5 w-3.5 opacity-60" />
                Send to Back
              </button>
              <div className="h-px bg-white/10 my-1.5 mx-3" />
              <button
                onClick={() => {
                  selectedLayerIds.forEach(id => dispatch(deleteLayer(id)))
                  dispatch(clearLayerSelection())
                  setContextMenu(null)
                }}
                className="w-full px-3.5 py-2 text-left text-[13px] font-medium text-red-400 hover:bg-red-500/20 hover:text-red-300 transition-colors flex items-center gap-2.5"
              >
                <Trash2 className="h-3.5 w-3.5 opacity-70" />
                Delete
              </button>
            </>
          ) : (
            <>
              {currentSceneBackgroundLayer?.data?.imageUrl && (
                <>
                  <button
                    onClick={() => {
                      dispatch(detachBackgroundImage({
                        sceneId: currentSceneId,
                        worldWidth,
                        worldHeight
                      }))
                      setContextMenu(null)
                    }}
                    className="w-full px-3.5 py-2 text-left text-[13px] font-medium text-white/80 hover:text-white hover:bg-white/10 transition-colors flex items-center gap-2.5"
                  >
                    <Unlink className="h-3.5 w-3.5 opacity-60" />
                    Detach Background Image
                  </button>
                  <button
                    onClick={() => {
                      dispatch(removeBackgroundImage({ sceneId: currentSceneId }))
                      setContextMenu(null)
                    }}
                    className="w-full px-3.5 py-2 text-left text-[13px] font-medium text-red-400 hover:bg-red-500/20 hover:text-red-300 transition-colors flex items-center gap-2.5"
                  >
                    <Trash2 className="h-3.5 w-3.5 opacity-70" />
                    Remove Background Image
                  </button>
                </>
              )}
              {/* Other canvas context items could go here */}
              {!currentSceneBackgroundLayer?.data?.imageUrl && (
                <div className="px-3 py-1.5 text-xs text-gray-500 italic">
                  Canvas Options
                </div>
              )}
            </>
          )}
        </div>
        <div
          className="fixed inset-0 z-[10005]"
          onClick={() => setContextMenu(null)}
        />
      </>,
      document.body
    )
  ), [contextMenu, selectedLayerIds, dispatch, selectedLayer, currentSceneId, currentSceneBackgroundLayer])
  // Camera controls for Canva-like behavior - optimized to reduce re-attachments
  useEffect(() => {
    if (!viewport || !isReady || !containerRef.current) return

    const container = containerRef.current
    const { keyDownHandler, keyUpHandler, mouseDownHandler, mouseMoveHandler, mouseUpHandler } = cameraControlHandlers

    // Add event listeners
    container.addEventListener('wheel', handleWheel, { passive: false })
    container.addEventListener('mousedown', mouseDownHandler)
    container.addEventListener('mousemove', mouseMoveHandler)
    container.addEventListener('mouseup', mouseUpHandler)

    window.addEventListener('keydown', keyDownHandler)
    window.addEventListener('keyup', keyUpHandler)

    // Cleanup
    return () => {
      container.removeEventListener('wheel', handleWheel)
      container.removeEventListener('mousedown', mouseDownHandler)
      container.removeEventListener('mousemove', mouseMoveHandler)
      container.removeEventListener('mouseup', mouseUpHandler)
      window.removeEventListener('keydown', keyDownHandler)
      window.removeEventListener('keyup', keyUpHandler)
    }
  }, [viewport, isReady, cameraControlHandlers]) // Optimized: handleWheel no longer depends on viewport/onZoomChange

  // =============================================================================
  // LIFECYCLE EFFECTS & INITIALIZATION
  // =============================================================================


  // Clear selection if selected layer doesn't belong to current scene
  useEffect(() => {
    if (selectedLayerData.selectedLayerId && selectedLayerData.selectedLayer && !selectedLayerData.belongsToCurrentScene) {
      dispatch(clearLayerSelection())
    }
  }, [selectedLayerData.selectedLayerId, selectedLayerData.selectedLayer, selectedLayerData.belongsToCurrentScene, dispatch])

  // Viewport initialization effect - runs once when viewport is ready
  useEffect(() => {
    if (viewport && isReady && !viewportInitializedRef.current && stageSize.width > 0 && stageSize.height > 0) {
      try {
        // Set initial zoom to fit (round to nearest 5% for clean display)
        const initialZoom = calculateFitZoom(stageSize, worldWidth, worldHeight, true)
        if (onZoomChange) {
          onZoomChange(initialZoom)
        }

        // Center the artboard in the viewport
        const centerX = worldWidth * 0.4  // 40% from left instead of 50%
        const centerY = worldHeight * 0.4  // 40% from top instead of 50%
        viewport.moveCenter(centerX, centerY)

        viewportInitializedRef.current = true
      } catch (error) {
        // Viewport initialization failed, continue silently
      }
    }
  }, [viewport, isReady, stageSize.width, stageSize.height, worldWidth, worldHeight, onZoomChange])

  // Auto-fit zoom effect - handles aspect ratio changes
  useEffect(() => {
    // Auto-fit zoom when aspect ratio changes
    if (aspectRatio && prevAspectRatioRef.current !== aspectRatio) {
      if (onZoomChange) {
        onZoomChange(fitZoom)
      }
      prevAspectRatioRef.current = aspectRatio
    }
  }, [aspectRatio, fitZoom, onZoomChange])

  // Consolidate viewport event listeners
  useEffect(() => {
    if (!viewport || !onViewportChange) return

    const handleViewportChange = () => {
      onViewportChange(getViewportSyncData())
    }

    viewport.on('moved', handleViewportChange)
    viewport.on('zoomed', handleViewportChange)

    // Initial sync
    handleViewportChange()

    return () => {
      viewport.off('moved', handleViewportChange)
      viewport.off('zoomed', handleViewportChange)
    }
  }, [viewport, onViewportChange, getViewportSyncData])

  // Sync on Resize: Ensure scrollbars update when container size changes
  useEffect(() => {
    if (isReady && viewport) {
      triggerViewportChange()
    }
  }, [stageSize.width, stageSize.height, isReady, viewport, triggerViewportChange])

  // Zoom handling effect - handles zoom changes from slider/keyboard and fit-to-viewport requests
  useEffect(() => {
    // Handle fit-to-viewport request (zoom === -1)
    if (zoom === -1 && onZoomChange) {
      onZoomChange(fitZoom)
      return
    }

    // Handle regular zoom changes (from slider or keyboard)
    if (viewport && isReady && zoom !== -1) {
      try {
        const currentZoomScale = viewport.scale.x
        const targetZoomScale = zoomScale

        // Only update if there's a significant difference (avoid floating point precision issues)
        if (Math.abs(currentZoomScale - targetZoomScale) > 0.001) {
          // Update zoom scale, centering on viewport center
          viewport.setZoom(zoomScale, true)
        }
      } catch (error) {
        // Viewport update failed, continue silently
      }
    }
  }, [viewport, isReady, zoom, zoomScale, fitZoom, onZoomChange])

  // =============================================================================
  // EVENT HANDLERS
  // =============================================================================

  const handleContextMenu = useCallback((e) => {
    e.preventDefault()

    // Select layer if hovering over one
    if (pixiApp && viewport && containerRef.current && layerObjects) {
      const rect = containerRef.current.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top

      // Use Pixi's hit testing system to find the object under the cursor
      // In PixiJS v8, the hit testing logic is on the rootBoundary of the event system
      const hitObject = pixiApp.renderer.events.rootBoundary.hitTest(x, y)

      if (hitObject) {
        const foundLayerId = findLayerIdFromObject(hitObject, layerObjects, stageContainer, viewport)
        const layer = layers[foundLayerId]

        // Don't select background layers on right click (consistent with left click)
        if (foundLayerId && layer?.type !== 'background' && layer?.sceneId === currentSceneId) {
          if (!selectedLayerIds.includes(foundLayerId)) {
            dispatch(setSelectedLayer(foundLayerId))
          }
        } else {
          // Clicked background or empty space on stage
          dispatch(clearLayerSelection())
        }
      } else {
        // Did not hit any Pixi object
        dispatch(clearLayerSelection())
      }
    }

    setContextMenu({ x: e.clientX, y: e.clientY })
    if (onRightClick) onRightClick(e)
  }, [pixiApp, viewport, layerObjects, stageContainer, selectedLayerIds, layers, currentSceneId, dispatch, onRightClick])







  // =============================================================================
  // RENDER
  // =============================================================================

  return (
    <div
      ref={stageContainerRef}
      className="relative flex w-full h-full stage-container"
    >
      {/* Canvas Stage - Fills container, camera zoom handled in viewport */}
      <div
        ref={canvasWrapperRef}
        className="relative shadow-2xl canvas-wrapper"
        onContextMenu={handleContextMenu}
      >
        {/* Grid Overlay */}
        {showGrid && (
          <div className="absolute inset-0 opacity-20 pointer-events-none grid-overlay"></div>
        )}

        {/* Safe Area Overlay */}
        {showSafeArea && (
          <div className="absolute inset-4 border-2 border-yellow-400 opacity-50 pointer-events-none"></div>
        )}

        {/* Pixi canvas container - fills the entire canvas container */}
        <div
          ref={containerRef}
          id="pixi-container"
          className="absolute inset-0 pixi-container"
          style={{
            touchAction: 'none',
            WebkitTouchCallout: 'none',
            WebkitUserSelect: 'none',
            userSelect: 'none',
            outline: 'none'
          }}
          onMouseDown={(e) => {
            if (isPlaying) {
              return
            }
            e.preventDefault()
          }}
          onTouchStart={(e) => {
            if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
              e.stopPropagation()
            }
          }}
          onDragStart={(e) => {
            e.preventDefault()
          }}
        />

        {/* Error State */}
        {error ? (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-900/90 z-50">
            <div className="bg-gray-800 p-6 rounded-lg border border-red-500/50 shadow-xl max-w-sm text-center">
              <h3 className="text-red-400 font-bold mb-2">Visual Engine Error</h3>
              <p className="text-gray-300 text-sm mb-4 text-balance">
                Unable to initialize the graphics engine. This may happen on devices with limited memory or disabled WebGL.
              </p>
              {error.message && (
                <div className="bg-gray-900 p-2 rounded text-xs text-red-300 mb-4 font-mono overflow-auto max-h-24">
                  {error.message}
                </div>
              )}
              <button
                onClick={retry}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded transition-colors w-full"
              >
                Retry Initialization
              </button>
            </div>
          </div>
        ) : !isReady ? (
          /* Empty Canvas Content - Only show when Pixi is not ready and no error */
          <div className="absolute inset-0 flex items-center justify-center text-gray-400 pointer-events-none" style={{ zIndex: 0 }}>
            <div className="text-center">
              <p className="text-sm animate-pulse">Initializing engine...</p>
            </div>
          </div>
        ) : null}

        {/* Text Edit Overlay */}
        {(() => {
          return editingTextLayerId && (
            <TextEditOverlay
              layer={editingTextLayerId ? layers[editingTextLayerId] : null}
              textObject={editingTextLayerId ? layerObjects.get(editingTextLayerId) : null}
              viewport={viewport}
              canvasContainer={containerRef.current}
              onTextChange={onTextChange}
              onFinishEditing={onFinishEditing}
            />
          )
        })()}
      </div>

      {/* Right-Click Context Menu */}
      {/* Locked Layer Tooltip */}
      {lockedTooltip && createPortal(
        <div
          className="locked-interaction-tooltip fixed z-[10020] bg-[#0f1015]/80 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] p-3.5 flex flex-col gap-4 animate-in fade-in zoom-in-95 slide-in-from-top-2 duration-300 min-w-[200px] max-w-[240px] origin-top-left"
          style={{
            left: Math.min(window.innerWidth - 240, lockedTooltip.x + 20),
            top: Math.min(window.innerHeight - 160, lockedTooltip.y + 20),
            transform: `scale(${Math.max(0.7, Math.min(1, window.innerWidth / 1440))})`
          }}
        >
          <div className="text-white/90 text-[11px] font-medium leading-relaxed">
            “This element is animated. Edit it from the start of the scene.”
          </div>
          <button
            onClick={() => {
              stopAndSeekToSceneStart()
              if (lockedTooltipTimeoutRef.current) {
                clearTimeout(lockedTooltipTimeoutRef.current)
                lockedTooltipTimeoutRef.current = null
              }
              setLockedTooltip(null)
            }}
            className="w-full h-8 bg-white/10 hover:bg-white/15 border border-white/20 text-white text-[10px] font-bold rounded-lg transition-all duration-200 flex items-center justify-center tracking-wider uppercase active:scale-95"
          >
            Go to Start
          </button>
        </div>,
        document.body
      )}

      {contextMenuElement}
    </div>
  )
}

export default React.memo(React.forwardRef(Stage))

