import { createSlice } from '@reduxjs/toolkit'

const initialState = {
  isPlaying: false,
  currentTimeMs: 0, // Time in milliseconds
  fps: 60,
  isLooping: false,
  playbackSpeed: 1.0, // 1x, 2x, 0.5x, etc.
}

const playbackSlice = createSlice({
  name: 'playback',
  initialState,
  reducers: {
    play: (state) => {
      state.isPlaying = true
    },
    
    pause: (state) => {
      state.isPlaying = false
    },
    
    togglePlayPause: (state) => {
      state.isPlaying = !state.isPlaying
    },
    
    seek: (state, action) => {
      const timeMs = action.payload
      state.currentTimeMs = Math.max(0, timeMs)
    },
    
    seekBySeconds: (state, action) => {
      const seconds = action.payload
      state.currentTimeMs = Math.max(0, seconds * 1000)
    },
    
    setFps: (state, action) => {
      state.fps = action.payload
    },
    
    setLooping: (state, action) => {
      state.isLooping = action.payload
    },
    
    setPlaybackSpeed: (state, action) => {
      state.playbackSpeed = action.payload
    },
    
    stepForward: (state) => {
      // Move forward by one frame
      const frameDurationMs = (1 / state.fps) * 1000
      state.currentTimeMs += frameDurationMs
    },
    
    stepBackward: (state) => {
      // Move backward by one frame
      const frameDurationMs = (1 / state.fps) * 1000
      state.currentTimeMs = Math.max(0, state.currentTimeMs - frameDurationMs)
    },
    
    reset: (state) => {
      state.currentTimeMs = 0
      state.isPlaying = false
    },
  },
})

export const {
  play,
  pause,
  togglePlayPause,
  seek,
  seekBySeconds,
  setFps,
  setLooping,
  setPlaybackSpeed,
  stepForward,
  stepBackward,
  reset,
} = playbackSlice.actions

// Selectors
export const selectIsPlaying = (state) => state.playback.isPlaying
export const selectCurrentTimeMs = (state) => state.playback.currentTimeMs
export const selectCurrentTimeSeconds = (state) => state.playback.currentTimeMs / 1000
export const selectFps = (state) => state.playback.fps
export const selectIsLooping = (state) => state.playback.isLooping
export const selectPlaybackSpeed = (state) => state.playback.playbackSpeed

export default playbackSlice.reducer

