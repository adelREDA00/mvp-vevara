import { gsap } from 'gsap'

export class FlipAction {
    constructor() {
        this.type = 'flip'
    }

    execute(pixiObject, actionData, options = {}) {
        const { values = {} } = actionData
        const duration = values.duration || 600
        const animationDuration = duration / 1000
        const halfDuration = animationDuration / 2

        const startScaleX = options.startState?.scaleX ?? pixiObject.scale.x
        // Use flipTargetScaleX when a ScaleAction in the same step changes scaleX
        const endScaleX = options.flipTargetScaleX ?? startScaleX

        // Determine which side is showing BEFORE this flip begins
        const wasShowingFront = options.startState?.showingFront !== false

        const tl = gsap.timeline({
            ...options.gsapOptions,
            onStart: () => { pixiObject._isFlipping = true },
            onComplete: () => { pixiObject._isFlipping = false },
            onReverseComplete: () => { pixiObject._isFlipping = false },
            onUpdate: () => {
                // Deterministic visibility: progress < 0.5 = original side, >= 0.5 = flipped side
                const progress = tl.progress()
                const nowShowingFront = progress < 0.5 ? wasShowingFront : !wasShowingFront

                // Update the reactive property. This automatically handles visibility
                // and sets the _showingFront flag used by the sync loop for persistence.
                if (pixiObject.showingFront !== nowShowingFront) {
                    pixiObject.showingFront = nowShowingFront
                }
            },
        })

        // Phase 1: scale X to 0 (card edge)
        tl.to(pixiObject.scale, {
            x: 0,
            duration: halfDuration,
            ease: 'power2.in',
            immediateRender: false,
            overwrite: false,
        })

        // Phase 2: scale X back to target
        tl.to(pixiObject.scale, {
            x: endScaleX,
            duration: halfDuration,
            ease: 'power2.out',
            immediateRender: false,
            overwrite: false,
        })

        return tl
    }
}
