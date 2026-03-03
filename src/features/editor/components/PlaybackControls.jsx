import { Play, Pause, Scissors, Loader2 } from 'lucide-react'

function PlaybackControls({
  isPlaying = false,
  isBuffering = false,
  currentTime = 0,
  totalTime = 12,
  onPlayPause,
  onSplit,
}) {
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
      {/* Left-aligned Scissor Button - Absolute positioned within the bars container */}
      <div className="absolute left-4 top-1/2 -translate-y-1/2 z-20">
        <button
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            if (onSplit) onSplit()
          }}
          className="p-1.5 rounded-md hover:bg-white/10 active:bg-purple-600/40 text-white/60 hover:text-white transition-all group"
          title="Split page at playhead (S)"
          type="button"
        >
          <Scissors className="h-4 w-4 sm:h-4.5 sm:w-4.5" />
        </button>
      </div>

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

          {/* Play / Pause / Loading Button */}
          <button
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              if (!isBuffering && onPlayPause) {
                onPlayPause()
              }
            }}
            disabled={isBuffering}
            className={`bg-white rounded-full w-6 h-6 sm:w-7 sm:h-7 md:w-7.5 md:h-7.5 flex items-center justify-center transition-all transform shadow-md touch-manipulation flex-shrink-0 ${isBuffering
                ? 'opacity-70 cursor-not-allowed'
                : 'hover:bg-white/90 active:bg-white/80 active:scale-90'
              }`}
            title={isBuffering ? 'Buffering...' : isPlaying ? 'Pause' : 'Play'}
            type="button"
          >
            {isBuffering ? (
              <Loader2
                className="h-3.5 w-3.5 sm:h-4 sm:w-4 md:h-4.5 md:w-4.5 text-gray-900 animate-spin"
              />
            ) : isPlaying ? (
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
