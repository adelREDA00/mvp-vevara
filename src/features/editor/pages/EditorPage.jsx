import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Layers } from 'lucide-react'
import Stage from '../components/Stage'
import { addScene, selectScenes, selectCurrentSceneId, selectCurrentScene, updateScene, deleteScene, deleteLayer, selectLayers, updateLayer, copyLayers, pasteLayers, copyScene, pasteScene, selectLastPastedLayerIds, addSceneMotionStep, deleteSceneMotionStep, selectSceneMotionFlow, initializeSceneMotionFlow, selectProjectTimelineInfo, addSceneMotionAction, updateSceneMotionAction, deleteSceneMotionAction } from '../../../store/slices/projectSlice'
import { selectSelectedLayerIds, selectSelectedCanvas, clearLayerSelection, setSelectedLayer } from '../../../store/slices/selectionSlice'
import { undo, redo } from '../../../store/slices/historySlice'
import MotionInspector from '../components/MotionInspector'
import MotionPanel from '../components/MotionPanel'
import TopToolbar from '../components/TopToolbar'
import LeftSidebar from '../components/LeftSidebar'
import ScenesBar from '../components/ScenesBar'
import CanvasControls from '../components/CanvasControls'
import PlaybackControls from '../components/PlaybackControls'
import ElementsPanel from '../components/ElementsPanel'
import DesignPanel from '../components/DesignPanel'
import TextPanel from '../components/TextPanel'
import UploadsPanel from '../components/UploadsPanel'
import ToolsPanel from '../components/ToolsPanel'
import ProjectsPanel from '../components/ProjectsPanel'
import AppsPanel from '../components/AppsPanel'
import ColorPickerPanel from '../components/ColorPickerPanel'
import { useEditorSidebar } from '../hooks/useEditorSidebar'
import { useEditorPlayback } from '../hooks/useEditorPlayback'
import { useEditorLayout } from '../hooks/useEditorLayout'
import { useWorldDimensions } from '../hooks/useWorldDimensions'
import { applyTransformInline } from '../hooks/useCanvasLayers'

