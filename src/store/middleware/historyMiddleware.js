/**
 * Middleware to track canvas actions for undo/redo functionality
 * Only tracks canvas-related actions, not app-level actions like selection changes
 */

// List of canvas actions that should be tracked for undo/redo
const CANVAS_ACTIONS = [
  'project/updateLayer',
  'project/addLayer',
  'project/deleteLayer',
  'project/duplicateLayer',
  'project/reorderLayer',
  'project/bringLayerToFront',
  'project/sendLayerToBack',
  'project/updateScene', // For canvas background color changes
  'project/pasteLayers',
  'project/pasteScene',
]

// Actions that should NOT be tracked (app-level actions)
const EXCLUDED_ACTIONS = [
  'selection/setSelectedLayer',
  'selection/setSelectedLayers',
  'selection/addSelectedLayer',
  'selection/removeSelectedLayer',
  'selection/clearLayerSelection',
  'selection/setSelectedCanvas',
  'selection/setSelectedScene',
  'project/setCurrentScene', // Scene switching is not a canvas action
  'project/copyLayers', // Copying doesn't change canvas
  'project/copyScene', // Copying doesn't change canvas
  'project/restoreProjectState', // State restoration from undo/redo shouldn't be tracked
  'history/addToHistory', // Don't track history actions themselves
  'history/undo',
  'history/redo',
  'history/clearHistory',
]

// Debounce time for batching rapid updates (e.g., during drag)
const DEBOUNCE_MS = 100

let debounceTimer = null
let pendingState = null

/**
 * Creates a deep clone of the project state
 */
function cloneProjectState(state) {
  return {
    scenes: JSON.parse(JSON.stringify(state.project.scenes)),
    layers: JSON.parse(JSON.stringify(state.project.layers)),
    segmentsByLayer: JSON.parse(JSON.stringify(state.project.segmentsByLayer || {})),
    currentSceneId: state.project.currentSceneId,
  }
}

export const historyMiddleware = (store) => (next) => (action) => {
  const actionType = action.type

  // Handle undo/redo actions
  if (actionType === 'history/undo') {
    const state = store.getState()
    const historyState = state.history

    if (historyState.past.length === 0) {
      return next(action) // Nothing to undo
    }

    // Get the state to restore (from past, before updating history)
    const stateToRestore = historyState.past[historyState.past.length - 1]

    // Update history state first
    const historyResult = next(action)

    // Then restore project state
    if (stateToRestore) {
      store.dispatch({
        type: 'project/restoreProjectState',
        payload: stateToRestore,
      })
    }

    return historyResult
  }

  if (actionType === 'history/redo') {
    const state = store.getState()
    const historyState = state.history

    if (historyState.future.length === 0) {
      return next(action) // Nothing to redo
    }

    // Get the state to restore (from future, before updating history)
    const stateToRestore = historyState.future[0]

    // Update history state first
    const historyResult = next(action)

    // Then restore project state
    if (stateToRestore) {
      store.dispatch({
        type: 'project/restoreProjectState',
        payload: stateToRestore,
      })
    }

    return historyResult
  }

  // Check if this is a canvas action we should track
  const isCanvasAction = CANVAS_ACTIONS.includes(actionType)
  const isExcluded = EXCLUDED_ACTIONS.includes(actionType)

  // Only track canvas actions that aren't excluded
  if (isCanvasAction && !isExcluded) {
    // Get current state before the action
    const currentState = store.getState()
    const historyState = currentState.history

    // If this is the first canvas action and we don't have a present state,
    // save the current state as the initial state
    if (historyState.present === null) {
      const initialState = cloneProjectState(currentState)
      store.dispatch({
        type: 'history/addToHistory',
        payload: initialState,
      })
    }

    // Execute the action
    const result = next(action)

    // Get the new state after the action
    const newState = store.getState()

    // Debounce rapid updates (like during drag operations)
    // This prevents creating a history entry for every frame of a drag
    clearTimeout(debounceTimer)

    pendingState = cloneProjectState(newState)

    debounceTimer = setTimeout(() => {
      if (pendingState) {
        // Dispatch action to add to history
        store.dispatch({
          type: 'history/addToHistory',
          payload: pendingState,
        })
        pendingState = null
      }
    }, DEBOUNCE_MS)

    return result
  }

  // For non-canvas actions, just pass through
  return next(action)
}

