/**
 * Check if WebCodecs API is available
 * @returns {boolean}
 */
export function hasWebCodecs() {
  return typeof window !== 'undefined' && 'VideoEncoder' in window
}

/**
 * Check if MediaRecorder API is available
 * @returns {boolean}
 */
export function hasMediaRecorder() {
  return typeof window !== 'undefined' && 'MediaRecorder' in window
}

