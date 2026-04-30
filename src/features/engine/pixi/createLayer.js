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
import { installReactiveCornerRadius } from '../motion/actions/CornerRadiusAction'
import { FlowTextContainer } from '../text/FlowTextContainer'

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

  // FLOW MODE: Use high-performance wrapping container if enabled
  if (data.enableFlow) {
    const flowText = new FlowTextContainer(config)
    flowText.x = x
    flowText.y = y
    flowText.alpha = opacity
    flowText.eventMode = 'static'
    flowText.cursor = 'pointer'
    if (config.id) flowText.label = `layer-${config.id}`
    return flowText
  }

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
    text.data = data // [FIX] Attach data to standard PIXI.Text so revealProgress can find content
  }

  // Enable interactions
  text.eventMode = 'static'
  text.cursor = 'pointer'

  // TYPEWRITER: Support character reveal for standard text layers too
  text._revealProgress = 1
  Object.defineProperty(text, 'revealProgress', {
    get() { return this._revealProgress },
    set(val) {
      if (this._revealProgress !== val) {
        this._revealProgress = Math.max(0, Math.min(1, val))
        // [FIX] Prioritize live data content. If it changes in Redux, it must change here.
        // We only fallback to _fullContent if data is missing or stale.
        const fullContent = this.data?.content ?? this._fullContent ?? this.text ?? 'Text'
        this._fullContent = fullContent
        
        const graphemes = [...fullContent]
        const visibleCount = Math.floor(this._revealProgress * graphemes.length)
        this.text = graphemes.slice(0, visibleCount).join('')
      }
    },
    configurable: true
  })

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
  const path = [] // Store vertices for exact layout wrapping

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
      path.push({x: centerX, y: centerY - ry})
      path.push({x: centerX + rx, y: centerY + ry})
      path.push({x: centerX - rx, y: centerY + ry})
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
      path.push({x: centerX, y: centerY - ry})
      path.push({x: centerX + rx, y: centerY - ry / 3})
      path.push({x: centerX + rx, y: centerY + ry / 3})
      path.push({x: centerX, y: centerY + ry})
      path.push({x: centerX - rx, y: centerY + ry / 3})
      path.push({x: centerX - rx, y: centerY - ry / 3})
      break

    case 'star': {
      // Make ALL four extreme points of the star touch the bbox edges exactly.
      const halfW = width / 2
      const halfH = height / 2
      const outerRx = halfW / Math.cos(Math.PI / 10)              // halfW / cos(18°) ≈ halfW × 1.0514
      const outerRy = height / (1 + Math.sin(3 * Math.PI / 10))  // height / (1+sin54°) ≈ halfH × 1.1055
      const innerRx = outerRx * 0.4
      const innerRy = outerRy * 0.4
      const yOffset = outerRy - halfH  // shifts star down so top AND bottom touch their edges
      const pts = 5
      const start = -Math.PI / 2
      
      const pxStart = centerX + Math.cos(start) * outerRx
      const pyStart = centerY + Math.sin(start) * outerRy + yOffset
      graphics.moveTo(pxStart, pyStart)
      path.push({x: pxStart, y: pyStart})
      
      for (let i = 1; i < pts * 2; i++) {
        const angle = start + (i * Math.PI) / pts
        const ex = i % 2 === 0 ? outerRx : innerRx
        const ey = i % 2 === 0 ? outerRy : innerRy
        const px = centerX + Math.cos(angle) * ex
        const py = centerY + Math.sin(angle) * ey + yOffset
        graphics.lineTo(px, py)
        path.push({x: px, y: py})
      }
      graphics.closePath()
      break
    }

    case 'line':
      // A line is just a thin filled rect — fill handles the colour
      graphics.rect(centerX - rx, centerY - ry, width, height)
      path.push({x: centerX - rx, y: centerY - ry})
      path.push({x: centerX + rx, y: centerY - ry})
      path.push({x: centerX + rx, y: centerY + ry})
      path.push({x: centerX - rx, y: centerY + ry})
      break

    case 'arrow': {
      // Points for a standard right-pointing arrow
      const headWidth = Math.min(width * 0.4, height * 1.5)
      const stemHeight = height * 0.3
      const stemRight = centerX + rx - headWidth

      graphics.moveTo(centerX - rx, centerY - stemHeight / 2)
      graphics.lineTo(stemRight, centerY - stemHeight / 2)
      graphics.lineTo(stemRight, centerY - ry)
      graphics.lineTo(centerX + rx, centerY)
      graphics.lineTo(stemRight, centerY + ry)
      graphics.lineTo(stemRight, centerY + stemHeight / 2)
      graphics.lineTo(centerX - rx, centerY + stemHeight / 2)
      graphics.closePath()

      path.push({x: centerX - rx, y: centerY - stemHeight / 2})
      path.push({x: stemRight, y: centerY - stemHeight / 2})
      path.push({x: stemRight, y: centerY - ry})
      path.push({x: centerX + rx, y: centerY})
      path.push({x: stemRight, y: centerY + ry})
      path.push({x: stemRight, y: centerY + stemHeight / 2})
      path.push({x: centerX - rx, y: centerY + stemHeight / 2})
      break
    }

    case 'arrowhead':
      // Triangular head that fills the bounding box
      graphics.moveTo(centerX - rx, centerY - ry)
      graphics.lineTo(centerX + rx, centerY)
      graphics.lineTo(centerX - rx, centerY + ry)
      graphics.closePath()
      path.push({x: centerX - rx, y: centerY - ry})
      path.push({x: centerX + rx, y: centerY})
      path.push({x: centerX - rx, y: centerY + ry})
      break


    default: {
      // rect / square and any unknown type
      const clampedRadius = Math.min(cornerRadius || 0, Math.min(width, height) / 2)
      graphics.roundRect(centerX - rx, centerY - ry, width, height, clampedRadius)
      path.push({x: centerX - rx, y: centerY - ry})
      path.push({x: centerX + rx, y: centerY - ry})
      path.push({x: centerX + rx, y: centerY + ry})
      path.push({x: centerX - rx, y: centerY + ry})
    }
  }
  
  return path
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
  const shapePath = drawShapePath(graphics, shapeType, shapeCenterX, shapeCenterY, width, height, data.cornerRadius || 0)

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

  // [COLOR FIX] Store shape metadata for redrawing during colorChange actions
  graphics._storedShapeData = {
    shapeType,
    cornerRadius: data.cornerRadius || 0,
    shapeCenterX,
    shapeCenterY,
    shapePath
  }
  
  // [METADATA] Store shape info for the Liquid Flow engine
  graphics.shapeType = shapeType
  
  // [CORNER RADIUS] Install reactive property so setting .cornerRadius = X 
  // immediately triggers a redraw via redrawShapeWithCornerRadius.
  installReactiveCornerRadius(graphics)
  graphics.cornerRadius = data.cornerRadius || 0
  
  graphics._storedFill = data.fill || null
  graphics._storedStroke = data.stroke || null
  graphics._storedStrokeWidth = strokeWidth
  graphics._storedStrokeStyle = strokeStyle
  graphics._storedWidth = width
  graphics._storedHeight = height
  graphics._storedAnchorX = effectiveAnchorX
  graphics._storedAnchorY = effectiveAnchorY

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
  container._storedCropWidth = cropWidth
  container._storedCropHeight = cropHeight

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
 * Create a Frame layer — an empty clipping container that can later receive
 * an image or video asset via drag-and-drop.  Structurally identical to an
 * image layer (Container → child Sprite + crop mask) so all existing crop,
 * resize, move, and animation code paths work without special-casing.
 *
 * When empty the sprite shows a lightweight placeholder (solid fill + plus icon).
 * When an asset is attached the sprite texture is swapped to the real image/video.
 */
