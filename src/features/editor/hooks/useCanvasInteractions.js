/**
 * Comprehensive canvas interaction hook that manages all user interactions with the design canvas.
 *
 * KEY RESPONSIBILITIES:
 * - Layer selection and multi-selection with visual feedback (hover boxes, selection indicators)
 * - Drag and drop operations with intelligent snapping (center, alignment, spacing, safe zones)
 * - Pointer event handling (down, move, up) with global tracking for smooth interactions
 * - Text layer special handling (double-click editing, word wrap management)
 * - Coordinate transformations between screen and world space with zoom-aware scaling
 * - Visual guide lines (center, alignment, spacing) with adaptive rendering
 * - Viewport drag management (pause/resume) during layer interactions
 * - Redux state synchronization with throttled updates for performance
 * - Event delegation and cleanup for proper memory management
 *
 * ORGANIZATION:
 * - Event handlers for pointer interactions and layer-specific behaviors
 * - Snapping system with multiple guide types and priority-based application
 * - Visual feedback system (hover effects, guide lines, selection boxes)
 * - State management integration with drag state tracking
 * - Cleanup and memory management for PIXI.js objects
 */

// =============================================================================
// IMPORTS AND DEPENDENCIES
// =============================================================================

import { useEffect, useRef, useCallback, useMemo } from 'react'
import { useDispatch } from 'react-redux'
import * as PIXI from 'pixi.js'
import { updateLayer, deleteLayer, updateSceneMotionAction, addSceneMotionAction } from '../../../store/slices/projectSlice'
import { setSelectedLayer, clearLayerSelection, setSelectedCanvas, setSelectedLayers } from '../../../store/slices/selectionSlice'
import { LAYER_TYPES } from '../../../store/models'
import { applyCenterSnapping, applyObjectAlignmentSnapping, applySpacingSnapping, applySafeZoneSnapping } from '../utils/centerSnapping'
import {
  getCombinedLayerBounds as computeCombinedLayerBounds,
  getLayerMetrics,
  isLayerCompletelyOutside,
  resolveAnchors,
  getLayerCenter,
  getLayerWorldBounds,
  getRotatedAABB,
  calculateTextDimensions
} from '../utils/geometry'
import { drawDashedLine } from '../../engine/pixi/dashUtils'
import { getCatmullRomPath, getSegmentMidpoint, getDistance } from '../utils/curveUtils'
import { filterBackgroundLayers as filterBgLayers, findLayerIdFromObject } from '../utils/layerUtils'
import { pauseViewportDragPlugin, resumeViewportDragPlugin } from '../utils/viewportUtils'
import { getScaledBadgeDimensions } from '../utils/badgeUtils'
import { getGlobalMotionEngine } from '../../engine/motion'


// Polyfill for requestIdleCallback (needed for Safari/iOS)
// Defined at module level to be available for all functions
const requestIdleCallback = (typeof window !== 'undefined' && window.requestIdleCallback)
  ? window.requestIdleCallback
  : function (cb) {
    return setTimeout(() => {
      const start = Date.now()
      cb({
        didTimeout: false,
        timeRemaining: () => Math.max(0, 50 - (Date.now() - start))
      })
    }, 1)
  }

const cancelIdleCallback = (typeof window !== 'undefined' && window.cancelIdleCallback)
  ? window.cancelIdleCallback
  : function (id) {
    clearTimeout(id)
  }

// =============================================================================
// HOOK FUNCTION AND INITIAL SETUP
// =============================================================================

/**
 * Sets up interaction handlers for Pixi objects
 * @param {PIXI.Container} stageContainer - Container with layers (clipped)
 * @param {PIXI.Container} layersContainer - Parent container for UI elements (no clipping)
 * @param {Map} layerObjectsMap - Map of layerId -> Pixi DisplayObject
 * @param {Object} layers - Map of layerId -> layer data
 * @param {string[]} selectedLayerIds - Currently selected layer IDs
 * @param {string} activeTool - Current tool ('select', 'move', 'resize', etc.)
 * @param {Object} viewport - Viewport instance for coordinate conversion
 * @param {number} worldWidth - Canvas world width
 * @param {number} worldHeight - Canvas world height
 * @param {number} [zoom=100] - Current zoom level (percentage, e.g., 100 = 100%)
 */
