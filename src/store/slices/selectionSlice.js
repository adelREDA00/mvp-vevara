import { createSlice } from '@reduxjs/toolkit'

const initialState = {
  selectedSceneId: null,
  selectedLayerIds: [], // Support multi-select
  selectedCanvas: false, // Track if canvas is selected
  selectedActionType: null, // Track specific selected action type (e.g. 'move', 'scale')
  selectedActionStepId: null, // Track specific step of the selected action
}

const selectionSlice = createSlice({
  name: 'selection',
  initialState,
  reducers: {
    setSelectedScene: (state, action) => {
      state.selectedSceneId = action.payload
      // Clear layer selection when changing scenes
      state.selectedLayerIds = []
      state.selectedActionType = null
      state.selectedActionStepId = null
    },

    setSelectedLayer: (state, action) => {
      const layerId = action.payload
      if (layerId === null) {
        state.selectedLayerIds = []
      } else {
        state.selectedLayerIds = [layerId]
      }
      state.selectedCanvas = false
      state.selectedActionType = null
      state.selectedActionStepId = null
    },

    setSelectedLayers: (state, action) => {
      const layerIds = action.payload
      if (Array.isArray(layerIds)) {
        state.selectedLayerIds = layerIds
      } else {
        state.selectedLayerIds = []
      }
      state.selectedCanvas = false
      state.selectedActionType = null
      state.selectedActionStepId = null
    },

    setSelectedCanvas: (state, action) => {
      state.selectedCanvas = action.payload === true
      if (state.selectedCanvas) {
        state.selectedLayerIds = []
      }
      state.selectedActionType = null
      state.selectedActionStepId = null
    },

    setSelectedAction: (state, action) => {
      const { layerId, actionType, stepId } = action.payload || {}
      if (layerId === null || layerId === undefined) {
        state.selectedLayerIds = []
      } else {
        state.selectedLayerIds = [layerId]
      }
      state.selectedActionType = actionType || null
      state.selectedActionStepId = stepId || null
      state.selectedCanvas = false
    },

    addSelectedLayer: (state, action) => {
      const layerId = action.payload
      if (layerId && !state.selectedLayerIds.includes(layerId)) {
        state.selectedLayerIds.push(layerId)
      }
      state.selectedActionType = null
      state.selectedActionStepId = null
    },

    removeSelectedLayer: (state, action) => {
      const layerId = action.payload
      state.selectedLayerIds = state.selectedLayerIds.filter(id => id !== layerId)
      state.selectedActionType = null
      state.selectedActionStepId = null
    },

    clearLayerSelection: (state) => {
      state.selectedLayerIds = []
      state.selectedCanvas = false
      state.selectedActionType = null
      state.selectedActionStepId = null
    },

    clearSelection: (state) => {
      state.selectedSceneId = null
      state.selectedLayerIds = []
      state.selectedActionType = null
      state.selectedActionStepId = null
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
  setSelectedAction,
} = selectionSlice.actions

// Selectors
export const selectSelectedSceneId = (state) => state.selection.selectedSceneId
export const selectSelectedLayerIds = (state) => state.selection.selectedLayerIds
export const selectSelectedLayerId = (state) => state.selection.selectedLayerIds[0] || null
export const selectHasSelection = (state) => state.selection.selectedLayerIds.length > 0
export const selectSelectedCanvas = (state) => state.selection.selectedCanvas
export const selectSelectedActionType = (state) => state.selection.selectedActionType
export const selectSelectedActionStepId = (state) => state.selection.selectedActionStepId

export default selectionSlice.reducer

