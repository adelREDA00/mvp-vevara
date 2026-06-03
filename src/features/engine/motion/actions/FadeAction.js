import { gsap } from 'gsap'
import { CustomEase } from "gsap/CustomEase";

// Register the plugin
gsap.registerPlugin(CustomEase);

export class FadeAction {
    constructor() {
        this.type = 'fade'
    }

    execute(pixiObject, actionData, options = {}) {
        const { values = {} } = actionData
        const duration = values.duration || 2000
        const easing = "myEase"

        const startOpacity = options.startState?.opacity ?? pixiObject.alpha
        const targetOpacity = values.opacity !== undefined ? values.opacity : 1

        const animationDuration = duration / 1000

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

        // [FIX] Only animate alpha if it's explicitly changing or provided
        if (values.opacity !== undefined) {
            fromVars.alpha = startOpacity
            toVars.alpha = targetOpacity
        } else {
            // If No opacity change, return a no-op to maintain duration
            return gsap.to({}, { duration: animationDuration })
        }

        const tl = gsap.timeline()
        tl.set(pixiObject, fromVars, 0)
        tl.to(pixiObject, toVars, 0)
        return tl
    }
}
