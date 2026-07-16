import { useState, useContext } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { ThemeContext } from '../../../app/context/ThemeContext'
import { X, Search, Type } from 'lucide-react'
import { addLayerAndSelect, selectCurrentSceneId } from '../../../store/slices/projectSlice'
import { DragToCloseHandle } from './DragToCloseHandle'

function TextPanel({ onClose, aspectRatio }) {
  const dispatch = useDispatch()
  const currentSceneId = useSelector(selectCurrentSceneId)
  const [searchQuery, setSearchQuery] = useState('')
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
      className="flex flex-col h-full relative transition-all duration-300 pt-0 lg:pt-12"
      style={{
        width: typeof window !== 'undefined' && window.innerWidth < 1024 ? '100%' : '320px',
        backgroundColor: typeof window !== 'undefined' && window.innerWidth < 1024 ? 'transparent' : (isLight ? '#f3f4f7' : '#090a0d'),
        backdropFilter: typeof window !== 'undefined' && window.innerWidth < 1024 ? 'none' : 'blur(20px)',
        WebkitBackdropFilter: typeof window !== 'undefined' && window.innerWidth < 1024 ? 'none' : 'blur(20px)',
        borderRight: typeof window !== 'undefined' && window.innerWidth < 1024 ? 'none' : `1px solid ${isLight ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.05)'}`,
      }}
    >
      {onClose && (
        <button
          onClick={onClose}
          className={`absolute top-3 right-3 z-50 transition-all duration-300 p-2 rounded-[10px] ${isLight ? 'text-gray-400 hover:text-gray-900 hover:bg-gray-100' : 'text-white/40 hover:text-white hover:bg-white/10'} hidden lg:block`}
        >
          <X className="h-5 w-5" strokeWidth={2} />
        </button>
      )}

      <div className="flex-1 overflow-y-auto p-6 scrollbar-hide">
        <div className="space-y-4">
          {filteredTextElements.map((element) => (
            <button
              key={element.id}
              onClick={element.onClick}
              className={`w-full text-left px-5 py-6 rounded-[16px] transition-all duration-300 border group shadow-sm active:scale-[0.98] ${isLight
                ? 'bg-gray-50/50 hover:bg-gray-100 border-gray-200 hover:border-gray-300'
                : 'hover:bg-white/5 border-white/5 hover:border-white/10'
                }`}
            >
              <div className="flex flex-col gap-2">
                {/* <span className={`text-[10px] uppercase font-bold tracking-widest transition-colors ${isLight ? 'text-gray-500 group-hover:text-gray-700' : 'text-white/40 group-hover:text-white/60'}`}>{element.name}</span> */}
                <span
                  className={isLight ? 'text-gray-900' : 'text-white'}
                  style={{
                    fontSize: element.id === 'title' ? '28px' :
                      element.id === 'cartoon' ? '32px' :
                        element.id === 'premium' ? '24px' :
                          element.id === 'poster' ? '28px' :
                            element.id === 'retro' ? '14px' :
                              element.id === 'subtitle' ? '20px' : '16px',
                    fontWeight: element.id === 'title' ? '700' :
                      element.id === 'subtitle' ? '600' : '500',
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

