/**
 * curveUtils.js - Performance-optimized geometry utilities for curved paths.
 * Uses Catmull-Rom splines for smooth paths passing through control points.
 */

/**
 * Calculates a point on a Catmull-Rom spline.
 * @param {Object} p0 - Point 0 {x, y}
 * @param {Object} p1 - Point 1 {x, y}
 * @param {Object} p2 - Point 2 {x, y}
 * @param {Object} p3 - Point 3 {x, y}
 * @param {number} t - Interpolation value (0 to 1)
 * @returns {Object} - Resulting point {x, y}
 */
export function getCatmullRomPoint(p0, p1, p2, p3, t) {
    const t2 = t * t;
    const t3 = t2 * t;

    const f0 = -0.5 * t3 + t2 - 0.5 * t;
    const f1 = 1.5 * t3 - 2.5 * t2 + 1.0;
    const f2 = -1.5 * t3 + 2.0 * t2 + 0.5 * t;
    const f3 = 0.5 * t3 - 0.5 * t2;

    return {
        x: p0.x * f0 + p1.x * f1 + p2.x * f2 + p3.x * f3,
        y: p0.y * f0 + p1.y * f1 + p2.y * f2 + p3.y * f3,
    };
}

/**
 * Generates a list of points representing a Catmull-Rom spline.
 * Optimized to minimize allocations by reusing objects if needed.
 * @param {Array} points - Array of {x, y} points.
 * @param {number} segmentsPerLoop - Number of segments between each pair of control points.
 * @returns {Array} - Array of {x, y} points for rendering.
 */
export function getCatmullRomPath(points, segmentsPerLoop = 6) {
    if (points.length < 2) return points;

    // [ROBUSTNESS] Filter out consecutive duplicate points to prevent 0-length segments
    // which cause math instability in Catmull-Rom calculations.
    const uniquePoints = [points[0]];
    for (let i = 1; i < points.length; i++) {
        const prev = points[i - 1];
        const curr = points[i];
        if (Math.abs(curr.x - prev.x) > 0.01 || Math.abs(curr.y - prev.y) > 0.01) {
            uniquePoints.push(curr);
        }
    }

    if (uniquePoints.length < 2) return uniquePoints;

    const path = [];
    const n = uniquePoints.length;

    for (let i = 0; i < n - 1; i++) {
        const p1 = uniquePoints[i];
        const p2 = uniquePoints[i + 1];

        // Virtual points for start/end
        const p0 = i === 0 ? { x: p1.x - (p2.x - p1.x), y: p1.y - (p2.y - p1.y) } : uniquePoints[i - 1];
        const p3 = i === n - 2 ? { x: p2.x + (p2.x - p1.x), y: p2.y + (p2.y - p1.y) } : uniquePoints[i + 2];

        for (let j = 0; j <= segmentsPerLoop; j++) {
            const t = j / segmentsPerLoop;
            path.push(getCatmullRomPoint(p0, p1, p2, p3, t));
        }
    }

    return path;
}

/**
 * Returns the midpoint of a segment on the spline for subdivision.
 * @param {Object} p1 - Start point
 * @param {Object} p2 - End point
 * @param {Object} prev - Previous point (or null)
 * @param {Object} next - Next point (or null)
 * @returns {Object} - Midpoint {x, y}
 */
export function getSegmentMidpoint(p1, p2, prev, next) {
    const p0 = prev || { x: p1.x - (p2.x - p1.x), y: p1.y - (p2.y - p1.y) };
    const p3 = next || { x: p2.x + (p2.x - p1.x), y: p2.y + (p2.y - p1.y) };
    return getCatmullRomPoint(p0, p1, p2, p3, 0.5);
}

/**
 * Calculates distance between two points.
 * [PERFORMANCE] Optimized to avoid Math.pow overhead
 */
export function getDistance(p1, p2) {
    const dx = p2.x - p1.x
    const dy = p2.y - p1.y
    return Math.sqrt(dx * dx + dy * dy)
}

/**
 * Calculates squared distance between two points (faster, no sqrt).
 * Use this when comparing distances (e.g., threshold checks).
 */
export function getDistanceSquared(p1, p2) {
    const dx = p2.x - p1.x
    const dy = p2.y - p1.y
    return dx * dx + dy * dy
}
