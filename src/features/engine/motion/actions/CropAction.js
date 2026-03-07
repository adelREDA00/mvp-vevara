/**
 * CropAction - Handles crop animations for motion steps
 * Applies GSAP animations to media layer crop properties
 */

import * as PIXI from 'pixi.js'
import { gsap } from 'gsap'
import { CustomEase } from "gsap/CustomEase";

// Register the plugin
gsap.registerPlugin(CustomEase);

export class CropAction {
    constructor() {
        this.type = 'crop'
    }

    execute(pixiObject, actionData, options = {}) {
        const { values = {} } = actionData
        const duration = values.duration || 2000

        // Ensure a consistent ease for motion capture playback
        CustomEase.create("myEase", "0.5,0,0,1");
        const easing = "myEase"

        const startState = options.startState || {}

        // Ensure reactive properties exist on the object
        this._ensureReactiveCropProperties(pixiObject, startState)

        const animationDuration = duration / 1000

        // Resolve start and target position using relative system
        const startX = values.initialX ?? startState.x ?? pixiObject.x
        const startY = values.initialY ?? startState.y ?? pixiObject.y

        // STATE ISOLATION FIX: Use fromTo so each step starts from its own predicted state
        const fromVars = {
            cropX: values.initialCropX ?? startState.cropX ?? pixiObject.cropX,
            cropY: values.initialCropY ?? startState.cropY ?? pixiObject.cropY,
            cropWidth: values.initialCropWidth ?? startState.cropWidth ?? pixiObject.cropWidth,
            cropHeight: values.initialCropHeight ?? startState.cropHeight ?? pixiObject.cropHeight,
            mediaWidth: values.initialMediaWidth ?? startState.mediaWidth ?? pixiObject.mediaWidth,
            mediaHeight: values.initialMediaHeight ?? startState.mediaHeight ?? pixiObject.mediaHeight,
        }

        const toVars = {
            duration: animationDuration,
            ease: easing,
            cropX: values.cropX !== undefined ? values.cropX : fromVars.cropX,
            cropY: values.cropY !== undefined ? values.cropY : fromVars.cropY,
            cropWidth: values.cropWidth !== undefined ? values.cropWidth : fromVars.cropWidth,
            cropHeight: values.cropHeight !== undefined ? values.cropHeight : fromVars.cropHeight,
            mediaWidth: values.mediaWidth !== undefined ? values.mediaWidth : fromVars.mediaWidth,
            mediaHeight: values.mediaHeight !== undefined ? values.mediaHeight : fromVars.mediaHeight,
            immediateRender: false,
            overwrite: 'auto',
            ...options.gsapOptions
        }

        // Only explicitly animate x/y if a delta shift is provided AND NOT EXPLICITLY undefined.
        // If fromVars.x/y is included, even as `startX`, GSAP's overwrite: 'auto' will
        // kill any overlapping x/y tweens from MoveAction (like MotionPathPlugin curves)!
        if (values.dx !== undefined || values.dy !== undefined) {
            const hasShift = (values.dx !== 0 && values.dx !== undefined) || (values.dy !== 0 && values.dy !== undefined)
            if (hasShift) {
                fromVars.x = startX
                fromVars.y = startY
                toVars.x = startX + (values.dx || 0)
                toVars.y = startY + (values.dy || 0)
            }
        }

        return gsap.fromTo(pixiObject, fromVars, toVars)
    }

