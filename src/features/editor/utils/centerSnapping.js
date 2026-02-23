/**
 * Advanced Snapping System for Canvas Interactions
 *
 * This module implements a sophisticated snapping system that provides precise alignment
 * and positioning feedback during canvas operations. It enables users to create pixel-perfect
 * layouts by automatically snapping elements to various alignment targets with visual guides.
 *
 * Snapping Types Supported:
 * - Center Snapping: Aligns elements to canvas center lines (horizontal/vertical)
 * - Object-to-Object Alignment: Snaps edges and centers between different elements
 * - Spacing Distribution: Maintains equal spacing between multiple aligned elements
 * - Safe Zone Boundaries: Constrains elements within designated safe areas
 *
 * Key Features:
 * - Intelligent distance-based snapping with configurable thresholds
 * - Multi-target priority system (safe zones > spacing > center > alignment)
 * - Real-time guide line generation for visual feedback
 * - Support for complex multi-object alignment scenarios
 * - Consistent spacing calculations for grid-like layouts
 * - Boundary-aware snapping that respects canvas constraints
 *
 * Performance Optimizations:
 * - Object pooling for alignment guides to reduce GC pressure
 * - Spatial partitioning for faster proximity checks
 * - Early exit conditions for distant objects
 * - Cached calculations for expensive operations
 *
 * Core Functions:
 * - applyCenterSnapping: Canvas center line alignment
 * - applyObjectAlignmentSnapping: Element-to-element positioning
 * - applySpacingSnapping: Equal distribution spacing
 * - applySafeZoneSnapping: Boundary constraint snapping
 * - calculateSafeZone: Safe area boundary computation
 *
 * Used by: useCanvasInteractions (primary snapping engine)
 */

// PERFORMANCE OPTIMIZATION: Snapping calculation throttling
const snappingThrottle = {
  lastCalculation: 0,
  minInterval: 16, // ~60fps
  cache: new Map(),

  shouldCalculate(key) {
    const now = Date.now()
    const lastTime = this.lastCalculation
    if (now - lastTime < this.minInterval) {
      // Check if we have a cached result
      return this.cache.has(key) ? this.cache.get(key) : false
    }
    this.lastCalculation = now
    return true
  },

  cacheResult(key, result) {
    // Limit cache size
    if (this.cache.size > 10) {
      const firstKey = this.cache.keys().next().value
      this.cache.delete(firstKey)
    }
    this.cache.set(key, result)
  },

  getCached(key) {
    return this.cache.get(key)
  }
}

/**
 * Applies center snapping to an element's position
 * @param {Object} params - Snapping parameters
 * @param {number} params.x - Current x position (element center)
 * @param {number} params.y - Current y position (element center)
 * @param {number} params.width - Element width (not used for center snapping, but kept for future use)
 * @param {number} params.height - Element height (not used for center snapping, but kept for future use)
 * @param {number} params.canvasWidth - Canvas width in world coordinates
 * @param {number} params.canvasHeight - Canvas height in world coordinates
 * @param {number} [params.threshold=7] - Snap threshold in pixels (default: 7)
 * @returns {Object} Snapped position and guide flags
 * @returns {number} returns.x - Snapped x position (or original if no snap)
 * @returns {number} returns.y - Snapped y position (or original if no snap)
 * @returns {boolean} returns.showVGuide - Whether to show vertical guide line
 * @returns {boolean} returns.showHGuide - Whether to show horizontal guide line
 */

/**
 * Applies object-to-object alignment snapping
 * @param {Object} params - Snapping parameters
 * @param {number} params.x - Current x position (element center)
 * @param {number} params.y - Current y position (element center)
 * @param {number} params.width - Element width
 * @param {number} params.height - Element height
 * @param {number} params.anchorX - Element anchor X (0-1)
 * @param {number} params.anchorY - Element anchor Y (0-1)
 * @param {Array} params.otherObjects - Array of other objects to align with: [{ x, y, width, height, anchorX, anchorY }]
 * @param {number} [params.threshold=7] - Snap threshold in pixels (default: 7)
 * @returns {Object} Snapped position and alignment guides
 * @returns {number} returns.x - Snapped x position (or original if no snap)
 * @returns {number} returns.y - Snapped y position (or original if no snap)
 * @returns {Array} returns.alignmentGuides - Array of alignment guide objects: [{ type, position, isVertical }]
 */
export function applyCenterSnapping({
  x,
  y,
  width,
  height,
  canvasWidth,
  canvasHeight,
  threshold = 10,
  scaleX = 1,
  scaleY = 1
}) {
  const centerX = canvasWidth * 0.5
  const centerY = canvasHeight * 0.5

  let snappedX = x
  let snappedY = y
  const alignmentGuides = []

  // Check horizontal center snap (vertical guide)
  const distFromCenterX = Math.abs(x - centerX)
  if (distFromCenterX <= threshold) {
    snappedX = centerX
    alignmentGuides.push({
      type: 'center',
      position: centerX,
      isVertical: true,
      start: 0,
      end: canvasHeight
    })
  }

  // Check vertical center snap (horizontal guide)
  const distFromCenterY = Math.abs(y - centerY)
  if (distFromCenterY <= threshold) {
    snappedY = centerY
    alignmentGuides.push({
      type: 'center',
      position: centerY,
      isVertical: false,
      start: 0,
      end: canvasWidth
    })
  }

  return {
    x: snappedX,
    y: snappedY,
    alignmentGuides,
    // Keep backward compatibility
    showVGuide: alignmentGuides.some(guide => guide.isVertical),
    showHGuide: alignmentGuides.some(guide => !guide.isVertical),
    releaseGuides: () => { } // No longer needed as we removed polling
  }
}

