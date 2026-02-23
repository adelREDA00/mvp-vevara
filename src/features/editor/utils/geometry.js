import * as PIXI from 'pixi.js'
import { LAYER_TYPES } from '../../../store/models'

const DEFAULT_DIMENSION = 100

// =============================================================================
// TEXT HANDLING UTILITIES
// =============================================================================

// Get accurate text dimensions using TextMetrics
export function getTextDimensions(text, style, wordWrapWidth) {
  try {
    const metrics = PIXI.TextMetrics.measureText(text, new PIXI.TextStyle({ ...style, wordWrap: true, wordWrapWidth: wordWrapWidth, breakWords: true, lineHeight: (style.fontSize || 24) * 1.2 }))
    return { width: metrics.width, height: metrics.height }
  } catch (error) {
    const tempText = new PIXI.Text({ text: text, style: { ...style, wordWrap: true, wordWrapWidth: wordWrapWidth, breakWords: true, lineHeight: (style.fontSize || 24) * 1.2 } })
    const bounds = tempText.getBounds()
    tempText.destroy()
    return { width: bounds.width, height: bounds.height }
  }
}

// Calculate current text dimensions for PIXI Text objects
export function calculateTextDimensions(textObject, layer, wordWrapWidth = null) {
  const currentLogicalWidth = wordWrapWidth || textObject.style?.wordWrapWidth || layer?.width || 100
  if (textObject._isResizing) {
    textObject.updateText?.(true)
    const localBounds = textObject.getLocalBounds()
    if (localBounds.height > 0) return { width: currentLogicalWidth, height: localBounds.height }
  }
  try {
    const localBounds = textObject.getLocalBounds()
    if (localBounds.width > 0 && localBounds.height > 0) return { width: currentLogicalWidth, height: localBounds.height }
  } catch (e) { }
  try {
    const content = textObject.text || layer?.data?.content || 'Text'
    const style = textObject.style
    const textDimensions = getTextDimensions(content, style, currentLogicalWidth)
    return { width: currentLogicalWidth, height: Math.max(textDimensions.height, layer?.height || 50) }
  } catch (e) {
    return { width: currentLogicalWidth, height: layer?.height || 50 }
  }
}

// =============================================================================
// PIXI OBJECT SAFETY UTILITIES
// =============================================================================

// Get a safe version of a visual object, using cached copy if available
function getSafeDisplayObject(layerObject) {
  if (!layerObject || layerObject.destroyed) {
    return null
  }

  const cached = layerObject._cachedSprite
  if (cached && !cached.destroyed) {
    return cached
  }

  return layerObject
}

// =============================================================================
// CORE GEOMETRY UTILITIES
// =============================================================================

export function resolveAnchors(layer, layerObject) {
  // CRITICAL FIX: Text layers are rendered with a center pivot to allow rotation around their center.
  // This means that for geometry/bounds calculations, they effectively have an anchor of (0.5, 0.5),
  // regardless of the internal text alignment anchor (which is used for text justification).
  if (layer?.type === 'text') {
    return { anchorX: 0.5, anchorY: 0.5 }
  }

  // Priority: 1. layer property, 2. custom object property (for Containers), 3. object's anchor property, 4. default 0.5
  const anchorX = layer.anchorX !== undefined ? layer.anchorX : (layerObject?.anchorX ?? layerObject?.anchor?.x ?? 0.5)
  const anchorY = layer.anchorY !== undefined ? layer.anchorY : (layerObject?.anchorY ?? layerObject?.anchor?.y ?? 0.5)
  return { anchorX, anchorY }
}

function resolveDimension(layerDim, fallback) {
  if (typeof layerDim === 'number' && layerDim > 0) {
    return layerDim
  }
  return fallback || DEFAULT_DIMENSION
}

/**
 * Calculates the world bounds of a layer, accounting for position, scale, rotation, and anchors.
 * Supports motion capture mode to use tracked dimensions/positions when active.
 * 
 * @param {Object} layer - Redux layer data
 * @param {Object} layerObject - PIXI DisplayObject
 * @param {Object} [motionCaptureMode=null] - Current motion capture state
 * @returns {Object} { left, right, top, bottom, centerX, centerY, width, height, x, y }
 */
