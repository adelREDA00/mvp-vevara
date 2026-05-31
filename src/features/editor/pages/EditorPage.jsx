import React, { useState, useEffect, useRef, useCallback, useMemo, useContext } from 'react'
import { ThemeContext } from '../../../app/context/ThemeContext'
import { useDispatch, useSelector } from 'react-redux'
import { Link, useParams, useLocation } from 'react-router-dom'
import { ADS_TEMPLATE, SAAS_TEMPLATE } from '../utils/practiceTemplates'
import { Layers, FileText } from 'lucide-react'
import Stage from '../components/Stage'
import { addScene, selectScenes, selectCurrentSceneId, selectCurrentScene, updateScene, deleteScene, splitScene, deleteLayer, selectLayers, updateLayer, copyLayers, pasteLayers, copyScene, pasteScene, selectLastPastedLayerIds, addSceneMotionStep, deleteSceneMotionStep, selectSceneMotionFlow, initializeSceneMotionFlow, selectProjectTimelineInfo, addSceneMotionAction, updateSceneMotionAction, deleteSceneMotionAction, selectSceneMotionFlows, reorderLayer, fetchProjectById, saveProject, selectProjectName, setProjectName, selectProjectId, resetProject, selectAspectRatio, setAspectRatio, setCurrentScene, updateSceneMotionFlow, initializeProject, selectLoadingMode, setLoadingMode, startMotionEditing, stopMotionEditing, flipCardFrame, selectIsDirty, selectProjectVersion, selectIsSaving as selectIsSavingRedux, selectEditingStepActionCount } from '../../../store/slices/projectSlice'
import { LAYER_TYPES } from '../../../store/models'
import { gsap } from 'gsap'
import { selectSelectedLayerIds, selectSelectedCanvas, clearLayerSelection, setSelectedLayer } from '../../../store/slices/selectionSlice'
import { undo, redo } from '../../../store/slices/historySlice'
import { saveAs } from 'file-saver'
import { exportVideo, initFFmpeg } from '../utils/videoExport'
import { Loader2, ChevronDown, User } from 'lucide-react'
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
import ProfilePanel from '../components/ProfilePanel'
import TextPanel from '../components/TextPanel'
import UploadsPanel from '../components/UploadsPanel'
import ImagesPanel from '../components/ImagesPanel'
// import ToolsPanel from '../components/ToolsPanel'
import FramesPanel from '../components/FramesPanel'
import ProjectsPanel from '../components/ProjectsPanel'
import AppsPanel from '../components/AppsPanel'
import ColorPickerPanel from '../components/ColorPickerPanel'
import AdvancedColorPickerModal from '../components/AdvancedColorPickerModal'
import PositionPanel from '../components/PositionPanel'
import TransitionsPanel from '../components/TransitionsPanel'
import TutorialOverlay from '../components/TutorialOverlay'
import TutorialExportModal from '../components/TutorialExportModal'
import { useEditorSidebar } from '../hooks/useEditorSidebar'
import { useEditorPlayback } from '../hooks/useEditorPlayback'
import { useEditorLayout } from '../hooks/useEditorLayout'
import { useWorldDimensions } from '../hooks/useWorldDimensions'
import { applyTransformInline } from '../hooks/useCanvasLayers'
import { resetGlobalMotionEngine } from '../../engine/motion'
import { BLUR_MAX } from '../../engine/motion/blurConstants.js'
import { CORNER_RADIUS_MAX } from '../../engine/motion/cornerRadiusConstants.js'
import { setGuestMode, startTutorial, endTutorial, selectTutorialState, nextStep, setInteractionLock, setAutoPlayState } from '../../../store/slices/tutorialSlice'
import { updateUserTheme, setLocalTheme } from '../../../store/slices/authSlice'
import ErrorBoundary from '../../../components/ErrorBoundary'
import * as PIXI from 'pixi.js'
import { useAssetPreloader } from '../hooks/useAssetPreloader'
import { usePerformanceOptimization } from '../hooks/usePerformanceOptimization'



