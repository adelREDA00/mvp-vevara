/**
 * ScaleAction - Handles scale animations for motion steps
 * Applies GSAP animations to PIXI DisplayObjects for scale changes
 */

import * as PIXI from 'pixi.js'
import { gsap } from 'gsap'
import { CustomEase } from "gsap/CustomEase";

// Register the plugin
gsap.registerPlugin(CustomEase);

export class ScaleAction {
    constructor() {
        this.type = 'scale'
    }

    /**
     * Execute a scale action on a PIXI DisplayObject
     * @param {PIXI.DisplayObject} pixiObject - The PIXI object to animate
     * @param {Object} actionData - Motion action data from Redux
     * @param {Object} options - Animation options
     * @returns {Promise} - Resolves when animation completes
     */
    execute(pixiObject, actionData, options = {}) {
        const { values = {} } = actionData
        const duration = values.duration || 2000
        CustomEase.create("myEase", "0.5,0,0,1");

        const easing = "myEase"


        // Pure relative system: target = start * offset
        const startX = options.startState?.scaleX ?? pixiObject.scale.x
        const startY = options.startState?.scaleY ?? pixiObject.scale.y

        const dsx = values.dsx ?? 1
        const dsy = values.dsy ?? 1

        const targetX = startX * dsx
        const targetY = startY * dsy

        const animationDuration = (duration || 2000) / 1000 // Convert ms to seconds

        // Resolve easing function
        const gsapEasing = easing || 'none'

        // Build GSAP vars object dynamically to only include changed properties.
        const gsapVars = {
            duration: animationDuration,
            ease: gsapEasing,
            immediateRender: false,
            overwrite: false,
            ...options.gsapOptions
        }

        // Detect PIXI.Text and boost resolution adaptively based on target scale
        if (pixiObject instanceof PIXI.Text || (pixiObject.children && pixiObject.children.find(c => c instanceof PIXI.Text))) {
            const textObj = pixiObject instanceof PIXI.Text ? pixiObject : pixiObject.children.find(c => c instanceof PIXI.Text)

            // ADAPTIVE RESOLUTION: Calculate target resolution based on maximum scale
            // [EXPORT FIX] Account for global exportScale (targetWidth/worldWidth)
            const exportScale = options.exportScale || 1
            const maxTargetScale = Math.max(targetX, targetY) * exportScale

            // Adaptive resolution: base (4.0) * scale factor, capped at 8.0 for performance
            // Only boost if scaling up significantly (> 1.5x)
            if (maxTargetScale > 1.5) {
                const targetResolution = Math.min(8, Math.max(4, 4 * maxTargetScale))

                const currentRes = textObj.resolution || 1
                if (currentRes < targetResolution) {
                    textObj.resolution = targetResolution
                    textObj.updateText?.(true)
                }
            }
        }

        const fromVars = {
            immediateRender: false
        }

        // [FIX] Only explicitly animate scale if it's changing (dsx/dsy != 1)
        // When a FlipAction co-exists in the same step, skip scale.x (flip owns it)
        if (Math.abs(dsx - 1) > 0.001 && !options.skipScaleX) {
            fromVars.x = startX
            gsapVars.x = targetX
        }
        if (Math.abs(dsy - 1) > 0.001) {
            fromVars.y = startY
            gsapVars.y = targetY
        }

        return gsap.fromTo(pixiObject.scale, fromVars, gsapVars)
    }




}
