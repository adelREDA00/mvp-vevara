/**
this hook is used to create a drag selection box that allows you to select multiple layers by dragging on the canvas
 */

import { useEffect, useRef, useCallback } from 'react'
import { useDispatch } from 'react-redux'
import * as PIXI from 'pixi.js'
import { setSelectedLayers } from '../../../store/slices/selectionSlice'
import { normalizeRect, layerIntersectsRect } from '../utils/geometry'
import { findLayerIdFromObject } from '../utils/layerUtils'
import { pauseViewportDragPlugin, resumeViewportDragPlugin } from '../utils/viewportUtils'

/**
 * Creates a drag selection box that allows selecting multiple layers
 * @param {PIXI.Container} stageContainer - Container with layers
 * @param {Object} layerObjectsMap - Map of layerId -> Pixi DisplayObject
 * @param {Object} layers - Map of layerId -> layer data
 * @param {Object} viewport - Viewport instance for coordinate conversion
 * @param {string[]} selectedLayerIds - Currently selected layer IDs
 * @param {string} activeTool - Current tool ('select', 'move', etc.)
 */
export function useDragSelectionBox(stageContainer, layerObjectsMap, layers, viewport, selectedLayerIds, activeTool, isPlaying = false, motionCaptureMode = null, currentSceneId = null) {
  const dispatch = useDispatch()
  const selectionBoxRef = useRef(null)
  const isDraggingRef = useRef(false)
  const dragStartRef = useRef(null)
  const latestStageContainerRef = useRef(stageContainer)
  const latestLayerObjectsMapRef = useRef(layerObjectsMap)
  const latestLayersRef = useRef(layers)
  const latestViewportRef = useRef(viewport)
  const latestSelectedLayerIdsRef = useRef(selectedLayerIds)
  const latestActiveToolRef = useRef(activeTool)
  const latestCurrentSceneIdRef = useRef(currentSceneId)

  // Keep refs updated
  latestStageContainerRef.current = stageContainer
  latestLayerObjectsMapRef.current = layerObjectsMap
  latestLayersRef.current = layers
  latestViewportRef.current = viewport
  latestSelectedLayerIdsRef.current = selectedLayerIds
  latestActiveToolRef.current = activeTool
  latestCurrentSceneIdRef.current = currentSceneId

  // Helper to find layer ID from Pixi object (using shared utility)
  const findLayerIdForObject = useCallback((object) => {
    return findLayerIdFromObject(
      object,
      latestLayerObjectsMapRef.current,
      latestStageContainerRef.current,
      latestViewportRef.current
    )
  }, [])

  // Create or update selection box graphics
  const updateSelectionBox = useCallback((x, y, width, height) => {
    const stageContainer = latestStageContainerRef.current
    if (!stageContainer) return

    let box = selectionBoxRef.current

    if (!box || box.destroyed) {
      // Create new selection box
      box = new PIXI.Graphics()
      box.label = 'drag-selection-box'
      box.eventMode = 'none' // Don't interfere with interactions
      box.zIndex = 10000 // Ensure it's on top
      stageContainer.addChild(box)
      selectionBoxRef.current = box
    }

    // Clear and redraw
    box.clear()

    // Normalize coordinates (handle negative width/height)
    const normalizedRect = normalizeRect(x, y, width, height)

    // Only draw if there's a meaningful size
    if (normalizedRect.width > 0 || normalizedRect.height > 0) {
      // Define the rectangle shape
      box.rect(normalizedRect.x, normalizedRect.y, normalizedRect.width, normalizedRect.height)

      // Apply fill (light purple with transparency)
      box.fill({ color: 0x9370db, alpha: 0.1 })

      // Apply stroke (purple border)
      box.stroke({ width: 2, color: 0x9370db, alpha: 1 })
    }

    // Make it visible
    box.visible = true
  }, [])

  // Remove selection box
  const removeSelectionBox = useCallback(() => {
    const box = selectionBoxRef.current
    if (box && !box.destroyed) {
      box.visible = false
      box.clear()
    }
  }, [])

  // Clean up selection box
  const destroySelectionBox = useCallback(() => {
    const box = selectionBoxRef.current
    if (box && !box.destroyed) {
      if (box.parent) {
        box.parent.removeChild(box)
      }
      box.destroy()
      selectionBoxRef.current = null
    }
  }, [])

  useEffect(() => {
    const stageContainer = latestStageContainerRef.current
    const viewport = latestViewportRef.current
    if (!stageContainer || !viewport) {
      return
    }

    // Get renderer for global events
    const renderer = viewport.parent?.parent?.renderer || viewport.parent?.renderer

    const handlePointerDown = (event) => {
      // Ignore right clicks for custom dragging (allow viewport panning to handle it)
      if (event.data?.button === 2 || event.button === 2 || event.data?.originalEvent?.button === 2) {
        return
      }

      // Don't work if playing
      if (isPlaying) {
        return
      }

      // Only work with select tool
      if (latestActiveToolRef.current !== 'select') {
        return
      }

      // Prevent text selection immediately
      event.preventDefault()

      const target = event.target

      // Skip if clicked on selection box or its handles
      let current = target
      while (current && current !== stageContainer && current !== viewport) {
        if (current.label === 'selection-box' ||
          current.parent?.label === 'selection-box' ||
          current.label === 'drag-selection-box' ||
          current.parent?.label === 'drag-selection-box' ||
          current.label === 'multi-selection-box' ||
          current.parent?.label === 'multi-selection-box') {
          return // Don't process - let selection box handle it
        }
        current = current.parent
      }

      // Get world position
      const worldPos = viewport.toWorld(event.data.global.x, event.data.global.y)
      const layerId = findLayerIdForObject(target)

      // CRITICAL: Only start drag selection if clicking on empty canvas (no layer found)
      // If a layer was found, let useCanvasInteractions handle element dragging instead
      if (layerId) {
        // Clicked on an element - don't start drag selection
        // Let useCanvasInteractions handle element dragging
        return
      }

      // Only start tracking drag selection on empty canvas
      // We'll determine if it's a drag or click based on movement
      // Don't stop propagation yet - let other handlers see the event
      // We'll stop propagation only if we detect actual dragging

      // Store initial position and target
      isDraggingRef.current = false // Start as false, will be set to true on first move
      dragStartRef.current = {
        x: worldPos.x,
        y: worldPos.y,
        screenX: event.data.global.x,
        screenY: event.data.global.y,
        target: target,
        layerId: null // No layer - empty canvas
      }

      // Pause viewport drag plugin temporarily (will resume if just a click)
      pauseViewportDragPlugin(viewport)
    }

    const handlePointerMove = (event) => {
      if (!dragStartRef.current) {
        return
      }

      // CRITICAL: Only proceed if we started from empty canvas (no layerId)
      // If dragStartRef has a layerId, it means we clicked on an element, so don't show drag selection box
      if (dragStartRef.current.layerId) {
        // Clicked on an element - cancel drag selection tracking
        dragStartRef.current = null
        isDraggingRef.current = false
        removeSelectionBox()

        // Resume viewport drag plugin
        resumeViewportDragPlugin(viewport)
        return
      }

      // Get current screen position
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

      // Check if we've moved enough to consider this a drag (not just a click)
      const moveDistance = Math.sqrt(
        Math.pow(globalX - dragStartRef.current.screenX, 2) +
        Math.pow(globalY - dragStartRef.current.screenY, 2)
      )

      // If moved less than 5 pixels, don't start drag selection yet (might be just a click)
      if (moveDistance < 5 && !isDraggingRef.current) {
        return
      }

      // This is a drag on empty canvas - start selection box
      if (!isDraggingRef.current) {
        isDraggingRef.current = true

        // Stop event propagation to prevent other handlers (like element dragging)
        event.stopPropagation()
        event.stopImmediatePropagation()

        // Create initial selection box
        updateSelectionBox(dragStartRef.current.x, dragStartRef.current.y, 0, 0)
      }

      // Stop propagation to prevent viewport panning during drag selection
      event.stopPropagation()

      const currentWorldPos = viewport.toWorld(globalX, globalY)

      // Calculate selection box dimensions
      const width = currentWorldPos.x - dragStartRef.current.x
      const height = currentWorldPos.y - dragStartRef.current.y

      // Update selection box visual
      updateSelectionBox(dragStartRef.current.x, dragStartRef.current.y, width, height)

      // Find all layers that intersect with the selection box
      const intersectingLayerIds = []
      const layers = latestLayersRef.current
      const layerObjectsMap = latestLayerObjectsMapRef.current

      if (layers && layerObjectsMap) {
        const selectionRect = normalizeRect(dragStartRef.current.x, dragStartRef.current.y, width, height)
        for (const [layerId, layerObject] of layerObjectsMap.entries()) {
          const layer = layers[layerId]
          // Filter by sceneId to only select layers in the current scene
          if (layer && layer.sceneId === latestCurrentSceneIdRef.current && layerObject && !layerObject.destroyed) {
            const intersects = layerIntersectsRect(layer, layerObject, selectionRect, motionCaptureMode)
            if (intersects) {
              intersectingLayerIds.push(layerId)
            }
          }
        }
      }

      // Update selection (but don't dispatch on every move to avoid performance issues)
      // We'll dispatch on pointer up instead
      // Store temporarily for pointer up
      dragStartRef.current.intersectingLayerIds = intersectingLayerIds
    }

    const handlePointerUp = (event) => {
      if (!dragStartRef.current) {
        removeSelectionBox()
        return
      }

      // If we never started dragging (just a click), clear selection
      if (!isDraggingRef.current) {
        // Clicked on empty canvas without dragging - let useCanvasInteractions handle canvas selection
        // Don't clear selection or do anything here - let the canvas interactions handler manage it

        dragStartRef.current = null

        // Re-enable viewport drag plugin
        resumeViewportDragPlugin(viewport)
        return
      }

      // We were dragging - finalize selection
      if (!isDraggingRef.current || !dragStartRef.current) {
        isDraggingRef.current = false
        dragStartRef.current = null
        removeSelectionBox()
        return
      }

      // Get final world position
      let globalX, globalY
      if (event.global) {
        globalX = event.global.x
        globalY = event.global.y
      } else if (event.data?.global) {
        globalX = event.data.global.x
        globalY = event.data.global.y
      }

      if (globalX !== undefined && globalY !== undefined) {
        const currentWorldPos = viewport.toWorld(globalX, globalY)
        const width = currentWorldPos.x - dragStartRef.current.x
        const height = currentWorldPos.y - dragStartRef.current.y
        const selectionRect = normalizeRect(dragStartRef.current.x, dragStartRef.current.y, width, height)

        // Only select if we dragged a meaningful distance (more than 5 pixels)
        const dragDistance = Math.sqrt(width * width + height * height)

        if (dragDistance > 5) {
          // Use stored intersecting layers or recalculate
          let intersectingLayerIds = dragStartRef.current.intersectingLayerIds || []

          if (intersectingLayerIds.length === 0) {
            // Recalculate if not stored
            const layers = latestLayersRef.current
            const layerObjectsMap = latestLayerObjectsMapRef.current

            if (layers && layerObjectsMap) {
              for (const [layerId, layerObject] of layerObjectsMap.entries()) {
                const layer = latestLayersRef.current[layerId]
                if (layer && layer.sceneId === latestCurrentSceneIdRef.current && layerObject && !layerObject.destroyed && layer.type !== 'background') {
                  const intersects = layerIntersectsRect(layer, layerObject, selectionRect, motionCaptureMode)
                  if (intersects) {
                    intersectingLayerIds.push(layerId)
                  }
                }
              }
            }
          }

          // Filter out background layers before selecting
          const nonBackgroundLayerIds = intersectingLayerIds.filter(layerId => {
            const layer = latestLayersRef.current[layerId]
            return layer && layer.type !== 'background'
          })

          // Select all intersecting non-background layers
          if (nonBackgroundLayerIds.length > 0) {
            dispatch(setSelectedLayers(nonBackgroundLayerIds))
          } else {
            // If no layers selected, clear selection
            dispatch(setSelectedLayers([]))
          }
        } else {
          // Small drag or click - clear selection
          dispatch(setSelectedLayers([]))
        }
      }

      // Re-enable viewport drag plugin
      resumeViewportDragPlugin(viewport)

      // Clean up
      isDraggingRef.current = false
      dragStartRef.current = null
      removeSelectionBox()
    }

    // Remove any existing handler first to avoid duplicates
    viewport.off('pointerdown', handlePointerDown)

    // Attach with normal priority - let canvas interactions handle simple clicks first
    viewport.on('pointerdown', handlePointerDown)

    if (renderer?.events) {
      renderer.events.on('globalpointermove', handlePointerMove)
      renderer.events.on('pointerup', handlePointerUp)
      renderer.events.on('pointerupoutside', handlePointerUp)
    } else {
      viewport.on('globalpointermove', handlePointerMove)
      viewport.on('pointerup', handlePointerUp)
      viewport.on('pointerupoutside', handlePointerUp)
    }

    // Cleanup
    return () => {
      viewport.off('pointerdown', handlePointerDown)

      if (renderer?.events) {
        renderer.events.off('globalpointermove', handlePointerMove)
        renderer.events.off('pointerup', handlePointerUp)
        renderer.events.off('pointerupoutside', handlePointerUp)
      } else {
        viewport.off('globalpointermove', handlePointerMove)
        viewport.off('pointerup', handlePointerUp)
        viewport.off('pointerupoutside', handlePointerUp)
      }

      destroySelectionBox()
    }
  }, [stageContainer, viewport, isPlaying, motionCaptureMode, currentSceneId]) // Re-run when stageContainer, viewport, isPlaying, motionCaptureMode, or currentSceneId changes

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      destroySelectionBox()
    }
  }, [destroySelectionBox])
}

