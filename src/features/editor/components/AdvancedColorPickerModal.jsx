import { useState, useRef, useEffect, useContext } from 'react'
import { createPortal } from 'react-dom'
import { X, Pipette } from 'lucide-react'
import { ThemeContext } from '../../../app/context/ThemeContext'

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

// Robust color parsing to handle Hex (3/6 char, with/without #), RGB/RGBA, HSL/HSLA
function parseColorToHexAndHsl(value) {
  let str = (value || '').trim()
  if (!str) return null

  // 1. Check if it is rgb/rgba
  const rgbMatch = str.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)$/i)
  if (rgbMatch) {
    const r = parseInt(rgbMatch[1], 10)
    const g = parseInt(rgbMatch[2], 10)
    const b = parseInt(rgbMatch[3], 10)
    if (r >= 0 && r <= 255 && g >= 0 && g <= 255 && b >= 0 && b <= 255) {
      const toHex = (c) => {
        const hex = c.toString(16)
        return hex.length === 1 ? '0' + hex : hex
      }
      const hex = `#${toHex(r)}${toHex(g)}${toHex(b)}`
      return { hex, hsl: hexToHsl(hex) }
    }
  }

  // 2. Check if HSL
  const hslMatch = str.match(/^hsla?\((\d+),\s*([\d.]+)%,\s*([\d.]+)%(?:,\s*[\d.]+)?\)$/i)
  if (hslMatch) {
    const h = parseFloat(hslMatch[1])
    const s = parseFloat(hslMatch[2])
    const l = parseFloat(hslMatch[3])
    if (h >= 0 && h <= 360 && s >= 0 && s <= 100 && l >= 0 && l <= 100) {
      const hex = hslToHex(h, s, l)
      return { hex, hsl: [h, s, l] }
    }
  }

  // 3. Hex formats
  // Remove leading '#' if present
  let cleanHex = str.startsWith('#') ? str.slice(1) : str
  // Match only hex characters
  cleanHex = cleanHex.replace(/[^0-9A-Fa-f]/g, '')

  if (cleanHex.length === 3) {
    const r = cleanHex[0] + cleanHex[0]
    const g = cleanHex[1] + cleanHex[1]
    const b = cleanHex[2] + cleanHex[2]
    const hex = `#${r}${g}${b}`
    return { hex, hsl: hexToHsl(hex) }
  }

  if (cleanHex.length === 6) {
    const hex = `#${cleanHex}`
    return { hex, hsl: hexToHsl(hex) }
  }

  return null
}

