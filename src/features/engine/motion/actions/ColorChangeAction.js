import { gsap } from 'gsap'
import { CustomEase } from "gsap/CustomEase";
import * as PIXI from 'pixi.js'
import { drawShapePath } from '../../pixi/createLayer'
import { drawDashedRect } from '../../pixi/dashUtils'
import { markTiltTextureDirty, syncTiltMesh } from '../../pixi/perspectiveTilt'

// Register the plugin
gsap.registerPlugin(CustomEase);

/**
 * Decompose a hex color (string "#RRGGBB" or numeric 0xRRGGBB) to { r, g, b }.
 */
function hexToRgb(hex) {
    let num
    if (typeof hex === 'string') {
        num = parseInt(hex.replace('#', ''), 16)
    } else if (typeof hex === 'number') {
        num = hex
    } else {
        return { r: 0, g: 0, b: 0 }
    }
    if (isNaN(num)) return { r: 0, g: 0, b: 0 }
    return {
        r: (num >> 16) & 0xFF,
        g: (num >> 8) & 0xFF,
        b: num & 0xFF,
    }
}

/**
 * Compose { r, g, b } (0-255) back to a numeric 0xRRGGBB color.
 */
function rgbToNum(r, g, b) {
    return ((Math.round(r) & 0xFF) << 16) |
           ((Math.round(g) & 0xFF) << 8) |
            (Math.round(b) & 0xFF)
}

/**
 * Parse a hex color string to a numeric PIXI color (same as parseColorCached in useCanvasLayers).
 */
function parseColor(hexColor) {
    if (hexColor === null || hexColor === undefined || hexColor === 'transparent') return null
    if (typeof hexColor === 'number') return hexColor
    if (typeof hexColor !== 'string') return null
    const hex = hexColor.replace('#', '')
    if (hex && /^[0-9A-Fa-f]{6}$/.test(hex)) {
        return parseInt(hex, 16)
    }
    return null
}

/**
 * Apply an interpolated numeric color to a PIXI object based on its type.
 * Handles Text, Background (Container with _backgroundGraphics), and Shape (Graphics).
 * Hot path — called 60fps during GSAP animation. Uses early exit to skip redundant work.
 */
function applyColor(pixiObject, numericColor) {
    // Early exit: skip if color hasn't changed since last apply
    if (pixiObject._lastAppliedColor === numericColor) return
    pixiObject._lastAppliedColor = numericColor

    // Any color mutation invalidates the tilt mesh's cached RenderTexture.
    // The next syncTiltMesh tick (fired below or by TiltAction onUpdate) re-captures.
    if (pixiObject._tiltMesh) markTiltTextureDirty(pixiObject)

    // Text layer: PIXI.Text has a `style` property with `fill`
    if (pixiObject instanceof PIXI.Text) {
        pixiObject.style.fill = numericColor
        return
    }

    // FlowTextContainer: Use custom updateColor method
    if (pixiObject.isFlowText && typeof pixiObject.updateColor === 'function') {
        const hex = '#' + numericColor.toString(16).padStart(6, '0')
        pixiObject.updateColor(hex)
        return
    }

    // Background layer: Container with _backgroundGraphics child
    if (pixiObject._backgroundGraphics) {
        const gfx = pixiObject._backgroundGraphics
        const w = pixiObject._storedWidth || 100
        const h = pixiObject._storedHeight || 100
        gfx.clear()
        gfx.rect(0, 0, w, h)
        gfx.fill(numericColor)
        pixiObject._storedColor = numericColor
        return
    }

    // Shape layer: PIXI.Graphics — full redraw with animated fill
    if (pixiObject instanceof PIXI.Graphics) {
        pixiObject._animatedFillColor = numericColor

        const shapeData = pixiObject._storedShapeData
        const w = pixiObject._storedWidth || 100
        const h = pixiObject._storedHeight || 100
        const anchorX = pixiObject._storedAnchorX ?? 0.5
        const anchorY = pixiObject._storedAnchorY ?? 0.5

        if (shapeData) {
            const shapeType = shapeData.shapeType || 'rect'
            const halfWidth = w / 2
            const halfHeight = h / 2
            const shapeCenterX = halfWidth * (1 - 2 * anchorX)
            const shapeCenterY = halfHeight * (1 - 2 * anchorY)

            const stroke = shapeData.stroke && shapeData.stroke !== ''
                ? parseColor(shapeData.stroke)
                : (shapeData.strokeWidth > 0 ? 0x000000 : null)
            const strokeWidth = shapeData.strokeWidth || 0
            const strokeStyle = shapeData.strokeStyle || 'solid'
            const isCircle = shapeType === 'circle'
            const isDashed = strokeStyle === 'dashed' && stroke !== null && strokeWidth > 0
            const isDotted = strokeStyle === 'dotted' && stroke !== null && strokeWidth > 0

            pixiObject.clear()

            const currentRadius = pixiObject.cornerRadius !== undefined ? pixiObject.cornerRadius : (shapeData.cornerRadius || 0)
            drawShapePath(pixiObject, shapeType, shapeCenterX, shapeCenterY, w, h, currentRadius)
            pixiObject.fill(numericColor)

            if (stroke !== null && strokeWidth > 0) {
                if (isDashed || isDotted) {
                    if (isCircle) {
                        pixiObject.ellipse(shapeCenterX, shapeCenterY, halfWidth, halfHeight)
                        pixiObject.stroke({ color: stroke, width: strokeWidth, alignment: 0.5 })
                    } else {
                        const dashLen = isDotted ? 0 : strokeWidth * 4
                        const gapLen = strokeWidth * 2
                        const currentRadius = pixiObject.cornerRadius !== undefined ? pixiObject.cornerRadius : (shapeData.cornerRadius || 0)
                        drawDashedRect(pixiObject, shapeCenterX - halfWidth, shapeCenterY - halfHeight, w, h, currentRadius, stroke, strokeWidth, dashLen, gapLen)
                    }
                } else {
                    const currentRadius = pixiObject.cornerRadius !== undefined ? pixiObject.cornerRadius : (shapeData.cornerRadius || 0)
                    drawShapePath(pixiObject, shapeType, shapeCenterX, shapeCenterY, w, h, currentRadius)
                    pixiObject.stroke({ color: stroke, width: strokeWidth, alignment: 0.5 })
                }
            }

            if (numericColor === null) {
                if (isCircle) {
                    pixiObject.hitArea = new PIXI.Ellipse(shapeCenterX, shapeCenterY, halfWidth, halfHeight)
                } else {
                    pixiObject.hitArea = new PIXI.Rectangle(shapeCenterX - halfWidth, shapeCenterY - halfHeight, w, h)
                }
            }
        } else {
            const halfWidth = w / 2
            const halfHeight = h / 2
            const shapeCenterX = halfWidth * (1 - 2 * anchorX)
            const shapeCenterY = halfHeight * (1 - 2 * anchorY)
            pixiObject.clear()
            pixiObject.rect(shapeCenterX - halfWidth, shapeCenterY - halfHeight, w, h)
            pixiObject.fill(numericColor)
        }

        // Store as hex string only after redraw (avoid per-frame string allocation)
        pixiObject._storedFill = '#' + numericColor.toString(16).padStart(6, '0')
    }
}

