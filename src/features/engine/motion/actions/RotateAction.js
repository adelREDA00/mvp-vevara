import { gsap } from 'gsap'
import { CustomEase } from "gsap/CustomEase";

// Register the plugin
gsap.registerPlugin(CustomEase);
export class RotateAction {
    constructor() {
        this.type = 'rotate'
    }

    execute(pixiObject, actionData, options = {}) {
        const { values = {} } = actionData
        const duration = values.duration || 2000
        const easing = "myEase"

        const animationDuration = duration / 1000

        const startAngle = options.startState?.rotation ?? (pixiObject.rotation * 180 / Math.PI)
        const dangle = values.dangle ?? 0
        const targetAngle = startAngle + dangle

        const toVars = {
            duration: animationDuration,
            ease: easing,
            immediateRender: false,
            overwrite: false,
            ...options.gsapOptions,
        }

        const fromVars = {
            immediateRender: false
        }

        // [FIX] Only animate rotation if it's explicitly changing or provided
        if (values.dangle !== undefined && values.dangle !== 0) {
            fromVars.rotation = startAngle * (Math.PI / 180)
            toVars.rotation = targetAngle * (Math.PI / 180)
        } else {
            // Return no-op to maintain duration if no rotation
            return gsap.to({}, { duration: animationDuration })
        }

        const tl = gsap.timeline()
        tl.set(pixiObject, fromVars, 0)
        tl.to(pixiObject, toVars, 0)
        return tl
    }
}