function EditorPage() {
  const { theme, setTheme } = useContext(ThemeContext)
  const isLight = theme === 'light';

  const dispatch = useDispatch()
  const scenes = useSelector(selectScenes)
  const currentSceneId = useSelector(selectCurrentSceneId)
  const selectedLayerIds = useSelector(selectSelectedLayerIds)
  const selectedCanvas = useSelector(selectSelectedCanvas)
  const layers = useSelector(selectLayers)
  const { isAuthenticated, user } = useSelector((state) => state.auth)
  const { active: tutorialActive, step: tutorialStep, hasRunSession, autoPlayState, isInteractionLocked } = useSelector(selectTutorialState)
  const lastPastedLayerIds = useSelector(selectLastPastedLayerIds)
  const { projectId: urlProjectId } = useParams()
  const location = useLocation()
  const projectName = useSelector(selectProjectName)
  const isStarterCopy = projectName && (projectName.endsWith(' (Copy)') || projectName.toLowerCase().includes('starter'))
  const isAutoPlaying = (autoPlayState === 'initial' || autoPlayState === 'final' || autoPlayState === 'pending_final' || (tutorialActive && tutorialStep === 3 && isInteractionLocked)) && !isStarterCopy;
  const projectId = useSelector(selectProjectId)

  // Get motion flow for current scene
  const currentSceneMotionFlow = useSelector((state) =>
    currentSceneId ? selectSceneMotionFlow(state, currentSceneId) : null
  )

  const projectStatus = useSelector(state => state.project.status)
  const isDirty = useSelector(selectIsDirty)
  const projectVersion = useSelector(selectProjectVersion)
  const isSavingRedux = useSelector(selectIsSavingRedux)
  const [isSaving, setIsSaving] = useState(false)
  const [isNavigating, setIsNavigating] = useState(false)
  const editingStepActionCount = useSelector(selectEditingStepActionCount)
  const aspectRatio = useSelector(selectAspectRatio)
  const loadingMode = useSelector(selectLoadingMode)
  const [showGrid, setShowGrid] = useState(false)
  const [showSafeArea, setShowSafeArea] = useState(false)
  const [showMotionPaths, setShowMotionPaths] = useState(false)
  const [manualTutorialRect, setManualTutorialRect] = useState(null);
  const [showStarterHint, setShowStarterHint] = useState(false)
  const [starterHintText, setStarterHintText] = useState('')
  const isInitialVertical = aspectRatio === '9:16'
  const [zoom, setZoom] = useState(isInitialVertical ? 18 : 31)
  const [showGuestModal, setShowGuestModal] = useState(false)
  const zoomRef = useRef(isInitialVertical ? 18 : 31) // Ref to track current zoom without causing re-renders
  const prevZoomRef = useRef(isInitialVertical ? 18 : 31) // Track previous zoom to detect changes

  // Keep zoomRef in sync with zoom state
  useEffect(() => {
    zoomRef.current = zoom
    // Initialize prevZoomRef on first render
    if ((prevZoomRef.current === 31 || prevZoomRef.current === 18) && zoom !== prevZoomRef.current) {
      prevZoomRef.current = zoom
    }
  }, [zoom])
  const [editingTextLayerId, setEditingTextLayerId] = useState(null)
  const [activeTool, setActiveTool] = useState('select')
  const [lastSaved, setLastSaved] = useState(Date.now())
  const [colorPickerType, setColorPickerType] = useState('fill') // 'fill' or 'text' or 'stroke'
  const [sidebarWidth, setSidebarWidth] = useState('80px')
  const [showPasteboard, setShowPasteboard] = useState(isAuthenticated)

  // Set default pasteboard visibility based on auth status
  useEffect(() => {
    setShowPasteboard(isAuthenticated)
  }, [isAuthenticated])
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
  const [pixiApp, setPixiApp] = useState(null)
  const [isStageReady, setIsStageReady] = useState(false) // Track PIXI object population
  const [pixiError, setPixiError] = useState(null) // NEW: Track fatal graphics errors

  // [FIX] Minimum display time prevents the loading overlay from "flashing" on fast connections
  const [minTimeElapsed, setMinTimeElapsed] = useState(false)
  const minTimeRef = useRef(null)
  const hasTriggeredInitialAutoPlay = useRef(false)
  useEffect(() => {
    minTimeRef.current = setTimeout(() => setMinTimeElapsed(true), 300)
    return () => { if (minTimeRef.current) clearTimeout(minTimeRef.current) }
  }, [])

  // [FIX] Detect if project has any assets requiring async loading.
  // This prevents the loading modal from dismissing during the gap between 
  // project data arriving (projectStatus='succeeded') and useCanvasLayers
  // processing the new layers (which sets isStageReady=false then back to true).
  const hasAsyncAssets = useMemo(() => {
    if (!layers) return false
    return Object.values(layers).some(l => l && (l.type === 'image' || l.type === 'video'))
  }, [layers])

  const FullScreenLoading = ({ progress, isPreloading, isStageReady, projectStatus, minTimeElapsed, hasAsyncAssets, error }) => {
    // [STRICT] Loading gate must be the bridge to total readiness.
    // However, if there is a fatal Pixi error, we MUST yield visibility to the Stage's error recovery UI.
    const projectDataReady = projectStatus === 'succeeded';
    const binaryAssetsReady = !isPreloading;
    const pixiObjectsReady = isStageReady;

    const isLoading = !projectDataReady || !binaryAssetsReady || !pixiObjectsReady || !minTimeElapsed;

    // [NEW] If we are in local loading mode, OR IF THERE IS A FATAL ERROR, we never show the full-screen preloader
    // Allowing the error UI to be visible.
    if (!isLoading || loadingMode === 'local' || error) return null;

    const percent = progress?.percent || 0;
    const loadedCount = progress?.loaded || 0;
    const totalCount = progress?.total || 0;

    return (
      <div className={`absolute inset-0 z-50 flex flex-col items-center justify-center p-8 text-center transition-opacity duration-500 ${isLight ? 'bg-[#f4f5f8]' : 'bg-[#090a10]'}`}>
        <style dangerouslySetInnerHTML={{__html: `
          @keyframes appleFloatCircle {
            0%, 100% { transform: translateY(0px) rotate(0deg); }
            50% { transform: translateY(-8px) rotate(10deg); }
          }
          @keyframes appleFloatSquare {
            0%, 100% { transform: translateY(0px) rotate(45deg); }
            50% { transform: translateY(-5px) rotate(60deg); }
          }
          @keyframes appleFloatTriangle {
            0%, 100% { transform: translateY(0px) rotate(0deg); }
            50% { transform: translateY(-11px) rotate(-15deg); }
          }
          .animate-shape-circle {
            animation: appleFloatCircle 4s ease-in-out infinite;
          }
          .animate-shape-square {
            animation: appleFloatSquare 4.5s ease-in-out infinite;
          }
          .animate-shape-triangle {
            animation: appleFloatTriangle 3.8s ease-in-out infinite;
          }
        `}} />
        
        {/* Apple style minimal shape indicator */}
        <div className="flex items-center justify-center gap-6 mb-12 relative h-12">
          {/* Square */}
          <div className={`w-3.5 h-3.5 rounded-[3px] rotate-[45deg] animate-shape-square transition-colors duration-500 ${
            isLight ? 'bg-black/20 shadow-[0_4px_12px_rgba(0,0,0,0.04)]' : 'bg-white/20 shadow-[0_4px_12px_rgba(255,255,255,0.02)]'
          }`} />

          {/* Circle */}
          <div className={`w-3.5 h-3.5 rounded-full animate-shape-circle transition-colors duration-500 ${
            isLight ? 'bg-black/35 shadow-[0_4px_12px_rgba(0,0,0,0.05)]' : 'bg-white/35 shadow-[0_4px_12px_rgba(255,255,255,0.03)]'
          }`} />

          {/* Triangle */}
          <svg 
            viewBox="0 0 24 24" 
            className={`w-4 h-4 fill-current animate-shape-triangle transition-colors duration-500 ${
              isLight ? 'text-black/15' : 'text-white/15'
            }`}
          >
            <path d="M12 3L2 21H22L12 3Z" />
          </svg>
        </div>

        <div className="space-y-4 max-w-[280px] w-full">
          <div className="space-y-1">
            <h2 className={`text-[15px] font-medium tracking-tight ${isLight ? 'text-gray-900/90' : 'text-white/90'}`}>
              Preparing workspace
            </h2>
            <p className={`text-[12px] ${isLight ? 'text-gray-400' : 'text-white/30'}`}>
              Organizing your motion assets
            </p>
          </div>

          {/* Premium Thin Progress Bar */}
          <div className="pt-2 space-y-2">
            <div className={`h-[2px] w-full rounded-full overflow-hidden ${isLight ? 'bg-black/5' : 'bg-white/5'}`}>
              <div
                className="h-full bg-[#7c4af0] transition-all duration-300 ease-out shadow-[0_0_8px_rgba(124,74,240,0.4)]"
                style={{ width: `${percent}%` }}
              />
            </div>
            <div className={`flex justify-between items-center text-[10px] font-medium tracking-wider ${isLight ? 'text-black/30' : 'text-white/20'}`}>
              <span>Progress</span>
              <span className="font-mono">{loadedCount} / {totalCount}</span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const { isPreloading, progress } = useAssetPreloader(layers, isPixiReady)

  // [NEW] Transition to local loading mode once initially ready
  useEffect(() => {
    if (loadingMode === 'global' && projectStatus === 'succeeded' && isStageReady && !isPreloading && minTimeElapsed) {
      // Small delay to ensure smooth transition
      const timer = setTimeout(() => {
        dispatch(setLoadingMode('local'))
      }, 500)
      return () => clearTimeout(timer)
    }
  }, [loadingMode, projectStatus, isStageReady, isPreloading, minTimeElapsed, dispatch])




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
  const [gifExportModalOpen, setGifExportModalOpen] = useState(false)

  // PERFORMANCE: Optimize rendering and animations based on tab visibility
  usePerformanceOptimization(pixiApp, motionControls, exportState.isActive)

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

      // Also sync theme on save to ensure persistence
      if (isAuthenticated) {
        dispatch(setLocalTheme(theme))
        dispatch(updateUserTheme(theme))
      }

      lastSavedStateRef.current = stateString
      setLastSaved(Date.now())
    } catch (error) {
      console.error('Failed to save project:', error)
    } finally {
      if (!silent) setIsSaving(false)
    }
  }, [dispatch, isAuthenticated, theme, projectName, scenes, layers, sceneMotionFlows, aspectRatio, worldWidth, worldHeight])

  // handleNavigate ensures we save the project before leaving the editor
  // when the user clicks the dashboard/user icon.
  const handleNavigate = useCallback(async (path) => {
    setIsNavigating(true)
    if (isAuthenticated) {
      // Ensure theme is synced before leaving
      dispatch(setLocalTheme(theme))
      dispatch(updateUserTheme(theme))
      await handleSave({ silent: true })
    }
    // [FIX] Force full page reload to release WebGL context
    window.location.href = path
  }, [isAuthenticated, theme, dispatch, handleSave])

  const saveToIndexedDB = (key, value) => {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('VevaraExportDB', 1)
      request.onupgradeneeded = (e) => {
        const db = e.target.result
        if (!db.objectStoreNames.contains('exports')) {
          db.createObjectStore('exports')
        }
      }
      request.onsuccess = (e) => {
        const db = e.target.result
        const tx = db.transaction('exports', 'readwrite')
        const store = tx.objectStore('exports')
        const putRequest = store.put(value, key)
        putRequest.onsuccess = () => resolve(true)
        putRequest.onerror = () => reject(putRequest.error)
      }
      request.onerror = () => reject(request.error)
    })
  }

  const handleCancelExport = useCallback(() => {
    if (exportAbortControllerRef.current) {
      exportAbortControllerRef.current.abort()
      exportAbortControllerRef.current = null
    }
    setExportState({ isActive: false, status: 'rendering', progress: 0, error: null })
  }, [])

  const handleExport = useCallback(async (options) => {
    console.log('[EditorPage] handleExport invoked with options:', options)
    // 1. Pause editor playback
    if (motionControls?.isPlaying) {
      console.log('[EditorPage] Pausing active editor playback')
      try { motionControls.pauseAll() } catch (e) { /* ignore */ }
    }

    // 2. Determine options
    const opts = typeof options === 'string'
      ? { format: 'mp4', resolution: options }
      : (options || { format: 'mp4', resolution: '720p' })
    const format = opts.format === 'gif' ? 'gif' : 'mp4'
    const resolution = opts.resolution || '720p'
    const gifOptions = opts.gifOptions || { width: 480, fps: 15, loop: 0 }

    // 3. Pre-open blank tab synchronously (user gesture) -> 100% bypasses Safari/iOS popup blockers
    console.log('[EditorPage] Pre-opening blank window')
    const exportWindow = window.open('about:blank', '_blank')

    // 4. Create snapshot of the state
    const exportId = `export_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
    console.log('[EditorPage] Created unique exportId:', exportId)
    const projectState = {
      projectName,
      scenes,
      layers,
      sceneMotionFlows,
      aspectRatio: aspectRatio || '16:9'
    }
    console.log('[EditorPage] Constructed projectState snapshot:', {
      projectName: projectState.projectName,
      scenesCount: projectState.scenes?.length,
      layersCount: Object.keys(projectState.layers || {}).length,
      aspectRatio: projectState.aspectRatio
    })

    // 5. Asynchronously save snapshot to IndexedDB (virtually unlimited quota!)
    try {
      console.log('[EditorPage] Saving snapshot to IndexedDB under key:', exportId)
      await saveToIndexedDB(exportId, projectState)
      console.log('[EditorPage] IndexedDB write completed successfully')
    } catch (e) {
      console.warn('[EditorPage] Failed to save snapshot to IndexedDB, falling back to localStorage:', e)
      try {
        localStorage.setItem(exportId, JSON.stringify(projectState))
        console.log('[EditorPage] LocalStorage write completed successfully as fallback')
      } catch (storageErr) {
        console.error('[EditorPage] LocalStorage fallback also failed (QuotaExceeded):', storageErr)
      }
    }

    // 6. Build the query params
    const gifWidth = gifOptions.width || 480
    const gifFps = gifOptions.fps || 15
    const gifLoop = gifOptions.loop !== undefined ? gifOptions.loop : 0

    let exportUrl = `/export?id=${exportId}&format=${format}&resolution=${resolution}`
    if (projectId) {
      exportUrl += `&projectId=${projectId}`
    }
    if (format === 'gif') {
      exportUrl += `&gifWidth=${gifWidth}&gifFps=${gifFps}&gifLoop=${gifLoop}`
    }

    // 7. Update URL of the pre-opened tab (instant branded pre-loader rendered!)
    if (exportWindow) {
      exportWindow.location.href = exportUrl
    } else {
      window.open(exportUrl, '_blank')
    }

    // 8. Non-blocking parallel auto-save in the background
    if (isAuthenticated) {
      handleSave({ silent: true }).catch((saveErr) => {
        console.warn('[handleExport] Parallel background auto-save failed:', saveErr)
      })
    }
  }, [scenes, layers, sceneMotionFlows, projectName, motionControls, aspectRatio, projectId, isAuthenticated, handleSave])

  // [PERF] Warm up the FFmpeg WASM core while the editor is idle so the first
  // user-triggered export doesn't have to wait for a 2-3s download. Skipped on
  // low-memory devices — we don't want to spend 20MB of idle RAM on a phone
  // that may never export.
  useEffect(() => {
    if (typeof navigator === 'undefined') return
    if ((navigator.deviceMemory || 4) < 4) return
    const idleCb = window.requestIdleCallback || ((fn) => setTimeout(fn, 800))
    const cancelIdleCb = window.cancelIdleCallback || clearTimeout
    const idleHandle = idleCb(() => {
      initFFmpeg().catch(() => { /* warm-up failures are non-fatal */ })
    })
    return () => {
      try { cancelIdleCb(idleHandle) } catch (e) { /* ignore */ }
    }
  }, [])

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
  // AUTO-SAVE LOGIC
  // =============================================================================
  useEffect(() => {
    // Only auto-save if authenticated, project is dirty, and not currently saving
    if (!isAuthenticated || !isDirty || isSaving || isSavingRedux || isExportActiveRef.current) return

    // Debounce save for 5 seconds of inactivity
    // This gives the user time to finish a "thought" of interactions
    const timer = setTimeout(() => {
      handleSave({ silent: true })
    }, 5000)

    return () => clearTimeout(timer)
  }, [isDirty, projectVersion, isAuthenticated, isSaving, isSavingRedux, handleSave])





  // =============================================================================
  // SIDEBAR AND PLAYBACK CONTROLS
  // =============================================================================
  const {
    activeSidebarItem,
    setActiveSidebarItem,
    handleSidebarItemClick,
    handleClosePanel,
  } = useEditorSidebar()

  const [activeTransitionSceneId, setActiveTransitionSceneId] = useState(null)
  const handleOpenTransitionsPanel = useCallback((sceneId) => {
    setActiveTransitionSceneId(sceneId)
    setActiveSidebarItem('Transitions')
  }, [setActiveSidebarItem])

  const [activeBottomMenu, setActiveBottomMenu] = useState(null)

  // Touch drag-to-dismiss logic for mobile bottom sheet
  const mobileSheetRef = useRef(null)
  const dragStartYRef = useRef(null)
  const isDraggingRef = useRef(false)

  const handleSheetTouchStart = useCallback((e) => {
    if (!mobileSheetRef.current) return
    const touchY = e.touches[0].clientY
    dragStartYRef.current = touchY
    isDraggingRef.current = true
    mobileSheetRef.current.style.transition = 'none'
  }, [])

  const handleSheetTouchMove = useCallback((e) => {
    if (!isDraggingRef.current || dragStartYRef.current === null || !mobileSheetRef.current) return
    const touchY = e.touches[0].clientY
    const deltaY = touchY - dragStartYRef.current

    // Only allow dragging downwards (deltaY > 0)
    if (deltaY > 0) {
      mobileSheetRef.current.style.transform = `translateY(${deltaY}px)`
    }
  }, [])

  const handleSheetTouchEnd = useCallback((e) => {
    if (!isDraggingRef.current || dragStartYRef.current === null || !mobileSheetRef.current) return
    isDraggingRef.current = false

    const touchY = e.changedTouches[0].clientY
    const deltaY = touchY - dragStartYRef.current
    dragStartYRef.current = null

    const backdrop = document.querySelector('.mobile-sheet-backdrop')

    if (deltaY > 120) {
      // Dismiss sheet
      mobileSheetRef.current.style.transition = 'transform 0.2s cubic-bezier(0.16, 1, 0.3, 1)'
      mobileSheetRef.current.style.transform = 'translateY(100%)'
      if (backdrop) {
        backdrop.style.transition = 'opacity 0.2s ease'
        backdrop.style.opacity = '0'
      }

      setTimeout(() => {
        setActiveSidebarItem(null)
        if (mobileSheetRef.current) {
          mobileSheetRef.current.style.transform = ''
          mobileSheetRef.current.style.transition = ''
        }
        if (backdrop) {
          backdrop.style.opacity = ''
          backdrop.style.backgroundColor = ''
          backdrop.style.transition = ''
        }
      }, 200)
    } else {
      // Snap back
      mobileSheetRef.current.style.transition = 'transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.15)'
      mobileSheetRef.current.style.transform = 'translateY(0)'

      setTimeout(() => {
        if (mobileSheetRef.current) {
          mobileSheetRef.current.style.transition = ''
        }
      }, 300)
    }
  }, [setActiveSidebarItem])

  const [isMotionPanelOpen, setIsMotionPanelOpen] = useState(false)
  const [requestOpenControl, setRequestOpenControl] = useState(null)

  // Automatically switch colorPickerType to 'canvas' when canvas is selected
  // and ensure it switches back to a valid layer mode when a layer is selected.
  useEffect(() => {
    if (selectedCanvas && activeSidebarItem === 'Color') {
      setColorPickerType('canvas')
    } else if (selectedLayerIds.length > 0 && colorPickerType === 'canvas' && activeSidebarItem === 'Color') {
      // Revert to 'fill' default when moving from canvas back to layers
      setColorPickerType('fill')
    }
  }, [selectedCanvas, selectedLayerIds, activeSidebarItem, colorPickerType])

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

  // =============================================================================
  // TUTORIAL LOGIC & AUTO-PLAY
  // =============================================================================
  const lastStepEndTime = useMemo(() => {
    if (!currentSceneMotionFlow?.steps || currentSceneMotionFlow.steps.length === 0) return 0;
    let maxTimeMs = 0;
    for (let i = 0; i < currentSceneMotionFlow.steps.length; i++) {
      const s = currentSceneMotionFlow.steps[i];
      const end = (s.startTime || 0) + (s.duration || 0);
      if (end > maxTimeMs) {
        maxTimeMs = end;
      }
    }
    return maxTimeMs / 1000;
  }, [currentSceneMotionFlow]);

  // Auto-pause at the end of the last step during autoplay (on load and after adding a step)
  useEffect(() => {
    if (isPlaying && (autoPlayState === 'initial' || autoPlayState === 'final') && !isStarterCopy && motionControls && lastStepEndTime > 0) {
      if (playheadTime >= lastStepEndTime) {
        motionControls.pauseAll();
        setIsPlaying(false);
        seek(lastStepEndTime);
      }
    }
  }, [isPlaying, autoPlayState, playheadTime, lastStepEndTime, motionControls, seek, setIsPlaying, isStarterCopy]);

  useEffect(() => {
    dispatch(setGuestMode(!isAuthenticated));
  }, [isAuthenticated, dispatch]);

  useEffect(() => {
    if (!isAuthenticated && projectStatus === 'succeeded' && isStageReady && !isPreloading && minTimeElapsed && motionControls) {
      const isPracticeTemplate = projectName === "onb marketing" || projectName === "Mistral AI Studio";
      if (isPracticeTemplate && !hasRunSession && autoPlayState === 'none' && !hasTriggeredInitialAutoPlay.current) {
        hasTriggeredInitialAutoPlay.current = true;
        dispatch(setAutoPlayState('initial'));
        dispatch(setInteractionLock(true));
        seek(0);
        motionControls.playAll();
        setIsPlaying(true);
      }
    }
  }, [isAuthenticated, projectStatus, isStageReady, isPreloading, minTimeElapsed, projectName, dispatch, hasRunSession, autoPlayState, seek, setIsPlaying, motionControls]);

  // Starter project copy initial autoplay on load (with 500ms delay to let the user see the first glance)
  useEffect(() => {
    if (projectStatus === 'succeeded' && isStageReady && !isPreloading && minTimeElapsed && motionControls) {
      if (isStarterCopy) {
        const targetProjId = urlProjectId || projectId;
        if (!targetProjId) return;

        const isAutoplayDone = localStorage.getItem(`vevara_starter_autoplay_done_${targetProjId}`) === 'true';

        // If they have already done autoplay, do not trigger autoplay
        if (isAutoplayDone) {
          return;
        }

        if (!hasTriggeredInitialAutoPlay.current) {
          hasTriggeredInitialAutoPlay.current = true;
          dispatch(setAutoPlayState('initial'));
          dispatch(setInteractionLock(true));
          // Seek exactly to 0
          seek(0);

          // Delay autoplay by 500ms so user has time to digest the initial frame
          const timer = setTimeout(() => {
            motionControls.playAll();
            setIsPlaying(true);
          }, 500);
          return () => clearTimeout(timer);
        }
      }
    }
  }, [projectStatus, isStageReady, isPreloading, minTimeElapsed, isStarterCopy, projectId, urlProjectId, motionControls, seek, setIsPlaying, dispatch]);

  // Auto-pause at the start of Scene 2 (end of first scene duration) and trigger starter tooltip
  useEffect(() => {
    if (isStarterCopy && isPlaying && motionControls) {
      const targetProjId = urlProjectId || projectId;
      if (!targetProjId) return;

      const isAutoplayDone = localStorage.getItem(`vevara_starter_autoplay_done_${targetProjId}`) === 'true';
      const firstSceneDuration = scenes?.[0]?.duration || 2.0;

      if (!isAutoplayDone && playheadTime >= firstSceneDuration) {
        // Pause playback
        motionControls.pauseAll();
        setIsPlaying(false);
        // Seek exactly to the end of scene 1 / start of scene 2
        seek(firstSceneDuration);
        // Set autoplay as done for this project ID so it won't trigger again
        localStorage.setItem(`vevara_starter_autoplay_done_${targetProjId}`, 'true');
        // Clear autoplay state and interaction lock
        dispatch(setAutoPlayState('none'));
        dispatch(setInteractionLock(false));
        // Trigger the custom tooltip
        setShowStarterHint(true);
        setStarterHintText("Animate this scene");
      }
    }
  }, [isStarterCopy, isPlaying, playheadTime, motionControls, projectId, urlProjectId, seek, setIsPlaying, dispatch, scenes]);

  // Handle playback completion for auto-play phases
  const prevIsPlaying = useRef(isPlaying);
  useEffect(() => {
    if (prevIsPlaying.current && !isPlaying) {
      if (autoPlayState === 'initial' && !isStarterCopy) {
        dispatch(setAutoPlayState('none'));
        dispatch(setInteractionLock(false));
        dispatch(startTutorial());
      } else if (autoPlayState === 'final') {
        dispatch(setAutoPlayState('none'));
        dispatch(setInteractionLock(false));
      }
    }
    prevIsPlaying.current = isPlaying;
  }, [isPlaying, autoPlayState, dispatch, isStarterCopy]);

  // Handle trigger for final auto-play when entering pending_final state
  useEffect(() => {
    if (autoPlayState === 'pending_final' && !isPlaying && motionControls) {
      dispatch(setAutoPlayState('final'));
      dispatch(setInteractionLock(true));
      seek(0);
      motionControls.playAll();
      setIsPlaying(true);
    }
  }, [autoPlayState, isPlaying, seek, setIsPlaying, dispatch, motionControls]);

  // Handle manual target rect calculation for Step 2
  useEffect(() => {
    if (tutorialActive && tutorialStep === 2) {
      const updateRect = () => {
        const isSaaS = projectName === "Mistral AI Studio";
        const layerId = isSaaS ? "1777822842468-c23ve3rsq" : "1777802757479-4gfgdrm5c";
        const transforms = motionControls?.getLayerCurrentTransforms();
        const t = transforms?.get(layerId);

        const canvasEl = document.querySelector('[data-tutorial="canvas-area"]');
        const pixiCanvas = canvasEl?.querySelector('canvas');
        const canvasRect = pixiCanvas?.getBoundingClientRect() || canvasEl?.getBoundingClientRect();

        const vp = motionControls?.getViewportData();

        if (t?.visualRect && canvasRect && vp) {
          const screenX = canvasRect.left + (t.visualRect.x - vp.left) * vp.scale;
          const screenY = canvasRect.top + (t.visualRect.y - vp.top) * vp.scale;
          const screenW = t.visualRect.width * vp.scale;
          const screenH = t.visualRect.height * vp.scale;

          setManualTutorialRect({
            x: screenX,
            y: screenY,
            width: screenW,
            height: screenH
          });
        }
      };
      updateRect();
      const interval = setInterval(updateRect, 32);
      return () => clearInterval(interval);
    } else {
      setManualTutorialRect(null);
    }
  }, [tutorialActive, tutorialStep, motionControls, projectName]);


  // Load project if ID is provided in URL
  useEffect(() => {
    if (urlProjectId && urlProjectId !== projectId) {
      dispatch(fetchProjectById(urlProjectId))
    }
  }, [urlProjectId, dispatch, projectId])

  useEffect(() => {
    if (projectStatus === 'loading') return

    const path = location.pathname;
    const isPracticePath = path === '/ads' || path === '/sass';

    // 1. Path-based template loading for guests
    if (!isAuthenticated && isPracticePath && !urlProjectId) {
      let template = null;
      if (path === '/ads') template = ADS_TEMPLATE;
      else if (path === '/sass') template = SAAS_TEMPLATE;

      if (template && projectName !== template.name) {
        dispatch(initializeProject({ ...template.data, name: template.name }));
        hasInitializedScene.current = true;
        return;
      }
    }

    // 2. Standard initialization for mount or empty state
    if (!hasInitializedScene.current && scenes.length === 0 && !urlProjectId) {
      hasInitializedScene.current = true;

      // Default empty scene for guests (on /) and auth users
      dispatch(addScene({
        name: 'Scene 1',
        duration: 10.0,
        transition: 'None',
      }))
    }
  }, [dispatch, scenes.length, projectStatus, urlProjectId, isAuthenticated, location.pathname, projectName])

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

  // Scene layers for MotionPanel (excluding background/camera)
  const sceneLayersForMotion = useMemo(() => {
    if (!currentSceneData?.layers) return []
    return currentSceneData.layers
      .map(id => layers[id])
      .filter(l => l && l.type !== LAYER_TYPES.CAMERA)
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
  const captureUndoSyncRef = useRef(false) // Signals that trackedLayers needs syncing from Redux after undo/redo
  const captureActionIdsRef = useRef(new Map()) // Tracks dispatched action IDs during capture: "layerId:type" -> actionId
  const [captureVersion, setCaptureVersion] = useState(0) // Internal state to force re-renders on Ref updates


  // Get timeline info for seeking

  const currentSceneTimelineInfo = useMemo(() => {
    if (!timelineInfo || !currentSceneId) return null
    return timelineInfo.find(s => s.id === currentSceneId)
  }, [timelineInfo, currentSceneId])
  const startTimeOffset = currentSceneTimelineInfo?.startTime || 0

  // Check if motion capture is active
  const isMotionCaptureActive = !!motionCaptureMode?.isActive

  const currentSidebarWidth = typeof window !== 'undefined' && window.innerWidth < 1024 ? '0px' : sidebarWidth

  // Handle Step 1 -> 2 transition (Clicking Animate)

  useEffect(() => {
    if (tutorialActive && tutorialStep === 1 && isMotionCaptureActive) {
      dispatch(nextStep());
    }
  }, [isMotionCaptureActive, tutorialActive, tutorialStep, dispatch]);

  // Handle Step 2 - Auto-selection and Interaction Gate
  useEffect(() => {
    if (tutorialActive && tutorialStep === 2) {
      const isSaaS = projectName === "Mistral AI Studio";
      const targetLayerId = isSaaS ? "1777822842468-c23ve3rsq" : "1777802757479-4gfgdrm5c";

      // Auto-select the target layer immediately
      if (layers[targetLayerId] && !selectedLayerIds.includes(targetLayerId)) {
        dispatch(setSelectedLayer(targetLayerId));
      }

      // Transition to Step 3 ONLY on real interaction (Move/Scale/Rotate)
      // This is tracked via editingStepActionCount > 0 OR live movement threshold
      if (editingStepActionCount > 0) {
        dispatch(nextStep());
      } else if (motionCaptureMode?.isActive) {
        // [OPTIMIZATION] Immediate transition: Detect meaningful movement while dragging
        // This removes the "sticky" feel of the overlay during the first interaction.
        const tracked = motionCaptureMode.trackedLayers?.get(targetLayerId);
        if (tracked) {
          const initial = tracked.initialTransform;
          const dx = Math.abs(tracked.deltaX || 0);
          const dy = Math.abs(tracked.deltaY || 0);
          const ds = Math.abs((tracked.scaleX || initial.scaleX) - initial.scaleX);
          const dr = Math.abs((tracked.rotation || initial.rotation) - initial.rotation);

          // Threshold for "intentional" interaction: 5px movement, 5% scale, or 5deg rotation
          if (dx > 5 || dy > 5 || ds > 0.05 || dr > 5) {
            dispatch(nextStep());
          }
        }
      }
    }
  }, [tutorialActive, tutorialStep, selectedLayerIds, editingStepActionCount, projectName, layers, dispatch, motionCaptureMode, captureVersion]);



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

  // Virtual layer for UI controls during motion capture
  // This combines the base Redux layer with live capture transforms to prevent slider snapping
  // while keeping the Redux 'base' state pure for the MotionEngine's starting point.
  const capturedLayer = useMemo(() => {
    if (!isMotionCaptureActive || !selectedLayerIds[0]) return null
    const layerId = selectedLayerIds[0]
    const capture = motionCaptureRef.current
    if (!capture) return null
    const tracked = capture.trackedLayers?.get(layerId)
    if (!tracked) return null
    const base = layers[layerId]
    if (!base) return null

    return {
      ...base,
      x: tracked.currentPosition?.x ?? base.x,
      y: tracked.currentPosition?.y ?? base.y,
      scaleX: tracked.scaleX !== undefined ? tracked.scaleX : base.scaleX,
      scaleY: tracked.scaleY !== undefined ? tracked.scaleY : base.scaleY,
      rotation: tracked.rotation !== undefined ? tracked.rotation : base.rotation,
      opacity: tracked.opacity !== undefined ? tracked.opacity : base.opacity,
      cropX: tracked.cropX ?? base.cropX,
      cropY: tracked.cropY ?? base.cropY,
      cropWidth: tracked.cropWidth ?? base.cropWidth,
      cropHeight: tracked.cropHeight ?? base.cropHeight,
      blur: tracked.blur !== undefined ? Math.max(0, Math.min(BLUR_MAX, tracked.blur)) : (base.blur ?? 0),
      tiltX: tracked.tiltX !== undefined ? tracked.tiltX : (base.tiltX ?? 0),
      tiltY: tracked.tiltY !== undefined ? tracked.tiltY : (base.tiltY ?? 0),
      data: {
        ...(base.data || {}),
        cornerRadius: tracked.cornerRadius !== undefined ? Math.max(0, Math.min(CORNER_RADIUS_MAX, tracked.cornerRadius)) : (base.data?.cornerRadius ?? 0)
      }
    }
    console.log('[DEBUG] capturedLayer update:', {
      layerId,
      trackedRadius: tracked.cornerRadius,
      baseRadius: base.data?.cornerRadius,
      finalRadius: result.data.cornerRadius
    })
    return result
  }, [isMotionCaptureActive, selectedLayerIds, layers, currentSceneMotionFlow, motionCaptureMode, captureVersion])

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
              applyTransformInline(pixiObject, baseLayerData, null, layerId, null, true, null, null, startTimeOffset)
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

    // Close any open sidebar panels when entering motion capture mode
    handleClosePanel()

    // [BUG 1 FIX] Clear any layer selection BEFORE starting the tween.
    // Without this, the auto-pause effect in Stage.jsx sees selectedLayerIds.length > 0
    // and isPlaying=true (from tweenTo) but motionCaptureMode.isActive is still false
    // (set in onComplete), so it calls pausePlayback() killing the tween.
    dispatch(clearLayerSelection())
    setShowStarterHint(false)
    if (isStarterCopy) {
      localStorage.setItem(`vevara_starter_autoplay_done_${urlProjectId || projectId}`, 'true')
    }

    // [NEW] Auto-open motion panel on desktop and mobile when adding a step
    if (isAuthenticated) {
      setIsMotionPanelOpen(true)
    }

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

    // 4. Calculate relative playheadTimeMs relative to the scene start using up-to-date Ref
    const currentPlayTime = playheadTimeRef.current || 0
    const timeInSceneMs = Math.round((currentPlayTime - (currentSceneTimelineInfo?.startTime || 0)) * 1000)

    // 5. Dispatch action to add the step
    dispatch(addSceneMotionStep({
      sceneId: currentSceneId,
      stepId: newStepId,
      playheadTimeMs: Math.max(0, timeInSceneMs)
    }))

    // [SYNC FIX] Inform Redux that we are starting to edit this specific step
    // This allows projectSlice to prevent auto-deleting this step if it becomes empty during interaction.
    dispatch(startMotionEditing({
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
      let currentOpacity = layer.opacity !== undefined ? layer.opacity : 1
      let currentBlur = layer.blur !== undefined ? layer.blur : 0
      let currentCornerRadius = layer.data?.cornerRadius || 0
      let currentColor = layer.type === 'shape' ? (layer.data?.fill || null)
        : layer.type === 'text' ? (layer.data?.color || null)
          : layer.type === 'background' ? ('#' + (layer.data?.color ?? 0xffffff).toString(16).padStart(6, '0'))
            : null
      // Track cumulative flip state from previous steps (Redux showingFront is the base/time-0 state)
      let currentShowingFront = layer.data?.showingFront !== false
      let currentCropX = layer.cropX || 0
      let currentCropY = layer.cropY || 0
      let currentCropWidth = layer.cropWidth || layer.width || 100
      let currentCropHeight = layer.cropHeight || layer.height || 100
      const layerObject = motionControls?.layerObjects?.get?.(layerId)
      let currentMediaWidth = layer.mediaWidth || layerObject?._mediaWidth || layerObject?._originalWidth || layer.width || 100
      let currentMediaHeight = layer.mediaHeight || layerObject?._mediaHeight || layerObject?._originalHeight || layer.height || 100
      // [TILT] Track cumulative tilt from previous steps (absolute per step, like blur)
      let currentTiltX = layer.tiltX !== undefined ? layer.tiltX : 0
      let currentTiltY = layer.tiltY !== undefined ? layer.tiltY : 0

      for (let i = 0; i < stepIndex; i++) {
        const prevStep = existingFlow[i]
        const actions = prevStep.layerActions?.[layerId] || []

        const moveAction = actions.find(a => a.type === 'move')
        const scaleAction = actions.find(a => a.type === 'scale')
        const rotateAction = actions.find(a => a.type === 'rotate')
        const cropAction = actions.find(a => a.type === 'crop')
        const fadeAction = actions.find(a => a.type === 'fade')

        if (moveAction) {
          // Add relative delta values
          currentX += moveAction.values?.dx || 0
          currentY += moveAction.values?.dy || 0
        }

        // [FIX] CUMULATIVE CROP SHIFT: Always check for bundled displacement in crop actions
        // regardless of whether a move action exists. This ensures initialTransform is 100% accurate.
        if (cropAction) {
          currentX += cropAction.values?.dx || 0
          currentY += cropAction.values?.dy || 0
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

        if (fadeAction) {
          // Opacity is typically absolute per step
          currentOpacity = fadeAction.values?.opacity !== undefined ? fadeAction.values.opacity : currentOpacity
        }

        const blurAction = prevStep.layerActions?.[layerId]?.find(a => a.type === 'blur')
        if (blurAction) {
          // Blur is relative or absolute? Usually absolute per step in this engine for simplicity
          currentBlur = blurAction.values?.blur !== undefined ? Math.max(0, Math.min(BLUR_MAX, blurAction.values.blur)) : currentBlur
        }

        const radiusAction = prevStep.layerActions?.[layerId]?.find(a => a.type === 'cornerRadius')
        if (radiusAction) {
          currentCornerRadius = radiusAction.values?.cornerRadius !== undefined ? Math.max(0, Math.min(CORNER_RADIUS_MAX, radiusAction.values.cornerRadius)) : currentCornerRadius
        }

        const colorAction = actions.find(a => a.type === 'colorChange')
        if (colorAction && colorAction.values?.color) {
          currentColor = colorAction.values.color
        }

        // Flip: toggle showingFront for each flip action in previous steps
        const flipAction = actions.find(a => a.type === 'flip')
        if (flipAction) {
          currentShowingFront = !currentShowingFront
        }

        // Tilt: absolute per step like blur/opacity
        const tiltAction = actions.find(a => a.type === 'tilt')
        if (tiltAction) {
          if (tiltAction.values?.tiltX !== undefined) currentTiltX = tiltAction.values.tiltX
          if (tiltAction.values?.tiltY !== undefined) currentTiltY = tiltAction.values.tiltY
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
        mediaHeight: currentMediaHeight,
        opacity: currentOpacity,
        blur: currentBlur,
        cornerRadius: currentCornerRadius,
        color: currentColor,
        // [TILT] Accumulated per-step tilt values
        tiltX: currentTiltX,
        tiltY: currentTiltY,
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
        opacity: currentOpacity,
        blur: currentBlur,
        cornerRadius: currentCornerRadius,
        color: currentColor,
        // Accumulated flip state from previous steps (accounts for all prior flip actions)
        showingFront: currentShowingFront,
        // [TILT] Accumulated tilt from previous steps
        tiltX: currentTiltX,
        tiltY: currentTiltY,
        interactionType: null,
        didMove: false,
        didBlur: false,
        didCornerRadius: false,
        didScale: false,
        didRotate: false,
        didFade: false,
        didCrop: false,
        didColor: false,
        didFlip: false,
        didTilt: false,
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
      // Clear _isFlipping on all layer objects — the tweenTo may have left it true
      // if the FlipAction's onComplete didn't fire reliably during scrubbing
      if (motionControls?.layerObjects) {
        motionControls.layerObjects.forEach((obj) => {
          if (obj && !obj.destroyed && obj._isFlipping) obj._isFlipping = false
        })
      }

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



            // Update the entry with actual visual coordinates
            entry.initialTransform.x = transform.x
            entry.initialTransform.y = transform.y
            entry.initialTransform.rotation = transform.rotation
            entry.initialTransform.scaleX = transform.scaleX
            entry.initialTransform.scaleY = transform.scaleY
            entry.initialTransform.opacity = transform.alpha !== undefined ? transform.alpha : entry.initialTransform.opacity

            entry.currentPosition.x = transform.x
            entry.currentPosition.y = transform.y
            entry.rotation = transform.rotation
            entry.scaleX = transform.scaleX
            entry.scaleY = transform.scaleY
            entry.opacity = transform.alpha !== undefined ? transform.alpha : entry.opacity
            entry.blur = transform.blur !== undefined ? transform.blur : (transform._blurFilter ? transform._blurFilter.strength : entry.blur)

            // [TILT] Preserve the live tilt angles produced by the fast-play
            // preview so that the freshly opened capture step starts from the
            // exact visual tilt — otherwise the layer would jump back to the
            // initial tilt the moment the user touches anything.
            if (transform.tiltX !== undefined) {
              entry.tiltX = transform.tiltX
              entry.initialTransform.tiltX = transform.tiltX
            }
            if (transform.tiltY !== undefined) {
              entry.tiltY = transform.tiltY
              entry.initialTransform.tiltY = transform.tiltY
            }

            // Sync color from PIXI object (post fast-preview)
            if (transform.color !== undefined && transform.color !== null) {
              entry.color = transform.color
              entry.initialTransform.color = transform.color
            }

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
      captureActionIdsRef.current.clear()

      // [CRITICAL FIX] Ensure we track existing actions so onInteractionEnd UPDATES them instead of duplicating!
      if (currentSceneMotionFlow?.steps) {
        const step = currentSceneMotionFlow.steps.find((s) => s.id === newStepId)
        if (step && step.layerActions) {
          Object.entries(step.layerActions).forEach(([layerIdStr, actions]) => {
            actions.forEach((action) => {
              captureActionIdsRef.current.set(`${layerIdStr}:${action.type}`, action.id)
            })
          })
        }
      }
      setMotionCaptureMode({
        isActive: true,
        isTransitioning: false,
        stepId: newStepId, // CRITICAL: Ensure stepId is set for global interactions!
        // Called when a drag/resize/rotate interaction ENDS during capture.
        // Dispatches motion actions to Redux so each interaction creates a history entry for undo.
        onInteractionEnd: (layerId) => {
          const capture = motionCaptureRef.current
          if (!capture) return
          const tracked = capture.trackedLayers?.get(layerId)
          if (!tracked) return
          const stepId = capture.stepId
          const sceneId = currentSceneId
          if (!stepId || !sceneId) return

          const init = tracked.initialTransform

          // Move
          const hasMoved = (tracked.didMove) || (tracked.controlPoints?.length > 0)
          if (hasMoved) {
            const key = `${layerId}:move`
            const existingId = captureActionIdsRef.current.get(key)
            if (existingId) {
              // Pass controlPoints as-is (undefined lets reducer preserve existing curve data)
              dispatch(updateSceneMotionAction({
                sceneId, stepId, layerId, actionId: existingId,
                values: { dx: tracked.deltaX, dy: tracked.deltaY, controlPoints: tracked.controlPoints }
              }))
            } else {
              const actionId = `action-${Date.now()}-move-${layerId}`
              dispatch(addSceneMotionAction({
                sceneId, stepId, layerId, actionId,
                type: 'move', values: { dx: tracked.deltaX, dy: tracked.deltaY, controlPoints: tracked.controlPoints || [], easing: 'power4.out' }
              }))
              captureActionIdsRef.current.set(key, actionId)
            }
          }

          // Scale
          const initialScaleX = init.scaleX || 1
          const initialScaleY = init.scaleY || 1
          const scaleChanged = tracked.scaleX !== undefined && tracked.scaleY !== undefined &&
            (Math.abs(tracked.scaleX - initialScaleX) > 0.001 || Math.abs(tracked.scaleY - initialScaleY) > 0.001)
          if (scaleChanged) {
            const key = `${layerId}:scale`
            const existingId = captureActionIdsRef.current.get(key)
            if (existingId) {
              dispatch(updateSceneMotionAction({
                sceneId, stepId, layerId, actionId: existingId,
                values: { dsx: tracked.scaleX / initialScaleX, dsy: tracked.scaleY / initialScaleY }
              }))
            } else {
              const actionId = `action-${Date.now()}-scale-${layerId}`
              dispatch(addSceneMotionAction({
                sceneId, stepId, layerId, actionId,
                type: 'scale', values: { dsx: tracked.scaleX / initialScaleX, dsy: tracked.scaleY / initialScaleY, easing: 'power4.out' }
              }))
              captureActionIdsRef.current.set(key, actionId)
            }
          } else {
            // Scale returned to initial — remove the action if it exists
            const key = `${layerId}:scale`
            const existingId = captureActionIdsRef.current.get(key)
            if (existingId) {
              dispatch(deleteSceneMotionAction({ sceneId, stepId, layerId, actionId: existingId }))
              captureActionIdsRef.current.delete(key)
            }
          }

          // Rotate
          const initialRotation = init.rotation || 0
          const rotateChanged = tracked.rotation !== undefined && Math.abs(tracked.rotation - initialRotation) > 0.1
          if (rotateChanged) {
            const key = `${layerId}:rotate`
            const existingId = captureActionIdsRef.current.get(key)
            if (existingId) {
              dispatch(updateSceneMotionAction({
                sceneId, stepId, layerId, actionId: existingId,
                values: { dangle: tracked.rotation - initialRotation }
              }))
            } else {
              const actionId = `action-${Date.now()}-rotate-${layerId}`
              dispatch(addSceneMotionAction({
                sceneId, stepId, layerId, actionId,
                type: 'rotate', values: { dangle: tracked.rotation - initialRotation, easing: 'power4.out' }
              }))
              captureActionIdsRef.current.set(key, actionId)
            }
          } else {
            // Rotation returned to initial — remove the action if it exists
            const key = `${layerId}:rotate`
            const existingId = captureActionIdsRef.current.get(key)
            if (existingId) {
              dispatch(deleteSceneMotionAction({ sceneId, stepId, layerId, actionId: existingId }))
              captureActionIdsRef.current.delete(key)
            }
          }

          // [SYNC FIX] Crop: Dispatch crop changes immediately on mouse-up
          // This keeps Move (center) and Crop (bounds) in sync in Redux, preventing jumps.
          const initialCropX = init.cropX || 0
          const initialCropY = init.cropY || 0
          const initialCropW = init.cropWidth || 100
          const initialCropH = init.cropHeight || 100

          const hasCropChanged = (
            (tracked.cropX !== undefined && Math.abs(tracked.cropX - initialCropX) > 0.1) ||
            (tracked.cropY !== undefined && Math.abs(tracked.cropY - initialCropY) > 0.1) ||
            (tracked.cropWidth !== undefined && Math.abs(tracked.cropWidth - initialCropW) > 0.1) ||
            (tracked.cropHeight !== undefined && Math.abs(tracked.cropHeight - initialCropH) > 0.1)
          )

          if (hasCropChanged) {
            const key = `${layerId}:crop`
            const existingId = captureActionIdsRef.current.get(key)
            const cropValues = {
              cropX: tracked.cropX ?? initialCropX,
              cropY: tracked.cropY ?? initialCropY,
              cropWidth: tracked.cropWidth ?? initialCropW,
              cropHeight: tracked.cropHeight ?? initialCropH,
              mediaWidth: tracked.mediaWidth ?? init.mediaWidth,
              mediaHeight: tracked.mediaHeight ?? init.mediaHeight,
              easing: 'power4.out'
            }

            // Important: dx/dy are handled by the Move action if it exists.
            // If No move action, the crop action itself carries the displacement.
            if (!tracked.didMove && !tracked.controlPoints?.length) {
              cropValues.dx = tracked.deltaX
              cropValues.dy = tracked.deltaY
            }

            if (existingId) {
              dispatch(updateSceneMotionAction({ sceneId, stepId, layerId, actionId: existingId, values: cropValues }))
            } else {
              const actionId = `action-${Date.now()}-crop-${layerId}`
              dispatch(addSceneMotionAction({ sceneId, stepId, layerId, actionId, type: 'crop', values: cropValues }))
              captureActionIdsRef.current.set(key, actionId)
            }
          } else {
            // [REVEAL BUG FIX] If crop returned to base, clean up the action
            const key = `${layerId}:crop`
            const existingId = captureActionIdsRef.current.get(key)
            if (existingId) {
              dispatch(deleteSceneMotionAction({ sceneId, stepId, layerId, actionId: existingId }))
              captureActionIdsRef.current.delete(key)
            }
          }

          // Fade (Opacity)
          const initialOpacity = init.opacity !== undefined ? init.opacity : 1
          const opacityChanged = tracked.opacity !== undefined && Math.abs(tracked.opacity - initialOpacity) > 0.001

          if (opacityChanged) {
            const key = `${layerId}:fade`
            const existingId = captureActionIdsRef.current.get(key)
            if (existingId) {
              dispatch(updateSceneMotionAction({
                sceneId, stepId, layerId, actionId: existingId,
                values: { opacity: tracked.opacity }
              }))
            } else {
              const actionId = `action-${Date.now()}-fade-${layerId}`
              dispatch(addSceneMotionAction({
                sceneId, stepId, layerId, actionId,
                type: 'fade', values: { opacity: tracked.opacity, easing: 'power4.out' }
              }))
              captureActionIdsRef.current.set(key, actionId)
            }
          } else {
            const key = `${layerId}:fade`
            const existingId = captureActionIdsRef.current.get(key)
            if (existingId) {
              dispatch(deleteSceneMotionAction({ sceneId, stepId, layerId, actionId: existingId }))
              captureActionIdsRef.current.delete(key)
            }
          }

          // Blur
          const initialBlur = init.blur !== undefined ? init.blur : 0
          const blurChanged = tracked.blur !== undefined && Math.abs(tracked.blur - initialBlur) > 0.1
          const shouldCreateBlurAction = blurChanged || tracked.didBlur

          if (shouldCreateBlurAction) {
            const key = `${layerId}:blur`
            const existingId = captureActionIdsRef.current.get(key)
            if (existingId) {
              dispatch(updateSceneMotionAction({
                sceneId, stepId, layerId, actionId: existingId,
                values: { blur: tracked.blur }
              }))
            } else {
              const actionId = `action-${Date.now()}-blur-${layerId}`
              dispatch(addSceneMotionAction({
                sceneId, stepId, layerId, actionId,
                type: 'blur', values: { blur: tracked.blur, easing: 'power4.out' }
              }))
              captureActionIdsRef.current.set(key, actionId)
            }
          } else {
            const key = `${layerId}:blur`
            const existingId = captureActionIdsRef.current.get(key)
            if (existingId) {
              dispatch(deleteSceneMotionAction({ sceneId, stepId, layerId, actionId: existingId }))
              captureActionIdsRef.current.delete(key)
            }
          }

          // Corner Radius
          const initialRadius = init.cornerRadius !== undefined ? init.cornerRadius : 0
          const radiusChanged = tracked.cornerRadius !== undefined && Math.abs(tracked.cornerRadius - initialRadius) > 0.1
          const shouldCreateRadiusAction = radiusChanged || tracked.didCornerRadius

          if (shouldCreateRadiusAction) {
            const key = `${layerId}:cornerRadius`
            const existingId = captureActionIdsRef.current.get(key)
            if (existingId) {
              dispatch(updateSceneMotionAction({
                sceneId, stepId, layerId, actionId: existingId,
                values: { cornerRadius: tracked.cornerRadius }
              }))
            } else {
              const actionId = `action-${Date.now()}-radius-${layerId}`
              dispatch(addSceneMotionAction({
                sceneId, stepId, layerId, actionId,
                type: 'cornerRadius', values: { cornerRadius: tracked.cornerRadius, easing: 'power4.out' }
              }))
              captureActionIdsRef.current.set(key, actionId)
            }
          } else {
            const key = `${layerId}:cornerRadius`
            const existingId = captureActionIdsRef.current.get(key)
            if (existingId) {
              dispatch(deleteSceneMotionAction({ sceneId, stepId, layerId, actionId: existingId }))
              captureActionIdsRef.current.delete(key)
            }
          }

          // Tilt
          const initialTiltX = init.tiltX !== undefined ? init.tiltX : 0
          const initialTiltY = init.tiltY !== undefined ? init.tiltY : 0
          const tiltXChanged = tracked.tiltX !== undefined && Math.abs(tracked.tiltX - initialTiltX) > 0.01
          const tiltYChanged = tracked.tiltY !== undefined && Math.abs(tracked.tiltY - initialTiltY) > 0.01
          const shouldCreateTiltAction = tiltXChanged || tiltYChanged

          if (shouldCreateTiltAction) {
            const key = `${layerId}:tilt`
            const existingId = captureActionIdsRef.current.get(key)
            const tiltValues = {
              tiltX: tracked.tiltX ?? initialTiltX,
              tiltY: tracked.tiltY ?? initialTiltY,
              easing: 'power4.out'
            }
            console.log(`[TILT DEBUG] onInteractionEnd update for layer ${layerId}:`, tiltValues, existingId ? 'UPDATING' : 'ADDING')
            if (existingId) {
              dispatch(updateSceneMotionAction({
                sceneId, stepId, layerId, actionId: existingId,
                values: tiltValues
              }))
              captureActionIdsRef.current.set(key, existingId)
            } else {
              const actionId = `action-${Date.now()}-tilt-${layerId}`
              dispatch(addSceneMotionAction({
                sceneId, stepId, layerId, actionId,
                type: 'tilt', values: tiltValues
              }))
              captureActionIdsRef.current.set(key, actionId)
            }
          } else {
            const key = `${layerId}:tilt`
            const existingId = captureActionIdsRef.current.get(key)
            if (existingId) {
              dispatch(deleteSceneMotionAction({ sceneId, stepId, layerId, actionId: existingId }))
              captureActionIdsRef.current.delete(key)
            }
          }

          // Color Change
          const colorChanged = tracked.color !== undefined && tracked.color !== init.color
          const shouldCreateColorAction = colorChanged || tracked.didColor
          if (shouldCreateColorAction) {
            const key = `${layerId}:colorChange`
            const existingId = captureActionIdsRef.current.get(key)
            if (existingId) {
              dispatch(updateSceneMotionAction({
                sceneId, stepId, layerId, actionId: existingId,
                values: { color: tracked.color }
              }))
            } else {
              const actionId = `action-${Date.now()}-color-${layerId}`
              dispatch(addSceneMotionAction({
                sceneId, stepId, layerId, actionId,
                type: 'colorChange', values: { color: tracked.color, easing: 'power1.out' }
              }))
              captureActionIdsRef.current.set(key, actionId)
            }
          } else {
            const key = `${layerId}:colorChange`
            const existingId = captureActionIdsRef.current.get(key)
            if (existingId) {
              dispatch(deleteSceneMotionAction({ sceneId, stepId, layerId, actionId: existingId }))
              captureActionIdsRef.current.delete(key)
            }
          }

          // Flip (card frames)
          if (tracked.didFlip) {
            const key = `${layerId}:flip`
            const existingId = captureActionIdsRef.current.get(key)
            if (!existingId) {
              const actionId = `action-${Date.now()}-flip-${layerId}`
              dispatch(addSceneMotionAction({
                sceneId, stepId, layerId, actionId,
                type: 'flip', values: { duration: 600 }
              }))
              captureActionIdsRef.current.set(key, actionId)
            }
          } else {
            // didFlip toggled back to false (user double-flipped) — remove the flip action
            const key = `${layerId}:flip`
            const existingId = captureActionIdsRef.current.get(key)
            if (existingId) {
              dispatch(deleteSceneMotionAction({ sceneId, stepId, layerId, actionId: existingId }))
              captureActionIdsRef.current.delete(key)
            }
          }
        },
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

          if (scaleX !== undefined) {
            nextEntry.scaleX = scaleX
            nextEntry.didScale = true
          }
          if (scaleY !== undefined) {
            nextEntry.scaleY = scaleY
            nextEntry.didScale = true
          }
          if (rotation !== undefined) {
            nextEntry.rotation = rotation
            nextEntry.didRotate = true
          }
          if (data.opacity !== undefined) {
            nextEntry.opacity = data.opacity
            nextEntry.didFade = true
          }
          if (data.blur !== undefined) {
            nextEntry.blur = data.blur
            nextEntry.didBlur = true
          }
          if (data.cornerRadius !== undefined) {
            nextEntry.cornerRadius = data.cornerRadius
            nextEntry.didCornerRadius = true
          }
          if (data.color !== undefined) {
            nextEntry.color = data.color
            nextEntry.didColor = true
          }
          if (data.didFlip) {
            nextEntry.didFlip = true
          }
          if (data.tiltX !== undefined) {
            nextEntry.tiltX = data.tiltX
            nextEntry.didTilt = true
          }
          if (data.tiltY !== undefined) {
            nextEntry.tiltY = data.tiltY
            nextEntry.didTilt = true
          }
          if (data.cropX !== undefined) {
            nextEntry.cropX = data.cropX
            nextEntry.didCrop = true
          }
          if (data.cropY !== undefined) {
            nextEntry.cropY = data.cropY
            nextEntry.didCrop = true
          }
          if (data.cropWidth !== undefined) {
            nextEntry.cropWidth = data.cropWidth
            nextEntry.didCrop = true
          }
          if (data.cropHeight !== undefined) {
            nextEntry.cropHeight = data.cropHeight
            nextEntry.didCrop = true
          }

          if (data.mediaWidth !== undefined) nextEntry.mediaWidth = data.mediaWidth
          if (data.mediaHeight !== undefined) nextEntry.mediaHeight = data.mediaHeight

          // [CONTROL POINTS FIX] Only update control points if explicitly provided (not undefined/null)
          // This preserves existing control points when updating position/scale/rotate without curve edits
          // Control points are arrays, so we check for array type to distinguish from undefined
          if (data.controlPoints !== undefined && Array.isArray(data.controlPoints)) {
            nextEntry.controlPoints = data.controlPoints
            nextEntry.didMove = true // Curve edit IS a move action
          } else if (data.controlPoints === null) {
            // Explicitly clear control points if null is passed
            nextEntry.controlPoints = []
            nextEntry.didMove = true
          }
          // If controlPoints is undefined, preserve existing value (don't overwrite)

          trackedLayers.set(layerId, nextEntry)
          setCaptureVersion(v => v + 1)
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
      // Incorporate playhead-aware creation logic: if playhead is after all steps, target is the playhead position.
      const lastExisting = existingFlow[existingFlow.length - 1]
      const lastStepEndMs = lastExisting
        ? (lastExisting.startTime || 0) + (lastExisting.duration || Math.round(pageDuration / existingFlow.length))
        : 0

      const currentPlayTime = playheadTimeRef.current || 0
      const timeInSceneMs = Math.max(0, Math.round((currentPlayTime - (currentSceneTimelineInfo?.startTime || 0)) * 1000))

      let newStartTimeMs = timeInSceneMs < lastStepEndMs ? lastStepEndMs : timeInSceneMs
      if (newStartTimeMs >= pageDuration) {
        newStartTimeMs = Math.max(0, pageDuration - 200)
      }

      let stepStartTimeSeconds = startTimeOffset + newStartTimeMs / 1000

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
      // No previous steps, seek to the newly created step's start time (which matches the playhead position)
      const pageDuration = currentSceneMotionFlow?.pageDuration || 5000
      const currentPlayTime = playheadTimeRef.current || 0
      const timeInSceneMs = Math.max(0, Math.round((currentPlayTime - (currentSceneTimelineInfo?.startTime || 0)) * 1000))

      let newStartTimeMs = timeInSceneMs
      if (newStartTimeMs >= pageDuration) {
        newStartTimeMs = Math.max(0, pageDuration - 200)
      }

      let stepStartTimeSeconds = startTimeOffset + newStartTimeMs / 1000
      motionControls.seek(stepStartTimeSeconds)
      enableCaptureMode()
    } else {
      enableCaptureMode()
    }
  }, [currentSceneId, currentSceneMotionFlow, layers, dispatch, motionControls, startTimeOffset, currentSceneTimelineInfo])

  /**
   * Apply captured motion and exit capture mode
   */
  const handleApplyMotion = useCallback((options = {}) => {
    // [TUTORIAL LOCK] Immediately block UI when saving the final step to prevent state corruption
    // during fast-preview and autoplay restart.
    if (tutorialActive && tutorialStep === 3) {
      dispatch(setInteractionLock(true))
    }
    // [FIX] Efficiently check if ONLY meaningful interactions or existing actions exist
    const hasAnyInteraction = motionCaptureMode.trackedLayers
      ? Array.from(motionCaptureMode.trackedLayers.values()).some(
        l => l.didMove || l.didBlur || l.didCornerRadius || l.didScale || l.didRotate || l.didFade || l.didCrop || l.didColor || l.didFlip || l.didTilt
      )
      : false

    const stepId = editingStepId
    const currentFlow = currentSceneMotionFlow || { steps: [] }
    const currentStep = currentFlow.steps?.find(s => s.id === stepId)
    const hasAnyActionsInRedux = currentStep && currentStep.layerActions && Object.keys(currentStep.layerActions).length > 0

    const isMeaningfulSession = hasAnyInteraction || hasAnyActionsInRedux

    if (!isMeaningfulSession) {
      // Nothing was changed and no previous actions exist — restore original flow or delete new step
      if (stepId && currentSceneId && isNewStepRef.current && savedStepTimingsRef.current) {
        dispatch(updateSceneMotionFlow({
          sceneId: currentSceneId,
          steps: savedStepTimingsRef.current
        }))
        savedStepTimingsRef.current = null
      } else if (stepId && currentSceneId) {
        dispatch(deleteSceneMotionStep({
          sceneId: currentSceneId,
          stepId: stepId
        }))
      }
      setMotionCaptureMode(null)
      setEditingStepId(null)
      motionCaptureRef.current = null
      dispatch(stopMotionEditing())
      return
    }

    if (!stepId || !currentSceneId) {
      setMotionCaptureMode(null)
      setEditingStepId(null)
      motionCaptureRef.current = null
      return
    }

    // Flush any pending debounced history state from onInteractionEnd before applying.
    // This ensures the last interaction's snapshot is committed to history.
    dispatch({ type: 'history/flushPending' })

    // Redux updates are synchronous, but React re-renders are async, so currentSceneMotionFlow
    // might be from a previous render. We'll build the preview optimistically anyway.
    const step = currentFlow.steps?.find(s => s.id === stepId)

    // Move/scale/rotate actions are already dispatched to Redux by onInteractionEnd during capture.
    // Only dispatch crop actions here (not handled by onInteractionEnd).

    // =======================================================================
    // FAST-PLAY PREVIEW: Trigger animated transition for visual feedback
    // =======================================================================
    if (motionControls && !options?.skipPreview) {
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
          // Determine if layer type supports cropping
          const isCropSupported = !['text', 'shape', 'background'].includes(layerData.type)

          const hasCropChanged = isCropSupported && (
            (cropX !== undefined && Math.abs(cropX - initialCropX) > 0.1) ||
            (cropY !== undefined && Math.abs(cropY - initialCropY) > 0.1) ||
            (cropWidth !== undefined && Math.abs(cropWidth - initialCropW) > 0.1) ||
            (cropHeight !== undefined && Math.abs(cropHeight - initialCropH) > 0.1)
          )

          // [CONSOLIDATED MOVE ACTION] Single unified logic for move action building
          // Control points take priority - if they exist, we MUST include move action
          const hasControlPoints = preservedControlPoints.length > 0
          const hasSignificantMovement = Math.abs(deltaX || 0) > 0.1 || Math.abs(deltaY || 0) > 0.1
          const moveActionAlreadyExists = !!originalMoveAction
          const shouldIncludeMoveAction = (didMove || hasControlPoints || moveActionAlreadyExists || !hasCropChanged) && (hasSignificantMovement || hasControlPoints || moveActionAlreadyExists)

          if (shouldIncludeMoveAction) {
            const moveIdx = actions.findIndex(a => a.type === 'move')
            const existingValues = existingMoveAction?.values || {}

            // [FIX] ONLY update dx/dy from the live canvas if the user actually moved or cropped the object.
            // If they just tweaked a blur/color slider, the canvas position might be mid-tween or jumping from a preview,
            // so we MUST strictly preserve the existing perfectly-calculated dx/dy!
            const isPositionalEdit = didMove || hasCropChanged || hasControlPoints
            const finalDx = isPositionalEdit ? deltaX : (existingValues.dx ?? deltaX)
            const finalDy = isPositionalEdit ? deltaY : (existingValues.dy ?? deltaY)

            const moveAction = {
              type: 'move',
              values: {
                ...existingValues,
                dx: finalDx,
                dy: finalDy,
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

          // Fade (Opacity) action
          const opacity = layerData.opacity
          const initialOpacity = initialTransform?.opacity !== undefined ? initialTransform.opacity : 1
          if (opacity !== undefined && Math.abs(opacity - initialOpacity) > 0.001) {
            const fadeIdx = actions.findIndex(a => a.type === 'fade')
            const action = {
              type: 'fade',
              values: {
                opacity: opacity,
                duration: effectiveDuration,
                easing: 'power4.out'
              }
            }
            if (fadeIdx !== -1) actions[fadeIdx] = action; else actions.push(action)
          }

          // Blur action
          const blur = layerData.blur
          const initialBlur = initialTransform?.blur !== undefined ? initialTransform.blur : 0
          if (blur !== undefined && Math.abs(blur - initialBlur) > 0.1) {
            const blurIdx = actions.findIndex(a => a.type === 'blur')
            const action = {
              type: 'blur',
              values: {
                blur: blur,
                duration: effectiveDuration,
                easing: 'power4.out'
              }
            }
            if (blurIdx !== -1) actions[blurIdx] = action; else actions.push(action)
          }

          // Corner Radius action
          const cornerRadius = layerData.cornerRadius
          const initialCornerRadius = initialTransform?.cornerRadius !== undefined ? initialTransform.cornerRadius : 0
          if (cornerRadius !== undefined && Math.abs(cornerRadius - initialCornerRadius) > 0.1) {
            const radiusIdx = actions.findIndex(a => a.type === 'cornerRadius')
            const action = {
              type: 'cornerRadius',
              values: {
                cornerRadius: cornerRadius,
                duration: effectiveDuration,
                easing: 'power4.out'
              }
            }
            if (radiusIdx !== -1) actions[radiusIdx] = action; else actions.push(action)
          }

          // Tilt action
          const tiltX = layerData.tiltX
          const tiltY = layerData.tiltY
          const initialTiltX = initialTransform?.tiltX !== undefined ? initialTransform.tiltX : 0
          const initialTiltY = initialTransform?.tiltY !== undefined ? initialTransform.tiltY : 0
          const tiltXDiff = tiltX !== undefined && Math.abs(tiltX - initialTiltX) > 0.01
          const tiltYDiff = tiltY !== undefined && Math.abs(tiltY - initialTiltY) > 0.01
          if (tiltXDiff || tiltYDiff) {
            const tiltIdx = actions.findIndex(a => a.type === 'tilt')
            const action = {
              type: 'tilt',
              values: {
                tiltX: tiltX ?? initialTiltX,
                tiltY: tiltY ?? initialTiltY,
                duration: effectiveDuration,
                easing: 'power4.out'
              }
            }
            console.log(`[TILT DEBUG] handleApplyMotion target layer ${layerId}:`, action.values)
            if (tiltIdx !== -1) actions[tiltIdx] = action; else actions.push(action)
          } else {
            const tiltIdx = actions.findIndex(a => a.type === 'tilt')
            if (tiltIdx !== -1) {
              console.log(`[TILT DEBUG] handleApplyMotion removing tilt for layer ${layerId}`)
              actions.splice(tiltIdx, 1)
            }
          }

          // [COLOR FIX] Add colorChange action to optimistic flow
          const color = layerData.color
          const initialColor = initialTransform?.color
          if (color !== undefined && color !== initialColor) {
            const colorIdx = actions.findIndex(a => a.type === 'colorChange')
            const action = {
              type: 'colorChange',
              values: {
                color: color,
                duration: effectiveDuration,
                easing: 'power1.out'
              }
            }
            if (colorIdx !== -1) actions[colorIdx] = action; else actions.push(action)
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

          // [FIX] Clear capture mode ONLY AFTER the preview is done.
          // This ensures that the Tutorial Step 6 (which prompts the user to play)
          // only appears once the engine is idle and isPlaying is false.
          // This prevents the "two clicks to play" issue where the first click
          // would accidentally pause the still-running fast preview.
          setMotionCaptureMode(null)
          setEditingStepId(null)
          motionCaptureRef.current = null
          savedStepTimingsRef.current = null // Step applied successfully, discard snapshot

          // [SYNC FIX] Inform Redux that we are done editing
          dispatch(stopMotionEditing())

          // If we are in the final tutorial step (Step 3: Save Step),
          // trigger the pending_final auto-play state and end tutorial.
          // This ensures we wait for the fast preview to complete.
          if (tutorialActive && tutorialStep === 3) {
            dispatch(setAutoPlayState('pending_final'))
            dispatch(endTutorial())
          }
        }
      })
    } else {
      // No motionControls available, just clear capture mode
      setMotionCaptureMode(null)
      setEditingStepId(null)
      motionCaptureRef.current = null
      savedStepTimingsRef.current = null

      // [SYNC FIX] Inform Redux that we are done editing
      dispatch(stopMotionEditing())
    }
  }, [motionCaptureMode, editingStepId, currentSceneId, currentSceneMotionFlow, dispatch, motionControls, startTimeOffset, currentSceneTimelineInfo, tutorialActive, tutorialStep])

  /**
   * Cancel motion capture: delete the auto-created step and exit
   * CRITICAL: Reset all PIXI objects to their base Redux state to prevent crop value leaks
   */
  const handleCancelMotion = useCallback(() => {
    // Flush any pending debounced history state before canceling
    dispatch({ type: 'history/flushPending' })

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
          applyTransformInline(pixiObject, baseLayerData, null, layerId, null, true, null, null, startTimeOffset)
        }
      })
    }

    // Exit capture mode
    setMotionCaptureMode(null)
    setEditingStepId(null)
    motionCaptureRef.current = null
    isNewStepRef.current = false

    // [FIX] Snap timeline marker back to base state when canceling
    if (motionControls) {
      motionControls.seek(startTimeOffset)
    }

    // [SYNC FIX] Inform Redux that we are done editing
    dispatch(stopMotionEditing())
  }, [editingStepId, currentSceneId, dispatch, motionControls, layers, startTimeOffset])

  // =========================================================================
  // Sync trackedLayers from Redux after undo/redo during active capture mode.
  // When undo restores sceneMotionFlows, we reconstruct the capture visual state
  // from the restored step's layerActions so the PIXI ticker stays in sync.
  // =========================================================================
  useEffect(() => {
    if (!captureUndoSyncRef.current || !isMotionCaptureActive || !editingStepId || !currentSceneId) return
    captureUndoSyncRef.current = false

    const step = currentSceneMotionFlow?.steps?.find(s => s.id === editingStepId)

    // If the step no longer exists (undo went past step creation), exit capture
    if (!step) {
      setMotionCaptureMode(null)
      setEditingStepId(null)
      motionCaptureRef.current = null
      isNewStepRef.current = false
      return
    }

    // Reconstruct trackedLayers from the restored Redux state
    const currentTracked = motionCaptureRef.current?.trackedLayers
    if (!currentTracked) return

    const newTrackedLayers = new Map()
    currentTracked.forEach((entry, layerId) => {
      const init = entry.initialTransform
      const actions = step.layerActions?.[layerId] || []

      const moveAction = actions.find(a => a.type === 'move')
      const scaleAction = actions.find(a => a.type === 'scale')
      const rotateAction = actions.find(a => a.type === 'rotate')
      const cropAction = actions.find(a => a.type === 'crop')

      const deltaX = moveAction?.values?.dx || 0
      const deltaY = moveAction?.values?.dy || 0
      const controlPoints = moveAction?.values?.controlPoints || []

      const scaleX = scaleAction
        ? init.scaleX * (scaleAction.values?.dsx ?? 1)
        : init.scaleX
      const scaleY = scaleAction
        ? init.scaleY * (scaleAction.values?.dsy ?? 1)
        : init.scaleY

      const rotation = rotateAction
        ? init.rotation + (rotateAction.values?.dangle ?? 0)
        : init.rotation

      newTrackedLayers.set(layerId, {
        ...entry,
        currentPosition: { x: init.x + deltaX, y: init.y + deltaY },
        deltaX,
        deltaY,
        scaleX,
        scaleY,
        rotation,
        controlPoints,
        cropX: cropAction?.values?.cropX ?? init.cropX ?? 0,
        cropY: cropAction?.values?.cropY ?? init.cropY ?? 0,
        cropWidth: cropAction?.values?.cropWidth ?? init.cropWidth ?? entry.width,
        cropHeight: cropAction?.values?.cropHeight ?? init.cropHeight ?? entry.height,
        mediaWidth: cropAction?.values?.mediaWidth ?? init.mediaWidth ?? entry.mediaWidth,
        mediaHeight: cropAction?.values?.mediaHeight ?? init.mediaHeight ?? entry.mediaHeight,
        didMove: Math.abs(deltaX) > 0.5 || Math.abs(deltaY) > 0.5 || controlPoints.length > 0,
        interactionType: null,
      })
    })

    // Update ref (used by onPositionUpdate callback)
    motionCaptureRef.current = {
      ...motionCaptureRef.current,
      trackedLayers: newTrackedLayers,
    }

    // Rebuild captureActionIdsRef from the restored step so subsequent interactions
    // correctly use update (not add) for actions that still exist after undo
    captureActionIdsRef.current.clear()
    if (step.layerActions) {
      Object.entries(step.layerActions).forEach(([lId, actions]) => {
        actions.forEach(action => {
          captureActionIdsRef.current.set(`${lId}:${action.type}`, action.id)
        })
      })
    }

    // Update React state (propagates to liveMotionCaptureRef → PIXI ticker)
    setMotionCaptureMode(prev => ({
      ...prev,
      trackedLayers: newTrackedLayers,
    }))
  }, [currentSceneMotionFlow, isMotionCaptureActive, editingStepId, currentSceneId])

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

    // Close any open sidebar panels when entering motion capture mode
    if (stepId !== 'base') {
      handleClosePanel()
    }

    // INSTANT FEEDBACK: Glow the block immediately regardless of state
    setEditingStepId(stepId)

    // [SYNC FIX] Inform Redux that we are starting to edit this specific step
    // This allows projectSlice to prevent auto-deleting this step if it becomes empty during interaction.
    dispatch(startMotionEditing({
      sceneId: currentSceneId,
      stepId: stepId
    }))

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
      let currentOpacity = layer.opacity !== undefined ? layer.opacity : 1
      let currentBlur = layer.blur !== undefined ? layer.blur : 0
      let currentColor = layer.type === 'shape' ? (layer.data?.fill || null)
        : layer.type === 'text' ? (layer.data?.color || null)
          : layer.type === 'background' ? ('#' + (layer.data?.color || 0xffffff).toString(16).padStart(6, '0'))
            : null
      // Track cumulative flip state from previous steps
      let currentShowingFront = layer.data?.showingFront !== false
      let currentCropX = layer.cropX || 0
      let currentCropY = layer.cropY || 0
      let currentCropWidth = layer.cropWidth || layer.width || 100
      let currentCropHeight = layer.cropHeight || layer.height || 100
      let currentCornerRadius = layer.data?.cornerRadius || 0
      const layerObject = motionControls?.layerObjects?.get?.(layerId)
      let currentMediaWidth = layer.mediaWidth || layerObject?._mediaWidth || layerObject?._originalWidth || layer.width || 100
      let currentMediaHeight = layer.mediaHeight || layerObject?._mediaHeight || layerObject?._originalHeight || layer.height || 100
      let currentTiltX = layer.tiltX !== undefined ? layer.tiltX : 0
      let currentTiltY = layer.tiltY !== undefined ? layer.tiltY : 0

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
          // [FIX] CUMULATIVE CROP SHIFT: Always check for bundled displacement in crop actions
          // regardless of whether a move action exists. This ensures initialTransform is 100% accurate.
          currentX += cropAction.values?.dx || 0
          currentY += cropAction.values?.dy || 0

          currentCropX = cropAction.values?.cropX ?? currentCropX
          currentCropY = cropAction.values?.cropY ?? currentCropY
          currentCropWidth = cropAction.values?.cropWidth ?? currentCropWidth
          currentCropHeight = cropAction.values?.cropHeight ?? currentCropHeight
          currentMediaWidth = cropAction.values?.mediaWidth ?? currentMediaWidth
          currentMediaHeight = cropAction.values?.mediaHeight ?? currentMediaHeight
        }

        const fadeAction = actions.find(a => a.type === 'fade')
        if (fadeAction) {
          currentOpacity = fadeAction.values?.opacity !== undefined ? fadeAction.values.opacity : currentOpacity
        }

        const blurAction = actions.find(a => a.type === 'blur')
        if (blurAction) {
          currentBlur = blurAction.values?.blur !== undefined ? blurAction.values.blur : currentBlur
        }

        const radiusAction = actions.find(a => a.type === 'cornerRadius')
        if (radiusAction) {
          currentCornerRadius = radiusAction.values?.cornerRadius !== undefined ? radiusAction.values.cornerRadius : currentCornerRadius
        }

        const colorAction = actions.find(a => a.type === 'colorChange')
        if (colorAction && colorAction.values?.color) {
          currentColor = colorAction.values.color
        }

        // Flip: toggle showingFront for each flip action in previous steps
        const flipAction = actions.find(a => a.type === 'flip')
        if (flipAction) {
          currentShowingFront = !currentShowingFront
        }

        // Tilt: absolute per step
        const tiltAction = actions.find(a => a.type === 'tilt')
        if (tiltAction) {
          currentTiltX = tiltAction.values?.tiltX !== undefined ? tiltAction.values.tiltX : currentTiltX
          currentTiltY = tiltAction.values?.tiltY !== undefined ? tiltAction.values.tiltY : currentTiltY
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
        opacity: currentOpacity,
        blur: currentBlur,
        cornerRadius: currentCornerRadius,
        color: currentColor,
        tiltX: currentTiltX,
        tiltY: currentTiltY,
      }

      const currentStepActions = step?.layerActions?.[layerId] || []
      const currentMove = currentStepActions.find(a => a.type === 'move')
      const currentScale = currentStepActions.find(a => a.type === 'scale')
      const currentRotate = currentStepActions.find(a => a.type === 'rotate')
      const currentCrop = currentStepActions.find(a => a.type === 'crop')
      const currentFade = currentStepActions.find(a => a.type === 'fade')
      const currentBlurAction = currentStepActions.find(a => a.type === 'blur')
      const currentColorAction = currentStepActions.find(a => a.type === 'colorChange')

      const currentTargetX = currentMove ? (sessionStartTransform.x + (currentMove.values.dx || 0)) : (sessionStartTransform.x + (currentCrop?.values?.dx || 0))
      const currentTargetY = currentMove ? (sessionStartTransform.y + (currentMove.values.dy || 0)) : (sessionStartTransform.y + (currentCrop?.values?.dy || 0))

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
        opacity: currentFade?.values?.opacity ?? sessionStartTransform.opacity,
        tiltX: currentStepActions.find(a => a.type === 'tilt')?.values?.tiltX ?? sessionStartTransform.tiltX,
        tiltY: currentStepActions.find(a => a.type === 'tilt')?.values?.tiltY ?? sessionStartTransform.tiltY,
        blur: currentBlurAction?.values?.blur ?? sessionStartTransform.blur,
        cornerRadius: currentStepActions.find(a => a.type === 'cornerRadius')?.values?.cornerRadius ?? sessionStartTransform.cornerRadius,
        color: currentColorAction?.values?.color ?? sessionStartTransform.color,
        controlPoints: currentMove?.values?.controlPoints || [],
        // Accumulated flip state: base from previous steps, then apply current step's flip if re-editing
        showingFront: currentStepActions.find(a => a.type === 'flip') ? !currentShowingFront : currentShowingFront,
        didMove: false,
        didColor: !!currentColorAction,
        didCornerRadius: !!currentStepActions.find(a => a.type === 'cornerRadius'),
        // Pre-set didFlip if the step already has a flip action (re-editing)
        didFlip: !!currentStepActions.find(a => a.type === 'flip'),
        didTilt: !!currentStepActions.find(a => a.type === 'tilt'),
        interactionType: null
      })
      console.log(`[TILT DEBUG] handleEditStep initialized layer ${layerId}:`, {
        initialTiltX: sessionStartTransform.tiltX,
        currentTiltX: initialTrackedLayers.get(layerId).tiltX,
        didTilt: initialTrackedLayers.get(layerId).didTilt
      })
    })

    // 2. Prepare capture session
    const enableEditCapture = () => {
      // Clear _isFlipping on all layer objects — tweenTo may have left it true
      if (motionControls?.layerObjects) {
        motionControls.layerObjects.forEach((obj) => {
          if (obj && !obj.destroyed && obj._isFlipping) obj._isFlipping = false
        })
      }

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
            if (transform.alpha !== undefined) entry.opacity = transform.alpha
            if (transform.blur !== undefined) entry.blur = transform.blur
            // [TILT SYNC] Explicitly sync tilt from visual skew property
            if (transform.tiltX !== undefined) entry.tiltX = transform.tiltX
            if (transform.tiltY !== undefined) entry.tiltY = transform.tiltY
            // Sync color from PIXI object (post fast-preview)
            if (transform.color !== undefined && transform.color !== null) {
              entry.color = transform.color
              entry.initialTransform.color = transform.color
            }
          }
        })
      }

      motionCaptureRef.current = {
        stepId,
        trackedLayers: initialTrackedLayers
      }
      // Pre-populate captureActionIdsRef with existing actions for this step
      captureActionIdsRef.current.clear()
      if (step?.layerActions) {
        Object.entries(step.layerActions).forEach(([lId, actions]) => {
          actions.forEach(action => {
            captureActionIdsRef.current.set(`${lId}:${action.type}`, action.id)
          })
        })
      }
      setMotionCaptureMode({
        isActive: true,
        isTransitioning: false,
        stepId,
        // Called when a drag/resize/rotate interaction ENDS during capture.
        // Dispatches motion actions to Redux so each interaction creates a history entry for undo.
        onInteractionEnd: (layerId) => {
          const capture = motionCaptureRef.current
          if (!capture) {
            console.warn('[Capture] No active capture found in ref');
            return
          }
          const tracked = capture.trackedLayers?.get(layerId)
          if (!tracked) {
            console.warn(`[Capture] No tracked data found for layer=${layerId}`);
            return
          }
          const captureStepId = capture.stepId
          const sceneId = currentSceneId
          if (!captureStepId || !sceneId) return

          const init = tracked.initialTransform

          // Move
          const hasMoved = (tracked.didMove) || (tracked.controlPoints?.length > 0)
          if (hasMoved) {
            const key = `${layerId}:move`
            const existingId = captureActionIdsRef.current.get(key)
            if (existingId) {
              // Pass controlPoints as-is (undefined lets reducer preserve existing curve data)
              dispatch(updateSceneMotionAction({
                sceneId, stepId: captureStepId, layerId, actionId: existingId,
                values: { dx: tracked.deltaX, dy: tracked.deltaY, controlPoints: tracked.controlPoints }
              }))
            } else {
              const actionId = `action-${Date.now()}-move-${layerId}`
              dispatch(addSceneMotionAction({
                sceneId, stepId: captureStepId, layerId, actionId,
                type: 'move', values: { dx: tracked.deltaX, dy: tracked.deltaY, controlPoints: tracked.controlPoints || [], easing: 'power4.out' }
              }))
              captureActionIdsRef.current.set(key, actionId)
            }
          }

          // Scale
          const initialScaleX = init.scaleX || 1
          const initialScaleY = init.scaleY || 1
          const scaleChanged = tracked.scaleX !== undefined && tracked.scaleY !== undefined &&
            (Math.abs(tracked.scaleX - initialScaleX) > 0.001 || Math.abs(tracked.scaleY - initialScaleY) > 0.001)
          if (scaleChanged) {
            const key = `${layerId}:scale`
            const existingId = captureActionIdsRef.current.get(key)
            if (existingId) {
              dispatch(updateSceneMotionAction({
                sceneId, stepId: captureStepId, layerId, actionId: existingId,
                values: { dsx: tracked.scaleX / initialScaleX, dsy: tracked.scaleY / initialScaleY }
              }))
            } else {
              const actionId = `action-${Date.now()}-scale-${layerId}`
              dispatch(addSceneMotionAction({
                sceneId, stepId: captureStepId, layerId, actionId,
                type: 'scale', values: { dsx: tracked.scaleX / initialScaleX, dsy: tracked.scaleY / initialScaleY, easing: 'power4.out' }
              }))
              captureActionIdsRef.current.set(key, actionId)
            }
          } else {
            // Scale returned to initial — remove the action if it exists
            const key = `${layerId}:scale`
            const existingId = captureActionIdsRef.current.get(key)
            if (existingId) {
              dispatch(deleteSceneMotionAction({ sceneId, stepId: captureStepId, layerId, actionId: existingId }))
              captureActionIdsRef.current.delete(key)
            }
          }

          // Rotate
          const initialRotation = init.rotation || 0
          const rotateChanged = tracked.rotation !== undefined && Math.abs(tracked.rotation - initialRotation) > 0.1
          if (rotateChanged) {
            const key = `${layerId}:rotate`
            const existingId = captureActionIdsRef.current.get(key)
            if (existingId) {
              dispatch(updateSceneMotionAction({
                sceneId, stepId: captureStepId, layerId, actionId: existingId,
                values: { dangle: tracked.rotation - initialRotation }
              }))
            } else {
              const actionId = `action-${Date.now()}-rotate-${layerId}`
              dispatch(addSceneMotionAction({
                sceneId, stepId: captureStepId, layerId, actionId,
                type: 'rotate', values: { dangle: tracked.rotation - initialRotation, easing: 'power4.out' }
              }))
              captureActionIdsRef.current.set(key, actionId)
            }
          } else {
            // Rotation returned to initial — remove the action if it exists
            const key = `${layerId}:rotate`
            const existingId = captureActionIdsRef.current.get(key)
            if (existingId) {
              dispatch(deleteSceneMotionAction({ sceneId, stepId: captureStepId, layerId, actionId: existingId }))
              captureActionIdsRef.current.delete(key)
            }
          }

          // [SYNC FIX] Crop: Dispatch crop changes immediately on mouse-up
          // This keeps Move (center) and Crop (bounds) in sync in Redux, preventing jumps.
          const initialCropX = init.cropX || 0
          const initialCropY = init.cropY || 0
          const initialCropW = init.cropWidth || 100
          const initialCropH = init.cropHeight || 100

          const hasCropChanged = (
            (tracked.cropX !== undefined && Math.abs(tracked.cropX - initialCropX) > 0.1) ||
            (tracked.cropY !== undefined && Math.abs(tracked.cropY - initialCropY) > 0.1) ||
            (tracked.cropWidth !== undefined && Math.abs(tracked.cropWidth - initialCropW) > 0.1) ||
            (tracked.cropHeight !== undefined && Math.abs(tracked.cropHeight - initialCropH) > 0.1)
          )

          if (hasCropChanged) {
            const key = `${layerId}:crop`
            const existingId = captureActionIdsRef.current.get(key)
            const cropValues = {
              cropX: tracked.cropX ?? initialCropX,
              cropY: tracked.cropY ?? initialCropY,
              cropWidth: tracked.cropWidth ?? initialCropW,
              cropHeight: tracked.cropHeight ?? initialCropH,
              mediaWidth: tracked.mediaWidth ?? init.mediaWidth,
              mediaHeight: tracked.mediaHeight ?? init.mediaHeight,
              easing: 'power4.out'
            }

            // Important: dx/dy are handled by the Move action if it exists.
            // If No move action, the crop action itself carries the displacement.
            if (!tracked.didMove && !tracked.controlPoints?.length) {
              cropValues.dx = tracked.deltaX
              cropValues.dy = tracked.deltaY
            }

            if (existingId) {
              dispatch(updateSceneMotionAction({ sceneId, stepId: captureStepId, layerId, actionId: existingId, values: cropValues }))
            } else {
              const actionId = `action-${Date.now()}-crop-${layerId}`
              dispatch(addSceneMotionAction({ sceneId, stepId: captureStepId, layerId, actionId, type: 'crop', values: cropValues }))
              captureActionIdsRef.current.set(key, actionId)
            }
          } else {
            // [REVEAL BUG FIX] If crop returned to base, clean up the action
            const key = `${layerId}:crop`
            const existingId = captureActionIdsRef.current.get(key)
            if (existingId) {
              dispatch(deleteSceneMotionAction({ sceneId, stepId: captureStepId, layerId, actionId: existingId }))
              captureActionIdsRef.current.delete(key)
            }
          }

          // Tilt
          const initialTiltX = init.tiltX !== undefined ? init.tiltX : 0
          const initialTiltY = init.tiltY !== undefined ? init.tiltY : 0
          const tiltXChanged = tracked.tiltX !== undefined && Math.abs(tracked.tiltX - initialTiltX) > 0.01
          const tiltYChanged = tracked.tiltY !== undefined && Math.abs(tracked.tiltY - initialTiltY) > 0.01
          const shouldCreateTiltAction = tiltXChanged || tiltYChanged

          if (shouldCreateTiltAction) {
            const key = `${layerId}:tilt`
            const existingId = captureActionIdsRef.current.get(key)
            const tiltValues = {
              tiltX: tracked.tiltX ?? initialTiltX,
              tiltY: tracked.tiltY ?? initialTiltY,
              easing: 'power4.out'
            }
            console.log(`[TILT DEBUG] onInteractionEnd (Edit) update for layer ${layerId}:`, tiltValues, existingId ? 'UPDATING' : 'ADDING')
            if (existingId) {
              dispatch(updateSceneMotionAction({
                sceneId, stepId: captureStepId, layerId, actionId: existingId,
                values: tiltValues
              }))
            } else {
              const actionId = `action-${Date.now()}-tilt-${layerId}`
              dispatch(addSceneMotionAction({
                sceneId, stepId: captureStepId, layerId, actionId,
                type: 'tilt', values: { ...tiltValues, easing: 'power4.out' }
              }))
              captureActionIdsRef.current.set(key, actionId)
            }
          } else {
            const key = `${layerId}:tilt`
            const existingId = captureActionIdsRef.current.get(key)
            if (existingId) {
              dispatch(deleteSceneMotionAction({ sceneId, stepId: captureStepId, layerId, actionId: existingId }))
              captureActionIdsRef.current.delete(key)
            }
          }

          // Fade (Opacity)
          const initialOpacity = init.opacity !== undefined ? init.opacity : 1
          const opacityChanged = tracked.opacity !== undefined && Math.abs(tracked.opacity - initialOpacity) > 0.001
          if (opacityChanged) {
            const key = `${layerId}:fade`
            const existingId = captureActionIdsRef.current.get(key)
            if (existingId) {
              dispatch(updateSceneMotionAction({
                sceneId, stepId: captureStepId, layerId, actionId: existingId,
                values: { opacity: tracked.opacity }
              }))
            } else {
              const actionId = `action-${Date.now()}-fade-${layerId}`
              dispatch(addSceneMotionAction({
                sceneId, stepId: captureStepId, layerId, actionId,
                type: 'fade', values: { opacity: tracked.opacity, easing: 'power4.out' }
              }))
              captureActionIdsRef.current.set(key, actionId)
            }
          } else {
            const key = `${layerId}:fade`
            const existingId = captureActionIdsRef.current.get(key)
            if (existingId) {
              dispatch(deleteSceneMotionAction({ sceneId, stepId: captureStepId, layerId, actionId: existingId }))
              captureActionIdsRef.current.delete(key)
            }
          }

          // Blur
          const initialBlur = init.blur !== undefined ? init.blur : 0
          const blurChanged = tracked.blur !== undefined && Math.abs(tracked.blur - initialBlur) > 0.1
          const shouldCreateBlurAction = blurChanged || tracked.didBlur

          if (shouldCreateBlurAction) {
            const key = `${layerId}:blur`
            const existingId = captureActionIdsRef.current.get(key)
            if (existingId) {
              dispatch(updateSceneMotionAction({
                sceneId, stepId: captureStepId, layerId, actionId: existingId,
                values: { blur: tracked.blur }
              }))
            } else {
              const actionId = `action-${Date.now()}-blur-${layerId}`
              dispatch(addSceneMotionAction({
                sceneId, stepId: captureStepId, layerId, actionId,
                type: 'blur', values: { blur: tracked.blur, easing: 'power4.out' }
              }))
              captureActionIdsRef.current.set(key, actionId)
            }
          } else {
            const key = `${layerId}:blur`
            const existingId = captureActionIdsRef.current.get(key)
            if (existingId) {
              dispatch(deleteSceneMotionAction({ sceneId, stepId: captureStepId, layerId, actionId: existingId }))
              captureActionIdsRef.current.delete(key)
            }
          }

          // Corner Radius
          const initialRadius = init.cornerRadius !== undefined ? init.cornerRadius : 0
          const radiusChanged = tracked.cornerRadius !== undefined && Math.abs(tracked.cornerRadius - initialRadius) > 0.1
          const shouldCreateRadiusAction = radiusChanged || tracked.didCornerRadius

          if (shouldCreateRadiusAction) {
            const key = `${layerId}:cornerRadius`
            const existingId = captureActionIdsRef.current.get(key)
            if (existingId) {
              dispatch(updateSceneMotionAction({
                sceneId, stepId: captureStepId, layerId, actionId: existingId,
                values: { cornerRadius: tracked.cornerRadius }
              }))
            } else {
              const actionId = `action-${Date.now()}-radius-${layerId}`
              dispatch(addSceneMotionAction({
                sceneId, stepId: captureStepId, layerId, actionId,
                type: 'cornerRadius', values: { cornerRadius: tracked.cornerRadius, easing: 'power4.out' }
              }))
              captureActionIdsRef.current.set(key, actionId)
            }
          } else {
            const key = `${layerId}:cornerRadius`
            const existingId = captureActionIdsRef.current.get(key)
            if (existingId) {
              dispatch(deleteSceneMotionAction({ sceneId, stepId: captureStepId, layerId, actionId: existingId }))
              captureActionIdsRef.current.delete(key)
            }
          }

          // Color Change
          const colorChanged = tracked.color !== undefined && tracked.color !== init.color
          const shouldCreateColorAction = colorChanged || tracked.didColor
          if (shouldCreateColorAction) {
            const key = `${layerId}:colorChange`
            const existingId = captureActionIdsRef.current.get(key)
            if (existingId) {
              dispatch(updateSceneMotionAction({
                sceneId, stepId: captureStepId, layerId, actionId: existingId,
                values: { color: tracked.color }
              }))
            } else {
              const actionId = `action-${Date.now()}-color-${layerId}`
              dispatch(addSceneMotionAction({
                sceneId, stepId: captureStepId, layerId, actionId,
                type: 'colorChange', values: { color: tracked.color, easing: 'power1.out' }
              }))
              captureActionIdsRef.current.set(key, actionId)
            }
          } else {
            const key = `${layerId}:colorChange`
            const existingId = captureActionIdsRef.current.get(key)
            if (existingId) {
              dispatch(deleteSceneMotionAction({ sceneId, stepId: captureStepId, layerId, actionId: existingId }))
              captureActionIdsRef.current.delete(key)
            }
          }

          // Flip (card frames)
          if (tracked.didFlip) {
            const key = `${layerId}:flip`
            const existingId = captureActionIdsRef.current.get(key)
            if (!existingId) {
              const actionId = `action-${Date.now()}-flip-${layerId}`
              dispatch(addSceneMotionAction({
                sceneId, stepId: captureStepId, layerId, actionId,
                type: 'flip', values: { duration: 600 }
              }))
              captureActionIdsRef.current.set(key, actionId)
            }
          } else {
            // didFlip toggled back to false (user double-flipped) — remove the flip action
            const key = `${layerId}:flip`
            const existingId = captureActionIdsRef.current.get(key)
            if (existingId) {
              dispatch(deleteSceneMotionAction({ sceneId, stepId: captureStepId, layerId, actionId: existingId }))
              captureActionIdsRef.current.delete(key)
            }
          }
        },
        onPositionUpdate: (data) => {

          const capture = motionCaptureRef.current
          if (!capture) return
          const entry = capture.trackedLayers.get(data.layerId)
          if (entry) {
            if (Math.abs(data.x - entry.initialTransform.x) > 0.5 || Math.abs(data.y - entry.initialTransform.y) > 0.5) {
              entry.didMove = true
            }
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
            if (data.opacity !== undefined) entry.opacity = data.opacity
            if (data.blur !== undefined) entry.blur = data.blur
            if (data.cornerRadius !== undefined) {
              entry.cornerRadius = data.cornerRadius
              entry.didCornerRadius = true
            }
            if (data.color !== undefined) {
              entry.color = data.color
              entry.didColor = true
            }
            if (data.didFlip) {
              entry.didFlip = true
            }
            if (data.controlPoints !== undefined && Array.isArray(data.controlPoints)) {
              entry.controlPoints = data.controlPoints
            } else if (data.controlPoints === null) {
              entry.controlPoints = []
            }
            setCaptureVersion(v => v + 1)
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
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault()
        if (isMotionCaptureActive) {
          // During active capture, undo/redo works granularly (same as normal mode).
          // After dispatch, the sync effect (below) reconstructs trackedLayers from Redux.
          captureUndoSyncRef.current = true
        }
        if (!e.shiftKey) {
          dispatch(undo())
        } else {
          dispatch(redo())
        }
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

        try {
          const lastCopiedType = localStorage.getItem('vevara_last_copied_type')
          if (lastCopiedType === 'scene') {
            dispatch(pasteScene())
          } else if (lastCopiedType === 'layers') {
            dispatch(pasteLayers())
          } else {
            // Legacy / fallback heuristic if marker is not set
            const sceneClipboard = localStorage.getItem('vevara_scene_clipboard')
            if (sceneClipboard) {
              const layerClipboard = localStorage.getItem('vevara_clipboard')
              if (sceneClipboard && (!layerClipboard || selectedLayerIds.length === 0)) {
                dispatch(pasteScene())
              } else if (layerClipboard) {
                dispatch(pasteLayers())
              }
            } else {
              dispatch(pasteLayers())
            }
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
  }, [isPlaying, showGrid, zoom, selectedLayerIds, currentSceneId, dispatch, playheadTime, totalTime, isMotionCaptureActive])

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

  /**
   * Flip a card frame layer visually and record in motion capture if active.
   * Extracted for reuse by both CanvasControls and handleAddAnimation.
   */
  const handleFlipForLayer = useCallback((layerId) => {
    if (!layerId) return
    const layer = layers[layerId]
    if (!layer?.data?.isCardFrame) return

    if (!isMotionCaptureActive) {
      dispatch(flipCardFrame({ layerId }))
    }

    const tracked = isMotionCaptureActive ? motionCaptureRef.current?.trackedLayers?.get(layerId) : null
    const showingFront = tracked?.showingFront !== undefined
      ? tracked.showingFront
      : (layer.data.showingFront !== false)

    const pixiObj = motionControls?.layerObjects?.get?.(layerId)
    if (pixiObj) {
      pixiObj._isFlipping = true
      gsap.to(pixiObj.scale, {
        x: 0, duration: 0.15, ease: 'power2.in',
        onComplete: () => {
          const newShowingFront = !showingFront
          pixiObj._showingFront = newShowingFront
          if (pixiObj._imageSprite) pixiObj._imageSprite.visible = newShowingFront && pixiObj._frameHasAsset
          if (pixiObj._backSprite) pixiObj._backSprite.visible = !newShowingFront && (pixiObj._frameHasBackAsset || false)
          if (pixiObj._framePlaceholder) {
            const activeHasAsset = newShowingFront ? pixiObj._frameHasAsset : (pixiObj._frameHasBackAsset || false)
            pixiObj._framePlaceholder.visible = !activeHasAsset
            if (!activeHasAsset && pixiObj._frameLabel) {
              const customLabel = (layer.data?.label || '').trim()
              if (!customLabel) {
                pixiObj._frameLabel.text = newShowingFront ? 'Front' : 'Back'
              }
            }
          }
          gsap.to(pixiObj.scale, {
            x: 1, duration: 0.15, ease: 'power2.out',
            onComplete: () => { pixiObj._isFlipping = false }
          })
        }
      })
    }

    if (tracked) {
      tracked.showingFront = !showingFront
      tracked.didFlip = !tracked.didFlip
      if (effectiveMotionCaptureMode?.onInteractionEnd) {
        effectiveMotionCaptureMode.onInteractionEnd(layerId)
      }
    }
  }, [layers, isMotionCaptureActive, motionControls, dispatch, effectiveMotionCaptureMode])

  /**
   * Handle adding an animation from the MotionPanel's "+ Add Animation" menu.
   * Auto-apply actions (move/rotate/scale/flip) nudge the PIXI object and dispatch.
   * Panel-opening actions (color/fade/blur/crop) select the layer and open controls.
   */
  const handleAddAnimation = useCallback((layerId, actionType) => {
    if (!isMotionCaptureActive || !editingStepId) return

    dispatch(setSelectedLayer(layerId))

    // [MOBILE] Auto-close the motion panel on mobile screens if the added action
    // requires interacting with a control panel/slider on the canvas controls or sidebar.
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      if (['colorChange', 'fade', 'blur', 'cornerRadius', 'tilt'].includes(actionType)) {
        setIsMotionPanelOpen(false)
      }
    }

    const pixiObj = motionControls?.layerObjects?.get?.(layerId)
    const tracked = motionCaptureRef.current?.trackedLayers?.get(layerId)

    switch (actionType) {
      case 'move': {
        if (!pixiObj || !tracked) break
        const nudge = 255
        pixiObj.x += nudge
        tracked.deltaX = (tracked.deltaX || 0) + nudge
        tracked.currentPosition = { x: pixiObj.x, y: pixiObj.y }
        tracked.didMove = true
        if (effectiveMotionCaptureMode?.onInteractionEnd) {
          effectiveMotionCaptureMode.onInteractionEnd(layerId)
        }
        break
      }
      case 'rotate': {
        if (!pixiObj || !tracked) break
        const angleDeg = 30
        pixiObj.rotation += angleDeg * (Math.PI / 180)
        tracked.rotation = (tracked.rotation ?? tracked.initialTransform?.rotation ?? 0) + angleDeg
        tracked.didRotate = true
        if (effectiveMotionCaptureMode?.onInteractionEnd) {
          effectiveMotionCaptureMode.onInteractionEnd(layerId)
        }
        break
      }
      case 'scale': {
        if (!pixiObj || !tracked) break
        const factor = 1.25
        pixiObj.scale.x *= factor
        pixiObj.scale.y *= factor
        tracked.scaleX = pixiObj.scale.x
        tracked.scaleY = pixiObj.scale.y
        tracked.didScale = true
        if (effectiveMotionCaptureMode?.onInteractionEnd) {
          effectiveMotionCaptureMode.onInteractionEnd(layerId)
        }
        break
      }
      case 'flip': {
        handleFlipForLayer(layerId)
        break
      }
      case 'colorChange': {
        if (typeof window !== 'undefined' && window.innerWidth < 1024) {
          setRequestOpenControl('color')
          setTimeout(() => setRequestOpenControl(null), 100)
        } else {
          setColorPickerType('fill')
          setActiveSidebarItem('Color')
        }
        break
      }
      case 'fade':
        setRequestOpenControl('opacity')
        setTimeout(() => setRequestOpenControl(null), 100)
        break
      case 'blur':
        setRequestOpenControl('blur')
        setTimeout(() => setRequestOpenControl(null), 100)
        break
      case 'cornerRadius':
        setRequestOpenControl('cornerRadius')
        setTimeout(() => setRequestOpenControl(null), 100)
        break
      case 'tilt':
        setRequestOpenControl('tilt')
        setTimeout(() => setRequestOpenControl(null), 100)
        break
      case 'crop': {
        if (!pixiObj || !tracked) break
        const layer = layers[layerId]
        if (!layer) break
        if (![LAYER_TYPES.IMAGE, LAYER_TYPES.VIDEO, LAYER_TYPES.FRAME].includes(layer.type)) break

        const mw = tracked.mediaWidth || tracked.initialTransform.mediaWidth || layer.mediaWidth || layer.width || 100
        const mh = tracked.mediaHeight || tracked.initialTransform.mediaHeight || layer.mediaHeight || layer.height || 100
        const insetX = mw * 0.10
        const insetY = mh * 0.10

        tracked.cropX = (tracked.cropX ?? tracked.initialTransform.cropX ?? 0) + insetX
        tracked.cropY = (tracked.cropY ?? tracked.initialTransform.cropY ?? 0) + insetY
        tracked.cropWidth = (tracked.cropWidth ?? tracked.initialTransform.cropWidth ?? mw) - insetX * 2
        tracked.cropHeight = (tracked.cropHeight ?? tracked.initialTransform.cropHeight ?? mh) - insetY * 2
        tracked.mediaWidth = mw
        tracked.mediaHeight = mh

        if (tracked.cropWidth <= 0 || tracked.cropHeight <= 0) break
        tracked.didCrop = true

        if (effectiveMotionCaptureMode?.onInteractionEnd) {
          effectiveMotionCaptureMode.onInteractionEnd(layerId)
        }
        break
      }
      case 'typewriter': {
        // [TYPEWRITER] Dispatch the action directly to Redux
        dispatch(addSceneMotionAction({
          sceneId: currentSceneId,
          stepId: editingStepId,
          layerId,
          type: 'typewriter',
          values: {
            duration: 1000, // Default duration
            easing: 'none'
          }
        }))

        // [FAST PREVIEW] Provide immediate visual feedback on the canvas when the user adds the effect
        if (pixiObj && typeof pixiObj.revealProgress !== 'undefined') {
          // Kill any lingering Tweens on revealProgress to prevent conflicts
          gsap.killTweensOf(pixiObj, "revealProgress")

          // Reset to 0 visually and animate to 1 smoothly
          pixiObj.revealProgress = 0
          gsap.to(pixiObj, {
            revealProgress: 1,
            duration: 1.0, // [FIX] Speed up to 1s to match standard fast preview
            ease: "none",
            onComplete: () => {
              // Mark as tracked so MotionPanel's "tryPreview" or state sync knows an interaction occurred
              if (tracked) {
                tracked.didTypewriter = true
              }
              if (effectiveMotionCaptureMode?.onInteractionEnd) {
                effectiveMotionCaptureMode.onInteractionEnd(layerId)
              }
            }
          })
        }
        break
      }
      default:
        break
    }
  }, [isMotionCaptureActive, editingStepId, motionControls, dispatch, effectiveMotionCaptureMode, handleFlipForLayer, setActiveSidebarItem, setIsMotionPanelOpen, setRequestOpenControl])

  const handleDeleteCaptureAction = useCallback((stepId, layerId, actionType) => {
    if (!isMotionCaptureActive || editingStepId !== stepId) return
    const tracked = motionCaptureRef.current?.trackedLayers?.get(layerId)
    if (!tracked) return

    // Remove from captureActionIdsRef
    captureActionIdsRef.current.delete(`${layerId}:${actionType}`)

    // Reset tracked flags and values to initial
    const init = tracked.initialTransform
    switch (actionType) {
      case 'move':
        tracked.didMove = false; tracked.deltaX = 0; tracked.deltaY = 0
        tracked.controlPoints = []
        tracked.currentPosition = { x: init.x, y: init.y }
        break
      case 'scale':
        tracked.didScale = false; tracked.scaleX = init.scaleX; tracked.scaleY = init.scaleY
        break
      case 'rotate':
        tracked.didRotate = false; tracked.rotation = init.rotation
        break
      case 'fade':
        tracked.didFade = false; tracked.opacity = init.opacity
        break
      case 'blur':
        tracked.didBlur = false; tracked.blur = init.blur ?? 0
        break
      case 'cornerRadius':
        tracked.didCornerRadius = false; tracked.cornerRadius = init.cornerRadius ?? 0
        break
      case 'crop':
        tracked.didCrop = false
        tracked.cropX = init.cropX; tracked.cropY = init.cropY
        tracked.cropWidth = init.cropWidth; tracked.cropHeight = init.cropHeight
        break
      case 'colorChange':
        tracked.didColor = false; tracked.color = init.color
        break
      case 'flip':
        tracked.didFlip = false; tracked.showingFront = !tracked.showingFront
        break
    }

    // Reset PIXI object for visual types
    const pixiObj = motionControls?.layerObjects?.get?.(layerId)
    if (pixiObj && !pixiObj.destroyed) {
      if (actionType === 'move') { pixiObj.x = init.x; pixiObj.y = init.y }
      if (actionType === 'scale') { pixiObj.scale.x = init.scaleX; pixiObj.scale.y = init.scaleY }
      if (actionType === 'rotate') { pixiObj.rotation = init.rotation * (Math.PI / 180) }
      if (actionType === 'fade') { pixiObj.alpha = init.opacity ?? 1 }
      if (actionType === 'cornerRadius') {
        const radius = init.cornerRadius ?? 0
        pixiObj._storedShapeData = { ...pixiObj._storedShapeData, cornerRadius: radius }
        if (pixiObj._updateShapeRadiusVisuals) pixiObj._updateShapeRadiusVisuals(radius)
      }
    }
  }, [isMotionCaptureActive, editingStepId, motionControls])

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
    <ThemeContext.Provider value={{ theme, setTheme }}>
      <div
        className={`h-dvh flex flex-col overflow-hidden relative select-none ${theme === 'light' ? 'theme-light text-gray-900 bg-[#f3f4f7]' : 'theme-dark text-white bg-[#090a0d]'}`}
        data-editor-container
        style={{
          touchAction: 'none',
          backgroundColor: theme === 'light' ? '#f3f4f7' : '#090a0d'
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
              <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-4 ${isLight ? 'bg-purple-100' : 'bg-purple-500/20'}`}>
                <FileText className={`h-6 w-6 ${isLight ? 'text-purple-600' : 'text-purple-400'}`} />
              </div>
              <h3 className={`text-lg font-bold mb-2 ${isLight ? 'text-gray-900' : 'text-white'}`}>Open account to save</h3>
              <p className={`text-sm mb-6 leading-relaxed ${isLight ? 'text-gray-500' : 'text-zinc-400'}`}>
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
                  className={`w-full py-2 text-xs font-medium transition-all ${isLight ? 'text-gray-400 hover:text-gray-600' : 'text-zinc-500 hover:text-zinc-300'}`}
                >
                  Not now
                </button>
              </div>
            </div>
          </Modal>
        )}

        {/* Loading Overlay */}
        {projectStatus === 'loading' && (
          <div className={`fixed inset-0 z-[9999] flex flex-col ${isLight ? 'bg-[#f4f5f8]' : 'bg-[#090a10]'}`}>
            <style dangerouslySetInnerHTML={{__html: `
              @keyframes shimmer {
                0% { background-position: -200% 0; }
                100% { background-position: 200% 0; }
              }
              .skeleton-shimmer {
                background: linear-gradient(90deg, rgba(255,255,255,0.015) 25%, rgba(255,255,255,0.05) 50%, rgba(255,255,255,0.015) 75%);
                background-size: 200% 100%;
                animation: shimmer 1.6s infinite linear;
              }
              .skeleton-shimmer-light {
                background: linear-gradient(90deg, rgba(0,0,0,0.02) 25%, rgba(0,0,0,0.05) 50%, rgba(0,0,0,0.02) 75%);
                background-size: 200% 100%;
                animation: shimmer 1.6s infinite linear;
              }
            `}} />
            
            {/* 1. TOP NAVBAR SKELETON */}
            <div className="h-14 flex items-center justify-between px-4 shrink-0">
              <div className="flex items-center gap-4">
                {/* Back Arrow Button */}
                <div className={`w-8 h-8 rounded-lg ${isLight ? 'bg-black/5' : 'bg-white/5'} ${isLight ? 'skeleton-shimmer-light' : 'skeleton-shimmer'}`} />
                {/* Project Name */}
                <div className={`w-36 h-4 rounded ${isLight ? 'bg-black/5' : 'bg-white/5'} ${isLight ? 'skeleton-shimmer-light' : 'skeleton-shimmer'}`} />
              </div>
              <div className="flex items-center gap-3">
                {/* Save Status / Aspect Ratio */}
                <div className={`w-16 h-7 rounded-lg ${isLight ? 'bg-black/5' : 'bg-white/5'} ${isLight ? 'skeleton-shimmer-light' : 'skeleton-shimmer'}`} />
                {/* Export Button */}
                <div className={`w-20 h-7 rounded-lg ${isLight ? 'bg-black/5' : 'bg-white/5'} ${isLight ? 'skeleton-shimmer-light' : 'skeleton-shimmer'}`} />
                {/* Profile Circle */}
                <div className={`w-7 h-7 rounded-full ${isLight ? 'bg-black/5' : 'bg-white/5'} ${isLight ? 'skeleton-shimmer-light' : 'skeleton-shimmer'}`} />
              </div>
            </div>

            {/* MAIN BODY AREA */}
            <div className="flex flex-1 overflow-hidden relative">
              
              {/* 2. LEFT SIDEBAR SKELETON (Desktop only) */}
              <div className="w-20 flex flex-col items-center py-5 gap-5 shrink-0 hidden md:flex">
                {[1, 2, 3, 4, 5].map(i => (
                  <div key={i} className={`w-11 h-11 rounded-xl ${isLight ? 'bg-black/5' : 'bg-white/5'} ${isLight ? 'skeleton-shimmer-light' : 'skeleton-shimmer'}`} />
                ))}
              </div>

              {/* 3. MIDDLE CANVAS & TIMELINE AREA */}
              <div className="flex-1 flex flex-col overflow-hidden relative">
                
                {/* EMPTY CANVAS AREA (Spacious & Clean) */}
                <div className="flex-1" />

                {/* 4. BOTTOM TIMELINE SKELETON (Desktop & Mobile) */}
                <div className="h-[140px] p-4 flex flex-col gap-3 shrink-0">
                  {/* Timeline Controls bar */}
                  <div className="flex items-center justify-between">
                    <div className="flex gap-3">
                      {/* Play Button Icon */}
                      <div className={`w-5 h-5 rounded-full ${isLight ? 'bg-black/5' : 'bg-white/5'} ${isLight ? 'skeleton-shimmer-light' : 'skeleton-shimmer'}`} />
                      {/* Time Code */}
                      <div className={`w-14 h-3.5 mt-0.5 rounded ${isLight ? 'bg-black/5' : 'bg-white/5'} ${isLight ? 'skeleton-shimmer-light' : 'skeleton-shimmer'}`} />
                    </div>
                    {/* Add Scene Button */}
                    <div className={`w-24 h-6 rounded-lg ${isLight ? 'bg-black/5' : 'bg-white/5'} ${isLight ? 'skeleton-shimmer-light' : 'skeleton-shimmer'}`} />
                  </div>

                  {/* Horizontal Scene Cards Grid */}
                  <div className="flex-1 flex gap-3 items-center overflow-hidden">
                    {[1, 2, 3, 4].map(i => (
                      <React.Fragment key={i}>
                        {/* Scene Card */}
                        <div className={`w-32 h-16 rounded-xl shrink-0 ${isLight ? 'bg-black/5' : 'bg-white/5'} ${isLight ? 'skeleton-shimmer-light' : 'skeleton-shimmer'}`} />
                        {/* transition spacer (except last item) */}
                        {i < 4 && (
                          <div className={`w-5 h-3 rounded shrink-0 opacity-40 ${isLight ? 'bg-black/5' : 'bg-white/5'} ${isLight ? 'skeleton-shimmer-light' : 'skeleton-shimmer'}`} />
                        )}
                      </React.Fragment>
                    ))}
                  </div>
                </div>

              </div>

            </div>
          </div>
        )}

        {/* Top Toolbar */}
        <div
          ref={topToolbarRef}
          className="absolute top-0 left-0 right-0 z-50"
          style={{
            transform: isMotionCaptureActive ? 'translateY(-100%)' : 'translateY(0)',
            transition: 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
          }}
        >
          <TopToolbar
            projectName={projectName}
            onSave={handleSave}
            onNavigate={handleNavigate}
            isSaving={isSaving || isSavingRedux}
            isDirty={isDirty}
            lastSaved={lastSaved}
            onProjectNameChange={(newName) => dispatch(setProjectName(newName))}
            onExport={handleExport}
            onRequestGifOptions={() => setGifExportModalOpen(true)}
            hideExport={tutorialActive && tutorialStep === 7}
            onCanvasSizeChange={handleCanvasSizeChange}
            onToggleSidebar={() => handleSidebarItemClick('Elements')}
            onUndo={() => {
              if (isMotionCaptureActive) captureUndoSyncRef.current = true
              dispatch(undo())
            }}
            onRedo={() => {
              if (isMotionCaptureActive) captureUndoSyncRef.current = true
              dispatch(redo())
            }}
            sidebarWidth={typeof window !== 'undefined' && window.innerWidth < 1024 ? '0px' : sidebarWidth}
            showPasteboard={showPasteboard}
            onTogglePasteboard={() => setShowPasteboard(!showPasteboard)}
          />
        </div>

        <div
          className="hidden lg:block absolute left-0 z-50"
          style={{
            top: `${topToolbarHeight}px`,
            height: `calc(100vh - ${topToolbarHeight}px)`,
            transform: isMotionCaptureActive ? 'translateX(-100%)' : 'translateX(0)',
            transition: isResizingBottom
              ? 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
              : 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), height 0.3s ease',
          }}
        >
          <LeftSidebar
            activeItem={activeSidebarItem}
            isMotionOpen={isMotionPanelOpen}
            onItemClick={(item) => {
              if (item === 'Motion') {
                setIsMotionPanelOpen(prev => !prev)
              } else {
                handleSidebarItemClick(item)
              }
            }}
          />
        </div>

        {/* Main Content Area */}
        <div className="flex flex-1 min-h-0 overflow-hidden relative z-40">

          {/* Side Panels - Desktop: normal, Mobile: full overlay */}
          <div className="relative">
            {/* Desktop Panels */}
            {activeSidebarItem && (
              <div className={`hidden lg:block absolute z-40 shadow-2xl transition-all duration-300 ${isMotionCaptureActive ? 'left-0' : 'left-20'}`} style={{
                top: isMotionCaptureActive ? '0px' : `${topToolbarHeight}px`,
                height: isMotionCaptureActive ? '100vh' : `calc(100vh - ${topToolbarHeight}px)`,
                borderRight: `1px solid ${theme === 'light' ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.05)'}`
              }}>
                {activeSidebarItem === 'Design' && (
                  <DesignPanel onClose={handleClosePanel} />
                )}
                {activeSidebarItem === 'Profile' && (
                  <ProfilePanel onClose={handleClosePanel} onNavigate={handleNavigate} />
                )}
                {activeSidebarItem === 'Elements' && (
                  <ElementsPanel onClose={handleClosePanel} aspectRatio={aspectRatio} />
                )}
                {activeSidebarItem === 'Frames' && (
                  <FramesPanel onClose={handleClosePanel} aspectRatio={aspectRatio} />
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
                {activeSidebarItem === 'Transitions' && (
                  <TransitionsPanel
                    onClose={handleClosePanel}
                    activeTransitionSceneId={activeTransitionSceneId}
                    motionControls={motionControls}
                  />
                )}
                {/* {activeSidebarItem === 'Tools' && (
                <ToolsPanel onClose={handleClosePanel} />
              )} */}
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
                      // Motion capture interception for color changes
                      // Do NOT dispatch updateLayer during capture — that would pollute the base layer state
                      // and make start === target, resulting in no animation.
                      if (isMotionCaptureActive && effectiveMotionCaptureMode?.onPositionUpdate && colorPickerType !== 'stroke') {
                        // For canvas background color, find the background layer
                        let captureLayerId = null
                        if (colorPickerType === 'canvas') {
                          captureLayerId = Object.keys(layers).find(id => layers[id]?.type === 'background' && layers[id]?.sceneId === currentSceneId)
                        } else if (selectedLayerIds?.length === 1) {
                          captureLayerId = selectedLayerIds[0]
                        }

                        if (captureLayerId) {
                          const capture = motionCaptureRef.current
                          if (capture && capture.trackedLayers.has(captureLayerId)) {
                            const colorValue = color === 'transparent' ? null : color
                            effectiveMotionCaptureMode.onPositionUpdate({ layerId: captureLayerId, color: colorValue })
                            effectiveMotionCaptureMode.onInteractionEnd(captureLayerId)
                            return
                          }
                        }
                      }

                      if (colorPickerType === 'canvas' && currentSceneId) {
                        if (color === 'transparent') return // Canvas background cannot be transparent

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
                          if (color === 'transparent') return // Background layer cannot be transparent

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
                  className="lg:hidden fixed inset-0 z-[60] bg-transparent transition-opacity duration-200 mobile-sheet-backdrop pointer-events-none"
                  style={{ top: 0 }}
                  aria-hidden
                />
                <div
                  ref={mobileSheetRef}
                  className={`lg:hidden fixed bottom-0 left-0 right-0 z-[61] flex flex-col rounded-t-2xl border-t shadow-2xl mobile-sheet-in ${isLight ? 'border-black/5' : 'border-white/10'}`}
                  style={{
                    height: (activeSidebarItem === 'Uploads' || activeSidebarItem === 'Media') ? '50vh' : '42vh',
                    minHeight: (activeSidebarItem === 'Uploads' || activeSidebarItem === 'Media') ? '320px' : '280px',
                    maxHeight: (activeSidebarItem === 'Uploads' || activeSidebarItem === 'Media') ? '52vh' : '45vh',
                    backgroundColor: isLight ? '#f3f4f7' : '#090a0d',
                    paddingBottom: 'env(safe-area-inset-bottom, 0px)',
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Top Bar Header with swipe-to-dismiss and click-to-close down arrow */}
                  <div className="relative flex items-center justify-between px-4 py-3 flex-shrink-0 w-full border-b border-black/5 dark:border-white/5">
                    {/* Spacing for symmetry */}
                    <div className="w-8 h-8 flex-shrink-0" />

                    {/* Centered Drag Handle (takes full height/width of center region for easy swiping) */}
                    <div
                      className="absolute inset-y-0 inset-x-12 flex justify-center items-center cursor-row-resize touch-none"
                      style={{ touchAction: 'none' }}
                      onTouchStart={handleSheetTouchStart}
                      onTouchMove={handleSheetTouchMove}
                      onTouchEnd={handleSheetTouchEnd}
                    >
                      <div className={`w-12 h-1.5 rounded-full ${isLight ? 'bg-black/15' : 'bg-white/30'}`} aria-hidden />
                    </div>

                    {/* Down Chevron button on the right */}
                    <button
                      onClick={handleClosePanel}
                      className={`relative z-10 flex h-8 w-8 items-center justify-center transition-all duration-200 active:scale-90 ${isLight ? 'text-gray-600 hover:text-gray-900' : 'text-white/60 hover:text-white'}`}
                      aria-label="Close panel"
                    >
                      <ChevronDown className="h-5 w-5" strokeWidth={2.5} />
                    </button>
                  </div>
                  {/* Panel content - scrollable, same bg as sheet */}
                  <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden" style={{ backgroundColor: isLight ? '#f3f4f7' : '#090a0d' }}>
                    {activeSidebarItem === 'Design' && (
                      <DesignPanel onClose={handleClosePanel} />
                    )}
                    {activeSidebarItem === 'Profile' && (
                      <ProfilePanel onClose={handleClosePanel} onNavigate={handleNavigate} />
                    )}
                    {activeSidebarItem === 'Elements' && (
                      <ElementsPanel onClose={handleClosePanel} aspectRatio={aspectRatio} />
                    )}
                    {activeSidebarItem === 'Frames' && (
                      <FramesPanel onClose={handleClosePanel} aspectRatio={aspectRatio} />
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
                    {activeSidebarItem === 'Transitions' && (
                      <TransitionsPanel
                        onClose={handleClosePanel}
                        activeTransitionSceneId={activeTransitionSceneId}
                        motionControls={motionControls}
                      />
                    )}
                    {/* {activeSidebarItem === 'Tools' && (
                    <ToolsPanel onClose={handleClosePanel} />
                  )} */}
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
                      <div className="w-full p-1">
                        <AdvancedColorPickerModal
                          isInline={true}
                          initialColor={
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
                            // Motion capture interception
                            if (isMotionCaptureActive && effectiveMotionCaptureMode?.onPositionUpdate && colorPickerType !== 'stroke') {
                              let captureLayerId = null
                              if (colorPickerType === 'canvas') {
                                captureLayerId = Object.keys(layers).find(id => layers[id]?.type === 'background' && layers[id]?.sceneId === currentSceneId)
                              } else if (selectedLayerIds?.length === 1) {
                                captureLayerId = selectedLayerIds[0]
                              }
                              if (captureLayerId) {
                                const capture = motionCaptureRef.current
                                if (capture && capture.trackedLayers.has(captureLayerId)) {
                                  const colorValue = color === 'transparent' ? null : color
                                  effectiveMotionCaptureMode.onPositionUpdate({ layerId: captureLayerId, color: colorValue })
                                  effectiveMotionCaptureMode.onInteractionEnd(captureLayerId)
                                  return
                                }
                              }
                            }

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
                          onClose={handleClosePanel}
                        />
                      </div>
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
                  {/* Horizontal minimal nav at bottom of sheet - scrollable on mobile */}
                  <div
                    className={`flex-shrink-0 flex items-center justify-start gap-3 px-4 py-2.5 border-t overflow-x-auto scrollbar-none ${isLight ? 'border-black/5 bg-black/5' : 'border-white/5 bg-black/20'}`}
                    style={{
                      paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))',
                      WebkitOverflowScrolling: 'touch'
                    }}
                  >
                    {[...SIDEBAR_ITEMS, { icon: User, label: 'Profile' }].map((item) => {
                      const Icon = item.icon
                      const isActive = activeSidebarItem === item.label
                      return (
                        <button
                          key={item.label}
                          onClick={() => handleSidebarItemClick(item.label)}
                          className={`flex flex-col items-center justify-center gap-0.5 py-1.5 px-3 min-w-[64px] flex-shrink-0 rounded-xl transition-all duration-200 touch-manipulation ${isActive
                            ? (isLight ? 'bg-gray-200 text-gray-900' : 'bg-white/10 text-white')
                            : (isLight ? 'text-gray-500 active:bg-black/5' : 'text-zinc-400 active:bg-white/5')
                            }`}
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
            <div
              ref={topControlsRef}
              className={`absolute z-30 pointer-events-none flex justify-center ${isAutoPlaying ? 'hidden' : 'lg:flex hidden'}`}
              style={{
                top: `${topToolbarHeight + 8}px`,
                left: currentSidebarWidth,
                right: 0,
                transform: currentSidebarWidth !== '0px' ? 'translateX(-40px)' : 'none'
              }}
            >
              <CanvasControls
                duration={`${totalTime.toFixed(1)}s`}
                selectedLayer={capturedLayer || (selectedLayerIds[0] ? layers[selectedLayerIds[0]] : null)}
                selectedCanvas={selectedCanvas}
                currentScene={currentSceneData}
                editingStepActionCount={editingStepActionCount}
                onLayerUpdate={(updates) => {
                  if (selectedLayerIds[0]) {
                    const layerId = selectedLayerIds[0]

                    // [MOTION CAPTURE FIX] During capture, we ONLY update the capture session/action.
                    // We do NOT dispatch updateLayer here because that pollutes the base layer state
                    // which the MotionEngine uses as its starting point for Step 0.
                    if (isMotionCaptureActive && effectiveMotionCaptureMode?.onPositionUpdate) {
                      if (updates.opacity !== undefined) {
                        const capture = motionCaptureRef.current
                        if (capture && capture.trackedLayers.has(layerId)) {
                          capture.trackedLayers.get(layerId).didFade = true
                        }
                        effectiveMotionCaptureMode.onPositionUpdate({ layerId, opacity: updates.opacity })
                        // For slider adjustments, we trigger an immediate interaction end 
                        // to generate/update the motion action in Redux.
                        effectiveMotionCaptureMode.onInteractionEnd(layerId)
                      }
                      // Handle other properties if Slider UI ever supports them (rotate, x, y etc)
                      if (updates.rotation !== undefined) {
                        const capture = motionCaptureRef.current
                        if (capture && capture.trackedLayers.has(layerId)) {
                          capture.trackedLayers.get(layerId).didRotate = true
                        }
                        effectiveMotionCaptureMode.onPositionUpdate({ layerId, rotation: updates.rotation })
                        effectiveMotionCaptureMode.onInteractionEnd(layerId)
                      }
                      if (updates.blur !== undefined) {
                        const clampedBlur = Math.max(0, Math.min(BLUR_MAX, updates.blur))
                        const capture = motionCaptureRef.current
                        if (capture && capture.trackedLayers.has(layerId)) {
                          const tracked = capture.trackedLayers.get(layerId)
                          tracked.didBlur = true
                        }
                        effectiveMotionCaptureMode.onPositionUpdate({ layerId, blur: clampedBlur })
                        effectiveMotionCaptureMode.onInteractionEnd(layerId)
                      }

                      // [TILT] Handle tiltX/tiltY slider updates during capture
                      if (updates.tiltX !== undefined || updates.tiltY !== undefined) {
                        const capture = motionCaptureRef.current
                        if (capture && capture.trackedLayers.has(layerId)) {
                          const tracked = capture.trackedLayers.get(layerId)
                          tracked.didTilt = true
                          if (updates.tiltX !== undefined) tracked.tiltX = updates.tiltX
                          if (updates.tiltY !== undefined) tracked.tiltY = updates.tiltY
                        }
                        effectiveMotionCaptureMode.onPositionUpdate({
                          layerId,
                          tiltX: updates.tiltX,
                          tiltY: updates.tiltY
                        })
                        // Trigger immediate action update
                        effectiveMotionCaptureMode.onInteractionEnd(layerId)
                      }

                      // [BUG FIX] Corner radius update from slider (nested in data)
                      const radiusUpdate = updates.cornerRadius !== undefined ? updates.cornerRadius : updates.data?.cornerRadius
                      if (radiusUpdate !== undefined) {
                        const clampedRadius = Math.max(0, Math.min(CORNER_RADIUS_MAX, radiusUpdate))
                        effectiveMotionCaptureMode.onPositionUpdate({ layerId, cornerRadius: clampedRadius })
                        effectiveMotionCaptureMode.onInteractionEnd(layerId)
                      }


                      // [BUG FIX] Only trigger color change if the value actually changed
                      // (prevents ghost actions when sliders spread entire data object)
                      const newColor = updates.data?.fill || updates.data?.color
                      if (newColor !== undefined) {
                        const capture = motionCaptureRef.current
                        const tracked = capture?.trackedLayers.get(layerId)
                        if (tracked && tracked.color !== newColor) {
                          tracked.didColor = true
                          tracked.color = newColor
                          effectiveMotionCaptureMode.onPositionUpdate({ layerId, color: newColor })
                          effectiveMotionCaptureMode.onInteractionEnd(layerId)
                        }
                      }
                    } else {
                      // Normal editor behavior: update base layer properties
                      dispatch(updateLayer({ id: layerId, ...updates }))
                    }
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
                  setIsMotionPanelOpen(prev => !prev)
                }}
                isMotionCaptureActive={isMotionCaptureActive}
                onStartMotionCapture={handleStartMotionCapture}
                onApplyMotion={handleApplyMotion}
                onCancelMotion={handleCancelMotion}
                onFlipCardFrame={() => handleFlipForLayer(selectedLayerIds[0])}
                requestOpenControl={requestOpenControl}
                stepsCount={currentSceneMotionFlow?.steps?.length || 0}
                showStarterHint={showStarterHint}
                starterHintText={starterHintText}
                onHideStarterHint={() => {
                  setShowStarterHint(false)
                  if (isStarterCopy) {
                    localStorage.setItem(`vevara_starter_autoplay_done_${urlProjectId || projectId}`, 'true')
                  }
                }}
              />
            </div>

            {/* Canvas - Takes all available space */}
            <div
              ref={canvasContainerRef}
              data-tutorial="canvas-area"
              className="absolute flex-1 overflow-hidden select-none"
              style={{
                top: 0,
                bottom: initialBottomHeight || 0,
                left: 0,
                right: 0,
                backgroundColor: isLight ? '#f3f4f7' : '#090a0d',
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
                onError={setPixiError} // Propagate error from Stage to EditorPage
                topToolbarHeight={topToolbarHeight}
                isResizingBottom={isResizingBottom}
                onReady={() => {
                  setIsPixiReady(true)
                  setPixiError(null) // Clear error on successful re-init
                  const app = stageRef.current?.getApp?.()
                  if (app) setPixiApp(app)
                }}
                setStageReady={setIsStageReady} // Pass the setter
                motionCaptureMode={effectiveMotionCaptureMode}
                captureVersion={captureVersion}
                onMotionStateChange={setMotionControls}
                editingStepId={editingStepId}
                editingTextLayerId={editingTextLayerId}
                onTextChange={handleTextChange}
                onFinishEditing={handleFinishEditing}
                onStartTextEditing={startTextEditing}
                totalTime={totalTime}
                showPasteboard={showPasteboard}
              />

              {/* Asset Preloading Overlay — gates on preloading, stage readiness, project data, and min display time */}
              <FullScreenLoading
                progress={progress}
                isPreloading={isPreloading}
                isStageReady={isStageReady}
                projectStatus={projectStatus}
                minTimeElapsed={minTimeElapsed}
                hasAsyncAssets={hasAsyncAssets}
                error={pixiError}
              />



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

          {/* Unified Playback Controls - Full-width bar sitting exactly above the bottom section */}
          {!isMotionCaptureActive && (
            <div
              className={`absolute right-0 z-30 pointer-events-auto items-center justify-center py-1 ${activeBottomMenu ? 'hidden lg:flex' : 'flex'}`}
              style={{
                left: currentSidebarWidth,
                bottom: `${bottomSectionHeight || 140}px`,
                backgroundColor: theme === 'light' ? '#f3f4f7' : '#090a0d',
                borderColor: theme === 'light' ? 'rgba(0, 0, 0, 0.05)' : 'rgba(255, 255, 255, 0.05)',
              }}
            >
              <div className="w-full px-4">
                <PlaybackControls
                  isPlaying={isPlaying}
                  isBuffering={motionControls?.isBuffering || false}
                  currentTime={playheadTime}
                  totalTime={totalTime}
                  shiftLeft={currentSidebarWidth !== '0px'}
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
                  isMotionCaptureActive={isMotionCaptureActive}
                />
              </div>
            </div>
          )}

          {/* Bottom Sections - Overlay at bottom with glass effect */}
          <div
            ref={bottomSectionRef}
            className={`absolute bottom-0 right-0 z-30 flex flex-col pointer-events-auto ${!isResizingBottom ? 'transition-all duration-300' : ''}`}
            style={{
              left: currentSidebarWidth,
              backgroundColor: theme === 'light' ? '#f3f4f7' : '#090a0d',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              borderTop: 'none',
              paddingBottom: 'env(safe-area-inset-bottom, 8px)',
              height: 'auto',
              maxHeight: '40vh',
              transition: isResizingBottom ? 'none' : 'height 0.3s ease'
            }}
          >
            {/* Top border line */}
            <div
              className="absolute top-0 left-0 right-0 h-[1px]"
              style={{
                top: '-1px',
                backgroundColor: theme === 'light' ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.08)'
              }}
            />

            {/* Content Container - Scrollable if content overflows */}
            <div className="flex flex-col flex-1" style={{
              minHeight: 0, // Allow flex item to shrink
              position: 'relative',
              paddingBottom: '0px' // Remove padding to make scenes bar touch bottom
            }}>
              {/* Scrollable Content Area - only playback + scenes; zoom is fixed below */}
              <div className={`flex-col overflow-x-hidden flex-1 scrollbar-hide overflow-y-visible ${activeBottomMenu ? 'hidden lg:flex' : 'flex'}`} style={{
                minHeight: 0
              }}>

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
                    paddingBottom: '12px',
                    paddingTop: '4px',
                    paddingLeft: '20px',
                    paddingRight: '20px',
                    touchAction: 'pan-x',
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
                    onOpenTransitionsPanel={handleOpenTransitionsPanel}
                  />
                </div>
              </div>

              {/* Zoom slider - fixed at bottom, outside scroll; minimal height */}
              {/* Log scale with narrow range (10-200%) and fine step for smooth, controlled feel */}
              <div className="pointer-events-auto flex-shrink-0 hidden lg:flex justify-end items-center gap-2 px-4 py-1" style={{ paddingBottom: 'max(6px, env(safe-area-inset-bottom, 0px))' }}>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={0.1}
                  value={(() => {
                    // Convert zoom (10-200) to slider position (0-100) using log scale
                    const z = zoom === -1 ? 100 : Math.min(200, Math.max(10, zoom))
                    return ((Math.log(z) - Math.log(10)) / (Math.log(200) - Math.log(10))) * 100
                  })()}
                  onChange={(e) => {
                    // Convert slider position (0-100) to zoom (10-200) using exp scale
                    const t = Number(e.target.value) / 100
                    const newZoom = 10 * Math.pow(200 / 10, t)
                    setZoom(Math.max(10, Math.min(200, newZoom)))
                  }}
                  className={`w-28 sm:w-32 lg:w-36 h-1 rounded-full appearance-none ${theme === 'light' ? 'bg-gray-300 [&::-webkit-slider-thumb]:bg-gray-600 [&::-moz-range-thumb]:bg-gray-600' : 'bg-white/20 [&::-webkit-slider-thumb]:bg-white [&::-moz-range-thumb]:bg-white'} [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:transition-transform hover:[&::-webkit-slider-thumb]:scale-110 [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:transition-transform hover:[&::-moz-range-thumb]:scale-110`}
                />
                <span className={`text-[10px] font-mono tabular-nums w-8 ${theme === 'light' ? 'text-gray-500' : 'text-white/60'}`}>
                  {zoom === -1 ? 'Fit' : `${Math.round(zoom)}%`}
                </span>
              </div>

              {/* Mobile Canvas Controls - Fixed at the very bottom on mobile screens */}
              <div className="lg:hidden pointer-events-auto flex-shrink-0 w-full" style={{
                paddingBottom: 'max(6px, env(safe-area-inset-bottom, 6px))'
              }}>
                <CanvasControls
                  duration={`${totalTime.toFixed(1)}s`}
                  selectedLayer={capturedLayer || (selectedLayerIds[0] ? layers[selectedLayerIds[0]] : null)}
                  selectedCanvas={selectedCanvas}
                  currentScene={currentSceneData}
                  editingStepActionCount={editingStepActionCount}
                  onLayerUpdate={(updates) => {
                    if (selectedLayerIds[0]) {
                      const layerId = selectedLayerIds[0]

                      // [MOTION CAPTURE FIX] During capture, we ONLY update the capture session/action.
                      if (isMotionCaptureActive && effectiveMotionCaptureMode?.onPositionUpdate) {
                        if (updates.opacity !== undefined) {
                          const capture = motionCaptureRef.current
                          if (capture && capture.trackedLayers.has(layerId)) {
                            capture.trackedLayers.get(layerId).didFade = true
                          }
                          effectiveMotionCaptureMode.onPositionUpdate({ layerId, opacity: updates.opacity })
                          effectiveMotionCaptureMode.onInteractionEnd(layerId)
                        }
                        if (updates.rotation !== undefined) {
                          const capture = motionCaptureRef.current
                          if (capture && capture.trackedLayers.has(layerId)) {
                            capture.trackedLayers.get(layerId).didRotate = true
                          }
                          effectiveMotionCaptureMode.onPositionUpdate({ layerId, rotation: updates.rotation })
                          effectiveMotionCaptureMode.onInteractionEnd(layerId)
                        }
                        if (updates.blur !== undefined) {
                          const clampedBlur = Math.max(0, Math.min(BLUR_MAX, updates.blur))
                          const capture = motionCaptureRef.current
                          if (capture && capture.trackedLayers.has(layerId)) {
                            const tracked = capture.trackedLayers.get(layerId)
                            tracked.didBlur = true
                          }
                          effectiveMotionCaptureMode.onPositionUpdate({ layerId, blur: clampedBlur })
                          effectiveMotionCaptureMode.onInteractionEnd(layerId)
                        }
                        if (updates.tiltX !== undefined || updates.tiltY !== undefined) {
                          const capture = motionCaptureRef.current
                          if (capture && capture.trackedLayers.has(layerId)) {
                            const tracked = capture.trackedLayers.get(layerId)
                            tracked.didTilt = true
                            if (updates.tiltX !== undefined) tracked.tiltX = updates.tiltX
                            if (updates.tiltY !== undefined) tracked.tiltY = updates.tiltY
                          }
                          effectiveMotionCaptureMode.onPositionUpdate({
                            layerId,
                            tiltX: updates.tiltX,
                            tiltY: updates.tiltY
                          })
                          effectiveMotionCaptureMode.onInteractionEnd(layerId)
                        }
                        const radiusUpdate = updates.cornerRadius !== undefined ? updates.cornerRadius : updates.data?.cornerRadius
                        if (radiusUpdate !== undefined) {
                          const clampedRadius = Math.max(0, Math.min(CORNER_RADIUS_MAX, radiusUpdate))
                          effectiveMotionCaptureMode.onPositionUpdate({ layerId, cornerRadius: clampedRadius })
                          effectiveMotionCaptureMode.onInteractionEnd(layerId)
                        }
                        const newColor = updates.data?.fill || updates.data?.color
                        if (newColor !== undefined) {
                          const capture = motionCaptureRef.current
                          const tracked = capture?.trackedLayers.get(layerId)
                          if (tracked && tracked.color !== newColor) {
                            tracked.didColor = true
                            tracked.color = newColor
                            effectiveMotionCaptureMode.onPositionUpdate({ layerId, color: newColor })
                            effectiveMotionCaptureMode.onInteractionEnd(layerId)
                          }
                        }
                      } else {
                        dispatch(updateLayer({ id: layerId, ...updates }))
                      }
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
                    setActiveSidebarItem('Color')
                  }}
                  onOpenPositionPanel={() => {
                    setActiveSidebarItem(activeSidebarItem === 'Position' ? null : 'Position')
                  }}
                  onToggleMotionPanel={() => {
                    setIsMotionPanelOpen(prev => !prev)
                  }}
                  isMotionCaptureActive={isMotionCaptureActive}
                  onStartMotionCapture={handleStartMotionCapture}
                  onApplyMotion={handleApplyMotion}
                  onCancelMotion={handleCancelMotion}
                  onFlipCardFrame={() => handleFlipForLayer(selectedLayerIds[0])}
                  requestOpenControl={requestOpenControl}
                  stepsCount={currentSceneMotionFlow?.steps?.length || 0}
                  isMobileBottom={true}
                  onSubmenuChange={(menuName) => setActiveBottomMenu(menuName)}
                  showStarterHint={showStarterHint}
                  starterHintText={starterHintText}
                  onHideStarterHint={() => {
                    setShowStarterHint(false)
                    if (isStarterCopy) {
                      localStorage.setItem(`vevara_starter_autoplay_done_${urlProjectId || projectId}`, 'true')
                    }
                  }}
                />
              </div>
            </div>

          </div>
        </div>

        {/* Motion Panel - Right side overlay */}
        <MotionPanel
          isOpen={isMotionPanelOpen}
          onClose={() => setIsMotionPanelOpen(false)}
          topToolbarHeight={topToolbarHeight}
          motionControls={motionControls}
          onStepEdit={handleEditStep}
          onApplyMotion={handleApplyMotion}
          onCancelMotion={handleCancelMotion}
          onStartMotionCapture={handleStartMotionCapture}
          onAddAnimation={handleAddAnimation}
          onDeleteCaptureAction={handleDeleteCaptureAction}
          sceneLayers={sceneLayersForMotion}
          selectedLayerIds={selectedLayerIds}
          isMotionCaptureActive={isMotionCaptureActive}
          editingStepId={editingStepId}
        />


        {/* Project Status Loading Modal */}
        <Modal
          isOpen={isSaving || isNavigating}
          showCloseButton={false}
          maxWidth="max-w-[280px]"
          className={`${isLight ? 'border-black/5 shadow-[0_0_50px_-12px_rgba(0,0,0,0.1)]' : 'border-white/5 shadow-[0_0_50px_-12px_rgba(0,0,0,0.5)]'}`}
        >
          <div className="flex flex-col items-center justify-center py-4 gap-4">
            <div className="relative">
              <div className={`absolute inset-0 blur-xl rounded-full scale-150 animate-pulse ${isLight ? 'bg-blue-500/10' : 'bg-blue-500/20'}`} />
              <Loader2 className="w-10 h-10 text-blue-400 animate-spin relative z-10" strokeWidth={1.5} />
            </div>
            <div className="flex flex-col items-center gap-1 text-center">
              <h3 className={`font-medium text-[15px] tracking-tight ${isLight ? 'text-gray-900' : 'text-white'}`}>
                {isNavigating ? 'Returning to Dashboard' : 'Saving Project'}
              </h3>
              <p className={`${isLight ? 'text-gray-500' : 'text-white/40'} text-[12px]`}>
                {isNavigating ? 'Finalizing your profile sync...' : 'Please wait a moment...'}
              </p>
            </div>
          </div>
        </Modal>
        <TutorialOverlay
          isPlaying={isPlaying}
          manualTargetRect={manualTutorialRect}
          onNext={() => dispatch(nextStep())}
        />
        <TutorialExportModal
          isOpen={tutorialActive && tutorialStep === 7}
          onClose={() => dispatch(endTutorial())}
          onExport={(res) => {
            handleExport(res);
            dispatch(nextStep()); // Finish tutorial
          }}
        />
        <TutorialExportModal
          isOpen={gifExportModalOpen}
          initialFormat="gif"
          onClose={() => setGifExportModalOpen(false)}
          onExport={(res) => {
            setGifExportModalOpen(false);
            handleExport(res);
          }}
        />
        {(autoPlayState === 'initial' || autoPlayState === 'final' || autoPlayState === 'pending_final' || (tutorialActive && tutorialStep === 3 && isInteractionLocked)) && !isStarterCopy && (
          <div
            className={`fixed inset-0 z-[999998] ${isLight ? 'bg-white' : 'bg-black'}`}
            style={{
              clipPath: `polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%, ${currentSidebarWidth} 72px, ${currentSidebarWidth} calc(100% - (${initialBottomHeight}px + 48px)), 100% calc(100% - (${initialBottomHeight}px + 48px)), 100% 72px, ${currentSidebarWidth} 72px)`,
              WebkitClipPath: `polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%, ${currentSidebarWidth} 72px, ${currentSidebarWidth} calc(100% - (${initialBottomHeight}px + 48px)), 100% calc(100% - (${initialBottomHeight}px + 48px)), 100% 72px, ${currentSidebarWidth} 72px)`
            }}
          />
        )}
        {isInteractionLocked && (
          <div className="fixed inset-0 z-[999999]" style={{ cursor: 'default' }} />
        )}
      </div>
    </ThemeContext.Provider>
  )
}

export default function EditorPageWrapper(props) {
  return (
    <ErrorBoundary>
      <EditorPage {...props} />
    </ErrorBoundary>
  )
}
