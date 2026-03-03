import { useMemo, useState, useRef, useCallback } from 'react'
import { GripVertical, X, Film } from 'lucide-react'
import { DragToCloseHandle } from './DragToCloseHandle'
import { LAYER_TYPES } from '../../../store/models'

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
  const [panelWidth, setPanelWidth] = useState(320)
  const [overId, setOverId] = useState(null)

  const draggingIdRef = useRef(null)
  const [draggingId, setDraggingId] = useState(null)

  const setDragging = useCallback((id) => {
    draggingIdRef.current = id
    setDraggingId(id)
  }, [])

  // Custom drag ghost: clone the card so the image following the cursor shows the real layer preview
  const setDragGhost = useCallback((e, cardEl) => {
    if (!cardEl || !e.dataTransfer) return
    const rect = cardEl.getBoundingClientRect()
    const ghost = cardEl.cloneNode(true)
    ghost.style.cssText = [
      'position:fixed',
      'left:-9999px',
      'top:0',
      'width:' + rect.width + 'px',
      'height:' + rect.height + 'px',
      'opacity:1',
      'box-shadow:0 12px 28px rgba(0,0,0,0.5)',
      'pointer-events:none',
      'background:#1a1b20',
      'box-sizing:border-box',
    ].join(';')
    document.body.appendChild(ghost)
    const offsetX = e.clientX - rect.left
    const offsetY = e.clientY - rect.top
    e.dataTransfer.setDragImage(ghost, offsetX, offsetY)
    requestAnimationFrame(() => ghost.remove())
  }, [])

  const stack = useMemo(() => layers.filter(Boolean), [layers])

  const frontToBack = useMemo(() =>
    stack.filter(l => l.type !== LAYER_TYPES.BACKGROUND).slice().reverse(),
    [stack]
  )

  const backgroundLayer = useMemo(
    () => stack.find(l => l.type === LAYER_TYPES.BACKGROUND) || null,
    [stack]
  )

  const getDisplayIndex = (id) => frontToBack.findIndex(l => l.id === id)

  const stackIndexFromDisplayIndex = (di) => stack.length - 1 - di

  const handleDrop = useCallback((targetId) => {
    const from = draggingIdRef.current
    if (!from) return

    const fromDi = getDisplayIndex(from)
    const toDi = getDisplayIndex(targetId)

    setDragging(null)
    setOverId(null)

    if (fromDi === -1 || toDi === -1 || fromDi === toDi) return

    const fromIdx = stackIndexFromDisplayIndex(fromDi)
    const toIdx = stackIndexFromDisplayIndex(toDi)

    if (fromIdx <= 0 || toIdx <= 0) return

    onReorder?.(fromIdx, toIdx)
  }, [frontToBack, stack, onReorder, setDragging])

  const renderPreview = (layer) => {
    if (!layer) return null

    // ── IMAGE ────────────────────────────────────────────────────────────────
    if (layer.type === LAYER_TYPES.IMAGE) {
      const src = layer.data?.url || layer.data?.src
      return src
        ? <img src={src} alt="" className="w-full h-full object-cover rounded-md" />
        : <div className="w-full h-full rounded-md bg-gradient-to-br from-white/20 to-white/5" />
    }

    // ── VIDEO ─────────────────────────────────────────────────────────────────
    if (layer.type === LAYER_TYPES.VIDEO) {
      const thumb = layer.data?.thumbnail
      return (
        <div className="w-full h-full relative rounded-md overflow-hidden bg-zinc-900">
          {thumb
            ? <img src={thumb} alt="" className="w-full h-full object-cover" />
            : <div className="w-full h-full bg-zinc-900" />
          }
          <div className="absolute inset-0 flex items-center justify-center bg-black/30">
            <Film className="h-4 w-4 text-white/70" />
          </div>
        </div>
      )
    }

    // ── TEXT ──────────────────────────────────────────────────────────────────
    if (layer.type === LAYER_TYPES.TEXT) {
      const text = layer.data?.content || ''
      const color = layer.data?.color || '#ffffff'
      const fs = getTextFontSize(text)
      return (
        <div className="w-full h-full rounded-md bg-white/5 border border-white/10 flex items-center justify-center px-2 overflow-hidden">
          <span
            style={{ fontSize: fs, color, lineHeight: 1.2, wordBreak: 'break-all' }}
            className="text-center"
          >
            {text || <span className="text-white/30 italic">empty</span>}
          </span>
        </div>
      )
    }

    // ── SHAPE ─────────────────────────────────────────────────────────────────
    if (layer.type === LAYER_TYPES.SHAPE) {
      const fill = layer.data?.fill
      const shapeType = layer.data?.shapeType || 'rect'
      const fillColor = fill && fill !== 'transparent' ? fill : 'rgba(255,255,255,0.18)'

      if (shapeType === 'circle') {
        return (
          <div className="w-full h-full flex items-center justify-center">
            <div className="w-8 h-8 rounded-full border border-white/10" style={{ backgroundColor: fillColor }} />
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
      return <div className="w-full h-full rounded-md border border-white/10" style={{ backgroundColor: fillColor }} />
    }

    // ── BACKGROUND ────────────────────────────────────────────────────────────
    if (layer.type === LAYER_TYPES.BACKGROUND) {
      const color = typeof layer.data?.color === 'number'
        ? '#' + layer.data.color.toString(16).padStart(6, '0')
        : (layer.data?.color || '#ffffff')
      return <div className="w-full h-full rounded-md border border-white/10" style={{ backgroundColor: color }} />
    }

    return (
      <div className="w-full h-full rounded-md bg-white/10 border border-white/10 flex items-center justify-center text-[10px] text-white/50">
        {(layer.type || 'L').charAt(0).toUpperCase()}
      </div>
    )
  }

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 1024

  return (
    <div
      className="flex flex-col h-full relative transition-all duration-300 pointer-events-auto"
      style={{
        width: isMobile ? '100%' : `${panelWidth}px`,
        backgroundColor: isMobile ? 'transparent' : '#0f1015',
        backdropFilter: isMobile ? 'none' : 'blur(20px)',
        WebkitBackdropFilter: isMobile ? 'none' : 'blur(20px)',
        borderRight: isMobile ? 'none' : '1px solid rgba(255, 255, 255, 0.05)',
      }}
    >
      <DragToCloseHandle onClose={onClose} onWidthChange={setPanelWidth} initialWidth={panelWidth} minWidth={240} />

      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-zinc-800/50 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-white/40 mb-0.5">Layers</div>
            <h2 className="text-lg font-semibold text-white leading-tight">Position</h2>
          </div>
          {onClose && (
            <button onClick={onClose} className="text-zinc-400 hover:text-white transition-colors p-1 rounded-md hover:bg-zinc-800">
              <X className="h-4 w-4" strokeWidth={1.5} />
            </button>
          )}
        </div>
      </div>

      {/* Card list */}
      <div
        className="flex-1 overflow-y-auto px-3 py-3 space-y-1.5"
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation() }}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation() }}
      >
        {frontToBack.length === 0 && (
          <div className="text-sm text-white/50 px-3 py-4 rounded-lg border border-dashed border-white/10 text-center leading-relaxed">
            Add elements to start reordering.<br />
            <span className="text-white/30 text-xs">Background is always at the bottom.</span>
          </div>
        )}

        {frontToBack.map((layer) => {
          const isSelected = selectedLayerId === layer.id
          const isDragged = draggingId === layer.id
          const isOver = overId === layer.id

          return (
            <div
              key={layer.id}
              draggable
              onDragStart={(e) => {
                e.stopPropagation()
                setDragging(layer.id)
                e.dataTransfer.effectAllowed = 'move'
                setDragGhost(e, e.currentTarget)
              }}
              onDragOver={(e) => {
                e.preventDefault()
                e.stopPropagation()
                e.dataTransfer.dropEffect = 'move'
                if (draggingIdRef.current && draggingIdRef.current !== layer.id) {
                  setOverId(layer.id)
                }
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget)) setOverId(null)
              }}
              onDrop={(e) => {
                e.preventDefault()
                e.stopPropagation()
                handleDrop(layer.id)
              }}
              onDragEnd={() => {
                setDragging(null)
                setOverId(null)
              }}
              onClick={() => onSelectLayer?.(layer.id)}
              className={[
                'group flex items-center gap-2 px-2 rounded-lg border transition-all select-none cursor-grab active:cursor-grabbing',
                isSelected
                  ? 'border-purple-500/60 bg-purple-500/10 shadow-[0_0_0_1px_rgba(168,85,247,0.15)]'
                  : 'border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/[0.07]',
                isDragged ? 'opacity-90 scale-[0.98] ring-1 ring-white/20' : '',
                isOver ? 'border-purple-400/70 bg-purple-500/10 scale-[1.01]' : '',
              ].join(' ')}
              style={{ height: '56px' }}
            >
              {/* Grip */}
              <div className="text-white/25 group-hover:text-white/55 transition-colors flex-shrink-0">
                <GripVertical className="h-4 w-4" />
              </div>

              {/* Preview — centered, fills remaining width */}
              <div className="flex-1 h-10 overflow-hidden">
                {renderPreview(layer)}
              </div>
            </div>
          )
        })}

        {/* Locked background row — no onClick, no drag */}
        {backgroundLayer && (
          <div
            className="flex items-center gap-2 px-2 rounded-lg border border-dashed border-white/10 bg-white/[0.03] mt-1"
            style={{ height: '56px' }}
            title="Canvas background — cannot be reordered"
          >
            <div className="text-white/12 flex-shrink-0">
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
