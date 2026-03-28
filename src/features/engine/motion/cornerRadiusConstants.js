/**
 * Shared corner radius limits for shape layers.
 * - CORNER_RADIUS_MAX: slider upper bound. Actual render-time clamping
 *   to min(width, height)/2 happens in drawShapePath.
 */
export const CORNER_RADIUS_MAX = 200
