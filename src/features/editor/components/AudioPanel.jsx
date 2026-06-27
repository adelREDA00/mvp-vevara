import { useState, useEffect, useRef, useContext } from 'react'
import { ThemeContext } from '../../../app/context/ThemeContext'
import { X, Play, Pause, Music } from 'lucide-react'

// Mock audio tracks data with free play/pause test mp3 URLs
const MOCK_AUDIO_TRACKS = [
  {
    id: 'track-1',
    name: 'If We Make It Through December',
    artist: 'Phoebe Bridgers',
    duration: '1:00',
    durationSeconds: 60,
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
    gradient: 'from-pink-500 to-rose-500',
    imageUrl: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=100&auto=format&fit=crop&q=60'
  },
  {
    id: 'track-2',
    name: 'Truth Hurts',
    artist: 'Lizzo',
    duration: '1:00',
    durationSeconds: 60,
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',
    gradient: 'from-purple-600 to-indigo-600',
    imageUrl: 'https://images.unsplash.com/photo-1498038432885-c6f3f1b912ee?w=100&auto=format&fit=crop&q=60'
  },
  {
    id: 'track-3',
    name: 'Heaven',
    artist: 'Khalid',
    duration: '1:00',
    durationSeconds: 60,
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3',
    gradient: 'from-amber-400 to-orange-500',
    imageUrl: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=100&auto=format&fit=crop&q=60'
  },
  {
    id: 'track-4',
    name: 'Slow Motion',
    artist: 'Vevara Ambient',
    duration: '2:15',
    durationSeconds: 135,
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3',
    gradient: 'from-teal-400 to-cyan-500',
    imageUrl: 'https://images.unsplash.com/photo-1446057032654-9d8885b7a3f3?w=100&auto=format&fit=crop&q=60'
  },
  {
    id: 'track-5',
    name: 'Upbeat Corporate',
    artist: 'Marketing Vibe',
    duration: '3:30',
    durationSeconds: 210,
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3',
    gradient: 'from-green-400 to-emerald-500',
    imageUrl: 'https://images.unsplash.com/photo-1459749411175-04bf5292ceea?w=100&auto=format&fit=crop&q=60'
  }
]

function AudioPanel({ onClose, onAddAudioTrack }) {
  const { theme } = useContext(ThemeContext)
  const isLight = theme === 'light'
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 1024

  // Audio preview state
  const [playingTrackId, setPlayingTrackId] = useState(null)
  const audioRef = useRef(null)

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
    if (playingTrackId === track.id) {
      // Pause current
      if (audioRef.current) {
        audioRef.current.pause()
      }
      setPlayingTrackId(null)
    } else {
      // Pause previous if any
      if (audioRef.current) {
        audioRef.current.pause()
      }

      // Play new
      audioRef.current = new Audio(track.url)
      audioRef.current.volume = 0.5 // Default moderate preview volume
      audioRef.current.play().catch(err => {
        console.warn('Audio preview play failed:', err)
      })
      setPlayingTrackId(track.id)

      audioRef.current.onended = () => {
        setPlayingTrackId(null)
      }
    }
  }

  return (
    <div
      className="flex flex-col h-full relative transition-all duration-300"
      style={{
        width: isMobile ? '100%' : '320px',
        backgroundColor: isMobile ? 'transparent' : (isLight ? '#f3f4f7' : '#090a0d'),
        backdropFilter: isMobile ? 'none' : 'blur(20px)',
        WebkitBackdropFilter: isMobile ? 'none' : 'blur(20px)',
        borderRight: isMobile ? 'none' : `1px solid ${isLight ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.05)'}`,
      }}
    >
      {/* Panel Header */}
      <div className={`hidden lg:block px-6 pt-6 pb-5 border-b ${isLight ? 'border-black/5' : 'border-white/5'}`}>
        <div className="flex items-center justify-between">
          <h2 className={`text-[20px] font-semibold tracking-tight ${isLight ? 'text-gray-900' : 'text-white'}`}>Audio</h2>
          {onClose && (
            <button
              onClick={onClose}
              className={`transition-all duration-300 p-2 rounded-[10px] ${isLight ? 'text-gray-400 hover:text-gray-900 hover:bg-gray-100' : 'text-white/40 hover:text-white hover:bg-white/10'}`}
            >
              <X className="h-5 w-5" strokeWidth={2} />
            </button>
          )}
        </div>
      </div>

      {/* Audio List Container */}
      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar scrollbar-hide flex flex-col gap-3">
        {MOCK_AUDIO_TRACKS.map((track) => {
          const isPlaying = playingTrackId === track.id

          return (
            <div
              key={track.id}
              className={`flex items-center justify-between p-2 rounded-xl transition-all duration-200 group ${
                isLight
                  ? 'hover:bg-black/5'
                  : 'hover:bg-white/5'
              }`}
            >
              {/* Left End - Circle with background/audio art and Play/Pause overlay */}
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div
                  className="relative w-12 h-12 rounded-full overflow-hidden flex-shrink-0 flex items-center justify-center cursor-pointer shadow-sm"
                  onClick={() => handlePlayPause(track)}
                >
                  {/* Gradient background with Music icon */}
                  <div className={`absolute inset-0 bg-gradient-to-tr ${track.gradient} flex items-center justify-center`}>
                    <Music className="h-5 w-5 text-white/70" />
                  </div>

                  {/* Translucent overlay - visible on hover or when playing */}
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

                {/* Middle - Name, Artist, and Duration */}
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
                    {track.artist} • {track.duration}
                  </span>
                </div>
              </div>

              {/* Right End - Add Action Button (hover-revealed or subtle add button) */}
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
      </div>
    </div>
  )
}

export default AudioPanel