export function getLayerWorldBounds(layer, layerObject, motionCaptureMode = null) {
  if (!layer || !layerObject || layerObject.destroyed) return null

  const displayObject = getSafeDisplayObject(layerObject)

  // Prioritize captured dimensions if in motion capture mode
  const capturedLayer = motionCaptureMode?.isActive && motionCaptureMode.trackedLayers?.get(layer.id)

  const isMedia = layer.type === LAYER_TYPES.IMAGE || layer.type === LAYER_TYPES.VIDEO

  // CROP SYSTEM: Prioritize visible (cropped) area for media layers
  // We check the PIXI object for "reactive" properties which represent the real-time visual state (animated or captured)
  let width, height

  if (isMedia) {
    width = capturedLayer?.cropWidth ?? (layerObject?._hasReactiveCropProperties ? layerObject.cropWidth : (layer.cropWidth ?? layer.width ?? DEFAULT_DIMENSION))
    height = capturedLayer?.cropHeight ?? (layerObject?._hasReactiveCropProperties ? layerObject.cropHeight : (layer.cropHeight ?? layer.height ?? DEFAULT_DIMENSION))
  } else if (layer.type === 'text' || displayObject instanceof PIXI.Text) {
    width = capturedLayer?.width ?? layer.width ?? DEFAULT_DIMENSION
    height = capturedLayer?.height ?? layer.height ?? (DEFAULT_DIMENSION / 5)
  } else {
    width = capturedLayer?.width ?? layer.width ?? DEFAULT_DIMENSION
    height = capturedLayer?.height ?? layer.height ?? DEFAULT_DIMENSION
  }

  const { anchorX, anchorY } = resolveAnchors(layer, displayObject)

  const scaleX = capturedLayer?.scaleX ?? (layer.scaleX !== undefined ? layer.scaleX : 1)
  const scaleY = capturedLayer?.scaleY ?? (layer.scaleY !== undefined ? layer.scaleY : 1)
  const rotation = capturedLayer?.rotation ?? (layer.rotation || 0)

  // Calculate actual bounds (accounting for anchor)
  const scaledWidth = width * scaleX
  const scaledHeight = height * scaleY
  const anchorOffsetX = -scaledWidth * anchorX
  const anchorOffsetY = -scaledHeight * anchorY

  // Get layer position (center position)
  const x = capturedLayer?.currentPosition?.x ?? layer.x ?? 0
  const y = capturedLayer?.currentPosition?.y ?? layer.y ?? 0

  // Calculate local corners before rotation
  const localCorners = [
    { x: anchorOffsetX, y: anchorOffsetY }, // top-left
    { x: anchorOffsetX + scaledWidth, y: anchorOffsetY }, // top-right
    { x: anchorOffsetX + scaledWidth, y: anchorOffsetY + scaledHeight }, // bottom-right
    { x: anchorOffsetX, y: anchorOffsetY + scaledHeight }, // bottom-left
  ]

  // Rotate corners around layer center
  const rotationRad = (rotation * Math.PI) / 180
  const cos = Math.cos(rotationRad)
  const sin = Math.sin(rotationRad)

  const worldCorners = localCorners.map(corner => {
    const dx = corner.x
    const dy = corner.y
    return {
      x: x + dx * cos - dy * sin,
      y: y + dx * sin + dy * cos,
    }
  })

  // Find bounding box of rotated corners
  const xs = worldCorners.map(c => c.x)
  const ys = worldCorners.map(c => c.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)

  const boundsWidth = maxX - minX
  const boundsHeight = maxY - minY

  return {
    left: minX,
    right: maxX,
    top: minY,
    bottom: maxY,
    centerX: x,
    centerY: y,
    width: boundsWidth,
    height: boundsHeight,
    // Add compatibility with code expecting createBounds structure
    x: minX,
    y: minY
  }
}

/**
 * Calculates the Axis-Aligned Bounding Box (AABB) for a rectangle with given properties.
 * This is a lightweight version of getLayerWorldBounds that doesn't require a DisplayObject.
 */
