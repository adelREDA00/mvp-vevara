/**
 * Factory functions for creating PIXI DisplayObjects from layer configurations.
 * Converts Redux layer data into renderable PIXI objects for text, shapes, images, and backgrounds.
 * Handles complex shape rendering with stroke/fill options, text styling, and image loading.
 * Provides the bridge between application state and visual representation.
 */

import * as PIXI from 'pixi.js'
import { drawDashedRect } from './dashUtils'
import { loadTextureRobust } from './textureUtils'
import { getGlobalMotionEngine } from '../motion/index'

// [MOBILE FIX] Detect mobile devices to conditionally disable GPU-heavy features
const _isMobileDevice = typeof window !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)

/**
 * Create a Pixi Text object from layer config
 * @param {Object} config - Layer configuration
 * @param {Object} config.data - Text data { content, fontFamily, fontSize, color, fontWeight, align, etc. }
 * @param {number} config.x - X position
 * @param {number} config.y - Y position
 * @param {number} config.width - Width constraint
 * @param {number} config.height - Height constraint
 * @param {number} config.opacity - Opacity (0-1)
 * @param {number} config.anchorX - Anchor X (0-1)
 * @param {number} config.anchorY - Anchor Y (0-1)
 * @returns {PIXI.Text}
 */
export function createTextLayer(config) {
  const { data = {}, x = 0, y = 0, width, opacity = 1 } = config

  const text = new PIXI.Text({
    text: data.content || 'Text',
    style: {
      fontFamily: data.fontFamily || 'Arial',
      fontSize: data.fontSize || 24,
      fill: data.color || '#000000',
      fontWeight: data.fontWeight || 'normal',
      fontStyle: data.fontStyle || 'normal',
      wordWrap: true, // Enable word wrap by default
      wordWrapWidth: width || 200,
      breakWords: true,
      lineHeight: (data.fontSize || 24) * 1.2,
      letterSpacing: 0, // [SYNC FIX] Explicitly zero to match browser default
      resolution: 2, // [SCALING FIX] Reduced from 4 to 2 to provide more headroom for scaling before hitting GPU limits
      antialias: true, // Maximized edges
      align: data.textAlign || 'left',
    },
  })

  // PERFORMANCE: Enable mipmapping for text textures to prevent aliasing when zoomed out
  if (text.texture?.source) {
    text.texture.source.autoGenerateMipmaps = true
    text.texture.source.mipMap = 'on'
    text.texture.source.scaleMode = 'linear'
  }

  // Set position and opacity
  text.x = x
  text.y = y
  text.alpha = opacity
  text._fontsLoadedVersion = -1 // Start at -1 to ensure observer triggers on load even if fonts are ready

  // CRITICAL FIX: Force text update BEFORE setting pivot to get accurate dimensions
  text.updateText?.(true)
  const actualTextHeight = text.getLocalBounds().height || config.height || 40

  // Restore alignment-based anchors to allow internal text logical alignment.
  const align = data.textAlign || 'left'
  const anchorX = align === 'center' ? 0.5 : (align === 'right' ? 1 : 0)
  text.anchor.set(anchorX, 0)

  // Use pivot to shift the rotation center to the geometric center of the text box.
  // This allows rotation to occur around the center while keeping text aligned.
  // CRITICAL FIX: Use actual rendered height instead of config.height
  text.pivot.x = (0.5 - anchorX) * (width || 200)
  text.pivot.y = actualTextHeight / 2

  // Set position to (x, y). 
  // With the pivot set correctly, Redux (x, y) now represents the CENTER of the text box.
  text.x = x
  text.y = y

  // Set opacity
  text.alpha = opacity

  // Store layer ID for reference
  if (config.id) {
    text.label = `layer-${config.id}`
  }

  // Enable interactions
  text.eventMode = 'static'
  text.cursor = 'pointer'

  return text
}

