// so when we start from the start we have no layer on our cavnas , and we then add a shaper or text layer , first we send the data to redux   , then usecanvalayers detect that and he take the redux data of the layer create the layer itself and then create a spreat map and store all the details of the pixi object on it , same thing for the update it take the redux data and update the pixi object and then update the spreat map  



import { useEffect, useRef, useMemo, useLayoutEffect, useState } from 'react'
import { useSelector, useDispatch } from 'react-redux'
import * as PIXI from 'pixi.js'
import { createTextLayer, createShapeLayer, createImageLayer, createVideoLayer, drawShapePath, releaseVideoElement } from '../../engine/pixi/createLayer'
import { drawDashedRect } from '../../engine/pixi/dashUtils'
import { LAYER_TYPES } from '../../../store/models'
import { updateLayer, selectScenes, selectProjectTimelineInfo, selectLoadingMode, startPreparingLayer, finishPreparingLayer } from '../../../store/slices/projectSlice'
import { updateLayerZOrder } from '../utils/layerUtils'
import { getGlobalMotionEngine } from '../../engine/motion'
import { loadTextureRobust } from '../../engine/pixi/textureUtils'

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

  // [FIX] BACKGROUND PROTECTION: Skip geometric transforms for background layers.
  // Their dimensions and positioning are managed separately to ensure "cover" fit
  // and non-interactivity.
  if (layer.type === 'background') {
    // Sync opacity only
    if (layer.opacity !== undefined) displayObject.alpha = layer.opacity
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
  const isAtSceneStart = !hasMotion || Math.abs(currentTime - startTimeOffset) < 0.1
  // Allow base state updates ONLY if at scene start (even if editing base)
  const shouldApplyBaseState = isAtSceneStart

  // Skip updates during playback unless forced (GSAP is in control)
  if (isActuallyPlaying && !force) {
    return
  }

  // 1. Position Synchronization
  if (force) {
    if (layer.x !== undefined) displayObject.x = layer.x
    if (layer.y !== undefined) displayObject.y = layer.y
  } else if (!isDragging) {
    if (capturedLayer && capturedLayer.currentPosition && !isActuallyPlaying) {
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
  const currentScaleX = capturedLayer?.scaleX ?? (layer.scaleX !== undefined ? layer.scaleX : 1)
  const currentScaleY = capturedLayer?.scaleY ?? (layer.scaleY !== undefined ? layer.scaleY : 1)

  // [FIX] EXCLUDE PIXI.Text from manual .width/.height scaling.
  // Text layers should render naturally via their .style properties (fontSize, wordWrapWidth)
  // and only be scaled via .scale property. Setting .width directly on Text objects
  // stretches/squishes the text texture, leading to distortion and clipping-like effects.
  if (displayObject instanceof PIXI.Sprite && !(displayObject instanceof PIXI.Text)) {
    const baseWidth = capturedLayer?.width ?? layer.width
    const baseHeight = capturedLayer?.height ?? layer.height

    if (force || (!isActuallyPlaying && (capturedLayer || shouldApplyBaseState))) {
      if (baseWidth !== undefined) displayObject.width = baseWidth * currentScaleX
      if (baseHeight !== undefined) displayObject.height = baseHeight * currentScaleY
    }
  } else {
    if (force || (!isActuallyPlaying && (capturedLayer || shouldApplyBaseState))) {
      displayObject.scale.set(currentScaleX, currentScaleY)
    }
  }

  // 3. Rotation Synchronization
  if (force) {
    if (layer.rotation !== undefined) displayObject.rotation = degToRad(layer.rotation)
  } else if (capturedLayer && capturedLayer.rotation !== undefined && !isActuallyPlaying) {
    displayObject.rotation = degToRad(capturedLayer.rotation)
  } else if (layer.rotation !== undefined && !isActuallyPlaying && shouldApplyBaseState) {
    displayObject.rotation = degToRad(layer.rotation)
  }

  // 4. Width/Height/Style Synchronization (for Graphics/Text/Containers)
  if (force || capturedLayer || !isActuallyPlaying) {
    if (displayObject instanceof PIXI.Text) {
      const isResizing = displayObject._isResizing === true
      const style = displayObject.style
      if (!isResizing && style && layer.width > 0) {
        if (style.wordWrapWidth !== layer.width) {
          style.wordWrapWidth = layer.width
          if (displayObject.updateText) displayObject.updateText(true)
        }
      }

      const align = layer.data?.textAlign || 'left'
      const anchorX = align === 'center' ? 0.5 : (align === 'right' ? 1 : 0)
      const currentWidth = layer.width || 200

      // PERFORMANCE FIX: Removed unconditional updateText(true) that was causing expensive 
      // canvas rasterization on every frame/render loop for PIXI.Text objects.
      const actualHeight = displayObject.getLocalBounds().height || layer.height || 40

      if (displayObject.anchor.x !== anchorX) displayObject.anchor.set(anchorX, 0)
      displayObject.pivot.set((0.5 - anchorX) * currentWidth, actualHeight / 2)
    } else if (displayObject instanceof PIXI.Container && (displayObject._imageSprite || displayObject._videoSprite)) {
      // [FIX] Always sync video timing metadata — this is read by syncMedia, not a visual transform.
      // This ensures the video element knows its correct offset even if a scene switch happens mid-playback.
      displayObject._sourceStartTime = layer.data?.sourceStartTime || 0
      displayObject._sourceEndTime = layer.data?.sourceEndTime || (layer.data?.duration || 0)

      // Sync muted state dynamically.
      // Muting is always safe, but unmuting requires prior user interaction
      // (browser autoplay policy). Only unmute when the engine is actively
      // playing, which guarantees the user clicked "play" first.
      if (displayObject._videoElement) {
        const isMuted = layer.data?.muted !== false;
        if (displayObject._videoElement.muted !== isMuted) {
          displayObject._videoElement.muted = isMuted;
        }
      }

      if (force || capturedLayer || (!isActuallyPlaying && shouldApplyBaseState)) {
        const sprite = displayObject._imageSprite || displayObject._videoSprite
        const cropMask = displayObject._cropMask

        // Read crop state from captured layer (live) OR Redux (stale during capture)
        const mediaW = capturedLayer?.mediaWidth ?? (layer.mediaWidth ?? displayObject._mediaWidth ?? displayObject._originalWidth ?? layer.width ?? 100)
        const mediaH = capturedLayer?.mediaHeight ?? (layer.mediaHeight ?? displayObject._mediaHeight ?? displayObject._originalHeight ?? layer.height ?? 100)
        const cropX = capturedLayer?.cropX ?? (layer.cropX ?? 0)
        const cropY = capturedLayer?.cropY ?? (layer.cropY ?? 0)
        const cropW = capturedLayer?.cropWidth ?? (layer.cropWidth ?? layer.width ?? 100)
        const cropH = capturedLayer?.cropHeight ?? (layer.cropHeight ?? layer.height ?? 100)

        // Store these values on the object so CropAction can initialize from them if needed
        displayObject._storedCropX = cropX
        displayObject._storedCropY = cropY
        displayObject._storedCropWidth = cropW
        displayObject._storedCropHeight = cropH
        displayObject._storedMediaWidth = mediaW
        displayObject._storedMediaHeight = mediaH

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
        if (typeof console !== 'undefined' && console.log && (displayObject._videoSprite || displayObject._imageSprite)) {
          console.log('[useCanvasLayers] applyTransformInline media', {
            layerId,
            fromCapture: !!capturedLayer,
            pos: { x: displayObject.x, y: displayObject.y },
            cropW,
            cropH,
            pivot: { x: displayObject.pivot.x, y: displayObject.pivot.y }
          })
        }
      }
    } else if (!(displayObject instanceof PIXI.Graphics) && !(displayObject instanceof PIXI.Sprite)) {
      if (force || (!isActuallyPlaying && (capturedLayer || shouldApplyBaseState))) {
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
}

export function useCanvasLayers(stageContainer, isReady, pixiApp = null, worldWidth = 1920, worldHeight = 1080, dragStateAPI = null, motionCaptureMode = null, editingTextLayerId = null, zoom = 100, editingStepId = null) {
  const dispatch = useDispatch()
  const loadingMode = useSelector(selectLoadingMode)

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

    const layerObjects = layerObjectsRef.current
    const createdLayers = createdLayersRef.current
    const engine = getGlobalMotionEngine()
    const isActuallyPlaying = engine.getIsPlaying()
    const currentTime = engine.masterTimeline?.time() || 0

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
            layerObjects.delete(oldId)
            createdLayers.delete(oldId)
            break
          }
        }
      }

      if (adoptedObject) {
        layerObjects.set(layerId, adoptedObject)
        createdLayers.add(layerId)

        // [FIX] ID MAPPING: Update labels immediately for interaction hooks.
        // This ensures findLayerIdFromObject (used for selection) matches the new ID.
        adoptedObject.label = `layer-${layerId}`

        // Reset visibility immediately for the new scene
        const layerData = layerRenderData[layerId]
        if (layerData) {
          adoptedObject.visible = layerData.visible
          adoptedObject.eventMode = layerData.visible ? 'static' : 'none'
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
        engine.registerLayerObject(layerId, pixiObject, { sceneId: layer.sceneId })
      }
      else if (layer.type === LAYER_TYPES.IMAGE) {
        createdLayers.add(layerId)
        asyncLoadCounterRef.current++
        dispatch(startPreparingLayer(layerId))
        // [FIX] Reset isStageReady when new async loads are queued — this ensures
        // the loading modal stays visible until ALL async layers are created
        if (loadingMode === 'global') {
          setIsStageReady(false)
        }

        // [MOBILE FIX] On mobile, push async loads into a queue processed sequentially.
        const handleImageLoad = () => createImageLayer(layer).then((sprite) => {
          asyncLoadCounterRef.current--
          dispatch(finishPreparingLayer(layerId))
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
          stageContainer.addChild(sprite)
          const isVisible = currentLayer.visible !== false && currentLayer.sceneId === currentScene?.id
          sprite.visible = isVisible
          applyTransformInline(sprite, currentLayer, dragStateAPI, layerId, motionCaptureMode, false, editingTextLayerId, editingStepId)
          engine.registerLayerObject(layerId, sprite, { sceneId: currentLayer.sceneId })
          setLayerObjectsVersion(v => v + 1)
          checkReadiness()
        }).catch((error) => {
          asyncLoadCounterRef.current--
          createdLayers.delete(layerId)
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
        dispatch(startPreparingLayer(layerId))
        if (loadingMode === 'global') {
          setIsStageReady(false)
        }

        const handleVideoLoad = () => createVideoLayer(layer).then((container) => {
          asyncLoadCounterRef.current--
          dispatch(finishPreparingLayer(layerId))
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
          stageContainer.addChild(container)
          const isVisible = currentLayer.visible !== false && currentLayer.sceneId === currentScene?.id
          container.visible = isVisible
          applyTransformInline(container, currentLayer, dragStateAPI, layerId, motionCaptureMode, false, editingTextLayerId, editingStepId)
          engine.registerLayerObject(layerId, container, { sceneId: currentLayer.sceneId })
          setLayerObjectsVersion(v => v + 1)
          checkReadiness()
        }).catch((error) => {
          asyncLoadCounterRef.current--
          createdLayers.delete(layerId)
          checkReadiness()
        })

        if (_isMobileDevice) {
          mobileLoadQueueRef.current.push(handleVideoLoad)
        } else {
          handleVideoLoad().catch(() => {
            asyncLoadCounterRef.current--
            dispatch(finishPreparingLayer(layerId))
            createdLayers.delete(layerId)
            checkReadiness()
          })
        }
        return
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
        createdLayers.add(layerId)

        // Set initial visibility for newly created synchronous layers
        const layerData = layerRenderData[layerId]
        if (layerData) {
          pixiObject.visible = layerData.visible
          pixiObject.eventMode = layerData.visible ? 'static' : 'none'
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
    layerOrder.forEach((layerId, desiredIndex) => {
      const layer = layers?.[layerId]
      const pixiObject = layerObjects.get(layerId)
      if (!layer || !pixiObject || pixiObject.destroyed) return

      // UPDATE [Sync]: Ensure MotionEngine always has the latest metadata (especially sceneId)
      // This handles cases where a layer is moved between scenes or updated.
      engine.registerLayerObject(layerId, pixiObject, { sceneId: layer.sceneId })

      const isLayerCaptured = motionCaptureMode?.isActive && motionCaptureMode.trackedLayers?.has(layerId)

      // -------------------------------------------------------------------
      // TEXT LAYER UPDATES (Optimized)
      // -------------------------------------------------------------------

      const startTimeOffset = layer.sceneStartOffset ?? 0
      const isAtSceneStart = Math.abs(currentTime - startTimeOffset) < 0.01

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
        pixiObject.eventMode = (layerData.visible && layer.type !== LAYER_TYPES.BACKGROUND) ? 'static' : 'none'
      }

      if (isInteracting) {
        // Skip geometric updates during interaction to prevent bouncing
        // But visibility and eventMode are already handled above.
        // Opacity and Z-order are handled below.
      } else {
        if (layer.type === LAYER_TYPES.TEXT && layer.data && (!isActuallyPlaying || isLayerCaptured)) {
          // [SYNC FIX] Remove scrubbing/scene-start skip.
          // We always want to sync text if the timeline is paused so Redux truth is visible.
          // Only update text content if it actually changed
          if (pixiObject.text !== layer.data.content) {
            // console.log(`[useCanvasLayers] Text content changed for ${layerId}: "${pixiObject.text}" -> "${layer.data.content}"`)
            pixiObject.text = layer.data.content || ''

            // In PIXI v8, changing .text doesn't always immediately update bounds until the next render
            // forcing it helps for immediate height sync back to Redux
            if (pixiObject.updateText) pixiObject.updateText(true);

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
            // Recalculate height on font size change
            calculateTextHeight(layerId, pixiObject.text, style.fontSize, wordWrapWidth, layer.data.fontFamily, layer.data.fontWeight, layer.data.fontStyle, dispatch, layerId === editingTextLayerId)
          }
          if (style.fill !== (layer.data.color || '#000000')) style.fill = layer.data.color || '#000000'
          if (style.fontFamily !== (layer.data.fontFamily || 'Arial')) style.fontFamily = layer.data.fontFamily || 'Arial'
          if (style.fontWeight !== (layer.data.fontWeight || 'normal')) style.fontWeight = layer.data.fontWeight || 'normal'
          if (style.fontStyle !== (layer.data.fontStyle || 'normal')) style.fontStyle = layer.data.fontStyle || 'normal'
          if (style.letterSpacing !== 0) style.letterSpacing = 0

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
        }

        // -------------------------------------------------------------------
        // BACKGROUND LAYER UPDATES
        // -------------------------------------------------------------------

        else if (layer.type === LAYER_TYPES.BACKGROUND) {
          const currentColor = layer.data?.color !== undefined ? layer.data.color : 0xffffff
          const targetWidth = layer.width || worldWidth
          const targetHeight = layer.height || worldHeight
          const graphics = pixiObject._backgroundGraphics

          if (pixiObject._storedColor !== currentColor || pixiObject._storedWidth !== targetWidth || pixiObject._storedHeight !== targetHeight) {
            if (graphics) {
              graphics.clear()
              graphics.rect(0, 0, targetWidth, targetHeight)
              graphics.fill(currentColor)
            }
            pixiObject._storedColor = currentColor

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
            const currentWidth = layer.width || 100
            const currentHeight = layer.height || 100
            const currentFill = layer.data?.fill || null
            const currentStroke = layer.data?.stroke || null
            const currentStrokeWidth = layer.data?.strokeWidth || 0
            const currentStrokeStyle = layer.data?.strokeStyle || 'solid'

            if (pixiObject._storedWidth !== currentWidth || pixiObject._storedHeight !== currentHeight ||
              pixiObject._storedFill !== currentFill || pixiObject._storedStroke !== currentStroke ||
              pixiObject._storedStrokeWidth !== currentStrokeWidth || pixiObject._storedStrokeStyle !== currentStrokeStyle) {

              redrawShapeWithColors(pixiObject, layer.data, currentWidth, currentHeight, layer.anchorX ?? 0.5, layer.anchorY ?? 0.5)

              pixiObject._storedWidth = currentWidth
              pixiObject._storedHeight = currentHeight
              pixiObject._storedFill = currentFill
              pixiObject._storedStroke = currentStroke
              pixiObject._storedStrokeWidth = currentStrokeWidth
              pixiObject._storedStrokeStyle = currentStrokeStyle
            }
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
            // (unless specifically at a scene start or in capture mode)
            if (!isActuallyPlaying && (isLayerCaptured || isAtSceneStart)) {
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

              const anchorX = layer.anchorX !== undefined ? layer.anchorX : 0.5
              const anchorY = layer.anchorY !== undefined ? layer.anchorY : 0.5
              pixiObject.pivot.set(cropW * anchorX, cropH * anchorY)
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

            if (oldStart !== pixiObject._sourceStartTime) {
              console.log(`[useCanvasLayers] Video time range updated: ${layerId}, sourceStartTime=${pixiObject._sourceStartTime}, sourceEndTime=${pixiObject._sourceEndTime}`)
            }

            if (!isActuallyPlaying && (isLayerCaptured || isAtSceneStart)) {
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

              const anchorX = layer.anchorX !== undefined ? layer.anchorX : 0.5
              const anchorY = layer.anchorY !== undefined ? layer.anchorY : 0.5
              pixiObject.pivot.set(cropW * anchorX, cropH * anchorY)
            }
          }
        }

        // -------------------------------------------------------------------
        // TRANSFORM & ALPHA
        // -------------------------------------------------------------------

        applyTransformInline(pixiObject, layer, dragStateAPI, layerId, motionCaptureMode, false, editingTextLayerId, editingStepId)

        // Sync Opacity (Alpha)
        if (layerData.opacity !== undefined && (!isActuallyPlaying || isLayerCaptured)) {
          pixiObject.alpha = layerData.opacity
        }
      }

      // -------------------------------------------------------------------
      // Z-ORDER SYNC
      // -------------------------------------------------------------------
      // Only reorder if the current index is wrong
      const currentIndex = stageContainer.children.indexOf(pixiObject)
      if (currentIndex !== desiredIndex) {
        updateLayerZOrder(stageContainer, pixiObject, desiredIndex)
      }
    })

    // 3. LAYER REMOVAL
    const currentLayerIds = new Set(layerOrder)
    layerObjects.forEach((pixiObject, layerId) => {
      if (!currentLayerIds.has(layerId)) {
        stageContainer.removeChild(pixiObject)

        // Properly destroy image sprites vs other objects
        const layer = layers?.[layerId]
        if (layer?.type === LAYER_TYPES.IMAGE || layer?.type === LAYER_TYPES.VIDEO) {
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

        layerObjects.delete(layerId)
        createdLayers.delete(layerId)
        previousLayerValuesRef.current.delete(layerId)
      }
    })

    previousSelectedLayerIdsRef.current = new Set(selectedLayerIds)

  }, [stageContainer, isReady, layerRenderData, layerOrder, currentScene?.id, selectedLayerIds, motionCaptureMode, editingTextLayerId, layers, dragStateAPI, editingStepId, worldWidth, worldHeight, fontsLoadedVersion, scenes, pixiApp])

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

            if ((layer?.type === LAYER_TYPES.IMAGE || layer?.type === LAYER_TYPES.VIDEO)) {
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
