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
  ChevronRight,
  Lock,
  Unlock,
  ArrowLeft,
} from 'lucide-react'
import { useDispatch, useSelector } from 'react-redux'
import { createSelector } from '@reduxjs/toolkit'
import { ThemeContext } from '../../../app/context/ThemeContext'
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
import { isLayerCompletelyOutside, getEffectiveLayerDimensions } from '../utils/geometry'
import { findLayerIdFromObject } from '../utils/layerUtils'
import { clearLayerSelection, setSelectedLayer, selectSelectedLayerIds, selectSelectedCanvas } from '../../../store/slices/selectionSlice'
import { selectLayers, duplicateLayer, bringLayerToFront, sendLayerToBack, bringLayerForward, sendLayerBackward, updateLayer, deleteLayer, selectCurrentSceneId, selectCurrentScene, selectSceneMotionFlows, selectScenes, setBackgroundImage, removeBackgroundImage, detachBackgroundImage, selectProjectTimelineInfo, attachAssetToFrame, detachAssetFromFrame, addLayerAndSelect, toggleFrameLock } from '../../../store/slices/projectSlice'
import { attachAssetToFrame as attachAssetToFramePixi, attachBackAssetToFrame as attachBackAssetToFramePixi, unhighlightFrameDropTarget, showFramePlaceholderFallback } from '../../engine/pixi/createLayer'
import { getGlobalMotionEngine } from '../../engine/motion'
import { loadTextureRobust } from '../../engine/pixi/textureUtils'

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
  zoom = 31,
  onZoomChange,
  onViewportChange, // Add onViewportChange prop
  topToolbarHeight = 0,
  onReady, // Callback fired when PIXI canvas is initialized
  setStageReady, // Callback to signal when stage initially populates with layers
  //motion capture mode & playback controls
  motionCaptureMode = null,
  captureVersion = 0,
  onMotionStateChange,
  editingStepId = null,
  // text editing
  editingTextLayerId,
  onTextChange,
  onFinishEditing,
  onStartTextEditing,
  totalTime = 0,
  showPasteboard = true,
  previewMode = false, // View-only Preview Mode: disable all canvas interaction
  onError, // Callback for fatal graphics errors
}, ref) { // Add ref parameter
  // =============================================================================
  // STATE MANAGEMENT
  // =============================================================================

  const dispatch = useDispatch()


  // Component state
  const { theme } = React.useContext(ThemeContext)
  const [contextMenu, setContextMenu] = useState(null)
  const [subMenu, setSubMenu] = useState(null) // 'position' or null
  const subMenuTimerRef = useRef(null)


  // Refs
  const containerRef = useRef(null)
  const canvasWrapperRef = useRef(null)
  const stageContainerRef = useRef(null)
  const viewportInitializedRef = useRef(false)
  const prevAspectRatioRef = useRef(aspectRatio)

  // Cache PIXI objects to avoid recreating them
  const maskRef = useRef(null)

  const zoomDebounceRef = useRef(null)
  const zoomAccumulatorRef = useRef(0)
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

  // Memoize effectiveZoom to prevent recalculation on every render.
  // [PREVIEW MODE] In preview we always track the live fit zoom so the artboard
  // stays "closer to full screen" regardless of the user's pre-preview zoom. This
  // also fixes mobile, where the one-shot re-fit could freeze on a stale container
  // size: forcing fitZoom here re-applies the fit on every container resize.
  const effectiveZoom = useMemo(() => (previewMode || zoom === -1) ? fitZoom : zoom, [previewMode, zoom, fitZoom])

  // Memoize zoom scale for performance - used in multiple places
  const zoomScale = useMemo(() => effectiveZoom / 100, [effectiveZoom])


  // =============================================================================
  // PIXI CANVAS INITIALIZATION
  // =============================================================================

  // Initialize Pixi canvas
  // Screen dimensions match container, world dimensions are fixed
  const { viewport, stageContainer, layersContainer, artboardSurface, artboardShadow, pixiApp, isReady, error, retry } = usePixiCanvas(containerRef, {
    width: stageSize.width || 800,
    height: stageSize.height || 600,
    worldWidth,
    worldHeight,
    zoom: effectiveZoom, // Pass zoom for camera scaling
  })

  // Propagate error to parent
  useEffect(() => {
    if (error && onError) {
      onError(error)
    }
  }, [error, onError])

  const getViewportData = useCallback(() => {
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
      const data = getViewportData()
      if (data) onViewportChange(data)
    }
  }, [viewport, onViewportChange, getViewportData])

  // Fire onReady prop when Pixi canvas is initialized
  useEffect(() => {
    if (isReady && onReady) {
      onReady()
    }
  }, [isReady, onReady])

  // Update Pixi canvas background color based on theme
  useEffect(() => {
    if (pixiApp?.renderer) {
      pixiApp.renderer.background.color = theme === 'light' ? 0xffffff : 0x0f1015
    }
  }, [theme, pixiApp])

  // Expose viewport controls to parent
  React.useImperativeHandle(ref, () => ({
    setViewportPosition: (x, y) => {
      if (viewport) {
        viewport.moveCenter(x, y)
        triggerViewportChange()
      }
    },
    getViewportData: () => {
      return getViewportData()
    },
    // Expose PixiJS objects for thumbnail capture and external rendering
    getApp: () => pixiApp,
    getLayersContainer: () => layersContainer,
  }), [viewport, worldWidth, worldHeight, onViewportChange, getViewportData, triggerViewportChange, pixiApp, layersContainer])

  // [PREVIEW MODE] View-only: disable ALL canvas interaction at the PIXI level.
  // Interactions are bound through PixiJS' event system (layer eventMode='static',
  // selection handles, viewport pan/zoom plugins), so a CSS pointer-events block on
  // the container isn't sufficient. Turning off the viewport's child hit-testing
  // stops hover/select/handles, and pausing the viewport disables pan/zoom.
  useEffect(() => {
    if (!viewport || !isReady) return
    viewport.interactiveChildren = !previewMode
    viewport.pause = previewMode
    return () => {
      // Restore interactivity if the viewport survives a previewMode change.
      if (viewport && !viewport.destroyed) {
        viewport.interactiveChildren = true
        viewport.pause = false
      }
    }
  }, [viewport, isReady, previewMode])

  // Create shared drag state API for both canvas interactions and selection box
  const dragStateAPI = useDragState()


  // =============================================================================
  // LAYER MANAGEMENT & SYNCHRONIZATION
  // =============================================================================



  // Sync layers from Redux store to canvas
  const { layerObjects, layerObjectsVersion, isStageReady } = useCanvasLayers(stageContainer, isReady, pixiApp, worldWidth, worldHeight, dragStateAPI, motionCaptureMode, editingTextLayerId, zoom, editingStepId, captureVersion)

  useEffect(() => {
    if (isStageReady && setStageReady) {
      setStageReady(true)
    }
  }, [isStageReady, setStageReady])

  // Stage.jsx passes layerObjects to useSimpleMotion
  // Motion playback hook - now uses scene-based motion flows
  const { playAll, pauseAll, stopAndSeekToSceneStart, pausePlayback, stopAll, seek, tweenTo, isPlaying, isBuffering, prepareEngine } = useSimpleMotion(layerObjects, currentSceneId, totalTime, null, motionCaptureMode, stageContainer, editingTextLayerId)

  // Helper to get current transforms from PIXI objects (for accurate motion capture sync)
  const getLayerCurrentTransforms = useCallback(() => {
    if (!layerObjects) return new Map()

    const transforms = new Map()
    layerObjects.forEach((obj, id) => {
      // Prioritize checking if there's a cached sprite or similar structure
      // but usually obj is the Container or Sprite directly
      // [TILT] When a layer is tilted, the original PIXI object is forced to
      // alpha=0 and the visible opacity lives on the perspective mesh /
      // _intendedAlpha sentinel. Returning obj.alpha=0 here would make capture
      // mode initialise the layer at opacity 0 and immediately hide it on
      // selection. Prefer the intended alpha when the layer is tilt-hidden.
      let reportedAlpha = obj._tiltHidden && typeof obj._intendedAlpha === 'number'
        ? obj._intendedAlpha
        : obj.alpha
      if (reportedAlpha !== undefined && Math.abs(reportedAlpha - 0.000001) < 1e-7) {
        reportedAlpha = 1.0
      }
      transforms.set(id, {
        x: obj.x,
        y: obj.y,
        scaleX: obj.scale?.x ?? 1,
        scaleY: obj.scale?.y ?? 1,
        rotation: (obj.rotation * 180) / Math.PI, // Convert rad to deg for consistent logic
        alpha: reportedAlpha,
        // Expose the current tilt angles so capture-mode can preserve them
        // when synchronising from PIXI to Redux.
        tiltX: typeof obj._tiltXDeg === 'number' ? obj._tiltXDeg : 0,
        tiltY: typeof obj._tiltYDeg === 'number' ? obj._tiltYDeg : 0,
        blur: (obj.filters && obj._blurFilter && obj.filters.includes(obj._blurFilter)) ? obj._blurFilter.strength : 0,
        color: obj._storedFill ?? (obj.style?.fill) ?? (obj._storedColor !== undefined ? (typeof obj._storedColor === 'string' ? obj._storedColor : '#' + obj._storedColor.toString(16).padStart(6, '0')) : null) ?? null,
        mediaWidth: obj.mediaWidth ?? obj._mediaWidth ?? obj._originalWidth ?? obj.width ?? 100,
        mediaHeight: obj.mediaHeight ?? obj._mediaHeight ?? obj._originalWidth ?? obj.height ?? 100,
        visualRect: (obj.getBounds && viewport) ? (() => {
          const bounds = obj.getBounds();
          // Convert global screen bounds to world coordinates so EditorPage can apply its own scaling
          const topLeft = viewport.toWorld(bounds.x, bounds.y);
          const bottomRight = viewport.toWorld(bounds.x + bounds.width, bounds.y + bounds.height);
          return {
            x: topLeft.x,
            y: topLeft.y,
            width: bottomRight.x - topLeft.x,
            height: bottomRight.y - topLeft.y
          };
        })() : null
      })
    })
    return transforms
  }, [layerObjects, viewport])



  // Handle dropping an asset (image/video URL) onto a frame layer
  const handleDropAssetOnFrame = useCallback((frameLayerId, assetUrl, assetWidth, assetHeight, assetIsVideo = false, thumbnail = null) => {
    // [BLOCK DROP IN CAPTURE MODE] Block drops during motion capture
    if (motionCaptureMode?.isActive) {
      return
    }

    const frameLayer = layers[frameLayerId]
    if (!frameLayer || frameLayer.type !== 'frame') return

    // Card frame: determine which side to attach to based on showingFront
    const isCardFrame = frameLayer.data?.isCardFrame
    // Use PIXI visual state when timeline flip actions exist (scrubbing scenario),
    // otherwise use Redux base state (manual flip scenario).
    const frameObj = layerObjects?.get(frameLayerId)
    const currentShowingFront = frameObj?._showingFront !== undefined
      ? frameObj._showingFront
      : (frameLayer.data?.showingFront ?? true)
    const side = isCardFrame && currentShowingFront === false ? 'back' : 'front'

    // [LOCK CHECK] Prevent drop if target side is locked
    const isLocked = isCardFrame
      ? (side === 'back' ? frameLayer.data?.backIsLockedDrop : frameLayer.data?.frontIsLockedDrop)
      : frameLayer.data?.isLockedDrop

    if (isLocked) {
      return
    }

    // Compute contain-fit dimensions locally
    const frameW = frameLayer.width
    const frameH = frameLayer.height
    const scale = Math.min(frameW / (assetWidth || 300), frameH / (assetHeight || 200))
    const newFrameW = (assetWidth || 300) * scale
    const newFrameH = (assetHeight || 200) * scale

    // 1. Update Redux state
    dispatch(attachAssetToFrame({
      layerId: frameLayerId,
      assetUrl,
      assetWidth: assetWidth || 300,
      assetHeight: assetHeight || 200,
      side,
      assetIsVideo,
      thumbnail
    }))

    // 2. Update PIXI object immediately for visual feedback
    if (frameObj) {
      // Clear drop target highlight so the sync loop is not blocked
      unhighlightFrameDropTarget(frameObj, newFrameW, newFrameH)

      loadTextureRobust(assetUrl, assetIsVideo).then(texture => {
        if (frameObj.destroyed) return
        if (!texture) {
          showFramePlaceholderFallback(frameObj, side)
          return
        }
        if (side === 'back') {
          attachBackAssetToFramePixi(frameObj, texture, newFrameW, newFrameH)
          // Immediately show back sprite since we know the back side is facing the user
          if (frameObj._backSprite) frameObj._backSprite.visible = true
          if (frameObj._imageSprite) frameObj._imageSprite.visible = false
        } else {
          attachAssetToFramePixi(frameObj, texture, newFrameW, newFrameH)
        }
        if (frameObj._framePlaceholder) frameObj._framePlaceholder.visible = false

        // Force sync loop to pick up the new asset visibility (critical for scenes 2+)
        frameObj._forceNextSync = true

        // Re-trigger prepareEngine(true) to rebuild GSAP timelines with new asset details/dimensions!
        prepareEngine(true)
      }).catch(() => {
        if (frameObj && !frameObj.destroyed) {
          showFramePlaceholderFallback(frameObj, side)
        }
      })
    }
  }, [layers, layerObjects, dispatch, motionCaptureMode, prepareEngine])

  // Native canvas drag-and-drop listeners (React synthetic events don't reach the canvas)
  useEffect(() => {
    const canvas = containerRef.current?.querySelector('canvas')
    if (!canvas) return

    const onDragOver = (e) => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }

    const onDrop = (e) => {
      e.preventDefault()
      let asset
      try {
        const raw = e.dataTransfer.getData('application/vevara-asset')
        if (!raw) return
        asset = JSON.parse(raw)
        if (!asset.url) return
      } catch { return }

      let targetId = null

      // Hit-test to find frame layer under cursor
      if (pixiApp?.renderer?.events?.rootBoundary) {
        const rect = canvas.getBoundingClientRect()
        const x = e.clientX - rect.left
        const y = e.clientY - rect.top
        const hitObject = pixiApp.renderer.events.rootBoundary.hitTest(x, y)
        if (hitObject) {
          const foundId = findLayerIdFromObject(hitObject, layerObjects, stageContainer, viewport)
          if (layers[foundId]?.type === 'frame') {
            const frameLayer = layers[foundId]
            const isCardFrame = frameLayer.data?.isCardFrame
            const frameObj = layerObjects?.get(foundId)
            const currentShowingFront = frameObj?._showingFront !== undefined
              ? frameObj._showingFront
              : (frameLayer.data?.showingFront ?? true)
            const side = isCardFrame && currentShowingFront === false ? 'back' : 'front'

            const isLocked = isCardFrame
              ? (side === 'back' ? frameLayer.data?.backIsLockedDrop : frameLayer.data?.frontIsLockedDrop)
              : frameLayer.data?.isLockedDrop

            if (isLocked) {
              return
            }

            targetId = foundId
          }
        }
      }

      // Fallback: if selected layer is a frame, drop onto it
      if (!targetId && selectedLayerIds?.length === 1) {
        const selId = selectedLayerIds[0]
        if (layers[selId]?.type === 'frame') {
          targetId = selId
        }
      }

      if (targetId) {
        handleDropAssetOnFrame(targetId, asset.url, asset.width || 300, asset.height || 200, asset.type === 'video', asset.thumbnail || null)
      }
    }

    canvas.addEventListener('dragover', onDragOver)
    canvas.addEventListener('drop', onDrop)
    return () => {
      canvas.removeEventListener('dragover', onDragOver)
      canvas.removeEventListener('drop', onDrop)
    }
  }, [pixiApp, viewport, layerObjects, layers, selectedLayerIds, handleDropAssetOnFrame, stageContainer])



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
    getViewportData,
    layerObjects
  }), [playAll, pauseAll, stopAndSeekToSceneStart, stopAll, seek, tweenTo, isPlaying, isBuffering, getLayerCurrentTransforms, getViewportData, layerObjects, viewport])

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
    belongsToCurrentScene && selectedLayerIds?.length === 1 ? selectedLayer : null,
    [belongsToCurrentScene, selectedLayer, selectedLayerIds.length]
  )

  // Memoize selected layer object lookup - only recalculates when scene membership, layerObjects, or ID changes
  const selectedLayerObject = useMemo(() =>
    belongsToCurrentScene && layerObjects ? layerObjects.get(selectedLayerId) : null,
    [belongsToCurrentScene, layerObjects, selectedLayerId, layerObjectsVersion]
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

    // [UX CHANGE] Use semi-transparent overlay instead of opaque background
    // This allows layers outside the canvas to be visible but clearly "off-stage".
    // [NEW] Controlled by showPasteboard toggle and light theme
    const overlayColor = theme === 'light'
      ? (showPasteboard ? 0xe1e3eb : 0xffffff)
      : 0x000000
    const overlayAlpha = showPasteboard ? 0.4 : 1.0

    // Top
    overlay.rect(-margin, -margin, worldWidth + margin * 2, margin)
    // Bottom
    overlay.rect(-margin, worldHeight, worldWidth + margin * 2, margin)
    // Left
    overlay.rect(-margin, 0, margin, worldHeight)
    // Right
    overlay.rect(worldWidth, 0, margin, worldHeight)
    overlay.fill({ color: overlayColor, alpha: overlayAlpha })

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
  }, [stageContainer, layersContainer, isReady, worldWidth, worldHeight, showPasteboard, theme])

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
    selectedLayerIds?.length > 1 ? stageContainer : null,
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
    effectiveZoom, // Pass zoom for handle scaling
    dragStateAPI // Pass dragStateAPI to check for active interactions
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
    sceneStartOffset: currentSceneMotionFlow?.sceneStartOffset || 0,
    currentSceneId,
    prepareEngine,
    previewMode // View-only: gate selection/hover handlers
  }), [layers, selectedLayerIds, activeTool, worldWidth, worldHeight, effectiveZoom, sceneMotionFlows, currentSceneId, currentSceneMotionFlow, prepareEngine, previewMode])

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
    currentSceneId, // Pass current scene ID for filtering
    previewMode // View-only: disable marquee drag-selection
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
    // [FIX] Strict Guard: Never update Redux "base state" during an active motion capture session.
    // Instead, useSelectionBox and useCanvasInteractions should call motionCaptureMode.onPositionUpdate.
    if (motionCaptureMode?.isActive) {
      return
    }

    const data = latestSelectedLayerDataRef.current
    if (!data.selectedLayerId) {
      return
    }

    // Create updated layer object for checking
    const updatedLayer = { ...data.selectedLayer, ...updates }
    const layerObject = layerObjects.get(data.selectedLayerId)

    // [UX CHANGE] Layers are NO LONGER deleted when moved outside the canvas.
    // The only way to delete a layer is for the user to manually trigger it.
    // This allows for a "pasteboard" workflow similar to professional design tools.
    const updatePayload = {
      id: data.selectedLayerId,
      ...updates
    }

    dispatch(updateLayer(updatePayload))
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
    interactionsAPI?.updateMotionArrowVisibility, // Pass arrow sync callback for live resize/rotate updates
    effectiveZoom, // Pass zoom for handle scaling
    layerObjectsVersion, // [Bug 2 Fix] Force re-initialization when layer PIXI instances change
    pausePlayback, // UX: Pause playback when resize/rotate starts
    editingTextLayerId
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
      // Accumulate delta in a ref to handle fast scrolling without losing events
      zoomAccumulatorRef.current += e.deltaY

      if (zoomDebounceRef.current) {
        clearTimeout(zoomDebounceRef.current)
      }

      zoomDebounceRef.current = setTimeout(() => {
        const delta = zoomAccumulatorRef.current
        zoomAccumulatorRef.current = 0

        // Calculate new zoom level using current zoom from ref
        const currentZoom = zoomScaleRef.current * 100

        // [UX FIX] Responsive yet smooth zoom
        const zoomFactor = Math.pow(0.9992, delta)
        const newZoom = Math.max(CAMERA_CONTROLS.MIN_ZOOM, Math.min(CAMERA_CONTROLS.MAX_ZOOM, currentZoom * zoomFactor))

        // Update the React state to reflect the zoom change
        if (onZoomChangeRef.current) {
          onZoomChangeRef.current(newZoom)
        }
      }, 8)
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
          className={`fixed z-[10010] backdrop-blur-2xl rounded-xl py-1.5 min-w-[180px] transition-all duration-200 animate-in fade-in zoom-in-95 ${theme === 'light'
            ? 'bg-white/95 shadow-[0_8px_32px_rgba(0,0,0,0.12)] border border-gray-200/80'
            : 'bg-[#090a0d]/80 shadow-[0_8px_32px_rgba(0,0,0,0.4)] border border-white/10'
            }`}
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseLeave={() => {
            if (subMenuTimerRef.current) clearTimeout(subMenuTimerRef.current)
            subMenuTimerRef.current = setTimeout(() => {
              setSubMenu(null)
            }, 300)
          }}
        >
          {selectedLayerIds?.length > 0 ? (
            <>
              <button
                onMouseEnter={() => setSubMenu(null)}
                onClick={() => {
                  if (selectedLayerIds[0]) {
                    dispatch(duplicateLayer(selectedLayerIds[0]))
                    setContextMenu(null)
                  }
                }}
                className={`w-full px-3.5 py-2 text-left text-[13px] font-medium transition-colors flex items-center gap-2.5 ${theme === 'light'
                  ? 'text-gray-700 hover:text-gray-900 hover:bg-gray-100'
                  : 'text-white/80 hover:text-white hover:bg-white/10'
                  }`}
              >
                <Copy className="h-3.5 w-3.5 opacity-60" />
                Duplicate
              </button>
              {selectedLayer?.type === 'image' && (
                <button
                  onMouseEnter={() => setSubMenu(null)}
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
                  className={`w-full px-3.5 py-2 text-left text-[13px] font-medium transition-colors flex items-center gap-2.5 ${theme === 'light'
                    ? 'text-gray-700 hover:text-gray-900 hover:bg-gray-100'
                    : 'text-white/80 hover:text-white hover:bg-white/10'
                    }`}
                >
                  <ImageIcon className="h-3.5 w-3.5 opacity-60" />
                  Set as Background
                </button>
              )}
              {selectedLayer?.type === 'frame' && (selectedLayer?.data?.assetUrl || (selectedLayer?.data?.isCardFrame && selectedLayer?.data?.backAssetUrl)) && (
                <button
                  onMouseEnter={() => setSubMenu(null)}
                  onClick={() => {
                    if (selectedLayerIds[0]) {
                      const frameLayerId = selectedLayerIds[0]
                      const frameLayer = layers[frameLayerId]
                      const frameObj = layerObjects?.get(frameLayerId)
                      const isCardFrame = frameLayer?.data?.isCardFrame
                      const currentShowingFront = frameObj?._showingFront !== undefined
                        ? frameObj._showingFront
                        : (frameLayer?.data?.showingFront !== false)
                      const detachBack = isCardFrame && !currentShowingFront

                      const assetUrl = detachBack ? frameLayer?.data?.backAssetUrl : frameLayer?.data?.assetUrl
                      const assetWidth = detachBack
                        ? (frameLayer?.data?.backAssetWidth || frameLayer?.width || 200)
                        : (frameLayer?.data?.assetWidth || frameLayer?.width || 200)
                      const assetHeight = detachBack
                        ? (frameLayer?.data?.backAssetHeight || frameLayer?.height || 200)
                        : (frameLayer?.data?.assetHeight || frameLayer?.height || 200)

                      // Create a standalone layer from the detached asset
                      if (assetUrl) {
                        const isVideo = !!(frameLayer?.data?.assetIsVideo)
                        const maxSize = 400
                        const ratio = Math.min(maxSize / assetWidth, maxSize / assetHeight, 1)
                        const displayW = Math.round(assetWidth * ratio)
                        const displayH = Math.round(assetHeight * ratio)

                        dispatch(addLayerAndSelect({
                          sceneId: currentSceneId,
                          type: isVideo ? 'video' : 'image',
                          name: isVideo ? 'Detached Video' : 'Detached Image',
                          x: frameLayer.x ?? (worldWidth / 2),
                          y: frameLayer.y ?? (worldHeight / 2),
                          width: displayW,
                          height: displayH,
                          anchorX: 0.5,
                          anchorY: 0.5,
                          mediaWidth: assetWidth,
                          mediaHeight: assetHeight,
                          data: {
                            url: assetUrl,
                            src: assetUrl,
                            // Preserving video metadata is critical for continuity
                            assetIsVideo: isVideo,
                            muted: frameLayer.data?.muted,
                            sourceStartTime: frameLayer.data?.sourceStartTime,
                            sourceEndTime: frameLayer.data?.sourceEndTime,
                            duration: frameLayer.data?.duration
                          }
                        }))
                      }

                      // Reset PIXI frame object immediately
                      if (detachBack) {
                        // Detach back side
                        if (frameObj && frameObj._backSprite) {
                          frameObj._backSprite.texture = PIXI.Texture.WHITE
                          frameObj._backSprite.alpha = 0
                          frameObj._frameHasBackAsset = false
                          if (frameObj._framePlaceholder) frameObj._framePlaceholder.visible = true
                        }
                        dispatch(detachAssetFromFrame({ layerId: frameLayerId, side: 'back' }))
                      } else {
                        // Detach front side
                        if (frameObj && frameObj._imageSprite) {
                          frameObj._imageSprite.texture = PIXI.Texture.WHITE
                          frameObj._imageSprite.alpha = 0
                          frameObj._frameHasAsset = false
                          if (frameObj._framePlaceholder) frameObj._framePlaceholder.visible = true
                        }
                        dispatch(detachAssetFromFrame({ layerId: frameLayerId }))
                      }
                      setContextMenu(null)
                    }
                  }}
                  className={`w-full px-3.5 py-2 text-left text-[13px] font-medium transition-colors flex items-center gap-2.5 ${theme === 'light'
                    ? 'text-gray-700 hover:text-gray-900 hover:bg-gray-100'
                    : 'text-white/80 hover:text-white hover:bg-white/10'
                    }`}
                >
                  <Unlink className="h-3.5 w-3.5 opacity-60" />
                  Detach Asset
                </button>
              )}
              {selectedLayer?.type === 'frame' && (
                <button
                  onMouseEnter={() => setSubMenu(null)}
                  onClick={() => {
                    if (selectedLayerIds[0]) {
                      const frameLayer = layers[selectedLayerIds[0]]
                      const isCardFrame = frameLayer?.data?.isCardFrame
                      const frameObj = layerObjects?.get(selectedLayerIds[0])
                      const currentShowingFront = frameObj?._showingFront !== undefined
                        ? frameObj._showingFront
                        : (frameLayer?.data?.showingFront ?? true)
                      const side = isCardFrame && currentShowingFront === false ? 'back' : 'front'

                      dispatch(toggleFrameLock({ layerId: selectedLayerIds[0], side }))
                      setContextMenu(null)
                    }
                  }}
                  className={`w-full px-3.5 py-2 text-left text-[13px] font-medium transition-colors flex items-center gap-2.5 ${theme === 'light'
                    ? 'text-gray-700 hover:text-gray-900 hover:bg-gray-100'
                    : 'text-white/80 hover:text-white hover:bg-white/10'
                    }`}
                >
                  {(() => {
                    const frameLayer = layers[selectedLayerIds[0]]
                    const isCardFrame = frameLayer?.data?.isCardFrame
                    const frameObj = layerObjects?.get(selectedLayerIds[0])
                    const currentShowingFront = frameObj?._showingFront !== undefined
                      ? frameObj._showingFront
                      : (frameLayer?.data?.showingFront ?? true)
                    const side = isCardFrame && currentShowingFront === false ? 'back' : 'front'

                    const isLocked = isCardFrame
                      ? (side === 'back' ? frameLayer?.data?.backIsLockedDrop : frameLayer?.data?.frontIsLockedDrop)
                      : frameLayer?.data?.isLockedDrop

                    const labelPrefix = isCardFrame
                      ? (side === 'back' ? 'Back ' : 'Front ')
                      : ''

                    return (
                      <>
                        {isLocked ? <Unlock className="h-3.5 w-3.5 opacity-60" /> : <Lock className="h-3.5 w-3.5 opacity-60" />}
                        {isLocked ? `Unlock ${labelPrefix}Asset Drop` : `Lock ${labelPrefix}Asset Drop`}
                      </>
                    )
                  })()}
                </button>
              )}
              {selectedLayer?.type === 'frame' && (
                <button
                  onMouseEnter={() => setSubMenu(null)}
                  onClick={() => {
                    if (selectedLayerIds[0]) {
                      const currentLabel = selectedLayer?.data?.label || ''
                      const newLabel = window.prompt('Enter frame label:', currentLabel)
                      if (newLabel !== null) {
                        dispatch(updateLayer({
                          id: selectedLayerIds[0],
                          data: { label: newLabel }
                        }))
                        setContextMenu(null)
                      }
                    }
                  }}
                  className={`w-full px-3.5 py-2 text-left text-[13px] font-medium transition-colors flex items-center gap-2.5 ${theme === 'light'
                    ? 'text-gray-700 hover:text-gray-900 hover:bg-gray-100'
                    : 'text-white/80 hover:text-white hover:bg-white/10'
                    }`}
                >
                  <ImageIcon className="h-3.5 w-3.5 opacity-60" />
                  Set Label
                </button>
              )}
              <div className="relative">
                <button
                  onMouseEnter={() => {
                    if (subMenuTimerRef.current) clearTimeout(subMenuTimerRef.current)
                    subMenuTimerRef.current = setTimeout(() => setSubMenu('position'), 300)
                  }}
                  onClick={() => setSubMenu(subMenu === 'position' ? null : 'position')}
                  className={`w-full px-3.5 py-2 text-left text-[13px] font-medium transition-colors flex items-center justify-between gap-2.5 border-t mt-1 pt-2.5 ${theme === 'light'
                    ? 'border-gray-100'
                    : 'border-white/5'
                    } ${subMenu === 'position'
                      ? (theme === 'light' ? 'bg-gray-100 text-gray-900' : 'bg-white/10 text-white')
                      : (theme === 'light' ? 'text-gray-700 hover:text-gray-900 hover:bg-gray-100' : 'text-white/80 hover:text-white hover:bg-white/10')
                    }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Layers className="h-3.5 w-3.5 opacity-60" />
                    Position
                  </div>
                  <ChevronRight className={`h-3.5 w-3.5 opacity-40 transition-transform duration-200 ${subMenu === 'position' ? 'rotate-90' : ''}`} />
                </button>

                {subMenu === 'position' && (
                  <div
                    className={`absolute ${contextMenu.x > window.innerWidth - 350 ? 'right-full mr-1' : 'left-full ml-1'} top-0 backdrop-blur-2xl rounded-xl shadow-2xl py-1.5 min-w-[160px] animate-in fade-in slide-in-from-left-2 duration-200 ${theme === 'light'
                      ? 'bg-white/95 border border-gray-200/80 shadow-[0_8px_32px_rgba(0,0,0,0.12)]'
                      : 'bg-[#090a0d]/90 border border-white/10 shadow-2xl'
                      }`}
                    onMouseEnter={() => {
                      if (subMenuTimerRef.current) clearTimeout(subMenuTimerRef.current)
                    }}
                  >
                    <button
                      onClick={() => {
                        if (selectedLayerIds[0]) {
                          dispatch(bringLayerToFront(selectedLayerIds[0]))
                          setContextMenu(null)
                          setSubMenu(null)
                        }
                      }}
                      className={`w-full px-3.5 py-2 text-left text-[13px] font-medium transition-colors flex items-center gap-2.5 ${theme === 'light'
                        ? 'text-gray-700 hover:text-gray-900 hover:bg-gray-100'
                        : 'text-white/80 hover:text-white hover:bg-white/10'
                        }`}
                    >
                      <Layers className="h-3.5 w-3.5 opacity-60" />
                      Bring to Front
                    </button>
                    <button
                      onClick={() => {
                        if (selectedLayerIds[0]) {
                          dispatch(bringLayerForward(selectedLayerIds[0]))
                          setContextMenu(null)
                          setSubMenu(null)
                        }
                      }}
                      className={`w-full px-3.5 py-2 text-left text-[13px] font-medium transition-colors flex items-center gap-2.5 ${theme === 'light'
                        ? 'text-gray-700 hover:text-gray-900 hover:bg-gray-100'
                        : 'text-white/80 hover:text-white hover:bg-white/10'
                        }`}
                    >
                      <ChevronUp className="h-3.5 w-3.5 opacity-60" />
                      Bring Forward
                    </button>
                    <button
                      onClick={() => {
                        if (selectedLayerIds[0]) {
                          dispatch(sendLayerBackward(selectedLayerIds[0]))
                          setContextMenu(null)
                          setSubMenu(null)
                        }
                      }}
                      className={`w-full px-3.5 py-2 text-left text-[13px] font-medium transition-colors flex items-center gap-2.5 ${theme === 'light'
                        ? 'text-gray-700 hover:text-gray-900 hover:bg-gray-100'
                        : 'text-white/80 hover:text-white hover:bg-white/10'
                        }`}
                    >
                      <ChevronDown className="h-3.5 w-3.5 opacity-60" />
                      Send Backward
                    </button>
                    <button
                      onClick={() => {
                        if (selectedLayerIds[0]) {
                          dispatch(sendLayerToBack(selectedLayerIds[0]))
                          setContextMenu(null)
                          setSubMenu(null)
                        }
                      }}
                      className={`w-full px-3.5 py-2 text-left text-[13px] font-medium transition-colors flex items-center gap-2.5 ${theme === 'light'
                        ? 'text-gray-700 hover:text-gray-900 hover:bg-gray-100'
                        : 'text-white/80 hover:text-white hover:bg-white/10'
                        }`}
                    >
                      <Layers3 className="h-3.5 w-3.5 opacity-60" />
                      Send to Back
                    </button>
                  </div>
                )}
              </div>
              <div className={`h-px my-1.5 mx-3 ${theme === 'light' ? 'bg-gray-100' : 'bg-white/10'}`} />
              <button
                onMouseEnter={() => setSubMenu(null)}
                onClick={() => {
                  selectedLayerIds.forEach(id => dispatch(deleteLayer(id)))
                  dispatch(clearLayerSelection())
                  setContextMenu(null)
                }}
                className={`w-full px-3.5 py-2 text-left text-[13px] font-medium transition-colors flex items-center gap-2.5 ${theme === 'light'
                  ? 'text-red-500 hover:bg-red-50 hover:text-red-600'
                  : 'text-red-400 hover:bg-red-500/20 hover:text-red-300'
                  }`}
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
                    onMouseEnter={() => setSubMenu(null)}
                    onClick={() => {
                      dispatch(detachBackgroundImage({
                        sceneId: currentSceneId,
                        worldWidth,
                        worldHeight
                      }))
                      setContextMenu(null)
                    }}
                    className={`w-full px-3.5 py-2 text-left text-[13px] font-medium transition-colors flex items-center gap-2.5 ${theme === 'light'
                      ? 'text-gray-700 hover:text-gray-900 hover:bg-gray-100'
                      : 'text-white/80 hover:text-white hover:bg-white/10'
                      }`}
                  >
                    <Unlink className="h-3.5 w-3.5 opacity-60" />
                    Detach Background Image
                  </button>
                  <button
                    onMouseEnter={() => setSubMenu(null)}
                    onClick={() => {
                      dispatch(removeBackgroundImage({ sceneId: currentSceneId }))
                      setContextMenu(null)
                    }}
                    className={`w-full px-3.5 py-2 text-left text-[13px] font-medium transition-colors flex items-center gap-2.5 ${theme === 'light'
                      ? 'text-red-500 hover:bg-red-50 hover:text-red-600'
                      : 'text-red-400 hover:bg-red-500/20 hover:text-red-300'
                      }`}
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
          onClick={() => { setContextMenu(null); setSubMenu(null); }}
        />
      </>,
      document.body
    )
  ), [contextMenu, selectedLayerIds, dispatch, selectedLayer, currentSceneId, currentSceneBackgroundLayer, layerObjects, subMenu])
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
        // Set initial zoom to 18% if the artboard is vertical (portrait), 31% otherwise
        const isVertical = worldHeight > worldWidth
        const initialZoom = isVertical ? 18 : 31
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
      onViewportChange(getViewportData())
    }

    viewport.on('moved', handleViewportChange)
    viewport.on('zoomed', handleViewportChange)

    // Initial sync
    handleViewportChange()

    return () => {
      viewport.off('moved', handleViewportChange)
      viewport.off('zoomed', handleViewportChange)
    }
  }, [viewport, onViewportChange, getViewportData])

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

        // Sync with viewport immediately if there's any change
        if (currentZoomScale !== targetZoomScale) {
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

    setSubMenu(null)
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

        {/* Error State — Robust Recovery UI */}
        {error ? (
          <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-[#090a0d]/90 backdrop-blur-md p-8 text-center transition-all animate-in fade-in duration-500">
            <div className="w-20 h-20 mb-8 rounded-3xl bg-red-500/10 flex items-center justify-center border border-red-500/20 shadow-[0_0_40px_rgba(239,68,68,0.1)]">
              <Unlink className="w-10 h-10 text-red-500" />
            </div>

            <h3 className="text-2xl font-bold text-white mb-3 tracking-tight">Graphics Engine Error</h3>
            <p className="text-white/50 text-[13px] max-w-sm mb-10 leading-relaxed font-medium">
              Your browser's graphics processor ran into a temporary issue. This
              usually happens when GPU resources are low. Try Re-initializing
              first — in most cases it recovers instantly.
            </p>

            <div className="flex flex-col gap-3 w-full max-w-xs">
              {/* Primary: re-init in-place (cleans GPU contexts, re-creates renderer) */}
              <button
                onClick={() => retry()}
                className="w-full h-12 bg-[#6940c9] hover:bg-[#7b4ee3] text-white text-[13px] font-bold rounded-2xl transition-all active:scale-95 shadow-[0_10px_20px_rgba(105,64,201,0.2)] flex items-center justify-center gap-2"
              >
                Re-initialize Engine
              </button>

              {/* Secondary: full page reload */}
              <button
                onClick={() => window.location.reload()}
                className="w-full h-12 bg-white/5 hover:bg-white/10 border border-white/10 text-white text-[13px] font-bold rounded-2xl transition-all active:scale-95 flex items-center justify-center"
              >
                Reload Page
              </button>

              {/* Tertiary: nuclear option — kill ALL WebGL contexts then reload */}
              <button
                onClick={() => {
                  try {
                    // Release every WebGL context on the entire page
                    document.querySelectorAll('canvas').forEach((c) => {
                      try {
                        const gl = c.getContext('webgl2') || c.getContext('webgl')
                        if (gl) gl.getExtension('WEBGL_lose_context')?.loseContext()
                      } catch (_) { }
                    })
                  } catch (_) { }
                  // Hard reload after a small delay so drivers can reclaim
                  setTimeout(() => window.location.reload(), 400)
                }}
                className="w-full h-10 text-white/30 hover:text-white/50 text-[11px] font-medium rounded-xl transition-all flex items-center justify-center"
              >
                Clear GPU & Restart
              </button>
            </div>

            <div className="mt-12 group cursor-pointer">
              <div className="flex items-center justify-center gap-2 text-[10px] uppercase tracking-[0.2em] font-bold text-white/20 group-hover:text-red-400/40 transition-colors">
                Technical Details
              </div>
              <div className="mt-4 bg-black/40 border border-white/5 p-4 rounded-xl text-[10px] text-red-400/60 font-mono text-left max-w-md overflow-hidden text-ellipsis whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
                {error.message || 'Renderer failed to initialize hardware contexts (WebGL)'}
              </div>
            </div>
          </div>
        ) : !isReady ? (
          /* Initializing state — only when Pixi is starting up and no error */
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ zIndex: 0 }}>
            <div className="flex flex-col items-center gap-2">
              <div className={`w-5 h-5 border-[1.5px] rounded-full animate-spin ${
                theme === 'light' ? 'border-black/10 border-t-black/40' : 'border-white/10 border-t-white/40'
              }`} />
              <p className={`text-[10px] font-medium tracking-wider uppercase ${
                theme === 'light' ? 'text-black/30' : 'text-white/20'
              }`}>Initializing</p>
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

export default React.memo(React.forwardRef(Stage))

