/**
 * curveUtils.js - Performance-optimized geometry utilities for curved paths.
 * Uses Catmull-Rom splines for smooth paths passing through control points.
 */

/**
 * Calculates a point on a Centripetal Catmull-Rom spline.
 * Centripetal version (alpha=0.5) is superior for motion design as it
 * avoids "loops" and "overshoots" common in uniform splines.
 * @param {Object} p0, p1, p2, p3 - Control points {x, y}
 * @param {number} t - Interpolation value (0 to 1) for the current segment (p1 to p2)
 * @returns {Object} - Resulting point {x, y}
 */
export function getCentripetalPoint(p0, p1, p2, p3, t) {
    const alpha = 0.5; // Centripetal parameter

    function getT(tPrev, pA, pB) {
        const dx = pB.x - pA.x;
        const dy = pB.y - pA.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        return tPrev + Math.pow(len, alpha);
    }

    const t0 = 0;
    const t1 = getT(t0, p0, p1);
    const t2 = getT(t1, p1, p2);
    const t3 = getT(t2, p2, p3);

    // Safety check to avoid division by zero
    if (t1 === t0 && t2 === t1) return p1;
    if (t2 === t1) return p1;
    if (t3 === t2 && t2 === t1) return p2;

    const currentTime = t1 + t * (t2 - t1);

    function a(pA, pB, tA, tB, time) {
        if (Math.abs(tB - tA) < 0.0001) return pA;
        const f = (tB - time) / (tB - tA);
        const g = (time - tA) / (tB - tA);
        return {
            x: pA.x * f + pB.x * g,
            y: pA.y * f + pB.y * g
        };
    }

    const a1 = a(p0, p1, t0, t1, currentTime);
    const a2 = a(p1, p2, t1, t2, currentTime);
    const a3 = a(p2, p3, t2, t3, currentTime);

    const b1 = a(a1, a2, t0, t2, currentTime);
    const b2 = a(a2, a3, t1, t3, currentTime);

    return a(b1, b2, t1, t2, currentTime);
}

/**
 * Legacy wrapper for backward compatibility or simple naming.
 * Now uses the superior Centripetal logic.
 */
export function getCatmullRomPoint(p0, p1, p2, p3, t) {
    return getCentripetalPoint(p0, p1, p2, p3, t);
}

/**
 * Generates a list of points representing a Centripetal Catmull-Rom spline.
 * @param {Array} points - Array of {x, y} points.
 * @param {number} segmentsPerLoop - Number of segments between each pair of control points.
 * @returns {Array} - Array of {x, y} points for rendering.
 */
export function getCatmullRomPath(points, segmentsPerLoop = 20) {
    if (points.length < 2) return points;

    // Filter out consecutive duplicate points
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

        // Virtual points for start/end to ensure the spline passes through all points
        const p0 = i === 0 ? { x: p1.x - (p2.x - p1.x), y: p1.y - (p2.y - p1.y) } : uniquePoints[i - 1];
        const p3 = i === n - 2 ? { x: p2.x + (p2.x - p1.x), y: p2.y + (p2.y - p1.y) } : uniquePoints[i + 2];

        // We use '<' instead of '<=' to avoid duplicating the join points
        for (let j = 0; j < segmentsPerLoop; j++) {
            const t = j / segmentsPerLoop;
            path.push(getCentripetalPoint(p0, p1, p2, p3, t));
        }
    }
    
    // Add the final endpoint explicitly
    path.push(uniquePoints[n - 1]);

    return path;
}

/**
 * Returns the midpoint of a segment on the spline for subdivision.
 */
export function getSegmentMidpoint(p1, p2, prev, next) {
    const p0 = prev || { x: p1.x - (p2.x - p1.x), y: p1.y - (p2.y - p1.y) };
    const p3 = next || { x: p2.x + (p2.x - p1.x), y: p2.y + (p2.y - p1.y) };
    return getCentripetalPoint(p0, p1, p2, p3, 0.5);
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
