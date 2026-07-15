import React, { useContext, useRef, useCallback } from 'react'
import { Trash2, Film, Loader2, Check, Music, Play, Pause } from 'lucide-react'
import { useSelector } from 'react-redux'
import { ThemeContext } from '../../../app/context/ThemeContext'
import { selectIsAssetPreparing } from '../../../store/slices/projectSlice'

export const AssetCard = React.memo(function AssetCard({ 
  image, 
  isUploading: isLegacyUploading, 
  deletingId, 
  onDelete, 
  onAdd,
  isSelected,
  onToggleSelect,
  isPlaying,
  onPlayPause,
  isSelectionMode = false
}) {
  const assetUrl = image.url || image.src
  const isPreparing = useSelector(state => selectIsAssetPreparing(state, assetUrl))
  const assetId = image.id || image._id
  const isDeleting = deletingId != null && deletingId === assetId
  const isVideo = image.metadata?.type?.startsWith('video/') || image.type === 'video'
  const isAudio = image.metadata?.type?.startsWith('audio/') || image.assetType === 'audio'

  const { status, progress, error, name } = image
  const isPending = status === 'pending'
  const isUploading = status === 'uploading' || isLegacyUploading
  const isFailed = status === 'failed'

  const { theme } = useContext(ThemeContext)
  const isLight = theme === 'light'

  const isDisabled = isUploading || isDeleting || isPreparing || isPending || isFailed

  const dragInfoRef = useRef({
    isDown: false,
    startX: 0,
    startY: 0,
    offsetX: 0,
    offsetY: 0,
    ghostEl: null,
    hasStarted: false,
    cardEl: null,
  })

  const handlePointerDown = useCallback((e) => {
    if (isDisabled) return
    if (e.button !== 0 && e.pointerType === 'mouse') return
    if (e.target.closest('button') || e.target.closest('[data-prevent-drag="true"]')) return

    const cardEl = e.currentTarget
    const rect = cardEl.getBoundingClientRect()

    dragInfoRef.current = {
      isDown: true,
      startX: e.clientX,
      startY: e.clientY,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      ghostEl: null,
      hasStarted: false,
      cardEl: cardEl,
    }

    if (e.pointerType !== 'touch') {
      cardEl.setPointerCapture(e.pointerId)
    }
  }, [isDisabled])

  const handlePointerMove = useCallback((e) => {
    if (e.pointerType === 'touch') return

    const info = dragInfoRef.current
    if (!info.isDown) return

    if (!info.hasStarted) {
      const dist = Math.hypot(e.clientX - info.startX, e.clientY - info.startY)
      if (dist > 5) {
        info.hasStarted = true

        const originalCard = info.cardEl
        if (originalCard) {
          const rect = originalCard.getBoundingClientRect()
          const ghost = originalCard.cloneNode(true)
          
          ghost.style.cssText = [
            'position: fixed',
            'width: ' + rect.width + 'px',
            'height: ' + rect.height + 'px',
            'opacity: 0.85',
            'pointer-events: none',
            'z-index: 9999',
            'background: ' + (isLight ? '#ffffff' : '#0e0f12'),
            'border: 1px solid ' + (isLight ? '#e2e8f0' : 'rgba(255, 255, 255, 0.1)'),
            'border-radius: 12px',
            'left: ' + (e.clientX - info.offsetX) + 'px',
            'top: ' + (e.clientY - info.offsetY) + 'px',
            'transition: none',
            'overflow: hidden'
          ].join(';')
          document.body.appendChild(ghost)
          info.ghostEl = ghost
        }

        window.activeDraggedAsset = {
          id: image.id || image._id,
          url: assetUrl,
          width: image.metadata?.width || 300,
          height: image.metadata?.height || 200,
          type: isVideo ? 'video' : (isAudio ? 'audio' : 'image'),
          thumbnail: image.metadata?.thumbnail || image.thumbnail || null,
          name: image.name,
          duration: image.metadata?.duration || 0,
          waveform: image.metadata?.waveform || [],
          metadata: image.metadata || null
        }
      }
    }

    if (info.hasStarted && info.ghostEl) {
      info.ghostEl.style.left = (e.clientX - info.offsetX) + 'px'
      info.ghostEl.style.top = (e.clientY - info.offsetY) + 'px'

      window.dispatchEvent(new CustomEvent('asset-drag-move', {
        detail: { x: e.clientX, y: e.clientY }
      }))
    }
  }, [isLight, image, assetUrl, isVideo, isAudio])

  const handlePointerUp = useCallback((e) => {
    const info = dragInfoRef.current
    if (!info.isDown) return

    try {
      if (e.pointerType !== 'touch') {
        info.cardEl?.releasePointerCapture(e.pointerId)
      }
    } catch (err) {}

    if (info.ghostEl) {
      info.ghostEl.remove()
    }

    const wasDragging = info.hasStarted

    dragInfoRef.current = {
      isDown: false,
      startX: 0,
      startY: 0,
      offsetX: 0,
      offsetY: 0,
      ghostEl: null,
      hasStarted: false,
      cardEl: null,
    }

    if (wasDragging) {
      window.dispatchEvent(new CustomEvent('asset-drag-drop', {
        detail: { x: e.clientX, y: e.clientY }
      }))
      setTimeout(() => {
        window.activeDraggedAsset = null
      }, 0)
    } else {
      if (e.pointerType === 'touch') {
        const dist = Math.hypot(e.clientX - info.startX, e.clientY - info.startY)
        if (dist > 10) return
      }
      if (isSelectionMode && onToggleSelect) {
        onToggleSelect(image.id || image._id)
      } else {
        onAdd(image)
      }
    }
  }, [onAdd, image, isSelectionMode, onToggleSelect])

  if (isAudio) {
    const gradients = [
      'from-pink-500 to-rose-500',
      'from-purple-600 to-indigo-600',
      'from-amber-400 to-orange-500',
      'from-teal-400 to-cyan-500',
      'from-green-400 to-emerald-500'
    ]
    const gradIndex = Math.abs((name || '').charCodeAt(0) || 0) % gradients.length
    const gradientClass = gradients[gradIndex]

    return (
      <div
        className={`group relative aspect-square rounded-xl overflow-hidden border transition-all ${
          isSelected 
            ? 'border-[#7c4af0] shadow-[0_0_12px_rgba(124,74,240,0.3)]' 
            : (isLight ? 'border-slate-100 hover:border-slate-200' : 'border-white/10 hover:border-purple-500/50')
        } ${isDisabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {/* Gradient background with Music icon */}
        <div className={`absolute inset-0 bg-gradient-to-tr ${gradientClass} flex flex-col items-center justify-center p-3 text-center`}>
          <Music className="h-8 w-8 text-white/50 mb-1" />
          <span className="text-[10px] font-semibold text-white/90 truncate w-full px-1">{name || 'Audio'}</span>
          <span className="text-[9px] text-white/60 mt-0.5">{image.metadata?.duration ? `${Math.round(image.metadata.duration)}s` : ''}</span>
        </div>

        {/* Centered play button overlay */}
        {!isDisabled && (
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              data-audio-preview-btn
              onClick={(e) => {
                e.stopPropagation()
                onPlayPause?.(image, e)
              }}
              className="w-10 h-10 rounded-full bg-white text-black flex items-center justify-center shadow-lg hover:scale-105 active:scale-95 transition-all"
            >
              {isPlaying ? (
                <Pause className="h-5 w-5 fill-black text-black" />
              ) : (
                <Play className="h-5 w-5 fill-black text-black ml-0.5" />
              )}
            </button>
          </div>
        )}

        {/* Selection Checkbox (Top-Left) */}
        {!isDisabled && (
          <div 
            data-prevent-drag="true"
            className={`absolute top-2.5 left-2.5 w-5 h-5 rounded-md border text-white flex items-center justify-center transition-all z-10 ${
              isSelected 
                ? 'bg-[#7c4af0] border-[#7c4af0]' 
                : 'bg-black/40 border-white/20 opacity-0 group-hover:opacity-100'
            }`}
            onClick={(e) => {
              e.stopPropagation()
              onToggleSelect(image.id)
            }}
          >
            {isSelected && <Check className="h-3.5 w-3.5 stroke-[3]" />}
          </div>
        )}

        {/* Delete Icon (Top-Right) */}
        {!isDisabled && onDelete && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onDelete(image.id, e)
            }}
            className="absolute top-2.5 right-2.5 p-1.5 bg-red-500/80 hover:bg-red-500 rounded-md text-white opacity-0 group-hover:opacity-100 transition-all z-10 shadow-lg"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    )
  }

  return (
    <div
      className={`group relative aspect-square rounded-xl overflow-hidden border transition-all ${
        isLight ? 'bg-slate-50' : 'bg-white/5'
      } ${
        isSelected 
          ? 'border-[#7c4af0] shadow-[0_0_12px_rgba(124,74,240,0.3)]' 
          : (isLight ? 'border-slate-100 hover:border-slate-200' : 'border-white/10 hover:border-purple-500/50')
      } ${isDisabled
        ? 'opacity-40 cursor-not-allowed'
        : 'cursor-pointer'
        }`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {/* Thumbnail / Placeholder */}
      {isVideo ? (
        <div className="w-full h-full relative">
          {image.metadata?.thumbnail || image.thumbnail ? (
            <img src={image.metadata?.thumbnail || image.thumbnail} className="w-full h-full object-cover" alt="" />
          ) : (
            <div className={`w-full h-full flex items-center justify-center ${isLight ? 'bg-slate-200' : 'bg-zinc-900'}`}>
              <Film className={`w-6 h-6 ${isLight ? 'text-slate-400' : 'text-white/20'}`} />
            </div>
          )}
          {!isDisabled && <div className="absolute top-2 right-2 px-1 py-0.5 rounded bg-black/60 text-[8px] font-bold text-white tracking-widest">VIDEO</div>}
        </div>
      ) : (
        <div className={`w-full h-full flex items-center justify-center overflow-hidden ${isLight ? 'bg-slate-200' : 'bg-zinc-900'}`}>
          {assetUrl ? (
            <img
              src={image.metadata?.thumbnail || image.thumbnail || assetUrl}
              className="w-full h-full object-cover"
              alt=""
              onError={(e) => {
                e.target.onerror = null
                e.target.style.display = 'none'
                const icon = document.createElement('div')
                icon.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="text-white/20"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>'
                e.target.parentElement.appendChild(icon)
              }}
            />
          ) : (
            <div className="flex flex-col items-center gap-2 p-4 text-center">
               <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isLight ? 'bg-black/5' : 'bg-white/5'}`}>
                  {isVideo ? <Film className={`w-4 h-4 ${isLight ? 'text-slate-400' : 'text-white/40'}`} /> : <Loader2 className={`w-4 h-4 animate-pulse ${isLight ? 'text-slate-400' : 'text-white/40'}`} />}
               </div>
               <span className={`text-[9px] font-medium truncate w-full px-2 ${isLight ? 'text-slate-500' : 'text-white/40'}`}>{name}</span>
            </div>
          )}
        </div>
      )}

      {/* Selection Checkbox (Top-Left) */}
      {!isDisabled && (
        <div 
          data-prevent-drag="true"
          className={`absolute top-2.5 left-2.5 w-5 h-5 rounded-md border text-white flex items-center justify-center transition-all z-10 ${
            isSelected 
              ? 'bg-[#7c4af0] border-[#7c4af0]' 
              : 'bg-black/40 border-white/20 opacity-0 group-hover:opacity-100'
          }`}
          onClick={(e) => {
            e.stopPropagation()
            onToggleSelect(image.id)
          }}
        >
          {isSelected && <Check className="h-3.5 w-3.5 stroke-[3]" />}
        </div>
      )}

      {/* Delete Icon (Top-Right) */}
      {!isDisabled && onDelete && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onDelete(image.id, e)
          }}
          className="absolute top-2.5 right-2.5 p-1.5 bg-red-500/80 hover:bg-red-500 rounded-md text-white opacity-0 group-hover:opacity-100 transition-all z-10 shadow-lg"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}

      {/* States Overlays */}
      {isPreparing && (
        <div className="absolute inset-0 bg-purple-500/20 backdrop-blur-[2px] flex flex-col items-center justify-center gap-2">
          <Loader2 className="h-6 w-6 text-purple-400 animate-spin" />
          <span className="text-[10px] font-bold text-purple-300 uppercase tracking-widest">Adding...</span>
        </div>
      )}

      {isDeleting && (
        <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
          <Loader2 className="h-5 w-5 text-white animate-spin" />
        </div>
      )}

      {/* NEW: Batch Upload States */}
      {(isPending || isUploading) && (
        <div className="absolute inset-0 bg-black/70 backdrop-blur-[1px] flex flex-col items-center justify-center p-3 text-center">
          {isUploading ? (
            <>
              <div className="relative w-10 h-10 mb-2">
                <svg className="w-full h-full transform -rotate-90">
                  <circle
                    className={isLight ? 'text-black/5' : 'text-white/10'}
                    strokeWidth="3"
                    stroke="currentColor"
                    fill="transparent"
                    r="16"
                    cx="20"
                    cy="20"
                  />
                  <circle
                    className="text-[#7c4af0] transition-all duration-300"
                    strokeWidth="3"
                    strokeDasharray={100}
                    strokeDashoffset={100 - (progress || 0)}
                    strokeLinecap="round"
                    stroke="currentColor"
                    fill="transparent"
                    r="16"
                    cx="20"
                    cy="20"
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-[9px] font-bold text-white">{progress}%</span>
                </div>
              </div>
              <span className="text-[10px] font-semibold text-white/60 tracking-tight uppercase">Uploading...</span>
            </>
          ) : (
            <>
              <div className="w-8 h-8 rounded-full border-2 border-dashed border-white/20 animate-[spin_4s_linear_infinite] mb-2" />
              <span className="text-[10px] font-semibold text-white/40 tracking-tight uppercase">Waiting...</span>
            </>
          )}
        </div>
      )}

      {isFailed && (
        <div className="absolute inset-0 bg-red-900/40 backdrop-blur-[2px] flex flex-col items-center justify-center p-3 text-center">
          <div className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center mb-2">
            <Trash2 className="w-4 h-4 text-red-400" />
          </div>
          <span className="text-[9px] font-bold text-red-200 uppercase tracking-widest mb-1">Failed</span>
          <p className="text-[8px] text-red-200/60 line-clamp-2 px-1">{error || 'Network error'}</p>
        </div>
      )}
    </div>
  )
})
