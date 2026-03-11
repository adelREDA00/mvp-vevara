import { createSlice, createSelector, createAsyncThunk } from '@reduxjs/toolkit'
import { uid } from '../../utils/ids'
import { setSelectedLayer, selectSelectedLayerId } from './selectionSlice'
import api from '../../api/client'

const generateId = uid

export const saveProject = createAsyncThunk(
  'project/save',
  async (args, { getState, rejectWithValue }) => {
    try {
      const state = getState().project
      const thumbnail = args?.thumbnail || null

      const projectPayload = {
        name: state.projectName,
        data: {
          scenes: state.scenes,
          layers: state.layers,
          sceneMotionFlows: state.sceneMotionFlows,
          aspectRatio: state.aspectRatio || '16:9'
        },
        thumbnail,
      }

      let response
      if (state.projectId) {
        // Update existing project
        response = await api.put(`/projects/${state.projectId}`, projectPayload)
      } else {
        // Create new project
        response = await api.post('/projects', projectPayload)
      }
      return response
    } catch (error) {
      return rejectWithValue(error.message)
    }
  }
)

export const fetchProjectById = createAsyncThunk(
  'project/fetchById',
  async (id, { rejectWithValue }) => {
    try {
      const data = await api.get(`/projects/${id}`)
      return data
    } catch (error) {
      return rejectWithValue(error.message)
    }
  }
)

const initialState = {
  projectId: null,
  scenes: [],
  layers: {},
  // Scene-based motion flows: { [sceneId]: { steps: [{ id, layerActions: { [layerId]: [...actions] } }], pageDuration } }
  sceneMotionFlows: {},
  currentSceneId: null, // Unified scene selection 
  projectName: 'Untitled Project',
  aspectRatio: '16:9',
  lastPastedLayerIds: [], // Track last pasted layer IDs for selection
  motionEditingMode: {
    isActive: false,
    sceneId: null,
    stepId: null,
    // Map of layerId -> initial transform captured at edit start
    initialTransforms: {},
  },
  status: 'idle',
  error: null,
  isSaving: false,
  saveError: null,
  // [NEW] Asset loading management
  loadingMode: 'global', // 'global' (full screen preloader) or 'local' (card spinners)
  preparingLayers: {}, // Map of layerId -> true for layers being initialized in PIXI
}

// Resolve step layout: auto steps get default duration, manual steps are preserved.
// Overflow is absorbed by trimming rightmost manual step(s). Steps are placed contiguously.
const resolveStepLayout = (steps, sceneDurationMs) => {
  if (steps.length === 0) return
  const MIN_DURATION = 200 // ms — minimum to prevent micro-durations
  const defaultDuration = Math.max(MIN_DURATION, Math.round(sceneDurationMs / steps.length))

  // Step 1: Set auto step durations to default, keep manual durations
  steps.forEach(step => {
    if (!step.manual) {
      step.duration = defaultDuration
    }
    // Enforce minimum for all steps
    if (!step.duration || step.duration < MIN_DURATION) step.duration = MIN_DURATION
  })

  // Step 2: Resolve overflow — trim from rightmost manual steps
  let total = steps.reduce((sum, s) => sum + s.duration, 0)
  if (total > sceneDurationMs) {
    let overflow = total - sceneDurationMs
    for (let i = steps.length - 1; i >= 0 && overflow > 0; i--) {
      if (steps[i].manual) {
        const maxTrim = steps[i].duration - MIN_DURATION
        if (maxTrim > 0) {
          const trim = Math.min(maxTrim, overflow)
          steps[i].duration = Math.round(steps[i].duration - trim)
          overflow -= trim
        }
      }
    }
    // Emergency fallback: if still overflowing, trim auto steps from right
    if (overflow > 0) {
      for (let i = steps.length - 1; i >= 0 && overflow > 0; i--) {
        const maxTrim = steps[i].duration - MIN_DURATION
        if (maxTrim > 0) {
          const trim = Math.min(maxTrim, overflow)
          steps[i].duration = Math.round(steps[i].duration - trim)
          overflow -= trim
        }
      }
    }
  }

  // Step 3: Position steps — preserve manually set positions (with gaps)
  const hasManualPositions = steps.some(s => s.manual && s.startTime != null)

  if (hasManualPositions) {
    let cursor = 0
    steps.forEach(step => {
      if (step.manual && step.startTime != null) {
        // Manual step: keep its user-set position (preserves gaps)
        cursor = step.startTime + step.duration
      } else {
        // Auto step: place after the last positioned step
        step.startTime = Math.round(cursor)
        cursor += step.duration
      }
    })
  } else {
    // All auto: contiguous placement (default behavior)
    let cursor = 0
    steps.forEach(step => {
      step.startTime = Math.round(cursor)
      cursor += step.duration
    })
  }

  // Step 4: Boundary clamp — no step may extend past the scene duration.
  // This prevents tweens from bleeding into the next scene (which breaks playback).
  steps.forEach(step => {
    if (step.startTime >= sceneDurationMs) {
      step.startTime = Math.max(0, sceneDurationMs - MIN_DURATION)
      step.duration = MIN_DURATION
    } else if (step.startTime + step.duration > sceneDurationMs) {
      step.duration = Math.max(MIN_DURATION, sceneDurationMs - step.startTime)
    }
  })
}

// Sync motion flow: resolve layout and sync action durations.
const syncSceneMotionDuration = (state, sceneId) => {
  const scene = state.scenes.find(s => s.id === sceneId)
  if (!scene) return

  const motionFlow = state.sceneMotionFlows[sceneId]
  if (!motionFlow) return

  const sceneDurationMs = Math.round((scene.duration || 5) * 1000)
  motionFlow.pageDuration = sceneDurationMs
  // Preserve or initialize sceneStartOffset
  if (motionFlow.sceneStartOffset === undefined) {
    motionFlow.sceneStartOffset = 0
  }

  const steps = motionFlow.steps || []
  if (steps.length === 0) return

  // Resolve layout: auto steps reflow, manual steps preserved
  resolveStepLayout(steps, sceneDurationMs)

  // Sync action durations to each step's effective duration
  steps.forEach(step => {
    if (!step.layerActions) step.layerActions = {}
    const effectiveDuration = step.duration
    Object.keys(step.layerActions).forEach(layerId => {
      const actions = step.layerActions[layerId]
      if (!Array.isArray(actions)) return
      actions.forEach(action => {
        if (!action.values) action.values = {}
        action.values.duration = effectiveDuration
        action.duration = effectiveDuration
      })
    })
  })
}

// Sync scene duration with the longest video layer duration
const syncSceneVideoDuration = (state, sceneId) => {
  const scene = state.scenes.find(s => s.id === sceneId)
  if (!scene) return

  // Find all video layers in this scene
  const videoLayers = scene.layers
    .map(layerId => state.layers[layerId])
    .filter(layer => layer && layer.type === 'video')

  if (videoLayers.length > 0) {
    // Find the longest video duration (in seconds)
    const maxDuration = Math.max(...videoLayers.map(l => l.data?.duration || 0))

    // [FIX] Expand-only strategy: Only auto-expand scene duration if a video is longer.
    // We do NOT auto-shrink here to avoid clashing with manual user adjustments.
    // Shrinking is handled explicitly by deleteLayer if the longest video is removed.
    if (maxDuration > 0 && maxDuration > scene.duration) {
      scene.duration = maxDuration
      // Sync motion flow duration to match updated scene duration
      syncSceneMotionDuration(state, sceneId)
    }
  }
}

