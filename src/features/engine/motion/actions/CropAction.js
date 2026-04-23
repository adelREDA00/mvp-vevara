/**
 * CropAction - Handles crop animations for motion steps
 * Applies GSAP animations to media layer crop properties
 */

import * as PIXI from 'pixi.js'
import { gsap } from 'gsap'
import { CustomEase } from "gsap/CustomEase";
import { redrawFramePlaceholder } from '../../pixi/createLayer'
import { markTiltTextureDirty, syncTiltMesh } from '../../pixi/perspectiveTilt'

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
        // [GSAP FIX] MotionEngine.registerLayerObject now initializes these properties.
        // We only need to ensure the _updateCropVisuals method is attached so the 
        // centralized setters in MotionEngine can trigger it.
        
        if (!pixiObject._updateCropVisuals) {
            pixiObject._updateCropVisuals = function () {
                CropAction.updateVisuals(this)
            }
        }

        if (pixiObject._hasReactiveCropProperties) return

        const properties = ['cropX', 'cropY', 'cropWidth', 'cropHeight', 'mediaWidth', 'mediaHeight']

        properties.forEach(prop => {
            const privateProp = `_${prop}`

            // If MotionEngine already initialized it, we don't need to do much here
            // but we ensure the initial value is correct if provided.
            if (initialState[prop] !== undefined) {
                pixiObject[privateProp] = initialState[prop]
            } else if (pixiObject[privateProp] === undefined) {
                // Fallback initialization if for some reason MotionEngine didn't do it
                let smartDefault = 0
                if (prop === 'cropWidth') smartDefault = pixiObject.width ?? 100
                if (prop === 'cropHeight') smartDefault = pixiObject.height ?? 100
                if (prop === 'mediaWidth') smartDefault = pixiObject._mediaWidth ?? pixiObject._originalWidth ?? pixiObject.width ?? 100
                if (prop === 'mediaHeight') smartDefault = pixiObject._mediaHeight ?? pixiObject._originalHeight ?? pixiObject.height ?? 100
                
                pixiObject[privateProp] = smartDefault
            }

            // If the public property doesn't exist yet, define it (though MotionEngine should have)
            if (pixiObject[prop] === undefined || Object.getOwnPropertyDescriptor(pixiObject, prop)?.configurable) {
                Object.defineProperty(pixiObject, prop, {
                    get() { return this[privateProp] },
                    set(value) {
                        if (this[privateProp] !== value) {
                            this[privateProp] = value
                            this._updateCropVisuals()
                        }
                    },
                    configurable: true
                })
            }
        })

        pixiObject._hasReactiveCropProperties = true
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

        // Guard pivot update to avoid micro-jitter from floating-point rounding during GSAP interpolation
        const newPivotX = cropW * anchorX
        const newPivotY = cropH * anchorY
        if (Math.abs(pixiObject.pivot.x - newPivotX) > 0.1 || Math.abs(pixiObject.pivot.y - newPivotY) > 0.1) {
            pixiObject.pivot.set(newPivotX, newPivotY)
        }

        // If an image asset is currently attached, shift internal coordinate geometries
        if (sprite && cropMask) {
          // Update front sprite geometry
          if (Math.abs(sprite.width - mediaW) > 0.1) sprite.width = mediaW
          if (Math.abs(sprite.height - mediaH) > 0.1) sprite.height = mediaH

          // Offset sprite to align with top-left of container (0,0)
          if (Math.abs(sprite.x - (-cropX)) > 0.1) sprite.x = -cropX
          if (Math.abs(sprite.y - (-cropY)) > 0.1) sprite.y = -cropY

          // Also update back sprite for card frames (keeps crop in sync on both sides)
          // Use back-specific cover-fit dimensions when available (different aspect ratio)
          const backSprite = pixiObject._backSprite
          if (backSprite) {
              const bMediaW = pixiObject._backMediaWidth ?? mediaW
              const bMediaH = pixiObject._backMediaHeight ?? mediaH
              const bCropX = pixiObject._backCropX ?? cropX
              const bCropY = pixiObject._backCropY ?? cropY
              if (Math.abs(backSprite.width - bMediaW) > 0.1) backSprite.width = bMediaW
              if (Math.abs(backSprite.height - bMediaH) > 0.1) backSprite.height = bMediaH
              if (Math.abs(backSprite.x - (-bCropX)) > 0.1) backSprite.x = -bCropX
              if (Math.abs(backSprite.y - (-bCropY)) > 0.1) backSprite.y = -bCropY
          }

          // Redraw crop mask
          cropMask.clear()
          cropMask.rect(0, 0, cropW, cropH)
          cropMask.fill(0xffffff)
        }

        // Keep perspective-tilt stamps in sync so captureToTexture sizes the
        // RTT to the current crop — otherwise the mesh keeps its last-captured
        // dimensions and a crop animation appears as a pure translation.
        pixiObject._storedCropWidth = cropW
        pixiObject._storedCropHeight = cropH

        if (pixiObject._tiltMesh && !pixiObject._tiltMesh.destroyed) {
            markTiltTextureDirty(pixiObject)
            syncTiltMesh(pixiObject, null)
        }
    }
}