/**
 * Applies object-to-object alignment snapping
 * @param {Object} params - Snapping parameters
 * @param {number} params.x - Current x position (element center)
 * @param {number} params.y - Current y position (element center)
 * @param {number} params.width - Element width
 * @param {number} params.height - Element height
 * @param {number} params.anchorX - Element anchor X (0-1)
 * @param {number} params.anchorY - Element anchor Y (0-1)
 * @param {Array} params.otherObjects - Array of other objects to align with: [{ x, y, width, height, anchorX, anchorY }]
 * @param {number} [params.threshold=7] - Snap threshold in pixels (default: 7)
 * @returns {Object} Snapped position and alignment guides
 * @returns {number} returns.x - Snapped x position (or original if no snap)
 * @returns {number} returns.y - Snapped y position (or original if no snap)
 * @returns {Array} returns.alignmentGuides - Array of alignment guide objects: [{ type, position, isVertical }]
 */
export function applyObjectAlignmentSnapping({
  x,
  y,
  width,
  height,
  anchorX = 0.5,
  anchorY = 0.5,
  otherObjects = [],
  threshold = 10,
  scaleX = 1,
  scaleY = 1
}) {
  let snappedX = x
  let snappedY = y
  const alignmentGuides = []

  // Early exit if no other objects to align with
  if (!otherObjects || otherObjects.length === 0) {
    return { x: snappedX, y: snappedY, alignmentGuides: [], releaseGuides: () => { } }
  }

  // Early exit if threshold is too large (no snapping possible)
  if (threshold <= 0) {
    return { x: snappedX, y: snappedY, alignmentGuides: [], releaseGuides: () => { } }
  }

  // PERFORMANCE OPTIMIZATION: Pre-calculate dragged object visual bounds
  const visualWidth = width * Math.abs(scaleX)
  const visualHeight = height * Math.abs(scaleY)
  const anchorOffsetX = visualWidth * anchorX
  const anchorOffsetY = visualHeight * anchorY

  const draggedLeft = x - anchorOffsetX
  const draggedRight = draggedLeft + visualWidth
  const draggedTop = y - anchorOffsetY
  const draggedBottom = draggedTop + visualHeight
  const draggedCenterX = x
  const draggedCenterY = y

  // Track the closest snap for each alignment type
  let closestLeftSnap = { distance: Infinity, position: null, minTop: Infinity, maxBottom: -Infinity }
  let closestRightSnap = { distance: Infinity, position: null, minTop: Infinity, maxBottom: -Infinity }
  let closestTopSnap = { distance: Infinity, position: null, minLeft: Infinity, maxRight: -Infinity }
  let closestBottomSnap = { distance: Infinity, position: null, minLeft: Infinity, maxRight: -Infinity }
  let closestCenterXSnap = { distance: Infinity, position: null, minTop: Infinity, maxBottom: -Infinity }
  let closestCenterYSnap = { distance: Infinity, position: null, minLeft: Infinity, maxRight: -Infinity }

  // Check alignment with all objects
  otherObjects.forEach((other) => {
    // Assuming other.width/height are already visual (scaled) dimensions
    const otherAnchorX = other.anchorX !== undefined ? other.anchorX : 0.5
    const otherAnchorY = other.anchorY !== undefined ? other.anchorY : 0.5

    const otherLeft = other.x - (other.width * otherAnchorX)
    const otherRight = otherLeft + other.width
    const otherTop = other.y - (other.height * otherAnchorY)
    const otherBottom = otherTop + other.height
    const otherCenterX = other.x
    const otherCenterY = other.y

    // Check left edge alignment
    const leftDist = Math.abs(draggedLeft - otherLeft)
    if (leftDist <= threshold) {
      if (leftDist < closestLeftSnap.distance) {
        closestLeftSnap.distance = leftDist
        closestLeftSnap.position = otherLeft
        closestLeftSnap.minTop = otherTop
        closestLeftSnap.maxBottom = otherBottom
      } else if (leftDist <= closestLeftSnap.distance + 0.1) {
        closestLeftSnap.minTop = Math.min(closestLeftSnap.minTop, otherTop)
        closestLeftSnap.maxBottom = Math.max(closestLeftSnap.maxBottom, otherBottom)
      }
    }

    // Check right edge alignment
    const rightDist = Math.abs(draggedRight - otherRight)
    if (rightDist <= threshold) {
      if (rightDist < closestRightSnap.distance) {
        closestRightSnap.distance = rightDist
        closestRightSnap.position = otherRight
        closestRightSnap.minTop = otherTop
        closestRightSnap.maxBottom = otherBottom
      } else if (rightDist <= closestRightSnap.distance + 0.1) {
        closestRightSnap.minTop = Math.min(closestRightSnap.minTop, otherTop)
        closestRightSnap.maxBottom = Math.max(closestRightSnap.maxBottom, otherBottom)
      }
    }

    // Check top edge alignment
    const topDist = Math.abs(draggedTop - otherTop)
    if (topDist <= threshold) {
      if (topDist < closestTopSnap.distance) {
        closestTopSnap.distance = topDist
        closestTopSnap.position = otherTop
        closestTopSnap.minLeft = otherLeft
        closestTopSnap.maxRight = otherRight
      } else if (topDist <= closestTopSnap.distance + 0.1) {
        closestTopSnap.minLeft = Math.min(closestTopSnap.minLeft, otherLeft)
        closestTopSnap.maxRight = Math.max(closestTopSnap.maxRight, otherRight)
      }
    }

    // Check bottom edge alignment
    const bottomDist = Math.abs(draggedBottom - otherBottom)
    if (bottomDist <= threshold) {
      if (bottomDist < closestBottomSnap.distance) {
        closestBottomSnap.distance = bottomDist
        closestBottomSnap.position = otherBottom
        closestBottomSnap.minLeft = otherLeft
        closestBottomSnap.maxRight = otherRight
      } else if (bottomDist <= closestBottomSnap.distance + 0.1) {
        closestBottomSnap.minLeft = Math.min(closestBottomSnap.minLeft, otherLeft)
        closestBottomSnap.maxRight = Math.max(closestBottomSnap.maxRight, otherRight)
      }
    }

    // Check horizontal center alignment
    const centerXDist = Math.abs(draggedCenterX - otherCenterX)
    if (centerXDist <= threshold) {
      if (centerXDist < closestCenterXSnap.distance) {
        closestCenterXSnap.distance = centerXDist
        closestCenterXSnap.position = otherCenterX
        closestCenterXSnap.minTop = otherTop
        closestCenterXSnap.maxBottom = otherBottom
      } else if (centerXDist <= closestCenterXSnap.distance + 0.1) {
        closestCenterXSnap.minTop = Math.min(closestCenterXSnap.minTop, otherTop)
        closestCenterXSnap.maxBottom = Math.max(closestCenterXSnap.maxBottom, otherBottom)
      }
    }

    // Check vertical center alignment
    const centerYDist = Math.abs(draggedCenterY - otherCenterY)
    if (centerYDist <= threshold) {
      if (centerYDist < closestCenterYSnap.distance) {
        closestCenterYSnap.distance = centerYDist
        closestCenterYSnap.position = otherCenterY
        closestCenterYSnap.minLeft = otherLeft
        closestCenterYSnap.maxRight = otherRight
      } else if (centerYDist <= closestCenterYSnap.distance + 0.1) {
        closestCenterYSnap.minLeft = Math.min(closestCenterYSnap.minLeft, otherLeft)
        closestCenterYSnap.maxRight = Math.max(closestCenterYSnap.maxRight, otherRight)
      }
    }
  })

  // Include dragged object bounds in guide bounds calculation
  if (closestLeftSnap.distance < Infinity) {
    closestLeftSnap.minTop = Math.min(closestLeftSnap.minTop, draggedTop)
    closestLeftSnap.maxBottom = Math.max(closestLeftSnap.maxBottom, draggedBottom)
  }
  if (closestRightSnap.distance < Infinity) {
    closestRightSnap.minTop = Math.min(closestRightSnap.minTop, draggedTop)
    closestRightSnap.maxBottom = Math.max(closestRightSnap.maxBottom, draggedBottom)
  }
  if (closestTopSnap.distance < Infinity) {
    closestTopSnap.minLeft = Math.min(closestTopSnap.minLeft, draggedLeft)
    closestTopSnap.maxRight = Math.max(closestTopSnap.maxRight, draggedRight)
  }
  if (closestBottomSnap.distance < Infinity) {
    closestBottomSnap.minLeft = Math.min(closestBottomSnap.minLeft, draggedLeft)
    closestBottomSnap.maxRight = Math.max(closestBottomSnap.maxRight, draggedRight)
  }
  if (closestCenterXSnap.distance < Infinity) {
    closestCenterXSnap.minTop = Math.min(closestCenterXSnap.minTop, draggedTop)
    closestCenterXSnap.maxBottom = Math.max(closestCenterXSnap.maxBottom, draggedBottom)
  }
  if (closestCenterYSnap.distance < Infinity) {
    closestCenterYSnap.minLeft = Math.min(closestCenterYSnap.minLeft, draggedLeft)
    closestCenterYSnap.maxRight = Math.max(closestCenterYSnap.maxRight, draggedRight)
  }

  // Priority: edge alignments over center alignments
  const hasEdgeXSnap = closestLeftSnap.distance < Infinity || closestRightSnap.distance < Infinity
  const hasEdgeYSnap = closestTopSnap.distance < Infinity || closestBottomSnap.distance < Infinity

  // Apply X snapping
  if (hasEdgeXSnap) {
    const bothEdgesAligned = closestLeftSnap.distance < Infinity && closestRightSnap.distance < Infinity
    const edgesAreClose = bothEdgesAligned && Math.abs(closestLeftSnap.distance - closestRightSnap.distance) < 0.1

    if (bothEdgesAligned && edgesAreClose) {
      snappedX = closestLeftSnap.position + anchorOffsetX
      alignmentGuides.push({
        type: 'left', position: closestLeftSnap.position, isVertical: true,
        start: closestLeftSnap.minTop, end: closestLeftSnap.maxBottom
      })
      alignmentGuides.push({
        type: 'right', position: closestRightSnap.position, isVertical: true,
        start: closestRightSnap.minTop, end: closestRightSnap.maxBottom
      })
    } else if (closestLeftSnap.distance <= closestRightSnap.distance && closestLeftSnap.distance < Infinity) {
      snappedX = closestLeftSnap.position + anchorOffsetX
      alignmentGuides.push({
        type: 'left', position: closestLeftSnap.position, isVertical: true,
        start: closestLeftSnap.minTop, end: closestLeftSnap.maxBottom
      })
    } else if (closestRightSnap.distance < Infinity) {
      snappedX = closestRightSnap.position - (visualWidth * (1 - anchorX))
      alignmentGuides.push({
        type: 'right', position: closestRightSnap.position, isVertical: true,
        start: closestRightSnap.minTop, end: closestRightSnap.maxBottom
      })
    }
  } else if (closestCenterXSnap.distance < Infinity) {
    snappedX = closestCenterXSnap.position
    alignmentGuides.push({
      type: 'centerX', position: closestCenterXSnap.position, isVertical: true,
      start: closestCenterXSnap.minTop, end: closestCenterXSnap.maxBottom
    })
  }

  // Apply Y snapping
  if (hasEdgeYSnap) {
    const bothEdgesAligned = closestTopSnap.distance < Infinity && closestBottomSnap.distance < Infinity
    const edgesAreClose = bothEdgesAligned && Math.abs(closestTopSnap.distance - closestBottomSnap.distance) < 0.1

    if (bothEdgesAligned && edgesAreClose) {
      snappedY = closestTopSnap.position + anchorOffsetY
      alignmentGuides.push({
        type: 'top', position: closestTopSnap.position, isVertical: false,
        start: closestTopSnap.minLeft, end: closestTopSnap.maxRight
      })
      alignmentGuides.push({
        type: 'bottom', position: closestBottomSnap.position, isVertical: false,
        start: closestBottomSnap.minLeft, end: closestBottomSnap.maxRight
      })
    } else if (closestTopSnap.distance <= closestBottomSnap.distance && closestTopSnap.distance < Infinity) {
      snappedY = closestTopSnap.position + anchorOffsetY
      alignmentGuides.push({
        type: 'top', position: closestTopSnap.position, isVertical: false,
        start: closestTopSnap.minLeft, end: closestTopSnap.maxRight
      })
    } else if (closestBottomSnap.distance < Infinity) {
      snappedY = closestBottomSnap.position - (visualHeight * (1 - anchorY))
      alignmentGuides.push({
        type: 'bottom', position: closestBottomSnap.position, isVertical: false,
        start: closestBottomSnap.minLeft, end: closestBottomSnap.maxRight
      })
    }
  } else if (closestCenterYSnap.distance < Infinity) {
    snappedY = closestCenterYSnap.position
    alignmentGuides.push({
      type: 'centerY', position: closestCenterYSnap.position, isVertical: false,
      start: closestCenterYSnap.minLeft, end: closestCenterYSnap.maxRight
    })
  }

  return {
    x: snappedX,
    y: snappedY,
    alignmentGuides,
    releaseGuides: () => { }
  }
}