export function useCanvasInteractions(stageContainer, layersContainer, layerObjectsMap, interactionParams, viewport, dragStateAPI, onStartTextEditing, motionCaptureMode = null, pausePlayback = null, isPlaying = false, multiSelectionAPI = null) {
  const { layers, selectedLayerIds, activeTool, worldWidth, worldHeight, effectiveZoom: zoom = 100, sceneMotionFlows, currentSceneId } = interactionParams
  const dispatch = useDispatch()

  // =============================================================================
  // REFS AND STATE MANAGEMENT
  // =============================================================================
  const dragStartRef = useRef(null)
  const initialPositionsRef = useRef(new Map()) // Map of layerId -> initial { x, y } position
  const dragOffsetsRef = useRef(new Map()) // Map of layerId -> offset from drag start position for multi-select
  const multiSelectBoundsCenterRef = useRef(null) // Original bounding box center at drag start for multi-select
  const pointerIsDownRef = useRef(false) // Track if pointer is actually pressed down on the object
  const selectedLayerIdsRef = useRef(selectedLayerIds) // Keep latest selectedLayerIds in ref
  useEffect(() => {
    selectedLayerIdsRef.current = selectedLayerIds
  }, [selectedLayerIds])

  // PERFORMANCE: Use stable identifiers for heavy dependencies to prevent unnecessary re-binding of event listeners/effects
  const layersCount = useMemo(() => Object.keys(layers || {}).length, [layers])
  const selectedIdsStr = useMemo(() => (selectedLayerIds || []).join(','), [selectedLayerIds])
  const latestLayersRef = useRef(layers)
  const latestMotionCaptureModeRef = useRef(motionCaptureMode)
  // [OPTIMIZATION] Live ref to bypass React render cycle latency for the Ticker
  const liveMotionCaptureRef = useRef(motionCaptureMode)

  const latestIsPlayingRef = useRef(isPlaying)

  useEffect(() => {
    selectedLayerIdsRef.current = selectedLayerIds
    latestLayersRef.current = layers
    latestMotionCaptureModeRef.current = motionCaptureMode

    // Sync live ref, but don't overwrite if we have fresher data during a drag (optional optimization, 
    // but typically safe to sync on render as long as render is fast enough. 
    // Actually, to be safe, we should only update from props if we aren't currently dragging?
    // No, simple sync is safer to avoid drift. The drag event will re-update it immediately after if needed.)
    liveMotionCaptureRef.current = motionCaptureMode

    if (motionCaptureMode) {
      console.log('[DEBUG-HOOK] motionCaptureMode updated:', {
        isActive: motionCaptureMode.isActive,
        stepId: motionCaptureMode.stepId,
        layerActions: motionCaptureMode.layerActions ? Object.keys(motionCaptureMode.layerActions).length : 0
      })
    }

    latestParamsRef.current = interactionParams
    latestIsPlayingRef.current = isPlaying
  }, [selectedLayerIds, layers, motionCaptureMode, interactionParams, isPlaying])

  const latestParamsRef = useRef(interactionParams)
  const dragUpdateFrameRef = useRef(null) // For throttling Redux updates during drag
  const pendingDragUpdatesRef = useRef(new Map()) // Store pending drag updates
  const viewportScaleRef = useRef({ scale: 1, dragScale: 1 }) // Cache viewport scale calculations
  const snappingCacheRef = useRef({ otherObjects: null, selectedIds: null, layersHash: null }) // Cache snapping calculations
  const snapThrottlingRef = useRef({
    lastSnapTime: 0,
    lastSnapPosition: null,
    snapInterval: 16, // ~60fps, run snapping every frame for smooth UX
    isSnappingEnabled: true,
    frameCounter: 0, // Frame counter for throttling
    framesPerSnap: 2 // Run snapping every 2 frames (~30fps) instead of every frame
  }) // Throttle snapping calculations to improve performance
  const cacheInvalidationTimeoutRef = useRef(null) // Debounce cache invalidation
  const multiSelectBoundsCacheRef = useRef({ bounds: null, selectedIds: null, timestamp: 0 }) // Cache multi-select bounds calculations
  const dragMultiSelectBoundsCacheRef = useRef({ bounds: null, selectedIds: null }) // Persistent cache for multi-select bounds during drag operations
  const precalculatedMetricsRef = useRef(new Map()) // Cache for pre-calculated layer metrics
  const idleCallbackRef = useRef(null) // Reference for idle callback
  const performanceStatsRef = useRef({
    snappingCalculationTime: [],
    pointerMoveCount: 0,
    lastFrameTime: performance.now(),
    frameDropCount: 0
  }) // Performance monitoring

  // =============================================================================
  // MAIN-1  -        GUIDE LINE AND VISUAL FEEDBACK REFS
  // =============================================================================

  // Guide lines for center snapping
  const vGuideRef = useRef(null) // Vertical guide line (canvas center)
  const hGuideRef = useRef(null) // Horizontal guide line (canvas center)
  const lastGuidePositionRef = useRef({ vX: null, hY: null }) // Cache last guide positions to avoid unnecessary updates
  const lastCanvasDimensionsRef = useRef({ width: null, height: null }) // Track last canvas dimensions
  const currentGuideStateRef = useRef({ showVGuide: false, showHGuide: false }) // Track current guide visibility state

  // Debounced guide updates during drag operations
  const guideUpdateThrottleRef = useRef({
    lastUpdateTime: 0,
    updateInterval: 16, // Match snap interval for snappy visual feedback (~60fps)
    pendingUpdate: null,
    frameId: null
  })

  // Alignment guide lines for object-to-object snapping
  const alignmentGuidesRef = useRef(new Map()) // Map of guide ID -> PIXI.Graphics
  const alignmentGuideIdCounterRef = useRef(0) // Counter for unique guide IDs
  const alignmentGuideCacheRef = useRef(new Map()) // Cache of guide ID -> { position, type, start, end, canvasWidth, canvasHeight }

  // Spacing guide lines for equal spacing snapping
  const spacingGuidesRef = useRef(new Map()) // Map of guide ID -> { graphics: PIXI.Graphics, label: PIXI.Text }
  const spacingGuideIdCounterRef = useRef(0) // Counter for unique guide IDs
  const spacingGuideCacheRef = useRef(new Map()) // Cache of guide ID -> { startX, startY, endX, endY, distance }

  // Hover box for layer objects
  const hoverBoxRef = useRef(null)

  // Drag hover box for layer objects during dragging
  const dragHoverBoxRef = useRef(null)

  // Store drag hover box dimensions (calculated once at drag start)
  const dragHoverBoxDimensionsRef = useRef(null) // Purple box shown on hover

  // Motion capture arrow (shows motion direction during drag)
  const motionArrowsRef = useRef(new Map()) // Map of layerId -> PIXI.Graphics
  const motionArrowBasesRef = useRef(new Map()) // Map of layerId -> { x, y } at drag start
  const motionArrowStepIdsRef = useRef(new Map()) // Map of layerId -> stepId for current arrow
  const stepAnchorPositionsRef = useRef(new Map()) // Map of `${layerId}-${stepId}` -> { x, y } anchor pos used for relative calc
  const isDraggingHandleRef = useRef(false) // Track if we are currently dragging a curve handle
  const updateMotionArrowVisibilityRef = useRef(null) // Proxy ref to solve circular dependency
  const handleMotionHandleDragRef = useRef(null) // Proxy ref to solve circular dependency
  const motionHandlesRef = useRef(new Map()) // Map of layerId -> PIXI.Container (holds handles)
  const motionHandlePoolRef = useRef([]) // Pool of PIXI.Graphics for handles


  // =============================================================================
  // HELPER FUNCTIONS AND UTILITIES
  // =============================================================================

  // Helper to get guide line stroke properties (fixed settings for all guides)
  const getGuideStrokeProperties = useCallback(() => {
    return { width: 3, color: 0x8B5CF6, alpha: 1.0 }
  }, [])

  // Helper function to calculate fixed font size for spacing guide labels
  const getFixedFontSize = useCallback(() => 12, [])

  // Helper function to get cached viewport scale (updates only when viewport scale changes)
  const getViewportScale = useCallback(() => {
    if (!viewport) return { scale: 1, dragScale: 1 }

    const currentScale = viewport.scale?.x || 1
    const cached = viewportScaleRef.current

    // Only recalculate if viewport scale has actually changed
    if (cached.scale !== currentScale) {
      const dragScale = 1 / currentScale // When zoomed in (scale > 1), drag should be slower
      viewportScaleRef.current = { scale: currentScale, dragScale }
      return { scale: currentScale, dragScale }
    }

    return cached
  }, [viewport])

  // Debounced cache invalidation to prevent excessive cache clearing during rapid updates
  const invalidateSnappingCache = useCallback(() => {
    if (cacheInvalidationTimeoutRef.current) {
      clearTimeout(cacheInvalidationTimeoutRef.current)
    }
    cacheInvalidationTimeoutRef.current = setTimeout(() => {
      snappingCacheRef.current = { otherObjects: null, selectedIds: null, layersHash: null }
      multiSelectBoundsCacheRef.current = { bounds: null, selectedIds: null, timestamp: 0 }
      cacheInvalidationTimeoutRef.current = null
    }, 500) // Increased to 500ms for better drag performance
  }, [])

  // Cached version of computeCombinedLayerBounds for performance
  const getCachedCombinedLayerBounds = useCallback((selectedLayerIds, currentLayers = layers, currentLayerObjectsMap = layerObjectsMap) => {
    const motionCaptureMode = latestMotionCaptureModeRef.current
    const selectedIdsKey = [...selectedLayerIds].sort().join(',')
    const cache = multiSelectBoundsCacheRef.current
    const currentTime = performance.now()

    // Create session-aware cache key
    const sessionKey = `${selectedIdsKey}:${motionCaptureMode?.isActive ? 'capture' : 'normal'}`

    // Check if cache is valid (same selection, same mode, recent timestamp)
    if (cache.selectedIds === sessionKey && cache.bounds && (currentTime - cache.timestamp) < 500) {
      return cache.bounds
    }

    // Cache miss - recalculate
    const bounds = computeCombinedLayerBounds(selectedLayerIds, currentLayers, currentLayerObjectsMap, motionCaptureMode)

    // Update cache
    multiSelectBoundsCacheRef.current = {
      bounds,
      selectedIds: sessionKey,
      timestamp: currentTime
    }

    return bounds
  }, [layers, layerObjectsMap])

  // Pre-calculate snap candidates during idle time for better drag performance
  const precalculateSnapCandidates = useCallback(() => {
    if (!layers || !layerObjectsMap) return

    const startTime = performance.now()
    let processedCount = 0

    Object.keys(layers).forEach((layerId) => {
      // Limit processing time to avoid blocking the main thread
      if (performance.now() - startTime > 10) return // Max 10ms per idle callback for snap candidates

      const layer = layers[layerId]
      const layerObject = layerObjectsMap.get(layerId)

      const motionCaptureMode = latestMotionCaptureModeRef.current
      const capturedLayer = motionCaptureMode?.isActive && motionCaptureMode.trackedLayers?.get(layerId)

      if (layer && layerObject && !layerObject.destroyed && layer.type !== 'background') {
        const currentWidth = capturedLayer?.width ?? layer.width ?? 100
        const currentHeight = capturedLayer?.height ?? layer.height ?? 100
        const currentX = capturedLayer?.currentPosition?.x ?? layer.x ?? 0
        const currentY = capturedLayer?.currentPosition?.y ?? layer.y ?? 0

        // Create cache key based on layer properties that affect snapping, including capture mode state
        const cacheKey = `${layerId}:${currentX}:${currentY}:${currentWidth}:${currentHeight}:${layer.anchorX}:${layer.anchorY}:${layer.type}:${motionCaptureMode?.isActive ? 'capture' : 'normal'}`

        // Check if we need to update this candidate
        const existing = snapCandidatesCacheRef.current.get(layerId)
        if (!existing || existing.cacheKey !== cacheKey) {
          const metrics = getCachedLayerMetrics(layer, layerObject)
          if (metrics) {
            // Pre-calculate bounds for faster spatial queries
            const { anchorX, anchorY } = resolveAnchors(layer, layerObject)
            const bounds = {
              left: currentX - (currentWidth * anchorX),
              right: currentX + (currentWidth * (1 - anchorX)),
              top: currentY - (currentHeight * anchorY),
              bottom: currentY + (currentHeight * (1 - anchorY))
            }

            snapCandidatesCacheRef.current.set(layerId, {
              metrics,
              bounds,
              cacheKey,
              timestamp: performance.now()
            })
            processedCount++
          }
        }
      }
    })

    // Clean up old snap candidates (older than 30 seconds)
    const cutoffTime = performance.now() - 30000
    for (const [layerId, candidate] of snapCandidatesCacheRef.current) {
      if (candidate.timestamp < cutoffTime) {
        snapCandidatesCacheRef.current.delete(layerId)
      }
    }

    // Schedule next pre-calculation if we processed items
    if (processedCount > 0) {
      if (idleCallbackRef.current) {
        cancelIdleCallback(idleCallbackRef.current)
      }
      idleCallbackRef.current = requestIdleCallback(precalculateSnapCandidates, { timeout: 1000 })
    }
  }, [layers, layerObjectsMap])

  // Pre-calculate layer metrics during idle time for performance
  const precalculateLayerMetrics = useCallback(() => {
    if (!layers || !layerObjectsMap) return

    const startTime = performance.now()
    let processedCount = 0

    Object.keys(layers).forEach((layerId) => {
      // Limit processing time to avoid blocking the main thread
      if (performance.now() - startTime > 5) return // Max 5ms per idle callback

      const layer = layers[layerId]
      const layerObject = layerObjectsMap.get(layerId)

      const motionCaptureMode = latestMotionCaptureModeRef.current
      const capturedLayer = motionCaptureMode?.isActive && motionCaptureMode.trackedLayers?.get(layerId)

      if (layer && layerObject && !layerObject.destroyed) {
        const currentWidth = capturedLayer?.width ?? layer.width ?? 100
        const currentHeight = capturedLayer?.height ?? layer.height ?? 100
        const currentX = capturedLayer?.currentPosition?.x ?? layer.x ?? 0
        const currentY = capturedLayer?.currentPosition?.y ?? layer.y ?? 0

        // Check if we already have cached metrics for this layer
        const cacheKey = `${layerId}:${currentX}:${currentY}:${currentWidth}:${currentHeight}:${motionCaptureMode?.isActive ? 'capture' : 'normal'}`
        if (!precalculatedMetricsRef.current.has(cacheKey)) {
          const metrics = getLayerMetrics(layer, layerObject, motionCaptureMode)
          if (metrics) {
            precalculatedMetricsRef.current.set(cacheKey, {
              metrics,
              timestamp: performance.now()
            })
            processedCount++
          }
        }
      }
    })

    // Clean up old cached metrics (older than 30 seconds)
    const cutoffTime = performance.now() - 30000
    for (const [key, value] of precalculatedMetricsRef.current) {
      if (value.timestamp < cutoffTime) {
        precalculatedMetricsRef.current.delete(key)
      }
    }

    // Schedule next pre-calculation if we processed items and there are more to process
    if (processedCount > 0 && precalculatedMetricsRef.current.size < Object.keys(layers).length) {
      if (idleCallbackRef.current) {
        cancelIdleCallback(idleCallbackRef.current)
      }
      idleCallbackRef.current = requestIdleCallback(precalculateLayerMetrics, { timeout: 1000 })
    }
  }, [layers, layerObjectsMap])

  // Get cached layer metrics with fallback to on-demand calculation
  // Separate caches for position-independent and position-dependent metrics
  const positionDependentCacheRef = useRef(new Map()) // positionKey -> metrics

  const getCachedLayerMetrics = useCallback((layer, layerObject) => {
    if (!layer || !layerObject || layerObject.destroyed) return null

    const motionCaptureMode = latestMotionCaptureModeRef.current
    const capturedLayer = motionCaptureMode?.isActive && motionCaptureMode.trackedLayers?.get(layer.id)

    // Check for captured dimensions
    const currentWidth = capturedLayer?.width ?? layer.width ?? 100
    const currentHeight = capturedLayer?.height ?? layer.height ?? 100

    // Create position-independent key for layer properties, including dimensions which can change in capture mode
    const propsKey = `${layer.id}:${currentWidth}:${currentHeight}:${layer.anchorX !== undefined ? layer.anchorX : 0.5}:${layer.anchorY !== undefined ? layer.anchorY : 0.5}:${layer.type}:${motionCaptureMode?.isActive ? 'capture' : 'normal'}`

    // Get cached properties or compute them
    let cachedProps = layerPropertiesCacheRef.current.get(layer.id)
    if (!cachedProps || cachedProps.key !== propsKey) {
      cachedProps = {
        key: propsKey,
        width: currentWidth,
        height: currentHeight,
        ...resolveAnchors(layer, layerObject),
        type: layer.type
      }
      layerPropertiesCacheRef.current.set(layer.id, cachedProps)
    }

    // Create position-dependent key for metrics that depend on position
    const currentX = capturedLayer?.currentPosition?.x ?? layer.x ?? 0
    const currentY = capturedLayer?.currentPosition?.y ?? layer.y ?? 0
    const positionKey = `${layer.id}:${currentX}:${currentY}:${currentWidth}:${currentHeight}`
    const cachedMetrics = positionDependentCacheRef.current.get(positionKey)

    if (cachedMetrics && (performance.now() - cachedMetrics.timestamp) < 2000) { // 2 second TTL for position-dependent cache
      return cachedMetrics.metrics
    }

    // Compute metrics with current dimensions and position
    const metrics = getLayerMetrics(layer, layerObject, motionCaptureMode)
    if (metrics) {
      positionDependentCacheRef.current.set(positionKey, {
        metrics,
        timestamp: performance.now()
      })
      // ... same cache size limiting logic follows ...

      // Limit cache size to prevent memory leaks
      if (positionDependentCacheRef.current.size > 200) {
        const entries = Array.from(positionDependentCacheRef.current.entries())
        entries.sort((a, b) => a[1].timestamp - b[1].timestamp)
        // Remove oldest 50 entries
        for (let i = 0; i < 50; i++) {
          positionDependentCacheRef.current.delete(entries[i][0])
        }
      }
    }

    return metrics
  }, [])

  // Get performance statistics for debugging
  const getPerformanceStats = useCallback(() => {
    const stats = performanceStatsRef.current
    if (stats.snappingCalculationTime.length === 0) return null

    const snappingTimes = stats.snappingCalculationTime
    const avgSnappingTime = snappingTimes.reduce((a, b) => a + b, 0) / snappingTimes.length
    const maxSnappingTime = Math.max(...snappingTimes)

    return {
      averageSnappingCalculationTime: avgSnappingTime,
      maxSnappingCalculationTime: maxSnappingTime,
      totalPointerMoves: stats.pointerMoveCount,
      frameDropCount: stats.frameDropCount,
      snappingCalculationsCount: snappingTimes.length
    }
  }, [])

  // Log performance stats periodically for debugging
  useEffect(() => {
    const interval = setInterval(() => {
      const stats = getPerformanceStats()
      if (stats && stats.totalPointerMoves > 100) { // Only log if there's been significant activity
        console.log('Canvas Interaction Performance Stats:', {
          avgSnappingTime: `${stats.averageSnappingCalculationTime.toFixed(2)}ms`,
          maxSnappingTime: `${stats.maxSnappingCalculationTime.toFixed(2)}ms`,
          pointerMoves: stats.totalPointerMoves,
          frameDrops: stats.frameDropCount,
          snappingCalcs: stats.snappingCalculationsCount
        })
      }
    }, 10000) // Log every 10 seconds

    return () => clearInterval(interval)
  }, [getPerformanceStats])

  // Spatial index for fast position-based queries
  const spatialIndexRef = useRef(new Map()) // layerId -> { x, y, width, height, bounds }

  // Cache for layer properties that don't change during drag
  const layerPropertiesCacheRef = useRef(new Map()) // layerId -> { width, height, anchorX, anchorY, type }

  // Separate position-based cache for snapping candidates
  const positionCacheRef = useRef(new Map()) // positionHash -> { objects: [], timestamp }

  // Pre-calculated snap candidates cache for better performance
  const snapCandidatesCacheRef = useRef(new Map()) // layerId -> { metrics, bounds, timestamp }

  // Update spatial index when layers change
  const updateSpatialIndex = useCallback((currentLayers = layers, currentLayerObjectsMap = layerObjectsMap) => {
    if (!currentLayers || !currentLayerObjectsMap) return

    const currentTime = performance.now()
    let updated = false

    const motionCaptureMode = latestMotionCaptureModeRef.current

    Object.keys(currentLayers).forEach((layerId) => {
      const layer = currentLayers[layerId]
      const layerObject = currentLayerObjectsMap.get(layerId)

      if (layer && layerObject && !layerObject.destroyed) {
        // [FIX] Only include layers from the current scene to prevent cross-scene snapping
        if (layer.sceneId !== currentSceneId) return

        // [FIX] Exclude background layers from spatial index to prevent snapping to them
        if (layer.type === LAYER_TYPES.BACKGROUND) return

        // Create a key that represents all visual properties affecting the spatial index
        // We include capture state to ensure spatial index reflects current motion capture state
        const capturedLayer = motionCaptureMode?.isActive && motionCaptureMode.trackedLayers?.get(layerId)
        const currentWidth = capturedLayer?.width ?? layer.width ?? 100
        const currentHeight = capturedLayer?.height ?? layer.height ?? 100
        const currentX = capturedLayer?.currentPosition?.x ?? layer.x ?? 0
        const currentY = capturedLayer?.currentPosition?.y ?? layer.y ?? 0
        const currentScaleX = capturedLayer?.scaleX ?? layer.scaleX ?? 1
        const currentScaleY = capturedLayer?.scaleY ?? layer.scaleY ?? 1
        const currentRotation = capturedLayer?.rotation ?? layer.rotation ?? 0
        const { anchorX, anchorY } = resolveAnchors(layer, layerObject)

        const propsKey = `${layerId}:${currentX}:${currentY}:${currentWidth}:${currentHeight}:${anchorX}:${anchorY}:${currentScaleX}:${currentScaleY}:${currentRotation}:${layer.type}:${motionCaptureMode?.isActive ? 'capture' : 'normal'}`

        const existing = spatialIndexRef.current.get(layerId)
        if (!existing || existing.key !== propsKey) {
          const bounds = getLayerWorldBounds(layer, layerObject, motionCaptureMode)
          spatialIndexRef.current.set(layerId, {
            bounds,
            zIndex: layerObject.zIndex || 0,
            width: currentWidth,
            height: currentHeight,
            anchorX,
            anchorY,
            type: layer.type,
            key: propsKey
          })
          updated = true
        }

        // Update layer properties cache (changes less frequently)
        if (!layerPropertiesCacheRef.current.has(layerId) ||
          layerPropertiesCacheRef.current.get(layerId).key !== propsKey) {
          layerPropertiesCacheRef.current.set(layerId, {
            width: currentWidth,
            height: currentHeight,
            anchorX,
            anchorY,
            type: layer.type,
            key: propsKey
          })
        }
      }
    })

    // Clean up removed layers AND layers from other scenes
    const currentLayerIds = new Set(Object.keys(currentLayers))
    for (const layerId of spatialIndexRef.current.keys()) {
      const layer = currentLayers[layerId]
      // Remove if layer doesn't exist OR if it belongs to a different scene
      if (!currentLayerIds.has(layerId) || (layer && layer.sceneId !== currentSceneId)) {
        spatialIndexRef.current.delete(layerId)
        layerPropertiesCacheRef.current.delete(layerId)
        updated = true
      }
    }

    return updated
  }, [layers, layerObjectsMap, currentSceneId])

  const getCachedOtherObjectsForAlignment = useCallback((selectedLayerIds, currentLayers = layers, currentLayerObjectsMap = layerObjectsMap, draggedObjectBounds = null, isDragOperation = false) => {
    if (!currentLayers || !currentLayerObjectsMap) return []

    // Only update spatial index during non-drag operations (when layers actually change)
    // During drag operations, use the existing spatial index to avoid performance overhead
    if (!isDragOperation) {
      updateSpatialIndex(currentLayers, currentLayerObjectsMap)
    }

    const selectedIdsKey = [...selectedLayerIds].sort().join(',')
    const selectedSet = new Set(selectedLayerIds)
    const otherObjects = []

    // Create position hash for cache key (only include dragged bounds if provided)
    const positionHash = draggedObjectBounds ?
      `${draggedObjectBounds.left}:${draggedObjectBounds.right}:${draggedObjectBounds.top}:${draggedObjectBounds.bottom}` :
      'no_bounds'

    const cacheKey = `${selectedIdsKey}:${positionHash}`
    const cached = positionCacheRef.current.get(cacheKey)

    // Use cached result if less than 500ms old (increased for drag performance)
    if (cached && (performance.now() - cached.timestamp) < 500) {
      return cached.objects
    }

    // Fast spatial query using pre-built index
    spatialIndexRef.current.forEach((spatialData, layerId) => {
      if (selectedSet.has(layerId)) return

      const layer = currentLayers[layerId]
      const layerObject = currentLayerObjectsMap.get(layerId)
      if (!layer || !layerObject || layerObject.destroyed) return

      // [FIX] Only include layers from the current scene to prevent cross-scene snapping
      if (layer.sceneId !== currentSceneId) return

      // Enhanced spatial filtering with pre-calculated bounds
      if (draggedObjectBounds) {
        // Use pre-calculated snap candidate bounds for faster filtering
        const snapCandidate = snapCandidatesCacheRef.current.get(layerId)
        const bounds = snapCandidate?.bounds || spatialData.bounds

        // Calculate distance using pre-computed bounds (much faster)
        const dx = Math.max(draggedObjectBounds.left - bounds.right, 0, bounds.left - draggedObjectBounds.right)
        const dy = Math.max(draggedObjectBounds.top - bounds.bottom, 0, bounds.top - draggedObjectBounds.bottom)
        const distance = Math.sqrt(dx * dx + dy * dy)

        // More aggressive filtering: only objects within reasonable snapping distance
        const maxSnapDistance = Math.max(worldWidth, worldHeight) * 1.5
        if (distance > maxSnapDistance) return
      }

      // Use pre-calculated snap candidates for better performance during drag
      const snapCandidate = snapCandidatesCacheRef.current.get(layerId)
      if (snapCandidate && snapCandidate.metrics) {
        otherObjects.push(snapCandidate.metrics)
      } else {
        // Fallback to on-demand calculation if pre-calculated candidate not available
        const metrics = getCachedLayerMetrics(layer, layerObject)
        if (metrics) {
          otherObjects.push(metrics)
        }
      }
    })

    // Cache the result with short TTL for drag operations
    positionCacheRef.current.set(cacheKey, {
      objects: otherObjects,
      timestamp: performance.now()
    })

    // Limit cache size to prevent memory leaks
    if (positionCacheRef.current.size > 50) {
      const entries = Array.from(positionCacheRef.current.entries())
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp)
      // Remove oldest 25% of entries
      const toRemove = Math.floor(entries.length * 0.25)
      for (let i = 0; i < toRemove; i++) {
        positionCacheRef.current.delete(entries[i][0])
      }
    }

    return otherObjects
  }, [layers, layerObjectsMap, worldWidth, worldHeight, updateSpatialIndex, currentSceneId])

  // Progressive snapping with coarse-to-fine filtering
  const applyProgressiveSnapping = useCallback((originalX, originalY, width, height, anchorX, anchorY, scaleX, scaleY, otherObjects, selectedLayerIds, maxTimeMs = 8, canvasWidth = worldWidth, canvasHeight = worldHeight, bounds = null) => {
    const startTime = performance.now()
    let snappedX = originalX
    let snappedY = originalY
    const result = {
      x: snappedX,
      y: snappedY,
      alignmentGuides: [],
      spacingGuides: [],
      showVGuide: false,
      showHGuide: false
    }

    // Phase 1: Fast center and safe zone snapping (always calculated, very cheap)
    // [FIX] Center and safezone snapping should work even with 0 other objects
    // These don't require other objects, so calculate them first before checking otherObjects
    const centerSnapResult = applyCenterSnapping({
      x: snappedX,
      y: snappedY,
      width,
      height,
      canvasWidth: worldWidth,
      canvasHeight: worldHeight,
      threshold: 10,
      scaleX,
      scaleY
    })

    const safeZoneSnapResult = applySafeZoneSnapping({
      x: centerSnapResult.x,
      y: centerSnapResult.y,
      width,
      height,
      anchorX,
      anchorY,
      canvasWidth: worldWidth,
      canvasHeight: worldHeight,
      margin: null,
      scaleX,
      scaleY,
      bounds
    })

    snappedX = safeZoneSnapResult.x
    snappedY = safeZoneSnapResult.y
    result.showVGuide = centerSnapResult.showVGuide
    result.showHGuide = centerSnapResult.showHGuide

    // Add center and safe zone guides
    // [FIX] Don't push center guides to alignmentGuides as they are handled by main solid guides
    // result.alignmentGuides.push(...centerSnapResult.alignmentGuides)
    result.alignmentGuides.push(...safeZoneSnapResult.alignmentGuides)

    // Early exit if no other objects for object-to-object snapping
    if (!otherObjects || otherObjects.length === 0) {
      result.x = snappedX
      result.y = snappedY
      return result
    }


    // Check if we have time for more expensive calculations
    if (performance.now() - startTime > maxTimeMs) {
      result.x = snappedX
      result.y = snappedY
      return result
    }

    // Phase 2: Coarse filtering - find objects within coarse snap distance
    // PERFORMANCE OPTIMIZATION: Use squared distances 
    const visualWidth = width * Math.abs(scaleX)
    const visualHeight = height * Math.abs(scaleY)
    const draggedLeft = bounds?.left ?? (originalX - (visualWidth * anchorX))
    const draggedRight = bounds?.right ?? (draggedLeft + visualWidth)
    const draggedTop = bounds?.top ?? (originalY - (visualHeight * anchorY))
    const draggedBottom = bounds?.bottom ?? (draggedTop + visualHeight)

    // Coverage threshold - use canvas diagonal squared for coarse clipping
    const coarseThresholdSq = (canvasWidth * canvasWidth + canvasHeight * canvasHeight)

    const nearbyObjects = otherObjects.filter(obj => {
      if (!obj) return false

      const objLeft = obj.x - (obj.width * obj.anchorX)
      const objRight = objLeft + obj.width
      const objTop = obj.y - (obj.height * obj.anchorY)
      const objBottom = objTop + obj.height

      // Coarse bounding box distance check (squared)
      const dx = Math.max(draggedLeft - objRight, 0, objLeft - draggedRight)
      const dy = Math.max(draggedTop - objBottom, 0, objTop - draggedBottom)
      const distSq = dx * dx + dy * dy

      return distSq <= coarseThresholdSq
    })

    // Phase 3: Detailed object-to-object snapping (only for nearby objects)
    if (nearbyObjects.length > 0 && performance.now() - startTime < maxTimeMs) {
      const alignmentResult = applyObjectAlignmentSnapping({
        x: snappedX,
        y: snappedY,
        width,
        height,
        anchorX,
        anchorY,
        otherObjects: nearbyObjects,
        threshold: 7,
        scaleX,
        scaleY
      })

      // Only apply alignment snapping if it actually moved the object
      if (Math.abs(alignmentResult.x - snappedX) > 0.1 || Math.abs(alignmentResult.y - snappedY) > 0.1) {
        snappedX = alignmentResult.x
        snappedY = alignmentResult.y
        result.alignmentGuides.push(...alignmentResult.alignmentGuides)
      }
    }

    // Phase 4: Spacing snapping (only if we have time and enough objects)
    if (nearbyObjects.length >= 2 && performance.now() - startTime < maxTimeMs * 0.8) {
      const spacingResult = applySpacingSnapping({
        x: snappedX,
        y: snappedY,
        width,
        height,
        anchorX,
        anchorY,
        otherObjects: nearbyObjects,
        threshold: 7
      })

      snappedX = spacingResult.x
      snappedY = spacingResult.y
      result.spacingGuides = spacingResult.spacingGuides
    }

    result.x = snappedX
    result.y = snappedY
    return result
  }, [worldWidth, worldHeight])

  // Helper function to apply snapping calculations (shared between single and multi-select)
  const applySnappingToPosition = useCallback((originalX, originalY, width, height, anchorX, anchorY, scaleX, scaleY, otherObjects, selectedLayerIds, bounds = null) => {
    return applyProgressiveSnapping(originalX, originalY, width, height, anchorX, anchorY, scaleX, scaleY, otherObjects, selectedLayerIds, 12, worldWidth, worldHeight, bounds)
  }, [applyProgressiveSnapping, worldWidth, worldHeight])


  // =============================================================================
  // MAIN-2  -                     HOVER BOX MANAGEMENT
  // =============================================================================

  // Helper function to update hover box synchronously with calculated values
  const updateHoverBox = useCallback((pixiObject, layer) => {
    if (isPlaying) return // Hide if playing
    if (!layersContainer || !pixiObject || !layer) return

    let hoverBox = hoverBoxRef.current
    let outlineGraphics = hoverBoxRef.current?._outlineGraphics

    // Check if hoverBox exists, is not destroyed, and is properly attached to current layersContainer
    if (!hoverBox || hoverBox.destroyed || hoverBox.parent !== layersContainer) {
      // Clean up old hoverBox if it exists but is in invalid state
      if (hoverBox && !hoverBox.destroyed && hoverBox.parent) {
        hoverBox.parent.removeChild(hoverBox)
        hoverBox.destroy()
      }

      // Create new hoverBox container once
      hoverBox = new PIXI.Container()
      hoverBox.label = 'hover-box'
      hoverBox.eventMode = 'none'
      hoverBox.zIndex = 9998 // Slightly below drag box

      // Create reusable outline graphics object once
      outlineGraphics = new PIXI.Graphics()
      outlineGraphics.eventMode = 'none'
      hoverBox.addChild(outlineGraphics)
      hoverBox._outlineGraphics = outlineGraphics

      hoverBoxRef.current = hoverBox
      if (!hoverBox.parent) {
        layersContainer.addChild(hoverBox) // Add to layersContainer to avoid clipping
      }
    }

    // Get bounds efficiently using layer data (fast path for performance)
    // Only use expensive getLocalBounds() for complex objects that need it
    let localBounds
    const { anchorX, anchorY } = resolveAnchors(layer, pixiObject)
    const layerWidth = layer.width || 100
    const layerHeight = layer.height || 100

    // Fast path: Use layer dimensions for most cases (shapes, images, simple graphics)
    // This avoids expensive getLocalBounds() calls during hover
    if (layer.type !== 'text' && !(pixiObject instanceof PIXI.Text)) {
      // CROP SYSTEM: For media elements, start dimensions should match the visible (cropped) area
      const isMedia = layer.type === LAYER_TYPES.IMAGE || layer.type === LAYER_TYPES.VIDEO
      const trackedLayer = motionCaptureMode?.isActive ? motionCaptureMode.trackedLayers?.get(layer.id) : null

      // Priority: Captured Crop > Object Visual Crop (Animated) > Redux Crop > Redux Width
      const width = isMedia
        ? (trackedLayer?.cropWidth ?? (pixiObject?._hasReactiveCropProperties ? pixiObject.cropWidth : (layer.cropWidth ?? layerWidth)))
        : (trackedLayer?.width ?? layerWidth)
      const height = isMedia
        ? (trackedLayer?.cropHeight ?? (pixiObject?._hasReactiveCropProperties ? pixiObject.cropHeight : (layer.cropHeight ?? layerHeight)))
        : (trackedLayer?.height ?? layerHeight)

      // For non-text layers, bounds are simply the layer dimensions (or crop dimensions)
      localBounds = {
        x: -width * anchorX,
        y: -height * anchorY,
        width: width,
        height: height
      }
    } else {
      // For text layers, use layer.width for width but get actual text height
      // Only fall back to layer data if it fails
      try {
        // Ensure text is up to date before measuring
        pixiObject.updateText?.(true)
        const textBounds = pixiObject.getLocalBounds()

        // Use layer.width for width but the content's logical (unscaled) height.
        // We use Math.max to avoid issues with empty text or tiny bounds.
        localBounds = {
          x: -layerWidth * anchorX,
          y: -textBounds.height * anchorY,
          width: layerWidth,
          height: Math.max(1, textBounds.height)
        }
        // Ensure we have valid bounds
        if (!localBounds || typeof localBounds.width !== 'number' || typeof localBounds.height !== 'number') {
          throw new Error('Invalid bounds from getLocalBounds')
        }
      } catch (e) {
        // Fallback to efficient layer data calculation
        localBounds = {
          x: -layerWidth * anchorX,
          y: -layerHeight * anchorY,
          width: layerWidth,
          height: layerHeight
        }
      }
    }

    // [FIX] BACKGROUND PROTECTION: Never show hover box for background layers
    if (layer.type === 'background') {
      if (hoverBox) hoverBox.visible = false
      return
    }

    // [PERFORMANCE] Hide entirely during playback
    if (isPlaying) {
      if (hoverBox) hoverBox.visible = false
      return
    }

    // CRITICAL: Prioritize captured state during motion capture to prevent flickering
    const capturedLayer = motionCaptureMode?.isActive && motionCaptureMode.trackedLayers?.get(layer.id)
    let currentRotation = capturedLayer?.rotation ?? (layer.rotation || 0)
    let scaleX = capturedLayer?.scaleX ?? (layer.scaleX || 1)
    let scaleY = capturedLayer?.scaleY ?? (layer.scaleY || 1)

    // [ACCURACY] In Normal Mode, follow actual PIXI visual properties for real-time sync
    if (!motionCaptureMode?.isActive) {
      const targetObject = pixiObject._cachedSprite || pixiObject
      scaleX = targetObject.scale.x
      scaleY = targetObject.scale.y
      currentRotation = (targetObject.rotation * 180) / Math.PI
    }

    // Calculate the visual center offset...
    const rotation = currentRotation * Math.PI / 180

    // Position the hover box directly at the object's position.
    hoverBox.x = pixiObject.x
    hoverBox.y = pixiObject.y
    hoverBox.rotation = rotation

    // Calculate the bounding box dimensions from local bounds.
    // scaleX/scaleY here are the absolute cumulative scales.
    const boundsWidth = localBounds.width * scaleX
    const boundsHeight = localBounds.height * scaleY

    // Center the hover box outline on its own origin (anchor 0.5, 0.5 for the outline)
    const localBoundsX = -boundsWidth * 0.5
    const localBoundsY = -boundsHeight * 0.5

    // Reuse existing graphics object - just clear and redraw
    outlineGraphics.clear()
    outlineGraphics.rect(localBoundsX, localBoundsY, boundsWidth, boundsHeight)

    // [FIX] ZOOM ADAPTIVE: Keep outline visually consistent regardless of zoom
    const viewportScale = viewport.scale?.x || 1
    const zoomScale = 1 / viewportScale
    outlineGraphics.stroke({ color: 0x8B5CF6, width: 1.5 * zoomScale })

    hoverBox.visible = true
  }, [layersContainer, motionCaptureMode, isPlaying])

  // Helper function to hide hover box
  const hideHoverBox = useCallback(() => {
    const hoverBox = hoverBoxRef.current
    if (hoverBox) {
      hoverBox.visible = false
    }
  }, [])

  // =============================================================================
  // DRAG HOVER BOX - Purple outline during layer dragging
  // =============================================================================

  // Helper function to update drag hover box with explicit coordinates (like useSelectionBox)
  const updateDragHoverBox = useCallback((x, y, width, height, rotationRadians, anchorX, anchorY, scaleX = 1, scaleY = 1, zoomScale = 1) => {
    const dragHoverBox = dragHoverBoxRef.current
    if (!dragHoverBox || !layersContainer || dragHoverBox.destroyed) return
    // Note: dragHoverBox is now guaranteed to exist and be properly parented by drag start logic

    const scaledWidth = width * scaleX
    const scaledHeight = height * scaleY
    const localBoundsX = -scaledWidth * anchorX
    const localBoundsY = -scaledHeight * anchorY

    dragHoverBox.x = x
    dragHoverBox.y = y
    dragHoverBox.rotation = rotationRadians

    // Reuse existing graphics object instead of recreating (performance optimization)
    let outline = dragHoverBox.children[0]
    if (!outline) {
      outline = new PIXI.Graphics()
      outline.eventMode = 'none'
      dragHoverBox.addChild(outline)
    }

    // Clear and redraw the outline (much faster than recreating the graphics object)
    outline.clear()
    outline.rect(localBoundsX, localBoundsY, scaledWidth, scaledHeight)

    // [FIX] ZOOM ADAPTIVE: Use the provided zoomScale for consistency with selection box
    outline.stroke({ color: 0x8B5CF6, width: 1.5 * zoomScale })
    dragHoverBox.visible = true
  }, [layersContainer])

  // Helper function to hide drag hover box
  const hideDragHoverBox = useCallback(() => {
    const dragHoverBox = dragHoverBoxRef.current
    if (dragHoverBox && !dragHoverBox.destroyed) {
      dragHoverBox.visible = false
    }
  }, [])

  // =============================================================================
  // MAIN-3 -         MOTION CAPTURE ARROW - Visual feedback for motion path
  // =============================================================================

  const createMotionArrow = useCallback((layerId, layersContainer) => {
    if (!layersContainer || !layerId) return null

    let arrow = motionArrowsRef.current.get(layerId)
    if (!arrow || arrow.destroyed) {
      arrow = new PIXI.Graphics()
      arrow.label = `motion-capture-arrow-${layerId}`
      arrow.eventMode = 'none'
      arrow.zIndex = 10000
      motionArrowsRef.current.set(layerId, arrow)
    }

    if (arrow.parent !== layersContainer) {
      layersContainer.addChild(arrow)
    }

    return arrow
  }, [])

  const getLayerCenter = useCallback((layer, layerObject, xOverride, yOverride) => {
    if (!layer) return { x: xOverride || 0, y: yOverride || 0 }
    const isMedia = layer.type === LAYER_TYPES.IMAGE || layer.type === LAYER_TYPES.VIDEO
    const trackedLayer = motionCaptureMode?.isActive ? motionCaptureMode.trackedLayers?.get(layer.id) : null
    const { anchorX, anchorY } = resolveAnchors(layer, layerObject)

    const width = isMedia
      ? (trackedLayer?.cropWidth ?? (layerObject?._hasReactiveCropProperties ? layerObject.cropWidth : (layer.cropWidth ?? layer.width ?? 100)))
      : (trackedLayer?.width ?? layer.width ?? 100)

    // CRITICAL: Get logical (unscaled) height for text layers to avoid double-scaling.
    let height = isMedia
      ? (trackedLayer?.cropHeight ?? (layerObject?._hasReactiveCropProperties ? layerObject.cropHeight : (layer.cropHeight ?? layer.height ?? 100)))
      : (trackedLayer?.height ?? layer.height ?? 100)
    if (layerObject instanceof PIXI.Text) {
      layerObject.updateText?.(true)
      height = layerObject.getLocalBounds().height
    }

    // Prioritize captured state during motion capture
    const capturedLayer = motionCaptureMode?.isActive && motionCaptureMode.trackedLayers?.get(layer.id)
    const scaleX = capturedLayer?.scaleX ?? (layer.scaleX || 1)
    const scaleY = capturedLayer?.scaleY ?? (layer.scaleY || 1)

    const x = (xOverride !== undefined ? xOverride : (layer.x || 0)) + (0.5 - anchorX) * width * scaleX
    const y = (yOverride !== undefined ? yOverride : (layer.y || 0)) + (0.5 - anchorY) * height * scaleY
    return { x, y }
  }, [motionCaptureMode])

  const updateMotionArrow = useCallback((layerId, segments = []) => {
    const arrow = motionArrowsRef.current.get(layerId)
    if (!arrow || arrow.destroyed || !segments || segments.length === 0) return

    arrow.clear()

    segments.forEach(seg => {
      const { start, end, controlPoints = [], isSolid = false, isLast = false } = seg
      if (!start || !end) return

      const color = 0x8B5CF6
      const strokeWidth = 4
      const startRadius = 6

      // ---- Start Point Marker ----
      arrow.circle(start.x, start.y, startRadius)
      arrow.fill(0xffffff)
      arrow.stroke({ width: strokeWidth, color })

      if (controlPoints && controlPoints.length > 0) {
        // Draw smooth curve using spline utilities
        const fullPoints = [start, ...controlPoints, end]
        const path = getCatmullRomPath(fullPoints, 12)

        const dashLength = isSolid ? undefined : 10
        const gapLength = isSolid ? undefined : 6

        if (isSolid) {
          arrow.moveTo(path[0].x, path[0].y)
          for (let i = 1; i < path.length; i++) {
            arrow.lineTo(path[i].x, path[i].y)
          }
          arrow.stroke({ width: strokeWidth, color })
        } else {
          for (let i = 0; i < path.length - 1; i++) {
            drawDashedLine(arrow, path[i].x, path[i].y, path[i + 1].x, path[i + 1].y, color, strokeWidth, dashLength, gapLength)
          }
        }

        if (isSolid) {
          // Draw arrow head at the end
          const lastPoint = path[path.length - 1]
          const prevPoint = path[path.length - 2] || start
          const angle = Math.atan2(lastPoint.y - prevPoint.y, lastPoint.x - prevPoint.x)

          const headLength = 18
          arrow.moveTo(lastPoint.x, lastPoint.y)
          arrow.lineTo(
            lastPoint.x - headLength * Math.cos(angle - Math.PI / 6),
            lastPoint.y - headLength * Math.sin(angle - Math.PI / 6)
          )
          arrow.moveTo(lastPoint.x, lastPoint.y)
          arrow.lineTo(
            lastPoint.x - headLength * Math.cos(angle + Math.PI / 6),
            lastPoint.y - headLength * Math.sin(angle + Math.PI / 6)
          )
          arrow.stroke({ width: strokeWidth, color })
        }
      } else {
        // Straight line logic
        const dx = end.x - start.x
        const dy = end.y - start.y
        const distance = Math.sqrt(dx * dx + dy * dy)
        const angle = Math.atan2(dy, dx)

        if (distance < 2) return

        const lineStartX = start.x + startRadius * Math.cos(angle)
        const lineStartY = start.y + startRadius * Math.sin(angle)

        if (isSolid) {
          arrow.moveTo(lineStartX, lineStartY)
          arrow.lineTo(end.x, end.y)
          arrow.stroke({ width: strokeWidth, color })
        } else {
          const dashLength = 10
          const gapLength = 6
          drawDashedLine(arrow, lineStartX, lineStartY, end.x, end.y, color, strokeWidth, dashLength, gapLength)
        }

        if (isSolid) {
          // Arrow head
          const tipX = end.x
          const tipY = end.y
          const headLength = 18
          const headWidth = 14

          const leftX = tipX - headLength * Math.cos(angle) + (headWidth / 2) * Math.sin(angle)
          const leftY = tipY - headLength * Math.sin(angle) - (headWidth / 2) * Math.cos(angle)
          const rightX = tipX - headLength * Math.cos(angle) - (headWidth / 2) * Math.sin(angle)
          const rightY = tipY - headLength * Math.sin(angle) + (headWidth / 2) * Math.cos(angle)

          arrow.moveTo(tipX, tipY)
          arrow.lineTo(leftX, leftY)
          arrow.lineTo(rightX, rightY)
          arrow.closePath()
          arrow.fill(color)
        }
      }
    })

    arrow.visible = true
  }, [])

  // Handle pooling system for performance on low-end PCs
  const getMotionHandle = useCallback(() => {
    let handle = motionHandlePoolRef.current.pop()
    if (!handle || handle.destroyed) {
      handle = new PIXI.Graphics()
      handle.eventMode = 'static'
      handle.cursor = 'pointer'
    }
    handle.visible = true
    return handle
  }, [])

  const releaseMotionHandle = useCallback((handle) => {
    if (!handle || handle.destroyed) return

    // Don't release if we are currently dragging this handle (safety check)
    if (isDraggingHandleRef.current && handle.alpha === 1 && !handle.visible) {
      // This is a subtle case where we might want to keep it, but generally 
      // the parent container clearing is what kills it. 
    }

    handle.visible = false
    handle.off('pointerenter')
    handle.off('pointerleave')
    handle.off('pointerdown')
    motionHandlePoolRef.current.push(handle)
  }, [])

  /**
   * Drags a motion control point or midpoint handle.
   */
  const handleMotionHandleDrag = useCallback((event, layerId, stepId, pointIndex, type) => {
    console.log('[DEBUG] Drag Start', { layerId, stepId, type, pointIndex })
    const handle = event.currentTarget

    // Fallback: If stepId is missing, check if we are in motion capture mode
    let actualStepId = stepId
    if (!actualStepId && latestMotionCaptureModeRef.current?.isActive) {
      actualStepId = latestMotionCaptureModeRef.current.stepId
      console.log('[DEBUG] Using fallback ID', actualStepId)
    }

    if (!actualStepId) {
      console.warn('[DEBUG] No actualStepId found!')
      return
    }

    const globalPos = event.global || event.data?.global
    if (!globalPos) {
      console.log('[DEBUG] No global position found')
      return
    }

    const startPos = { x: globalPos.x, y: globalPos.y }
    const startHandlePos = { x: handle.x, y: handle.y }

    // Get latest state
    const step = sceneMotionFlows[currentSceneId]?.steps?.find(s => s.id === actualStepId)
    const moveAction = step?.layerActions?.[layerId]?.find(a => a.type === 'move')

    // [FIX] HIGH-PRECISION ANCHOR: Use the exact anchor position from the render loop
    // [MULTI-LAYER FIX] Use layer+step key to prevent overwrites when multiple layers share the same step
    const anchorKey = `${layerId}-${actualStepId}`
    let stepStartAnchor = stepAnchorPositionsRef.current.get(anchorKey)

    if (!stepStartAnchor) {
      // [MULTI-LAYER FIX] Recalculate anchor position if missing (e.g., after multi-move)
      // This ensures anchor is always available when curving paths after moving layers
      const engine = getGlobalMotionEngine()
      const sceneStartTime = sceneMotionFlows[currentSceneId]?.startTime || 0
      const step = sceneMotionFlows[currentSceneId]?.steps?.find(s => s.id === actualStepId)

      if (step) {
        const startState = engine.predictLayerStateAtTime(layerId, currentSceneId, step.startTime || sceneStartTime)

        if (startState && startState.x !== undefined && startState.y !== undefined) {
          stepStartAnchor = { x: startState.x, y: startState.y }
          stepAnchorPositionsRef.current.set(anchorKey, stepStartAnchor)
        }
      }

      if (!stepStartAnchor) {
        console.warn('Missing step start anchor for handle drag and could not recalculate', { layerId, actualStepId, anchorKey })
        return
      }
    }

    const currentControlPoints = [...(moveAction?.values?.controlPoints || [])]
    const layer = layers[layerId]
    const layerObject = layerObjectsMap.get(layerId)

    // Get the target end position
    let targetX = layer.x || 0
    let targetY = layer.y || 0

    const activeMode = latestMotionCaptureModeRef.current

    if (activeMode?.isActive) {
      const capturedLayer = activeMode.trackedLayers?.get(layerId)

      if (capturedLayer?.currentPosition) {
        targetX = capturedLayer.currentPosition.x
        targetY = capturedLayer.currentPosition.y
      } else if (layerObject) {
        targetX = layerObject.x
        targetY = layerObject.y
      } else if (moveAction?.values?.x !== undefined) {
        targetX = moveAction.values.x
        targetY = moveAction.values.y
      }
    } else if (moveAction?.values?.x !== undefined) {
      targetX = moveAction.values.x
      targetY = moveAction.values.y
    }

    const end = getLayerCenter(layer, layerObject, targetX, targetY)

    const container = motionHandlesRef.current.get(layerId)
    if (container) {
      container.children.forEach(child => {
        if (child !== handle) child.visible = false
      })
    }

    isDraggingHandleRef.current = true
    pauseViewportDragPlugin(viewport)

    // Derived renderer for global events
    const renderer = viewport.parent?.parent?.renderer || viewport.parent?.renderer

    const onMove = (moveEvent) => {
      // [FIX] HIGH-PRECISION: Use local position within the handles container
      // This automatically accounts for viewport scaling and container offsets.
      const localPos = container.toLocal(moveEvent.global)
      if (!localPos) return

      handle.x = localPos.x
      handle.y = localPos.y

      // [FIX] CONSISTENT OFFSET: Convert world-center handle position BACK to relative anchor offset
      // Since worldCenter = anchorPos + centerOffset, then:
      // worldCenter - anchorPos = centerOffset
      // However, controlPoints in Redux are usually relative to startAnchor: anchorPt - startAnchor.
      // Wait, there's a distinction between "Center Offset" and "Step Offset".
      // In our system, controlPoints are "Anchor points in step space" (pt - stepStartAnchor).
      // But we are dragging a CENTER point. 
      // Fortunately, since rotation/scale are constant throughout the step (in current MVP),
      // the vector from Anchor to Center is constant. 
      // Thus: (CenterPt - StartCenterCenter) is identical to (AnchorPt - StartAnchorAnchor).
      const startCenter = getLayerCenter(layer, layerObject, stepStartAnchor.x, stepStartAnchor.y)
      const relX = handle.x - startCenter.x
      const relY = handle.y - startCenter.y

      let updatedPoints = []
      if (type === 'control') {
        updatedPoints = [...currentControlPoints]
        updatedPoints[pointIndex] = { x: relX, y: relY }
      } else {
        updatedPoints = [...currentControlPoints]
        updatedPoints.splice(pointIndex, 0, { x: relX, y: relY })
      }

      // Update MotionPanel / Capture Mode ephemeral state
      if (latestMotionCaptureModeRef.current?.isActive && latestMotionCaptureModeRef.current.onPositionUpdate) {
        const capturedLayer = latestMotionCaptureModeRef.current.trackedLayers?.get(layerId)
        latestMotionCaptureModeRef.current.onPositionUpdate({
          layerId,
          x: targetX,
          y: targetY,
          rotation: capturedLayer?.rotation || 0,
          scaleX: capturedLayer?.scaleX || 1,
          scaleY: capturedLayer?.scaleY || 1,
          controlPoints: updatedPoints, // PROPAGATE CURVE!
          interactionType: 'move'
        })
      }

      // Live update visual arrow using these center-relative offsets
      // [FIX] PROXY: Use ref to avoid circular dependency / initialization error
      if (updateMotionArrowVisibilityRef.current) {
        updateMotionArrowVisibilityRef.current(layerId, true, updatedPoints)
      }
    }

    const onUp = () => {
      console.log('[DEBUG] Handle Drag End')

      if (renderer?.events) {
        renderer.events.off('globalpointermove', onMove)
        renderer.events.off('pointerup', onUp)
        renderer.events.off('pointerupoutside', onUp)
      } else {
        viewport.off('globalpointermove', onMove)
        viewport.off('pointerup', onUp)
        viewport.off('pointerupoutside', onUp)
      }

      isDraggingHandleRef.current = false
      resumeViewportDragPlugin(viewport)

      // Final Redux update
      // [MULTI-LAYER FIX] Re-fetch anchor to ensure we have the latest value
      const anchorKey = `${layerId}-${actualStepId}`
      const latestStepStartAnchor = stepAnchorPositionsRef.current.get(anchorKey) || stepStartAnchor
      const startCenter = getLayerCenter(layer, layerObject, latestStepStartAnchor.x, latestStepStartAnchor.y)
      const relX = handle.x - startCenter.x
      const relY = handle.y - startCenter.y

      let finalPoints = []
      if (type === 'control') {
        finalPoints = [...currentControlPoints]
        finalPoints[pointIndex] = { x: relX, y: relY }
      } else {
        finalPoints = [...currentControlPoints]
        finalPoints.splice(pointIndex, 0, { x: relX, y: relY })
      }

      // [FIX] FORCE TRACKED LAYER UPDATE:
      // When we release the handle, we MUST tell the MotionPanel that the layer is effectively
      // at this target position. Otherwise, if the user hasn't moved the layer *after* this interaction,
      // the MotionPanel might think the layer is still at its old position or the `capturedLayer` state
      // might be stale relative to the new Redux action we are about to dispatch.
      if (latestMotionCaptureModeRef.current?.isActive && latestMotionCaptureModeRef.current.onPositionUpdate) {
        const capturedLayer = latestMotionCaptureModeRef.current.trackedLayers?.get(layerId)
        latestMotionCaptureModeRef.current.onPositionUpdate({
          layerId,
          x: targetX,
          y: targetY,
          rotation: capturedLayer?.rotation || 0,
          scaleX: capturedLayer?.scaleX || 1,
          scaleY: capturedLayer?.scaleY || 1,
          cropX: capturedLayer?.cropX ?? (layer.cropX || 0),
          cropY: capturedLayer?.cropY ?? (layer.cropY || 0),
          cropWidth: capturedLayer?.cropWidth ?? (layer.cropWidth || layer.width || 100),
          cropHeight: capturedLayer?.cropHeight ?? (layer.cropHeight || layer.height || 100),
          mediaWidth: capturedLayer?.mediaWidth ?? layer.mediaWidth,
          mediaHeight: capturedLayer?.mediaHeight ?? layer.mediaHeight,
          controlPoints: finalPoints, // PROPAGATE CURVE!
          interactionType: 'move' // Treat curve edit as a move interaction regarding position
        })
      }

      if (moveAction) {
        // Calculate relative offset from predicted start state
        const engine = getGlobalMotionEngine()
        const sceneStartTime = sceneMotionFlows[currentSceneId]?.startTime || 0
        const startState = engine.predictLayerStateAtTime(layerId, currentSceneId, step.startTime || sceneStartTime)

        const dx = targetX - (startState?.x ?? layer.x ?? 0)
        const dy = targetY - (startState?.y ?? layer.y ?? 0)

        dispatch(updateSceneMotionAction({
          sceneId: currentSceneId,
          stepId: actualStepId,
          layerId,
          actionId: moveAction.id,
          values: {
            controlPoints: finalPoints,
            dx,
            dy
          }
        }))
      } else {
        // Create new action with relative offset
        const engine = getGlobalMotionEngine()
        const sceneStartTime = sceneMotionFlows[currentSceneId]?.startTime || 0
        const startState = engine.predictLayerStateAtTime(layerId, currentSceneId, step.startTime || sceneStartTime)

        const dx = targetX - (startState?.x ?? layer.x ?? 0)
        const dy = targetY - (startState?.y ?? layer.y ?? 0)

        dispatch(addSceneMotionAction({
          sceneId: currentSceneId,
          stepId: actualStepId,
          layerId,
          actionId: `action-${Date.now()}-move-${layerId}`,
          type: 'move',
          values: {
            dx,
            dy,
            controlPoints: finalPoints,
            easing: 'power4.out'
          }
        }))
      }
    }

    if (renderer?.events) {
      renderer.events.on('globalpointermove', onMove)
      renderer.events.on('pointerup', onUp)
      renderer.events.on('pointerupoutside', onUp)
    } else {
      viewport.on('globalpointermove', onMove)
      viewport.on('pointerup', onUp)
      viewport.on('pointerupoutside', onUp)
    }
  }, [dispatch, currentSceneId, sceneMotionFlows, layers, layerObjectsMap, getLayerCenter, viewport, updateMotionArrow, addSceneMotionAction])

  // Keep proxy ref updated
  handleMotionHandleDragRef.current = handleMotionHandleDrag

  // [FIX] FORCE RENDER LOOP FOR CAPTURED LAYERS
  // The 'Layer Snap Back' bug occurs because when we dispatch a Redux action (like adding a keyframe),
  // `useSimpleMotion` observes the change and calls `prepareEngine`, which resets all layers to their
  // base Redux state (effectively undoing our live motion capture transforms).
  //
  // To fix this, we hook into the PIXI ticker and forcibly re-apply the `trackedLayers` state
  // every single frame as long as Motion Capture is active. This ensures that even if another
  // system resets the layer, we immediately snap it back to the correct visual state.
  useEffect(() => {
    const ticker = PIXI.Ticker.shared

    const enforceCapturedPositions = () => {
      // [OPTIMIZATION] Use live ref to avoid React latency
      const activeMode = liveMotionCaptureRef.current
      if (!activeMode?.isActive || !activeMode.trackedLayers) return

      // [FIX] TICKER GUARD: Yield control to the animation engine if it's currently playing a preview.
      // This prevents the "snapping" conflict where the ticker enforces captured positions
      // while GSAP is trying to animate the layer to a new target.
      const engine = getGlobalMotionEngine()
      if (engine.getIsPlaying()) return

      activeMode.trackedLayers.forEach((data, layerId) => {
        const layerObject = layerObjectsMap.get(layerId)
        // Check if object exists and isn't destroyed
        if (layerObject && !layerObject.destroyed) {
          // Check specifically for currentPosition to distinguish from just tracked initial state
          if (data.currentPosition) {
            layerObject.x = data.currentPosition.x
            layerObject.y = data.currentPosition.y
          }

          // Also enforce other transforms if they exist
          if (data.rotation !== undefined) layerObject.rotation = (data.rotation * Math.PI) / 180
          if (data.scaleX !== undefined) layerObject.scale.x = data.scaleX
          if (data.scaleY !== undefined) layerObject.scale.y = data.scaleY

          // Enforce crop state so it doesn't jump back when engine rebuilds
          if (data.cropX !== undefined) layerObject.cropX = data.cropX
          if (data.cropY !== undefined) layerObject.cropY = data.cropY
          if (data.cropWidth !== undefined) layerObject.cropWidth = data.cropWidth
          if (data.cropHeight !== undefined) layerObject.cropHeight = data.cropHeight
          if (data.mediaWidth !== undefined) layerObject.mediaWidth = data.mediaWidth
          if (data.mediaHeight !== undefined) layerObject.mediaHeight = data.mediaHeight

          // Fallback visual update if GSAP CropAction hasn't injected reactive properties yet
          if (!layerObject._hasReactiveCropProperties && (layerObject._imageSprite || layerObject._videoSprite)) {
            const sprite = layerObject._imageSprite || layerObject._videoSprite
            const cropMask = layerObject._cropMask

            if (sprite && cropMask) {
              const cropX = data.cropX ?? 0
              const cropY = data.cropY ?? 0
              const cropW = data.cropWidth ?? sprite.width
              const cropH = data.cropHeight ?? sprite.height
              const mediaW = data.mediaWidth ?? sprite.width
              const mediaH = data.mediaHeight ?? sprite.height

              if (Math.abs(sprite.width - mediaW) > 0.1) sprite.width = mediaW
              if (Math.abs(sprite.height - mediaH) > 0.1) sprite.height = mediaH
              if (Math.abs(sprite.x - (-cropX)) > 0.1) sprite.x = -cropX
              if (Math.abs(sprite.y - (-cropY)) > 0.1) sprite.y = -cropY

              cropMask.clear()
              cropMask.rect(0, 0, cropW, cropH)
              cropMask.fill(0xffffff)

              const anchorX = layerObject.anchorX ?? 0.5
              const anchorY = layerObject.anchorY ?? 0.5
              layerObject.pivot.set(cropW * anchorX, cropH * anchorY)
            }
          }
        }
      })
    }

    // [OPTIMIZATION] Run at HIGH priority to ensure we override any potential 
    // Redux/React stale state resets before the frame is rendered.
    ticker.add(enforceCapturedPositions, null, PIXI.UPDATE_PRIORITY.HIGH)
    return () => {
      ticker.remove(enforceCapturedPositions)
    }
  }, [layerObjectsMap])

  /**
   * Synchronizes interactive handles for a motion arrow.
   */
  const syncMotionHandles = useCallback((layerId, stepId, controlPoints, start, end) => {
    if (!layersContainer || !start || !end || !viewport) return

    // CRITICAL PERFORMANCE FIX: If we are currently dragging a handle, DO NOT clear the container.
    // Clearing the container would destroy the handle while it's being held, stopping the drag.
    if (isDraggingHandleRef.current) return

    let container = motionHandlesRef.current.get(layerId)
    if (!container || container.destroyed) {
      container = new PIXI.Container()
      container.label = `motion-handles-${layerId}`
      container.zIndex = 10001
      motionHandlesRef.current.set(layerId, container)
      layersContainer.addChild(container)
    }

    // Release existing handles back to pool
    for (let i = container.children.length - 1; i >= 0; i--) {
      const child = container.children[i]
      if (child instanceof PIXI.Graphics) releaseMotionHandle(child)
    }
    container.removeChildren()
    container.visible = true

    // [ZOOM ADAPTIVE] Calculate scale factor to keep handles consistent on screen
    const viewportScale = viewport.scale?.x || 1
    // Clamp zoomScale to prevent handles from becoming massive when zooming out significantly
    const zoomScale = Math.min(3.0, 1 / viewportScale)

    // Final styling: White fill with purple outline
    const purpleColor = 0x8B5CF6
    const whiteColor = 0xffffff
    const baseHandleSize = 6
    const handleSize = baseHandleSize * zoomScale
    const strokeWidth = Math.max(1, 1.5 * zoomScale)

    // Hover effects for handles - [PERFORMANCE] Minimize redraws
    const setupHandleHover = (handle, isMidpoint) => {
      handle.on('pointerenter', () => {
        // Switch to solid purple on hover
        handle.clear()
        const r = isMidpoint ? handleSize - (1 * zoomScale) : handleSize
        handle.circle(0, 0, r)
        handle.fill(purpleColor)
        handle.alpha = 1
      })
      handle.on('pointerleave', () => {
        // Reset to white fill with purple border
        handle.clear()
        const r = isMidpoint ? handleSize - (1 * zoomScale) : handleSize
        handle.circle(0, 0, r)
        handle.fill(whiteColor)
        handle.stroke({ width: strokeWidth, color: purpleColor })
        handle.alpha = 1
      })
    }

    // 1. Create Control Point Handles (Solid circles)
    controlPoints.forEach((pt, index) => {
      const handle = getMotionHandle()
      handle.clear()
      handle.circle(0, 0, handleSize)
      handle.fill(whiteColor)
      handle.stroke({ width: strokeWidth, color: purpleColor })
      handle.alpha = 1
      handle.x = pt.x
      handle.y = pt.y

      // Hit area scaled by zoom for better interaction
      const hitRadius = Math.max(16, 24 * zoomScale)
      handle.hitArea = new PIXI.Circle(0, 0, hitRadius)

      handle.on('pointerdown', (e) => {
        e.stopPropagation()
        // [FIX] PROXY: Use ref to avoid circular dependency / initialization error
        // [MULTI-LAYER FIX] Ensure anchor position is up-to-date before starting drag
        const anchorKey = `${layerId}-${stepId}`
        if (!stepAnchorPositionsRef.current.has(anchorKey)) {
          // Recalculate anchor if missing
          const engine = getGlobalMotionEngine()
          const sceneStartTime = sceneMotionFlows[currentSceneId]?.startTime || 0
          const step = sceneMotionFlows[currentSceneId]?.steps?.find(s => s.id === stepId)
          if (step) {
            const startState = engine.predictLayerStateAtTime(layerId, currentSceneId, step.startTime || sceneStartTime)
            if (startState && startState.x !== undefined && startState.y !== undefined) {
              stepAnchorPositionsRef.current.set(anchorKey, { x: startState.x, y: startState.y })
            }
          }
        }
        if (handleMotionHandleDragRef.current) {
          handleMotionHandleDragRef.current(e, layerId, stepId, index, 'control')
        }
      })

      setupHandleHover(handle, false)
      container.addChild(handle)
    })

    // 2. Create Midpoint Handles (Ghost circles) - for subdivision
    const allPoints = [start, ...controlPoints, end]
    for (let i = 0; i < allPoints.length - 1; i++) {
      const p1 = allPoints[i]
      const p2 = allPoints[i + 1]
      const prev = i > 0 ? allPoints[i - 1] : null
      const next = i < allPoints.length - 2 ? allPoints[i + 2] : null

      const midpoint = getSegmentMidpoint(p1, p2, prev, next)

      const handle = getMotionHandle()
      handle.clear()
      handle.circle(0, 0, handleSize - (1 * zoomScale))
      handle.fill(whiteColor)
      handle.stroke({ width: strokeWidth, color: purpleColor })
      handle.alpha = 1
      handle.x = midpoint.x
      handle.y = midpoint.y

      // Hit area scaled by zoom for better interaction
      const hitRadius = Math.max(16, 24 * zoomScale)
      handle.hitArea = new PIXI.Circle(0, 0, hitRadius)

      handle.on('pointerdown', (e) => {
        e.stopPropagation()
        // [FIX] PROXY: Use ref to avoid circular dependency / initialization error
        // [MULTI-LAYER FIX] Ensure anchor position is up-to-date before starting drag
        const anchorKey = `${layerId}-${stepId}`
        if (!stepAnchorPositionsRef.current.has(anchorKey)) {
          // Recalculate anchor if missing
          const engine = getGlobalMotionEngine()
          const sceneStartTime = sceneMotionFlows[currentSceneId]?.startTime || 0
          const step = sceneMotionFlows[currentSceneId]?.steps?.find(s => s.id === stepId)
          if (step) {
            const startState = engine.predictLayerStateAtTime(layerId, currentSceneId, step.startTime || sceneStartTime)
            if (startState && startState.x !== undefined && startState.y !== undefined) {
              stepAnchorPositionsRef.current.set(anchorKey, { x: startState.x, y: startState.y })
            }
          }
        }
        if (handleMotionHandleDragRef.current) {
          handleMotionHandleDragRef.current(e, layerId, stepId, i, 'midpoint')
        }
      })

      setupHandleHover(handle, true)
      container.addChild(handle)
    }
  }, [layersContainer, viewport, getMotionHandle, releaseMotionHandle])



  const hideMotionArrow = useCallback((layerId = null) => {
    if (layerId) {
      const arrow = motionArrowsRef.current.get(layerId)
      if (arrow && !arrow.destroyed) {
        arrow.visible = false
      }
      motionArrowBasesRef.current.delete(layerId)
      motionArrowStepIdsRef.current.delete(layerId)

      // Hide and release handles
      const handleContainer = motionHandlesRef.current.get(layerId)
      if (handleContainer) {
        handleContainer.children.forEach(child => {
          if (child instanceof PIXI.Graphics) {
            releaseMotionHandle(child)
          }
        })
        handleContainer.removeChildren()
        handleContainer.visible = false
      }
    } else {
      for (const arrow of motionArrowsRef.current.values()) {
        if (arrow && !arrow.destroyed) {
          arrow.visible = false
        }
      }

      // Hide and release all handles
      for (const container of motionHandlesRef.current.values()) {
        container.children.forEach(child => {
          if (child instanceof PIXI.Graphics) {
            releaseMotionHandle(child)
          }
        })
        container.removeChildren()
        container.visible = false
      }

      motionArrowBasesRef.current.clear()
      motionArrowStepIdsRef.current.clear()
    }
  }, [])

  const clearMotionHandles = useCallback((layerId) => {
    if (!layerId) return

    const handleContainer = motionHandlesRef.current.get(layerId)
    if (handleContainer) {
      handleContainer.children.forEach(child => {
        if (child instanceof PIXI.Graphics) {
          releaseMotionHandle(child)
        }
      })
      handleContainer.removeChildren()
      handleContainer.visible = false
    }
    motionArrowStepIdsRef.current.delete(layerId)
  }, [releaseMotionHandle])

  // =============================================================================
  // MAIN-4 -         CENTER GUIDE LINE MANAGEMENT
  // =============================================================================

  const createGuideLine = useCallback((isVertical, layersContainer) => {
    if (!layersContainer) {
      return null
    }

    // Use provided layersContainer directly (no longer derive from stageContainer)

    const guide = new PIXI.Graphics()
    guide.label = isVertical ? 'v-guide' : 'h-guide'
    guide.eventMode = 'none' // Don't interfere with interactions
    guide.visible = true // Ensure it's visible
    guide.zIndex = 10000 // High z-index to render on top
    // Add at the end to ensure it renders on top
    layersContainer.addChild(guide)

    return guide
  }, [])

  const updateGuideLine = useCallback((guide, isVertical, canvasWidth, canvasHeight, viewport, forceUpdate = false) => {
    if (!guide || !viewport) {
      return
    }

    // Check if guide is destroyed
    if (guide.destroyed) {
      return
    }

    // Check if canvas dimensions have changed significantly
    const lastDimensions = lastCanvasDimensionsRef.current
    const dimensionsChanged = lastDimensions.width !== canvasWidth || lastDimensions.height !== canvasHeight

    if (dimensionsChanged) {
      lastCanvasDimensionsRef.current = { width: canvasWidth, height: canvasHeight }
      // Force update when dimensions change
      forceUpdate = true
    }

    // No zoom compensation needed - using fixed stroke widths

    if (isVertical) {
      // Vertical guide at canvas center - span entire canvas height
      // Canvas coordinate system goes from (0,0) to (canvasWidth, canvasHeight)
      const centerX = canvasWidth / 2
      const topY = 0
      const bottomY = canvasHeight

      // Only draw if guide is not already drawn at this position or dimensions haven't changed
      // Even with forceUpdate, don't redraw if position hasn't changed
      const positionChanged = lastGuidePositionRef.current.vX !== centerX
      if (!positionChanged && guide.visible && !dimensionsChanged) {
        return // Already drawn and visible, no need to redraw
      }

      lastGuidePositionRef.current.vX = centerX

      // Safety check before calling clear
      if (!guide || guide.destroyed || typeof guide.clear !== 'function') {
        return
      }

      guide.clear()
      guide.moveTo(centerX, topY)
      guide.lineTo(centerX, bottomY)
      const strokeProps = getGuideStrokeProperties()
      guide.stroke({ width: strokeProps.width, color: strokeProps.color, alpha: strokeProps.alpha })
    } else {
      // Horizontal guide at canvas center - span entire canvas width
      // Canvas coordinate system goes from (0,0) to (canvasWidth, canvasHeight)
      const centerY = canvasHeight / 2
      const leftX = 0
      const rightX = canvasWidth

      // Only draw if guide is not already drawn at this position or dimensions haven't changed
      // Even with forceUpdate, don't redraw if position hasn't changed
      const positionChanged = lastGuidePositionRef.current.hY !== centerY
      if (!positionChanged && guide.visible && !dimensionsChanged) {
        return // Already drawn and visible, no need to redraw
      }

      lastGuidePositionRef.current.hY = centerY

      // Safety check before calling clear
      if (!guide || guide.destroyed || typeof guide.clear !== 'function') {
        return
      }

      guide.clear()
      guide.moveTo(leftX, centerY)
      guide.lineTo(rightX, centerY)
      const strokeProps = getGuideStrokeProperties()
      guide.stroke({ width: strokeProps.width, color: strokeProps.color, alpha: strokeProps.alpha })
    }
  }, [getGuideStrokeProperties])

  const hideGuideLines = useCallback(() => {
    if (vGuideRef.current) {
      vGuideRef.current.visible = false
    }
    if (hGuideRef.current) {
      hGuideRef.current.visible = false
    }
    currentGuideStateRef.current = { showVGuide: false, showHGuide: false }
  }, [])

  const removeGuideLines = useCallback((layersContainer) => {
    if (!layersContainer) {
      return
    }

    if (vGuideRef.current && layersContainer && vGuideRef.current.parent === layersContainer) {
      layersContainer.removeChild(vGuideRef.current)
      vGuideRef.current.destroy()
      vGuideRef.current = null
    }
    if (hGuideRef.current && layersContainer && hGuideRef.current.parent === layersContainer) {
      layersContainer.removeChild(hGuideRef.current)
      hGuideRef.current.destroy()
      hGuideRef.current = null
    }
  }, [])

  // =============================================================================
  // MAIN-5 -         ALIGNMENT GUIDE LINE MANAGEMENT
  // =============================================================================

  const updateAlignmentGuides = useCallback((alignmentGuides, layersContainer, canvasWidth, canvasHeight, viewport) => {
    if (!layersContainer || !viewport) return

    // Create a set of current guide IDs from alignmentGuides
    const currentGuideIds = new Set()
    alignmentGuides.forEach((guide) => {
      // Use position rounded to 2 decimals for ID to handle floating point precision
      const guideId = `${guide.isVertical ? 'v' : 'h'}-${Math.round(guide.position * 100) / 100}`
      currentGuideIds.add(guideId)

      // Check cache to see if guide needs updating
      const cacheKey = guideId
      const cachedGuide = alignmentGuideCacheRef.current.get(cacheKey)
      const start = guide.start !== undefined ? guide.start : (guide.isVertical ? 0 : 0)
      const end = guide.end !== undefined ? guide.end : (guide.isVertical ? canvasHeight : canvasWidth)
      const needsUpdate = !cachedGuide ||
        cachedGuide.position !== guide.position ||
        cachedGuide.type !== guide.type ||
        cachedGuide.start !== start ||
        cachedGuide.end !== end ||
        cachedGuide.canvasWidth !== canvasWidth ||
        cachedGuide.canvasHeight !== canvasHeight

      // Check if guide already exists
      let existingGuide = null
      for (const [id, guideObj] of alignmentGuidesRef.current.entries()) {
        if (id === guideId && !guideObj.destroyed) {
          existingGuide = guideObj
          break
        }
      }

      if (!existingGuide) {
        // Create new guide and apply appropriate styling
        if (layersContainer) {
          const newGuide = new PIXI.Graphics()
          newGuide.label = `alignment-guide-${guide.isVertical ? 'v' : 'h'}-${alignmentGuideIdCounterRef.current++}`
          newGuide.eventMode = 'none'
          newGuide.visible = true
          newGuide.zIndex = 10000

          const strokeProps = getGuideStrokeProperties()

          if (guide.type === 'safeZone') {
            // Safe zone guides: solid lines same thickness as center guides and purple color
            newGuide.stroke({ width: strokeProps.width, color: 0x8B5CF6, alpha: 1.0 }) // Same thickness as center guides (3px), purple color, full opacity

            // Purple lines same thickness as center guides (3px wide/tall) - frame style, stop at corners
            if (guide.isVertical) {
              // Vertical guide as 3px wide filled rectangle between start and end
              const startY = guide.start !== undefined ? guide.start : 0
              const endY = guide.end !== undefined ? guide.end : canvasHeight
              const height = endY - startY
              newGuide.rect(guide.position - 1.5, startY, 3, height) // Center the 3px wide line on the guide position
              newGuide.fill({ color: 0x8B5CF6, alpha: 1.0 })
            } else {
              // Horizontal guide as 3px tall filled rectangle between start and end
              const startX = guide.start !== undefined ? guide.start : 0
              const endX = guide.end !== undefined ? guide.end : canvasWidth
              const width = endX - startX
              newGuide.rect(startX, guide.position - 1.5, width, 3) // Center the 3px tall line on the guide position
              newGuide.fill({ color: 0x8B5CF6, alpha: 1.0 })
            }
          } else {
            // Other guides: dotted lines with normal thickness
            // Thinner stroke for dotted lines (50% of normal width, minimum 1px)
            const thinStrokeWidth = Math.max(1, strokeProps.width * 0.5)
            // More dotted pattern: shorter dashes, longer gaps
            const dashLength = 3
            const gapLength = 6

            if (guide.isVertical) {
              // Use bounds if provided, otherwise span full canvas height
              const startY = guide.start !== undefined ? guide.start : 0
              const endY = guide.end !== undefined ? guide.end : canvasHeight
              drawDashedLine(newGuide, guide.position, startY, guide.position, endY, strokeProps.color, thinStrokeWidth, dashLength, gapLength)
            } else {
              // Use bounds if provided, otherwise span full canvas width
              const startX = guide.start !== undefined ? guide.start : 0
              const endX = guide.end !== undefined ? guide.end : canvasWidth
              drawDashedLine(newGuide, startX, guide.position, endX, guide.position, strokeProps.color, thinStrokeWidth, dashLength, gapLength)
            }
          }

          newGuide.zIndex = 10000
          layersContainer.addChild(newGuide)
          alignmentGuidesRef.current.set(guideId, newGuide)

          // Update cache
          alignmentGuideCacheRef.current.set(cacheKey, {
            position: guide.position,
            type: guide.type,
            start,
            end,
            canvasWidth,
            canvasHeight
          })
        }
      } else if (needsUpdate) {
        // Update existing guide position and stroke width only if needed
        existingGuide.visible = true
        existingGuide.clear()
        const strokeProps = getGuideStrokeProperties()

        if (guide.type === 'safeZone') {
          // Safe zone guides: solid lines same thickness as center guides and purple color
          existingGuide.stroke({ width: strokeProps.width, color: 0x8B5CF6, alpha: 1.0 }) // Same thickness as center guides (3px), purple color, full opacity

          // Purple lines same thickness as center guides (3px wide/tall) - frame style, stop at corners
          if (guide.isVertical) {
            // Vertical guide as 3px wide filled rectangle between start and end
            const startY = guide.start !== undefined ? guide.start : 0
            const endY = guide.end !== undefined ? guide.end : canvasHeight
            const height = endY - startY
            existingGuide.rect(guide.position - 1.5, startY, 3, height) // Center the 3px wide line on the guide position
            existingGuide.fill({ color: 0x8B5CF6, alpha: 1.0 })
          } else {
            // Horizontal guide as 3px tall filled rectangle between start and end
            const startX = guide.start !== undefined ? guide.start : 0
            const endX = guide.end !== undefined ? guide.end : canvasWidth
            const width = endX - startX
            existingGuide.rect(startX, guide.position - 1.5, width, 3) // Center the 3px tall line on the guide position
            existingGuide.fill({ color: 0x8B5CF6, alpha: 1.0 })
          }
        } else {
          // Other guides: dotted lines with normal thickness
          // Thinner stroke for dotted lines (50% of normal width, minimum 1px)
          const thinStrokeWidth = Math.max(1, strokeProps.width * 0.5)
          // More dotted pattern: shorter dashes, longer gaps
          const dashLength = 3
          const gapLength = 6
          if (guide.isVertical) {
            // Use bounds if provided, otherwise span full canvas height
            const startY = guide.start !== undefined ? guide.start : 0
            const endY = guide.end !== undefined ? guide.end : canvasHeight
            drawDashedLine(existingGuide, guide.position, startY, guide.position, endY, strokeProps.color, thinStrokeWidth, dashLength, gapLength)
          } else {
            // Use bounds if provided, otherwise span full canvas width
            const startX = guide.start !== undefined ? guide.start : 0
            const endX = guide.end !== undefined ? guide.end : canvasWidth
            drawDashedLine(existingGuide, startX, guide.position, endX, guide.position, strokeProps.color, thinStrokeWidth, dashLength, gapLength)
          }
        }

        // Update cache
        alignmentGuideCacheRef.current.set(cacheKey, {
          position: guide.position,
          type: guide.type,
          start,
          end,
          canvasWidth,
          canvasHeight
        })
      } else {
        // Guide exists and doesn't need update, just ensure it's visible
        existingGuide.visible = true
      }
    })

    // Remove guides that are no longer needed
    for (const [guideId, guideObj] of alignmentGuidesRef.current.entries()) {
      if (!currentGuideIds.has(guideId)) {
        if (guideObj && !guideObj.destroyed && guideObj.parent === layersContainer) {
          layersContainer.removeChild(guideObj)
          guideObj.destroy()
        }
        alignmentGuidesRef.current.delete(guideId)
      }
    }
  }, [getGuideStrokeProperties])

  const hideAlignmentGuides = useCallback(() => {
    for (const guide of alignmentGuidesRef.current.values()) {
      if (guide && !guide.destroyed) {
        guide.visible = false
      }
    }
  }, [])

  const removeAlignmentGuides = useCallback((layersContainer) => {
    if (!layersContainer) return

    for (const [guideId, guide] of alignmentGuidesRef.current.entries()) {
      if (guide && !guide.destroyed && guide.parent === layersContainer) {
        layersContainer.removeChild(guide)
        guide.destroy()
      }
    }
    alignmentGuidesRef.current.clear()
    alignmentGuideCacheRef.current.clear()
  }, [])

  // =============================================================================
  // SPACING GUIDE LINE MANAGEMENT
  // =============================================================================

  const createSpacingGuideLine = useCallback((spacingGuide, layersContainer, viewport) => {
    if (!layersContainer || !viewport) return null

    const container = new PIXI.Container()
    container.label = `spacing-guide-${spacingGuideIdCounterRef.current++}`
    container.eventMode = 'none'
    container.visible = true
    container.zIndex = 10000

    const strokeProps = getGuideStrokeProperties()
    const graphics = new PIXI.Graphics()

    // Calculate zoom-adaptive dimensions
    // When zoomed in (scale > 1), we want features to look normal size, so we scale DOWN (1/scale)
    const currentScale = viewport.scale.x || 1
    const zoomScale = 1 / currentScale
    const dims = getScaledBadgeDimensions(zoomScale)

    // Scale stroke width inversely with zoom to maintain constant visual thickness
    // Base width 1px, scaled by zoomScale
    // Standardize spacing guide visuals: 1.5px logical width looks crisp and premium
    const thinStrokeWidth = 1.5 * zoomScale
    const dashLength = 4 * zoomScale
    const gapLength = 4 * zoomScale

    // Draw the guide line (dotted/dashed) with rounded coordinates for sharpness
    const startX = Math.round(spacingGuide.startX)
    const startY = Math.round(spacingGuide.startY)
    const endX = Math.round(spacingGuide.endX)
    const endY = Math.round(spacingGuide.endY)
    drawDashedLine(graphics, startX, startY, endX, endY, strokeProps.color, thinStrokeWidth, dashLength, gapLength)

    container.addChild(graphics)

    // Create text label for distance (only show distance, no target)
    const labelText = `${Math.round(spacingGuide.distance)}` // Removed 'px' for cleaner look at small scales

    // QUALITY FIX: Use higher resolution for text based on viewport
    const viewportScale = viewport.scale.x || 1
    const textResolution = Math.min(3, Math.max(1, viewportScale))

    // Apply scaling to font size manually since we're not using container scaling here yet
    // (We could use container scaling, but let's stick to property scaling for guides for now, or match badgeUtils)
    // Actually, let's match badgeUtils pattern: consistent font size * scale

    const label = new PIXI.Text({
      text: labelText,
      style: {
        fontFamily: 'monospace',
        fontSize: dims.fontSize * zoomScale, // Scale font size directly
        fill: 0xffffff, // White text
        fontWeight: 'bold',
        align: 'center'
      }
    })
    label.resolution = textResolution

    // Position label at the center of the rounded guide line
    const labelX = Math.round((startX + endX) / 2)
    const labelY = Math.round((startY + endY) / 2)

    // For horizontal guides, position label above the line
    // For vertical guides, position label to the right of the line
    if (spacingGuide.isVertical) {
      label.x = labelX + (12 * zoomScale)
      label.y = Math.round(labelY - label.height / 2)
    } else {
      label.x = Math.round(labelX - label.width / 2)
      label.y = labelY - label.height - (12 * zoomScale)
    }

    // Create label background - purple badge with rounded corners
    const labelBg = new PIXI.Graphics()

    labelBg.clear()
    labelBg.roundRect(
      label.x - (dims.padding * zoomScale),
      label.y - (dims.padding * zoomScale) / 2,
      label.width + ((dims.padding * 2) * zoomScale),
      label.height + (dims.padding * zoomScale),
      dims.borderRadius * zoomScale
    )
    labelBg.fill({ color: 0x0D1216, alpha: 0.85 }) // Match CanvasControls color

    container.addChild(labelBg)
    container.addChild(label)

    layersContainer.addChild(container)
    return { graphics: container, label, labelBg }
  }, [getGuideStrokeProperties, getFixedFontSize])

  const updateSpacingGuides = useCallback((spacingGuides, layersContainer, viewport) => {
    if (!layersContainer || !viewport) return

    const strokeProps = getGuideStrokeProperties()

    // Create a set of current guide IDs (use a more stable ID based on guide properties)
    const currentGuideIds = new Set()
    spacingGuides.forEach((guide) => {
      // Use a more stable ID based on guide properties, not index
      const guideId = `spacing-${guide.type}-${Math.round(guide.startX)}-${Math.round(guide.startY)}-${Math.round(guide.endX)}-${Math.round(guide.endY)}`
      currentGuideIds.add(guideId)

      // Check cache to see if guide needs updating
      const cacheKey = guideId
      const cachedGuide = spacingGuideCacheRef.current.get(cacheKey)
      const needsUpdate = !cachedGuide ||
        cachedGuide.startX !== guide.startX ||
        cachedGuide.startY !== guide.startY ||
        cachedGuide.endX !== guide.endX ||
        cachedGuide.endY !== guide.endY ||
        cachedGuide.distance !== guide.distance

      // Check if guide already exists
      let existingGuide = spacingGuidesRef.current.get(guideId)

      if (!existingGuide || existingGuide.graphics.destroyed) {
        // Create new guide
        const newGuide = createSpacingGuideLine(guide, layersContainer, viewport)
        if (newGuide) {
          spacingGuidesRef.current.set(guideId, newGuide)
          // Update cache
          spacingGuideCacheRef.current.set(cacheKey, {
            startX: guide.startX,
            startY: guide.startY,
            endX: guide.endX,
            endY: guide.endY,
            distance: guide.distance
          })
        }
      } else if (needsUpdate) {
        // Update existing guide: line position and distance label only if needed
        existingGuide.graphics.visible = true

        // Find the graphics line (first child is the line graphics)
        const graphics = existingGuide.graphics.children[0]
        const label = existingGuide.label
        const labelBg = existingGuide.labelBg

        if (graphics && graphics instanceof PIXI.Graphics) {
          // Update line position with consistent 1.5px width and rounded coordinates
          graphics.clear()
          const currentScale = viewport.scale.x || 1
          const zoomScale = 1 / currentScale
          const thinStrokeWidth = 1.5 * zoomScale
          const dashLength = 4 * zoomScale
          const gapLength = 4 * zoomScale

          const startX = Math.round(guide.startX)
          const startY = Math.round(guide.startY)
          const endX = Math.round(guide.endX)
          const endY = Math.round(guide.endY)
          drawDashedLine(graphics, startX, startY, endX, endY, strokeProps.color, thinStrokeWidth, dashLength, gapLength)
        }

        if (label) {
          // Calculate zoom-adaptive dimensions
          const currentScale = viewport.scale.x || 1
          const zoomScale = 1 / currentScale
          const dims = getScaledBadgeDimensions(zoomScale) // Returns constants + scale

          // QUALITY FIX: Update resolution
          label.resolution = Math.min(3, Math.max(1, currentScale))

          // Update font size based on zoom (manually scale since we're not using container scale here)
          label.style.fontSize = dims.fontSize * zoomScale

          // Update distance label text (only show distance, no target)
          // Updating text after fontSize ensures PIXI recalculates dimensions
          const labelText = `${Math.round(guide.distance)}`
          label.text = labelText

          // Update label color to white
          label.style.fill = 0xffffff

          // Reposition label at the center of the rounded guide line
          const startX = Math.round(guide.startX)
          const startY = Math.round(guide.startY)
          const endX = Math.round(guide.endX)
          const endY = Math.round(guide.endY)
          const labelX = Math.round((startX + endX) / 2)
          const labelY = Math.round((startY + endY) / 2)

          if (guide.isVertical) {
            label.x = labelX + (12 * zoomScale)
            label.y = Math.round(labelY - label.height / 2)
          } else {
            label.x = Math.round(labelX - label.width / 2)
            label.y = labelY - label.height - (12 * zoomScale)
          }

          // Update label background - purple badge with rounded corners
          if (labelBg) {
            // zoomScale and dims are already calculated above

            labelBg.clear()
            const targetBgWidth = label.width + ((dims.padding * 2) * zoomScale)
            const quantizedBgWidth = Math.ceil(targetBgWidth / (16 * zoomScale)) * (16 * zoomScale)

            labelBg.roundRect(
              label.x - (quantizedBgWidth - label.width) / 2,
              label.y - (dims.padding * zoomScale) / 2,
              quantizedBgWidth,
              label.height + (dims.padding * zoomScale),
              dims.borderRadius * zoomScale
            )
            labelBg.fill({ color: 0x0D1216, alpha: 0.85 }) // Match CanvasControls color
            // No stroke needed for badge style
          }
        }

        // Update cache
        spacingGuideCacheRef.current.set(cacheKey, {
          startX: guide.startX,
          startY: guide.startY,
          endX: guide.endX,
          endY: guide.endY,
          distance: guide.distance
        })
      } else {
        // Guide exists and doesn't need update, just ensure it's visible
        existingGuide.graphics.visible = true
      }
    })

    // Remove guides that are no longer needed
    for (const [guideId, guideObj] of spacingGuidesRef.current.entries()) {
      if (!currentGuideIds.has(guideId)) {
        if (guideObj && guideObj.graphics && !guideObj.graphics.destroyed && guideObj.graphics.parent === layersContainer) {
          layersContainer.removeChild(guideObj.graphics)
          guideObj.graphics.destroy({ children: true })
        }
        spacingGuidesRef.current.delete(guideId)
      }
    }
  }, [createSpacingGuideLine, getGuideStrokeProperties])

  // Debounced guide update functions for performance during drag (defined after the functions they depend on)
  const debouncedUpdateAlignmentGuides = useCallback((alignmentGuides, layersContainer, canvasWidth, canvasHeight, viewport) => {
    const throttle = guideUpdateThrottleRef.current
    const currentTime = performance.now()

    // Always update immediately if no recent update
    if (currentTime - throttle.lastUpdateTime > throttle.updateInterval) {
      updateAlignmentGuides(alignmentGuides, layersContainer, canvasWidth, canvasHeight, viewport)
      throttle.lastUpdateTime = currentTime
      return
    }

    // Queue update for next frame
    throttle.pendingUpdate = () => {
      updateAlignmentGuides(alignmentGuides, layersContainer, canvasWidth, canvasHeight, viewport)
      throttle.lastUpdateTime = performance.now()
      throttle.pendingUpdate = null
    }

    if (!throttle.frameId) {
      throttle.frameId = requestAnimationFrame(() => {
        if (throttle.pendingUpdate) {
          throttle.pendingUpdate()
        }
        throttle.frameId = null
      })
    }
  }, []) // No dependencies since updateAlignmentGuides is stable

  const debouncedUpdateSpacingGuides = useCallback((spacingGuides, layersContainer, viewport) => {
    const throttle = guideUpdateThrottleRef.current
    const currentTime = performance.now()

    // Always update immediately if no recent update
    if (currentTime - throttle.lastUpdateTime > throttle.updateInterval) {
      updateSpacingGuides(spacingGuides, layersContainer, viewport)
      throttle.lastUpdateTime = currentTime
      return
    }

    // Queue update for next frame
    throttle.pendingUpdate = () => {
      updateSpacingGuides(spacingGuides, layersContainer, viewport)
      throttle.lastUpdateTime = performance.now()
      throttle.pendingUpdate = null
    }

    if (!throttle.frameId) {
      throttle.frameId = requestAnimationFrame(() => {
        if (throttle.pendingUpdate) {
          throttle.pendingUpdate()
        }
        throttle.frameId = null
      })
    }
  }, []) // No dependencies since updateSpacingGuides is stable

  const hideSpacingGuides = useCallback(() => {
    for (const guideObj of spacingGuidesRef.current.values()) {
      if (guideObj && guideObj.graphics && !guideObj.graphics.destroyed) {
        guideObj.graphics.visible = false
      }
    }
  }, [])

  const removeSpacingGuides = useCallback((layersContainer) => {
    if (!layersContainer) return

    for (const [guideId, guideObj] of spacingGuidesRef.current.entries()) {
      if (guideObj && guideObj.graphics && !guideObj.graphics.destroyed && guideObj.graphics.parent === layersContainer) {
        layersContainer.removeChild(guideObj.graphics)
        guideObj.graphics.destroy({ children: true })
      }
    }
    spacingGuidesRef.current.clear()
    spacingGuideCacheRef.current.clear()
  }, [])



  // =============================================================================
  // USE EFFECT HOOKS AND SIDE EFFECTS
  // =============================================================================

  // Keep ref updated with latest selectedLayerIds
  useEffect(() => {
    selectedLayerIdsRef.current = selectedLayerIds
    // Invalidate snapping cache when selection changes
    snappingCacheRef.current = { otherObjects: null, selectedIds: null }
  }, [selectedLayerIds])

  // Visualize motion path when layer is selected and has move action
  const updateMotionArrowVisibility = useCallback((layerId, skipClear = false, tempControlPoints = null) => {
    // Hide immediately if isPlaying is true
    if (latestIsPlayingRef.current) {
      hideMotionArrow() // Hide all
      return
    }

    // If no layerId provided, try to find from selectedLayerIds
    if (!layerId) {
      if (selectedLayerIdsRef.current && selectedLayerIdsRef.current.length === 1) {
        layerId = selectedLayerIdsRef.current[0]
      } else {
        if (!skipClear) hideMotionArrow()
        return
      }
    }

    const layer = layers[layerId]
    const layerObject = layerObjectsMap.get(layerId)
    const sceneMotionFlow = sceneMotionFlows?.[currentSceneId]
    const currentMotionCaptureMode = latestMotionCaptureModeRef.current

    if (!layer || !layerObject) {
      hideMotionArrow(layerId)
      return
    }

    // ASSEMBLE PATH CHAIN
    const segments = []
    const engine = getGlobalMotionEngine()

    // Start with base state from REDUX (not PIXI object, which moves with playhead)
    // This ensures the path is always drawn relative to the "start" of the scene
    let currentState = {
      x: layer.x || 0,
      y: layer.y || 0,
      rotation: layer.rotation || 0,
      scaleX: layer.scaleX || 1,
      scaleY: layer.scaleY || 1
    }

    // Iterate through steps to build the path chain
    // [IMPORTANT] Record the anchor position for this layer+step combination for relative calculation in drag handlers
    // [MULTI-LAYER FIX] Use layer+step key to prevent overwrites when multiple layers share the same step
    // We only clear the entire map during group sync (syncArrows) to avoid wiping data from other selected layers.
    // For individual updates, we just overwrite the relevant entries for this layer.

    for (const step of (sceneMotionFlow?.steps || [])) {
      const layerActions = step.layerActions?.[layerId] || []
      const moveAction = layerActions.find(a => a.type === 'move')

      const isActiveStep = currentMotionCaptureMode?.isActive && currentMotionCaptureMode.stepId === step.id
      const isCurrentlyDragged = isActiveStep && dragStateAPI.isDragging()
      const trackedLayer = isActiveStep ? currentMotionCaptureMode.trackedLayers?.get(layerId) : null

      // CRITICAL FIX: Only treat as "moving" if actively dragged OR actually moved
      const isActuallyMoving = isActiveStep && (isCurrentlyDragged || trackedLayer?.didMove)

      if (moveAction || isActuallyMoving) {
        const anchorKey = `${layerId}-${step.id}`
        stepAnchorPositionsRef.current.set(anchorKey, { x: currentState.x, y: currentState.y })

        const startCenter = getLayerCenter(layer, layerObject, currentState.x, currentState.y)

        // Calculate end using relative deltas
        let endX = currentState.x
        let endY = currentState.y

        if (moveAction) {
          if (moveAction.values?.dx !== undefined || moveAction.values?.dy !== undefined) {
            endX += (moveAction.values.dx || 0)
            endY += (moveAction.values.dy || 0)
          } else {
            // Fallback for absolute legacy values (should be rare now)
            endX = moveAction.values?.x !== undefined ? moveAction.values.x : endX
            endY = moveAction.values?.y !== undefined ? moveAction.values.y : endY
          }
        }

        const isCurrentlyHandleDragged = isDraggingHandleRef.current &&
          motionArrowStepIdsRef.current.get(layerId) === step.id

        // If actively dragging or just finished dragging in Capture Mode, prioritize tracked position
        let endCenter

        if (isCurrentlyDragged) {
          const targetObj = layerObject._cachedSprite || layerObject
          endCenter = getLayerCenter(layer, layerObject, targetObj.x, targetObj.y)
        } else if (isActiveStep && trackedLayer?.currentPosition) {
          endCenter = getLayerCenter(layer, layerObject, trackedLayer.currentPosition.x, trackedLayer.currentPosition.y)
          endX = trackedLayer.currentPosition.x
          endY = trackedLayer.currentPosition.y
        } else {
          endCenter = getLayerCenter(layer, layerObject, endX, endY)
        }

        const controlPoints = (isCurrentlyHandleDragged && tempControlPoints)
          ? tempControlPoints
          : (moveAction?.values?.controlPoints || [])

        // [FIX] HIDE UNTIL MOVEMENT: Do not show markers or handles for the active step
        // until the user actually starts moving the layer (2px threshold).
        const dist = getDistance(startCenter, endCenter)
        const hasMoved = dist > 2 || controlPoints.length > 0 || (moveAction && (Math.abs(moveAction.values?.dx || 0) > 0.1 || Math.abs(moveAction.values?.dy || 0) > 0.1))

        if (hasMoved || !isActiveStep) {
          // [FIX] UNIFIED COORDINATES: Map relative anchor offsets to WORLD CENTERS for rendering
          // This ensures handles are always exactly on the visual line.
          // [MULTI-LAYER FIX] Use stored anchor position if available, otherwise use currentState
          const anchorKey = `${layerId}-${step.id}`
          const storedAnchor = stepAnchorPositionsRef.current.get(anchorKey)
          const anchorX = storedAnchor?.x ?? currentState.x
          const anchorY = storedAnchor?.y ?? currentState.y
          const worldCenterControlPoints = controlPoints.map(cp => {
            return getLayerCenter(layer, layerObject, anchorX + cp.x, anchorY + cp.y)
          })

          segments.push({
            start: startCenter,
            end: endCenter,
            controlPoints: worldCenterControlPoints,
            isSolid: isCurrentlyDragged || isActiveStep,
            stepId: step.id
          })
        }

        // Update currentState for next step
        currentState.x = endX
        currentState.y = endY
      } else {
        // Just update state predictions for other actions
      }
    }

    if (segments.length === 0) {
      hideMotionArrow(layerId)
      return
    }

    // Create arrow if needed
    createMotionArrow(layerId, layersContainer)

    // Update the arrow with all segments
    updateMotionArrow(layerId, segments)

    // For handle sync logic, we'll ONLY show handles for the "active" (solid) step
    // in Motion Capture Mode. Dashed arrows are just for preview and are non-interactive.
    const activeSegment = segments.find(s => s.isSolid)

    if (activeSegment) {
      motionArrowStepIdsRef.current.set(layerId, activeSegment.stepId)
      syncMotionHandles(layerId, activeSegment.stepId, activeSegment.controlPoints, activeSegment.start, activeSegment.end)
    } else {
      clearMotionHandles(layerId)
    }

  }, [layers, layerObjectsMap, sceneMotionFlows, currentSceneId, dragStateAPI, hideMotionArrow, createMotionArrow, updateMotionArrow, getLayerCenter, motionCaptureMode, zoom, syncMotionHandles, clearMotionHandles])

  // Keep proxy ref updated
  updateMotionArrowVisibilityRef.current = updateMotionArrowVisibility

  /**
   * Performance optimization: Live-sync motion arrows directly using PIXI object positions.
   * This bypasses the React/Redux loop for 60fps movement during multi-select rotate/resize.
   * [MULTI-LAYER FIX] Also ensures anchor positions are recalculated for all selected layers.
   */
  const syncArrows = useCallback(() => {
    const currentSelectedIds = selectedLayerIdsRef.current
    if (!currentSelectedIds || currentSelectedIds.length === 0) return

    // [MULTI-LAYER FIX] Clear anchor map once at the beginning of grouped sync 
    // to ensure we have a fresh slate for the entire selection.
    stepAnchorPositionsRef.current.clear()

    currentSelectedIds.forEach(id => {
      // For multi-segment system, simply re-trigger updateMotionArrowVisibility
      // to rebuild the chain with current PIXI positions for the active step.
      // This is efficient enough for 60fps and avoids duplicating complex path logic.
      // [MULTI-LAYER FIX] This also recalculates anchor positions per layer+step combination
      updateMotionArrowVisibility(id, true)
    })
  }, [updateMotionArrowVisibility])

  // Effect to update visibility when potential dependencies change
  useEffect(() => {
    // CRITICAL: Do not interfere with motion arrow if motion capture is active AND dragging
    // The drag handlers manage the arrow state in this mode during active movement.
    // However, we want to show it on selection even in capture mode if not dragging.
    if (motionCaptureMode?.isActive && dragStateAPI.isDragging()) {
      return
    }

    if (isDraggingHandleRef.current) {
      return
    }

    // Only run if we have a selection and not playing
    if (selectedLayerIds && selectedLayerIds.length > 0 && !isPlaying) {
      // Hide all previous arrows once at the start
      hideMotionArrow()

      // If single selection, just show one
      if (selectedLayerIds.length === 1) {
        updateMotionArrowVisibility(selectedLayerIds[0])
      } else if (motionCaptureMode?.isActive) {
        // Multi-selection: only show arrows in Motion Capture mode
        selectedLayerIds.forEach(id => {
          updateMotionArrowVisibility(id, true) // skipClear=true to accumulate arrows
        })
      } else {
        // Multi-selection in normal mode: hide all (as per previous logic)
        hideMotionArrow()
      }
    } else {
      hideMotionArrow()
    }
  }, [selectedLayerIds, sceneMotionFlows, currentSceneId, layers, layerObjectsMap, updateMotionArrowVisibility, hideMotionArrow, motionCaptureMode, dragStateAPI, isPlaying])

  // Double-click detection for text editing (moved to viewport level)
  const doubleClickTimeoutsRef = useRef(new Map()) // Map of layerId -> { timestamp, timer }

  // Update drag state API with latest layer objects map
  useEffect(() => {
    dragStateAPI.updateLayerObjectsMap(layerObjectsMap)
  }, [layerObjectsMap, dragStateAPI])

  // Hide hover box when dragging state changes (starts or ends)
  useEffect(() => {
    hideHoverBox()
    hideDragHoverBox()
  }, [dragStateAPI.isDragging(), hideHoverBox, hideDragHoverBox])

  // =============================================================================
  // PERFORMANCE: DECOUPLED GUIDE CLEANUP
  // =============================================================================

  // This effect handles aggressive guide removal only when the component unmounts.
  // [FIX] Don't remove center guides when scene changes - they work the same for all scenes
  // Only remove alignment/spacing guides which are scene-specific
  useEffect(() => {
    return () => {
      if (layersContainer) {
        removeAlignmentGuides(layersContainer)
        removeSpacingGuides(layersContainer)
        // [FIX] Only remove center guides on unmount, not on scene change
        // Center guides should persist across scenes since they're canvas-based, not scene-based
        // removeGuideLines(layersContainer) // Removed - center guides persist across scenes
      }
    }
  }, [layersContainer, removeAlignmentGuides, removeSpacingGuides])

  // =============================================================================
  // MAIN-6 -          MAIN INTERACTION EVENT HANDLERS
  // =============================================================================

  useEffect(() => {
    if (!stageContainer || !layerObjectsMap || !viewport) return

    // =========================================================================
    // POINTER DOWN HANDLER - Handles initial click/drag detection
    // =========================================================================

    const handlePointerDown = (event) => {
      // Ignore right clicks for custom dragging (allow viewport panning to handle it)
      if (event.data?.button === 2 || event.button === 2 || event.data?.originalEvent?.button === 2) {
        return
      }

      const target = event.target

      // Prevent text selection immediately
      event.preventDefault()

      // Hide hover box immediately when any pointer interaction starts
      hideHoverBox()

      // CRITICAL: If we are not in motion capture mode, and we interact with the canvas,
      // pause playback at the current time.
      if (!latestMotionCaptureModeRef.current?.isActive && pausePlayback) {
        pausePlayback()
      }

      // Use ref to get latest selectedLayerIds (avoids stale closure)
      // CRITICAL FIX: Filter by currentSceneId to prevent teleporting layers from other scenes
      let currentSelectedLayerIds = (selectedLayerIdsRef.current || [])
        .filter(id => latestLayersRef.current[id]?.sceneId === currentSceneId)

      // Check if we have multiple layers selected - this affects how we handle selection boxes
      const hasMultiSelect = currentSelectedLayerIds && currentSelectedLayerIds.length > 1


      // Check if clicked on selection box or its handles
      let current = target
      let clickedOnMultiSelectionBox = false
      let clickedOnSelectionBox = false
      while (current && current !== stageContainer && current !== viewport) {
        if (current.label === 'selection-box' || current.parent?.label === 'selection-box') {
          clickedOnSelectionBox = true
          break
        }
        // Check if clicked on multi-selection box
        if (current.label === 'multi-selection-box' || current.parent?.label === 'multi-selection-box') {
          clickedOnMultiSelectionBox = true
          break
        }
        current = current.parent
      }

      // If clicked on multi-selection box and we have multiple layers selected, start multi-drag
      if (clickedOnMultiSelectionBox && hasMultiSelect) {
        // Ensure we stop propagation to prevent other handlers from interfering
        event.stopPropagation()
        event.stopImmediatePropagation?.()
        // Get screen position
        const screenPos = { x: event.data.global.x, y: event.data.global.y }

        // Store initial positions and offsets for all selected layers
        initialPositionsRef.current.clear()
        dragOffsetsRef.current.clear()

        // Calculate bounding box center first
        const originalBounds = computeCombinedLayerBounds(currentSelectedLayerIds, latestLayersRef.current, layerObjectsMap, latestMotionCaptureModeRef.current)

        // CRITICAL FIX: Cache initial bounds for box movement during drag
        if (originalBounds) {
          dragMultiSelectBoundsCacheRef.current = {
            bounds: originalBounds,
            selectedIds: [...currentSelectedLayerIds]
          }
        }

        currentSelectedLayerIds.forEach((id) => {
          const selectedLayer = latestLayersRef.current[id]
          if (selectedLayer) {
            // Check for captured transform overrides during motion capture
            const capturedLayer = latestMotionCaptureModeRef.current?.isActive && latestMotionCaptureModeRef.current.trackedLayers?.get(id)

            const pos = {
              x: capturedLayer?.currentPosition?.x ?? (selectedLayer.x || 0),
              y: capturedLayer?.currentPosition?.y ?? (selectedLayer.y || 0),
              cropX: capturedLayer?.cropX ?? (selectedLayer.cropX || 0),
              cropY: capturedLayer?.cropY ?? (selectedLayer.cropY || 0),
              cropWidth: capturedLayer?.cropWidth ?? (selectedLayer.cropWidth || selectedLayer.width || 100),
              cropHeight: capturedLayer?.cropHeight ?? (selectedLayer.cropHeight || selectedLayer.height || 100),
            }
            initialPositionsRef.current.set(id, pos)

            // Store offset from bounding box center for multi-select drag
            if (originalBounds) {
              dragOffsetsRef.current.set(id, {
                x: pos.x - originalBounds.centerX,
                y: pos.y - originalBounds.centerY,
              })
            }
          }
        })

        // Store original bounding box center for multi-select snapping
        if (originalBounds) {
          multiSelectBoundsCenterRef.current = {
            x: originalBounds.centerX,
            y: originalBounds.centerY
          }
        }

        pointerIsDownRef.current = true
        dragStartRef.current = { x: screenPos.x, y: screenPos.y }
        return
      }

      // Handle selection box clicks for single layer dragging
      if (clickedOnSelectionBox && !hasMultiSelect) {
        // Find the layer that this selection box belongs to
        // We need to find which layer's selection box was clicked
        let selectedLayerId = null
        for (const [layerId, layerObj] of layerObjectsMap) {
          if (currentSelectedLayerIds.includes(layerId)) {
            selectedLayerId = layerId
            break
          }
        }

        if (selectedLayerId && latestLayersRef.current[selectedLayerId]) {
          // Start drag for this single layer
          event.stopPropagation()
          event.stopImmediatePropagation?.()

          const screenPos = { x: event.data.global.x, y: event.data.global.y }
          const selectedLayer = latestLayersRef.current[selectedLayerId]

          // Store initial position
          initialPositionsRef.current.clear()
          dragOffsetsRef.current.clear()

          // Check for captured transform overrides during motion capture
          const capturedLayer = latestMotionCaptureModeRef.current?.isActive && latestMotionCaptureModeRef.current.trackedLayers?.get(selectedLayerId)

          const pos = {
            x: capturedLayer?.currentPosition?.x ?? (selectedLayer.x || 0),
            y: capturedLayer?.currentPosition?.y ?? (selectedLayer.y || 0),
            cropX: capturedLayer?.cropX ?? (selectedLayer.cropX || 0),
            cropY: capturedLayer?.cropY ?? (selectedLayer.cropY || 0),
            cropWidth: capturedLayer?.cropWidth ?? (selectedLayer.cropWidth || selectedLayer.width || 100),
            cropHeight: capturedLayer?.cropHeight ?? (selectedLayer.cropHeight || selectedLayer.height || 100),
          }
          initialPositionsRef.current.set(selectedLayerId, pos)

          pointerIsDownRef.current = true
          dragStartRef.current = { x: screenPos.x, y: screenPos.y, layerId: selectedLayerId }

          return
        }
      }

      if (!target || target === stageContainer || target === viewport || target === viewport.plugins.get('clamp')) {
        // Clicked on empty canvas - select the canvas
        dispatch(setSelectedCanvas(true))
        return
      }

      // Find layer ID from the clicked object
      let layerId = findLayerIdFromObject(target, layerObjectsMap, stageContainer, viewport)

      // [FIX] BACKGROUND PROTECTION: Never select background layers via pointer interaction
      if (layerId && latestLayersRef.current[layerId]?.type === 'background') {
        layerId = null
      }

      // CRITICAL: Verify the clicked layer belongs to the current scene
      if (layerId && latestLayersRef.current[layerId]?.sceneId !== currentSceneId) {
        layerId = null
      }

      // If we clicked on a selection box but have multi-select, we should still allow multi-drag
      // Check if clicking on a selection box while having multi-select - start drag with all selected layers
      if (clickedOnSelectionBox && hasMultiSelect && currentSelectedLayerIds.length > 0) {
        // When clicking on a selection box in multi-select mode, start drag with all selected layers
        // We'll treat this as clicking on one of the selected elements
        if (!layerId || !currentSelectedLayerIds.includes(layerId)) {
          // Use the first selected layer ID - we'll drag all of them anyway
          layerId = currentSelectedLayerIds[0]
        }
      }

      // If no layerId found from target, but we have a single selected layer, use that
      // This handles cases where the click event target isn't directly on the layer object
      if (!layerId && !hasMultiSelect && currentSelectedLayerIds.length === 1) {
        layerId = currentSelectedLayerIds[0]
      }

      if (!layerId) {
        // Only clear selection if we don't have multi-select or if we truly didn't click on anything
        if (!hasMultiSelect) {
          dispatch(clearLayerSelection())
        }
        return
      }

      // Handle double-click detection for text editing
      const layer = latestLayersRef.current[layerId]
      if (layer && layer.type === LAYER_TYPES.TEXT) {
        const now = Date.now()
        const existingTimeout = doubleClickTimeoutsRef.current.get(layerId)
        const isDoubleClick = existingTimeout && (now - existingTimeout.timestamp) < 300


        if (existingTimeout) {
          clearTimeout(existingTimeout.timer)
          doubleClickTimeoutsRef.current.delete(layerId)
        }

        if (!isDoubleClick) {
          // Single click - set timeout for potential double-click
          const timer = setTimeout(() => {
            doubleClickTimeoutsRef.current.delete(layerId)
          }, 300)
          doubleClickTimeoutsRef.current.set(layerId, {
            timestamp: now,
            timer
          })
        } else {
          // Double-click detected - start text editing
          // CRITICAL: Prevent editing during motion capture mode
          if (onStartTextEditing && !latestMotionCaptureModeRef.current?.isActive) {
            onStartTextEditing(layerId)
          }
          // Don't proceed with normal selection logic for double-clicks
          return
        }
      }

      // Check if the clicked layer is part of the multi-select
      // Also treat clicks on selection boxes in multi-select mode as clicking on a selected element
      const clickedLayerInMultiSelect = hasMultiSelect && (currentSelectedLayerIds.includes(layerId) || clickedOnSelectionBox)


      // CRITICAL: If we have multi-select active, preserve it unless clicking on an unselected element
      // If clicking on a selected element or selection box, keep multi-select and start drag
      if (hasMultiSelect) {
        // If clicking on a selected element or selection box, preserve multi-select
        if (clickedLayerInMultiSelect) {


          // Filter out background layers from multi-select operations
          const filteredSelectedIds = filterBgLayers(currentSelectedLayerIds, latestLayersRef.current)
          if (filteredSelectedIds.length !== currentSelectedLayerIds.length) {
            // Background layers were in selection - update selection to exclude them
            dispatch(setSelectedLayers(filteredSelectedIds))
            // Update the ref for immediate use
            selectedLayerIdsRef.current = filteredSelectedIds
            currentSelectedLayerIds = filteredSelectedIds
          }

          // If no non-background layers are selected, don't proceed with multi-drag
          if (currentSelectedLayerIds.length === 0) {
            return
          }

          // Keep the existing selection (don't dispatch setSelectedLayer)
          // Prepare for multi-drag immediately
          if (activeTool === 'select' || activeTool === 'move') {
            const layer = layers[layerId]
            if (!layer) return

            // Don't allow dragging background layers even in multi-select
            if (layer.type === 'background') {
              return
            }

            // Get screen position
            const screenPos = { x: event.data.global.x, y: event.data.global.y }

            // Store initial positions for all selected layers (background layers already filtered out)
            initialPositionsRef.current.clear()
            currentSelectedLayerIds.forEach((id) => {
              const selectedLayer = latestLayersRef.current[id]
              if (selectedLayer) {
                // Check for captured transform overrides during motion capture
                const capturedLayer = motionCaptureMode?.isActive && motionCaptureMode.trackedLayers?.get(id)

                initialPositionsRef.current.set(id, {
                  x: capturedLayer?.currentPosition?.x ?? (selectedLayer.x || 0),
                  y: capturedLayer?.currentPosition?.y ?? (selectedLayer.y || 0),
                  cropX: capturedLayer?.cropX ?? (selectedLayer.cropX || 0),
                  cropY: capturedLayer?.cropY ?? (selectedLayer.cropY || 0),
                  cropWidth: capturedLayer?.cropWidth ?? (selectedLayer.cropWidth || selectedLayer.width || 100),
                  cropHeight: capturedLayer?.cropHeight ?? (selectedLayer.cropHeight || selectedLayer.height || 100),
                })
              }
            })

            // Store original bounding box center for multi-select snapping
            // Cache bounds for the entire drag operation to avoid recalculation
            let bounds = dragMultiSelectBoundsCacheRef.current.bounds
            const cacheKey = [...currentSelectedLayerIds].sort().join(',')
            if (!bounds || dragMultiSelectBoundsCacheRef.current.selectedIds !== cacheKey) {
              bounds = computeCombinedLayerBounds(currentSelectedLayerIds, latestLayersRef.current, layerObjectsMap, latestMotionCaptureModeRef.current)
              dragMultiSelectBoundsCacheRef.current = {
                bounds,
                selectedIds: cacheKey
              }
            }
            if (bounds) {
              multiSelectBoundsCenterRef.current = {
                x: bounds.centerX,
                y: bounds.centerY
              }
            }

            pointerIsDownRef.current = true
            dragStartRef.current = { x: screenPos.x, y: screenPos.y }


            return // Don't continue with single-select logic
          }
          // If not select/move tool, still preserve selection but don't start drag
          return
        } else {
          // Clicking on an unselected element while multi-select is active
          // Change selection to just this element (user wants to select different element)
          // CRITICAL FIX for Arrow Visibility: Optimistically update the ref so immediate drag sees correct state
          selectedLayerIdsRef.current = [layerId]
          dispatch(setSelectedLayer(layerId))
          // Continue with single-select drag logic below
        }
      } else {
        // No multi-select - normal single-select behavior



        // Set selection (this will clear multi-select if it exists)
        // Only cancel text editing if we're selecting a different layer than what's currently being edited
        // We check this by comparing with the current editing state
        dispatch(setSelectedLayer(layerId))
      }

      // Prepare for drag if using select tool
      if (activeTool === 'select' || activeTool === 'move') {
        const currentLayers = latestLayersRef.current
        const layer = currentLayers[layerId]
        if (!layer) return

        // Don't allow dragging or resizing background layers
        if (layer.type === 'background') {
          return
        }

        // Get screen position
        const screenPos = { x: event.data.global.x, y: event.data.global.y }

        if (hasMultiSelect) {
          // Multi-select drag: store initial positions and offsets for all selected layers (except background layers)
          initialPositionsRef.current.clear()
          dragOffsetsRef.current.clear()

          // Calculate bounding box center first
          const currentLayers = latestLayersRef.current
          const originalBounds = computeCombinedLayerBounds(currentSelectedLayerIds, currentLayers, layerObjectsMap)

          currentSelectedLayerIds.forEach((id) => {
            const selectedLayer = currentLayers[id]
            if (selectedLayer && selectedLayer.type !== 'background') {
              // Check for captured transform overrides during motion capture
              const capturedLayer = motionCaptureMode?.isActive && motionCaptureMode.trackedLayers?.get(id)

              const pos = {
                x: capturedLayer?.currentPosition?.x ?? (selectedLayer.x || 0),
                y: capturedLayer?.currentPosition?.y ?? (selectedLayer.y || 0),
              }
              initialPositionsRef.current.set(id, pos)

              // Store offset from bounding box center for multi-select drag
              if (originalBounds) {
                dragOffsetsRef.current.set(id, {
                  x: pos.x - originalBounds.centerX,
                  y: pos.y - originalBounds.centerY,
                })
              }
            }
          })

          // Store original bounding box center for multi-select snapping
          // Cache bounds for the entire drag operation
          let multiSelectBounds = dragMultiSelectBoundsCacheRef.current.bounds
          const cacheKey = [...currentSelectedLayerIds].sort().join(',')
          if (!multiSelectBounds || dragMultiSelectBoundsCacheRef.current.selectedIds !== cacheKey) {
            multiSelectBounds = computeCombinedLayerBounds(currentSelectedLayerIds, latestLayersRef.current, layerObjectsMap)
            dragMultiSelectBoundsCacheRef.current = {
              bounds: multiSelectBounds,
              selectedIds: cacheKey
            }
          }
          if (multiSelectBounds) {
            multiSelectBoundsCenterRef.current = {
              x: multiSelectBounds.centerX,
              y: multiSelectBounds.centerY
            }
          }
        } else {
          // Single select: use existing logic

          initialPositionsRef.current.clear()

          // Check for captured transform overrides during motion capture
          const capturedLayer = motionCaptureMode?.isActive && motionCaptureMode.trackedLayers?.get(layerId)

          const layerObject = layerObjectsMap.get(layerId)
          initialPositionsRef.current.set(layerId, {
            x: capturedLayer?.currentPosition?.x ?? (layer.x || 0),
            y: capturedLayer?.currentPosition?.y ?? (layer.y || 0),
            cropX: capturedLayer?.cropX ?? (layer.cropX || 0),
            cropY: capturedLayer?.cropY ?? (layer.cropY || 0),
            cropWidth: capturedLayer?.cropWidth ?? (layer.cropWidth || layer.width || 100),
            cropHeight: capturedLayer?.cropHeight ?? (layer.cropHeight || layer.height || 100),
            mediaWidth: capturedLayer?.mediaWidth ?? layer.mediaWidth ?? layerObject?._mediaWidth ?? layer.width ?? 100,
            mediaHeight: capturedLayer?.mediaHeight ?? layer.mediaHeight ?? layerObject?._mediaHeight ?? layer.height ?? 100,
          })
        }

        pointerIsDownRef.current = true
        dragStartRef.current = { x: screenPos.x, y: screenPos.y, layerId: layerId, timestamp: Date.now() }
      }
    }

    // =========================================================================
    // GLOBAL POINTER MOVE HANDLER - Handles drag movement and snapping
    // =========================================================================

    const handleGlobalPointerMove = (event) => {
      const motionCapture = latestMotionCaptureModeRef.current

      // Performance monitoring: track frame drops and pointer move frequency
      const currentTime = performance.now()
      const timeSinceLastFrame = currentTime - performanceStatsRef.current.lastFrameTime
      if (timeSinceLastFrame > 20) { // More than ~50fps indicates a frame drop
        performanceStatsRef.current.frameDropCount++
      }
      performanceStatsRef.current.lastFrameTime = currentTime
      performanceStatsRef.current.pointerMoveCount++

      // Get global coordinates from event
      let globalX, globalY
      if (event.global) {
        globalX = event.global.x
        globalY = event.global.y
      } else if (event.data?.global) {
        globalX = event.data.global.x
        globalY = event.data.global.y
      } else {
        return
      }

      // Use screen coordinates directly
      const screenPos = { x: globalX, y: globalY }

      // Check if we should start dragging (pointer is down but dragging hasn't started yet)
      // CRITICAL FIX: Do not start tracking drag if we are resizing or rotating
      if (!dragStateAPI.isDragging() && !dragStateAPI.isResizing() && !dragStateAPI.isRotating() && pointerIsDownRef.current && dragStartRef.current) {
        // Check if mouse has moved past drag threshold
        // PERFORMANCE OPTIMIZATION: Use squared distance to avoid Math.sqrt
        const deltaX = screenPos.x - dragStartRef.current.x
        const deltaY = screenPos.y - dragStartRef.current.y
        const distSq = deltaX * deltaX + deltaY * deltaY
        const { scale: viewportScale } = getViewportScale()
        const dragThreshold = Math.max(1, 2 / viewportScale)
        if (distSq < dragThreshold * dragThreshold) {
          return // Not enough movement yet, don't start dragging
        }
        // Start dragging!
        dragStateAPI.setDragState(true, dragStartRef.current.layerId)

        // Show drag hover box when dragging starts
        const dragStartLayerId = dragStartRef.current.layerId
        const currentSelectedLayerIds = selectedLayerIdsRef.current
        const hasMultiSelect = currentSelectedLayerIds && currentSelectedLayerIds.length > 1
        if (dragStartLayerId) {
          const layer = layers[dragStartLayerId]
          const layerObject = layerObjectsMap.get(dragStartLayerId)
          if (layer && layerObject) {
            const { anchorX, anchorY } = resolveAnchors(layer, layerObject)

            // CRITICAL FIX: Capture UNSCALED dimensions for accurate hover box
            // For media elements, we use the current crop dimensions as the logical base
            let width, height
            const isMedia = layer.type === LAYER_TYPES.IMAGE || layer.type === LAYER_TYPES.VIDEO
            const capturedLayer = motionCaptureMode?.isActive && motionCaptureMode.trackedLayers?.get(dragStartLayerId)

            if (layerObject instanceof PIXI.Text) {
              const dims = calculateTextDimensions(layerObject, layer)
              width = dims.width
              height = dims.height
            } else if (isMedia) {
              // CROP SYSTEM: Use cropped dimensions for media layers
              width = capturedLayer?.cropWidth ?? layer.cropWidth ?? layer.width ?? 100
              height = capturedLayer?.cropHeight ?? layer.cropHeight ?? layer.height ?? 100
            } else {
              width = capturedLayer?.width ?? layer.width ?? 100
              height = capturedLayer?.height ?? layer.height ?? 100
            }

            // Ensure drag hover box is properly parented (optimization: do this once at drag start)
            let dragHoverBox = dragHoverBoxRef.current
            if (!dragHoverBox || dragHoverBox.destroyed) {
              dragHoverBox = new PIXI.Container()
              dragHoverBox.label = 'drag-hover-box'
              dragHoverBox.eventMode = 'none'
              dragHoverBox.zIndex = 9998 // Slightly below drag box
              dragHoverBoxRef.current = dragHoverBox
            }
            if (!dragHoverBox.parent && layersContainer) {
              layersContainer.addChild(dragHoverBox) // Add to layersContainer to avoid clipping
            }

            // Store dimensions for use during drag move (dimensions don't change during drag)
            const rotationDegrees = capturedLayer?.rotation ?? (layer.rotation || 0)
            const scaleX = capturedLayer?.scaleX ?? (layer.scaleX || 1)
            const scaleY = capturedLayer?.scaleY ?? (layer.scaleY || 1)
            const currentX = capturedLayer?.currentPosition?.x ?? (layer.x || 0)
            const currentY = capturedLayer?.currentPosition?.y ?? (layer.y || 0)

            dragHoverBoxDimensionsRef.current = {
              width,
              height,
              anchorX,
              anchorY,
              scaleX,
              scaleY,
              rotation: rotationDegrees,
              rotationRadians: rotationDegrees * Math.PI / 180 // Pre-calculate radians to avoid repeated conversions
            }

            // CRITICAL FIX: Pass correct anchors and zoomScale to updateDragHoverBox for proper alignment
            const { dragScale } = getViewportScale()
            updateDragHoverBox(currentX, currentY, width, height, dragHoverBoxDimensionsRef.current.rotationRadians, anchorX, anchorY, scaleX, scaleY, dragScale)
          }
        }

        // Motion capture mode: initialize motion arrow base position
        // Motion capture mode: initialize motion arrow base position
        if (motionCaptureMode?.isActive) {
          // Initialize for ALL selected layers in multi-select, or just the dragged one in single-select
          // But actually, we only need to init for layers that are being DRAGGED.
          // In multi-select, all selected layers calculate their offsets, so let's init arrows for all of them.
          const layersToInit = hasMultiSelect ? currentSelectedLayerIds : (dragStartLayerId ? [dragStartLayerId] : [])

          layersToInit.forEach(layerId => {
            const layer = layers[layerId]
            const layerObject = layerObjectsMap.get(layerId)
            if (layer && layerObject) {
              const capturedLayer = motionCaptureMode.trackedLayers?.get(layerId)

              // Base center at the START of this specific step
              const startX = capturedLayer?.initialTransform?.x ?? (layer.x || 0)
              const startY = capturedLayer?.initialTransform?.y ?? (layer.y || 0)
              const baseCenter = getLayerCenter(layer, layerObject, startX, startY)

              // Store base center in Map
              motionArrowBasesRef.current.set(layerId, baseCenter)
              createMotionArrow(layerId, layersContainer)

              // Current center
              const currentX = capturedLayer?.currentPosition?.x ?? (layer.x || 0)
              const currentY = capturedLayer?.currentPosition?.y ?? (layer.y || 0)
              const currentCenter = getLayerCenter(layer, layerObject, currentX, currentY)

              updateMotionArrowVisibility(layerId, true)
            }
          })
        }

        // PERFORMANCE OPTIMIZATION: Faster move action check
        let hasMoveAction = false
        if (!motionCaptureMode?.isActive) {
          const sceneMotionFlow = sceneMotionFlows?.[currentSceneId]
          if (sceneMotionFlow?.steps?.length > 0) {
            hasMoveAction = sceneMotionFlow.steps.some(step =>
              step.layerActions?.[dragStartLayerId]?.some(a => a.type === 'move')
            )
          }
        }

        if (!motionCaptureMode?.isActive && !hasMoveAction) {
          hideMotionArrow()
        }

        // Immediately pause viewport drag to prevent interference
        pauseViewportDragPlugin(viewport)

        // Reset snapping throttle cache when starting drag
        snapThrottlingRef.current.lastSnapPosition = null
        snapThrottlingRef.current.lastSnapTime = 0
      }

      // If we're not actually dragging yet, return
      if (!dragStateAPI.isDragging() || (activeTool !== 'select' && activeTool !== 'move')) {
        return
      }

      // CRITICAL FIX: Prevent moving/snapping logic if interactively resizing or rotating
      // This prevents unwanted guidelines from appearing while cropping
      if (dragStateAPI.isResizing() || dragStateAPI.isRotating()) {
        return
      }
      // Check if we have multiple layers selected (use ref for latest value)
      // CRITICAL FIX: Filter by currentSceneId to prevent teleporting layers from other scenes
      const currentSelectedLayerIds = (selectedLayerIdsRef.current || [])
        .filter(id => latestLayersRef.current[id]?.sceneId === currentSceneId)
      const isMultiSelectDrag = currentSelectedLayerIds && currentSelectedLayerIds.length > 1 && dragOffsetsRef.current.size > 0

      // Ensure dragStartRef has layerId - should be set by now
      if (!dragStartRef.current.layerId) {
        // Warning: dragStartRef still missing layerId
      }

      if (isMultiSelectDrag) {
        // Optimized multi-select drag: simplified snapping for better performance
        // Get the original bounding box center (stored at drag start)
        let originalBoundsCenter = multiSelectBoundsCenterRef.current

        if (!originalBoundsCenter && dragStartRef.current) {
          // Fallback: calculate it now if not stored (shouldn't happen, but safety net)
          const currentBounds = getCachedCombinedLayerBounds(currentSelectedLayerIds, layers, layerObjectsMap)
          if (currentBounds) {
            // Calculate original center from current center minus drag delta
            const dragDeltaX = screenPos.x - dragStartRef.current.x
            const dragDeltaY = screenPos.y - dragStartRef.current.y
            originalBoundsCenter = {
              x: currentBounds.centerX - dragDeltaX,
              y: currentBounds.centerY - dragDeltaY
            }
            multiSelectBoundsCenterRef.current = originalBoundsCenter
          }
        }

        if (!originalBoundsCenter) {
          // Can't calculate bounds, skip snapping
          return
        }

        // Calculate the new bounding box center based on mouse movement
        const { dragScale } = getViewportScale()
        const dragDeltaX = (screenPos.x - dragStartRef.current.x) * dragScale
        const dragDeltaY = (screenPos.y - dragStartRef.current.y) * dragScale
        const newBoundsCenterX = originalBoundsCenter.x + dragDeltaX
        const newBoundsCenterY = originalBoundsCenter.y + dragDeltaY

        // Get current bounding box dimensions for snapping calculations
        // Use cached bounds from drag start for better performance
        const currentBounds = dragMultiSelectBoundsCacheRef.current.bounds

        // Simplified snapping for multi-select: only canvas center and safe zones
        let snappedCenterX = newBoundsCenterX
        let snappedCenterY = newBoundsCenterY
        let centerSnapResult = { x: snappedCenterX, y: snappedCenterY, showVGuide: false, showHGuide: false, alignmentGuides: [] }

        const currentTime = performance.now()
        const snapThrottle = snapThrottlingRef.current
        let shouldRunSnapping = true

        // Check if we should throttle snapping calculations for multi-select
        if (snapThrottle.isSnappingEnabled && snapThrottle.lastSnapPosition &&
          (currentTime - snapThrottle.lastSnapTime) < snapThrottle.snapInterval) {
          // Use cached snap result if possible (flicker-free throttling)
          const originalX = newBoundsCenterX
          const originalY = newBoundsCenterY
          const lastSnap = snapThrottle.lastSnapPosition

          // Calculate current snap status for each axis
          const wasSnappedX = Math.round(lastSnap.snappedX * 100) !== Math.round(lastSnap.originalX * 100)
          const wasSnappedY = Math.round(lastSnap.snappedY * 100) !== Math.round(lastSnap.originalY * 100)

          // Threshold for "stickiness" during throttled frames - larger than snapping threshold to prevent fighting
          const stickThreshold = 25

          // Handle X axis stability
          if (wasSnappedX && Math.abs(originalX - lastSnap.snappedX) < stickThreshold) {
            snappedCenterX = lastSnap.snappedX
          } else {
            snappedCenterX = lastSnap.snappedX + (originalX - lastSnap.originalX)
          }

          // Handle Y axis stability
          if (wasSnappedY && Math.abs(originalY - lastSnap.snappedY) < stickThreshold) {
            snappedCenterY = lastSnap.snappedY
          } else {
            snappedCenterY = lastSnap.snappedY + (originalY - lastSnap.originalY)
          }

          centerSnapResult = lastSnap.centerSnapResult || { showVGuide: false, showHGuide: false, alignmentGuides: [] }
          shouldRunSnapping = false
        }

        if (worldWidth && worldHeight && currentBounds && shouldRunSnapping) {
          // Only run canvas center snapping for multi-select (much cheaper than object-to-object)
          centerSnapResult = applyCenterSnapping({
            x: newBoundsCenterX,
            y: newBoundsCenterY,
            width: currentBounds.width,
            height: currentBounds.height,
            canvasWidth: worldWidth,
            canvasHeight: worldHeight,
            threshold: 10
          })

          // Apply canvas center position snapping for multi-select
          if (centerSnapResult.x !== newBoundsCenterX || centerSnapResult.y !== newBoundsCenterY) {
            snappedCenterX = centerSnapResult.x
            snappedCenterY = centerSnapResult.y
          }

          // Cache the simplified result for throttling
          snapThrottle.lastSnapTime = currentTime
          snapThrottle.lastSnapPosition = {
            originalX: newBoundsCenterX,
            originalY: newBoundsCenterY,
            snappedX: snappedCenterX,
            snappedY: snappedCenterY,
            centerSnapResult: {
              showVGuide: centerSnapResult.showVGuide,
              showHGuide: centerSnapResult.showHGuide,
              alignmentGuides: centerSnapResult.alignmentGuides
            },
            spacingResult: { spacingGuides: [] }
          }
        } else if (!shouldRunSnapping) {
          // When using throttled results, ensure spacing guides are hidden for multi-select
          // (Alignment guides are handled below by updateAlignmentGuides)
          hideSpacingGuides()
        } else {
          hideSpacingGuides()
          hideAlignmentGuides()
        }

        // Update layers and selection box
        const deltaX = snappedCenterX - originalBoundsCenter.x
        const deltaY = snappedCenterY - originalBoundsCenter.y

        // SMOOTH FEEDBACK: Update multi-selection box position directly in PIXI
        if (multiSelectionAPI && multiSelectionAPI.updateBoxPosition) {
          const currentBoundsForAPI = dragMultiSelectBoundsCacheRef.current.bounds
          if (currentBoundsForAPI) {
            multiSelectionAPI.updateBoxPosition(
              currentBoundsForAPI.x + deltaX,
              currentBoundsForAPI.y + deltaY
            )
          }
        }

        // Update guide lines (only center guides for multi-select)
        // Moved OUTSIDE shouldRunSnapping to ensure consistency during throttled frames
        const newGuideState = { showVGuide: centerSnapResult.showVGuide, showHGuide: centerSnapResult.showHGuide }
        const currentGuideState = currentGuideStateRef.current

        if (newGuideState.showVGuide !== currentGuideState.showVGuide ||
          newGuideState.showHGuide !== currentGuideState.showHGuide) {
          if (stageContainer) {
            if (newGuideState.showVGuide) {
              if (!vGuideRef.current) {
                vGuideRef.current = createGuideLine(true, layersContainer)
              }
              vGuideRef.current.visible = true
              updateGuideLine(vGuideRef.current, true, worldWidth, worldHeight, viewport, true)
            } else if (vGuideRef.current) {
              vGuideRef.current.visible = false
            }

            if (newGuideState.showHGuide) {
              if (!hGuideRef.current) {
                hGuideRef.current = createGuideLine(false, layersContainer)
              }
              hGuideRef.current.visible = true
              updateGuideLine(hGuideRef.current, false, worldWidth, worldHeight, viewport, true)
            } else if (hGuideRef.current) {
              hGuideRef.current.visible = false
            }
            currentGuideStateRef.current = newGuideState
          }
        }

        // Update alignment guide lines (only center guides)
        if (layersContainer && centerSnapResult.alignmentGuides && centerSnapResult.alignmentGuides.length > 0) {
          debouncedUpdateAlignmentGuides(centerSnapResult.alignmentGuides, layersContainer, worldWidth, worldHeight, viewport)
        } else {
          hideAlignmentGuides()
        }

        // Calculate the snap offset
        const snapOffsetX = snappedCenterX - newBoundsCenterX
        const snapOffsetY = snappedCenterY - newBoundsCenterY

        // Now apply the snap offset to all selected layers efficiently
        currentSelectedLayerIds.forEach((selectedLayerId) => {
          const layer = latestLayersRef.current[selectedLayerId]
          if (!layer) return

          const initialPos = initialPositionsRef.current.get(selectedLayerId)
          if (!initialPos) return

          // Calculate new position with snap offset applied
          let newX = initialPos.x + (screenPos.x - dragStartRef.current.x) * dragScale + snapOffsetX
          let newY = initialPos.y + (screenPos.y - dragStartRef.current.y) * dragScale + snapOffsetY

          // Update visual position immediately
          const layerObject = layerObjectsMap.get(selectedLayerId)
          if (layerObject && !layerObject.destroyed) {
            const targetObject = layerObject._cachedSprite || layerObject

            // Store selection box position
            layerObject._selectionBoxX = newX
            layerObject._selectionBoxY = newY
            if (layerObject._cachedSprite && !layerObject._cachedSprite.destroyed) {
              layerObject._cachedSprite._selectionBoxX = newX
              layerObject._cachedSprite._selectionBoxY = newY
            }

            targetObject.x = newX
            targetObject.y = newY
          }

          // Handle motion capture mode vs normal drag mode
          if (motionCaptureMode?.isActive) {
            // Motion capture mode: Don't dispatch to Redux, call callback instead
            // Use existing captured values for rotation/scale to prevent overwriting with old Redux state
            const capturedLayer = motionCaptureMode.trackedLayers?.get(selectedLayerId)

            // [CONTROL POINTS FIX] Preserve existing control points when updating position in multi-move
            // This prevents control points from being lost when multiple layers are moved together
            // Control points are relative to initialTransform, so they remain valid after position updates
            const existingControlPoints = capturedLayer?.controlPoints
            const hasControlPoints = existingControlPoints && Array.isArray(existingControlPoints) && existingControlPoints.length > 0

            // [PERFORMANCE] Only include controlPoints in update if they exist (avoid passing undefined)
            const updateData = {
              layerId: selectedLayerId,
              x: newX,
              y: newY,
              // deltaX/Y are now calculated by MotionPanel relative to session start
              rotation: capturedLayer?.rotation ?? (layer.rotation || 0),
              scaleX: capturedLayer?.scaleX ?? (layer.scaleX || 1),
              scaleY: capturedLayer?.scaleY ?? (layer.scaleY || 1),
              // Preserve crop state
              cropX: capturedLayer?.cropX ?? (layer.cropX || 0),
              cropY: capturedLayer?.cropY ?? (layer.cropY || 0),
              cropWidth: capturedLayer?.cropWidth ?? (layer.cropWidth || layer.width || 100),
              cropHeight: capturedLayer?.cropHeight ?? (layer.cropHeight || layer.height || 100),
              mediaWidth: capturedLayer?.mediaWidth ?? layer.mediaWidth,
              mediaHeight: capturedLayer?.mediaHeight ?? layer.mediaHeight,
              interactionType: 'move'
            }

            // [CRITICAL] Only include controlPoints if they exist - this preserves them without overwriting
            if (hasControlPoints) {
              updateData.controlPoints = existingControlPoints
            }

            motionCaptureMode.onPositionUpdate(updateData)

            // [OPTIMIZATION] Synchronously update the live ref so the Ticker sees it THIS frame, 
            // without waiting for React to re-render MotionPanel and pass down the new props.
            if (liveMotionCaptureRef.current && liveMotionCaptureRef.current.trackedLayers) {
              const liveLayer = liveMotionCaptureRef.current.trackedLayers.get(selectedLayerId)
              // Determine if we need to clone to avoid mutating read-only props (safe if we just update internal objects?)
              // Ideally we should be careful, but for a live perf ref, partial mutation of the *Map value* is acceptable 
              // as long as we don't mutate the Map itself if it's from props.
              // Actually, `capturedLayer` comes from `motionCaptureMode` which ultimately comes from `MotionPanel` state.
              // It's safer to clone the entry if we want to modify it, but `trackedLayers` is a Map.

              // We will update a "shadow" property or just trust that onPositionUpdate will eventually trigger the React update.
              // But for the ticker, we need the value NOW.
              if (liveLayer) {
                // We can't easily mutate readonly state from props.
                // Instead, we can set a flag or value on `liveMotionCaptureRef` itself if we structure it to handle this?
                // Or simpler: Just update the properties on the existing object if it's not frozen.
                // Most React state isn't deep-frozen in dev unless strictly enforced.
                liveLayer.currentPosition = { x: newX, y: newY }
              }
            }

            // [MULTI-LAYER FIX] Recalculate anchor positions after multi-move to ensure they're up-to-date
            // This is critical for proper control point calculation when curving paths
            if (motionCaptureMode?.isActive && motionCaptureMode.stepId) {
              const anchorKey = `${selectedLayerId}-${motionCaptureMode.stepId}`
              // Only update if we don't already have a valid anchor for this layer+step
              if (!stepAnchorPositionsRef.current.has(anchorKey)) {
                const engine = getGlobalMotionEngine()
                const sceneStartTime = sceneMotionFlows[currentSceneId]?.startTime || 0
                const step = sceneMotionFlows[currentSceneId]?.steps?.find(s => s.id === motionCaptureMode.stepId)
                if (step) {
                  const startState = engine.predictLayerStateAtTime(selectedLayerId, currentSceneId, step.startTime || sceneStartTime)
                  if (startState && startState.x !== undefined && startState.y !== undefined) {
                    stepAnchorPositionsRef.current.set(anchorKey, { x: startState.x, y: startState.y })
                  }
                }
              }
            }
          } else {
            // Store pending update for throttled Redux dispatch
            pendingDragUpdatesRef.current.set(selectedLayerId, { x: newX, y: newY })
          }
        })

        // LIVE PERFORMANCE FIX: Sync all motion arrows and handles during group drag
        if (motionCaptureMode?.isActive) {
          syncArrows()
        }

        // Only throttle Redux updates if not in motion capture mode
        if (!motionCapture?.isActive && !dragUpdateFrameRef.current) {
          dragUpdateFrameRef.current = requestAnimationFrame(() => {
            // Dispatch all pending updates
            pendingDragUpdatesRef.current.forEach((updates, layerId) => {
              dispatch(updateLayer({ id: layerId, ...updates }))
            })
            pendingDragUpdatesRef.current.clear()
            dragUpdateFrameRef.current = null
          })
        }
        return
      }

      // Single select drag (existing logic)
      const selectedLayerId = dragStateAPI.getDraggingLayerId()

      if (!selectedLayerId) {
        dragStateAPI.setDragState(false)
        return
      }

      const layer = latestLayersRef.current[selectedLayerId]
      if (!layer) {
        dragStateAPI.setDragState(false)
        return
      }

      // Calculate new position - scale by inverse zoom level for proper drag speed
      const { dragScale } = getViewportScale()

      const initialPos = initialPositionsRef.current.get(selectedLayerId)
      let newX = initialPos ? initialPos.x + (screenPos.x - dragStartRef.current.x) * dragScale : screenPos.x
      let newY = initialPos ? initialPos.y + (screenPos.y - dragStartRef.current.y) * dragScale : screenPos.y

      const layerObject = layerObjectsMap.get(selectedLayerId)

      // Apply snapping (center + object alignment + spacing) with throttling for performance
      if (layer && worldWidth && worldHeight) {
        const { anchorX, anchorY } = resolveAnchors(layer, layerObject)

        const originalX = newX
        const originalY = newY
        const currentTime = performance.now()
        const snapThrottle = snapThrottlingRef.current

        let snapResult
        let shouldRunSnapping = true

        // Frame-based throttling: only run snapping every N frames
        snapThrottle.frameCounter++
        const shouldThrottleByFrame = snapThrottle.frameCounter % snapThrottle.framesPerSnap !== 0

        // Check if we should throttle snapping calculations
        if (shouldThrottleByFrame && snapThrottle.lastSnapPosition) {
          // Use cached snap result with stability (flicker-free frame throttling)
          const lastSnap = snapThrottle.lastSnapPosition
          const wasSnappedX = Math.round(lastSnap.snappedX * 100) !== Math.round(lastSnap.originalX * 100)
          const wasSnappedY = Math.round(lastSnap.snappedY * 100) !== Math.round(lastSnap.originalY * 100)

          // Threshold for "stickiness" during throttled frames - larger than snapping threshold to prevent fighting
          const stickThreshold = 25

          let stableX, stableY
          if (wasSnappedX && Math.abs(originalX - lastSnap.snappedX) < stickThreshold) {
            stableX = lastSnap.snappedX
          } else {
            stableX = lastSnap.snappedX + (originalX - lastSnap.originalX)
          }

          if (wasSnappedY && Math.abs(originalY - lastSnap.snappedY) < stickThreshold) {
            stableY = lastSnap.snappedY
          } else {
            stableY = lastSnap.snappedY + (originalY - lastSnap.originalY)
          }

          snapResult = {
            x: stableX,
            y: stableY,
            alignmentGuides: lastSnap.alignmentGuides,
            spacingGuides: lastSnap.spacingGuides,
            showVGuide: lastSnap.showVGuide,
            showHGuide: lastSnap.showHGuide
          }
          shouldRunSnapping = false
        } else if (snapThrottle.isSnappingEnabled && snapThrottle.lastSnapPosition &&
          (currentTime - snapThrottle.lastSnapTime) < snapThrottle.snapInterval) {
          // Use cached snap result with stability (flicker-free time throttling)
          const lastSnap = snapThrottle.lastSnapPosition
          const wasSnappedX = Math.round(lastSnap.snappedX * 100) !== Math.round(lastSnap.originalX * 100)
          const wasSnappedY = Math.round(lastSnap.snappedY * 100) !== Math.round(lastSnap.originalY * 100)

          // Threshold for "stickiness" during throttled frames - larger than snapping threshold to prevent fighting
          const stickThreshold = 25

          let stableX, stableY
          if (wasSnappedX && Math.abs(originalX - lastSnap.snappedX) < stickThreshold) {
            stableX = lastSnap.snappedX
          } else {
            stableX = lastSnap.snappedX + (originalX - lastSnap.originalX)
          }

          if (wasSnappedY && Math.abs(originalY - lastSnap.snappedY) < stickThreshold) {
            stableY = lastSnap.snappedY
          } else {
            stableY = lastSnap.snappedY + (originalY - lastSnap.originalY)
          }

          snapResult = {
            x: stableX,
            y: stableY,
            alignmentGuides: lastSnap.alignmentGuides,
            spacingGuides: lastSnap.spacingGuides,
            showVGuide: lastSnap.showVGuide,
            showHGuide: lastSnap.showHGuide
          }
          shouldRunSnapping = false
        }

        const capturedLayer = motionCapture?.isActive && motionCapture.trackedLayers?.get(selectedLayerId)
        const currentWidth = capturedLayer?.width ?? layer.width ?? 100
        const currentHeight = capturedLayer?.height ?? layer.height ?? 100

        if (shouldRunSnapping) {
          // Run full snapping calculation with spatial filtering
          const snappingStartTime = performance.now()
          const scaleX = capturedLayer?.scaleX ?? (layer.scaleX || 1)
          const scaleY = capturedLayer?.scaleY ?? (layer.scaleY || 1)
          const rotationDegrees = capturedLayer?.rotation ?? (layer.rotation || 0)
          const draggedBounds = getRotatedAABB(
            originalX,
            originalY,
            currentWidth,
            currentHeight,
            scaleX,
            scaleY,
            rotationDegrees,
            anchorX,
            anchorY
          )
          const otherObjects = getCachedOtherObjectsForAlignment([selectedLayerId], latestLayersRef.current, layerObjectsMap, draggedBounds, true)
          snapResult = applySnappingToPosition(originalX, originalY, currentWidth, currentHeight, anchorX, anchorY, scaleX, scaleY, otherObjects, [selectedLayerId], draggedBounds)

          // Track performance
          const snappingTime = performance.now() - snappingStartTime
          performanceStatsRef.current.snappingCalculationTime.push(snappingTime)
          if (performanceStatsRef.current.snappingCalculationTime.length > 100) {
            performanceStatsRef.current.snappingCalculationTime.shift() // Keep only last 100 measurements
          }

          // Cache the result for throttling
          snapThrottle.lastSnapTime = currentTime
          snapThrottle.lastSnapPosition = {
            originalX,
            originalY,
            snappedX: snapResult.x,
            snappedY: snapResult.y,
            alignmentGuides: snapResult.alignmentGuides,
            spacingGuides: snapResult.spacingGuides,
            showVGuide: snapResult.showVGuide,
            showHGuide: snapResult.showHGuide
          }
        }

        newX = snapResult.x
        newY = snapResult.y

        // Update guides - Moved OUTSIDE shouldRunSnapping to ensure consistency during throttled frames
        if (snapResult.spacingGuides && snapResult.spacingGuides.length > 0) {
          if (layersContainer) {
            debouncedUpdateSpacingGuides(snapResult.spacingGuides, layersContainer, viewport)
          }
        } else {
          hideSpacingGuides()
        }

        // Update center guide lines
        const newGuideState = { showVGuide: snapResult.showVGuide, showHGuide: snapResult.showHGuide }
        const currentGuideState = currentGuideStateRef.current

        if (newGuideState.showVGuide !== currentGuideState.showVGuide || newGuideState.showHGuide !== currentGuideState.showHGuide) {
          if (stageContainer) {
            // Handle vertical guide
            if (newGuideState.showVGuide) {
              if (!vGuideRef.current) {
                vGuideRef.current = createGuideLine(true, layersContainer)
                updateGuideLine(vGuideRef.current, true, worldWidth, worldHeight, viewport, true)
              } else if (!vGuideRef.current.visible) {
                vGuideRef.current.visible = true
                updateGuideLine(vGuideRef.current, true, worldWidth, worldHeight, viewport, true)
              } else {
                updateGuideLine(vGuideRef.current, true, worldWidth, worldHeight, viewport, true)
              }
            } else {
              if (vGuideRef.current && vGuideRef.current.visible) {
                vGuideRef.current.visible = false
              }
            }

            // Handle horizontal guide
            if (newGuideState.showHGuide) {
              if (!hGuideRef.current) {
                hGuideRef.current = createGuideLine(false, layersContainer)
                updateGuideLine(hGuideRef.current, false, worldWidth, worldHeight, viewport, true)
              } else if (!hGuideRef.current.visible) {
                hGuideRef.current.visible = true
                updateGuideLine(hGuideRef.current, false, worldWidth, worldHeight, viewport, true)
              } else {
                updateGuideLine(hGuideRef.current, false, worldWidth, worldHeight, viewport, true)
              }
            } else {
              if (hGuideRef.current && hGuideRef.current.visible) {
                hGuideRef.current.visible = false
              }
            }
          }
          currentGuideStateRef.current = newGuideState
        }

        // Update alignment guide lines
        if (layersContainer && snapResult.alignmentGuides && snapResult.alignmentGuides.length > 0) {
          debouncedUpdateAlignmentGuides(snapResult.alignmentGuides, layersContainer, worldWidth, worldHeight, viewport)
        } else {
          hideAlignmentGuides()
        }
      } else {
        hideSpacingGuides()
      }

      // IMMEDIATELY update the visual position of the layer object
      if (layerObject && !layerObject.destroyed) {
        // For text elements, use the same target object logic as useCanvasLayers
        // This ensures we're updating the correct object (cached sprite if it exists)
        const targetObject = layerObject._cachedSprite || layerObject

        // CRITICAL: Store selection box position (newX, newY) on the layer object
        // This allows the selection box to read it immediately during drag
        layerObject._selectionBoxX = newX
        layerObject._selectionBoxY = newY
        if (layerObject._cachedSprite && !layerObject._cachedSprite.destroyed) {
          layerObject._cachedSprite._selectionBoxX = newX
          layerObject._cachedSprite._selectionBoxY = newY
        }

        // Position elements
        targetObject.x = newX
        targetObject.y = newY
      }

      // Update drag hover box with snapped position during drag move (use stored dimensions)
      const dragHoverBoxDims = dragHoverBoxDimensionsRef.current
      if (dragHoverBoxDims) {
        const { dragScale } = getViewportScale()
        updateDragHoverBox(newX, newY, dragHoverBoxDims.width, dragHoverBoxDims.height, dragHoverBoxDims.rotationRadians, dragHoverBoxDims.anchorX, dragHoverBoxDims.anchorY, dragHoverBoxDims.scaleX, dragHoverBoxDims.scaleY, dragScale)
      }

      // Handle motion capture mode vs normal drag mode
      if (motionCapture?.isActive) {
        // Motion capture mode: Don't dispatch to Redux, call callback instead
        const capturedLayer = motionCapture.trackedLayers?.get(selectedLayerId)

        // [CONTROL POINTS FIX] Preserve existing control points when updating position
        // This prevents control points from being lost during single or multi-layer drags
        const existingControlPoints = capturedLayer?.controlPoints
        const hasControlPoints = existingControlPoints && Array.isArray(existingControlPoints) && existingControlPoints.length > 0

        // [PERFORMANCE] Only include controlPoints in update if they exist (avoid passing undefined)
        const updateData = {
          layerId: selectedLayerId,
          x: newX,
          y: newY,
          rotation: capturedLayer?.rotation ?? (layer.rotation || 0),
          scaleX: capturedLayer?.scaleX ?? (layer.scaleX || 1),
          scaleY: capturedLayer?.scaleY ?? (layer.scaleY || 1),
          cropX: capturedLayer?.cropX ?? (layer.cropX || 0),
          cropY: capturedLayer?.cropY ?? (layer.cropY || 0),
          cropWidth: capturedLayer?.cropWidth ?? (layer.cropWidth || layer.width || 100),
          cropHeight: capturedLayer?.cropHeight ?? (layer.cropHeight || layer.height || 100),
          mediaWidth: capturedLayer?.mediaWidth ?? layer.mediaWidth,
          mediaHeight: capturedLayer?.mediaHeight ?? layer.mediaHeight,
          interactionType: 'move'
        }

        // [CRITICAL] Only include controlPoints if they exist - this preserves them without overwriting
        if (hasControlPoints) {
          updateData.controlPoints = existingControlPoints
        }

        motionCapture.onPositionUpdate(updateData)

        if (liveMotionCaptureRef.current && liveMotionCaptureRef.current.trackedLayers) {
          const liveLayer = liveMotionCaptureRef.current.trackedLayers.get(selectedLayerId)
          if (liveLayer) {
            liveLayer.currentPosition = { x: newX, y: newY }
          }
        }

        updateMotionArrowVisibility(selectedLayerId, true)
      } else {
        // Normal mode
        updateMotionArrowVisibility(selectedLayerId, true)
        pendingDragUpdatesRef.current.set(selectedLayerId, { x: newX, y: newY })
        if (!dragUpdateFrameRef.current) {
          dragUpdateFrameRef.current = requestAnimationFrame(() => {
            pendingDragUpdatesRef.current.forEach((updates, layerId) => {
              dispatch(updateLayer({ id: layerId, x: updates.x, y: updates.y }))
            })
            pendingDragUpdatesRef.current.clear()
            dragUpdateFrameRef.current = null
          })
        }
      }
    }

    // Local pointer move handler for viewport events
    const handlePointerMove = (event) => {
      if (!dragStateAPI.isDragging() || (activeTool !== 'select' && activeTool !== 'move')) {
        return
      }

      // Prevent viewport panning when dragging a layer
      event.stopPropagation()

      // Use global handler for consistency
      handleGlobalPointerMove(event)
    }

    // =========================================================================
    // GLOBAL POINTER UP HANDLER - Handles drag completion and cleanup
    // =========================================================================

    const handleGlobalPointerUp = () => {
      // Check if there was an active drag before processing
      const wasDragging = dragStateAPI.isDragging()

      // No throttling - updates are immediate

      // Check if we have multiple layers selected (use ref for latest value)
      const currentSelectedLayerIds = selectedLayerIdsRef.current
      const hasMultiSelect = currentSelectedLayerIds && currentSelectedLayerIds.length > 1

      if (hasMultiSelect && dragStateAPI.isDragging()) {
        // Multi-select drag: layers are already updated in real-time, just clean up
        initialPositionsRef.current.clear()
      } else {
        // Single select drag - layers are already updated in real-time, no finalization needed
        initialPositionsRef.current.clear()
      }

      // Hide guide lines and drag hover box only if there was an active drag
      if (wasDragging) {
        hideGuideLines()
        hideAlignmentGuides()
        hideSpacingGuides()
        hideDragHoverBox()
        const currentMotionCaptureMode = latestMotionCaptureModeRef.current
        if (!currentMotionCaptureMode?.isActive) {
          hideMotionArrow()
        }
      }

      // Re-enable viewport drag
      resumeViewportDragPlugin(viewport)

      // ADD BOUNDARY CHECKING HERE
      // Check if any dragged layers went outside canvas bounds
      if (wasDragging && currentSelectedLayerIds) {
        currentSelectedLayerIds.forEach(layerId => {
          const layer = latestLayersRef.current[layerId]
          const layerObject = layerObjectsMap.get(layerId)

          if (layer && layerObject) {
            // Use the shared boundary checking logic
            const isOutside = isLayerCompletelyOutside(layer, layerObject, worldWidth, worldHeight)

            if (isOutside) {
              // Layer is completely outside canvas - delete it
              dispatch(deleteLayer(layerId))
              // Remove from selection if it was selected
              if (currentSelectedLayerIds.includes(layerId)) {
                dispatch(clearLayerSelection())
              }
            }
          }
        })
      }

      // Clear dragging flag from text elements (on both object and cached sprite if it exists)
      // CRITICAL: For center/right aligned text, we need to reset position after Redux updates
      // Use requestAnimationFrame to ensure Redux state has updated first
      const currentSelectedIds = selectedLayerIdsRef.current
      const layersToCleanup = hasMultiSelect ? currentSelectedIds : (currentSelectedIds?.[0] ? [currentSelectedIds[0]] : [])

      layersToCleanup.forEach((layerId) => {
        const layerObject = layerObjectsMap.get(layerId)
        const layer = latestLayersRef.current[layerId]

        if (layerObject && !layerObject.destroyed) {

          // Clear selection box position cache
          if (layerObject._selectionBoxX !== undefined) {
            delete layerObject._selectionBoxX
            delete layerObject._selectionBoxY
          }
          if (layerObject._cachedSprite && !layerObject._cachedSprite.destroyed) {
            if (layerObject._cachedSprite._selectionBoxX !== undefined) {
              delete layerObject._cachedSprite._selectionBoxX
              delete layerObject._cachedSprite._selectionBoxY
            }
          }
        }
      })

      // Comprehensive cleanup to prevent state accumulation
      dragStateAPI.setDragState(false)
      pointerIsDownRef.current = false
      dragStartRef.current = null
      initialPositionsRef.current.clear()
      dragOffsetsRef.current.clear()
      multiSelectBoundsCenterRef.current = null
      dragHoverBoxDimensionsRef.current = null // Clear stored drag hover box dimensions
      dragMultiSelectBoundsCacheRef.current = { bounds: null, selectedIds: null } // Clear drag-specific multi-select bounds cache
      motionArrowBasesRef.current.clear()

      // Cancel any pending drag updates and dispatch final positions
      if (dragUpdateFrameRef.current) {
        cancelAnimationFrame(dragUpdateFrameRef.current)
        dragUpdateFrameRef.current = null
      }
      // Dispatch any remaining pending updates immediately
      if (pendingDragUpdatesRef.current.size > 0) {
        pendingDragUpdatesRef.current.forEach((updates, layerId) => {
          const layer = latestLayersRef.current[layerId]
          if (!layer) return

          // Calculate relative dx/dy if we are NOT in motion capture mode
          // (In motion capture mode, onPositionUpdate already handled everything)
          const engine = getGlobalMotionEngine()
          const sceneMotionFlow = sceneMotionFlows?.[currentSceneId]
          const step = sceneMotionFlow?.steps?.find(s => s.layerActions?.[layerId]?.some(a => a.type === 'move'))

          const sceneStartTime = sceneMotionFlow?.startTime || 0
          const startState = engine.predictLayerStateAtTime(layerId, currentSceneId, step?.startTime || sceneStartTime)

          const dx = updates.x - (startState?.x ?? layer.x ?? 0)
          const dy = updates.y - (startState?.y ?? layer.y ?? 0)

          // We still use updateLayer to update the BASE position, but we should also 
          // consider if we need to update the motion action here for normal mode?
          // Actually, normal dragging usually just updates the BASE position (initial state).
          // And all animation steps should be relative to this new base.
          dispatch(updateLayer({ id: layerId, x: updates.x, y: updates.y }))
        })
        pendingDragUpdatesRef.current.clear()
      }

      hideGuideLines()
      hideAlignmentGuides()
      hideSpacingGuides()

      // Restore appropriate motion arrows after drag ends
      if (currentSelectedLayerIds && currentSelectedLayerIds.length > 0) {
        if (currentSelectedLayerIds.length === 1) {
          updateMotionArrowVisibility(currentSelectedLayerIds[0])
        } else if (motionCaptureMode?.isActive) {
          // In Motion Capture mode, show arrows for all selected layers
          hideMotionArrow()
          currentSelectedLayerIds.forEach(id => updateMotionArrowVisibility(id, true))
        } else {
          hideMotionArrow()
        }
      } else {
        hideMotionArrow()
      }
    }

    // Local pointer up handler
    const handlePointerUp = () => {
      handleGlobalPointerUp()
    }

    // Get renderer for global events (tracks movement outside viewport)
    const renderer = viewport.parent?.parent?.renderer || viewport.parent?.renderer

    // Add event listeners to viewport (which receives all interactions)
    // Use higher priority to catch events before viewport plugins and other handlers
    viewport.on('pointerdown', handlePointerDown, true)
    viewport.on('pointermove', handlePointerMove, true)
    viewport.on('pointerup', handlePointerUp, true)
    viewport.on('pointerupoutside', handlePointerUp, true)

    // Add global pointer move and up listeners to track movement outside viewport
    // This allows dragging layers outside the canvas boundaries
    if (renderer?.events) {
      renderer.events.on('globalpointermove', handleGlobalPointerMove)
      renderer.events.on('pointerup', handleGlobalPointerUp)
      renderer.events.on('pointerupoutside', handleGlobalPointerUp)
    } else {
      // Fallback: use viewport global events
      viewport.on('globalpointermove', handleGlobalPointerMove)
      viewport.on('globalpointerup', handleGlobalPointerUp)
    }

    // =========================================================================
    // LAYER OBJECT INTERACTION HANDLERS - Individual layer hover/click handling & Hover box  
    // =========================================================================

    const clickHandlers = new Map()

    layerObjectsMap.forEach((pixiObject, layerId) => {
      const layer = layers[layerId]
      const isVisibleInScene = layer && layer.sceneId === currentSceneId

      if (pixiObject && !pixiObject.destroyed) {
        // [FIX] BACKGROUND PROTECTION: Background layers are never interactive
        const isBackground = layer?.type === 'background'

        // CRITICAL: Only make layers interactive if they belong to the current scene and are NOT backgrounds
        pixiObject.eventMode = (isVisibleInScene && !isBackground) ? 'static' : 'none'
        pixiObject.cursor = (isVisibleInScene && !isBackground) ? 'pointer' : 'default'

        if (!isVisibleInScene || isBackground) return

        // Add hover effect for layer objects
        const handleLayerHoverEnter = () => {

          // Hide drag hover box when entering hover state to avoid conflicts
          hideDragHoverBox()

          // Only show hover box if the layer is NOT currently selected AND we're not dragging
          // Use ref to get latest selectedLayerIds to avoid stale closure issues
          const currentSelectedLayerIds = selectedLayerIdsRef.current
          const isSelected = currentSelectedLayerIds.includes(layerId)
          const isDragging = dragStateAPI.isDragging()

          // Don't show hover box if layer has a visible selection box
          const layerObject = layerObjectsMap.get(layerId)
          const hasSelectionBox = layerObject?.parent?.children?.some(child => child.label === 'selection-box' && child.visible)

          // Show hover box if:
          // 1. Not selected and not interacting and no selection box (normal hover)
          // 2. AND not playing!
          // 3. AND layer belongs to currently active scene
          const shouldShowHover = !isSelected && !isDragging && !hasSelectionBox && !latestIsPlayingRef.current && isVisibleInScene

          if (shouldShowHover) {
            const layer = layers[layerId]
            if (layer && pixiObject) {
              updateHoverBox(pixiObject, layer)
            }
          }
        }

        const handleLayerHoverLeave = () => {

          hideHoverBox()
        }

        pixiObject.on('pointerenter', handleLayerHoverEnter)
        pixiObject.on('pointerleave', handleLayerHoverLeave)

        const handleLayerClick = (event) => {
          // Hide hover box immediately when clicking on any layer
          hideHoverBox()

          // Skip if clicked on selection box or its handles
          let current = event.target
          while (current && current !== stageContainer && current !== viewport) {
            if (current.label === 'selection-box' || current.parent?.label === 'selection-box') {
              return // Don't process - let selection box handle it
            }
            // Also skip if clicked on multi-selection box
            if (current.label === 'multi-selection-box' || current.parent?.label === 'multi-selection-box') {
              return // Don't process - let useCanvasInteractions handle multi-drag
            }
            current = current.parent
          }


          // Get current click position
          let currentX = 0, currentY = 0
          if (event.global) {
            currentX = event.global.x
            currentY = event.global.y
          } else if (event.data?.global) {
            currentX = event.data.global.x
            currentY = event.data.global.y
          }

          // Double-click detection is now handled at viewport level

          // For all other cases (single click, selection, drag), let the viewport handler take over
          // Don't dispatch selection or prepare drag here - the viewport handler will handle it
          // This prevents conflicts between individual layer handlers and the main viewport logic
        }

        // Attach click handler
        pixiObject.on('pointerdown', handleLayerClick)
        clickHandlers.set(layerId, {
          click: handleLayerClick,
          hoverEnter: handleLayerHoverEnter,
          hoverLeave: handleLayerHoverLeave
        })
      }
    })

    // Cleanup
    return () => {
      viewport.off('pointerdown', handlePointerDown)
      viewport.off('pointermove', handlePointerMove)
      viewport.off('pointerup', handlePointerUp)
      viewport.off('pointerupoutside', handlePointerUp)

      // Remove global pointer listeners
      if (renderer?.events) {
        renderer.events.off('globalpointermove', handleGlobalPointerMove)
        renderer.events.off('pointerup', handleGlobalPointerUp)
        renderer.events.off('pointerupoutside', handleGlobalPointerUp)
      } else {
        viewport.off('globalpointermove', handleGlobalPointerMove)
        viewport.off('globalpointerup', handleGlobalPointerUp)
      }


      // Remove object listeners
      clickHandlers.forEach((handlers, layerId) => {
        const pixiObject = layerObjectsMap.get(layerId)
        if (pixiObject && !pixiObject.destroyed) {
          if (handlers.click) {
            pixiObject.off('pointerdown', handlers.click)
          }
          if (handlers.hoverEnter) {
            pixiObject.off('pointerenter', handlers.hoverEnter)
          }
          if (handlers.hoverLeave) {
            pixiObject.off('pointerleave', handlers.hoverLeave)
          }
        }
      })
      clickHandlers.clear()

      // NOTE: Aggressive guide cleanup moved to separate decoupled useEffect for stability
    }
  }, [stageContainer, layerObjectsMap, layersCount, selectedIdsStr, activeTool, viewport, dispatch, worldWidth, worldHeight, hideGuideLines, removeGuideLines, hideAlignmentGuides, removeAlignmentGuides, hideSpacingGuides, removeSpacingGuides, getCachedOtherObjectsForAlignment, updateAlignmentGuides, updateSpacingGuides, motionCaptureMode, currentSceneId])

  // =============================================================================
  // ADDITIONAL USE EFFECT HOOKS - Side effects and cleanup
  // =============================================================================

  // Invalidate snapping cache when layers or scene change to ensure accuracy
  useEffect(() => {
    invalidateSnappingCache()
    // Update spatial index when layers or scene change (not during drag operations)
    // [FIX] Include currentSceneId to rebuild spatial index when scene changes
    updateSpatialIndex(layers, layerObjectsMap)
    // Clear all caches to force refresh when scene changes
    snapCandidatesCacheRef.current.clear()
    // [FIX] Clear position cache when scene changes to prevent stale cross-scene data
    positionCacheRef.current.clear()
  }, [layers, layerObjectsMap, currentSceneId, invalidateSnappingCache, updateSpatialIndex])

  // Start pre-calculating layer metrics and snap candidates during idle time
  useEffect(() => {
    if (idleCallbackRef.current) {
      cancelIdleCallback(idleCallbackRef.current)
    }
    // Start with snap candidates pre-calculation (higher priority for drag performance)
    idleCallbackRef.current = requestIdleCallback(() => {
      precalculateSnapCandidates()
      precalculateLayerMetrics()
    }, { timeout: 1000 })

    return () => {
      if (idleCallbackRef.current) {
        cancelIdleCallback(idleCallbackRef.current)
        idleCallbackRef.current = null
      }
    }
  }, [precalculateSnapCandidates, precalculateLayerMetrics])

  // Force guide line redraw when canvas dimensions change
  useEffect(() => {
    // Redraw existing guide lines with new dimensions
    // Check that guide exists and is not destroyed before updating
    if (vGuideRef.current && !vGuideRef.current.destroyed && viewport) {
      updateGuideLine(vGuideRef.current, true, worldWidth, worldHeight, viewport, true)
    }
    if (hGuideRef.current && !hGuideRef.current.destroyed && viewport) {
      updateGuideLine(hGuideRef.current, false, worldWidth, worldHeight, viewport, true)
    }

  }, [worldWidth, worldHeight, viewport, updateGuideLine, layersContainer]) // Fix: Use layersContainer instead of stageContainer in dependency array



  // Prevent text selection during drag operations
  useEffect(() => {
    let textSelectionPrevented = false

    const preventTextSelection = (e) => {
      if (dragStateAPI.isDragging() || dragStateAPI.isResizing() || dragStateAPI.isRotating()) {
        e.preventDefault()
        return false
      }
    }

    const updateTextSelectionPrevention = () => {
      const shouldPrevent = dragStateAPI.isDragging() || dragStateAPI.isResizing() || dragStateAPI.isRotating()

      if (shouldPrevent && !textSelectionPrevented) {
        // Enable text selection prevention
        document.body.style.userSelect = 'none'
        document.body.style.WebkitUserSelect = 'none'
        document.body.style.MozUserSelect = 'none'
        document.body.style.msUserSelect = 'none'
        document.addEventListener('selectstart', preventTextSelection, true)
        textSelectionPrevented = true
      } else if (!shouldPrevent && textSelectionPrevented) {
        // Disable text selection prevention
        document.body.style.userSelect = ''
        document.body.style.WebkitUserSelect = ''
        document.body.style.MozUserSelect = ''
        document.body.style.msUserSelect = ''
        document.removeEventListener('selectstart', preventTextSelection, true)
        textSelectionPrevented = false
      }
    }

    // Set up a polling mechanism to check drag state
    const checkInterval = setInterval(updateTextSelectionPrevention, 16) // ~60fps

    // Initial check
    updateTextSelectionPrevention()

    return () => {
      clearInterval(checkInterval)
      if (textSelectionPrevented) {
        document.body.style.userSelect = ''
        document.body.style.WebkitUserSelect = ''
        document.body.style.MozUserSelect = ''
        document.body.style.msUserSelect = ''
        document.removeEventListener('selectstart', preventTextSelection, true)
      }
    }
  }, [dragStateAPI])


  // Only cleanup guide lines and hover box on actual component unmount
  useEffect(() => {
    return () => {
      // Clean up hover box
      if (hoverBoxRef.current && !hoverBoxRef.current.destroyed && hoverBoxRef.current.parent) {
        hoverBoxRef.current.parent.removeChild(hoverBoxRef.current)
        hoverBoxRef.current.destroy()
        hoverBoxRef.current = null
      }

      // Clean up drag hover box
      if (dragHoverBoxRef.current && !dragHoverBoxRef.current.destroyed && dragHoverBoxRef.current.parent) {
        dragHoverBoxRef.current.parent.removeChild(dragHoverBoxRef.current)
        dragHoverBoxRef.current.destroy()
        dragHoverBoxRef.current = null
      }

      // Clean up motion capture arrows
      for (const arrow of motionArrowsRef.current.values()) {
        if (arrow && !arrow.destroyed) {
          if (arrow.parent) {
            arrow.parent.removeChild(arrow)
          }
          arrow.destroy()
        }
      }
      motionArrowsRef.current.clear()

      if (layersContainer) {
        removeGuideLines(layersContainer) // Fix: Use layersContainer parameter instead of stageContainer
        removeAlignmentGuides(layersContainer) // Fix: Use layersContainer parameter instead of stageContainer
        removeSpacingGuides(layersContainer) // Fix: Use layersContainer parameter instead of stageContainer
      }
    }
  }, [layersContainer, removeGuideLines, removeAlignmentGuides, removeSpacingGuides])

  // Expose public API for interactions
  const interactionsAPI = useMemo(() => ({
    syncArrows
  }), [syncArrows])

  return interactionsAPI
}

// =============================================================================
// HOOK EXPORT
// =============================================================================

