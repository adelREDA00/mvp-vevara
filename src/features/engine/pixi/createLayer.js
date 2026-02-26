/**
 * Factory functions for creating PIXI DisplayObjects from layer configurations.
 * Converts Redux layer data into renderable PIXI objects for text, shapes, images, and backgrounds.
 * Handles complex shape rendering with stroke/fill options, text styling, and image loading.
 * Provides the bridge between application state and visual representation.
 */

import * as PIXI from 'pixi.js'
import { drawDashedRect } from './dashUtils'
import { loadTextureRobust } from './textureUtils'

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
  if (isCircle) {
    // For circles, use ellipse() to allow elliptical shapes
    graphics.ellipse(shapeCenterX, shapeCenterY, halfWidth, halfHeight)
  } else {
    graphics.roundRect(shapeCenterX - halfWidth, shapeCenterY - halfHeight, width, height, data.cornerRadius || 0)
  }

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
        // Use custom dashed rectangle drawing
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
      if (isCircle) {
        graphics.ellipse(shapeCenterX, shapeCenterY, halfWidth, halfHeight)
      } else {
        graphics.roundRect(shapeCenterX - halfWidth, shapeCenterY - halfHeight, width, height, data.cornerRadius || 0)
      }
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
  if (texture.source) {
    texture.source.autoGenerateMipmaps = true
    texture.source.mipMap = 'on'
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

  let texture

  try {
    if (videoUrl.startsWith('blob:')) {
      // PERFORMANCE: For blob URLs, we use a native element to ensure parsing.
      const videoElement = document.createElement('video')
      videoElement.src = videoUrl
      videoElement.muted = true
      videoElement.loop = false
      videoElement.playsInline = true
      videoElement.preload = 'auto'
      videoElement.autoplay = false
      videoElement.setAttribute('autoplay', 'false')
      videoElement.pause()


      // SECURITY FIX: Do NOT set crossOrigin for blob URLs. 
      // This causes SecurityError 'Failed to execute texSubImage2D' in some browsers
      // because blobs don't have CORS headers.
      // videoElement.crossOrigin = 'anonymous' (REMOVED)

      // WEBGL FIX: We must wait for the video to have enough data (readyState 3 or 4) 
      // and metadata (dimensions) before creating the PIXI texture.
      await new Promise((resolve) => {
        const onMetadata = () => {
          videoElement.removeEventListener('loadedmetadata', onMetadata)
          if (videoElement.readyState >= 3) resolve()
        }

        const onCanPlay = () => {
          videoElement.removeEventListener('canplay', onCanPlay)
          videoElement.removeEventListener('canplaythrough', onCanPlay)
          if (videoElement.videoWidth > 0) resolve()
        }

        if (videoElement.readyState >= 3 && videoElement.videoWidth > 0) {
          resolve()
        } else {
          videoElement.addEventListener('loadedmetadata', onMetadata)
          videoElement.addEventListener('canplay', onCanPlay)
          videoElement.addEventListener('canplaythrough', onCanPlay)
          // Fallback timeout
          setTimeout(resolve, 5000)
        }
      })

      // Explicitly Ensure video is paused after initialization
      videoElement.pause()

      texture = PIXI.Texture.from(videoElement, {
        resourceOptions: {
          autoPlay: false,
          muted: true,
          loop: false,
          playsinline: true
        }
      })
      texture._nativeVideo = videoElement // Store for easier access
    } else {
      // PIXI v8: Assets.load is preferred for network URLs
      texture = await PIXI.Assets.load({
        src: videoUrl,
        data: {
          resourceOptions: {
            autoPlay: false,
            muted: true,
            loop: false,
            playsinline: true,
          }
        }
      })
    }
  } catch (loadError) {
    console.warn(`Assets.load failed for video: ${videoUrl}, trying fallback...`, loadError)

    // Fallback: Try Texture.from as a last resort (often works for already-cached or simple assets)
    try {
      texture = PIXI.Texture.from(videoUrl)
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
  const videoElement = texture._nativeVideo || (texture.source?.resource instanceof HTMLVideoElement ? texture.source.resource : null)

  // PERFORMANCE: Enable mipmapping for videos if possible
  if (texture.source) {
    texture.source.autoGenerateMipmaps = true
    texture.source.mipMap = 'on'
    texture.source.scaleMode = 'linear'
  }

  container._videoSprite = sprite
  container._videoTexture = texture
  container._videoElement = videoElement
  container.addChild(sprite)

  // PERFORMANCE: Enable mipmapping for videos if possible
  if (texture.source) {
    texture.source.autoGenerateMipmaps = true
    texture.source.mipMap = 'on'
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

