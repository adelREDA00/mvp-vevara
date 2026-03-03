import { useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { X, Square, Circle, Triangle, Hexagon, Minus, Star } from 'lucide-react'
import { addLayerAndSelect, selectCurrentSceneId } from '../../../store/slices/projectSlice'

function ElementsPanel({ onClose, aspectRatio }) {
  const dispatch = useDispatch()
  const currentSceneId = useSelector(selectCurrentSceneId)

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
          fill: '#e5e5e5',
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
          fill: '#e5e5e5',
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
          fill: '#e5e5e5',
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
          fill: '#e5e5e5',
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
          fill: '#e5e5e5',
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
          fill: '#e5e5e5',
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
          fill: '#e5e5e5',
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
          className="w-full aspect-square flex items-center justify-center hover:bg-zinc-800/20 rounded-lg transition-all duration-200 group relative"
          title={item.element.name}
        >
          <svg viewBox="0 0 56 56" className="w-[56px] h-[56px] flex-shrink-0">
            {shapeId === 'circle' && (
              <circle cx="28" cy="28" r="20" fill="#e5e5e5" />
            )}
            {shapeId === 'rectangle' && (
              <rect x="8" y="8" width="40" height="40" rx="3" fill="#e5e5e5" />
            )}
            {shapeId === 'square' && (
              <rect x="12" y="12" width="32" height="32" rx="2" fill="#e5e5e5" />
            )}
            {shapeId === 'triangle' && (
              <path d="M28 10L45 40H11L28 10z" fill="#e5e5e5" />
            )}
            {shapeId === 'hexagon' && (
              <path d="M28 8l16.97 9.75v19.5L28 48l-16.97-9.75v-19.5L28 8z" fill="#e5e5e5" />
            )}
            {shapeId === 'line' && (
              <rect x="8" y="26" width="40" height="4" rx="2" fill="#e5e5e5" />
            )}
            {shapeId === 'star' && (
              <path
                d="M28 8l5.09 10.32 11.39 1.65-8.24 8.03 1.95 11.3L28 33.8l-10.19 5.5 1.95-11.3-8.24-8.03 11.39-1.65L28 8z"
                fill="#e5e5e5"
              />
            )}
          </svg>
        </button>
      )
    }

    return null
  }

  const GridSection = ({ items, sectionName }) => {
    return (
      <div className="mb-6">
        <div className="flex items-center justify-between px-4 mb-3">
          <h3 className="text-sm font-medium text-white">{sectionName}</h3>
          <span className="text-xs text-zinc-500">{items.length} items</span>
        </div>
        <div className="px-4">
          <div className="grid grid-cols-3 gap-3">
            {items.map((item) => (
              <div key={item.id}>{renderElementPreview(item)}</div>
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
        backgroundColor: typeof window !== 'undefined' && window.innerWidth < 1024 ? 'transparent' : '#0f1015',
        backdropFilter: typeof window !== 'undefined' && window.innerWidth < 1024 ? 'none' : 'blur(20px)',
        WebkitBackdropFilter: typeof window !== 'undefined' && window.innerWidth < 1024 ? 'none' : 'blur(20px)',
        borderRight: typeof window !== 'undefined' && window.innerWidth < 1024 ? 'none' : '1px solid rgba(255, 255, 255, 0.05)',
      }}
    >
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-zinc-800/50">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-white">Graphics</h2>
          {onClose && (
            <button
              onClick={onClose}
              className="text-white/70 hover:text-white hover:bg-white/10 transition-all duration-200 p-1 rounded-md"
            >
              <X className="h-4 w-4" strokeWidth={2} />
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
