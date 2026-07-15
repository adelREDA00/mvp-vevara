// so when we start from the start we have no layer on our cavnas , and we then add a shaper or text layer , first we send the data to redux   , then usecanvalayers detect that and he take the redux data of the layer create the layer itself and then create a spreat map and store all the details of the pixi object on it , same thing for the update it take the redux data and update the pixi object and then update the spreat map  



import { useEffect, useRef, useMemo, useLayoutEffect, useState } from 'react'
import { useSelector, useDispatch } from 'react-redux'
import * as PIXI from 'pixi.js'
import { createTextLayer, createShapeLayer, createImageLayer, createVideoLayer, createFrameLayer, attachAssetToFrame, attachBackAssetToFrame, showFramePlaceholderFallback, redrawFramePlaceholder, drawShapePath, releaseVideoElement } from '../../engine/pixi/createLayer'
import { drawDashedRect } from '../../engine/pixi/dashUtils'
import { LAYER_TYPES } from '../../../store/models'
import { updateLayer, selectScenes, selectProjectTimelineInfo, selectLoadingMode, startPreparingLayer, finishPreparingLayer, selectIsTimelineDragging, selectIsCanvasInteracting } from '../../../store/slices/projectSlice'
import { updateLayerZOrder } from '../utils/layerUtils'
import { getGlobalMotionEngine } from '../../engine/motion'
import { BLUR_MAX, BLUR_QUALITY, computeBlurPhysicalStrength } from '../../engine/motion/blurConstants.js'
import { loadTextureRobust } from '../../engine/pixi/textureUtils'
import {
  applyTiltToObject,
  removeTiltFromObject,
  syncTiltMesh,
  markTiltTextureDirty,
  TILT_HIDE_SENTINEL
} from '../../engine/pixi/perspectiveTilt'

// [MOBILE FIX] Detect mobile for sequential asset loading
const _isMobileDevice = typeof window !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)

// Helper function to properly destroy image sprites based on texture source
const destroyImageSprite = (sprite, layer) => {
  if (!sprite || sprite.destroyed) return

  // Check if this is an image layer with a texture that needs unloading
  if (layer?.type === LAYER_TYPES.IMAGE && sprite.texture) {
    const imageUrl = layer.data?.url || layer.data?.src

    // For regular URLs (loaded via Assets.load), unload the texture first
    if (imageUrl && !imageUrl.startsWith('blob:')) {
      // NOTE: Handled by PIXI v8 GC; explicit Assets.unload(imageUrl) 
      // is skipped to avoid issues with background conversion.
    }
  }

  // Handle Video-specific cleanup (critical for preventing resource errors)
  if (layer?.type === LAYER_TYPES.VIDEO) {
    // Release from the global cache and kill the element
    if (layer.id) {
      releaseVideoElement(layer.id)
    }

    // Standard Pixi cleanup for the sprite/texture
    sprite.destroy({ texture: true })
  } else {
    // For regular images, just destroy sprite, keep texture (Assets managed)
    sprite.destroy({ texture: false })
  }
}

// ===========================================================================
// UTILITY FUNCTIONS
// ===========================================================================

function degToRad(degrees) {
  return (degrees * Math.PI) / 180
}

const colorCache = new Map()

function parseColorCached(hexColor) {
  if (!hexColor || typeof hexColor !== 'string') return null

  if (colorCache.has(hexColor)) {
    return colorCache.get(hexColor)
  }

  if (hexColor === 'transparent') return null

  try {
    const hex = hexColor.replace('#', '')
    if (hex && /^[0-9A-Fa-f]{6}$/.test(hex)) {
      const parsed = parseInt(hex, 16)
      colorCache.set(hexColor, parsed)
      return parsed
    }
  } catch (e) {
    // Invalid color
  }

  return null
}

const textMetricsCache = new Map()
// Shared style object to avoid constant allocation
const sharedTextStyle = new PIXI.TextStyle()

//Purpose: Measures text dimensions without creating permanent PIXI objects

function getCachedTextBounds(text, style) {
  // PERFORMANCE: Use a faster key builder
  const key = `${text || ''}|${style.fontFamily}|${style.fontSize}|${style.fontWeight}|${style.fontStyle || 'normal'}|${style.wordWrapWidth}|${style.lineHeight}|${style.letterSpacing || 0}`

  if (textMetricsCache.has(key)) {
    return textMetricsCache.get(key)
  }

  try {
    // ENHANCEMENT: Use TextMetrics for ultra-fast measurement without creating PIXI.Text objects
    // PERFORMANCE: Update shared style object instead of creating new one
    Object.assign(sharedTextStyle, {
      fontFamily: style.fontFamily || 'Arial',
      fontSize: style.fontSize || 24,
      fontWeight: style.fontWeight || 'normal',
      fontStyle: style.fontStyle || 'normal',
      wordWrap: style.wordWrap || false,
      wordWrapWidth: style.wordWrapWidth || 100,
      breakWords: true, // [WRAP FIX] Ensure PIXI breaks long words same as browser
      lineHeight: style.lineHeight,
      letterSpacing: 0 // [SYNC FIX] Match browser and creation default
    })

    const metrics = PIXI.TextMetrics.measureText(text || '', sharedTextStyle)
    const bounds = { x: 0, y: 0, width: metrics.width, height: metrics.height }

    textMetricsCache.set(key, bounds)
    return bounds
  } catch (e) {
    return { x: 0, y: 0, width: 100, height: 20 }
  }
}

function debounce(func, wait) {
  let timeout
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout)
      func(...args)
    }
    clearTimeout(timeout)
    timeout = setTimeout(later, wait)
  }
}

const debouncedTextHeightCalculationsRef = { current: new Map() } // Ensure ref exists

function calculateTextHeight(layerId, content, fontSize, wordWrapWidth, fontFamily, fontWeight, fontStyle, dispatch, isEditing = false) {
  const cacheKey = `${layerId}-height-calc`

  const runCalculation = (layerId, content, fontSize, wordWrapWidth, fontFamily, fontWeight, fontStyle, dispatch) => {
    try {
      const textStyle = {
        fontFamily: fontFamily || 'Arial',
        fontSize: fontSize,
        fontWeight: fontWeight || 'normal',
        fontStyle: fontStyle || 'normal',
        wordWrap: true,
        wordWrapWidth: wordWrapWidth,
        breakWords: true, // [WRAP FIX] Consistent metrics
        lineHeight: fontSize * 1.2
      }
      const bounds = getCachedTextBounds(content, textStyle)
      if (bounds.height > 0) {
        const newHeight = Math.max(bounds.height, 20)
        // [SYNC FIX] Lower threshold for height updates to ensure selection box follows exactly
        dispatch((getState) => {
          const state = getState()
          const currentLayer = state.project.layers[layerId]
          if (currentLayer && Math.abs(currentLayer.height - newHeight) > 0.5) {
            return updateLayer({ id: layerId, height: newHeight })
          }
          return { type: 'noop' } // No-op action if height is same
        })
      }
    } catch (e) { }
  }

  // If currently editing, we need IMMEDIATE feedback for the selection box to follow the text
  if (isEditing) {
    runCalculation(layerId, content, fontSize, wordWrapWidth, fontFamily, fontWeight, fontStyle, dispatch)
    return
  }

  if (!debouncedTextHeightCalculationsRef.current.has(cacheKey)) {
    debouncedTextHeightCalculationsRef.current.set(cacheKey, debounce(runCalculation, 200))
  }

  debouncedTextHeightCalculationsRef.current.get(cacheKey)(layerId, content, fontSize, wordWrapWidth, fontFamily, fontWeight, fontStyle, dispatch)
}



// ===========================================================================
// SHAPE DRAWING FUNCTIONS
// ===========================================================================

function updateShapeDimensions(pixiObject, newWidth, newHeight, originalWidth, originalHeight) {
  if (!pixiObject || !(pixiObject instanceof PIXI.Graphics)) return

  const scaleX = newWidth / originalWidth
  const scaleY = newHeight / originalHeight

  pixiObject.scale.set(scaleX, scaleY)

  if (pixiObject.hitArea) {
    if (pixiObject.hitArea instanceof PIXI.Rectangle) {
      pixiObject.hitArea.width = newWidth
      pixiObject.hitArea.height = newHeight
    } else if (pixiObject.hitArea instanceof PIXI.Circle) {
      const size = Math.min(newWidth, newHeight)
      pixiObject.hitArea.radius = size / 2
    } else if (pixiObject.hitArea instanceof PIXI.Ellipse) {
      pixiObject.hitArea.halfWidth = newWidth / 2
      pixiObject.hitArea.halfHeight = newHeight / 2
    }
  }
}

function redrawShapeWithColors(pixiObject, shapeData, width, height, anchorX, anchorY) {
  if (!pixiObject || !(pixiObject instanceof PIXI.Graphics)) return

  // Stash dimensions/anchor on the object so the tilt RTT capture can compute
  // a stable origin without relying on getLocalBounds(), which in PIXI v8
  // returns stale/zero values right after clear()+redraw and would size the
  // RenderTexture incorrectly (causing the mesh to show nothing).
  pixiObject._storedWidth = width
  pixiObject._storedHeight = height
  pixiObject._storedAnchorX = anchorX
  pixiObject._storedAnchorY = anchorY

  const fill = parseColorCached(shapeData.fill)
  let stroke = null

  if (shapeData.stroke && shapeData.stroke !== '') {
    stroke = parseColorCached(shapeData.stroke)
  } else if (shapeData.strokeWidth > 0) {
    stroke = 0x000000
  }

  const strokeWidth = shapeData.strokeWidth || 0
  const strokeStyle = shapeData.strokeStyle || 'solid'
  const shapeType = shapeData.shapeType || 'rect'
  const isCircle = shapeType === 'circle'

  // Calculate shape center position based on anchor point
  const halfWidth = width / 2
  const halfHeight = height / 2

  // For anchor 0.5: center at (0,0) - shape centered on position
  // For anchor 0: center at (halfWidth, halfHeight) - shape starts at position
  // For anchor 1: center at (-halfWidth, -halfHeight) - shape ends at position
  const shapeCenterX = halfWidth * (1 - 2 * anchorX)
  const shapeCenterY = halfHeight * (1 - 2 * anchorY)

  const isDashed = strokeStyle === 'dashed' && stroke !== null && strokeWidth > 0
  const isDotted = strokeStyle === 'dotted' && stroke !== null && strokeWidth > 0

  pixiObject.clear()

  // Draw shape path (fills exactly width × height — required for applyTransformInline to leave scale=1)
  drawShapePath(pixiObject, shapeType, shapeCenterX, shapeCenterY, width, height, shapeData.cornerRadius || 0)

  if (fill !== null) {
    pixiObject.fill(fill)
  } else {
    pixiObject.fill({ color: 0x000000, alpha: 0 })
  }

  if (stroke !== null && strokeWidth > 0) {
    if (isDashed || isDotted) {
      // Dashed circles fall back to solid; all other shapes use dashed bounding rect
      if (isCircle) {
        pixiObject.ellipse(shapeCenterX, shapeCenterY, halfWidth, halfHeight)
        pixiObject.stroke({ color: stroke, width: strokeWidth, alignment: 0.5 })
      } else {
        const dashLen = isDotted ? 0 : strokeWidth * 4
        const gapLen = strokeWidth * 2
        drawDashedRect(pixiObject, shapeCenterX - halfWidth, shapeCenterY - halfHeight, width, height, shapeData.cornerRadius || 0, stroke, strokeWidth, dashLen, gapLen)
      }
    } else {
      // Redraw path so the stroke follows the exact shape outline
      drawShapePath(pixiObject, shapeType, shapeCenterX, shapeCenterY, width, height, shapeData.cornerRadius || 0)
      pixiObject.stroke({ color: stroke, width: strokeWidth, alignment: 0.5 })
    }
  }

  if (fill === null) {
    if (isCircle) {
      pixiObject.hitArea = new PIXI.Ellipse(shapeCenterX, shapeCenterY, halfWidth, halfHeight)
    } else {
      pixiObject.hitArea = new PIXI.Rectangle(shapeCenterX - halfWidth, shapeCenterY - halfHeight, width, height)
    }
  } else {
    pixiObject.hitArea = null
  }
}

// ===========================================================================
// TRANSFORM AND POSITIONING FUNCTIONS
// ===========================================================================