/**
 * Detects equal spacing between objects and applies spacing snapping
 * @param {Object} params - Spacing parameters
 * @param {number} params.x - Current x position (element center)
 * @param {number} params.y - Current y position (element center)
 * @param {number} params.width - Element width
 * @param {number} params.height - Element height
 * @param {number} params.anchorX - Element anchor X (0-1)
 * @param {number} params.anchorY - Element anchor Y (0-1)
 * @param {Array} params.otherObjects - Array of other objects: [{ x, y, width, height, anchorX, anchorY }]
 * @param {number} [params.threshold=7] - Snap threshold in pixels (default: 7)
 * @param {number} [params.overlapThreshold=0.5] - Minimum overlap ratio to consider objects in same row/column (default: 0.5)
 * @returns {Object} Snapped position and spacing guides
 * @returns {number} returns.x - Snapped x position (or original if no snap)
 * @returns {number} returns.y - Snapped y position (or original if no snap)
 * @returns {Array} returns.spacingGuides - Array of spacing guide objects: [{ type: 'horizontal'|'vertical', startX, startY, endX, endY, distance, isVertical }]
 */
/**
 * Calculates safe zone boundaries based on canvas dimensions
 * Uses adaptive formula: 5% of canvas size, clamped between 16px and 120px
 * For backward compatibility, a specific margin can be provided to override the adaptive formula
 * @param {number} canvasWidth - Canvas width in world coordinates
 * @param {number} canvasHeight - Canvas height in world coordinates
 * @param {number|string|null} margin - Optional: specific margin from edges (px or %). If null, uses adaptive formula
 * @returns {Object} Safe zone boundaries: { left, right, top, bottom, centerX, centerY }
 */
