/**
 * Convert milliseconds to frames
 * @param {number} ms
 * @param {number} fps
 * @returns {number}
 */
export function msToFrames(ms, fps = 60) {
  return Math.floor((ms / 1000) * fps)
}

/**
 * Convert frames to milliseconds
 * @param {number} frames
 * @param {number} fps
 * @returns {number}
 */
export function framesToMs(frames, fps = 60) {
  return (frames / fps) * 1000
}

/**
 * Clamp a value between min and max
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

