/**
 * Badge Utilities
 *
 * This module provides utilities for creating and managing badges that appear
 * during various transform operations (resize and rotation). These badges show
 * real-time feedback to users during element transformations.
 *
 * Key features:
 * - Dynamic badge creation with zoom-adaptive sizing
 * - Real-time badge updates during resize and rotation operations
 * - Proper text formatting and background scaling
 * - Badge positioning relative to selection bounds
 * - Cleanup utilities for badge removal
 *
 * Badge types:
 * - Dimensions badge: Shows width and height during resize operations
 * - Rotation badge: Shows current rotation degree during rotation operations
 *
 * Used by: useSelectionBox, useMultiSelectionBox
 */

import * as PIXI from 'pixi.js'

/**
 * Formats width and height for display.
 *
 * @param {number} width - Width value
 * @param {number} height - Height value
 * @returns {string} Formatted string "W × H"
 */
export function formatDimensions(width, height) {
  return `${width.toFixed(1)} × ${height.toFixed(1)}`
}

/**
 * Formats rotation for display.
 *
 * @param {number} rotation - Rotation value in radians
 * @returns {string} Formatted string with degree symbol
 */
export function formatRotation(rotation) {
  const degrees = (rotation * 180) / Math.PI
  return `${degrees.toFixed(1)}°`
}

export function getScaledBadgeDimensions(zoomScale = 1) {
  // We want badges to be container-scaled.
  // The base values are for zoom level 1.0.
  // When zoomed in (zoomScale < 1), the entire container will be scaled by zoomScale.

  return {
    fontSize: 14, // Increased from 13
    padding: 8,  // Increased from 6
    gap: 16,
    borderRadius: 4,
    minBackgroundWidth: 60, // Increased from 50
    scale: zoomScale // This zoomScale parameter is now passed as (1/viewport.scale.x) from the caller
  }
}

/**
 * Updates the badge background to fit the text.
 *
 * @param {PIXI.Graphics} background - Background graphics
 * @param {PIXI.Text} textElement - Text element
 * @param {Object} dims - Scaled dimensions from getScaledBadgeDimensions
 */
function updateBadgeBackground(background, textElement, dims) {
  const textWidth = textElement.width
  const textHeight = textElement.height

  // QUANTIZATION FIX: Round width up to nearest 24px to prevent micro-jittering 
  // when numbers change. We also use toFixed(1) in formatters for character stability.
  const targetWidth = textWidth + dims.padding * 2
  const quantizedWidth = Math.ceil(targetWidth / 24) * 24
  const backgroundWidth = Math.max(quantizedWidth, dims.minBackgroundWidth)
  const backgroundHeight = textHeight + dims.padding * 2

  // PERFORMANCE OPTIMIZATION: Avoid redrawing if dimensions haven't changed
  if (background._lastWidth === backgroundWidth && background._lastHeight === backgroundHeight) {
    return
  }

  background.clear()
  background.roundRect(
    -backgroundWidth / 2,
    -textHeight / 2 - dims.padding,
    backgroundWidth,
    backgroundHeight,
    Math.max(dims.borderRadius * 2, 6)
  )
  background.fill({ color: 0x0D1216, alpha: 0.85 })

  // Store last dimensions for performance check
  background._lastWidth = backgroundWidth
  background._lastHeight = backgroundHeight
}

/**
 * Creates a dimensions badge container with background and text.
 *
 * @param {Object} options - Badge options
 * @param {number} options.width - Element width to display
 * @param {number} options.height - Element height to display
 * @param {number} options.zoomScale - Current viewport zoom scale
 * @returns {PIXI.Container} Badge container
 */
export function createDimensionsBadge({ width, height, zoomScale = 1 }) {
  const badgeContainer = new PIXI.Container()
  badgeContainer.label = 'dimensions-badge'
  badgeContainer.eventMode = 'none'

  const dims = getScaledBadgeDimensions(zoomScale)

  // Background rectangle
  const background = new PIXI.Graphics()
  background.eventMode = 'none'
  badgeContainer.addChild(background)

  // Text element
  const textElement = new PIXI.Text({
    text: formatDimensions(width, height),
    style: {
      fontFamily: 'monospace', // Use monospace to ensure digits have equal width
      fontSize: dims.fontSize,
      fill: 0xFFFFFF,
      fontWeight: 'bold'
    }
  })
  textElement.eventMode = 'none'
  textElement.anchor.set(0.5, 0.5)
  badgeContainer.addChild(textElement)

  // Update background to fit text
  updateBadgeBackground(background, textElement, dims)

  return badgeContainer
}

/**
 * Updates an existing dimensions badge with new values.
 *
 * @param {PIXI.Container} badgeContainer - The badge container
 * @param {Object} options - Update options
 * @param {number} options.width - New element width
 * @param {number} options.height - New element height
 * @param {number} options.localY - Y position in local space
 * @param {number} options.zoomScale - Current viewport zoom scale
 */
