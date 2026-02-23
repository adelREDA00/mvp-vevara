/**
 * Utility functions for drawing dashed and dotted strokes in PIXI.js.
 * Since PIXI.js doesn't natively support dashed strokes, these functions manually
 * render dashed patterns for rectangles and lines.
 * Used for visual feedback in selection boxes, shape outlines, and guide lines.
 */

/**
 * Draw a dashed line between two points
 */
export function drawDashedLine(graphics, x1, y1, x2, y2, strokeColor, strokeWidth, dashLength, gapLength) {
  const dashPattern = dashLength || strokeWidth * 4
  const gapPattern = gapLength || strokeWidth * 2

  // Draw the dashed line segment
  drawDashedLineSegment(graphics, x1, y1, x2, y2, dashPattern, gapPattern)

  // Apply stroke
  graphics.stroke({ color: strokeColor, width: strokeWidth })
}

/**
 * Draw a dashed rectangle
 */
export function drawDashedRect(graphics, x, y, width, height, cornerRadius, strokeColor, strokeWidth, dashLength, gapLength) {
  const dashPattern = dashLength || strokeWidth * 4
  const gapPattern = gapLength || strokeWidth * 2

  // For rounded rectangles, we'll draw straight lines for now
  // (rounded corners with dashes would be more complex)
  if (cornerRadius > 0) {
    // Simplified: draw as straight rectangle for now
    // TODO: Implement proper rounded corner dashed lines
  }

  // Draw all edges without calling stroke (we'll call it once at the end)
  drawDashedLineSegment(graphics, x, y, x + width, y, dashPattern, gapPattern)
  drawDashedLineSegment(graphics, x + width, y, x + width, y + height, dashPattern, gapPattern)
  drawDashedLineSegment(graphics, x + width, y + height, x, y + height, dashPattern, gapPattern)
  drawDashedLineSegment(graphics, x, y + height, x, y, dashPattern, gapPattern)

  // Apply stroke once after all dashes are drawn
  graphics.stroke({ color: strokeColor, width: strokeWidth })
}

/**
 * Draw a dashed circle
 */
export function drawDashedCircle(graphics, centerX, centerY, radius, strokeColor, strokeWidth, dashLength, gapLength) {
  const dashPattern = dashLength || strokeWidth * 4
  const gapPattern = gapLength || strokeWidth * 2
  const circumference = 2 * Math.PI * radius

  let currentDistance = 0

  while (currentDistance < circumference) {
    const startAngle = (currentDistance / circumference) * 2 * Math.PI
    const dashAngle = (dashPattern / circumference) * 2 * Math.PI
    const endAngle = Math.min(startAngle + dashAngle, 2 * Math.PI)

    const startX = centerX + radius * Math.cos(startAngle)
    const startY = centerY + radius * Math.sin(startAngle)
    const endX = centerX + radius * Math.cos(endAngle)
    const endY = centerY + radius * Math.sin(endAngle)

    graphics.moveTo(startX, startY)
    graphics.lineTo(endX, endY)

    currentDistance += dashPattern + gapPattern
  }

  // Apply stroke once after all dashes are drawn
  graphics.stroke({ color: strokeColor, width: strokeWidth })
}

/**
 * Draw a dashed line segment (without calling stroke)
 */
function drawDashedLineSegment(graphics, x1, y1, x2, y2, dashLength, gapLength) {
  const dx = x2 - x1
  const dy = y2 - y1
  const distance = Math.sqrt(dx * dx + dy * dy)

  if (distance === 0) return

  const totalPattern = dashLength + gapLength
  let currentDistance = 0

  while (currentDistance < distance) {
    const startProgress = currentDistance / distance
    const endProgress = Math.min((currentDistance + dashLength) / distance, 1)

    const startX = x1 + dx * startProgress
    const startY = y1 + dy * startProgress
    const endX = x1 + dx * endProgress
    const endY = y1 + dy * endProgress

    graphics.moveTo(startX, startY)
    graphics.lineTo(endX, endY)

    currentDistance += totalPattern
  }
}