/**
 * Draws a shape path into a PIXI.Graphics object.
 * Every shape is drawn to fill EXACTLY its width × height bounding box so that
 * PIXI's own bounding-box width/height always equals the layer dimensions.
 * This is critical: applyTransformInline sets displayObject.width/height from
 * Redux, which would otherwise scale a shape whose visual extent doesn't match,
 * causing jitter/shake during and after resize operations.
 *
 * @param {PIXI.Graphics} graphics
 * @param {string}  shapeType  - 'rect'|'square'|'circle'|'triangle'|'hexagon'|'star'|'line'
 * @param {number}  centerX    - local X of the shape's geometric centre
 * @param {number}  centerY    - local Y of the shape's geometric centre
 * @param {number}  width      - full bounding-box width
 * @param {number}  height     - full bounding-box height
 * @param {number}  [cornerRadius=0] - only used for rect/square
 */
export function drawShapePath(graphics, shapeType, centerX, centerY, width, height, cornerRadius = 0) {
  const rx = width / 2   // half-width  == outer X radius
  const ry = height / 2  // half-height == outer Y radius

  switch (shapeType) {
    case 'circle':
      // Ellipse that fills the full width × height box (matches rect behaviour for transforms)
      graphics.ellipse(centerX, centerY, rx, ry)
      break

    case 'triangle':
      graphics.moveTo(centerX, centerY - ry)
      graphics.lineTo(centerX + rx, centerY + ry)
      graphics.lineTo(centerX - rx, centerY + ry)
      graphics.closePath()
      break

    case 'hexagon':
      // Flat-top pointy-bottom hexagon that fills the bbox
      graphics.moveTo(centerX, centerY - ry)
      graphics.lineTo(centerX + rx, centerY - ry / 3)
      graphics.lineTo(centerX + rx, centerY + ry / 3)
      graphics.lineTo(centerX, centerY + ry)
      graphics.lineTo(centerX - rx, centerY + ry / 3)
      graphics.lineTo(centerX - rx, centerY - ry / 3)
      graphics.closePath()
      break

    case 'star': {
      // Make ALL four extreme points of the star touch the bbox edges exactly.
      //
      // For a 5-point upward star (first outer point at -90°, i.e. top):
      //   - Widest outer points at angles ±(90°−72°) = ±18° from horizontal
      //       x-extent = cos(18°)·outerRx  →  outerRx = halfW / cos(18°) = halfW / cos(π/10)
      //   - Top point at -90°: y-extent = -outerRy
      //   - Bottom outer points at 54°/126°: y-extent = sin(54°)·outerRy
      //       Solving top+bottom simultaneously: (1 + sin(54°))·outerRy = height
      //       →  outerRy = height / (1 + sin(3π/10))
      //   - Vertical shift to center the result: yOffset = outerRy − halfH
      const halfW = width / 2
      const halfH = height / 2
      const outerRx = halfW / Math.cos(Math.PI / 10)              // halfW / cos(18°) ≈ halfW × 1.0514
      const outerRy = height / (1 + Math.sin(3 * Math.PI / 10))  // height / (1+sin54°) ≈ halfH × 1.1055
      const innerRx = outerRx * 0.4
      const innerRy = outerRy * 0.4
      const yOffset = outerRy - halfH  // shifts star down so top AND bottom touch their edges
      const pts = 5
      const start = -Math.PI / 2
      graphics.moveTo(
        centerX + Math.cos(start) * outerRx,
        centerY + Math.sin(start) * outerRy + yOffset
      )
      for (let i = 1; i < pts * 2; i++) {
        const angle = start + (i * Math.PI) / pts
        const ex = i % 2 === 0 ? outerRx : innerRx
        const ey = i % 2 === 0 ? outerRy : innerRy
        graphics.lineTo(
          centerX + Math.cos(angle) * ex,
          centerY + Math.sin(angle) * ey + yOffset
        )
      }
      graphics.closePath()
      break
    }

    case 'line':
      // A line is just a thin filled rect — fill handles the colour
      graphics.rect(centerX - rx, centerY - ry, width, height)
      break

    default:
      // rect / square and any unknown type
      graphics.roundRect(centerX - rx, centerY - ry, width, height, cornerRadius || 0)
  }
}

