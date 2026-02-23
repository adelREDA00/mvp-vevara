import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, Droplet } from 'lucide-react'

// Helper functions for color conversion
function hexToHsl(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h, s, l = (max + min) / 2

  if (max === min) {
    h = s = 0
  } else {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break
      case g: h = ((b - r) / d + 2) / 6; break
      case b: h = ((r - g) / d + 4) / 6; break
      default: h = 0
    }
  }

  return [h * 360, s * 100, l * 100]
}

function hslToHex(h, s, l) {
  h = h / 360
  s = s / 100
  l = l / 100

  let r, g, b

  if (s === 0) {
    r = g = b = l
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1
      if (t > 1) t -= 1
      if (t < 1/6) return p + (q - p) * 6 * t
      if (t < 1/2) return q
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6
      return p
    }

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    r = hue2rgb(p, q, h + 1/3)
    g = hue2rgb(p, q, h)
    b = hue2rgb(p, q, h - 1/3)
  }

  const toHex = (c) => {
    const hex = Math.round(c * 255).toString(16)
    return hex.length === 1 ? '0' + hex : hex
  }

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

function AdvancedColorPickerModal({ initialColor, onColorSelect, onClose, anchorElement }) {
  const [activeTab, setActiveTab] = useState('solid') // 'solid' or 'gradient'
  
  const [hsl, setHsl] = useState(() => {
    try {
      return hexToHsl(initialColor)
    } catch {
      return [0, 0, 50]
    }
  })
  
  const [hex, setHex] = useState(initialColor)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const colorAreaRef = useRef(null)
  const hueSliderRef = useRef(null)
  const modalRef = useRef(null)
  const isDraggingColor = useRef(false)
  const isDraggingHue = useRef(false)
  const isInitialMount = useRef(true)
  const previousHexRef = useRef(initialColor)
  const onColorSelectRef = useRef(onColorSelect)

  // Keep onColorSelect ref updated
  useEffect(() => {
    onColorSelectRef.current = onColorSelect
  }, [onColorSelect])

  // Update hex when HSL changes
  useEffect(() => {
    const newHex = hslToHex(hsl[0], hsl[1], hsl[2])
    setHex(newHex)
  }, [hsl])

  // Automatically apply color changes
  useEffect(() => {
    // Skip the initial mount to avoid calling onColorSelect with the initial color
    if (isInitialMount.current) {
      isInitialMount.current = false
      previousHexRef.current = hex
      return
    }
    
    // Only call onColorSelect if hex is a valid 6-digit hex color and has actually changed
    if (/^#[0-9A-Fa-f]{6}$/i.test(hex) && hex !== previousHexRef.current && onColorSelectRef.current) {
      previousHexRef.current = hex
      onColorSelectRef.current(hex)
    }
  }, [hex])

  // Calculate position relative to anchor element
  useEffect(() => {
    const updatePosition = () => {
      if (anchorElement && modalRef.current) {
        const rect = anchorElement.getBoundingClientRect()
        const modalRect = modalRef.current.getBoundingClientRect()
        
        // Position below the button, aligned to left
        let top = rect.bottom + 8
        let left = rect.left
        
        // Adjust if modal would go off screen
        const maxLeft = window.innerWidth - (modalRect.width || 280) - 16
        const adjustedLeft = Math.max(16, Math.min(left, maxLeft))
        
        // Adjust if modal would go off bottom of screen
        const maxTop = window.innerHeight - (modalRect.height || 320) - 16
        if (top > maxTop) {
          // Position above button instead
          top = rect.top - (modalRect.height || 320) - 8
        }
        
        setPosition({ top: Math.max(16, top), left: adjustedLeft })
      }
    }

    // Initial position calculation
    updatePosition()

    // Update on scroll/resize
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('resize', updatePosition)
    
    return () => {
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('resize', updatePosition)
    }
  }, [anchorElement])

  // Handle click outside to close
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (modalRef.current && !modalRef.current.contains(e.target) && 
          anchorElement && !anchorElement.contains(e.target)) {
        onClose()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onClose, anchorElement])

  // Update HSL when hex input changes
  const handleHexChange = (value) => {
    if (/^#[0-9A-Fa-f]{6}$/i.test(value)) {
      setHex(value)
      try {
        const newHsl = hexToHsl(value)
        setHsl(newHsl)
      } catch (e) {
        // Invalid hex, ignore
      }
    } else if (/^#[0-9A-Fa-f]{0,6}$/i.test(value)) {
      setHex(value)
    }
  }

  // Handle color area click/drag
  const handleColorAreaMouseDown = (e) => {
    isDraggingColor.current = true
    updateColorFromArea(e)
    document.addEventListener('mousemove', handleColorAreaMouseMove)
    document.addEventListener('mouseup', handleColorAreaMouseUp)
  }

  const handleColorAreaMouseMove = (e) => {
    if (isDraggingColor.current) {
      updateColorFromArea(e)
    }
  }

  const handleColorAreaMouseUp = () => {
    isDraggingColor.current = false
    document.removeEventListener('mousemove', handleColorAreaMouseMove)
    document.removeEventListener('mouseup', handleColorAreaMouseUp)
  }

  const updateColorFromArea = (e) => {
    if (!colorAreaRef.current) return
    const rect = colorAreaRef.current.getBoundingClientRect()
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
    
    // Use functional update to get latest hsl value
    setHsl(prevHsl => {
      const newHsl = [prevHsl[0], x * 100, (1 - y) * 100]
      return newHsl
    })
  }

  // Handle hue slider click/drag
  const handleHueMouseDown = (e) => {
    isDraggingHue.current = true
    updateHueFromSlider(e)
    document.addEventListener('mousemove', handleHueMouseMove)
    document.addEventListener('mouseup', handleHueMouseUp)
  }

  const handleHueMouseMove = (e) => {
    if (isDraggingHue.current) {
      updateHueFromSlider(e)
    }
  }

  const handleHueMouseUp = () => {
    isDraggingHue.current = false
    document.removeEventListener('mousemove', handleHueMouseMove)
    document.removeEventListener('mouseup', handleHueMouseUp)
  }

  const updateHueFromSlider = (e) => {
    if (!hueSliderRef.current) return
    const rect = hueSliderRef.current.getBoundingClientRect()
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    
    // Use functional update to get latest hsl value
    setHsl(prevHsl => {
      const newHsl = [x * 360, prevHsl[1], prevHsl[2]]
      return newHsl
    })
  }

  // Eyedropper tool
  const handleEyedropper = async () => {
    if (!window.EyeDropper) {
      // Fallback: show message or use alternative method
      alert('Eyedropper API not supported in this browser')
      return
    }

    try {
      const eyeDropper = new window.EyeDropper()
      const result = await eyeDropper.open()
      if (result.sRGBHex) {
        const newHsl = hexToHsl(result.sRGBHex)
        setHex(result.sRGBHex)
        setHsl(newHsl)
      }
    } catch (e) {
      // User cancelled or error
    }
  }

  // Cleanup
  useEffect(() => {
    return () => {
      document.removeEventListener('mousemove', handleColorAreaMouseMove)
      document.removeEventListener('mouseup', handleColorAreaMouseUp)
      document.removeEventListener('mousemove', handleHueMouseMove)
      document.removeEventListener('mouseup', handleHueMouseUp)
    }
  }, [])

  // Color area gradient
  const colorAreaStyle = {
    background: `linear-gradient(to top, black, transparent), linear-gradient(to right, white, hsl(${hsl[0]}, 100%, 50%))`
  }

  // Hue slider gradient
  const hueSliderStyle = {
    background: 'linear-gradient(to right, #ff0000, #ff7f00, #ffff00, #00ff00, #0000ff, #4b0082, #9400d3, #ff0000)'
  }

  // Current color position in color area
  const colorX = hsl[1] / 100
  const colorY = 1 - (hsl[2] / 100)
  const hueX = hsl[0] / 360

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      ref={modalRef}
      className="fixed bg-zinc-900 rounded-lg shadow-2xl border border-zinc-800 z-[10000]"
      style={{ 
        width: '280px',
        top: `${position.top}px`,
        left: `${position.left}px`,
      }}
      onClick={(e) => e.stopPropagation()}
    >
        {/* Header */}
        <div className="px-2 pt-2 pb-1.5 border-b border-zinc-800 flex-shrink-0">
          <div className="flex items-center justify-between mb-1.5">
            <h2 className="text-xs font-semibold text-white">Pick Colour</h2>
            <button
              onClick={onClose}
              className="text-zinc-400 hover:text-white transition-colors p-0.5 rounded-md hover:bg-zinc-800"
            >
              <X className="h-3 w-3" strokeWidth={1.5} />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-zinc-800">
            <button
              onClick={() => setActiveTab('solid')}
              className={`flex-1 px-2 py-1 text-xs font-medium transition-colors relative ${
                activeTab === 'solid'
                  ? 'text-white'
                  : 'text-zinc-400 hover:text-zinc-300'
              }`}
            >
              Solid colour
              {activeTab === 'solid' && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-purple-500" />
              )}
            </button>
            <button
              onClick={() => setActiveTab('gradient')}
              className={`flex-1 px-2 py-1 text-xs font-medium transition-colors relative ${
                activeTab === 'gradient'
                  ? 'text-white'
                  : 'text-zinc-400 hover:text-zinc-300'
              }`}
            >
              Gradient
              {activeTab === 'gradient' && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-purple-500" />
              )}
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-2">
          {activeTab === 'solid' && (
            <>
              {/* Color Selection Area */}
              <div className="mb-2">
                <div
                  ref={colorAreaRef}
                  onMouseDown={handleColorAreaMouseDown}
                  className="w-full h-32 rounded-lg cursor-crosshair relative overflow-hidden"
                  style={colorAreaStyle}
                >
                  {/* Color Selector */}
                  <div
                    className="absolute w-3 h-3 rounded-full border-2 border-white shadow-lg pointer-events-none"
                    style={{
                      left: `calc(${colorX * 100}% - 6px)`,
                      top: `calc(${colorY * 100}% - 6px)`,
                      backgroundColor: `hsl(${hsl[0]}, ${hsl[1]}%, ${hsl[2]}%)`,
                    }}
                  />
                </div>
              </div>

              {/* Hue Slider */}
              <div className="mb-2">
                <div
                  ref={hueSliderRef}
                  onMouseDown={handleHueMouseDown}
                  className="w-full h-4 rounded-lg cursor-pointer relative overflow-hidden"
                  style={hueSliderStyle}
                >
                  {/* Hue Selector */}
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-white shadow-lg pointer-events-none"
                    style={{
                      left: `calc(${hueX * 100}% - 1px)`,
                    }}
                  />
                </div>
              </div>

              {/* Hex Input with Color Swatch and Eyedropper */}
              <div className="mb-2">
                <div className="flex items-center gap-1.5 bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1">
                  {/* Color Swatch */}
                  <div
                    className="w-4 h-4 rounded border border-zinc-600 flex-shrink-0"
                    style={{ backgroundColor: hex }}
                  />
                  
                  {/* Hex Input */}
                  <input
                    type="text"
                    value={hex}
                    onChange={(e) => handleHexChange(e.target.value)}
                    className="flex-1 bg-transparent text-white text-xs outline-none"
                    placeholder="#000000"
                  />
                  
                  {/* Eyedropper Button */}
                  <button
                    onClick={handleEyedropper}
                    className="text-zinc-400 hover:text-white transition-colors p-0.5 rounded hover:bg-zinc-700 flex-shrink-0"
                    title="Eyedropper"
                  >
                    <Droplet className="h-3 w-3" strokeWidth={1.5} />
                  </button>
                </div>
              </div>
            </>
          )}

          {activeTab === 'gradient' && (
            <div className="text-center text-zinc-400 text-xs py-4">
              Gradient feature coming soon
            </div>
          )}
        </div>
    </div>,
    document.body
  )
}

export default AdvancedColorPickerModal