const projectSlice = createSlice({
  name: 'project',
  initialState,
  reducers: {
    // [FIX] Reset project state to initial values for clean editor re-entry
    resetProject: () => initialState,
    setProjectName: (state, action) => {
      state.projectName = action.payload
    },
    // Asset loading management
    setLoadingMode: (state, action) => {
      state.loadingMode = action.payload // 'global' or 'local'
    },
    startPreparingLayer: (state, action) => {
      state.preparingLayers[action.payload] = true
    },
    finishPreparingLayer: (state, action) => {
      delete state.preparingLayers[action.payload]
    },
    setAspectRatio: (state, action) => {
      state.aspectRatio = action.payload
    },
    // Scene actions
    addScene: (state, action) => {
      const sceneId = action.payload.id || generateId()
      const backgroundColor = action.payload.backgroundColor !== undefined ? action.payload.backgroundColor : 0xffffff

      // Use provided width/height or default to standard resolutions based on aspectRatio
      let width = action.payload.width
      let height = action.payload.height

      if (!width || !height) {
        // Fallback to standard resolutions based on current aspectRatio
        if (state.aspectRatio === '9:16') {
          width = 1080
          height = 1920
        } else if (state.aspectRatio === '1:1') {
          width = 1080
          height = 1080
        } else {
          // Default to 16:9 or custom
          width = 1920
          height = 1080
        }
      }

      // Create background layer for this scene
      const backgroundLayer = {
        id: generateId(),
        sceneId: sceneId,
        type: 'background',
        name: 'Background',
        visible: true,
        locked: false, // Background can be selected for color changes but not dragged/resized
        opacity: 1.0,
        // Background covers entire world from (0,0)
        x: 0,
        y: 0,
        width: width,
        height: height,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        anchorX: 0, // Top-left anchor so it covers from (0,0)
        anchorY: 0,
        // Background-specific data
        data: {
          color: backgroundColor,
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }

      // Add background layer to layers map
      state.layers[backgroundLayer.id] = backgroundLayer

      const newScene = {
        id: sceneId,
        name: action.payload.name || `Scene ${state.scenes.length + 1}`,
        duration: action.payload.duration || 5.0,
        transition: action.payload.transition || 'None',
        backgroundColor: backgroundColor,
        layers: [backgroundLayer.id], // Start with background layer
      }
      state.scenes.push(newScene)
      if (!state.currentSceneId && state.scenes.length === 1) {
        state.currentSceneId = newScene.id
      }
      state.status = 'succeeded'
    },

    updateScene: (state, action) => {
      const { id, trimStartDelta, ...updates } = action.payload
      const scene = state.scenes.find(s => s.id === id)
      if (scene) {
        // If backgroundColor is being updated, also update the background layer
        if (updates.backgroundColor !== undefined) {
          const backgroundLayerId = scene.layers.find(layerId => {
            const layer = state.layers[layerId]
            return layer && layer.type === 'background'
          })

          if (backgroundLayerId) {
            const backgroundLayer = state.layers[backgroundLayerId]
            if (backgroundLayer) {
              backgroundLayer.data = { ...backgroundLayer.data, color: updates.backgroundColor }
              backgroundLayer.updatedAt = Date.now()
            }
          }
        }

        // [FIX] Apply trimming delta to all video layers in the scene
        // Bidirectional trimming: leftTrimDelta (starts later) or rightTrimDelta (ends earlier)
        if (trimStartDelta !== undefined && trimStartDelta !== 0) {
          scene.layers.forEach(layerId => {
            const layer = state.layers[layerId]
            if (layer && layer.type === 'video') {
              if (!layer.data) layer.data = {}
              const currentStart = layer.data.sourceStartTime || 0
              layer.data.sourceStartTime = Math.max(0, currentStart + trimStartDelta)
            }
          })
        }

        Object.assign(scene, updates)

        // [FIX] Sync video sourceEndTime if duration was updated
        // This ensures stretching a scene also stretches the video playback boundary
        if (updates.duration !== undefined) {
          scene.layers.forEach(layerId => {
            const layer = state.layers[layerId]
            if (layer && layer.type === 'video' && layer.data) {
              // Only update if sourceEndTime was already set (e.g. by split or manual trim)
              if (layer.data.sourceEndTime !== undefined) {
                const start = layer.data.sourceStartTime || 0
                layer.data.sourceEndTime = start + updates.duration
              }
            }
          })

          // Scale manual step positions AND durations proportionally when scene duration changes
          const motionFlow = state.sceneMotionFlows[id]
          if (motionFlow && motionFlow.steps && motionFlow.steps.length > 0) {
            const oldPageDuration = motionFlow.pageDuration || 5000
            const newPageDuration = Math.round(updates.duration * 1000)
            if (oldPageDuration > 0 && newPageDuration !== oldPageDuration) {
              const ratio = newPageDuration / oldPageDuration
              motionFlow.steps.forEach(step => {
                if (step.manual) {
                  if (step.startTime != null) {
                    step.startTime = Math.round(step.startTime * ratio)
                  }
                  if (step.duration != null) {
                    step.duration = Math.round(Math.max(200, step.duration * ratio))
                  }
                }
              })
            }
          }

          syncSceneMotionDuration(state, id)
        }
      }
    },

    deleteScene: (state, action) => {
      const sceneId = action.payload
      state.scenes = state.scenes.filter(s => s.id !== sceneId)

      // Clean up layers for deleted scene
      Object.keys(state.layers).forEach(layerId => {
        if (state.layers[layerId].sceneId === sceneId) {
          delete state.layers[layerId]
        }
      })

      // Clean up scene motion flow
      delete state.sceneMotionFlows[sceneId]

      // Set new current scene if needed
      if (state.currentSceneId === sceneId && state.scenes.length > 0) {
        state.currentSceneId = state.scenes[0].id
      }
    },

    setCurrentScene: (state, action) => {
      const sceneId = action.payload
      // Stability check: if already on this scene, do nothing
      if (state.currentSceneId === sceneId) return

      if (state.scenes.find(s => s.id === sceneId)) {
        state.currentSceneId = sceneId
      }
    },

    reorderScene: (state, action) => {
      const { fromIndex, toIndex } = action.payload
      if (fromIndex !== toIndex && fromIndex >= 0 && toIndex >= 0 &&
        fromIndex < state.scenes.length && toIndex < state.scenes.length) {
        const [moved] = state.scenes.splice(fromIndex, 1)
        state.scenes.splice(toIndex, 0, moved)
      }
    },

    /**
     * Split a scene at a specific time point.
     * Creates a new scene, duplicates layers, and splits video playback ranges.
     */
    splitScene: (state, action) => {
      const { sceneId, splitTime } = action.payload // splitTime in seconds relative to scene start
      const sceneIndex = state.scenes.findIndex(s => s.id === sceneId)
      if (sceneIndex === -1) return

      const originalScene = state.scenes[sceneIndex]
      const originalDuration = originalScene.duration

      // Ensure split time is within bounds
      const rawSplitTime = Math.max(0.1, Math.min(splitTime, originalDuration - 0.1))
      // [FIX] Frame Snapping: Round to nearest 60fps boundary to avoid repeated frames in videos
      const safeSplitTime = Math.round(rawSplitTime * 60) / 60

      const newSceneId = generateId()
      const newSceneDuration = originalDuration - safeSplitTime

      // 1. Create the new scene (second segment)
      // We start by cloning the original scene metadata
      const newScene = {
        ...originalScene,
        id: newSceneId,
        name: `${originalScene.name} (Part 2)`,
        duration: newSceneDuration,
        layers: [], // Will be populated with new layer IDs
      }

      // 2. Adjust original scene duration (first segment)
      originalScene.duration = safeSplitTime

      // 3. Handle layers - Deep duplication to ensure independent segments
      // We map originalLayerId -> newLayerId for motion flow duplication below
      const layerIdMap = {}

      originalScene.layers.forEach(layerId => {
        const layer = state.layers[layerId]
        if (!layer) return

        const newLayerId = generateId()
        layerIdMap[layerId] = newLayerId

        // Deep duplicate the layer
        const newLayer = JSON.parse(JSON.stringify(layer))
        newLayer.id = newLayerId
        newLayer.sceneId = newSceneId

        // [SCENE CUT FIX] Preserve sourceId to enable seamless PIXI object adoption
        // This ensures that video elements are reused across the split transition,
        // preventing the "freeze" or "flicker" caused by layer reconstruction.
        newLayer.sourceId = layer.sourceId || layer.id

        // Split logic for video layers
        if (layer.type === 'video' && layer.data) {
          const originalSourceStart = layer.data.sourceStartTime || 0

          // Original layer (left segment): ends at split point
          layer.data.sourceEndTime = originalSourceStart + safeSplitTime

          // New layer (right segment): starts at split point
          newLayer.data.sourceStartTime = originalSourceStart + safeSplitTime
          // sourceEndTime remains as duplicated (original's original sourceEndTime)
        }

        state.layers[newLayerId] = newLayer
        newScene.layers.push(newLayerId)
      })

      // 4. Handle Motion Flows — Both scenes get a FULL COPY of all steps.
      // We do NOT split or filter steps. syncSceneMotionDuration will recalculate
      // step durations relative to each scene's new duration.
      const originalFlow = state.sceneMotionFlows[sceneId]
      const cutPointMs = Math.round(safeSplitTime * 1000)
      const newSceneDurationMs = Math.round(newSceneDuration * 1000)

      if (originalFlow) {
        const originalPageDuration = originalFlow.pageDuration || (scene.duration * 1000)
        // Deep copy all steps for the right scene
        const newFlowSteps = JSON.parse(JSON.stringify(originalFlow.steps || []))

        // Helper: proportionally scale step timing to a new scene duration
        const scaleStepTiming = (step, targetDurationMs) => {
          if (originalPageDuration <= 0) return
          const ratio = targetDurationMs / originalPageDuration
          if (step.startTime != null) {
            step.startTime = Math.round(step.startTime * ratio)
          }
          if (step.duration != null) {
            step.duration = Math.max(200, Math.round(step.duration * ratio))
          }
          // Keep step.manual flag intact — preserves manual state
        }

        // Remap layer IDs in the new flow's steps to match the duplicated layers
        newFlowSteps.forEach(step => {
          if (step.layerActions) {
            const newLayerActions = {}
            Object.keys(step.layerActions).forEach(oldLayerId => {
              const newLayerId = layerIdMap[oldLayerId]
              if (newLayerId) {
                newLayerActions[newLayerId] = step.layerActions[oldLayerId].map(action => ({
                  ...action,
                  id: generateId()
                }))
              }
            })
            step.layerActions = newLayerActions
          }
          // Give each step a new ID for the right scene
          step.id = generateId()
          // Scale timing proportionally to the right scene's duration
          scaleStepTiming(step, newSceneDurationMs)
        })

        // Assign the duplicated flow to the right scene
        state.sceneMotionFlows[newSceneId] = {
          steps: newFlowSteps,
          pageDuration: newSceneDurationMs
        }

        // Update left scene's pageDuration and scale its steps proportionally
        originalFlow.pageDuration = cutPointMs
          ; (originalFlow.steps || []).forEach(step => {
            scaleStepTiming(step, cutPointMs)
          })
      } else {
        // Ensure both flows are initialized even if empty
        state.sceneMotionFlows[sceneId] = { steps: [], pageDuration: cutPointMs }
        state.sceneMotionFlows[newSceneId] = { steps: [], pageDuration: newSceneDurationMs }
      }

      // 5. Insert the new scene into the project array
      // This MUST happen before syncSceneMotionDuration so the new scene is discoverable by ID
      state.scenes.splice(sceneIndex + 1, 0, newScene)

      // 6. Sync both for absolute duration/step alignment
      syncSceneMotionDuration(state, sceneId)
      syncSceneMotionDuration(state, newSceneId)

      state.currentSceneId = newSceneId
    },

    // Layer actions
    addLayer: (state, action) => {
      const { sceneId, type, id, ...layerData } = action.payload
      const newLayer = {
        id: id || generateId(),
        sceneId: sceneId || state.currentSceneId,
        type, // 'text', 'shape'
        name: layerData.name || `${type} Layer`,
        visible: layerData.visible !== undefined ? layerData.visible : true,
        locked: layerData.locked !== undefined ? layerData.locked : false,
        opacity: layerData.opacity !== undefined ? layerData.opacity : 1.0,
        // Transform properties
        x: layerData.x || 0,
        y: layerData.y || 0,
        width: layerData.width || 100,
        height: layerData.height || 100,
        rotation: layerData.rotation || 0,
        scaleX: layerData.scaleX !== undefined ? layerData.scaleX : 1,
        scaleY: layerData.scaleY !== undefined ? layerData.scaleY : 1,
        // Text layers should use top-left anchor (0,0) for consistent positioning
        // Shape layers use center anchor (0.5, 0.5) by default
        anchorX: layerData.anchorX !== undefined ? layerData.anchorX : (type === 'text' ? 0 : 0.5),
        anchorY: layerData.anchorY !== undefined ? layerData.anchorY : (type === 'text' ? 0 : 0.5),
        // Layer-specific data
        data: type === 'video'
          ? { sourceStartTime: 0, sourceEndTime: layerData.data?.duration || 0, ...layerData.data }
          : (layerData.data || {}),

        createdAt: Date.now(),
        updatedAt: Date.now(),
      }

      state.layers[newLayer.id] = newLayer

      // Add to scene's layer list
      const scene = state.scenes.find(s => s.id === newLayer.sceneId)
      if (scene) {
        scene.layers.push(newLayer.id)
        // Auto-sync scene duration if this is a video layer
        if (type === 'video') {
          syncSceneVideoDuration(state, newLayer.sceneId)
        }
      }
    },

    updateLayer: (state, action) => {
      const { id, ...updates } = action.payload
      const layer = state.layers[id]
      if (layer) {
        // Check if duration is newly discovered (metadata loaded)
        // Only trigger sync if we go from 0/undefined to a real duration
        const isMetadataLoad = updates.data?.duration !== undefined &&
          (layer.data?.duration === undefined || layer.data?.duration === 0)

        // CRITICAL: Deep merge data property to preserve existing properties
        if (updates.data !== undefined) {
          // Merge data objects to preserve existing properties
          updates.data = { ...(layer.data || {}), ...updates.data }
        }

        Object.assign(layer, updates, { updatedAt: Date.now() })

        // Only re-sync scene duration if the duration was NEWLY discovered (e.g., first metadata load)
        if (layer.type === 'video' && isMetadataLoad) {
          if (!layer.data) layer.data = {}
          layer.data.sourceEndTime = updates.data.duration
          syncSceneVideoDuration(state, layer.sceneId)
        }
      }
    },

    deleteLayer: (state, action) => {
      const layerId = action.payload
      const layer = state.layers[layerId]

      if (layer) {
        // Remove from scene's layer list
        const scene = state.scenes.find(s => s.id === layer.sceneId)
        if (scene) {
          scene.layers = scene.layers.filter(id => id !== layerId)
        }

        // Remove this layer from all scene motion flows
        Object.values(state.sceneMotionFlows).forEach(motionFlow => {
          if (motionFlow.steps) {
            // Remove empty steps
            motionFlow.steps = motionFlow.steps.filter(step => {
              if (step.layerActions && step.layerActions[layerId]) {
                delete step.layerActions[layerId]
              }
              // Keep step only if it still has other layer actions
              return Object.keys(step.layerActions || {}).length > 0
            })
          }
        })

        // Delete the layer
        const deletedLayerType = layer.type
        const sceneId = layer.sceneId
        delete state.layers[layerId]

        // If a video layer was deleted, re-sync scene duration
        if (deletedLayerType === 'video') {
          syncSceneVideoDuration(state, sceneId)
        }
      }
    },

    duplicateLayer: (state, action) => {
      const layerId = action.payload
      const layer = state.layers[layerId]

      if (layer) {
        const newLayerId = generateId()
        const newLayer = {
          ...layer,
          id: newLayerId,
          name: `${layer.name} Copy`,
          x: layer.x + 20,
          y: layer.y + 20,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }

        state.layers[newLayer.id] = newLayer

        // Add to scene
        const scene = state.scenes.find(s => s.id === layer.sceneId)
        if (scene) {
          scene.layers.push(newLayer.id)

          // If video layer duplicated, re-sync (though duration likely same)
          if (layer.type === 'video') {
            syncSceneVideoDuration(state, layer.sceneId)
          }

          // Copy this layer's actions in the scene motion flow to the new layer
          const sceneMotionFlow = state.sceneMotionFlows[layer.sceneId]
          if (sceneMotionFlow && sceneMotionFlow.steps) {
            sceneMotionFlow.steps.forEach(step => {
              if (step.layerActions && step.layerActions[layerId]) {
                // Deep copy actions for the new layer
                step.layerActions[newLayerId] = step.layerActions[layerId].map(action => ({
                  id: generateId(),
                  type: action.type,
                  values: {
                    ...action.values,
                    controlPoints: action.values?.controlPoints ? JSON.parse(JSON.stringify(action.values.controlPoints)) : undefined
                  },
                }))
              }
            })
          }
        }
      }
    },

    reorderLayer: (state, action) => {
      const { sceneId, fromIndex, toIndex } = action.payload
      const scene = state.scenes.find(s => s.id === sceneId)
      if (scene) {
        const [moved] = scene.layers.splice(fromIndex, 1)
        scene.layers.splice(toIndex, 0, moved)
      }
    },

    bringLayerToFront: (state, action) => {
      const layerId = typeof action.payload === 'string' ? action.payload : action.payload.layerId
      const layer = state.layers[layerId]
      if (!layer) return

      const scene = state.scenes.find(s => s.id === layer.sceneId)
      if (scene) {
        const currentIndex = scene.layers.indexOf(layerId)
        if (currentIndex !== -1 && currentIndex < scene.layers.length - 1) {
          scene.layers.splice(currentIndex, 1)
          scene.layers.push(layerId)
        }
      }
    },

    sendLayerToBack: (state, action) => {
      const layerId = typeof action.payload === 'string' ? action.payload : action.payload.layerId
      const layer = state.layers[layerId]
      if (!layer) return

      const scene = state.scenes.find(s => s.id === layer.sceneId)
      if (scene) {
        const currentIndex = scene.layers.indexOf(layerId)
        // Background layer is always at index 0, so we send to index 1
        if (currentIndex > 1) {
          scene.layers.splice(currentIndex, 1)
          scene.layers.splice(1, 0, layerId)
        }
      }
    },
    bringLayerForward: (state, action) => {
      const layerId = typeof action.payload === 'string' ? action.payload : action.payload.layerId
      const layer = state.layers[layerId]
      if (!layer) return

      const scene = state.scenes.find(s => s.id === layer.sceneId)
      if (scene) {
        const currentIndex = scene.layers.indexOf(layerId)
        if (currentIndex !== -1 && currentIndex < scene.layers.length - 1) {
          const nextIndex = currentIndex + 1
          scene.layers.splice(currentIndex, 1)
          scene.layers.splice(nextIndex, 0, layerId)
        }
      }
    },
    sendLayerBackward: (state, action) => {
      const layerId = typeof action.payload === 'string' ? action.payload : action.payload.layerId
      const layer = state.layers[layerId]
      if (!layer) return

      const scene = state.scenes.find(s => s.id === layer.sceneId)
      if (scene) {
        const currentIndex = scene.layers.indexOf(layerId)
        // Ensure it doesn't go below the background layer (index 0)
        if (currentIndex > 1) {
          const nextIndex = currentIndex - 1
          scene.layers.splice(currentIndex, 1)
          scene.layers.splice(nextIndex, 0, layerId)
        }
      }
    },

    // =========================================================================
    // Scene Motion Flow actions - Core motion system (scene-based)
    // =========================================================================

    // Initialize motion flow for a scene
    initializeSceneMotionFlow: (state, action) => {
      const { sceneId } = action.payload
      const scene = state.scenes.find(s => s.id === sceneId)
      const pageDuration = scene ? scene.duration * 1000 : 6000

      if (!state.sceneMotionFlows[sceneId]) {
        state.sceneMotionFlows[sceneId] = {
          steps: [],
          pageDuration,
        }
      }
    },

    // Update scene motion flow properties (like page duration)
    updateSceneMotionFlow: (state, action) => {
      const { sceneId, ...updates } = action.payload
      if (state.sceneMotionFlows[sceneId]) {
        Object.assign(state.sceneMotionFlows[sceneId], updates)
      }
    },

    addSceneMotionStep: (state, action) => {
      const { sceneId, stepId } = action.payload
      const scene = state.scenes.find(s => s.id === sceneId)
      const pageDuration = scene ? Math.round(scene.duration * 1000) : 6000

      if (!state.sceneMotionFlows[sceneId]) {
        state.sceneMotionFlows[sceneId] = {
          steps: [],
          pageDuration,
        }
      }

      // New step is always auto (manual: false or undefined)
      state.sceneMotionFlows[sceneId].steps.push({
        id: stepId || generateId(),
        layerActions: {},
        // No manual flag → auto step, resolveStepLayout assigns duration
      })

      // resolveStepLayout recalculates: auto steps get default, manual preserved, overflow trimmed
      syncSceneMotionDuration(state, sceneId)
    },

    // Update an existing motion step
    updateSceneMotionStep: (state, action) => {
      const { sceneId, stepId, ...updates } = action.payload
      const motionFlow = state.sceneMotionFlows[sceneId]
      if (motionFlow) {
        const step = motionFlow.steps.find(s => s.id === stepId)
        if (step) {
          Object.assign(step, updates)
          syncSceneMotionDuration(state, sceneId)
        }
      }
    },

    // Delete a motion step — resolveStepLayout recalculates auto steps, manual preserved
    deleteSceneMotionStep: (state, action) => {
      const { sceneId, stepId } = action.payload
      const motionFlow = state.sceneMotionFlows[sceneId]
      if (motionFlow) {
        motionFlow.steps = motionFlow.steps.filter(s => s.id !== stepId)
        syncSceneMotionDuration(state, sceneId)
      }
    },

    // Reorder motion steps — clears manual flags and redistributes equally
    reorderSceneMotionSteps: (state, action) => {
      const { sceneId, fromIndex, toIndex } = action.payload
      const motionFlow = state.sceneMotionFlows[sceneId]
      if (motionFlow && motionFlow.steps) {
        if (fromIndex !== toIndex &&
          fromIndex >= 0 && toIndex >= 0 &&
          fromIndex < motionFlow.steps.length && toIndex < motionFlow.steps.length) {
          const [moved] = motionFlow.steps.splice(fromIndex, 1)
          motionFlow.steps.splice(toIndex, 0, moved)
          // After reorder, clear all manual flags so resolveStepLayout redistributes equally
          motionFlow.steps.forEach(s => {
            delete s.manual
            delete s.startTime
            delete s.duration
          })
          syncSceneMotionDuration(state, sceneId)
        }
      }
    },

    // Update step timing manually (move, resize left, resize right)
    // Marks the edited step as manual = true (protected from auto-redistribution).
    // Enforces: no overlap, order preserved, scene boundaries respected.
    // Does NOT trigger fast preview or move the timeline marker.
    updateStepTiming: (state, action) => {
      const { sceneId, stepId, startTime, duration } = action.payload
      const motionFlow = state.sceneMotionFlows[sceneId]
      if (!motionFlow) return

      const steps = motionFlow.steps
      const stepIndex = steps.findIndex(s => s.id === stepId)
      if (stepIndex === -1) return

      const step = steps[stepIndex]
      const sceneDuration = motionFlow.pageDuration || 5000
      const MIN_DURATION = 200 // ms — synced with resolveStepLayout

      // Mark this step as manually edited
      step.manual = true

      // Determine neighbor boundaries
      const prevEnd = stepIndex > 0
        ? (steps[stepIndex - 1].startTime || 0) + (steps[stepIndex - 1].duration || 0)
        : 0
      const nextStart = stepIndex < steps.length - 1
        ? (steps[stepIndex + 1].startTime || sceneDuration)
        : sceneDuration

      let newStartTime = startTime !== undefined ? startTime : step.startTime
      let newDuration = duration !== undefined ? duration : step.duration

      // Clamp startTime: cannot go before prevEnd, cannot push past nextStart
      newStartTime = Math.max(prevEnd, Math.min(newStartTime, nextStart - MIN_DURATION))

      // Clamp duration: minimum 50ms, cannot exceed space to nextStart
      newDuration = Math.max(MIN_DURATION, Math.min(newDuration, nextStart - newStartTime))

      step.startTime = Math.round(newStartTime)
      step.duration = Math.round(newDuration)

      // Sync action durations
      if (step.layerActions) {
        Object.keys(step.layerActions).forEach(layerId => {
          const actions = step.layerActions[layerId]
          if (!Array.isArray(actions)) return
          actions.forEach(a => {
            if (!a.values) a.values = {}
            a.values.duration = step.duration
            a.duration = step.duration
          })
        })
      }
    },

    // Add action to a layer within a motion step
    // Does NOT trigger layout reflow — only syncs the new action's duration to the step
    addSceneMotionAction: (state, action) => {
      const { sceneId, stepId, layerId, actionId, type, values = {} } = action.payload
      const motionFlow = state.sceneMotionFlows[sceneId]
      if (motionFlow) {
        const step = motionFlow.steps.find(s => s.id === stepId)
        if (step) {
          if (!step.layerActions[layerId]) {
            step.layerActions[layerId] = []
          }
          const stepDuration = step.duration || 1000
          const newAction = {
            id: actionId || generateId(),
            type,
            duration: stepDuration,
            values: {
              ...values,
              duration: stepDuration,
              controlPoints: values.controlPoints ? JSON.parse(JSON.stringify(values.controlPoints)) : undefined
            },
          }
          step.layerActions[layerId].push(newAction)
        }
      }
    },

    // Update a motion action for a specific layer within a step
    // Does NOT trigger layout reflow — only updates action data in place
    updateSceneMotionAction: (state, action) => {
      const { sceneId, stepId, layerId, actionId, ...updates } = action.payload
      const motionFlow = state.sceneMotionFlows[sceneId]
      if (motionFlow) {
        const step = motionFlow.steps.find(s => s.id === stepId)
        if (step && step.layerActions[layerId]) {
          const motionAction = step.layerActions[layerId].find(a => a.id === actionId)
          if (motionAction) {
            // Merge values to preserve synced duration and easing if not provided
            if (updates.values) {
              updates.values = {
                ...(motionAction.values || {}),
                ...updates.values,
                duration: step.duration || motionAction.values?.duration,
                controlPoints: updates.values.controlPoints !== undefined
                  ? JSON.parse(JSON.stringify(updates.values.controlPoints))
                  : (motionAction.values?.controlPoints ? JSON.parse(JSON.stringify(motionAction.values.controlPoints)) : undefined)
              }
            }
            Object.assign(motionAction, updates)
          }
        }
      }
    },

    // Delete a motion action from a specific layer within a step
    deleteSceneMotionAction: (state, action) => {
      const { sceneId, stepId, layerId, actionId } = action.payload
      const motionFlow = state.sceneMotionFlows[sceneId]
      if (motionFlow) {
        const step = motionFlow.steps.find(s => s.id === stepId)
        if (step && step.layerActions[layerId]) {
          step.layerActions[layerId] = step.layerActions[layerId].filter(a => a.id !== actionId)
          // Clean up if no actions left for this layer
          if (step.layerActions[layerId].length === 0) {
            delete step.layerActions[layerId]
          }

          // Clean up step if no layers have actions left
          if (Object.keys(step.layerActions).length === 0) {
            motionFlow.steps = motionFlow.steps.filter(s => s.id !== stepId)
            syncSceneMotionDuration(state, sceneId)
          }
        }
      }
    },

    // Duplicate a motion step with all its layer actions
    duplicateSceneMotionStep: (state, action) => {
      const { sceneId, stepId } = action.payload
      const motionFlow = state.sceneMotionFlows[sceneId]
      if (motionFlow) {
        const stepToDuplicate = motionFlow.steps.find(s => s.id === stepId)
        if (stepToDuplicate) {
          // Deep copy the layerActions
          const duplicatedLayerActions = {}
          Object.keys(stepToDuplicate.layerActions || {}).forEach(layerId => {
            duplicatedLayerActions[layerId] = stepToDuplicate.layerActions[layerId].map(action => ({
              id: generateId(),
              type: action.type,
              values: {
                ...action.values,
                controlPoints: action.values?.controlPoints ? JSON.parse(JSON.stringify(action.values.controlPoints)) : undefined
              },
            }))
          })

          const duplicatedStep = {
            id: generateId(),
            layerActions: duplicatedLayerActions,
          }
          motionFlow.steps.push(duplicatedStep)
          syncSceneMotionDuration(state, sceneId)
        }
      }
    },

    // Clear all motion data for a scene
    clearSceneMotionFlow: (state, action) => {
      const { sceneId } = action.payload
      if (state.sceneMotionFlows[sceneId]) {
        delete state.sceneMotionFlows[sceneId]
      }
    },

    // Motion Editing Mode - Start editing a motion step on canvas (scene-based)
    startMotionEditing: (state, action) => {
      const { sceneId, stepId } = action.payload
      const scene = state.scenes.find(s => s.id === sceneId)
      if (scene) {
        // Capture initial transforms for all layers in the scene
        const initialTransforms = {}
        scene.layers.forEach(layerId => {
          const layer = state.layers[layerId]
          if (layer && layer.type !== 'background') {
            initialTransforms[layerId] = {
              x: layer.x,
              y: layer.y,
              rotation: layer.rotation,
              scaleX: layer.scaleX,
              scaleY: layer.scaleY,
              opacity: layer.opacity,
            }
          }
        })

        state.motionEditingMode = {
          isActive: true,
          sceneId,
          stepId,
          initialTransforms,
        }
      }
    },

    // Motion Editing Mode - Stop editing and reset
    stopMotionEditing: (state, action) => {
      // Reset motion editing mode
      state.motionEditingMode = {
        isActive: false,
        sceneId: null,
        stepId: null,
        initialTransforms: {},
      }
    },

    // Project metadata
    setProjectName: (state, action) => {
      state.projectName = action.payload
    },

    // Initialize project (load from saved data)
    initializeProject: (state, action) => {
      const project = action.payload
      state.scenes = project.scenes || []
      state.layers = project.layers || {}
      state.sceneMotionFlows = project.sceneMotionFlows || {} // Initialize scene motion flows from saved project
      state.projectName = project.name || 'Untitled Project'
      state.currentSceneId = project.currentSceneId || project.currentProjectId || (state.scenes[0]?.id || null)
      state.status = 'succeeded'
    },

    // Restore project state from history (for undo/redo)
    restoreProjectState: (state, action) => {
      const { scenes, layers, sceneMotionFlows, currentSceneId, currentProjectId } = action.payload
      // Deep copy to ensure immutability (Immer will handle this, but being explicit)
      if (scenes) {
        state.scenes = JSON.parse(JSON.stringify(scenes))
      }
      if (layers) {
        state.layers = JSON.parse(JSON.stringify(layers))
      }
      if (sceneMotionFlows) {
        state.sceneMotionFlows = JSON.parse(JSON.stringify(sceneMotionFlows))
      }
      const finalSceneId = currentSceneId || currentProjectId
      if (finalSceneId !== undefined) {
        state.currentSceneId = finalSceneId
      }
    },

    // Copy layers to clipboard (stores in localStorage for cross-scene support)
    copyLayers: (state, action) => {
      const layerIds = action.payload
      if (!Array.isArray(layerIds) || layerIds.length === 0) return

      const layersToCopy = layerIds
        .map(id => state.layers[id])
        .filter(Boolean)
        .filter(layer => {
          // Validate layer has required fields
          if (!layer || typeof layer !== 'object' || !layer.type ||
            layer.x === undefined || layer.y === undefined) {
            return false
          }

          // For shape layers, ensure they have valid shape data
          if (layer.type === 'shape') {
            if (!layer.data) {
              return false
            }
            // Validate fill if present
            if (layer.data.fill !== undefined &&
              layer.data.fill !== null &&
              layer.data.fill !== 'transparent' &&
              typeof layer.data.fill !== 'string') {
              return false
            }
          }

          return true
        })
        .map(layer => {
          // Create a clean copy without id and sceneId
          const { id, sceneId, createdAt, updatedAt, ...layerData } = layer

          // Ensure data object exists and is clean
          if (!layerData.data || typeof layerData.data !== 'object') {
            layerData.data = {}
          } else {
            // Clean data object - remove any invalid properties
            const cleanData = {}
            Object.keys(layerData.data).forEach(key => {
              const value = layerData.data[key]
              // Only copy valid values (not functions, undefined, etc.)
              if (value !== undefined && typeof value !== 'function') {
                cleanData[key] = value
              }
            })
            layerData.data = cleanData
          }

          // Capture motion data for this layer
          const layerActions = {}
          const sceneMotionFlow = state.sceneMotionFlows[layer.sceneId]
          if (sceneMotionFlow && sceneMotionFlow.steps) {
            sceneMotionFlow.steps.forEach(step => {
              if (step.layerActions && step.layerActions[id]) {
                layerActions[step.id] = step.layerActions[id]
              }
            })
          }
          if (Object.keys(layerActions).length > 0) {
            layerData.motionData = layerActions
          }

          return layerData
        })

      if (layersToCopy.length === 0) {
        return
      }

      // Store in localStorage for persistence across scenes
      try {
        localStorage.setItem('vevara_clipboard', JSON.stringify({
          layers: layersToCopy,
          timestamp: Date.now(),
          version: '1.0', // Version marker for validation
        }))
      } catch (e) {
        // Clear clipboard if storage fails
        try {
          localStorage.removeItem('vevara_clipboard')
        } catch { }
      }
    },

    // Paste layers from clipboard
    pasteLayers: (state, action) => {
      const { targetSceneId, offsetX = 20, offsetY = 20 } = action.payload || {}
      const sceneId = targetSceneId || state.currentSceneId

      // Retrieve from localStorage
      let clipboardData
      try {
        const stored = localStorage.getItem('vevara_clipboard')
        if (!stored) return
        clipboardData = JSON.parse(stored)
      } catch (e) {
        // Clear corrupted clipboard
        try {
          localStorage.removeItem('vevara_clipboard')
        } catch { }
        return
      }

      // Validate clipboard data structure
      if (!clipboardData || typeof clipboardData !== 'object') {
        // Clear corrupted clipboard
        try {
          localStorage.removeItem('vevara_clipboard')
        } catch { }
        return
      }

      // Check if clipboard is too old (older than 1 hour) - might be corrupted
      if (clipboardData.timestamp && Date.now() - clipboardData.timestamp > 3600000) {
        try {
          localStorage.removeItem('vevara_clipboard')
        } catch { }
        return
      }

      if (!Array.isArray(clipboardData.layers) || clipboardData.layers.length === 0) {
        return
      }

      // Final validation - ensure all layers in array are valid objects
      const validLayers = clipboardData.layers.filter(layer =>
        layer && typeof layer === 'object' && layer.type
      )

      if (validLayers.length === 0) {
        // Clear corrupted clipboard
        try {
          localStorage.removeItem('vevara_clipboard')
        } catch { }
        return
      }

      // Use only valid layers
      clipboardData.layers = validLayers

      const scene = state.scenes.find(s => s.id === sceneId)
      if (!scene) return

      const newLayerIds = []
      const layerIdMap = {} // Map old layer indices to new IDs

      // Create new layers with validation
      clipboardData.layers.forEach((layerData, index) => {
        // Validate layer data before creating
        if (!layerData || typeof layerData !== 'object') {
          return
        }

        // Ensure required fields exist
        if (!layerData.type || layerData.x === undefined || layerData.y === undefined) {
          return
        }

        // Ensure data object exists and is valid
        if (!layerData.data || typeof layerData.data !== 'object') {
          layerData.data = {}
        }

        // For shape layers, validate they have proper shape data
        if (layerData.type === 'shape') {
          // Ensure shape data exists
          if (!layerData.data) {
            return
          }
          // Ensure fill is a valid string or null/transparent
          if (layerData.data.fill !== undefined &&
            layerData.data.fill !== null &&
            layerData.data.fill !== 'transparent' &&
            typeof layerData.data.fill !== 'string') {
            return
          }
        }

        // Validate numeric fields
        const x = typeof layerData.x === 'number' ? layerData.x : 0
        const y = typeof layerData.y === 'number' ? layerData.y : 0
        const width = typeof layerData.width === 'number' ? layerData.width : 100
        const height = typeof layerData.height === 'number' ? layerData.height : 100

        // Create clean data object - only copy valid properties
        const cleanData = {}
        if (layerData.data && typeof layerData.data === 'object') {
          Object.keys(layerData.data).forEach(key => {
            const value = layerData.data[key]
            // Only copy valid values (not functions, undefined, etc.)
            if (value !== undefined && typeof value !== 'function') {
              cleanData[key] = value
            }
          })
        }

        const newLayer = {
          ...layerData,
          id: generateId(),
          sceneId,
          x: x + offsetX,
          y: y + offsetY,
          width,
          height,
          name: layerData.name ? `${layerData.name} Copy` : `Layer Copy`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          // Use clean data object
          data: cleanData,
        }

        state.layers[newLayer.id] = newLayer
        scene.layers.push(newLayer.id)
        newLayerIds.push(newLayer.id)

        // Map old index to new ID
        layerIdMap[index] = newLayer.id

        // Restore motion data if available and applicable
        if (layerData.motionData && typeof layerData.motionData === 'object') {
          const targetSceneMotionFlow = state.sceneMotionFlows[sceneId]
          if (targetSceneMotionFlow && targetSceneMotionFlow.steps) {
            Object.keys(layerData.motionData).forEach(stepId => {
              // Check if the target scene has this step (only works within same scene or if step structure matches)
              const targetStep = targetSceneMotionFlow.steps.find(s => s.id === stepId)
              if (targetStep) {
                // Duplicate actions for the new layer
                const originalActions = layerData.motionData[stepId]
                if (Array.isArray(originalActions)) {
                  targetStep.layerActions[newLayer.id] = originalActions.map(action => ({
                    ...action,
                    id: generateId(),
                  }))
                }
              }
            })
          }
        }
      })


      // Store pasted layer IDs for selection
      state.lastPastedLayerIds = newLayerIds

      // Auto-sync scene duration if video layers were pasted
      const hasVideo = clipboardData.layers.some(l => l.type === 'video')
      if (hasVideo) {
        syncSceneVideoDuration(state, sceneId)
      }
    },

    // Copy scene to clipboard (stores in localStorage for cross-project support)
    copyScene: (state, action) => {
      const sceneId = action.payload
      const scene = state.scenes.find(s => s.id === sceneId)
      if (!scene) return

      // Get all layers for this scene
      const sceneLayers = scene.layers
        .map(layerId => state.layers[layerId])
        .filter(Boolean)
        .map(layer => {
          // Create a clean copy without id and sceneId
          const { id, sceneId: oldSceneId, createdAt, updatedAt, ...layerData } = layer
          return layerData
        })

      // Store scene data in localStorage (including original scene ID for positioning)
      try {
        localStorage.setItem('vevara_scene_clipboard', JSON.stringify({
          scene: {
            name: scene.name,
            duration: scene.duration,
            transition: scene.transition,
          },
          originalSceneId: sceneId, // Store original scene ID to position paste after it
          layers: sceneLayers,
          timestamp: Date.now(),
        }))
      } catch (e) {
      }
    },

    // Paste scene from clipboard
    pasteScene: (state, action) => {
      // Retrieve from localStorage
      let clipboardData
      try {
        const stored = localStorage.getItem('vevara_scene_clipboard')
        if (!stored) return
        clipboardData = JSON.parse(stored)
      } catch (e) {
        return
      }

      if (!clipboardData.scene || !clipboardData.layers) return

      // Create new scene
      const newScene = {
        id: generateId(),
        name: `${clipboardData.scene.name} Copy`,
        duration: clipboardData.scene.duration || 5.0,
        transition: clipboardData.scene.transition || 'None',
        layers: [],
      }

      // Insert scene right after the original scene (if original scene ID is stored)
      if (clipboardData.originalSceneId) {
        const originalIndex = state.scenes.findIndex(s => s.id === clipboardData.originalSceneId)
        if (originalIndex !== -1) {
          // Insert right after the original scene
          state.scenes.splice(originalIndex + 1, 0, newScene)
        } else {
          // Original scene not found, append to end
          state.scenes.push(newScene)
        }
      } else {
        // No original scene ID, append to end
        state.scenes.push(newScene)
      }

      // Set as current scene
      state.currentProjectId = newScene.id

      const newLayerIds = []
      const layerIdMap = {} // Map old layer indices to new IDs

      // Create all layers for the new scene
      clipboardData.layers.forEach((layerData, index) => {
        const newLayer = {
          ...layerData,
          id: generateId(),
          sceneId: newScene.id,
          name: layerData.name ? `${layerData.name} Copy` : `Layer Copy`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }

        state.layers[newLayer.id] = newLayer
        newScene.layers.push(newLayer.id)
        newLayerIds.push(newLayer.id)

        // Map old index to new ID
        layerIdMap[index] = newLayer.id
      })


      // Store pasted layer IDs for selection
      state.lastPastedLayerIds = newLayerIds

      // Auto-sync scene duration if pasted scene contains videos
      const hasVideo = clipboardData.layers.some(l => l.type === 'video')
      if (hasVideo) {
        syncSceneVideoDuration(state, newScene.id)
      }
    },

    setBackgroundImage: (state, action) => {
      const { sceneId, imageUrl, originalWidth, originalHeight, originalScaleX, originalScaleY } = action.payload
      const scene = state.scenes.find(s => s.id === sceneId)
      if (scene) {
        const backgroundLayerId = scene.layers.find(layerId => {
          const layer = state.layers[layerId]
          return layer && layer.type === 'background'
        })

        if (backgroundLayerId) {
          const backgroundLayer = state.layers[backgroundLayerId]
          if (backgroundLayer) {
            backgroundLayer.data = {
              ...backgroundLayer.data,
              imageUrl,
              originalWidth,
              originalHeight,
              originalScaleX,
              originalScaleY
            }
            backgroundLayer.updatedAt = Date.now()
          }
        }
      }
    },

    removeBackgroundImage: (state, action) => {
      const { sceneId } = action.payload
      const scene = state.scenes.find(s => s.id === sceneId)
      if (scene) {
        const backgroundLayerId = scene.layers.find(layerId => {
          const layer = state.layers[layerId]
          return layer && layer.type === 'background'
        })

        if (backgroundLayerId) {
          const backgroundLayer = state.layers[backgroundLayerId]
          if (backgroundLayer && backgroundLayer.data) {
            const { imageUrl, ...remainingData } = backgroundLayer.data
            backgroundLayer.data = remainingData
            backgroundLayer.updatedAt = Date.now()
          }
        }
      }
    },

    detachBackgroundImage: (state, action) => {
      const { sceneId, worldWidth = 1920, worldHeight = 1080 } = action.payload
      const scene = state.scenes.find(s => s.id === sceneId)
      if (scene) {
        const backgroundLayerId = scene.layers.find(layerId => {
          const layer = state.layers[layerId]
          return layer && layer.type === 'background'
        })

        if (backgroundLayerId) {
          const backgroundLayer = state.layers[backgroundLayerId]
          const data = backgroundLayer?.data
          const imageUrl = data?.imageUrl

          if (imageUrl) {
            // Create a new image layer
            const newLayerId = uid()

            // Restore original dimensions if available, otherwise default to 80% of canvas
            const width = data.originalWidth || (worldWidth * 0.8)
            const height = data.originalHeight || (worldHeight * 0.8)
            const scaleX = data.originalScaleX !== undefined ? data.originalScaleX : 1
            const scaleY = data.originalScaleY !== undefined ? data.originalScaleY : 1

            const newLayer = {
              id: newLayerId,
              sceneId,
              type: 'image',
              name: 'Detached Background',
              visible: true,
              locked: false,
              opacity: 1.0,
              x: worldWidth / 2,
              y: worldHeight / 2,
              width: width,
              height: height,
              rotation: 0,
              scaleX: scaleX,
              scaleY: scaleY,
              anchorX: 0.5,
              anchorY: 0.5,
              data: {
                url: imageUrl
              },
              createdAt: Date.now(),
              updatedAt: Date.now(),
            }

            state.layers[newLayerId] = newLayer

            // Insert after background layer (which is usually at index 0)
            const bgIndex = scene.layers.indexOf(backgroundLayerId)
            scene.layers.splice(bgIndex + 1, 0, newLayerId)

            // Clear background image after detaching
            backgroundLayer.data = { ...data }
            delete backgroundLayer.data.imageUrl
            delete backgroundLayer.data.originalWidth
            delete backgroundLayer.data.originalHeight
            delete backgroundLayer.data.originalScaleX
            delete backgroundLayer.data.originalScaleY
            backgroundLayer.updatedAt = Date.now()
          }
        }
      }
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchProjectById.pending, (state) => {
        state.status = 'loading'
        state.error = null
      })
      .addCase(fetchProjectById.fulfilled, (state, action) => {
        const { _id, name, data } = action.payload
        state.projectId = _id
        state.projectName = name
        state.scenes = data.scenes || []
        state.layers = data.layers || {}
        state.sceneMotionFlows = data.sceneMotionFlows || {}
        state.aspectRatio = data.aspectRatio || '16:9' // Restore aspect ratio
        state.currentSceneId = state.scenes.length > 0 ? state.scenes[0].id : null
        state.status = 'succeeded'
      })
      .addCase(fetchProjectById.rejected, (state, action) => {
        state.status = 'failed'
        state.error = action.payload || 'Failed to load project'
      })
      // Save project
      .addCase(saveProject.pending, (state) => {
        state.isSaving = true
        state.saveError = null
      })
      .addCase(saveProject.fulfilled, (state, action) => {
        state.projectId = action.payload._id
        state.isSaving = false
        state.saveError = null
      })
      .addCase(saveProject.rejected, (state, action) => {
        state.isSaving = false
        state.saveError = action.payload || 'Failed to save project'
      })
  }
})

export const {
  resetProject,
  setProjectName,
  addScene,
  updateScene,
  deleteScene,
  setCurrentScene,
  reorderScene,
  splitScene,
  addLayer,
  updateLayer,
  deleteLayer,
  duplicateLayer,
  reorderLayer,
  bringLayerToFront,
  sendLayerToBack,
  bringLayerForward,
  sendLayerBackward,
  // Scene-based motion flow actions
  initializeSceneMotionFlow,
  updateSceneMotionFlow,
  addSceneMotionStep,
  updateSceneMotionStep,
  deleteSceneMotionStep,
  reorderSceneMotionSteps,
  addSceneMotionAction,
  updateSceneMotionAction,
  deleteSceneMotionAction,
  duplicateSceneMotionStep,
  clearSceneMotionFlow,
  updateStepTiming,
  startMotionEditing,
  stopMotionEditing,
  initializeProject,
  restoreProjectState,
  copyLayers,
  pasteLayers,
  copyScene,
  pasteScene,
  setBackgroundImage,
  removeBackgroundImage,
  detachBackgroundImage,
  setAspectRatio,
  // Asset loading management
  setLoadingMode,
  startPreparingLayer,
  finishPreparingLayer,
} = projectSlice.actions

// Stable default references to prevent unnecessary rerenders
export const EMPTY_MOTION_FLOW = { steps: [], pageDuration: 6000 }
export const EMPTY_OBJECT = {}
export const EMPTY_ARRAY = []

// Selectors
export const selectProjectId = (state) => state.project.projectId
export const selectProjectName = (state) => state.project.projectName
export const selectAspectRatio = (state) => state.project.aspectRatio
export const selectScenes = (state) => state.project.scenes
export const selectCurrentSceneId = (state) => state.project.currentSceneId
export const selectCurrentScene = (state) => {
  const sceneId = state.project.currentSceneId
  return state.project.scenes.find(s => s.id === sceneId)
}
// Returns all layers in the project
export const selectLayers = (state) => state.project.layers
// Returns the layers for a given scene (memoized for performance)
export const selectLayersByScene = createSelector(
  [
    (state, sceneId) => state.project.scenes.find(s => s.id === sceneId),
    (state) => state.project.layers
  ],
  (scene, layers) => {
    if (!scene) return EMPTY_ARRAY
    return scene.layers.map(layerId => layers[layerId]).filter(Boolean)
  }
)
// Returns the currently selected layer (memoized for performance)
export const selectSelectedLayer = createSelector(
  [selectSelectedLayerId, selectLayers],
  (selectedLayerId, layers) => selectedLayerId ? layers[selectedLayerId] : null
)

// =========================================================================
// Scene Motion Flow selectors
// =========================================================================

// Returns all scene motion flows in the project
export const selectSceneMotionFlows = (state) => state.project.sceneMotionFlows

// Returns the motion flow for a given scene
export const selectSceneMotionFlow = (state, sceneId) => {
  return state.project.sceneMotionFlows[sceneId] || EMPTY_MOTION_FLOW
}

// Returns the motion step for a given scene and step ID
export const selectSceneMotionStep = (state, sceneId, stepId) => {
  const motionFlow = state.project.sceneMotionFlows[sceneId]
  if (!motionFlow) return null
  return motionFlow.steps.find(step => step.id === stepId) || null
}

// Returns all layer actions for a specific step (memoized for performance)
export const selectStepLayerActions = createSelector(
  [(state, sceneId, stepId) => selectSceneMotionStep(state, sceneId, stepId)],
  (step) => {
    if (!step) return EMPTY_OBJECT
    return step.layerActions || EMPTY_OBJECT
  }
)

/**
 * Selector to calculate the global timeline info for all scenes.
 * Returns an array of scenes with their global startTime and endTime in seconds.
 */
export const selectProjectTimelineInfo = createSelector(
  [selectScenes],
  (scenes) => {
    let cumulativeTime = 0
    return scenes.map((scene) => {
      const duration = typeof scene?.duration === 'number' ? scene.duration : 5.0
      const startTime = cumulativeTime
      const endTime = cumulativeTime + duration
      cumulativeTime = endTime
      return {
        ...scene,
        startTime,
        endTime,
        duration
      }
    })
  }
)

/**
 * Selector to get the total project duration in seconds.
 */
export const selectTotalProjectDuration = createSelector(
  [selectProjectTimelineInfo],
  (timelineInfo) => {
    if (timelineInfo.length === 0) return 0
    return timelineInfo[timelineInfo.length - 1].endTime
  }
)

// Returns actions for a specific layer within a step (memoized for performance)
export const selectLayerActionsInStep = createSelector(
  [(state, sceneId, stepId, layerId) => selectSceneMotionStep(state, sceneId, stepId), (state, sceneId, stepId, layerId) => layerId],
  (step, layerId) => {
    if (!step || !step.layerActions) return EMPTY_ARRAY
    return step.layerActions[layerId] || EMPTY_ARRAY
  }
)

// Thunk action to add a layer and automatically select it
export const addLayerAndSelect = (layerConfig) => (dispatch, getState) => {
  // Generate the layer ID first
  const newLayerId = generateId()

  // Add the layer with the pre-generated ID
  dispatch(addLayer({ ...layerConfig, id: newLayerId }))

  // Defer selection to next tick so PIXI objects can be created first
  setTimeout(() => {
    dispatch(setSelectedLayer(newLayerId))
  }, 0)
}

export const selectLastPastedLayerIds = (state) => state.project.lastPastedLayerIds

// Motion Editing Mode selectors
// Returns the motion editing mode state
export const selectMotionEditingMode = (state) => state.project.motionEditingMode
// Returns true if motion editing is active
export const selectIsMotionEditingActive = (state) => state.project.motionEditingMode.isActive
// Returns the scene that is currently being edited
export const selectMotionEditingSceneId = (state) => state.project.motionEditingMode.sceneId
// Returns the step that is currently being edited
export const selectMotionEditingStepId = (state) => state.project.motionEditingMode.stepId
// Returns the initial transforms of all layers captured at edit start
export const selectMotionEditingInitialTransforms = (state) => state.project.motionEditingMode.initialTransforms

// Asset loading selectors
export const selectLoadingMode = (state) => state.project.loadingMode
export const selectPreparingLayers = (state) => state.project.preparingLayers
export const selectIsLayerPreparing = (state, layerId) => !!state.project.preparingLayers[layerId]

// Returns true if any layer with the given asset URL is being prepared
export const selectIsAssetPreparing = createSelector(
  [selectLayers, selectPreparingLayers, (state, assetUrl) => assetUrl],
  (layers, preparingLayers, assetUrl) => {
    if (!assetUrl) return false
    return Object.keys(preparingLayers).some(layerId => {
      const layer = layers[layerId]
      return layer && (layer.data?.url === assetUrl || layer.data?.src === assetUrl)
    })
  }
)

// Save/Load status selectors
export const selectIsSaving = (state) => state.project.isSaving
export const selectSaveError = (state) => state.project.saveError
export const selectProjectStatus = (state) => state.project.status
export const selectProjectError = (state) => state.project.error

export default projectSlice.reducer
