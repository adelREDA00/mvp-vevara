import { gsap } from 'gsap'

export class FadeAction {
    constructor() {
        this.type = 'fade'
    }

    execute(pixiObject, actionData, options = {}) {
        const { values = {} } = actionData
        const opacity = values.opacity !== undefined ? values.opacity : 1
        const duration = values.duration || 2000
        const easing = values.easing || 'linear'

        const animationDuration = duration / 1000

        return gsap.to(pixiObject, {
            alpha: opacity, // PIXI uses alpha for opacity
            duration: animationDuration,
            ease: easing,
            immediateRender: false,
            ...options.gsapOptions,
        })
    }
}
