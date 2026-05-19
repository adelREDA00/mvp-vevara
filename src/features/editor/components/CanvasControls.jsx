import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, useContext } from 'react'
import { ThemeContext } from '../../../app/context/ThemeContext'
import {
  Minus, ChevronDown,
  Settings, Zap, X, MoreVertical, Layers,
  Volume2, VolumeX, Ghost, Droplets, FlipHorizontal2,
  Plus, Rotate3d, Check, Eye, EyeOff, Waves,
  AlignLeft, AlignCenter, AlignRight, RotateCcw,
  ArrowLeftRight, ArrowUpDown
} from 'lucide-react'
import * as Slider from '@radix-ui/react-slider'
import { LAYER_TYPES } from '../../../store/models'
import { BLUR_MAX } from '../../engine/motion/blurConstants.js'
import { CORNER_RADIUS_MAX } from '../../engine/motion/cornerRadiusConstants.js'
import { DropdownMenu, DropdownMenuItem } from './DropdownMenu'
import { useSelector, useDispatch } from 'react-redux'
import { selectTutorialState, endTutorial, setAutoPlayState } from '../../../store/slices/tutorialSlice'

const DEFAULT_COLORS = [
  '#6367FF', '#8494FF', '#C9BEFF', '#FFDBFD', '#ffffff',
  '#222831', '#393E46', '#00ADB5', '#EEEEEE', '#000000',
  '#FFF5E4', '#FFE3E1', '#FFD1D1', '#FF9494', '#ff4500',
  '#00d1b2', '#f5f5f5', '#209cee', '#ffdd57', '#ff3860'
]

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
  onToggleMotionPanel,
  isMotionCaptureActive = false,
  onStartMotionCapture,
  onApplyMotion,
  onCancelMotion,
  onFlipCardFrame,
  requestOpenControl = null,
  stepsCount = 0,
  editingStepActionCount = 0,
  showPasteboard = true,
  onTogglePasteboard,
  isMobileBottom = false,
  onSubmenuChange
}) {
  const { theme } = useContext(ThemeContext)
  const dispatch = useDispatch()
  const { active: tutorialActive, step: tutorialStep } = useSelector(selectTutorialState)

  const [showOpacitySlider, setShowOpacitySlider] = useState(false)
  const [showBlurSlider, setShowBlurSlider] = useState(false)
  const [showCornerRadiusSlider, setShowCornerRadiusSlider] = useState(false)
  const [showTiltPanel, setShowTiltPanel] = useState(false)
  const [showColorMenu, setShowColorMenu] = useState(false)
  const [showAddStepHint, setShowAddStepHint] = useState(false)
  const scrollContainerRef = useRef(null)
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
      return false
    })()

    setShowOpacitySlider(false)
    setShowBlurSlider(false)
    setShowCornerRadiusSlider(false)
    setShowTiltPanel(false)
    setShowColorMenu(false)

    if (turnOn) {
      if (menuName === 'opacity') setShowOpacitySlider(true)
      if (menuName === 'blur') setShowBlurSlider(true)
      if (menuName === 'radius') setShowCornerRadiusSlider(true)
      if (menuName === 'tilt') setShowTiltPanel(true)
      if (menuName === 'color') setShowColorMenu(true)
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
    onSubmenuChange?.(null)
  }, [selectedLayer?.id, selectedCanvas])

  // Open opacity/blur slider when requested by parent (e.g. from MotionPanel)
  useEffect(() => {
    if (requestOpenControl === 'opacity') {
      setShowOpacitySlider(true)
      setShowBlurSlider(false)
      setShowCornerRadiusSlider(false)
      setShowTiltPanel(false)
    } else if (requestOpenControl === 'blur') {
      setShowBlurSlider(true)
      setShowOpacitySlider(false)
      setShowCornerRadiusSlider(false)
      setShowTiltPanel(false)
    } else if (requestOpenControl === 'cornerRadius') {
      setShowCornerRadiusSlider(true)
      setShowOpacitySlider(false)
      setShowBlurSlider(false)
      setShowTiltPanel(false)
    } else if (requestOpenControl === 'tilt') {
      setShowTiltPanel(true)
      setShowOpacitySlider(false)
      setShowBlurSlider(false)
      setShowCornerRadiusSlider(false)
    }
  }, [requestOpenControl])

  // [MOBILE] Auto-scroll to the right on small screens to ensure "Add Step" is visible
  useLayoutEffect(() => {
    if (scrollContainerRef.current && typeof window !== 'undefined' && window.innerWidth < 1024) {
      // Small delay to ensure children are rendered and measured
      const timer = setTimeout(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollLeft = scrollContainerRef.current.scrollWidth
        }
      }, 100)
      return () => clearTimeout(timer)
    }
  }, [selectedLayer?.id, selectedCanvas])

  const handleLayerUpdate = (updates) => {
    if (onLayerUpdate) {
      onLayerUpdate(updates)
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
  const getFontSize = () => {
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



  return (
    <div className={isMobileBottom ? "relative flex flex-col items-center justify-center w-full px-4 py-1.5" : "relative flex flex-col items-center justify-center py-2 px-3"}>
      <div
        ref={scrollContainerRef}
        className={isMobileBottom 
          ? "h-10 flex items-center justify-center gap-3 px-4 w-full overflow-x-auto scrollbar-none transition-all duration-300"
          : "h-10 flex items-center gap-3 px-3 rounded-[12px] max-w-[calc(100vw-24px)] overflow-x-auto mobile-scrollbar backdrop-blur-md transition-all duration-300"
        }
        style={isMobileBottom ? {
          backgroundColor: 'transparent',
          backdropFilter: 'none',
          WebkitBackdropFilter: 'none',
          border: 'none',
          boxShadow: 'none',
          pointerEvents: 'auto',
          justifyContent: 'safe center',
        } : {
          backgroundColor: 'var(--editor-panel-bg)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          border: '1px solid var(--editor-panel-border)',
          boxShadow: 'var(--editor-panel-shadow)',
          pointerEvents: 'auto',
        }}
      >
        {/* Canvas Background Color Picker - Specific UI */}
        {selectedCanvas && currentScene && (
          <div className="flex items-center gap-2 flex-shrink-0 mr-2">
            {/* <span className="text-white text-xs">Background:</span> */}
            <button
              onClick={() => {
                if (isMobileBottom) {
                  toggleSubmenu('color')
                } else if (onOpenColorPicker) {
                  onOpenColorPicker('canvas')
                }
              }}
              className={`w-6 h-6 rounded-full border-2 cursor-pointer transition-all hover:ring-2 ${theme === 'light' ? 'border-gray-300 hover:ring-gray-300' : 'border-zinc-600 hover:ring-zinc-500'}`}
              style={{
                backgroundColor: getCanvasBackgroundColor(),
                backgroundImage: (getCanvasBackgroundColor() === '#ffffff' || getCanvasBackgroundColor() === '#FFFFFF') ? 'conic-gradient(from 0deg, red, yellow, lime, aqua, blue, magenta, red)' : undefined
              }}
              title="Canvas Background Color"
            />
            <button
              onClick={() => onTogglePasteboard?.()}
              className={`h-6 px-1.5 rounded-md transition-all flex items-center justify-center border ${showPasteboard
                ? 'bg-[#7c4af0]/20 border-[#7c4af0]/50 text-[#7c4af0]'
                : (theme === 'light'
                  ? 'text-gray-400 hover:bg-gray-100 border-transparent hover:border-gray-200'
                  : 'text-white/40 hover:bg-white/10 border-transparent hover:border-white/10')
                }`}
              title={showPasteboard ? "Hide Pasteboard" : "Show Pasteboard"}
            >
              {showPasteboard ? <Eye className="h-4 w-4" strokeWidth={2.5} /> : <EyeOff className="h-4 w-4" strokeWidth={2.5} />}
            </button>
            <div className={`w-px h-4 mx-1 ${theme === 'light' ? 'bg-gray-200' : 'bg-zinc-700'}`} />
          </div>
        )}

        {/* Color Picker - Circular (Generic for Layers) */}
        {!selectedCanvas && (
          <div className="relative flex-shrink-0 flex justify-center" style={{ width: '32px' }}>
            <button
              onClick={() => {
                if (isMobileBottom) {
                  toggleSubmenu('color')
                } else if (onOpenColorPicker && selectedLayer) {
                  if (selectedLayer.type === LAYER_TYPES.BACKGROUND) {
                    onOpenColorPicker('canvas') // Background layers use canvas color picker
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

            {/* Font Size Dropdown */}
            <DropdownMenu
              trigger={
                <button className={`h-8 px-2 rounded-[8px] text-xs transition-all flex items-center gap-2 outline-none min-w-[60px] ${theme === 'light'
                  ? 'bg-gray-100 text-gray-900 border border-gray-200 hover:bg-gray-200'
                  : 'bg-white/5 text-white/90 border border-white/5 hover:bg-white/10'}`}>
                  <span className="flex-1 text-left font-medium">{getFontSize()}</span>
                  <ChevronDown className="h-3.5 w-3.5 opacity-60" strokeWidth={2} />
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

            {/* Combined Alignment & Water Flow Dropdown */}
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
                        <Waves
                          className="absolute -top-1 -right-1 h-2 w-2 text-[#22c55e] opacity-90 animate-pulse"
                          strokeWidth={2.5}
                        />
                      )}
                    </div>

                    <ChevronDown className="h-3 w-3 opacity-40" strokeWidth={2.5} />
                  </div>
                </button>
              }
            >
              <div className="py-1 min-w-[180px]">
                <DropdownMenuItem
                  onClick={() => handleLayerUpdate({
                    data: {
                      ...selectedLayer.data,
                      textAlign: 'left'
                    }
                  })}
                >
                  <div className={`flex items-center justify-between w-full ${selectedLayer.data?.textAlign === 'left' ? 'text-purple-400' : ''}`}>
                    <div className="flex items-center gap-3">
                      <AlignLeft className="h-4 w-4" strokeWidth={2} />
                      <span className="font-medium">Left Alignment</span>
                    </div>
                    {selectedLayer.data?.textAlign === 'left' && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                  </div>
                </DropdownMenuItem>

                <DropdownMenuItem
                  onClick={() => handleLayerUpdate({
                    data: {
                      ...selectedLayer.data,
                      textAlign: 'center'
                    }
                  })}
                >
                  <div className={`flex items-center justify-between w-full ${selectedLayer.data?.textAlign === 'center' ? 'text-purple-400' : ''}`}>
                    <div className="flex items-center gap-3">
                      <AlignCenter className="h-4 w-4" strokeWidth={2} />
                      <span className="font-medium">Center</span>
                    </div>
                    {selectedLayer.data?.textAlign === 'center' && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                  </div>
                </DropdownMenuItem>

                <DropdownMenuItem
                  onClick={() => handleLayerUpdate({
                    data: {
                      ...selectedLayer.data,
                      textAlign: 'right'
                    }
                  })}
                >
                  <div className={`flex items-center justify-between w-full ${selectedLayer.data?.textAlign === 'right' ? 'text-purple-400' : ''}`}>
                    <div className="flex items-center gap-3">
                      <AlignRight className="h-4 w-4" strokeWidth={2} />
                      <span className="font-medium">Right Alignment</span>
                    </div>
                    {selectedLayer.data?.textAlign === 'right' && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                  </div>
                </DropdownMenuItem>

                <div className="h-px bg-white/5 my-1 mx-2" />

                <DropdownMenuItem
                  onClick={() => handleLayerUpdate({
                    data: {
                      ...selectedLayer.data,
                      enableFlow: !selectedLayer.data?.enableFlow
                    }
                  })}
                >
                  <div className={`flex items-center justify-between w-full ${selectedLayer.data?.enableFlow ? 'text-purple-400 font-semibold' : ''}`}>
                    <div className="flex items-center gap-3">
                      <Waves className={`h-4 w-4 ${selectedLayer.data?.enableFlow ? 'animate-pulse' : ''}`} strokeWidth={2} />
                      <span className="font-medium">Water Flow (Wrap)</span>
                    </div>
                    {selectedLayer.data?.enableFlow && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                  </div>
                </DropdownMenuItem>
              </div>
            </DropdownMenu>

          </>
        )}

        {/* Shape-specific controls */}
        {selectedLayer?.type === LAYER_TYPES.SHAPE && (
          <>
            {/* Stroke Style Button */}
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
                {/* Stroke Width Slider */}
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
                    min={0}
                    max={20}
                    step={0.5}
                  >
                    <Slider.Track className={`${theme === 'light' ? 'bg-gray-100' : 'bg-zinc-700'} relative grow rounded-full h-1.5`}>
                      <Slider.Range className={`absolute ${theme === 'light' ? 'bg-[#7c4af0]' : 'bg-white'} rounded-full h-full`} />
                    </Slider.Track>
                    <Slider.Thumb className={`block w-4 h-4 rounded-full shadow-md focus:outline-none focus:ring-2 ${theme === 'light'
                      ? 'bg-white border-2 border-[#7c4af0] focus:ring-[#7c4af0]'
                      : 'bg-white hover:bg-zinc-100 focus:ring-white focus:ring-offset-2 focus:ring-offset-zinc-800'}`} />
                  </Slider.Root>
                </div>

                {/* Stroke Color */}
                <div className="mb-4">
                  <label className={`text-xs mb-2 block ${theme === 'light' ? 'text-gray-500' : 'text-gray-300'}`}>Color</label>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        if (onOpenColorPicker) {
                          onOpenColorPicker('stroke')
                        }
                      }}
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

                {/* Stroke Style */}
                <div>
                  <label className={`text-xs mb-2 block ${theme === 'light' ? 'text-gray-500' : 'text-gray-300'}`}>Style</label>
                  <div className="flex gap-2">
                    {['solid', 'dashed', 'dotted'].map((style) => (
                      <button
                        key={style}
                        onClick={() => {
                          handleLayerUpdate({ data: { ...selectedLayer.data, strokeStyle: style } })
                        }}
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
            onClick={() => {
              toggleSubmenu('opacity')
            }}
            className={`h-8 px-2 rounded-[8px] transition-all flex items-center gap-1.5 touch-manipulation whitespace-nowrap border ${theme === 'light'
              ? (showOpacitySlider ? 'bg-purple-500/10 border-purple-500/30 text-purple-600' : 'text-gray-700 hover:bg-gray-100 border-transparent hover:border-gray-200')
              : (showOpacitySlider ? 'bg-white/20 border-white/20 text-white' : 'text-white hover:bg-white/10 border-transparent hover:border-white/10')}`}
            title="Layer Transparency"
          >
            <Ghost className="h-4 w-4 flex-shrink-0 opacity-70" strokeWidth={2} />
            {/* <span className="text-xs font-medium">Opacity</span> */}
          </button>
        )}

        {/* Blur Control */}
        {selectedLayer && selectedLayer.type !== LAYER_TYPES.BACKGROUND && (
          <button
            onClick={() => {
              toggleSubmenu('blur')
            }}
            className={`h-8 px-2 rounded-[8px] transition-all flex items-center gap-1.5 touch-manipulation whitespace-nowrap border ${theme === 'light'
              ? (showBlurSlider ? 'bg-purple-500/10 border-purple-500/30 text-purple-600' : 'text-gray-700 hover:bg-gray-100 border-transparent hover:border-gray-200')
              : (showBlurSlider ? 'bg-white/20 border-white/20 text-white' : 'text-white hover:bg-white/10 border-transparent hover:border-white/10')}`}
            title="Layer Blur"
          >
            <Droplets className="h-4 w-4 flex-shrink-0 opacity-70" strokeWidth={2} />
            {/* <span className="text-xs font-medium">Blur</span> */}
          </button>
        )}

        {/* Corner Radius Control - Only for rect/square shapes */}
        {selectedLayer?.type === LAYER_TYPES.SHAPE && hasCorners() && (
          <button
            onClick={() => {
              toggleSubmenu('radius')
            }}
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

        {/* 3D Tilt Control — available for all non-background layers */}
        {selectedLayer && selectedLayer.type !== LAYER_TYPES.BACKGROUND && (
          <button
            onClick={() => {
              toggleSubmenu('tilt')
            }}
            className={`h-8 px-2 rounded-[8px] transition-all flex items-center gap-1.5 touch-manipulation whitespace-nowrap border ${theme === 'light'
              ? (showTiltPanel ? 'bg-purple-500/10 border-purple-500/30 text-purple-600' : 'text-gray-700 hover:bg-gray-100 border-transparent hover:border-gray-200')
              : (showTiltPanel ? 'bg-white/20 border-white/20 text-white' : 'text-white hover:bg-white/10 border-transparent hover:border-white/10')}`}
            title="3D Tilt (Perspective)"
          >
            {/* Perspective / tilt cube icon */}

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

        {/* Video specific controls — also show for frame layers containing a video asset */}
        {(selectedLayer?.type === LAYER_TYPES.VIDEO || (selectedLayer?.type === LAYER_TYPES.FRAME && selectedLayer?.data?.assetIsVideo)) && (
          <button
            onClick={() => {
              const isMuted = selectedLayer.data?.muted !== false // default true
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

        {/* Motion Controls Group */}
        <div className="flex items-center gap-0.5 flex-shrink-0">
          {/* Motion Button - Toggle capture mode */}
          <button
            data-tutorial="add-step-button"
            onClick={() => {
              if (isMotionCaptureActive) {
                onApplyMotion?.()
                // Hide hint when applying motion
                setShowAddStepHint(false)
              } else {
                onStartMotionCapture?.()
                // Show hint if it's the first time AND no steps exist yet
                // Boolean check on hasShownAddStepHint for robustness
                if (!hasShownAddStepHint && Number(stepsCount) === 0) {
                  setShowAddStepHint(true)
                }
              }
            }}
            className={`h-8 px-3 rounded-[10px] transition-all duration-300 flex items-center gap-2 touch-manipulation whitespace-nowrap font-medium text-xs ${isMotionCaptureActive
              ? (editingStepActionCount > 0
                ? 'bg-[#7c4af0] text-white shadow-[0_0_20px_rgba(124,74,240,0.6)] ring-1 ring-white/20 animate-pulse-glow hover:bg-[#8b5cf6]'
                : (theme === 'light' ? 'bg-gray-100 text-gray-400' : 'bg-zinc-800/80 text-zinc-500') + ' border border-white/5 cursor-default')
              : (theme === 'light'
                ? 'text-gray-700 hover:bg-gray-100 active:bg-gray-200 border-transparent hover:border-gray-200'
                : 'text-white hover:bg-white/10 active:bg-white/15 border border-transparent hover:border-white/10')
              }`}
            title={isMotionCaptureActive ? "Save Step" : "Animate"}
          >
            {isMotionCaptureActive ? (
              <Check className="h-4 w-4 flex-shrink-0" strokeWidth={3} />
            ) : (
              <Zap className="h-4 w-4 flex-shrink-0" strokeWidth={2.5} />
            )}
            <span>{isMotionCaptureActive ? 'Save Step' : 'Animate'}</span>
          </button>

          {/* Cancel Button - Only shown in capture mode */}
          {isMotionCaptureActive && (
            <button
              onClick={() => {
                onCancelMotion?.()
                setShowAddStepHint(false)
              }}
              className={`${theme === 'light' ? 'text-gray-500 hover:bg-red-50' : 'text-white hover:bg-red-600/80'} active:bg-red-700 h-7 w-7 rounded-md transition-colors flex items-center justify-center`}
              title="Cancel Animation Capture"
            >
              <X className="h-4 w-4" />
            </button>
          )}

          {/* Motion Panel Menu - 3 dots to access MotionPanel for managing steps */}
          <button
            onClick={() => onToggleMotionPanel?.()}
            className={`h-7 w-7 rounded-md transition-colors flex items-center justify-center border ${theme === 'light'
              ? 'text-gray-700 hover:bg-gray-100 border-transparent hover:border-gray-200'
              : 'text-white hover:bg-white/10 border-transparent hover:border-white/10'}`}
            title="Animation Steps"
          >
            <MoreVertical className="h-4 w-4 opacity-70" />
          </button>
        </div>

      </div>

      {/* Transparency Sub-tab (Modal) */}
      {showOpacitySlider && selectedLayer && (
        <div
          className={isMobileBottom
            ? "absolute bottom-full mb-3 left-4 right-4 h-12 flex items-center justify-between gap-3 px-4 rounded-xl backdrop-blur-md z-50 animate-in fade-in slide-in-from-bottom-2 duration-200"
            : "absolute top-full mt-2 left-1/2 -translate-x-1/2 h-9 flex items-center gap-3 px-4 rounded-lg backdrop-blur-md z-50 animate-in fade-in slide-in-from-top-2 duration-200"
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
          <span className={`text-[10px] uppercase font-bold tracking-wider select-none shrink-0 ${theme === 'light' ? 'text-gray-500' : 'text-white/60'}`}>Opacity</span>

          <Slider.Root
            className="relative flex items-center select-none touch-none grow h-5"
            value={[Math.round((selectedLayer.opacity ?? 1) * 100)]}
            onValueChange={(value) => {
              handleLayerUpdate({ opacity: value[0] / 100 })
            }}
            min={0}
            max={100}
            step={1}
          >
            <Slider.Track className={`${theme === 'light' ? 'bg-gray-200' : 'bg-white/10'} relative grow rounded-full h-1`}>
              <Slider.Range className={`absolute ${theme === 'light' ? 'bg-[#7c4af0]' : 'bg-white'} rounded-full h-full`} />
            </Slider.Track>
            <Slider.Thumb
              className={`block w-4 h-4 rounded-full transition-all focus:outline-none cursor-pointer ${theme === 'light'
                ? 'bg-white border-2 border-[#7c4af0] shadow-sm'
                : 'bg-white shadow-md hover:scale-110'}`}
              aria-label="Layer Opacity"
            />
          </Slider.Root>

          <span className={`text-xs font-mono min-w-[32px] text-right shrink-0 ${theme === 'light' ? 'text-gray-700' : 'text-white'}`}>
            {Math.round((selectedLayer.opacity ?? 1) * 100)}%
          </span>

          {isMobileBottom && (
            <button
              onClick={() => {
                setShowOpacitySlider(false)
                onSubmenuChange?.(null)
              }}
              className={`p-1 rounded-md transition-colors shrink-0 ${theme === 'light' ? 'hover:bg-gray-100 text-gray-400' : 'hover:bg-white/10 text-white/40'}`}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Blur Sub-tab (Modal) */}
      {showBlurSlider && selectedLayer && (
        <div
          className={isMobileBottom
            ? "absolute bottom-full mb-3 left-4 right-4 h-12 flex items-center justify-between gap-3 px-4 rounded-xl backdrop-blur-md z-50 animate-in fade-in slide-in-from-bottom-2 duration-200"
            : "absolute top-full mt-2 left-1/2 -translate-x-1/2 h-9 flex items-center gap-3 px-4 rounded-lg backdrop-blur-md z-50 animate-in fade-in slide-in-from-top-2 duration-200"
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
          <span className={`text-[10px] uppercase font-bold tracking-wider select-none shrink-0 ${theme === 'light' ? 'text-gray-500' : 'text-white/60'}`}>Blur</span>

          <Slider.Root
            className="relative flex items-center select-none touch-none grow h-5"
            value={[Math.min(BLUR_MAX, selectedLayer.blur ?? 0)]}
            onValueChange={(value) => {
              const v = Math.max(0, Math.min(BLUR_MAX, value[0] ?? 0))
              handleLayerUpdate({ blur: v })
            }}
            min={0}
            max={BLUR_MAX}
            step={0.5}
          >
            <Slider.Track className={`${theme === 'light' ? 'bg-gray-200' : 'bg-white/10'} relative grow rounded-full h-1`}>
              <Slider.Range className={`absolute ${theme === 'light' ? 'bg-[#7c4af0]' : 'bg-white'} rounded-full h-full`} />
            </Slider.Track>
            <Slider.Thumb
              className={`block w-4 h-4 rounded-full transition-all focus:outline-none cursor-pointer ${theme === 'light'
                ? 'bg-white border-2 border-[#7c4af0] shadow-sm'
                : 'bg-white shadow-md hover:scale-110'}`}
              aria-label="Layer Blur"
            />
          </Slider.Root>

          <span className={`text-xs font-mono min-w-[32px] text-right shrink-0 ${theme === 'light' ? 'text-gray-700' : 'text-white'}`}>
            {Math.round(Math.min(BLUR_MAX, selectedLayer.blur ?? 0))}
          </span>

          {isMobileBottom && (
            <button
              onClick={() => {
                setShowBlurSlider(false)
                onSubmenuChange?.(null)
              }}
              className={`p-1 rounded-md transition-colors shrink-0 ${theme === 'light' ? 'hover:bg-gray-100 text-gray-400' : 'hover:bg-white/10 text-white/40'}`}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Corner Radius Sub-tab (Modal) */}
      {showCornerRadiusSlider && selectedLayer && hasCorners() && (
        <div
          className={isMobileBottom
            ? "absolute bottom-full mb-3 left-4 right-4 h-12 flex items-center justify-between gap-3 px-4 rounded-xl backdrop-blur-md z-50 animate-in fade-in slide-in-from-bottom-2 duration-200"
            : "absolute top-full mt-2 left-1/2 -translate-x-1/2 h-9 flex items-center gap-3 px-4 rounded-lg backdrop-blur-md z-50 animate-in fade-in slide-in-from-top-2 duration-200"
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
          <span className={`text-[10px] uppercase font-bold tracking-wider select-none shrink-0 ${theme === 'light' ? 'text-gray-500' : 'text-white/60'}`}>Radius</span>
          <Slider.Root
            className="relative flex items-center select-none touch-none grow h-5"
            value={[selectedLayer.data?.cornerRadius ?? 0]}
            onValueChange={(value) => {
              const v = Math.max(0, Math.min(CORNER_RADIUS_MAX, Math.round(value[0] ?? 0)))
              handleLayerUpdate({ data: { ...selectedLayer.data, cornerRadius: v } })
            }}
            min={0}
            max={Math.min(CORNER_RADIUS_MAX, Math.min(selectedLayer.width || 100, selectedLayer.height || 100) / 2)}
            step={1}
          >
            <Slider.Track className={`${theme === 'light' ? 'bg-gray-200' : 'bg-white/10'} relative grow rounded-full h-1`}>
              <Slider.Range className={`absolute ${theme === 'light' ? 'bg-[#7c4af0]' : 'bg-white'} rounded-full h-full`} />
            </Slider.Track>
            <Slider.Thumb
              className={`block w-4 h-4 rounded-full transition-all focus:outline-none cursor-pointer ${theme === 'light'
                ? 'bg-white border-2 border-[#7c4af0] shadow-sm'
                : 'bg-white shadow-md hover:scale-110'}`}
              aria-label="Corner Radius"
            />
          </Slider.Root>

          <span className={`text-xs font-mono min-w-[36px] text-right shrink-0 ${theme === 'light' ? 'text-gray-700' : 'text-white'}`}>
            {Math.round(selectedLayer.data?.cornerRadius ?? 0)}px
          </span>

          {isMobileBottom && (
            <button
              onClick={() => {
                setShowCornerRadiusSlider(false)
                onSubmenuChange?.(null)
              }}
              className={`p-1 rounded-md transition-colors shrink-0 ${theme === 'light' ? 'hover:bg-gray-100 text-gray-400' : 'hover:bg-white/10 text-white/40'}`}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      {/* 3D Tilt Sub-panel — compact stacked-slider layout */}
      {showTiltPanel && selectedLayer && (() => {
        const TILT_MAX = 60           // hard limit, matches TiltAction.clampTilt
        const TILT_SAFE = 45          // recommended upper bound
        const tiltX = selectedLayer.tiltX ?? 0
        const tiltY = selectedLayer.tiltY ?? 0
        const isUnsafeX = Math.abs(tiltX) > TILT_SAFE
        const isUnsafeY = Math.abs(tiltY) > TILT_SAFE
        const safeHalfPct = (TILT_SAFE / TILT_MAX) * 50
        const trackBase = theme === 'light' ? 'bg-gray-200' : 'bg-white/10'
        const safeBand = theme === 'light' ? 'bg-emerald-300/60' : 'bg-emerald-400/25'
        const rangeFill = theme === 'light' ? 'bg-[#7c4af0]' : 'bg-white'
        const labelCol = theme === 'light' ? 'text-gray-500' : 'text-white/60'
        const valCol = theme === 'light' ? 'text-gray-700' : 'text-white'
        const warnCol = theme === 'light' ? 'text-amber-600' : 'text-amber-400'
        const thumbCls = `block w-4 h-4 rounded-full transition-all focus:outline-none cursor-pointer ${theme === 'light'
          ? 'bg-white border-2 border-[#7c4af0] shadow-sm'
          : 'bg-white shadow-md hover:scale-110'}`

        const renderRow = (axis, value, onChange, ariaLabel, isUnsafe, Icon) => (
          <div className="flex items-center gap-2 w-full">
            <div className="flex items-center gap-1 shrink-0 w-[24px]">
              <Icon className={`h-2.5 w-2.5 ${labelCol}`} />
              <span className={`text-[10px] uppercase font-bold tracking-wider select-none text-center ${labelCol}`}>
                {axis}
              </span>
            </div>
            <Slider.Root
              className="relative flex items-center select-none touch-none grow h-5"
              value={[value]}
              onValueChange={(v) => {
                let val = v[0] ?? 0
                // Snap to 0 if within +/- 2 degrees for easier resetting
                if (Math.abs(val) < 2) {
                  val = 0
                }
                const clamped = Math.max(-TILT_MAX, Math.min(TILT_MAX, val))
                onChange(clamped)
              }}
              min={-TILT_MAX}
              max={TILT_MAX}
              step={0.5}
            >
              <Slider.Track className={`${trackBase} relative grow rounded-full h-1 overflow-hidden`}>
                <span
                  aria-hidden
                  className={`absolute top-0 bottom-0 ${safeBand}`}
                  style={{ left: `${50 - safeHalfPct}%`, width: `${safeHalfPct * 2}%` }}
                />
                <Slider.Range className={`absolute ${rangeFill} rounded-full h-full`} />
              </Slider.Track>
              <Slider.Thumb className={thumbCls} aria-label={ariaLabel} />
            </Slider.Root>
            <span className={`text-xs font-mono min-w-[44px] text-right tabular-nums ${isUnsafe ? warnCol : valCol}`}>
              {value.toFixed(1)}°
            </span>
          </div>
        )

        return (
          <div
            className={isMobileBottom
              ? "absolute bottom-full mb-3 left-4 right-4 flex flex-col gap-1 p-4 rounded-xl backdrop-blur-md z-50 animate-in fade-in slide-in-from-bottom-2 duration-200"
              : "absolute top-full mt-2 left-1/2 -translate-x-1/2 flex flex-col gap-0.5 px-4 py-2 rounded-lg backdrop-blur-md z-50 animate-in fade-in slide-in-from-top-2 duration-200"
            }
            style={{
              backgroundColor: 'var(--editor-panel-bg)',
              backdropFilter: 'blur(24px)',
              WebkitBackdropFilter: 'blur(24px)',
              border: '1px solid var(--editor-panel-border)',
              boxShadow: 'var(--editor-panel-shadow)',
              minWidth: isMobileBottom ? 'auto' : '270px',
              pointerEvents: 'auto'
            }}
          >
            {/* Absolute Close/Reset Icons */}
            <div className="absolute top-2 right-2 flex items-center gap-1.5 z-10">
              {(tiltX !== 0 || tiltY !== 0) && (
                <button
                  onClick={() => handleLayerUpdate({ tiltX: 0, tiltY: 0 })}
                  className={`p-1 rounded-md transition-all ${theme === 'light' ? 'text-gray-400 hover:text-gray-600 hover:bg-gray-100' : 'text-white/30 hover:text-white/60 hover:bg-white/10'}`}
                  title="Reset Tilt"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              )}
              {isMobileBottom && (
                <button
                  onClick={() => {
                    setShowTiltPanel(false)
                    onSubmenuChange?.(null)
                  }}
                  className={`p-1 rounded-md transition-colors ${theme === 'light' ? 'hover:bg-gray-100 text-gray-400' : 'hover:bg-white/10 text-white/40'}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <div className="pr-10 pt-1">
              {renderRow('H', tiltX, (v) => handleLayerUpdate({ tiltX: v }), 'Horizontal Tilt', isUnsafeX, ArrowLeftRight)}
              {renderRow('V', tiltY, (v) => handleLayerUpdate({ tiltY: v }), 'Vertical Tilt', isUnsafeY, ArrowUpDown)}
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

      {/* Add Step Hint Modal */}
      {showAddStepHint && (
        <div
          className={`absolute ${isMobileBottom ? 'bottom-full mb-4' : 'top-full mt-4'} left-1/2 -translate-x-1/2 z-[100] animate-in fade-in ${isMobileBottom ? 'slide-in-from-bottom-2' : 'slide-in-from-top-2'} duration-300`}
          style={{ pointerEvents: 'auto' }}
        >
          {/* Arrow */}
          <div
            className={`absolute ${isMobileBottom ? '-bottom-1.5 border-b border-r' : '-top-1.5 border-t border-l'} left-1/2 -translate-x-1/2 w-3 h-3 rotate-45 border-white/20`}
            style={{ backgroundColor: '#6940c9' }}
          />

          <div
            className="bg-[#6940c9] text-white px-4 py-2.5 rounded-2xl sm:rounded-full shadow-[0_15px_40px_rgba(0,0,0,0.5)] border border-white/20 flex flex-row items-center gap-3 sm:gap-4 max-w-[calc(100vw-32px)] sm:max-w-none w-fit sm:w-max text-left sm:text-center animate-bounce-subtle"
          >
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
