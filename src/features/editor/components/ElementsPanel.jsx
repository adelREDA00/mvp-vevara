import { useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { X, Square, Circle, Triangle, Hexagon, Minus } from 'lucide-react'
import { addLayerAndSelect, selectCurrentSceneId } from '../../../store/slices/projectSlice'
import { DragToCloseHandle } from './DragToCloseHandle'

function ElementsPanel({ onClose, aspectRatio }) {
  const dispatch = useDispatch()
  const currentSceneId = useSelector(selectCurrentSceneId)
  const [width, setWidth] = useState(320)

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
  ]

  // Sample data for different sections - include all elements for UI demonstration
  const recentlyUsed = [
    { id: '1', element: allElements[0], onClick: allElements[0].onClick }, // Rectangle
    { id: '2', element: allElements[1], onClick: allElements[1].onClick }, // Circle
    { id: '3', element: allElements[2], onClick: allElements[2].onClick }, // Triangle
    { id: '4', element: allElements[3], onClick: allElements[3].onClick }, // Hexagon
    { id: '5', element: allElements[4], onClick: allElements[4].onClick }, // Line
    { id: '6', element: allElements[5], onClick: allElements[5].onClick }, // Square
  ]

  const magicRecommendations = [
    { id: 'f1', element: allElements[4], onClick: allElements[4].onClick }, // Line
    { id: 'f2', element: allElements[5], onClick: allElements[5].onClick }, // Square
    { id: 'f3', element: allElements[0], onClick: allElements[0].onClick }, // Rectangle
    { id: 'f4', element: allElements[1], onClick: allElements[1].onClick }, // Circle
    { id: 'f5', element: allElements[2], onClick: allElements[2].onClick }, // Triangle
    { id: 'f6', element: allElements[3], onClick: allElements[3].onClick }, // Hexagon
  ]

  const renderElementPreview = (item) => {
    if (item.element) {
      const shapeId = item.element.id

      return (
        <button
          onClick={item.onClick}
          className="flex-shrink-0 w-[88px] h-[88px] flex items-center justify-center hover:bg-zinc-800/20 rounded-lg transition-all duration-200 group relative"
          title={item.element.name}
        >
          <svg width="56" height="56" viewBox="0 0 56 56" className="flex-shrink-0">
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
          </svg>
        </button>
      )
    }

    return null
  }

  // Scrollable section component
  const ScrollableSection = ({ items, sectionName }) => {
    const scrollContainerRef = useRef(null)

    return (
      <div className="mb-6">
        <div className="flex items-center justify-between px-4 mb-3">
          <h3 className="text-sm font-medium text-white">{sectionName}</h3>
          <button className="text-xs text-zinc-400 hover:text-white transition-colors cursor-pointer">
            See all
          </button>
        </div>
        <div className="relative px-4">
          {/* Scrollable container */}
          <div
            ref={scrollContainerRef}
            className="flex gap-3 overflow-x-auto scrollbar-hide"
            style={{
              scrollbarWidth: 'none',
              msOverflowStyle: 'none',
              WebkitOverflowScrolling: 'touch'
            }}
          >
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
      className="flex flex-col h-full relative backdrop-blur-md transition-all duration-300"
      style={{
        width: typeof window !== 'undefined' && window.innerWidth < 1024 ? '100%' : `${width}px`,
        backgroundColor: 'rgba(13, 18, 22, 0.85)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderRight: '0.5px solid rgba(255, 255, 255, 0.1)',
      }}
    >
      {/* Resize Handle - Drag left to close */}
      <DragToCloseHandle onClose={onClose} onWidthChange={setWidth} initialWidth={width} minWidth={200} maxWidth={500} />

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
          <ScrollableSection
            items={recentlyUsed}
            sectionName="Recently used"
          />
          <ScrollableSection
            items={magicRecommendations}
            sectionName="Magic recommendations"
          />
        </div>
      </div>
    </div>
  )
}

export default ElementsPanel
