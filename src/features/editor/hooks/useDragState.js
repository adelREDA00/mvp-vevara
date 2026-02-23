/**
 * Custom hook that provides centralized drag state management.
 * This hook is used by both useCanvasInteractions and useSelectionBox
 * to share drag state information without direct property access.
 */

import { useRef, useCallback } from 'react'

/**
 * Hook that provides centralized drag state management
 * @returns {Object} Drag state API functions
 */
export function useDragState() {
  const isDraggingRef = useRef(false)
  const draggingLayerIdRef = useRef(null)
  const layerObjectsMapRef = useRef(new Map())
  const isResizingRef = useRef(false)
  const isRotatingRef = useRef(false)
  const interactionLayerIdRef = useRef(null)

  /**
   * Reset all drag state to initial values
   */
  const resetAllState = useCallback(() => {
    isDraggingRef.current = false
    draggingLayerIdRef.current = null
    isResizingRef.current = false
    isRotatingRef.current = false
    interactionLayerIdRef.current = null
  }, [])

  /**
   * Update the layer objects map reference
   * @param {Map} layerObjectsMap - Current layer objects map
   */
  const updateLayerObjectsMap = useCallback((layerObjectsMap) => {
    if (!layerObjectsMap || !(layerObjectsMap instanceof Map)) {
      // During initialization or if passed undefined/null, create a new empty Map
      layerObjectsMapRef.current = new Map()
      return
    }
    layerObjectsMapRef.current = layerObjectsMap
  }, [])

  /**
   * Set the current drag state
   * @param {boolean} isDragging - Whether dragging is active
   * @param {string} layerId - The ID of the layer being dragged (if any)
   */
  const setDragState = useCallback((isDragging, layerId = null) => {
    if (typeof isDragging !== 'boolean') {
      console.warn('useDragState: setDragState expects isDragging to be a boolean')
      return
    }
    if (layerId !== null && typeof layerId !== 'string') {
      console.warn('useDragState: setDragState expects layerId to be a string or null')
      return
    }

    // Prevent conflicting states - dragging and resizing/rotating should be mutually exclusive
    if (isDragging && (isResizingRef.current || isRotatingRef.current)) {
      console.warn('useDragState: Cannot start dragging while resizing or rotating is active. Resetting interaction state.')
      isResizingRef.current = false
      isRotatingRef.current = false
      interactionLayerIdRef.current = null
    }

    isDraggingRef.current = isDragging
    // Ensure layerId is cleared when dragging stops
    draggingLayerIdRef.current = isDragging ? layerId : null
  }, [])

  /**
   * Set the current resize/rotate interaction state
   * @param {boolean} isResizing - Whether resizing is active
   * @param {boolean} isRotating - Whether rotating is active
   * @param {string} layerId - The ID of the layer being interacted with (if any)
   */
  const setInteractionState = useCallback((isResizing, isRotating, layerId = null) => {
    if (typeof isResizing !== 'boolean' || typeof isRotating !== 'boolean') {
      console.warn('useDragState: setInteractionState expects isResizing and isRotating to be booleans')
      return
    }
    if (layerId !== null && typeof layerId !== 'string') {
      console.warn('useDragState: setInteractionState expects layerId to be a string or null')
      return
    }

    // Prevent conflicting states - resizing/rotating and dragging should be mutually exclusive
    if ((isResizing || isRotating) && isDraggingRef.current) {
      console.warn('useDragState: Cannot start resizing/rotating while dragging is active. Resetting drag state.')
      isDraggingRef.current = false
      draggingLayerIdRef.current = null
    }

    // Prevent both resizing and rotating at the same time
    if (isResizing && isRotating) {
      console.warn('useDragState: Cannot resize and rotate simultaneously. Prioritizing resizing.')
      isRotating = false
    }

    isResizingRef.current = isResizing
    isRotatingRef.current = isRotating
    // Ensure layerId is cleared when neither resizing nor rotating is active
    interactionLayerIdRef.current = (isResizing || isRotating) ? layerId : null
  }, [])

  /**
   * Check if any drag operation is currently active
   * @returns {boolean} True if any dragging is happening
   */
  const isDragging = useCallback(() => {
    return isDraggingRef.current
  }, [])

  /**
   * Check if any resize operation is currently active
   * @returns {boolean} True if any resizing is happening
   */
  const isResizing = useCallback(() => {
    return isResizingRef.current
  }, [])

  /**
   * Check if any rotate operation is currently active
   * @returns {boolean} True if any rotating is happening
   */
  const isRotating = useCallback(() => {
    return isRotatingRef.current
  }, [])

  /**
   * Check if any interaction (resize, rotate, or drag) is currently active
   * @returns {boolean} True if any interaction is happening
   */
  const isInteracting = useCallback(() => {
    return isDraggingRef.current || isResizingRef.current || isRotatingRef.current
  }, [])

  /**
   * Check if a specific layer is currently being dragged
   * @param {string} layerId - The layer ID to check
   * @returns {boolean} True if the layer is being dragged
   */
  const isLayerDragging = useCallback((layerId) => {
    if (!layerId || typeof layerId !== 'string') {
      console.warn('useDragState: isLayerDragging expects layerId to be a non-empty string')
      return false
    }
    return draggingLayerIdRef.current === layerId && isDraggingRef.current
  }, [])

  /**
   * Get the ID of the currently dragging layer
   * @returns {string|null} The layer ID being dragged, or null if not dragging
   */
  const getDraggingLayerId = useCallback(() => {
    return isDraggingRef.current ? draggingLayerIdRef.current : null
  }, [])

  /**
   * Get the ID of the currently interacting layer (resizing, rotating, or dragging)
   * @returns {string|null} The layer ID being interacted with, or null if not interacting
   */
  const getInteractionLayerId = useCallback(() => {
    if (isDraggingRef.current) return draggingLayerIdRef.current
    if (isResizingRef.current || isRotatingRef.current) return interactionLayerIdRef.current
    return null
  }, [])

  /**
   * Get comprehensive drag state for a specific layer
   * @param {string} layerId - The layer ID to check
   * @returns {Object} Drag state information
   */
  const getLayerDragState = useCallback((layerId) => {
    if (!layerId || typeof layerId !== 'string') {
      console.warn('useDragState: getLayerDragState expects layerId to be a non-empty string')
      return {
        isDragging: false,
        hasPositionOverrides: false,
        dragPosition: null
      }
    }

    const layerObjectsMap = layerObjectsMapRef.current
    // Ensure we have a valid Map instance
    if (!layerObjectsMap || !(layerObjectsMap instanceof Map)) {
      return {
        isDragging: false,
        hasPositionOverrides: false,
        dragPosition: null
      }
    }

    const layerObject = layerObjectsMap.get(layerId)
    if (!layerObject) {
      return {
        isDragging: false,
        hasPositionOverrides: false,
        dragPosition: null
      }
    }

    const isDraggingLayer = draggingLayerIdRef.current === layerId && isDraggingRef.current

    // Simplified position override logic - check both layerObject and cachedSprite
    const hasPositionOverrides = (layerObject._selectionBoxX !== undefined ||
                                  layerObject._selectionBoxY !== undefined) ||
                                 (layerObject._cachedSprite &&
                                  (layerObject._cachedSprite._selectionBoxX !== undefined ||
                                   layerObject._cachedSprite._selectionBoxY !== undefined))

    let dragPosition = null
    if (hasPositionOverrides) {
      // Prioritize cachedSprite if it exists and has position overrides, otherwise use layerObject
      const targetObj = layerObject._cachedSprite || layerObject
      dragPosition = {
        x: targetObj._selectionBoxX !== undefined ? targetObj._selectionBoxX : (layerObject._selectionBoxX || 0),
        y: targetObj._selectionBoxY !== undefined ? targetObj._selectionBoxY : (layerObject._selectionBoxY || 0)
      }
    }

    return {
      isDragging: isDraggingLayer,
      hasPositionOverrides,
      dragPosition
    }
  }, [])

  return {
    updateLayerObjectsMap,
    setDragState,
    setInteractionState,
    resetAllState,
    getDraggingLayerId,
    getInteractionLayerId,
    isDragging,
    isResizing,
    isRotating,
    isInteracting,
    isLayerDragging,
    getLayerDragState
  }
}
