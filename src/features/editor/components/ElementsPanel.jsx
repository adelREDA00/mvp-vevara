import { useState, useContext } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { ThemeContext } from '../../../app/context/ThemeContext'
import { X, Square, Circle, Triangle, Hexagon, Minus, Star, ArrowRight, ChevronRight } from 'lucide-react'
import { addLayerAndSelect, selectCurrentSceneId } from '../../../store/slices/projectSlice'

function ElementsPanel({ onClose, aspectRatio }) {
  const dispatch = useDispatch()
  const currentSceneId = useSelector(selectCurrentSceneId)
  const { theme } = useContext(ThemeContext)
  const isLight = theme === 'light'

  // Use the aspect ratio prop passed from parent (same as Stage.jsx)
  const getCurrentAspectRatio = () => {
    return aspectRatio || '16:9'
  }

  // Calculate world dimensions based on aspect ratio (same as Stage.jsx)
  const getWorldDimensions = () => {
    const aspectRatio = getCurrentAspectRatio()
    const [widthRatio, heightRatio] = aspectRatio.split(':').map(Number)
    const aspectRatioValue = widthRatio / heightRatio

    // Use common standard resolutions based on aspect ratio
    // For landscape (16:9, 4:3, etc.), use 1920x1080 as base
    // For portrait (9:16, 3:4, etc.), use 1080x1920 as base
    // Scale proportionally to maintain aspect ratio

    if (aspectRatioValue >= 1) {
      // Landscape or square
      // Standard: 1920x1080 for 16:9
      const baseWidth = 1920
      const baseHeight = 1080
      const baseAspect = baseWidth / baseHeight

      if (Math.abs(aspectRatioValue - baseAspect) < 0.01) {
        // Close to 16:9, use standard
        return { worldWidth: 1920, worldHeight: 1080 }
      } else {
        // Scale to match aspect ratio
        const worldHeight = 1080
        const worldWidth = Math.round(worldHeight * aspectRatioValue)
        return { worldWidth, worldHeight }
      }
    } else {
      // Portrait
      // Standard: 1080x1920 for 9:16
      const baseWidth = 1080
      const baseHeight = 1920
      const baseAspect = baseWidth / baseHeight

      if (Math.abs(aspectRatioValue - baseAspect) < 0.01) {
        // Close to 9:16, use standard
        return { worldWidth: 1080, worldHeight: 1920 }
      } else {
        // Scale to match aspect ratio
        const worldWidth = 1080
        const worldHeight = Math.round(worldWidth / aspectRatioValue)
        return { worldWidth, worldHeight }
      }
    }
  }

  const { worldWidth, worldHeight } = getWorldDimensions()

  const handleAddElement = (elementType, config) => {
    if (!currentSceneId) return

    // Calculate center position based on world dimensions
    // Elements are anchored at center (0.5, 0.5) by default
    const elementWidth = config.width || 150
    const elementHeight = config.height || 150

    const centerX = worldWidth / 2
    const centerY = worldHeight / 2

    const defaultConfig = {
      sceneId: currentSceneId,
      x: centerX,
      y: centerY,
      width: elementWidth,
      height: elementHeight,
      ...config
    }

    dispatch(addLayerAndSelect(defaultConfig))
  }

  const allElements = [
    {
      id: 'rectangle',
      name: 'Rectangle',
      icon: Square,
      onClick: () => handleAddElement('shape', {
        type: 'shape',
        width: 150,
        height: 150,
        anchorX: 0.5,
        anchorY: 0.5,
        data: {
          shapeType: 'rect',
          fill: '#7c7c8a',
          stroke: '',
          strokeWidth: 0,
        }
      })
    },
    {
      id: 'circle',
      name: 'Circle',
      icon: Circle,
      onClick: () => handleAddElement('shape', {
        type: 'shape',
        width: 100,
        height: 100,
        anchorX: 0.5,
        anchorY: 0.5,
        data: {
          shapeType: 'circle',
          radius: 50,
          fill: '#7c7c8a',
          stroke: '',
          strokeWidth: 0,
        }
      })
    },
    {
      id: 'line',
      name: 'Line',
      icon: Minus,
      onClick: () => handleAddElement('shape', {
        type: 'shape',
        width: 200,
        height: 4,
        anchorX: 0.5,
        anchorY: 0.5,
        data: {
          shapeType: 'line',
          fill: '#7c7c8a',
          stroke: '',
          strokeWidth: 0,
        }
      })
    },
    {
      id: 'triangle',
      name: 'Triangle',
      icon: Triangle,
      onClick: () => handleAddElement('shape', {
        type: 'shape',
        width: 130,
        height: 130,
        anchorX: 0.5,
        anchorY: 0.5,
        data: {
          shapeType: 'triangle',
          fill: '#7c7c8a',
          stroke: '',
          strokeWidth: 0,
        }
      })
    },
    {
      id: 'hexagon',
      name: 'Hexagon',
      icon: Hexagon,
      onClick: () => handleAddElement('shape', {
        type: 'shape',
        width: 140,
        height: 140,
        anchorX: 0.5,
        anchorY: 0.5,
        data: {
          shapeType: 'hexagon',
          fill: '#7c7c8a',
          stroke: '',
          strokeWidth: 0,
        }
      })
    },
    {
      id: 'square',
      name: 'Square',
      icon: Square,
      onClick: () => handleAddElement('shape', {
        type: 'shape',
        width: 120,
        height: 120,
        anchorX: 0.5,
        anchorY: 0.5,
        data: {
          shapeType: 'square',
          fill: '#7c7c8a',
          stroke: '',
          strokeWidth: 0,
        }
      })
    },
    {
      id: 'star',
      name: 'Star',
      icon: Star,
      onClick: () => handleAddElement('shape', {
        type: 'shape',
        width: 140,
        height: 140,
        anchorX: 0.5,
        anchorY: 0.5,
        data: {
          shapeType: 'star',
          fill: '#7c7c8a',
          stroke: '',
          strokeWidth: 0,
        }
      })
    },
    {
      id: 'arrow',
      name: 'Arrow',
      icon: ArrowRight,
      onClick: () => handleAddElement('shape', {
        type: 'shape',
        width: 200,
        height: 60,
        anchorX: 0.5,
        anchorY: 0.5,
        data: {
          shapeType: 'arrow',
          fill: '#7c7c8a',
          stroke: '',
          strokeWidth: 0,
        }
      })
    },
    {
      id: 'arrowhead',
      name: 'Arrow Head',
      icon: ChevronRight,
      onClick: () => handleAddElement('shape', {
        type: 'shape',
        width: 100,
        height: 100,
        anchorX: 0.5,
        anchorY: 0.5,
        data: {
          shapeType: 'arrowhead',
          fill: '#7c7c8a',
          stroke: '',
          strokeWidth: 0,
        }
      })
    },
  ]


  const elementItems = allElements.map((element) => ({
    id: element.id,
    element,
    onClick: element.onClick,
  }))

  const renderElementPreview = (item) => {
    if (item.element) {
      const shapeId = item.element.id

      return (
        <button
          onClick={item.onClick}
          className={`w-full aspect-square flex items-center justify-center rounded-[12px] transition-all duration-300 group relative border shadow-sm ${
            isLight 
              ? 'bg-white border-transparent hover:border-purple-300 hover:bg-purple-50/10' 
              : 'bg-white/5 border-transparent hover:bg-white/10 hover:border-white/10'
          }`}
          title={item.element.name}
        >
          <svg viewBox="0 0 56 56" className="w-[52px] h-[52px] flex-shrink-0 transition-transform duration-300 group-hover:scale-110">
            {shapeId === 'circle' && (
              <circle cx="28" cy="28" r="20" fill="#64748b" />
            )}
            {shapeId === 'rectangle' && (
              <rect x="8" y="8" width="40" height="40" rx="4" fill="#64748b" />
            )}
            {shapeId === 'square' && (
              <rect x="12" y="12" width="32" height="32" rx="3" fill="#64748b" />
            )}
            {shapeId === 'triangle' && (
              <path d="M28 10L45 40H11L28 10z" fill="#64748b" />
            )}
            {shapeId === 'hexagon' && (
              <path d="M28 8l16.97 9.75v19.5L28 48l-16.97-9.75v-19.5L28 8z" fill="#64748b" />
            )}
            {shapeId === 'line' && (
              <rect x="8" y="26" width="40" height="4" rx="2" fill="#64748b" />
            )}
            {shapeId === 'star' && (
              <path
                d="M28 8l5.09 10.32 11.39 1.65-8.24 8.03 1.95 11.3L28 33.8l-10.19 5.5 1.95-11.3-8.24-8.03 11.39-1.65L28 8z"
                fill="#64748b"
              />
            )}
            {shapeId === 'arrow' && (
              <path
                d="M8 24h24v-8l16 12-16 12v-8h-24z"
                fill="#64748b"
              />
            )}
            {shapeId === 'arrowhead' && (
              <path
                d="M12 12l28 16-28 16z"
                fill="#64748b"
              />
            )}

          </svg>
        </button>
      )
    }

    return null
  }

  const GridSection = ({ items, sectionName, renderItem }) => {
    const renderer = renderItem || renderElementPreview
    return (
      <div className="mb-8">
        <div className="flex items-center justify-between px-6 mb-4">
          <h3 className={`text-[14px] font-semibold uppercase tracking-widest ${isLight ? 'text-gray-500' : 'text-white/50'}`}>{sectionName}</h3>
          <span className={`text-[12px] font-medium ${isLight ? 'text-gray-400' : 'text-zinc-600'}`}>{items.length} items</span>
        </div>
        <div className="px-6">
          <div className="grid grid-cols-3 gap-4">
            {items.map((item) => (
              <div key={item.id}>{renderer(item)}</div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className="flex flex-col h-full relative transition-all duration-300"
      style={{
        width: typeof window !== 'undefined' && window.innerWidth < 1024 ? '100%' : '320px',
        backgroundColor: typeof window !== 'undefined' && window.innerWidth < 1024 ? 'transparent' : (isLight ? '#f3f4f7' : '#090a0d'),
        backdropFilter: typeof window !== 'undefined' && window.innerWidth < 1024 ? 'none' : 'blur(20px)',
        WebkitBackdropFilter: typeof window !== 'undefined' && window.innerWidth < 1024 ? 'none' : 'blur(20px)',
        borderRight: typeof window !== 'undefined' && window.innerWidth < 1024 ? 'none' : `1px solid ${isLight ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.05)'}`,
      }}
    >
      {/* Header */}
      <div className={`hidden lg:block px-6 pt-6 pb-4 border-b ${isLight ? 'border-black/5' : 'border-white/5'}`}>
        <div className="flex items-center justify-between mb-2">
          <h2 className={`text-[20px] font-semibold tracking-tight ${isLight ? 'text-gray-900' : 'text-white'}`}>Graphics</h2>
          {onClose && (
            <button
              onClick={onClose}
              className={`transition-all duration-300 p-2 rounded-[10px] ${isLight ? 'text-gray-400 hover:text-gray-900 hover:bg-gray-100' : 'text-white/40 hover:text-white hover:bg-white/10'}`}
            >
              <X className="h-5 w-5" strokeWidth={2} />
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="py-4">
          <GridSection
            items={elementItems}
            sectionName="Elements"
          />

        </div>
      </div>
    </div>
  )
}

export default ElementsPanel
