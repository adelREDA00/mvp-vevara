/**
 * Generate a unique ID
 * @returns {string}
 */
export function uid() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

