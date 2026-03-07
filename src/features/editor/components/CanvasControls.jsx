import {
  Minus, ChevronDown,
  Settings, Activity, X, MoreVertical, Layers,
  Volume2, VolumeX
} from 'lucide-react'
import * as Slider from '@radix-ui/react-slider'
import { LAYER_TYPES } from '../../../store/models'
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
  onCancelMotion
}) {


  const handleLayerUpdate = (updates) => {
    if (onLayerUpdate) {
      onLayerUpdate(updates)
    }
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
    <div className="flex items-center justify-center py-1 px-3">
      <div
        className="h-9 flex items-center gap-1.5 px-2 rounded-lg max-w-[calc(100vw-24px)] overflow-x-auto scrollbar-hide backdrop-blur-md"
        style={{
          backgroundColor: 'rgba(15, 16, 21, 0.8)',
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
                <button className="h-7 px-2 rounded-md bg-white/5 text-white/90 text-xs border border-white/5 hover:bg-white/10 flex items-center gap-1.5 transition-all outline-none min-w-[120px]">
                  <span className="truncate flex-1 text-left">{getFontFamily()}</span>
                  <ChevronDown className="h-3 w-3 opacity-60" />
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
                <button className="h-7 px-2 rounded-md bg-white/5 text-white/90 text-xs border border-white/5 hover:bg-white/10 flex items-center gap-1.5 transition-all outline-none min-w-[60px]">
                  <span className="flex-1 text-left">{getFontSize()}</span>
                  <ChevronDown className="h-3 w-3 opacity-60" />
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

                // Standard editor behavior: alignment only changes internal text flow.
                // The box (x, y) remains at the same top-left position.
                handleLayerUpdate({
                  data: {
                    ...selectedLayer.data,
                    textAlign: newAlign
                  }
                })
              }}
              className="text-white hover:bg-white/10 active:bg-white/15 h-7 px-2 rounded-md transition-colors flex items-center justify-center min-w-[32px] border border-transparent hover:border-white/10"
              title={`Align: ${selectedLayer.data?.textAlign || 'left'}`}
            >
              <div className="flex flex-col gap-0.5 items-center">
                <div className={`h-0.5 bg-current rounded-full ${selectedLayer.data?.textAlign === 'right' ? 'w-4 self-end' : (selectedLayer.data?.textAlign === 'center' ? 'w-4' : 'w-4 self-start')}`} />
                <div className={`h-0.5 bg-current rounded-full ${selectedLayer.data?.textAlign === 'right' ? 'w-2 self-end' : (selectedLayer.data?.textAlign === 'center' ? 'w-2' : 'w-2 self-start')}`} />
                <div className={`h-0.5 bg-current rounded-full ${selectedLayer.data?.textAlign === 'right' ? 'w-4 self-end' : (selectedLayer.data?.textAlign === 'center' ? 'w-4' : 'w-4 self-start')}`} />
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
                  className="text-white hover:bg-white/10 active:bg-white/15 h-7 px-2 rounded-md transition-colors flex items-center gap-1 touch-manipulation whitespace-nowrap flex-shrink-0 border border-transparent hover:border-white/10"
                  title="Stroke Style"
                >
                  <Minus className="h-4 w-4 flex-shrink-0 opacity-60" />
                  <span className="text-sm">Stroke</span>
                  <ChevronDown className="h-3 w-3 flex-shrink-0 opacity-60" />
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

        {/* Position panel opener */}
        <button
          onClick={() => onOpenPositionPanel?.()}
          className="text-white hover:bg-white/10 active:bg-white/15 h-7 px-2 rounded-md transition-colors flex items-center gap-1 touch-manipulation whitespace-nowrap flex-shrink-0 border border-transparent hover:border-white/10"
          title="Reorder layers"
        >
          <Layers className="h-4 w-4 flex-shrink-0 opacity-70" />
          <span className="text-sm">Position</span>
        </button>

        {/* Video specific controls */}
        {selectedLayer?.type === LAYER_TYPES.VIDEO && (
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
            onClick={() => {
              if (isMotionCaptureActive) {
                onApplyMotion?.()
              } else {
                onStartMotionCapture?.()
              }
            }}
            className={`h-7 px-2 rounded-md transition-all flex items-center gap-1 touch-manipulation whitespace-nowrap ${isMotionCaptureActive
              ? 'bg-purple-600 text-white shadow-[0_0_20px_rgba(168,85,247,0.8)] ring-1 ring-purple-400 animate-pulse-glow'
              : 'text-white hover:bg-white/10 active:bg-white/15 border border-transparent hover:border-white/10'
              }`}
            title={isMotionCaptureActive ? "Apply Animation" : "Start Animation Capture"}
          >
            <Activity className="h-4 w-4 flex-shrink-0" />
            <span className="text-sm">Add Step</span>
          </button>

          {/* Cancel Button - Only shown in capture mode */}
          {isMotionCaptureActive && (
            <button
              onClick={() => onCancelMotion?.()}
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


    </div>
  )
}

export default CanvasControls