export function updateDimensionsBadge(badgeContainer, { width, height, zoomScale = 1, viewportScale = 1 }) {
  if (!badgeContainer || badgeContainer.children.length < 2) return

  const dims = getScaledBadgeDimensions(zoomScale)
  const background = badgeContainer.children[0]
  const textElement = badgeContainer.children[1]

  // Update text
  // We use stable font size now
  textElement.style.fontSize = dims.fontSize
  textElement.text = formatDimensions(width, height)

  // CRITICAL QUALITY FIX: Increase resolution matches viewport to keep text crisp
  // Cap at 4x to ensure ultra-crisp quality even at high zoom
  const targetResolution = Math.max(2, Math.min(4, viewportScale))
  if (textElement.resolution !== targetResolution) {
    textElement.resolution = targetResolution
  }

  // Apply scaling to the entire container
  badgeContainer.scale.set(dims.scale)

  // Position badge - handled by caller (mouse position) usually, 
  // but if we need local offsets inside the container, we do it here.
  // Since we are moving to mouse-following, the caller sets x/y.
  // We just ensure the background fits the text.

  // Update background
  updateBadgeBackground(background, textElement, dims)
}

/**
 * Removes a dimensions badge from its parent.
 *
 * @param {PIXI.Container} parent - Parent container
 */
export function removeDimensionsBadge(parent) {
  if (!parent) return

  const badgeIndex = parent.children.findIndex(child => child.label === 'dimensions-badge')
  if (badgeIndex !== -1) {
    const badge = parent.children[badgeIndex]
    parent.removeChild(badge)
    badge.destroy({ children: true })
  }
}

/**
 * Creates a rotation badge container with background and text.
 *
 * @param {Object} options - Badge options
 * @param {number} options.rotation - Current rotation in degrees
 * @param {number} options.zoomScale - Current viewport zoom scale
 * @returns {PIXI.Container} Badge container
 */
export function createRotationBadge({ rotation, zoomScale = 1 }) {
  const badgeContainer = new PIXI.Container()
  badgeContainer.label = 'rotation-badge'
  badgeContainer.eventMode = 'none'

  const dims = getScaledBadgeDimensions(zoomScale)

  // Background rectangle
  const background = new PIXI.Graphics()
  background.eventMode = 'none'
  badgeContainer.addChild(background)

  // Text element
  const textElement = new PIXI.Text({
    text: formatRotation((rotation * Math.PI) / 180), // formatRotation expects radians
    style: {
      fontFamily: 'monospace',
      fontSize: dims.fontSize,
      fill: 0xFFFFFF,
      fontWeight: 'bold'
    }
  })
  textElement.eventMode = 'none'
  textElement.anchor.set(0.5, 0.5)
  badgeContainer.addChild(textElement)

  // Update background to fit text
  updateBadgeBackground(background, textElement, dims)

  return badgeContainer
}

/**
 * Updates an existing rotation badge with new values.
 *
 * @param {PIXI.Container} badgeContainer - The badge container
 * @param {Object} options - Update options
 * @param {number} options.rotation - New rotation in degrees
 * @param {number} options.localX - X position in local space
 * @param {number} options.localY - Y position in local space
 * @param {number} options.zoomScale - Current viewport zoom scale
 */
export function updateRotationBadge(badgeContainer, { rotation, zoomScale = 1, viewportScale = 1 }) {
  if (!badgeContainer || badgeContainer.children.length < 2) return

  const dims = getScaledBadgeDimensions(zoomScale)
  const background = badgeContainer.children[0]
  const textElement = badgeContainer.children[1]

  // Update text
  textElement.style.fontSize = dims.fontSize
  textElement.text = formatRotation((rotation * Math.PI) / 180)

  // CRITICAL QUALITY FIX: Increase resolution matches viewport to keep text crisp
  // Cap at 4x for ultra-sharp quality
  const targetResolution = Math.max(2, Math.min(4, viewportScale))
  if (textElement.resolution !== targetResolution) {
    textElement.resolution = targetResolution
  }

  // Apply scaling to the entire container
  badgeContainer.scale.set(dims.scale)

  // Update background
  updateBadgeBackground(background, textElement, dims)
}

/**
 * Removes a rotation badge from its parent.
 *
 * @param {PIXI.Container} parent - Parent container
 */
export function removeRotationBadge(parent) {
  if (!parent) return

  const badgeIndex = parent.children.findIndex(child => child.label === 'rotation-badge')
  if (badgeIndex !== -1) {
    const badge = parent.children[badgeIndex]
    parent.removeChild(badge)
    badge.destroy({ children: true })
  }
}