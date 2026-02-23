import { createSlice } from '@reduxjs/toolkit'

const initialState = {
  selectedSceneId: null,
  selectedLayerIds: [], // Support multi-select
  selectedCanvas: false, // Track if canvas is selected
}

const selectionSlice = createSlice({
  name: 'selection',
  initialState,
  reducers: {
    setSelectedScene: (state, action) => {
      state.selectedSceneId = action.payload
      // Clear layer selection when changing scenes
      state.selectedLayerIds = []
    },

    setSelectedLayer: (state, action) => {
      const layerId = action.payload
      if (layerId === null) {
        state.selectedLayerIds = []
      } else {
        state.selectedLayerIds = [layerId]
      }
      state.selectedCanvas = false
    },

    setSelectedLayers: (state, action) => {
      const layerIds = action.payload
      if (Array.isArray(layerIds)) {
        state.selectedLayerIds = layerIds
      } else {
        state.selectedLayerIds = []
      }
      state.selectedCanvas = false
    },

    setSelectedCanvas: (state, action) => {
      state.selectedCanvas = action.payload === true
      if (state.selectedCanvas) {
        state.selectedLayerIds = []
      }
    },

    addSelectedLayer: (state, action) => {
      const layerId = action.payload
      if (layerId && !state.selectedLayerIds.includes(layerId)) {
        state.selectedLayerIds.push(layerId)
      }
    },

    removeSelectedLayer: (state, action) => {
      const layerId = action.payload
      state.selectedLayerIds = state.selectedLayerIds.filter(id => id !== layerId)
    },

    clearLayerSelection: (state) => {
      state.selectedLayerIds = []
      state.selectedCanvas = false
    },

    clearSelection: (state) => {
      state.selectedSceneId = null
      state.selectedLayerIds = []
    },
  },
})

export const {
  setSelectedScene,
  setSelectedLayer,
  setSelectedLayers,
  addSelectedLayer,
  removeSelectedLayer,
  clearLayerSelection,
  clearSelection,
  setSelectedCanvas,
} = selectionSlice.actions

// Selectors
export const selectSelectedSceneId = (state) => state.selection.selectedSceneId
export const selectSelectedLayerIds = (state) => state.selection.selectedLayerIds
export const selectSelectedLayerId = (state) => state.selection.selectedLayerIds[0] || null
export const selectHasSelection = (state) => state.selection.selectedLayerIds.length > 0
export const selectSelectedCanvas = (state) => state.selection.selectedCanvas

export default selectionSlice.reducer

