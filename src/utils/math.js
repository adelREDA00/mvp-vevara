/**
 * Linear interpolation
 * @param {number} a
 * @param {number} b
 * @param {number} t
 * @returns {number}
 */
export function lerp(a, b, t) {
  return a + (b - a) * t
}

/**
 * Round to specified decimal places
 * @param {number} value
 * @param {number} decimals
 * @returns {number}
 */
export function round(value, decimals = 2) {
  return Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals)
}

/**
 * Check if two numbers are approximately equal within a given epsilon
 * @param {number} a - First number
 * @param {number} b - Second number
 * @param {number} epsilon - Maximum difference to consider equal (default: 0.01)
 * @returns {boolean}
 */
export function isApproximatelyEqual(a, b, epsilon = 0.01) {
  return Math.abs(a - b) < epsilon
}

