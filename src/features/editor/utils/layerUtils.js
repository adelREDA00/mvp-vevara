/**
 * Layer Management Utilities
 *
 * This module provides essential utilities for working with canvas layers during interactive
 * operations. It handles layer identification, bounds calculation, and state management
 * for multi-layer selection and transformation operations.
 *
 * Key features:
 * - Layer ID resolution from PIXI display objects
 * - Combined bounds calculation for multi-layer selections
 * - Background layer filtering for selection operations
 * - Initial layer state extraction for transformations
 * - Canvas boundary checking for layer positioning
 *
 * Used by: useDragSelectionBox, useCanvasInteractions, useMultiSelectionBox
 */

import * as PIXI from 'pixi.js'
import { getLayerWorldBounds } from './geometry'

/**
 * Finds the layer ID from a PIXI display object by traversing up the parent chain.
 * Checks for layer labels (layer-{id} format) or matches against a layer objects map.
 * 
 * @param {PIXI.DisplayObject} object - The PIXI object to find the layer ID for
 * @param {Map<string, PIXI.DisplayObject>} layerObjectsMap - Map of layerId -> PIXI object
 * @param {PIXI.Container} stageContainer - The stage container (stops traversal)
 * @param {PIXI.Container} viewport - The viewport (stops traversal)
 * @returns {string|null} The layer ID or null if not found
 */
export function findLayerIdFromObject(object, layerObjectsMap, stageContainer, viewport) {
  if (!object || !layerObjectsMap) return null

  // Search up the parent chain
  let current = object
  while (current && current !== stageContainer && current !== viewport) {
    // 1. Check for layer label (most direct)
    // Support multiple formats: 'layer-ID', 'layer-layer-ID', etc.
    if (current.label && typeof current.label === 'string') {
      const match = current.label.match(/layer-([a-zA-Z0-9_-]+)$/)
      if (match && match[1]) {
        return match[1]
      }
    }

    // 2. Exact match in the map
    for (const [layerId, pixiObject] of layerObjectsMap.entries()) {
      if (pixiObject === current) {
        return layerId
      }
    }
    current = current.parent
  }

  return null
}

/**
 * Filters out background layers from a list of layer IDs.
 * 
 * @param {string[]} layerIds - Array of layer IDs to filter
 * @param {Object} layers - Map of layerId -> layer data
 * @returns {string[]} Filtered array without background layers
 */
export function filterBackgroundLayers(layerIds, layers) {
  return layerIds.filter(id => {
    const layer = layers[id]
    return layer && layer.type !== 'background'
  })
}

/**
 * Calculates combined bounding box for multiple layers.
 * Uses PIXI object positions when available for accuracy.
 * 
 * @param {string[]} layerIds - Layer IDs to calculate bounds for
 * @param {Object} layers - Map of layerId -> layer data
 * @param {Map<string, PIXI.DisplayObject>} layerObjectsMap - Map of layerId -> PIXI object
 * @returns {Object|null} Combined bounds or null if no valid bounds
 */
export function calculateCombinedBounds(layerIds, layers, layerObjectsMap, motionCaptureMode = null) {
  if (!layerIds || layerIds.length === 0) return null

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let hasBounds = false

  layerIds.forEach((layerId) => {
    const layer = layers[layerId]
    if (!layer) return

    const layerObject = layerObjectsMap?.get(layerId)

    // Always use getLayerWorldBounds for consistent behavior with drag selection
    // This ensures the multi-selection box positioning matches the selection logic
    const bounds = getLayerWorldBounds(layer, layerObject, motionCaptureMode)

    if (bounds) {
      hasBounds = true
      minX = Math.min(minX, bounds.x)
      minY = Math.min(minY, bounds.y)
      maxX = Math.max(maxX, bounds.x + bounds.width)
      maxY = Math.max(maxY, bounds.y + bounds.height)
    }
  })

  if (!hasBounds) return null

  const width = maxX - minX
  const height = maxY - minY

  return {
    x: minX,
    y: minY,
    width,
    height,
    minX,
    minY,
    maxX,
    maxY,
    centerX: minX + width / 2,
    centerY: minY + height / 2
  }
}

/**
 * Gets the initial layer state for resize/transform operations.
 * 
 * @param {Object} layer - Layer data from Redux
 * @param {PIXI.DisplayObject} layerObject - PIXI display object
 * @returns {Object|null} Initial state or null if invalid
 */
