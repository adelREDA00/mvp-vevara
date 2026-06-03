import { gsap } from 'gsap'

/**
 * TypewriterAction - Animates text character by character.
 * Also handles opacity fade-in to match the reveal effect.
 */
export class TypewriterAction {
    constructor() {
        this.type = 'typewriter'
    }

    execute(pixiObject, actionData, options = {}) {
        const { values = {} } = actionData
        const duration = values.duration || 2000
        const easing = values.easing || 'none' // Character reveal usually feels best linear or with a subtle ease

        // [FIX] Force startReveal to 0 to ensure the typing effect starts from the beginning.
        // The default "predicted" state is often 1, which was causing the text to be fully visible immediately.
        const startReveal = 0
        const targetReveal = 1

        const animationDuration = duration / 1000

        const toVars = {
            duration: animationDuration,
            ease: easing,
            immediateRender: false,
            overwrite: false,
            // Custom property that FlowTextContainer and Text layer will handle via getter/setter
            revealProgress: targetReveal,
            ...options.gsapOptions
        }

        const fromVars = {
            revealProgress: startReveal,
            immediateRender: false
        }

        console.log(`[DEBUG] TypewriterAction.execute for ${pixiObject.label || 'unknown'}`, { 
            animationDuration, 
            startReveal, 
            targetReveal
        })

        const tl = gsap.timeline()
        tl.set(pixiObject, fromVars, 0)
        tl.to(pixiObject, toVars, 0)
        return tl
    }
}
