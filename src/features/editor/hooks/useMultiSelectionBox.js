/**
 * Hook to create and manage a selection box that encompasses multiple selected layers.
 * Displays a dashed outline around all selected layers with resize handles for simultaneous
 * transformations. Handles multi-layer resizing, moving, and rotating operations while
 * maintaining relative positions between layers. Only activates when 2+ layers are selected.
 */

import { useEffect, useRef, useState } from 'react'
import { useDispatch } from 'react-redux'
import * as PIXI from 'pixi.js'
import { drawDashedRect } from '../../engine/pixi/dashUtils'
import { drawShapePath } from '../../engine/pixi/createLayer'
import { getLayerWorldBounds, getCombinedLayerBounds, getRotatedAABB } from '../utils/geometry'
import { updateLayer } from '../../../store/slices/projectSlice'
import { calculateCombinedBounds, getInitialLayerState } from '../utils/layerUtils'
import { pauseViewportDragPlugin, resumeViewportDragPlugin } from '../utils/viewportUtils'
import { createDimensionsBadge, updateDimensionsBadge, removeDimensionsBadge, createRotationBadge, updateRotationBadge, removeRotationBadge } from '../utils/badgeUtils'
import { createResizeHandle, createRotateHandle, calculateAdaptedScale } from '../utils/handleUtils'
import { getLayerFirstActionTime } from '../utils/animationUtils'
import { getGlobalMotionEngine } from '../../engine/motion'

