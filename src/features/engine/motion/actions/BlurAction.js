import { gsap } from 'gsap'
import { CustomEase } from "gsap/CustomEase";
import * as PIXI from 'pixi.js'
import { BLUR_MAX, BLUR_QUALITY } from '../blurConstants.js'

// Register the plugin
gsap.registerPlugin(CustomEase);

function clampBlur(v) {
  return Math.max(0, Math.min(Number(v) || 0, BLUR_MAX))
}

export class BlurAction {
    constructor() {
        this.type = 'blur'
    }

    execute(pixiObject, actionData, options = {}) {
        const { values = {} } = actionData
        const duration = (values.duration || 2000) / 1000
        const easing = "myEase"

        // [EXPORT SYNC] Cache export scale for the applier
        const exportScale = options.exportScale || 1
        pixiObject._blurExportScale = exportScale

        const startBlur = clampBlur(options.startState?.blur ?? (pixiObject._blurFilter ? pixiObject._blurLogicalStrength : 0))
        const targetBlur = clampBlur(values.blur !== undefined ? values.blur : 0)

        // Initial setup for the applier
        pixiObject._blurLogicalStrength = startBlur

        const quality = 4 // Boost quality everywhere for consistency and premium look

        // Ensure filter exists for animation if there is any blur
        if (!pixiObject._blurFilter && (startBlur > 0 || targetBlur > 0)) {
            pixiObject._blurFilter = new PIXI.BlurFilter({ strength: 0, quality: quality })
            // Only eagerly append to filters if the start blur is actually greater than 0
            if (startBlur > 0) {
                pixiObject.filters = pixiObject.filters ? [...pixiObject.filters, pixiObject._blurFilter] : [pixiObject._blurFilter]
            }
        }

        if (!pixiObject._blurFilter) {
            return gsap.to({}, { duration })
        }

        // [EXPORT FIX] Manual sync for rapid seeking (e.g. video export)
        // This applier calculates the physical filter strength live from logical world units.
        pixiObject._applyAnimatedBlur = () => {
            if (pixiObject.destroyed) return;
            const filter = pixiObject._blurFilter;
            if (!filter) return;

            const logicalStrength = pixiObject._blurLogicalStrength || 0;
            
            if (logicalStrength > 0) {
                // [PERFORMANCE] Calculate physical scale factor including viewport and resolution.
                const worldScale = Math.abs(pixiObject.worldTransform.a);
                const rendererRes = pixiObject.renderer?.resolution || window.devicePixelRatio || 1;
                
                const physicalScale = options.isExport ? pixiObject._blurExportScale : (worldScale * rendererRes);
                const targetPhysicalStrength = logicalStrength * physicalScale;

                if (Math.abs(filter.strength - targetPhysicalStrength) > 0.05) {
                    filter.strength = targetPhysicalStrength;
                }

                if (!pixiObject.filters || !pixiObject.filters.includes(filter)) {
                    pixiObject.filters = pixiObject.filters ? [...pixiObject.filters, filter] : [filter];
                }
            } else {
                if (filter.strength !== 0) filter.strength = 0;
                if (pixiObject.filters && pixiObject.filters.includes(filter)) {
                    pixiObject.filters = pixiObject.filters.filter(f => f !== filter);
                    if (pixiObject.filters.length === 0) pixiObject.filters = null;
                }
            }
        };

        // Initialize state
        pixiObject._applyAnimatedBlur();

        const toVars = {
            duration: duration,
            ease: easing,
            immediateRender: false,
            overwrite: false,
            onUpdate: () => {
                if (pixiObject._applyAnimatedBlur) pixiObject._applyAnimatedBlur();
            },
            onComplete: () => {
                if (pixiObject._applyAnimatedBlur) pixiObject._applyAnimatedBlur();
            },
            ...options.gsapOptions
        }

        const fromVars = {
            immediateRender: false
        }

        // [FIX] Only animate blur if it's explicitly changing or provided
        if (values.blur !== undefined) {
            fromVars._blurLogicalStrength = startBlur
            toVars._blurLogicalStrength = targetBlur
        } else {
            // Return no-op to maintain duration if no blur
            return gsap.to({}, { duration })
        }

        const tl = gsap.timeline()
        tl.set(pixiObject, fromVars, 0)
        tl.to(pixiObject, toVars, 0)
        return tl
    }
}