export function applyTransformInline(displayObject, layer, dragStateAPI, layerId, motionCaptureMode = null, force = false, editingTextLayerId = null, editingStepId = null) {
  if (!displayObject || !layer) return

  if (displayObject.destroyed) {
    return
  }

  const isEditingText = layerId === editingTextLayerId
  displayObject._isEditingText = isEditingText
  if (isEditingText) {
    if (displayObject._tiltMesh) {
      removeTiltFromObject(displayObject)
    }
    displayObject.visible = false
    displayObject.alpha = layer.opacity !== undefined ? layer.opacity : 1
  }

  // Skip visual overrides if the layer is currently animating a local preset preview
  if (displayObject._isPlayingPresetPreview) {
    return
  }

  // [FIX] BACKGROUND PROTECTION: Skip geometric transforms for background layers.
  // Their dimensions and positioning are managed separately to ensure "cover" fit
  // and non-interactivity.
  if (layer.type === 'background') {
    // Sync opacity only (but don't clobber alpha=0 set by the tilt system to hide the original)
    if (layer.opacity !== undefined && !displayObject._tiltHidden) {
      displayObject.alpha = layer.opacity
    }
    return
  }

  // Check for motion capture overrides
  const capturedLayer = motionCaptureMode?.isActive && motionCaptureMode.trackedLayers?.get(layerId)

  // CRITICAL: Lockout - Do not apply any transforms if the layer is currently being interactively modified
  const isInteracting = displayObject._isResizing === true || displayObject._isRotating === true
  if (isInteracting) {
    return
  }

  const isDragging = dragStateAPI && layerId ? dragStateAPI.isLayerDragging(layerId) : displayObject._isDragging === true

  // Use engine state directly for synchronous checks
  const engine = getGlobalMotionEngine()
  const isActuallyPlaying = engine.getIsPlaying()
  const currentTime = engine.masterTimeline?.time() || 0

  // [FIX] Scene-aware start check: 
  // We only want to apply Redux "base" state if we are at the START of the current scene's duration,
  // OR if the layer has no motion actions (so it isn't controlled by GSAP).
  // This allows GSAP to maintain control during scrubbing/playing.
  // [BASE EDITING FIX] Even when editing base, we only force base state if we are at the scene start.
  // This prevents the "snap back" glitch during seeking after clicking the 'B' block.
  const isEditingBase = editingStepId === 'base'
  const startTimeOffset = layer.sceneStartOffset ?? 0
  const hasMotion = engine.activeTimelines?.has(layerId)
  // [FIX] GSAP Baseline Priority: Redux raw base state is only applied if the layer has no animation timeline at all,
  // or if the user is explicitly editing the base layer starting state. This prevents clobbering baseline set tweens.
  const shouldApplyBaseState = !hasMotion || isEditingBase
  // 4. Metadata & Muted State Synchronization (CRITICAL for Video playback)
  // This must happen even during playback to ensure scene switches and mute toggles are reactive.
  if (displayObject instanceof PIXI.Container && (displayObject._imageSprite || displayObject._videoSprite)) {
    // [FIX] Always sync video timing metadata — this is read by syncMedia, not a visual transform.
    // This ensures the video element knows its correct offset even if a scene switch happens mid-playback.
    displayObject._sourceStartTime = layer.data?.sourceStartTime || 0
    displayObject._sourceEndTime = layer.data?.sourceEndTime || (layer.data?.duration || 0)

    if (layer.data?.isCardFrame) {
      displayObject._backSourceStartTime = layer.data?.backSourceStartTime || 0
      displayObject._backSourceEndTime = layer.data?.backSourceEndTime || (layer.data?.backDuration || 0)
      displayObject._frontLayerMuted = layer.data?.muted !== false
      displayObject._backLayerMuted = layer.data?.backMuted !== false
      // Set the active _layerMuted dynamically based on showingFront
      const showingFront = displayObject._showingFront !== false
      displayObject._layerMuted = showingFront ? displayObject._frontLayerMuted : displayObject._backLayerMuted
    } else {
      // Sync muted state dynamically.
      const isMuted = layer.data?.muted !== false;
      displayObject._layerMuted = isMuted; // [BUG FIX] Pass flag to MotionEngine for playback sync
    }
  }

  // Skip updates during playback unless forced (GSAP is in control)
  if (isActuallyPlaying && !force) {
    return
  }

  // 1. Position Synchronization
  if (force) {
    if (layer.x !== undefined) displayObject.x = layer.x
    if (layer.y !== undefined) displayObject.y = layer.y

    // Reset colors to base Redux values
    if (layer.type === 'text') {
      const reduxBaseTextColor = layer.data?.color || '#000000'
      if (displayObject.isFlowText && typeof displayObject.updateColor === 'function') {
        displayObject.updateColor(reduxBaseTextColor)
      } else if (displayObject.style) {
        displayObject.style.fill = reduxBaseTextColor
      }
      displayObject._lastReduxFillApplied = reduxBaseTextColor
    } else if (layer.type === 'shape') {
      const reduxBaseFill = layer.data?.fill || null
      const currentWidth = layer.width || 100
      const currentHeight = layer.height || 100
      const liveShapeData = {
        ...layer.data,
        fill: reduxBaseFill
      }
      redrawShapeWithColors(displayObject, liveShapeData, currentWidth, currentHeight, layer.anchorX ?? 0.5, layer.anchorY ?? 0.5)
      displayObject._storedFill = reduxBaseFill
      displayObject._lastReduxFillApplied = reduxBaseFill
    } else if (layer.type === 'background') {
      const reduxBaseBgColor = layer.data?.color !== undefined ? layer.data.color : 0xffffff
      const targetWidth = layer.width || displayObject._storedWidth || 1920
      const targetHeight = layer.height || displayObject._storedHeight || 1080
      const graphics = displayObject._backgroundGraphics
      if (graphics) {
        graphics.clear()
        graphics.rect(0, 0, targetWidth, targetHeight)
        graphics.fill(reduxBaseBgColor)
      }
      displayObject._storedColor = reduxBaseBgColor
      displayObject._lastReduxBgColorApplied = reduxBaseBgColor
    }
  } else if (!isDragging) {
    if (capturedLayer && capturedLayer.didMove && capturedLayer.currentPosition && !isActuallyPlaying) {
      displayObject.x = capturedLayer.currentPosition.x
      displayObject.y = capturedLayer.currentPosition.y
    } else if (!isActuallyPlaying && shouldApplyBaseState) {
      // [FIX] Only sync with Redux base state if we are at the START of the timeline
      // OR if we're editing the base (editingStepId === 'base')
      // This prevents snapping back when selecting a layer while paused mid-play.
      // [BASE EDITING FIX] Allow updates when editing base state
      if (layer.x !== undefined) displayObject.x = layer.x
      if (layer.y !== undefined) displayObject.y = layer.y
    }
  }

  // 2. Scale Synchronization
  const currentScaleX = (capturedLayer && capturedLayer.didScale) ? capturedLayer.scaleX : (layer.scaleX !== undefined ? layer.scaleX : 1)
  const currentScaleY = (capturedLayer && capturedLayer.didScale) ? capturedLayer.scaleY : (layer.scaleY !== undefined ? layer.scaleY : 1)

  // [FIX] EXCLUDE PIXI.Text from manual .width/.height scaling.
  // Text layers should render naturally via their .style properties (fontSize, wordWrapWidth)
  // and only be scaled via .scale property. Setting .width directly on Text objects
  // stretches/squishes the text texture, leading to distortion and clipping-like effects.
  const isScaleCaptured = !!(capturedLayer && capturedLayer.didScale)
  if (displayObject instanceof PIXI.Sprite && !(displayObject instanceof PIXI.Text)) {
    const baseWidth = isScaleCaptured ? capturedLayer.width : layer.width
    const baseHeight = isScaleCaptured ? capturedLayer.height : layer.height

    if (force || (!isActuallyPlaying && (isScaleCaptured || shouldApplyBaseState))) {
      if (baseWidth !== undefined) displayObject.width = baseWidth * currentScaleX
      if (baseHeight !== undefined) displayObject.height = baseHeight * currentScaleY
    }
  } else {
    if (force || (!isActuallyPlaying && (isScaleCaptured || shouldApplyBaseState))) {
      displayObject.scale.set(currentScaleX, currentScaleY)
    }
  }

  // 3. Rotation Synchronization
  if (force) {
    if (layer.rotation !== undefined) displayObject.rotation = degToRad(layer.rotation)
  } else if (capturedLayer && capturedLayer.didRotate && capturedLayer.rotation !== undefined && !isActuallyPlaying) {
    displayObject.rotation = degToRad(capturedLayer.rotation)
  } else if (layer.rotation !== undefined && !isActuallyPlaying && shouldApplyBaseState) {
    displayObject.rotation = degToRad(layer.rotation)
  }

  // 4. Width/Height/Style Synchronization (for Graphics/Text/Containers)
  const isCropCaptured = !!(capturedLayer && capturedLayer.didCrop)
  const hasCapturedLayer = !!capturedLayer
  if (force || hasCapturedLayer || !isActuallyPlaying) {
    if (displayObject instanceof PIXI.Text) {
      // Sync data and _fullContent references to prevent stale references in revealProgress
      displayObject.data = layer.data
      displayObject._fullContent = layer.data?.content || ''
      const isResizing = displayObject._isResizing === true
      const style = displayObject.style
      if (!isResizing && style) {
        // [SELECTION BOX FIX] Push the Redux font size onto the PIXI text style so the
        // glyph texture — and getLocalBounds(), which the selection box reads — updates
        // the instant the user changes font size from the canvas controls. Previously
        // only wordWrapWidth was synced here, so the selection box kept stale dimensions
        // until a manual resize/scale happened to set style.fontSize. lineHeight mirrors
        // the 1.2 ratio used by the resize handler for visual consistency.
        let needsTextUpdate = false
        const desiredFontSize = layer.data?.fontSize
        if (typeof desiredFontSize === 'number' && desiredFontSize > 0 && style.fontSize !== desiredFontSize) {
          style.fontSize = desiredFontSize
          style.lineHeight = desiredFontSize * 1.2
          needsTextUpdate = true
        }
        if (layer.width > 0 && style.wordWrapWidth !== layer.width) {
          style.wordWrapWidth = layer.width
          needsTextUpdate = true
        }
        if (needsTextUpdate && displayObject.updateText) displayObject.updateText(true)
      }

      const align = layer.data?.textAlign || 'left'
      const anchorX = align === 'center' ? 0.5 : (align === 'right' ? 1 : 0)
      const currentWidth = layer.width || 200

      // PERFORMANCE FIX: Removed unconditional updateText(true) that was causing expensive 
      // canvas rasterization on every frame/render loop for PIXI.Text objects.
      const actualHeight = displayObject.getLocalBounds().height || layer.height || 40

      if (displayObject.anchor.x !== anchorX) displayObject.anchor.set(anchorX, 0)
      displayObject.pivot.set((0.5 - anchorX) * currentWidth, actualHeight / 2)
    } else if (displayObject._imageSprite || displayObject._videoSprite) {
      if (force || isCropCaptured || (!isActuallyPlaying && shouldApplyBaseState)) {
        const sprite = displayObject._imageSprite || displayObject._videoSprite
        const cropMask = displayObject._cropMask

        // Read crop state from captured layer (live) OR Redux (stale during capture)
        const mediaW = isCropCaptured ? capturedLayer.mediaWidth : (layer.mediaWidth ?? displayObject._mediaWidth ?? displayObject._originalWidth ?? layer.width ?? 100)
        const mediaH = isCropCaptured ? capturedLayer.mediaHeight : (layer.mediaHeight ?? displayObject._mediaHeight ?? displayObject._originalHeight ?? layer.height ?? 100)
        const cropX = isCropCaptured ? capturedLayer.cropX : (layer.cropX ?? 0)
        const cropY = isCropCaptured ? capturedLayer.cropY : (layer.cropY ?? 0)
        const cropW = isCropCaptured ? capturedLayer.cropWidth : (layer.cropWidth ?? layer.width ?? 100)
        const cropH = isCropCaptured ? capturedLayer.cropHeight : (layer.cropHeight ?? layer.height ?? 100)

        // Store these values on the object so CropAction can initialize from them if needed
        displayObject._storedCropX = cropX
        displayObject._storedCropY = cropY
        displayObject._storedCropWidth = cropW
        displayObject._storedCropHeight = cropH
        displayObject._storedMediaWidth = mediaW
        displayObject._storedMediaHeight = mediaH

        // If the object has reactive properties (GSAP setters), update them as well so they are in sync
        if (displayObject._hasGSAPProperties || displayObject._hasReactiveCropProperties) {
          displayObject.cropX = cropX
          displayObject.cropY = cropY
          displayObject.cropWidth = cropW
          displayObject.cropHeight = cropH
          displayObject.mediaWidth = mediaW
          displayObject.mediaHeight = mediaH
        }

        // Update sprite to match full media size
        if (Math.abs(sprite.width - mediaW) > 0.1) sprite.width = mediaW
        if (Math.abs(sprite.height - mediaH) > 0.1) sprite.height = mediaH

        // Offset sprite so crop region starts at container origin
        if (Math.abs(sprite.x - (-cropX)) > 0.1) sprite.x = -cropX
        if (Math.abs(sprite.y - (-cropY)) > 0.1) sprite.y = -cropY

        // Update crop mask
        if (cropMask) {
          cropMask.clear()
          cropMask.rect(0, 0, cropW, cropH)
          cropMask.fill(0xffffff)
        }

        // Update pivot for anchor-based positioning (required so visual center matches container position)
        const targetAnchorX = layer.anchorX !== undefined ? layer.anchorX : 0.5
        const targetAnchorY = layer.anchorY !== undefined ? layer.anchorY : 0.5
        displayObject.pivot.set(cropW * targetAnchorX, cropH * targetAnchorY)
      }
    } else if (!(displayObject instanceof PIXI.Graphics) && !(displayObject instanceof PIXI.Sprite)) {
      if (force || (!isActuallyPlaying && (isScaleCaptured || shouldApplyBaseState))) {
        if (layer.width !== undefined) displayObject.width = layer.width
        if (layer.height !== undefined) displayObject.height = layer.height
      }
    }
  }

  // 5. Anchor Synchronization (for standard Sprites that aren't Text or Cropped Containers)
  if (!(displayObject instanceof PIXI.Text) && !(displayObject._imageSprite || displayObject._videoSprite)) {
    if (displayObject.anchor) {
      const anchorX = layer.anchorX !== undefined ? layer.anchorX : (displayObject.anchor.x ?? 0.5)
      const anchorY = layer.anchorY !== undefined ? layer.anchorY : (displayObject.anchor.y ?? 0.5)
      displayObject.anchor.set(anchorX, anchorY)
    }
  }

  // 6. Opacity (Alpha) Synchronization
  // Skip writing to displayObject.alpha when tilt is hiding the original
  // (alpha=0 is load-bearing for that system; the mesh shows the displayed
  // opacity).  We still forward the intended opacity through `_intendedAlpha`
  // so the next syncTiltMesh tick applies it to mesh.alpha.
  //
  // [ANIMATED-EDIT FIX] Mirror the colour sentinel pattern: if the Redux base
  // opacity genuinely changed since the last time we applied it, bypass the
  // shouldApplyBaseState gate so the edit is visible at any timeline position.
  const reduxOpacity = layer.opacity ?? 1
  const allowOpacityUpdate = force || shouldApplyBaseState

  if (!displayObject._tiltHidden) {
    if (force) {
      if (layer.opacity !== undefined) displayObject.alpha = layer.opacity
    } else if (!isActuallyPlaying) {
      if (capturedLayer && capturedLayer.didFade && capturedLayer.opacity !== undefined) {
        displayObject.alpha = capturedLayer.opacity
      } else if (allowOpacityUpdate && layer.opacity !== undefined) {
        displayObject.alpha = layer.opacity
      }
    }
  } else {
    // Tilted: route the intended opacity to the tilt system instead of
    // pixiObject.alpha so the mesh's alpha follows the user's slider /
    // captured value while the original stays at alpha=TILT_HIDE_SENTINEL.
    //
    // Gating MUST mirror the non-tilted branch above — otherwise we'd
    // clobber a FadeAction's tweened alpha during animation playback.
    if (force) {
      if (layer.opacity !== undefined) displayObject._intendedAlpha = layer.opacity
    } else if (!isActuallyPlaying) {
      if (capturedLayer && capturedLayer.didFade && capturedLayer.opacity !== undefined) {
        displayObject._intendedAlpha = capturedLayer.opacity
      } else if (allowOpacityUpdate && layer.opacity !== undefined) {
        displayObject._intendedAlpha = layer.opacity
      }
    }

    // [SENTINEL FIX] Ensure the original layer is at the sentinel value.
    // This prevents stale alpha values (from prepareEngine/force resets)
    // from being captured as "intended" in the next ticker tick.
    if (displayObject.alpha !== TILT_HIDE_SENTINEL) {
      displayObject.alpha = TILT_HIDE_SENTINEL
    }
  }
  // Track the last Redux opacity we applied (for the sentinel-change bypass above)
  if (!capturedLayer && !isActuallyPlaying) {
    displayObject._lastReduxOpacityApplied = reduxOpacity
  }

  // 7. Blur Filter Synchronization
  // Blur is stored as 0-BLUR_MAX in Redux.
  // [ANIMATED-EDIT FIX] Sentinel-change bypass: allow update whenever the Redux
  // base blur value genuinely changes, regardless of timeline position.
  // This mirrors the opacity/color sentinel pattern — prevents static blur
  // sync from overwriting GSAP-driven animated blur after prepareEngine rebuilds.
  const reduxBlur = layer.blur ?? 0
  const reduxBlurChanged = displayObject._lastReduxBlurApplied !== reduxBlur
  const allowBlurUpdate = force || shouldApplyBaseState

  if (force) {
    syncBlurFilter(displayObject, reduxBlur)
  } else if (!isActuallyPlaying) {
    if (capturedLayer && capturedLayer.didBlur && capturedLayer.blur !== undefined) {
      syncBlurFilter(displayObject, capturedLayer.blur)
    } else if (allowBlurUpdate && reduxBlur !== undefined) {
      syncBlurFilter(displayObject, reduxBlur)
    }
  }
  // Track last Redux blur applied
  if (!capturedLayer && !isActuallyPlaying) {
    displayObject._lastReduxBlurApplied = reduxBlur
  }

  // 8. Tilt Synchronization (3D perspective).
  // Redux is the source of truth for the angle; the mesh is a visual slave
  // whose transforms we re-copy every sync so it stays glued to the original.
  const isTiltCaptured = !!(capturedLayer && capturedLayer.didTilt)
  const capturedTiltX = isTiltCaptured ? capturedLayer.tiltX : undefined
  const capturedTiltY = isTiltCaptured ? capturedLayer.tiltY : undefined
  const tiltX = capturedTiltX ?? (layer.tiltX ?? 0)
  const tiltY = capturedTiltY ?? (layer.tiltY ?? 0)
  const hasTilt = Math.abs(tiltX) > 0.01 || Math.abs(tiltY) > 0.01
  const tiltRenderer = displayObject._pixiRenderer || null
  // [ANIMATED-EDIT FIX] Sentinel-change bypass for tilt: allow update whenever the
  // Redux base tilt values genuinely change, regardless of timeline position.
  const reduxTiltKey = `${layer.tiltX ?? 0},${layer.tiltY ?? 0}`
  const canApplyTiltState = force || isTiltCaptured || (!isActuallyPlaying && shouldApplyBaseState)
  // [PERF] Track whether applyTiltToObject was called — it internally syncs
  // the mesh, so we skip the redundant syncTiltMesh() below.
  let _tiltMeshAlreadySynced = false
  if (canApplyTiltState) {
    if (hasTilt && !isEditingText) {
      applyTiltToObject(displayObject, tiltX, tiltY, tiltRenderer)
      _tiltMeshAlreadySynced = true
    } else if (displayObject._tiltMesh) {
      removeTiltFromObject(displayObject)
      // Step 6 was skipped above because _tiltHidden was still true at that
      // point; now that the mesh is gone, push the layer's intended opacity
      // back onto the object so we don't leave it at the alpha=1 sentinel
      // removeTiltFromObject set.
      const targetAlpha = ((capturedLayer && capturedLayer.didFade) ? capturedLayer.opacity : layer.opacity)
      if (targetAlpha !== undefined) displayObject.alpha = targetAlpha
    }
  }
  // Track last Redux tilt applied
  if (!capturedLayer && !isActuallyPlaying) {
    displayObject._lastReduxTiltApplied = reduxTiltKey
  }
  // [Bug 3 Fix] When a resize just ended on this layer (within the last 150ms),
  // skip the unconditional syncTiltMesh. handleResizeEnd() already properly
  // synced the mesh corners and scheduled a forced RTT recapture via
  // requestAnimationFrame. Calling syncTiltMesh here without the force flag
  // would re-compute corners using potentially stale _tiltCaptureW/H (before
  // the deferred RTT recapture finishes), causing the mesh to visually drift
  // away from the selection box after releasing the mouse.
  const RECENT_RESIZE_END = typeof displayObject._lastResizeEndTime === 'number'
    && (performance.now() - displayObject._lastResizeEndTime) < 150

  if (displayObject._tiltMesh && !_tiltMeshAlreadySynced) {
    // Mirror the owner's intended visibility onto the mesh so scene cuts,
    // editing-text-hide, and other visibility toggles propagate.
    displayObject._tiltOwnerVisible = displayObject.visible !== false
    // [Bug 3 Fix v2] When a resize just ended and applyTransformInline has
    // synced the PIXI state from Redux, force a full RTT recapture IMMEDIATELY.
    // This is the most direct fix: instead of skipping syncTiltMesh and relying
    // on a deferred RAF callback (which introduces a frame of visual drift),
    // we force the recapture right here with the freshly-synced PIXI state.
    if (RECENT_RESIZE_END) {
      syncTiltMesh(displayObject, layer, { force: true })
    } else {
      syncTiltMesh(displayObject, layer)
    }
  } else if (displayObject._tiltMesh) {
    // Mesh was already synced by applyTiltToObject above — only update
    // visibility metadata, no redundant CPU syncTiltMesh call.
    displayObject._tiltOwnerVisible = displayObject.visible !== false
  }
  
  if (!displayObject._tiltMesh && allowOpacityUpdate && !displayObject._tiltHidden && displayObject.alpha === 0 && (((capturedLayer && capturedLayer.didFade) ? capturedLayer.opacity : layer.opacity) ?? 1) > 0) {
    // Guard for the frame after tilt is removed: step 6 may have been gated by
    // _tiltHidden earlier, so the alpha=0 left over from the hide mechanism would
    // otherwise persist. Restore here once mesh is gone.
    // [FIX] Use capturedLayer.opacity if available, otherwise fallback to base layer.opacity.
    displayObject.alpha = ((capturedLayer && capturedLayer.didFade) ? capturedLayer.opacity : layer.opacity) ?? 1
  }

  // 9. Card Frame (showingFront) Synchronization
  if (displayObject._isCardFrame && displayObject.showingFront !== undefined) {
    let targetShowingFront = layer.data?.showingFront !== false
    const isFlipCaptured = !!(capturedLayer && capturedLayer.didFlip)
    const canApplyShowingFront = force || isFlipCaptured || (!isActuallyPlaying && shouldApplyBaseState)
    if (canApplyShowingFront) {
      if (isFlipCaptured && capturedLayer && capturedLayer.showingFront !== undefined) {
        targetShowingFront = capturedLayer.showingFront
      }

      if (!displayObject._isFlipping && displayObject.showingFront !== targetShowingFront) {
        displayObject.showingFront = targetShowingFront
      }
    }
  }
}