/**
 * Create a Pixi Graphics object (rectangle) from layer config
 * @param {Object} config - Layer configuration
 * @param {Object} config.data - Rectangle data { fill, stroke, strokeWidth, cornerRadius, etc. }
 * @param {number} config.x - X position
 * @param {number} config.y - Y position
 * @param {number} config.width - Width
 * @param {number} config.height - Height
 * @param {number} config.opacity - Opacity (0-1)
 * @param {number} config.anchorX - Anchor X (0-1)
 * @param {number} config.anchorY - Anchor Y (0-1)
 * @returns {PIXI.Graphics}
 */
export function createShapeLayer(config) {
  // Extract config with defaults
  const { data = {}, x = 0, y = 0, width = 100, height = 100, opacity = 1, anchorX = 0.5, anchorY = 0.5 } = config

  // Ensure circle shapes use center anchor for proper positioning
  const effectiveAnchorX = data.shapeType === 'circle' ? 0.5 : (anchorX !== undefined ? anchorX : 0.5)
  const effectiveAnchorY = data.shapeType === 'circle' ? 0.5 : (anchorY !== undefined ? anchorY : 0.5)

  // Create PIXI graphics object for drawing
  const graphics = new PIXI.Graphics()

  // Convert hex fill color to number (null for transparent)
  const fill = data.fill && data.fill !== 'transparent' && data.fill !== null ? parseInt(data.fill.replace('#', ''), 16) : null

  // Parse stroke color, default to black if width set but no color
  let stroke = null
  if (data.stroke && data.stroke !== '') {
    const strokeHex = data.stroke.replace('#', '')
    if (strokeHex && /^[0-9A-Fa-f]{6}$/.test(strokeHex)) {
      stroke = parseInt(strokeHex, 16)
    }
  } else if (data.strokeWidth > 0) {
    // Default to black if stroke width is set but no color
    stroke = 0x000000
  }
  // Get stroke width and style
  const strokeWidth = data.strokeWidth || 0
  const strokeStyle = data.strokeStyle || 'solid'

  // Determine shape type and dimensions
  const shapeType = data.shapeType || 'rect'
  const isCircle = shapeType === 'circle'

  // Calculate ellipse/rectangle center position based on anchor point
  const halfWidth = width / 2
  const halfHeight = height / 2

  // For anchor 0.5: center at (0,0) - shape centered on position
  // For anchor 0: center at (halfWidth, halfHeight) - shape starts at position
  // For anchor 1: center at (-halfWidth, -halfHeight) - shape ends at position
  const shapeCenterX = halfWidth * (1 - 2 * effectiveAnchorX)
  const shapeCenterY = halfHeight * (1 - 2 * effectiveAnchorY)

  // Clear and prepare graphics for drawing
  graphics.clear()

  // Check if stroke is dashed or dotted (needs special drawing)
  const isDashed = strokeStyle === 'dashed' && stroke !== null && strokeWidth > 0
  const isDotted = strokeStyle === 'dotted' && stroke !== null && strokeWidth > 0

  // Draw shape outline (path needed before fill)
  drawShapePath(graphics, shapeType, shapeCenterX, shapeCenterY, width, height, data.cornerRadius || 0)

  // Apply fill color (or transparent fill for clickability)
  if (fill !== null) {
    graphics.fill(fill)
  } else {
    // Invisible fill makes entire area clickable
    graphics.fill({ color: 0x000000, alpha: 0 })
  }

  // Apply stroke (border) if specified
  if (stroke !== null && strokeWidth > 0) {
    if (isDashed || isDotted) {
      if (isCircle) {
        // For ellipses, fall back to solid stroke (dashed ellipse not implemented)
        graphics.ellipse(shapeCenterX, shapeCenterY, halfWidth, halfHeight)
        graphics.stroke({
          color: stroke,
          width: strokeWidth,
          alignment: 0.5
        })
      } else {
        // Use custom dashed rectangle drawing for all non-circular shapes
        const dashLen = isDotted ? 0 : strokeWidth * 4
        const gapLen = strokeWidth * 2

        drawDashedRect(
          graphics,
          shapeCenterX - halfWidth,
          shapeCenterY - halfHeight,
          width,
          height,
          data.cornerRadius || 0,
          stroke,
          strokeWidth,
          dashLen,
          gapLen
        )
      }
    } else {
      // Redraw path and apply solid stroke
      drawShapePath(graphics, shapeType, shapeCenterX, shapeCenterY, width, height, data.cornerRadius || 0)
      graphics.stroke({
        color: stroke,
        width: strokeWidth,
        alignment: 0.5 // Center alignment for quality
      })
    }
  }

  // Position the graphics object
  graphics.x = x
  graphics.y = y


  // Set transparency
  graphics.alpha = opacity

  // Add identifier label
  if (config.id) {
    graphics.label = `layer-${config.id}`
  }

  // Enable mouse interactions
  graphics.eventMode = 'static'
  graphics.cursor = 'pointer'

  // For transparent shapes, set clickable area
  if (fill === null) {
    if (isCircle) {
      graphics.hitArea = new PIXI.Ellipse(shapeCenterX, shapeCenterY, halfWidth, halfHeight)
    } else {
      graphics.hitArea = new PIXI.Rectangle(shapeCenterX - halfWidth, shapeCenterY - halfHeight, width, height)
    }
  }

  // Return the created graphics object
  return graphics
}