export function getRotatedAABB(x, y, width, height, scaleX, scaleY, rotation, anchorX, anchorY) {
  const scaledWidth = width * scaleX
  const scaledHeight = height * scaleY
  const anchorOffsetX = -scaledWidth * anchorX
  const anchorOffsetY = -scaledHeight * anchorY

  // Local corners
  const corners = [
    { x: anchorOffsetX, y: anchorOffsetY },
    { x: anchorOffsetX + scaledWidth, y: anchorOffsetY },
    { x: anchorOffsetX + scaledWidth, y: anchorOffsetY + scaledHeight },
    { x: anchorOffsetX, y: anchorOffsetY + scaledHeight },
  ]

  // Rotate and shift
  const rad = (rotation * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity

  for (const c of corners) {
    const wx = x + c.x * cos - c.y * sin
    const wy = y + c.x * sin + c.y * cos
    if (wx < minX) minX = wx
    if (wx > maxX) maxX = wx
    if (wy < minY) minY = wy
    if (wy > maxY) maxY = wy
  }

  return {
    left: minX,
    right: maxX,
    top: minY,
    bottom: maxY,
    width: maxX - minX,
    width: maxX - minX,
    height: maxY - minY,
    centerX: x,
    centerY: y,
    x: minX, // Add compatibility with getLayerWorldBounds
    y: minY
  }
}

// =============================================================================
// RECTANGLE UTILITIES
// =============================================================================

export function normalizeRect(x, y, width, height) {
  const normalizedX = Math.min(x, x + width)
  const normalizedY = Math.min(y, y + height)

  return {
    x: normalizedX,
    y: normalizedY,
    width: Math.abs(width),
    height: Math.abs(height),
    right: normalizedX + Math.abs(width),
    bottom: normalizedY + Math.abs(height)
  }
}

export function rectsIntersect(a, b) {
  if (!a || !b) return false
  return !(
    (a.right !== undefined ? a.right : a.x + a.width) < b.x ||
    a.x > (b.right !== undefined ? b.right : b.x + b.width) ||
    (a.bottom !== undefined ? a.bottom : a.y + a.height) < b.y ||
    a.y > (b.bottom !== undefined ? b.bottom : b.y + b.height)
  )
}

export function layerIntersectsRect(layer, layerObject, rect, motionCaptureMode = null) {
  if (!rect) return false
  const bounds = getLayerWorldBounds(layer, layerObject, motionCaptureMode)
  if (!bounds) return false
  return rectsIntersect(bounds, rect)
}

// =============================================================================
// MULTI-LAYER & METRICS UTILITIES
// =============================================================================

export function getCombinedLayerBounds(layerIds = [], layers = {}, layerObjectsMap, motionCaptureMode = null) {
  if (!Array.isArray(layerIds) || layerIds.length === 0) return null

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  let hasBounds = false

  layerIds.forEach((layerId) => {
    const layer = layers[layerId]
    const layerObject = layerObjectsMap?.get?.(layerId)
    const bounds = getLayerWorldBounds(layer, layerObject, motionCaptureMode)
    if (!bounds) return

    hasBounds = true
    minX = Math.min(minX, bounds.left)
    minY = Math.min(minY, bounds.top)
    maxX = Math.max(maxX, bounds.right)
    maxY = Math.max(maxY, bounds.bottom)
  })

  if (!hasBounds) return null

  const width = maxX - minX
  const height = maxY - minY

  return {
    x: minX,
    y: minY,
    width,
    height,
    left: minX,
    top: minY,
    right: maxX,
    bottom: maxY,
    centerX: minX + width / 2,
    centerY: minY + height / 2
  }
}

export function getLayerMetrics(layer, layerObject, motionCaptureMode = null) {
  if (!layer) return null

  const displayObject = getSafeDisplayObject(layerObject)
  const capturedLayer = motionCaptureMode?.isActive && motionCaptureMode.trackedLayers?.get(layer.id)

  const x = capturedLayer?.currentPosition?.x ?? (displayObject?.x !== undefined ? displayObject.x : (layer.x || 0))
  const y = capturedLayer?.currentPosition?.y ?? (displayObject?.y !== undefined ? displayObject.y : (layer.y || 0))

  const isMedia = layer.type === LAYER_TYPES.IMAGE || layer.type === LAYER_TYPES.VIDEO
  let width, height

  if (isMedia) {
    width = capturedLayer?.cropWidth ?? (layerObject?._hasReactiveCropProperties ? layerObject.cropWidth : (layer.cropWidth ?? layer.width ?? DEFAULT_DIMENSION))
    height = capturedLayer?.cropHeight ?? (layerObject?._hasReactiveCropProperties ? layerObject.cropHeight : (layer.cropHeight ?? layer.height ?? DEFAULT_DIMENSION))
  } else {
    width = resolveDimension(capturedLayer?.width ?? layer.width, displayObject?.width)
    height = resolveDimension(capturedLayer?.height ?? layer.height, displayObject?.height)
  }

  const { anchorX, anchorY } = resolveAnchors(layer, displayObject)

  return { x, y, width, height, anchorX, anchorY }
}

export function getLayerCenter(layer, layerObject, overrideX, overrideY) {
  if (!layer) return { x: 0, y: 0 }

  // [ROBUSTNESS] Prioritize layer data over live PIXI properties for centers
  // to prevent "jitter" or "jumps" during animation/drag cycles.
  const displayObject = getSafeDisplayObject(layerObject)
  const { anchorX, anchorY } = resolveAnchors(layer, displayObject)

  const width = layer.width || displayObject?.width || DEFAULT_DIMENSION
  const height = layer.height || displayObject?.height || (DEFAULT_DIMENSION / 5)

  const x = overrideX !== undefined ? overrideX : (layer.x || 0)
  const y = overrideY !== undefined ? overrideY : (layer.y || 0)

  const rotation = layer.rotation || 0
  const rad = (rotation * Math.PI) / 180

  const localOffsetX = width * (0.5 - anchorX)
  const localOffsetY = height * (0.5 - anchorY)

  const cos = Math.cos(rad)
  const sin = Math.sin(rad)

  return {
    x: x + localOffsetX * cos - localOffsetY * sin,
    y: y + localOffsetX * sin + localOffsetY * cos
  }
}

// =============================================================================
// CANVAS BOUNDARY VALIDATION
// =============================================================================

export function isLayerCompletelyOutside(layer, layerObject, worldWidth, worldHeight) {
  if (!layer || !layerObject || layerObject.destroyed || !worldWidth || !worldHeight) return false

  const bounds = getLayerWorldBounds(layer, layerObject)
  if (!bounds) return false

  return bounds.right < 0 || bounds.left > worldWidth || bounds.bottom < 0 || bounds.top > worldHeight
}
