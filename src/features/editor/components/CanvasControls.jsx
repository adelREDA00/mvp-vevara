import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, useContext } from 'react'
import { createPortal } from 'react-dom'
import { ThemeContext } from '../../../app/context/ThemeContext'
import {
  Minus, ChevronDown,
  Settings, X, Layers,
  Volume2, VolumeX, Ghost, Droplets, FlipHorizontal2,
  Plus, Rotate3d, Check, Eye, EyeOff, Waves,
  AlignLeft, AlignCenter, AlignRight, RotateCcw,
  ArrowLeftRight, ArrowUpDown, Undo2, Redo2,
  Music, Scissors, Trash2, Copy
} from 'lucide-react'
import * as Slider from '@radix-ui/react-slider'
import { LAYER_TYPES } from '../../../store/models'
import { BLUR_MAX, computeBlurPhysicalStrength } from '../../engine/motion/blurConstants.js'
import { CORNER_RADIUS_MAX } from '../../engine/motion/cornerRadiusConstants.js'
import { DropdownMenu, DropdownMenuItem } from './DropdownMenu'
import { useSelector, useDispatch } from 'react-redux'
import { selectTutorialState, endTutorial, setAutoPlayState } from '../../../store/slices/tutorialSlice'
import { selectCanUndo, selectCanRedo } from '../../../store/slices/historySlice'
import {
  duplicateLayer,
  deleteLayer,
  deleteScene,
  copyScene,
  pasteScene,
  selectScenes
} from '../../../store/slices/projectSlice'
import { clearLayerSelection } from '../../../store/slices/selectionSlice'
import * as PIXI from 'pixi.js'
import { getGlobalMotionEngine } from '../../engine/motion'
import { syncTiltMesh, applyTiltToObject } from '../../engine/pixi/perspectiveTilt'

const DEFAULT_COLORS = [
  '#6367FF', '#8494FF', '#C9BEFF', '#FFDBFD', '#ffffff',
  '#222831', '#393E46', '#00ADB5', '#EEEEEE', '#000000',
  '#FFF5E4', '#FFE3E1', '#FFD1D1', '#FF9494', '#ff4500',
  '#00d1b2', '#f5f5f5', '#209cee', '#ffdd57', '#ff3860'
]