/**
 * Create a Pixi Sprite (image) from layer config
 * @param {Object} config - Layer configuration
 * @param {Object} config.data - Image data { src, url }
 * @param {number} config.x - X position
 * @param {number} config.y - Y position
 * @param {number} config.width - Width
 * @param {number} config.height - Height
 * @param {number} config.opacity - Opacity (0-1)
 * @param {number} config.anchorX - Anchor X (0-1)
 * @param {number} config.anchorY - Anchor Y (0-1)
 * @returns {Promise<PIXI.Sprite>}
 */




// NEW: Enhanced image layer creation with blob URL support
// This function now handles both regular URLs and blob URLs (uploaded files)
export async function createImageLayer(config) {
  const { data = {}, x = 0, y = 0, width, height, opacity = 1, anchorX = 0.5, anchorY = 0.5 } = config

  const imageUrl = data.url || data.src
  if (!imageUrl) {
    throw new Error('Image layer requires data.url or data.src')
  }

  const texture = await loadTextureRobust(imageUrl)
  if (!texture) {
    throw new Error(`Failed to load texture for: ${imageUrl}`)
  }

  const container = new PIXI.Container()
  const sprite = new PIXI.Sprite(texture)

  // PERFORMANCE: Enable mipmapping for images to prevent aliasing when zoomed out
  // [MOBILE FIX] Disable mipmapping on mobile to save ~3x GPU memory per texture
  if (texture.source) {
    if (!_isMobileDevice) {
      texture.source.autoGenerateMipmaps = true
      texture.source.mipMap = 'on'
    } else {
      texture.source.autoGenerateMipmaps = false
    }
    texture.source.scaleMode = 'linear'
  }

  container._imageSprite = sprite
  container.addChild(sprite)

  // Calculate the display size (may differ from media if user provided explicit dimensions)
  // This represents the "logical" full size of the uncropped image in the canvas
  const finalWidth = width || texture.width || 300
  const finalHeight = height || (width && texture.width ? (texture.height / texture.width) * width : (texture.height || 200))

  // CROP SYSTEM: Store LOGICAL media dimensions, not raw texture pixels
  // This solves the top-left zoom bug when GSAP tries to animate from base states
  container._mediaWidth = config.mediaWidth ?? finalWidth
  container._mediaHeight = config.mediaHeight ?? finalHeight

  // Store original for fallback
  container._originalWidth = finalWidth
  container._originalHeight = finalHeight

  // CROP SYSTEM: Read crop state from config, default to full-image (no crop)
  const cropX = config.cropX ?? 0
  const cropY = config.cropY ?? 0
  const cropWidth = config.cropWidth ?? finalWidth
  const cropHeight = config.cropHeight ?? finalHeight

  // The sprite always represents the FULL media at its intrinsic aspect ratio.
  // Its size is set to the "media window" dimensions (what the user has scaled to).
  sprite.width = config.mediaWidth ?? finalWidth
  sprite.height = config.mediaHeight ?? finalHeight

  // Sprite anchor at (0, 0) — crop offset is handled via sprite position
  sprite.anchor.set(0, 0)

  // Position the sprite so the crop region aligns with the container origin
  sprite.x = -cropX
  sprite.y = -cropY

  // CROP MASK: A rectangle that defines the visible region
  const cropMask = new PIXI.Graphics()
  cropMask.rect(0, 0, cropWidth, cropHeight)
  cropMask.fill(0xffffff)
  container.addChild(cropMask)
  container.mask = cropMask
  container._cropMask = cropMask

  // Container anchor: offset so (x, y) represents the center of the crop box
  container.anchorX = anchorX
  container.anchorY = anchorY
  // Shift the crop box so anchorX/anchorY aligns with the container origin
  container.pivot.set(cropWidth * anchorX, cropHeight * anchorY)

  container.x = x
  container.y = y
  container.alpha = opacity

  if (config.id) {
    container.label = `layer-${config.id}`
  }
  container._originalWidth = finalWidth
  container._originalHeight = finalHeight

  container.eventMode = 'static'
  container.cursor = 'pointer'

  return container
}


