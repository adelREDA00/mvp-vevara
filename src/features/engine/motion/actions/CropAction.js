/**
 * CropAction - Handles crop animations for motion steps
 * Applies GSAP animations to media layer crop properties
 */

import * as PIXI from 'pixi.js'
import { gsap } from 'gsap'
import { CustomEase } from "gsap/CustomEase";
import { redrawFramePlaceholder } from '../../pixi/createLayer'

// Register the plugin
gsap.registerPlugin(CustomEase);

export class CropAction {
    constructor() {
        this.type = 'crop'
    }

    execute(pixiObject, actionData, options = {}) {
        // [ROCK SOLID FIX] Never attempt to crop a Text or Graphics layer.
        // Doing so overwrites their natural Pivot math and causes massive visual jumps.
        if (!pixiObject || pixiObject instanceof PIXI.Text || pixiObject instanceof PIXI.Graphics) {
            return null;
        }

        const { values = {} } = actionData
        const duration = values.duration || 2000

        // Ensure a consistent ease for motion capture playback
        CustomEase.create("myEase", "0.5,0,0,1");
        const easing = "myEase"

        const startState = options.startState || {}

        // Ensure reactive properties exist on the object
        this._ensureReactiveCropProperties(pixiObject, startState)

        const animationDuration = duration / 1000

        // Resolve start position using strictly relative/tracker system
        const startX = startState.x ?? pixiObject.x
        const startY = startState.y ?? pixiObject.y

        const toVars = {
            duration: animationDuration,
            ease: easing,
            immediateRender: false,
            overwrite: false,
            ...options.gsapOptions
        }

        const fromVars = {
            immediateRender: false
        }

        // [FIX] Explicitly animate ONLY properties that are changing.
        // This prevents overwriting other parallel actions in the same step.
        let hasChanges = false

        const cropProps = ['cropX', 'cropY', 'cropWidth', 'cropHeight', 'mediaWidth', 'mediaHeight']
        cropProps.forEach(prop => {
            if (values[prop] !== undefined) {
                // [FIX] CRITICAL: NEVER use values.initial... they are stale snapshots.
                // Always trust the startState from the MotionEngine tracker.
                fromVars[prop] = startState[prop] ?? pixiObject[prop]
                toVars[prop] = values[prop]
                hasChanges = true
            }
        })

        // Track x/y displacement
        if (values.dx !== undefined && values.dx !== 0) {
            fromVars.x = startX
            toVars.x = startX + values.dx
            hasChanges = true
        }
        if (values.dy !== undefined && values.dy !== 0) {
            fromVars.y = startY
            toVars.y = startY + values.dy
            hasChanges = true
        }

        // If no changes provided, return a no-op to maintain step duration
        if (!hasChanges) {
            return gsap.to({}, { duration: animationDuration })
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

        const mediaW = pixiObject.mediaWidth || pixiObject._storedMediaWidth || 100
        const mediaH = pixiObject.mediaHeight || pixiObject._storedMediaHeight || 100
        const cropX = pixiObject.cropX || 0
        const cropY = pixiObject.cropY || 0
        const cropW = pixiObject.cropWidth || 100
        const cropH = pixiObject.cropHeight || 100

        // [FIX] ALWAYS update pivot to maintain anchor-based positioning, 
        // EVEN IF the frame is currently empty (detaching an asset leaves 
        // the frame with crop math, requiring pivot shifts to match x/y compensation).
        const anchorX = pixiObject.anchorX !== undefined ? pixiObject.anchorX : 0.5
        const anchorY = pixiObject.anchorY !== undefined ? pixiObject.anchorY : 0.5

        pixiObject.pivot.set(cropW * anchorX, cropH * anchorY)

        // If an image asset is currently attached, shift internal coordinate geometries
        if (sprite && cropMask) {
          // Update sprite geometry
          if (Math.abs(sprite.width - mediaW) > 0.1) sprite.width = mediaW
          if (Math.abs(sprite.height - mediaH) > 0.1) sprite.height = mediaH

          // Offset sprite to align with top-left of container (0,0)
          if (Math.abs(sprite.x - (-cropX)) > 0.1) sprite.x = -cropX
          if (Math.abs(sprite.y - (-cropY)) > 0.1) sprite.y = -cropY

          // Redraw crop mask
          cropMask.clear()
          cropMask.rect(0, 0, cropW, cropH)
          cropMask.fill(0xffffff)
        }

        // [FIX] Update visibility and placeholders for frames during animation
        if (pixiObject._isFrame) {
            if (pixiObject._imageSprite) pixiObject._imageSprite.visible = !!pixiObject._frameHasAsset
            if (pixiObject._framePlaceholder) {
                pixiObject._framePlaceholder.visible = !pixiObject._frameHasAsset
                if (!pixiObject._frameHasAsset) {
                    redrawFramePlaceholder(pixiObject, cropW, cropH, pixiObject._frameData)
                }
            }
        }
    }
}
