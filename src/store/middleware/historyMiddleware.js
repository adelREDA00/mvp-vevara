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
  // Motion flow actions (MotionCaptureMode & MotionPanel)
  'project/addSceneMotionStep',
  'project/deleteSceneMotionStep',
  'project/addSceneMotionAction',
  'project/updateSceneMotionAction',
  'project/deleteSceneMotionAction',
  'project/updateStepTiming',
  'project/duplicateSceneMotionStep',
  'project/reorderSceneMotionSteps',
  'project/updateSceneMotionStep',
  'project/clearSceneMotionFlow',
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
  'history/flushPending', // Internal: flush debounced state
]

// Debounce time for batching rapid updates (e.g., during drag)
const DEBOUNCE_MS = 100

let debounceTimer = null
let pendingState = null
let hasPendingDragChanges = false


/**
 * Creates a deep clone of the project state
 */
function cloneProjectState(state) {
  return {
    scenes: JSON.parse(JSON.stringify(state.project.scenes)),
    layers: JSON.parse(JSON.stringify(state.project.layers)),
    sceneMotionFlows: JSON.parse(JSON.stringify(state.project.sceneMotionFlows || {})),
    segmentsByLayer: JSON.parse(JSON.stringify(state.project.segmentsByLayer || {})),
    currentSceneId: state.project.currentSceneId,
  }
}

/**
 * Flush any pending debounced state into history immediately.
 * Must be called before undo/redo to ensure the history stack is complete.
 */
function flushPendingState(store) {
  if (pendingState) {
    clearTimeout(debounceTimer)
    store.dispatch({
      type: 'history/addToHistory',
      payload: pendingState,
    })
    pendingState = null
    debounceTimer = null
  }
}

export const historyMiddleware = (store) => (next) => (action) => {
  const actionType = action.type

  // Handle timeline dragging finish to commit the final state to history
  if (actionType === 'project/setTimelineDragging') {
    const result = next(action)
    if (action.payload === false && hasPendingDragChanges) {
      const newState = store.getState()
      const finalState = cloneProjectState(newState)
      store.dispatch({
        type: 'history/addToHistory',
        payload: finalState,
      })
      hasPendingDragChanges = false
    }
    return result
  }

  // Handle canvas interacting finish to commit the final state to history
  if (actionType === 'project/setCanvasInteracting') {
    const result = next(action)
    if (action.payload === false && hasPendingDragChanges) {
      const newState = store.getState()
      const finalState = cloneProjectState(newState)
      store.dispatch({
        type: 'history/addToHistory',
        payload: finalState,
      })
      hasPendingDragChanges = false
    }
    return result
  }

  // Flush pending debounced state on demand (used by handleApplyMotion before exiting capture)
  if (actionType === 'history/flushPending') {
    flushPendingState(store)
    return
  }

  // Handle undo/redo actions
  if (actionType === 'history/undo') {
    // Flush pending state BEFORE undo so the history stack is complete
    flushPendingState(store)

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
    // Flush pending state BEFORE redo so the history stack is complete
    flushPendingState(store)

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

    // Skip cloning and history recording during active timeline dragging/resizing or canvas interaction
    if (currentState.project?.isTimelineDragging || currentState.project?.isCanvasInteracting) {
      hasPendingDragChanges = true
      return result
    }

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

