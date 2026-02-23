import { configureStore } from '@reduxjs/toolkit'
import projectReducer from './slices/projectSlice'
import selectionReducer from './slices/selectionSlice'
import playbackReducer from './slices/playbackSlice'
import historyReducer from './slices/historySlice'
import uploadsReducer from './slices/uploadsSlice'
import { historyMiddleware } from './middleware/historyMiddleware'

export const store = configureStore({
  reducer: {
    project: projectReducer,
    selection: selectionReducer,
    playback: playbackReducer,
    history: historyReducer,
    uploads: uploadsReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        // Ignore these action types for serialization check
        ignoredActions: ['history/addToHistory'],
      },
    }).concat(historyMiddleware),
  devTools: process.env.NODE_ENV !== 'production',
})

// Expose store to window for testing in console (development only)
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  window.__VEVARA_STORE__ = store
}

