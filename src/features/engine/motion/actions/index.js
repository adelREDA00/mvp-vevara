/**
 * Action handlers index - Exports all motion action classes
 * Central registry for action types and their handlers
 */

export { MoveAction } from './MoveAction.js'
export { ScaleAction } from './ScaleAction.js'
export { RotateAction } from './RotateAction.js'
export { FadeAction } from './FadeAction.js'
export { HoldAction } from './HoldAction.js'
export { CropAction } from './CropAction.js'

import { MoveAction } from './MoveAction.js'
import { ScaleAction } from './ScaleAction.js'
import { RotateAction } from './RotateAction.js'
import { FadeAction } from './FadeAction.js'
import { HoldAction } from './HoldAction.js'
import { CropAction } from './CropAction.js'
import { ACTION_TYPES } from '../types/actionTypes.js'

/**
 * Registry mapping action types to their handler classes
 */
export const ACTION_HANDLERS = {
  [ACTION_TYPES.MOVE]: MoveAction,
  [ACTION_TYPES.SCALE]: ScaleAction,
  [ACTION_TYPES.ROTATE]: RotateAction,
  [ACTION_TYPES.FADE]: FadeAction,
  [ACTION_TYPES.CROP]: CropAction,
  [ACTION_TYPES.HOLD]: HoldAction,
}

/**
 * Get action handler instance for a given action type
 * @param {string} actionType - The action type (e.g., 'move', 'scale')
 * @returns {Object|null} - Action handler instance or null if not found
 */
export function getActionHandler(actionType) {
  const HandlerClass = ACTION_HANDLERS[actionType]
  return HandlerClass ? new HandlerClass() : null
}

/**
 * Get all available action types
 * @returns {string[]} - Array of available action type strings
 */
export function getAvailableActionTypes() {
  return Object.values(ACTION_TYPES)
}