// GLOBAL VIDEO ELEMENT CACHE: Maps scene-specific segment keys -> HTMLVideoElement
// Key format: videoUrl|sceneId|sourceStartTime|sourceEndTime
const videoElementCache = new Map()
const releaseTimers = new Map() // layerId -> timeoutId for deferred cleanup

/**
 * Explicitly cleanup and release a video element from the cache.
 * Called when a video layer is destroyed from the stage.
 * Uses a deferred timeout to avoid killing elements that are immediately reused.
 */
export function releaseVideoElement(layerId) {
  // [FIX] Deferred Release: Reordering scenes often triggers a momentary "removal"
  // If we kill the element immediately, we get a dark flash/freeze when it's re-added.
  if (releaseTimers.has(layerId)) return

  const timerId = setTimeout(() => {
    const videoElement = videoElementCache.get(layerId)
    if (videoElement) {
      try {
        videoElement.pause()
        videoElement.src = ''
        videoElement.load()
      } catch (e) {
        console.warn(`[releaseVideoElement] Error cleaning up video ${layerId}:`, e)
      }
      videoElementCache.delete(layerId)
    }
    releaseTimers.delete(layerId)
  }, 200) // Wait 200ms before actual destruction

  releaseTimers.set(layerId, timerId)
}

/**
 * Create a Pixi Container with a Video Sprite from layer config
 * @param {Object} config - Layer configuration
 * @returns {Promise<PIXI.Container>}
 */
