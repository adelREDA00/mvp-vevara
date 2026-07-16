import { useState, useRef, useEffect, useContext, useCallback } from 'react'
import { useSelector, useDispatch } from 'react-redux'
import { gsap } from 'gsap'
import * as Slider from '@radix-ui/react-slider'
import { ThemeContext } from '../../../app/context/ThemeContext'
import { selectTutorialState } from '../../../store/slices/tutorialSlice'
import { BLUR_MAX } from '../../engine/motion/blurConstants.js'
import { PRESET_REGISTRY, getPresetGroups } from '../../engine/motion/presets.js'
import { getContrastCardBg } from '../utils/contrast'
import PresetPreviewCard from './PresetPreviewCard'
import AdvancedColorPickerModal from './AdvancedColorPickerModal'
import {
  Move, RotateCw, Maximize2, Eye, X, Crop, FlipHorizontal2,
  ChevronDown, ChevronUp, Droplets, Palette, Film, Type, Rotate3d,
  ArrowLeft, ArrowRight, ArrowUp, ArrowDown, ChevronRight, ChevronLeft, Zap,
  Pencil, Trash2, Plus,
} from 'lucide-react'

const CornerRadiusIcon = (props) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M21 4H11C7.13401 4 4 7.13401 4 11V21" />
  </svg>
)

import { LAYER_TYPES } from '../../../store/models'
import {
  selectSceneMotionFlow, deleteSceneMotionAction,
  selectCurrentSceneId, selectLayers, applyPresetToStep, clearPresetFromStep,
} from '../../../store/slices/projectSlice'
import { setSelectedLayer } from '../../../store/slices/selectionSlice'
import { getGlobalMotionEngine } from '../../engine/motion'
import { syncTiltedDisplay } from '../../engine/pixi/perspectiveTilt.js'
import * as PIXI from 'pixi.js'

const DEFAULT_MOTION_FLOW = { steps: [], pageDuration: 5000 }

const actionTypes = [
  { id: 'move', label: 'Move', icon: Move },
  { id: 'rotate', label: 'Rotate', icon: RotateCw },
  { id: 'scale', label: 'Scale', icon: Maximize2 },
  { id: 'crop', label: 'Crop', icon: Crop },
  { id: 'fade', label: 'Fade', icon: Eye },
  { id: 'flip', label: 'Flip', icon: FlipHorizontal2 },
  { id: 'colorChange', label: 'Color', icon: Palette },
  { id: 'blur', label: 'Blur', icon: Droplets },
  { id: 'cornerRadius', label: 'Radius', icon: CornerRadiusIcon },
  { id: 'typewriter', label: 'Typewriter', icon: Type },
  { id: 'tilt', label: '3D Tilt', icon: Rotate3d },
]

// ─────────────────────────────────────────────────────────────────────────────
// PRESET GROUPING LOGIC
//
// Presets with direction variants (slide_in_left/right/top/bottom etc.) are
// collapsed into a single representative card. When that card is selected the
// inline expanded row lets the user pick IN/OUT and the direction.
//
// A "preset family" is a group of presets that share the same base name but
// differ only in direction. We define families explicitly so the grid shows one
// card per family.
// ─────────────────────────────────────────────────────────────────────────────

// Direction arrows represent the element's DIRECTION OF TRAVEL, so the glyph flips
// between entrance and exit:
//   IN  — element travels from the named side toward center (e.g. 'bottom' rises → ↑)
//   OUT — element travels toward the named side          (e.g. 'bottom' exits down → ↓)
const DIRECTION_ICONS_IN = {
  left: ArrowRight,
  right: ArrowLeft,
  top: ArrowDown,
  bottom: ArrowUp,
}
const DIRECTION_ICONS_OUT = {
  left: ArrowLeft,
  right: ArrowRight,
  top: ArrowUp,
  bottom: ArrowDown,
}
const getDirectionIcon = (direction, mode) =>
  (mode === 'OUT' ? DIRECTION_ICONS_OUT : DIRECTION_ICONS_IN)[direction]

// Each family entry:
//   representativeId  – the preset shown as the card (first direction by default)
//   inIds             – [presetId, direction] pairs for IN variants
//   outIds            – [presetId, direction] pairs for OUT variants
//   hasDirections     – whether to show direction arrows in the expanded row
const PRESET_FAMILIES = [
  // ── FADE ────────────────────────────────────────────────────────────────────
  {
    familyKey: 'fade',
    label: 'Fade',
    inIds: [{ id: 'fade_in', direction: null }],
    outIds: [{ id: 'fade_out', direction: null }],
    hasDirections: false,
  },
  // ── SLIDE ───────────────────────────────────────────────────────────────────
  {
    familyKey: 'slide',
    label: 'Slide',
    inIds: [
      { id: 'slide_in_left', direction: 'left' },
      { id: 'slide_in_right', direction: 'right' },
      { id: 'slide_in_top', direction: 'top' },
      { id: 'slide_in_bottom', direction: 'bottom' },
    ],
    outIds: [
      { id: 'slide_out_left', direction: 'left' },
      { id: 'slide_out_right', direction: 'right' },
      { id: 'slide_out_top', direction: 'top' },
      { id: 'slide_out_bottom', direction: 'bottom' },
    ],
    hasDirections: true,
  },
  // ── SCALE ───────────────────────────────────────────────────────────────────
  {
    familyKey: 'grow',
    label: 'Grow',
    inIds: [{ id: 'grow_in', direction: null }],
    outIds: [{ id: 'grow_out', direction: null }],
    hasDirections: false,
  },
  {
    familyKey: 'shrink',
    label: 'Shrink',
    inIds: [{ id: 'shrink_in', direction: null }],
    outIds: [{ id: 'shrink_out', direction: null }],
    hasDirections: false,
  },
  // ── ROTATION ────────────────────────────────────────────────────────────────
  {
    familyKey: 'spin',
    label: 'Spin',
    inIds: [{ id: 'spin_in', direction: null }],
    outIds: [{ id: 'spin_out', direction: null }],
    hasDirections: false,
  },
  // ── BLUR ────────────────────────────────────────────────────────────────────
  {
    familyKey: 'blur',
    label: 'Blur',
    inIds: [{ id: 'blur_in', direction: null }],
    outIds: [{ id: 'blur_out', direction: null }],
    hasDirections: false,
  },
  {
    familyKey: 'blur_slide',
    label: 'Blur Slide',
    inIds: [
      { id: 'blur_slide_in_left', direction: 'left' },
      { id: 'blur_slide_in_right', direction: 'right' },
      { id: 'blur_slide_in_top', direction: 'top' },
      { id: 'blur_slide_in_bottom', direction: 'bottom' },
    ],
    outIds: [
      { id: 'blur_slide_out_left', direction: 'left' },
      { id: 'blur_slide_out_right', direction: 'right' },
      { id: 'blur_slide_out_top', direction: 'top' },
      { id: 'blur_slide_out_bottom', direction: 'bottom' },
    ],
    hasDirections: true,
  },
  {
    familyKey: 'blur_scale',
    label: 'Blur Scale',
    inIds: [{ id: 'blur_scale_in', direction: null }],
    outIds: [{ id: 'blur_scale_out', direction: null }],
    hasDirections: false,
  },
  // ── TYPEWRITER ───────────────────────────────────────────────────────────────
  // Text-only entrance preset. `layerTypes` gates it to TEXT layers (other
  // families have no `layerTypes` and apply to every layer type).
  {
    familyKey: 'typewriter',
    label: 'Typewriter',
    inIds: [{ id: 'typewriter_in', direction: null }],
    outIds: [],
    hasDirections: false,
    layerTypes: [LAYER_TYPES.TEXT],
  },
]

// Build a reverse lookup: presetId → familyKey
const PRESET_ID_TO_FAMILY = {}
PRESET_FAMILIES.forEach(fam => {
  fam.inIds.forEach(({ id }) => { PRESET_ID_TO_FAMILY[id] = fam.familyKey })
  fam.outIds.forEach(({ id }) => { PRESET_ID_TO_FAMILY[id] = fam.familyKey })
})

const ACTION_AVAILABILITY = {
  [LAYER_TYPES.SHAPE]: ['move', 'rotate', 'scale', 'fade', 'blur', 'colorChange', 'cornerRadius', 'tilt'],
  [LAYER_TYPES.TEXT]: ['move', 'rotate', 'scale', 'fade', 'blur', 'colorChange', 'tilt'],
  [LAYER_TYPES.IMAGE]: ['move', 'rotate', 'scale', 'fade', 'blur', 'crop', 'tilt'],
  [LAYER_TYPES.VIDEO]: ['move', 'rotate', 'scale', 'fade', 'blur', 'crop', 'tilt'],
  [LAYER_TYPES.GROUP]: ['move', 'rotate', 'scale', 'fade', 'blur', 'tilt'],
  frame_normal: ['move', 'rotate', 'scale', 'fade', 'blur', 'crop', 'tilt'],
  frame_card: ['move', 'rotate', 'scale', 'fade', 'blur', 'crop', 'flip', 'tilt'],
  [LAYER_TYPES.BACKGROUND]: ['colorChange'],
}

function getLayerDisplayName(layer) {
  if (!layer) return 'Unknown'
  switch (layer.type) {
    case LAYER_TYPES.IMAGE: return 'Image layer'
    case LAYER_TYPES.VIDEO: return 'Video layer'
    case LAYER_TYPES.SHAPE: return 'Shape layer'
    case LAYER_TYPES.TEXT: return 'Text layer'
    case LAYER_TYPES.GROUP: return 'Group'
    case LAYER_TYPES.BACKGROUND: return 'Background'
    case LAYER_TYPES.FRAME: return layer.data?.isCardFrame ? 'Card Frame' : 'Frame'
    default: return 'Element'
  }
}

function getTextFontSize(text) {
  const len = (text || '').length
  if (len <= 5) return '13px'
  if (len <= 12) return '11px'
  if (len <= 22) return '9px'
  if (len <= 40) return '7.5px'
  return '6px'
}

function getInheritedStepValues(motionFlow, editingStepId, selectedLayerId, previewLayer) {
  const state = {
    opacity: previewLayer?.opacity ?? 1,
    blur: previewLayer?.blur ?? 0,
    cornerRadius: previewLayer?.data?.cornerRadius ?? 0,
    tiltX: previewLayer?.tiltX ?? 0,
    tiltY: previewLayer?.tiltY ?? 0,
    color: previewLayer?.data?.fill ?? previewLayer?.data?.color ?? null,
  }

  if (!motionFlow || !editingStepId || !selectedLayerId) return state

  const editingStepIndex = motionFlow.findIndex(s => s.id === editingStepId)
  if (editingStepIndex <= 0) return state

  for (let i = 0; i < editingStepIndex; i++) {
    const step = motionFlow[i]
    const stepLayerActions = step.layerActions?.[selectedLayerId] || []
    const stepPreset = step.layerPresets?.[selectedLayerId]

    let resolvedActions = [...stepLayerActions]
    if (stepPreset && PRESET_REGISTRY[stepPreset.id]) {
      const presetActions = PRESET_REGISTRY[stepPreset.id].getActions(state, step.duration || 2000)
      const customByType = new Map()
      stepLayerActions.forEach(a => { if (a) customByType.set(a.type, a) })

      const composedActions = presetActions.map(pAction => {
        const custom = customByType.get(pAction.type)
        if (!custom) return pAction
        return {
          ...pAction,
          values: { ...pAction.values, ...custom.values }
        }
      })

      const presetTypes = new Set(presetActions.map(p => p.type))
      const remainingCustom = stepLayerActions.filter(a => !presetTypes.has(a.type))
      resolvedActions = [...composedActions, ...remainingCustom]
    }

    resolvedActions.forEach(action => {
      const v = action.values || {}
      if (action.type === 'fade' && v.opacity !== undefined) {
        state.opacity = v.opacity
      } else if (action.type === 'blur' && v.blur !== undefined) {
        state.blur = v.blur
      } else if (action.type === 'cornerRadius' && v.cornerRadius !== undefined) {
        state.cornerRadius = v.cornerRadius
      } else if (action.type === 'tilt') {
        if (v.tiltX !== undefined) state.tiltX = v.tiltX
        if (v.tiltY !== undefined) state.tiltY = v.tiltY
      } else if (action.type === 'colorChange' && v.color !== undefined) {
        state.color = v.color
      }
    })
  }

  return state
}

// ─────────────────────────────────────────────────────────────────────────────

