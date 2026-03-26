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

                const frontSprite = pixiObject._imageSprite
                const backSprite = pixiObject._backSprite
                if (frontSprite && backSprite) {
                    frontSprite.visible = nowShowingFront && pixiObject._frameHasAsset
                    backSprite.visible = !nowShowingFront && pixiObject._frameHasBackAsset
                    if (pixiObject._framePlaceholder) {
                        const activeHasAsset = nowShowingFront
                            ? pixiObject._frameHasAsset
                            : pixiObject._frameHasBackAsset
                        pixiObject._framePlaceholder.visible = !activeHasAsset
                        // Update placeholder label ("Front"/"Back") for empty card frames
                        if (!activeHasAsset && pixiObject._frameLabel) {
                            const customLabel = (pixiObject._frameData?.label || '').trim()
                            if (!customLabel) {
                                pixiObject._frameLabel.text = nowShowingFront ? 'Front' : 'Back'
                            }
                        }
                    }
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