export function createFrameLayer(config) {
  const { data = {}, x = 0, y = 0, width = 200, height = 200, opacity = 1, anchorX = 0.5, anchorY = 0.5 } = config

  const container = new PIXI.Container()

  // If an asset is already attached (e.g. loading from saved project), hide placeholder
  const hasAsset = !!(data.assetUrl || data.url || data.src)

  // --- inner sprite (empty white texture when no asset) ---
  const sprite = new PIXI.Sprite(hasAsset ? PIXI.Texture.WHITE : PIXI.Texture.WHITE)
  sprite.width = width
  sprite.height = height
  sprite.anchor.set(0, 0)
  sprite.x = 0
  sprite.y = 0
  sprite.alpha = hasAsset ? 1 : 0 // invisible when empty so placeholder shows
  container.addChild(sprite)
  container._imageSprite = sprite // reuse the same property name so existing code detects it

  // --- placeholder group (Container to hold graphics + text) ---
  // [UX FIX] Added AFTER sprite so the highlight (which reuses placeholder) renders on top of assets
  const placeholderGroup = new PIXI.Container()
  container.addChild(placeholderGroup)
  container._framePlaceholder = placeholderGroup // used for visibility management

  // --- placeholder background/icon graphics ---
  const graphics = new PIXI.Graphics()
  placeholderGroup.addChild(graphics)
  container._framePlaceholderGraphics = graphics

  // --- optional text label ---
  const label = new PIXI.Text({
    text: data.label || '',
    style: {
      fontFamily: 'Outfit, sans-serif',
      fontSize: 60,
      fontWeight: 'bold',
      fill: 0x888888,
      align: 'center',
    }
  })
  label.anchor.set(0.5)
  placeholderGroup.addChild(label)
  container._frameLabel = label

  // Use shared helper to draw placeholder consistently
  redrawFramePlaceholder(container, width, height, data)

  // If an asset is already attached, hide placeholder (as it's now on top)
  if (hasAsset) {
    placeholderGroup.visible = false
  }

  // CROP SYSTEM — identical to createImageLayer
  const cropX = config.cropX ?? 0
  const cropY = config.cropY ?? 0
  const cropWidth = config.cropWidth ?? width
  const cropHeight = config.cropHeight ?? height

  container._mediaWidth = config.mediaWidth ?? width
  container._mediaHeight = config.mediaHeight ?? height
  container._originalWidth = width
  container._originalHeight = height


  // Crop mask
  const cropMask = new PIXI.Graphics()
  cropMask.rect(0, 0, cropWidth, cropHeight)
  cropMask.fill(0xffffff)
  container.addChild(cropMask)
  container.mask = cropMask
  container._cropMask = cropMask
  container._storedCropWidth = cropWidth
  container._storedCropHeight = cropHeight

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

  // Mark as frame for easy detection
  container._isFrame = true
  container._frameHasAsset = hasAsset
  container._frameData = data

  // Card frame: add a second sprite for the back side
  if (data.isCardFrame) {
    const hasBackAsset = !!data.backAssetUrl
    const backSprite = new PIXI.Sprite(PIXI.Texture.WHITE)
    backSprite.width = width
    backSprite.height = height
    backSprite.anchor.set(0, 0)
    backSprite.x = 0
    backSprite.y = 0
    backSprite.alpha = hasBackAsset ? 1 : 0
    backSprite.visible = false // back side hidden initially
    // Insert before placeholder so highlight renders on top
    container.addChildAt(backSprite, container.getChildIndex(placeholderGroup))
    container._backSprite = backSprite
    container._isCardFrame = true
    container._frameHasBackAsset = hasBackAsset
  }

  return container
}

