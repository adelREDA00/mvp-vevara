import { useContext } from 'react'
import { Play, Pause, Scissors, Loader2, Pencil, Trash2 } from 'lucide-react'
import { ThemeContext } from '../../../app/context/ThemeContext'

function PlaybackControls({
  isPlaying = false,
  isBuffering = false,
  currentTime = 0,
  totalTime = 12,
  onPlayPause,
  onSplit,
  playheadStepId = null,
  onUpdateStep,
  onDeleteStep,
}) {
  const { theme } = useContext(ThemeContext)
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  const canUpdateStep = !!playheadStepId

  return (
    <div
      className="flex flex-col flex-shrink-0 relative"
      style={{
        backgroundColor: 'transparent',
      }}
    >
      {/* Left controls: Split + Update Step + Delete Step */}
      <div className="absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 z-20 flex items-center gap-0.5">
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
          <Scissors className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
        </button>

        {/* Update Step button */}
        <button
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            if (canUpdateStep && onUpdateStep) onUpdateStep(playheadStepId)
          }}
          disabled={!canUpdateStep}
          className={`p-1.5 rounded-md transition-all relative group ${canUpdateStep
              ? 'hover:bg-purple-500/15 active:bg-purple-500/25 text-purple-400 hover:text-purple-300 cursor-pointer'
              : 'text-white/15 cursor-not-allowed'
            }`}
          title={canUpdateStep ? 'Update step at playhead' : 'Move playhead over a step to update'}
          type="button"
        >
          <Pencil className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
          {/* Active step indicator dot */}
          {canUpdateStep && (
            <span
              className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-purple-400"
            />
          )}
          {/* Tooltip */}
          <span className="hidden group-hover:block absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-zinc-900 text-white text-[10px] px-2 py-1 rounded whitespace-nowrap pointer-events-none z-50 border border-white/10">
            {canUpdateStep ? 'Update step' : 'No step at playhead'}
          </span>
        </button>

        {/* Delete Step button */}
        <button
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            if (canUpdateStep && onDeleteStep) onDeleteStep(playheadStepId)
          }}
          disabled={!canUpdateStep}
          className={`p-1.5 rounded-md transition-all relative group ${canUpdateStep
              ? 'hover:bg-red-500/15 active:bg-red-500/25 text-red-400/70 hover:text-red-400 cursor-pointer'
              : 'text-white/15 cursor-not-allowed'
            }`}
          title={canUpdateStep ? 'Delete step at playhead' : 'Move playhead over a step to delete'}
          type="button"
        >
          <Trash2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
          {/* Tooltip */}
          <span className="hidden group-hover:block absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-zinc-900 text-white text-[10px] px-2 py-1 rounded whitespace-nowrap pointer-events-none z-50 border border-white/10">
            {canUpdateStep ? 'Delete step' : 'No step at playhead'}
          </span>
        </button>
      </div>

      {/* Center: Playback controls */}
      <div className="flex items-center justify-center px-4 h-8 sm:h-9 md:h-10 flex-shrink-0 relative z-10">
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
    </div>
  )
}

export default PlaybackControls
