import { gsap } from 'gsap'
import { CustomEase } from "gsap/CustomEase";
import * as PIXI from 'pixi.js'

// Register the plugin
gsap.registerPlugin(CustomEase);
import { drawShapePath } from '../../pixi/createLayer'
import { drawDashedRect } from '../../pixi/dashUtils'
import { CORNER_RADIUS_MAX } from '../cornerRadiusConstants.js'
import { markTiltTextureDirty, syncTiltMesh } from '../../pixi/perspectiveTilt'

function clampRadius(value) {
    return Math.max(0, Math.min(CORNER_RADIUS_MAX, Number(value) || 0))
}

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
 * Redraw a PIXI.Graphics shape with the given corner radius.
 * Reads fill, stroke, and dimensions from stored metadata on the object.
 */
function redrawShapeWithCornerRadius(pixiObject, cornerRadius) {
    const shapeData = pixiObject._storedShapeData
    if (!shapeData) return

    const shapeType = shapeData.shapeType || 'rect'
    // Only rect/square support corner radius
    if (shapeType !== 'rect' && shapeType !== 'square') return

    const w = pixiObject._storedWidth || 100
    const h = pixiObject._storedHeight || 100
    const anchorX = pixiObject._storedAnchorX ?? 0.5
    const anchorY = pixiObject._storedAnchorY ?? 0.5
    const halfWidth = w / 2
    const halfHeight = h / 2
    const shapeCenterX = halfWidth * (1 - 2 * anchorX)
    const shapeCenterY = halfHeight * (1 - 2 * anchorY)

    // Use animated fill color if a color animation is active, otherwise stored fill
    const fillRaw = pixiObject._animatedFillColor !== undefined
        ? pixiObject._animatedFillColor
        : pixiObject._storedFill
    const fill = typeof fillRaw === 'number' ? fillRaw : parseColor(fillRaw)

    const strokeRaw = pixiObject._storedStroke
    const stroke = strokeRaw ? parseColor(strokeRaw) : null
    const strokeWidth = pixiObject._storedStrokeWidth || 0
    const strokeStyle = pixiObject._storedStrokeStyle || 'solid'
    const isDashed = strokeStyle === 'dashed' && stroke !== null && strokeWidth > 0
    const isDotted = strokeStyle === 'dotted' && stroke !== null && strokeWidth > 0

    // [LEAK FIX] Do NOT mutate shapeData.cornerRadius here. 
    // Other actions (like ColorChangeAction) should read the live .cornerRadius 
    // property from the pixiObject instead of relying on this stored metadata.
    shapeData.shapeCenterX = shapeCenterX
    shapeData.shapeCenterY = shapeCenterY

    pixiObject.clear()

    drawShapePath(pixiObject, shapeType, shapeCenterX, shapeCenterY, w, h, cornerRadius)

    if (fill !== null) {
        pixiObject.fill(fill)
    } else {
        pixiObject.fill({ color: 0x000000, alpha: 0 })
    }

    if (stroke !== null && strokeWidth > 0) {
        if (isDashed || isDotted) {
            const dashLen = isDotted ? 0 : strokeWidth * 4
            const gapLen = strokeWidth * 2
            drawDashedRect(pixiObject, shapeCenterX - halfWidth, shapeCenterY - halfHeight, w, h, cornerRadius, stroke, strokeWidth, dashLen, gapLen)
        } else {
            drawShapePath(pixiObject, shapeType, shapeCenterX, shapeCenterY, w, h, cornerRadius)
            pixiObject.stroke({ color: stroke, width: strokeWidth, alignment: 0.5 })
        }
    }

    if (fill === null) {
        pixiObject.hitArea = new PIXI.Rectangle(shapeCenterX - halfWidth, shapeCenterY - halfHeight, w, h)
    }

    // Keep _storedFill in sync as hex string (same convention as ColorChangeAction)
    if (typeof fillRaw === 'number') {
        pixiObject._storedFill = '#' + fillRaw.toString(16).padStart(6, '0')
    }
}

/**
 * Define getters/setters for corner radius on the PIXI object.
 * This ensures that any change (GSAP, manual, or during seek) 
 * immediately triggers a visual redraw.
 */
export function installReactiveCornerRadius(pixiObject) {
    if (!pixiObject._applyAnimatedCornerRadius) {
        pixiObject._applyAnimatedCornerRadius = function () {
            const radius = this.cornerRadius ?? 0
            redrawShapeWithCornerRadius(this, radius)
            
            // [TILT SYNC] If the layer is currently tilted, any visual change 
            // (like corner radius) must mark the tilt texture dirty so the 
            // mesh re-captures the updated original.
            if (this._tiltMesh && !this._tiltMesh.destroyed) {
                markTiltTextureDirty(this)
                syncTiltMesh(this, null)
            }
        }
    }

    if (pixiObject._hasReactiveRadiusProperties) return

    const privateProp = '_cornerRadius'
    
    // Initial value from stored data if available
    if (pixiObject[privateProp] === undefined) {
        pixiObject[privateProp] = pixiObject.cornerRadius ?? pixiObject._storedShapeData?.cornerRadius ?? 0
    }

    // If MotionEngine already initialized it, we ensure it's reactive
    if (pixiObject.cornerRadius === undefined || Object.getOwnPropertyDescriptor(pixiObject, 'cornerRadius')?.configurable) {
        Object.defineProperty(pixiObject, 'cornerRadius', {
            get() { return this[privateProp] },
            set(value) {
                if (this[privateProp] !== value) {
                    this[privateProp] = value
                    this._applyAnimatedCornerRadius()
                }
            },
            configurable: true
        })
    }

    pixiObject._hasReactiveRadiusProperties = true
}

export class CornerRadiusAction {
    constructor() {
        this.type = 'cornerRadius'
    }

    execute(pixiObject, actionData, options = {}) {
        const { values = {} } = actionData
        const duration = (values.duration || 2000) / 1000
        const easing = "myEase"

        // Resolve start radius
        const startRadius = clampRadius(
            options.startState?.cornerRadius ?? (pixiObject.cornerRadius ?? 0)
        )
        const targetRadius = clampRadius(
            values.cornerRadius !== undefined ? values.cornerRadius : 0
        )

        // Ensure reactive properties and visual applier are attached
        installReactiveCornerRadius(pixiObject)

        // No-op if values are the same
        if (Math.abs(startRadius - targetRadius) < 0.1) {
            return gsap.to({}, { duration })
        }

        const toVars = {
            cornerRadius: targetRadius,
            duration,
            ease: easing,
            immediateRender: false,
            overwrite: false,
        }

        const tl = gsap.timeline()
        tl.set(pixiObject, { cornerRadius: startRadius }, 0)
        tl.to(pixiObject, toVars, 0)
        return tl
    }
}