function MotionPanel({
  isOpen = false,
  onClose,
  isCollapsed = false,
  onToggleCollapsed,
  topToolbarHeight = 0,
  bottomSectionHeight = 140,
  onApplyMotion,
  onCancelMotion,
  onStartMotionCapture,
  onAddAnimation,
  onCustomActionValueChange,
  onStepEdit,
  onDeleteStep,
  sceneLayers = [],
  selectedLayerIds = [],
  motionControls = null,
  isMotionCaptureActive,
  editingStepId,
  onDeleteCaptureAction,
  editingStepActionCount = 0,
  activeStepId = null,
  onMobileMinimizedChange = null,
  onSelectStepEnd = null,
  isMobileMinimizedProp = false,
}) {
  const dispatch = useDispatch()
  const [showAdvancedPicker, setShowAdvancedPicker] = useState(false)
  const customColorButtonRef = useRef(null)
  const currentSceneId = useSelector(selectCurrentSceneId)
  const layers = useSelector(selectLayers)
  const tutorialState = useSelector(selectTutorialState)
  const isTutorialStep1 = tutorialState?.active && tutorialState?.step === 1;
  const isTutorialStep4 = tutorialState?.active && tutorialState?.step === 4;

  const motionFlowData = useSelector((state) =>
    currentSceneId ? selectSceneMotionFlow(state, currentSceneId) : DEFAULT_MOTION_FLOW
  )
  const motionFlow = motionFlowData.steps || []

  const PANEL_WIDTH = 300
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 1024)
  const { theme } = useContext(ThemeContext)
  const isLight = theme === 'light'

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 1024)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Mobile: minimized state — collapses to small handle bar
  const [isMobileMinimized, setIsMobileMinimized] = useState(isMobileMinimizedProp)

  useEffect(() => {
    setIsMobileMinimized(isMobileMinimizedProp)
  }, [isMobileMinimizedProp])

  useEffect(() => {
    if (isMobile && isMotionCaptureActive) {
      if (tutorialState?.active) {
        setIsMobileMinimized(false) // Auto-expand when capture starts on mobile only during onboarding tutorial
      }
    }
  }, [isMobile, isMotionCaptureActive, tutorialState?.active])

  useEffect(() => {
    onMobileMinimizedChange?.(isMobileMinimized)
  }, [isMobileMinimized, onMobileMinimizedChange])

  // Animate panel in/out on desktop collapse toggle
  useEffect(() => {
    if (prevIsCollapsedRef.current === isCollapsed) return
    prevIsCollapsedRef.current = isCollapsed
    if (!isCollapsed && !isMobile && panelRef.current) {
      gsap.killTweensOf(panelRef.current)
      panelRef.current.style.transition = 'none'
      gsap.fromTo(panelRef.current, { x: PANEL_WIDTH }, { x: 0, duration: 0.18, ease: 'power1.out', onComplete: () => { if (panelRef.current) panelRef.current.style.transition = '' } })
    }
    if (isCollapsed && !isMobile) {
      requestAnimationFrame(() => {
        if (collapsedOuterRef.current) {
          gsap.killTweensOf(collapsedOuterRef.current)
          gsap.fromTo(collapsedOuterRef.current, { x: 48 }, { x: 0, duration: 0.18, ease: 'power1.out' })
        }
      })
    }
  }, [isCollapsed, isMobile, PANEL_WIDTH])

  // Animate panel in on mobile expand from minimized
  useEffect(() => {
    if (prevIsMobileMinimizedRef.current === isMobileMinimized) return
    prevIsMobileMinimizedRef.current = isMobileMinimized
    if (!isMobileMinimized && isMobile && panelRef.current) {
      gsap.killTweensOf(panelRef.current)
      panelRef.current.style.transition = 'none'
      gsap.fromTo(panelRef.current, { y: '100%' }, { y: 0, duration: 0.22, ease: 'power2.out', onComplete: () => { if (panelRef.current) panelRef.current.style.transition = '' } })
    }
  }, [isMobileMinimized, isMobile])

  // Animate panel in when motion capture first starts on mobile (mirrors the close animation)
  useEffect(() => {
    if (!isMobile) return
    if (!prevCaptureActiveRef.current && isMotionCaptureActive) {
      requestAnimationFrame(() => {
        if (panelRef.current) {
          gsap.killTweensOf(panelRef.current)
          panelRef.current.style.transition = 'none'
          gsap.fromTo(panelRef.current, { y: '100%' }, { y: 0, duration: 0.22, ease: 'power2.out', onComplete: () => { if (panelRef.current) panelRef.current.style.transition = '' } })
        }
      })
    }
    prevCaptureActiveRef.current = isMotionCaptureActive
  }, [isMobile, isMotionCaptureActive])

  // Handlers for animated collapse/minimize (reset view state before animating)
  const handleCollapseWithAnimation = useCallback(() => {
    if (panelRef.current) {
      gsap.killTweensOf(panelRef.current)
      panelRef.current.style.transition = 'none'
      gsap.to(panelRef.current, {
        x: PANEL_WIDTH, duration: 0.18, ease: 'power1.in',
        onComplete: () => {
          if (panelRef.current) panelRef.current.style.transition = ''
          setMotionModeState('list')
          setSelectedLayerId(null)
          setExpandedFamilyKey(null)
          dispatch(setSelectedLayer(null))
          onToggleCollapsed?.()
        }
      })
    } else {
      setMotionModeState('list')
      setSelectedLayerId(null)
      setExpandedFamilyKey(null)
      dispatch(setSelectedLayer(null))
      onToggleCollapsed?.()
    }
  }, [onToggleCollapsed, PANEL_WIDTH, dispatch])

  const handleMobileMinimize = useCallback(() => {
    if (panelRef.current) {
      gsap.killTweensOf(panelRef.current)
      panelRef.current.style.transition = 'none'
      gsap.to(panelRef.current, {
        y: '100%', duration: 0.22, ease: 'power2.in',
        onComplete: () => {
          if (panelRef.current) panelRef.current.style.transition = ''
          setMotionModeState('list')
          setSelectedLayerId(null)
          setExpandedFamilyKey(null)
          dispatch(setSelectedLayer(null))
          setIsMobileMinimized(true)
        }
      })
    } else {
      setMotionModeState('list')
      setSelectedLayerId(null)
      setExpandedFamilyKey(null)
      dispatch(setSelectedLayer(null))
      setIsMobileMinimized(true)
    }
  }, [dispatch])

  const handleExpandFromCollapsed = useCallback(() => {
    if (collapsedOuterRef.current) {
      gsap.killTweensOf(collapsedOuterRef.current)
      gsap.to(collapsedOuterRef.current, { x: 48, duration: 0.22, ease: 'power2.in', onComplete: () => onToggleCollapsed?.() })
    } else {
      onToggleCollapsed?.()
    }
  }, [onToggleCollapsed])

  // Normal mode: which moment card is expanded (one at a time)
  const [expandedStepId, setExpandedStepId] = useState(null)

  // Auto-close moment card if it is no longer the active one
  useEffect(() => {
    if (expandedStepId && expandedStepId !== activeStepId) {
      setExpandedStepId(null)
    }
  }, [activeStepId, expandedStepId])

  // Inline delete confirmation
  const [confirmDeleteStepId, setConfirmDeleteStepId] = useState(null)

  // Motion mode
  const [motionModeState, setMotionModeState] = useState('list') // 'list' | 'element'
  const [selectedLayerId, setSelectedLayerId] = useState(null)
  const [activeTab, setActiveTab] = useState('presets')
  // Which family card is expanded in the presets tab
  const [expandedFamilyKey, setExpandedFamilyKey] = useState(null)
  // Per-family selected direction — { [familyKey]: 'left'|'right'|'top'|'bottom'|null }
  const [familyDirections, setFamilyDirections] = useState({})
  // Per-family selected mode — { [familyKey]: 'IN'|'OUT' }
  const [familyModes, setFamilyModes] = useState({})
  // Which custom-action row has its inline settings panel expanded (Custom tab)
  const [expandedActionType, setExpandedActionType] = useState(null)

  // Reset motion state when tutorial ends — ensure no onboarding-specific logic lingers.
  // Only fires on the active→inactive transition so authenticated users are never affected.
  const wasTutorialActive = useRef(false)
  useEffect(() => {
    if (wasTutorialActive.current && !tutorialState.active) {
      setMotionModeState('list')
      setSelectedLayerId(null)
      setActiveTab('presets')
      setExpandedFamilyKey(null)
      setFamilyDirections({})
      setFamilyModes({})
      setExpandedActionType(null)
    }
    wasTutorialActive.current = tutorialState.active
  }, [tutorialState.active])

  // Reset motion state when capture starts/stops
  useEffect(() => {
    if (!isMotionCaptureActive) {
      setMotionModeState('list')
      setSelectedLayerId(null)
      setActiveTab('presets')
      setExpandedFamilyKey(null)
      setFamilyDirections({})
      setFamilyModes({})
      setExpandedActionType(null)
    }
  }, [isMotionCaptureActive])

  // Collapse any open inline settings row when the selected element changes
  useEffect(() => { setExpandedActionType(null) }, [selectedLayerId])

  const scrollContainerRef = useRef(null)
  const cardRefs = useRef({})
  const collapsedScrollRef = useRef(null)
  const collapsedOuterRef = useRef(null)
  const panelRef = useRef(null)
  const prevIsCollapsedRef = useRef(isCollapsed)
  const prevIsMobileMinimizedRef = useRef(isMobileMinimized)
  const prevCaptureActiveRef = useRef(false)
  const previewingObjectRef = useRef(null)

  const cancelAndRestoreActivePreview = useCallback((pixiObj) => {
    if (!pixiObj || pixiObj.destroyed) return
    if (pixiObj._previewTimeline) {
      try { pixiObj._previewTimeline.kill() } catch { }
      pixiObj._previewTimeline = null
    }
    if (pixiObj._isPlayingPresetPreview) {
      pixiObj._isPlayingPresetPreview = false
      const snap = pixiObj._originalPreviewSnap
      if (snap) {
        pixiObj.x = snap.x
        pixiObj.y = snap.y
        pixiObj.alpha = snap.alpha
        pixiObj.rotation = snap.rotation
        if (pixiObj.scale) pixiObj.scale.set(snap.scaleX, snap.scaleY)
        if (pixiObj.revealProgress !== undefined && snap.revealProgress !== undefined) {
          pixiObj.revealProgress = snap.revealProgress
        }
        if (pixiObj._blurFilter) {
          pixiObj._blurFilter.strength = snap.blurStrength
          const has = pixiObj.filters?.includes(pixiObj._blurFilter)
          if (snap.hadBlurFilter && !has) {
            pixiObj.filters = pixiObj.filters ? [...pixiObj.filters, pixiObj._blurFilter] : [pixiObj._blurFilter]
          } else if (!snap.hadBlurFilter && has) {
            pixiObj.filters = pixiObj.filters.filter(f => f !== pixiObj._blurFilter)
            if (!pixiObj.filters.length) pixiObj.filters = null
          }
        }
        if (snap.intendedAlpha !== undefined) {
          pixiObj._intendedAlpha = snap.intendedAlpha
        }
        if (pixiObj._tiltMesh) {
          syncTiltedDisplay(pixiObj)
        }
        pixiObj._originalPreviewSnap = null
      }
    }
  }, [])

  // Cleanup active preview on unmount or selection/state changes
  useEffect(() => {
    return () => {
      if (previewingObjectRef.current) {
        cancelAndRestoreActivePreview(previewingObjectRef.current)
        previewingObjectRef.current = null
      }
    }
  }, [selectedLayerId, editingStepId, isMotionCaptureActive, currentSceneId, cancelAndRestoreActivePreview])

  useEffect(() => {
    const el = collapsedOuterRef.current
    if (!el) return
    const handleWheel = (e) => {
      if (!collapsedScrollRef.current) return
      e.preventDefault()
      e.stopPropagation()
      collapsedScrollRef.current.scrollTop += e.deltaY
    }
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [isCollapsed, isMobile])

  useEffect(() => {
    if (activeStepId && cardRefs.current[activeStepId]) {
      cardRefs.current[activeStepId].scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [activeStepId])

  useEffect(() => {
    if (isMobile && (expandedFamilyKey || expandedActionType) && scrollContainerRef.current) {
      setTimeout(() => {
        scrollContainerRef.current.scrollTo({
          top: scrollContainerRef.current.scrollHeight,
          behavior: 'smooth'
        })
      }, 120)
    }
  }, [expandedFamilyKey, expandedActionType, isMobile])

  // Canvas selection → go directly to element view
  useEffect(() => {
    if (isMotionCaptureActive && selectedLayerIds && selectedLayerIds.length > 0) {
      const firstLayerId = selectedLayerIds[0]
      if (sceneLayers.some(l => l.id === firstLayerId)) {
        setSelectedLayerId(firstLayerId)
        setMotionModeState('element')
      }
    }
  }, [selectedLayerIds, isMotionCaptureActive, sceneLayers])

  // The step currently being edited
  const step = isMotionCaptureActive && editingStepId ? motionFlow.find(s => s.id === editingStepId) : null
  const layerActions = step?.layerActions?.[selectedLayerId] || []
  const actionsCount = layerActions.length

  // Auto-switch to Custom tab when a canvas action is added
  const prevActionsCountRef = useRef(actionsCount)
  const prevLayerIdRef = useRef(selectedLayerId)
  useEffect(() => {
    if (selectedLayerId && isMotionCaptureActive) {
      if (prevLayerIdRef.current !== selectedLayerId) {
        prevLayerIdRef.current = selectedLayerId
        prevActionsCountRef.current = actionsCount
        setActiveTab('presets') // Default to preset tab on layer selection change
        return
      }
      if (actionsCount > prevActionsCountRef.current) setActiveTab('custom')
      prevActionsCountRef.current = actionsCount
    }
  }, [actionsCount, selectedLayerId, isMotionCaptureActive])

  // On mobile, only render during motion capture (MobileMotionBar handles normal mode)
  if (!currentSceneId || (isMobile && !isMotionCaptureActive)) return null

  // Mobile: minimized state — compact 40px horizontal bar matching Canvas Control height
  if (isMobile && isMobileMinimized) {
    return (
      <div
        className="fixed bottom-0 left-0 right-0 flex items-center"
        style={{
          height: 40,
          zIndex: 61,
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          backgroundColor: isLight ? 'rgba(255,255,255,0.97)' : 'rgba(15,16,21,0.97)',
          borderTop: `1px solid ${isLight ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.08)'}`,
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
        }}
      >
        <div
          className="flex items-center gap-2 px-3 overflow-x-auto flex-1 min-w-0 h-full"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
          onClick={() => setIsMobileMinimized(false)}
        >
          <span className={`text-[11px] font-semibold shrink-0 ${isLight ? 'text-slate-500' : 'text-zinc-400'}`}>
            Select element
          </span>
          <div className={`w-px h-3.5 shrink-0 ${isLight ? 'bg-slate-200' : 'bg-zinc-700'}`} />
          {sceneLayers.slice(0, 10).map(layer => {
            const isText = layer.type === LAYER_TYPES.TEXT
            const isVideo = layer.type === LAYER_TYPES.VIDEO
            const isShape = layer.type === LAYER_TYPES.SHAPE
            const fill = layer.data?.fill
            const thumb = layer.data?.thumbnail
            const url = layer.data?.url || layer.data?.src
            const textContent = layer.data?.content || ''
            const textColor = layer.data?.color
            return (
              <button
                key={layer.id}
                onClick={(e) => {
                  e.stopPropagation()
                  setSelectedLayerId(layer.id)
                  setMotionModeState('element')
                  dispatch(setSelectedLayer(layer.id))
                  setIsMobileMinimized(false)
                }}
                className={`w-6 h-6 rounded shrink-0 flex items-center justify-center overflow-hidden ${isLight ? 'bg-slate-100' : 'bg-zinc-800'
                  }`}
                style={(isShape || (!isText && !isVideo)) && fill ? { backgroundColor: fill } : undefined}
              >
                {thumb ? (
                  <img src={thumb} alt="" className="w-full h-full object-cover" />
                ) : url && !isVideo ? (
                  <img src={url} alt="" className="w-full h-full object-cover" />
                ) : isText ? (
                  <span style={{ fontSize: 7, color: textColor || (isLight ? '#374151' : '#d4d4d8'), fontWeight: 700, lineHeight: 1 }}>
                    {textContent ? textContent.slice(0, 2) : 'T'}
                  </span>
                ) : isVideo ? (
                  <Film className={`h-3 w-3 ${isLight ? 'text-slate-500' : 'text-zinc-400'}`} />
                ) : null}
              </button>
            )
          })}
        </div>
        <button
          onClick={() => setIsMobileMinimized(false)}
          className={`shrink-0 h-10 w-10 flex items-center justify-center ${isLight ? 'text-slate-400 hover:text-slate-600' : 'text-zinc-500 hover:text-zinc-300'}`}
        >
          <ChevronUp className="h-4 w-4" strokeWidth={2} />
        </button>
      </div>
    )
  }

  // ============================================================================
  // HANDLERS
  // ============================================================================

  const handleDeleteAction = (stepId, layerId, actionId, actionType) => {
    if (!currentSceneId) return
    dispatch(deleteSceneMotionAction({ sceneId: currentSceneId, stepId, layerId, actionId }))
    if (isMotionCaptureActive && onDeleteCaptureAction) onDeleteCaptureAction(stepId, layerId, actionType)
  }

  const playPresetPreview = (pixiObject, presetId, cleanState) => {
    if (!pixiObject || pixiObject.destroyed) return
    const presetDef = PRESET_REGISTRY[presetId]
    if (!presetDef) return

    // If another layer has a preview running, cancel and restore it first
    if (previewingObjectRef.current && previewingObjectRef.current !== pixiObject) {
      cancelAndRestoreActivePreview(previewingObjectRef.current)
    }
    previewingObjectRef.current = pixiObject

    if (pixiObject._previewTimeline) {
      try { pixiObject._previewTimeline.kill() } catch { }
      pixiObject._previewTimeline = null
    }
    const previewEngine = getGlobalMotionEngine()
    gsap.killTweensOf(previewEngine.masterTimeline, { time: true })
    previewEngine.masterTimeline.pause()

    // If we're already playing a preview, we reuse the existing original snap
    const snap = pixiObject._originalPreviewSnap || {
      x: pixiObject.x, y: pixiObject.y, alpha: pixiObject.alpha, rotation: pixiObject.rotation,
      scaleX: pixiObject.scale?.x ?? 1, scaleY: pixiObject.scale?.y ?? 1,
      blurStrength: pixiObject._blurFilter?.strength ?? 0,
      hadBlurFilter: !!(pixiObject.filters && pixiObject._blurFilter && pixiObject.filters.includes(pixiObject._blurFilter)),
      revealProgress: pixiObject.revealProgress ?? 1,
      intendedAlpha: pixiObject._intendedAlpha,
    }

    if (!pixiObject._originalPreviewSnap) {
      pixiObject._originalPreviewSnap = snap
    }

    pixiObject._isPlayingPresetPreview = true
    const duration = 1.0, ease = 'power2.out'
    pixiObject.x = cleanState.x; pixiObject.y = cleanState.y
    if (pixiObject._tiltHidden) {
      pixiObject.alpha = 0.000001
      pixiObject._intendedAlpha = cleanState.alpha
    } else {
      pixiObject.alpha = cleanState.alpha
    }
    pixiObject.rotation = cleanState.rotation
    if (pixiObject.scale) pixiObject.scale.set(cleanState.scaleX, cleanState.scaleY)
    if (pixiObject._blurFilter) {
      pixiObject._blurFilter.strength = 0
      if (pixiObject.filters?.includes(pixiObject._blurFilter)) {
        pixiObject.filters = pixiObject.filters.filter(f => f !== pixiObject._blurFilter)
        if (!pixiObject.filters.length) pixiObject.filters = null
      }
    }

    const actions = presetDef.getActions({ ...cleanState, opacity: cleanState.alpha }, duration * 1000)
    const mainTween = {}, mainFrom = {}
    let scaleTween = null, blurTween = null, hasTypewriter = false
    actions.forEach(a => {
      if (a.type === 'typewriter') {
        hasTypewriter = true
      } else if (a.type === 'fade') {
        if (a.startOffset?.opacity !== undefined) mainFrom.alpha = a.startOffset.opacity
        if (a.values?.opacity !== undefined) mainTween.alpha = a.values.opacity
      } else if (a.type === 'move') {
        if (a.startOffset?.x !== undefined) mainFrom.x = cleanState.x + a.startOffset.x
        if (a.startOffset?.y !== undefined) mainFrom.y = cleanState.y + a.startOffset.y
        if (a.values?.dx) mainTween.x = (mainFrom.x ?? cleanState.x) + a.values.dx
        if (a.values?.dy) mainTween.y = (mainFrom.y ?? cleanState.y) + a.values.dy
      } else if (a.type === 'scale') {
        const fx = a.startOffset?.scaleX !== undefined ? cleanState.scaleX * a.startOffset.scaleX : cleanState.scaleX
        const fy = a.startOffset?.scaleY !== undefined ? cleanState.scaleY * a.startOffset.scaleY : cleanState.scaleY
        scaleTween = { fromX: fx, fromY: fy, toX: fx * (a.values?.dsx ?? 1), toY: fy * (a.values?.dsy ?? 1) }
      } else if (a.type === 'rotate') {
        if (a.startOffset?.rotation !== undefined) mainFrom.rotation = cleanState.rotation + a.startOffset.rotation * Math.PI / 180
        if (a.values?.dangle) mainTween.rotation = (mainFrom.rotation ?? cleanState.rotation) + a.values.dangle * Math.PI / 180
      } else if (a.type === 'blur') {
        blurTween = { from: a.startOffset?.blur ?? 0, to: a.values?.blur ?? 0 }
      }
    })

    const hasSpatial = mainTween.x || mainTween.y || scaleTween || mainTween.rotation || blurTween
    if (hasSpatial && mainFrom.alpha !== undefined && mainFrom.alpha < 0.3) mainFrom.alpha = 0.3
    Object.entries(mainFrom).forEach(([k, v]) => { pixiObject[k] = v })
    if (pixiObject.scale) pixiObject.scale.set(scaleTween?.fromX ?? cleanState.scaleX, scaleTween?.fromY ?? cleanState.scaleY)
    if (blurTween) {
      if (!pixiObject._blurFilter) pixiObject._blurFilter = new PIXI.BlurFilter({ strength: 0, quality: 4 })
      pixiObject._blurFilter.strength = blurTween.from
      if (blurTween.from > 0 && !pixiObject.filters?.includes(pixiObject._blurFilter))
        pixiObject.filters = pixiObject.filters ? [...pixiObject.filters, pixiObject._blurFilter] : [pixiObject._blurFilter]
    }

    const restore = () => {
      if (pixiObject.destroyed) return
      pixiObject._isPlayingPresetPreview = false
      pixiObject._previewTimeline = null

      if (previewingObjectRef.current === pixiObject) {
        previewingObjectRef.current = null
      }

      pixiObject.x = snap.x; pixiObject.y = snap.y; pixiObject.alpha = snap.alpha; pixiObject.rotation = snap.rotation
      if (pixiObject.scale) pixiObject.scale.set(snap.scaleX, snap.scaleY)
      if (pixiObject.revealProgress !== undefined && snap.revealProgress !== undefined) {
        pixiObject.revealProgress = snap.revealProgress
      }
      if (pixiObject._blurFilter) {
        pixiObject._blurFilter.strength = snap.blurStrength
        const has = pixiObject.filters?.includes(pixiObject._blurFilter)
        if (snap.hadBlurFilter && !has) pixiObject.filters = pixiObject.filters ? [...pixiObject.filters, pixiObject._blurFilter] : [pixiObject._blurFilter]
        else if (!snap.hadBlurFilter && has) { pixiObject.filters = pixiObject.filters.filter(f => f !== pixiObject._blurFilter); if (!pixiObject.filters.length) pixiObject.filters = null }
      }
      if (snap.intendedAlpha !== undefined) {
        pixiObject._intendedAlpha = snap.intendedAlpha
      }
      if (pixiObject._tiltMesh) {
        syncTiltedDisplay(pixiObject)
      }
      pixiObject._originalPreviewSnap = null
      if (!isMotionCaptureActive) { const eng = getGlobalMotionEngine(); eng.seek(eng.masterTimeline?.time() || 0, { force: true }) }
    }

    const tl = gsap.timeline({
      onUpdate: () => {
        if (pixiObject._tiltMesh) {
          syncTiltedDisplay(pixiObject)
        }
      },
      onComplete: restore
    })
    pixiObject._previewTimeline = tl
    if (pixiObject.scale) tl.to(pixiObject.scale, { x: scaleTween?.toX ?? cleanState.scaleX, y: scaleTween?.toY ?? cleanState.scaleY, duration, ease: scaleTween ? ease : 'none' }, 0)
    if (blurTween) {
      const bp = { value: blurTween.from }
      tl.to(bp, {
        value: blurTween.to, duration, ease, onUpdate: () => {
          if (!pixiObject._blurFilter) return
          pixiObject._blurFilter.strength = bp.value
          if (bp.value > 0.1) { if (!pixiObject.filters?.includes(pixiObject._blurFilter)) pixiObject.filters = pixiObject.filters ? [...pixiObject.filters, pixiObject._blurFilter] : [pixiObject._blurFilter] }
          else { if (pixiObject.filters?.includes(pixiObject._blurFilter)) { pixiObject.filters = pixiObject.filters.filter(f => f !== pixiObject._blurFilter); if (!pixiObject.filters.length) pixiObject.filters = null } }
        }
      }, 0)
    }
    if (Object.keys(mainTween).length) tl.to(pixiObject, { ...mainTween, duration, ease }, 0)
    if (hasTypewriter && pixiObject.revealProgress !== undefined) {
      tl.fromTo(pixiObject, { revealProgress: 0 }, { revealProgress: 1, duration, ease: 'none' }, 0)
    }
  }

  const applyPreset = (presetId, type) => {
    if (!selectedLayerId || !editingStepId || !currentSceneId) return

    const activePreset = step?.layerPresets?.[selectedLayerId]
    if (activePreset?.id === presetId) {
      if (motionControls?.layerObjects) {
        const pixiObj = motionControls.layerObjects.get(selectedLayerId)
        if (pixiObj) {
          cancelAndRestoreActivePreview(pixiObj)
        }
      }
      dispatch(clearPresetFromStep({ sceneId: currentSceneId, stepId: editingStepId, layerId: selectedLayerId }))
      return
    }
    let cleanState = null, pixiObj = null
    if (motionControls?.layerObjects) {
      pixiObj = motionControls.layerObjects.get(selectedLayerId)
      if (pixiObj) {
        const eng = getGlobalMotionEngine()
        gsap.killTweensOf(eng.masterTimeline, { time: true })
        eng.masterTimeline.pause()

        // If a preview is already active, we MUST reuse the existing original preview snap to prevent locking mid-animation values
        const hasSnap = !!pixiObj._originalPreviewSnap
        const snap = pixiObj._originalPreviewSnap

        const currentX = hasSnap ? snap.x : pixiObj.x
        const currentY = hasSnap ? snap.y : pixiObj.y
        const currentAlpha = hasSnap
          ? snap.alpha
          : (pixiObj._tiltHidden && typeof pixiObj._intendedAlpha === 'number'
            ? pixiObj._intendedAlpha
            : (Math.abs(pixiObj.alpha - 0.000001) < 1e-7 ? 1.0 : pixiObj.alpha))
        const currentRotation = hasSnap ? snap.rotation : pixiObj.rotation
        const currentScaleX = hasSnap ? snap.scaleX : (pixiObj.scale?.x ?? 1)
        const currentScaleY = hasSnap ? snap.scaleY : (pixiObj.scale?.y ?? 1)

        cleanState = {
          x: currentX,
          y: currentY,
          alpha: currentAlpha,
          rotation: currentRotation,
          scaleX: currentScaleX,
          scaleY: currentScaleY
        }
      }
    }
    dispatch(applyPresetToStep({ sceneId: currentSceneId, stepId: editingStepId, layerId: selectedLayerId, presetId, presetType: type }))
    if (cleanState && pixiObj) playPresetPreview(pixiObj, presetId, cleanState)
  }

  // ============================================================================
  // RENDER HELPERS
  // ============================================================================

  const getActionMeta = (t) => actionTypes.find(a => a.id === t)

  const renderLayerPreview = (layer) => {
    if (!layer) return null
    if (layer.type === LAYER_TYPES.IMAGE) {
      const src = layer.data?.url || layer.data?.src
      return src ? <img src={src} alt="" className="w-full h-full object-contain" /> : <div className={`w-full h-full rounded ${isLight ? 'bg-slate-200' : 'bg-white/10'}`} />
    }
    if (layer.type === LAYER_TYPES.VIDEO) {
      const thumb = layer.data?.thumbnail
      const url = layer.data?.url || layer.data?.src
      return (
        <div className={`w-full h-full relative overflow-hidden rounded ${isLight ? 'bg-slate-100' : 'bg-zinc-900'}`}>
          {thumb ? <img src={thumb} alt="" className="w-full h-full object-cover" /> : (url ? <video src={url} className="w-full h-full object-cover" preload="metadata" muted playsInline /> : <div className={`w-full h-full ${isLight ? 'bg-slate-100' : 'bg-zinc-900'}`} />)}
          <div className={`absolute inset-0 flex items-center justify-center ${isLight ? 'bg-black/10' : 'bg-black/30'}`}><Film className={`h-3 w-3 ${isLight ? 'text-slate-600' : 'text-white/70'}`} /></div>
        </div>
      )
    }
    if (layer.type === LAYER_TYPES.TEXT) {
      const text = layer.data?.content || ''
      const color = layer.data?.color || (isLight ? '#111827' : '#ffffff')
      return <div className="w-full h-full flex items-center justify-center overflow-hidden rounded"><span style={{ fontSize: getTextFontSize(text), color, lineHeight: 1.2, wordBreak: 'break-all' }} className="text-center font-bold">{text || <span className={`italic ${isLight ? 'text-slate-400' : 'text-white/30'}`}>empty</span>}</span></div>
    }
    if (layer.type === LAYER_TYPES.SHAPE) {
      const fill = layer.data?.fill, shapeType = layer.data?.shapeType || 'rect'
      const fillColor = fill && fill !== 'transparent' ? fill : (isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.18)')
      if (shapeType === 'circle') return <div className="w-full h-full flex items-center justify-center"><div className={`w-6 h-6 rounded-full border ${isLight ? 'border-slate-200' : 'border-white/10'}`} style={{ backgroundColor: fillColor }} /></div>
      if (shapeType === 'triangle') return <div className="w-full h-full flex items-center justify-center"><div className="w-0 h-0" style={{ borderLeft: '10px solid transparent', borderRight: '10px solid transparent', borderBottom: `16px solid ${fillColor}` }} /></div>
      return <div className={`w-full h-full rounded border ${isLight ? 'border-slate-200' : 'border-white/10'}`} style={{ backgroundColor: fillColor }} />
    }
    if (layer.type === LAYER_TYPES.FRAME) {
      const hasFrontAsset = !!layer.data?.assetUrl
      const isCard = !!layer.data?.isCardFrame
      const hasBackAsset = isCard && !!layer.data?.backAssetUrl
      const hasAnyAsset = hasFrontAsset || hasBackAsset

      if (!hasAnyAsset) {
        return (
          <div className={`w-full h-full rounded flex items-center justify-center text-[10px] font-bold tracking-wider uppercase ${isLight ? 'bg-slate-100 border border-slate-200 text-slate-500' : 'bg-white/5 border border-white/10 text-white/40'}`}>
            Frame
          </div>
        )
      }

      const renderSingleFrameAsset = (url, isVideo, sideLabel) => {
        if (!url) {
          return (
            <div className={`w-full h-full flex items-center justify-center text-[8px] font-bold ${isLight ? 'bg-slate-50 text-slate-400' : 'bg-black/10 text-white/20'}`}>
              {sideLabel}
            </div>
          )
        }

        if (isVideo) {
          const thumb = sideLabel === 'Back' ? layer.data?.backThumbnail : layer.data?.thumbnail
          return (
            <div className="w-full h-full relative overflow-hidden bg-black/10">
              {thumb ? (
                <img src={thumb} alt="" className="w-full h-full object-contain" />
              ) : (
                <video src={url} className="w-full h-full object-contain" preload="metadata" muted playsInline />
              )}
              <div className={`absolute inset-0 flex items-center justify-center ${isLight ? 'bg-black/10' : 'bg-black/30'}`}>
                <Film className={`h-3 w-3 ${isLight ? 'text-slate-600' : 'text-white/70'}`} />
              </div>
            </div>
          )
        }

        return (
          <img src={url} alt="" className="w-full h-full object-contain" />
        )
      }

      if (isCard) {
        return (
          <div className={`w-full h-full rounded flex overflow-hidden border ${isLight ? 'border-slate-200 bg-white' : 'border-white/10 bg-white/5'}`}>
            <div className={`w-1/2 h-full border-r ${isLight ? 'border-slate-150' : 'border-white/10'}`}>
              {renderSingleFrameAsset(layer.data.assetUrl, layer.data.assetIsVideo, 'Front')}
            </div>
            <div className="w-1/2 h-full">
              {renderSingleFrameAsset(layer.data.backAssetUrl, layer.data.backAssetIsVideo, 'Back')}
            </div>
          </div>
        )
      }

      return (
        <div className={`w-full h-full rounded overflow-hidden border ${isLight ? 'border-slate-200 bg-white' : 'border-white/10 bg-white/5'}`}>
          {renderSingleFrameAsset(layer.data.assetUrl, layer.data.assetIsVideo, '')}
        </div>
      )
    }
    if (layer.type === LAYER_TYPES.BACKGROUND) {
      const color = typeof layer.data?.color === 'number' ? '#' + layer.data.color.toString(16).padStart(6, '0') : (layer.data?.color || (isLight ? '#ffffff' : '#000000'))
      return <div className="w-full h-full rounded" style={{ backgroundColor: color }} />
    }
    return <div className={`w-full h-full rounded flex items-center justify-center text-[10px] font-bold ${isLight ? 'text-slate-500' : 'text-white/50'}`}>{(layer.type || 'L').charAt(0).toUpperCase()}</div>
  }

  // ============================================================================
  // HEADER
  // ============================================================================
  const renderHeader = () => {
    let title = '', subtitle = '', showBack = false, onBackClick = null
    if (!isMotionCaptureActive) {
      title = 'Moments'
      subtitle = motionFlow.length === 0 ? 'No moments yet' : `${motionFlow.length} moment${motionFlow.length !== 1 ? 's' : ''}`
    } else if (motionModeState === 'list') {
      title = 'Select element'
      subtitle = 'Choose what to animate'
    } else {
      const layer = sceneLayers.find(l => l.id === selectedLayerId)
      title = getLayerDisplayName(layer)
      subtitle = 'Animating'
      showBack = true
      onBackClick = () => { setMotionModeState('list'); setSelectedLayerId(null); setExpandedFamilyKey(null); dispatch(setSelectedLayer(null)) }
    }
    return (
      <div className={`flex items-center justify-between border-b border-black/5 dark:border-white/5 flex-shrink-0 select-none ${isMobile ? 'px-4 py-3.5' : 'px-4 py-4'}`}>
        <div className="flex items-center gap-2.5 min-w-0">
          {showBack && (
            <button onClick={onBackClick} className={`p-1 rounded transition-colors shrink-0 ${isLight ? 'text-slate-500 hover:text-slate-800' : 'text-zinc-400 hover:text-zinc-100'}`}>
              <ArrowLeft className={isMobile ? 'h-4 w-4' : 'h-[18px] w-[18px]'} strokeWidth={2.5} />
            </button>
          )}
          <div className="min-w-0">
            <h2 className={`font-semibold tracking-tight leading-tight truncate ${isMobile ? 'text-[14px]' : 'text-base'} ${isLight ? 'text-gray-900' : 'text-white'}`}>{title}</h2>
            {subtitle && <p className={`mt-0.5 truncate ${isMobile ? 'text-[11px]' : 'text-xs'} ${isLight ? 'text-slate-400' : 'text-zinc-500'}`}>{subtitle}</p>}
          </div>
        </div>
        {/* Mobile: minimize during capture, close otherwise. Desktop: collapse */}
        {isMobile ? (
          <button
            onClick={isMotionCaptureActive ? handleMobileMinimize : onClose}
            className={`p-1 rounded transition-colors shrink-0 ${isLight ? 'text-slate-400 hover:text-slate-700' : 'text-zinc-500 hover:text-zinc-200'}`}
            aria-label={isMotionCaptureActive ? 'Minimize' : 'Close'}
          >
            <ChevronDown className="h-5 w-5 text-zinc-500 dark:text-zinc-400" strokeWidth={2.5} />
          </button>
        ) : (
          <button
            onClick={handleCollapseWithAnimation}
            className={`transition-all duration-300 p-2 rounded-[10px] shrink-0 ${isLight ? 'text-gray-400 hover:text-gray-900 hover:bg-gray-100' : 'text-white/40 hover:text-white hover:bg-white/10'}`}
            aria-label="Collapse"
          >
            <ChevronRight className="h-5 w-5 text-zinc-500 dark:text-zinc-400" strokeWidth={2} />
          </button>
        )}
      </div>
    )
  }

  // ============================================================================
  // NORMAL MODE — VIEW-ONLY MOMENT CARDS
  // ============================================================================
  const renderNormalMode = () => {
    return (
      <div className="flex-1 overflow-y-auto p-3 space-y-2 relative" style={{ scrollBehavior: 'smooth' }}>

        {/* Design Base State Card */}
        <div
          onClick={(e) => {
            e.stopPropagation();
            onSelectStepEnd?.('base');
          }}
          className={`overflow-hidden border-2 rounded-[6px] transition-all duration-150 cursor-pointer ${activeStepId === 'base'
            ? isLight
              ? 'border-transparent bg-[#b0b5be] shadow-sm'
              : 'border-transparent bg-[#3a3b48] shadow-sm'
            : isLight
              ? 'border-transparent bg-[#eaecef] hover:bg-[#b0b5be]'
              : 'border-transparent bg-[#1c1d26] hover:bg-[#3a3b48]'
            }`}
        >
          <div className={`w-full flex items-center justify-between gap-2 ${isMobile ? 'px-3 py-2.5' : 'px-3.5 py-3'}`} style={{ minHeight: 52 }}>
            <div className="min-w-0 flex-1 text-left">
              <h4 className={`font-semibold truncate whitespace-nowrap ${isMobile ? 'text-[12px]' : 'text-sm'} ${isLight ? 'text-[#111827]' : 'text-[#F2F2F2]'
                }`}>
                Design
              </h4>
              <p className={`truncate whitespace-nowrap ${isMobile ? 'text-[10px]' : 'text-xs mt-0.5'} ${isLight ? 'text-[#27303A]' : 'text-[#AEB5C0]'
                }`}>
                Starting point
              </p>
            </div>
          </div>
        </div>

        {motionFlow.map((step, stepIndex) => {
          const isExpanded = expandedStepId === step.id
          const allLayerIds = new Set([...Object.keys(step.layerActions || {}), ...Object.keys(step.layerPresets || {})])
          const layerCount = allLayerIds.size
          const isPlayheadActive = activeStepId === step.id
          const isConfirmingDelete = confirmDeleteStepId === step.id

          return (
            <div key={step.id} ref={el => { if (el) cardRefs.current[step.id] = el }}
              style={{
                pointerEvents: isTutorialStep1 ? 'none' : 'auto',
              }}
              onClick={(e) => {
                const isActionButton = e.target.closest('button');
                if (isActionButton) return;

                onSelectStepEnd?.(step.id);
              }}
              className={`group overflow-hidden border-2 rounded-[6px] transition-all duration-150 cursor-pointer ${isPlayheadActive
                ? isLight
                  ? 'border-transparent bg-[#cab3f8] shadow-sm'
                  : 'border-transparent bg-[#4c3b70] shadow-sm'
                : isLight
                  ? 'border-transparent bg-white text-slate-800 hover:bg-[#cab3f8]'
                  : 'border-transparent bg-[#121319] text-zinc-400 hover:bg-[#3b3847]'
                }`}>
              {/* Delete confirmation — consistent min-height, no layout shift */}
              {isConfirmingDelete ? (
                <div className="flex w-full overflow-hidden" style={{ minHeight: 52 }}>
                  <button
                    onClick={(e) => { e.stopPropagation(); setConfirmDeleteStepId(null) }}
                    className={`flex-1 flex items-center justify-center transition-colors ${isLight ? 'bg-slate-100 text-slate-700 hover:bg-slate-200' : 'bg-white/[0.05] text-zinc-200 hover:bg-white/[0.08]'
                      }`}
                  >
                    <span className="text-sm font-bold">No</span>
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onDeleteStep?.(step.id); setConfirmDeleteStepId(null) }}
                    className="flex-1 flex items-center justify-center bg-red-500 hover:bg-red-600 text-white text-sm font-bold transition-colors"
                  >
                    Delete
                  </button>
                </div>
              ) : (
                <div className={`w-full flex items-center gap-2 ${isMobile ? 'px-3 py-2.5' : 'px-3.5 py-3'}`} style={{ minHeight: 52 }}>
                  {/* Number badge + title/subtitle */}
                  <div
                    className="flex items-center gap-3 min-w-0 flex-1 text-left"
                  >
                    <div className="min-w-0 flex-1">
                      <h4 className={`font-semibold truncate whitespace-nowrap ${isMobile ? 'text-[12px]' : 'text-sm'} ${isPlayheadActive
                        ? isLight ? 'text-[#2d1b4e]' : 'text-purple-100'
                        : isLight ? 'text-slate-800 group-hover:text-[#2d1b4e]' : 'text-zinc-400 group-hover:text-purple-100'
                        }`}>Moment {stepIndex + 1}</h4>
                      <p className={`truncate whitespace-nowrap ${isMobile ? 'text-[10px]' : 'text-xs mt-0.5'} ${isPlayheadActive
                        ? isLight ? 'text-[#3b1e70]/80' : 'text-purple-300'
                        : isLight ? 'text-slate-500 group-hover:text-[#3b1e70]/80' : 'text-zinc-500 group-hover:text-purple-300'
                        }`}>
                        {layerCount > 0 ? `${layerCount} animated element${layerCount !== 1 ? 's' : ''}` : 'No effects'}
                      </p>
                    </div>
                  </div>
                  {/* Edit → Delete → Expand (always at far right) */}
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      onClick={(e) => { e.stopPropagation(); onStepEdit?.(step.id) }}
                      title="Edit moment"
                      className={`h-7 w-7 rounded-lg flex items-center justify-center transition-colors ${isPlayheadActive
                        ? isLight ? 'text-[#3b1e70]/85 hover:text-[#2d1b4e] hover:bg-[#cab3f8]/30' : 'text-purple-200/80 hover:text-white hover:bg-white/10'
                        : isLight ? 'text-slate-400 hover:text-[#7c4af0] group-hover:text-[#3b1e70]/85 hover:bg-[#cab3f8]/10' : 'text-zinc-500 hover:text-[#8e7ebd] group-hover:text-purple-200/80 hover:bg-white/10'
                        }`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setConfirmDeleteStepId(step.id) }}
                      title="Delete moment"
                      className={`h-7 w-7 rounded-lg flex items-center justify-center transition-colors ${isPlayheadActive
                        ? isLight ? 'text-[#3b1e70]/85 hover:text-red-600 hover:bg-[#cab3f8]/30' : 'text-purple-200/80 hover:text-red-400 hover:bg-white/10'
                        : isLight ? 'text-slate-400 hover:text-red-500 group-hover:text-[#3b1e70]/85 hover:bg-red-50' : 'text-zinc-500 hover:text-red-400 group-hover:text-purple-200/80 hover:bg-red-500/10'
                        }`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        const isActive = activeStepId === step.id;
                        if (isActive) {
                          setExpandedStepId(isExpanded ? null : step.id);
                        } else {
                          onSelectStepEnd?.(step.id);
                          setExpandedStepId(step.id);
                        }
                      }}
                      className={`h-7 w-7 rounded-lg flex items-center justify-center transition-colors ${isExpanded
                        ? isPlayheadActive
                          ? isLight ? 'text-[#2d1b4e] bg-[#cab3f8]/30' : 'text-purple-200 bg-white/10'
                          : (isLight ? 'text-[#7c4af0] bg-[#7c4af0]/10' : 'text-[#8e7ebd] bg-white/10')
                        : isPlayheadActive
                          ? isLight ? 'text-[#3b1e70]/85 hover:bg-[#cab3f8]/30' : 'text-purple-200/85 hover:bg-white/10'
                          : (isLight ? 'text-slate-400 hover:bg-black/5 group-hover:text-[#3b1e70]/85' : 'text-zinc-500 hover:bg-white/10 group-hover:text-purple-200/80')
                        }`}
                    >
                      <ChevronDown className={`transition-transform duration-200 ${isMobile ? 'h-3.5 w-3.5' : 'h-4 w-4'} ${isExpanded ? 'rotate-180' : 'rotate-0'}`} />
                    </button>
                  </div>
                </div>
              )}

              {isExpanded && (
                <div className={`border-t px-3 py-2.5 space-y-1.5 ${isLight ? 'border-slate-150 bg-slate-50/70' : 'border-white/[0.05] bg-black/25'
                  }`}>
                  {allLayerIds.size === 0 ? (
                    <p className={`text-[10px] italic py-1 text-center ${isLight ? 'text-slate-400' : 'text-zinc-600'}`}>No effects in this moment</p>
                  ) : [...allLayerIds].map((layerId) => {
                    const layer = sceneLayers.find(l => l.id === layerId) || layers[layerId]
                    const actions = step.layerActions?.[layerId] || []
                    const preset = step.layerPresets?.[layerId]
                    const color = layer?.data?.color || layer?.data?.fill || (isLight ? '#111827' : '#ffffff')
                    const contrastBg = getContrastCardBg(color, isLight)
                    return (
                      <div key={layerId} className={`flex items-start gap-2 px-2 ${isMobile ? 'py-1.5' : 'py-2'}`}>
                        <div
                          style={contrastBg ? { backgroundColor: contrastBg } : undefined}
                          className={`shrink-0 overflow-hidden flex items-center justify-center rounded ${isMobile ? 'w-6 h-6' : 'w-8 h-8'}`}
                        >
                          {renderLayerPreview(layer)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className={`font-semibold ${isMobile ? 'text-[10px]' : 'text-xs'} ${isLight ? 'text-slate-700' : 'text-zinc-300'}`}>{getLayerDisplayName(layer)}</p>
                          <div className="flex flex-wrap gap-1 mt-0.5">
                            {preset && (
                              <span className={`font-bold px-1.5 py-px rounded ${isMobile ? 'text-[8px]' : 'text-[10px]'} ${isLight ? 'bg-slate-100 text-slate-500' : 'bg-zinc-800/80 text-zinc-400'}`}>
                                {preset.type === 'IN' ? 'Entrance' : 'Exit'}
                              </span>
                            )}
                            {actions.map((action) => {
                              const meta = getActionMeta(action.type)
                              return meta ? (
                                <span key={action.id} className={`font-bold px-1.5 py-px rounded ${isMobile ? 'text-[8px]' : 'text-[10px]'} ${isLight ? 'bg-slate-100 text-slate-500' : 'bg-zinc-800/80 text-zinc-400'}`}>{meta.label}</span>
                              ) : null
                            })}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}

        {/* Add Moment dotted card — always at bottom of the list.
            [ONBOARDING] Elevated z-index so it stays above the dimmed overlay during Step 1. */}
        <div
          data-tutorial="add-moment-button"
          style={{ minHeight: 52 }}
          className={`relative z-20 border-2 border-solid rounded-xl flex items-center justify-center gap-2 cursor-pointer transition-all ${isMobile ? 'px-3 py-2.5' : 'px-3.5 py-3'} ${isLight ? 'border-[#7c4af0]/20 hover:border-[#7c4af0]/50' : 'border-[#7c4af0]/15 hover:border-[#7c4af0]/45'
            } ${isTutorialStep1 || isTutorialStep4 ? 'animate-onboarding-pulse border-[#7c4af0] bg-[#7c4af0]/5 dark:bg-[#7c4af0]/10' : ''}`}
          onClick={() => onStartMotionCapture?.()}
        >
          <Plus className="h-3.5 w-3.5 text-[#7c4af0] shrink-0" />
          <span className={`text-sm font-medium text-[#7c4af0] ${isMobile ? 'text-[12px]' : ''}`}>Add Moment</span>
        </div>
      </div>
    )
  }

  // ============================================================================
  // MOTION MODE — STATE 1: ELEMENT LIST
  // ============================================================================
  const renderMotionModeList = () => (
    <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
      {sceneLayers.length === 0 ? (
        <p className={`text-[11px] italic text-center py-12 ${isLight ? 'text-slate-400' : 'text-zinc-600'}`}>No elements in this scene</p>
      ) : sceneLayers.map((layer) => {
        const layerId = layer.id
        const isSelected = selectedLayerIds?.includes(layerId)
        const open = () => { setSelectedLayerId(layerId); setMotionModeState('element'); setExpandedFamilyKey(null); dispatch(setSelectedLayer(layerId)) }
        const color = layer?.data?.color || layer?.data?.fill || (isLight ? '#111827' : '#ffffff')
        const contrastBg = getContrastCardBg(color, isLight)
        const hasPreset = !!step?.layerPresets?.[layerId]
        const customCount = (step?.layerActions?.[layerId] || []).length
        const totalAnimations = (hasPreset ? 1 : 0) + customCount

        return (
          <button key={layerId} onClick={open}
            className={`group w-full flex items-center gap-3 border rounded-[6px] cursor-pointer transition-all duration-150 text-left ${isMobile ? 'px-3 py-2' : 'px-3.5 py-2.5'} ${isSelected ? (isLight ? 'border-purple-200 bg-purple-50/40' : 'border-purple-500/25 bg-[#7c4af0]/[0.07]') : (isLight ? 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50' : 'border-white/[0.06] bg-white/[0.02] hover:border-white/[0.1] hover:bg-white/[0.04]')
              }`}>
            <div
              style={contrastBg ? { backgroundColor: contrastBg } : undefined}
              className={`shrink-0 overflow-hidden flex items-center justify-center rounded ${isMobile ? 'w-8 h-8' : 'w-10 h-10'}`}
            >
              {renderLayerPreview(layer)}
            </div>
            <div className="min-w-0 flex-1">
              <h4 className={`font-medium truncate ${isMobile ? 'text-[12px]' : 'text-sm'} ${isLight ? 'text-slate-800' : 'text-zinc-200'}`}>{getLayerDisplayName(layer)}</h4>
              {totalAnimations > 0 ? (
                <p className={`truncate font-semibold ${isMobile ? 'text-[10px]' : 'text-xs'} text-[#7c4af0] dark:text-[#a78bfa]`}>
                  {totalAnimations} animation action{totalAnimations > 1 ? 's' : ''}
                </p>
              ) : (
                <p className={`truncate ${isMobile ? 'text-[10px]' : 'text-xs'} ${isLight ? 'text-slate-400' : 'text-zinc-500'}`}>Tap to animate</p>
              )}
            </div>
            <ChevronRight className={`shrink-0 ${isMobile ? 'h-3.5 w-3.5' : 'h-4 w-4'} ${isSelected ? 'text-[#7c4af0]' : (isLight ? 'text-slate-300 group-hover:text-slate-500' : 'text-zinc-600 group-hover:text-zinc-400')}`} />
          </button>
        )
      })}
    </div>
  )

  // ============================================================================
  // MOTION MODE — STATE 2: ELEMENT CONTROL VIEW
  // ============================================================================
  const renderMotionModeElement = () => {
    const layer = sceneLayers.find(l => l.id === selectedLayerId)
    if (!layer || !step) return null

    const layerId = layer.id
    const activePresetInfo = step?.layerPresets?.[layerId]
    const activePresetId = activePresetInfo?.id || null
    const activePresetType = activePresetInfo?.type || null  // 'IN' | 'OUT' | null
    const activeFamilyKey = activePresetId ? PRESET_ID_TO_FAMILY[activePresetId] : null

    let layerKey = layer.type
    if (layer.type === LAYER_TYPES.FRAME) layerKey = layer.data?.isCardFrame ? 'frame_card' : 'frame_normal'
    let allowedActions = ACTION_AVAILABILITY[layerKey] || []
    if ((layer.data?.shapeType || 'rect') !== 'rect' && layer.data?.shapeType !== 'square')
      allowedActions = allowedActions.filter(t => t !== 'cornerRadius')

    // [BACKGROUND PRESETS] Background layers never support entrance/exit presets — only
    // custom actions (colorChange). Hide the Presets tab entirely and force the Custom tab.
    const isBackground = layer.type === LAYER_TYPES.BACKGROUND
    const effectiveTab = isBackground ? 'custom' : activeTab

    const activeActions = layerActions || []
    const TRANSFORM_IDS = ['move', 'scale', 'rotate']
    const previewLayer = layers[layerId] || null

    // ── PRESETS TAB ───────────────────────────────────────────────────────────
    const renderExpandedRow = (fam) => {
      const currentMode = familyModes[fam.familyKey] || (activePresetType && activeFamilyKey === fam.familyKey ? activePresetType : 'IN')
      const currentDir = familyDirections[fam.familyKey] || (fam.hasDirections ? (fam.inIds[0]?.direction || null) : null)
      const variantList = currentMode === 'OUT' ? fam.outIds : fam.inIds

      const selectModeAndApply = (newMode) => {
        setFamilyModes(prev => ({ ...prev, [fam.familyKey]: newMode }))
        const varList = newMode === 'OUT' ? fam.outIds : fam.inIds
        const target = fam.hasDirections ? (varList.find(v => v.direction === currentDir) || varList[0]) : varList[0]
        if (target) applyPreset(target.id, newMode)
      }

      const selectDirAndApply = (dir) => {
        setFamilyDirections(prev => ({ ...prev, [fam.familyKey]: dir }))
        const target = variantList.find(v => v.direction === dir)
        if (target) applyPreset(target.id, currentMode)
      }

      const hasOut = fam.outIds.length > 0
      const isMobileRow = isMobile && (hasOut || fam.hasDirections)

      return (
        <div className={`w-full flex ${isMobileRow ? 'flex-row items-center justify-between gap-3 px-3 py-1.5 mb-1.5' : 'flex-col items-start justify-center gap-2 px-2.5 py-2.5 mb-2'
          } ${isMobile ? 'rounded-xl border border-black/5 dark:border-white/5' : 'aspect-[2/1]'
          } ${isLight ? 'bg-slate-50 border border-slate-200' : 'bg-white/[0.03] border border-white/[0.06]'}`}>
          {/* ON ENTER / ON EXIT toggle */}
          {hasOut && (
            <div className={`flex p-0.5 border ${isLight ? 'border-slate-200 bg-slate-100/50' : 'border-white/[0.08] bg-zinc-900'} rounded-lg overflow-hidden ${isMobileRow ? (fam.hasDirections ? 'w-[130px]' : 'mx-auto w-[160px]') : 'w-full'
              }`}>
              {[
                { id: 'IN', label: 'On Enter' },
                { id: 'OUT', label: 'On Exit' },
              ].map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => selectModeAndApply(opt.id)}
                  className={`flex-1 ${isMobile ? 'py-1 text-[10px]' : 'py-1.5 text-[11px]'} font-bold tracking-wide transition-all rounded-md ${currentMode === opt.id
                    ? isLight
                      ? 'bg-white text-slate-800 shadow-sm border border-slate-200/30'
                      : 'bg-zinc-800 text-white shadow-[0_1px_2px_rgba(0,0,0,0.4)] border border-white/[0.04]'
                    : isLight
                      ? 'text-slate-500 hover:text-slate-800'
                      : 'text-zinc-500 hover:text-zinc-200 bg-transparent'
                    }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}

          {/* Direction arrows */}
          {fam.hasDirections && (
            <div className="flex items-center gap-1.5">
              {variantList.map(({ direction }) => {
                const DirIcon = getDirectionIcon(direction, currentMode)
                if (!DirIcon) return null
                const isSelDir = currentDir === direction
                return (
                  <button
                    key={direction}
                    onClick={() => selectDirAndApply(direction)}
                    title={direction}
                    className={`${isMobile ? 'w-7 h-7' : 'w-8 h-8'} flex items-center justify-center border transition-all active:scale-95 rounded-md ${isSelDir
                      ? isLight
                        ? 'border-slate-400 bg-slate-200 text-slate-800'
                        : 'border-zinc-650 bg-zinc-800 text-white shadow-[0_1px_2px_rgba(0,0,0,0.4)]'
                      : (isLight
                        ? 'border-slate-250 bg-white text-slate-400 hover:border-slate-350 hover:text-slate-655'
                        : 'border-white/[0.08] bg-white/[0.04] text-zinc-500 hover:text-zinc-200')
                      }`}
                  >
                    <DirIcon className={`${isMobile ? 'h-3.5 w-3.5' : 'h-3.5 w-3.5'}`} strokeWidth={2.5} />
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )
    }

    const renderPresetsTab = () => {
      const availableFamilies = PRESET_FAMILIES.filter(
        fam => !fam.layerTypes || fam.layerTypes.includes(layer.type)
      )

      if (isMobile) {
        return (
          <div className="space-y-3">
            <div className="flex flex-row gap-3 overflow-x-auto pb-3 px-1 scrollbar-none snap-x snap-mandatory">
              {availableFamilies.map((fam) => {
                const isActiveFam = activeFamilyKey === fam.familyKey
                const isFamExpanded = expandedFamilyKey === fam.familyKey
                const famHasConfig = fam.hasDirections || fam.outIds.length > 0

                const currentMode = familyModes[fam.familyKey] || (activePresetType && isActiveFam ? activePresetType : 'IN')
                const currentDir = familyDirections[fam.familyKey] || (
                  isActiveFam && fam.hasDirections
                    ? (fam.inIds.find(v => v.id === activePresetId)?.direction || fam.outIds.find(v => v.id === activePresetId)?.direction || fam.inIds[0]?.direction)
                    : (fam.inIds[0]?.direction || null)
                )
                const variantList = currentMode === 'OUT' ? fam.outIds : fam.inIds
                const repVariant = fam.hasDirections ? (variantList.find(v => v.direction === currentDir) || variantList[0]) : variantList[0]
                const repPreset = repVariant ? PRESET_REGISTRY[repVariant.id] : null
                if (!repPreset) return null

                const handleCardClick = () => {
                  if (isActiveFam) {
                    dispatch(clearPresetFromStep({ sceneId: currentSceneId, stepId: editingStepId, layerId: selectedLayerId }))
                    setExpandedFamilyKey(null)
                  } else if (isFamExpanded) {
                    setExpandedFamilyKey(null)
                  } else {
                    if (famHasConfig) setExpandedFamilyKey(fam.familyKey)
                    const mode = familyModes[fam.familyKey] || 'IN'
                    const dir = familyDirections[fam.familyKey] || (fam.hasDirections ? fam.inIds[0].direction : null)
                    const varList = mode === 'OUT' ? fam.outIds : fam.inIds
                    const target = fam.hasDirections ? (varList.find(v => v.direction === dir) || varList[0]) : varList[0]
                    if (target) applyPreset(target.id, mode)
                  }
                }

                return (
                  <div key={fam.familyKey} className="snap-center shrink-0 w-[100px]">
                    <PresetPreviewCard
                      preset={repPreset}
                      layer={previewLayer}
                      showingFront={
                        motionControls?.layerObjects?.get?.(previewLayer?.id)?._showingFront !== undefined
                          ? motionControls.layerObjects.get(previewLayer.id)._showingFront
                          : (previewLayer?.data?.showingFront !== false)
                      }
                      isActive={isActiveFam}
                      onClick={handleCardClick}
                      isLight={isLight}
                      isMobile={true}
                    />
                  </div>
                )
              })}
            </div>
            {expandedFamilyKey && (
              <div className="px-1">
                {renderExpandedRow(availableFamilies.find(f => f.familyKey === expandedFamilyKey))}
              </div>
            )}
          </div>
        )
      }

      // Split families into rows so we can inject the expanded row immediately after the
      // row that contains the selected family card. [MOBILE] Use 3 columns on mobile so
      // the preset cards are smaller; 2 columns on desktop.
      const cols = 2
      const rows = []
      for (let i = 0; i < availableFamilies.length; i += cols) {
        rows.push(availableFamilies.slice(i, i + cols))
      }

      return (
        <div className="space-y-0">
          {rows.map((rowFams, rowIdx) => {
            // Does this row contain the currently expanded family?
            const expandedInRow = expandedFamilyKey
              ? rowFams.find(f => f.familyKey === expandedFamilyKey)
              : null

            return (
              <div key={rowIdx}>
                {/* Card row — [MOBILE] 3 smaller columns, [DESKTOP] 2 columns.
                    [UPDATE #3] tighter on mobile, [UPDATE #4] more generous on desktop. */}
                <div className={`grid px-0 grid-cols-2 gap-3 py-3`}>
                  {rowFams.map((fam) => {
                    const isActiveFam = activeFamilyKey === fam.familyKey

                    const currentMode = familyModes[fam.familyKey] || (activePresetType && isActiveFam ? activePresetType : 'IN')
                    const currentDir = familyDirections[fam.familyKey] || (
                      isActiveFam && fam.hasDirections
                        ? (fam.inIds.find(v => v.id === activePresetId)?.direction || fam.outIds.find(v => v.id === activePresetId)?.direction || fam.inIds[0]?.direction)
                        : (fam.inIds[0]?.direction || null)
                    )
                    const variantList = currentMode === 'OUT' ? fam.outIds : fam.inIds
                    const repVariant = fam.hasDirections ? (variantList.find(v => v.direction === currentDir) || variantList[0]) : variantList[0]
                    const repPreset = repVariant ? PRESET_REGISTRY[repVariant.id] : null
                    if (!repPreset) return null

                    const isFamExpanded = expandedFamilyKey === fam.familyKey

                    // Families with no exit variant and no directions (e.g.
                    // Typewriter) have nothing to configure, so the card just
                    // applies/toggles without opening an (empty) settings row.
                    const famHasConfig = fam.hasDirections || fam.outIds.length > 0

                    const handleCardClick = () => {
                      if (isActiveFam) {
                        // Already selected — deselect immediately (one click)
                        dispatch(clearPresetFromStep({ sceneId: currentSceneId, stepId: editingStepId, layerId: selectedLayerId }))
                        setExpandedFamilyKey(null)
                      } else if (isFamExpanded) {
                        // Expanded but not yet applied — collapse
                        setExpandedFamilyKey(null)
                      } else {
                        // Open settings row (when there's something to configure) and apply the default variant
                        if (famHasConfig) setExpandedFamilyKey(fam.familyKey)
                        const mode = familyModes[fam.familyKey] || 'IN'
                        const dir = familyDirections[fam.familyKey] || (fam.hasDirections ? fam.inIds[0].direction : null)
                        const varList = mode === 'OUT' ? fam.outIds : fam.inIds
                        const target = fam.hasDirections ? (varList.find(v => v.direction === dir) || varList[0]) : varList[0]
                        if (target) applyPreset(target.id, mode)
                      }
                    }

                    return (
                      <PresetPreviewCard
                        key={fam.familyKey}
                        preset={repPreset}
                        layer={previewLayer}
                        showingFront={
                          motionControls?.layerObjects?.get?.(previewLayer?.id)?._showingFront !== undefined
                            ? motionControls.layerObjects.get(previewLayer.id)._showingFront
                            : (previewLayer?.data?.showingFront !== false)
                        }
                        isActive={isActiveFam}
                        onClick={handleCardClick}
                        isLight={isLight}
                        isMobile={isMobile}
                      />
                    )
                  })}
                  {/* Fill any trailing empty slots so the grid stays aligned */}
                  {rowFams.length < cols && Array.from({ length: cols - rowFams.length }).map((_, i) => <div key={`empty-${i}`} />)}
                </div>

                {/* Expanded settings row — only shown directly after the row that has the selected card */}
                {expandedInRow && renderExpandedRow(expandedInRow)}
              </div>
            )
          })}
        </div>
      )
    }

    // ── CUSTOM TAB ────────────────────────────────────────────────────────────
    // Custom actions whose settings are edited inline in the panel (instead of needing
    // the canvas toolbar). Transform actions (move/scale/rotate/crop/flip/typewriter)
    // are still captured via direct canvas interaction.
    const SETTINGS_ACTION_TYPES = ['colorChange', 'fade', 'blur', 'tilt', 'cornerRadius']
    const COLOR_SWATCHES = ['#ffffff', '#000000', '#7c4af0', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#ec4899']

    const getLayerColorHex = () => {
      const c = previewLayer?.data?.fill ?? previewLayer?.data?.color
      if (typeof c === 'number') return '#' + c.toString(16).padStart(6, '0')
      if (typeof c === 'string' && c !== 'transparent') return c
      return '#ffffff'
    }

    // Inline settings panel rendered beneath a selected custom action (Color/Opacity/
    // Blur/3D Tilt/Radius). Adjusting a control commits via onCustomActionValueChange,
    // which routes through the same capture path the canvas controls use — so the motion
    // action is created on first change and updated on subsequent changes.
    const renderActionSettings = (actionType, action) => {
      const v = action?.values || {}
      const commit = (updates) => onCustomActionValueChange?.(layerId, updates)
      const labelCls = `text-[10px] uppercase font-bold tracking-wider shrink-0 ${isLight ? 'text-slate-400' : 'text-zinc-500'}`
      const valCls = `text-[11px] font-mono shrink-0 ${isLight ? 'text-slate-600' : 'text-zinc-300'}`
      const trackCls = `${isLight ? 'bg-slate-200' : 'bg-white/10'} relative grow rounded-full h-1`
      const rangeCls = `absolute ${isLight ? 'bg-[#7c4af0]' : 'bg-white'} rounded-full h-full`
      const thumbCls = `block w-3.5 h-3.5 rounded-full focus:outline-none cursor-pointer ${isLight ? 'bg-white border-2 border-[#7c4af0] shadow-sm' : 'bg-white shadow-md'}`
      const wrap = (children) => {
        if (isMobile) return <div className="w-full">{children}</div>
        return <div className={`px-3 py-3 ${isLight ? 'bg-slate-50 border-t border-slate-100' : 'bg-black/30 border-t border-white/[0.05]'}`}>{children}</div>
      }
      const sliderRow = (label, valueLabel, sliderProps) => (
        <div className="flex items-center gap-3">
          <span className={`${labelCls} w-12`}>{label}</span>
          <Slider.Root className="relative flex items-center select-none touch-none grow h-5" {...sliderProps}>
            <Slider.Track className={trackCls}><Slider.Range className={rangeCls} /></Slider.Track>
            <Slider.Thumb className={thumbCls} aria-label={label} />
          </Slider.Root>
          <span className={`${valCls} w-10 text-right`}>{valueLabel}</span>
        </div>
      )

      const inherited = getInheritedStepValues(motionFlow, editingStepId, selectedLayerId, previewLayer)

      if (actionType === 'fade') {
        const opacity = v.opacity ?? inherited.opacity
        return wrap(sliderRow('Opacity', `${Math.round(opacity * 100)}%`, {
          min: 0, max: 100, step: 1, value: [Math.round(opacity * 100)],
          onValueChange: (val) => commit({ opacity: (val[0] ?? 0) / 100 }),
        }))
      }
      if (actionType === 'blur') {
        const blur = v.blur ?? inherited.blur
        return wrap(sliderRow('Blur', `${Math.round(Math.min(BLUR_MAX, blur))}`, {
          min: 0, max: BLUR_MAX, step: 0.5, value: [Math.min(BLUR_MAX, blur)],
          onValueChange: (val) => commit({ blur: Math.max(0, Math.min(BLUR_MAX, val[0] ?? 0)) }),
        }))
      }
      if (actionType === 'cornerRadius') {
        const radius = v.cornerRadius ?? inherited.cornerRadius
        const maxR = Math.max(1, Math.min(200, Math.min(previewLayer?.width || 100, previewLayer?.height || 100) / 2))
        return wrap(sliderRow('Radius', `${Math.round(radius)}px`, {
          min: 0, max: maxR, step: 1, value: [Math.min(maxR, radius)],
          onValueChange: (val) => commit({ cornerRadius: Math.max(0, Math.round(val[0] ?? 0)) }),
        }))
      }
      if (actionType === 'tilt') {
        const tiltX = v.tiltX ?? inherited.tiltX
        const tiltY = v.tiltY ?? inherited.tiltY
        const T = 60
        const tiltRow = (label, value, key) => sliderRow(label, `${value.toFixed(1)}°`, {
          min: -T, max: T, step: 0.5, value: [value],
          onValueChange: (val) => { let n = val[0] ?? 0; if (Math.abs(n) < 2) n = 0; commit({ [key]: Math.max(-T, Math.min(T, n)) }) },
        })
        return wrap(
          <div className="flex flex-col gap-2">
            {tiltRow('Tilt H', tiltX, 'tiltX')}
            {tiltRow('Tilt V', tiltY, 'tiltY')}
          </div>
        )
      }
      if (actionType === 'colorChange') {
        const current = v.color ?? inherited.color ?? getLayerColorHex()
        const safeCurrent = /^#[0-9a-fA-F]{6}$/.test(String(current)) ? current : '#ffffff'

        if (isMobile) {
          return wrap(
            <div className="flex flex-col gap-2.5">
              <span className={labelCls}>Color</span>
              <div className="w-full">
                <AdvancedColorPickerModal
                  initialColor={safeCurrent}
                  onColorSelect={(color) => commit({ color })}
                  onClose={() => { }}
                  isInline={true}
                  hideHeader={true}
                />
              </div>
            </div>
          )
        }

        return wrap(
          <div className="flex flex-col gap-2.5">
            <span className={labelCls}>Color</span>
            <div className="flex items-center gap-2 flex-wrap">
              {COLOR_SWATCHES.slice(0, 8).map((c) => (
                <button
                  key={c}
                  onClick={() => commit({ color: c })}
                  className={`w-6 h-6 rounded-full border transition-transform hover:scale-110 ${String(current).toLowerCase() === c.toLowerCase() ? 'ring-2 ring-[#7c4af0] border-white' : (isLight ? 'border-slate-200' : 'border-white/10')}`}
                  style={{ backgroundColor: c }}
                  title={c}
                />
              ))}
              <button
                ref={customColorButtonRef}
                onClick={() => setShowAdvancedPicker(true)}
                className={`w-6 h-6 rounded-full border cursor-pointer overflow-hidden relative transition-transform hover:scale-110 ${isLight ? 'border-slate-200' : 'border-white/10'}`}
                title="Custom color"
                style={{ background: 'conic-gradient(from 0deg, red, yellow, lime, aqua, blue, magenta, red)' }}
              />
              {showAdvancedPicker && (
                <AdvancedColorPickerModal
                  onClose={() => setShowAdvancedPicker(false)}
                  initialColor={safeCurrent}
                  onColorSelect={(color) => commit({ color })}
                  anchorElement={customColorButtonRef.current}
                />
              )}
            </div>
          </div>
        )
      }
      return null
    }

    const renderCustomActionRow = (actionType) => {
      const meta = getActionMeta(actionType)
      if (!meta || !allowedActions.includes(actionType)) return null
      const Icon = meta.icon
      const action = activeActions.find(a => a.type === actionType)
      const isAct = !!action
      const hasSettings = SETTINGS_ACTION_TYPES.includes(actionType)
      const isExpanded = hasSettings && expandedActionType === actionType

      const handleRowClick = () => {
        if (hasSettings) {
          // Toggle the inline settings row. The control commits the value (creating the
          // action on first change) so no separate "add" click is required.
          setExpandedActionType(isExpanded ? null : actionType)
        } else if (!isAct) {
          // Transform actions are captured via canvas interaction (existing behavior).
          onAddAnimation?.(layerId, actionType)
        }
      }

      return (
        <div key={actionType}>
          <div
            onClick={handleRowClick}
            className={`flex items-center justify-between gap-3 font-semibold transition-colors ${isMobile ? 'px-3 py-2.5 text-[11px]' : 'px-3 py-3 text-[13px]'} ${isAct
              ? (isLight ? 'bg-[#7c4af0]/10 text-[#7c4af0]' : 'bg-[#7c4af0]/15 text-[#c084fc]')
              : (isLight ? 'hover:bg-slate-50 cursor-pointer' : 'hover:bg-white/[0.03] cursor-pointer')
              } ${hasSettings ? 'cursor-pointer' : ''}`}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className={`p-1 shrink-0 ${isAct ? (isLight ? 'text-[#7c4af0]' : 'text-[#c084fc]') : (isLight ? 'text-slate-500' : 'text-zinc-500')}`}>
                <Icon className={isMobile ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
              </div>
              <span className={`font-semibold ${isAct ? (isLight ? 'text-[#7c4af0]' : 'text-[#c084fc]') : (isLight ? 'text-slate-600' : 'text-zinc-400')}`}>{meta.label}</span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {hasSettings && (
                <ChevronDown className={`transition-transform duration-200 ${isMobile ? 'h-3.5 w-3.5' : 'h-4 w-4'} ${isExpanded ? 'rotate-180 text-zinc-500 dark:text-zinc-400' : (isLight ? 'text-slate-400' : 'text-zinc-500')}`} />
              )}
              {isAct && (
                <button
                  onClick={(e) => { e.stopPropagation(); handleDeleteAction(step.id, layerId, action.id, actionType) }}
                  className={`p-0.5 transition-colors ${isLight ? 'text-slate-300 hover:text-red-500' : 'text-zinc-655 hover:text-red-400'}`}
                >
                  <X className="h-3.5 w-3.5" strokeWidth={2} />
                </button>
              )}
            </div>
          </div>
          {isExpanded && renderActionSettings(actionType, action)}
        </div>
      )
    }

    const sectionLabelCls = `font-bold uppercase tracking-widest mb-1.5 px-1 ${isMobile ? 'text-[10px]' : 'text-[11px]'} ${isLight ? 'text-slate-400' : 'text-zinc-500'}`
    const renderCustomTab = () => {
      if (isMobile) {
        return (
          <div className="space-y-3">
            <div className="flex flex-row gap-3 overflow-x-auto pb-3 px-1 scrollbar-none snap-x snap-mandatory">
              {allowedActions.map((actionType) => {
                const meta = getActionMeta(actionType)
                if (!meta) return null
                const Icon = meta.icon
                const action = activeActions.find(a => a.type === actionType)
                const isAct = !!action
                const hasSettings = SETTINGS_ACTION_TYPES.includes(actionType)

                const handleRowClick = () => {
                  if (hasSettings) {
                    setExpandedActionType(expandedActionType === actionType ? null : actionType)
                  } else if (!isAct) {
                    onAddAnimation?.(layerId, actionType)
                  }
                }

                return (
                  <div key={actionType} className="snap-center shrink-0 w-[100px]">
                    <div
                      onClick={handleRowClick}
                      className={`w-full aspect-square rounded-xl flex flex-col items-center justify-center transition-all duration-200 relative ${isAct
                        ? isLight
                          ? 'border border-[#7c4af0]/30 bg-[#7c4af0]/10 shadow-sm'
                          : 'border border-[#a78bfa]/35 bg-[#7c4af0]/15 shadow-sm shadow-black/20'
                        : (isLight ? 'bg-slate-100 hover:bg-slate-200/85 border border-transparent' : 'bg-zinc-900/40 hover:bg-zinc-900/80 border border-white/[0.04]')
                        }`}
                    >
                      <div className={`p-1 shrink-0 ${isAct ? (isLight ? 'text-[#7c4af0]' : 'text-[#c084fc]') : (isLight ? 'text-slate-500' : 'text-zinc-500')}`}>
                        <Icon className="h-6 w-6" strokeWidth={2} />
                      </div>
                      {isAct && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleDeleteAction(step.id, layerId, action.id, actionType)
                            if (expandedActionType === actionType) {
                              setExpandedActionType(null)
                            }
                          }}
                          className={`absolute top-1.5 right-1.5 p-0.5 rounded-full transition-colors ${isLight ? 'text-slate-400 hover:text-red-500 hover:bg-slate-200' : 'text-zinc-500 hover:text-red-400 hover:bg-white/5'}`}
                        >
                          <X className="h-3 w-3" strokeWidth={2.5} />
                        </button>
                      )}
                    </div>
                    <span className={`block font-semibold text-center transition-colors truncate max-w-full px-0.5 text-[8px] mt-1 ${isAct
                      ? (isLight ? 'text-[#7c4af0]' : 'text-[#c084fc]')
                      : (isLight ? 'text-slate-500 hover:text-slate-700' : 'text-zinc-400 hover:text-zinc-200')
                      }`}>
                      {meta.label}
                    </span>
                  </div>
                )
              })}
            </div>
            {expandedActionType && (
              <div className="px-1">
                {renderActionSettings(expandedActionType, activeActions.find(a => a.type === expandedActionType))}
              </div>
            )}
          </div>
        )
      }

      return (
        <div className="space-y-4">
          <div>
            <p className={sectionLabelCls}>Transform</p>
            <div className={`overflow-hidden ${isLight ? 'divide-y divide-slate-100' : 'divide-y divide-white/[0.04]'}`}>
              {TRANSFORM_IDS.map(t => renderCustomActionRow(t))}
            </div>
          </div>
          {allowedActions.some(t => !TRANSFORM_IDS.includes(t)) && (
            <div>
              <p className={sectionLabelCls}>Effects</p>
              <div className={`overflow-hidden ${isLight ? 'divide-y divide-slate-100' : 'divide-y divide-white/[0.04]'}`}>
                {allowedActions.filter(t => !TRANSFORM_IDS.includes(t)).map(t => renderCustomActionRow(t))}
              </div>
            </div>
          )}
        </div>
      )
    }

    const presetBadge = (activePresetInfo ? 1 : 0)
    const customBadge = activeActions.length

    return (
      <div className="flex flex-col h-full">
        {/* Tab bar */}
        <div className={`flex w-full border-b flex-shrink-0 ${isLight ? 'border-slate-200 bg-slate-50' : 'border-white/[0.05] bg-[#0d0e12]'}`}>
          {(isBackground
            ? [{ id: 'custom', label: 'Custom', badge: customBadge }]
            : [
              { id: 'presets', label: 'Presets', badge: presetBadge },
              { id: 'custom', label: 'Custom', badge: customBadge },
            ]
          ).map((tab) => {
            const isTActive = effectiveTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 font-bold tracking-wide transition-colors flex items-center justify-center gap-1 rounded-none ${isMobile ? 'py-2.5 text-[11px]' : 'py-3 text-[12px]'
                  } ${isTActive
                    ? isLight
                      ? 'bg-slate-300 text-slate-800'
                      : 'bg-zinc-800 text-zinc-150'
                    : isLight
                      ? 'text-slate-500 hover:text-slate-800 bg-slate-200/50 hover:bg-slate-200'
                      : 'text-zinc-500 hover:text-zinc-200 bg-zinc-900/50 hover:bg-zinc-850'
                  }`}
              >
                {tab.label}
                {tab.badge > 0 && (
                  <span className="ml-1 font-mono text-[10px] font-normal opacity-75">({tab.badge})</span>
                )}
              </button>
            )
          })}
          {/* Collapse arrow — always visible regardless of active tab */}
          <button
            onClick={isMobile ? handleMobileMinimize : handleCollapseWithAnimation}
            className={`px-3 border-l rounded-none flex items-center justify-center transition-colors ${isLight ? 'border-slate-100 hover:bg-slate-200/30' : 'border-white/[0.05] hover:bg-white/[0.02]'
              }`}
            aria-label="Collapse"
          >
            {isMobile ? (
              <ChevronDown className="h-5 w-5 text-zinc-500 dark:text-zinc-400" strokeWidth={2.5} />
            ) : (
              <ChevronRight className="h-5 w-5 text-zinc-500 dark:text-zinc-400" strokeWidth={2} />
            )}
          </button>
        </div>

        {/* Tab content */}
        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-3 min-h-0">
          {effectiveTab === 'presets' && renderPresetsTab()}
          {effectiveTab === 'custom' && renderCustomTab()}
        </div>

        {/* Exit element footer */}
        <div className={`flex-shrink-0 border-t flex flex-col items-center ${isMobile ? 'p-1.5 gap-1' : 'p-3 gap-2'
          } ${isLight ? 'border-slate-200 bg-slate-50/50' : 'border-white/[0.05] bg-[#0d0e12]/50'
          }`}>
          {/* Animated layers badge/chip */}
          <div className={`rounded-full font-bold tracking-wide transition-all ${isMobile ? 'px-2 py-0.5 text-[9px]' : 'px-2.5 py-1 text-[10px]'
            } ${isLight ? 'bg-slate-200/60 text-slate-500' : 'bg-zinc-800/60 text-zinc-400'
            }`}>
            Animating {sceneLayers.filter(l => step?.layerPresets?.[l.id] || (step?.layerActions?.[l.id] || []).length > 0).length} of {sceneLayers.length} elements
          </div>
          <button
            onClick={() => { setMotionModeState('list'); setSelectedLayerId(null); setExpandedFamilyKey(null); dispatch(setSelectedLayer(null)) }}
            className={`w-full font-bold flex items-center justify-center gap-2 border-2  border-[#7c4af0]/50 hover:border-[#7c4af0] transition-all duration-150 ${isMobile ? 'py-1.5 rounded-md text-[11px]' : 'py-2.5 rounded-lg text-[12px]'
              }`}
            style={{
              backgroundColor: 'rgb(228, 217, 249)',
              color: '#7c4af0',
            }}
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
            Add Element
          </button>
        </div>
      </div>
    )
  }

  // ============================================================================
  // COLLAPSED STATE (desktop only)
  // ============================================================================
  if (!isMobile && isCollapsed) {
    const collapsedTop = isMotionCaptureActive ? 0 : topToolbarHeight
    return (
      <div
        ref={collapsedOuterRef}
        className="fixed right-0 flex flex-col items-center"
        style={{
          width: '48px',
          top: `${collapsedTop}px`,
          height: `calc(100vh - ${collapsedTop}px - ${bottomSectionHeight || 0}px)`,
          zIndex: 50,
          backgroundColor: isLight ? '#f3f4f7' : '#090a0d',
          borderLeft: `1px solid ${isLight ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.05)'}`,
        }}
      >
        {/* Expand toggle */}
        <button
          onClick={handleExpandFromCollapsed}
          title="Expand moments panel"
          className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors shrink-0 mt-3 mb-1 ${isLight ? 'text-slate-500 hover:text-slate-900 hover:bg-slate-200' : 'text-zinc-400 hover:text-white hover:bg-white/10'
            }`}
        >
          <ChevronLeft className="h-5 w-5 text-zinc-500 dark:text-zinc-400" strokeWidth={2} />
        </button>

        {/* Scrollable list: moment cards + Add Moment at the end */}
        <div
          ref={collapsedScrollRef}
          className="flex flex-col items-center gap-2 overflow-y-auto flex-1 min-h-0 w-full py-1"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {isMotionCaptureActive ? (
            sceneLayers.map((layer) => {
              const isSelected = selectedLayerIds?.includes(layer.id)
              const isText = layer.type === LAYER_TYPES.TEXT
              const isVideo = layer.type === LAYER_TYPES.VIDEO
              const isShape = layer.type === LAYER_TYPES.SHAPE
              const fill = layer.data?.fill
              const thumb = layer.data?.thumbnail
              const url = layer.data?.url || layer.data?.src
              const textContent = layer.data?.content || ''
              const textColor = layer.data?.color

              return (
                <button
                  key={layer.id}
                  onClick={(e) => {
                    e.stopPropagation()
                    setSelectedLayerId(layer.id)
                    setMotionModeState('element')
                    dispatch(setSelectedLayer(layer.id))
                    handleExpandFromCollapsed()
                  }}
                  title={getLayerDisplayName(layer)}
                  className={`w-9 h-9 rounded-lg border flex items-center justify-center overflow-hidden shrink-0 transition-colors ${isSelected
                    ? 'border-[#7c4af0] ring-1 ring-[#7c4af0]/30 bg-[#7c4af0]/10'
                    : isLight
                      ? 'border-slate-200 hover:border-slate-350 bg-slate-100 hover:bg-slate-200/85'
                      : 'border-white/10 hover:border-white/20 bg-zinc-900/40 hover:bg-zinc-900/80'
                    }`}
                  style={(isShape || (!isText && !isVideo)) && fill ? { backgroundColor: fill } : undefined}
                >
                  {thumb ? (
                    <img src={thumb} alt="" className="w-full h-full object-cover" />
                  ) : url && !isVideo ? (
                    <img src={url} alt="" className="w-full h-full object-cover" />
                  ) : isText ? (
                    <span style={{ fontSize: 9, color: textColor || (isLight ? '#374151' : '#d4d4d8'), fontWeight: 700, lineHeight: 1 }}>
                      {textContent ? textContent.slice(0, 2) : 'T'}
                    </span>
                  ) : isVideo ? (
                    <Film className={`h-4 w-4 ${isLight ? 'text-slate-500' : 'text-zinc-400'}`} />
                  ) : (
                    <span className="text-[10px] font-bold">{(layer.type || 'L').charAt(0).toUpperCase()}</span>
                  )}
                </button>
              )
            })
          ) : (
            <>
              <button
                onClick={() => onSelectStepEnd?.('base')}
                title="Design / Starting Point"
                className={`w-9 h-9 rounded-lg border-2 flex items-center justify-center text-[10px] font-bold transition-all shrink-0 ${activeStepId === 'base'
                  ? isLight
                    ? 'border-transparent bg-slate-200 text-slate-900 shadow-sm'
                    : 'border-transparent bg-[#1c1d26] text-zinc-200 shadow-sm'
                  : isLight
                    ? 'border-transparent bg-white text-slate-800 hover:bg-[#cab3f8] hover:text-purple-900'
                    : 'border-transparent bg-[#121319] text-zinc-400 hover:bg-[#3b3847] hover:text-zinc-200'
                  }`}
              >
                D
              </button>
              {motionFlow.map((step, idx) => (
                <button
                  key={step.id}
                  onClick={() => onSelectStepEnd?.(step.id)}
                  title={`Select Moment ${idx + 1}`}
                  className={`w-9 h-9 rounded-lg border-2 flex items-center justify-center text-[10px] font-bold transition-all shrink-0 ${activeStepId === step.id
                    ? isLight
                      ? 'border-transparent bg-[#cab3f8] text-purple-900 shadow-sm'
                      : 'border-transparent bg-[#4c3b70] text-purple-200 shadow-sm'
                    : isLight
                      ? 'border-transparent bg-white text-slate-800 hover:bg-[#cab3f8] hover:text-purple-900'
                      : 'border-transparent bg-[#121319] text-zinc-400 hover:bg-[#3b3847] hover:text-zinc-200'
                    }`}
                >
                  M{idx + 1}
                </button>
              ))}
              {/* Add Moment — always after the last card, scrolls into view */}
              <button
                data-tutorial="add-moment-button"
                onClick={() => onStartMotionCapture?.()}
                title="Add Moment"
                className={`w-9 h-9 rounded-lg border-2 border-solid flex items-center justify-center transition-all shrink-0 ${isLight
                  ? 'border-[#7c4af0]/30 text-[#7c4af0] hover:border-[#7c4af0] hover:bg-[#7c4af0]/5'
                  : 'border-[#7050c0]/35 text-[#8e7ebd] hover:border-[#7050c0] hover:bg-[#7050c0]/5'
                  } ${isTutorialStep1 || isTutorialStep4 ? 'animate-onboarding-pulse border-[#7c4af0] bg-[#7c4af0]/5 dark:bg-[#7c4af0]/10' : ''}`}
              >
                <Plus className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
      </div>
    )
  }

  // ============================================================================
  // MAIN RENDER (expanded)
  // ============================================================================
  return (
    <>
      {isMobile && isOpen && <div className="lg:hidden fixed inset-0 z-[60] bg-transparent pointer-events-none" />}
      <div
        ref={panelRef}
        className={`fixed flex flex-col editor-panel-container ${isMobile ? 'bottom-0 left-0 right-0 rounded-t-2xl border-t' : 'inset-y-0 right-0 border-l transition-all duration-300'}`}
        style={{
          zIndex: isMobile ? 61 : (isMotionCaptureActive ? 50 : 35),
          top: isMobile ? 'auto' : (isMotionCaptureActive ? '0px' : `${topToolbarHeight}px`),
          height: isMobile
            ? '36vh'
            : (isMotionCaptureActive
              ? '100vh'
              : `calc(100vh - ${topToolbarHeight}px - ${(bottomSectionHeight || 140)}px)`),
          '--bottom-section-height': `${(bottomSectionHeight || 140)}px`,
          minHeight: isMobile ? '230px' : 'auto',
          maxHeight: isMobile ? '48vh' : 'auto',
          width: isMobile ? '100vw' : `${PANEL_WIDTH}px`,
          backgroundColor: isLight ? '#f3f4f7' : '#090a0d',
          borderLeft: isMobile ? 'none' : `1px solid ${isLight ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.05)'}`,
          borderTop: isMobile ? `1px solid ${isLight ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.05)'}` : 'none',
        }}
      >
        {isMobile && (
          <div
            className="flex justify-center pt-2.5 pb-1 flex-shrink-0 cursor-pointer"
            title="Minimize"
            onClick={handleMobileMinimize}
          >
            <div className={`h-1 w-9 rounded-full ${isLight ? 'bg-slate-300' : 'bg-zinc-600'}`} />
          </div>
        )}
        {/* Both desktop and mobile hide the header in the layer (element)
            view so content begins at the Preset/Custom tabs. */}
        {!(isMotionCaptureActive && motionModeState === 'element') && renderHeader()}
        <div className="flex-1 overflow-hidden min-h-0 flex flex-col">
          {!isMotionCaptureActive && renderNormalMode()}
          {isMotionCaptureActive && motionModeState === 'list' && renderMotionModeList()}
          {isMotionCaptureActive && motionModeState === 'element' && renderMotionModeElement()}
        </div>
      </div>
    </>
  )
}

export default MotionPanel
