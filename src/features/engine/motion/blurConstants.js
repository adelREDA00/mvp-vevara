/**
 * Shared blur limits, quality, and physical-strength computation for layer blur (PIXI BlurFilter).
 * - BLUR_MAX: max logical strength (0–BLUR_MAX). Lower = less GPU cost on low-end devices.
 * - BLUR_QUALITY: BlurFilter.quality (4 = smooth, consistent with BlurAction).
 * - computeBlurPhysicalStrength: converts logical blur → PIXI filter strength
 *   using the same world-scale × renderer-resolution formula used by the
 *   animated path (_applyAnimatedBlur).  This guarantees that the live slider
 *   drag, the static syncBlurFilter, and the animated/export path all produce
 *   identical visual results.
 */
export const BLUR_MAX = 10
export const BLUR_QUALITY = 4

/**
 * Convert a logical blur value (0–BLUR_MAX) into a PIXI BlurFilter physical
 * strength, applying world-scale and renderer-resolution multipliers so the
 * result is consistent with BlurAction._applyAnimatedBlur.
 *
 * @param {number} logicalBlur - logical blur (0–BLUR_MAX)
 * @param {PIXI.DisplayObject} [displayObject] - optional, used to read worldTransform
 * @param {object} [options] - { rendererRes } override (e.g. from BlurAction)
 * @returns {number} physical PIXI filter strength
 */
export function computeBlurPhysicalStrength(logicalBlur, displayObject = null, options = {}) {
  const clamped = Math.max(0, Math.min(Number(logicalBlur) || 0, BLUR_MAX))
  if (clamped === 0) return 0

  const worldScale = displayObject
    ? Math.abs(displayObject.worldTransform.a)
    : 1
  const rendererRes = options.rendererRes
    ?? displayObject?.renderer?.resolution
    ?? (typeof window !== 'undefined' && window.devicePixelRatio)
    ?? 1

  return clamped * worldScale * rendererRes
}