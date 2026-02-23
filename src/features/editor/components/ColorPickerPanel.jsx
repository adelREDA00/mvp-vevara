import { useState, useMemo, useRef } from 'react'
import { X, Search, Plus, FileText } from 'lucide-react'
import { DragToCloseHandle } from './DragToCloseHandle'
import AdvancedColorPickerModal from './AdvancedColorPickerModal'

// Default solid colors - comprehensive palette
const DEFAULT_COLORS = [
  // Grayscale
  '#000000', '#333333', '#666666', '#999999', '#ffffff',
  // Reds/Pinks/Purples
  '#ff0000', '#ff6347', '#ff1493', '#e6e6fa', '#9370db',
  // Teals/Blues
  '#008080', '#87ceeb', '#4169e1', '#00008b', '#4b0082',
  // Greens/Yellows/Oranges
  '#90ee90', '#32cd32', '#00ff00', '#ffff00', '#ffa500',
  // More oranges/reds
  '#ff4500', '#dc143c', '#8b0000', '#ff69b4', '#da70d6',
  // More blues/cyans
  '#00ced1', '#1e90ff', '#0000cd', '#191970', '#7b68ee',
  // More greens
  '#228b22', '#2e8b57', '#3cb371', '#00fa9a', '#adff2f',
  // Browns/yellows
  '#a0522d', '#cd853f', '#deb887', '#f0e68c', '#ffd700',
]

function ColorPickerPanel({ onClose, selectedColor, onColorSelect, colorType = 'fill' }) {
  const [searchQuery, setSearchQuery] = useState('')
  const [documentColors, setDocumentColors] = useState([
    '#000000',
    '#808080',
    '#ffffff',
  ])
  const [showAdvancedPicker, setShowAdvancedPicker] = useState(false)
  const addColorButtonRef = useRef(null)
  const [width, setWidth] = useState(320)

  // Filter colors based on search query
  const filteredColors = useMemo(() => {
    if (!searchQuery.trim()) return DEFAULT_COLORS

    const query = searchQuery.toLowerCase().trim()

    // Check if it's a hex code
    if (query.startsWith('#')) {
      return DEFAULT_COLORS.filter(color =>
        color.toLowerCase().includes(query)
      )
    }

    // Color name matching (basic)
    const colorNameMap = {
      'black': '#000000',
      'white': '#ffffff',
      'red': '#ff0000',
      'green': '#32cd32',
      'blue': '#4169e1',
      'yellow': '#ffff00',
      'orange': '#ffa500',
      'purple': '#9370db',
      'pink': '#ff1493',
      'gray': '#808080',
      'grey': '#808080',
      'teal': '#008080',
      'cyan': '#00ced1',
      'brown': '#a0522d',
    }

    if (colorNameMap[query]) {
      return [colorNameMap[query]]
    }

    return DEFAULT_COLORS.filter(color =>
      color.toLowerCase().includes(query.replace('#', ''))
    )
  }, [searchQuery])

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
        className="flex flex-col h-full relative backdrop-blur-md transition-all duration-300"
        style={{
          width: typeof window !== 'undefined' && window.innerWidth < 1024 ? '100%' : `${width}px`,
          backgroundColor: 'rgba(13, 18, 22, 0.75)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderRight: '0.5px solid rgba(255, 255, 255, 0.1)',
        }}
      >
        <DragToCloseHandle onClose={onClose} onWidthChange={setWidth} initialWidth={width} minWidth={200} />

        {/* Header */}
        <div className="px-4 pt-4 pb-3 border-b border-zinc-800/50 flex-shrink-0">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-white">Colour</h2>
            {onClose && (
              <button
                onClick={onClose}
                className="text-zinc-400 hover:text-white transition-colors p-1 rounded-md hover:bg-zinc-800"
              >
                <X className="h-4 w-4" strokeWidth={1.5} />
              </button>
            )}
          </div>

          {/* Search Bar */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-zinc-500" strokeWidth={1.5} />
            <input
              type="text"
              placeholder='Try "blue" or "#00c4cc"'
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-white text-sm placeholder-zinc-500 focus:outline-none focus:border-zinc-700 focus:ring-1 focus:ring-zinc-700"
            />
          </div>
        </div>

        {/* Content - Scrollable */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {/* Document Colours Section */}
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <FileText className="h-4 w-4 text-zinc-400" strokeWidth={1.5} />
              <h3 className="text-sm font-medium text-zinc-300">Document colours</h3>
            </div>
            <div className="flex items-center gap-2">
              {/* Add Custom Color - Gradient Circle with Plus */}
              <div className="relative">
                <button
                  ref={addColorButtonRef}
                  onClick={handleAddCustomColor}
                  className="w-8 h-8 rounded-full flex items-center justify-center cursor-pointer hover:ring-2 hover:ring-zinc-600 transition-all"
                  style={{
                    background: 'linear-gradient(135deg, #ff0000, #ff7f00, #ffff00, #00ff00, #0000ff, #4b0082, #9400d3)',
                  }}
                  title="Add custom color"
                >
                  <Plus className="h-4 w-4 text-white" strokeWidth={2.5} />
                </button>
              </div>

              {/* Transparent - Checkered Pattern */}
              <button
                onClick={handleTransparent}
                className={`w-8 h-8 rounded-full cursor-pointer transition-all ${isSelected('transparent') ? 'ring-2 ring-purple-500' : 'hover:ring-2 hover:ring-zinc-600'
                  }`}
                style={{
                  backgroundImage: 'linear-gradient(45deg, #666 25%, transparent 25%, transparent 75%, #666 75%, #666), linear-gradient(45deg, #666 25%, transparent 25%, transparent 75%, #666 75%, #666)',
                  backgroundSize: '6px 6px',
                  backgroundPosition: '0 0, 3px 3px',
                }}
                title="No fill"
              />

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

          {/* Brand Kit Message */}
          <div className="mb-6">
            <p className="text-xs text-zinc-500">No brand colours set for this Brand Kit.</p>
          </div>

          {/* Default Solid Colours Section */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-zinc-400" strokeWidth={1.5} />
                <h3 className="text-sm font-medium text-zinc-300">Default solid colours</h3>
              </div>
              <button className="text-xs text-zinc-400 hover:text-zinc-300 transition-colors">
                See all
              </button>
            </div>

            {/* Color Grid */}
            <div className="grid grid-cols-5 gap-2">
              {filteredColors.map((color, index) => (
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
