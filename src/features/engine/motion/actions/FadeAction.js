import { gsap } from 'gsap'

export class FadeAction {
    constructor() {
        this.type = 'fade'
    }

    execute(pixiObject, actionData, options = {}) {
        const { values = {} } = actionData
        const duration = values.duration || 2000
        const easing = values.easing || 'power4.out'

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

        return gsap.fromTo(pixiObject, fromVars, toVars)
    }
}
