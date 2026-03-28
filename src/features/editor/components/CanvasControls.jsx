import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react'
import {
  Minus, ChevronDown,
  Settings, Zap, X, MoreVertical, Layers,
  Volume2, VolumeX, Ghost, Droplets, FlipHorizontal2,
  Plus, Check
} from 'lucide-react'
import * as Slider from '@radix-ui/react-slider'
import { LAYER_TYPES } from '../../../store/models'
import { BLUR_MAX } from '../../engine/motion/blurConstants.js'
import { CORNER_RADIUS_MAX } from '../../engine/motion/cornerRadiusConstants.js'
import { DropdownMenu, DropdownMenuItem } from './DropdownMenu'

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
  editingStepActionCount = 0
}) {

  const [showOpacitySlider, setShowOpacitySlider] = useState(false)
  const [showBlurSlider, setShowBlurSlider] = useState(false)
  const [showCornerRadiusSlider, setShowCornerRadiusSlider] = useState(false)
  const [showAddStepHint, setShowAddStepHint] = useState(false)
  const scrollContainerRef = useRef(null)
  const [hasShownAddStepHint, setHasShownAddStepHint] = useState(() => {
    try {
      return localStorage.getItem('vevara_hint_add_step_shown') === 'true'
    } catch (e) {
      return false
    }
  })

  // Auto-close slider when selection changes
  useEffect(() => {
    setShowOpacitySlider(false)
    setShowBlurSlider(false)
    setShowCornerRadiusSlider(false)
  }, [selectedLayer?.id, selectedCanvas])

  // Open opacity/blur slider when requested by parent (e.g. from MotionPanel)
  useEffect(() => {
    if (requestOpenControl === 'opacity') {
      setShowOpacitySlider(true)
      setShowBlurSlider(false)
      setShowCornerRadiusSlider(false)
    } else if (requestOpenControl === 'blur') {
      setShowBlurSlider(true)
      setShowOpacitySlider(false)
      setShowCornerRadiusSlider(false)
    } else if (requestOpenControl === 'cornerRadius') {
      setShowCornerRadiusSlider(true)
      setShowOpacitySlider(false)
      setShowBlurSlider(false)
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
    <div className="relative flex flex-col items-center justify-center py-2 px-3">
      <div
        ref={scrollContainerRef}
        className="h-10 flex items-center gap-3 px-3 rounded-[12px] max-w-[calc(100vw-24px)] overflow-x-auto mobile-scrollbar backdrop-blur-md transition-all duration-300 shadow-medium"
        style={{
          backgroundColor: 'rgba(15, 16, 21, 0.85)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          pointerEvents: 'auto',
        }}
      >
        {/* Canvas Background Color Picker - Specific UI */}
        {selectedCanvas && currentScene && (
          <div className="flex items-center gap-2 flex-shrink-0 mr-2">
            <span className="text-white text-xs">Background:</span>
            <button
              onClick={() => {
                if (onOpenColorPicker) {
                  onOpenColorPicker('canvas')
                }
              }}
              className="w-6 h-6 rounded-full border-2 border-zinc-600 cursor-pointer hover:border-zinc-500 transition-all hover:ring-2 hover:ring-zinc-500"
              style={{ backgroundColor: getCanvasBackgroundColor() }}
              title="Canvas Background Color"
            />
            <div className="w-px h-4 bg-zinc-700 mx-1" />
          </div>
        )}

        {/* Color Picker - Circular (Generic for Layers) */}
        {!selectedCanvas && (
          <div className="relative flex-shrink-0 flex justify-center" style={{ width: '32px' }}>
            <button
              onClick={() => {
                if (onOpenColorPicker && selectedLayer) {
                  if (selectedLayer.type === LAYER_TYPES.BACKGROUND) {
                    onOpenColorPicker('canvas') // Background layers use canvas color picker
                  } else if (selectedLayer.type === LAYER_TYPES.SHAPE || selectedLayer.type === LAYER_TYPES.TEXT) {
                    onOpenColorPicker(selectedLayer.type === LAYER_TYPES.SHAPE ? 'fill' : 'text')
                  }
                }
              }}
              disabled={!selectedLayer || (selectedLayer.type !== LAYER_TYPES.SHAPE && selectedLayer.type !== LAYER_TYPES.TEXT && selectedLayer.type !== LAYER_TYPES.BACKGROUND)}
              className="w-6 h-6 rounded-full cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-all hover:ring-2 hover:ring-zinc-500"
              style={{
                backgroundColor: selectedLayer?.type === LAYER_TYPES.BACKGROUND ? getCanvasBackgroundColor() : (isTransparent() ? 'transparent' : getColor()),
                backgroundImage: (selectedLayer?.type !== LAYER_TYPES.BACKGROUND && isTransparent()) ? 'linear-gradient(45deg, #666 25%, transparent 25%, transparent 75%, #666 75%, #666), linear-gradient(45deg, #666 25%, transparent 25%, transparent 75%, #666 75%, #666)' : undefined,
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
                <button className="h-8 px-3 rounded-[8px] bg-white/5 text-white/90 text-xs border border-white/5 hover:bg-white/10 flex items-center gap-2 transition-all outline-none min-w-[120px]">
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
                <button className="h-8 px-2 rounded-[8px] bg-white/5 text-white/90 text-xs border border-white/5 hover:bg-white/10 flex items-center gap-2 transition-all outline-none min-w-[60px]">
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

            {/* Alignment Toggle */}
            <button
              onClick={() => {
                const currentAlign = selectedLayer.data?.textAlign || 'left'
                let newAlign = 'center'

                if (currentAlign === 'center') {
                  newAlign = 'right'
                } else if (currentAlign === 'right') {
                  newAlign = 'left'
                }

                handleLayerUpdate({
                  data: {
                    ...selectedLayer.data,
                    textAlign: newAlign
                  }
                })
              }}
              className="text-white hover:bg-white/10 active:bg-white/15 h-8 px-2 rounded-[8px] transition-colors flex items-center justify-center min-w-[32px] border border-transparent hover:border-white/10"
              title={`Align: ${selectedLayer.data?.textAlign || 'left'}`}
            >
              <div className="flex flex-col gap-0.5 items-center">
                <div className={`h-0.5 bg-current rounded-full transition-all duration-200 ${selectedLayer.data?.textAlign === 'right' ? 'w-4 self-end' : (selectedLayer.data?.textAlign === 'center' ? 'w-4' : 'w-4 self-start')}`} />
                <div className={`h-0.5 bg-current rounded-full transition-all duration-200 ${selectedLayer.data?.textAlign === 'right' ? 'w-2 self-end' : (selectedLayer.data?.textAlign === 'center' ? 'w-2' : 'w-2 self-start')}`} />
                <div className={`h-0.5 bg-current rounded-full transition-all duration-200 ${selectedLayer.data?.textAlign === 'right' ? 'w-4 self-end' : (selectedLayer.data?.textAlign === 'center' ? 'w-4' : 'w-4 self-start')}`} />
              </div>
            </button>

          </>
        )}

        {/* Shape-specific controls */}
        {selectedLayer?.type === LAYER_TYPES.SHAPE && (
          <>
            {/* Stroke Style Button */}
            <DropdownMenu
              trigger={
                <button
                  className="text-white hover:bg-white/10 active:bg-white/15 h-8 px-2 rounded-[8px] transition-colors flex items-center gap-1.5 touch-manipulation whitespace-nowrap flex-shrink-0 border border-transparent hover:border-white/10"
                  title="Stroke Style"
                >
                  <Minus className="h-4 w-4 flex-shrink-0 opacity-60" strokeWidth={2} />
                  <span className="text-xs font-medium">Stroke</span>
                  <ChevronDown className="h-3 w-3 flex-shrink-0 opacity-60" strokeWidth={2} />
                </button>
              }
            >
              <div className="p-4 min-w-[280px]">
                {/* Stroke Width Slider */}
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs text-gray-300">Width</label>
                    <span className="text-xs text-white font-medium">{getStrokeWidth()}px</span>
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
                    <Slider.Track className="bg-zinc-700 relative grow rounded-full h-1.5">
                      <Slider.Range className="absolute bg-white rounded-full h-full" />
                    </Slider.Track>
                    <Slider.Thumb className="block w-4 h-4 bg-white rounded-full shadow-md hover:bg-zinc-100 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-zinc-800" />
                  </Slider.Root>
                </div>

                {/* Stroke Color */}
                <div className="mb-4">
                  <label className="text-xs text-gray-300 mb-2 block">Color</label>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        if (onOpenColorPicker) {
                          onOpenColorPicker('stroke')
                        }
                      }}
                      className="w-12 h-8 rounded border-2 border-zinc-600 cursor-pointer hover:border-zinc-500 transition-colors"
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
                      className="flex-1 bg-transparent border border-zinc-700 rounded px-2 py-1.5 text-xs text-white outline-none focus:border-zinc-500"
                      placeholder="#000000"
                    />
                  </div>
                </div>

                {/* Stroke Style */}
                <div>
                  <label className="text-xs text-gray-300 mb-2 block">Style</label>
                  <div className="flex gap-2">
                    {['solid', 'dashed', 'dotted'].map((style) => (
                      <button
                        key={style}
                        onClick={() => {
                          handleLayerUpdate({ data: { ...selectedLayer.data, strokeStyle: style } })
                        }}
                        className={`flex-1 px-3 py-2 rounded text-xs font-medium transition-colors ${getStrokeStyle() === style
                          ? 'bg-purple-600 text-white shadow-[0_4px_12px_rgba(168,85,247,0.4)]'
                          : 'bg-white/5 text-gray-300 hover:bg-white/10'
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
              setShowOpacitySlider(!showOpacitySlider)
              setShowBlurSlider(false)
              setShowCornerRadiusSlider(false)
            }}
            className={`text-white hover:bg-white/10 active:bg-white/15 h-8 px-2 rounded-[8px] transition-all flex items-center gap-1.5 touch-manipulation whitespace-nowrap border border-transparent hover:border-white/10 ${showOpacitySlider ? 'bg-white/20 border-white/20' : ''}`}
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
              setShowBlurSlider(!showBlurSlider)
              setShowOpacitySlider(false)
              setShowCornerRadiusSlider(false)
            }}
            className={`text-white hover:bg-white/10 active:bg-white/15 h-8 px-2 rounded-[8px] transition-all flex items-center gap-1.5 touch-manipulation whitespace-nowrap border border-transparent hover:border-white/10 ${showBlurSlider ? 'bg-white/20 border-white/20' : ''}`}
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
              setShowCornerRadiusSlider(!showCornerRadiusSlider)
              setShowOpacitySlider(false)
              setShowBlurSlider(false)
            }}
            className={`text-white hover:bg-white/10 active:bg-white/15 h-8 px-2 rounded-[8px] transition-all flex items-center gap-1.5 touch-manipulation whitespace-nowrap border border-transparent hover:border-white/10 ${showCornerRadiusSlider ? 'bg-white/20 border-white/20' : ''}`}
            title="Corner Radius"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 flex-shrink-0 opacity-70">
              <path d="M21 4H11C7.13401 4 4 7.13401 4 11V21" />
            </svg>
          </button>
        )}

        {/* Card Frame flip button */}
        {selectedLayer?.data?.isCardFrame && (
          <button
            onClick={() => onFlipCardFrame?.()}
            className="text-white hover:bg-white/10 active:bg-white/15 h-8 px-2.5 rounded-[8px] transition-colors flex items-center gap-1.5 touch-manipulation whitespace-nowrap flex-shrink-0 border border-transparent hover:border-white/10"
            title={`Showing ${selectedLayer.data.showingFront !== false ? 'Front' : 'Back'} - Click to flip`}
          >
            <FlipHorizontal2 className="h-4 w-4 flex-shrink-0 opacity-70" strokeWidth={2} />
            <span className="text-xs font-medium">{selectedLayer.data.showingFront !== false ? 'Front' : 'Back'}</span>
          </button>
        )}

        {/* Position panel opener */}
        <button
          onClick={() => onOpenPositionPanel?.()}
          className="text-white hover:bg-white/10 active:bg-white/15 h-8 px-2 rounded-[8px] transition-colors flex items-center gap-1.5 touch-manipulation whitespace-nowrap flex-shrink-0 border border-transparent hover:border-white/10"
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
            className="text-white hover:bg-white/10 active:bg-white/15 h-7 w-7 rounded-md transition-colors flex items-center justify-center border border-transparent hover:border-white/10 flex-shrink-0"
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
                : 'bg-zinc-800/80 text-zinc-500 border border-white/5 cursor-default hover:bg-zinc-800')
              : 'text-white hover:bg-white/10 active:bg-white/15 border border-transparent hover:border-white/10'
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
              className="text-white hover:bg-red-600/80 active:bg-red-700 h-7 w-7 rounded-md transition-colors flex items-center justify-center"
              title="Cancel Animation Capture"
            >
              <X className="h-4 w-4" />
            </button>
          )}

          {/* Motion Panel Menu - 3 dots to access MotionPanel for managing steps */}
          <button
            onClick={() => onToggleMotionPanel?.()}
            className="text-white hover:bg-white/10 active:bg-white/15 h-7 w-7 rounded-md transition-colors flex items-center justify-center border border-transparent hover:border-white/10"
            title="Animation Steps"
          >
            <MoreVertical className="h-4 w-4 opacity-70" />
          </button>
        </div>

      </div>

      {/* Transparency Sub-tab (Modal) */}
      {showOpacitySlider && selectedLayer && (
        <div
          className="absolute top-full mt-2 left-1/2 -translate-x-1/2 h-9 flex items-center gap-3 px-4 rounded-lg backdrop-blur-md z-50 animate-in fade-in slide-in-from-top-2 duration-200"
          style={{
            backgroundColor: 'rgba(15, 16, 21, 0.9)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
            minWidth: '240px',
            pointerEvents: 'auto'
          }}
        >
          <span className="text-white/60 text-[10px] uppercase font-bold tracking-wider select-none shrink-0">Opacity</span>

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
            <Slider.Track className="bg-white/10 relative grow rounded-full h-1">
              <Slider.Range className="absolute bg-white rounded-full h-full" />
            </Slider.Track>
            <Slider.Thumb
              className="block w-3 h-3 bg-white rounded-full shadow-[0_0_10px_rgba(255,255,255,0.4)] hover:scale-110 transition-transform focus:outline-none cursor-pointer"
              aria-label="Layer Opacity"
            />
          </Slider.Root>

          <span className="text-white text-xs font-mono min-w-[32px] text-right">
            {Math.round((selectedLayer.opacity ?? 1) * 100)}%
          </span>
        </div>
      )}

      {/* Blur Sub-tab (Modal) */}
      {showBlurSlider && selectedLayer && (
        <div
          className="absolute top-full mt-2 left-1/2 -translate-x-1/2 h-9 flex items-center gap-3 px-4 rounded-lg backdrop-blur-md z-50 animate-in fade-in slide-in-from-top-2 duration-200"
          style={{
            backgroundColor: 'rgba(15, 16, 21, 0.9)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
            minWidth: '240px',
            pointerEvents: 'auto'
          }}
        >
          <span className="text-white/60 text-[10px] uppercase font-bold tracking-wider select-none shrink-0">Blur</span>

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
            <Slider.Track className="bg-white/10 relative grow rounded-full h-1">
              <Slider.Range className="absolute bg-white rounded-full h-full" />
            </Slider.Track>
            <Slider.Thumb
              className="block w-3 h-3 bg-white rounded-full shadow-[0_0_10px_rgba(255,255,255,0.4)] hover:scale-110 transition-transform focus:outline-none cursor-pointer"
              aria-label="Layer Blur"
            />
          </Slider.Root>

          <span className="text-white text-xs font-mono min-w-[32px] text-right">
            {Math.round(Math.min(BLUR_MAX, selectedLayer.blur ?? 0))}
          </span>
        </div>
      )}

      {/* Corner Radius Sub-tab (Modal) */}
      {showCornerRadiusSlider && selectedLayer && hasCorners() && (
        <div
          className="absolute top-full mt-2 left-1/2 -translate-x-1/2 h-9 flex items-center gap-3 px-4 rounded-lg backdrop-blur-md z-50 animate-in fade-in slide-in-from-top-2 duration-200"
          style={{
            backgroundColor: 'rgba(15, 16, 21, 0.9)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
            minWidth: '240px',
            pointerEvents: 'auto'
          }}
        >
          <span className="text-white/60 text-[10px] uppercase font-bold tracking-wider select-none shrink-0">Radius</span>
          {console.log('[DEBUG] CanvasControls cornerRadius render:', selectedLayer.data?.cornerRadius)}
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
            <Slider.Track className="bg-white/10 relative grow rounded-full h-1">
              <Slider.Range className="absolute bg-white rounded-full h-full" />
            </Slider.Track>
            <Slider.Thumb
              className="block w-3 h-3 bg-white rounded-full shadow-[0_0_10px_rgba(255,255,255,0.4)] hover:scale-110 transition-transform focus:outline-none cursor-pointer"
              aria-label="Corner Radius"
            />
          </Slider.Root>

          <span className="text-white text-xs font-mono min-w-[36px] text-right">
            {Math.round(selectedLayer.data?.cornerRadius ?? 0)}px
          </span>
        </div>
      )}

      {/* Add Step Hint Modal */}
      {showAddStepHint && (
        <div
          className="absolute top-full mt-4 left-1/2 -translate-x-1/2 z-[100] animate-in fade-in slide-in-from-top-2 duration-300"
          style={{ pointerEvents: 'auto' }}
        >
          {/* Arrow */}
          <div
            className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 rotate-45 border-t border-l border-white/20"
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
      `}</style>
    </div>
  )
}

export default CanvasControls
