import { gsap } from 'gsap'

export class HoldAction {
    constructor() {
        this.type = 'hold'
    }

    execute(pixiObject, actionData, options = {}) {
        const { values = {} } = actionData
        const duration = values.duration || 2000

        const animationDuration = duration / 1000

        // For hold, we just create a delay using GSAP
        return gsap.to(pixiObject, {
            duration: animationDuration,
            immediateRender: false,
            ...options.gsapOptions,
        })
    }
}