    /**
     * Define getters/setters for crop properties on the PIXI object
     * This ensures that ANY change to these values (GSAP, manual, etc.) 
     * immediately triggers a visual update.
     * 
     * @param {PIXI.Container} pixiObject 
     * @param {Object} initialState - Optional initial state to populate defaults
     */
    _ensureReactiveCropProperties(pixiObject, initialState = {}) {
        if (pixiObject._hasReactiveCropProperties) return

        const properties = ['cropX', 'cropY', 'cropWidth', 'cropHeight', 'mediaWidth', 'mediaHeight']

        properties.forEach(prop => {
            const privateProp = `_stored${prop.charAt(0).toUpperCase() + prop.slice(1)}` // e.g., _storedCropX

            // value initialization:
            // 1. Try existing private prop (persistence)
            // 2. Try initialState (prediction/context)
            // 3. Try object's current dimensions (smart default)
            // 4. Fallback to 0 or 100 (safe default)

            if (pixiObject[privateProp] === undefined) {
                // Determine sensible default based on current object state
                let smartDefault = 0
                if (prop === 'cropWidth') smartDefault = pixiObject.cropWidth ?? pixiObject.width ?? 100
                if (prop === 'cropHeight') smartDefault = pixiObject.cropHeight ?? pixiObject.height ?? 100
                if (prop === 'mediaWidth') smartDefault = pixiObject._mediaWidth ?? pixiObject._originalWidth ?? pixiObject.width ?? 100
                if (prop === 'mediaHeight') smartDefault = pixiObject._mediaHeight ?? pixiObject._originalHeight ?? pixiObject.height ?? 100

                // Allow initialState to override smart default
                const initialValue = initialState[prop]

                if (pixiObject[privateProp] === undefined) {
                    pixiObject[privateProp] = initialValue ?? smartDefault
                }
            }

            Object.defineProperty(pixiObject, prop, {
                get() {
                    return this[privateProp]
                },
                set(value) {
                    if (this[privateProp] !== value) {
                        this[privateProp] = value
                        // Call the update function directly on the object scope
                        // We attach the update function to the object so it can be called internally
                        if (this._updateCropVisuals) {
                            this._updateCropVisuals()
                        } else {
                            // Fallback if method not attached (shouldn't happen if we attach it below)
                            CropAction.updateVisuals(this)
                        }
                    }
                },
                configurable: true // Allow re-definition if hot-reloading
            })
        })

        // Attach the visual update function to the object
        pixiObject._updateCropVisuals = function () {
            CropAction.updateVisuals(this)
        }

        pixiObject._hasReactiveCropProperties = true

        // Immediate visual update to ensure state is reflected
        pixiObject._updateCropVisuals()
    }

    /**
     * Static helper to apply visual updates based on current state
     */
    static updateVisuals(pixiObject) {
        const sprite = pixiObject._imageSprite || pixiObject._videoSprite
        const cropMask = pixiObject._cropMask

        if (!sprite || !cropMask) return

        const mediaW = pixiObject.mediaWidth
        const mediaH = pixiObject.mediaHeight
        const cropX = pixiObject.cropX
        const cropY = pixiObject.cropY
        const cropW = pixiObject.cropWidth
        const cropH = pixiObject.cropHeight


        // Update sprite geometry
        if (Math.abs(sprite.width - mediaW) > 0.1) sprite.width = mediaW
        if (Math.abs(sprite.height - mediaH) > 0.1) sprite.height = mediaH

        // Offset sprite to align with top-left of container (0,0)
        // The container's (0,0) is the top-left of the CROP window.
        // So we shift the sprite so that the (cropX, cropY) point of the sprite is at (0,0).
        if (Math.abs(sprite.x - (-cropX)) > 0.1) sprite.x = -cropX
        if (Math.abs(sprite.y - (-cropY)) > 0.1) sprite.y = -cropY

        // Redraw crop mask
        // Optimizing: Only redraw if dimensions changed significantly
        // But clear/rect is cheap enough for now
        cropMask.clear()
        cropMask.rect(0, 0, cropW, cropH)
        cropMask.fill(0xffffff)

        // Update pivot to maintain anchor-based positioning (e.g. rotation center)
        const anchorX = pixiObject.anchorX ?? 0.5
        const anchorY = pixiObject.anchorY ?? 0.5
        pixiObject.pivot.set(cropW * anchorX, cropH * anchorY)
    }
}
