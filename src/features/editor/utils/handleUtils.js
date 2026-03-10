/**
 * Interactive Handle Utilities
 *
 * This module provides utilities for creating and managing interactive resize and rotation
 * handles that appear around selected elements. Handles maintain consistent visual styling
 * and behavior across different selection scenarios while adapting to zoom levels.
 *
 * Key features:
 * - Resize handle creation with hover effects and event handling
 * - Handle positioning updates based on element bounds
 * - Rotated cursor calculations for proper interaction feedback
 * - Zoom-adaptive handle sizing for consistent usability
 * - Support for both corner and side handles
 *
 * Used by: useSelectionBox, useMultiSelectionBox
 */

import * as PIXI from 'pixi.js'

/**
 * Calculates a dampened scale factor for UI elements based on zoom level.
 * Ensures handles remain visible but don't become overwhelmingly large.
 */
export function calculateAdaptedScale(zoomScale) {
  // If zooming out (zoomScale > 1), dampen the growth
  const scale = zoomScale > 1 ? 1 + (zoomScale - 1) * 0.45 : zoomScale
  // Clamp to reasonable range for extreme zoom levels
  return Math.min(4.0, Math.max(0.5, scale))
}

/**
 * Creates a resize handle (corner or side).
 *
 * @param {Object} options - Handle options
 * @param {number} options.x - Handle X position
 * @param {number} options.y - Handle Y position
 * @param {string} options.handleType - Type: 'nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w'
 * @param {string} options.cursor - CSS cursor style
 * @param {Function} options.onResizeStart - Callback when resize starts
 * @param {Function} [options.onHoverEnter] - Optional hover enter callback
 * @param {Function} [options.onHoverLeave] - Optional hover leave callback
 * @param {number} [options.zoomScale=1] - Scale factor for zoom level
 * @returns {PIXI.Graphics} The handle graphics
 */
export function createResizeHandle({
  x, y, handleType, cursor,
  onResizeStart, onHoverEnter, onHoverLeave, zoomScale = 1,
  isLocked = false, onLockedInteraction = null
}) {
  const handle = new PIXI.Graphics()
  handle.alpha = isLocked ? 0.4 : 1.0
  const baseScale = calculateAdaptedScale(zoomScale)
  const dims = {
    cornerRadius: 12 * baseScale,
    sideWidth: 32 * baseScale,
    sideHeight: 12 * baseScale,
    sideWidthVertical: 12 * baseScale,
    sideHeightVertical: 32 * baseScale
  }
  const isCorner = ['nw', 'ne', 'sw', 'se'].includes(handleType)

  // Draw handle
  drawHandle(handle, handleType, dims, false, zoomScale)

  handle.x = x
  handle.y = y
  handle.label = 'resize-handle'
  handle.eventMode = 'static'
  handle.cursor = cursor
  handle.zIndex = 10002
  handle.handleType = handleType

  const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0)
  // Set hit area - more generous for easier interaction
  if (isCorner) {
    const hitAreaRadius = isTouch ? Math.max(48, 64 * baseScale) : Math.max(20, 32 * baseScale)
    handle.hitArea = new PIXI.Circle(0, 0, hitAreaRadius)
  } else {
    const hitAreaSize = isTouch ? Math.max(64, 80 * baseScale) : Math.max(32, 56 * baseScale)
    handle.hitArea = new PIXI.Rectangle(-hitAreaSize / 2, -hitAreaSize / 2, hitAreaSize, hitAreaSize)
  }

  // Hover events
  handle.on('pointerenter', () => {
    if (isLocked) return
    drawHandle(handle, handleType, dims, true, zoomScale)
    onHoverEnter?.()
  })

  handle.on('pointerleave', () => {
    if (isLocked) return
    drawHandle(handle, handleType, dims, false, zoomScale)
    onHoverLeave?.()
  })

  // Resize start
  handle.on('pointerdown', (e) => {
    e.stopPropagation()
    e.stopImmediatePropagation?.()
    if (isLocked) {
      if (onLockedInteraction) onLockedInteraction(e)
      return
    }
    onResizeStart(handleType, cursor, e)
  })

  return handle
}

/**
 * Draws a handle's graphics based on type and hover state.
 *
 * @param {PIXI.Graphics} handle - The handle graphics
 * @param {string} handleType - Handle type
 * @param {Object} dims - Scaled dimensions
 * @param {boolean} isHovered - Whether handle is hovered
 * @param {number} zoomScale - Scale factor for zoom level
 */
function drawHandle(handle, handleType, dims, isHovered, zoomScale = 1) {
  const isCorner = ['nw', 'ne', 'sw', 'se'].includes(handleType)
  const isSide = ['n', 's', 'e', 'w'].includes(handleType)

  // Calculate baseScale locally for stroke width
  const baseScale = Math.min(1.8, Math.max(0.5, zoomScale))

  handle.clear()

  if (isCorner) {
    const radius = isHovered ? dims.cornerRadius + 4 * baseScale : dims.cornerRadius
    handle.circle(0, 0, radius)
    handle.fill({ color: isHovered ? 0x9370db : 0xffffff })
    handle.stroke({ color: isHovered ? 0xffffff : 0x9370db, width: Math.max(1, 1.5 * baseScale) })
  } else if (isSide) {
    const isHorizontal = handleType === 'n' || handleType === 's'
    const w = isHorizontal ? dims.sideWidth : dims.sideWidthVertical
    const h = isHorizontal ? dims.sideHeight : dims.sideHeightVertical
    const extra = isHovered ? 6 * baseScale : 0

    handle.roundRect(-(w + extra) / 2, -(h + extra) / 2, w + extra, h + extra, 5 * (zoomScale < 1 ? zoomScale : 1))
    handle.fill({ color: isHovered ? 0x9370db : 0xffffff })
    handle.stroke({ color: isHovered ? 0xffffff : 0x9370db, width: Math.max(1, 2 * baseScale) })
  }
}


