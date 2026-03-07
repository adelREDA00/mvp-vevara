/**
 * Motion Engine - Main exports for the motion animation system
 * Provides the core animation engine for layer motion flows
 */

import { MotionEngine } from './MotionEngine.js'

export { MotionTimeline } from './MotionTimeline.js'

// Action exports
export * from './actions/index.js'

// Type exports
export * from './types/actionTypes.js'


// Convenience function to create a singleton MotionEngine so all editor uses the same motion brain and this avoids conflicts with multiple motion engines and also good for perfermance
let globalMotionEngine = null
export function getGlobalMotionEngine() {
  if (!globalMotionEngine) {
    globalMotionEngine = new MotionEngine()
  }
  return globalMotionEngine
}

export function resetGlobalMotionEngine() {
  if (globalMotionEngine) {
    globalMotionEngine.reset()
    globalMotionEngine = null // Force recreation on next use
  }
}