// [SLIDER CLIP FIX] On desktop the control sliders were rendered as `absolute top-full`
// children of the left pill's `overflow-x-auto` scroll container. Per CSS, `overflow-x:auto`
// forces the computed `overflow-y` to `auto`, so any popover hanging below the 40px pill was
// clipped and never appeared. The pills also use `backdrop-filter`, which makes them a
// containing block for `position:fixed` descendants — so even fixed positioning gets clipped.
// ControlPopover escapes both by portaling to document.body and positioning `fixed` from the
// trigger button's viewport rect (kept in sync on scroll/resize).
function ControlPopover({ open, anchorRef, children }) {
  const [pos, setPos] = useState(null)
  useLayoutEffect(() => {
    if (!open) return
    const el = anchorRef?.current
    if (!el) return
    const update = () => {
      const r = el.getBoundingClientRect()
      setPos({ top: r.bottom + 8, left: r.left + r.width / 2 })
    }
    update()
    // capture=true so we also catch scrolls of inner scroll containers (the pill).
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [open, anchorRef])

  if (!open || !pos) return null
  return createPortal(
    <div style={{ position: 'fixed', top: pos.top, left: pos.left, transform: 'translateX(-50%)', zIndex: 9999, pointerEvents: 'auto' }}>
      {children}
    </div>,
    document.body
  )
}

function CanvasControls({
  duration = '4.4s',
  selectedLayer,
  selectedCanvas,
  currentScene,
  onLayerUpdate,
  onCanvasUpdate,
  onToggleAdvanced,
  onOpenColorPicker,
  onOpenPositionPanel,
  isMotionCaptureActive = false,
  onStartMotionCapture,
  onApplyMotion,
  onCancelMotion,
  onFlipCardFrame,
  requestOpenControl = null,
  stepsCount = 0,
  editingStepActionCount = 0,
  isDoneEnabled = false,
  editingMomentLabel = '',
  isMobileBottom = false,
  onSubmenuChange,
  onUndo,
  onRedo,
  // ── Audio block props ──────────────────────────────────────────────────────
  selectedAudioBlock = null,   // { id, name, volume, muted } from AudioBar local state
  onAudioBlockUpdate = null,   // fn({ id, ...updates })
  onAudioBlockDelete = null,   // fn(id)
  onAudioBlockCut   = null,    // fn(id) — cut at playhead (Phase 2)
}) {
  const { theme } = useContext(ThemeContext)
  const dispatch = useDispatch()
  const scenes = useSelector(selectScenes)
  const { active: tutorialActive, step: tutorialStep } = useSelector(selectTutorialState)

  const [isMobileScreen, setIsMobileScreen] = useState(() => typeof window !== 'undefined' && window.innerWidth < 1024)
  useEffect(() => {
    const onResize = () => setIsMobileScreen(window.innerWidth < 1024)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const canUndo = useSelector(selectCanUndo)
  const canRedo = useSelector(selectCanRedo)

  const [showOpacitySlider, setShowOpacitySlider] = useState(false)
  const [showBlurSlider, setShowBlurSlider] = useState(false)
  const [showCornerRadiusSlider, setShowCornerRadiusSlider] = useState(false)
  const [showTiltPanel, setShowTiltPanel] = useState(false)
  const [showColorMenu, setShowColorMenu] = useState(false)
  const [showFontMenu, setShowFontMenu] = useState(false)
  const [showSizeMenu, setShowSizeMenu] = useState(false)
  const [showAlignMenu, setShowAlignMenu] = useState(false)
  const [showAddStepHint, setShowAddStepHint] = useState(false)
  
  const currentFontSize = getFontSize()
  const [localFontSize, setLocalFontSize] = useState(currentFontSize.toString())

  useEffect(() => {
    setLocalFontSize(currentFontSize.toString())
  }, [currentFontSize])

  const globalBlurListenerRef = useRef(null)

  const handleInputFocus = () => {
    if (globalBlurListenerRef.current) return
    const listener = (e) => {
      const activeEl = document.activeElement
      if (activeEl && activeEl.classList.contains('font-size-input')) {
        if (e.target !== activeEl) {
          activeEl.blur()
        }
      }
    }
    globalBlurListenerRef.current = listener
    document.addEventListener('pointerdown', listener, true)
  }

  useEffect(() => {
    return () => {
      if (globalBlurListenerRef.current) {
        document.removeEventListener('pointerdown', globalBlurListenerRef.current, true)
      }
    }
  }, [])

  // [PERF] Local state to track slider values during drag (bypasses Redux for smooth UX)
  const [dragTiltX, setDragTiltX] = useState(null)
  const [dragTiltY, setDragTiltY] = useState(null)
  const [dragOpacity, setDragOpacity] = useState(null)
  const [dragBlur, setDragBlur] = useState(null)
  const [dragCornerRadius, setDragCornerRadius] = useState(null)
  // [PERF] Resolve the PIXI object once for all direct-mutation sliders
  const pixiObject = useMemo(() => {
    if (!selectedLayer?.id) return null
    return getGlobalMotionEngine()?.registeredObjects?.get(selectedLayer.id) || null
  }, [selectedLayer?.id])
  const scrollContainerRef = useRef(null)
  const containerRef = useRef(null)
  const animateButtonRef = useRef(null)

  // ── Audio controls local state ─────────────────────────────────────────────
  const [audioVolume, setAudioVolume] = useState(selectedAudioBlock?.volume ?? 1)
  const [audioMuted, setAudioMuted] = useState(selectedAudioBlock?.muted ?? false)
  const [showAudioVolume, setShowAudioVolume] = useState(false)
  const audioVolumeBtnRef = useRef(null)

  useEffect(() => {
    if (selectedAudioBlock) {
      setAudioVolume(selectedAudioBlock.volume ?? 1)
      setAudioMuted(selectedAudioBlock.muted ?? false)
    }
  }, [selectedAudioBlock?.id, selectedAudioBlock?.volume, selectedAudioBlock?.muted])

  // Render audio pill content (shown when audio block is selected, no canvas/layer selected)
  const renderAudioControls = () => {
    if (!selectedAudioBlock || selectedLayer || selectedCanvas) return null
    const isLight = theme === 'light'

    return (
      <>
        {/* Audio track label (desktop only) */}
        {!isMobileBottom && (
          <div className={`flex items-center gap-1.5 flex-shrink-0 pr-2 mr-1 border-r ${
            isLight ? 'border-black/10' : 'border-white/10'
          }`}>
            <Music className="h-3.5 w-3.5 text-purple-400" strokeWidth={1.5} />
            <span className={`text-[11px] font-semibold max-w-[100px] truncate ${
              isLight ? 'text-gray-600' : 'text-white/70'
            }`}>{selectedAudioBlock.name || 'Audio'}</span>
          </div>
        )}

        {/* Volume & Mute Button - speaker icon only, opens slider panel */}
        <div className="relative flex-shrink-0" ref={audioVolumeBtnRef}>
          <button
            onClick={() => {
              if (isMobileBottom) {
                toggleSubmenu('audioVolume')
              } else {
                setShowAudioVolume(v => !v)
              }
            }}
            className={`h-8 px-2 rounded-[8px] transition-all flex items-center justify-center touch-manipulation border ${
              showAudioVolume
                ? theme === 'light'
                  ? 'bg-purple-500/10 border-purple-500/30 text-purple-600'
                  : 'bg-white/20 border-white/20 text-white'
                : theme === 'light'
                  ? 'text-gray-700 hover:bg-gray-100 border-transparent hover:border-gray-200'
                  : 'text-white hover:bg-white/10 border-transparent hover:border-white/10'
            }`}
            title="Volume & Mute"
          >
            {audioMuted ? (
              <VolumeX className="h-4 w-4" strokeWidth={2} />
            ) : (
              <Volume2 className="h-4 w-4" strokeWidth={2} />
            )}
          </button>

          {/* Volume slider popover — portaled to avoid clip (desktop only) */}
          {!isMobileBottom && (
            <ControlPopover open={showAudioVolume} anchorRef={audioVolumeBtnRef}>
              <div
                className="h-9 flex items-center gap-3 px-4 rounded-lg backdrop-blur-md animate-in fade-in slide-in-from-top-2 duration-200"
                style={{
                  backgroundColor: 'var(--editor-panel-bg)',
                  backdropFilter: 'blur(24px)',
                  WebkitBackdropFilter: 'blur(24px)',
                  border: '1px solid var(--editor-panel-border)',
                  boxShadow: 'var(--editor-panel-shadow)',
                  minWidth: '240px',
                  pointerEvents: 'auto',
                }}
              >
                {/* Speaker icon inside the panel for instant mute/unmute */}
                <button
                  onClick={() => {
                    const newMuted = !audioMuted
                    setAudioMuted(newMuted)
                    onAudioBlockUpdate?.({ id: selectedAudioBlock.id, muted: newMuted })
                  }}
                  className={`p-1 rounded transition-colors ${
                    theme === 'light' ? 'hover:bg-black/5 text-gray-700' : 'hover:bg-white/10 text-white'
                  }`}
                  title={audioMuted ? 'Unmute' : 'Mute'}
                >
                  {audioMuted ? (
                    <VolumeX className="h-4 w-4" strokeWidth={2} />
                  ) : (
                    <Volume2 className="h-4 w-4" strokeWidth={2} />
                  )}
                </button>

                <Slider.Root
                  className="relative flex items-center select-none touch-none grow h-5"
                  value={[audioMuted ? 0 : Math.round(audioVolume * 100)]}
                  onValueChange={(value) => {
                    const v = value[0] / 100
                    setAudioVolume(v)
                    onAudioBlockUpdate?.({ id: selectedAudioBlock.id, volume: v, muted: v === 0 })
                    if (v > 0 && audioMuted) {
                      setAudioMuted(false)
                    } else if (v === 0 && !audioMuted) {
                      setAudioMuted(true)
                    }
                  }}
                  min={0} max={100} step={1}
                >
                  <Slider.Track className={`${theme === 'light' ? 'bg-gray-200' : 'bg-white/10'} relative grow rounded-full h-1`}>
                    <Slider.Range className="absolute bg-[#7c4af0] rounded-full h-full" />
                  </Slider.Track>
                  <Slider.Thumb className={`block w-4 h-4 rounded-full transition-all focus:outline-none cursor-pointer ${theme === 'light' ? 'bg-white border-2 border-[#7c4af0] shadow-sm' : 'bg-white shadow-md hover:scale-110'}`} aria-label="Audio Volume" />
                </Slider.Root>
                <span className={`text-xs font-mono min-w-[32px] text-right shrink-0 ${theme === 'light' ? 'text-gray-700' : 'text-white'}`}>
                  {audioMuted ? '0%' : `${Math.round(audioVolume * 100)}%`}
                </span>
              </div>
            </ControlPopover>
          )}
        </div>

        {/* Separator */}
        <div className={`w-px h-5 flex-shrink-0 ${
          theme === 'light' ? 'bg-black/10' : 'bg-white/10'
        }`} />

        {/* Cut at playhead */}
        <button
          onClick={() => onAudioBlockCut?.(selectedAudioBlock.id)}
          className={`h-8 px-2 rounded-[8px] transition-all flex items-center justify-center touch-manipulation flex-shrink-0 border ${
            theme === 'light'
              ? 'text-gray-700 hover:bg-gray-100 border-transparent hover:border-gray-200'
              : 'text-white hover:bg-white/10 border-transparent hover:border-white/10'
          }`}
          title="Cut audio at playhead"
        >
          <Scissors className="h-4 w-4" strokeWidth={2} />
        </button>

        {/* Delete */}
        <button
          onClick={() => onAudioBlockDelete?.(selectedAudioBlock.id)}
          className={`h-8 px-2 rounded-[8px] transition-all flex items-center justify-center touch-manipulation flex-shrink-0 border ${
            theme === 'light'
              ? 'text-red-500 hover:bg-red-50 border-transparent hover:border-red-200'
              : 'text-red-400 hover:bg-red-500/15 border-transparent hover:border-red-500/25'
          }`}
          title="Delete audio block"
        >
          <Trash2 className="h-4 w-4" strokeWidth={2} />
        </button>
      </>
    )
  }

  // [SLIDER CLIP FIX] Anchors for the portaled control popovers (opacity/blur/radius/tilt).
  const opacityBtnRef = useRef(null)
  const blurBtnRef = useRef(null)
  const radiusBtnRef = useRef(null)
  const tiltBtnRef = useRef(null)
  const [tooltipLeft, setTooltipLeft] = useState(null)

  const updateTooltipPosition = useCallback(() => {
    if (animateButtonRef.current && containerRef.current) {
      const btnRect = animateButtonRef.current.getBoundingClientRect()
      const containerRect = containerRef.current.getBoundingClientRect()
      const center = btnRect.left - containerRect.left + (btnRect.width / 2)
      setTooltipLeft(center)
    }
  }, [])

  useLayoutEffect(() => {
    updateTooltipPosition()
    window.addEventListener('resize', updateTooltipPosition)
    return () => window.removeEventListener('resize', updateTooltipPosition)
  }, [
    updateTooltipPosition,
    selectedLayer?.id,
    selectedCanvas,
    stepsCount,
    showAddStepHint,
    isMotionCaptureActive,
    isMobileBottom
  ])

  const [hasShownAddStepHint, setHasShownAddStepHint] = useState(() => {
    try {
      return localStorage.getItem('vevara_hint_add_step_shown') === 'true'
    } catch (e) {
      return false
    }
  })

  const toggleSubmenu = (menuName) => {
    const turnOn = (() => {
      if (menuName === 'opacity') return !showOpacitySlider
      if (menuName === 'blur') return !showBlurSlider
      if (menuName === 'radius') return !showCornerRadiusSlider
      if (menuName === 'tilt') return !showTiltPanel
      if (menuName === 'color') return !showColorMenu
      if (menuName === 'font') return !showFontMenu
      if (menuName === 'size') return !showSizeMenu
      if (menuName === 'align') return !showAlignMenu
      if (menuName === 'audioVolume') return !showAudioVolume
      return false
    })()

    setShowOpacitySlider(false)
    setShowBlurSlider(false)
    setShowCornerRadiusSlider(false)
    setShowTiltPanel(false)
    setShowColorMenu(false)
    setShowFontMenu(false)
    setShowSizeMenu(false)
    setShowAlignMenu(false)
    setShowAudioVolume(false)

    if (turnOn) {
      if (menuName === 'opacity') setShowOpacitySlider(true)
      if (menuName === 'blur') setShowBlurSlider(true)
      if (menuName === 'radius') setShowCornerRadiusSlider(true)
      if (menuName === 'tilt') setShowTiltPanel(true)
      if (menuName === 'color') setShowColorMenu(true)
      if (menuName === 'font') setShowFontMenu(true)
      if (menuName === 'size') setShowSizeMenu(true)
      if (menuName === 'align') setShowAlignMenu(true)
      if (menuName === 'audioVolume') setShowAudioVolume(true)
      onSubmenuChange?.(menuName)
    } else {
      onSubmenuChange?.(null)
    }
  }

  // Auto-close slider when selection changes
  useEffect(() => {
    setShowOpacitySlider(false)
    setShowBlurSlider(false)
    setShowCornerRadiusSlider(false)
    setShowTiltPanel(false)
    setShowColorMenu(false)
    setShowFontMenu(false)
    setShowSizeMenu(false)
    setShowAlignMenu(false)
    setShowAudioVolume(false)
    onSubmenuChange?.(null)
  }, [selectedLayer?.id, selectedCanvas])

  // Open opacity/blur slider when requested by parent (e.g. from MotionPanel)
  useEffect(() => {
    if (requestOpenControl === 'opacity') {
      setShowOpacitySlider(true)
      setShowBlurSlider(false)
      setShowCornerRadiusSlider(false)
      setShowTiltPanel(false)
      setShowColorMenu(false)
      if (isMobileBottom) onSubmenuChange?.('opacity')
    } else if (requestOpenControl === 'blur') {
      setShowBlurSlider(true)
      setShowOpacitySlider(false)
      setShowCornerRadiusSlider(false)
      setShowTiltPanel(false)
      setShowColorMenu(false)
      if (isMobileBottom) onSubmenuChange?.('blur')
    } else if (requestOpenControl === 'cornerRadius') {
      setShowCornerRadiusSlider(true)
      setShowOpacitySlider(false)
      setShowBlurSlider(false)
      setShowTiltPanel(false)
      setShowColorMenu(false)
      if (isMobileBottom) onSubmenuChange?.('radius')
    } else if (requestOpenControl === 'tilt') {
      setShowTiltPanel(true)
      setShowOpacitySlider(false)
      setShowBlurSlider(false)
      setShowCornerRadiusSlider(false)
      setShowColorMenu(false)
      if (isMobileBottom) onSubmenuChange?.('tilt')
    } else if (requestOpenControl === 'color') {
      setShowColorMenu(true)
      setShowOpacitySlider(false)
      setShowBlurSlider(false)
      setShowCornerRadiusSlider(false)
      setShowTiltPanel(false)
      if (isMobileBottom) onSubmenuChange?.('color')
    }
  }, [requestOpenControl, isMobileBottom, onSubmenuChange])

  // Auto-scroll removed — motion controls are now in a fixed right zone
  // and don't need scroll-into-view.

  const handleLayerUpdate = (updates) => {
    if (onLayerUpdate) {
      onLayerUpdate(updates, selectedLayer?.id)
    }
  }

  // Check if shape supports corner radius (rect/square only)
  const hasCorners = () => {
    if (!selectedLayer || selectedLayer.type !== LAYER_TYPES.SHAPE) return false
    const st = selectedLayer.data?.shapeType || 'rect'
    return st === 'rect' || st === 'square'
  }

  // Check if fill is transparent
  const isTransparent = () => {
    if (!selectedLayer) return false
    if (selectedLayer.type === LAYER_TYPES.SHAPE) {
      return !selectedLayer.data?.fill || selectedLayer.data?.fill === 'transparent' || selectedLayer.data?.fill === null
    }
    return false
  }

  // Get color based on layer type
  const getColor = () => {
    if (!selectedLayer) return '#ffffff'
    if (selectedLayer.type === LAYER_TYPES.SHAPE) {
      const fill = selectedLayer.data?.fill
      if (!fill || fill === 'transparent' || fill === null) {
        return '#ffffff' // Default color for color picker when transparent
      }
      return fill || '#3b82f6'
    }
    if (selectedLayer.type === LAYER_TYPES.TEXT) {
      return selectedLayer.data?.color || '#ffffff'
    }
    return '#ffffff'
  }

  // Get stroke color
  const getStrokeColor = () => {
    if (!selectedLayer) return '#000000'
    return selectedLayer.data?.stroke || '#000000'
  }

  // Get stroke width
  const getStrokeWidth = () => {
    if (!selectedLayer) return 0
    return selectedLayer.data?.strokeWidth || 0
  }

  // Get stroke style
  const getStrokeStyle = () => {
    if (!selectedLayer) return 'solid'
    return selectedLayer.data?.strokeStyle || 'solid'
  }


  // Get font family for text
  const getFontFamily = () => {
    if (!selectedLayer || selectedLayer.type !== LAYER_TYPES.TEXT) return 'Arial'
    return selectedLayer.data?.fontFamily || 'Arial'
  }

  // Get font size for text
  function getFontSize() {
    if (!selectedLayer || selectedLayer.type !== LAYER_TYPES.TEXT) return 16
    const baseFontSize = selectedLayer.data?.fontSize || 16
    const scale = selectedLayer.scaleX || 1
    return Math.round(baseFontSize * scale)
  }


  // Get canvas background color
  const getCanvasBackgroundColor = () => {
    if (!currentScene) return '#ffffff'
    const bgColor = currentScene.backgroundColor !== undefined ? currentScene.backgroundColor : 0xffffff
    // Convert hex number to hex string
    if (typeof bgColor === 'number') {
      return '#' + bgColor.toString(16).padStart(6, '0')
    }
    return bgColor
  }

  // Common fonts list
  // List of artistic and standard fonts
  const fonts = [
    'Arial',
    'Inter',
    'Poppins',
    'Montserrat',
    'Outfit',
    'Syne',
    'Bebas Neue',
    'Anton',
    'Unbounded',
    'Righteous',
    'Bungee',
    'Bangers',
    'Luckiest Guy',
    'Londrina Solid',
    'Titan One',
    'Special Elite',
    'Archivo Black',
    'Press Start 2P',
    'Cinzel Decorative',
    'Abril Fatface',
    'Permanent Marker',
    'Playfair Display',
    'Cormorant Garamond',
    'Bodoni Moda',
    'Cinzel',
    'Philosopher',
    'Tenor Sans',
    'Prata',
    'EB Garamond',
    'Manrope',
    'Space Grotesk',
    'Georgia',
    'Times New Roman',
    'Verdana',
    'Courier New',
    'Helvetica',
  ]



  // ─── Motion controls: Undo/Redo + Cancel + Done (capture mode only) ──────────────────
  // Layout: [Undo/Redo + label (grows)] | [Cancel] | [Done (wider, primary)]
  const renderMotionControls = () => {
    if (!isMotionCaptureActive) return null
    return (
      <>
        {/* Left: Undo/Redo + optional label — grows to fill available space */}
        <div className="flex items-center gap-1 px-2 flex-1">
          <div className={`flex items-center gap-0.5 pr-2 mr-1 border-r border-black/10 dark:border-white/10`}>
            <button
              onClick={onUndo}
              disabled={!canUndo}
              className={`h-8 w-8 rounded-[8px] transition-all flex items-center justify-center touch-manipulation disabled:opacity-30 disabled:pointer-events-none ${
                theme === 'light'
                  ? 'text-gray-700 hover:bg-gray-100 active:bg-gray-200'
                  : 'text-white hover:bg-white/10 active:bg-white/20'
              }`}
              title="Undo (Ctrl+Z)"
              type="button"
            >
              <Undo2 className="h-4 w-4" strokeWidth={2} />
            </button>
            <button
              onClick={onRedo}
              disabled={!canRedo}
              className={`h-8 w-8 rounded-[8px] transition-all flex items-center justify-center touch-manipulation disabled:opacity-30 disabled:pointer-events-none ${
                theme === 'light'
                  ? 'text-gray-700 hover:bg-gray-100 active:bg-gray-200'
                  : 'text-white hover:bg-white/10 active:bg-white/20'
              }`}
              title="Redo (Ctrl+Shift+Z)"
              type="button"
            >
              <Redo2 className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>
          {editingMomentLabel && (
            <span className={`text-xs font-medium px-1 whitespace-nowrap ${
              theme === 'light' ? 'text-gray-500' : 'text-zinc-400'
            }`}>
              {editingMomentLabel}
            </span>
          )}
        </div>

        {/* Cancel — compact secondary action, immediately left of Done */}
        <button
          onClick={() => { onCancelMotion?.(); setShowAddStepHint(false) }}
          className={`flex items-center justify-center px-4 border-l transition-all duration-200 touch-manipulation whitespace-nowrap font-semibold text-xs ${
            theme === 'light'
              ? 'text-gray-600 hover:bg-gray-100 active:bg-gray-200 border-black/10'
              : 'text-zinc-300 hover:bg-white/10 active:bg-white/20 border-white/10'
          }`}
        >
          Cancel
        </button>

        {/* Done — wider primary action on the far right */}
        <div ref={animateButtonRef} className="flex">
          <button
            data-tutorial="add-step-button"
            onClick={() => { if (isDoneEnabled) { onApplyMotion?.(); setShowAddStepHint(false) } }}
            className={`flex items-center justify-center px-6 border-l transition-all duration-300 touch-manipulation whitespace-nowrap font-semibold text-xs ${
              isDoneEnabled
                ? 'bg-[#7c4af0] text-white border-[#7c4af0] shadow-[0_0_20px_rgba(124,74,240,0.6)] animate-pulse-glow hover:bg-[#8b5cf6]'
                : (theme === 'light'
                  ? 'text-gray-400 border-black/10 cursor-default'
                  : 'text-zinc-500 border-white/10 cursor-default')
            }`}
            title="Done"
          >
            Save moment
          </button>
        </div>
      </>
    )
  }

  if (!isMobileBottom && isMobileScreen) {
    return null
  }
  if (isMobileBottom && !isMobileScreen) {
    return null
  }

  return (
    <div
      ref={containerRef}
      className={isMobileBottom
        ? "relative flex flex-col items-center justify-center w-full"
        : "relative pointer-events-none w-full"
      }
      style={isMobileBottom ? undefined : { height: '54px' }}
    >
      {/* ── Desktop: centered pill ── */}
      {!isMobileBottom && (
        <div className="absolute inset-0 pointer-events-none">
          {/* Motion capture mode: standalone centered pill with Cancel / label / Done */}
          {isMotionCaptureActive && (
          <div
            className="absolute top-1 flex items-center pointer-events-auto"
            style={{ left: '50%', transform: 'translateX(-50%)' }}
          >
            <div
              className="h-10 flex items-stretch overflow-hidden backdrop-blur-md flex-shrink-0"
              style={{
                backgroundColor: 'var(--editor-panel-bg)',
                backdropFilter: 'blur(24px)',
                WebkitBackdropFilter: 'blur(24px)',
                border: '1px solid var(--editor-panel-border)',
                borderRadius: '12px',
              }}
            >
              {renderMotionControls()}
            </div>
          </div>
          )}

          {/* Normal mode: single centered pill with property controls */}
          {!isMotionCaptureActive && (
          <div
            className="absolute top-1 flex items-center justify-center pointer-events-auto"
            style={{ left: '50%', transform: 'translateX(-50%)' }}
          >
            <div
              className="h-10 flex items-center backdrop-blur-md"
              style={{
                backgroundColor: 'var(--editor-panel-bg)',
                backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
                border: '1px solid var(--editor-panel-border)',
                borderRadius: '12px',
              }}
            >
            <div
              ref={scrollContainerRef}
              className="flex items-center gap-3 px-3 h-full overflow-x-auto scrollbar-none"
              style={{ pointerEvents: 'auto' }}
            >

        {/* ── Audio Block Controls — shown when audio block is selected (no layer/canvas) ── */}
        {renderAudioControls()}

        {/* ── Normal layer/canvas controls — hidden when audio block active ── */}
        {(!selectedAudioBlock || selectedLayer || selectedCanvas) && <>

        {/* Canvas Background Color Picker - Specific UI */}
        {selectedCanvas && currentScene && (
          <div className="flex items-center gap-2 flex-shrink-0 mr-2">
            <button
              onClick={() => { if (onOpenColorPicker) { onOpenColorPicker('canvas') } }}
              className={`w-6 h-6 rounded-full border-2 cursor-pointer transition-all hover:ring-2 ${theme === 'light' ? 'border-gray-300 hover:ring-gray-300' : 'border-zinc-600 hover:ring-zinc-500'}`}
              style={{
                backgroundColor: getCanvasBackgroundColor(),
                backgroundImage: (getCanvasBackgroundColor() === '#ffffff' || getCanvasBackgroundColor() === '#FFFFFF') ? 'conic-gradient(from 0deg, red, yellow, lime, aqua, blue, magenta, red)' : undefined
              }}
              title="Canvas Background Color"
            />
          </div>
        )}

        {/* Color Picker - Circular (Generic for Layers) */}
        {!selectedCanvas && (
          <div className="relative flex-shrink-0 flex justify-center" style={{ width: '32px' }}>
            <button
              onClick={() => {
                if (onOpenColorPicker && selectedLayer) {
                  if (selectedLayer.type === LAYER_TYPES.BACKGROUND) {
                    onOpenColorPicker('canvas')
                  } else if (selectedLayer.type === LAYER_TYPES.SHAPE || selectedLayer.type === LAYER_TYPES.TEXT) {
                    onOpenColorPicker(selectedLayer.type === LAYER_TYPES.SHAPE ? 'fill' : 'text')
                  }
                }
              }}
              disabled={!selectedLayer || (selectedLayer.type !== LAYER_TYPES.SHAPE && selectedLayer.type !== LAYER_TYPES.TEXT && selectedLayer.type !== LAYER_TYPES.BACKGROUND)}
              className={`w-6 h-6 rounded-full cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-all hover:ring-2 ${theme === 'light' ? 'hover:ring-gray-300 border border-gray-200' : 'hover:ring-zinc-500 border border-white/10'}`}
              style={{
                backgroundColor: selectedLayer?.type === LAYER_TYPES.BACKGROUND ? getCanvasBackgroundColor() : (isTransparent() ? 'transparent' : getColor()),
                backgroundImage: (selectedLayer?.type === LAYER_TYPES.BACKGROUND && (getCanvasBackgroundColor() === '#ffffff' || getCanvasBackgroundColor() === '#FFFFFF'))
                  ? 'conic-gradient(from 0deg, red, yellow, lime, aqua, blue, magenta, red)'
                  : (selectedLayer?.type !== LAYER_TYPES.BACKGROUND && !isTransparent() && (getColor() === '#ffffff' || getColor() === '#FFFFFF'))
                    ? 'conic-gradient(from 0deg, red, yellow, lime, aqua, blue, magenta, red)'
                    : (selectedLayer?.type !== LAYER_TYPES.BACKGROUND && isTransparent())
                      ? 'linear-gradient(45deg, #666 25%, transparent 25%, transparent 75%, #666 75%, #666), linear-gradient(45deg, #666 25%, transparent 25%, transparent 75%, #666 75%, #666)'
                      : undefined,
                backgroundSize: (selectedLayer?.type !== LAYER_TYPES.BACKGROUND && isTransparent()) ? '6px 6px' : undefined,
                backgroundPosition: (selectedLayer?.type !== LAYER_TYPES.BACKGROUND && isTransparent()) ? '0 0, 3px 3px' : undefined,
              }}
              title={selectedLayer?.type === LAYER_TYPES.BACKGROUND ? "Background Color" : "Fill Color"}
            />
          </div>
        )}

        {/* Font Selection - Only for text */}
        {selectedLayer?.type === LAYER_TYPES.TEXT && (
          <>
            <DropdownMenu
              trigger={
                <button className={`h-8 px-3 rounded-[8px] text-xs transition-all flex items-center gap-2 outline-none min-w-[120px] ${theme === 'light'
                  ? 'bg-gray-100 text-gray-900 border border-gray-200 hover:bg-gray-200'
                  : 'bg-white/5 text-white/90 border border-white/5 hover:bg-white/10'}`}>
                  <span className="truncate flex-1 text-left font-medium">{getFontFamily()}</span>
                  <ChevronDown className="h-3.5 w-3.5 opacity-60" strokeWidth={2} />
                </button>
              }
            >
              <div className="max-h-[300px] overflow-y-auto py-1 scrollbar-hide">
                {fonts.map(font => (
                  <DropdownMenuItem
                    key={font}
                    onClick={() => handleLayerUpdate({ data: { ...selectedLayer.data, fontFamily: font } })}
                  >
                    <span style={{ fontFamily: font }}>{font}</span>
                  </DropdownMenuItem>
                ))}
              </div>
            </DropdownMenu>

            <div className="flex items-center">
              <input
                type="number"
                value={localFontSize}
                onChange={(e) => setLocalFontSize(e.target.value)}
                onFocus={handleInputFocus}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const val = parseInt(localFontSize, 10)
                    if (!isNaN(val) && val > 0) {
                      handleLayerUpdate({
                        data: { ...selectedLayer.data, fontSize: val },
                        scaleX: 1,
                        scaleY: 1
                      })
                      e.currentTarget.blur()
                    }
                  }
                }}
                onBlur={() => {
                  if (globalBlurListenerRef.current) {
                    document.removeEventListener('pointerdown', globalBlurListenerRef.current, true)
                    globalBlurListenerRef.current = null
                  }
                  const val = parseInt(localFontSize, 10)
                  if (!isNaN(val) && val > 0) {
                    handleLayerUpdate({
                      data: { ...selectedLayer.data, fontSize: val },
                      scaleX: 1,
                      scaleY: 1
                    })
                  } else {
                    setLocalFontSize(currentFontSize.toString())
                  }
                }}
                className={`font-size-input w-12 h-8 px-1.5 rounded-l-[8px] text-xs font-medium outline-none text-center border-y border-l transition-all ${theme === 'light'
                  ? 'bg-gray-100 text-gray-900 border-gray-200 focus:border-purple-500/50 focus:bg-white'
                  : 'bg-white/5 text-white/90 border-white/5 focus:border-purple-500/50 focus:bg-white/10'}`}
                min="1"
              />
              <DropdownMenu
                trigger={
                  <button className={`h-8 px-1 rounded-r-[8px] transition-all flex items-center justify-center outline-none border-y border-r ${theme === 'light'
                    ? 'bg-gray-100 text-gray-900 border-gray-200 hover:bg-gray-200'
                    : 'bg-white/5 text-white/90 border-white/5 hover:bg-white/10'}`}>
                    <ChevronDown className="h-3 w-3 opacity-60" strokeWidth={2} />
                  </button>
                }
              >
                <div className="max-h-[300px] overflow-y-auto py-1 scrollbar-hide">
                  {[8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 64, 72, 96, 120].map(size => (
                    <DropdownMenuItem
                      key={size}
                      onClick={() => {
                        const newSize = parseInt(size, 10)
                        handleLayerUpdate({
                          data: { ...selectedLayer.data, fontSize: newSize },
                          scaleX: 1,
                          scaleY: 1
                        })
                      }}
                    >
                      {size}
                    </DropdownMenuItem>
                  ))}
                </div>
              </DropdownMenu>
            </div>

            <DropdownMenu
              trigger={
                <button
                  className={`h-8 px-2 rounded-[8px] transition-all flex items-center justify-center min-w-[44px] border ${selectedLayer.data?.enableFlow
                    ? 'bg-purple-600/20 border-purple-500/50 text-purple-400 shadow-[0_0_10px_rgba(168,85,247,0.2)]'
                    : (theme === 'light'
                      ? 'text-gray-700 hover:bg-gray-100 border-transparent hover:border-gray-200'
                      : 'text-white hover:bg-white/10 border-transparent hover:border-white/10')
                    }`}
                  title={selectedLayer.data?.enableFlow ? "Water Flow Enabled" : `Align: ${selectedLayer.data?.textAlign || 'left'}`}
                >
                  <div className="flex items-center gap-1.5">
                    <div className="relative">
                      {selectedLayer.data?.textAlign === 'center' ? (
                        <AlignCenter className="h-4 w-4 opacity-100" strokeWidth={2.5} />
                      ) : selectedLayer.data?.textAlign === 'right' ? (
                        <AlignRight className="h-4 w-4 opacity-100" strokeWidth={2.5} />
                      ) : (
                        <AlignLeft className="h-4 w-4 opacity-100" strokeWidth={2.5} />
                      )}
                      {selectedLayer.data?.enableFlow && (
                        <Waves className="absolute -top-1 -right-1 h-2 w-2 text-[#22c55e] opacity-90 animate-pulse" strokeWidth={2.5} />
                      )}
                    </div>
                    <ChevronDown className="h-3 w-3 opacity-40" strokeWidth={2.5} />
                  </div>
                </button>
              }
            >
              <div className="py-1 min-w-[180px]">
                <DropdownMenuItem onClick={() => handleLayerUpdate({ data: { ...selectedLayer.data, textAlign: 'left' } })}>
                  <div className={`flex items-center justify-between w-full ${selectedLayer.data?.textAlign === 'left' ? 'text-purple-400' : ''}`}>
                    <div className="flex items-center gap-3"><AlignLeft className="h-4 w-4" strokeWidth={2} /><span className="font-medium">Left Alignment</span></div>
                    {selectedLayer.data?.textAlign === 'left' && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleLayerUpdate({ data: { ...selectedLayer.data, textAlign: 'center' } })}>
                  <div className={`flex items-center justify-between w-full ${selectedLayer.data?.textAlign === 'center' ? 'text-purple-400' : ''}`}>
                    <div className="flex items-center gap-3"><AlignCenter className="h-4 w-4" strokeWidth={2} /><span className="font-medium">Center</span></div>
                    {selectedLayer.data?.textAlign === 'center' && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleLayerUpdate({ data: { ...selectedLayer.data, textAlign: 'right' } })}>
                  <div className={`flex items-center justify-between w-full ${selectedLayer.data?.textAlign === 'right' ? 'text-purple-400' : ''}`}>
                    <div className="flex items-center gap-3"><AlignRight className="h-4 w-4" strokeWidth={2} /><span className="font-medium">Right Alignment</span></div>
                    {selectedLayer.data?.textAlign === 'right' && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                  </div>
                </DropdownMenuItem>
                <div className="h-px bg-white/5 my-1 mx-2" />
                <DropdownMenuItem onClick={() => handleLayerUpdate({ data: { ...selectedLayer.data, enableFlow: !selectedLayer.data?.enableFlow } })}>
                  <div className={`flex items-center justify-between w-full ${selectedLayer.data?.enableFlow ? 'text-purple-400 font-semibold' : ''}`}>
                    <div className="flex items-center gap-3"><Waves className={`h-4 w-4 ${selectedLayer.data?.enableFlow ? 'animate-pulse' : ''}`} strokeWidth={2} /><span className="font-medium">Water Flow (Wrap)</span></div>
                    {selectedLayer.data?.enableFlow && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                  </div>
                </DropdownMenuItem>
              </div>
            </DropdownMenu>
          </>
        )}

        {/* Shape-specific controls */}
        {selectedLayer?.type === LAYER_TYPES.SHAPE && (
          <DropdownMenu
            trigger={
              <button
                className={`h-8 px-2 rounded-[8px] transition-colors flex items-center gap-1.5 touch-manipulation whitespace-nowrap flex-shrink-0 border ${theme === 'light'
                  ? 'text-gray-700 hover:bg-gray-100 active:bg-gray-200 border-transparent hover:border-gray-200'
                  : 'text-white hover:bg-white/10 active:bg-white/15 border-transparent hover:border-white/10'}`}
                title="Stroke Style"
              >
                <Minus className="h-4 w-4 flex-shrink-0 opacity-60" strokeWidth={2} />
                <span className="text-xs font-medium">Stroke</span>
                <ChevronDown className="h-3 w-3 flex-shrink-0 opacity-60" strokeWidth={2} />
              </button>
            }
          >
            <div className={`p-4 min-w-[280px] ${theme === 'light' ? 'bg-white' : 'bg-zinc-900'} rounded-xl shadow-2xl`}>
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <label className={`text-xs ${theme === 'light' ? 'text-gray-500' : 'text-gray-300'}`}>Width</label>
                  <span className={`text-xs font-medium ${theme === 'light' ? 'text-gray-900' : 'text-white'}`}>{getStrokeWidth()}px</span>
                </div>
                <Slider.Root
                  className="relative flex items-center select-none touch-none w-full h-5"
                  value={[getStrokeWidth()]}
                  onValueChange={(value) => {
                    const newStrokeWidth = value[0]
                    const updatedData = { ...selectedLayer.data, strokeWidth: newStrokeWidth }
                    if (newStrokeWidth > 0 && (!selectedLayer.data?.stroke || selectedLayer.data.stroke === '')) {
                      updatedData.stroke = '#000000'
                    }
                    handleLayerUpdate({ data: updatedData })
                  }}
                  min={0} max={20} step={0.5}
                >
                  <Slider.Track className={`${theme === 'light' ? 'bg-gray-100' : 'bg-zinc-700'} relative grow rounded-full h-1.5`}>
                    <Slider.Range className={`absolute ${theme === 'light' ? 'bg-[#7c4af0]' : 'bg-white'} rounded-full h-full`} />
                  </Slider.Track>
                  <Slider.Thumb className={`block w-4 h-4 rounded-full shadow-md focus:outline-none focus:ring-2 ${theme === 'light' ? 'bg-white border-2 border-[#7c4af0] focus:ring-[#7c4af0]' : 'bg-white hover:bg-zinc-100 focus:ring-white focus:ring-offset-2 focus:ring-offset-zinc-800'}`} />
                </Slider.Root>
              </div>
              <div className="mb-4">
                <label className={`text-xs mb-2 block ${theme === 'light' ? 'text-gray-500' : 'text-gray-300'}`}>Color</label>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { if (onOpenColorPicker) { onOpenColorPicker('stroke') } }}
                    className={`w-12 h-8 rounded border-2 cursor-pointer transition-colors ${theme === 'light' ? 'border-gray-200 hover:border-gray-300' : 'border-zinc-600 hover:border-zinc-500'}`}
                    style={{ backgroundColor: getStrokeColor() }}
                    title="Stroke Color"
                  />
                  <input
                    type="text"
                    value={getStrokeColor()}
                    onChange={(e) => {
                      if (/^#[0-9A-Fa-f]{0,6}$/.test(e.target.value)) {
                        handleLayerUpdate({ data: { ...selectedLayer.data, stroke: e.target.value } })
                      }
                    }}
                    className={`flex-1 bg-transparent border rounded px-2 py-1.5 text-xs outline-none focus:border-[#7c4af0] ${theme === 'light' ? 'border-gray-200 text-gray-900' : 'border-zinc-700 text-white'}`}
                    placeholder="#000000"
                  />
                </div>
              </div>
              <div>
                <label className={`text-xs mb-2 block ${theme === 'light' ? 'text-gray-500' : 'text-gray-300'}`}>Style</label>
                <div className="flex gap-2">
                  {['solid', 'dashed', 'dotted'].map((style) => (
                    <button
                      key={style}
                      onClick={() => { handleLayerUpdate({ data: { ...selectedLayer.data, strokeStyle: style } }) }}
                      className={`flex-1 px-3 py-2 rounded text-xs font-medium transition-colors ${getStrokeStyle() === style
                        ? 'bg-[#7c4af0] text-white shadow-lg shadow-[#7c4af0]/20'
                        : (theme === 'light' ? 'bg-gray-100 text-gray-600 hover:bg-gray-200' : 'bg-white/5 text-gray-300 hover:bg-white/10')
                        }`}
                    >
                      {style.charAt(0).toUpperCase() + style.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </DropdownMenu>
        )}

        {/* Opacity Control — [PERF] Direct PIXI mutation during drag, Redux sync on release */}
        {selectedLayer && selectedLayer.type !== LAYER_TYPES.BACKGROUND && (
          <div className="relative flex-shrink-0">
            <button
              ref={opacityBtnRef}
              onClick={() => { toggleSubmenu('opacity') }}
              className={`h-8 px-2 rounded-[8px] transition-all flex items-center gap-1.5 touch-manipulation whitespace-nowrap border ${theme === 'light'
                ? (showOpacitySlider ? 'bg-purple-500/10 border-purple-500/30 text-purple-600' : 'text-gray-700 hover:bg-gray-100 border-transparent hover:border-gray-200')
                : (showOpacitySlider ? 'bg-white/20 border-white/20 text-white' : 'text-white hover:bg-white/10 border-transparent hover:border-white/10')}`}
              title="Layer Transparency"
            >
              <Ghost className="h-4 w-4 flex-shrink-0 opacity-70" strokeWidth={2} />
            </button>
            <ControlPopover open={showOpacitySlider} anchorRef={opacityBtnRef}>{showOpacitySlider && (() => {
              // [PERF] Resolve PIXI object fresh in scope (same pattern as tilt for live visual updates)
              const pixiObj = selectedLayer?.id
                ? getGlobalMotionEngine()?.registeredObjects?.get(selectedLayer.id)
                : null
              return (
              <div
                className="h-9 flex items-center gap-3 px-4 rounded-lg backdrop-blur-md animate-in fade-in slide-in-from-top-2 duration-200"
                style={{
                  backgroundColor: 'var(--editor-panel-bg)',
                  backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
                  border: '1px solid var(--editor-panel-border)',
                  boxShadow: 'var(--editor-panel-shadow)',
                  minWidth: '240px', pointerEvents: 'auto'
                }}
              >
                <span className={`text-[10px] uppercase font-bold tracking-wider select-none shrink-0 ${theme === 'light' ? 'text-gray-500' : 'text-white/60'}`}>Opacity</span>
                <Slider.Root
                  className="relative flex items-center select-none touch-none grow h-5"
                  value={[Math.round(((dragOpacity !== null ? dragOpacity : selectedLayer.opacity) ?? 1) * 100)]}
                  onValueChange={(value) => {
                    const v = value[0] / 100
                    if (pixiObj && !pixiObj.destroyed) {
                      if (pixiObj._tiltHidden && pixiObj._tiltMesh && !pixiObj._tiltMesh.destroyed) {
                        pixiObj._intendedAlpha = v
                        pixiObj._tiltMesh.alpha = v
                      } else {
                        pixiObj.alpha = v
                      }
                    }
                    setDragOpacity(v)
                  }}
                  onValueCommit={(value) => {
                    const v = value[0] / 100
                    handleLayerUpdate({ opacity: v })
                    setDragOpacity(null)
                  }}
                  min={0} max={100} step={1}
                >
                  <Slider.Track className={`${theme === 'light' ? 'bg-gray-200' : 'bg-white/10'} relative grow rounded-full h-1`}>
                    <Slider.Range className={`absolute ${theme === 'light' ? 'bg-[#7c4af0]' : 'bg-white'} rounded-full h-full`} />
                  </Slider.Track>
                  <Slider.Thumb className={`block w-4 h-4 rounded-full transition-all focus:outline-none cursor-pointer ${theme === 'light' ? 'bg-white border-2 border-[#7c4af0] shadow-sm' : 'bg-white shadow-md hover:scale-110'}`} aria-label="Layer Opacity" />
                </Slider.Root>
                <span className={`text-xs font-mono min-w-[32px] text-right shrink-0 ${theme === 'light' ? 'text-gray-700' : 'text-white'}`}>
                  {Math.round(((dragOpacity !== null ? dragOpacity : selectedLayer.opacity) ?? 1) * 100)}%
                </span>
              </div>
              )
            })()}</ControlPopover>
          </div>
        )}

        {/* Blur Control — [PERF] Direct PIXI mutation during drag, Redux sync on release */}
        {selectedLayer && selectedLayer.type !== LAYER_TYPES.BACKGROUND && (
          <div className="relative flex-shrink-0">
            <button
              ref={blurBtnRef}
              onClick={() => { toggleSubmenu('blur') }}
              className={`h-8 px-2 rounded-[8px] transition-all flex items-center gap-1.5 touch-manipulation whitespace-nowrap border ${theme === 'light'
                ? (showBlurSlider ? 'bg-purple-500/10 border-purple-500/30 text-purple-600' : 'text-gray-700 hover:bg-gray-100 border-transparent hover:border-gray-200')
                : (showBlurSlider ? 'bg-white/20 border-white/20 text-white' : 'text-white hover:bg-white/10 border-transparent hover:border-white/10')}`}
              title="Layer Blur"
            >
              <Droplets className="h-4 w-4 flex-shrink-0 opacity-70" strokeWidth={2} />
            </button>
            <ControlPopover open={showBlurSlider} anchorRef={blurBtnRef}>{showBlurSlider && (() => {
              const pixiObj = selectedLayer?.id
                ? getGlobalMotionEngine()?.registeredObjects?.get(selectedLayer.id)
                : null
              return (
              <div
                className="h-9 flex items-center gap-3 px-4 rounded-lg backdrop-blur-md animate-in fade-in slide-in-from-top-2 duration-200"
                style={{
                  backgroundColor: 'var(--editor-panel-bg)',
                  backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
                  border: '1px solid var(--editor-panel-border)',
                  boxShadow: 'var(--editor-panel-shadow)',
                  minWidth: '240px', pointerEvents: 'auto'
                }}
              >
                <span className={`text-[10px] uppercase font-bold tracking-wider select-none shrink-0 ${theme === 'light' ? 'text-gray-500' : 'text-white/60'}`}>Blur</span>
                <Slider.Root
                  className="relative flex items-center select-none touch-none grow h-5"
                  value={[Math.min(BLUR_MAX, (dragBlur !== null ? dragBlur : selectedLayer.blur) ?? 0)]}
                  onValueChange={(value) => {
                    const v = Math.max(0, Math.min(BLUR_MAX, value[0] ?? 0))
                    if (pixiObj && !pixiObj.destroyed) {
                      if (!pixiObj._blurFilter) {
                        pixiObj._blurFilter = new PIXI.BlurFilter()
                        pixiObj._blurFilter.quality = 4
                      }
                      pixiObj._blurFilter.strength = computeBlurPhysicalStrength(v, pixiObj)
                      if (!pixiObj.filters?.includes(pixiObj._blurFilter)) {
                        pixiObj.filters = pixiObj.filters ? [...pixiObj.filters, pixiObj._blurFilter] : [pixiObj._blurFilter]
                      }
                    }
                    setDragBlur(v)
                  }}
                  onValueCommit={(value) => {
                    const v = Math.max(0, Math.min(BLUR_MAX, value[0] ?? 0))
                    handleLayerUpdate({ blur: v })
                    setDragBlur(null)
                  }}
                  min={0} max={BLUR_MAX} step={0.5}
                >
                  <Slider.Track className={`${theme === 'light' ? 'bg-gray-200' : 'bg-white/10'} relative grow rounded-full h-1`}>
                    <Slider.Range className={`absolute ${theme === 'light' ? 'bg-[#7c4af0]' : 'bg-white'} rounded-full h-full`} />
                  </Slider.Track>
                  <Slider.Thumb className={`block w-4 h-4 rounded-full transition-all focus:outline-none cursor-pointer ${theme === 'light' ? 'bg-white border-2 border-[#7c4af0] shadow-sm' : 'bg-white shadow-md hover:scale-110'}`} aria-label="Layer Blur" />
                </Slider.Root>
                <span className={`text-xs font-mono min-w-[32px] text-right shrink-0 ${theme === 'light' ? 'text-gray-700' : 'text-white'}`}>
                  {Math.round(Math.min(BLUR_MAX, (dragBlur !== null ? dragBlur : selectedLayer.blur) ?? 0))}
                </span>
              </div>
              )
            })()}</ControlPopover>
          </div>
        )}

        {/* Corner Radius Control — [PERF] Direct PIXI mutation during drag, Redux sync on release */}
        {selectedLayer?.type === LAYER_TYPES.SHAPE && hasCorners() && (
          <div className="relative flex-shrink-0">
            <button
              ref={radiusBtnRef}
              onClick={() => { toggleSubmenu('radius') }}
              className={`h-8 px-2 rounded-[8px] transition-all flex items-center gap-1.5 touch-manipulation whitespace-nowrap border ${theme === 'light'
                ? (showCornerRadiusSlider ? 'bg-purple-500/10 border-purple-500/30 text-purple-600' : 'text-gray-700 hover:bg-gray-100 border-transparent hover:border-gray-200')
                : (showCornerRadiusSlider ? 'bg-white/20 border-white/20 text-white' : 'text-white hover:bg-white/10 border-transparent hover:border-white/10')}`}
              title="Corner Radius"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 flex-shrink-0 opacity-70">
                <path d="M21 4H11C7.13401 4 4 7.13401 4 11V21" />
              </svg>
            </button>
            <ControlPopover open={showCornerRadiusSlider} anchorRef={radiusBtnRef}>{showCornerRadiusSlider && (() => {
              const pixiObj = selectedLayer?.id
                ? getGlobalMotionEngine()?.registeredObjects?.get(selectedLayer.id)
                : null
              return (
              <div
                className="h-9 flex items-center gap-3 px-4 rounded-lg backdrop-blur-md animate-in fade-in slide-in-from-top-2 duration-200"
                style={{
                  backgroundColor: 'var(--editor-panel-bg)',
                  backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
                  border: '1px solid var(--editor-panel-border)',
                  boxShadow: 'var(--editor-panel-shadow)',
                  minWidth: '240px', pointerEvents: 'auto'
                }}
              >
                <span className={`text-[10px] uppercase font-bold tracking-wider select-none shrink-0 ${theme === 'light' ? 'text-gray-500' : 'text-white/60'}`}>Radius</span>
                <Slider.Root
                  className="relative flex items-center select-none touch-none grow h-5"
                  value={[(dragCornerRadius !== null ? dragCornerRadius : selectedLayer.data?.cornerRadius) ?? 0]}
                  onValueChange={(value) => {
                    const v = Math.max(0, Math.min(CORNER_RADIUS_MAX, Math.round(value[0] ?? 0)))
                    if (pixiObj && !pixiObj.destroyed) {
                      if (typeof pixiObj.cornerRadius !== 'undefined') {
                        pixiObj.cornerRadius = v
                      } else if (pixiObj._hasReactiveRadiusProperties) {
                        pixiObj._cornerRadius = v
                        pixiObj._applyAnimatedCornerRadius?.()
                      }
                    }
                    setDragCornerRadius(v)
                  }}
                  onValueCommit={(value) => {
                    const v = Math.max(0, Math.min(CORNER_RADIUS_MAX, Math.round(value[0] ?? 0)))
                    handleLayerUpdate({ data: { ...selectedLayer.data, cornerRadius: v } })
                    setDragCornerRadius(null)
                  }}
                  min={0}
                  max={Math.min(CORNER_RADIUS_MAX, Math.min(selectedLayer.width || 100, selectedLayer.height || 100) / 2)}
                  step={1}
                >
                  <Slider.Track className={`${theme === 'light' ? 'bg-gray-200' : 'bg-white/10'} relative grow rounded-full h-1`}>
                    <Slider.Range className={`absolute ${theme === 'light' ? 'bg-[#7c4af0]' : 'bg-white'} rounded-full h-full`} />
                  </Slider.Track>
                  <Slider.Thumb className={`block w-4 h-4 rounded-full transition-all focus:outline-none cursor-pointer ${theme === 'light' ? 'bg-white border-2 border-[#7c4af0] shadow-sm' : 'bg-white shadow-md hover:scale-110'}`} aria-label="Corner Radius" />
                </Slider.Root>
                <span className={`text-xs font-mono min-w-[36px] text-right shrink-0 ${theme === 'light' ? 'text-gray-700' : 'text-white'}`}>
                  {Math.round((dragCornerRadius !== null ? dragCornerRadius : selectedLayer.data?.cornerRadius) ?? 0)}px
                </span>
              </div>
              )
            })()}</ControlPopover>
          </div>
        )}

        {/* 3D Tilt Control — [PERF] Direct PIXI mutation during drag, Redux sync on release */}
        {selectedLayer && selectedLayer.type !== LAYER_TYPES.BACKGROUND && (
          <div className="relative flex-shrink-0">
            <button
              ref={tiltBtnRef}
              onClick={() => { toggleSubmenu('tilt') }}
              className={`h-8 px-2 rounded-[8px] transition-all flex items-center gap-1.5 touch-manipulation whitespace-nowrap border ${theme === 'light'
                ? (showTiltPanel ? 'bg-purple-500/10 border-purple-500/30 text-purple-600' : 'text-gray-700 hover:bg-gray-100 border-transparent hover:border-gray-200')
                : (showTiltPanel ? 'bg-white/20 border-white/20 text-white' : 'text-white hover:bg-white/10 border-transparent hover:border-white/10')}`}
              title="3D Tilt (Perspective)"
            >
              <Rotate3d className="h-4 w-4 flex-shrink-0 opacity-70" />
              <span className="text-xs font-medium">3D Tilt</span>
            </button>
            <ControlPopover open={showTiltPanel} anchorRef={tiltBtnRef}>{showTiltPanel && (() => {
              const TILT_MAX = 60; const TILT_SAFE = 45
              // Use local drag state if active, otherwise fallback to Redux value
              const tiltX = dragTiltX !== null ? dragTiltX : (selectedLayer.tiltX ?? 0)
              const tiltY = dragTiltY !== null ? dragTiltY : (selectedLayer.tiltY ?? 0)
              const isUnsafeX = Math.abs(tiltX) > TILT_SAFE; const isUnsafeY = Math.abs(tiltY) > TILT_SAFE
              const safeHalfPct = (TILT_SAFE / TILT_MAX) * 50
              const trackBase = theme === 'light' ? 'bg-gray-200' : 'bg-white/10'
              const safeBand = theme === 'light' ? 'bg-emerald-300/60' : 'bg-emerald-400/25'
              const rangeFill = theme === 'light' ? 'bg-[#7c4af0]' : 'bg-white'
              const labelCol = theme === 'light' ? 'text-gray-500' : 'text-white/60'
              const valCol = theme === 'light' ? 'text-gray-700' : 'text-white'
              const warnCol = theme === 'light' ? 'text-amber-600' : 'text-amber-400'
              const thumbCls = `block w-4 h-4 rounded-full transition-all focus:outline-none cursor-pointer ${theme === 'light' ? 'bg-white border-2 border-[#7c4af0] shadow-sm' : 'bg-white shadow-md hover:scale-110'}`
              
              // [PERF] Resolve the PIXI object once so slider drags can mutate it directly
              // without going through the Redux → useCanvasLayers → applyTransformInline pipeline.
              const pixiObject = selectedLayer?.id
                ? getGlobalMotionEngine()?.registeredObjects?.get(selectedLayer.id)
                : null
              const pixiRenderer = pixiObject?._pixiRenderer || null
              
              const renderRow = (axis, value, ariaLabel, isUnsafe, Icon) => (
                <div className="flex items-center gap-2 w-full">
                  <div className="flex items-center gap-1 shrink-0 w-[24px]">
                    <Icon className={`h-2.5 w-2.5 ${labelCol}`} />
                    <span className={`text-[10px] uppercase font-bold tracking-wider select-none text-center ${labelCol}`}>{axis}</span>
                  </div>
                  <Slider.Root className="relative flex items-center select-none touch-none grow h-5" value={[value]}
                    onValueChange={(v) => {
                      let val = v[0] ?? 0
                      if (Math.abs(val) < 2) val = 0
                      val = Math.max(-TILT_MAX, Math.min(TILT_MAX, val))
                      // [PERF] Direct PIXI mutation for instant visual feedback during drag.
                      // Local state drives the slider thumb; Redux sync is deferred to onValueCommit.
                      // [BUG 1 FIX] When tilting from 0 (first drag), _tiltMesh doesn't exist yet.
                      // syncTiltMesh returns immediately when mesh is null. Call applyTiltToObject
                      // to create the mesh on first-touch, then subsequent drags are instant.
                      if (pixiObject && !pixiObject.destroyed) {
                        if (axis === 'H') pixiObject._tiltXDeg = val
                        else pixiObject._tiltYDeg = val
                        if (pixiObject._tiltMesh && !pixiObject._tiltMesh.destroyed) {
                          syncTiltMesh(pixiObject, null)
                        } else {
                          // First-touch: mesh doesn't exist yet — create it immediately.
                          applyTiltToObject(
                            pixiObject,
                            pixiObject._tiltXDeg || 0,
                            pixiObject._tiltYDeg || 0,
                            pixiObject._pixiRenderer || null
                          )
                        }
                      }
                      // Update local drag state so slider thumb follows mouse instantly
                      if (axis === 'H') setDragTiltX(val)
                      else setDragTiltY(val)
                    }}
                    onValueCommit={(v) => {
                      // [PERF] Sync the final value to Redux on slider release, then clear local state.
                      let val = v[0] ?? 0
                      if (Math.abs(val) < 2) val = 0
                      val = Math.max(-TILT_MAX, Math.min(TILT_MAX, val))
                      handleLayerUpdate({ [axis === 'H' ? 'tiltX' : 'tiltY']: val })
                      if (axis === 'H') setDragTiltX(null)
                      else setDragTiltY(null)
                    }}
                    min={-TILT_MAX} max={TILT_MAX} step={0.5}
                  >
                    <Slider.Track className={`${trackBase} relative grow rounded-full h-1 overflow-hidden`}>
                      <span aria-hidden className={`absolute top-0 bottom-0 ${safeBand}`} style={{ left: `${50 - safeHalfPct}%`, width: `${safeHalfPct * 2}%` }} />
                      <Slider.Range className={`absolute ${rangeFill} rounded-full h-full`} />
                    </Slider.Track>
                    <Slider.Thumb className={thumbCls} aria-label={ariaLabel} />
                  </Slider.Root>
                  <span className={`text-xs font-mono min-w-[44px] text-right tabular-nums ${isUnsafe ? warnCol : valCol}`}>{value.toFixed(1)}°</span>
                </div>
              )
              return (
                <div
                  className="flex flex-col gap-0.5 px-4 py-2 rounded-lg backdrop-blur-md animate-in fade-in slide-in-from-top-2 duration-200"
                  style={{
                    backgroundColor: 'var(--editor-panel-bg)',
                    backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
                    border: '1px solid var(--editor-panel-border)',
                    boxShadow: 'var(--editor-panel-shadow)',
                    minWidth: '270px', pointerEvents: 'auto'
                  }}
                >
                  <div className="absolute top-2 right-2 flex items-center gap-1.5 z-10">
                    {(tiltX !== 0 || tiltY !== 0) && (
                      <button onClick={() => {
                        setDragTiltX(null)
                        setDragTiltY(null)
                        if (pixiObject && !pixiObject.destroyed) {
                          pixiObject._tiltXDeg = 0
                          pixiObject._tiltYDeg = 0
                          syncTiltMesh(pixiObject, null)
                        }
                        handleLayerUpdate({ tiltX: 0, tiltY: 0 })
                      }}
                        className={`p-1 rounded-md transition-all ${theme === 'light' ? 'text-gray-400 hover:text-gray-600 hover:bg-gray-100' : 'text-white/30 hover:text-white/60 hover:bg-white/10'}`}
                        title="Reset Tilt"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  <div className="pr-10 pt-1">
                    {renderRow('H', tiltX, 'Horizontal Tilt', isUnsafeX, ArrowLeftRight)}
                    {renderRow('V', tiltY, 'Vertical Tilt', isUnsafeY, ArrowUpDown)}
                  </div>
                </div>
              )
            })()}</ControlPopover>
          </div>
        )}

        {/* Card Frame flip button */}
        {selectedLayer?.data?.isCardFrame && (
          <button
            onClick={() => onFlipCardFrame?.()}
            className={`h-8 px-2.5 rounded-[8px] transition-colors flex items-center gap-1.5 touch-manipulation whitespace-nowrap flex-shrink-0 border ${theme === 'light'
              ? 'text-gray-700 hover:bg-gray-100 active:bg-gray-200 border-transparent hover:border-gray-200'
              : 'text-white hover:bg-white/10 active:bg-white/15 border-transparent hover:border-white/10'}`}
            title={`Showing ${selectedLayer.data.showingFront !== false ? 'Front' : 'Back'} - Click to flip`}
          >
            <FlipHorizontal2 className="h-4 w-4 flex-shrink-0 opacity-70" strokeWidth={2} />
            <span className="text-xs font-medium">{selectedLayer.data.showingFront !== false ? 'Front' : 'Back'}</span>
          </button>
        )}

        {/* Position panel opener */}
        <button
          onClick={() => onOpenPositionPanel?.()}
          className={`h-8 px-2 rounded-[8px] transition-colors flex items-center gap-1.5 touch-manipulation whitespace-nowrap flex-shrink-0 border ${theme === 'light'
            ? 'text-gray-700 hover:bg-gray-100 active:bg-gray-200 border-transparent hover:border-gray-200'
            : 'text-white hover:bg-white/10 active:bg-white/15 border-transparent hover:border-white/10'}`}
          title="Reorder layers"
        >
          <Layers className="h-4 w-4 flex-shrink-0 opacity-70" strokeWidth={2} />
          <span className="text-xs font-medium">Position</span>
        </button>

        {/* Video specific controls */}
        {(selectedLayer?.type === LAYER_TYPES.VIDEO || (selectedLayer?.type === LAYER_TYPES.FRAME && selectedLayer?.data?.assetIsVideo)) && (
          <button
            onClick={() => {
              const isMuted = selectedLayer.data?.muted !== false
              handleLayerUpdate({ data: { ...selectedLayer.data, muted: !isMuted } })
            }}
            className={`h-7 w-7 rounded-md transition-colors flex items-center justify-center border flex-shrink-0 ${theme === 'light'
              ? 'text-gray-700 hover:bg-gray-100 border-transparent hover:border-gray-200'
              : 'text-white hover:bg-white/10 border-transparent hover:border-white/10'}`}
            title={selectedLayer.data?.muted !== false ? "Unmute Video" : "Mute Video"}
          >
            {selectedLayer.data?.muted !== false ? (
              <VolumeX className="h-4 w-4 opacity-70 text-red-400" />
            ) : (
              <Volume2 className="h-4 w-4 opacity-70" />
            )}
          </button>
        )}
        </> /* end normal controls conditional */}

            </div>
            </div>
          </div>
          )}
        </div>
      )}

      {/* ── Mobile: pill bar (property controls in normal mode, motion controls in capture) ── */}
      {isMobileBottom && (
        <div
          className="h-10 flex items-center justify-center w-full transition-all duration-300"
          style={{ pointerEvents: 'auto' }}
        >
          {/* Left scrollable section — hidden during Motion Capture mode */}
          {!isMotionCaptureActive && (
          <div
            className="h-10 flex items-center flex-1 min-w-0 backdrop-blur-md"
            style={{
              backgroundColor: 'var(--editor-panel-bg)',
              backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
              borderTop: '1px solid var(--editor-panel-border)',
            }}
          >
          <div
            ref={scrollContainerRef}
            className="flex items-center justify-center gap-3 px-2 h-full overflow-x-auto scrollbar-none flex-1 min-w-0"
            style={{ pointerEvents: 'auto' }}
          >

        {/* ── Audio Block Controls — shown when audio block is selected (no layer/canvas) ── */}
        {renderAudioControls()}

        {/* ── Normal layer/canvas controls — hidden when audio block active ── */}
        {(!selectedAudioBlock || selectedLayer || selectedCanvas) && <>

        {/* Canvas Background Color Picker - Specific UI */}
        {selectedCanvas && currentScene && (
          <div className="flex items-center gap-2 flex-shrink-0 mr-2">
            <button
              onClick={() => { toggleSubmenu('color') }}
              className={`w-6 h-6 rounded-full border-2 cursor-pointer transition-all hover:ring-2 ${theme === 'light' ? 'border-gray-300 hover:ring-gray-300' : 'border-zinc-600 hover:ring-zinc-500'}`}
              style={{
                backgroundColor: getCanvasBackgroundColor(),
                backgroundImage: (getCanvasBackgroundColor() === '#ffffff' || getCanvasBackgroundColor() === '#FFFFFF') ? 'conic-gradient(from 0deg, red, yellow, lime, aqua, blue, magenta, red)' : undefined
              }}
              title="Canvas Background Color"
            />
          </div>
        )}

        {/* Color Picker - Circular (Generic for Layers) */}
        {!selectedCanvas && (
          <div className="relative flex-shrink-0 flex justify-center" style={{ width: '32px' }}>
            <button
              onClick={() => {
                if (onOpenColorPicker && selectedLayer) {
                  if (selectedLayer.type === LAYER_TYPES.BACKGROUND) {
                    onOpenColorPicker('canvas')
                  } else if (selectedLayer.type === LAYER_TYPES.SHAPE || selectedLayer.type === LAYER_TYPES.TEXT) {
                    onOpenColorPicker(selectedLayer.type === LAYER_TYPES.SHAPE ? 'fill' : 'text')
                  }
                } else {
                  toggleSubmenu('color')
                }
              }}
              disabled={!selectedLayer || (selectedLayer.type !== LAYER_TYPES.SHAPE && selectedLayer.type !== LAYER_TYPES.TEXT && selectedLayer.type !== LAYER_TYPES.BACKGROUND)}
              className={`w-6 h-6 rounded-full cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-all hover:ring-2 ${theme === 'light' ? 'hover:ring-gray-300 border border-gray-200' : 'hover:ring-zinc-500 border border-white/10'}`}
              style={{
                backgroundColor: selectedLayer?.type === LAYER_TYPES.BACKGROUND ? getCanvasBackgroundColor() : (isTransparent() ? 'transparent' : getColor()),
                backgroundImage: (selectedLayer?.type === LAYER_TYPES.BACKGROUND && (getCanvasBackgroundColor() === '#ffffff' || getCanvasBackgroundColor() === '#FFFFFF'))
                  ? 'conic-gradient(from 0deg, red, yellow, lime, aqua, blue, magenta, red)'
                  : (selectedLayer?.type !== LAYER_TYPES.BACKGROUND && !isTransparent() && (getColor() === '#ffffff' || getColor() === '#FFFFFF'))
                    ? 'conic-gradient(from 0deg, red, yellow, lime, aqua, blue, magenta, red)'
                    : (selectedLayer?.type !== LAYER_TYPES.BACKGROUND && isTransparent())
                      ? 'linear-gradient(45deg, #666 25%, transparent 25%, transparent 75%, #666 75%, #666), linear-gradient(45deg, #666 25%, transparent 25%, transparent 75%, #666 75%, #666)'
                      : undefined,
                backgroundSize: (selectedLayer?.type !== LAYER_TYPES.BACKGROUND && isTransparent()) ? '6px 6px' : undefined,
                backgroundPosition: (selectedLayer?.type !== LAYER_TYPES.BACKGROUND && isTransparent()) ? '0 0, 3px 3px' : undefined,
              }}
              title={selectedLayer?.type === LAYER_TYPES.BACKGROUND ? "Background Color" : "Fill Color"}
            />
          </div>
        )}

        {/* Font Selection - Only for text */}
        {selectedLayer?.type === LAYER_TYPES.TEXT && (
          <>
            <button
              onClick={() => toggleSubmenu('font')}
              className={`h-8 px-3 rounded-[8px] text-xs transition-all flex items-center gap-2 outline-none min-w-[100px] border ${showFontMenu
                ? 'bg-purple-500/10 border-purple-500/30 text-purple-600'
                : (theme === 'light' ? 'bg-gray-100 text-gray-900 border-gray-200 hover:bg-gray-200' : 'bg-white/5 text-white/90 border border-white/5 hover:bg-white/10')}`}
            >
              <span className="truncate flex-1 text-left font-medium">{getFontFamily()}</span>
              <ChevronDown className="h-3.5 w-3.5 opacity-60" strokeWidth={2} />
            </button>

            <button
              onClick={() => toggleSubmenu('size')}
              className={`h-8 px-2 rounded-[8px] text-xs transition-all flex items-center gap-2 outline-none min-w-[50px] border ${showSizeMenu
                ? 'bg-purple-500/10 border-purple-500/30 text-purple-600'
                : (theme === 'light' ? 'bg-gray-100 text-gray-900 border-gray-200 hover:bg-gray-200' : 'bg-white/5 text-white/90 border border-white/5 hover:bg-white/10')}`}
            >
              <span className="flex-1 text-left font-medium">{getFontSize()}</span>
              <ChevronDown className="h-3.5 w-3.5 opacity-60" strokeWidth={2} />
            </button>

            <button
              onClick={() => toggleSubmenu('align')}
              className={`h-8 px-2 rounded-[8px] transition-all flex items-center justify-center min-w-[44px] border ${showAlignMenu
                ? 'bg-purple-600/20 border-purple-500/50 text-purple-400 shadow-[0_0_10px_rgba(168,85,247,0.2)]'
                : (theme === 'light'
                  ? 'text-gray-700 hover:bg-gray-100 border-transparent hover:border-gray-200'
                  : 'text-white hover:bg-white/10 border-transparent hover:border-white/10')
                }`}
              title={selectedLayer.data?.enableFlow ? "Water Flow Enabled" : `Align: ${selectedLayer.data?.textAlign || 'left'}`}
            >
              <div className="flex items-center gap-1.5">
                <div className="relative">
                  {selectedLayer.data?.textAlign === 'center' ? (
                    <AlignCenter className="h-4 w-4 opacity-100" strokeWidth={2.5} />
                  ) : selectedLayer.data?.textAlign === 'right' ? (
                    <AlignRight className="h-4 w-4 opacity-100" strokeWidth={2.5} />
                  ) : (
                    <AlignLeft className="h-4 w-4 opacity-100" strokeWidth={2.5} />
                  )}
                  {selectedLayer.data?.enableFlow && (
                    <Waves className="absolute -top-1 -right-1 h-2 w-2 text-[#22c55e] opacity-90 animate-pulse" strokeWidth={2.5} />
                  )}
                </div>
                <ChevronDown className="h-3 w-3 opacity-40" strokeWidth={2.5} />
              </div>
            </button>
          </>
        )}

        {/* Shape-specific controls */}
        {selectedLayer?.type === LAYER_TYPES.SHAPE && (
          <>
            <DropdownMenu
              trigger={
                <button
                  className={`h-8 px-2 rounded-[8px] transition-colors flex items-center gap-1.5 touch-manipulation whitespace-nowrap flex-shrink-0 border ${theme === 'light'
                    ? 'text-gray-700 hover:bg-gray-100 active:bg-gray-200 border-transparent hover:border-gray-200'
                    : 'text-white hover:bg-white/10 active:bg-white/15 border-transparent hover:border-white/10'}`}
                  title="Stroke Style"
                >
                  <Minus className="h-4 w-4 flex-shrink-0 opacity-60" strokeWidth={2} />
                  <span className="text-xs font-medium">Stroke</span>
                  <ChevronDown className="h-3 w-3 flex-shrink-0 opacity-60" strokeWidth={2} />
                </button>
              }
            >
              <div className={`p-4 min-w-[280px] ${theme === 'light' ? 'bg-white' : 'bg-zinc-900'} rounded-xl shadow-2xl`}>
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <label className={`text-xs ${theme === 'light' ? 'text-gray-500' : 'text-gray-300'}`}>Width</label>
                    <span className={`text-xs font-medium ${theme === 'light' ? 'text-gray-900' : 'text-white'}`}>{getStrokeWidth()}px</span>
                  </div>
                  <Slider.Root
                    className="relative flex items-center select-none touch-none w-full h-5"
                    value={[getStrokeWidth()]}
                    onValueChange={(value) => {
                      const newStrokeWidth = value[0]
                      const updatedData = { ...selectedLayer.data, strokeWidth: newStrokeWidth }
                      if (newStrokeWidth > 0 && (!selectedLayer.data?.stroke || selectedLayer.data.stroke === '')) {
                        updatedData.stroke = '#000000'
                      }
                      handleLayerUpdate({ data: updatedData })
                    }}
                    min={0} max={20} step={0.5}
                  >
                    <Slider.Track className={`${theme === 'light' ? 'bg-gray-100' : 'bg-zinc-700'} relative grow rounded-full h-1.5`}>
                      <Slider.Range className={`absolute ${theme === 'light' ? 'bg-[#7c4af0]' : 'bg-white'} rounded-full h-full`} />
                    </Slider.Track>
                    <Slider.Thumb className={`block w-4 h-4 rounded-full shadow-md focus:outline-none focus:ring-2 ${theme === 'light' ? 'bg-white border-2 border-[#7c4af0] focus:ring-[#7c4af0]' : 'bg-white hover:bg-zinc-100 focus:ring-white focus:ring-offset-2 focus:ring-offset-zinc-800'}`} />
                  </Slider.Root>
                </div>
                <div className="mb-4">
                  <label className={`text-xs mb-2 block ${theme === 'light' ? 'text-gray-500' : 'text-gray-300'}`}>Color</label>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => { if (onOpenColorPicker) { onOpenColorPicker('stroke') } }}
                      className={`w-12 h-8 rounded border-2 cursor-pointer transition-colors ${theme === 'light' ? 'border-gray-200 hover:border-gray-300' : 'border-zinc-600 hover:border-zinc-500'}`}
                      style={{ backgroundColor: getStrokeColor() }}
                      title="Stroke Color"
                    />
                    <input
                      type="text"
                      value={getStrokeColor()}
                      onChange={(e) => {
                        if (/^#[0-9A-Fa-f]{0,6}$/.test(e.target.value)) {
                          handleLayerUpdate({ data: { ...selectedLayer.data, stroke: e.target.value } })
                        }
                      }}
                      className={`flex-1 bg-transparent border rounded px-2 py-1.5 text-xs outline-none focus:border-[#7c4af0] ${theme === 'light' ? 'border-gray-200 text-gray-900' : 'border-zinc-700 text-white'}`}
                      placeholder="#000000"
                    />
                  </div>
                </div>
                <div>
                  <label className={`text-xs mb-2 block ${theme === 'light' ? 'text-gray-500' : 'text-gray-300'}`}>Style</label>
                  <div className="flex gap-2">
                    {['solid', 'dashed', 'dotted'].map((style) => (
                      <button
                        key={style}
                        onClick={() => { handleLayerUpdate({ data: { ...selectedLayer.data, strokeStyle: style } }) }}
                        className={`flex-1 px-3 py-2 rounded text-xs font-medium transition-colors ${getStrokeStyle() === style
                          ? 'bg-[#7c4af0] text-white shadow-lg shadow-[#7c4af0]/20'
                          : (theme === 'light' ? 'bg-gray-100 text-gray-600 hover:bg-gray-200' : 'bg-white/5 text-gray-300 hover:bg-white/10')
                          }`}
                      >
                        {style.charAt(0).toUpperCase() + style.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </DropdownMenu>
          </>
        )}

        {/* Opacity Control */}
        {selectedLayer && selectedLayer.type !== LAYER_TYPES.BACKGROUND && (
          <button
            onClick={() => { toggleSubmenu('opacity') }}
            className={`h-8 px-2 rounded-[8px] transition-all flex items-center gap-1.5 touch-manipulation whitespace-nowrap border ${theme === 'light'
              ? (showOpacitySlider ? 'bg-purple-500/10 border-purple-500/30 text-purple-600' : 'text-gray-700 hover:bg-gray-100 border-transparent hover:border-gray-200')
              : (showOpacitySlider ? 'bg-white/20 border-white/20 text-white' : 'text-white hover:bg-white/10 border-transparent hover:border-white/10')}`}
            title="Layer Transparency"
          >
            <Ghost className="h-4 w-4 flex-shrink-0 opacity-70" strokeWidth={2} />
          </button>
        )}

        {/* Blur Control */}
        {selectedLayer && selectedLayer.type !== LAYER_TYPES.BACKGROUND && (
          <button
            onClick={() => { toggleSubmenu('blur') }}
            className={`h-8 px-2 rounded-[8px] transition-all flex items-center gap-1.5 touch-manipulation whitespace-nowrap border ${theme === 'light'
              ? (showBlurSlider ? 'bg-purple-500/10 border-purple-500/30 text-purple-600' : 'text-gray-700 hover:bg-gray-100 border-transparent hover:border-gray-200')
              : (showBlurSlider ? 'bg-white/20 border-white/20 text-white' : 'text-white hover:bg-white/10 border-transparent hover:border-white/10')}`}
            title="Layer Blur"
          >
            <Droplets className="h-4 w-4 flex-shrink-0 opacity-70" strokeWidth={2} />
          </button>
        )}

        {/* Corner Radius Control */}
        {selectedLayer?.type === LAYER_TYPES.SHAPE && hasCorners() && (
          <button
            onClick={() => { toggleSubmenu('radius') }}
            className={`h-8 px-2 rounded-[8px] transition-all flex items-center gap-1.5 touch-manipulation whitespace-nowrap border ${theme === 'light'
              ? (showCornerRadiusSlider ? 'bg-purple-500/10 border-purple-500/30 text-purple-600' : 'text-gray-700 hover:bg-gray-100 border-transparent hover:border-gray-200')
              : (showCornerRadiusSlider ? 'bg-white/20 border-white/20 text-white' : 'text-white hover:bg-white/10 border-transparent hover:border-white/10')}`}
            title="Corner Radius"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 flex-shrink-0 opacity-70">
              <path d="M21 4H11C7.13401 4 4 7.13401 4 11V21" />
            </svg>
          </button>
        )}

        {/* 3D Tilt Control */}
        {selectedLayer && selectedLayer.type !== LAYER_TYPES.BACKGROUND && (
          <button
            onClick={() => { toggleSubmenu('tilt') }}
            className={`h-8 px-2 rounded-[8px] transition-all flex items-center gap-1.5 touch-manipulation whitespace-nowrap border ${theme === 'light'
              ? (showTiltPanel ? 'bg-purple-500/10 border-purple-500/30 text-purple-600' : 'text-gray-700 hover:bg-gray-100 border-transparent hover:border-gray-200')
              : (showTiltPanel ? 'bg-white/20 border-white/20 text-white' : 'text-white hover:bg-white/10 border-transparent hover:border-white/10')}`}
            title="3D Tilt (Perspective)"
          >
            <Rotate3d className="h-4 w-4 flex-shrink-0 opacity-70" />
            <span className="text-xs font-medium">3D Tilt</span>
          </button>
        )}

        {/* Card Frame flip button */}
        {selectedLayer?.data?.isCardFrame && (
          <button
            onClick={() => onFlipCardFrame?.()}
            className={`h-8 px-2.5 rounded-[8px] transition-colors flex items-center gap-1.5 touch-manipulation whitespace-nowrap flex-shrink-0 border ${theme === 'light'
              ? 'text-gray-700 hover:bg-gray-100 active:bg-gray-200 border-transparent hover:border-gray-200'
              : 'text-white hover:bg-white/10 active:bg-white/15 border-transparent hover:border-white/10'}`}
            title={`Showing ${selectedLayer.data.showingFront !== false ? 'Front' : 'Back'} - Click to flip`}
          >
            <FlipHorizontal2 className="h-4 w-4 flex-shrink-0 opacity-70" strokeWidth={2} />
            <span className="text-xs font-medium">{selectedLayer.data.showingFront !== false ? 'Front' : 'Back'}</span>
          </button>
        )}

        {/* Position panel opener */}
        <button
          onClick={() => onOpenPositionPanel?.()}
          className={`h-8 px-2 rounded-[8px] transition-colors flex items-center gap-1.5 touch-manipulation whitespace-nowrap flex-shrink-0 border ${theme === 'light'
            ? 'text-gray-700 hover:bg-gray-100 active:bg-gray-200 border-transparent hover:border-gray-200'
            : 'text-white hover:bg-white/10 active:bg-white/15 border-transparent hover:border-white/10'}`}
          title="Reorder layers"
        >
          <Layers className="h-4 w-4 flex-shrink-0 opacity-70" strokeWidth={2} />
          <span className="text-xs font-medium">Position</span>
        </button>

        {/* Video specific controls */}
        {(selectedLayer?.type === LAYER_TYPES.VIDEO || (selectedLayer?.type === LAYER_TYPES.FRAME && selectedLayer?.data?.assetIsVideo)) && (
          <button
            onClick={() => {
              const isMuted = selectedLayer.data?.muted !== false
              handleLayerUpdate({ data: { ...selectedLayer.data, muted: !isMuted } })
            }}
            className={`h-7 w-7 rounded-md transition-colors flex items-center justify-center border flex-shrink-0 ${theme === 'light'
              ? 'text-gray-700 hover:bg-gray-100 border-transparent hover:border-gray-200'
              : 'text-white hover:bg-white/10 border-transparent hover:border-white/10'}`}
            title={selectedLayer.data?.muted !== false ? "Unmute Video" : "Mute Video"}
          >
            {selectedLayer.data?.muted !== false ? (
              <VolumeX className="h-4 w-4 opacity-70 text-red-400" />
            ) : (
              <Volume2 className="h-4 w-4 opacity-70" />
            )}
          </button>
        )}

        {/* Mobile Layer/Scene Duplicate & Delete buttons */}
        {selectedLayer && selectedLayer.type !== 'background' && (
          <div className={`w-px h-5 flex-shrink-0 ${theme === 'light' ? 'bg-black/10' : 'bg-white/10'}`} />
        )}

        {selectedLayer && (
          <button
            onClick={() => {
              dispatch(duplicateLayer(selectedLayer.id))
            }}
            className={`h-8 px-2 rounded-[8px] transition-colors flex items-center justify-center border flex-shrink-0 ${theme === 'light'
              ? 'text-gray-700 hover:bg-gray-100 active:bg-gray-200 border-transparent hover:border-gray-200'
              : 'text-white hover:bg-white/10 active:bg-white/15 border-transparent hover:border-white/10'}`}
            title="Duplicate Layer"
          >
            <Copy className="h-4 w-4 flex-shrink-0 opacity-70" strokeWidth={2} />
          </button>
        )}

        {selectedLayer && selectedLayer.type !== 'background' && (
          <button
            onClick={() => {
              dispatch(deleteLayer(selectedLayer.id))
              dispatch(clearLayerSelection())
            }}
            className={`h-8 px-2 rounded-[8px] transition-colors flex items-center justify-center border flex-shrink-0 ${theme === 'light'
              ? 'text-red-500 hover:bg-red-50 active:bg-red-100 border-transparent hover:border-red-200'
              : 'text-red-400 hover:bg-red-500/15 active:bg-red-500/25 border-transparent hover:border-red-500/25'}`}
            title="Delete Layer"
          >
            <Trash2 className="h-4 w-4 flex-shrink-0 opacity-70" strokeWidth={2} />
          </button>
        )}

        {(!selectedAudioBlock && !selectedLayer && currentScene) && (
          <>
            <button
              onClick={() => {
                dispatch(copyScene(currentScene.id))
                dispatch(pasteScene())
              }}
              className={`h-8 px-2 rounded-[8px] transition-colors flex items-center justify-center border flex-shrink-0 ${theme === 'light'
                ? 'text-gray-700 hover:bg-gray-100 active:bg-gray-200 border-transparent hover:border-gray-200'
                : 'text-white hover:bg-white/10 active:bg-white/15 border-transparent hover:border-white/10'}`}
              title="Duplicate Scene"
            >
              <Copy className="h-4 w-4 flex-shrink-0 opacity-70" strokeWidth={2} />
            </button>

            {!selectedCanvas && scenes.length > 1 && (
              <button
                onClick={() => {
                  dispatch(deleteScene(currentScene.id))
                }}
                className={`h-8 px-2 rounded-[8px] transition-colors flex items-center justify-center border flex-shrink-0 ${theme === 'light'
                  ? 'text-red-500 hover:bg-red-50 active:bg-red-100 border-transparent hover:border-red-200'
                  : 'text-red-400 hover:bg-red-500/15 active:bg-red-500/25 border-transparent hover:border-red-500/25'}`}
                title="Delete Scene"
              >
                <Trash2 className="h-4 w-4 flex-shrink-0 opacity-70" strokeWidth={2} />
              </button>
            )}
          </>
        )}

          </>}{/* end normal controls */}
          </div>{/* end scrollable */}
          </div>
          )}{/* end left section */}
          {/* Right motion section — only shown in capture mode */}
          {isMotionCaptureActive && (
          <div
            className="h-10 flex items-stretch overflow-hidden backdrop-blur-md w-full"
            style={{
              backgroundColor: 'var(--editor-panel-bg)',
              backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
              border: '1px solid var(--editor-panel-border)',
              borderRadius: '12px',
            }}
          >
            {renderMotionControls()}
          </div>
          )}
        </div>
      )}

      {/* Transparency Sub-tab (Modal) — mobile only [PERF] direct PIXI, fresh object resolve */}
      {showOpacitySlider && selectedLayer && isMobileBottom && (() => {
        const pixiObj = selectedLayer?.id
          ? getGlobalMotionEngine()?.registeredObjects?.get(selectedLayer.id)
          : null
        return (
        <div
          className="absolute bottom-full mb-3 left-4 right-4 h-12 flex items-center justify-between gap-3 px-4 rounded-xl backdrop-blur-md z-50 animate-in fade-in slide-in-from-bottom-2 duration-200"
          style={{
            backgroundColor: 'var(--editor-panel-bg)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            border: '1px solid var(--editor-panel-border)',
            boxShadow: 'var(--editor-panel-shadow)',
            pointerEvents: 'auto'
          }}
        >
          <span className={`text-[10px] uppercase font-bold tracking-wider select-none shrink-0 ${theme === 'light' ? 'text-gray-500' : 'text-white/60'}`}>Opacity</span>
          <Slider.Root
            className="relative flex items-center select-none touch-none grow h-5"
            value={[Math.round(((dragOpacity !== null ? dragOpacity : selectedLayer.opacity) ?? 1) * 100)]}
            onValueChange={(value) => {
              const v = value[0] / 100
              if (pixiObj && !pixiObj.destroyed) {
                if (pixiObj._tiltHidden && pixiObj._tiltMesh && !pixiObj._tiltMesh.destroyed) {
                  pixiObj._intendedAlpha = v
                  pixiObj._tiltMesh.alpha = v
                } else {
                  pixiObj.alpha = v
                }
              }
              setDragOpacity(v)
            }}
            onValueCommit={(value) => {
              const v = value[0] / 100
              handleLayerUpdate({ opacity: v })
              setDragOpacity(null)
            }}
            min={0} max={100} step={1}
          >
            <Slider.Track className={`${theme === 'light' ? 'bg-gray-200' : 'bg-white/10'} relative grow rounded-full h-1`}>
              <Slider.Range className={`absolute ${theme === 'light' ? 'bg-[#7c4af0]' : 'bg-white'} rounded-full h-full`} />
            </Slider.Track>
            <Slider.Thumb
              className={`block w-4 h-4 rounded-full transition-all focus:outline-none cursor-pointer ${theme === 'light' ? 'bg-white border-2 border-[#7c4af0] shadow-sm' : 'bg-white shadow-md hover:scale-110'}`}
              aria-label="Layer Opacity"
            />
          </Slider.Root>
          <span className={`text-xs font-mono min-w-[32px] text-right shrink-0 ${theme === 'light' ? 'text-gray-700' : 'text-white'}`}>
            {Math.round(((dragOpacity !== null ? dragOpacity : selectedLayer.opacity) ?? 1) * 100)}%
          </span>
          <button
            onClick={() => { setShowOpacitySlider(false); onSubmenuChange?.(null) }}
            className={`p-1 rounded-md transition-colors shrink-0 ${theme === 'light' ? 'hover:bg-gray-100 text-gray-400' : 'hover:bg-white/10 text-white/40'}`}
          ><X className="h-3.5 w-3.5" /></button>
        </div>
        )
      })()}

      {/* Blur Sub-tab (Modal) — mobile only [PERF] direct PIXI */}
      {showBlurSlider && selectedLayer && isMobileBottom && (() => {
        const pixiObj = selectedLayer?.id
          ? getGlobalMotionEngine()?.registeredObjects?.get(selectedLayer.id)
          : null
        return (
        <div
          className="absolute bottom-full mb-3 left-4 right-4 h-12 flex items-center justify-between gap-3 px-4 rounded-xl backdrop-blur-md z-50 animate-in fade-in slide-in-from-bottom-2 duration-200"
          style={{
            backgroundColor: 'var(--editor-panel-bg)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            border: '1px solid var(--editor-panel-border)',
            boxShadow: 'var(--editor-panel-shadow)',
            pointerEvents: 'auto'
          }}
        >
          <span className={`text-[10px] uppercase font-bold tracking-wider select-none shrink-0 ${theme === 'light' ? 'text-gray-500' : 'text-white/60'}`}>Blur</span>
          <Slider.Root
            className="relative flex items-center select-none touch-none grow h-5"
            value={[Math.min(BLUR_MAX, (dragBlur !== null ? dragBlur : selectedLayer.blur) ?? 0)]}
            onValueChange={(value) => {
              const v = Math.max(0, Math.min(BLUR_MAX, value[0] ?? 0))
              if (pixiObj && !pixiObj.destroyed) {
                if (!pixiObj._blurFilter) { pixiObj._blurFilter = new PIXI.BlurFilter(); pixiObj._blurFilter.quality = 4 }
                pixiObj._blurFilter.strength = computeBlurPhysicalStrength(v, pixiObj)
                if (!pixiObj.filters?.includes(pixiObj._blurFilter)) pixiObj.filters = [...(pixiObj.filters || []), pixiObj._blurFilter]
              }
              setDragBlur(v)
            }}
            onValueCommit={(value) => {
              const v = Math.max(0, Math.min(BLUR_MAX, value[0] ?? 0))
              handleLayerUpdate({ blur: v })
              setDragBlur(null)
            }}
            min={0} max={BLUR_MAX} step={0.5}
          >
            <Slider.Track className={`${theme === 'light' ? 'bg-gray-200' : 'bg-white/10'} relative grow rounded-full h-1`}>
              <Slider.Range className={`absolute ${theme === 'light' ? 'bg-[#7c4af0]' : 'bg-white'} rounded-full h-full`} />
            </Slider.Track>
            <Slider.Thumb
              className={`block w-4 h-4 rounded-full transition-all focus:outline-none cursor-pointer ${theme === 'light' ? 'bg-white border-2 border-[#7c4af0] shadow-sm' : 'bg-white shadow-md hover:scale-110'}`}
              aria-label="Layer Blur"
            />
          </Slider.Root>
          <span className={`text-xs font-mono min-w-[32px] text-right shrink-0 ${theme === 'light' ? 'text-gray-700' : 'text-white'}`}>
            {Math.round(Math.min(BLUR_MAX, (dragBlur !== null ? dragBlur : selectedLayer.blur) ?? 0))}
          </span>
          <button
            onClick={() => { setShowBlurSlider(false); onSubmenuChange?.(null) }}
            className={`p-1 rounded-md transition-colors shrink-0 ${theme === 'light' ? 'hover:bg-gray-100 text-gray-400' : 'hover:bg-white/10 text-white/40'}`}
          ><X className="h-3.5 w-3.5" /></button>
        </div>
        )
      })()}

      {/* Corner Radius Sub-tab (Modal) — mobile only [PERF] direct PIXI */}
      {showCornerRadiusSlider && selectedLayer && hasCorners() && isMobileBottom && (() => {
        const pixiObj = selectedLayer?.id
          ? getGlobalMotionEngine()?.registeredObjects?.get(selectedLayer.id)
          : null
        return (
        <div
          className="absolute bottom-full mb-3 left-4 right-4 h-12 flex items-center justify-between gap-3 px-4 rounded-xl backdrop-blur-md z-50 animate-in fade-in slide-in-from-bottom-2 duration-200"
          style={{
            backgroundColor: 'var(--editor-panel-bg)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            border: '1px solid var(--editor-panel-border)',
            boxShadow: 'var(--editor-panel-shadow)',
            pointerEvents: 'auto'
          }}
        >
          <span className={`text-[10px] uppercase font-bold tracking-wider select-none shrink-0 ${theme === 'light' ? 'text-gray-500' : 'text-white/60'}`}>Radius</span>
          <Slider.Root
            className="relative flex items-center select-none touch-none grow h-5"
            value={[(dragCornerRadius !== null ? dragCornerRadius : selectedLayer.data?.cornerRadius) ?? 0]}
            onValueChange={(value) => {
              const v = Math.max(0, Math.min(CORNER_RADIUS_MAX, Math.round(value[0] ?? 0)))
              if (pixiObj && !pixiObj.destroyed) {
                if (typeof pixiObj.cornerRadius !== 'undefined') pixiObj.cornerRadius = v
                else if (pixiObj._hasReactiveRadiusProperties) { pixiObj._cornerRadius = v; pixiObj._applyAnimatedCornerRadius?.() }
              }
              setDragCornerRadius(v)
            }}
            onValueCommit={(value) => {
              const v = Math.max(0, Math.min(CORNER_RADIUS_MAX, Math.round(value[0] ?? 0)))
              handleLayerUpdate({ data: { ...selectedLayer.data, cornerRadius: v } })
              setDragCornerRadius(null)
            }}
            min={0}
            max={Math.min(CORNER_RADIUS_MAX, Math.min(selectedLayer.width || 100, selectedLayer.height || 100) / 2)}
            step={1}
          >
            <Slider.Track className={`${theme === 'light' ? 'bg-gray-200' : 'bg-white/10'} relative grow rounded-full h-1`}>
              <Slider.Range className={`absolute ${theme === 'light' ? 'bg-[#7c4af0]' : 'bg-white'} rounded-full h-full`} />
            </Slider.Track>
            <Slider.Thumb
              className={`block w-4 h-4 rounded-full transition-all focus:outline-none cursor-pointer ${theme === 'light' ? 'bg-white border-2 border-[#7c4af0] shadow-sm' : 'bg-white shadow-md hover:scale-110'}`}
              aria-label="Corner Radius"
            />
          </Slider.Root>
          <span className={`text-xs font-mono min-w-[36px] text-right shrink-0 ${theme === 'light' ? 'text-gray-700' : 'text-white'}`}>
            {Math.round((dragCornerRadius !== null ? dragCornerRadius : selectedLayer.data?.cornerRadius) ?? 0)}px
          </span>
          <button
            onClick={() => { setShowCornerRadiusSlider(false); onSubmenuChange?.(null) }}
            className={`p-1 rounded-md transition-colors shrink-0 ${theme === 'light' ? 'hover:bg-gray-100 text-gray-400' : 'hover:bg-white/10 text-white/40'}`}
          ><X className="h-3.5 w-3.5" /></button>
        </div>
        )
      })()}

      {/* 3D Tilt Sub-panel — mobile only [PERF] direct PIXI, fresh object resolve */}
      {showTiltPanel && selectedLayer && isMobileBottom && (() => {
        const TILT_MAX = 60; const TILT_SAFE = 45
        const tiltX = dragTiltX !== null ? dragTiltX : (selectedLayer.tiltX ?? 0)
        const tiltY = dragTiltY !== null ? dragTiltY : (selectedLayer.tiltY ?? 0)
        const isUnsafeX = Math.abs(tiltX) > TILT_SAFE; const isUnsafeY = Math.abs(tiltY) > TILT_SAFE
        const safeHalfPct = (TILT_SAFE / TILT_MAX) * 50
        const trackBase = theme === 'light' ? 'bg-gray-200' : 'bg-white/10'
        const safeBand = theme === 'light' ? 'bg-emerald-300/60' : 'bg-emerald-400/25'
        const rangeFill = theme === 'light' ? 'bg-[#7c4af0]' : 'bg-white'
        const labelCol = theme === 'light' ? 'text-gray-500' : 'text-white/60'
        const valCol = theme === 'light' ? 'text-gray-700' : 'text-white'
        const warnCol = theme === 'light' ? 'text-amber-600' : 'text-amber-400'
        const thumbCls = `block w-4 h-4 rounded-full transition-all focus:outline-none cursor-pointer ${theme === 'light' ? 'bg-white border-2 border-[#7c4af0] shadow-sm' : 'bg-white shadow-md hover:scale-110'}`
        
        const pixiObj = selectedLayer?.id
          ? getGlobalMotionEngine()?.registeredObjects?.get(selectedLayer.id)
          : null

        const renderRow = (axis, value, ariaLabel, isUnsafe, Icon) => (
          <div className="flex items-center gap-2 w-full">
            <div className="flex items-center gap-1 shrink-0 w-[24px]">
              <Icon className={`h-2.5 w-2.5 ${labelCol}`} />
              <span className={`text-[10px] uppercase font-bold tracking-wider select-none text-center ${labelCol}`}>{axis}</span>
            </div>
            <Slider.Root className="relative flex items-center select-none touch-none grow h-5" value={[value]}
              onValueChange={(v) => {
                let val = v[0] ?? 0
                if (Math.abs(val) < 2) val = 0
                val = Math.max(-TILT_MAX, Math.min(TILT_MAX, val))
                if (pixiObj && !pixiObj.destroyed) {
                  if (axis === 'H') pixiObj._tiltXDeg = val
                  else pixiObj._tiltYDeg = val
                  // [BUG 1 FIX] Same fix as desktop: create mesh on first-touch
                  if (pixiObj._tiltMesh && !pixiObj._tiltMesh.destroyed) {
                    syncTiltMesh(pixiObj, null)
                  } else {
                    applyTiltToObject(
                      pixiObj,
                      pixiObj._tiltXDeg || 0,
                      pixiObj._tiltYDeg || 0,
                      pixiObj._pixiRenderer || null
                    )
                  }
                }
                if (axis === 'H') setDragTiltX(val)
                else setDragTiltY(val)
              }}
              onValueCommit={(v) => {
                let val = v[0] ?? 0
                if (Math.abs(val) < 2) val = 0
                val = Math.max(-TILT_MAX, Math.min(TILT_MAX, val))
                handleLayerUpdate({ [axis === 'H' ? 'tiltX' : 'tiltY']: val })
                if (axis === 'H') setDragTiltX(null)
                else setDragTiltY(null)
              }}
              min={-TILT_MAX} max={TILT_MAX} step={0.5}
            >
              <Slider.Track className={`${trackBase} relative grow rounded-full h-1 overflow-hidden`}>
                <span aria-hidden className={`absolute top-0 bottom-0 ${safeBand}`} style={{ left: `${50 - safeHalfPct}%`, width: `${safeHalfPct * 2}%` }} />
                <Slider.Range className={`absolute ${rangeFill} rounded-full h-full`} />
              </Slider.Track>
              <Slider.Thumb className={thumbCls} aria-label={ariaLabel} />
            </Slider.Root>
            <span className={`text-xs font-mono min-w-[44px] text-right tabular-nums ${isUnsafe ? warnCol : valCol}`}>{value.toFixed(1)}°</span>
          </div>
        )

        return (
          <div
            className="absolute bottom-full mb-3 left-4 right-4 flex flex-col gap-1 p-4 rounded-xl backdrop-blur-md z-50 animate-in fade-in slide-in-from-bottom-2 duration-200"
            style={{
              backgroundColor: 'var(--editor-panel-bg)',
              backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
              border: '1px solid var(--editor-panel-border)',
              boxShadow: 'var(--editor-panel-shadow)',
              pointerEvents: 'auto'
            }}
          >
            <div className="absolute top-2 right-2 flex items-center gap-1.5 z-10">
              {(tiltX !== 0 || tiltY !== 0) && (
                <button onClick={() => {
                  setDragTiltX(null); setDragTiltY(null)
                  if (pixiObj && !pixiObj.destroyed) { pixiObj._tiltXDeg = 0; pixiObj._tiltYDeg = 0; syncTiltMesh(pixiObj, null) }
                  handleLayerUpdate({ tiltX: 0, tiltY: 0 })
                }}
                  className={`p-1 rounded-md transition-all ${theme === 'light' ? 'text-gray-400 hover:text-gray-600 hover:bg-gray-100' : 'text-white/30 hover:text-white/60 hover:bg-white/10'}`}
                  title="Reset Tilt"
                ><RotateCcw className="h-3.5 w-3.5" /></button>
              )}
              <button onClick={() => { setShowTiltPanel(false); onSubmenuChange?.(null) }}
                className={`p-1 rounded-md transition-colors ${theme === 'light' ? 'hover:bg-gray-100 text-gray-400' : 'hover:bg-white/10 text-white/40'}`}
              ><X className="h-3.5 w-3.5" /></button>
            </div>
            <div className="pr-10 pt-1">
              {renderRow('H', tiltX, 'Horizontal Tilt', isUnsafeX, ArrowLeftRight)}
              {renderRow('V', tiltY, 'Vertical Tilt', isUnsafeY, ArrowUpDown)}
            </div>
          </div>
        )
      })()}

      {/* Color Sub-menu */}
      {showColorMenu && (selectedLayer || selectedCanvas) && (
        <div
          className={isMobileBottom 
            ? "absolute bottom-full mb-3 left-4 right-4 h-12 flex items-center justify-between gap-3 px-4 rounded-xl backdrop-blur-md z-50 animate-in fade-in slide-in-from-bottom-2 duration-200"
            : "absolute top-full mt-2 left-1/2 -translate-x-1/2 flex flex-col gap-2 p-3 rounded-lg backdrop-blur-md z-50 animate-in fade-in slide-in-from-top-2 duration-200"
          }
          style={{
            backgroundColor: 'var(--editor-panel-bg)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            border: '1px solid var(--editor-panel-border)',
            boxShadow: 'var(--editor-panel-shadow)',
            minWidth: isMobileBottom ? 'auto' : '240px',
            pointerEvents: 'auto'
          }}
        >
          {isMobileBottom ? (
            <>
              <span className={`text-[10px] uppercase font-bold tracking-wider select-none shrink-0 ${theme === 'light' ? 'text-gray-500' : 'text-white/60'}`}>Color</span>
              
              <div className="flex items-center gap-2 overflow-x-auto scrollbar-none grow px-2 py-1">
                {/* First Circle: Custom Color Picker Manual Trigger */}
                <button
                  onClick={() => {
                    if (onOpenColorPicker) {
                      if (selectedLayer) {
                        onOpenColorPicker(selectedLayer.type === LAYER_TYPES.SHAPE ? 'fill' : 'text')
                      } else {
                        onOpenColorPicker('canvas')
                      }
                    }
                  }}
                  className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 cursor-pointer transition-all active:scale-95 border border-white/20"
                  style={{
                    background: 'linear-gradient(135deg, #ff0000, #ff7f00, #ffff00, #00ff00, #0000ff, #4b0082, #9400d3)',
                  }}
                  title="Custom color"
                >
                  <Plus className="h-3.5 w-3.5 text-white" strokeWidth={3} />
                </button>

                {/* Solid Colors */}
                {DEFAULT_COLORS.map((color, index) => {
                  const isSelected = selectedLayer 
                    ? (selectedLayer.data?.fill || selectedLayer.data?.color || selectedLayer.color) === color
                    : getCanvasBackgroundColor() === color
                  return (
                    <button
                      key={index}
                      onClick={() => {
                        if (selectedLayer) {
                          handleLayerUpdate({ data: { ...selectedLayer.data, fill: color, color: color } })
                        } else {
                          onCanvasUpdate?.({ backgroundColor: color })
                        }
                      }}
                      className={`w-7 h-7 rounded-full shrink-0 cursor-pointer transition-all active:scale-95 ${
                        isSelected ? 'ring-2 ring-purple-500 scale-105 shadow-md' : 'hover:ring-2 hover:ring-zinc-500'
                      }`}
                      style={{ backgroundColor: color }}
                      title={color}
                    />
                  )
                })}
              </div>

              <button
                onClick={() => {
                  setShowColorMenu(false)
                  onSubmenuChange?.(null)
                }}
                className={`p-1 rounded-md transition-colors shrink-0 ${theme === 'light' ? 'hover:bg-gray-100 text-gray-400' : 'hover:bg-white/10 text-white/40'}`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <span className={`text-[10px] uppercase font-bold tracking-wider select-none shrink-0 ${theme === 'light' ? 'text-gray-500' : 'text-white/60'}`}>Color</span>
                <button
                  onClick={() => {
                    setShowColorMenu(false)
                    onSubmenuChange?.(null)
                  }}
                  className={`p-1 rounded-md transition-colors ${theme === 'light' ? 'hover:bg-gray-100 text-gray-400' : 'hover:bg-white/10 text-white/40'}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              
              <div className="max-h-[140px] overflow-y-auto pr-1 flex flex-col gap-2 scrollbar-none">
                <div className="grid grid-cols-5 gap-2.5 justify-items-center py-1">
                  {DEFAULT_COLORS.map((color, index) => {
                    const isSelected = selectedLayer 
                      ? (selectedLayer.data?.fill || selectedLayer.data?.color || selectedLayer.color) === color
                      : getCanvasBackgroundColor() === color
                    return (
                      <button
                        key={index}
                        onClick={() => {
                          if (selectedLayer) {
                            handleLayerUpdate({ data: { ...selectedLayer.data, fill: color, color: color } })
                          } else {
                            onCanvasUpdate?.({ backgroundColor: color })
                          }
                        }}
                        className={`w-8 h-8 rounded-full cursor-pointer transition-all active:scale-95 ${
                          isSelected ? 'ring-2 ring-purple-500 scale-105 shadow-md' : 'hover:ring-2 hover:ring-zinc-500'
                        }`}
                        style={{ backgroundColor: color }}
                        title={color}
                      />
                    )
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Font Family Sub-menu (Mobile Only) */}
      {showFontMenu && selectedLayer?.type === LAYER_TYPES.TEXT && isMobileBottom && (
        <div
          className="absolute bottom-full mb-3 left-4 right-4 h-12 flex items-center justify-between gap-3 px-4 rounded-xl backdrop-blur-md z-50 animate-in fade-in slide-in-from-bottom-2 duration-200"
          style={{
            backgroundColor: 'var(--editor-panel-bg)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            border: '1px solid var(--editor-panel-border)',
            boxShadow: 'var(--editor-panel-shadow)',
            pointerEvents: 'auto'
          }}
        >
          <span className={`text-[10px] uppercase font-bold tracking-wider select-none shrink-0 ${theme === 'light' ? 'text-gray-500' : 'text-white/60'}`}>Font</span>
          
          <div className="flex items-center gap-2 overflow-x-auto scrollbar-none grow px-2 py-1">
            {fonts.map((font) => {
              const isSelected = getFontFamily() === font
              return (
                <button
                  key={font}
                  onClick={() => handleLayerUpdate({ data: { ...selectedLayer.data, fontFamily: font } })}
                  style={{ fontFamily: font }}
                  className={`px-3 py-1.5 rounded-lg shrink-0 text-xs font-medium transition-all active:scale-95 border ${
                    isSelected
                      ? 'bg-purple-600/20 border-purple-500/50 text-purple-400 shadow-sm'
                      : (theme === 'light' ? 'bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200' : 'bg-white/5 text-white border-transparent hover:bg-white/10')
                  }`}
                >
                  {font}
                </button>
              )
            })}
          </div>

          <button
            onClick={() => {
              setShowFontMenu(false)
              onSubmenuChange?.(null)
            }}
            className={`p-1 rounded-md transition-colors shrink-0 ${theme === 'light' ? 'hover:bg-gray-100 text-gray-400' : 'hover:bg-white/10 text-white/40'}`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Font Size Sub-menu (Mobile Only) */}
      {showSizeMenu && selectedLayer?.type === LAYER_TYPES.TEXT && isMobileBottom && (
        <div
          className="absolute bottom-full mb-3 left-4 right-4 h-12 flex items-center justify-between gap-3 px-4 rounded-xl backdrop-blur-md z-50 animate-in fade-in slide-in-from-bottom-2 duration-200"
          style={{
            backgroundColor: 'var(--editor-panel-bg)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            border: '1px solid var(--editor-panel-border)',
            boxShadow: 'var(--editor-panel-shadow)',
            pointerEvents: 'auto'
          }}
        >
          <div className="flex items-center gap-1.5 shrink-0 select-none">
            <span className={`text-[10px] uppercase font-bold tracking-wider ${theme === 'light' ? 'text-gray-500' : 'text-white/60'}`}>Size</span>
            <input
              type="number"
              value={localFontSize}
              onChange={(e) => setLocalFontSize(e.target.value)}
              onFocus={handleInputFocus}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const val = parseInt(localFontSize, 10)
                  if (!isNaN(val) && val > 0) {
                    handleLayerUpdate({
                      data: { ...selectedLayer.data, fontSize: val },
                      scaleX: 1,
                      scaleY: 1
                    })
                    e.currentTarget.blur()
                  }
                }
              }}
              onBlur={() => {
                if (globalBlurListenerRef.current) {
                  document.removeEventListener('pointerdown', globalBlurListenerRef.current, true)
                  globalBlurListenerRef.current = null
                }
                const val = parseInt(localFontSize, 10)
                if (!isNaN(val) && val > 0) {
                  handleLayerUpdate({
                    data: { ...selectedLayer.data, fontSize: val },
                    scaleX: 1,
                    scaleY: 1
                  })
                } else {
                  setLocalFontSize(currentFontSize.toString())
                }
              }}
              className={`font-size-input w-12 h-7 px-1 rounded-lg text-xs font-mono font-bold text-center border focus:outline-none focus:border-purple-500/50 ${
                theme === 'light' 
                  ? 'bg-gray-100 border-gray-200 text-gray-900 focus:bg-white' 
                  : 'bg-white/5 border-white/10 text-white focus:bg-white/10'
              }`}
              min="1"
            />
          </div>
          
          <div className="flex items-center gap-2 overflow-x-auto scrollbar-none grow px-2 py-1">
            {[8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 64, 72, 96, 120].map((size) => {
              const isSelected = getFontSize() === size
              return (
                <button
                  key={size}
                  onClick={() => {
                    const newSize = parseInt(size, 10)
                    handleLayerUpdate({
                      data: { ...selectedLayer.data, fontSize: newSize },
                      scaleX: 1,
                      scaleY: 1
                    })
                  }}
                  className={`px-3 py-1 rounded-lg shrink-0 text-xs font-mono font-bold transition-all active:scale-95 border ${
                    isSelected
                      ? 'bg-purple-600/20 border-purple-500/50 text-purple-400 shadow-sm'
                      : (theme === 'light' ? 'bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200' : 'bg-white/5 text-white border-transparent hover:bg-white/10')
                  }`}
                >
                  {size}
                </button>
              )
            })}
          </div>

          <button
            onClick={() => {
              setShowSizeMenu(false)
              onSubmenuChange?.(null)
            }}
            className={`p-1 rounded-md transition-colors shrink-0 ${theme === 'light' ? 'hover:bg-gray-100 text-gray-400' : 'hover:bg-white/10 text-white/40'}`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Text Alignment Sub-menu (Mobile Only) */}
      {showAlignMenu && selectedLayer?.type === LAYER_TYPES.TEXT && isMobileBottom && (
        <div
          className="absolute bottom-full mb-3 left-4 right-4 h-12 flex items-center justify-between gap-3 px-4 rounded-xl backdrop-blur-md z-50 animate-in fade-in slide-in-from-bottom-2 duration-200"
          style={{
            backgroundColor: 'var(--editor-panel-bg)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            border: '1px solid var(--editor-panel-border)',
            boxShadow: 'var(--editor-panel-shadow)',
            pointerEvents: 'auto'
          }}
        >
          <span className={`text-[10px] uppercase font-bold tracking-wider select-none shrink-0 ${theme === 'light' ? 'text-gray-500' : 'text-white/60'}`}>Align</span>
          
          <div className="flex items-center gap-3 overflow-x-auto scrollbar-none grow px-2 py-1 justify-center">
            {/* Left Align */}
            <button
              onClick={() => handleLayerUpdate({ data: { ...selectedLayer.data, textAlign: 'left' } })}
              className={`p-2 rounded-lg shrink-0 transition-all active:scale-95 border flex items-center gap-1.5 text-xs font-semibold ${
                selectedLayer.data?.textAlign === 'left' || !selectedLayer.data?.textAlign
                  ? 'bg-purple-600/20 border-purple-500/50 text-purple-400'
                  : (theme === 'light' ? 'bg-gray-100 text-gray-700 border-gray-200' : 'bg-white/5 text-white border-transparent')
              }`}
            >
              <AlignLeft className="h-4 w-4" />
              <span>Left</span>
            </button>

            {/* Center Align */}
            <button
              onClick={() => handleLayerUpdate({ data: { ...selectedLayer.data, textAlign: 'center' } })}
              className={`p-2 rounded-lg shrink-0 transition-all active:scale-95 border flex items-center gap-1.5 text-xs font-semibold ${
                selectedLayer.data?.textAlign === 'center'
                  ? 'bg-purple-600/20 border-purple-500/50 text-purple-400'
                  : (theme === 'light' ? 'bg-gray-100 text-gray-700 border-gray-200' : 'bg-white/5 text-white border-transparent')
              }`}
            >
              <AlignCenter className="h-4 w-4" />
              <span>Center</span>
            </button>

            {/* Right Align */}
            <button
              onClick={() => handleLayerUpdate({ data: { ...selectedLayer.data, textAlign: 'right' } })}
              className={`p-2 rounded-lg shrink-0 transition-all active:scale-95 border flex items-center gap-1.5 text-xs font-semibold ${
                selectedLayer.data?.textAlign === 'right'
                  ? 'bg-purple-600/20 border-purple-500/50 text-purple-400'
                  : (theme === 'light' ? 'bg-gray-100 text-gray-700 border-gray-200' : 'bg-white/5 text-white border-transparent')
              }`}
            >
              <AlignRight className="h-4 w-4" />
              <span>Right</span>
            </button>

            <div className={`w-px h-6 shrink-0 ${theme === 'light' ? 'bg-gray-200' : 'bg-zinc-800'}`} />

            {/* Water Flow */}
            <button
              onClick={() => handleLayerUpdate({ data: { ...selectedLayer.data, enableFlow: !selectedLayer.data?.enableFlow } })}
              className={`p-2 rounded-lg shrink-0 transition-all active:scale-95 border flex items-center gap-1.5 text-xs font-semibold ${
                selectedLayer.data?.enableFlow
                  ? 'bg-purple-600/20 border-purple-500/50 text-[#22c55e]'
                  : (theme === 'light' ? 'bg-gray-100 text-gray-700 border-gray-200' : 'bg-white/5 text-white border-transparent')
              }`}
            >
              <Waves className={`h-4 w-4 ${selectedLayer.data?.enableFlow ? 'animate-pulse' : ''}`} />
              <span>Water Flow</span>
            </button>
          </div>

          <button
            onClick={() => {
              setShowAlignMenu(false)
              onSubmenuChange?.(null)
            }}
            className={`p-1 rounded-md transition-colors shrink-0 ${theme === 'light' ? 'hover:bg-gray-100 text-gray-400' : 'hover:bg-white/10 text-white/40'}`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Add Step Hint Modal */}
      {showAddStepHint && (
        <div
          className={`absolute ${isMobileBottom ? 'bottom-full mb-3' : 'top-full mt-2.5'} z-[100] animate-in fade-in ${isMobileBottom ? 'slide-in-from-bottom-2' : 'slide-in-from-top-2'} duration-300`}
          style={{
            pointerEvents: 'auto',
            left: tooltipLeft !== null ? `${tooltipLeft}px` : '50%',
            transform: 'translateX(-50%)'
          }}
        >
          <div
            className="relative bg-[#6940c9] text-white px-4 py-2.5 rounded-2xl sm:rounded-full shadow-[0_15px_40px_rgba(0,0,0,0.5)] border border-white/20 flex flex-row items-center gap-3 sm:gap-4 max-w-[calc(100vw-32px)] sm:max-w-none w-fit sm:w-max text-left sm:text-center animate-bounce-subtle"
          >
            {/* Arrow inside the bouncing container so they move together cohesively */}
            <div
              className={`absolute ${isMobileBottom ? '-bottom-1.5 border-b border-r' : '-top-1.5 border-t border-l'} left-1/2 -ml-1.5 w-3 h-3 rotate-45 border-white/20`}
              style={{ backgroundColor: '#6940c9' }}
            />

            <span className="text-[11px] sm:text-[12.5px] font-semibold leading-normal opacity-95">
              Now change anything, move, scale, rotate, blur or edit, it will animate.
            </span>

            <button
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setShowAddStepHint(false)
                setHasShownAddStepHint(true)
                try {
                  localStorage.setItem('vevara_hint_add_step_shown', 'true')
                } catch (e) {
                  // Ignore localStorage errors
                }
              }}
              className="text-[11px] font-bold opacity-80 hover:opacity-100 transition-opacity underline decoration-white/40 underline-offset-4 text-purple-200 whitespace-nowrap self-center"
            >
              hide
            </button>
          </div>
        </div>
      )}

      {/* Audio Volume Sub-tab (Modal) — mobile only */}
      {showAudioVolume && selectedAudioBlock && isMobileBottom && (
        <div
          className="absolute bottom-full mb-3 left-4 right-4 h-12 flex items-center justify-between gap-3 px-4 rounded-xl backdrop-blur-md z-50 animate-in fade-in slide-in-from-bottom-2 duration-200"
          style={{
            backgroundColor: 'var(--editor-panel-bg)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            border: '1px solid var(--editor-panel-border)',
            boxShadow: 'var(--editor-panel-shadow)',
            pointerEvents: 'auto'
          }}
        >
          <button
            onClick={() => {
              const newMuted = !audioMuted
              setAudioMuted(newMuted)
              onAudioBlockUpdate?.({ id: selectedAudioBlock.id, muted: newMuted })
            }}
            className={`p-1 rounded transition-colors ${
              theme === 'light' ? 'hover:bg-black/5 text-gray-700' : 'hover:bg-white/10 text-white'
            }`}
            title={audioMuted ? 'Unmute' : 'Mute'}
          >
            {audioMuted ? (
              <VolumeX className="h-4 w-4" strokeWidth={2} />
            ) : (
              <Volume2 className="h-4 w-4" strokeWidth={2} />
            )}
          </button>

          <Slider.Root
            className="relative flex items-center select-none touch-none grow h-5"
            value={[audioMuted ? 0 : Math.round(audioVolume * 100)]}
            onValueChange={(value) => {
              const v = value[0] / 100
              setAudioVolume(v)
              onAudioBlockUpdate?.({ id: selectedAudioBlock.id, volume: v, muted: v === 0 })
              if (v > 0 && audioMuted) {
                setAudioMuted(false)
              } else if (v === 0 && !audioMuted) {
                setAudioMuted(true)
              }
            }}
            min={0} max={100} step={1}
          >
            <Slider.Track className={`${theme === 'light' ? 'bg-gray-200' : 'bg-white/10'} relative grow rounded-full h-1`}>
              <Slider.Range className="absolute bg-[#7c4af0] rounded-full h-full" />
            </Slider.Track>
            <Slider.Thumb className={`block w-4 h-4 rounded-full transition-all focus:outline-none cursor-pointer ${theme === 'light' ? 'bg-white border-2 border-[#7c4af0] shadow-sm' : 'bg-white shadow-md hover:scale-110'}`} aria-label="Audio Volume" />
          </Slider.Root>
          <span className={`text-xs font-mono min-w-[32px] text-right shrink-0 ${theme === 'light' ? 'text-gray-700' : 'text-white'}`}>
            {audioMuted ? '0%' : `${Math.round(audioVolume * 100)}%`}
          </span>
          <button
            onClick={() => { setShowAudioVolume(false); onSubmenuChange?.(null) }}
            className={`p-1 rounded-md transition-colors shrink-0 ${theme === 'light' ? 'hover:bg-gray-100 text-gray-400' : 'hover:bg-white/10 text-white/40'}`}
          ><X className="h-3.5 w-3.5" /></button>
        </div>
      )}

      <style>{`
        @keyframes bounce-subtle {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-6px); }
        }
        .animate-bounce-subtle {
          animation: bounce-subtle 2.5s infinite ease-in-out;
        }
        .scrollbar-none::-webkit-scrollbar {
          display: none;
        }
        .scrollbar-none {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
    </div>
  )

}

export default CanvasControls