export function getInitialLayerState(layer, layerObject) {
  if (!layer || !layerObject || layerObject.destroyed) return null

  const bounds = getLayerWorldBounds(layer, layerObject)
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null

  const isTextElement = layerObject instanceof PIXI.Text
  const anchorX = isTextElement ? 0 : (layer.anchorX !== undefined ? layer.anchorX : 0.5)
  const anchorY = isTextElement ? 0 : (layer.anchorY !== undefined ? layer.anchorY : 0.5)

  return {
    x: layer.x || 0,
    y: layer.y || 0,
    width: layer.width || bounds.width,
    height: layer.height || bounds.height,
    scaleX: layer.scaleX !== undefined ? layer.scaleX : 1,
    scaleY: layer.scaleY !== undefined ? layer.scaleY : 1,
    anchorX,
    anchorY,
    boundsX: bounds.x,
    boundsY: bounds.y,
    boundsWidth: bounds.width,
    boundsHeight: bounds.height,
    isTextElement,
    initialFontSize: isTextElement ? (layer.data?.fontSize || layerObject.style?.fontSize || 24) : null
  }
}

/**
 * Checks if a layer is completely outside canvas bounds.
 * 
 * @param {Object} layer - Layer data from Redux
 * @param {PIXI.DisplayObject} layerObject - PIXI display object
 * @param {number} worldWidth - Canvas world width
 * @param {number} worldHeight - Canvas world height
 * @returns {boolean} True if layer is completely outside canvas
 */
export function isLayerOutsideCanvas(layer, layerObject, worldWidth, worldHeight) {
  if (!layer || !layerObject || layerObject.destroyed || !worldWidth || !worldHeight) return false

  const width = layer.width || 100
  const height = layer.height || 100
  const scaleX = layer.scaleX !== undefined ? layer.scaleX : 1
  const scaleY = layer.scaleY !== undefined ? layer.scaleY : 1
  const isTextLayer = layerObject instanceof PIXI.Text
  const anchorX = isTextLayer ? 0 : (layer.anchorX !== undefined ? layer.anchorX : 0.5)
  const anchorY = isTextLayer ? 0 : (layer.anchorY !== undefined ? layer.anchorY : 0.5)
  const rotation = layer.rotation || 0

  const scaledWidth = width * scaleX
  const scaledHeight = height * scaleY
  const anchorOffsetX = -scaledWidth * anchorX
  const anchorOffsetY = -scaledHeight * anchorY

  const x = layer.x || 0
  const y = layer.y || 0

  // Calculate local corners before rotation
  const localCorners = [
    { x: anchorOffsetX, y: anchorOffsetY },
    { x: anchorOffsetX + scaledWidth, y: anchorOffsetY },
    { x: anchorOffsetX + scaledWidth, y: anchorOffsetY + scaledHeight },
    { x: anchorOffsetX, y: anchorOffsetY + scaledHeight }
  ]

  // Rotate corners around layer center
  const rotationRad = (rotation * Math.PI) / 180
  const cos = Math.cos(rotationRad)
  const sin = Math.sin(rotationRad)

  const worldCorners = localCorners.map(corner => ({
    x: x + corner.x * cos - corner.y * sin,
    y: y + corner.x * sin + corner.y * cos
  }))

  // Find bounding box of rotated corners
  const xs = worldCorners.map(c => c.x)
  const ys = worldCorners.map(c => c.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)

  return maxX < 0 || minX > worldWidth || maxY < 0 || minY > worldHeight
}

/**
 * Updates the z-order (render order) of a layer in the stage container.
 * Handles selection box priority to keep it on top.
 *
 * @param {PIXI.Container} stageContainer - The container holding all layers
 * @param {PIXI.DisplayObject} pixiObject - The PIXI object to reorder
 * @param {number} desiredIndex - The desired index in the layer order array
 * @returns {boolean} True if the z-order was updated, false if no change was needed
 */
export function updateLayerZOrder(stageContainer, pixiObject, desiredIndex) {
  if (!stageContainer || !pixiObject || desiredIndex === -1) return false

  const currentIndex = stageContainer.children.indexOf(pixiObject)

  if (currentIndex === desiredIndex) return false

  // Remove the child first
  stageContainer.removeChild(pixiObject)

  // After removal, find selection box index (it may have changed after removal)
  let selectionBoxIndex = -1
  for (let i = 0; i < stageContainer.children.length; i++) {
    if (stageContainer.children[i].label === 'selection-box') {
      selectionBoxIndex = i
      break
    }
  }

  // Calculate the target index, accounting for selection box
  // Get the current number of children (after removal)
  const currentChildCount = stageContainer.children.length

  let targetIndex = desiredIndex

  // If selection box exists and desired index is at or after it, insert before selection box
  // This keeps the selection box on top
  if (selectionBoxIndex !== -1 && desiredIndex >= selectionBoxIndex) {
    targetIndex = selectionBoxIndex
  }

  // Clamp to valid range: 0 to currentChildCount (inclusive)
  // addChildAt accepts indices from 0 to children.length (inclusive)
  targetIndex = Math.max(0, Math.min(targetIndex, currentChildCount))

  stageContainer.addChildAt(pixiObject, targetIndex)
  return true
}