export function calculateSafeZone(canvasWidth, canvasHeight, margin = null) {
  // If a specific margin is provided (for backward compatibility), use it
  if (margin !== null) {
    // Parse margin - if it's a string ending with '%', treat as percentage
    let marginPx = margin
    if (typeof margin === 'string' && margin.endsWith('%')) {
      const percentage = parseFloat(margin) / 100
      // Use the minimum dimension to calculate percentage margin for consistent behavior
      const minDimension = Math.min(canvasWidth, canvasHeight)
      marginPx = minDimension * percentage
    } else if (typeof margin === 'string') {
      marginPx = parseFloat(margin) || 20
    }

    return {
      left: marginPx,
      right: canvasWidth - marginPx,
      top: marginPx,
      bottom: canvasHeight - marginPx,
      centerX: canvasWidth / 2,
      centerY: canvasHeight / 2
    }
  }

  const minMargin = 16;
  const maxMargin = 120;

  const marginX = Math.max(minMargin, Math.min(maxMargin, canvasWidth * 0.05));   // 5% of width
  const marginY = Math.max(minMargin, Math.min(maxMargin, canvasHeight * 0.05)); // 5% of height

  const left = marginX;
  const right = canvasWidth - marginX;
  const top = marginY;
  const bottom = canvasHeight - marginY;

  return {
    left,
    right,
    top,
    bottom,
    width: right - left,
    height: bottom - top,
    centerX: canvasWidth / 2,
    centerY: canvasHeight / 2
  }
}

