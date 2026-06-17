import { ThemeContext } from '../../../app/context/ThemeContext'
import React, { useMemo, useState, useRef, useCallback, useContext } from 'react'
import { GripVertical, X, Film } from 'lucide-react'
import { LAYER_TYPES } from '../../../store/models'
import { getContrastCardBg } from '../utils/contrast'

// Shrink font size so text always fits within the fixed-size preview card
function getTextFontSize(text) {
  const len = (text || '').length
  if (len <= 5) return '13px'
  if (len <= 12) return '11px'
  if (len <= 22) return '9px'
  if (len <= 40) return '7.5px'
  return '6px'
}

function PositionPanel({
  layers = [],
  selectedLayerId = null,
  onSelectLayer,
  onReorder,
  onClose,
}) {
  const { theme } = useContext(ThemeContext)
  const isLight = theme === 'light'
  const [overId, setOverId] = useState(null)

  const containerRef = useRef(null)
  const pointerYRef = useRef(0)
  const dragScrollLoopRef = useRef(null)

  const dragInfoRef = useRef({
    isDown: false,
    startX: 0,
    startY: 0,
    offsetX: 0,
    offsetY: 0,
    draggingId: null,
    ghostEl: null,
    hasStarted: false,
    cardEl: null,
  })

  const [draggingId, setDraggingId] = useState(null)

  const stack = useMemo(() => layers.filter(Boolean), [layers])

  const frontToBack = useMemo(() =>
    stack.filter(l => l.type !== LAYER_TYPES.BACKGROUND).slice().reverse(),
    [stack]
  )

  const backgroundLayer = useMemo(
    () => stack.find(l => l.type === LAYER_TYPES.BACKGROUND) || null,
    [stack]
  )

  const getDisplayIndex = useCallback((id) => frontToBack.findIndex(l => l.id === id), [frontToBack])

  const stackIndexFromDisplayIndex = useCallback((di) => stack.length - 1 - di, [stack])

  // Continuous autoscroll loop using requestAnimationFrame
  const startAutoscroll = useCallback(() => {
    if (dragScrollLoopRef.current) return

    const scrollFn = () => {
      const container = containerRef.current
      if (!container || !dragInfoRef.current.isDown) {
        dragScrollLoopRef.current = null
        return
      }

      const rect = container.getBoundingClientRect()
      const clientY = pointerYRef.current
      const threshold = 55
      const maxSpeed = 15 // pixels per frame

      let speed = 0
      if (clientY >= rect.top && clientY <= rect.bottom) {
        const distTop = clientY - rect.top
        const distBottom = rect.bottom - clientY

        if (distTop < threshold) {
          speed = -((threshold - distTop) / threshold) * maxSpeed
        } else if (distBottom < threshold) {
          speed = ((threshold - distBottom) / threshold) * maxSpeed
        }
      }

      if (speed !== 0) {
        container.scrollTop += speed

        // When scrolling, re-evaluate the element under the pointer to update the overId
        const ghost = dragInfoRef.current.ghostEl
        if (ghost) {
          ghost.style.display = 'none'
          const element = document.elementFromPoint(window.innerWidth / 2, pointerYRef.current)
          ghost.style.display = 'flex'

          if (element) {
            const card = element.closest('[data-layer-id]')
            if (card) {
              const targetId = card.getAttribute('data-layer-id')
              if (targetId && targetId !== dragInfoRef.current.draggingId) {
                setOverId(targetId)
              } else {
                setOverId(null)
              }
            } else {
              setOverId(null)
            }
          }
        }
      }

      dragScrollLoopRef.current = requestAnimationFrame(scrollFn)
    }

    dragScrollLoopRef.current = requestAnimationFrame(scrollFn)
  }, [])

  const stopAutoscroll = useCallback(() => {
    if (dragScrollLoopRef.current) {
      cancelAnimationFrame(dragScrollLoopRef.current)
      dragScrollLoopRef.current = null
    }
  }, [])

  const handlePointerDown = useCallback((e, layerId) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return

    const cardEl = e.currentTarget
    const rect = cardEl.getBoundingClientRect()

    dragInfoRef.current = {
      isDown: true,
      startX: e.clientX,
      startY: e.clientY,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      draggingId: layerId,
      ghostEl: null,
      hasStarted: false,
      cardEl: cardEl,
    }

    pointerYRef.current = e.clientY
    cardEl.setPointerCapture(e.pointerId)
  }, [])

  const handlePointerMove = useCallback((e) => {
    const info = dragInfoRef.current
    if (!info.isDown) return

    pointerYRef.current = e.clientY

    if (!info.hasStarted) {
      const dist = Math.hypot(e.clientX - info.startX, e.clientY - info.startY)
      if (dist > 5) {
        info.hasStarted = true
        setDraggingId(info.draggingId)

        const originalCard = info.cardEl
        if (originalCard) {
          const rect = originalCard.getBoundingClientRect()
          const ghost = originalCard.cloneNode(true)
          ghost.removeAttribute('data-layer-id')
          ghost.style.cssText = [
            'position: fixed',
            'width: ' + rect.width + 'px',
            'height: ' + rect.height + 'px',
            'opacity: 0.92',
            'pointer-events: none',
            'z-index: 9999',
            'box-shadow: 0 20px 35px rgba(0,0,0,0.35), 0 0 0 1.5px rgba(124, 74, 240, 0.25)',
            'background: ' + (isLight ? '#ffffff' : '#0e0f12'),
            'border: 1.5px solid #7c4af0',
            'border-radius: 10px',
            'transform: scale(1.02) rotate(0.8deg)',
            'left: ' + (e.clientX - info.offsetX) + 'px',
            'top: ' + (e.clientY - info.offsetY) + 'px',
            'transition: transform 0.15s ease, box-shadow 0.15s ease',
            'backdrop-filter: blur(12px)',
            '-webkit-backdrop-filter: blur(12px)',
          ].join(';')
          document.body.appendChild(ghost)
          info.ghostEl = ghost
        }

        startAutoscroll()
      }
    }

    if (info.hasStarted && info.ghostEl) {
      info.ghostEl.style.left = (e.clientX - info.offsetX) + 'px'
      info.ghostEl.style.top = (e.clientY - info.offsetY) + 'px'

      // Temporarily hide ghost to check elements under pointer
      info.ghostEl.style.display = 'none'
      const element = document.elementFromPoint(e.clientX, e.clientY)
      info.ghostEl.style.display = 'flex'

      if (element) {
        const card = element.closest('[data-layer-id]')
        if (card) {
          const targetId = card.getAttribute('data-layer-id')
          if (targetId && targetId !== info.draggingId) {
            setOverId(targetId)
          } else {
            setOverId(null)
          }
        } else {
          setOverId(null)
        }
      }
    }
  }, [isLight, startAutoscroll])

  const handlePointerUp = useCallback((e) => {
    const info = dragInfoRef.current
    if (!info.isDown) return

    try {
      info.cardEl?.releasePointerCapture(e.pointerId)
    } catch (err) {}

    stopAutoscroll()

    if (info.ghostEl) {
      info.ghostEl.remove()
    }

    const wasDragging = info.hasStarted
    const finalDraggingId = info.draggingId

    dragInfoRef.current = {
      isDown: false,
      startX: 0,
      startY: 0,
      offsetX: 0,
      offsetY: 0,
      draggingId: null,
      ghostEl: null,
      hasStarted: false,
      cardEl: null,
    }

    setDraggingId(null)
    setOverId(null)

    if (wasDragging) {
      const element = document.elementFromPoint(e.clientX, e.clientY)
      let targetId = null
      if (element) {
        const card = element.closest('[data-layer-id]')
        if (card) {
          targetId = card.getAttribute('data-layer-id')
        }
      }

      if (targetId && targetId !== finalDraggingId) {
        const fromDi = getDisplayIndex(finalDraggingId)
        const toDi = getDisplayIndex(targetId)

        if (fromDi !== -1 && toDi !== -1 && fromDi !== toDi) {
          const fromIdx = stackIndexFromDisplayIndex(fromDi)
          const toIdx = stackIndexFromDisplayIndex(toDi)
          if (fromIdx > 0 && toIdx > 0) {
            onReorder?.(fromIdx, toIdx)
          }
        }
      }
    } else {
      onSelectLayer?.(finalDraggingId)
    }
  }, [getDisplayIndex, stackIndexFromDisplayIndex, onReorder, onSelectLayer, stopAutoscroll])


  const renderPreview = (layer) => {
    if (!layer) return null

    // ── IMAGE ────────────────────────────────────────────────────────────────
    if (layer.type === LAYER_TYPES.IMAGE) {
      const src = layer.data?.url || layer.data?.src
      return src
        ? <img src={src} alt="" className="w-full h-full object-contain rounded-md" />
        : <div className={`w-full h-full rounded-md ${isLight ? 'bg-slate-200' : 'bg-gradient-to-br from-white/20 to-white/5'}`} />
    }

    // ── VIDEO ─────────────────────────────────────────────────────────────────
    if (layer.type === LAYER_TYPES.VIDEO) {
      const thumb = layer.data?.thumbnail
      const url = layer.data?.url || layer.data?.src
      return (
        <div className={`w-full h-full relative rounded-md overflow-hidden ${isLight ? 'bg-slate-100' : 'bg-zinc-900'}`}>
          {thumb
            ? <img src={thumb} alt="" className="w-full h-full object-cover" />
            : (url ? <video src={url} className="w-full h-full object-cover" preload="metadata" muted playsInline /> : <div className={`w-full h-full ${isLight ? 'bg-slate-100' : 'bg-zinc-900'}`} />)
          }
          <div className={`absolute inset-0 flex items-center justify-center ${isLight ? 'bg-black/10' : 'bg-black/30'}`}>
            <Film className={`h-4 w-4 ${isLight ? 'text-slate-600' : 'text-white/70'}`} />
          </div>
        </div>
      )
    }

    // ── TEXT ──────────────────────────────────────────────────────────────────
    if (layer.type === LAYER_TYPES.TEXT) {
      const text = layer.data?.content || ''
      const color = layer.data?.color || (isLight ? '#111827' : '#ffffff')
      const fs = getTextFontSize(text)
      const contrastBg = getContrastCardBg(color, isLight)
      return (
        <div
          className={`w-full h-full rounded-md flex items-center justify-center px-2 overflow-hidden ${
            contrastBg ? 'border border-transparent' : (isLight ? 'bg-white border border-slate-100' : 'bg-white/5 border border-white/10')
          }`}
          style={contrastBg ? { backgroundColor: contrastBg } : undefined}
        >
          <span
            style={{ fontSize: fs, color, lineHeight: 1.2, wordBreak: 'break-all' }}
            className="text-center font-semibold"
          >
            {text || <span className={`${isLight ? 'text-slate-300' : 'text-white/30'} italic`}>empty</span>}
          </span>
        </div>
      )
    }

    // ── SHAPE ─────────────────────────────────────────────────────────────────
    if (layer.type === LAYER_TYPES.SHAPE) {
      const fill = layer.data?.fill
      const shapeType = layer.data?.shapeType || 'rect'
      const fillColor = fill && fill !== 'transparent' ? fill : (isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.18)')

      if (shapeType === 'circle') {
        return (
          <div className="w-full h-full flex items-center justify-center">
            <div className={`w-8 h-8 rounded-full border ${isLight ? 'border-slate-200' : 'border-white/10'}`} style={{ backgroundColor: fillColor }} />
          </div>
        )
      }
      if (shapeType === 'triangle') {
        return (
          <div className="w-full h-full flex items-center justify-center">
            <div className="w-0 h-0" style={{
              borderLeft: '14px solid transparent',
              borderRight: '14px solid transparent',
              borderBottom: `24px solid ${fillColor}`,
            }} />
          </div>
        )
      }
      return <div className={`w-full h-full rounded-md border ${isLight ? 'border-slate-200' : 'border-white/10'}`} style={{ backgroundColor: fillColor }} />
    }

    // ── FRAME ─────────────────────────────────────────────────────────────────
    if (layer.type === LAYER_TYPES.FRAME) {
      const hasFrontAsset = !!layer.data?.assetUrl
      const isCard = !!layer.data?.isCardFrame
      const hasBackAsset = isCard && !!layer.data?.backAssetUrl
      const hasAnyAsset = hasFrontAsset || hasBackAsset

      if (!hasAnyAsset) {
        return (
          <div className={`w-full h-full rounded-md flex items-center justify-center text-[10px] font-bold tracking-wider uppercase ${isLight ? 'bg-slate-100 border border-slate-200 text-slate-500' : 'bg-white/5 border border-white/10 text-white/40'}`}>
            Frame
          </div>
        )
      }

      // Helper to render a single frame asset (front or back) inside a half-width or full-width container
      const renderSingleFrameAsset = (url, isVideo, sideLabel) => {
        if (!url) {
          return (
            <div className={`w-full h-full flex items-center justify-center text-[8px] font-bold ${isLight ? 'bg-slate-50 text-slate-350' : 'bg-black/10 text-white/20'}`}>
              {sideLabel}
            </div>
          )
        }

        if (isVideo) {
          const thumb = sideLabel === 'Back' ? layer.data?.backThumbnail : layer.data?.thumbnail
          return (
            <div className="w-full h-full relative overflow-hidden bg-black/10">
              {thumb ? (
                <img src={thumb} alt="" className="w-full h-full object-contain" />
              ) : (
                <video src={url} className="w-full h-full object-contain" preload="metadata" muted playsInline />
              )}
              <div className={`absolute inset-0 flex items-center justify-center ${isLight ? 'bg-black/10' : 'bg-black/30'}`}>
                <Film className={`h-3 w-3 ${isLight ? 'text-slate-600' : 'text-white/70'}`} />
              </div>
            </div>
          )
        }

        return (
          <img src={url} alt="" className="w-full h-full object-contain" />
        )
      }

      if (isCard) {
        return (
          <div className={`w-full h-full rounded-md flex overflow-hidden border ${isLight ? 'border-slate-200 bg-white' : 'border-white/10 bg-white/5'}`}>
            <div className={`w-1/2 h-full border-r ${isLight ? 'border-slate-150' : 'border-white/10'}`}>
              {renderSingleFrameAsset(layer.data.assetUrl, layer.data.assetIsVideo, 'Front')}
            </div>
            <div className="w-1/2 h-full">
              {renderSingleFrameAsset(layer.data.backAssetUrl, layer.data.backAssetIsVideo, 'Back')}
            </div>
          </div>
        )
      }

      // Standard frame (non-card) with asset
      return (
        <div className={`w-full h-full rounded-md overflow-hidden border ${isLight ? 'border-slate-200 bg-white' : 'border-white/10 bg-white/5'}`}>
          {renderSingleFrameAsset(layer.data.assetUrl, layer.data.assetIsVideo, '')}
        </div>
      )
    }

    // ── BACKGROUND ────────────────────────────────────────────────────────────
    if (layer.type === LAYER_TYPES.BACKGROUND) {
      const color = typeof layer.data?.color === 'number'
        ? '#' + layer.data.color.toString(16).padStart(6, '0')
        : (layer.data?.color || (isLight ? '#ffffff' : '#000000'))
      return <div className={`w-full h-full rounded-md border ${isLight ? 'border-slate-200' : 'border-white/10'}`} style={{ backgroundColor: color }} />
    }

    return (
      <div className={`w-full h-full rounded-md flex items-center justify-center text-[10px] font-bold ${isLight ? 'bg-slate-100 border border-slate-200 text-slate-500' : 'bg-white/10 border border-white/10 text-white/50'}`}>
        {(layer.type || 'L').charAt(0).toUpperCase()}
      </div>
    )
  }

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 1024

  return (
    <div
      className="flex flex-col h-full relative transition-all duration-300 pointer-events-auto"
      style={{
        width: isMobile ? '100%' : '320px',
        backgroundColor: isMobile ? 'transparent' : (isLight ? '#f3f4f7' : '#090a0d'),
        backdropFilter: isMobile ? 'none' : 'blur(20px)',
        WebkitBackdropFilter: isMobile ? 'none' : 'blur(20px)',
        borderRight: isMobile ? 'none' : `1px solid ${isLight ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.05)'}`,
      }}
    >
      {/* Header */}
      <div className={`hidden lg:block px-4 pt-4 pb-3 border-b flex-shrink-0 ${isLight ? 'border-black/5' : 'border-zinc-800/50'}`}>
        <div className="flex items-center justify-between">
          <div>
            <div className={`text-[10px] uppercase tracking-[0.2em] mb-0.5 ${isLight ? 'text-gray-500' : 'text-white/40'}`}>Layers</div>
            <h2 className={`text-lg font-semibold leading-tight ${isLight ? 'text-gray-900' : 'text-white'}`}>Position</h2>
          </div>
          {onClose && (
            <button onClick={onClose} className={`transition-colors p-1 rounded-md ${isLight ? 'text-gray-400 hover:text-gray-900 hover:bg-gray-100' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`}>
              <X className="h-4 w-4" strokeWidth={1.5} />
            </button>
          )}
        </div>
      </div>

      {/* Card list */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto px-3 py-3 space-y-1.5 scroll-smooth"
      >
        {frontToBack.length === 0 && (
          <div className={`text-sm px-3 py-6 rounded-xl border border-dashed text-center leading-relaxed ${isLight ? 'border-slate-200 text-slate-400 bg-white shadow-sm' : 'border-white/10 text-white/50 animate-pulse'}`}>
            Add elements to start reordering.<br />
            <span className={`text-[11px] mt-1 block ${isLight ? 'text-slate-300' : 'text-white/30'}`}>Background is always at the bottom</span>
          </div>
        )}

        {frontToBack.map((layer) => {
          const isSelected = selectedLayerId === layer.id
          const isDragged = draggingId === layer.id
          const isOver = overId === layer.id

          const color = layer.data?.color || layer.data?.fill || (isLight ? '#111827' : '#ffffff')
          const contrastBg = getContrastCardBg(color, isLight)

          return (
            <div
              key={layer.id}
              data-layer-id={layer.id}
              onPointerDown={(e) => handlePointerDown(e, layer.id)}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              className={[
                'group flex items-center gap-2 px-2 rounded-lg border transition-all select-none cursor-grab active:cursor-grabbing',
                isSelected
                  ? isLight ? 'border-purple-500 bg-purple-500/10' : 'border-purple-500/60 bg-purple-500/10 shadow-[0_0_0_1px_rgba(168,85,247,0.15)]'
                  : isLight ? 'border-gray-200 bg-white hover:border-purple-300 hover:bg-purple-50/10' : 'border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/[0.07]',
                isDragged ? isLight ? 'opacity-40 scale-[0.98] border-dashed border-purple-400/50' : 'opacity-40 scale-[0.98] border-dashed border-purple-500/40' : '',
                isOver ? isLight ? 'border-purple-400 bg-purple-50/80 scale-[1.01] translate-y-0.5' : 'border-purple-400/70 bg-purple-500/15 scale-[1.01] translate-y-0.5' : '',
              ].join(' ')}
              style={{ 
                height: '56px', 
                touchAction: 'none'
              }}
            >
              {/* Grip */}
              <div 
                className={`transition-colors flex-shrink-0 cursor-grab active:cursor-grabbing ${isLight ? 'text-slate-300 group-hover:text-slate-500' : 'text-white/25 group-hover:text-white/55'}`}
              >
                <GripVertical className="h-4 w-4" />
              </div>

              {/* Preview — centered, fills remaining width */}
              <div className="flex-1 h-10 overflow-hidden" style={{ pointerEvents: 'none' }}>
                {renderPreview(layer)}
              </div>
            </div>
          )
        })}

        {/* Locked background row — no onClick, no drag */}
        {backgroundLayer && (
          <div
            className={`flex items-center gap-2 px-2 rounded-lg border border-dashed mt-1 ${isLight ? 'border-slate-200 bg-slate-50/50' : 'border-white/10 bg-white/[0.03]'}`}
            style={{ height: '56px' }}
            title="Canvas background — cannot be reordered"
          >
            <div className={`flex-shrink-0 ${isLight ? 'text-slate-200' : 'text-white/12'}`}>
              <GripVertical className="h-4 w-4" />
            </div>
            <div className="flex-1 h-10 overflow-hidden opacity-50">
              {renderPreview(backgroundLayer)}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default PositionPanel