/**
 * Attach a loaded texture to an existing frame container.
 * Computes cover-fit crop so the asset fills the frame proportionally.
 */
export function attachAssetToFrame(container, texture, frameWidth, frameHeight) {
  if (!container || !texture) return null

  const sprite = container._imageSprite
  if (!sprite) return null

  // Compute cover-fit: scale asset so it fully covers the frame
  const texW = texture.width
  const texH = texture.height
  const scale = Math.max(frameWidth / texW, frameHeight / texH)
  const mediaW = texW * scale
  const mediaH = texH * scale

  // Center the asset within the frame (crop offsets)
  const cropX = (mediaW - frameWidth) / 2
  const cropY = (mediaH - frameHeight) / 2

  sprite.texture = texture
  sprite.width = mediaW
  sprite.height = mediaH
  sprite.anchor.set(0, 0)
  sprite.x = -cropX
  sprite.y = -cropY
  sprite.alpha = 1
  sprite.visible = true // [FIX] Ensure immediate visibility after texture load

  // Enable mipmapping
  if (!_isMobileDevice && texture.source) {
    texture.source.autoGenerateMipmaps = true
    texture.source.mipMap = 'on'
    texture.source.scaleMode = 'linear'
  }

  // Update container metadata
  container._mediaWidth = mediaW
  container._mediaHeight = mediaH


  // Update crop mask to frame dimensions
  const cropMask = container._cropMask
  if (cropMask) {
    cropMask.clear()
    cropMask.rect(0, 0, frameWidth, frameHeight)
    cropMask.fill(0xffffff)
  }

  // Hide placeholder
  if (container._framePlaceholder) {
    container._framePlaceholder.visible = false
  }
  container._frameHasAsset = true

  return { mediaWidth: mediaW, mediaHeight: mediaH, cropX, cropY, cropWidth: frameWidth, cropHeight: frameHeight }
}

