import { useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { X, Search, Type } from 'lucide-react'
import { addLayerAndSelect, selectCurrentSceneId } from '../../../store/slices/projectSlice'
import { DragToCloseHandle } from './DragToCloseHandle'

function TextPanel({ onClose, aspectRatio }) {
  const dispatch = useDispatch()
  const currentSceneId = useSelector(selectCurrentSceneId)
  const [searchQuery, setSearchQuery] = useState('')
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

  const handleAddText = (textType, config) => {
    if (!currentSceneId) return

    const centerX = worldWidth / 2
    const centerY = worldHeight / 2

    const defaultConfig = {
      sceneId: currentSceneId,
      x: centerX,
      y: centerY,
      ...config
    }

    dispatch(addLayerAndSelect(defaultConfig))
  }

  const textElements = [
    {
      id: 'title',
      name: 'Title',
      preview: 'Add a heading',
      onClick: () => handleAddText('text', {
        type: 'text',
        width: 600,
        height: 100,
        data: {
          content: 'Add a heading',
          fontSize: 64,
          color: '#000000',
          fontFamily: 'Inter',
          fontWeight: 'bold',
          textAlign: 'center',
        }
      })
    },
    {
      id: 'subtitle',
      name: 'Subtitle',
      preview: 'Add a subheading',
      onClick: () => handleAddText('text', {
        type: 'text',
        width: 500,
        height: 80,
        data: {
          content: 'Add a subheading',
          fontSize: 42,
          color: '#000000',
          fontFamily: 'Inter',
          fontWeight: '600',
          textAlign: 'center',
        }
      })
    },
    {
      id: 'body',
      name: 'Body text',
      preview: 'Add a little bit of body text',
      onClick: () => handleAddText('text', {
        type: 'text',
        width: 400,
        height: 60,
        data: {
          content: 'Add a little bit of body text',
          fontSize: 24,
          color: '#000000',
          fontFamily: 'Inter',
          fontWeight: 'normal',
          textAlign: 'center',
        }
      })
    },
  ]

  const filteredTextElements = textElements.filter(element =>
    element.name.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <div
      className="flex flex-col h-full relative backdrop-blur-md transition-all duration-300"
      style={{
        width: typeof window !== 'undefined' && window.innerWidth < 1024 ? '100%' : `${width}px`,
        backgroundColor: typeof window !== 'undefined' && window.innerWidth < 1024 ? 'transparent' : 'rgba(13, 18, 22, 0.85)',
        backdropFilter: typeof window !== 'undefined' && window.innerWidth < 1024 ? 'none' : 'blur(12px)',
        WebkitBackdropFilter: typeof window !== 'undefined' && window.innerWidth < 1024 ? 'none' : 'blur(12px)',
        borderRight: typeof window !== 'undefined' && window.innerWidth < 1024 ? 'none' : '0.5px solid rgba(255, 255, 255, 0.1)',
      }}
    >
      <DragToCloseHandle onClose={onClose} onWidthChange={setWidth} initialWidth={width} minWidth={200} />

      <div className="px-4 pt-4 pb-3 border-b border-zinc-800/50">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-white">Text</h2>
          {onClose && (
            <button
              onClick={onClose}
              className="text-white/70 hover:text-white hover:bg-white/10 transition-all duration-200 p-1 rounded-md"
            >
              <X className="h-4 w-4" strokeWidth={2} />
            </button>
          )}
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-zinc-500" strokeWidth={1.5} />
          <input
            type="text"
            placeholder="Search text elements"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-zinc-900/50 border border-zinc-800 rounded-lg text-white text-sm placeholder-zinc-500 focus:outline-none focus:border-zinc-700 focus:ring-1 focus:ring-zinc-700"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="space-y-3">
          {filteredTextElements.map((element) => (
            <button
              key={element.id}
              onClick={element.onClick}
              className="w-full text-left px-4 py-4 rounded-lg hover:bg-zinc-800/50 transition-colors border border-zinc-800 hover:border-zinc-700"
            >
              <div className="flex flex-col gap-1">
                <span className="text-xs text-zinc-400 uppercase tracking-wide">{element.name}</span>
                <span
                  className="text-white"
                  style={{
                    fontSize: element.id === 'title' ? '28px' : element.id === 'subtitle' ? '20px' : '16px',
                    fontWeight: element.id === 'title' ? 'bold' : element.id === 'subtitle' ? '600' : 'normal',
                    lineHeight: '1.2',
                    fontFamily: 'Inter'
                  }}
                >
                  {element.preview}
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div >
  )
}

export default TextPanel

