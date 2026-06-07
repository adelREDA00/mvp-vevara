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
  // zoomScale = 1 / canvasZoom
  // If zooming out (zoomScale > 1), dampen the growth so handles don't become massive
  // If zooming in (zoomScale < 1), let them shrink but keep a minimum size for usability
  const scale = zoomScale > 1 
    ? 1 + (zoomScale - 1) * 0.35 
    : Math.max(0.3, zoomScale)
  
  // Clamp to reasonable range
  return Math.min(3.0, scale)
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
  isLocked = false
}) {
  const handle = new PIXI.Graphics()
  handle.alpha = isLocked ? 0.4 : 1.0
  const baseScale = calculateAdaptedScale(zoomScale)
  const dims = {
    cornerRadius: 8 * baseScale,
    sideWidth: 20 * baseScale,
    sideHeight: 7 * baseScale,
    sideWidthVertical: 7 * baseScale,
    sideHeightVertical: 20 * baseScale
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
    if (e._redirected) {
      e.stopPropagation()
      e.stopImmediatePropagation?.()
      if (isLocked) {
        return
      }
      onResizeStart(handleType, cursor, e)
      return
    }

    const closest = getClosestActiveMultiHandle(handle.parent, e.data.global)
    if (closest && closest !== handle) {
      // If center wins, let event bubble naturally to trigger selection box dragging
      if (closest === handle.parent) {
        return
      }
      e.stopPropagation()
      e.stopImmediatePropagation?.()
      if (isLocked) {
        return
      }
      e._redirected = true
      closest.emit('pointerdown', e)
    } else {
      e.stopPropagation()
      e.stopImmediatePropagation?.()
      if (isLocked) {
        return
      }
      onResizeStart(handleType, cursor, e)
    }
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
  const baseScale = Math.min(1.5, Math.max(0.4, zoomScale))

  handle.clear()

  if (isCorner) {
    const radius = isHovered ? dims.cornerRadius + 2 * baseScale : dims.cornerRadius
    handle.circle(0, 0, radius)
    handle.fill({ color: isHovered ? 0x9370db : 0xffffff })
    handle.stroke({ color: isHovered ? 0xffffff : 0x9370db, width: Math.max(1, 1.2 * baseScale) })
  } else if (isSide) {
    const isHorizontal = handleType === 'n' || handleType === 's'
    const w = isHorizontal ? dims.sideWidth : dims.sideWidthVertical
    const h = isHorizontal ? dims.sideHeight : dims.sideHeightVertical
    const extra = isHovered ? 3 * baseScale : 0

    handle.roundRect(-(w + extra) / 2, -(h + extra) / 2, w + extra, h + extra, 3 * (zoomScale < 1 ? zoomScale : 1))
    handle.fill({ color: isHovered ? 0x9370db : 0xffffff })
    handle.stroke({ color: isHovered ? 0xffffff : 0x9370db, width: Math.max(1, 1.2 * baseScale) })
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
  isLocked = false
}) {
  const handle = new PIXI.Container()
  handle.alpha = isLocked ? 0.4 : 1.0
  const baseScale = calculateAdaptedScale(zoomScale)
  const radius = 22 * baseScale

  // Draw white circle background
  const background = new PIXI.Graphics()
  background.circle(0, 0, radius)
  background.fill({ color: 0xffffff })
  background.stroke({ color: 0xD1D5DB, width: 1 })
  handle.addChild(background)

  // Create icon container
  const icon = new PIXI.Graphics()
  handle.addChild(icon)

  // Premium "two curved arrows" icon (Canva style)
  const drawArrows = (graphics, color, size) => {
    graphics.clear()
    const s = size / 2
    const r = s * 0.75
    const arrowSize = s * 0.35
    const strokeWidth = Math.max(1, 1.5 * baseScale)

    // Arc angles (in radians)
    const arcLength = Math.PI * 0.65
    const gap = Math.PI * 0.35

    // Top Arc
    const topStart = -Math.PI * 0.5 - arcLength / 2
    const topEnd = -Math.PI * 0.5 + arcLength / 2

    // Bottom Arc
    const bottomStart = Math.PI * 0.5 - arcLength / 2
    const bottomEnd = Math.PI * 0.5 + arcLength / 2

    // Draw Arcs
    graphics.beginPath()
    graphics.arc(0, 0, r, topStart, topEnd)
    graphics.stroke({ color, width: strokeWidth, cap: 'round' })

    graphics.beginPath()
    graphics.arc(0, 0, r, bottomStart, bottomEnd)
    graphics.stroke({ color, width: strokeWidth, cap: 'round' })

    // Helper to draw a sharp arrowhead at a specific point on the circle
    const drawHead = (angle, isClockwise = true) => {
      const x = Math.cos(angle) * r
      const y = Math.sin(angle) * r
      const tangent = angle + (isClockwise ? Math.PI / 2 : -Math.PI / 2)
      const spread = 0.7 // ~40 degrees

      const x1 = x - arrowSize * Math.cos(tangent - spread)
      const y1 = y - arrowSize * Math.sin(tangent - spread)
      const x2 = x - arrowSize * Math.cos(tangent + spread)
      const y2 = y - arrowSize * Math.sin(tangent + spread)

      graphics.moveTo(x, y)
      graphics.lineTo(x1, y1)
      graphics.moveTo(x, y)
      graphics.lineTo(x2, y2)
    }

    graphics.beginPath()
    drawHead(topEnd, true)
    drawHead(bottomEnd, true)
    graphics.stroke({ color, width: strokeWidth, cap: 'round' })
  }

  const iconSize = 24 * baseScale
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
    background.stroke({ color: 0xffffff, width: Math.max(1, 1.2 * baseScale) })
    drawArrows(icon, 0xffffff, iconSize)
    handle.cursor = 'grab'
  })

  handle.on('pointerleave', () => {
    if (isLocked) return
    background.clear()
    background.circle(0, 0, radius)
    background.fill({ color: 0xffffff })
    background.stroke({ color: 0xD1D5DB, width: 1 })
    drawArrows(icon, 0x000000, iconSize)
    handle.cursor = 'grab'
  })

  // Start rotation
  handle.on('pointerdown', (e) => {
    if (e._redirected) {
      e.stopPropagation()
      e.stopImmediatePropagation?.()
      if (isLocked) {
        return
      }
      onRotateStart(e)
      return
    }

    const closest = getClosestActiveMultiHandle(handle.parent, e.data.global)
    if (closest && closest !== handle) {
      // If center wins, let event bubble naturally to trigger selection box dragging
      if (closest === handle.parent) {
        return
      }
      e.stopPropagation()
      e.stopImmediatePropagation?.()
      if (isLocked) {
        return
      }
      e._redirected = true
      closest.emit('pointerdown', e)
    } else {
      e.stopPropagation()
      e.stopImmediatePropagation?.()
      if (isLocked) {
        return
      }
      onRotateStart(e)
    }
  })

  return handle
}