/**
 * Applies safe zone snapping to an element's position
 * Intelligently snaps object edges AND centers to safe zone boundaries with corner support
 * Can snap both edges and centers to horizontal/vertical boundaries simultaneously
 * Allows objects to be dragged past boundaries once snapped - no hard constraints
 * @param {Object} params - Snapping parameters
 * @param {number} params.x - Current x position (element center)
 * @param {number} params.y - Current y position (element center)
 * @param {number} params.width - Element width
 * @param {number} params.height - Element height
 * @param {number} params.anchorX - Element anchor X (0-1)
 * @param {number} params.anchorY - Element anchor Y (0-1)
 * @param {number} params.canvasWidth - Canvas width in world coordinates
 * @param {number} params.canvasHeight - Canvas height in world coordinates
 * @param {number|string|null} [params.margin=null] - Margin from edges (px or %). If null, uses adaptive 5% formula. If string ends with '%', treated as percentage
 * @returns {Object} Snapped position and guide information
 * @returns {number} returns.x - Snapped x position (or original if no horizontal snap)
 * @returns {number} returns.y - Snapped y position (or original if no vertical snap)
 * @returns {Array} returns.alignmentGuides - Array of safe zone guide objects for visual feedback
 * @returns {boolean} returns.showLeftGuide - Whether to show left safe zone guide (computed from alignmentGuides)
 * @returns {boolean} returns.showRightGuide - Whether to show right safe zone guide (computed from alignmentGuides)
 * @returns {boolean} returns.showTopGuide - Whether to show top safe zone guide (computed from alignmentGuides)
 * @returns {boolean} returns.showBottomGuide - Whether to show bottom safe zone guide (computed from alignmentGuides)
 */
export function applySafeZoneSnapping({
  x,
  y,
  width,
  height,
  anchorX = 0.5,
  anchorY = 0.5,
  canvasWidth,
  canvasHeight,
  margin = 20,
  scaleX = 1,
  scaleY = 1,
  bounds = null // Optional: pre-calculated world bounds {left, right, top, bottom}
}) {
  const safeZone = calculateSafeZone(canvasWidth, canvasHeight, margin)

  // Start with original positions
  let snappedX = x
  let snappedY = y
  const alignmentGuides = []

  // PERFORMANCE OPTIMIZATION: Use visual (scaled) dimensions if bounds not provided
  const visualWidth = width * Math.abs(scaleX)
  const visualHeight = height * Math.abs(scaleY)

  // Calculate element bounding box edges (use bounds if provided for accuracy with rotation)
  // The bounds already account for rotation corners via getLayerWorldBounds
  const leftEdge = bounds ? bounds.left : x - (visualWidth * anchorX)
  const rightEdge = bounds ? bounds.right : leftEdge + visualWidth
  const topEdge = bounds ? bounds.top : y - (visualHeight * anchorY)
  const bottomEdge = bounds ? bounds.bottom : topEdge + visualHeight

  // Use proportional thresholds for each boundary type
  const horizontalThreshold = Math.max(20, Math.min(50, canvasWidth * 0.02))
  const verticalThreshold = Math.max(20, Math.min(50, canvasHeight * 0.02))

  // PERFORMANCE OPTIMIZATION: Aggressive early exit using a coarse proximity check
  // If the object's AABB is nowhere near the safezone boundaries, skip all calculations.
  const proximityBuffer = Math.max(horizontalThreshold, verticalThreshold) * 2
  const isFarFromX = rightEdge < (safeZone.left - proximityBuffer) || leftEdge > (safeZone.right + proximityBuffer)
  const isFarFromY = bottomEdge < (safeZone.top - proximityBuffer) || topEdge > (safeZone.bottom + proximityBuffer)

  // Additionally, if the object is far from the boundaries of the safezone itself
  if (isFarFromX && isFarFromY) {
    return {
      x: snappedX, y: snappedY, alignmentGuides: [],
      showLeftGuide: false, showRightGuide: false, showTopGuide: false, showBottomGuide: false,
      safeZone, releaseGuides: () => { }
    }
  }

  // Calculate distances for all relevant combinations (includes outside-to-inside)
  const distL_L = Math.abs(leftEdge - safeZone.left)    // Left edge to Left boundary (inside -> out)
  const distR_L = Math.abs(rightEdge - safeZone.left)   // Right edge to Left boundary (outside -> in)
  const distR_R = Math.abs(rightEdge - safeZone.right)  // Right edge to Right boundary (inside -> out)
  const distL_R = Math.abs(leftEdge - safeZone.right)   // Left edge to Right boundary (outside -> in)
  const distT_T = Math.abs(topEdge - safeZone.top)      // Top edge to Top boundary (inside -> out)
  const distB_T = Math.abs(bottomEdge - safeZone.top)   // Bottom edge to Top boundary (outside -> in)
  const distB_B = Math.abs(bottomEdge - safeZone.bottom)// Bottom edge to Bottom boundary (inside -> out)
  const distT_B = Math.abs(topEdge - safeZone.bottom)   // Top edge to Bottom boundary (outside -> in)

  // Center distances (for center snapping to safezone boundaries)
  const distCX_L = Math.abs(x - safeZone.left)
  const distCX_R = Math.abs(x - safeZone.right)
  const distCY_T = Math.abs(y - safeZone.top)
  const distCY_B = Math.abs(y - safeZone.bottom)

  // Determine if any guide should be shown (using thresholds)
  const isCloseToLeft = distL_L <= horizontalThreshold || distR_L <= horizontalThreshold || distCX_L <= horizontalThreshold
  const isCloseToRight = distR_R <= horizontalThreshold || distL_R <= horizontalThreshold || distCX_R <= horizontalThreshold
  const isCloseToTop = distT_T <= verticalThreshold || distB_T <= verticalThreshold || distCY_T <= verticalThreshold
  const isCloseToBottom = distB_B <= verticalThreshold || distT_B <= verticalThreshold || distCY_B <= verticalThreshold

  if (!isCloseToLeft && !isCloseToRight && !isCloseToTop && !isCloseToBottom) {
    return {
      x: snappedX, y: snappedY, alignmentGuides: [],
      showLeftGuide: false, showRightGuide: false, showTopGuide: false, showBottomGuide: false,
      safeZone, releaseGuides: () => { }
    }
  }

  // Add safe zone guides
  if (isCloseToLeft) {
    alignmentGuides.push({
      type: 'safeZone', position: safeZone.left,
      isVertical: true, start: safeZone.top, end: safeZone.bottom
    })
  }
  if (isCloseToRight) {
    alignmentGuides.push({
      type: 'safeZone', position: safeZone.right,
      isVertical: true, start: safeZone.top, end: safeZone.bottom
    })
  }
  if (isCloseToTop) {
    alignmentGuides.push({
      type: 'safeZone', position: safeZone.top,
      isVertical: false, start: safeZone.left, end: safeZone.right
    })
  }
  if (isCloseToBottom) {
    alignmentGuides.push({
      type: 'safeZone', position: safeZone.bottom,
      isVertical: false, start: safeZone.left, end: safeZone.right
    })
  }

  // Find best horizontal snap
  let minH = Infinity, hSnapVal = null
  if (distL_L <= horizontalThreshold && distL_L < minH) { minH = distL_L; hSnapVal = safeZone.left - (leftEdge - x) }
  if (distR_L <= horizontalThreshold && distR_L < minH) { minH = distR_L; hSnapVal = safeZone.left - (rightEdge - x) }
  if (distR_R <= horizontalThreshold && distR_R < minH) { minH = distR_R; hSnapVal = safeZone.right - (rightEdge - x) }
  if (distL_R <= horizontalThreshold && distL_R < minH) { minH = distL_R; hSnapVal = safeZone.right - (leftEdge - x) }
  if (distCX_L <= horizontalThreshold && distCX_L < minH) { minH = distCX_L; hSnapVal = safeZone.left }
  if (distCX_R <= horizontalThreshold && distCX_R < minH) { minH = distCX_R; hSnapVal = safeZone.right }

  // Find best vertical snap
  let minV = Infinity, vSnapVal = null
  if (distT_T <= verticalThreshold && distT_T < minV) { minV = distT_T; vSnapVal = safeZone.top - (topEdge - y) }
  if (distB_T <= verticalThreshold && distB_T < minV) { minV = distB_T; vSnapVal = safeZone.top - (bottomEdge - y) }
  if (distB_B <= verticalThreshold && distB_B < minV) { minV = distB_B; vSnapVal = safeZone.bottom - (bottomEdge - y) }
  if (distT_B <= verticalThreshold && distT_B < minV) { minV = distT_B; vSnapVal = safeZone.bottom - (topEdge - y) }
  if (distCY_T <= verticalThreshold && distCY_T < minV) { minV = distCY_T; vSnapVal = safeZone.top }
  if (distCY_B <= verticalThreshold && distCY_B < minV) { minV = distCY_B; vSnapVal = safeZone.bottom }

  // Apply snaps (Corner priority: both can apply if close)
  if (hSnapVal !== null) snappedX = hSnapVal
  if (vSnapVal !== null) snappedY = vSnapVal

  return {
    x: snappedX,
    y: snappedY,
    alignmentGuides,
    showLeftGuide: isCloseToLeft,
    showRightGuide: isCloseToRight,
    showTopGuide: isCloseToTop,
    showBottomGuide: isCloseToBottom,
    safeZone,
    releaseGuides: () => { }
  }
}