function EditorPage() {
  const dispatch = useDispatch()
  const scenes = useSelector(selectScenes)
  const currentSceneId = useSelector(selectCurrentSceneId)
  const selectedLayerIds = useSelector(selectSelectedLayerIds)
  const selectedCanvas = useSelector(selectSelectedCanvas)
  const layers = useSelector(selectLayers)

  const lastPastedLayerIds = useSelector(selectLastPastedLayerIds)

  const [aspectRatio, setAspectRatio] = useState('16:9')
  const [showGrid, setShowGrid] = useState(false)
  const [showSafeArea, setShowSafeArea] = useState(false)
  const [showMotionPaths, setShowMotionPaths] = useState(false)
  const [zoom, setZoom] = useState(43)
  const zoomRef = useRef(43) // Ref to track current zoom without causing re-renders
  const prevZoomRef = useRef(43) // Track previous zoom to detect changes

  // Keep zoomRef in sync with zoom state
  useEffect(() => {
    zoomRef.current = zoom
    // Initialize prevZoomRef on first render
    if (prevZoomRef.current === 43 && zoom !== 43) {
      prevZoomRef.current = zoom
    }
  }, [zoom])
  const [editingTextLayerId, setEditingTextLayerId] = useState(null)
  const [activeTool, setActiveTool] = useState('select')
  const [projectName, setProjectName] = useState('Untitled Project')
  const [lastSaved, setLastSaved] = useState(Date.now())
  const [colorPickerType, setColorPickerType] = useState('fill') // 'fill' or 'text' or 'stroke'
  const [sidebarWidth, setSidebarWidth] = useState('3.5rem')
  const [isMotionPanelOpen, setIsMotionPanelOpen] = useState(false)
  const [motionCaptureMode, setMotionCaptureMode] = useState(null)
  const [motionControls, setMotionControls] = useState(null)
  const hasInitializedScene = useRef(false)

  const handleFinishEditing = useCallback(() => {
    setEditingTextLayerId(null)
  }, [])

  // Finish text editing when zoom changes
  useEffect(() => {
    if (editingTextLayerId && zoom !== prevZoomRef.current) {
      handleFinishEditing()
    }
    prevZoomRef.current = zoom
  }, [zoom, editingTextLayerId, handleFinishEditing])

  // Finish text editing when selection changes (another layer selected or canvas clicked)
  useEffect(() => {
    if (editingTextLayerId) {
      // If canvas is selected, finish editing
      if (selectedCanvas) {
        handleFinishEditing()
        return
      }

      // If another layer is selected (not the one being edited), finish editing
      if (selectedLayerIds && selectedLayerIds.length > 0 && !selectedLayerIds.includes(editingTextLayerId)) {
        handleFinishEditing()
        return
      }

      // If no layers are selected, finish editing
      if (!selectedLayerIds || selectedLayerIds.length === 0) {
        handleFinishEditing()
        return
      }
    }
  }, [selectedLayerIds, selectedCanvas, editingTextLayerId, handleFinishEditing])




  // =============================================================================
  // SIDEBAR AND PLAYBACK CONTROLS
  // =============================================================================
  const {
    activeSidebarItem,
    setActiveSidebarItem,
    handleSidebarItemClick,
    handleClosePanel,
  } = useEditorSidebar()

  const {
    playheadTime,
    setPlayheadTime,
    playheadTimeRef,
    isPlaying,
    setIsPlaying,
    segments,
    totalTime,
    formatTime,
    handleAddSegment,
    handleUpdateSegment,
    handleDeleteSegment,
    handleDuplicateSegment,
    handleToggleSegmentBypass,
  } = useEditorPlayback(scenes)

  const {
    topToolbarRef,
    topControlsRef,
    canvasScrollRef,
    bottomSectionRef,
    playbackControlsRef,
    scenesBarRef,
    bottomControlsRef,
    bottomSectionHeight,
    topToolbarHeight,
    customBottomHeight,
    isResizingBottom,
    handleBottomResizeMouseDown,
  } = useEditorLayout({ aspectRatio, selectedLayerIds })

  // Centralized seek function to sync UI and Engine
  const seek = useCallback((time) => {
    const clampedTime = Math.max(0, Math.min(time, totalTime))
    if (motionControls) {
      motionControls.seek(clampedTime)
    } else {
      setPlayheadTime(clampedTime)
      playheadTimeRef.current = clampedTime
    }
  }, [motionControls, totalTime, setPlayheadTime, playheadTimeRef])

  const handleMotionStop = useCallback(() => {
    if (motionControls) {
      motionControls.stopAll()
    }
  }, [motionControls])

  // Initialize default scene if none exists (only once)
  useEffect(() => {
    if (!hasInitializedScene.current && scenes.length === 0) {
      hasInitializedScene.current = true
      dispatch(addScene({
        name: 'Scene 1',
        duration: 5.0,
        transition: 'None',
      }))
    }
  }, [dispatch, scenes.length])

  // Get current scene data from Redux
  const currentSceneData = useSelector(selectCurrentScene)

  // Calculate aspect ratio from width and height (simplified to lowest terms)
  const calculateAspectRatio = (width, height) => {
    const gcd = (a, b) => b === 0 ? a : gcd(b, a % b)
    const divisor = gcd(width, height)
    const simplifiedWidth = width / divisor
    const simplifiedHeight = height / divisor
    return `${simplifiedWidth}:${simplifiedHeight}`
  }

  // Handle canvas size change
  const handleCanvasSizeChange = (width, height) => {
    const newAspectRatio = calculateAspectRatio(width, height)
    setAspectRatio(newAspectRatio)
  }

  // Calculate current world dimensions based on aspect ratio
  const { worldWidth, worldHeight } = useWorldDimensions(aspectRatio)



  // -------------------------------------------------------------------
  // TEXT EDITING
  // -------------------------------------------------------------------
  // Handle text editing
  const handleTextChange = useCallback((text) => {
    if (editingTextLayerId && layers[editingTextLayerId]) {
      dispatch(updateLayer({
        id: editingTextLayerId,
        data: { ...layers[editingTextLayerId].data, content: text }
      }))
    }
  }, [editingTextLayerId, layers, dispatch])

  const startTextEditing = useCallback((layerId) => {
    setEditingTextLayerId(layerId)
  }, [editingTextLayerId])

  // -------------------------------------------------------------------
  // MOTION CAPTURE CONTROLS (from CanvasControls)
  // -------------------------------------------------------------------
  // State for tracking the current editing step (created via CanvasControls)
  const [editingStepId, setEditingStepId] = useState(null)
  const isNewStepRef = useRef(false) // Track if the current session is for a NEW step vs editing an EXISTING one
  const motionCaptureRef = useRef(null) // Ref to hold capture data for apply/cancel
  const motionControlsRef = useRef(null) // Ref to hold motion playback controls from Stage

  // Get motion flow for current scene
  const currentSceneMotionFlow = useSelector((state) =>
    currentSceneId ? selectSceneMotionFlow(state, currentSceneId) : null
  )

  // Get timeline info for seeking
  const timelineInfo = useSelector(selectProjectTimelineInfo)
  const currentSceneTimelineInfo = useMemo(() => {
    if (!timelineInfo || !currentSceneId) return null
    return timelineInfo.find(s => s.id === currentSceneId)
  }, [timelineInfo, currentSceneId])
  const startTimeOffset = currentSceneTimelineInfo?.startTime || 0

  // Check if motion capture is active
  const isMotionCaptureActive = !!motionCaptureMode?.isActive

  // Effect: Exit motion capture mode when switching scenes
  // We use a ref to track the previous scene ID to detect changes
  const prevSceneIdRef = useRef(currentSceneId)

  useEffect(() => {
    // If scene changed and we are in motion capture mode, cancel it
    if (prevSceneIdRef.current !== currentSceneId) {
      if (motionCaptureRef.current) { // Check if we were capturing
        console.log('🔄 [EditorPage] Scene switched, cancelling active motion capture')

        // 1. Remove the tentative step
        if (motionCaptureRef.current.stepId) {
          dispatch(deleteSceneMotionStep({
            sceneId: prevSceneIdRef.current, // Use previous scene ID
            stepId: motionCaptureRef.current.stepId
          }))
        }

        // [CROP FIX] Reset all PIXI objects to their base Redux state when scene switches
        // This prevents crop values from persisting across scene changes
        if (motionControls && motionControls.layerObjects && layers) {
          const layerObjects = motionControls.layerObjects
          layerObjects.forEach((pixiObject, layerId) => {
            const baseLayerData = layers[layerId]
            if (baseLayerData && pixiObject && !pixiObject.destroyed) {
              // Force reset to base Redux state
              applyTransformInline(pixiObject, baseLayerData, null, layerId, null, true)
            }
          })
        }

        // 2. Reset local state
        setMotionCaptureMode({ isActive: false, trackedLayers: new Map(), onPositionUpdate: null, layerActions: {} })
        setEditingStepId(null)
        motionCaptureRef.current = null
      }
    }

    // Update ref
    prevSceneIdRef.current = currentSceneId
  }, [currentSceneId, dispatch, motionControls, layers])

  /**
   * Start motion capture: auto-add a new step and enter capture mode
   */
  const handleStartMotionCapture = useCallback(() => {
    if (!currentSceneId) return

    // 1. Ensure motion flow exists
    dispatch(initializeSceneMotionFlow({ sceneId: currentSceneId }))

    // 2. Create a new step ID
    const newStepId = `step-${Date.now()}`

    // 3. Dispatch action to add the step
    dispatch(addSceneMotionStep({
      sceneId: currentSceneId,
      stepId: newStepId
    }))

    // 4. Store the step ID for tracking
    setEditingStepId(newStepId)
    isNewStepRef.current = true // Mark as NEWLY created step

    // 5. Build initial tracked layers map for capture mode
    const initialTrackedLayers = new Map()

    // Get the current motion flow (before the new step we just added)
    const existingFlow = currentSceneMotionFlow?.steps || []
    const stepIndex = existingFlow.length // New step will be at this index

    Object.keys(layers).forEach((layerId) => {
      const layer = layers[layerId]
      if (!layer) return

      // Calculate cumulative transformation from all PREVIOUS steps
      let currentX = layer.x || 0
      let currentY = layer.y || 0
      let currentScaleX = layer.scaleX !== undefined ? layer.scaleX : 1
      let currentScaleY = layer.scaleY !== undefined ? layer.scaleY : 1
      let currentRotation = layer.rotation || 0
      let currentCropX = layer.cropX || 0
      let currentCropY = layer.cropY || 0
      let currentCropWidth = layer.cropWidth || layer.width || 100
      let currentCropHeight = layer.cropHeight || layer.height || 100
      const layerObject = motionControls?.layerObjects?.get?.(layerId)
      let currentMediaWidth = layer.mediaWidth || layerObject?._mediaWidth || layerObject?._originalWidth || layer.width || 100
      let currentMediaHeight = layer.mediaHeight || layerObject?._mediaHeight || layerObject?._originalHeight || layer.height || 100

      for (let i = 0; i < stepIndex; i++) {
        const prevStep = existingFlow[i]
        const actions = prevStep.layerActions?.[layerId] || []

        const moveAction = actions.find(a => a.type === 'move')
        const scaleAction = actions.find(a => a.type === 'scale')
        const rotateAction = actions.find(a => a.type === 'rotate')
        const cropAction = actions.find(a => a.type === 'crop')

        if (moveAction) {
          // Add relative delta values
          currentX += moveAction.values?.dx || 0
          currentY += moveAction.values?.dy || 0
        } else if (cropAction && cropAction.values?.dx !== undefined) {
          // BUNDLED POSITION FALLBACK: If no move action exists, check if position was bundled in crop
          currentX += cropAction.values.dx
          currentY += cropAction.values.dy
        }

        if (scaleAction) {
          // Multiply relative scale multipliers
          currentScaleX *= (scaleAction.values?.dsx !== undefined ? scaleAction.values.dsx : 1)
          currentScaleY *= (scaleAction.values?.dsy !== undefined ? scaleAction.values.dsy : 1)
        }

        if (rotateAction) {
          // Add relative rotation angle
          currentRotation += rotateAction.values?.dangle ?? 0
        }

        if (cropAction) {
          // Crop properties are typically absolute transformations within the step
          currentCropX = cropAction.values?.cropX !== undefined ? cropAction.values.cropX : currentCropX
          currentCropY = cropAction.values?.cropY !== undefined ? cropAction.values.cropY : currentCropY
          currentCropWidth = cropAction.values?.cropWidth !== undefined ? cropAction.values.cropWidth : currentCropWidth
          currentCropHeight = cropAction.values?.cropHeight !== undefined ? cropAction.values.cropHeight : currentCropHeight
          currentMediaWidth = cropAction.values?.mediaWidth !== undefined ? cropAction.values.mediaWidth : currentMediaWidth
          currentMediaHeight = cropAction.values?.mediaHeight !== undefined ? cropAction.values.mediaHeight : currentMediaHeight
        }
      }

      // Session start transform (end of previous steps)
      const sessionStartTransform = {
        x: currentX,
        y: currentY,
        width: currentCropWidth,
        height: currentCropHeight,
        scaleX: currentScaleX,
        scaleY: currentScaleY,
        rotation: currentRotation,
        // Track accumulated crop properties
        cropX: currentCropX,
        cropY: currentCropY,
        cropWidth: currentCropWidth,
        cropHeight: currentCropHeight,
        mediaWidth: currentMediaWidth,
        mediaHeight: currentMediaHeight
      }

      // Apply any existing crop action values from previous steps
      // Note: In this simplified loop we aren't iterating through every single previous action type for crop
      // differently than move/scale, but if we did, we'd update these values here.
      // For now, we assume the layer state + standard properties cover the base state.
      // If we need strict per-step reconstruction for crop, we'd add crop logic to the 'for' loop above.
      // Given crop is new, let's just ensure we capture the CURRENT layer state as the start.

      initialTrackedLayers.set(layerId, {
        initialTransform: sessionStartTransform,
        currentPosition: { x: currentX, y: currentY },
        deltaX: 0,
        deltaY: 0,
        width: sessionStartTransform.width,
        height: sessionStartTransform.height,
        scaleX: sessionStartTransform.scaleX,
        scaleY: sessionStartTransform.scaleY,
        rotation: sessionStartTransform.rotation,
        // Detailed crop state tracking
        // Detailed crop state tracking - Use calculated defaults to prevent 'undefined'
        cropX: currentCropX,
        cropY: currentCropY,
        cropWidth: currentCropWidth,
        cropHeight: currentCropHeight,
        mediaWidth: currentMediaWidth,
        mediaHeight: currentMediaHeight,
        interactionType: null,
        didMove: false
      })
    })

    // 6. Store capture data in ref for later use
    motionCaptureRef.current = {
      stepId: newStepId,
      trackedLayers: initialTrackedLayers
    }

    // 7. Fast-play through all previous steps to animate to the start of the new step
    // 7. Fast-play through all previous steps to animate to the start of the new step
    const enableCaptureMode = () => {
      // Synchronize initialTrackedLayers with ACTUAL visual state from PIXI
      // This ensures that if the animation ended slightly off from the calculated position,
      // we snap the logical state to the visual state, preventing a visual jump.
      // [CROP FIX] DO NOT sync crop values from PIXI objects - they may contain stale values
      // from canceled capture sessions. Crop values should ONLY come from Redux layers and
      // calculated previous steps, not from PIXI objects which can have leaked state.
      if (motionControls && motionControls.getLayerCurrentTransforms) {
        const currentTransforms = motionControls.getLayerCurrentTransforms()

        // Update tracked layers with actual visual state
        currentTransforms.forEach((transform, layerId) => {
          if (initialTrackedLayers.has(layerId)) {
            const entry = initialTrackedLayers.get(layerId)

            // Log discrepancy for debugging
            // const dx = transform.x - entry.initialTransform.x
            // const dy = transform.y - entry.initialTransform.y
            // if (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1) console.log(`Aligning layer ${layerId}: dx=${dx}, dy=${dy}`)

            // Update the entry with actual visual coordinates
            entry.initialTransform.x = transform.x
            entry.initialTransform.y = transform.y
            entry.initialTransform.rotation = transform.rotation
            entry.initialTransform.scaleX = transform.scaleX
            entry.initialTransform.scaleY = transform.scaleY

            entry.currentPosition.x = transform.x
            entry.currentPosition.y = transform.y
            entry.rotation = transform.rotation
            entry.scaleX = transform.scaleX
            entry.scaleY = transform.scaleY

            // [CROP FIX] DO NOT sync crop values from PIXI objects - use only calculated values from Redux
            // Crop values are already correctly calculated from Redux layers and previous steps above.
            // Syncing from PIXI would reintroduce stale crop values from canceled sessions.
            // Crop values should remain as calculated from sessionStartTransform (lines 369-385)
          }
        })
      }

      // Update ref with synchronized data
      motionCaptureRef.current = {
        stepId: newStepId,
        trackedLayers: initialTrackedLayers
      }

      // 8. Set motion capture mode (this will be picked up by MotionPanel via onMotionEditingChange)
      setMotionCaptureMode({
        isActive: true,
        stepId: newStepId, // CRITICAL: Ensure stepId is set for global interactions!
        onPositionUpdate: (data) => {
          // Update tracked layers
          const { layerId, x, y, scaleX, scaleY, rotation, interactionType } = data
          if (!layerId || !motionCaptureRef.current) return

          const trackedLayers = motionCaptureRef.current.trackedLayers
          const existingEntry = trackedLayers.get(layerId)
          if (!existingEntry) return

          const initialTotalX = existingEntry.initialTransform.x
          const initialTotalY = existingEntry.initialTransform.y

          const nextEntry = {
            ...existingEntry,
            interactionType: interactionType !== undefined ? interactionType : existingEntry.interactionType,
            didMove: (interactionType === 'move' && (Math.abs(x - initialTotalX) > 0.5 || Math.abs(y - initialTotalY) > 0.5)) || existingEntry.didMove
          }

          if (x !== undefined && y !== undefined) {
            nextEntry.currentPosition = { x, y }
            nextEntry.deltaX = x - initialTotalX
            nextEntry.deltaY = y - initialTotalY
          }

          if (scaleX !== undefined) nextEntry.scaleX = scaleX
          if (scaleY !== undefined) nextEntry.scaleY = scaleY
          if (rotation !== undefined) nextEntry.rotation = rotation

          // Create crop properties in capture data
          if (data.cropX !== undefined) nextEntry.cropX = data.cropX
          if (data.cropY !== undefined) nextEntry.cropY = data.cropY
          if (data.cropWidth !== undefined) nextEntry.cropWidth = data.cropWidth
          if (data.cropHeight !== undefined) nextEntry.cropHeight = data.cropHeight
          if (data.mediaWidth !== undefined) nextEntry.mediaWidth = data.mediaWidth
          if (data.mediaHeight !== undefined) nextEntry.mediaHeight = data.mediaHeight
          
          // [CONTROL POINTS FIX] Only update control points if explicitly provided (not undefined/null)
          // This preserves existing control points when updating position/scale/rotate without curve edits
          // Control points are arrays, so we check for array type to distinguish from undefined
          if (data.controlPoints !== undefined && Array.isArray(data.controlPoints)) {
            nextEntry.controlPoints = data.controlPoints
          } else if (data.controlPoints === null) {
            // Explicitly clear control points if null is passed
            nextEntry.controlPoints = []
          }
          // If controlPoints is undefined, preserve existing value (don't overwrite)

          trackedLayers.set(layerId, nextEntry)
        },
        trackedLayers: initialTrackedLayers, // Pass the synchronized map
        layerActions: {}
      })
    }

    if (motionControls && stepIndex > 0) {
      const pageDuration = currentSceneMotionFlow?.pageDuration || 5000
      const stepCount = existingFlow.length + 1 // Include new step
      const stepDuration = stepCount > 0 ? pageDuration / stepCount : pageDuration
      const stepStartTimeSeconds = startTimeOffset + (stepIndex * stepDuration) / 1000

      // OPTIMIZATION: Create detailed optimistic flow to ensure accurate preview
      // We manually construct the flow with updated durations to avoid "drift"
      // caused by animating with old 5s steps to a 2.5s timestamp.
      const optimisticSteps = existingFlow.map(step => {
        const newStep = { ...step, layerActions: {} }
        if (step.layerActions) {
          Object.keys(step.layerActions).forEach(layerId => {
            // Update action durations
            newStep.layerActions[layerId] = step.layerActions[layerId].map(action => ({
              ...action,
              values: { ...action.values, duration: stepDuration }
            }))
          })
        }
        return newStep
      })

      // Add the new empty step to complete the flow structure
      optimisticSteps.push({ id: newStepId, layerActions: {} })

      const optimisticFlow = {
        ...currentSceneMotionFlow,
        steps: optimisticSteps
      }

      // Animate from scene start to the start of the new step (fast-play previous steps)
      console.log(`🎬 [EditorPage] Fast-play previous ${stepIndex} steps: 0s -> ${stepStartTimeSeconds}s`)

      // Use a Promise-like approach or onComplete if supported
      // We assume tweenTo supports onComplete in its options or returns a promise
      try {
        const tweenResult = motionControls.tweenTo(stepStartTimeSeconds, {
          duration: Math.min(stepIndex * 0.3, 1.5), // Quick animation: 0.3s per step, max 1.5s
          startTime: startTimeOffset,
          flow: optimisticFlow, // Use the optimistic flow with correct durations
          onComplete: () => {
            console.log('✅ [EditorPage] Fast-play complete, enabling capture mode')
            enableCaptureMode()
          }
        })

        // Fallback: If onComplete isn't called for some reason (e.g. immediate return), 
        // ensure we enable capture mode. But GSAP onComplete is reliable.
      } catch (e) {
        console.error('Fast-play error:', e)
        enableCaptureMode()
      }
    } else if (motionControls) {
      // No previous steps, just seek to start
      motionControls.seek(startTimeOffset)
      enableCaptureMode()
    } else {
      enableCaptureMode()
    }
  }, [currentSceneId, currentSceneMotionFlow, layers, dispatch, motionControls, startTimeOffset])

  /**
   * Apply captured motion and exit capture mode
   */
  const handleApplyMotion = useCallback((options = {}) => {
    // Check if we have captured motion data
    if (!motionCaptureMode || !motionCaptureMode.trackedLayers || motionCaptureMode.trackedLayers.size === 0) {
      // Nothing was captured, just cancel and delete the empty step
      if (editingStepId && currentSceneId) {
        dispatch(deleteSceneMotionStep({
          sceneId: currentSceneId,
          stepId: editingStepId
        }))
      }
      setMotionCaptureMode(null)
      setEditingStepId(null)
      motionCaptureRef.current = null
      return
    }

    const stepId = editingStepId
    if (!stepId || !currentSceneId) {
      setMotionCaptureMode(null)
      setEditingStepId(null)
      motionCaptureRef.current = null
      return
    }

    // [RACE CONDITION FIX] Get the current step to check for existing actions
    // Redux updates are synchronous, but React re-renders are async, so currentSceneMotionFlow
    // might be from a previous render. We'll build the preview optimistically anyway.
    const currentFlow = currentSceneMotionFlow || { steps: [] }
    const step = currentFlow.steps?.find(s => s.id === stepId)

    // Dispatch updates to Redux for each tracked layer
    motionCaptureMode.trackedLayers.forEach((layerData, layerId) => {
      const { deltaX, deltaY, scaleX, scaleY, rotation, initialTransform, didMove } = layerData

      const existingLayerActions = step?.layerActions?.[layerId] || []
      const moveAction = existingLayerActions.find(a => a.type === 'move')
      const scaleAction = existingLayerActions.find(a => a.type === 'scale')
      const rotateAction = existingLayerActions.find(a => a.type === 'rotate')

      // Position (Absolute position)
      const targetX = (initialTransform?.x || 0) + (deltaX || 0)
      const targetY = (initialTransform?.y || 0) + (deltaY || 0)

      // Sync Crop
      const { cropX, cropY, cropWidth, cropHeight, mediaWidth, mediaHeight } = layerData
      const cropAction = existingLayerActions.find(a => a.type === 'crop')

      const initialCropX = initialTransform?.cropX || 0
      const initialCropY = initialTransform?.cropY || 0
      const initialCropW = initialTransform?.cropWidth || 100
      const initialCropH = initialTransform?.cropHeight || 100

      const hasCropChanged = (
        (cropX !== undefined && Math.abs(cropX - initialCropX) > 0.1) ||
        (cropY !== undefined && Math.abs(cropY - initialCropY) > 0.1) ||
        (cropWidth !== undefined && Math.abs(cropWidth - initialCropW) > 0.1) ||
        (cropHeight !== undefined && Math.abs(cropHeight - initialCropH) > 0.1)
      )

      // Only create/update MOVE action if:
      // 1. User explicitly moved the layer (interactionType 'move' recorded in didMove)
      // 2. OR the layer has control points (curved path being edited)
      const hasControlPoints = (layerData.controlPoints && layerData.controlPoints.length > 0)
      const shouldUpdateMoveAction = (didMove || hasControlPoints) && (Math.abs(deltaX || 0) > 0.1 || Math.abs(deltaY || 0) > 0.1 || hasControlPoints)

      // BUNDLE POSITION INFO INTO CROP ACTION (Pivot Shift Compensation)
      const cropValues = hasCropChanged ? {
        cropX: cropX ?? initialCropX,
        cropY: cropY ?? initialCropY,
        cropWidth: cropWidth ?? initialCropW,
        cropHeight: cropHeight ?? initialCropH,
        mediaWidth: mediaWidth ?? initialTransform?.mediaWidth,
        mediaHeight: mediaHeight ?? initialTransform?.mediaHeight,
        // Only pass dx/dy directly to CropAction if MoveAction isn't managing it.
        // This prevents GSAP overwrite conflicts where CropAction's x/y tweens kill the MoveAction curve.
        dx: (shouldUpdateMoveAction || moveAction) ? undefined : deltaX,
        dy: (shouldUpdateMoveAction || moveAction) ? undefined : deltaY,
        easing: 'power4.out'
      } : null

      if (shouldUpdateMoveAction) {
        if (moveAction) {
          dispatch(updateSceneMotionAction({
            sceneId: currentSceneId, stepId, layerId, actionId: moveAction.id,
            values: {
              ...moveAction.values,
              dx: deltaX,
              dy: deltaY,
              controlPoints: layerData.controlPoints || moveAction.values?.controlPoints || []
            }
          }))
        } else {
          dispatch(addSceneMotionAction({
            sceneId: currentSceneId, stepId, layerId, actionId: `action-${Date.now()}-move-${layerId}`,
            type: 'move', values: {
              dx: deltaX,
              dy: deltaY,
              controlPoints: layerData.controlPoints || [],
              easing: 'power4.out'
            }
          }))
        }
      }

      // Scale (Absolute scale values)
      if (scaleX !== undefined && scaleY !== undefined) {
        const initialScaleX = initialTransform?.scaleX || 1
        const initialScaleY = initialTransform?.scaleY || 1
        const isInitialScale = Math.abs(scaleX - initialScaleX) <= 0.001 && Math.abs(scaleY - initialScaleY) <= 0.001

        if (!isInitialScale) {
          if (scaleAction) {
            dispatch(updateSceneMotionAction({
              sceneId: currentSceneId, stepId, layerId, actionId: scaleAction.id,
              values: { ...scaleAction.values, dsx: scaleX / initialScaleX, dsy: scaleY / initialScaleY }
            }))
          } else {
            dispatch(addSceneMotionAction({
              sceneId: currentSceneId, stepId, layerId, actionId: `action-${Date.now()}-scale-${layerId}`,
              type: 'scale', values: { dsx: scaleX / initialScaleX, dsy: scaleY / initialScaleY, easing: 'power4.out' }
            }))
          }
        } else if (scaleAction) {
          // If returned to initial scale, delete the existing action
          dispatch(deleteSceneMotionAction({ sceneId: currentSceneId, stepId, layerId, actionId: scaleAction.id }))
        }
      }

      // Rotate
      const initialRotation = initialTransform?.rotation || 0
      const isInitialRotation = Math.abs(rotation - initialRotation) <= 0.1

      if (rotation !== undefined && !isInitialRotation) {
        if (rotateAction) {
          dispatch(updateSceneMotionAction({
            sceneId: currentSceneId, stepId, layerId, actionId: rotateAction.id,
            values: { ...rotateAction.values, dangle: rotation - initialRotation }
          }))
        } else {
          dispatch(addSceneMotionAction({
            sceneId: currentSceneId, stepId, layerId, actionId: `action-${Date.now()}-rotate-${layerId}`,
            type: 'rotate', values: { dangle: rotation - initialRotation, easing: 'power4.out' }
          }))
        }
      } else if (rotateAction && isInitialRotation) {
        // If returned to initial rotation, delete the existing action
        dispatch(deleteSceneMotionAction({ sceneId: currentSceneId, stepId, layerId, actionId: rotateAction.id }))
      }

      if (hasCropChanged) {
        if (cropAction) {
          dispatch(updateSceneMotionAction({
            sceneId: currentSceneId, stepId, layerId, actionId: cropAction.id,
            values: { ...cropAction.values, ...cropValues }
          }))
        } else {
          dispatch(addSceneMotionAction({
            sceneId: currentSceneId, stepId, layerId, actionId: `action-${Date.now()}-crop-${layerId}`,
            type: 'crop', values: cropValues
          }))
        }
      }
    })

    // =======================================================================
    // FAST-PLAY PREVIEW: Trigger animated transition for visual feedback
    // =======================================================================
    if (motionControls && !options?.skipPreview) {
      const currentFlow = currentSceneMotionFlow || { steps: [], pageDuration: 5000 }
      const motionFlow = currentFlow.steps || []
      const stepIndex = motionFlow.findIndex(s => s.id === stepId)
      const pageDuration = currentFlow.pageDuration || 5000
      const stepCount = motionFlow.length
      const stepDuration = stepCount > 0 ? pageDuration / stepCount : pageDuration
      const stepStartTimeSeconds = startTimeOffset + (stepIndex * stepDuration) / 1000
      const calculatedEndTime = startTimeOffset + ((stepIndex + 1) * stepDuration) / 1000
      // Clamp to scene boundary
      const sceneEndTime = currentSceneTimelineInfo?.endTime || calculatedEndTime
      const stepEndTimeSeconds = Math.min(calculatedEndTime, sceneEndTime - 0.01)

      // Build updated flow for transition preview
      // [PERFORMANCE] Use structured clone for better performance than JSON.parse/stringify
      const updatedSteps = (typeof structuredClone !== 'undefined') 
        ? structuredClone(motionFlow) 
        : JSON.parse(JSON.stringify(motionFlow))
      const targetStep = updatedSteps[stepIndex]
      if (targetStep) {
        if (!targetStep.layerActions) targetStep.layerActions = {}
        motionCaptureMode.trackedLayers.forEach((layerData, layerId) => {
          const { deltaX, deltaY, scaleX, scaleY, rotation, initialTransform, didMove } = layerData
          const actions = targetStep.layerActions[layerId] || []

          // [CONTROL POINTS FIX] Get existing move action from ORIGINAL flow to preserve control points
          // The deep copy might be stale, so we check the original flow first
          const originalStep = motionFlow[stepIndex]
          const originalMoveAction = originalStep?.layerActions?.[layerId]?.find(a => a.type === 'move')
          const existingMoveAction = actions.find(a => a.type === 'move')
          
          // Priority: layerData.controlPoints > originalMoveAction.controlPoints > existingMoveAction.controlPoints
          const preservedControlPoints = layerData.controlPoints?.length > 0 
            ? layerData.controlPoints 
            : (originalMoveAction?.values?.controlPoints?.length > 0 
              ? originalMoveAction.values.controlPoints 
              : (existingMoveAction?.values?.controlPoints || []))

          const targetX = (initialTransform?.x || 0) + (deltaX || 0)
          const targetY = (initialTransform?.y || 0) + (deltaY || 0)

          // CROP PREVIEW
          const { cropX, cropY, cropWidth, cropHeight, mediaWidth, mediaHeight } = layerData
          const initialCropX = initialTransform?.cropX || 0
          const initialCropY = initialTransform?.cropY || 0
          const initialCropW = initialTransform?.cropWidth || 100
          const initialCropH = initialTransform?.cropHeight || 100

          const hasCropChanged = (
            (cropX !== undefined && Math.abs(cropX - initialCropX) > 0.1) ||
            (cropY !== undefined && Math.abs(cropY - initialCropY) > 0.1) ||
            (cropWidth !== undefined && Math.abs(cropWidth - initialCropW) > 0.1) ||
            (cropHeight !== undefined && Math.abs(cropHeight - initialCropH) > 0.1)
          )

          // [CONSOLIDATED MOVE ACTION] Single unified logic for move action building
          // Control points take priority - if they exist, we MUST include move action
          const hasControlPoints = preservedControlPoints.length > 0
          const hasSignificantMovement = Math.abs(deltaX || 0) > 0.1 || Math.abs(deltaY || 0) > 0.1
          const shouldIncludeMoveAction = (didMove || hasControlPoints || !hasCropChanged) && (hasSignificantMovement || hasControlPoints)

          if (shouldIncludeMoveAction) {
            const moveIdx = actions.findIndex(a => a.type === 'move')
            const existingValues = existingMoveAction?.values || {}

            const moveAction = {
              type: 'move',
              values: {
                ...existingValues,
                dx: deltaX,
                dy: deltaY,
                // [CRITICAL] Always preserve control points - they define the curve path
                controlPoints: preservedControlPoints,
                duration: stepDuration,
                easing: 'power4.out'
              }
            }
            if (moveIdx !== -1) {
              actions[moveIdx] = moveAction
            } else {
              actions.push(moveAction)
            }
          } else {
            // Remove move action if it's not needed and doesn't have control points
            const moveIdx = actions.findIndex(a => a.type === 'move')
            if (moveIdx !== -1 && !hasControlPoints) {
              actions.splice(moveIdx, 1)
            }
          }

          // Scale action
          if (scaleX !== undefined && scaleY !== undefined) {
            const initialScaleX = initialTransform?.scaleX || 1
            const initialScaleY = initialTransform?.scaleY || 1
            if (Math.abs(scaleX - initialScaleX) > 0.001 || Math.abs(scaleY - initialScaleY) > 0.001) {
              const scaleIdx = actions.findIndex(a => a.type === 'scale')
              const action = { 
                type: 'scale', 
                values: { 
                  dsx: scaleX / (initialTransform?.scaleX || 1), 
                  dsy: scaleY / (initialTransform?.scaleY || 1), 
                  duration: stepDuration, 
                  easing: 'power4.out' 
                } 
              }
              if (scaleIdx !== -1) actions[scaleIdx] = action; else actions.push(action)
            }
          }

          // Rotate action
          const initialRotation = initialTransform?.rotation || 0
          if (rotation !== undefined && Math.abs(rotation - initialRotation) > 0.1) {
            const rotateIdx = actions.findIndex(a => a.type === 'rotate')
            const action = { 
              type: 'rotate', 
              values: { 
                dangle: rotation - (initialTransform?.rotation || 0), 
                duration: stepDuration, 
                easing: 'power4.out' 
              } 
            }
            if (rotateIdx !== -1) actions[rotateIdx] = action; else actions.push(action)
          }

          // Crop action - only include dx/dy if move action isn't managing position
          if (hasCropChanged) {
            const cropIdx = actions.findIndex(a => a.type === 'crop')
            const moveActionExists = actions.some(a => a.type === 'move')

            const cropAction = {
              type: 'crop',
              values: {
                cropX: cropX ?? initialCropX,
                cropY: cropY ?? initialCropY,
                cropWidth: cropWidth ?? initialCropW,
                cropHeight: cropHeight ?? initialCropH,
                mediaWidth: mediaWidth ?? initialTransform?.mediaWidth,
                mediaHeight: mediaHeight ?? initialTransform?.mediaHeight,
                // [FIX] Prevent dx/dy conflict - only include if move action doesn't exist
                // This prevents GSAP overwrite conflicts where CropAction's x/y tweens kill the MoveAction curve
                dx: moveActionExists ? undefined : deltaX,
                dy: moveActionExists ? undefined : deltaY,
                duration: stepDuration,
                easing: 'power4.out'
              }
            }
            if (cropIdx !== -1) {
              actions[cropIdx] = cropAction
            } else {
              actions.push(cropAction)
            }
          }

          targetStep.layerActions[layerId] = actions
        })
      }

      console.log(`🎬 [EditorPage] Fast-play step (${stepIndex + 1}): ${stepStartTimeSeconds}s -> ${stepEndTimeSeconds}s`)

      // [RACE CONDITION FIX] Build optimistic flow that matches what we just dispatched to Redux
      // This ensures preview uses the exact same data structure that will be in Redux after update
      const optimisticFlow = { ...currentFlow, steps: updatedSteps }

      motionControls.tweenTo(stepEndTimeSeconds, {
        duration: 1,
        startTime: stepStartTimeSeconds,
        flow: optimisticFlow,
        onComplete: () => {
          // [SNAP-BACK FIX] After preview completes, we need to:
          // 1. Wait for Redux to update (next tick)
          // 2. Force engine rebuild with updated Redux state
          // 3. Then seek to maintain position
          // This prevents the engine from rebuilding with stale data and causing snap-back
          console.log(`✅ [EditorPage] Fast-play complete, waiting for Redux update then seeking to ${stepEndTimeSeconds}s`)
          
          // Use setTimeout to wait for Redux update to propagate through the store
          // Redux Toolkit updates are synchronous, but React re-renders are async
          setTimeout(() => {
            // Force engine rebuild with latest Redux state (this will use the updated flows from Redux)
            if (motionControls && typeof motionControls.prepareEngine === 'function') {
              console.log(`🔄 [EditorPage] Forcing engine rebuild with updated Redux state`)
              motionControls.prepareEngine(true)
            }
            
            // Now seek to maintain position with the updated engine
            // This ensures we're using the correct flow data, not the stale preview flow
            motionControls.seek(stepEndTimeSeconds)
            console.log(`✅ [EditorPage] Position maintained at ${stepEndTimeSeconds}s with updated engine`)
          }, 0) // Use 0ms timeout to defer to next event loop tick
        }
      })

      // [FIX] Clear capture mode AFTER triggering tweenTo to ensure 
      // the engine has started its internal 'isPlaying' state before 
      // React re-renders and potentially cancels the preview.
      setMotionCaptureMode(null)
      setEditingStepId(null)
      motionCaptureRef.current = null
    } else {
      // No motionControls available, just clear capture mode
      setMotionCaptureMode(null)
      setEditingStepId(null)
      motionCaptureRef.current = null
    }
  }, [motionCaptureMode, editingStepId, currentSceneId, currentSceneMotionFlow, dispatch, motionControls, startTimeOffset, currentSceneTimelineInfo])

  /**
   * Edit an existing motion step (Centralized logic for both Panel and Timeline)
   */
  const handleEditStep = useCallback((stepId) => {
    // 1. EXIT/TOGGLE CASE: If we're already editing this exact step, apply and exit
    if (isMotionCaptureActive && editingStepId === stepId) {
      handleApplyMotion()
      return
    }

    // 2. SAVE OR DISCARD PREVIOUS EDITS: 
    // If we're moving from one capture session to another target (different step or base)
    if (isMotionCaptureActive) {
      if (stepId === 'base') {
        // Discard changes instead of saving
        handleCancelMotion()
      } else {
        // Apply and save changes before moving to next step
        handleApplyMotion()
      }
    }

    if (!currentSceneId) return

    // 3. BASE CASE: Snap playhead to scene start
    if (stepId === 'base') {
      // Seek UI and Engine together
      if (seek) seek(startTimeOffset)

      // Ensure state is clean
      setMotionCaptureMode(null)
      setEditingStepId('base')
      motionCaptureRef.current = null
      return
    }


    // Mark as EXISTING step being edited
    isNewStepRef.current = false

    const motionFlow = currentSceneMotionFlow?.steps || []
    const stepIndex = motionFlow.findIndex(s => s.id === stepId)
    if (stepIndex === -1) return

    // INSTANT FEEDBACK: Glow the block immediately
    setEditingStepId(stepId)

    const step = motionFlow[stepIndex]
    const initialTrackedLayers = new Map()

    // 1. Calculate cumulative transformation for all layers
    Object.keys(layers).forEach((layerId) => {
      const layer = layers[layerId]
      if (!layer) return

      let currentX = layer.x || 0
      let currentY = layer.y || 0
      let currentScaleX = layer.scaleX !== undefined ? layer.scaleX : 1
      let currentScaleY = layer.scaleY !== undefined ? layer.scaleY : 1
      let currentRotation = layer.rotation || 0
      let currentCropX = layer.cropX || 0
      let currentCropY = layer.cropY || 0
      let currentCropWidth = layer.cropWidth || layer.width || 100
      let currentCropHeight = layer.cropHeight || layer.height || 100
      const layerObject = motionControls?.layerObjects?.get?.(layerId)
      let currentMediaWidth = layer.mediaWidth || layerObject?._mediaWidth || layerObject?._originalWidth || layer.width || 100
      let currentMediaHeight = layer.mediaHeight || layerObject?._mediaHeight || layerObject?._originalHeight || layer.height || 100

      // Accumulate transforms from previous steps using RELATIVE values
      // This matches how data is stored in Redux (dx, dy, dsx, dsy, dangle)
      for (let i = 0; i < stepIndex; i++) {
        const prevStep = motionFlow[i]
        const actions = prevStep.layerActions?.[layerId] || []

        const moveAction = actions.find(a => a.type === 'move')
        const scaleAction = actions.find(a => a.type === 'scale')
        const rotateAction = actions.find(a => a.type === 'rotate')
        const cropAction = actions.find(a => a.type === 'crop')

        if (moveAction) {
          currentX += moveAction.values?.dx || 0
          currentY += moveAction.values?.dy || 0
        }

        if (scaleAction) {
          currentScaleX *= (scaleAction.values?.dsx ?? 1)
          currentScaleY *= (scaleAction.values?.dsy ?? 1)
        }
        if (rotateAction) {
          currentRotation += (rotateAction.values?.dangle ?? 0)
        }
        if (cropAction) {
          // Crop is absolute per step, but might shift the layer
          if (cropAction.values?.x !== undefined) currentX = cropAction.values.x
          if (cropAction.values?.y !== undefined) currentY = cropAction.values.y

          currentCropX = cropAction.values?.cropX ?? currentCropX
          currentCropY = cropAction.values?.cropY ?? currentCropY
          currentCropWidth = cropAction.values?.cropWidth ?? currentCropWidth
          currentCropHeight = cropAction.values?.cropHeight ?? currentCropHeight
          currentMediaWidth = cropAction.values?.mediaWidth ?? currentMediaWidth
          currentMediaHeight = cropAction.values?.mediaHeight ?? currentMediaHeight
        }
      }

      const sessionStartTransform = {
        x: currentX,
        y: currentY,
        width: currentCropWidth,
        height: currentCropHeight,
        scaleX: currentScaleX,
        scaleY: currentScaleY,
        rotation: currentRotation,
        cropX: currentCropX,
        cropY: currentCropY,
        cropWidth: currentCropWidth,
        cropHeight: currentCropHeight,
        mediaWidth: currentMediaWidth,
        mediaHeight: currentMediaHeight,
      }

      const currentStepActions = step?.layerActions?.[layerId] || []
      const currentMove = currentStepActions.find(a => a.type === 'move')
      const currentScale = currentStepActions.find(a => a.type === 'scale')
      const currentRotate = currentStepActions.find(a => a.type === 'rotate')
      const currentCrop = currentStepActions.find(a => a.type === 'crop')

      const currentTargetX = currentMove ? (sessionStartTransform.x + (currentMove.values.dx || 0)) : (currentCrop?.values?.x ?? sessionStartTransform.x)
      const currentTargetY = currentMove ? (sessionStartTransform.y + (currentMove.values.dy || 0)) : (currentCrop?.values?.y ?? sessionStartTransform.y)

      const deltaX = currentTargetX - sessionStartTransform.x
      const deltaY = currentTargetY - sessionStartTransform.y

      // [CROP FIX] CRITICAL: initialTransform must ALWAYS represent the state BEFORE this step
      // (sessionStartTransform), NOT the state after applying this step's actions.
      // This ensures that when editing, comparisons are made against the correct baseline.
      // The current values (cropX, cropY, etc.) represent the state AFTER this step's actions.
      initialTrackedLayers.set(layerId, {
        initialTransform: sessionStartTransform, // State BEFORE this step - this is the baseline for comparisons
        currentPosition: { x: currentTargetX, y: currentTargetY },
        deltaX,
        deltaY,
        width: sessionStartTransform.width,
        height: sessionStartTransform.height,
        // Current values AFTER applying this step's actions
        scaleX: currentScale?.values?.dsx !== undefined ? sessionStartTransform.scaleX * currentScale.values.dsx : sessionStartTransform.scaleX,
        scaleY: currentScale?.values?.dsy !== undefined ? sessionStartTransform.scaleY * currentScale.values.dsy : sessionStartTransform.scaleY,
        rotation: currentRotate?.values?.dangle !== undefined ? sessionStartTransform.rotation + currentRotate.values.dangle : sessionStartTransform.rotation,
        // [CROP FIX] Current crop values AFTER this step's crop action (if it exists)
        // These are used for display/editing, but initialTransform.cropX/Y/etc. are used for comparison
        cropX: currentCrop?.values?.cropX ?? sessionStartTransform.cropX,
        cropY: currentCrop?.values?.cropY ?? sessionStartTransform.cropY,
        cropWidth: currentCrop?.values?.cropWidth ?? sessionStartTransform.cropWidth,
        cropHeight: currentCrop?.values?.cropHeight ?? sessionStartTransform.cropHeight,
        mediaWidth: currentCrop?.values?.mediaWidth ?? sessionStartTransform.mediaWidth,
        mediaHeight: currentCrop?.values?.mediaHeight ?? sessionStartTransform.mediaHeight,
        // [CONTROL POINTS FIX] Initialize control points from existing move action when editing
        // This ensures that when editing a step with a curved path, the control points are
        // properly loaded and can be edited/updated
        controlPoints: currentMove?.values?.controlPoints || [],
        didMove: false,
        interactionType: null
      })
    })

    // 2. Prepare capture session
    const enableEditCapture = () => {
      // Synchronize initialTrackedLayers with ACTUAL visual state from PIXI
      // This ensures that after the fast-play stops, we snap the logical state to the visual state, 
      // preventing a visual jump/snap-back to the scene start.
      if (motionControls && motionControls.getLayerCurrentTransforms) {
        const currentTransforms = motionControls.getLayerCurrentTransforms()
        currentTransforms.forEach((transform, layerId) => {
          if (initialTrackedLayers.has(layerId)) {
            const entry = initialTrackedLayers.get(layerId)

            // Sync current state from visual engine
            entry.currentPosition.x = transform.x
            entry.currentPosition.y = transform.y
            entry.rotation = transform.rotation
            entry.scaleX = transform.scaleX
            entry.scaleY = transform.scaleY

            // CRITICAL FIX: Recalculate deltas relative to the original step start (initialTransform)
            // DO NOT overwrite initialTransform, as it is the anchor point for the step actions.
            entry.deltaX = transform.x - entry.initialTransform.x
            entry.deltaY = transform.y - entry.initialTransform.y

            // [CROP FIX] Sync crop values from visual state when editing existing steps
            // This ensures the current crop values match what's visually displayed, so editing works correctly.
            // initialTransform.cropX/Y/etc. remain unchanged (they represent state BEFORE this step).
            // entry.cropX/Y/etc. represent the current state AFTER this step's crop action.
            if (transform.cropX !== undefined) entry.cropX = transform.cropX
            if (transform.cropY !== undefined) entry.cropY = transform.cropY
            if (transform.cropWidth !== undefined) {
              entry.cropWidth = transform.cropWidth
              entry.width = transform.cropWidth
            }
            if (transform.cropHeight !== undefined) {
              entry.cropHeight = transform.cropHeight
              entry.height = transform.cropHeight
            }
            if (transform.mediaWidth !== undefined) entry.mediaWidth = transform.mediaWidth
            if (transform.mediaHeight !== undefined) entry.mediaHeight = transform.mediaHeight
          }
        })
      }

      motionCaptureRef.current = {
        stepId,
        trackedLayers: initialTrackedLayers
      }
      setMotionCaptureMode({
        isActive: true,
        stepId,
        onPositionUpdate: (data) => {
          const capture = motionCaptureRef.current
          if (!capture) return

          const entry = capture.trackedLayers.get(data.layerId)
          if (entry) {
            // Update mutable ref data directly for high performance
            if (data.interactionType === 'move') entry.didMove = true
            if (data.x !== undefined && data.y !== undefined) {
              entry.currentPosition = { x: data.x, y: data.y }
              // Delta is relative to the START of the current step
              entry.deltaX = data.x - entry.initialTransform.x
              entry.deltaY = data.y - entry.initialTransform.y
            }
            if (data.scaleX !== undefined) entry.scaleX = data.scaleX
            if (data.scaleY !== undefined) entry.scaleY = data.scaleY
            if (data.rotation !== undefined) entry.rotation = data.rotation
            if (data.cropX !== undefined) entry.cropX = data.cropX
            if (data.cropY !== undefined) entry.cropY = data.cropY
            if (data.cropWidth !== undefined) entry.cropWidth = data.cropWidth
            if (data.cropHeight !== undefined) entry.cropHeight = data.cropHeight
            if (data.mediaWidth !== undefined) entry.mediaWidth = data.mediaWidth
            if (data.mediaHeight !== undefined) entry.mediaHeight = data.mediaHeight
            
            // [CONTROL POINTS FIX] Only update control points if explicitly provided (not undefined/null)
            // This preserves existing control points when updating position/scale/rotate without curve edits
            // Control points are arrays, so we check for array type to distinguish from undefined
            if (data.controlPoints !== undefined && Array.isArray(data.controlPoints)) {
              entry.controlPoints = data.controlPoints
            } else if (data.controlPoints === null) {
              // Explicitly clear control points if null is passed
              entry.controlPoints = []
            }
            // If controlPoints is undefined, preserve existing value (don't overwrite)
          }
        },
        trackedLayers: initialTrackedLayers,
        layerActions: step?.layerActions || {}
      })
      setEditingStepId(stepId)
    }

    // 3. Sequential Playback / Fast-Preview
    if (motionControls) {
      const pageDuration = currentSceneMotionFlow.pageDuration || 5000
      const stepCount = motionFlow.length
      const stepDuration = stepCount > 0 ? pageDuration / stepCount : pageDuration
      const stepStartTimeSeconds = startTimeOffset + (stepIndex * stepDuration) / 1000
      const calculatedEndTime = startTimeOffset + ((stepIndex + 1) * stepDuration) / 1000
      const sceneEndTime = currentSceneTimelineInfo?.endTime || calculatedEndTime
      const stepEndTimeSeconds = Math.min(calculatedEndTime, sceneEndTime - 0.01)

      const hasActions = step.layerActions && Object.values(step.layerActions).some(actions => actions.length > 0)
      const targetTime = hasActions ? stepEndTimeSeconds : stepStartTimeSeconds

      motionControls.tweenTo(targetTime, {
        duration: 0.3, // Even snappier (0.3s)
        startTime: startTimeOffset,
        onComplete: enableEditCapture
      })
    } else {
      enableEditCapture()
    }
  }, [isMotionCaptureActive, editingStepId, handleApplyMotion, currentSceneId, currentSceneMotionFlow, layers, motionControls, startTimeOffset, currentSceneTimelineInfo, seek])

  /**
   * Cancel motion capture: delete the auto-created step and exit
   * CRITICAL: Reset all PIXI objects to their base Redux state to prevent crop value leaks
   */
  const handleCancelMotion = useCallback(() => {
    if (editingStepId && currentSceneId) {
      // Delete the step ONLY if it was NEWLY created in this session
      if (isNewStepRef.current) {
        dispatch(deleteSceneMotionStep({
          sceneId: currentSceneId,
          stepId: editingStepId
        }))
      }
    }

    // [CROP FIX] Reset all PIXI objects to their base Redux state before exiting capture mode
    // This prevents crop values (and other transform values) from persisting on PIXI objects
    // after canceling, which would then be read as initial state in the next capture session
    if (motionControls && motionControls.layerObjects && layers) {
      const layerObjects = motionControls.layerObjects
      layerObjects.forEach((pixiObject, layerId) => {
        const baseLayerData = layers[layerId]
        if (baseLayerData && pixiObject && !pixiObject.destroyed) {
          // Force reset to base Redux state (force=true ensures visual alignment)
          // This resets crop values, position, rotation, scale, etc. to match Redux
          applyTransformInline(pixiObject, baseLayerData, null, layerId, null, true)
        }
      })
    }

    // Exit capture mode
    setMotionCaptureMode(null)
    setEditingStepId(null)
    motionCaptureRef.current = null
    isNewStepRef.current = false
  }, [editingStepId, currentSceneId, dispatch, motionControls, layers])




  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Check if user is typing in an input or textarea
      const isTyping = e.target.tagName === 'INPUT' ||
        e.target.tagName === 'TEXTAREA' ||
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA' ||
        e.target.isContentEditable ||
        document.activeElement?.isContentEditable

      // If typing in a textarea/input, don't handle shortcuts
      if (isTyping && !e.metaKey && !e.ctrlKey) {
        return
      }

      // Cmd/Ctrl+Z / Shift+Cmd/Ctrl+Z — Undo/Redo
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        dispatch(undo())
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && e.shiftKey) {
        e.preventDefault()
        dispatch(redo())
      }

      // Space — Play/Pause
      if (e.key === ' ' && !isTyping) {
        e.preventDefault()
        if (motionControls) {
          if (isPlaying) {
            motionControls.pauseAll()
          } else {
            motionControls.playAll()
          }
        }
      }

      // 1 / 2 / 3 — Zoom 50/100/200%; Shift+1 Fit
      if (e.key === '1' && e.shiftKey && !isTyping) {
        e.preventDefault()
        setZoom(-1)
      } else if (e.key === '1' && !e.shiftKey && !isTyping) {
        e.preventDefault()
        setZoom(50)
      } else if (e.key === '2' && !isTyping) {
        e.preventDefault()
        setZoom(100)
      } else if (e.key === '3' && !isTyping) {
        e.preventDefault()
        setZoom(200)
      }

      // Ctrl + Plus / Ctrl + Minus / Ctrl + 0 — Zoom In/Out/Fit
      if ((e.metaKey || e.ctrlKey) && !isTyping) {
        if (e.key === '=' || e.key === '+') {
          e.preventDefault()
          const newZoom = Math.min(zoom * 1.2, 500)
          setZoom(Math.round(newZoom))
        } else if (e.key === '-') {
          e.preventDefault()
          const newZoom = Math.max(zoom / 1.2, 10)
          setZoom(Math.round(newZoom))
        } else if (e.key === '0') {
          e.preventDefault()
          setZoom(-1) // Fit zoom
        }
      }

      // G toggle grid
      if ((e.key === 'g' || e.key === 'G') && !isTyping) {
        e.preventDefault()
        setShowGrid(!showGrid)
      }

      // S toggle snapping
      if ((e.key === 's' || e.key === 'S') && !isTyping) {
        e.preventDefault()
        // Handle snap toggle
      }

      // Delete/Backspace — Delete selected layer(s) or current scene
      if ((e.key === 'Delete' || e.key === 'Backspace') && !isTyping) {
        e.preventDefault()
        if (selectedLayerIds && selectedLayerIds.length > 0) {
          // Delete all selected layers
          selectedLayerIds.forEach(layerId => {
            dispatch(deleteLayer(layerId))
          })
          // Clear selection after deletion
          dispatch(clearLayerSelection())
        } else if (currentSceneId && scenes.length > 1) {
          // If no layers selected, delete the current scene (if more than one scene exists)
          dispatch(deleteScene(currentSceneId))
        }
      }

      // Cmd/Ctrl+C — Copy selected layers or current scene
      if ((e.metaKey || e.ctrlKey) && e.key === 'c' && !isTyping) {
        e.preventDefault()
        if (selectedLayerIds && selectedLayerIds.length > 0) {
          // Copy selected layers
          dispatch(copyLayers(selectedLayerIds))
        } else if (currentSceneId) {
          // If no layers selected, copy the current scene
          dispatch(copyScene(currentSceneId))
        }
      }

      // Cmd/Ctrl+V — Paste layers or scene
      if ((e.metaKey || e.ctrlKey) && e.key === 'v' && !isTyping) {
        e.preventDefault()

        // Check if we have scene clipboard data
        try {
          const sceneClipboard = localStorage.getItem('vevara_scene_clipboard')
          if (sceneClipboard) {
            // Check if we also have layer clipboard to determine which to paste
            const layerClipboard = localStorage.getItem('vevara_clipboard')

            // If we have both, prefer scene clipboard if no layers are selected
            // Otherwise prefer layer clipboard if layers are selected
            if (sceneClipboard && (!layerClipboard || selectedLayerIds.length === 0)) {
              dispatch(pasteScene())
            } else if (layerClipboard) {
              dispatch(pasteLayers())
            }
          } else {
            // Only layer clipboard available
            dispatch(pasteLayers())
          }
        } catch (e) {
          // Fallback to layer paste
          dispatch(pasteLayers())
        }
        // Selection will be handled by useEffect watching lastPastedLayerIds
      }

      // Cmd/Ctrl+D duplicate layer
      if ((e.metaKey || e.ctrlKey) && e.key === 'd' && !isTyping) {
        e.preventDefault()
        if (selectedLayerIds && selectedLayerIds.length > 0) {
          // Duplicate all selected layers
          selectedLayerIds.forEach(layerId => {
            dispatch(duplicateLayer(layerId))
          })
        }
      }

      // Arrow keys nudge
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && !isTyping) {
        if (selectedLayerIds && selectedLayerIds.length > 0) {
          e.preventDefault()
          const nudge = e.shiftKey ? 10 : 1
          const delta = {
            ArrowUp: { x: 0, y: -nudge },
            ArrowDown: { x: 0, y: nudge },
            ArrowLeft: { x: -nudge, y: 0 },
            ArrowRight: { x: nudge, y: 0 },
          }[e.key]
          // Handle nudge
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isPlaying, showGrid, zoom, selectedLayerIds, currentSceneId, dispatch, playheadTime, totalTime])

  // Select pasted layers after paste
  useEffect(() => {
    if (lastPastedLayerIds && lastPastedLayerIds.length > 0 && lastPastedLayerIds[0]) {
      // Select the first pasted layer
      dispatch(setSelectedLayer(lastPastedLayerIds[0]))
    }
  }, [lastPastedLayerIds, dispatch])





  // Update sidebar width based on screen size
  useEffect(() => {
    const updateSidebarWidth = () => {
      if (window.innerWidth >= 1024) { // lg: breakpoint
        setSidebarWidth('5rem') // w-20
      } else {
        setSidebarWidth('0px') // Sidebar is hidden on mobile/tablet < lg
      }
    }

    updateSidebarWidth()
    window.addEventListener('resize', updateSidebarWidth)
    return () => window.removeEventListener('resize', updateSidebarWidth)
  }, [])

  // Auto-save simulation
  useEffect(() => {
    const interval = setInterval(() => {
      setLastSaved(Date.now())
    }, 3000)
    return () => clearInterval(interval)
  }, [])





  // Prevent text selection across the entire editor during interactions
  // useEffect(() => {
  //   const preventTextSelection = (e) => {
  //     // Only prevent text selection on the canvas area, not globally
  //     const canvasContainer = document.querySelector('#pixi-container')
  //     if (canvasContainer && canvasContainer.contains(e.target)) {
  //       e.preventDefault()
  //       return false
  //     }
  //   }



  //   // Add aggressive text selection prevention
  //   document.addEventListener('selectstart', preventTextSelection, true)
  //   document.addEventListener('dragstart', preventTextSelection, true)

  //   // Only prevent mousedown on canvas area to avoid text selection during interactions
  //   const handleMouseDown = (e) => {
  //     const canvasContainer = document.querySelector('#pixi-container')
  //     if (canvasContainer && canvasContainer.contains(e.target)) {
  //       // Check if this is a potential drag operation (not just a click)
  //       const isInteractive = e.target.closest('button, input, select, textarea, a, [role="button"], [role="tab"], [role="menuitem"], [role="dialog"]')
  //       if (!isInteractive) {
  //         // Prevent text selection for potential drag operations on canvas
  //         e.preventDefault()
  //       }
  //     }
  //   }

  //   document.addEventListener('mousedown', handleMouseDown, true)

  //   return () => {
  //     document.removeEventListener('selectstart', preventTextSelection, true)
  //     document.removeEventListener('dragstart', preventTextSelection, true)
  //     document.removeEventListener('mousedown', handleMouseDown, true)
  //   }
  // }, [])


  // Handle mouse wheel zoom with Ctrl key (works anywhere in the app)
  useEffect(() => {
    const handleWheel = (e) => {
      // Check if Ctrl key is pressed
      if (e.ctrlKey || e.metaKey) {
        // Don't interfere with input fields or textareas when user is typing
        const isTyping = e.target.tagName === 'INPUT' ||
          e.target.tagName === 'TEXTAREA' ||
          e.target.isContentEditable

        // Only prevent default and zoom if not typing in an input field
        if (!isTyping) {
          e.preventDefault() // Prevent default browser zoom

          // Calculate zoom direction and amount
          // deltaY > 0 means scrolling down (zoom out), deltaY < 0 means scrolling up (zoom in)
          const zoomFactor = 1.15 // Slightly more responsive zoom multiplier
          const currentZoom = zoomRef.current // Use ref to get current zoom value

          // Calculate new zoom level based on scroll direction
          let newZoom
          if (e.deltaY < 0) {
            // Scrolling up = zoom in
            newZoom = currentZoom * zoomFactor
            newZoom = Math.min(newZoom, 500) // Max 500%
          } else {
            // Scrolling down = zoom out
            newZoom = currentZoom / zoomFactor
            newZoom = Math.max(newZoom, 10) // Min 10%
          }

          // Round to nearest 5 for cleaner step values (10, 15, 20, 25, etc.)
          newZoom = Math.round(newZoom / 5) * 5

          // Ensure we don't go below minimum or above maximum after rounding
          newZoom = Math.max(10, Math.min(500, newZoom))

          // If rounding caused the zoom to stay the same, force a minimum change
          // This prevents getting stuck at certain zoom levels (like 15%)
          if (newZoom === currentZoom) {
            if (e.deltaY < 0) {
              // Zooming in - round up to next 5
              newZoom = Math.min(Math.ceil(currentZoom / 5) * 5 + 5, 500)
            } else {
              // Zooming out - round down to previous 5
              newZoom = Math.max(Math.floor(currentZoom / 5) * 5 - 5, 10)
            }
          }

          // Update zoom (always update to ensure handler stays responsive)
          // The zoom effect will handle maintaining the center of visible area
          setZoom(newZoom)
        }
      }
    }

    // Add event listener to window so it works anywhere in the app
    // Use bubble phase (default) instead of capture to avoid conflicts
    window.addEventListener('wheel', handleWheel, { passive: false })

    return () => {
      // Cleanup event listener
      window.removeEventListener('wheel', handleWheel)
    }
  }, []) // Empty dependency array - only run once on mount

  // =============================================================================
  // DERIVED STATE FOR CANVAS
  // =============================================================================

  // Merge the ephemeral motionCaptureMode state with the LIVE Redux state
  // This ensures that when actions (like controlPoints) are updated in Redux,
  // the canvas immediately sees them, preventing the "snap back" to straight lines.
  const effectiveMotionCaptureMode = useMemo(() => {
    if (!motionCaptureMode || !motionCaptureMode.isActive) return null

    // If we have an editing step, try to find it in the live flow
    const activeStepId = motionCaptureMode.stepId || editingStepId
    if (!activeStepId) return motionCaptureMode

    const liveStep = currentSceneMotionFlow?.steps?.find(s => s.id === activeStepId)

    // If we found the live step, merge its layerActions into our mode object
    if (liveStep && liveStep.layerActions) {
      return {
        ...motionCaptureMode,
        stepId: activeStepId, // Ensure ID is explicit
        layerActions: liveStep.layerActions // OVERRIDE with Redux truth
      }
    }

    return motionCaptureMode
  }, [motionCaptureMode, editingStepId, currentSceneMotionFlow])

  return (
    <div
      className="h-screen sm:h-dvh flex flex-col text-white overflow-hidden relative"
      data-editor-container
      style={{ touchAction: 'none' }}
      onDragStart={(e) => {
        // Prevent drag operations that might trigger text selection
        e.preventDefault()
      }}
    >
      {/* Top Toolbar */}
      <div ref={topToolbarRef} className="absolute top-0 left-0 right-0 z-50">
        <TopToolbar
          projectName={projectName}
          onShare={() => { }}
          onExport={() => { }}
          onPreview={() => {
            // Mobile Menu Toggle: if any panel is open, close it. Otherwise open Elements.
            if (activeSidebarItem) {
              setActiveSidebarItem(null)
            } else {
              setActiveSidebarItem('Elements')
            }
          }}
          onProjectNameChange={setProjectName}
          lastSaved={lastSaved}
          onCanvasSizeChange={handleCanvasSizeChange}
        />
      </div>

      {/* Left Sidebar - Hidden on mobile by default */}
      <div
        className="hidden lg:block absolute left-0 z-50 transition-all duration-300"
        style={{
          top: topToolbarHeight,
          height: `calc(100vh - ${topToolbarHeight}px)`
        }}
      >
        <LeftSidebar
          activeItem={activeSidebarItem}
          onItemClick={handleSidebarItemClick}
        />
      </div>

      {/* Main Content Area */}
      <div className="flex flex-1 min-h-0 overflow-hidden relative z-40">

        {/* Side Panels - Desktop: normal, Mobile: full overlay */}
        <div className="relative">
          {/* Desktop Panels */}
          {activeSidebarItem && (
            <div className="hidden lg:block absolute left-20 z-40 shadow-2xl transition-all duration-300" style={{
              top: `${topToolbarHeight}px`,
              height: `calc(100vh - ${topToolbarHeight}px)`,
              borderRight: '1px solid rgba(255, 255, 255, 0.05)'
            }}>
              {activeSidebarItem === 'Design' && (
                <DesignPanel onClose={handleClosePanel} />
              )}
              {activeSidebarItem === 'Elements' && (
                <ElementsPanel onClose={handleClosePanel} aspectRatio={aspectRatio} />
              )}
              {activeSidebarItem === 'Text' && (
                <TextPanel onClose={handleClosePanel} aspectRatio={aspectRatio} />
              )}
              {activeSidebarItem === 'Uploads' && (
                <UploadsPanel onClose={handleClosePanel} aspectRatio={aspectRatio} />
              )}
              {activeSidebarItem === 'Tools' && (
                <ToolsPanel onClose={handleClosePanel} />
              )}
              {activeSidebarItem === 'Color' && (
                <ColorPickerPanel
                  onClose={handleClosePanel}
                  selectedColor={
                    colorPickerType === 'canvas'
                      ? (currentSceneData?.backgroundColor !== undefined
                        ? (typeof currentSceneData.backgroundColor === 'number'
                          ? '#' + currentSceneData.backgroundColor.toString(16).padStart(6, '0')
                          : currentSceneData.backgroundColor)
                        : '#ffffff')
                      : selectedLayerIds[0] && layers[selectedLayerIds[0]]
                        ? (layers[selectedLayerIds[0]].type === 'background'
                          ? (layers[selectedLayerIds[0]].data?.color !== undefined
                            ? (typeof layers[selectedLayerIds[0]].data.color === 'number'
                              ? '#' + layers[selectedLayerIds[0]].data.color.toString(16).padStart(6, '0')
                              : layers[selectedLayerIds[0]].data.color)
                            : '#ffffff')
                          : colorPickerType === 'fill'
                            ? (layers[selectedLayerIds[0]].type === 'shape'
                              ? layers[selectedLayerIds[0]].data?.fill
                              : layers[selectedLayerIds[0]].data?.color)
                            : colorPickerType === 'text'
                              ? layers[selectedLayerIds[0]].data?.color
                              : layers[selectedLayerIds[0]].data?.stroke)
                        : '#ffffff'
                  }
                  onColorSelect={(color) => {
                    if (colorPickerType === 'canvas' && currentSceneId) {
                      // Convert hex string to number for canvas background
                      const bgColor = color.startsWith('#')
                        ? parseInt(color.slice(1), 16)
                        : parseInt(color, 16)
                      dispatch(updateScene({ id: currentSceneId, backgroundColor: bgColor }))
                    } else if (selectedLayerIds && selectedLayerIds.length > 1) {
                      // Update all selected layers (multi-select)
                      selectedLayerIds.forEach((layerId) => {
                        const layer = layers[layerId]
                        if (!layer) return

                        const updates = { data: { ...layer.data } }

                        if (colorPickerType === 'fill' && layer.type === 'shape') {
                          updates.data.fill = color === 'transparent' ? null : color
                        } else if (colorPickerType === 'fill' || colorPickerType === 'text') {
                          updates.data.color = color === 'transparent' ? '#ffffff' : color
                        } else if (colorPickerType === 'stroke') {
                          updates.data.stroke = color === 'transparent' ? null : color
                        }

                        dispatch(updateLayer({ id: layerId, ...updates }))
                      })
                    } else if (selectedLayerIds && selectedLayerIds.length === 1) {
                      const layerId = selectedLayerIds[0]
                      const layer = layers[layerId]
                      if (!layer) return

                      // Handle background layer color changes
                      if (layer.type === 'background' && currentSceneId) {
                        // Convert hex string to number for background layer
                        const bgColor = color.startsWith('#')
                          ? parseInt(color.slice(1), 16)
                          : parseInt(color, 16)
                        dispatch(updateScene({ id: currentSceneId, backgroundColor: bgColor }))
                      } else {
                        // Handle regular layer color changes
                        const updates = { data: { ...layer.data } }

                        if (colorPickerType === 'fill' && layer.type === 'shape') {
                          updates.data.fill = color === 'transparent' ? null : color
                        } else if (colorPickerType === 'fill' || colorPickerType === 'text') {
                          updates.data.color = color === 'transparent' ? '#ffffff' : color
                        } else if (colorPickerType === 'stroke') {
                          updates.data.stroke = color === 'transparent' ? null : color
                        }

                        dispatch(updateLayer({ id: layerId, ...updates }))
                      }
                    }
                  }}
                  colorType={colorPickerType}
                />
              )}
              {activeSidebarItem === 'Projects' && (
                <ProjectsPanel onClose={handleClosePanel} />
              )}
              {activeSidebarItem === 'Apps' && (
                <AppsPanel onClose={handleClosePanel} />
              )}
              {activeSidebarItem === 'Advanced' && (
                <MotionInspector
                  onClose={handleClosePanel}
                  segments={segments}
                  onAddSegment={handleAddSegment}
                  onUpdateSegment={handleUpdateSegment}
                  onDeleteSegment={handleDeleteSegment}
                  onDuplicateSegment={handleDuplicateSegment}
                  onToggleSegmentBypass={handleToggleSegmentBypass}
                  onLayerUpdate={(updates) => {
                    if (selectedLayerIds[0]) {
                      dispatch(updateLayer({ id: selectedLayerIds[0], ...updates }))
                    }
                  }}
                />
              )}
            </div>
          )}

          {/* Mobile Panels - Redesigned full screen overlay with sidebar navigation */}
          {activeSidebarItem && (
            <div
              className="lg:hidden fixed inset-0 z-[60] bg-black/60 backdrop-blur-md transition-opacity duration-300"
              onClick={() => setActiveSidebarItem(null)}
              style={{
                top: 0,
                bottom: 0,
                left: 0,
                right: '35%'
              }}
            >
              <div
                className="absolute left-0 top-0 bottom-0 right-0 bg-[#0d1216] shadow-2xl flex flex-row overflow-hidden transition-transform duration-300"
                onClick={(e) => e.stopPropagation()}
                style={{
                  top: topToolbarHeight,
                  height: `calc(100vh - ${topToolbarHeight}px)`
                }}
              >
                {/* Embedded Sidebar for Mobile */}
                <div className="w-16 h-full border-r border-white/5 bg-black/20 flex-shrink-0">
                  <LeftSidebar
                    activeItem={activeSidebarItem}
                    onItemClick={handleSidebarItemClick}
                  />
                </div>

                {/* Panel Content for Mobile */}
                <div className="flex-1 h-full overflow-hidden flex flex-col relative">
                  <div className="flex-1 overflow-y-auto">
                    {activeSidebarItem === 'Design' && (
                      <DesignPanel onClose={handleClosePanel} />
                    )}
                    {activeSidebarItem === 'Elements' && (
                      <ElementsPanel onClose={handleClosePanel} aspectRatio={aspectRatio} />
                    )}
                    {activeSidebarItem === 'Text' && (
                      <TextPanel onClose={handleClosePanel} aspectRatio={aspectRatio} />
                    )}
                    {activeSidebarItem === 'Uploads' && (
                      <UploadsPanel onClose={handleClosePanel} aspectRatio={aspectRatio} />
                    )}
                    {activeSidebarItem === 'Tools' && (
                      <ToolsPanel onClose={handleClosePanel} />
                    )}
                    {activeSidebarItem === 'Color' && (
                      <ColorPickerPanel
                        onClose={handleClosePanel}
                        selectedColor={
                          colorPickerType === 'canvas'
                            ? (currentSceneData?.backgroundColor !== undefined
                              ? (typeof currentSceneData.backgroundColor === 'number'
                                ? '#' + currentSceneData.backgroundColor.toString(16).padStart(6, '0')
                                : currentSceneData.backgroundColor)
                              : '#ffffff')
                            : selectedLayerIds[0] && layers[selectedLayerIds[0]]
                              ? (layers[selectedLayerIds[0]].type === 'background'
                                ? (layers[selectedLayerIds[0]].data?.color !== undefined
                                  ? (typeof layers[selectedLayerIds[0]].data.color === 'number'
                                    ? '#' + layers[selectedLayerIds[0]].data.color.toString(16).padStart(6, '0')
                                    : layers[selectedLayerIds[0]].data.color)
                                  : '#ffffff')
                                : colorPickerType === 'fill'
                                  ? (layers[selectedLayerIds[0]].type === 'shape'
                                    ? layers[selectedLayerIds[0]].data?.fill
                                    : layers[selectedLayerIds[0]].data?.color)
                                  : colorPickerType === 'text'
                                    ? layers[selectedLayerIds[0]].data?.color
                                    : layers[selectedLayerIds[0]].data?.stroke)
                              : '#ffffff'
                        }
                        onColorSelect={(color) => {
                          if (colorPickerType === 'canvas' && currentSceneId) {
                            const bgColor = color.startsWith('#') ? parseInt(color.slice(1), 16) : parseInt(color, 16)
                            dispatch(updateScene({ id: currentSceneId, backgroundColor: bgColor }))
                          } else if (selectedLayerIds && selectedLayerIds.length > 0) {
                            selectedLayerIds.forEach((layerId) => {
                              const layer = layers[layerId]
                              if (!layer) return
                              const updates = { data: { ...layer.data } }
                              if (colorPickerType === 'fill' && layer.type === 'shape') {
                                updates.data.fill = color === 'transparent' ? null : color
                              } else if (colorPickerType === 'fill' || colorPickerType === 'text') {
                                updates.data.color = color === 'transparent' ? '#ffffff' : color
                              } else if (colorPickerType === 'stroke') {
                                updates.data.stroke = color === 'transparent' ? null : color
                              }
                              dispatch(updateLayer({ id: layerId, ...updates }))
                            })
                          }
                        }}
                        colorType={colorPickerType}
                      />
                    )}
                    {activeSidebarItem === 'Projects' && (
                      <ProjectsPanel onClose={handleClosePanel} />
                    )}
                    {activeSidebarItem === 'Apps' && (
                      <AppsPanel onClose={handleClosePanel} />
                    )}
                    {activeSidebarItem === 'Advanced' && (
                      <MotionInspector
                        onClose={handleClosePanel}
                        segments={segments}
                        onAddSegment={handleAddSegment}
                        onUpdateSegment={handleUpdateSegment}
                        onDeleteSegment={handleDeleteSegment}
                        onDuplicateSegment={handleDuplicateSegment}
                        onToggleSegmentBypass={handleToggleSegmentBypass}
                        onLayerUpdate={(updates) => {
                          if (selectedLayerIds[0]) {
                            dispatch(updateLayer({ id: selectedLayerIds[0], ...updates }))
                          }
                        }}
                      />
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>


        {/* Canvas and Bottom Sections */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden relative">
          {/* Canvas Controls - Overlay at top (when element or canvas is selected)  */}
          {(() => {
            const shouldShowControls = (selectedLayerIds[0] && layers[selectedLayerIds[0]]) || selectedCanvas
            return shouldShowControls ? (
              <div ref={topControlsRef} className="absolute left-1/2 transform -translate-x-1/2 z-30 pointer-events-none" style={{ top: `${topToolbarHeight + 8}px` }}>
                <CanvasControls
                  duration={`${totalTime.toFixed(1)}s`}
                  selectedLayer={selectedLayerIds[0] ? layers[selectedLayerIds[0]] : null}
                  selectedCanvas={selectedCanvas}
                  currentScene={currentSceneData}
                  onLayerUpdate={(updates) => {
                    if (selectedLayerIds[0]) {
                      dispatch(updateLayer({ id: selectedLayerIds[0], ...updates }))
                    }
                  }}
                  onCanvasUpdate={(updates) => {
                    if (currentSceneId) {
                      dispatch(updateScene({ id: currentSceneId, ...updates }))
                    }
                  }}
                  onToggleAdvanced={() => {
                    if (activeSidebarItem === 'Advanced') {
                      setActiveSidebarItem(null)
                    } else {
                      setActiveSidebarItem('Advanced')
                    }
                  }}
                  onOpenColorPicker={(type = 'fill') => {
                    setColorPickerType(type)
                    setActiveSidebarItem('Color') // Open color panel in sidebar
                  }}
                  onToggleMotionPanel={() => {
                    setIsMotionPanelOpen(!isMotionPanelOpen)
                  }}
                  isMotionCaptureActive={isMotionCaptureActive}
                  onStartMotionCapture={handleStartMotionCapture}
                  onApplyMotion={handleApplyMotion}
                  onCancelMotion={handleCancelMotion}
                />
              </div>
            ) : null
          })()}

          {/* Canvas - Takes all available space */}
          <div
            ref={canvasScrollRef}
            className="flex-1 min-h-0 w-full flex items-center justify-center"
            style={useMemo(() => ({
              position: 'relative',
              zIndex: 1,
            }), [])}
          >
            <Stage
              aspectRatio={aspectRatio}
              showGrid={showGrid}
              showSafeArea={showSafeArea}
              showMotionPaths={showMotionPaths}
              setShowGrid={setShowGrid}
              setShowSafeArea={setShowSafeArea}
              setShowMotionPaths={setShowMotionPaths}
              activeTool={activeTool}
              onToolChange={setActiveTool}
              onSetCameraStart={() => { }}
              onSetCameraEnd={() => { }}
              zoom={zoom}
              onZoomChange={setZoom}
              bottomSectionHeight={bottomSectionHeight}
              topToolbarHeight={topToolbarHeight}
              //motion capture mode & playback controls
              motionCaptureMode={effectiveMotionCaptureMode}
              onMotionStateChange={setMotionControls}
              editingStepId={editingStepId}
              //text editing
              editingTextLayerId={editingTextLayerId}
              onTextChange={handleTextChange}
              onFinishEditing={handleFinishEditing}
              onStartTextEditing={startTextEditing}
              totalTime={totalTime}
            />

            {/* Removed floating mobile menu button */}
          </div>

          {/* Bottom Sections - Overlay at bottom with glass effect */}
          <div
            ref={bottomSectionRef}
            className={`absolute bottom-0 right-0 z-30 flex flex-col pointer-events-auto ${!isResizingBottom ? 'transition-all duration-300' : ''}`}
            style={{
              left: typeof window !== 'undefined' && window.innerWidth < 1024 ? '0px' : sidebarWidth,
              borderTop: '1px solid rgba(13, 18, 22, 0.8)',
              ...(customBottomHeight !== null ? {
                height: `${customBottomHeight}px`,
                maxHeight: `${customBottomHeight}px`
              } : {})
            }}
          >
            {/* Height Resize Handle - Invisible but wide enough for easy grabbing */}
            <div
              className={`absolute top-0 left-0 right-0 h-1.5 cursor-ns-resize z-50 group flex items-start justify-center`}
              onMouseDown={handleBottomResizeMouseDown}
              style={{ top: '-1px' }}
            >
              {/* Visible Indicator: Solid purple line that fades out at ends */}
              <div className={`w-full h-[2px] bg-gradient-to-r from-transparent via-purple-500 to-transparent transition-opacity duration-300 ${isResizingBottom ? 'opacity-100' : 'opacity-40 group-hover:opacity-100'}`} />
            </div>
            {/* Content Container - Scrollable if content overflows */}
            <div className="flex flex-col flex-1" style={{
              minHeight: 0, // Allow flex item to shrink
              position: 'relative',
              paddingBottom: '0px' // Remove padding to make scenes bar touch bottom
            }}>
              {/* Scrollable Content Area - REMOVED overflow-y-auto for cleaner look */}
              <div className="flex flex-col overflow-x-hidden flex-1 scrollbar-hide" style={{
                minHeight: 0 // Allow flex item to shrink
              }}>
                {/* Playback Controls - Top Section */}
                <div ref={playbackControlsRef} className="pointer-events-auto flex-shrink-0 relative" style={{
                  marginLeft: typeof window !== 'undefined' && window.innerWidth < 1024 ? '0' : `-${sidebarWidth}`,
                  width: typeof window !== 'undefined' && window.innerWidth < 1024 ? '100%' : `calc(100% + ${sidebarWidth})`
                }}>
                  <PlaybackControls
                    isPlaying={isPlaying}
                    currentTime={playheadTime}
                    totalTime={totalTime}
                    onPlayPause={() => {
                      if (motionControls) {
                        if (isPlaying) {
                          motionControls.pauseAll()
                        } else {
                          motionControls.playAll()
                        }
                      }
                    }}
                  />
                </div>

                {/* Scenes Bar - Timeline Tracks Section - Horizontally scrollable */}
                <div
                  ref={scenesBarRef}
                  className="pointer-events-auto flex-shrink-0"
                  style={{
                    width: '100%',
                    minWidth: 0, // Allow shrinking
                    backgroundColor: 'rgba(13, 18, 22, 0.85)',
                    backdropFilter: 'blur(12px)',
                    WebkitBackdropFilter: 'blur(12px)',
                    overflowX: 'auto',
                    overflowY: 'visible',
                    WebkitOverflowScrolling: 'touch', // Smooth scrolling on iOS
                    paddingBottom: '8px',
                    paddingTop: '0px',
                    paddingLeft: '16px',
                    paddingRight: '16px',
                  }}
                >
                  <ScenesBar
                    currentTime={Math.min(playheadTime, totalTime)}
                    totalTime={totalTime}
                    worldWidth={worldWidth}
                    worldHeight={worldHeight}
                    currentTimeStepId={editingStepId}
                    isMotionCaptureActive={isMotionCaptureActive}
                    onStepClick={handleEditStep} // Pass centralized handler
                    bottomSectionHeight={customBottomHeight} // Pass height for dynamic spacing
                    onSeek={seek}
                    onMotionStop={handleMotionStop}
                  />
                </div>
              </div>
            </div>

          </div>

        </div>

      </div>

      {/* Motion Panel - Right side overlay */}
      <MotionPanel
        isOpen={activeSidebarItem === 'Motion'}
        onClose={() => setActiveSidebarItem(null)}
        topToolbarHeight={topToolbarHeight}
        motionControls={motionControls}
        onStepEdit={handleEditStep}
        isMotionCaptureActive={isMotionCaptureActive}
        editingStepId={editingStepId}
      />
    </div>
  )
}

export default EditorPage