/**
 * Attach a loaded texture to the back side of a card frame container.
 * Uses the same cover-fit logic as the front side.
 */
export function attachBackAssetToFrame(container, texture, frameWidth, frameHeight) {
  if (!container || !texture) return null

  const sprite = container._backSprite
  if (!sprite) return null

  // Compute cover-fit: scale asset so it fully covers the frame
  const texW = texture.width
  const texH = texture.height
  const scale = Math.max(frameWidth / texW, frameHeight / texH)
  const mediaW = texW * scale
  const mediaH = texH * scale

  // Center the asset within the frame (crop offsets)
  const cropX = (mediaW - frameWidth) / 2
  const cropY = (mediaH - frameHeight) / 2

  sprite.texture = texture
  sprite.width = mediaW
  sprite.height = mediaH
  sprite.anchor.set(0, 0)
  sprite.x = -cropX
  sprite.y = -cropY
  sprite.alpha = 1

  // Enable mipmapping
  if (!_isMobileDevice && texture.source) {
    texture.source.autoGenerateMipmaps = true
    texture.source.mipMap = 'on'
    texture.source.scaleMode = 'linear'
  }

  container._frameHasBackAsset = true

  // Store back-specific cover-fit dimensions on the container
  // so the sync loop can size the back sprite independently of the front
  container._backMediaWidth = mediaW
  container._backMediaHeight = mediaH
  container._backCropX = cropX
  container._backCropY = cropY

  return { mediaWidth: mediaW, mediaHeight: mediaH, cropX, cropY, cropWidth: frameWidth, cropHeight: frameHeight }
}

/**
 * Redraw the frame placeholder graphic at new dimensions.
 * Called during resize/sync so the placeholder scales with the frame.
 */
export function redrawFramePlaceholder(container, width, height, data = null) {
  const group = container._framePlaceholder
  const ph = container._framePlaceholderGraphics
  const labelObj = container._frameLabel
  if (!ph || (group && container._isDropTarget)) return

  const frameData = data || container._frameData
  const labelText = (frameData?.label || '').trim()

  // For card frames, show side indicator when no label is set
  const isCardFrame = frameData?.isCardFrame || container._isCardFrame
  const showingFront = frameData?.showingFront !== false
  const sideLabel = isCardFrame ? (showingFront ? 'Front' : 'Back') : ''

  ph.clear()
  ph.rect(0, 0, width, height)
  ph.fill({ color: 0x2a2a30, alpha: 0.6 })

  const cx = width / 2, cy = height / 2

  if (labelObj) {
    if (labelText || sideLabel) {
      labelObj.text = labelText || sideLabel
      labelObj.style.fill = 0xdddddd // More visible light gray
      labelObj.style.fontSize = 60
      labelObj.style.fontWeight = 'bold'
      labelObj.style.wordWrap = true
      labelObj.style.wordWrapWidth = Math.max(50, width - 20)
      labelObj.position.set(cx, cy)
      labelObj.visible = true
    } else {
      labelObj.text = ''
      labelObj.visible = false
      const arm = Math.min(width, height) * 0.12
      ph.moveTo(cx - arm, cy).lineTo(cx + arm, cy)
      ph.moveTo(cx, cy - arm).lineTo(cx, cy + arm)
      ph.stroke({ color: 0x888888, width: 2 })
    }
  }
}

/**
 * Highlight a frame as a drop target (purple tint + border).
 * Sets _isDropTarget flag so the sync loop doesn't overwrite the highlight.
 */
export function highlightFrameDropTarget(container, width, height, data = null) {
  const group = container._framePlaceholder
  const ph = container._framePlaceholderGraphics
  const labelObj = container._frameLabel
  if (!ph || !group) return

  const frameData = data || container._frameData
  const labelText = (frameData?.label || '').trim()

  container._isDropTarget = true
  group.visible = true // [UX FIX] Ensure highlight is visible even if placeholder was hidden for asset
  ph.clear()
  ph.rect(0, 0, width, height)
  ph.fill({ color: 0x7c3aed, alpha: 0.25 })
  ph.rect(0, 0, width, height)
  ph.stroke({ color: 0x7c3aed, width: 2 })

  const cx = width / 2, cy = height / 2

  if (labelObj) {
    if (labelText) {
      labelObj.text = labelText
      labelObj.style.fill = 0xffffff
      labelObj.style.fontSize = 60
      labelObj.style.fontWeight = 'bold'
      labelObj.style.wordWrap = true
      labelObj.style.wordWrapWidth = Math.max(50, width - 20)
      labelObj.position.set(cx, cy)
      labelObj.visible = true
    } else {
      labelObj.text = ''
      labelObj.visible = false
      const arm = Math.min(width, height) * 0.12
      ph.moveTo(cx - arm, cy).lineTo(cx + arm, cy)
      ph.moveTo(cx, cy - arm).lineTo(cx, cy + arm)
      ph.stroke({ color: 0xffffff, width: 2 })
    }
  }
}