export class ColorChangeAction {
    constructor() {
        this.type = 'colorChange'
    }

    execute(pixiObject, actionData, options = {}) {
        const { values = {} } = actionData
        const duration = (values.duration || 2000) / 1000
        const easing = "myEase"

        // Determine start color from state tracker or current object
        let startColorRaw = options.startState?.color
        if (startColorRaw === undefined) {
            // Fallback: read from the PIXI object
            if (pixiObject instanceof PIXI.Text) {
                startColorRaw = pixiObject.style?.fill ?? '#000000'
            } else if (pixiObject._backgroundGraphics) {
                startColorRaw = pixiObject._storedColor ?? 0xffffff
            } else if (pixiObject instanceof PIXI.Graphics) {
                startColorRaw = pixiObject._storedFill ?? '#000000'
            } else {
                startColorRaw = '#000000'
            }
        }

        const targetColor = values.color || '#000000'

        const startRgb = hexToRgb(startColorRaw)
        const targetRgb = hexToRgb(targetColor)

        // If start and target are the same, return a no-op tween
        if (startRgb.r === targetRgb.r && startRgb.g === targetRgb.g && startRgb.b === targetRgb.b) {
            return gsap.to({}, { duration })
        }

        // Target a _animatedColorState sub-object on pixiObject (like ScaleAction targets pixiObject.scale)
        // so GSAP writes interpolated RGB values directly and they persist across seek/scrub.
        // Using a sub-object avoids overwrite conflicts with MoveAction/FadeAction
        // which also target pixiObject directly.
        if (!pixiObject._animatedColorState) {
            pixiObject._animatedColorState = { r: startRgb.r, g: startRgb.g, b: startRgb.b }
        } else {
            // Safety: if it was somehow set to a string or non-object in a previous buggy version
            if (typeof pixiObject._animatedColorState !== 'object') {
                pixiObject._animatedColorState = { r: startRgb.r, g: startRgb.g, b: startRgb.b }
            } else {
                pixiObject._animatedColorState.r = startRgb.r
                pixiObject._animatedColorState.g = startRgb.g
                pixiObject._animatedColorState.b = startRgb.b
            }
        }

        // Store a function for manual color sync after seek (since onUpdate may not
        // reliably fire during masterTimeline.pause(time) in nested timeline configs)
        pixiObject._applyAnimatedColor = () => {
            if (pixiObject._animatedColorState) {
                const num = rgbToNum(pixiObject._animatedColorState.r, pixiObject._animatedColorState.g, pixiObject._animatedColorState.b)
                pixiObject._animatedColorState.numeric = num
                applyColor(pixiObject, num)
                if (pixiObject._tiltMesh) syncTiltMesh(pixiObject, null)
            }
        }

        const toVars = {
            r: targetRgb.r,
            g: targetRgb.g,
            b: targetRgb.b,
            duration,
            ease: easing,
            immediateRender: false,
            overwrite: false,
            onUpdate: () => {
                if (!pixiObject._animatedColorState) return
                const num = rgbToNum(pixiObject._animatedColorState.r, pixiObject._animatedColorState.g, pixiObject._animatedColorState.b)
                pixiObject._animatedColorState.numeric = num
                applyColor(pixiObject, num)
                if (pixiObject._tiltMesh) syncTiltMesh(pixiObject, null)
            },
            onComplete: () => {
                if (!pixiObject._animatedColorState) return
                const num = rgbToNum(pixiObject._animatedColorState.r, pixiObject._animatedColorState.g, pixiObject._animatedColorState.b)
                pixiObject._animatedColorState.numeric = num
                applyColor(pixiObject, num)
                if (pixiObject._tiltMesh) syncTiltMesh(pixiObject, null)
            },
            onReverseComplete: () => {
                if (!pixiObject._animatedColorState) return
                const num = rgbToNum(startRgb.r, startRgb.g, startRgb.b)
                pixiObject._animatedColorState.numeric = num
                applyColor(pixiObject, num)
                if (pixiObject._tiltMesh) syncTiltMesh(pixiObject, null)
            },
            ...options.gsapOptions
        }

        return gsap.fromTo(pixiObject._animatedColorState,
            { r: startRgb.r, g: startRgb.g, b: startRgb.b },
            toVars
        )
    }
}
