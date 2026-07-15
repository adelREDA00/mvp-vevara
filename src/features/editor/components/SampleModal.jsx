import React, { useState, useEffect, useRef } from 'react'
import { X, ChevronDown } from 'lucide-react'

/**
 * SampleModal — Lightweight modal rendered at app level (portal to body).
 * No header, no card labels. Simple image-only cards with theme-adaptive solid bg.
 * Click outside or Escape to close.
 * Accepts optional canvasRect for canvas-relative positioning.
 */

const FALLBACK_SAMPLES = [
  {
    id: 'mac-sample',
    name: 'Sample Image',
    thumbnail: '/mac.png',
  },
  {
    id: 'mac-2',
    name: 'Sample Image',
    thumbnail: '/vevaraBeta2.png',
  },
  {
    id: 'mac-1',
    name: 'Sample Image',
    thumbnail: '/vevaraBetaSample.png',
  },
  {
    id: 'mac-3',
    name: 'Sample Image',
    thumbnail: '/vevaraBetaSample1.png',
  },
]

function SampleModal({ isOpen, samples = FALLBACK_SAMPLES, onSelect, onClose, theme, canvasRect }) {
  const [selectedId, setSelectedId] = useState(null)
  const overlayRef = useRef(null)
  const isLight = theme === 'light'

  useEffect(() => {
    if (isOpen) setSelectedId(null)
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[10020] flex items-end justify-center"
      style={{ background: 'transparent', pointerEvents: 'auto' }}
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose()
      }}
    >
      <div
        className="pointer-events-auto mobile-sheet-in"
        style={{
          width: '100%',
          height: '40vh',
          maxHeight: '40vh',
          background: isLight ? '#f3f4f7' : '#090a0d',
          borderRadius: '20px 20px 0 0',
          borderTop: `1px solid ${isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)'}`,
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
        }}
      >
        {/* Header Bar — aligned right, title removed */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            position: 'relative',
            alignItems: 'center',
            padding: '8px 24px',
            borderBottom: `1px solid ${isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)'}`,
            flexShrink: 0,
          }}
        >
          <div
            className="justify-self-center w-full flex justify-center items-center cursor-row-resize touch-none"
            style={{ touchAction: 'none' }}
          >
            <div className={`w-12 h-1.5 rounded-full ${isLight ? 'bg-black/15' : 'bg-white/30'}`} aria-hidden />
          </div>

          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              borderRadius: '50%',
              width: '32px',
              height: '32px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: isLight ? '#6b7280' : '#a1a1aa',
              outline: 'none',
              transition: 'background-color 0.2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.08)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent'
            }}
            aria-label="Close modal"
          >
            <ChevronDown size={22} />
          </button>
        </div>

        {/* Content Area */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            overflowX: 'auto',
            overflowY: 'hidden',
            width: '100%',
            boxSizing: 'border-box',
            padding: '16px 24px 20px 24px',
            flex: 1,
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              gap: '24px',
              margin: '0 auto',
            }}
          >
            {samples.map((sample) => {
              const isSelected = selectedId === sample.id
              return (
                <button
                  key={sample.id}
                  onClick={() => {
                    setSelectedId(sample.id)
                    onSelect(sample)
                  }}
                  className="flex-shrink-0 cursor-pointer transition-all duration-300 hover:scale-[1.03] outline-none"
                  style={{
                    height: 'min(160px, 22vh)',
                    border: `2px solid ${isSelected ? '#7c3aed' : 'transparent'
                      }`,
                    borderRadius: '12px',
                    background: isLight ? '#e5e7eb' : '#1f2937',
                    padding: 0,
                    overflow: 'hidden',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <img
                    src={sample.thumbnail}
                    alt={sample.name}
                    style={{ height: '100%', width: 'auto', objectFit: 'contain' }}
                    loading="lazy"
                  />
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

export default React.memo(SampleModal)