function AdvancedColorPickerModal({ initialColor, onColorSelect, onClose, anchorElement, isInline = false, hideHeader = false }) {
  const { theme } = useContext(ThemeContext)
  const isLight = theme === 'light'
  
  const [hsl, setHsl] = useState(() => {
    try {
      return hexToHsl(initialColor)
    } catch {
      return [0, 0, 50]
    }
  })
  
  const [hex, setHex] = useState(initialColor)
  const [position, setPosition] = useState(null)
  const colorAreaRef = useRef(null)
  const hueSliderRef = useRef(null)
  const modalRef = useRef(null)
  const isDraggingColor = useRef(false)
  const isDraggingHue = useRef(false)
  const isInitialMount = useRef(true)
  const previousHexRef = useRef(initialColor)
  const onColorSelectRef = useRef(onColorSelect)
  const colorInputRef = useRef(null)

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
    if (isInline) return

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
  }, [anchorElement, isInline])

  // Handle click outside to close.
  useEffect(() => {
    if (isInline) return

    const handleClickOutside = (e) => {
      if (modalRef.current && !modalRef.current.contains(e.target) &&
          anchorElement && !anchorElement.contains(e.target)) {
        onClose()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [onClose, anchorElement, isInline])

  // Update HSL when hex input changes
  const handleHexChange = (value) => {
    const trimmed = (value || '').trim()
    
    // Check if it matches a fully parsed color code (hex with/without #, rgb, hsl, etc.)
    const parsed = parseColorToHexAndHsl(trimmed)
    if (parsed) {
      setHex(parsed.hex)
      setHsl(parsed.hsl)
      return
    }

    // Otherwise allow typing partial hex values
    let displayVal = trimmed
    if (displayVal && !displayVal.startsWith('#')) {
      if (/^[0-9A-Fa-f]{0,6}$/.test(displayVal)) {
        displayVal = '#' + displayVal
      }
    }

    if (/^#[0-9A-Fa-f]{0,6}$/i.test(displayVal)) {
      setHex(displayVal)
    }
  }

  const handleEyeDropperClick = async () => {
    if (typeof window !== 'undefined' && 'EyeDropper' in window) {
      try {
        const eyeDropper = new window.EyeDropper()
        const result = await eyeDropper.open()
        if (result && result.sRGBHex) {
          handleHexChange(result.sRGBHex)
        }
      } catch (err) {
        console.warn('Eyedropper failed or cancelled', err)
      }
    } else {
      colorInputRef.current?.click()
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

  const content = (
    <div
      ref={modalRef}
      className={isInline
        ? `w-full flex flex-col ${isLight ? 'text-slate-900' : 'text-white'}`
        : (typeof window !== 'undefined' && window.innerWidth < 1024
          ? `fixed rounded-2xl shadow-2xl border z-[10000] overflow-hidden animate-in slide-in-from-bottom-5 fade-in duration-300 ${isLight ? 'border-slate-200 text-slate-900' : 'border-white/10 text-white'}`
          : `fixed rounded-xl shadow-2xl border z-[10000] overflow-hidden ${isLight ? 'border-slate-200 text-slate-900' : 'border-white/10 text-white'}`)
      }
      style={isInline ? {
        backgroundColor: 'transparent',
      } : (typeof window !== 'undefined' && window.innerWidth < 1024 ? {
        width: 'calc(100% - 32px)',
        maxWidth: '320px',
        bottom: '16px',
        left: '50%',
        transform: 'translateX(-50%)',
        backgroundColor: isLight ? 'rgba(255, 255, 255, 0.98)' : 'rgba(15, 16, 21, 0.95)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
      } : {
        width: '280px',
        top: position ? `${position.top}px` : '0px',
        left: position ? `${position.left}px` : '0px',
        opacity: position ? 1 : 0,
        pointerEvents: position ? 'auto' : 'none',
        backgroundColor: isLight ? 'rgba(255, 255, 255, 0.9)' : 'rgba(15, 16, 21, 0.7)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
      })}
      onClick={(e) => e.stopPropagation()}
    >
        {/* Header */}
        {!hideHeader && (
          <div className={`px-3 pt-3 pb-2 border-b flex-shrink-0 ${isLight ? 'border-slate-100 bg-slate-50/50' : 'border-white/5 bg-white/5'}`}>
            {!isInline && (
              <div className="flex items-center justify-between">
                <h2 className={`text-[11px] font-bold uppercase tracking-wider ${isLight ? 'text-slate-500' : 'text-white/50'}`}>Pick Colour</h2>
                <button
                  onClick={onClose}
                  className={`transition-colors p-1 rounded-full ${isLight ? 'text-slate-400 hover:text-slate-900 hover:bg-slate-100' : 'text-zinc-400 hover:text-white hover:bg-white/10'}`}
                >
                  <X className="h-3.5 w-3.5" strokeWidth={2} />
                </button>
              </div>
            )}
          </div>
        )}

        {/* Content */}
        <div className="p-3">
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
          <div className="mt-4">
            <div className={`flex items-center gap-2 border rounded-xl px-3 py-2 transition-all ${
              isLight 
                ? 'bg-slate-100 border-slate-200/60 focus-within:border-slate-400' 
                : 'bg-black/40 border-white/5 focus-within:border-white/20'
            }`}>
              {/* Color Swatch */}
              <div
                className={`w-6 h-6 rounded-lg border flex-shrink-0 shadow-inner ${isLight ? 'border-slate-200' : 'border-white/10'}`}
                style={{ backgroundColor: hex }}
              />
              
              {/* Hex Input */}
              <div className="flex flex-col flex-1 min-w-0">
                <span className={`text-[9px] uppercase font-bold leading-none mb-1 ${isLight ? 'text-slate-500' : 'text-white/30'}`}>Hex Code</span>
                <input
                  type="text"
                  value={hex}
                  onChange={(e) => handleHexChange(e.target.value)}
                  className={`bg-transparent text-xs font-medium outline-none p-0 h-4 ${isLight ? 'text-slate-900' : 'text-white'}`}
                  placeholder="#000000"
                />
              </div>

              {/* Eyedropper Button */}
              <button
                type="button"
                onClick={handleEyeDropperClick}
                className={`p-1.5 rounded-lg transition-colors flex-shrink-0 ${
                  isLight 
                    ? 'text-slate-500 hover:text-slate-950 hover:bg-slate-200' 
                    : 'text-white/50 hover:text-white hover:bg-white/10'
                }`}
                title="Pick color"
              >
                <Pipette className="w-4 h-4" />
              </button>

              <input
                ref={colorInputRef}
                type="color"
                value={hex && hex.startsWith('#') && hex.length === 7 ? hex : '#000000'}
                onChange={(e) => handleHexChange(e.target.value)}
                style={{ display: 'none' }}
              />


            </div>
          </div>
        </div>
    </div>
  )

  if (isInline) {
    return content
  }

  return createPortal(
    <>
      {typeof window !== 'undefined' && window.innerWidth < 1024 && (
        <div
          className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={onClose}
        />
      )}
      {content}
    </>,
    document.body
  )
}

export default AdvancedColorPickerModal