export function useMultiSelectionBox(stageContainer, layersContainer, selectedLayerIds, layerObjectsMap, layers, viewport, worldWidth, worldHeight, isPlaying = false, motionCaptureMode = null, interactionsAPIRef = null, currentSceneId = null, sceneMotionFlow = null, onLockedInteraction = null, zoom = 1) {
  const dispatch = useDispatch()
  const selectionBoxRef = useRef(null)
  const [forceUpdate, setForceUpdate] = useState(0)
  const triggerUpdate = () => setForceUpdate(prev => prev + 1)

  // Single interaction state ref (new architecture)
  const interactionStateRef = useRef({ resize: null, rotate: null })

  // Helper accessors for backward compatibility (old interface)
  const resizeStateRef = {
    get current() { return interactionStateRef.current.resize },
    set current(value) { interactionStateRef.current.resize = value }
  }

  const rotateStateRef = {
    get current() { return interactionStateRef.current.rotate },
    set current(value) { interactionStateRef.current.rotate = value }
  }

  const latestSelectedLayerIdsRef = useRef(selectedLayerIds)
  const latestLayerObjectsMapRef = useRef(layerObjectsMap)
  const latestLayersRef = useRef(layers)
  const latestViewportRef = useRef(viewport)
  const latestStageContainerRef = useRef(stageContainer)
  const latestLayersContainerRef = useRef(layersContainer)
  const dimensionsBadgeRef = useRef(null)
  const rotationBadgeRef = useRef(null)
  const latestCurrentSceneIdRef = useRef(currentSceneId)
  const latestSceneMotionFlowRef = useRef(sceneMotionFlow)

  // Object pooling for performance optimization
  const pooledObjectsRef = useRef({
    outline: null,
    handles: new Array(8).fill(null), // 8 handles: 4 corners + 4 edges
    rotateHandle: null,
    hitArea: null
  })

  // Cached bounds to avoid recalculation
  const cachedBoundsRef = useRef(null)

  // Keep refs updated
  latestSelectedLayerIdsRef.current = selectedLayerIds
  latestLayerObjectsMapRef.current = layerObjectsMap
  latestLayersRef.current = layers
  latestViewportRef.current = viewport
  latestStageContainerRef.current = stageContainer
  latestLayersContainerRef.current = layersContainer
  latestCurrentSceneIdRef.current = currentSceneId
  latestSceneMotionFlowRef.current = sceneMotionFlow
  const latestMotionCaptureModeRef = useRef(motionCaptureMode)

  useEffect(() => {
    latestMotionCaptureModeRef.current = motionCaptureMode
    // Hide immediately if isPlaying is true
    if (isPlaying) {
      if (selectionBoxRef.current) {
        selectionBoxRef.current.visible = false
      }
      return
    }

    // Visibility is now handled by always showing the box, but locking it if necessary

    // Clear bounds cache when selected layers change to ensure fresh calculations
    // This fixes the issue where multi-selection stops working after the first drag operation
    cachedBoundsRef.current = null

    // Filter selected layers by the current scene ID
    const sceneSelectedLayerIds = selectedLayerIds?.filter(id => layers[id]?.sceneId === currentSceneId) || []

    if (!stageContainer || !viewport || sceneSelectedLayerIds.length <= 1) {
      if (selectionBoxRef.current) {
        if (selectionBoxRef.current.parent) {
          selectionBoxRef.current.parent.removeChild(selectionBoxRef.current)
        }
        selectionBoxRef.current.destroy({ children: true })
        selectionBoxRef.current = null
      }

      // CRITICAL: Clear interaction flags on all layers that were part of this multi-selection
      // This prevents layers from getting "stuck" in an interacting state after scene switch or deselect
      if (latestSelectedLayerIdsRef.current) {
        latestSelectedLayerIdsRef.current.forEach(layerId => {
          const layerObject = latestLayerObjectsMapRef.current?.get(layerId)
          if (layerObject) {
            layerObject._isResizing = false
            layerObject._isRotating = false
            if (layerObject._cachedSprite) {
              layerObject._cachedSprite._isResizing = false
              layerObject._cachedSprite._isRotating = false
            }
          }
        })
      }
      return
    }

    // Calculate combined bounds using shared utility
    // Uses PIXI object positions when possible (more accurate after resize operations)
    // CRITICAL FIX: Pass motionCaptureMode so we get the TRACKED state, not the stale Redux state
    const combinedBounds = calculateCombinedBounds(sceneSelectedLayerIds, layers, layerObjectsMap, motionCaptureMode)

    if (!combinedBounds) {
      if (selectionBoxRef.current) {
        if (selectionBoxRef.current.parent) {
          selectionBoxRef.current.parent.removeChild(selectionBoxRef.current)
        }
        selectionBoxRef.current.destroy({ children: true })
        selectionBoxRef.current = null
      }
      return
    }

    // Create or update selection box
    let box = selectionBoxRef.current

    if (!box || box.destroyed) {
      box = new PIXI.Container()
      box.label = 'multi-selection-box'
      box.eventMode = 'static' // Make it interactive so clicks are detected
      box.interactiveChildren = true
      box.cursor = 'move' // Show move cursor
      box.zIndex = 10001 // Above single selection box
      layersContainer.addChild(box)
      selectionBoxRef.current = box

      // Ensure the container itself can receive events by setting a hit area
      // This is important for containers that contain only graphics
      // box.hitArea constraint removed
    }

    // Early exit during resize or rotate - let the handlers update the box
    if (resizeStateRef.current || rotateStateRef.current) {
      // During interactive operations, don't clear anything
      // Just ensure box is visible
      box.visible = true
      return // Skip the rest of the useEffect during resize/rotate
    }

    const { x: minX, y: minY, width, height } = combinedBounds

    // Check if bounds actually changed to avoid unnecessary redraws
    const boundsKey = `${minX}-${minY}-${width}-${height}`
    if (cachedBoundsRef.current === boundsKey && pooledObjectsRef.current.outline) {
      // Bounds haven't changed, but we still need to ensure visually correct dashed rect
      const outline = pooledObjectsRef.current.outline
      outline.clear()
      drawDashedRect(outline, 0, 0, width, height, 0, 0x8B5CF6, 1.5, 10, 5)
      return
    }
    cachedBoundsRef.current = boundsKey

    // Clear existing graphics (but keep handles if resizing)
    box.removeChildren()

    // Use object pooling for outline graphics
    let graphics = pooledObjectsRef.current.outline
    if (!graphics || graphics.destroyed) {
      graphics = new PIXI.Graphics()
      graphics.label = 'multi-selection-outline' // Label it so we can find it during resize
      graphics.eventMode = 'none' // Don't let graphics interfere with container events
      pooledObjectsRef.current.outline = graphics
    } else {
      graphics.clear()
    }

    const engine = getGlobalMotionEngine()
    const currentTime = engine?.masterTimeline?.time() || 0
    const sceneStartTime = sceneMotionFlow?.sceneStartOffset || 0
    const isPastBaseStep = Math.abs(currentTime - sceneStartTime) > 0.02

    // Check if any selected layer is animated
    const anyLayerAnimated = selectedLayerIds.some(layerId => {
      return getLayerFirstActionTime(layerId, sceneMotionFlow) !== Infinity
    })

    const isLocked = !motionCaptureMode?.isActive && isPastBaseStep && anyLayerAnimated

    // drawDashedRect signature: (graphics, x, y, width, height, cornerRadius, strokeColor, strokeWidth, dashLength, gapLength)
    const zoomScale = 1 / (viewport?.scale?.x || 1)
    const baseScale = calculateAdaptedScale(zoomScale)
    drawDashedRect(graphics, 0, 0, width, height, 0, 0x8B5CF6, 1.5 * baseScale, 10, 5)

    graphics.alpha = isLocked ? 0.4 : 1.0

    box.addChild(graphics)
    box.x = minX
    box.y = minY

    // Update hit area to match the selection box bounds plus padding for handles
    // This ensures rotation handle at y: -30 is clickable
    // box.hitArea removed to allow children outside bounds to be interactive
    // Create explicit hit area for the box body (transparent fill)
    let bodyHit = box.children.find(c => c.label === 'body-hit')
    if (!bodyHit) {
      bodyHit = new PIXI.Graphics()
      bodyHit.label = 'body-hit'
      bodyHit.eventMode = 'static'
      box.addChildAt(bodyHit, 0)
    }
    bodyHit.clear()
    bodyHit.rect(0, 0, width, height)
    bodyHit.fill({ color: 0x000000, alpha: 0.01 })

    // Enable interactive children for resize handles
    box.interactiveChildren = true

    // Static handle sizing

    // Create resize handles (only if not currently resizing)
    if (!resizeStateRef.current) {
      // [PERFORMANCE] Store initial layer states for resize calculations
      // [MOTION CAPTURE FIX] Use tracked state when in motion capture mode
      const initialLayerStates = new Map()
      const isMotionCapture = motionCaptureMode?.isActive

      selectedLayerIds.forEach((layerId) => {
        const layer = layers[layerId]
        const layerObject = layerObjectsMap?.get(layerId)
        if (!layer || !layerObject || layerObject.destroyed) return

        // [MOTION CAPTURE FIX] Use tracked state in motion capture mode for accurate initial state
        if (isMotionCapture) {
          const trackedLayer = motionCaptureMode.trackedLayers?.get(layerId)
          if (trackedLayer) {
            const currentX = trackedLayer.currentPosition?.x ?? layer.x
            const currentY = trackedLayer.currentPosition?.y ?? layer.y
            const currentWidth = trackedLayer.width ?? layer.width
            const currentHeight = trackedLayer.height ?? layer.height
            const currentScaleX = trackedLayer.scaleX ?? 1
            const currentScaleY = trackedLayer.scaleY ?? 1
            const currentRotation = trackedLayer.rotation ?? layer.rotation ?? 0

            // Calculate bounds from tracked state
            const isTextElement = layerObject instanceof PIXI.Text
            const anchorX = isTextElement ? 0 : (layer.anchorX ?? 0.5)
            const anchorY = isTextElement ? 0 : (layer.anchorY ?? 0.5)

            const bounds = getRotatedAABB(
              currentX, currentY, currentWidth, currentHeight,
              currentScaleX, currentScaleY, currentRotation, anchorX, anchorY
            )

            if (bounds && bounds.width > 0 && bounds.height > 0) {
              initialLayerStates.set(layerId, {
                x: currentX,
                y: currentY,
                width: currentWidth,
                height: currentHeight,
                scaleX: currentScaleX,
                scaleY: currentScaleY,
                anchorX,
                anchorY,
                boundsX: bounds.left,
                boundsY: bounds.top,
                boundsWidth: bounds.width,
                boundsHeight: bounds.height,
                isTextElement,
                initialFontSize: isTextElement ? (layer.data?.fontSize || layerObject.style?.fontSize || 24) : null,
              })
            }
            return
          }
        }

        // Fallback to normal Redux state calculation
        const bounds = getLayerWorldBounds(layer, layerObject)
        if (bounds && bounds.width > 0 && bounds.height > 0) {
          // For text elements, anchorX is always 0 (left edge), anchorY is always 0 (top edge)
          const isTextElement = layerObject instanceof PIXI.Text
          const anchorX = isTextElement ? 0 : (layer.anchorX !== undefined ? layer.anchorX : 0.5)
          const anchorY = isTextElement ? 0 : (layer.anchorY !== undefined ? layer.anchorY : 0.5)

          initialLayerStates.set(layerId, {
            x: layer.x || 0,
            y: layer.y || 0,
            width: layer.width || bounds.width,
            height: layer.height || bounds.height,
            scaleX: layer.scaleX !== undefined ? layer.scaleX : 1,
            scaleY: layer.scaleY !== undefined ? layer.scaleY : 1,
            anchorX: anchorX,
            anchorY: anchorY,
            boundsX: bounds.x,
            boundsY: bounds.y,
            boundsWidth: bounds.width,
            boundsHeight: bounds.height,
            isTextElement: isTextElement, // Store element type for resize logic
            initialFontSize: isTextElement ? (layer.data?.fontSize || layerObject.style?.fontSize || 24) : null,
          })
        }
      })

      // Create handle function using utility with object pooling
      function createHandle(index, hx, hy, cursor, handleType) {
        let handle = pooledObjectsRef.current.handles[index]
        if (!handle || handle.destroyed) {
          handle = createResizeHandle({
            x: hx,
            y: hy,
            handleType,
            cursor,
            onResizeStart: (handleType, cursor, e) => {
              // [FIX] DYNAMIC LOCK CHECK: Avoid stale closures by checking current time from engine
              const engine = getGlobalMotionEngine()
              const currentTime = engine?.masterTimeline?.time() || 0
              // Use ref to avoid stale closures in pooled handles
              const sceneFlow = latestSceneMotionFlowRef.current
              const startOffset = sceneFlow?.sceneStartOffset || 0
              const isActuallyLocked = !latestMotionCaptureModeRef.current?.isActive && Math.abs(currentTime - startOffset) > 0.02 && 
                latestSelectedLayerIdsRef.current.some(layerId => getLayerFirstActionTime(layerId, sceneFlow) !== Infinity)

              if (isActuallyLocked) {
                if (onLockedInteraction) onLockedInteraction(e)
                return
              }
              handleMultiResizeStart(handleType, cursor, e, minX, minY, width, height, initialLayerStates)
            },
            zoomScale: 1 / (viewport?.scale?.x || 1)
          })
          pooledObjectsRef.current.handles[index] = handle
        } else {
          // Update existing handle properties and visually scale if needed
          handle.x = hx
          handle.y = hy
          handle.cursor = isLocked ? 'not-allowed' : cursor
          handle.handleType = handleType
          handle.visible = true
          handle.alpha = isLocked ? 0.4 : 1.0
          // Update visual scaling to stay consistent on screen
          const currentZoom = 1 / (viewport?.scale?.x || 1)
          // Handle sizing is normally baked into Graphics by handleUtils, 
          // but we ensure it's synced if zoom changed significantly
          if (Math.abs((handle._prevZoomScale || 1) - currentZoom) > 0.05) {
            handle._prevZoomScale = currentZoom
            // Optional: trigger redraw if handleUtils supports it, 
            // but usually we just let it be destroyed/recreated on next effect run
          }
        }

        return handle
      }

      // Create all handles using object pooling
      // [PERFORMANCE] Reuse isMotionCapture variable from above
      const handles = isMotionCapture ? [] : [
        createHandle(0, 0, 0, 'nw-resize', 'nw'),
        createHandle(1, width, 0, 'ne-resize', 'ne'),
        createHandle(2, 0, height, 'sw-resize', 'sw'),
        createHandle(3, width, height, 'se-resize', 'se'),
        createHandle(4, width / 2, 0, 'n-resize', 'n'),
        createHandle(5, width / 2, height, 's-resize', 's'),
        createHandle(6, 0, height / 2, 'w-resize', 'w'),
        createHandle(7, width, height / 2, 'e-resize', 'e'),
      ]

      if (!isMotionCapture) {
        handles.forEach(handle => box.addChild(handle))
      }

      if (!resizeStateRef.current && !rotateStateRef.current) {
        const zoomScale = 1 / (viewport?.scale?.x || 1)
        const baseScale = calculateAdaptedScale(zoomScale)
        const rotateRadius = 18 * baseScale
        const rotationYPosition = height + rotateRadius + (45 * baseScale)

        // Check if we need to recreate the handle (if missing, destroyed, or zoom changed)
        let rotateHandle = pooledObjectsRef.current.rotateHandle
        const shouldRecreate = !rotateHandle || rotateHandle.destroyed || Math.abs(rotateHandle._cachedZoom - zoomScale) > 0.1

        if (shouldRecreate) {
          if (rotateHandle) rotateHandle.destroy({ children: true })

          rotateHandle = createRotateHandle({
            x: width / 2,
            y: rotationYPosition,
            onRotateStart: (e) => {
              // [FIX] DYNAMIC LOCK CHECK: Avoid stale closures by checking current time from engine
              const engine = getGlobalMotionEngine()
              const currentTime = engine?.masterTimeline?.time() || 0
              const sceneFlow = latestSceneMotionFlowRef.current
              const startOffset = sceneFlow?.sceneStartOffset || 0
              const isActuallyLocked = !latestMotionCaptureModeRef.current?.isActive && Math.abs(currentTime - startOffset) > 0.02 && 
                latestSelectedLayerIdsRef.current.some(layerId => getLayerFirstActionTime(layerId, sceneFlow) !== Infinity)

              if (isActuallyLocked) {
                if (onLockedInteraction) onLockedInteraction(e)
                return
              }
              handleMultiRotateStart(e)
            },
            zoomScale: zoomScale
          })
          rotateHandle._cachedZoom = zoomScale
          pooledObjectsRef.current.rotateHandle = rotateHandle
          box.addChild(rotateHandle)
        } else {
          // Just update position
          rotateHandle.x = width / 2
          rotateHandle.y = rotationYPosition
          rotateHandle.visible = true
          rotateHandle.alpha = isLocked ? 0.4 : 1.0
          rotateHandle.scale.set(1) // Ensure scale is 1, as sizing is baked into graphics

          // Ensure it's part of the box
          if (rotateHandle.parent !== box) {
            box.addChild(rotateHandle)
          }
        }
      }
    }

    // Ensure box is on top
    if (box.parent === layersContainer) {
      const topIndex = layersContainer.children.length - 1
      layersContainer.setChildIndex(box, topIndex)
    }

    // Multi-resize handler
    function handleMultiResizeStart(handleType, cursor, startEvent, staleBoxX, staleBoxY, staleBoxWidth, staleBoxHeight, staleInitialLayerStates) {
      // Deactivate resizing and scaling in MotionCaptureMode for multi-selection
      if (motionCaptureMode?.isActive) return

      const currentViewport = latestViewportRef.current
      if (!currentViewport) return

      startEvent.stopPropagation()
      if (startEvent.data?.originalEvent) {
        startEvent.data.originalEvent.stopPropagation()
        startEvent.data.originalEvent.preventDefault()
      }

      const startWorldPos = currentViewport.toWorld(startEvent.data.global.x, startEvent.data.global.y)

      // Check if Shift key is pressed at resize start
      const shiftKey = startEvent.data?.originalEvent?.shiftKey || false

      // CRITICAL FIX: Recalculate current box bounds and initial layer states from PIXI objects
      // Use getCombinedLayerBounds for perfect parity with live sync, avoiding the "flinch" effect
      // Filter selected layers by current scene
      const currentSelectedLayerIds = (latestSelectedLayerIdsRef.current || [])
        .filter(id => latestLayersRef.current[id]?.sceneId === latestCurrentSceneIdRef.current)
      const currentLayers = latestLayersRef.current
      const currentLayerObjectsMap = latestLayerObjectsMapRef.current

      // Pass motionCaptureMode to getCombinedLayerBounds so it uses tracked layers!
      const refinedBounds = getCombinedLayerBounds(currentSelectedLayerIds, currentLayers, currentLayerObjectsMap, motionCaptureMode)

      if (!refinedBounds) return

      const { x: freshBoxX, y: freshBoxY, width: freshBoxWidth, height: freshBoxHeight } = refinedBounds
      const freshInitialLayerStates = new Map()

      currentSelectedLayerIds.forEach((layerId) => {
        const layer = currentLayers[layerId]
        const layerObject = currentLayerObjectsMap?.get(layerId)
        if (layer && layerObject && !layerObject.destroyed) {
          // CRITICAL FIX: In Motion Capture mode, use the TRACKED state, not the Redux state
          // This prevents snap-back on consecutive resizes
          if (motionCaptureMode?.isActive) {
            const trackedLayer = motionCaptureMode.trackedLayers?.get(layerId)
            if (trackedLayer) {
              // [PERFORMANCE] Construct initial state from tracked data efficiently
              // trackedLayer has: currentPosition {x, y}, rotation, scaleX, scaleY, width, height
              const currentX = trackedLayer.currentPosition?.x ?? layer.x
              const currentY = trackedLayer.currentPosition?.y ?? layer.y
              const currentWidth = trackedLayer.width ?? layer.width
              const currentHeight = trackedLayer.height ?? layer.height
              const currentScaleX = trackedLayer.scaleX ?? 1
              const currentScaleY = trackedLayer.scaleY ?? 1
              const currentRotation = trackedLayer.rotation ?? layer.rotation ?? 0
              const anchorX = layer.anchorX ?? 0.5
              const anchorY = layer.anchorY ?? 0.5
              const isTextElement = layerObject instanceof PIXI.Text

              // [PERFORMANCE] Calculate AABB bounds efficiently
              const bounds = getRotatedAABB(
                currentX,
                currentY,
                currentWidth,
                currentHeight,
                currentScaleX,
                currentScaleY,
                currentRotation,
                anchorX,
                anchorY
              )

              const initialState = {
                x: currentX,
                y: currentY,
                width: currentWidth,
                height: currentHeight,
                scaleX: currentScaleX,
                scaleY: currentScaleY,
                anchorX,
                anchorY,
                boundsX: bounds.left,
                boundsY: bounds.top,
                boundsWidth: bounds.width,
                boundsHeight: bounds.height,
                isTextElement,
                initialFontSize: isTextElement ? (layer.data?.fontSize || layerObject.style?.fontSize || 24) : null
              }

              freshInitialLayerStates.set(layerId, initialState)
              return
            }
          }

          // Fallback to normal Redux state
          const initialState = getInitialLayerState(layer, layerObject)
          if (initialState) {
            freshInitialLayerStates.set(layerId, initialState)
          }
        }
      })

      resizeStateRef.current = {
        handleType,
        cursor,
        startBoxX: freshBoxX,
        startBoxY: freshBoxY,
        startBoxWidth: freshBoxWidth,
        startBoxHeight: freshBoxHeight,
        startMouseX: startWorldPos.x,
        startMouseY: startWorldPos.y,
        initialLayerStates: freshInitialLayerStates,
        aspectRatio: freshBoxWidth / freshBoxHeight,
        lastWorldPos: { x: startWorldPos.x, y: startWorldPos.y },
      }

      // Ensure selection box is visible and in the layers container
      const box = selectionBoxRef.current
      if (box && !box.destroyed) {
        box.visible = true
        if (!box.parent && latestLayersContainerRef.current) {
          latestLayersContainerRef.current.addChild(box)
        }

        // Update box position and size to match fresh bounds
        box.x = freshBoxX
        box.y = freshBoxY

        // Update hit area - removed restrictive hitArea to allow handles to be clickable
        // instead we use bodyHit child for the box body interaction
        if (box.hitArea) box.hitArea = null

        // Update outline
        const outline = box.children.find(child => child.label === 'multi-selection-outline')
        if (outline) {
          outline.visible = true
          outline.clear()
          const zoomScale = 1 / (latestViewportRef.current?.scale?.x || 1)
          const baseScale = calculateAdaptedScale(zoomScale)
          drawDashedRect(outline, 0, 0, freshBoxWidth, freshBoxHeight, 0, 0x8B5CF6, 1.5 * baseScale, 10, 5)
        }

        // Update handle positions
        const handles = box.children.filter(child => child.label === 'resize-handle')
        handles.forEach(handle => {
          if (handle && !handle.destroyed) {
            const hType = handle.handleType
            if (hType === 'nw') handle.position.set(0, 0)
            else if (hType === 'ne') handle.position.set(freshBoxWidth, 0)
            else if (hType === 'sw') handle.position.set(0, freshBoxHeight)
            else if (hType === 'se') handle.position.set(freshBoxWidth, freshBoxHeight)
            else if (hType === 'n') handle.position.set(freshBoxWidth / 2, 0)
            else if (hType === 's') handle.position.set(freshBoxWidth / 2, freshBoxHeight)
            else if (hType === 'w') handle.position.set(0, freshBoxHeight / 2)
            else if (hType === 'e') handle.position.set(freshBoxWidth, freshBoxHeight / 2)
          }
        })
      }

      // Disable viewport drag
      pauseViewportDragPlugin(currentViewport)

      // Event handlers
      function onMove(e) {
        if (!resizeStateRef.current) return

        const viewportInstance = latestViewportRef.current
        if (!viewportInstance) return

        // Check if Shift key is currently pressed
        const shiftKey = e.data?.originalEvent?.shiftKey || false
        resizeStateRef.current.shiftKey = shiftKey

        let globalX, globalY
        if (e.global) {
          globalX = e.global.x
          globalY = e.global.y
        } else if (e.data?.global) {
          globalX = e.data.global.x
          globalY = e.data.global.y
        } else {
          return
        }

        const worldPos = viewportInstance.toWorld(globalX, globalY)
        if (resizeStateRef.current) {
          resizeStateRef.current.lastWorldPos = { x: worldPos.x, y: worldPos.y }
        }
        handleMultiResizeMove(worldPos.x, worldPos.y)
      }

      function onEnd() {
        if (!resizeStateRef.current) return

        const viewportInstance = latestViewportRef.current
        const renderer = viewportInstance?.parent?.parent?.renderer || viewportInstance?.parent?.renderer
        const currentLayerObjectsMap = latestLayerObjectsMapRef.current

        // Clear resizing flags
        const state = resizeStateRef.current
        if (state && state.pendingUpdates) {
          state.pendingUpdates.forEach(({ layerId }) => {
            const layerObject = currentLayerObjectsMap?.get(layerId)
            if (layerObject) {
              const targetObject = layerObject._cachedSprite || layerObject
              if (targetObject && !targetObject.destroyed) {
                targetObject._isResizing = false
              }
              if (layerObject._cachedSprite && layerObject._cachedSprite !== targetObject) {
                layerObject._cachedSprite._isResizing = false
              }
            }
          })
        }

        // Finalize updates for all layers (dispatch to Redux)
        // Note: We may have already dispatched during resize, but this ensures final state is correct
        if (state && state.pendingUpdates) {
          state.pendingUpdates.forEach(({ layerId, updates }) => {
            dispatch(updateLayer({ id: layerId, ...updates }))
          })
        }

        // Clean up any pending animation frame
        if (state && state.dispatchFrameId) {
          cancelAnimationFrame(state.dispatchFrameId)
          state.dispatchFrameId = null
        }

        // Clear resize state AFTER removing event listeners
        // This allows the useEffect to run and recalculate the box
        resizeStateRef.current = null

        // Resume viewport drag
        resumeViewportDragPlugin(viewportInstance)

        // Remove event listeners
        if (renderer?.events) {
          renderer.events.off('globalpointermove', onMove)
          renderer.events.off('pointerup', onEnd)
          renderer.events.off('pointerupoutside', onEnd)
        } else {
          currentViewport.off('globalpointermove', onMove)
          currentViewport.off('pointerup', onEnd)
          currentViewport.off('pointerupoutside', onEnd)
        }

        // Remove dimensions badge after resize ends
        if (dimensionsBadgeRef.current) {
          if (dimensionsBadgeRef.current.parent) {
            dimensionsBadgeRef.current.parent.removeChild(dimensionsBadgeRef.current)
          }
          dimensionsBadgeRef.current.destroy({ children: true })
          dimensionsBadgeRef.current = null
        }

        // Force a recalculation of the multi-selection box bounds immediately
        // The PIXI objects should have the correct positions from the resize operation
        if (selectionBoxRef.current && !selectionBoxRef.current.destroyed) {
          selectionBoxRef.current.visible = true
        }

        // Trigger react state update to re-run the effect and finalize bounds from tracked state
        triggerUpdate()
      }

      const renderer = currentViewport.parent?.parent?.renderer || currentViewport.parent?.renderer
      if (renderer?.events) {
        renderer.events.on('globalpointermove', onMove)
        renderer.events.on('pointerup', onEnd)
        renderer.events.on('pointerupoutside', onEnd)
      } else {
        currentViewport.on('globalpointermove', onMove)
        currentViewport.on('pointerup', onEnd)
        currentViewport.on('pointerupoutside', onEnd)
      }
    }


    function handleMultiResizeMove(mouseX, mouseY) {
      const state = resizeStateRef.current
      if (!state) return

      const { handleType, startBoxX, startBoxY, startBoxWidth, startBoxHeight, startMouseX, startMouseY, initialLayerStates } = state

      // Calculate mouse delta
      const deltaX = mouseX - startMouseX
      const deltaY = mouseY - startMouseY

      const isCornerHandle = ['nw', 'ne', 'sw', 'se'].includes(handleType)
      const shiftKey = state.shiftKey || false
      const maintainAspectRatio = shiftKey && isCornerHandle

      // ALWAYS force aspect ratio preservation for corner handles in normal mode
      // This matches the single selection box behavior
      const effectiveMaintainAspectRatio = maintainAspectRatio || isCornerHandle

      // Initialize defaults
      let newBoxX = startBoxX
      let newBoxY = startBoxY
      let newBoxWidth = startBoxWidth
      let newBoxHeight = startBoxHeight

      if (effectiveMaintainAspectRatio) {
        // ASPECT RATIO PRESERVED SCALING
        let scale = 1
        let tempW = startBoxWidth
        let tempH = startBoxHeight

        switch (handleType) {
          case 'nw':
            tempW = startBoxWidth - deltaX
            tempH = startBoxHeight - deltaY
            scale = Math.max(0.1, tempW / startBoxWidth, tempH / startBoxHeight)
            break
          case 'ne':
            tempW = startBoxWidth + deltaX
            tempH = startBoxHeight - deltaY
            scale = Math.max(0.1, tempW / startBoxWidth, tempH / startBoxHeight)
            break
          case 'sw':
            tempW = startBoxWidth - deltaX
            tempH = startBoxHeight + deltaY
            scale = Math.max(0.1, tempW / startBoxWidth, tempH / startBoxHeight)
            break
          case 'se':
            tempW = startBoxWidth + deltaX
            tempH = startBoxHeight + deltaY
            scale = Math.max(0.1, tempW / startBoxWidth, tempH / startBoxHeight)
            break
          case 'e':
          case 'w':
            tempW = (handleType === 'e') ? startBoxWidth + deltaX : startBoxWidth - deltaX
            scale = Math.max(0.1, tempW / startBoxWidth)
            break
          case 'n':
          case 's':
            tempH = (handleType === 's') ? startBoxHeight + deltaY : startBoxHeight - deltaY
            scale = Math.max(0.1, tempH / startBoxHeight)
            break
        }

        newBoxWidth = startBoxWidth * scale
        newBoxHeight = startBoxHeight * scale

        // Apply Position Constraints (Keep opposite side fixed)
        switch (handleType) {
          case 'nw':
            newBoxX = (startBoxX + startBoxWidth) - newBoxWidth
            newBoxY = (startBoxY + startBoxHeight) - newBoxHeight
            break
          case 'ne':
            newBoxX = startBoxX
            newBoxY = (startBoxY + startBoxHeight) - newBoxHeight
            break
          case 'sw':
            newBoxX = (startBoxX + startBoxWidth) - newBoxWidth
            newBoxY = startBoxY
            break
          case 'se':
          case 'e':
          case 's':
            newBoxX = startBoxX
            newBoxY = startBoxY
            break
          case 'n':
            newBoxX = startBoxX
            newBoxY = (startBoxY + startBoxHeight) - newBoxHeight
            break
          case 'w':
            newBoxX = (startBoxX + startBoxWidth) - newBoxWidth
            newBoxY = startBoxY
            break
        }
      } else {
        // FREE SCALING (Side handles without shift) - Opposite side fixed
        switch (handleType) {
          case 'n':
            newBoxY = startBoxY + deltaY
            newBoxHeight = startBoxHeight - deltaY
            newBoxX = startBoxX
            newBoxWidth = startBoxWidth
            break
          case 's':
            newBoxHeight = startBoxHeight + deltaY
            newBoxX = startBoxX
            newBoxWidth = startBoxWidth
            newBoxY = startBoxY
            break
          case 'w':
            newBoxX = startBoxX + deltaX
            newBoxWidth = startBoxWidth - deltaX
            newBoxY = startBoxY
            break
          case 'e':
            newBoxWidth = startBoxWidth + deltaX
            newBoxX = startBoxX
            newBoxY = startBoxY
            break
        }
      }

      // Safe guards for negative dimensions
      if (newBoxWidth < 10) {
        newBoxWidth = 10
        // Correct position if we hit min width on left-side resizing
        if (handleType.includes('w')) {
          newBoxX = (startBoxX + startBoxWidth) - 10
        }
      }
      if (newBoxHeight < 10) {
        newBoxHeight = 10
        // Correct position if we hit min height on top-side resizing
        if (handleType.includes('n')) {
          newBoxY = (startBoxY + startBoxHeight) - 10
        }
      }

      // Calculate scale factors
      const scaleX = newBoxWidth / startBoxWidth
      const scaleY = newBoxHeight / startBoxHeight

      // Update all selected layers
      const pendingUpdates = []
      const currentSelectedLayerIds = (latestSelectedLayerIdsRef.current || [])
        .filter(id => latestLayersRef.current[id]?.sceneId === latestCurrentSceneIdRef.current)
      const currentLayers = latestLayersRef.current
      const currentLayerObjectsMap = latestLayerObjectsMapRef.current

      currentSelectedLayerIds.forEach((layerId) => {
        const initialState = initialLayerStates.get(layerId)
        if (!initialState) return

        const layer = currentLayers[layerId]
        const layerObject = currentLayerObjectsMap?.get(layerId)
        if (!layer || !layerObject || layerObject.destroyed) return

        // Calculate the element's top-left corner position relative to the original bounding box
        // Use boundsX and boundsY which represent the actual visual top-left of the element
        const elementTopLeftX = initialState.boundsX
        const elementTopLeftY = initialState.boundsY

        // Calculate relative position (0-1) of the top-left corner within the original bounding box
        // Clamp to [0, 1] to ensure it stays within bounds
        const relativeX = Math.max(0, Math.min(1, (elementTopLeftX - startBoxX) / startBoxWidth))
        const relativeY = Math.max(0, Math.min(1, (elementTopLeftY - startBoxY) / startBoxHeight))

        // For text elements, handle dimensions differently
        const isTextElement = initialState.isTextElement || (layerObject instanceof PIXI.Text)

        // Calculate new dimensions first
        let newWidth = Math.max(10, initialState.width * scaleX)
        let newHeight = Math.max(10, initialState.height * scaleY)

        // For text elements, height should be recalculated from actual bounds, not scaled directly
        // Use a temporary height estimate for position calculation, will be corrected after text updates
        if (isTextElement) {
          // Use scaleX for text height estimate (proportional to width) since text height scales with font size
          newHeight = Math.max(initialState.height * scaleX, initialState.initialFontSize || 24)
        }

        // Calculate new top-left position in the new bounding box
        // Ensure the element fits within the box by constraining the position
        const newTopLeftX = newBoxX + (relativeX * newBoxWidth)
        const newTopLeftY = newBoxY + (relativeY * newBoxHeight)

        // Constrain the element to stay within the new bounding box
        // The element's right edge should not exceed the box's right edge
        // The element's bottom edge should not exceed the box's bottom edge
        const constrainedTopLeftX = Math.min(newTopLeftX, newBoxX + newBoxWidth - newWidth)
        const constrainedTopLeftY = Math.min(newTopLeftY, newBoxY + newBoxHeight - newHeight)
        // Also ensure it doesn't go before the box's left/top edges
        const finalTopLeftX = Math.max(newBoxX, constrainedTopLeftX)
        const finalTopLeftY = Math.max(newBoxY, constrainedTopLeftY)

        // Calculate new position based on anchor point
        // The bounds represent the top-left of the visual bounds, so we need to adjust
        // based on the anchor point to get the actual layer position
        const anchorX = initialState.anchorX
        const anchorY = initialState.anchorY

        // The bounds top-left is at: layerX - (width * anchorX)
        // So: layerX = boundsX + (width * anchorX)
        // For text elements, anchorY is 0, so newY = finalTopLeftY
        const newX = finalTopLeftX + (newWidth * anchorX)
        const newY = finalTopLeftY + (newHeight * anchorY)

        // Update visual position and dimensions immediately (for smooth feedback)
        const targetObject = layerObject._cachedSprite || layerObject
        if (targetObject && !targetObject.destroyed) {
          targetObject.x = newX
          targetObject.y = newY

          // Mark as resizing to prevent useCanvasLayers from interfering
          targetObject._isResizing = true
          if (layerObject._cachedSprite && layerObject._cachedSprite !== targetObject) {
            layerObject._cachedSprite._isResizing = true
          }
        }

        // For graphics objects (shapes), redraw directly for immediate visual feedback
        if (layer.type === 'shape' && layerObject instanceof PIXI.Graphics && layer.data) {
          const shapeData = layer.data
          const anchorX = initialState.anchorX
          const anchorY = initialState.anchorY

          // Calculate anchor offset
          const anchorOffsetX = -newWidth * anchorX
          const anchorOffsetY = -newHeight * anchorY

          // Parse colors
          const fill = shapeData.fill && shapeData.fill !== 'transparent' && shapeData.fill !== null
            ? parseInt(shapeData.fill.replace('#', ''), 16)
            : null
          let stroke = null
          if (shapeData.stroke && shapeData.stroke !== '') {
            const strokeHex = shapeData.stroke.replace('#', '')
            if (strokeHex && /^[0-9A-Fa-f]{6}$/.test(strokeHex)) {
              stroke = parseInt(strokeHex, 16)
            }
          } else if (shapeData.strokeWidth > 0) {
            stroke = 0x000000
          }
          const strokeWidth = shapeData.strokeWidth || 0
          const strokeStyle = shapeData.strokeStyle || 'solid'

          // Determine shape type and drawing parameters
          const shapeType = shapeData.shapeType || 'rect'
          const isCircle = shapeType === 'circle'

          layerObject.clear()

          // Draw the shape path based on type (needed for fill)
          const centerX = anchorOffsetX + newWidth / 2
          const centerY = anchorOffsetY + newHeight / 2

          // drawShapePath fills exactly newWidth × newHeight — keeps PIXI bbox in sync with layer dims
          drawShapePath(layerObject, shapeType, centerX, centerY, newWidth, newHeight, shapeData.cornerRadius || 0)

          // Apply fill
          if (fill !== null) {
            layerObject.fill(fill)
          } else {
            layerObject.fill({ color: 0x000000, alpha: 0 })
          }

          // Apply stroke
          if (stroke !== null && strokeWidth > 0) {
            const isDashed = strokeStyle === 'dashed'
            const isDotted = strokeStyle === 'dotted'

            if (isDashed || isDotted) {
              // Dashed circles fall back to solid; others use dashed bounding rect
              if (isCircle) {
                layerObject.ellipse(centerX, centerY, newWidth / 2, newHeight / 2)
              }
              layerObject.stroke({ color: stroke, width: strokeWidth })
            } else {
              // Redraw path so solid stroke follows the exact shape outline
              drawShapePath(layerObject, shapeType, centerX, centerY, newWidth, newHeight, shapeData.cornerRadius || 0)
              layerObject.stroke({ color: stroke, width: strokeWidth })
            }
          }
        }

        // For text elements, handle fontSize scaling and height recalculation BEFORE creating updates
        let finalHeight = newHeight
        let finalY = newY
        let fontSizeUpdate = null

        if (isTextElement && layerObject instanceof PIXI.Text) {
          const isCornerHandle = ['nw', 'ne', 'sw', 'se'].includes(handleType)

          if (isCornerHandle && initialState.initialFontSize) {
            // Corner handles: scale font size proportionally with width
            const newFontSize = Math.max(8, initialState.initialFontSize * scaleX)

            // Update font size visually immediately
            if (layerObject.style) {
              layerObject.style.fontSize = newFontSize
            }

            fontSizeUpdate = newFontSize
          }

          // Update wordWrapWidth for all text resize operations
          if (layerObject.style) {
            layerObject.style.wordWrap = true
            layerObject.style.wordWrapWidth = newWidth

            // Force text to recalculate layout
            layerObject.text = layerObject.text

            // Recalculate actual height from text bounds after applying width/fontSize changes
            // This ensures the text stays within the selection box
            // OPTIMIZED: Cache bounds to avoid repeated calculations during rapid resize
            // Store the latest world position for detached badge positioning
            if (!state.lastWorldPos) state.lastWorldPos = { x: 0, y: 0 }
            state.lastWorldPos.x = newX
            state.lastWorldPos.y = finalY

            const cacheKey = `${layerId}_${newWidth}_${fontSizeUpdate || initialState.initialFontSize}_${layerObject.text}`
            let textBounds = null

            // Check if we have a cached bounds for this state
            if (!state._textBoundsCache) state._textBoundsCache = new Map()
            if (state._textBoundsCache.has(cacheKey)) {
              textBounds = state._textBoundsCache.get(cacheKey)
            } else {
              try {
                textBounds = layerObject.getLocalBounds(true)
                if (textBounds && textBounds.height > 0) {
                  // Cache the result (limit cache size to prevent memory issues)
                  if (state._textBoundsCache.size > 10) {
                    const firstKey = state._textBoundsCache.keys().next().value
                    state._textBoundsCache.delete(firstKey)
                  }
                  state._textBoundsCache.set(cacheKey, textBounds)
                }
              } catch (e) {
                // If bounds calculation fails, use cached value or fallback
              }
            }

            if (textBounds && textBounds.height > 0) {
              // Update height to match actual text bounds
              finalHeight = Math.max(textBounds.height, initialState.initialFontSize || 24)

              // Adjust position if height changed significantly from our estimate
              // Since anchorY is 0 for text, we need to adjust Y to keep top edge aligned
              const estimatedHeight = initialState.height * scaleX
              const heightDelta = finalHeight - estimatedHeight
              if (Math.abs(heightDelta) > 1) {
                // Adjust Y position to keep text top edge aligned (anchorY = 0)
                finalY = newY - heightDelta
                targetObject.y = finalY
              }
            } else {
              // Fallback: use proportional height if bounds calculation fails
              finalHeight = Math.max(initialState.height * scaleX, initialState.initialFontSize || 24)
            }
          }
        }

        // Prepare updates (don't mutate layer object - it's read-only from Redux)
        const updates = {
          x: newX,
          y: finalY,
          width: newWidth,
          height: finalHeight,
        }

        // Add fontSize update if applicable
        if (fontSizeUpdate !== null) {
          if (!updates.data) updates.data = {}
          updates.data.fontSize = fontSizeUpdate
        }

        // Handle Motion Capture Mode
        if (motionCaptureMode?.isActive) {
          if (isNaN(newX) || isNaN(finalY) || isNaN(newWidth) || isNaN(finalHeight)) {
            console.error('UseMultiSelectionBox: Invalid resize values for motion capture:', { newX, finalY, newWidth, finalHeight })
          }

          // [CONTROL POINTS FIX] Preserve existing control points during resize
          // Control points are relative to initialTransform, so they remain valid after resize
          const trackedLayer = motionCaptureMode.trackedLayers?.get(layerId)
          const existingControlPoints = trackedLayer?.controlPoints
          const hasControlPoints = existingControlPoints && Array.isArray(existingControlPoints) && existingControlPoints.length > 0

          // [PERFORMANCE] Only include controlPoints in update if they exist (avoid passing undefined)
          const updateData = {
            layerId,
            x: newX,
            y: finalY,
            width: newWidth,
            height: finalHeight,
            rotation: trackedLayer?.rotation ?? (layer.rotation || 0),
            scaleX: trackedLayer?.scaleX ?? (layer.scaleX || 1),
            scaleY: trackedLayer?.scaleY ?? (layer.scaleY || 1),
            // Preserve crop state
            cropX: trackedLayer?.cropX ?? (layer.cropX || 0),
            cropY: trackedLayer?.cropY ?? (layer.cropY || 0),
            cropWidth: trackedLayer?.cropWidth ?? (layer.cropWidth || layer.width || 100),
            cropHeight: trackedLayer?.cropHeight ?? (layer.cropHeight || layer.height || 100),
            mediaWidth: trackedLayer?.mediaWidth ?? layer.mediaWidth,
            mediaHeight: trackedLayer?.mediaHeight ?? layer.mediaHeight,
            interactionType: 'scale',
            data: updates.data // Pass data updates (fontSize)
          }

          // [CRITICAL] Only include controlPoints if they exist - this preserves them without overwriting
          if (hasControlPoints) {
            updateData.controlPoints = existingControlPoints
          }

          motionCaptureMode.onPositionUpdate(updateData)

          // [OPTIMIZATION] Synchronously update the live ref so the Ticker sees it THIS frame,
          // without waiting for React to re-render MotionPanel and pass down the new props.
          if (latestMotionCaptureModeRef.current && latestMotionCaptureModeRef.current.trackedLayers) {
            const liveLayer = latestMotionCaptureModeRef.current.trackedLayers.get(layerId)
            if (liveLayer) {
              liveLayer.currentPosition = { x: newX, y: finalY }
              liveLayer.width = newWidth
              liveLayer.height = finalHeight
            }
          }
        } else {
          // Store for Redux update only if not in motion capture mode
          pendingUpdates.push({
            layerId,
            updates
          })
        }
      })

      // LIVE PERFORMANCE FIX: Sync motion arrows immediately after resizing objects
      // This bypasses React/Redux for 60fps updates during the interaction
      if (motionCaptureMode?.isActive && interactionsAPIRef?.current) {
        interactionsAPIRef.current.syncArrows()
      }

      // Store pending updates
      state.pendingUpdates = pendingUpdates

      // Dispatch updates using requestAnimationFrame for smooth 60fps updates
      // This ensures useCanvasLayers redraws the graphics with new dimensions
      // Using requestAnimationFrame instead of Date.now() for better frame synchronization
      if (!state.dispatchFrameId) {
        state.dispatchFrameId = requestAnimationFrame(() => {
          if (state.pendingUpdates && state.pendingUpdates.length > 0) {
            state.pendingUpdates.forEach(({ layerId, updates }) => {
              dispatch(updateLayer({ id: layerId, ...updates }))
            })
            state.pendingUpdates = []
          }
          state.dispatchFrameId = null
        })
      }

      // Variables already declared or scoped correctly at the top of handleMultiResizeMove

      // Calculate the combined bounds of all selected layers based on their LATEST PIXI STATE
      // We pass null for motionCaptureMode here as we want the direct visual state
      // CRITICAL FIX: In Motion Capture mode, Redux is stale, so getCombinedLayerBounds returns old bounds.
      // Instead of recalculating, we should use the newBox variables we just calculated!
      // This ensures the box matches the visual state of the dragged handles.

      let finalBoxX = newBoxX
      let finalBoxY = newBoxY
      let finalBoxWidth = newBoxWidth
      let finalBoxHeight = newBoxHeight

      // Loop through all selected layers in the current scene
      const currentSelectedLayerIdsInScene = (latestSelectedLayerIdsRef.current || [])
        .filter(id => latestLayersRef.current[id]?.sceneId === latestCurrentSceneIdRef.current)

      // Only recalculate if we are NOT in motion capture mode (to ensure sync with Redux rounding/constraints)
      if (!motionCaptureMode?.isActive) {
        const refinedBounds = getCombinedLayerBounds(currentSelectedLayerIdsInScene, currentLayers, currentLayerObjectsMap)
        if (refinedBounds) {
          finalBoxX = refinedBounds.x
          finalBoxY = refinedBounds.y
          finalBoxWidth = refinedBounds.width
          finalBoxHeight = refinedBounds.height
        }
      }

      // Update selection box visual during resize
      const box = selectionBoxRef.current
      const currentStageContainer = latestStageContainerRef.current

      if (!box || box.destroyed) return

      // Ensure box is visible and in the stage
      box.visible = true
      if (!box.parent && currentStageContainer) {
        currentStageContainer.addChild(box)
      }

      // Sync box to refined bounds
      box.x = finalBoxX
      box.y = finalBoxY
      box.rotation = 0 // Reset rotation as refinedBounds is AABB

      // Update hit area for the refined box
      // box.hitArea update removed to prefer bodyHit child
      // box.hitArea = new PIXI.Rectangle(0, 0, finalBoxWidth, finalBoxHeight)

      // Get current zoom for consistent handle positioning
      const viewportInstance = latestViewportRef.current
      const zoomScale = viewportInstance ? (1 / (viewportInstance.scale.x || 1)) : 1

      // Update outline - find by label once and cache for this session if possible
      // For now, we use label lookup but it's much faster than re-creating
      let outline = box.children.find(child => child.label === 'multi-selection-outline')
      if (outline) {
        outline.clear()
        drawDashedRect(outline, 0, 0, finalBoxWidth, finalBoxHeight, 0, 0x8B5CF6, 1.5 * zoomScale, 10, 5)
      }

      // Update handle positions based on refined dimensions
      const handles = box.children.filter(child => child.label === 'resize-handle')
      handles.forEach(handle => {
        if (handle && !handle.destroyed) {
          const hType = handle.handleType
          if (hType === 'nw') handle.position.set(0, 0)
          else if (hType === 'ne') handle.position.set(finalBoxWidth, 0)
          else if (hType === 'sw') handle.position.set(0, finalBoxHeight)
          else if (hType === 'se') handle.position.set(finalBoxWidth, finalBoxHeight)
          else if (hType === 'n') handle.position.set(finalBoxWidth / 2, 0)
          else if (hType === 's') handle.position.set(finalBoxWidth / 2, finalBoxHeight)
          else if (hType === 'w') handle.position.set(0, finalBoxHeight / 2)
          else if (hType === 'e') handle.position.set(finalBoxWidth, finalBoxHeight / 2)
        }
      })

      const rotateHandle = box.children.find(child => child.label === 'rotate-handle')
      if (rotateHandle && !rotateHandle.destroyed) {
        const baseScale = calculateAdaptedScale(zoomScale)
        const rotateRadius = 18 * baseScale
        rotateHandle.x = finalBoxWidth / 2
        rotateHandle.y = finalBoxHeight + rotateRadius + (45 * baseScale)
      }

      // Update bodyHit dimensions (custom hit area)
      const bodyHit = box.children.find(child => child.label === 'body-hit')
      if (bodyHit && !bodyHit.destroyed) {
        bodyHit.clear()
        bodyHit.rect(0, 0, finalBoxWidth, finalBoxHeight)
        bodyHit.fill({ color: 0x000000, alpha: 0.01 })
      }

      // =========================================================================
      // DETACHED DIMENSIONS BADGE - Follows mouse for parity with single-select
      // =========================================================================
      // viewportInstance hoisted above
      const currentLayersContainer = latestLayersContainerRef.current

      if (viewportInstance && currentLayersContainer) {
        // Use the world coordinates of the mouse for the badge
        const rState = resizeStateRef.current
        if (rState && rState.lastWorldPos) {
          const worldPos = rState.lastWorldPos
          const viewportScale = viewportInstance.scale.x || 1
          // zoomScale hoisted above
          const zoomScale = 1 / viewportScale

          // Manage detached badge
          let badge = dimensionsBadgeRef.current
          if (!badge || badge.destroyed) {
            badge = createDimensionsBadge({
              width: finalBoxWidth,
              height: finalBoxHeight,
              zoomScale: zoomScale
            })
            dimensionsBadgeRef.current = badge
            currentLayersContainer.addChild(badge)
          }

          // Initial position near mouse for parity (offset BOTTOM-RIGHT)
          badge.x = worldPos.x + (96 * zoomScale)
          badge.y = worldPos.y + (48 * zoomScale)
          badge.zIndex = 10002

          updateDimensionsBadge(badge, {
            width: finalBoxWidth,
            height: finalBoxHeight,
            zoomScale: zoomScale,
            viewportScale: viewportScale
          })
        }
      }
    }

    // =========================================================================
    // MULTI-ROTATE HANDLERS
    // =========================================================================

    function handleMultiRotateStart(startEvent) {
      const currentViewport = latestViewportRef.current
      if (!currentViewport) return

      startEvent.stopPropagation()
      const startWorldPos = currentViewport.toWorld(startEvent.data.global.x, startEvent.data.global.y)

      const currentSelectedLayerIds = (latestSelectedLayerIdsRef.current || [])
        .filter(id => latestLayersRef.current[id]?.sceneId === latestCurrentSceneIdRef.current)
      const currentLayers = latestLayersRef.current
      const currentLayerObjectsMap = latestLayerObjectsMapRef.current

      // Calculate the common center of all selected layers
      const bounds = calculateCombinedBounds(currentSelectedLayerIds, currentLayers, currentLayerObjectsMap, motionCaptureMode)
      if (!bounds) return

      const centerX = bounds.x + bounds.width / 2
      const centerY = bounds.y + bounds.height / 2

      // Capture initial state including current overall rotation (relative to vertical)
      const startAngle = Math.atan2(startWorldPos.y - centerY, startWorldPos.x - centerX)

      const initialLayerStates = new Map()
      currentSelectedLayerIds.forEach(id => {
        const layer = currentLayers[id]
        const obj = currentLayerObjectsMap.get(id)
        if (layer && obj && !obj.destroyed) {
          // CRITICAL FIX: Use tracked state in Motion Capture mode
          if (motionCaptureMode?.isActive) {
            const trackedLayer = motionCaptureMode.trackedLayers?.get(id)
            if (trackedLayer) {
              // Determine current visual properties from tracked data
              const currentX = trackedLayer.currentPosition?.x ?? layer.x
              const currentY = trackedLayer.currentPosition?.y ?? layer.y
              const currentRotation = trackedLayer.rotation ?? layer.rotation ?? 0
              const currentRotationRad = (currentRotation * Math.PI) / 180
              const currentScaleX = trackedLayer.scaleX ?? 1
              const currentScaleY = trackedLayer.scaleY ?? 1

              initialLayerStates.set(id, {
                x: currentX,
                y: currentY,
                rotation: currentRotation, // degrees
                // Store vector from common center to layer center
                dx: currentX - centerX,
                dy: currentY - centerY,
                scaleX: currentScaleX, // Store initial scale for motion capture
                scaleY: currentScaleY
              })
              return
            }
          }

          initialLayerStates.set(id, {
            x: obj.x,
            y: obj.y,
            rotation: (obj.rotation * 180) / Math.PI,
            // Store vector from common center to layer center
            dx: obj.x - centerX,
            dy: obj.y - centerY,
            scaleX: obj.scale.x, // Store initial scale for motion capture
            scaleY: obj.scale.y
          })
        }
      })

      const box = selectionBoxRef.current
      rotateStateRef.current = {
        centerX,
        centerY,
        startAngle,
        initialRotation: box ? (box.rotation * 180) / Math.PI : 0,
        initialBoxX: box ? box.x : bounds.x,
        initialBoxY: box ? box.y : bounds.y,
        initialBoxWidth: box ? bounds.width : 0,
        initialBoxHeight: box ? bounds.height : 0,
        initialLayerStates
      }

      pauseViewportDragPlugin(currentViewport)

      function onMove(e) {
        if (!rotateStateRef.current) return
        const viewportInstance = latestViewportRef.current
        if (!viewportInstance) return

        const worldPos = viewportInstance.toWorld(e.data.global.x, e.data.global.y)
        handleMultiRotateMove(worldPos.x, worldPos.y)
      }

      function onEnd() {
        if (!rotateStateRef.current) return
        const state = rotateStateRef.current

        // Finalize Redux updates
        if (!motionCaptureMode?.isActive) {
          state.initialLayerStates.forEach((initial, id) => {
            const obj = currentLayerObjectsMap.get(id)
            if (obj && !obj.destroyed) {
              const rotation = (obj.rotation * 180) / Math.PI
              dispatch(updateLayer({
                id,
                x: obj.x,
                y: obj.y,
                rotation
              }))
            }
          })
        }

        if (box && !box.destroyed) {
          box.pivot.set(0, 0)
          box.rotation = 0
          // Force immediate bounds update logic in next render
        }
        rotateStateRef.current = null
        resumeViewportDragPlugin(currentViewport)

        const renderer = currentViewport.parent?.parent?.renderer || currentViewport.parent?.renderer
        if (renderer?.events) {
          renderer.events.off('globalpointermove', onMove)
          renderer.events.off('pointerup', onEnd)
          renderer.events.off('pointerupoutside', onEnd)
        } else {
          currentViewport.off('globalpointermove', onMove)
          currentViewport.off('pointerup', onEnd)
          currentViewport.off('pointerupoutside', onEnd)
        }

        // Cleanup detached badge
        if (rotationBadgeRef.current) {
          if (rotationBadgeRef.current.parent) {
            rotationBadgeRef.current.parent.removeChild(rotationBadgeRef.current)
          }
          rotationBadgeRef.current.destroy({ children: true })
          rotationBadgeRef.current = null
        }
        triggerUpdate()
      }

      const renderer = currentViewport.parent?.parent?.renderer || currentViewport.parent?.renderer
      if (renderer?.events) {
        renderer.events.on('globalpointermove', onMove)
        renderer.events.on('pointerup', onEnd)
        renderer.events.on('pointerupoutside', onEnd)
      } else {
        currentViewport.on('globalpointermove', onMove)
        currentViewport.on('pointerup', onEnd)
        currentViewport.on('pointerupoutside', onEnd)
      }
    }

    function handleMultiRotateMove(mouseX, mouseY) {
      const state = rotateStateRef.current
      if (!state) return

      const { centerX, centerY, startAngle, initialLayerStates } = state
      const currentAngle = Math.atan2(mouseY - centerY, mouseX - centerX)
      let angleDeltaRad = currentAngle - startAngle
      const deg = Math.round(angleDeltaRad * 180 / Math.PI) // Fixed: deg variable definition

      const currentLayerObjectsMap = latestLayerObjectsMapRef.current
      const currentLayers = latestLayersRef.current
      const cos = Math.cos(angleDeltaRad)
      const sin = Math.sin(angleDeltaRad)

      initialLayerStates.forEach((initial, id) => {
        const obj = currentLayerObjectsMap.get(id)
        if (obj && !obj.destroyed) {
          // Rotate the offset vector
          const newDx = initial.dx * cos - initial.dy * sin
          const newDxSnapped = initial.dx * cos - initial.dy * sin
          const newDy = initial.dx * sin + initial.dy * cos

          obj.x = centerX + newDx
          obj.y = centerY + newDy
          obj.rotation = (initial.rotation + (angleDeltaRad * 180 / Math.PI)) * Math.PI / 180

          // Handle Motion Capture Mode
          if (motionCaptureMode?.isActive) {
            // [CONTROL POINTS FIX] Preserve existing control points during rotation
            // Control points are relative to initialTransform, so they remain valid after rotation
            const trackedLayer = motionCaptureMode.trackedLayers?.get(id)
            const existingControlPoints = trackedLayer?.controlPoints
            const hasControlPoints = existingControlPoints && Array.isArray(existingControlPoints) && existingControlPoints.length > 0
            const layer = currentLayers[id]

            // [PERFORMANCE] Only include controlPoints in update if they exist (avoid passing undefined)
            const updateData = {
              layerId: id,
              x: obj.x,
              y: obj.y,
              rotation: (obj.rotation * 180) / Math.PI,
              scaleX: trackedLayer?.scaleX ?? (initial.scaleX || 1),
              scaleY: trackedLayer?.scaleY ?? (initial.scaleY || 1),
              // Preserve crop state
              cropX: trackedLayer?.cropX ?? (layer?.cropX || 0),
              cropY: trackedLayer?.cropY ?? (layer?.cropY || 0),
              cropWidth: trackedLayer?.cropWidth ?? (layer?.cropWidth || layer?.width || 100),
              cropHeight: trackedLayer?.cropHeight ?? (layer?.cropHeight || layer?.height || 100),
              mediaWidth: trackedLayer?.mediaWidth ?? layer?.mediaWidth,
              mediaHeight: trackedLayer?.mediaHeight ?? layer?.mediaHeight,
              interactionType: 'rotate'
            }

            // [CRITICAL] Only include controlPoints if they exist - this preserves them without overwriting
            if (hasControlPoints) {
              updateData.controlPoints = existingControlPoints
            }

            motionCaptureMode.onPositionUpdate(updateData)

            // [OPTIMIZATION] Synchronously update the live ref so the Ticker sees it THIS frame, 
            // without waiting for React to re-render MotionPanel and pass down the new props.
            if (latestMotionCaptureModeRef.current && latestMotionCaptureModeRef.current.trackedLayers) {
              const liveLayer = latestMotionCaptureModeRef.current.trackedLayers.get(id)
              if (liveLayer) {
                liveLayer.currentPosition = { x: obj.x, y: obj.y }
                liveLayer.rotation = (obj.rotation * 180) / Math.PI
              }
            }
          }
        }
      })

      // LIVE PERFORMANCE FIX: Sync motion arrows immediately after rotating objects
      // This bypasses React/Redux for 60fps updates during the interaction
      if (motionCaptureMode?.isActive && interactionsAPIRef?.current) {
        interactionsAPIRef.current.syncArrows()
      }

      // =========================================================================
      // BOX ROTATION - Rotate the selection box WITH the layers
      // =========================================================================
      const box = selectionBoxRef.current
      if (box && !box.destroyed) {
        // Set pivot to center of rotation (relative to box top-left at rotation start)
        // Since the box was AABB at start, freshBoxX/Y was its top-left
        const pivotX = centerX - state.initialBoxX
        const pivotY = centerY - state.initialBoxY

        box.pivot.set(pivotX, pivotY)
        box.position.set(centerX, centerY)
        box.rotation = (state.initialRotation + deg) * Math.PI / 180

        // Rotation handle stays fixed relative to the box container
        // No need to manually update it here if it's placed correctly relative to pivot
      }

      // =========================================================================
      // DETACHED ROTATION BADGE - Follows mouse for parity with single-select
      // =========================================================================
      const viewportInstance = latestViewportRef.current
      const currentLayersContainer = latestLayersContainerRef.current

      if (viewportInstance && currentLayersContainer) {
        const viewportScale = viewportInstance.scale.x || 1
        const zoomScale = 1 / viewportScale

        // Manage detached badge
        let badge = rotationBadgeRef.current
        if (!badge || badge.destroyed) {
          badge = createRotationBadge({
            rotation: deg,
            zoomScale: zoomScale
          })
          rotationBadgeRef.current = badge
          currentLayersContainer.addChild(badge)
        }

        // Position near mouse for parity (offset BOTTOM-RIGHT)
        badge.x = mouseX + (96 * zoomScale)
        badge.y = mouseY + (48 * zoomScale)
        badge.zIndex = 10002

        updateRotationBadge(badge, {
          rotation: deg,
          zoomScale: zoomScale,
          viewportScale: viewportScale
        })
      }
    }

    // Cleanup
    return () => {
      // Don't cleanup during resize or rotate - let the end handlers do it
      if (resizeStateRef.current || rotateStateRef.current) {
        return
      }

      if (selectionBoxRef.current && !selectionBoxRef.current.destroyed) {
        if (selectionBoxRef.current.parent) {
          selectionBoxRef.current.parent.removeChild(selectionBoxRef.current)
        }
        selectionBoxRef.current.destroy({ children: true })
        selectionBoxRef.current = null
      }
    }
  }, [stageContainer, selectedLayerIds, layerObjectsMap, layers, viewport, isPlaying, motionCaptureMode, forceUpdate, currentSceneId, zoom])

  // API for external control (e.g. from useCanvasInteractions)
  const updateBoxPosition = (x, y) => {
    const box = selectionBoxRef.current
    if (box && !box.destroyed) { // Remove resizeStateRef check to allow external updates if needed, logic in useCanvasInteractions should handle conflicts
      box.x = x
      box.y = y
      // If we used pivot, we need to reset it or account for it
      if (box.rotation === 0) {
        box.pivot.set(0, 0)
      }
    }
  }

  const updateBoxBounds = () => {
    // Force a full bounds recalculation and redraw
    cachedBoundsRef.current = null
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (selectionBoxRef.current && !selectionBoxRef.current.destroyed) {
        if (selectionBoxRef.current.parent) selectionBoxRef.current.parent.removeChild(selectionBoxRef.current)
        selectionBoxRef.current.destroy({ children: true })
        selectionBoxRef.current = null
      }

      // Clean up pooled objects
      Object.keys(pooledObjectsRef.current).forEach(key => {
        const obj = pooledObjectsRef.current[key]
        if (obj && !obj.destroyed) {
          if (Array.isArray(obj)) {
            obj.forEach(item => {
              if (item && !item.destroyed) {
                item.destroy()
              }
            })
          } else if (!obj.destroyed) {
            obj.destroy()
          }
        }
      })
      pooledObjectsRef.current = {
        outline: null,
        handles: new Array(8).fill(null),
        rotateHandle: null,
        hitArea: null
      }

      // Cleanup detached badges
      if (dimensionsBadgeRef.current) {
        if (dimensionsBadgeRef.current.parent) {
          dimensionsBadgeRef.current.parent.removeChild(dimensionsBadgeRef.current)
        }
        dimensionsBadgeRef.current.destroy({ children: true })
        dimensionsBadgeRef.current = null
      }
      if (rotationBadgeRef.current) {
        if (rotationBadgeRef.current.parent) {
          rotationBadgeRef.current.parent.removeChild(rotationBadgeRef.current)
        }
        rotationBadgeRef.current.destroy({ children: true })
        rotationBadgeRef.current = null
      }

      // CRITICAL: Clear interaction flags on all layers that were part of this multi-selection
      // This ensures that if the hook unmounts during an interaction (e.g. scene switch),
      // the layers don't stay in a "stuck" interaction state.
      if (latestSelectedLayerIdsRef.current) {
        latestSelectedLayerIdsRef.current.forEach(layerId => {
          const layerObject = latestLayerObjectsMapRef.current?.get(layerId)
          if (layerObject) {
            layerObject._isResizing = false
            layerObject._isRotating = false
            if (layerObject._cachedSprite) {
              layerObject._cachedSprite._isResizing = false
              layerObject._cachedSprite._isRotating = false
            }
          }
        })
      }

      cachedBoundsRef.current = null
    }
  }, [])

  return {
    updateBoxPosition,
    updateBoxBounds
  }
}