export function applySpacingSnapping({
  x,
  y,
  width,
  height,
  anchorX = 0.5,
  anchorY = 0.5,
  otherObjects = [],
  threshold = 7,
  overlapThreshold = 0.8 // Increased from 0.5 for stricter "same line" requirement
}) {
  let snappedX = x
  let snappedY = y
  const spacingGuides = []

  // Early exit conditions
  if (!otherObjects || otherObjects.length < 2) {
    return { x: snappedX, y: snappedY, spacingGuides: [], releaseGuides: () => { } }
  }

  if (threshold <= 0 || overlapThreshold <= 0 || overlapThreshold > 1) {
    return { x: snappedX, y: snappedY, spacingGuides: [], releaseGuides: () => { } }
  }

  // Cache anchor calculations and dragged object bounds
  const anchorOffsetX = width * anchorX
  const anchorOffsetY = height * anchorY
  const draggedLeft = x - anchorOffsetX
  const draggedRight = draggedLeft + width
  const draggedTop = y - anchorOffsetY
  const draggedBottom = draggedTop + height

  // PERFORMANCE OPTIMIZATION: Create expanded bounds for spatial filtering
  const expandedThreshold = Math.max(width, height) * 2 // Look for objects within 2x the dragged object size
  const filterLeft = draggedLeft - expandedThreshold
  const filterRight = draggedRight + expandedThreshold
  const filterTop = draggedTop - expandedThreshold
  const filterBottom = draggedBottom + expandedThreshold

  // Helper function to check if two objects overlap vertically (same row)
  const overlapsVertically = (obj1Top, obj1Bottom, obj2Top, obj2Bottom) => {
    const overlap = Math.min(obj1Bottom, obj2Bottom) - Math.max(obj1Top, obj2Top)
    const minHeight = Math.min(obj1Bottom - obj1Top, obj2Bottom - obj2Top)
    return overlap >= minHeight * overlapThreshold
  }

  // Helper function to check if two objects overlap horizontally (same column)
  const overlapsHorizontally = (obj1Left, obj1Right, obj2Left, obj2Right) => {
    const overlap = Math.min(obj1Right, obj2Right) - Math.max(obj1Left, obj2Left)
    const minWidth = Math.min(obj1Right - obj1Left, obj2Right - obj2Left)
    return overlap >= minWidth * overlapThreshold
  }

  // Pre-calculate dragged object bounds for overlap checks
  const draggedOverlapThresholdVert = draggedBottom - draggedTop
  const draggedOverlapThresholdHoriz = draggedRight - draggedLeft

  // HORIZONTAL SPACING DETECTION
  // Find objects in the same row (vertical overlap with dragged object) and collect positions
  const rowObjects = [{ left: draggedLeft, right: draggedRight, top: draggedTop, bottom: draggedBottom, isDragged: true }]

  // PERFORMANCE OPTIMIZATION: Pre-filter objects using spatial bounds
  const nearbyObjects = otherObjects.filter((other) => {
    if (!other || other.width === undefined || other.height === undefined) return false

    const otherAnchorX = other.anchorX !== undefined ? other.anchorX : 0.5
    const otherAnchorY = other.anchorY !== undefined ? other.anchorY : 0.5

    const otherLeft = other.x - (other.width * otherAnchorX)
    const otherRight = otherLeft + other.width
    const otherTop = other.y - (other.height * otherAnchorY)
    const otherBottom = otherTop + other.height

    // Quick spatial check - skip objects that are clearly too far
    return !(otherRight < filterLeft || otherLeft > filterRight ||
      otherBottom < filterTop || otherTop > filterBottom)
  })

  nearbyObjects.forEach((other) => {
    const otherAnchorX = other.anchorX !== undefined ? other.anchorX : 0.5
    const otherAnchorY = other.anchorY !== undefined ? other.anchorY : 0.5

    const otherLeft = other.x - (other.width * otherAnchorX)
    const otherRight = otherLeft + other.width
    const otherTop = other.y - (other.height * otherAnchorY)
    const otherBottom = otherTop + other.height

    // Check vertical overlap using helper
    if (overlapsVertically(draggedTop, draggedBottom, otherTop, otherBottom)) {
      rowObjects.push({
        left: otherLeft,
        right: otherRight,
        top: otherTop,
        bottom: otherBottom,
        isDragged: false
      })
    }
  })

  if (rowObjects.length >= 3) {
    // Sort by left position
    rowObjects.sort((a, b) => a.left - b.left)

    // Identify the dragged object's index
    const draggedIndex = rowObjects.findIndex(obj => obj.isDragged)

    // Collect all gaps and find the reference gap
    const gaps = []
    const staticGaps = []
    for (let i = 0; i < rowObjects.length - 1; i++) {
      const leftObj = rowObjects[i]
      const rightObj = rowObjects[i + 1]
      const gap = rightObj.left - leftObj.right
      const involvesDragged = leftObj.isDragged || rightObj.isDragged

      gaps.push({ leftObj, rightObj, gap, involvesDragged })
      if (!involvesDragged && gap > 1) {
        staticGaps.push(gap)
      }
    }

    // Find the most common static gap
    let referenceGap = 0
    if (staticGaps.length > 0) {
      const gapCounts = new Map()
      let maxCount = 0
      staticGaps.forEach(g => {
        const count = (gapCounts.get(g) || 0) + 1
        gapCounts.set(g, count)
        if (count > maxCount) {
          maxCount = count
          referenceGap = g
        }
      })
    }

    // If we have a reference gap, check if the dragged gaps match it
    let didSnap = false
    if (referenceGap > 0) {
      gaps.forEach(g => {
        if (g.involvesDragged) {
          const gapDiff = Math.abs(g.gap - referenceGap)
          if (gapDiff <= threshold) {
            // SNAP!
            if (g.leftObj.isDragged) {
              snappedX = g.rightObj.left - referenceGap - width + anchorOffsetX
            } else {
              snappedX = g.leftObj.right + referenceGap + anchorOffsetX
            }
            didSnap = true
          }
        }
      })
    }

    // Special case: "Center" between two objects if no common static gap or after snapping
    if (!didSnap && draggedIndex > 0 && draggedIndex < rowObjects.length - 1) {
      const leftObj = rowObjects[draggedIndex - 1]
      const rightObj = rowObjects[draggedIndex + 1]
      const totalSpace = rightObj.left - leftObj.right
      const idealGap = (totalSpace - width) / 2

      const gapToLeft = draggedLeft - leftObj.right
      if (idealGap > 0 && Math.abs(gapToLeft - idealGap) <= threshold) {
        snappedX = leftObj.right + idealGap + anchorOffsetX
        referenceGap = idealGap
        didSnap = true
      }
    }

    // If we snapped or have a matching gap, show ALL equal badges on this line
    if (didSnap || (referenceGap > 0 && gaps.some(g => g.involvesDragged && Math.abs(g.gap - referenceGap) <= 1))) {
      // Use the final snapped positions for all objects to check matching gaps
      const finalDraggedLeft = snappedX - anchorOffsetX
      const finalDraggedRight = finalDraggedLeft + width

      gaps.forEach(g => {
        const l = g.leftObj.isDragged ? finalDraggedLeft : g.leftObj.left
        const r = g.leftObj.isDragged ? finalDraggedRight : g.leftObj.right
        const l2 = g.rightObj.isDragged ? finalDraggedLeft : g.rightObj.left
        const r2 = g.rightObj.isDragged ? finalDraggedRight : g.rightObj.right

        const currentGap = l2 - r
        if (Math.abs(currentGap - referenceGap) <= threshold + 0.5) {
          const overlapTop = Math.max(g.leftObj.top, g.rightObj.top, draggedTop)
          const overlapBottom = Math.min(g.leftObj.bottom, g.rightObj.bottom, draggedBottom)
          const guideY = overlapTop + (overlapBottom - overlapTop) / 2

          spacingGuides.push({
            type: 'horizontal',
            startX: r,
            startY: guideY,
            endX: l2,
            endY: guideY,
            distance: Math.round(referenceGap),
            targetDistance: Math.round(referenceGap),
            isVertical: false,
            shouldSnap: true
          })
        }
      })
    }
  }

  // VERTICAL SPACING DETECTION
  // Find objects in the same column (horizontal overlap with dragged object) and collect positions
  const columnObjects = [{ left: draggedLeft, right: draggedRight, top: draggedTop, bottom: draggedBottom, isDragged: true }]

  nearbyObjects.forEach((other) => {
    const otherAnchorX = other.anchorX !== undefined ? other.anchorX : 0.5
    const otherAnchorY = other.anchorY !== undefined ? other.anchorY : 0.5

    const otherLeft = other.x - (other.width * otherAnchorX)
    const otherRight = otherLeft + other.width
    const otherTop = other.y - (other.height * otherAnchorY)
    const otherBottom = otherTop + other.height

    // Check horizontal overlap using helper
    if (overlapsHorizontally(draggedLeft, draggedRight, otherLeft, otherRight)) {
      columnObjects.push({
        left: otherLeft,
        right: otherRight,
        top: otherTop,
        bottom: otherBottom,
        isDragged: false
      })
    }
  })

  if (columnObjects.length >= 3) {
    // Sort by top position
    columnObjects.sort((a, b) => a.top - b.top)

    // Identify the dragged object's index
    const draggedIndex = columnObjects.findIndex(obj => obj.isDragged)

    // Collect all gaps and find the reference gap
    const gaps = []
    const staticGaps = []
    for (let i = 0; i < columnObjects.length - 1; i++) {
      const topObj = columnObjects[i]
      const bottomObj = columnObjects[i + 1]
      const gap = bottomObj.top - topObj.bottom
      const involvesDragged = topObj.isDragged || bottomObj.isDragged

      gaps.push({ topObj, bottomObj, gap, involvesDragged })
      if (!involvesDragged && gap > 1) {
        staticGaps.push(gap)
      }
    }

    // Find the most common static gap
    let referenceGap = 0
    if (staticGaps.length > 0) {
      const gapCounts = new Map()
      let maxCount = 0
      staticGaps.forEach(g => {
        const count = (gapCounts.get(g) || 0) + 1
        gapCounts.set(g, count)
        if (count > maxCount) {
          maxCount = count
          referenceGap = g
        }
      })
    }

    // If we have a reference gap, check if the dragged gaps match it
    let didSnap = false
    if (referenceGap > 0) {
      gaps.forEach(g => {
        if (g.involvesDragged) {
          const gapDiff = Math.abs(g.gap - referenceGap)
          if (gapDiff <= threshold) {
            // SNAP!
            if (g.topObj.isDragged) {
              snappedY = g.bottomObj.top - referenceGap - height + anchorOffsetY
            } else {
              snappedY = g.topObj.bottom + referenceGap + anchorOffsetY
            }
            didSnap = true
          }
        }
      })
    }

    // Special case: "Center" between two objects if no common static gap or after snapping
    if (!didSnap && draggedIndex > 0 && draggedIndex < columnObjects.length - 1) {
      const topObj = columnObjects[draggedIndex - 1]
      const bottomObj = columnObjects[draggedIndex + 1]
      const totalSpace = bottomObj.top - topObj.bottom
      const idealGap = (totalSpace - height) / 2

      const gapToTop = draggedTop - topObj.bottom
      if (idealGap > 0 && Math.abs(gapToTop - idealGap) <= threshold) {
        snappedY = topObj.bottom + idealGap + anchorOffsetY
        referenceGap = idealGap
        didSnap = true
      }
    }

    // If we snapped or have a matching gap, show ALL equal badges on this line
    if (didSnap || (referenceGap > 0 && gaps.some(g => g.involvesDragged && Math.abs(g.gap - referenceGap) <= 1))) {
      // Use the final snapped positions for all objects to check matching gaps
      const finalDraggedTop = snappedY - anchorOffsetY
      const finalDraggedBottom = finalDraggedTop + height

      gaps.forEach(g => {
        const t = g.topObj.isDragged ? finalDraggedTop : g.topObj.top
        const b = g.topObj.isDragged ? finalDraggedBottom : g.topObj.bottom
        const t2 = g.bottomObj.isDragged ? finalDraggedTop : g.bottomObj.top
        const b2 = g.bottomObj.isDragged ? finalDraggedBottom : g.bottomObj.bottom

        const currentGap = t2 - b
        if (Math.abs(currentGap - referenceGap) <= threshold + 0.5) {
          const overlapLeft = Math.max(g.topObj.left, g.bottomObj.left, draggedLeft)
          const overlapRight = Math.min(g.topObj.right, g.bottomObj.right, draggedRight)
          const guideX = overlapLeft + (overlapRight - overlapLeft) / 2

          spacingGuides.push({
            type: 'vertical',
            startX: guideX,
            startY: b,
            endX: guideX,
            endY: t2,
            distance: Math.round(referenceGap),
            targetDistance: Math.round(referenceGap),
            isVertical: true,
            shouldSnap: true
          })
        }
      })
    }
  }

  return {
    x: snappedX,
    y: snappedY,
    spacingGuides,
    releaseGuides: () => guidePool.releaseAll(spacingGuides)
  }
}

