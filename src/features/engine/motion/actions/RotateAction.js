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
        CustomEase.create("myEase", "0.5,0,0,1");

        const easing = "myEase"

        const animationDuration = duration / 1000

        const startAngle = options.startState?.rotation ?? (pixiObject.rotation * 180 / Math.PI)
        const dangle = values.dangle ?? 0
        const targetAngle = startAngle + dangle

        const fromVars = {
            rotation: startAngle * (Math.PI / 180),
            immediateRender: false
        }

        return gsap.fromTo(pixiObject, fromVars, {
            rotation: targetAngle * (Math.PI / 180), // Convert degrees to radians
            duration: animationDuration,
            ease: easing,
            immediateRender: false,
            overwrite: 'auto',
            ...options.gsapOptions,
        })
    }
}