export async function createVideoLayer(config) {
  const { data = {}, x = 0, y = 0, width, height, opacity = 1, anchorX = 0.5, anchorY = 0.5 } = config

  const videoUrl = data.url || data.src
  if (!videoUrl) {
    throw new Error('Video layer requires data.url or data.src')
  }

  // [ROBUST FIX] Index cache by layerId to ensure instance stability.
  // Using layerId ensures that as long as the layer exists in the project,
  // it keeps its dedicated video element.
  const cacheKey = config.id
  if (!cacheKey) {
    throw new Error('Video layer requires a unique config.id for caching')
  }

  // [FIX] Cancel any pending release if the layer is re-requested
  if (releaseTimers.has(cacheKey)) {
    clearTimeout(releaseTimers.get(cacheKey))
    releaseTimers.delete(cacheKey)
    // console.log(`[createVideoLayer] Cancelled deferred release for layer: ${cacheKey}`)
  }

  let texture
  let videoElement = videoElementCache.get(cacheKey)
  if (videoElement) {
    // If the URL has changed for the same layer ID, update the source
    const currentSrc = videoElement.src || ''
    if (videoUrl && !currentSrc.includes(videoUrl)) {
      console.log(`[createVideoLayer] URL changed for layer ${cacheKey}, updating src`)
      videoElement.pause()
      videoElement.src = videoUrl
      videoElement.load()
    } else {
      videoElement.pause() // Safeguard: ensure it's not playing when pulled from cache
    }
  }

  try {
    if (videoUrl.startsWith('blob:')) {
      // If NOT in cache, create and prepare
      if (!videoElement) {
        console.log(`[createVideoLayer] Creating new video element for ${config.sceneId}: ${videoUrl}`)
        // PERFORMANCE: For blob URLs, we use a native element to ensure parsing.
        videoElement = document.createElement('video')
        videoElement.crossOrigin = 'anonymous'
        videoElement.src = videoUrl
        videoElement.muted = data.muted !== false
        videoElement.loop = false
        videoElement.playsInline = true
        videoElement.preload = 'auto'
        videoElement.autoplay = false
        videoElement.setAttribute('autoplay', 'false')
        videoElement.pause()

        // [SCENE CUT FIX] Intercept play() to prevent PIXI VideoSource from auto-playing
        // PIXI v8 VideoSource often ignores autoPlay: false and calls play() when media is ready.
        // We block these accidental calls if the MotionEngine is currently paused.
        const originalPlay = videoElement.play
        videoElement.play = function () {
          const engine = getGlobalMotionEngine()
          if (engine && !engine.isPlaying) {
            // console.log("🛑 [createVideoLayer] Blocking accidental video.play() because engine is paused")
            return Promise.resolve()
          }
          return originalPlay.apply(this, arguments)
        }

        // Cache it immediately with the partitioned key
        videoElementCache.set(cacheKey, videoElement)

        // WEBGL FIX: We must wait for metadata and enough data for smooth playback
        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
        const targetReadyState = isMobile ? 4 : 3 // HAVE_ENOUGH_DATA for mobile, HAVE_FUTURE_DATA for desktop
        const timeoutMs = isMobile ? 20000 : 10000 // Higher timeout for mobile network/decoding

        await new Promise((resolve) => {
          let timeoutId
          const onMetadata = () => {
            if (videoElement.readyState >= targetReadyState) {
              videoElement.removeEventListener('loadedmetadata', onMetadata)
              if (timeoutId) clearTimeout(timeoutId)
              resolve()
            }
          }

          const onCanPlay = () => {
            if (videoElement.readyState >= targetReadyState && videoElement.videoWidth > 0) {
              videoElement.removeEventListener('canplay', onCanPlay)
              videoElement.removeEventListener('canplaythrough', onCanPlay)
              if (timeoutId) clearTimeout(timeoutId)
              resolve()
            }
          }

          if (videoElement.readyState >= targetReadyState && videoElement.videoWidth > 0) {
            resolve()
          } else {
            videoElement.addEventListener('loadedmetadata', onMetadata)
            videoElement.addEventListener('canplay', onCanPlay)
            videoElement.addEventListener('canplaythrough', onCanPlay)
            timeoutId = setTimeout(() => {
              console.warn(`[createVideoLayer] readiness timeout (${timeoutMs / 1000}s) for: ${videoUrl}`)
              resolve()
            }, timeoutMs)
          }
        })
        videoElement.pause()
      }

      texture = PIXI.Texture.from(videoElement, {
        resourceOptions: {
          autoPlay: false,
          muted: data.muted !== false,
          loop: false,
          playsinline: true,
          crossOrigin: 'anonymous'
        }
      })
      texture._nativeVideo = videoElement
      videoElement.pause() // Ensure it's paused after texture assignment
    } else {
      // Network URL handle
      texture = await PIXI.Assets.load({
        src: videoUrl,
        data: {
          resourceOptions: {
            autoPlay: false,
            muted: data.muted !== false,
            loop: false,
            playsinline: true,
            crossOrigin: 'anonymous',
          }
        }
      })
    }
  } catch (loadError) {
    try {
      texture = await PIXI.Assets.load({
        src: videoUrl,
        data: {
          resourceOptions: {
            autoPlay: false,
            muted: data.muted !== false,
            loop: false,
            playsinline: true,
            crossOrigin: 'anonymous',
          }
        }
      })
    } catch (fallbackError) {
      console.error(`Final fallback failed for video: ${videoUrl}`, fallbackError)
      throw new Error(`Failed to load video texture: ${videoUrl}`)
    }
  }

  // Safety check: Ensure texture was actually created
  if (!texture) {
    throw new Error(`Failed to initialize video texture for: ${videoUrl}`)
  }

  // Create container to normalize transforms (similar to Image layers)
  const container = new PIXI.Container()
  const sprite = new PIXI.Sprite(texture)
  videoElement = texture._nativeVideo || (texture.source?.resource instanceof HTMLVideoElement ? texture.source.resource : null)

  // PERFORMANCE: Enable mipmapping for videos if possible
  // [MOBILE FIX] Disable mipmapping on mobile to save ~3x GPU memory per texture
  if (texture.source) {
    if (!_isMobileDevice) {
      texture.source.autoGenerateMipmaps = true
      texture.source.mipMap = 'on'
    } else {
      texture.source.autoGenerateMipmaps = false
    }
    texture.source.scaleMode = 'linear'
  }

  container._videoSprite = sprite
  container._videoTexture = texture
  container._videoElement = videoElement
  container.addChild(sprite)

  // PERFORMANCE: Enable mipmapping for videos if possible
  // [MOBILE FIX] Disable mipmapping on mobile
  if (texture.source) {
    if (!_isMobileDevice) {
      texture.source.autoGenerateMipmaps = true
      texture.source.mipMap = 'on'
    } else {
      texture.source.autoGenerateMipmaps = false
    }
    texture.source.scaleMode = 'linear'
  }

  // CROP SYSTEM: Store intrinsic media dimensions
  const texWidth = videoElement?.videoWidth || texture.width || data.width || 300
  const texHeight = videoElement?.videoHeight || texture.height || data.height || 200

  const finalWidth = width || texWidth
  const finalHeight = height || (width ? (texHeight / texWidth) * width : texHeight)

  // CROP SYSTEM: Store LOGICAL media dimensions, not raw texture pixels
  container._mediaWidth = config.mediaWidth ?? finalWidth
  container._mediaHeight = config.mediaHeight ?? finalHeight

  // Store original for fallback
  container._originalWidth = finalWidth
  container._originalHeight = finalHeight

  // CROP SYSTEM: Read crop state from config, default to full-video (no crop)
  const cropX = config.cropX ?? 0
  const cropY = config.cropY ?? 0
  const cropWidth = config.cropWidth ?? finalWidth
  const cropHeight = config.cropHeight ?? finalHeight

  // Sprite at full media size, anchor at (0, 0)
  sprite.width = config.mediaWidth ?? finalWidth
  sprite.height = config.mediaHeight ?? finalHeight
  sprite.anchor.set(0, 0)
  sprite.x = -cropX
  sprite.y = -cropY

  // CROP MASK
  const cropMask = new PIXI.Graphics()
  cropMask.rect(0, 0, cropWidth, cropHeight)
  cropMask.fill(0xffffff)
  container.addChild(cropMask)
  container.mask = cropMask
  container._cropMask = cropMask

  // Pivot for anchor-based positioning
  container.anchorX = anchorX
  container.anchorY = anchorY
  container.pivot.set(cropWidth * anchorX, cropHeight * anchorY)

  container.x = x
  container.y = y
  container.alpha = opacity

  if (config.id) {
    container.label = `layer-${config.id}`
  }

  container.eventMode = 'static'
  container.cursor = 'pointer'

  return container
}

