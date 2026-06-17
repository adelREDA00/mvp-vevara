import { ThemeContext } from '../../../app/context/ThemeContext'
import React, { useState, useRef, useContext } from 'react'
import { X, Plus, FileText } from 'lucide-react'
import AdvancedColorPickerModal from './AdvancedColorPickerModal'

// Default solid colors - comprehensive premium palette
const DEFAULT_COLORS = [
  // Modern Premium Palette 1 (Purples/Blues)
  '#6367FF', '#8494FF', '#C9BEFF', '#FFDBFD', '#ffffff',
  // Modern Premium Palette 2 (Dark/Teals)
  '#222831', '#393E46', '#00ADB5', '#EEEEEE', '#000000',
  // Modern Premium Palette 3 (Soft Pinks/Reds)
  '#FFF5E4', '#FFE3E1', '#FFD1D1', '#FF9494', '#ff4500',
  // Startup Tech/Vibrant background fun colors
  '#D4F652', '#39E09B', '#FF8E99', '#00F5FF', '#FF7E5F', '#D800FF',
  // Extra UI Colors
  '#00d1b2', '#f5f5f5', '#209cee', '#ffdd57', '#ff3860'
]

function ColorPickerPanel({ onClose, selectedColor, onColorSelect, colorType = 'fill' }) {
  const [documentColors, setDocumentColors] = useState([
    '#000000',
    '#808080',
    '#ffffff',
  ])
  const [showAdvancedPicker, setShowAdvancedPicker] = useState(false)
  const addColorButtonRef = useRef(null)
  const { theme } = useContext(ThemeContext)
  const isLight = theme === 'light'

  const handleColorClick = (color) => {
    if (onColorSelect) {
      onColorSelect(color)
    }
  }

  const handleAddCustomColor = () => {
    setShowAdvancedPicker(true)
  }

  const handleAdvancedPickerSelect = (color) => {
    handleColorClick(color)
    // Don't close the modal - let user close it manually
  }

  const handleTransparent = () => {
    if (onColorSelect) {
      onColorSelect('transparent')
    }
  }

  // Check if color is currently selected
  const isSelected = (color) => {
    if (color === 'transparent') {
      return selectedColor === 'transparent' || !selectedColor || selectedColor === null
    }
    return selectedColor?.toLowerCase() === color.toLowerCase()
  }

  return (
    <>
      <div
        className="flex flex-col h-full relative transition-all duration-300 pointer-events-auto"
        style={{
          width: typeof window !== 'undefined' && window.innerWidth < 1024 ? '100%' : '320px',
          backgroundColor: typeof window !== 'undefined' && window.innerWidth < 1024 ? 'transparent' : (isLight ? '#f3f4f7' : '#090a0d'),
          backdropFilter: typeof window !== 'undefined' && window.innerWidth < 1024 ? 'none' : 'blur(20px)',
          WebkitBackdropFilter: typeof window !== 'undefined' && window.innerWidth < 1024 ? 'none' : 'blur(20px)',
          borderRight: typeof window !== 'undefined' && window.innerWidth < 1024 ? 'none' : `1px solid ${isLight ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.05)'}`,
        }}
      >
        {/* Header */}
        <div className={`px-4 pt-4 pb-3 border-b flex-shrink-0 ${isLight ? 'border-black/5' : 'border-zinc-800/50'}`}>
          <div className="flex items-center justify-between">
            <h2 className={`text-lg font-semibold ${isLight ? 'text-gray-900' : 'text-white'}`}>Colour</h2>
            {onClose && (
              <button
                onClick={onClose}
                className={`transition-colors p-1 rounded-md ${isLight ? 'text-gray-400 hover:text-gray-900 hover:bg-gray-100' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`}
              >
                <X className="h-4 w-4" strokeWidth={1.5} />
              </button>
            )}
          </div>
        </div>

        {/* Content - Scrollable */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {/* Document Colours Section */}
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <FileText className={`h-4 w-4 ${isLight ? 'text-gray-400' : 'text-zinc-400'}`} strokeWidth={1.5} />
              <h3 className={`text-sm font-medium ${isLight ? 'text-gray-700' : 'text-zinc-300'}`}>Document colours</h3>
            </div>
            <div className="flex items-center gap-2">
              {/* Add Custom Color - Gradient Circle with Plus */}
              <div className="relative">
                <button
                  ref={addColorButtonRef}
                  onClick={handleAddCustomColor}
                  className={`w-8 h-8 rounded-full flex items-center justify-center cursor-pointer transition-all ${isLight ? 'hover:ring-2 hover:ring-gray-300' : 'hover:ring-2 hover:ring-zinc-600'}`}
                  style={{
                    background: 'linear-gradient(135deg, #ff0000, #ff7f00, #ffff00, #00ff00, #0000ff, #4b0082, #9400d3)',
                  }}
                  title="Add custom color"
                >
                  <Plus className="h-4 w-4 text-white" strokeWidth={2.5} />
                </button>
              </div>

              {/* Transparent - Checkered Pattern */}
              {colorType !== 'canvas' && (
                <button
                  onClick={handleTransparent}
                  className={`w-8 h-8 rounded-full cursor-pointer transition-all ${isSelected('transparent') ? 'ring-2 ring-purple-500' : (isLight ? 'hover:ring-2 hover:ring-gray-300' : 'hover:ring-2 hover:ring-zinc-600')
                    }`}
                  style={{
                    backgroundImage: isLight 
                      ? 'linear-gradient(45deg, #e5e7eb 25%, transparent 25%, transparent 75%, #e5e7eb 75%, #e5e7eb), linear-gradient(45deg, #e5e7eb 25%, transparent 25%, transparent 75%, #e5e7eb 75%, #e5e7eb)'
                      : 'linear-gradient(45deg, #666 25%, transparent 25%, transparent 75%, #666 75%, #666), linear-gradient(45deg, #666 25%, transparent 25%, transparent 75%, #666 75%, #666)',
                    backgroundSize: '6px 6px',
                    backgroundPosition: '0 0, 3px 3px',
                  }}
                  title="No fill"
                />
              )}

              {/* Document Colors */}
              {documentColors.map((color, index) => (
                <button
                  key={index}
                  onClick={() => handleColorClick(color)}
                  className={`w-8 h-8 rounded-full cursor-pointer transition-all ${isSelected(color) ? 'ring-2 ring-purple-500' : 'hover:ring-2 hover:ring-zinc-600'
                    }`}
                  style={{ backgroundColor: color }}
                  title={color}
                />
              ))}
            </div>
          </div>

          {/* Default Solid Colours Section */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <FileText className={`h-4 w-4 ${isLight ? 'text-gray-400' : 'text-zinc-400'}`} strokeWidth={1.5} />
                <h3 className={`text-sm font-medium ${isLight ? 'text-gray-700' : 'text-zinc-300'}`}>Default solid colours</h3>
              </div>
            </div>

            {/* Color Grid */}
            <div className="grid grid-cols-5 gap-2">
              {DEFAULT_COLORS.map((color, index) => (
                <button
                  key={index}
                  onClick={() => handleColorClick(color)}
                  className={`w-8 h-8 rounded-full cursor-pointer transition-all ${isSelected(color) ? 'ring-2 ring-purple-500' : 'hover:ring-2 hover:ring-zinc-600'
                    }`}
                  style={{ backgroundColor: color }}
                  title={color}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Advanced Color Picker Modal */}
      {showAdvancedPicker && addColorButtonRef.current && (
        <AdvancedColorPickerModal
          initialColor={selectedColor && selectedColor !== 'transparent' && selectedColor !== null ? selectedColor : '#919191'}
          onColorSelect={handleAdvancedPickerSelect}
          onClose={() => setShowAdvancedPicker(false)}
          anchorElement={addColorButtonRef.current}
        />
      )}
    </>
  )
}

export default ColorPickerPanel