/**
 * Helper to manage PIXI.BlurFilter on a display object.
 * Uses filter.strength (PIXI v8). Values clamped to 0–BLUR_MAX for low-end/mobile perf.
 */
function syncBlurFilter(displayObject, blurValue) {
  displayObject._blurLogicalStrength = blurValue
  displayObject._blur = blurValue

  const physicalStrength = computeBlurPhysicalStrength(blurValue, displayObject)
  let blurChanged = false
  if (physicalStrength > 0) {
    if (!displayObject._blurFilter) {
      displayObject._blurFilter = new PIXI.BlurFilter()
      displayObject._blurFilter.quality = BLUR_QUALITY
    }
    if (Math.abs(displayObject._blurFilter.strength - physicalStrength) > 0.05) {
      displayObject._blurFilter.strength = physicalStrength
      blurChanged = true
    }
    if (!displayObject.filters || !displayObject.filters.includes(displayObject._blurFilter)) {
      displayObject.filters = displayObject.filters ? [...displayObject.filters, displayObject._blurFilter] : [displayObject._blurFilter]
      blurChanged = true
    }
  } else if (displayObject._blurFilter) {
    if (displayObject._blurFilter.strength !== 0) blurChanged = true
    displayObject._blurFilter.strength = 0
    if (displayObject.filters && displayObject.filters.includes(displayObject._blurFilter)) {
      displayObject.filters = displayObject.filters.filter(f => f !== displayObject._blurFilter)
      if (displayObject.filters.length === 0) displayObject.filters = null
      blurChanged = true
    }
  }
  // Blur is applied as a filter on the original layer.  Since the tilt mesh
  // shows the captured RTT (which bakes in filter output), any change to blur
  // means the mesh must re-capture.
  if (blurChanged) markTiltTextureDirty(displayObject)
}

// ===========================================================================
// LOAD TIMEOUT GUARD
// Races each async asset load against a deadline so a hung network request or
// PIXI promise never keeps asyncLoadCounterRef > 0 forever (infinite loader).
// ===========================================================================

const ASSET_LOAD_TIMEOUT_MS = 15000 // 15 s — generous for slow mobile connections

function withLoadTimeout(promise) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Asset load timed out after 15 s')), ASSET_LOAD_TIMEOUT_MS)
    )
  ])
}

// ===========================================================================
// CANVAS PLACEHOLDER HELPERS
// Creates a lightweight shimmer placeholder on the canvas immediately when an
// image or video is being loaded, giving instant spatial feedback to the user.
// ===========================================================================

function _createPlaceholder(layer, layerId) {
  try {
    const w = layer.width || 100
    const h = layer.height || 100
    const ax = layer.anchorX ?? 0.5
    const ay = layer.anchorY ?? 0.5

    const container = new PIXI.Container()
    container.label = `placeholder-layer-${layerId}`
    container.eventMode = 'none'
    container.x = layer.x || 0
    container.y = layer.y || 0

    // Base background shape (shimmering purple outline/fill)
    const g = new PIXI.Graphics()
    g.roundRect(-w * ax, -h * ay, w, h, 10)
    g.fill({ color: 0x7c4af0, alpha: 0.14 })
    g.stroke({ color: 0x7c4af0, width: 1.5, alpha: 0.40 })
    container.addChild(g)

    const thumbnailUrl = layer.data?.thumbnail || 
      layer.data?.metadata?.thumbnail || 
      (layer.type === 'image' ? (layer.data?.url || layer.data?.src) : null)
    if (thumbnailUrl) {
      try {
        const img = new Image()
        if (thumbnailUrl && !thumbnailUrl.startsWith('data:') && !thumbnailUrl.startsWith('blob:')) {
          img.crossOrigin = 'anonymous'
        }
        
        const texture = PIXI.Texture.from(img)
        img.onload = () => {
          if (texture.source) {
            texture.source.update()
          }
        }
        img.src = thumbnailUrl

        const sprite = new PIXI.Sprite(texture)
        sprite.width = w
        sprite.height = h
        sprite.anchor.set(ax, ay)
        sprite.alpha = 0.55
        
        // Rounded crop mask to match the placeholder border
        const mask = new PIXI.Graphics()
        mask.roundRect(-w * ax, -h * ay, w, h, 10)
        mask.fill(0xffffff)
        container.addChild(mask)
        sprite.mask = mask

        container.addChild(sprite)
      } catch (err) {
        console.warn('[_createPlaceholder] Failed to load thumbnail sprite:', err)
      }
    }

    // Lightweight shimmer: oscillate container alpha via the shared ticker
    let _phase = 0
    const _tick = () => {
      if (container.destroyed) return
      _phase += 0.06
      container.alpha = 0.65 + 0.25 * Math.sin(_phase)
    }
    PIXI.Ticker.shared.add(_tick)
    container._placeholderTick = _tick
    return container
  } catch (e) {
    return null
  }
}

