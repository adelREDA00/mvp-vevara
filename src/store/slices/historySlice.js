import { createSlice } from '@reduxjs/toolkit'

const initialState = {
  past: [], // Array of past states (for undo)
  present: null, // Current state snapshot
  future: [], // Array of future states (for redo)
  maxHistorySize: 50, // Maximum number of history entries
}

const historySlice = createSlice({
  name: 'history',
  initialState,
  reducers: {
    // Add a new state to history (called by middleware)
    addToHistory: (state, action) => {
      const newState = action.payload
      
      // If we have a present state, move it to past
      if (state.present !== null) {
        state.past.push(state.present)
        
        // Limit history size
        if (state.past.length > state.maxHistorySize) {
          state.past.shift() // Remove oldest entry
        }
      }
      
      // Set new state as present
      state.present = newState
      
      // Clear future when new action is performed
      state.future = []
    },
    
    // Undo: move present to future, move last past to present
    undo: (state) => {
      if (state.past.length === 0) {
        return // Nothing to undo
      }
      
      // Move current present to future
      if (state.present !== null) {
        state.future.unshift(state.present)
      }
      
      // Move last past to present
      state.present = state.past.pop()
    },
    
    // Redo: move present to past, move first future to present
    redo: (state) => {
      if (state.future.length === 0) {
        return // Nothing to redo
      }
      
      // Move current present to past
      if (state.present !== null) {
        state.past.push(state.present)
      }
      
      // Move first future to present
      state.present = state.future.shift()
    },
    
    // Clear history
    clearHistory: (state) => {
      state.past = []
      state.present = null
      state.future = []
    },
  },
})

export const { addToHistory, undo, redo, clearHistory } = historySlice.actions

// Selectors
export const selectCanUndo = (state) => state.history.past.length > 0
export const selectCanRedo = (state) => state.history.future.length > 0

export default historySlice.reducer

