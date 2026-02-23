# Redux Store Documentation

This directory contains the Redux store setup for the Vevara editor application.

## Structure

```
store/
├── index.js              # Store configuration and exports
├── hooks.js              # Typed hooks (useAppDispatch, useAppSelector)
├── slices/
│   ├── projectSlice.js   # Project data (scenes, layers, segments)
│   ├── selectionSlice.js # Selection state
│   └── playbackSlice.js  # Timeline playback state
└── models.js             # Data model definitions
```

## Usage

### Basic Setup

The store is already configured in `src/app/index.jsx` with the `<Provider>` wrapper.

### Using Redux in Components

```javascript
import { useAppDispatch, useAppSelector } from '../store/hooks'
import { addLayer, selectLayersByScene } from '../store/slices/projectSlice'
import { setSelectedLayer } from '../store/slices/selectionSlice'

function MyComponent() {
  const dispatch = useAppDispatch()
  
  // Read from store
  const layers = useAppSelector(state => selectLayersByScene(state, sceneId))
  const selectedLayerId = useAppSelector(state => state.selection.selectedLayerIds[0])
  
  // Dispatch actions
  const handleAddLayer = () => {
    dispatch(addLayer({
      sceneId: currentSceneId,
      type: 'text',
      name: 'My Text Layer',
      x: 100,
      y: 100,
    }))
  }
  
  const handleSelect = (layerId) => {
    dispatch(setSelectedLayer(layerId))
  }
  
  return (
    // ... component JSX
  )
}
```

## Store Slices

### projectSlice

Manages all project data: scenes, layers, and animation segments.

**Actions:**
- `addScene({ name, duration, transition })` - Create new scene
- `updateScene({ id, ...updates })` - Update scene properties
- `deleteScene(sceneId)` - Remove scene
- `setCurrentScene(sceneId)` - Set active scene
- `addLayer({ sceneId, type, ...layerData })` - Create new layer
- `updateLayer({ id, ...updates })` - Update layer properties
- `deleteLayer(layerId)` - Remove layer
- `duplicateLayer(layerId)` - Clone a layer
- `reorderLayer({ sceneId, fromIndex, toIndex })` - Change layer order
- `addSegment({ layerId, startTime, endTime, ...data })` - Add animation segment
- `updateSegment({ layerId, segmentId, ...updates })` - Update segment
- `deleteSegment({ layerId, segmentId })` - Remove segment
- `setProjectName(name)` - Update project name
- `initializeProject(projectData)` - Load saved project

**Selectors:**
- `selectScenes(state)` - All scenes
- `selectCurrentSceneId(state)` - Active scene ID
- `selectCurrentScene(state)` - Active scene object
- `selectLayers(state)` - All layers (object map)
- `selectLayersByScene(state, sceneId)` - Layers for a scene
- `selectSegmentsByLayer(state, layerId)` - Segments for a layer

### selectionSlice

Manages what's currently selected in the editor.

**Actions:**
- `setSelectedScene(sceneId)` - Select a scene
- `setSelectedLayer(layerId)` - Select single layer (clears others)
- `addSelectedLayer(layerId)` - Add to multi-select
- `removeSelectedLayer(layerId)` - Remove from multi-select
- `clearLayerSelection()` - Clear all layer selections
- `setSelectedSegment(segmentId)` - Select animation segment
- `clearSelection()` - Clear everything

**Selectors:**
- `selectSelectedSceneId(state)`
- `selectSelectedLayerIds(state)` - Array of selected layer IDs
- `selectSelectedLayerId(state)` - First selected layer ID (single select)
- `selectSelectedSegmentId(state)`
- `selectHasSelection(state)` - Boolean if anything is selected

### playbackSlice

Manages timeline playback state.

**Actions:**
- `play()` - Start playback
- `pause()` - Stop playback
- `togglePlayPause()` - Toggle play/pause
- `seek(timeMs)` - Jump to time (milliseconds)
- `seekBySeconds(seconds)` - Jump to time (seconds)
- `setFps(fps)` - Change frame rate
- `setLooping(true/false)` - Enable/disable looping
- `setPlaybackSpeed(speed)` - Change playback speed (1.0 = normal)
- `stepForward()` - Move forward one frame
- `stepBackward()` - Move backward one frame
- `reset()` - Reset to beginning and pause

**Selectors:**
- `selectIsPlaying(state)`
- `selectCurrentTimeMs(state)` - Current time in milliseconds
- `selectCurrentTimeSeconds(state)` - Current time in seconds
- `selectFps(state)`
- `selectIsLooping(state)`
- `selectPlaybackSpeed(state)`

## Data Models

See `models.js` for complete type definitions:

- **Scene**: Composition/timeline with layers
- **Layer**: Single element (text, shape, image, video, etc.)
- **Segment**: Animation segment with keyframes
- **Keyframe**: Single animation point

## DevTools

Redux DevTools are enabled in development. Install the browser extension:
- [Chrome](https://chrome.google.com/webstore/detail/redux-devtools/lmhkpmbekcpmknklioeibfkpmmfibljd)
- [Firefox](https://addons.mozilla.org/en-US/firefox/addon/reduxdevtools/)

