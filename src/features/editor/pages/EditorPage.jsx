import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Link, useParams } from 'react-router-dom'
import { Layers, FileText } from 'lucide-react'
import Stage from '../components/Stage'
import { addScene, selectScenes, selectCurrentSceneId, selectCurrentScene, updateScene, deleteScene, splitScene, deleteLayer, selectLayers, updateLayer, copyLayers, pasteLayers, copyScene, pasteScene, selectLastPastedLayerIds, addSceneMotionStep, deleteSceneMotionStep, selectSceneMotionFlow, initializeSceneMotionFlow, selectProjectTimelineInfo, addSceneMotionAction, updateSceneMotionAction, deleteSceneMotionAction, selectSceneMotionFlows, reorderLayer, fetchProjectById, saveProject, selectProjectName, setProjectName, selectProjectId, resetProject, selectAspectRatio, setAspectRatio, setCurrentScene, updateSceneMotionFlow, initializeProject } from '../../../store/slices/projectSlice'
import { selectSelectedLayerIds, selectSelectedCanvas, clearLayerSelection, setSelectedLayer } from '../../../store/slices/selectionSlice'
import { undo, redo } from '../../../store/slices/historySlice'
import { saveAs } from 'file-saver'
import { exportVideo } from '../utils/videoExport'
import { Loader2 } from 'lucide-react'
import MotionInspector from '../components/MotionInspector'
import MotionPanel from '../components/MotionPanel'
import TopToolbar from '../components/TopToolbar'
import LeftSidebar, { SIDEBAR_ITEMS } from '../components/LeftSidebar'
import Modal from '../components/Modal'
import ScenesBar from '../components/ScenesBar'
import CanvasControls from '../components/CanvasControls'
import PlaybackControls from '../components/PlaybackControls'
import ElementsPanel from '../components/ElementsPanel'
import DesignPanel from '../components/DesignPanel'
import TextPanel from '../components/TextPanel'
import UploadsPanel from '../components/UploadsPanel'
import ImagesPanel from '../components/ImagesPanel'
import ToolsPanel from '../components/ToolsPanel'
import ProjectsPanel from '../components/ProjectsPanel'
import AppsPanel from '../components/AppsPanel'
import ColorPickerPanel from '../components/ColorPickerPanel'
import PositionPanel from '../components/PositionPanel'
import { useEditorSidebar } from '../hooks/useEditorSidebar'
import { useEditorPlayback } from '../hooks/useEditorPlayback'
import { useEditorLayout } from '../hooks/useEditorLayout'
import { useWorldDimensions } from '../hooks/useWorldDimensions'
import { applyTransformInline } from '../hooks/useCanvasLayers'
import { resetGlobalMotionEngine } from '../../engine/motion'
import ErrorBoundary from '../../../components/ErrorBoundary'
import * as PIXI from 'pixi.js'
import { useAssetPreloader } from '../hooks/useAssetPreloader'

const GUEST_TEMPLATE = {
  name: 'Practice Project',
  aspectRatio: '16:9',
  scenes: [
    {
      id: 'scene-guest-1',
      name: 'Scene 1',
      duration: 5.0,
      transition: 'None',
      backgroundColor: 0xffffff,
      layers: ['bg-guest-1', 'shape-guest-1', 'text-guest-1'],
    }
  ],
  layers: {
    'bg-guest-1': {
      id: 'bg-guest-1',
      sceneId: 'scene-guest-1',
      type: 'background',
      name: 'Background',
      visible: true,
      locked: false,
      opacity: 1.0,
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      anchorX: 0,
      anchorY: 0,
      data: { color: 0xffffff },
    },
    'shape-guest-1': {
      id: 'shape-guest-1',
      sceneId: 'scene-guest-1',
      type: 'shape',
      name: 'Practice Box',
      visible: true,
      locked: false,
      opacity: 1.0,
      x: 400,
      y: 540,
      width: 200,
      height: 200,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      anchorX: 0.5,
      anchorY: 0.5,
      data: {
        shapeType: 'rect',
        fill: '#000000',
        stroke: '',
        strokeWidth: 0,
      },
    },
    'text-guest-1': {
      id: 'text-guest-1',
      sceneId: 'scene-guest-1',
      type: 'text',
      name: 'Instructions',
      visible: true,
      locked: false,
      opacity: 1.0,
      x: 960,
      y: 200,
      width: 1000,
      height: 100,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      anchorX: 0.5,
      anchorY: 0.5,
      data: {
        content: "Click Add Step, move or change the box, then click Add Step again to apply",
        fontSize: 54,
        color: '#000000',
        fontFamily: 'Inter',
        fontWeight: 'bold',
        textAlign: 'center',
      },
    }
  },
  sceneMotionFlows: {
    'scene-guest-1': {
      steps: [],
      pageDuration: 5000,
    }
  },
  currentSceneId: 'scene-guest-1'
}