/**
 * Helper to find the geometrically closest selection handle to a given global touch position in a multi-selection box.
 * Applies a bias in favor of corners and rotation handles, as they are physically smaller
 * and harder to target than side hit areas.
 */
function getClosestActiveMultiHandle(selectionBox, touchPos) {
  if (!selectionBox) return null

  let closestHandle = null
  let minDistance = Infinity

  selectionBox.children.forEach(child => {
    if (!child.visible || !child.label) return

    // Multi-selection box handles have child.label = 'resize-handle' or 'rotate-handle'
    const isResizeHandle = child.label === 'resize-handle'
    const isRotationHandle = child.label === 'rotate-handle'

    if (isResizeHandle || isRotationHandle) {
      let handlePos
      try {
        handlePos = child.getGlobalPosition()
      } catch (err) {
        return
      }

      const dx = touchPos.x - handlePos.x
      const dy = touchPos.y - handlePos.y
      let distance = Math.sqrt(dx * dx + dy * dy)

      // Apply a priority bias for corner handles and rotation handle on touch screens
      const isCorner = isResizeHandle && ['nw', 'ne', 'sw', 'se'].includes(child.handleType)
      if (isCorner) {
        distance *= 0.8 // 20% bias in favor of corners
      } else if (isRotationHandle) {
        distance *= 0.85 // 15% bias in favor of rotation
      }

      if (distance < minDistance) {
        minDistance = distance
        closestHandle = child
      }
    }
  })

  // Calculate selection box center using opposite NW and SE corners for affine-invariant accuracy
  const nwHandle = selectionBox.children.find(c => c.label === 'resize-handle' && c.handleType === 'nw')
  const seHandle = selectionBox.children.find(c => c.label === 'resize-handle' && c.handleType === 'se')

  let centerPos = null
  if (nwHandle && seHandle && nwHandle.visible && seHandle.visible) {
    try {
      const nwPos = nwHandle.getGlobalPosition()
      const sePos = seHandle.getGlobalPosition()
      centerPos = {
        x: (nwPos.x + sePos.x) / 2,
        y: (nwPos.y + sePos.y) / 2
      }
    } catch (e) {}
  }

  if (!centerPos) {
    try {
      centerPos = selectionBox.getGlobalPosition()
    } catch (e) {}
  }

  if (centerPos) {
    const dcX = touchPos.x - centerPos.x
    const dcY = touchPos.y - centerPos.y
    const distanceToCenter = Math.sqrt(dcX * dcX + dcY * dcY)

    // If closer to center, center wins to allow bubbling drag behavior
    if (distanceToCenter < minDistance) {
      return selectionBox
    }
  }

  return closestHandle
}
