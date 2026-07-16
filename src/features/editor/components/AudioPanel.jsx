import { useState, useEffect, useRef, useContext, useCallback } from 'react'
import { ThemeContext } from '../../../app/context/ThemeContext'
import { X, Music, Loader2, AlertCircle, Play, Pause } from 'lucide-react'
import api from '../../../api/client'

const BATCH_SIZE = 12 // List items are smaller, so we can load more per batch

const gradients = [
  'from-pink-500 to-rose-500',
  'from-purple-600 to-indigo-600',
  'from-amber-400 to-orange-500',
  'from-teal-400 to-cyan-500',
  'from-green-400 to-emerald-500'
]

const formatDuration = (seconds) => {
  if (!seconds) return '00:00'
  const m = Math.floor(seconds / 60).toString().padStart(2, '0')
  const s = Math.floor(seconds % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

function AudioPanel({ onClose, onAddAudioTrack }) {
  const { theme } = useContext(ThemeContext)
  const isLight = theme === 'light'
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 1024

  const [sharedAssets, setSharedAssets] = useState([])
  const [isFetching, setIsFetching] = useState(false)
  const [fetchError, setFetchError] = useState(null)
  const [hasMore, setHasMore] = useState(true)
  const [isInitialLoad, setIsInitialLoad] = useState(true)

  const sentinelRef = useRef(null)

  // Audio preview state
  const [playingTrackId, setPlayingTrackId] = useState(null)
  const audioRef = useRef(null)

  const fetchNextBatch = useCallback(async (reset = false) => {
    if (isFetching) return
    const currentSkip = reset ? 0 : sharedAssets.length
    try {
      setIsFetching(true)
      const data = await api.get(`/uploads/shared?assetType=audio&limit=${BATCH_SIZE}&skip=${currentSkip}`)
      if (data.length < BATCH_SIZE) {
        setHasMore(false)
      } else {
        setHasMore(true)
      }
      if (reset) {
        setSharedAssets(data)
      } else {
        setSharedAssets(prev => [...prev, ...data])
      }
      setFetchError(null)
    } catch (err) {
      setFetchError(err.message || 'Failed to fetch audio assets')
    } finally {
      setIsFetching(false)
      setIsInitialLoad(false)
    }
  }, [isFetching, sharedAssets.length])

  // Initial fetch on mount
  useEffect(() => {
    fetchNextBatch(true)
  }, [])

  // Scroll pagination observer
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || !hasMore || isFetching || isInitialLoad) return

    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        fetchNextBatch(false)
      }
    }, {
      root: null,
      rootMargin: '150px',
      threshold: 0.1
    })

    observer.observe(sentinel)
    return () => {
      if (sentinel) observer.unobserve(sentinel)
    }
  }, [sentinelRef.current, hasMore, isFetching, isInitialLoad, fetchNextBatch])

  // Stop audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }
    }
  }, [])

  const handlePlayPause = (track) => {
    const trackId = track._id || track.id
    if (playingTrackId === trackId) {
      if (audioRef.current) {
        audioRef.current.pause()
      }
      setPlayingTrackId(null)
    } else {
      if (audioRef.current) {
        audioRef.current.pause()
      }

      audioRef.current = new Audio(track.url || track.src)
      audioRef.current.volume = 0.5
      audioRef.current.play().catch(err => {
        console.warn('Audio preview play failed:', err)
      })
      setPlayingTrackId(trackId)

      audioRef.current.onended = () => {
        setPlayingTrackId(null)
      }
    }
  }

  return (
    <div
      className="flex flex-col h-full relative transition-all duration-300 pt-0 lg:pt-12"
      style={{
        width: isMobile ? '100%' : '320px',
        backgroundColor: isMobile ? 'transparent' : (isLight ? '#f3f4f7' : '#090a0d'),
        backdropFilter: isMobile ? 'none' : 'blur(20px)',
        WebkitBackdropFilter: isMobile ? 'none' : 'blur(20px)',
        borderRight: isMobile ? 'none' : `1px solid ${isLight ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.05)'}`,
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

      {fetchError && (
        <div className="mx-4 mt-2 p-3 bg-red-900/50 border border-red-700 rounded-lg flex gap-2">
          <AlertCircle className="h-4 w-4 text-red-400 flex-shrink-0" />
          <p className="text-red-300 text-sm flex-1">{fetchError}</p>
        </div>
      )}

      {/* Audio Grid Container */}
      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar scrollbar-hide flex flex-col gap-3">
        {isInitialLoad && isFetching ? (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className={`flex items-center gap-3.5 p-2.5 rounded-xl border animate-pulse ${isLight ? 'bg-black/5 border-slate-100' : 'bg-white/5 border-white/5'}`}>
                <div className="w-11 h-11 rounded-full bg-slate-300/30 shrink-0" />
                <div className="flex-1 flex flex-col gap-2">
                  <div className="h-3 bg-slate-300/30 rounded w-2/3" />
                  <div className="h-2 bg-slate-300/30 rounded w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : sharedAssets.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-center">
            <div className={`p-4 rounded-full mb-4 ${isLight ? 'bg-black/5' : 'bg-white/5'}`}>
              <Music className={`h-8 w-8 ${isLight ? 'text-slate-300' : 'text-zinc-600'}`} />
            </div>
            <p className={`text-[14px] font-medium ${isLight ? 'text-slate-400' : 'text-zinc-500'}`}>
              No audio tracks available
            </p>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-2.5">
              {sharedAssets.map((track) => {
                const trackId = track._id || track.id
                const trackName = track.name || track.metadata?.name || 'Audio Track'
                const trackDurationRaw = track.metadata?.duration || track.duration || 0
                const durationText = formatDuration(trackDurationRaw)
                const isPlaying = playingTrackId === trackId

                const gradIndex = Math.abs((trackName || '').charCodeAt(0) || 0) % gradients.length
                const gradientClass = gradients[gradIndex]

                return (
                  <div
                    key={trackId}
                    onClick={() => onAddAudioTrack(track)}
                    className={`flex items-center gap-3.5 p-2.5 rounded-xl transition-all cursor-pointer ${isLight
                      ? 'hover:bg-slate-50'
                      : 'hover:bg-[#1b1c26]'
                      }`}
                  >
                    {/* Left Side: Circular Profile with Play Button always on top */}
                    <div className="relative shrink-0 w-11 h-11 rounded-full overflow-hidden shadow-sm">
                      {/* Gradient background */}
                      <div className={`absolute inset-0 bg-gradient-to-tr ${gradientClass} flex items-center justify-center`}>
                        <Music className="h-5 w-5 text-white/40" />
                      </div>
                      {/* Play/Pause Button overlay - always visible, semi-transparent black background, white icon */}
                      <div className="absolute inset-0 bg-black/35 flex items-center justify-center">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation() // Prevent triggering row click insertion
                            handlePlayPause(track)
                          }}
                          className="w-7 h-7 rounded-full bg-white/20 hover:bg-white/30 text-white flex items-center justify-center transition-all hover:scale-105 active:scale-95"
                        >
                          {isPlaying ? (
                            <Pause className="h-3.5 w-3.5 fill-white text-white" />
                          ) : (
                            <Play className="h-3.5 w-3.5 fill-white text-white ml-0.5" />
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Right Side: Name and Duration */}
                    <div className="min-w-0 flex-1 flex flex-col gap-0.5">
                      <span className={`text-xs font-semibold truncate ${isLight ? 'text-slate-800' : 'text-zinc-200'}`}>
                        {trackName}
                      </span>
                      <span className={`text-[10px] font-medium ${isLight ? 'text-slate-400' : 'text-zinc-500'}`}>
                        {durationText}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
            {hasMore && (
              <div ref={sentinelRef} className="h-14 flex items-center justify-center mt-2">
                <Loader2 className="h-5 w-5 animate-spin text-[#7c4af0]" />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default AudioPanel