function EditorPage() {
  const dispatch = useDispatch()
  const scenes = useSelector(selectScenes)
  const currentSceneId = useSelector(selectCurrentSceneId)
  const selectedLayerIds = useSelector(selectSelectedLayerIds)
  const selectedCanvas = useSelector(selectSelectedCanvas)
  const layers = useSelector(selectLayers)
  const { isAuthenticated } = useSelector((state) => state.auth)

  const lastPastedLayerIds = useSelector(selectLastPastedLayerIds)
  const { projectId: urlProjectId } = useParams()
  const projectName = useSelector(selectProjectName)
  const projectId = useSelector(selectProjectId)
  const projectStatus = useSelector(state => state.project.status)
  const [isSaving, setIsSaving] = useState(false)
  const aspectRatio = useSelector(selectAspectRatio)
  const [showGrid, setShowGrid] = useState(false)
  const [showSafeArea, setShowSafeArea] = useState(false)
  const [showMotionPaths, setShowMotionPaths] = useState(false)
  const [zoom, setZoom] = useState(43)
  const [showGuestModal, setShowGuestModal] = useState(false)
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
  const [lastSaved, setLastSaved] = useState(Date.now())
  const [colorPickerType, setColorPickerType] = useState('fill') // 'fill' or 'text' or 'stroke'
  const [sidebarWidth, setSidebarWidth] = useState('3.5rem')
  const [isMotionPanelOpen, setIsMotionPanelOpen] = useState(false)
  const [motionCaptureMode, setMotionCaptureMode] = useState(null)
  const [motionControls, setMotionControls] = useState(null)
  const hasInitializedScene = useRef(false)
  const stageRef = useRef(null)
  const viewportDataRef = useRef(null)
  const isDraggingScrollbar = useRef(false)
  const scrollbarDragType = useRef(null) // 'vertical' or 'horizontal'
  const lastMousePos = useRef({ x: 0, y: 0 })

  // Refs for direct DOM manipulation to guarantee sync and performance
  const canvasContainerRef = useRef(null)
  const vTrackRef = useRef(null)
  const hTrackRef = useRef(null)
  const vThumbRef = useRef(null)
  const hThumbRef = useRef(null)

  // Calculate world dimensions
  const { worldWidth, worldHeight } = useWorldDimensions(aspectRatio)

  // Preload assets before showing editor to ensure smooth UX, especially for duplicated templates
  const [isPixiReady, setIsPixiReady] = useState(false)
  const isPreloading = useAssetPreloader(layers, isPixiReady)

  const handleViewportChange = useCallback((data) => {
    if (!data) return
    viewportDataRef.current = data

    // Use values from data with reliable fallbacks
    const scale = data.scale || 1
    const sw = data.screenWidth || 0
    const sh = data.screenHeight || 0
    const ww = data.worldWidth || worldWidth
    const wh = data.worldHeight || worldHeight
    const l = data.left !== undefined ? data.left : 0
    const t = data.top !== undefined ? data.top : 0


    if (sw <= 0 || sh <= 0) return

    const totalWorldWidth = ww * scale
    const totalWorldHeight = wh * scale

    const needsV = totalWorldHeight > (sh + 2)
    const needsH = totalWorldWidth > (sw + 2)

    if (vTrackRef.current) vTrackRef.current.style.display = needsV ? 'block' : 'none'
    if (hTrackRef.current) hTrackRef.current.style.display = needsH ? 'block' : 'none'

    if (needsV && vThumbRef.current) {
      const vTrackH = sh - 23 // top 8 + bottom 15
      const thumbH = Math.max(40, Math.min(vTrackH, (sh / totalWorldHeight) * vTrackH))
      const maxT = wh - sh / scale
      const ratio = maxT <= 1 ? 0 : Math.max(0, Math.min(1, t / maxT))

      const pos = ratio * (vTrackH - thumbH)
      vThumbRef.current.style.height = `${thumbH}px`
      vThumbRef.current.style.top = `${pos}px`
    }

    if (needsH && hThumbRef.current) {
      const hTrackW = sw - 23 // left 8 + right 15
      const thumbW = Math.max(40, Math.min(hTrackW, (sw / totalWorldWidth) * hTrackW))
      const maxL = ww - sw / scale
      const ratio = maxL <= 1 ? 0 : Math.max(0, Math.min(1, l / maxL))

      const pos = ratio * (hTrackW - thumbW)
      hThumbRef.current.style.width = `${thumbW}px`
      hThumbRef.current.style.left = `${pos}px`
    }
  }, [worldWidth, worldHeight])

  const handleScrollbarMouseDown = useCallback((e, type) => {
    e.preventDefault()
    e.stopPropagation()
    isDraggingScrollbar.current = true
    scrollbarDragType.current = type
    lastMousePos.current = { x: e.clientX, y: e.clientY }
  }, [])

  useEffect(() => {
    const handleMouseMove = (e) => {
      const viewportData = viewportDataRef.current
      if (!isDraggingScrollbar.current || !viewportData || !stageRef.current) return

      const deltaX = e.clientX - lastMousePos.current.x
      const deltaY = e.clientY - lastMousePos.current.y
      lastMousePos.current = { x: e.clientX, y: e.clientY }

      const { scale, screenWidth, screenHeight, worldWidth, worldHeight } = viewportData
      const totalWorldWidth = worldWidth * scale
      const totalWorldHeight = worldHeight * scale

      if (scrollbarDragType.current === 'vertical') {
        const vTrackHeight = screenHeight - 23
        const thumbHeight = Math.max(40, Math.min(vTrackHeight, (screenHeight / totalWorldHeight) * vTrackHeight))
        const scrollableTrack = vTrackHeight - thumbHeight

        if (scrollableTrack <= 0) return

        const scrollableWorldRange = worldHeight - screenHeight / scale
        const panAmount = (deltaY / scrollableTrack) * scrollableWorldRange

        const currentCenter = stageRef.current.getViewportData()
        if (currentCenter) {
          const newCenterY = (currentCenter.top + currentCenter.bottom) / 2 + panAmount
          stageRef.current.setViewportPosition((currentCenter.left + currentCenter.right) / 2, newCenterY)
        }
      } else {
        const hTrackWidth = screenWidth - 23
        const thumbWidth = Math.max(40, Math.min(hTrackWidth, (screenWidth / totalWorldWidth) * hTrackWidth))
        const scrollableTrack = hTrackWidth - thumbWidth

        if (scrollableTrack <= 0) return

        const scrollableWorldRange = worldWidth - screenWidth / scale
        const panAmount = (deltaX / scrollableTrack) * scrollableWorldRange

        const currentCenter = stageRef.current.getViewportData()
        if (currentCenter) {
          const newCenterX = (currentCenter.left + currentCenter.right) / 2 + panAmount
          stageRef.current.setViewportPosition(newCenterX, (currentCenter.top + currentCenter.bottom) / 2)
        }
      }
    }

    const handleMouseUp = () => {
      isDraggingScrollbar.current = false
      scrollbarDragType.current = null
      document.body.style.userSelect = ''
    }

    const onWindowMouseMove = (e) => {
      if (isDraggingScrollbar.current) {
        handleMouseMove(e)
      }
    }

    const onWindowMouseUp = () => {
      if (isDraggingScrollbar.current) {
        handleMouseUp()
      }
    }

    window.addEventListener('mousemove', onWindowMouseMove)
    window.addEventListener('mouseup', onWindowMouseUp)

    return () => {
      window.removeEventListener('mousemove', onWindowMouseMove)
      window.removeEventListener('mouseup', onWindowMouseUp)
    }
  }, [])

  // Export State
  const sceneMotionFlows = useSelector(selectSceneMotionFlows)
  const timelineInfo = useSelector(selectProjectTimelineInfo)
  const [exportState, setExportState] = useState({
    isActive: false,
    status: 'rendering', // 'rendering', 'encoding', 'completed', 'error'
    progress: 0,
    error: null
  })
  const exportAbortControllerRef = useRef(null)
  const isExportActiveRef = useRef(false)

  useEffect(() => {
    isExportActiveRef.current = exportState.isActive
  }, [exportState.isActive])

  const lastSavedStateRef = useRef(null)

  const handleSave = useCallback(async (options = {}) => {
    if (!isAuthenticated) {
      setShowGuestModal(true)
      return
    }
    if (isExportActiveRef.current) return

    const { force = false, silent = false } = options

    // [PERFORMANCE] Dirty check: Compare current state with last saved state
    // to avoid redundant saves and expensive thumbnail captures.
    const projectState = {
      name: projectName,
      scenes,
      layers,
      sceneMotionFlows,
      aspectRatio
    }

    const stateString = JSON.stringify(projectState)
    if (!force && stateString === lastSavedStateRef.current) {
      // console.log('[Save] Skipping save: No changes detected.')
      return
    }

    if (!silent) setIsSaving(true)
    try {
      // Capture a high-quality thumbnail from the ARTBOARD area
      let thumbnail = null
      try {
        const app = stageRef.current?.getApp?.()
        const layersContainer = stageRef.current?.getLayersContainer?.()

        if (app?.renderer && layersContainer) {
          // [QUALITY] Target the layersContainer instead of app.stage.
          // Since layersContainer is a child of the viewport but represents
          // the world space, capturing it with 1:1 scale ensures the thumbnail
          // is never affected by editor zoom/pan.
          const targetWidth = 400
          const targetResolution = Math.min(1, targetWidth / worldWidth)

          thumbnail = await app.renderer.extract.base64({
            target: layersContainer,
            frame: new PIXI.Rectangle(0, 0, worldWidth, worldHeight),
            format: 'image/webp',
            quality: 0.8,
            resolution: targetResolution
          })
        }
      } catch (thumbErr) {
        console.error('[Save] Could not capture thumbnail:', thumbErr)
      }

      await dispatch(saveProject({ thumbnail })).unwrap()
      lastSavedStateRef.current = stateString
      setLastSaved(Date.now())
    } catch (error) {
      console.error('Failed to save project:', error)
    } finally {
      if (!silent) setIsSaving(false)
    }
  }, [dispatch, isAuthenticated, projectName, scenes, layers, sceneMotionFlows, aspectRatio, worldWidth, worldHeight])

  // handleNavigate ensures we save the project before leaving the editor
  // when the user clicks the dashboard/user icon.
  const handleNavigate = useCallback(async (path) => {
    if (isAuthenticated) {
      await handleSave({ silent: false })
    }
    // [FIX] Force full page reload to release WebGL context
    window.location.href = path
  }, [isAuthenticated, handleSave])

  const handleCancelExport = useCallback(() => {
    if (exportAbortControllerRef.current) {
      exportAbortControllerRef.current.abort()
      exportAbortControllerRef.current = null
    }
    setExportState({ isActive: false, status: 'rendering', progress: 0, error: null })
  }, [])

  const handleExport = useCallback(async (resolution) => {
    if (exportState.isActive) return

    const savedTime = playheadTimeRef.current || 0

    if (motionControls?.isPlaying) {
      try { motionControls.pauseAll() } catch (e) { /* ignore */ }
    }

    setExportState({
      isActive: true,
      status: 'initializing',
      progress: 0,
      error: null
    })

    const controller = new AbortController()
    exportAbortControllerRef.current = controller

    try {
      const videoBlob = await exportVideo({
        scenes,
        layers,
        sceneMotionFlows,
        timelineInfo,
        aspectRatio,
        resolution,
        fps: 30,
        onProgress: (update) => {
          setExportState(prev => ({
            ...prev,
            status: update.status,
            progress: update.progress
          }))
        },
        signal: controller.signal,
        editorMotionControls: motionControls
      })

      saveAs(videoBlob, `${projectName || 'video'}_${resolution}.mp4`)

      setExportState(prev => ({
        ...prev,
        status: 'completed',
        progress: 100
      }))

      // Close overlay after a short delay
      setTimeout(() => {
        setExportState(prev => ({ ...prev, isActive: false }))
      }, 2000)

    } catch (error) {
      if (error.message === 'cancelled') {
        setExportState({ isActive: false, status: 'rendering', progress: 0, error: null })
        return
      }
      console.error('Export failed:', error)
      setExportState({
        isActive: true,
        status: 'error',
        progress: 0,
        error: error.message
      })
    } finally {
      exportAbortControllerRef.current = null
      if (motionControls) {
        try { motionControls.seek(savedTime) } catch (e) { /* ignore */ }
      }
    }
  }, [scenes, layers, sceneMotionFlows, timelineInfo, projectName, exportState.isActive, motionControls, aspectRatio])

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

  // [LAYOUT FIX] Capture initial bottom section height for stable canvas centering
  // The user wants the canvas to be centered based on the INITIAL layout,
  // and NOT resize or "flinch" when the timeline is later resized.
  const [initialBottomHeight, setInitialBottomHeight] = useState(0)
  useEffect(() => {
    if (bottomSectionHeight > 0 && initialBottomHeight === 0) {
      setInitialBottomHeight(bottomSectionHeight)
    }
  }, [bottomSectionHeight, initialBottomHeight])

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

  // Load project if ID is provided in URL
  useEffect(() => {
    if (urlProjectId && urlProjectId !== projectId) {
      dispatch(fetchProjectById(urlProjectId))
    }
  }, [urlProjectId, dispatch, projectId])

  // Initialize default scene if none exists (only once and if not loading)
  useEffect(() => {
    if (projectStatus === 'loading') return
    if (!hasInitializedScene.current && scenes.length === 0 && !urlProjectId) {
      hasInitializedScene.current = true

      if (!isAuthenticated) {
        // [GUEST TEMPLATE] Initialize with a practice project for guest users
        dispatch(initializeProject(GUEST_TEMPLATE))
      } else {
        // Default empty scene for authenticated users
        dispatch(addScene({
          name: 'Scene 1',
          duration: 5.0,
          transition: 'None',
        }))
      }
    }
  }, [dispatch, scenes.length, projectStatus, urlProjectId, isAuthenticated])

  // Reset global motion engine and project state on unmount to prevent
  // WebGL/GSAP leaks and stale Redux state on re-entry
  useEffect(() => {
    // [FIX] Reset hasInitializedScene on mount so new editor sessions
    // always initialize a default scene if needed.
    hasInitializedScene.current = false
    return () => {
      resetGlobalMotionEngine()
      // [FIX] Clean re-entry: Reset project state on unmount so the next
      // editor session starts with a clean slate. Doing this on unmount
      // (instead of mount) avoids crashing PIXI objects mid-lifecycle.
      dispatch(resetProject())
    }
  }, [])

  // [FIX] Best-effort auto-save on tab/window closure.
  // We use beforeunload to trigger a save. Since saveProject is async,
  // this is "best effort" and may not always complete depending on the browser.
  useEffect(() => {
    const handleTabClose = (e) => {
      if (isAuthenticated && projectId) {
        // We don't block the exit with a confirmation, just fire the save.
        // Some browsers allow async work to finish if it's fast enough.
        handleSave({ silent: true })
      }
    }

    window.addEventListener('beforeunload', handleTabClose)
    return () => window.removeEventListener('beforeunload', handleTabClose)
  }, [isAuthenticated, projectId, handleSave])

  // Get current scene data from Redux
  const currentSceneData = useSelector(selectCurrentScene)

  const sceneLayersOrdered = useMemo(() => {
    if (!currentSceneData?.layers) return []
    return currentSceneData.layers.map(id => layers[id]).filter(Boolean)
  }, [currentSceneData, layers])

  const handlePositionReorder = useCallback((fromIndex, toIndex) => {
    if (!currentSceneId) return
    if (fromIndex === toIndex) return
    if (fromIndex === 0 || toIndex === 0) return
    dispatch(reorderLayer({ sceneId: currentSceneId, fromIndex, toIndex }))
  }, [dispatch, currentSceneId])

  const handleSelectFromPositionPanel = useCallback((layerId) => {
    if (layerId) {
      dispatch(setSelectedLayer(layerId))
    }
  }, [dispatch])

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
    dispatch(setAspectRatio(newAspectRatio))
  }




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
  const savedStepTimingsRef = useRef(null) // Snapshot of step timings before adding a new step (for cancel restoration)
  const motionControlsRef = useRef(null) // Ref to hold motion playback controls from Stage

  // Get motion flow for current scene
  const currentSceneMotionFlow = useSelector((state) =>
    currentSceneId ? selectSceneMotionFlow(state, currentSceneId) : null
  )

  // Get timeline info for seeking

  const currentSceneTimelineInfo = useMemo(() => {
    if (!timelineInfo || !currentSceneId) return null
    return timelineInfo.find(s => s.id === currentSceneId)
  }, [timelineInfo, currentSceneId])
  const startTimeOffset = currentSceneTimelineInfo?.startTime || 0

  // Check if motion capture is active
  const isMotionCaptureActive = !!motionCaptureMode?.isActive

  // Determine which step (if any) the playhead is currently over
  const playheadStepId = useMemo(() => {
    if (!currentSceneId || !currentSceneMotionFlow?.steps?.length) return null
    if (!currentSceneTimelineInfo) return null

    const timeInSceneMs = (playheadTime - currentSceneTimelineInfo.startTime) * 1000
    if (timeInSceneMs < 0) return null

    const step = currentSceneMotionFlow.steps.find(s => {
      const start = s.startTime || 0
      const duration = s.duration || 0
      return timeInSceneMs >= start && timeInSceneMs <= start + duration
    })

    return step?.id || null
  }, [currentSceneId, currentSceneMotionFlow, currentSceneTimelineInfo, playheadTime])

  // Effect: Exit motion capture mode when switching scenes
  // We use a ref to track the previous scene ID to detect changes
  const prevSceneIdRef = useRef(currentSceneId)

  useEffect(() => {
    // If scene changed and we are in motion capture mode, cancel it
    if (prevSceneIdRef.current !== currentSceneId) {
      // [BUG 2 FIX] Skip cleanup if we're in the Add Step transitioning state.
      // During the fast-play preview, the playhead might briefly trigger a scene switch
      // (e.g., due to floating-point precision at scene boundaries).
      // Deleting the step in this case is incorrect — the user didn't navigate away.
      if (motionCaptureMode?.isTransitioning) {
        // Revert the scene switch — stay on the original scene
        dispatch(setCurrentScene(prevSceneIdRef.current))
        return
      }

      if (motionCaptureRef.current) { // Check if we were capturing

        // 1. Remove the tentative step — restore saved timings if available
        if (isNewStepRef.current && savedStepTimingsRef.current) {
          dispatch(updateSceneMotionFlow({
            sceneId: prevSceneIdRef.current,
            steps: savedStepTimingsRef.current
          }))
          savedStepTimingsRef.current = null
        } else if (motionCaptureRef.current.stepId) {
          dispatch(deleteSceneMotionStep({
            sceneId: prevSceneIdRef.current,
            stepId: motionCaptureRef.current.stepId
          }))
        }

        // [CROP FIX] Reset all PIXI objects to their base Redux state when scene switches
        if (motionControls && motionControls.layerObjects && layers) {
          const layerObjects = motionControls.layerObjects
          layerObjects.forEach((pixiObject, layerId) => {
            const baseLayerData = layers[layerId]
            if (baseLayerData && pixiObject && !pixiObject.destroyed) {
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
  }, [currentSceneId, dispatch, motionControls, layers, motionCaptureMode])

  /**
   * Start motion capture: auto-add a new step and enter capture mode
   */
  const handleStartMotionCapture = useCallback(() => {
    if (!currentSceneId) return

    // [BUG 1 FIX] Clear any layer selection BEFORE starting the tween.
    // Without this, the auto-pause effect in Stage.jsx sees selectedLayerIds.length > 0
    // and isPlaying=true (from tweenTo) but motionCaptureMode.isActive is still false
    // (set in onComplete), so it calls pausePlayback() killing the tween.
    dispatch(clearLayerSelection())

    // 1. Ensure motion flow exists
    dispatch(initializeSceneMotionFlow({ sceneId: currentSceneId }))

    // 2. Snapshot current step timings BEFORE adding the new step.
    // addSceneMotionStep triggers syncSceneMotionDuration which redistributes durations.
    // If the user cancels, we restore this snapshot to undo the redistribution.
    savedStepTimingsRef.current = currentSceneMotionFlow?.steps
      ? JSON.parse(JSON.stringify(currentSceneMotionFlow.steps))
      : []

    // 3. Create a new step ID
    const newStepId = `step-${Date.now()}`

    // 4. Dispatch action to add the step
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
        isTransitioning: false,
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

    // [BUG 1 FIX] Set transitioning state BEFORE the tween starts.
    // This prevents the auto-pause effect in Stage.jsx from interfering
    // even if selection clearing and isPlaying batching has timing issues.
    setMotionCaptureMode({ isActive: false, isTransitioning: true, stepId: newStepId })

    if (motionControls && stepIndex > 0) {
      const pageDuration = currentSceneMotionFlow?.pageDuration || 5000

      // [FIX] Use the OLD flow's timing for the target — the engine still has this layout.
      // The engine will rebuild with the new layout after React re-renders.
      // existingFlow is from stale React state (before addSceneMotionStep dispatch),
      // which is EXACTLY what the engine's internal masterTimeline currently matches.
      const lastExisting = existingFlow[existingFlow.length - 1]
      const lastStepEnd = lastExisting
        ? (lastExisting.startTime || 0) + (lastExisting.duration || Math.round(pageDuration / existingFlow.length))
        : pageDuration
      let stepStartTimeSeconds = startTimeOffset + lastStepEnd / 1000

      // [BUG 2 FIX] Clamp the tween target to stay safely within the current scene boundary.
      // Without this, when existing steps fill the entire scene duration, the target equals
      // the scene's end time. The tween can overshoot (floating point), causing
      // useEditorPlayback to auto-switch to the next scene, which triggers the scene-switch
      // effect that deletes the newly created step.
      const sceneEndTime = currentSceneTimelineInfo?.endTime || (startTimeOffset + 5)
      stepStartTimeSeconds = Math.min(stepStartTimeSeconds, sceneEndTime - 0.05)


      try {
        motionControls.tweenTo(stepStartTimeSeconds, {
          duration: Math.min(stepIndex * 0.3, 1.5),
          startTime: startTimeOffset,
          onComplete: () => {
            enableCaptureMode()
          }
        })
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
  }, [currentSceneId, currentSceneMotionFlow, layers, dispatch, motionControls, startTimeOffset, currentSceneTimelineInfo])

  /**
   * Apply captured motion and exit capture mode
   */
  const handleApplyMotion = useCallback((options = {}) => {
    // Check if we have captured motion data
    if (!motionCaptureMode || !motionCaptureMode.trackedLayers || motionCaptureMode.trackedLayers.size === 0) {
      // Nothing was captured — restore original step timings if this was a new step
      if (editingStepId && currentSceneId && isNewStepRef.current && savedStepTimingsRef.current) {
        dispatch(updateSceneMotionFlow({
          sceneId: currentSceneId,
          steps: savedStepTimingsRef.current
        }))
        savedStepTimingsRef.current = null
      } else if (editingStepId && currentSceneId) {
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
      // Use absolute startTime for timing
      const timingStep = motionFlow[stepIndex]
      const stepStartMs = timingStep?.startTime != null ? timingStep.startTime : (stepIndex * stepDuration)
      const effectiveDuration = timingStep?.duration || stepDuration
      const stepStartTimeSeconds = startTimeOffset + stepStartMs / 1000
      const calculatedEndTime = stepStartTimeSeconds + effectiveDuration / 1000
      // Clamp to scene boundary with a safe buffer to prevent the playhead from
      // overshooting into the next scene (which triggers auto scene-switch and step deletion).
      const sceneEndTime = currentSceneTimelineInfo?.endTime || calculatedEndTime
      const stepEndTimeSeconds = Math.min(calculatedEndTime, sceneEndTime - 0.05)

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
                controlPoints: preservedControlPoints,
                duration: effectiveDuration,
                easing: 'power4.out'
              }
            }
            if (moveIdx !== -1) {
              actions[moveIdx] = moveAction
            } else {
              actions.push(moveAction)
            }
          } else {
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
                  duration: effectiveDuration,
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
                duration: effectiveDuration,
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
                dx: moveActionExists ? undefined : deltaX,
                dy: moveActionExists ? undefined : deltaY,
                duration: effectiveDuration,
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

      // [RACE CONDITION FIX] Build optimistic flow that matches what we just dispatched to Redux
      // This ensures preview uses the exact same data structure that will be in Redux after update
      const optimisticFlow = { ...currentFlow, steps: updatedSteps }


      motionControls.tweenTo(stepEndTimeSeconds, {
        duration: 1,
        startTime: stepStartTimeSeconds,
        flow: optimisticFlow,
        onComplete: () => {
          // The tween has scrubbed to stepEndTimeSeconds with correct action durations.
          // The overridden flow matches what was dispatched to Redux, so the visual state
          // is already correct. Just seek to hold position — the natural engine rebuild
          // (triggered by the React re-render when isPlaying changes to false) will
          // sync the engine with the latest Redux state without any visible jump.
          motionControls.seek(stepEndTimeSeconds)
        }
      })

      // [FIX] Clear capture mode AFTER triggering tweenTo to ensure 
      // the engine has started its internal 'isPlaying' state before 
      // React re-renders and potentially cancels the preview.
      setMotionCaptureMode(null)
      setEditingStepId(null)
      motionCaptureRef.current = null
      savedStepTimingsRef.current = null // Step applied successfully, discard snapshot
    } else {
      // No motionControls available, just clear capture mode
      setMotionCaptureMode(null)
      setEditingStepId(null)
      motionCaptureRef.current = null
      savedStepTimingsRef.current = null
    }
  }, [motionCaptureMode, editingStepId, currentSceneId, currentSceneMotionFlow, dispatch, motionControls, startTimeOffset, currentSceneTimelineInfo])

  /**
   * Cancel motion capture: delete the auto-created step and exit
   * CRITICAL: Reset all PIXI objects to their base Redux state to prevent crop value leaks
   */
  const handleCancelMotion = useCallback(() => {
    if (editingStepId && currentSceneId) {
      if (isNewStepRef.current) {
        // Restore the saved step timings snapshot from BEFORE addSceneMotionStep was dispatched.
        // This removes the new step AND undoes the duration redistribution in one operation,
        // so existing steps return to their original durations.
        if (savedStepTimingsRef.current) {
          dispatch(updateSceneMotionFlow({
            sceneId: currentSceneId,
            steps: savedStepTimingsRef.current
          }))
          savedStepTimingsRef.current = null
        } else {
          dispatch(deleteSceneMotionStep({
            sceneId: currentSceneId,
            stepId: editingStepId
          }))
        }
      }
    }

    // [CROP FIX] Reset all PIXI objects to their base Redux state before exiting capture mode
    if (motionControls && motionControls.layerObjects && layers) {
      const layerObjects = motionControls.layerObjects
      layerObjects.forEach((pixiObject, layerId) => {
        const baseLayerData = layers[layerId]
        if (baseLayerData && pixiObject && !pixiObject.destroyed) {
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

  /**
   * Select a step (highlight + seek) WITHOUT entering capture mode.
   * This is the default click behavior for step blocks.
   * Editing only happens via explicit controls (context menu "Update Step", MotionPanel buttons).
   */
  const handleSelectStep = useCallback((stepId) => {
    if (!currentSceneId) return

    // If currently in capture mode, apply or cancel first
    if (isMotionCaptureActive) {
      if (stepId === 'base') {
        handleCancelMotion()
      } else {
        handleApplyMotion({ skipPreview: true })
      }
    }

    // Set the visual selection
    setEditingStepId(stepId)

    // Seek to the step's timeline position
    if (stepId === 'base') {
      seek(startTimeOffset)
      setMotionCaptureMode(null)
      motionCaptureRef.current = null
      return
    }

    // Find step timing and seek to its start position
    const motionFlow = currentSceneMotionFlow?.steps || []
    const stepIndex = motionFlow.findIndex(s => s.id === stepId)
    if (stepIndex === -1) return

    const step = motionFlow[stepIndex]
    const pageDuration = currentSceneMotionFlow?.pageDuration || 5000
    const stepCount = motionFlow.length
    const stepDuration = stepCount > 0 ? pageDuration / stepCount : pageDuration
    const stepStartMs = step.startTime != null ? step.startTime : (stepIndex * stepDuration)
    const stepStartTimeSeconds = startTimeOffset + stepStartMs / 1000

    seek(stepStartTimeSeconds)
  }, [currentSceneId, isMotionCaptureActive, handleCancelMotion, handleApplyMotion, seek, startTimeOffset, currentSceneMotionFlow])

  /**
   * Edit an existing motion step (Centralized logic for both Panel and Timeline)
   */
  const handleEditStep = useCallback((stepId) => {
    // 1. EXIT/TOGGLE CASE: If we're already editing this exact step, apply and exit
    if (isMotionCaptureActive && editingStepId === stepId) {
      handleApplyMotion()
      return
    }

    // [STABILITY] If clicking on an already active step but not in capture mode, just ensure we're there
    if (!isMotionCaptureActive && editingStepId === stepId && stepId !== 'base') {
      // Re-trigger capture for this step if it lost focus but is still active
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

    // INSTANT FEEDBACK: Glow the block immediately regardless of state
    setEditingStepId(stepId)

    // 3. BASE CASE: Snap playhead to scene start
    if (stepId === 'base') {
      // Seek UI and Engine together
      if (seek) {
        seek(startTimeOffset)
      } else {
        setPlayheadTime(startTimeOffset)
        playheadTimeRef.current = startTimeOffset
      }

      // Ensure state is clean
      setMotionCaptureMode(null)
      motionCaptureRef.current = null
      return
    }

    // Mark as EXISTING step being edited
    isNewStepRef.current = false

    const motionFlow = currentSceneMotionFlow?.steps || []
    const stepIndex = motionFlow.findIndex(s => s.id === stepId)
    if (stepIndex === -1) return

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

      initialTrackedLayers.set(layerId, {
        initialTransform: sessionStartTransform,
        currentPosition: { x: currentTargetX, y: currentTargetY },
        deltaX,
        deltaY,
        width: sessionStartTransform.width,
        height: sessionStartTransform.height,
        scaleX: currentScale?.values?.dsx !== undefined ? sessionStartTransform.scaleX * currentScale.values.dsx : sessionStartTransform.scaleX,
        scaleY: currentScale?.values?.dsy !== undefined ? sessionStartTransform.scaleY * currentScale.values.dsy : sessionStartTransform.scaleY,
        rotation: currentRotate?.values?.dangle !== undefined ? sessionStartTransform.rotation + currentRotate.values.dangle : sessionStartTransform.rotation,
        cropX: currentCrop?.values?.cropX ?? sessionStartTransform.cropX,
        cropY: currentCrop?.values?.cropY ?? sessionStartTransform.cropY,
        cropWidth: currentCrop?.values?.cropWidth ?? sessionStartTransform.cropWidth,
        cropHeight: currentCrop?.values?.cropHeight ?? sessionStartTransform.cropHeight,
        mediaWidth: currentCrop?.values?.mediaWidth ?? sessionStartTransform.mediaWidth,
        mediaHeight: currentCrop?.values?.mediaHeight ?? sessionStartTransform.mediaHeight,
        controlPoints: currentMove?.values?.controlPoints || [],
        didMove: false,
        interactionType: null
      })
    })

    // 2. Prepare capture session
    const enableEditCapture = () => {
      if (motionControls && motionControls.getLayerCurrentTransforms) {
        const currentTransforms = motionControls.getLayerCurrentTransforms()
        currentTransforms.forEach((transform, layerId) => {
          if (initialTrackedLayers.has(layerId)) {
            const entry = initialTrackedLayers.get(layerId)
            entry.currentPosition.x = transform.x
            entry.currentPosition.y = transform.y
            entry.rotation = transform.rotation
            entry.scaleX = transform.scaleX
            entry.scaleY = transform.scaleY
            entry.deltaX = transform.x - entry.initialTransform.x
            entry.deltaY = transform.y - entry.initialTransform.y
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
        isTransitioning: false,
        stepId,
        onPositionUpdate: (data) => {
          const capture = motionCaptureRef.current
          if (!capture) return
          const entry = capture.trackedLayers.get(data.layerId)
          if (entry) {
            if (data.interactionType === 'move') entry.didMove = true
            if (data.x !== undefined && data.y !== undefined) {
              entry.currentPosition = { x: data.x, y: data.y }
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
            if (data.controlPoints !== undefined && Array.isArray(data.controlPoints)) {
              entry.controlPoints = data.controlPoints
            } else if (data.controlPoints === null) {
              entry.controlPoints = []
            }
          }
        },
        trackedLayers: initialTrackedLayers,
        layerActions: step?.layerActions || {}
      })
    }

    // 3. Sequential Playback / Fast-Preview
    // Clear selection and set transitioning state to prevent auto-pause and scene-switch during tween
    dispatch(clearLayerSelection())
    setMotionCaptureMode({ isActive: false, isTransitioning: true, stepId })

    if (motionControls) {
      const pageDuration = currentSceneMotionFlow.pageDuration || 5000
      const stepCount = motionFlow.length
      const stepDuration = stepCount > 0 ? pageDuration / stepCount : pageDuration
      const stepStartMs = step.startTime != null ? step.startTime : (stepIndex * stepDuration)
      const effectiveDuration = step.duration || stepDuration
      const stepStartTimeSeconds = startTimeOffset + stepStartMs / 1000
      const calculatedEndTime = stepStartTimeSeconds + effectiveDuration / 1000
      // Clamp to scene boundary with safe buffer to prevent overshoot into next scene
      const sceneEndTime = currentSceneTimelineInfo?.endTime || calculatedEndTime
      const stepEndTimeSeconds = Math.min(calculatedEndTime, sceneEndTime - 0.05)

      const hasActions = step.layerActions && Object.values(step.layerActions).some(actions => actions.length > 0)
      const targetTime = hasActions ? stepEndTimeSeconds : stepStartTimeSeconds

      motionControls.tweenTo(targetTime, {
        duration: 0.3,
        startTime: startTimeOffset,
        onComplete: enableEditCapture
      })
    } else {
      enableEditCapture()
    }
  }, [isMotionCaptureActive, editingStepId, handleApplyMotion, currentSceneId, currentSceneMotionFlow, layers, motionControls, startTimeOffset, currentSceneTimelineInfo, seek, handleCancelMotion, dispatch])






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

      // 'S' key — Split Page at playhead
      if (e.key.toLowerCase() === 's' && !isTyping && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        handleSplitScene()
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







  // [UI FIX] Global Browser Interruption Control
  // Prevent browser context menu and text selection from interfering with the editor
  useEffect(() => {
    const getElementTarget = (e) => {
      let t = e.target
      if (t && t.nodeType === Node.TEXT_NODE) t = t.parentElement
      return t
    }

    const isEditableTarget = (t) => {
      if (!t) return false
      return t.tagName === 'INPUT' ||
        t.tagName === 'TEXTAREA' ||
        t.isContentEditable ||
        (t.closest && t.closest('[contenteditable="true"]'))
    }

    const handleGlobalContextMenu = (e) => {
      if (!isEditableTarget(getElementTarget(e))) {
        e.preventDefault()
        return false
      }
    }

    const handleGlobalSelectStart = (e) => {
      if (!isEditableTarget(getElementTarget(e))) {
        e.preventDefault()
        return false
      }
    }

    // Add listeners with capture: true to ensure we catch them before browser defaults
    document.addEventListener('contextmenu', handleGlobalContextMenu, true)
    document.addEventListener('selectstart', handleGlobalSelectStart, true)

    return () => {
      document.removeEventListener('contextmenu', handleGlobalContextMenu, true)
      document.removeEventListener('selectstart', handleGlobalSelectStart, true)
    }
  }, [])


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
    if (!motionCaptureMode) return null

    // [BUG 1 FIX] During Add Step transition (fast-play preview), pass through the
    // transitioning flag so Stage.jsx's auto-pause effect can check it.
    if (motionCaptureMode.isTransitioning) {
      return { isActive: false, isTransitioning: true }
    }

    if (!motionCaptureMode.isActive) return null

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

  const handleSplitScene = useCallback(() => {
    if (!currentSceneId) return
    const sceneInfo = timelineInfo.find(s => s.id === currentSceneId)
    if (!sceneInfo) return

    const timeInScene = playheadTime - sceneInfo.startTime
    // [FIX] Frame Snapping: Align split to 60fps boundary
    const snappedSplitTime = Math.round(timeInScene * 60) / 60
    const snappedPlayheadTime = sceneInfo.startTime + snappedSplitTime

    if (timeInScene > 0.1 && timeInScene < (sceneInfo.endTime - sceneInfo.startTime - 0.1)) {
      if (motionControls) motionControls.pauseAll()
      setIsPlaying(false) // Immediate UI feedback
      dispatch(splitScene({
        sceneId: currentSceneId,
        splitTime: snappedSplitTime
      }))
      // Auto-seek past split point (using snapped time)
      seek(snappedPlayheadTime + 0.001)
    } else {
      alert("Move playhead inside a page to split it.")
    }
  }, [currentSceneId, timelineInfo, playheadTime, motionControls, dispatch, seek])

  return (
    <div
      className="h-dvh flex flex-col text-white overflow-hidden relative select-none"
      data-editor-container
      style={{
        touchAction: 'none',
        backgroundColor: '#0f1015'
      }}
      onDragStart={(e) => {
        // Prevent drag operations that might trigger text selection
        e.preventDefault()
      }}
    >
      {/* Guest Save/Import Modal */}
      {showGuestModal && (
        <Modal
          isOpen={showGuestModal}
          onClose={() => setShowGuestModal(false)}
          maxWidth="max-w-xs"
          showCloseButton={true}
        >
          <div className="flex flex-col items-center text-center">
            <div className="w-12 h-12 bg-purple-500/20 rounded-full flex items-center justify-center mb-4">
              <FileText className="h-6 w-6 text-purple-400" />
            </div>
            <h3 className="text-lg font-bold text-white mb-2">Open account to save</h3>
            <p className="text-zinc-400 text-sm mb-6 leading-relaxed">
              Create a free account to save your projects and access professional templates.
            </p>
            <div className="flex flex-col w-full gap-2">
              <button
                onClick={() => window.location.href = '/login'}
                className="w-full py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl font-semibold transition-all shadow-lg shadow-purple-500/20"
              >
                Sign up for free
              </button>
              <button
                onClick={() => setShowGuestModal(false)}
                className="w-full py-2 text-zinc-500 hover:text-zinc-300 text-xs font-medium transition-all"
              >
                Not now
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Loading Overlay */}
      {projectStatus === 'loading' && (
        <div className="absolute inset-0 z-[100] flex items-center justify-center bg-[#0f1015]/60 backdrop-blur-sm">
          <div className="w-10 h-10 border-4 border-purple-500/30 border-t-purple-500 rounded-full animate-spin"></div>
        </div>
      )}

      {/* Top Toolbar */}
      <div
        ref={topToolbarRef}
        className="absolute top-0 left-0 right-0 z-50 transition-all duration-300"
      >
        <TopToolbar
          projectName={projectName}
          onSave={handleSave}
          onNavigate={handleNavigate}
          isSaving={isSaving}
          lastSaved={lastSaved}
          onProjectNameChange={(newName) => dispatch(setProjectName(newName))}
          onExport={handleExport}
          onCanvasSizeChange={handleCanvasSizeChange}
          onToggleSidebar={() => handleSidebarItemClick('Elements')}
        />
      </div>

      <div
        className="hidden lg:block absolute left-0 z-50"
        style={{
          top: `${topToolbarHeight}px`,
          height: `calc(100vh - ${topToolbarHeight}px - ${bottomSectionHeight}px)`,
          transition: isResizingBottom ? 'none' : 'height 0.3s ease',
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
              {activeSidebarItem === 'Media' && (
                <ImagesPanel onClose={handleClosePanel} aspectRatio={aspectRatio} />
              )}
              {activeSidebarItem === 'Tools' && (
                <ToolsPanel onClose={handleClosePanel} />
              )}
              {activeSidebarItem === 'Position' && (
                <PositionPanel
                  onClose={handleClosePanel}
                  layers={sceneLayersOrdered}
                  selectedLayerId={selectedLayerIds[0]}
                  onSelectLayer={handleSelectFromPositionPanel}
                  onReorder={handlePositionReorder}
                />
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

          {/* Mobile: bottom sheet (~40% height) with horizontal nav at bottom */}
          {activeSidebarItem && (
            <>
              <div
                className="lg:hidden fixed inset-0 z-[60] bg-black/50 transition-opacity duration-200"
                style={{ top: 0 }}
                onClick={() => setActiveSidebarItem(null)}
                aria-hidden
              />
              <div
                className="lg:hidden fixed bottom-0 left-0 right-0 z-[61] flex flex-col rounded-t-2xl border-t border-white/10 shadow-2xl mobile-sheet-in"
                style={{
                  height: '80vh',
                  minHeight: '360px',
                  maxHeight: '90vh',
                  backgroundColor: '#0f1015',
                  paddingBottom: 'env(safe-area-inset-bottom, 0px)',
                }}
                onClick={(e) => e.stopPropagation()}
              >
                {/* Drag handle */}
                <div className="flex justify-center pt-2.5 pb-1 flex-shrink-0">
                  <div className="w-10 h-1 rounded-full bg-white/20" aria-hidden />
                </div>
                {/* Panel content - scrollable, same bg as sheet */}
                <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden" style={{ backgroundColor: '#0f1015' }}>
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
                  {activeSidebarItem === 'Media' && (
                    <ImagesPanel onClose={handleClosePanel} aspectRatio={aspectRatio} />
                  )}
                  {activeSidebarItem === 'Tools' && (
                    <ToolsPanel onClose={handleClosePanel} />
                  )}
                  {activeSidebarItem === 'Position' && (
                    <PositionPanel
                      onClose={handleClosePanel}
                      layers={sceneLayersOrdered}
                      selectedLayerId={selectedLayerIds[0]}
                      onSelectLayer={handleSelectFromPositionPanel}
                      onReorder={handlePositionReorder}
                    />
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
                {/* Horizontal minimal nav at bottom of sheet */}
                <div
                  className="flex-shrink-0 flex items-center justify-around gap-1 px-2 py-2.5 border-t border-white/5 bg-black/20"
                  style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
                >
                  {SIDEBAR_ITEMS.map((item) => {
                    const Icon = item.icon
                    const isActive = activeSidebarItem === item.label
                    return (
                      <button
                        key={item.label}
                        onClick={() => handleSidebarItemClick(item.label)}
                        className={`flex flex-col items-center justify-center gap-0.5 py-2 px-3 min-w-[64px] rounded-xl transition-all duration-200 touch-manipulation ${isActive ? 'bg-white/10 text-white' : 'text-zinc-400 active:bg-white/5'}`}
                      >
                        <Icon className="h-5 w-5 flex-shrink-0" strokeWidth={1.5} />
                        <span className="text-[10px] font-medium">{item.label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </>
          )}
        </div>


        {/* Canvas and Bottom Sections */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden relative">
          {/* Canvas Controls - Overlay at top (when element or canvas is selected)  */}
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
              onOpenPositionPanel={() => {
                setActiveSidebarItem(activeSidebarItem === 'Position' ? null : 'Position')
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

          {/* Canvas - Takes all available space */}
          <div
            ref={canvasContainerRef}
            className="absolute flex-1 overflow-hidden select-none"
            style={{
              top: topToolbarHeight,
              bottom: initialBottomHeight || 0,
              left: typeof window !== 'undefined' && window.innerWidth < 1024 ? '0px' : sidebarWidth,
              right: 0,
              backgroundColor: '#0f1015',
              zIndex: 10,
            }}
          >
            <Stage
              ref={stageRef}
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
              onViewportChange={handleViewportChange}
              topToolbarHeight={topToolbarHeight}
              isResizingBottom={isResizingBottom}
              onReady={() => setIsPixiReady(true)}
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

            {/* Asset Preloading Overlay */}
            {isPreloading && (
              <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-[#0f1015] transition-opacity duration-500">
                <div className="relative">
                  <div className="w-16 h-16 border-4 border-[#6940c9]/20 rounded-full"></div>
                  <div className="w-16 h-16 border-4 border-[#6940c9] border-t-transparent rounded-full animate-spin absolute inset-0"></div>
                  <Layers className="w-6 h-6 text-[#6940c9] absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 animate-pulse" />
                </div>
                <h3 className="mt-6 text-lg font-medium text-white tracking-tight">Loading Project Assets</h3>
                <p className="mt-2 text-sm text-white/50">Preparing your canvas...</p>
              </div>
            )}

            {/* Vertical Scrollbar Container */}
            <div
              ref={vTrackRef}
              className="absolute right-1.5 z-40 bg-black/60 backdrop-blur-md rounded-full"
              style={{
                top: 8,
                bottom: 15, // Clear vertical overlap even more
                width: '6px',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                display: 'none',
                pointerEvents: 'none'
              }}
            >
              <div
                ref={vThumbRef}
                className="w-full bg-white/90 hover:bg-white active:bg-white transition-colors cursor-pointer rounded-full absolute shadow-sm"
                style={{ pointerEvents: 'auto', left: 0 }}
                onMouseDown={(e) => {
                  handleScrollbarMouseDown(e, 'vertical')
                  document.body.style.userSelect = 'none'
                }}
              />
            </div>

            {/* Horizontal Scrollbar Container */}
            <div
              ref={hTrackRef}
              className="absolute bottom-2.5 z-40 bg-black/60 backdrop-blur-md rounded-full"
              style={{
                left: 8,
                right: 15, // Clear horizontal overlap even more
                height: '6px',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                display: 'none',
                pointerEvents: 'none',
              }}
            >
              <div
                ref={hThumbRef}
                className="h-full bg-white/90 hover:bg-white active:bg-white transition-colors cursor-pointer rounded-full absolute shadow-sm"
                style={{ pointerEvents: 'auto', top: 0 }}
                onMouseDown={(e) => {
                  handleScrollbarMouseDown(e, 'horizontal')
                  document.body.style.userSelect = 'none'
                }}
              />
            </div>
          </div>

          {/* Removed floating mobile menu button */}
        </div>

        {/* Bottom Sections - Overlay at bottom with glass effect */}
        <div
          ref={bottomSectionRef}
          className={`absolute bottom-0 right-0 z-30 flex flex-col pointer-events-auto ${!isResizingBottom ? 'transition-all duration-300' : ''}`}
          style={{
            left: typeof window !== 'undefined' && window.innerWidth < 1024 ? '0px' : sidebarWidth,
            backgroundColor: '#0f1015',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            borderTop: '1px solid rgba(255, 255, 255, 0.05)',
            paddingBottom: 'env(safe-area-inset-bottom, 8px)',
            ...(customBottomHeight !== null ? {
              height: `calc(${customBottomHeight}px + env(safe-area-inset-bottom, 0px))`,
              maxHeight: `calc(${customBottomHeight}px + env(safe-area-inset-bottom, 0px))`
            } : {})
          }}
        >
          {/* Height Resize Handle */}
          <div
            className={`absolute top-0 left-0 right-0 h-1.5 cursor-ns-resize z-50 group flex items-start justify-center`}
            onMouseDown={handleBottomResizeMouseDown}
            style={{ top: '-1px' }}
          >
            <div className={`w-full h-[2px] bg-gradient-to-r from-transparent via-[#7c4af0] to-transparent transition-opacity duration-300 ${isResizingBottom ? 'opacity-100' : 'opacity-40 group-hover:opacity-100'}`} />
          </div>
          {/* Content Container - Scrollable if content overflows */}
          <div className="flex flex-col flex-1" style={{
            minHeight: 0, // Allow flex item to shrink
            position: 'relative',
            paddingBottom: '0px' // Remove padding to make scenes bar touch bottom
          }}>
            {/* Scrollable Content Area - only playback + scenes; zoom is fixed below */}
            <div className="flex flex-col overflow-x-hidden flex-1 scrollbar-hide overflow-y-auto" style={{
              minHeight: 0
            }}>
              {/* Playback Controls - Top Section */}
              <div ref={playbackControlsRef} className="pointer-events-auto flex-shrink-0 relative w-full">
                <PlaybackControls
                  isPlaying={isPlaying}
                  isBuffering={motionControls?.isBuffering || false}
                  currentTime={playheadTime}
                  totalTime={totalTime}
                  onPlayPause={() => {
                    if (motionControls) {
                      if (isPlaying) {
                        motionControls.pauseAll()
                        setIsPlaying(false)
                      } else {
                        motionControls.playAll()
                        setIsPlaying(true)
                      }
                    }
                  }}
                  onSplit={handleSplitScene}
                  playheadStepId={playheadStepId}
                  onUpdateStep={handleEditStep}
                  onDeleteStep={(stepId) => {
                    if (currentSceneId && stepId) {
                      dispatch(deleteSceneMotionStep({
                        sceneId: currentSceneId,
                        stepId: stepId
                      }))
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
                  minWidth: 0,
                  backgroundColor: 'transparent',
                  overflowX: 'auto',
                  overflowY: 'visible',
                  WebkitOverflowScrolling: 'touch',
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
                  onStepClick={handleSelectStep}
                  onStepEdit={handleEditStep}
                  bottomSectionHeight={customBottomHeight}
                  onSeek={seek}
                  onMotionStop={handleMotionStop}
                />
              </div>
            </div>

            {/* Zoom slider - fixed at bottom, outside scroll; minimal height, simple white */}
            <div className="pointer-events-auto flex-shrink-0 flex justify-center lg:justify-end items-center gap-2 px-4 py-1" style={{ paddingBottom: 'max(6px, env(safe-area-inset-bottom, 0px))' }}>
              <input
                type="range"
                min={10}
                max={300}
                value={zoom === -1 ? 100 : Math.min(300, Math.max(10, zoom))}
                onChange={(e) => setZoom(Number(e.target.value))}
                className="w-24 sm:w-28 lg:w-32 h-1 rounded-full appearance-none bg-white/20 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:cursor-pointer [&::-moz-range-thumb]:w-2.5 [&::-moz-range-thumb]:h-2.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer"
              />
              <span className="text-[10px] font-mono text-white/60 tabular-nums w-8">
                {zoom === -1 ? 'Fit' : `${Math.round(zoom)}%`}
              </span>
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

      {/* Export Progress Overlay */}
      <Modal
        isOpen={exportState.isActive}
        onClose={() => setExportState(prev => ({ ...prev, isActive: false }))}
        showCloseButton={exportState.status === 'completed' || exportState.status === 'error'}
        maxWidth="max-w-md"
      >
        <div className="relative">
          {/* Animated Background Pulse */}
          <div className="absolute -inset-6 bg-purple-600/5 animate-pulse pointer-events-none" />

          <div className="relative z-10 flex flex-col items-center w-full">
            {exportState.status !== 'error' && exportState.status !== 'completed' && (
              <div className="mb-6 relative">
                <div className="absolute inset-0 bg-purple-500/20 blur-2xl rounded-full" />
                <Loader2 className="h-10 w-10 text-purple-400 animate-spin relative z-10" />
              </div>
            )}

            {exportState.status === 'completed' && (
              <div className="h-10 w-10 bg-green-500/20 rounded-full flex items-center justify-center mb-6 border border-green-500/30">
                <svg className="h-5 w-5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              </div>
            )}

            {exportState.status === 'error' && (
              <div className="h-10 w-10 bg-red-500/20 rounded-full flex items-center justify-center mb-6 border border-red-500/30">
                <svg className="h-5 w-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
            )}

            <h3 className="text-lg font-bold mb-2 tracking-tight text-white">
              {exportState.status === 'initializing' && 'Preparing Export...'}
              {exportState.status === 'rendering' && 'Rendering Frames...'}
              {exportState.status === 'encoding' && 'Finalizing Video...'}
              {exportState.status === 'completed' && 'Export Successful!'}
              {exportState.status === 'error' && 'Export Failed'}
            </h3>

            <div className="text-white/40 text-[13px] mb-8 text-center max-w-[320px] leading-relaxed">
              <p>
                {exportState.status === 'rendering' && 'Capturing high-resolution frames for each animation step.'}
                {exportState.status === 'encoding' && 'Processing with FFmpeg to generate your video file.'}
                {exportState.status === 'completed' && 'Your download has started automatically.'}
                {exportState.status === 'error' && (exportState.error || 'An unexpected error occurred during encoding.')}
              </p>
              {(exportState.status === 'rendering' || exportState.status === 'encoding' || exportState.status === 'initializing') && (
                <div className="mt-4 px-4 py-2 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                  <p className="text-yellow-500/80 font-semibold text-[11px] uppercase tracking-wider mb-1">Important</p>
                  <p className="text-white/60 text-[12px]">
                    4K and 2K exports with video elements take a long time.
                    <span className="block font-bold text-white/80 mt-1">Please do not close this page.</span>
                  </p>
                </div>
              )}
            </div>

            {exportState.status !== 'error' && exportState.status !== 'completed' && (
              <div className="w-full">
                <div className="flex justify-between items-end mb-2">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-[#7c4af0]">Progress</span>
                  <span className="text-base font-mono font-medium text-white/90">{exportState.progress}%</span>
                </div>
                <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden border border-white/5 shadow-inner">
                  <div
                    className="h-full bg-gradient-to-r from-[#7c4af0] to-indigo-500 shadow-[0_0_15px_rgba(124,74,240,0.4)] transition-all duration-300 ease-out"
                    style={{ width: `${exportState.progress}%` }}
                  />
                </div>
              </div>
            )}

            {exportState.status !== 'error' && exportState.status !== 'completed' && (
              <button
                onClick={handleCancelExport}
                className="mt-8 w-full py-2.5 bg-white/5 hover:bg-white/10 text-white/40 hover:text-white/90 rounded-xl text-[12px] font-medium transition-all border border-white/5"
              >
                Cancel Export
              </button>
            )}

            {exportState.status === 'completed' && (
              <button
                onClick={() => setExportState(prev => ({ ...prev, isActive: false }))}
                className="w-full py-2.5 bg-white/5 hover:bg-white/10 text-white/90 rounded-xl text-[12px] font-medium transition-all border border-white/5"
              >
                Close Window
              </button>
            )}

            {exportState.status === 'error' && (
              <div className="w-full flex flex-col gap-3 mt-2">
                <button
                  onClick={() => handleExport('1080p')}
                  className="w-full py-2.5 bg-[#7c4af0] hover:bg-[#8d61f2] text-white rounded-xl text-[12px] font-bold transition-all shadow-lg shadow-purple-500/20"
                >
                  Try Again
                </button>
                <button
                  onClick={() => setExportState(prev => ({ ...prev, isActive: false }))}
                  className="w-full py-2.5 bg-white/5 hover:bg-white/10 text-white/90 rounded-xl text-[12px] font-medium transition-all border border-white/5"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      </Modal>
      {/* Project Status Loading Modal */}
      <Modal
        isOpen={isSaving}
        showCloseButton={false}
        maxWidth="max-w-[280px]"
        className="border-white/5 shadow-[0_0_50px_-12px_rgba(0,0,0,0.5)]"
      >
        <div className="flex flex-col items-center justify-center py-4 gap-4">
          <div className="relative">
            <div className="absolute inset-0 bg-blue-500/20 blur-xl rounded-full scale-150 animate-pulse" />
            <Loader2 className="w-10 h-10 text-blue-400 animate-spin relative z-10" strokeWidth={1.5} />
          </div>
          <div className="flex flex-col items-center gap-1 text-center">
            <h3 className="text-white font-medium text-[15px] tracking-tight">Saving Project</h3>
            <p className="text-white/40 text-[12px]">Please wait a moment...</p>
          </div>
        </div>
      </Modal>
    </div>
  )
}

export default function EditorPageWrapper(props) {
  return (
    <ErrorBoundary>
      <EditorPage {...props} />
    </ErrorBoundary>
  )
}
