import { Play, Pause } from 'lucide-react'

function PlaybackControls({
  isPlaying = false,
  currentTime = 0,
  totalTime = 12,
  onPlayPause,
}) {
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  return (
    <div
      className="flex flex-col flex-shrink-0 backdrop-blur-md"
      style={{
        backgroundColor: 'rgba(13, 18, 22, 0.85)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
      }}
    >
      {/* Top Bar: Controls and Timeline Ruler */}
      <div className="flex items-center justify-center px-4 h-8 sm:h-9 md:h-10 flex-shrink-0 relative z-10">
        {/* Center: Current Time, Play Button, Total Time */}
        <div className="flex items-center justify-center gap-3 sm:gap-4 md:gap-5">
          {/* Current Time */}
          <div
            className="text-white/60 text-[9px] sm:text-[10px] md:text-[11px] font-medium flex-shrink-0 w-10 text-right"
            style={{
              fontFamily: 'Inter, sans-serif',
              whiteSpace: 'nowrap',
            }}
          >
            {formatTime(currentTime)}
          </div>

          {/* Play Button */}
          <button
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              if (onPlayPause) {
                onPlayPause()
              }
            }}
            className="bg-white hover:bg-white/90 active:bg-white/80 rounded-full w-6 h-6 sm:w-7 sm:h-7 md:w-7.5 md:h-7.5 flex items-center justify-center transition-all transform active:scale-90 shadow-md touch-manipulation flex-shrink-0"
            title={isPlaying ? 'Pause' : 'Play'}
            type="button"
          >
            {isPlaying ? (
              <Pause className="h-3.5 w-3.5 sm:h-4 sm:w-4 md:h-4.5 md:w-4.5 text-gray-900" fill="currentColor" strokeWidth={2} />
            ) : (
              <Play className="h-3.5 w-3.5 sm:h-4 sm:w-4 md:h-4.5 md:w-4.5 text-gray-900 ml-0.5" fill="currentColor" strokeWidth={2} />
            )}
          </button>

          {/* Total Time */}
          <div
            className="text-white/60 text-[9px] sm:text-[10px] md:text-[11px] font-medium flex-shrink-0 w-10 text-left"
            style={{
              fontFamily: 'Inter, sans-serif',
              whiteSpace: 'nowrap',
            }}
          >
            {formatTime(totalTime)}
          </div>
        </div>
      </div>
    </div>
  )
}

export default PlaybackControls
