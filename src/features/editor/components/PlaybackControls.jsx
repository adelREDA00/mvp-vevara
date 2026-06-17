import { useContext } from 'react'
import { Play, Pause, Scissors, Loader2, ZoomIn, ZoomOut } from 'lucide-react'
import { ThemeContext } from '../../../app/context/ThemeContext'

function PlaybackControls({
  isPlaying = false,
  isBuffering = false,
  currentTime = 0,
  totalTime = 12,
  onPlayPause,
  onSplit,
  isMotionCaptureActive = false,
  shiftLeft = false,
  onZoomIn,
  onZoomOut,
}) {
  const { theme } = useContext(ThemeContext)
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  return (
    <div
      className="flex flex-col flex-shrink-0 relative"
      style={{
        backgroundColor: 'transparent',
      }}
    >
      {/* Left controls: Split */}
      {!isMotionCaptureActive && (
        <div className="absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 z-20 flex items-center gap-0.5 sm:gap-1">
          <button
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              if (onSplit) onSplit()
            }}
            className={`p-1.5 rounded-md transition-all ${theme === 'light'
              ? 'hover:bg-gray-200 text-gray-400 hover:text-gray-700'
              : 'hover:bg-white/8 active:bg-white/15 text-white/40 hover:text-white/80'}`}
            title="Split page at playhead (S)"
            type="button"
          >
            <Scissors className="h-3.5 w-3.5 sm:h-4 sm:w-4 lg:h-[18px] lg:w-[18px]" />
          </button>
        </div>
      )}

      {/* Right controls: Zoom Out + Zoom In (Mobile only) */}
      {!isMotionCaptureActive && (
        <div className="absolute right-3 sm:right-4 top-1/2 -translate-y-1/2 z-20 flex lg:hidden items-center gap-0.5">
          {/* Timeline Zoom Out (Mobile only) */}
          <button
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              if (onZoomOut) onZoomOut()
            }}
            className={`p-1.5 rounded-md transition-all ${theme === 'light' 
              ? 'hover:bg-gray-200 text-gray-400 hover:text-gray-700' 
              : 'hover:bg-white/8 active:bg-white/15 text-white/40 hover:text-white/80'}`}
            title="Zoom out timeline"
            type="button"
          >
            <ZoomOut className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
          </button>

          {/* Timeline Zoom In (Mobile only) */}
          <button
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              if (onZoomIn) onZoomIn()
            }}
            className={`p-1.5 rounded-md transition-all ${theme === 'light' 
              ? 'hover:bg-gray-200 text-gray-400 hover:text-gray-700' 
              : 'hover:bg-white/8 active:bg-white/15 text-white/40 hover:text-white/80'}`}
            title="Zoom in timeline"
            type="button"
          >
            <ZoomIn className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
          </button>
        </div>
      )}

      {/* Center: Playback controls */}
      {!isMotionCaptureActive && (
        <div 
          className="flex items-center justify-center px-4 h-8 sm:h-9 md:h-10 flex-shrink-0 relative z-10"
          style={{
            transform: shiftLeft ? 'translateX(-40px)' : 'none'
          }}
        >
          <div className="flex items-center justify-center gap-3 sm:gap-4 md:gap-5">
            <div
              className={`${theme === 'light' ? 'text-gray-400' : 'text-white/45'} text-[11px] sm:text-[12px] font-semibold flex-shrink-0 w-12 text-right tabular-nums`}
              style={{
                fontFamily: 'Inter, system-ui, sans-serif',
                whiteSpace: 'nowrap',
              }}
            >
              {formatTime(currentTime)}
            </div>

            <button
              data-tutorial="play-button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                if (!isBuffering && onPlayPause) {
                  onPlayPause()
                }
              }}
              disabled={isBuffering}
              className={`bg-white rounded-full w-6 h-6 sm:w-7 sm:h-7 flex items-center justify-center transition-all transform touch-manipulation flex-shrink-0 ${isBuffering
                ? 'opacity-70 cursor-not-allowed'
                : 'hover:bg-white/90 active:bg-white/80 active:scale-90'
                }`}
              title={isBuffering ? 'Buffering...' : isPlaying ? 'Pause' : 'Play'}
              type="button"
            >
              {isBuffering ? (
                <Loader2 className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-gray-900 animate-spin" />
              ) : isPlaying ? (
                <Pause className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-gray-900" fill="currentColor" strokeWidth={2} />
              ) : (
                <Play className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-gray-900 ml-0.5" fill="currentColor" strokeWidth={2} />
              )}
            </button>

            <div
              className={`${theme === 'light' ? 'text-gray-400' : 'text-white/45'} text-[11px] sm:text-[12px] font-semibold flex-shrink-0 w-12 text-left tabular-nums`}
              style={{
                fontFamily: 'Inter, system-ui, sans-serif',
                whiteSpace: 'nowrap',
              }}
            >
              {formatTime(totalTime)}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default PlaybackControls