/**
 * Remove drop-target highlight from a frame (restore normal placeholder).
 */
export function unhighlightFrameDropTarget(container, width, height) {
  container._isDropTarget = false
  redrawFramePlaceholder(container, width, height)

  // [UX FIX] If frame has an asset, hide the placeholder again (it was shown for the highlight)
  // For card frames, check the active side's asset status using current visual state
  const showingFront = container._showingFront !== undefined
    ? container._showingFront !== false
    : container._frameData?.showingFront !== false
  const activeHasAsset = container._isCardFrame
    ? (showingFront ? container._frameHasAsset : container._frameHasBackAsset)
    : container._frameHasAsset
  if (activeHasAsset && container._framePlaceholder) {
    container._framePlaceholder.visible = false
  }
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

  // [ROBUST FIX] Index cache by sourceId to ensure instance stability across split segments.
  // Using sourceId ensures that split segments of the same original video share the
  // exact same HTMLVideoElement and hardware decoder, preventing audio stutter and
  // buffer exhaustion when multiple segments are in the project.
  const cacheKey = config.sourceId || config.id
  if (!cacheKey) {
    throw new Error('Video layer requires a unique config.id or config.sourceId for caching')
  }

  // [FIX] Cancel any pending release if the layer is re-requested
  if (releaseTimers.has(cacheKey)) {
    clearTimeout(releaseTimers.get(cacheKey))
    releaseTimers.delete(cacheKey)
  }

  let texture
  let videoElement = videoElementCache.get(cacheKey)
  if (videoElement) {
    // If the URL has changed for the same layer ID, update the source
    const currentSrc = videoElement.src || ''
    if (videoUrl && !currentSrc.includes(videoUrl)) {
      videoElement.pause()
      // [CORS FIX] Always re-enforce crossOrigin BEFORE setting src on reuse
      videoElement.crossOrigin = 'anonymous' 
      videoElement.src = videoUrl
      videoElement.load()
    } else {
      videoElement.pause() 
    }
  }

  try {
    if (videoUrl.startsWith('blob:')) {
      // If NOT in cache, create and prepare
      if (!videoElement) {
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

        await new Promise((resolve, reject) => {
          let timeoutId
          const cleanup = () => {
            videoElement.removeEventListener('loadedmetadata', onMetadata)
            videoElement.removeEventListener('canplay', onCanPlay)
            videoElement.removeEventListener('canplaythrough', onCanPlay)
            videoElement.removeEventListener('error', onError)
            if (timeoutId) clearTimeout(timeoutId)
          }
          const onMetadata = () => {
            if (videoElement.readyState >= targetReadyState) {
              cleanup()
              resolve()
            }
          }

          const onCanPlay = () => {
            if (videoElement.readyState >= targetReadyState && videoElement.videoWidth > 0) {
              cleanup()
              resolve()
            }
          }

          // [404 FIX] Reject immediately if the video element fires an error
          // (e.g. 404 Not Found). Without this, the promise hangs until the
          // timeout — keeping asyncLoadCounterRef > 0 and freezing the loader.
          const onError = (e) => {
            cleanup()
            const code = videoElement.error?.code
            reject(new Error(`Video load error (code ${code}) for: ${videoUrl}`))
          }

          if (videoElement.readyState >= targetReadyState && videoElement.videoWidth > 0) {
            resolve()
          } else {
            videoElement.addEventListener('loadedmetadata', onMetadata)
            videoElement.addEventListener('canplay', onCanPlay)
            videoElement.addEventListener('canplaythrough', onCanPlay)
            videoElement.addEventListener('error', onError)
            timeoutId = setTimeout(() => {
              console.warn(`[createVideoLayer] readiness timeout (${timeoutMs / 1000}s) for: ${videoUrl}`)
              cleanup()
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
  container._storedCropWidth = cropWidth
  container._storedCropHeight = cropHeight

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