function _destroyPlaceholder(placeholder, stageContainer) {
  if (!placeholder || placeholder.destroyed) return
  try {
    if (placeholder._placeholderTick) {
      PIXI.Ticker.shared.remove(placeholder._placeholderTick)
      placeholder._placeholderTick = null
    }
    if (stageContainer && !stageContainer.destroyed) {
      stageContainer.removeChild(placeholder)
    }
    placeholder.destroy({ children: true })
  } catch (e) { /* silent — placeholder already cleaned up */ }
}

export function useCanvasLayers(stageContainer, isReady, pixiApp = null, worldWidth = 1920, worldHeight = 1080, dragStateAPI = null, motionCaptureMode = null, editingTextLayerId = null, zoom = 100, editingStepId = null) {
  const dispatch = useDispatch()
  const loadingMode = useSelector(selectLoadingMode)
  const isTimelineDragging = useSelector(selectIsTimelineDragging)
  const isCanvasInteracting = useSelector(selectIsCanvasInteracting)

  // Trigger a full redraw of text layers when web fonts finish loading
  const [fontsLoadedVersion, setFontsLoadedVersion] = useState(0)

  useEffect(() => {
    if (document.fonts) {
      let isMounted = true;
      const handleLoadingDone = () => {
        if (!isMounted) return;
        // console.log(`[useCanvasLayers] Fonts ready. Status: ${document.fonts.status}`);
        textMetricsCache.clear();
        setFontsLoadedVersion(v => v + 1);
      };

      // Initial check
      document.fonts.ready.then(() => {
        setTimeout(handleLoadingDone, 300); // Wait for browser rasterizer to catch up
      }).catch(() => { });

      document.fonts.addEventListener('loadingdone', handleFontChange);

      // Poll a few times during first 10 seconds to catch late-load fonts
      const pollSequence = [1000, 2000, 5000, 10000];
      const timeouts = pollSequence.map(delay => setTimeout(handleLoadingDone, delay));

      function handleFontChange() {
        if (document.fonts.status === 'loaded') {
          handleLoadingDone();
        }
      }

      return () => {
        isMounted = false;
        document.fonts.removeEventListener('loadingdone', handleFontChange);
        timeouts.forEach(t => clearTimeout(t));
      };
    } else {
      // console.warn('[useCanvasLayers] document.fonts API not available')
    }
  }, []);

  // [Bug 3 Fix] Counter that increments whenever an async layer (video/image) resolves.
  // This gives useCanvasInteractions a stable dep to rebind pointer handlers after async creation.
  const [layerObjectsVersion, setLayerObjectsVersion] = useState(0)
  const [isStageReady, setIsStageReady] = useState(false)
  // [FIX] Persistent ref counter for async loads — survives across render cycles
  const asyncLoadCounterRef = useRef(0)
  // [MOBILE FIX] Sequential loading queue — on mobile, async layer creations are queued
  // and processed one-at-a-time to prevent simultaneous image decoding that crashes iOS
  const mobileLoadQueueRef = useRef([])
  const mobileLoadRunningRef = useRef(false)

  const layers = useSelector((state) => {
    try {
      return state?.project?.layers || {}
    } catch (error) {
      return {}
    }
  }, (left, right) => {
    if (!left || !right) return left === right
    return Object.keys(left).length === Object.keys(right).length &&
      Object.keys(left).every(key => left[key] === right[key])
  })

  const currentScene = useSelector((state) => {
    try {
      const sceneId = state?.project?.currentSceneId
      if (!sceneId) return null
      return state?.project?.scenes?.find(s => s.id === sceneId) || null
    } catch (error) {
      return null
    }
  })

  const selectedLayerIds = useSelector((state) => {
    try {
      return state?.selection?.selectedLayerIds || []
    } catch (error) {
      return []
    }
  }, (left, right) => {
    if (!left || !right) return left === right
    if (left.length !== right.length) return false
    return left.every((id, index) => id === right[index])
  })

  const layerObjectsRef = useRef(new Map())
  const createdLayersRef = useRef(new Set())
  const previousLayerValuesRef = useRef(new Map())
  const previousSelectedLayerIdsRef = useRef(new Set())

  // Get all project scenes to build the global layer order
  const scenes = useSelector(selectScenes)
  const timelineInfo = useSelector(selectProjectTimelineInfo)
  const projectStatus = useSelector(state => state?.project?.status || 'idle')

  // Build a project-wide layer order (concatenating all scenes)
  // We need a stable reference to all project layers, not just the current scene,
  // to properly manage assets like backgrounds that might persist across scenes,
  // and so MotionEngine can toggle their visibility during continuous project playback.
  const layerOrder = useMemo(() => {
    return scenes.reduce((acc, scene) => [...acc, ...scene.layers], [])
  }, [scenes])

  const layerRenderData = useMemo(() => {
    const renderData = {}

    // Create a lookup for scene start times to avoid repeated searching
    const sceneStartTimeMap = {}
    scenes.forEach(s => {
      const info = timelineInfo.find(ti => ti.id === s.id)
      if (info) sceneStartTimeMap[s.id] = info.startTime
    })

    layerOrder.forEach(layerId => {
      const layer = layers?.[layerId]
      if (layer) {
        // Calculate project-wide visibility
        // Layer is visible if it belongs to current scene OR we are playing the whole project
        const isVisibleInProject = layer.sceneId === currentScene?.id

        renderData[layerId] = {
          type: layer.type,
          x: layer.x,
          y: layer.y,
          width: layer.width,
          height: layer.height,
          rotation: layer.rotation,
          scaleX: layer.scaleX,
          scaleY: layer.scaleY,
          opacity: layer.opacity,
          visible: layer.visible && isVisibleInProject,
          anchorX: layer.anchorX,
          anchorY: layer.anchorY,
          sceneId: layer.sceneId,
          sceneStartOffset: sceneStartTimeMap[layer.sceneId] || 0,
          sourceId: layer.data?.id || layer.id,
          // Sync video timing properties
          sourceStartTime: layer.data?.sourceStartTime || 0,
          sourceEndTime: layer.data?.sourceEndTime || layer.data?.duration || 0,
          // CRITICAL: Ensure data property is properly populated for all types
          data: {
            ...layer.data,
            sourceStartTime: layer.data?.sourceStartTime || 0,
            sourceEndTime: layer.data?.sourceEndTime || layer.data?.duration || 0,
          }
        }
      }
    })
    return renderData
  }, [layers, layerOrder, currentScene?.id, scenes, timelineInfo])

  // =======================================================================
  // CONSOLIDATED LAYER MANAGEMENT (CREATION, UPDATE, CLEANUP, VISIBILITY)
  // =======================================================================
  // We use useLayoutEffect to ensure everything happens synchronously before paint.
  // This prevents "blank frames" or flickering during scene transitions and splits.
  useLayoutEffect(() => {
    if (!stageContainer || !isReady || !scenes) return
    // [FIX] Guard against destroyed PIXI renderer during navigation transitions.
    // Without this, layer creation/updates would draw on a dead WebGL context,
    // causing GL_INVALID_OPERATION errors.
    if (pixiApp && (!pixiApp.renderer || pixiApp.destroyed)) return

    // [TIMELINE DRAG PERF FIX] Skip all canvas layer updates during active timeline dragging/resizing or canvas interaction
    if (isTimelineDragging || isCanvasInteracting) return

    const layerObjects = layerObjectsRef.current
    const createdLayers = createdLayersRef.current
    const engine = getGlobalMotionEngine()
    const isActuallyPlaying = engine.getIsPlaying()
    const currentTime = engine.masterTimeline?.time() || 0
    const pixiRenderer = pixiApp?.renderer || null

    const stampRenderer = (obj) => {
      if (obj && !obj.destroyed && pixiRenderer) obj._pixiRenderer = pixiRenderer
    }

    // [FIX] checkReadiness uses ONLY refs (always current) to avoid stale closure issues.
    // The counter tracks in-flight async loads. On mobile, also check the queue length.
    // CRITICAL: We also check projectStatus to ensure we don't signal readiness on 
    // the very first render pass before project data has even arrived!
    const checkReadiness = () => {
      if (asyncLoadCounterRef.current === 0 &&
        mobileLoadQueueRef.current.length === 0 &&
        projectStatus === 'succeeded') {
        setIsStageReady(true)
      }
    }

    // 1. LAYER CREATION & ADOPTION
    layerOrder.forEach((layerId) => {
      const layer = layers?.[layerId]
      if (!layer) return

      if (createdLayers.has(layerId)) return

      // [ADOPTION] Reuse existing PIXI objects from outgoing scenes
      const sourceId = layer.sourceId || (layer.data?.id) || layer.id
      let adoptedObject = null

      for (let [oldId, oldObj] of layerObjects.entries()) {
        const oldLayer = layers[oldId]
        if (oldLayer && !oldObj.destroyed && (oldLayer.sourceId === sourceId || oldLayer.id === sourceId)) {
          if (oldLayer.sceneId !== currentScene?.id) {
            // [SEAMLESS FIX] Continuity Check: Only adopt video layers if playback is contiguous
            // If there's a discontinuity (e.g. trimming the split), we want a fresh object
            // so we can "double buffer" the segments in distinct video elements.
            if (layer.type === 'video') {
              const oldEnd = oldLayer.data?.sourceEndTime || 0
              const newStart = layer.data?.sourceStartTime || 0
              if (Math.abs(oldEnd - newStart) > 0.05) {
                // console.log(`[useCanvasLayers] Skipping video adoption due to discontinuity: ${oldEnd.toFixed(2)} -> ${newStart.toFixed(2)}`)
                continue
              }
            }

            adoptedObject = oldObj

            // [ENGINE CLEANUP] Unregister the old ID from the engine immediately 
            // so it doesn't continue syncing stale range/muted state for the same object.
            try {
              engine.unregisterLayerObject(oldId)
            } catch (e) { }

            layerObjects.delete(oldId)
            createdLayers.delete(oldId)
            break
          }
        }
      }

      if (adoptedObject) {
        layerObjects.set(layerId, adoptedObject)
        createdLayers.add(layerId)
        stampRenderer(adoptedObject)

        // [FIX] ID MAPPING: Update labels immediately for interaction hooks.
        // This ensures findLayerIdFromObject (used for selection) matches the new ID.
        adoptedObject.label = `layer-${layerId}`

        // Reset visibility immediately for the new scene
        const layerData = layerRenderData[layerId]
        if (layerData) {
          adoptedObject.visible = layerData.visible
          const targetMode = layerData.visible ? 'static' : 'none'
          if (adoptedObject._tiltHidden) {
            adoptedObject._originalEventMode = targetMode
            adoptedObject.eventMode = 'none'
          } else {
            adoptedObject.eventMode = targetMode
          }
        }

        applyTransformInline(adoptedObject, layer, dragStateAPI, layerId, motionCaptureMode, true)
        engine.registerLayerObject(layerId, adoptedObject, { sceneId: layer.sceneId })
        return
      }

      let pixiObject = null

      if (layer.type === LAYER_TYPES.TEXT) {
        pixiObject = createTextLayer(layer)
        engine.registerLayerObject(layerId, pixiObject, { sceneId: layer.sceneId })
      }
      else if (layer.type === LAYER_TYPES.SHAPE) {
        pixiObject = createShapeLayer(layer)
        engine.registerLayerObject(layerId, pixiObject, { sceneId: layer.sceneId })
      }
      else if (layer.type === LAYER_TYPES.BACKGROUND) {
        const container = new PIXI.Container()
        const graphics = new PIXI.Graphics()
        const color = layer.data?.color !== undefined ? layer.data.color : 0xffffff
        graphics.rect(0, 0, layer.width || worldWidth, layer.height || worldHeight)
        graphics.fill(color)
        graphics.eventMode = 'none'
        container.eventMode = 'none'

        container.addChild(graphics)
        container._backgroundGraphics = graphics
        container._storedColor = color
        container._storedWidth = layer.width || worldWidth
        container._storedHeight = layer.height || worldHeight
        container._storedImageUrl = undefined // Set to undefined to force initial load in update block

        pixiObject = container
        pixiObject.isBackground = true
        engine.registerLayerObject(layerId, pixiObject, { sceneId: layer.sceneId })
      }
      else if (layer.type === LAYER_TYPES.IMAGE) {
        createdLayers.add(layerId)
        asyncLoadCounterRef.current++
        dispatch(startPreparingLayer({ layerId, assetUrl: layer.data?.url || layer.data?.src }))
        // [FIX] Reset isStageReady when new async loads are queued — this ensures
        // the loading modal stays visible until ALL async layers are created
        if (loadingMode === 'global') {
          setIsStageReady(false)
        }

        // [PLACEHOLDER] Show an immediate canvas placeholder while texture loads
        const _placeholder = _createPlaceholder(layer, layerId)
        if (_placeholder && stageContainer && !stageContainer.destroyed) {
          stageContainer.addChild(_placeholder)
        }

        // [MOBILE FIX] On mobile, push async loads into a queue processed sequentially.
        const handleImageLoad = () => withLoadTimeout(createImageLayer(layer)).then((sprite) => {
          asyncLoadCounterRef.current--
          dispatch(finishPreparingLayer(layerId))
          _destroyPlaceholder(_placeholder, stageContainer)
          if (!stageContainer || !sprite || sprite.destroyed) {
            if (sprite && !sprite.destroyed) destroyImageSprite(sprite, layer)
            checkReadiness()
            return
          }
          const currentLayer = layers?.[layerId]
          if (!currentLayer) {
            destroyImageSprite(sprite, layer)
            layerObjects.delete(layerId)
            createdLayers.delete(layerId)
            checkReadiness()
            return
          }
          layerObjects.set(layerId, sprite)
          stampRenderer(sprite)
          stageContainer.addChild(sprite)
          const isVisible = currentLayer.visible !== false && currentLayer.sceneId === currentScene?.id
          sprite.visible = isVisible
          applyTransformInline(sprite, currentLayer, dragStateAPI, layerId, motionCaptureMode, false, editingTextLayerId, editingStepId)
          engine.registerLayerObject(layerId, sprite, { sceneId: currentLayer.sceneId })
          setLayerObjectsVersion(v => v + 1)
          checkReadiness()
        }).catch((error) => {
          asyncLoadCounterRef.current--
          dispatch(finishPreparingLayer(layerId))
          _destroyPlaceholder(_placeholder, stageContainer)
          // Keep in createdLayers to prevent infinite loop of failed retries
          checkReadiness()
        })

        if (_isMobileDevice) {
          mobileLoadQueueRef.current.push(handleImageLoad)
        } else {
          handleImageLoad()
        }
        return
      }
      else if (layer.type === LAYER_TYPES.VIDEO) {
        createdLayers.add(layerId)
        asyncLoadCounterRef.current++
        dispatch(startPreparingLayer({ layerId, assetUrl: layer.data?.url || layer.data?.src }))
        if (loadingMode === 'global') {
          setIsStageReady(false)
        }

        // [PLACEHOLDER] Show an immediate canvas placeholder while video decodes
        const _videoPlaceholder = _createPlaceholder(layer, layerId)
        if (_videoPlaceholder && stageContainer && !stageContainer.destroyed) {
          stageContainer.addChild(_videoPlaceholder)
        }

        const handleVideoLoad = () => withLoadTimeout(createVideoLayer(layer)).then((container) => {
          asyncLoadCounterRef.current--
          dispatch(finishPreparingLayer(layerId))
          _destroyPlaceholder(_videoPlaceholder, stageContainer)
          if (!stageContainer || !container || container.destroyed) {
            if (container && !container.destroyed) {
              const sprite = container._videoSprite
              destroyImageSprite(sprite, layer)
            }
            checkReadiness()
            return
          }
          const currentLayer = layers?.[layerId]
          if (!currentLayer) {
            const sprite = container._videoSprite
            destroyImageSprite(sprite, layer)
            layerObjects.delete(layerId)
            createdLayers.delete(layerId)
            checkReadiness()
            return
          }
          container._sourceStartTime = currentLayer.data?.sourceStartTime ?? 0
          container._sourceEndTime = currentLayer.data?.sourceEndTime ?? undefined

          layerObjects.set(layerId, container)
          stampRenderer(container)
          stageContainer.addChild(container)
          const isVisible = currentLayer.visible !== false && currentLayer.sceneId === currentScene?.id
          container.visible = isVisible
          applyTransformInline(container, currentLayer, dragStateAPI, layerId, motionCaptureMode, false, editingTextLayerId, editingStepId)
          engine.registerLayerObject(layerId, container, { sceneId: currentLayer.sceneId })
          setLayerObjectsVersion(v => v + 1)
          checkReadiness()
        }).catch((error) => {
          asyncLoadCounterRef.current--
          dispatch(finishPreparingLayer(layerId))
          _destroyPlaceholder(_videoPlaceholder, stageContainer)
          // Keep in createdLayers to prevent infinite loop of failed retries
          checkReadiness()
        })

        if (_isMobileDevice) {
          mobileLoadQueueRef.current.push(handleVideoLoad)
        } else {
          handleVideoLoad().catch(() => {
            asyncLoadCounterRef.current--
            dispatch(finishPreparingLayer(layerId))
            _destroyPlaceholder(_videoPlaceholder, stageContainer)
            // Keep in createdLayers to prevent infinite loop of failed retries
            checkReadiness()
          })
        }
        return
      }
      else if (layer.type === LAYER_TYPES.FRAME) {
        pixiObject = createFrameLayer(layer)
        engine.registerLayerObject(layerId, pixiObject, { sceneId: layer.sceneId })

        // If the frame already has an attached asset (loading from saved project), load it
        const assetUrl = layer.data?.assetUrl
        const backAssetUrl = layer.data?.backAssetUrl

        if (assetUrl || backAssetUrl) {
          createdLayers.add(layerId)
          if (loadingMode === 'global') setIsStageReady(false)

          const promises = []

          if (assetUrl) {
            promises.push(
              loadTextureRobust(assetUrl, layer.data?.assetIsVideo).then(texture => {
                if (texture && !pixiObject.destroyed) {
                  attachAssetToFrame(pixiObject, texture, layer.cropWidth ?? layer.width, layer.cropHeight ?? layer.height)
                } else if (!pixiObject.destroyed) {
                  showFramePlaceholderFallback(pixiObject, 'front')
                }
              }).catch(() => {
                if (!pixiObject.destroyed) {
                  showFramePlaceholderFallback(pixiObject, 'front')
                }
              })
            )
          }

          if (backAssetUrl) {
            promises.push(
              loadTextureRobust(backAssetUrl, layer.data?.backAssetIsVideo).then(texture => {
                if (texture && !pixiObject.destroyed) {
                  attachBackAssetToFrame(pixiObject, texture, layer.cropWidth ?? layer.width, layer.cropHeight ?? layer.height)
                } else if (!pixiObject.destroyed) {
                  showFramePlaceholderFallback(pixiObject, 'back')
                }
              }).catch(() => {
                if (!pixiObject.destroyed) {
                  showFramePlaceholderFallback(pixiObject, 'back')
                }
              })
            )
          }

          if (promises.length > 0) {
            asyncLoadCounterRef.current++
            const frameAssetUrl = assetUrl || backAssetUrl
            dispatch(startPreparingLayer({ layerId, assetUrl: frameAssetUrl }))

            Promise.all(promises).then(() => {
              asyncLoadCounterRef.current--
              dispatch(finishPreparingLayer(layerId))
              setLayerObjectsVersion(v => v + 1)
              checkReadiness()
            }).catch(() => {
              asyncLoadCounterRef.current--
              dispatch(finishPreparingLayer(layerId))
              checkReadiness()
            })
          }

          // Still add to stage synchronously (placeholder visible until texture loads)
          if (stageContainer) stageContainer.addChild(pixiObject)
          layerObjects.set(layerId, pixiObject)
          stampRenderer(pixiObject)

          const layerData = layerRenderData[layerId]
          if (layerData) {
            pixiObject.visible = layerData.visible
            const targetMode = layerData.visible ? 'static' : 'none'
            if (pixiObject._tiltHidden) {
              pixiObject._originalEventMode = targetMode
              pixiObject.eventMode = 'none'
            } else {
              pixiObject.eventMode = targetMode
            }
          }
          return
        }
      }

      if (pixiObject) {
        if (pixiObject instanceof PIXI.Graphics) {
          pixiObject._storedWidth = layer.width || 100
          pixiObject._storedHeight = layer.height || 100
          pixiObject._storedAnchorX = layer.anchorX !== undefined ? layer.anchorX : 0.5
          pixiObject._storedAnchorY = layer.anchorY !== undefined ? layer.anchorY : 0.5
          pixiObject._storedFill = layer.data?.fill || null
          pixiObject._storedStroke = layer.data?.stroke || null
          pixiObject._storedStrokeWidth = layer.data?.strokeWidth || 0
          pixiObject._storedStrokeStyle = layer.data?.strokeStyle || 'solid'
        }

        if (stageContainer) {
          if (layer.type === LAYER_TYPES.BACKGROUND || layerOrder.indexOf(layerId) === 0) {
            stageContainer.addChildAt(pixiObject, 0)
          } else {
            stageContainer.addChild(pixiObject)
          }
        }
        layerObjects.set(layerId, pixiObject)
        stampRenderer(pixiObject)
        createdLayers.add(layerId)

        // Set initial visibility for newly created synchronous layers
        const layerData = layerRenderData[layerId]
        if (layerData) {
          pixiObject.visible = layerData.visible
          const targetMode = layerData.visible ? 'static' : 'none'
          if (pixiObject._tiltHidden) {
            pixiObject._originalEventMode = targetMode
            pixiObject.eventMode = 'none'
          } else {
            pixiObject.eventMode = targetMode
          }
        }
      }
    })

    // [MOBILE FIX] Drain the mobile load queue sequentially
    if (_isMobileDevice && mobileLoadQueueRef.current.length > 0 && !mobileLoadRunningRef.current) {
      mobileLoadRunningRef.current = true
      const drainQueue = async () => {
        while (mobileLoadQueueRef.current.length > 0) {
          const task = mobileLoadQueueRef.current.shift()
          try {
            await task()
          } catch (e) {
            // Individual task errors are already handled in their .catch() blocks
          }
          // Small yield between loads to let the browser GC and avoid memory spikes
          await new Promise(r => setTimeout(r, 50))
        }
        mobileLoadRunningRef.current = false
      }
      drainQueue()
    }

    // If no async loads were triggered this render, we might be ready
    checkReadiness()

    // 2. LAYER UPDATES & Z-ORDER SYNC
    // Tilt meshes are SIBLINGS in stageContainer, not entries in layerOrder.
    // We need to bump every later layer's stage index by the number of tilt
    // meshes that come BEFORE it, otherwise inserting layerB at orderIndex 1
    // pushes the previous tilted layerA's mesh on top of layerB and breaks
    // visual stacking. Tracked across the loop.
    let placedMeshOffset = 0

    // console.time(`[useCanvasLayers] update-loop-${currentScene?.id}`)
    // console.time(`[useCanvasLayers] update-loop-${currentScene?.id}`)
    layerOrder.forEach((layerId, desiredIndex) => {
      const layer = layers?.[layerId]
      let pixiObject = layerObjects.get(layerId)
      if (!layer || !pixiObject || pixiObject.destroyed) return

      // [TEXT WRAP] createTextLayer chooses PIXI.Text vs FlowTextContainer at creation
      // time only, so toggling Water-Flow (data.enableFlow) does nothing on its own.
      // Swap the PIXI object in place when the flag no longer matches the live object.
      if (layer.type === LAYER_TYPES.TEXT) {
        const wantsFlow = !!layer.data?.enableFlow
        const isFlow = !!pixiObject.isFlowText
        const busy = pixiObject._isResizing || pixiObject._isRotating || pixiObject._isDragging
        if (wantsFlow !== isFlow && !busy && layerId !== editingTextLayerId) {
          const parent = pixiObject.parent
          const childIndex = parent ? parent.getChildIndex(pixiObject) : -1
          const newObj = createTextLayer(layer)
          if (parent) {
            const idx = childIndex >= 0 ? Math.min(childIndex, parent.children.length) : parent.children.length
            parent.addChildAt(newObj, idx)
            parent.removeChild(pixiObject)
          } else if (stageContainer && !stageContainer.destroyed) {
            stageContainer.addChild(newObj)
          }
          try { pixiObject.destroy({ children: true }) } catch (e) { /* already gone */ }
          layerObjects.set(layerId, newObj)
          engine.registerLayerObject(layerId, newObj, { sceneId: layer.sceneId })
          applyTransformInline(newObj, layer, dragStateAPI, layerId, motionCaptureMode, true, editingTextLayerId, editingStepId)
          // Re-run obstacle-aware wrapping immediately so the swap reflows at once.
          engine.refreshFlows?.()
          pixiObject = newObj
        }
      }

      // UPDATE [Sync]: Ensure MotionEngine always has the latest metadata (especially sceneId)
      // This handles cases where a layer is moved between scenes or updated.
      if (!engine.registeredObjects.has(layerId) || pixiObject._sceneId !== layer.sceneId) {
        if (layer.type === LAYER_TYPES.VIDEO || (layer.type === LAYER_TYPES.FRAME && layer.data?.assetIsVideo)) {
          // console.log(`[useCanvasLayers] Syncing video layer ${layerId} to scene ${layer.sceneId}`)
        }
        engine.registerLayerObject(layerId, pixiObject, { sceneId: layer.sceneId })
      }

      const isLayerCaptured = motionCaptureMode?.isActive && motionCaptureMode.trackedLayers?.has(layerId)
      // [TILT/CAPTURE] Live capture state for this layer.  Color picker writes
      // tracked.color onto this entry; the type-specific update blocks below
      // need it to repaint shapes/text/background without waiting for the
      // step to be saved into Redux.
      const capturedLayer = isLayerCaptured ? motionCaptureMode.trackedLayers.get(layerId) : null

      // -------------------------------------------------------------------
      // TEXT LAYER UPDATES (Optimized)
      // -------------------------------------------------------------------

      const startTimeOffset = layer.sceneStartOffset ?? 0
      const hasMotion = engine.activeTimelines?.has(layerId)
      const isAtSceneStart = !hasMotion || Math.abs(currentTime - startTimeOffset) < 0.1

      // [FIX] Anti-Jitter: Skip Redux updates if the layer is being actively transformed by the user
      // This prevents the "tug-of-war" between immediate mouse updates and delayed Redux state
      const isInteracting = pixiObject._isResizing || pixiObject._isRotating || pixiObject._isDragging

      // -----------------------------------------------------------------------
      // VISIBILITY & INTERACTION SYNC (from old useLayoutEffect)
      // This prevents the "flash" when exiting edit mode by ensuring the PIXI layer
      // becomes visible in the same frame that the HTML overlay unmounts.
      // -----------------------------------------------------------------------
      const layerData = layerRenderData[layerId]
      if (!layerData) return // Should not happen if layer is in layerOrder

      if (layerId === editingTextLayerId) {
        pixiObject.visible = false
        pixiObject.eventMode = 'none' // Disable interaction while editing
      } else {
        pixiObject.visible = layerData.visible // This already includes sceneId check!

        // REINFORCE SCENE ISOLATION: Explicitly disable interaction for off-scene layers
        // This prevents invisible layers from other scenes from responding to events
        // [FIX] BACKGROUND PROTECTION: Never set background layers to 'static'
        const targetMode = (layerData.visible && layer.type !== LAYER_TYPES.BACKGROUND) ? 'static' : 'none'
        if (pixiObject._tiltHidden) {
          pixiObject._originalEventMode = targetMode
          pixiObject.eventMode = 'none'
        } else {
          pixiObject.eventMode = targetMode
        }
      }

      // [TILT — SCENE ISOLATION] Keep the perspective-mesh sibling's visibility
      // locked to its owner here, independently of applyTransformInline step 8.
      // applyTransformInline early-returns when engine.getIsPlaying() is true,
      // and that stays true during playback AND for ~200ms after every seek
      // (scene switches trigger a seek).  Without this direct sync the mesh
      // kept the previous scene's visibility state — tilted layers from other
      // scenes leaked onto the current canvas while paused, and tilted layers
      // on the scene the playhead entered stayed hidden during playback.
      const _tiltMesh = pixiObject._tiltMesh
      if (_tiltMesh && !_tiltMesh.destroyed) {
        _tiltMesh.visible = pixiObject.visible !== false
      }

      if (isInteracting) {
        // Skip geometric updates during interaction to prevent bouncing
        // But visibility and eventMode are already handled above.
        // Opacity and Z-order are handled below.
      } else {
        if (layer.type === LAYER_TYPES.TEXT && layer.data && (!isActuallyPlaying || isLayerCaptured)) {
          if (pixiObject.isFlowText) {
            // [TEXT WRAP] FlowTextContainer is a PIXI.Container — it has no .style/.text.
            // Sync via its `data` ref + updateText()/wordWrapWidth (which re-layout), and
            // updateColor() for live colour. Obstacle-aware reflow is driven by the engine's
            // refreshFlows(); here we only rebuild on content/style/width/colour changes.
            const fd = layer.data
            pixiObject.data = { ...pixiObject.data, ...fd }
            const wrapW = layer.width || 200
            const relayout =
              pixiObject._content !== (fd.content || 'Text') ||
              pixiObject._fontSize !== (fd.fontSize || 24) ||
              pixiObject._fontFamily !== (fd.fontFamily || 'Arial') ||
              pixiObject._textAlign !== (fd.textAlign || 'left') ||
              (pixiObject._fontWeight || 'normal') !== (fd.fontWeight || 'normal') ||
              (pixiObject._fontStyle || 'normal') !== (fd.fontStyle || 'normal')
            if (relayout) {
              pixiObject._wordWrapWidth = wrapW
              pixiObject.updateText()
            } else if (pixiObject._wordWrapWidth !== wrapW) {
              pixiObject.wordWrapWidth = wrapW // setter triggers refresh
            }
            const liveColor = (capturedLayer && capturedLayer.didColor && capturedLayer.color !== undefined && capturedLayer.color !== null)
              ? capturedLayer.color
              : (fd.color || '#000000')
            if (pixiObject._color !== liveColor) pixiObject.updateColor(liveColor)
          } else {
            // Sync data and _fullContent references to prevent stale references in revealProgress
            pixiObject.data = layer.data
            pixiObject._fullContent = layer.data.content || ''
            // [SYNC FIX] Remove scrubbing/scene-start skip.
            // We always want to sync text if the timeline is paused so Redux truth is visible.
            // Only update text content if it actually changed
            if (pixiObject.text !== layer.data.content) {
            // console.log(`[useCanvasLayers] Text content changed for ${layerId}: "${pixiObject.text}" -> "${layer.data.content}"`)
            pixiObject.text = layer.data.content || ''

            // In PIXI v8, changing .text doesn't always immediately update bounds until the next render
            // forcing it helps for immediate height sync back to Redux
            if (pixiObject.updateText) pixiObject.updateText(true);
            markTiltTextureDirty(pixiObject)

            // Re-calculate height if text changed
            const currentFontSize = layer.data.fontSize || 16
            const wordWrapWidth = layer.width || 200
            calculateTextHeight(
              layerId,
              pixiObject.text,
              currentFontSize,
              wordWrapWidth,
              layer.data.fontFamily,
              layer.data.fontWeight,
              layer.data.fontStyle,
              dispatch,
              layerId === editingTextLayerId
            )
          }

          // Sync wordWrapWidth whenever layer.width changes
          const style = pixiObject.style
          const wordWrapWidth = layer.width || 200
          if (style.wordWrapWidth !== wordWrapWidth) {
            style.wordWrapWidth = wordWrapWidth
            // Force re-measure immediately
            if (pixiObject.updateText) pixiObject.updateText(true)
            markTiltTextureDirty(pixiObject)

            // Recalculate height whenever width/wrap changes
            calculateTextHeight(
              layerId,
              pixiObject.text,
              style.fontSize || 16,
              wordWrapWidth,
              layer.data.fontFamily,
              layer.data.fontWeight,
              layer.data.fontStyle,
              dispatch,
              layerId === editingTextLayerId
            )
          }

          if (style.fontSize !== (layer.data.fontSize || 16)) {
            style.fontSize = layer.data.fontSize || 16
            style.lineHeight = style.fontSize * 1.2
            if (pixiObject.updateText) pixiObject.updateText(true)
            // Recalculate height on font size change
            calculateTextHeight(layerId, pixiObject.text, style.fontSize, wordWrapWidth, layer.data.fontFamily, layer.data.fontWeight, layer.data.fontStyle, dispatch, layerId === editingTextLayerId)
            markTiltTextureDirty(pixiObject)
          }
          const prevFill = style.fill
          const prevFontFamily = style.fontFamily
          const prevFontWeight = style.fontWeight
          const prevFontStyle = style.fontStyle
          // [TILT/CAPTURE] Prefer the live captured color when MotionCapture
          // is editing this layer so the user sees the colour change instantly
          // (and the tilt mesh re-captures via markTiltTextureDirty below).
           const reduxBaseTextColor = layer.data.color || '#000000'
           const isColorCaptured = !!(capturedLayer && capturedLayer.didColor)
           const liveTextColor = (isColorCaptured && capturedLayer.color !== undefined && capturedLayer.color !== null)
             ? capturedLayer.color
             : reduxBaseTextColor
           // [PREVIEW-PRESERVE] After a fast preview ends, the ColorChangeAction
           // has stamped the animated colour onto style.fill.  A re-render here
           // (caused by selection / panel toggles / etc.) would otherwise revert
           // it back to the Redux base colour because style.fill !== liveTextColor.
           // Only re-apply Redux colour when:
           //   (a) the playhead is at the scene start (Redux is authoritative),
           //   (b) the layer is being captured (capture wins),
           //   (c) the Redux colour itself genuinely changed (user picked a new
           //       colour from the picker).
           // CRITICAL: Track ONLY the Redux base value in the sentinel — never
           // the captured value.  If we polluted the sentinel with the live
           // captured colour during capture, then after capture exits the
           // sentinel ("blue") would differ from Redux ("red"), reduxFillChanged
           // would flip true, and we'd snap back to the Redux base — exactly
           // the "color resets after preview / select" bug.
           //
           // [DELETE-STEP FIX] If the layer no longer has an engine-owned colour
           // animation (_applyAnimatedColor is stamped by ColorChangeAction and
           // cleared by unloadAllMotions), Redux is the single source of truth
           // again.  Without this, deleting the only colour step would leave the
           // stale animated colour locked on the layer until something else
           // forced a re-sync.
           const hasEngineColorAnim = typeof pixiObject._applyAnimatedColor === 'function'
           const reduxFillChanged = pixiObject._lastReduxFillApplied !== reduxBaseTextColor
           const allowFillUpdate = isAtSceneStart || isColorCaptured || reduxFillChanged || !hasEngineColorAnim
           if (style.fill !== liveTextColor && allowFillUpdate) style.fill = liveTextColor
          pixiObject._lastReduxFillApplied = reduxBaseTextColor
          if (style.fontFamily !== (layer.data.fontFamily || 'Arial')) style.fontFamily = layer.data.fontFamily || 'Arial'
          if (style.fontWeight !== (layer.data.fontWeight || 'normal')) style.fontWeight = layer.data.fontWeight || 'normal'
          if (style.fontStyle !== (layer.data.fontStyle || 'normal')) style.fontStyle = layer.data.fontStyle || 'normal'
          if (style.letterSpacing !== 0) style.letterSpacing = 0
          if (prevFill !== style.fill || prevFontFamily !== style.fontFamily ||
            prevFontWeight !== style.fontWeight || prevFontStyle !== style.fontStyle) {
            markTiltTextureDirty(pixiObject)
          }

          // If the fonts loaded version changes, we MUST force a re-render of this text object
          if (pixiObject._fontsLoadedVersion !== fontsLoadedVersion) {
            pixiObject._fontsLoadedVersion = fontsLoadedVersion;

            // [NUCLEAR REFRESH] Toggling font family forces PIXI to re-query the browser's metrics/rasterizer
            const targetFont = layer.data?.fontFamily || 'Arial';

            // Temporal switch to invalid/generic font and back triggers deep dirty flag in PIXI v8
            style.fontFamily = 'monospace';
            if (pixiObject.updateText) pixiObject.updateText(true);

            style.fontFamily = targetFont;
            if (pixiObject.updateText) pixiObject.updateText(true);

            // Force re-measure and re-pivot immediately
            const align = layer.data?.textAlign || 'left'
            const anchorX = align === 'center' ? 0.5 : (align === 'right' ? 1 : 0)
            const currentWidth = layer.width || 200
            const bounds = pixiObject.getLocalBounds()

            pixiObject.anchor.set(anchorX, 0)
            pixiObject.pivot.set((0.5 - anchorX) * currentWidth, bounds.height / 2)

            // Re-calculate the Redux height so selection boxes fit
            calculateTextHeight(
              layerId,
              pixiObject.text,
              layer.data.fontSize || 16,
              currentWidth,
              targetFont,
              layer.data.fontWeight,
              layer.data.fontStyle,
              dispatch,
              layerId === editingTextLayerId
            );
          }

          if (style.align !== (layer.data.textAlign || 'left')) {
            style.align = layer.data.textAlign || 'left'
            const anchorX = style.align === 'center' ? 0.5 : (style.align === 'right' ? 1 : 0)
            if (pixiObject.anchor.x !== anchorX) pixiObject.anchor.x = anchorX

            // Update pivot to keep centered rotation
            // CRITICAL FIX: Use actual text height instead of layer.height
            const width = layer.width || 200
            pixiObject.updateText?.(true)
            const actualHeight = pixiObject.getLocalBounds().height || layer.height || 40
            pixiObject.pivot.set((0.5 - anchorX) * width, actualHeight / 2)
          }
          } // end else — standard PIXI.Text branch
        }

        // -------------------------------------------------------------------
        // BACKGROUND LAYER UPDATES
        // -------------------------------------------------------------------

        else if (layer.type === LAYER_TYPES.BACKGROUND) {
          // [TILT/CAPTURE] Honour the captured background colour during
          // MotionCapture so live edits show up before the step is saved.
          const isColorCaptured = !!(capturedLayer && capturedLayer.didColor)
          const rawCapturedBgColor = isColorCaptured ? capturedLayer.color : undefined
          const capturedBgColor = (rawCapturedBgColor !== undefined && rawCapturedBgColor !== null)
            ? (typeof rawCapturedBgColor === 'string'
              ? parseInt(rawCapturedBgColor.replace('#', ''), 16)
              : rawCapturedBgColor)
            : undefined
          const reduxBaseBgColor = layer.data?.color !== undefined ? layer.data.color : 0xffffff
          const currentColor = capturedBgColor !== undefined
            ? capturedBgColor
            : reduxBaseBgColor
          const targetWidth = layer.width || worldWidth
          const targetHeight = layer.height || worldHeight
          const graphics = pixiObject._backgroundGraphics

          // [PREVIEW-PRESERVE] After a fast preview, ColorChangeAction has
          // repainted _backgroundGraphics with the animated colour and stamped
          // _storedColor with that animated value.  Without this gate the
          // re-render below would always repaint with Redux' base colour,
          // resetting the background.  See the matching block in TEXT updates.
          // CRITICAL: compare against the Redux base only — never the live
          // captured colour — so the sentinel stays stable across capture
          // exit and we don't trigger a false "Redux changed" repaint.
          //
          // [DELETE-STEP FIX] If no engine colour animation is registered on
          // the background (tween removed by the step deletion), Redux is the
          // authority again and should repaint the background immediately.
          const hasEngineColorAnim = typeof pixiObject._applyAnimatedColor === 'function'
          const reduxBgColorChanged = pixiObject._lastReduxBgColorApplied !== reduxBaseBgColor
          const allowBgColorUpdate = isAtSceneStart || isColorCaptured || reduxBgColorChanged || !hasEngineColorAnim

          const bgDimsChanged = pixiObject._storedWidth !== targetWidth || pixiObject._storedHeight !== targetHeight
          const bgColorChanged = pixiObject._storedColor !== currentColor && allowBgColorUpdate

          if (bgColorChanged || bgDimsChanged) {
            // When only the canvas resized mid-animation, keep the engine's
            // last animated colour instead of forcing Redux base.
            let effectiveBgColor = currentColor
            if (!allowBgColorUpdate && pixiObject._lastAppliedColor !== undefined && pixiObject._lastAppliedColor !== null) {
              effectiveBgColor = pixiObject._lastAppliedColor
            }
            if (graphics) {
              graphics.clear()
              graphics.rect(0, 0, targetWidth, targetHeight)
              graphics.fill(effectiveBgColor)
            }
            pixiObject._storedColor = effectiveBgColor

            // Update background image scale if present
            if (pixiObject._backgroundImage) {
              const sprite = pixiObject._backgroundImage
              const texture = sprite.texture
              const scale = Math.max(targetWidth / texture.width, targetHeight / texture.height)
              sprite.scale.set(scale)
              sprite.x = (targetWidth - texture.width * scale) / 2
              sprite.y = (targetHeight - texture.height * scale) / 2
            }

            pixiObject._storedWidth = targetWidth
            pixiObject._storedHeight = targetHeight
          }
          pixiObject._lastReduxBgColorApplied = reduxBaseBgColor

          // Handle Background Image update
          const currentImageUrl = layer.data?.imageUrl
          if (pixiObject._storedImageUrl !== currentImageUrl) {
            pixiObject._storedImageUrl = currentImageUrl

            // Cleanup old image
            if (pixiObject._backgroundImage) {
              const oldSprite = pixiObject._backgroundImage
              pixiObject.removeChild(oldSprite)
              destroyImageSprite(oldSprite, { type: LAYER_TYPES.IMAGE, data: { url: pixiObject._oldImageUrl } })
              pixiObject._backgroundImage = null
            }

            if (currentImageUrl) {
              pixiObject._oldImageUrl = currentImageUrl

              loadTextureRobust(currentImageUrl).then(texture => {
                if (pixiObject.destroyed || pixiObject._storedImageUrl !== currentImageUrl || !texture) return

                const sprite = new PIXI.Sprite(texture)
                pixiObject.addChild(sprite)
                pixiObject._backgroundImage = sprite

                // Scale to cover
                const scale = Math.max(pixiObject._storedWidth / texture.width, pixiObject._storedHeight / texture.height)
                sprite.scale.set(scale)

                // Center it
                sprite.x = (pixiObject._storedWidth - texture.width * scale) / 2
                sprite.y = (pixiObject._storedHeight - texture.height * scale) / 2
              }).catch(err => {
                console.error('Failed to load background image:', err)
              })
            }
          }
        }

        // -------------------------------------------------------------------
        // SHAPE LAYER UPDATES
        // -------------------------------------------------------------------

        else if (layer.type === LAYER_TYPES.SHAPE && layer.data) {
          // [FIX] Sync shape properties whenever paused or captured
          // (Removed isAtSceneStart restriction as colors aren't animated by engine)
          if (!isActuallyPlaying || isLayerCaptured) {
            // [TILT/CAPTURE] During MotionCapture, color picker writes to
            // trackedLayers (capturedLayer.color) — Redux is left untouched
            // until the user saves the step.  Without this override, the
            // shape redraw below would always compare against the stale
            // Redux fill, never repaint, and the live preview wouldn't show
            // the new colour (especially noticeable on tilted shapes whose
            // mesh texture would also stay stale).
            const isColorCaptured = !!(capturedLayer && capturedLayer.didColor)
            const isRadiusCaptured = !!(capturedLayer && capturedLayer.didCornerRadius)
            const capturedColor = isColorCaptured ? capturedLayer.color : undefined
            const currentWidth = layer.width || 100
            const currentHeight = layer.height || 100
            const reduxBaseFill = layer.data?.fill || null
            const currentFill = capturedColor !== undefined && capturedColor !== null
              ? capturedColor
              : reduxBaseFill
            const currentStroke = layer.data?.stroke || null
            const currentStrokeWidth = layer.data?.strokeWidth || 0
            const currentStrokeStyle = layer.data?.strokeStyle || 'solid'
            const currentCornerRadius = (isRadiusCaptured && capturedLayer.cornerRadius !== undefined)
              ? capturedLayer.cornerRadius
              : (layer.data?.cornerRadius || 0)

            // [PREVIEW-PRESERVE] Corner Radius update logic
            const reduxBaseCornerRadius = layer.data?.cornerRadius || 0
            const reduxRadiusChanged = pixiObject._lastReduxRadiusApplied !== reduxBaseCornerRadius
            // Only allow Redux to overwrite the radius if we are at the start, 
            // capturing, Redux value changed, or no motion exists.
            const allowRadiusUpdate = isAtSceneStart || isRadiusCaptured || reduxRadiusChanged

            let effectiveCornerRadius = currentCornerRadius
            if (!allowRadiusUpdate && pixiObject.cornerRadius !== undefined) {
              effectiveCornerRadius = pixiObject.cornerRadius
            }

            // [PREVIEW-PRESERVE] See the matching block in TEXT updates: after
            // a fast preview, ColorChangeAction has overwritten _storedFill with
            // the engine's animated hex.  Comparing against Redux' currentFill
            // would always trigger a redraw with the OLD Redux colour, snapping
            // the shape back.  Only allow Redux/captured fill to win when:
            //   (a) we're at scene start, (b) the layer is captured, or
            //   (c) Redux fill itself changed (user picker).
            // For pure dimension changes mid-animation we still need to redraw,
            // but with the engine's animated colour preserved (effectiveFill).
            // CRITICAL: track Redux base fill in the sentinel (NOT the live
            // captured value).  Otherwise, after capture exits the sentinel
            // would mismatch Redux and force a snap-back redraw.
            //
            // [DELETE-STEP FIX] When no engine colour animation remains
            // (_applyAnimatedColor cleared by unloadAllMotions after a step is
            // deleted), Redux is authoritative again so the shape repaints
            // with the Redux fill on the next render.
            const hasEngineColorAnim = typeof pixiObject._applyAnimatedColor === 'function'
            const reduxFillChanged = pixiObject._lastReduxFillApplied !== reduxBaseFill
            const allowFillUpdate = isAtSceneStart || isColorCaptured || reduxFillChanged || !hasEngineColorAnim

            const dimsOrStrokeChanged =
              pixiObject._storedWidth !== currentWidth ||
              pixiObject._storedHeight !== currentHeight ||
              pixiObject._storedStroke !== currentStroke ||
              pixiObject._storedStrokeWidth !== currentStrokeWidth ||
              pixiObject._storedStrokeStyle !== currentStrokeStyle
            const fillNeedsRedraw = pixiObject._storedFill !== currentFill && allowFillUpdate

            if (dimsOrStrokeChanged || fillNeedsRedraw) {
              // Pick the colour to actually paint with: when only dims changed
              // mid-animation, keep the engine's animated colour so the redraw
              // doesn't visually reset the colour.
              let effectiveFill = currentFill
              if (
                !allowFillUpdate &&
                pixiObject._animatedFillColor !== undefined &&
                pixiObject._animatedFillColor !== null
              ) {
                effectiveFill = '#' + pixiObject._animatedFillColor.toString(16).padStart(6, '0')
              }

              const liveShapeData = {
                ...layer.data,
                fill: effectiveFill,
                cornerRadius: effectiveCornerRadius
              }

              redrawShapeWithColors(pixiObject, liveShapeData, currentWidth, currentHeight, layer.anchorX ?? 0.5, layer.anchorY ?? 0.5)
              markTiltTextureDirty(pixiObject)

              pixiObject._storedWidth = currentWidth
              pixiObject._storedHeight = currentHeight
              pixiObject._storedFill = effectiveFill
              pixiObject._storedStroke = currentStroke
              pixiObject._storedStrokeWidth = currentStrokeWidth
              pixiObject._storedStrokeStyle = currentStrokeStyle

              // [SYNC FIX] Keep the reactive property in sync without triggering a second redraw
              if (pixiObject._hasReactiveRadiusProperties) {
                pixiObject._cornerRadius = effectiveCornerRadius
              }
            } else if (pixiObject.cornerRadius !== effectiveCornerRadius && allowRadiusUpdate) {
              // [SYNC FIX] Trigger instant redraw via reactive setter
              pixiObject.cornerRadius = effectiveCornerRadius
            }
            pixiObject._lastReduxFillApplied = reduxBaseFill
            pixiObject._lastReduxRadiusApplied = reduxBaseCornerRadius
          }
        }

        // -------------------------------------------------------------------
        // IMAGE LAYER UPDATES
        // -------------------------------------------------------------------
        else if (layer.type === LAYER_TYPES.IMAGE) {
          if (pixiObject._imageSprite) {
            const sprite = pixiObject._imageSprite
            const cropMask = pixiObject._cropMask

            // [FIX] Protected Sync: Only apply Redux dimensions/crops if not playing/scrubbing
            // (unless specifically at a scene start or in capture mode with active crop edits)
            const isCropCaptured = !!(capturedLayer && capturedLayer.didCrop)
            if (!isActuallyPlaying && (isCropCaptured || isAtSceneStart)) {
              // CROP SYSTEM: Sync media size, crop offset, mask, and pivot
              const mediaW = layer.mediaWidth ?? layer.width ?? 100
              const mediaH = layer.mediaHeight ?? layer.height ?? 100
              const cropX = layer.cropX ?? 0
              const cropY = layer.cropY ?? 0
              const cropW = layer.cropWidth ?? layer.width ?? 100
              const cropH = layer.cropHeight ?? layer.height ?? 100

              if (Math.abs(sprite.width - mediaW) > 0.5) sprite.width = mediaW
              if (Math.abs(sprite.height - mediaH) > 0.5) sprite.height = mediaH
              if (Math.abs(sprite.x - (-cropX)) > 0.5) sprite.x = -cropX
              if (Math.abs(sprite.y - (-cropY)) > 0.5) sprite.y = -cropY

              if (cropMask) {
                cropMask.clear()
                cropMask.rect(0, 0, cropW, cropH)
                cropMask.fill(0xffffff)
              }

              // pivot sync to prevent jumps
              const targetAnchorX = layer.anchorX !== undefined ? layer.anchorX : 0.5
              const targetAnchorY = layer.anchorY !== undefined ? layer.anchorY : 0.5
              pixiObject.pivot.set(cropW * targetAnchorX, cropH * targetAnchorY)

              pixiObject._storedCropX = cropX
              pixiObject._storedCropY = cropY
              pixiObject._storedCropWidth = cropW
              pixiObject._storedCropHeight = cropH
              pixiObject._storedMediaWidth = mediaW
              pixiObject._storedMediaHeight = mediaH
            }
          }
        }

        // -------------------------------------------------------------------
        // VIDEO LAYER UPDATES
        // -------------------------------------------------------------------
        else if (layer.type === LAYER_TYPES.VIDEO) {
          if (pixiObject._videoSprite) {
            const sprite = pixiObject._videoSprite
            const cropMask = pixiObject._cropMask

            // [Bug 4 Fix] Always keep video time range in sync with Redux layer data.
            // After a scene split, sourceStartTime / sourceEndTime change — MotionEngine.syncMedia
            // reads these off the PIXI object, so they must stay current.
            const oldStart = pixiObject._sourceStartTime
            pixiObject._sourceStartTime = layer.data?.sourceStartTime ?? 0
            pixiObject._sourceEndTime = layer.data?.sourceEndTime ?? undefined

            const isCropCaptured = !!(capturedLayer && capturedLayer.didCrop)
            if (!isActuallyPlaying && (isCropCaptured || isAtSceneStart)) {
              const mediaW = layer.mediaWidth ?? layer.width ?? 100
              const mediaH = layer.mediaHeight ?? layer.height ?? 100
              const cropX = layer.cropX ?? 0
              const cropY = layer.cropY ?? 0
              const cropW = layer.cropWidth ?? layer.width ?? 100
              const cropH = layer.cropHeight ?? layer.height ?? 100

              if (Math.abs(sprite.width - mediaW) > 0.5) sprite.width = mediaW
              if (Math.abs(sprite.height - mediaH) > 0.5) sprite.height = mediaH
              if (Math.abs(sprite.x - (-cropX)) > 0.5) sprite.x = -cropX
              if (Math.abs(sprite.y - (-cropY)) > 0.5) sprite.y = -cropY

              if (cropMask) {
                cropMask.clear()
                cropMask.rect(0, 0, cropW, cropH)
                cropMask.fill(0xffffff)
              }

              const targetAnchorX = layer.anchorX !== undefined ? layer.anchorX : 0.5
              const targetAnchorY = layer.anchorY !== undefined ? layer.anchorY : 0.5
              pixiObject.pivot.set(cropW * targetAnchorX, cropH * targetAnchorY)

              pixiObject._storedCropX = cropX
              pixiObject._storedCropY = cropY
              pixiObject._storedCropWidth = cropW
              pixiObject._storedCropHeight = cropH
              pixiObject._storedMediaWidth = mediaW
              pixiObject._storedMediaHeight = mediaH
            }
          }
        }

        // -------------------------------------------------------------------
        // AUDIO LAYER UPDATES (Card Frames / Audio blocks)
        // -------------------------------------------------------------------
        else if (layer.type === LAYER_TYPES.AUDIO) {
          // Copy timings and muted preferences to PIXI object so MotionEngine syncs them
          pixiObject._sourceStartTime = layer.data?.sourceStartTime ?? 0
          pixiObject._sourceEndTime = layer.data?.sourceEndTime ?? undefined
          pixiObject._backSourceStartTime = layer.data?.backSourceStartTime ?? 0
          pixiObject._backSourceEndTime = layer.data?.backSourceEndTime ?? undefined
          pixiObject._frontLayerMuted = layer.data?.muted !== false
          pixiObject._backLayerMuted = layer.data?.backMuted !== false
          const showingFront = pixiObject._showingFront !== false
          pixiObject._layerMuted = showingFront ? pixiObject._frontLayerMuted : pixiObject._backLayerMuted

          if (pixiObject._imageSprite) {
            const sprite = pixiObject._imageSprite
            const cropMask = pixiObject._cropMask

            const isCropCaptured = !!(capturedLayer && capturedLayer.didCrop)
            if (!isActuallyPlaying && (isCropCaptured || isAtSceneStart)) {
              const mediaW = layer.mediaWidth ?? layer.width ?? 100
              const mediaH = layer.mediaHeight ?? layer.height ?? 100
              const cropX = layer.cropX ?? 0
              const cropY = layer.cropY ?? 0
              const cropW = layer.cropWidth ?? layer.width ?? 100
              const cropH = layer.cropHeight ?? layer.height ?? 100

              if (Math.abs(sprite.width - mediaW) > 0.5) sprite.width = mediaW
              if (Math.abs(sprite.height - mediaH) > 0.5) sprite.height = mediaH
              if (Math.abs(sprite.x - (-cropX)) > 0.5) sprite.x = -cropX
              if (Math.abs(sprite.y - (-cropY)) > 0.5) sprite.y = -cropY

              if (cropMask) {
                cropMask.clear()
                cropMask.rect(0, 0, cropW, cropH)
                cropMask.fill(0xffffff)
              }

              const targetAnchorX = layer.anchorX !== undefined ? layer.anchorX : 0.5
              const targetAnchorY = layer.anchorY !== undefined ? layer.anchorY : 0.5
              pixiObject.pivot.set(cropW * targetAnchorX, cropH * targetAnchorY)

              pixiObject._storedCropX = cropX
              pixiObject._storedCropY = cropY
              pixiObject._storedCropWidth = cropW
              pixiObject._storedCropHeight = cropH
              pixiObject._storedMediaWidth = mediaW
              pixiObject._storedMediaHeight = mediaH
            }
          }
        }

        // -------------------------------------------------------------------
        // FRAME LAYER UPDATES (reuses image path since _imageSprite is set)
        // -------------------------------------------------------------------
        else if (layer.type === LAYER_TYPES.FRAME) {
          // Copy timings and muted preferences to PIXI object so MotionEngine syncs them
          pixiObject._sourceStartTime = layer.data?.sourceStartTime ?? 0
          pixiObject._sourceEndTime = layer.data?.sourceEndTime ?? undefined
          pixiObject._backSourceStartTime = layer.data?.backSourceStartTime ?? 0
          pixiObject._backSourceEndTime = layer.data?.backSourceEndTime ?? undefined
          pixiObject._frontLayerMuted = layer.data?.muted !== false
          pixiObject._backLayerMuted = layer.data?.backMuted !== false
          const showingFront = pixiObject._showingFront !== false
          pixiObject._layerMuted = showingFront ? pixiObject._frontLayerMuted : pixiObject._backLayerMuted

          if (pixiObject._imageSprite) {
            const sprite = pixiObject._imageSprite
            const cropMask = pixiObject._cropMask

            const isCropCaptured = !!(capturedLayer && capturedLayer.didCrop)
            if (!isActuallyPlaying && (isCropCaptured || isAtSceneStart)) {
              const mediaW = layer.mediaWidth ?? layer.width ?? 100
              const mediaH = layer.mediaHeight ?? layer.height ?? 100
              const cropX = layer.cropX ?? 0
              const cropY = layer.cropY ?? 0
              const cropW = layer.cropWidth ?? layer.width ?? 100
              const cropH = layer.cropHeight ?? layer.height ?? 100

              const cropOrSizeChanged = (
                Math.abs(sprite.width - mediaW) > 0.5 ||
                Math.abs(sprite.height - mediaH) > 0.5 ||
                Math.abs(sprite.x - (-cropX)) > 0.5 ||
                Math.abs(sprite.y - (-cropY)) > 0.5 ||
                pixiObject._storedCropWidth !== cropW ||
                pixiObject._storedCropHeight !== cropH
              )

              if (pixiObject._frameHasAsset) {
                if (Math.abs(sprite.width - mediaW) > 0.5) sprite.width = mediaW
                if (Math.abs(sprite.height - mediaH) > 0.5) sprite.height = mediaH
                if (Math.abs(sprite.x - (-cropX)) > 0.5) sprite.x = -cropX
                if (Math.abs(sprite.y - (-cropY)) > 0.5) sprite.y = -cropY
              }

              if (cropMask) {
                cropMask.clear()
                cropMask.rect(0, 0, cropW, cropH)
                cropMask.fill(0xffffff)
              }

              pixiObject._storedCropWidth = cropW
              pixiObject._storedCropHeight = cropH
              pixiObject._storedMediaWidth = mediaW
              pixiObject._storedMediaHeight = mediaH

              const anchorX = layer.anchorX !== undefined ? layer.anchorX : 0.5
              const anchorY = layer.anchorY !== undefined ? layer.anchorY : 0.5
              pixiObject.pivot.set(cropW * anchorX, cropH * anchorY)

              // Sync placeholder visibility and redraw at current dimensions
              // Skip redraw when frame is highlighted as a drop target (_isDropTarget)
              if (pixiObject._framePlaceholder) {
                const isShowingFront = pixiObject._showingFront !== undefined ? pixiObject._showingFront : true
                const activeHasAsset = isShowingFront
                  ? !!(layer.data?.assetUrl || layer.data?.url || layer.data?.src)
                  : !!(layer.data?.backAssetUrl)

                // [UX FIX] Keep placeholder visible if it is currently a drop target highlight
                // OR if the active side is empty.
                pixiObject._framePlaceholder.visible = !!pixiObject._isDropTarget || !activeHasAsset
                if (!activeHasAsset && !pixiObject._isDropTarget) {
                  redrawFramePlaceholder(pixiObject, cropW, cropH, layer.data)
                  markTiltTextureDirty(pixiObject)
                }
              }

              if (cropOrSizeChanged) markTiltTextureDirty(pixiObject)
            }
          }
        }

        // -------------------------------------------------------------------
        // TRANSFORM & ALPHA
        // -------------------------------------------------------------------

        applyTransformInline(pixiObject, layer, dragStateAPI, layerId, motionCaptureMode, false, editingTextLayerId, editingStepId)
      }

      // -------------------------------------------------------------------
      // Z-ORDER SYNC
      // -------------------------------------------------------------------
      // The desired stage index is the layerOrder index plus the number of
      // tilt meshes belonging to LOWER layers we've already placed.  Without
      // this offset, dragging a non-tilted layerB above a tilted layerA would
      // visually go BEHIND layerA's mesh, even though layerB is higher in
      // the layer panel.
      const targetStageIndex = desiredIndex + placedMeshOffset
      const currentIndex = stageContainer.children.indexOf(pixiObject)
      if (currentIndex !== targetStageIndex) {
        updateLayerZOrder(stageContainer, pixiObject, targetStageIndex)
      }

      // Keep the tilt mesh slotted immediately after its owner in z-order.
      const tiltMesh = pixiObject._tiltMesh
      if (tiltMesh && !tiltMesh.destroyed && tiltMesh.parent === stageContainer) {
        const ownerIdx = stageContainer.children.indexOf(pixiObject)
        const meshIdx = stageContainer.children.indexOf(tiltMesh)
        const targetIdx = Math.min(ownerIdx + 1, stageContainer.children.length - 1)
        if (meshIdx !== targetIdx && ownerIdx !== -1) {
          stageContainer.setChildIndex(tiltMesh, targetIdx)
        }
        // This mesh now occupies a stage slot that all subsequent layers
        // need to skip over.
        placedMeshOffset += 1
      }
    })
    // console.timeEnd(`[useCanvasLayers] update-loop-${currentScene?.id}`)

    // 3. LAYER REMOVAL
    const currentLayerIds = new Set(layerOrder)
    layerObjects.forEach((pixiObject, layerId) => {
      if (!currentLayerIds.has(layerId)) {
        // Clean up the tilt mesh sibling before destroying the owner
        removeTiltFromObject(pixiObject)
        stageContainer.removeChild(pixiObject)

        // Properly destroy image sprites vs other objects
        const layer = layers?.[layerId]
        if (layer?.type === LAYER_TYPES.IMAGE || layer?.type === LAYER_TYPES.VIDEO || layer?.type === LAYER_TYPES.FRAME) {
          const sprite = pixiObject._imageSprite || pixiObject._videoSprite || pixiObject
          if (sprite instanceof PIXI.Sprite) {
            destroyImageSprite(sprite, layer)
          }
          if (pixiObject !== sprite) {
            pixiObject.destroy({ children: true })
          }
        } else {
          pixiObject.destroy()
        }

        // [ENGINE CLEANUP] Properly unregister from MotionEngine to stop playback/sync
        try {
          engine.unregisterLayerObject(layerId)
        } catch (e) { }

        layerObjects.delete(layerId)
        createdLayers.delete(layerId)
        previousLayerValuesRef.current.delete(layerId)
      }
    })

    previousSelectedLayerIdsRef.current = new Set(selectedLayerIds)

  }, [stageContainer, isReady, layerRenderData, layerOrder, currentScene?.id, selectedLayerIds, motionCaptureMode, editingTextLayerId, layers, dragStateAPI, editingStepId, worldWidth, worldHeight, fontsLoadedVersion, scenes, pixiApp, isTimelineDragging, isCanvasInteracting])

  // SYNC DYNAMIC RESOLUTION FOR TEXT SHARPNESS
  // This ensures text remains crisp even at 500% zoom by re-rasterizing it
  // at a higher resolution as the viewport scales up.
  useLayoutEffect(() => {
    if (!pixiApp || !isReady || !layers) return

    const zoomScale = zoom / 100 // Use the zoom prop for reactive triggering
    const dpr = window.devicePixelRatio || 1

    // Calculate target resolution: higher zoom = higher resolution
    // Standard baseline is 2, scaling up to 5 for 400% zoom
    const targetResolution = Math.min(5, Math.max(2, zoomScale * dpr))

    let updateCount = 0
    layerObjectsRef.current.forEach((pixiObject, layerId) => {
      if (pixiObject instanceof PIXI.Text && !pixiObject.destroyed) {
        // ENHANCEMENT: Only update resolution if target is HIGHER than current 
        // OR if current resolution is lower than standard baseline (2).
        // This prevents the "resolution drop" after scaling in capture mode.
        const currentRes = pixiObject.resolution

        // Boost if target zoom requires it, or if it's currently very low.
        // But DON'T downscale if it was boosted by useSelectionBox during capture.
        if (currentRes < targetResolution || (currentRes < 2)) {
          pixiObject.resolution = targetResolution
          updateCount++
        }
      }
    })
  }, [pixiApp, isReady, layers, zoom])

  // ===========================================================================
  // CLEANUP - Memory management and unmount handling
  // ===========================================================================

  useEffect(() => {
    return () => {
      // SAFETY CHECK: Ensure layerObjectsRef.current exists before iteration
      if (!layerObjectsRef.current) return

      layerObjectsRef.current.forEach((pixiObject, layerId) => {
        if (pixiObject && !pixiObject.destroyed) {
          // [FIX] Wrap all destroy calls in try/catch. During navigation teardown,
          // PIXI objects may be in a partially-destroyed state (e.g. WebGL context
          // already lost) which causes internal PIXI errors when calling .destroy().
          try {
            // SAFETY CHECK: Ensure layers exists before accessing it
            const layer = layers?.[layerId]

            if ((layer?.type === LAYER_TYPES.IMAGE || layer?.type === LAYER_TYPES.VIDEO || layer?.type === LAYER_TYPES.FRAME)) {
              const sprite = pixiObject._imageSprite || pixiObject._videoSprite || (pixiObject instanceof PIXI.Sprite ? pixiObject : null)
              if (sprite) {
                destroyImageSprite(sprite, layer)
              }
              if (pixiObject !== sprite && !pixiObject.destroyed) {
                pixiObject.destroy({ children: true })
              }
            } else {
              pixiObject.destroy()
            }
          } catch (e) {
            // Ignore errors from partially-destroyed objects during navigation
          }

          // [FIX] Unregister from MotionEngine to prevent stale objects from causing crashes
          // during subsequent project loads (reading 'x' error in MotionEngine.js).
          try {
            getGlobalMotionEngine().unregisterLayerObject(layerId)
          } catch (e) {
            // Ignore errors during teardown
          }
        }
      })
      layerObjectsRef.current.clear()
      createdLayersRef.current.clear()
    }
  }, [])

  // ===========================================================================
  // HOOK RETURN - Expose layer objects for external access
  // ===========================================================================

  return {
    layerObjects: layerObjectsRef.current,
    getLayerObject: (layerId) => layerObjectsRef.current.get(layerId),
    layerObjectsVersion, // [Bug 3 Fix] Increments after each async layer creation
    isStageReady,
  }
}
