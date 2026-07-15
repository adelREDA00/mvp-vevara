import { useState, useEffect, useRef, useContext, useCallback } from 'react'
import { ThemeContext } from '../../../app/context/ThemeContext'
import { X, Play, Pause, Music, Loader2, AlertCircle } from 'lucide-react'
import api from '../../../api/client'

const BATCH_SIZE = 6

const GRADIENTS = [
  'from-pink-500 to-rose-500',
  'from-purple-600 to-indigo-600',
  'from-amber-400 to-orange-500',
  'from-teal-400 to-cyan-500',
  'from-green-400 to-emerald-500',
]

const formatDuration = (seconds) => {
  if (!seconds) return '0:00'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
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

      {/* Audio List Container */}
      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar scrollbar-hide flex flex-col gap-3">
        {isInitialLoad && isFetching ? (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className={`flex items-center gap-3 p-2 rounded-xl animate-pulse ${isLight ? 'bg-black/5' : 'bg-white/5'}`}>
                <div className="w-12 h-12 rounded-full bg-slate-300/30 shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 bg-slate-300/30 rounded w-3/4" />
                  <div className="h-2.5 bg-slate-300/30 rounded w-1/2" />
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
            {sharedAssets.map((track, index) => {
              const trackId = track._id || track.id
              const isPlaying = playingTrackId === trackId
              const gradient = GRADIENTS[index % GRADIENTS.length]

              return (
                <div
                  key={trackId}
                  className={`flex items-center justify-between p-2 rounded-xl transition-all duration-200 group ${
                    isLight ? 'hover:bg-black/5' : 'hover:bg-white/5'
                  }`}
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div
                      className="relative w-12 h-12 rounded-full overflow-hidden flex-shrink-0 flex items-center justify-center cursor-pointer shadow-sm"
                      onClick={() => handlePlayPause(track)}
                    >
                      <div className={`absolute inset-0 bg-gradient-to-tr ${gradient} flex items-center justify-center`}>
                        <Music className="h-5 w-5 text-white/70" />
                      </div>

                      <div className={`absolute inset-0 bg-black/40 flex items-center justify-center transition-opacity duration-200 ${
                        isPlaying ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                      }`}>
                        {isPlaying ? (
                          <Pause className="h-5 w-5 text-white fill-white" />
                        ) : (
                          <Play className="h-5 w-5 text-white fill-white ml-0.5" />
                        )}
                      </div>
                    </div>

                    <div className="flex flex-col min-w-0">
                      <span
                        className={`text-[13px] font-semibold truncate ${
                          isLight ? 'text-gray-900' : 'text-white'
                        }`}
                      >
                        {track.name}
                      </span>
                      <span
                        className={`text-[11px] truncate mt-0.5 ${
                          isLight ? 'text-gray-500' : 'text-white/40'
                        }`}
                      >
                        Designer • {formatDuration(track.metadata?.duration)}
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={() => onAddAudioTrack?.(track)}
                    className={`flex-shrink-0 ml-2 px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all duration-200 ${
                      isLight
                        ? 'bg-purple-50 hover:bg-[#7c4af0] text-[#7c4af0] hover:text-white border border-purple-100'
                        : 'bg-white/8 hover:bg-[#7c4af0] text-white hover:text-white border border-transparent'
                    }`}
                  >
                    Add
                  </button>
                </div>
              )
            })}
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