/**
 * Gets the appropriate rotated cursor based on handle type and element rotation.
 * 
 * @param {string} handleType - Handle type
 * @param {number} rotationDeg - Element rotation in degrees
 * @returns {string} CSS cursor style
 */
export function getRotatedCursor(handleType, rotationDeg) {
  const cursorAngles = {
    'e': 0,
    'ne': 45,
    'n': 90,
    'nw': 135,
    'w': 180,
    'sw': 225,
    's': 270,
    'se': 315
  }

  const baseAngle = cursorAngles[handleType] ?? 0
  const rotatedAngle = (baseAngle + rotationDeg) % 360
  const normalizedAngle = Math.round(rotatedAngle / 45) * 45
  const finalAngle = ((normalizedAngle % 360) + 360) % 360

  const entries = Object.entries(cursorAngles)
  const closest = entries.reduce((prev, curr) => {
    const prevDiff = Math.abs(((prev[1] - finalAngle + 180) % 360) - 180)
    const currDiff = Math.abs(((curr[1] - finalAngle + 180) % 360) - 180)
    return currDiff < prevDiff ? curr : prev
  })

  return closest[0] + '-resize'
}

/**
 * Creates a rotation handle.
 *
 * @param {Object} options - Handle options
 * @param {number} options.x - Handle X position
 * @param {number} options.y - Handle Y position
 * @param {Function} options.onRotateStart - Callback when rotation starts
 * @param {number} [options.zoomScale=1] - Scale factor for zoom level
 * @returns {PIXI.Graphics} The handle graphics
 */
/**
 * Creates a rotation handle with a premium "two-arrow" icon.
 *
 * @param {Object} options - Handle options
 * @param {number} options.x - Handle X position
 * @param {number} options.y - Handle Y position
 * @param {Function} options.onRotateStart - Callback when rotation starts
 * @param {number} [options.zoomScale=1] - Scale factor for zoom level
 * @returns {PIXI.Container} The handle container
 */
export function createRotateHandle({
  x, y, onRotateStart, zoomScale = 1,
  isLocked = false, onLockedInteraction = null
}) {
  const handle = new PIXI.Container()
  handle.alpha = isLocked ? 0.4 : 1.0
  const baseScale = calculateAdaptedScale(zoomScale)
  const radius = 18 * baseScale

  // Draw white circle background
  const background = new PIXI.Graphics()
  background.circle(0, 0, radius)
  background.fill({ color: 0xffffff })
  background.stroke({ color: 0x8B5CF6, width: Math.max(1, 2 * baseScale) })
  handle.addChild(background)

  // Create icon container
  const icon = new PIXI.Graphics()
  handle.addChild(icon)

  // Premium "two curved arrows" icon (Canva style)
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
      const tangent = angle + (isClockwise ? Math.PI / 2 : -Math.PI / 2)
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

    drawHead(topEnd, true)
    drawHead(bottomEnd, true)
    graphics.stroke({ color, width: 2, cap: 'round' })
  }

  const iconSize = 20 * baseScale
  drawArrows(icon, 0x000000, iconSize)

  handle.x = x
  handle.y = y
  handle.label = 'rotate-handle'
  handle.eventMode = 'static'
  handle.cursor = 'grab'
  handle.zIndex = 10003

  const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0)
  // Hit area - match visual radius for precision, increase for touch
  handle.hitArea = new PIXI.Circle(0, 0, isTouch ? Math.max(48, radius * 2.5) : radius)

  // Hover animations
  handle.on('pointerenter', () => {
    if (isLocked) return
    handle.cursor = 'grabbing'
    background.clear()
    background.circle(0, 0, radius + 2 * baseScale)
    background.fill({ color: 0x8B5CF6 })
    background.stroke({ color: 0xffffff, width: Math.max(1, 2 * baseScale) })
    drawArrows(icon, 0xffffff, iconSize)
    handle.cursor = 'grab'
  })

  handle.on('pointerleave', () => {
    if (isLocked) return
    background.clear()
    background.circle(0, 0, radius)
    background.fill({ color: 0xffffff })
    background.stroke({ color: 0x8B5CF6, width: Math.max(1, 2 * baseScale) })
    drawArrows(icon, 0x000000, iconSize)
    handle.cursor = 'grab'
  })

  // Start rotation
  handle.on('pointerdown', (e) => {
    e.stopPropagation()
    e.stopImmediatePropagation?.()
    if (isLocked) {
      if (onLockedInteraction) onLockedInteraction(e)
      return
    }
    onRotateStart(e)
  })

  return handle
}
