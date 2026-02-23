// =============================================================================
// IMPORTS
// =============================================================================

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react'
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
import { clearLayerSelection } from '../../../store/slices/selectionSlice'
import { selectSelectedLayerIds } from '../../../store/slices/selectionSlice'
import { selectLayers, duplicateLayer, bringLayerToFront, sendLayerToBack, bringLayerForward, sendLayerBackward, updateLayer, deleteLayer, selectCurrentSceneId, selectCurrentScene, selectSceneMotionFlows, selectScenes, setBackgroundImage, removeBackgroundImage, detachBackgroundImage, selectProjectTimelineInfo } from '../../../store/slices/projectSlice'

// =============================================================================
// MEMOIZED SELECTORS
// =============================================================================

// Combined selector for stage-related state to prevent unnecessary re-renders
const selectStageState = createSelector(
  [selectSelectedLayerIds, selectLayers, selectCurrentSceneId, selectCurrentScene, selectSceneMotionFlows, selectScenes, selectProjectTimelineInfo],
  (selectedLayerIds, layers, currentSceneId, currentScene, sceneMotionFlows, scenes, timelineInfo) => ({
    selectedLayerIds,
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
  bottomSectionHeight = 0,
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
}) {
  // =============================================================================
  // STATE MANAGEMENT
  // =============================================================================

  const dispatch = useDispatch()

  // Component state
  const [contextMenu, setContextMenu] = useState(null)

  // Refs
  const containerRef = useRef(null)
  const canvasWrapperRef = useRef(null)
  const stageContainerRef = useRef(null)
  const viewportInitializedRef = useRef(false)
  const prevBottomSectionHeightRef = useRef(bottomSectionHeight)
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
  const { selectedLayerIds, layers, currentSceneId, currentScene, sceneMotionFlows, scenes, timelineInfo } = useSelector(selectStageState)

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

  // Create shared drag state API for both canvas interactions and selection box
  const dragStateAPI = useDragState()

  // DEBUG: Trace selection and drag state
  useEffect(() => {
    if (dragStateAPI.isDragging()) {
      console.log(`[Stage] isDragging=true draggingLayerId=${dragStateAPI.getDraggingLayerId()} selectedCount=${selectedLayerIds.length}`);
    }
  }, [dragStateAPI.isDragging(), dragStateAPI.getDraggingLayerId(), selectedLayerIds])

  // =============================================================================
  // LAYER MANAGEMENT & SYNCHRONIZATION
  // =============================================================================



  // Sync layers from Redux store to canvas
  const { layerObjects } = useCanvasLayers(stageContainer, isReady, pixiApp, worldWidth, worldHeight, dragStateAPI, motionCaptureMode, editingTextLayerId, zoom, editingStepId)


  // Stage.jsx passes layerObjects to useSimpleMotion
  // Motion playback hook - now uses scene-based motion flows
  const { playAll, pauseAll, stopAndSeekToSceneStart, pausePlayback, stopAll, seek, tweenTo, isPlaying } = useSimpleMotion(layerObjects, currentSceneId, totalTime)

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

  // Pass motion controls up to parent
  useEffect(() => {
    if (onMotionStateChange) {
      onMotionStateChange({
        playAll,
        pauseAll,
        stopAndSeekToSceneStart,
        stopAll,
        seek,
        tweenTo,
        isPlaying,
        getLayerCurrentTransforms, // Expose this new helper
        layerObjects
      })
    }
  }, [onMotionStateChange, playAll, pauseAll, stopAndSeekToSceneStart, stopAll, seek, tweenTo, isPlaying, getLayerCurrentTransforms, layerObjects])

  // Pause playback when selecting layers/canvas while playing
  useEffect(() => {
    if (selectedLayerIds && selectedLayerIds.length > 0 && isPlaying && !motionCaptureMode?.isActive) {
      // If there's a selection change while playing and NOT in motion capture, pause playback
      pausePlayback()
    }
  }, [selectedLayerIds, isPlaying, motionCaptureMode, pausePlayback])

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

  // Update background layer dimensions when world dimensions change
  useEffect(() => {
    if (!isReady || !currentSceneId || !layers) return

    // Find the background layer for the current scene
    const backgroundLayerId = currentScene?.layers?.find(layerId => {
      const layer = layers[layerId]
      return layer && layer.type === 'background'
    })

    if (backgroundLayerId) {
      const backgroundLayer = layers[backgroundLayerId]
      if (backgroundLayer && (backgroundLayer.width !== worldWidth || backgroundLayer.height !== worldHeight)) {
        // Update background layer dimensions to match world dimensions
        dispatch(updateLayer({
          id: backgroundLayerId,
          width: worldWidth,
          height: worldHeight
        }))
      }
    }
  }, [worldWidth, worldHeight, currentSceneId, currentScene, isReady, dispatch, layers])

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
    const bgColor = 0x0d1216 // Match app background color

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
    currentSceneMotionFlow // Pass scene motion flow for visibility logic
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
    multiSelectionAPI
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
  const handleLayerUpdate = useCallback((updates) => {
    if (!selectedLayerData.selectedLayerId) {
      return
    }

    // Create updated layer object for checking
    const updatedLayer = { ...selectedLayerData.selectedLayer, ...updates }
    const layerObject = layerObjects.get(selectedLayerData.selectedLayerId)

    // Check if layer is completely outside canvas after update
    if (isLayerCompletelyOutside(updatedLayer, layerObject, worldWidth, worldHeight)) {
      // Layer is completely outside canvas - delete it
      dispatch(deleteLayer(selectedLayerId))
      dispatch(clearLayerSelection())
    } else {
      // Layer is still inside or partially inside - update it
      // Simplified data merging: always preserve existing data and merge updates
      const updatePayload = {
        id: selectedLayerData.selectedLayerId,
        ...updates
      }

      dispatch(updateLayer(updatePayload))
    }
  }, [selectedLayerData.selectedLayerId, selectedLayerData.selectedLayer, layerObjects, worldWidth, worldHeight, selectedLayerId, dispatch])

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
    currentSceneMotionFlow // Pass scene motion flow for visibility logic
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
    }
  }, []) // No dependencies needed - using refs instead

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
        }

        state.lastMousePos = { x: e.clientX, y: e.clientY }
      }, 8) // Faster debounce for panning (~120fps)

      e.preventDefault()
    }
  }, [viewport])

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
    contextMenu && (
      <>
        <div
          className="fixed z-50 bg-gray-900 rounded-lg shadow-xl border border-gray-800 py-1 min-w-[160px]"
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
                className="w-full px-3 py-1.5 text-left text-sm text-gray-300 hover:bg-gray-800 flex items-center gap-2"
              >
                <Copy className="h-3.5 w-3.5" />
                Duplicate
              </button>
              {selectedLayer?.type === 'image' && (
                <button
                  onClick={() => {
                    const imageUrl = selectedLayer?.data?.url || selectedLayer?.data?.src
                    if (selectedLayerIds[0] && imageUrl) {
                      dispatch(setBackgroundImage({
                        sceneId: currentSceneId,
                        imageUrl: imageUrl
                      }))
                      dispatch(deleteLayer(selectedLayerIds[0]))
                      dispatch(clearLayerSelection())
                      setContextMenu(null)
                    }
                  }}
                  className="w-full px-3 py-1.5 text-left text-sm text-gray-300 hover:bg-gray-800 flex items-center gap-2"
                >
                  <ImageIcon className="h-3.5 w-3.5" />
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
                className="w-full px-3 py-1.5 text-left text-sm text-gray-300 hover:bg-gray-800 flex items-center gap-2"
              >
                <Layers className="h-3.5 w-3.5" />
                Bring to Front
              </button>
              <button
                onClick={() => {
                  if (selectedLayerIds[0]) {
                    dispatch(bringLayerForward(selectedLayerIds[0]))
                    setContextMenu(null)
                  }
                }}
                className="w-full px-3 py-1.5 text-left text-sm text-gray-300 hover:bg-gray-800 flex items-center gap-2"
              >
                <ChevronUp className="h-3.5 w-3.5" />
                Bring Forward
              </button>
              <button
                onClick={() => {
                  if (selectedLayerIds[0]) {
                    dispatch(sendLayerBackward(selectedLayerIds[0]))
                    setContextMenu(null)
                  }
                }}
                className="w-full px-3 py-1.5 text-left text-sm text-gray-300 hover:bg-gray-800 flex items-center gap-2"
              >
                <ChevronDown className="h-3.5 w-3.5" />
                Send Backward
              </button>
              <button
                onClick={() => {
                  if (selectedLayerIds[0]) {
                    dispatch(sendLayerToBack(selectedLayerIds[0]))
                    setContextMenu(null)
                  }
                }}
                className="w-full px-3 py-1.5 text-left text-sm text-gray-300 hover:bg-gray-800 flex items-center gap-2"
              >
                <Layers3 className="h-3.5 w-3.5" />
                Send to Back
              </button>
              <div className="h-px bg-gray-800 my-1 mx-2" />
              <button
                onClick={() => {
                  selectedLayerIds.forEach(id => dispatch(deleteLayer(id)))
                  dispatch(clearLayerSelection())
                  setContextMenu(null)
                }}
                className="w-full px-3 py-1.5 text-left text-sm text-red-400 hover:bg-gray-800 flex items-center gap-2"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </button>
            </>
          ) : (
            <>
              {currentSceneBackgroundLayer?.data?.imageUrl && (
                <>
                  <button
                    onClick={() => {
                      dispatch(detachBackgroundImage({ sceneId: currentSceneId }))
                      setContextMenu(null)
                    }}
                    className="w-full px-3 py-1.5 text-left text-sm text-gray-300 hover:bg-gray-800 flex items-center gap-2"
                  >
                    <Unlink className="h-3.5 w-3.5" />
                    Detach Background Image
                  </button>
                  <button
                    onClick={() => {
                      dispatch(removeBackgroundImage({ sceneId: currentSceneId }))
                      setContextMenu(null)
                    }}
                    className="w-full px-3 py-1.5 text-left text-sm text-red-400 hover:bg-gray-800 flex items-center gap-2"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
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
          className="fixed inset-0 z-40"
          onClick={() => setContextMenu(null)}
        />
      </>
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
    setContextMenu({ x: e.clientX, y: e.clientY })
    if (onRightClick) onRightClick(e)
  }, [onRightClick])







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
          onMouseDown={(e) => {
            // Don't work if playing
            if (isPlaying) {
              return
            }

            // Prevent text selection immediately on mousedown
            // This catches the event before it reaches Pixi
            e.preventDefault()
          }}
          onDragStart={(e) => {
            // Prevent any drag operations that might cause text selection
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
      {contextMenuElement}
    </div>
  )
}

export default React.memo(Stage)

