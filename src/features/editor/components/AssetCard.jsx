import { Trash2, Film, Loader2, Check } from 'lucide-react'
import { useSelector } from 'react-redux'
import { selectIsAssetPreparing } from '../../../store/slices/projectSlice'

export function AssetCard({ 
  image, 
  isUploading: isLegacyUploading, 
  deletingId, 
  onDelete, 
  onAdd,
  isSelected,
  onToggleSelect
}) {
  const assetUrl = image.url || image.src
  const isPreparing = useSelector(state => selectIsAssetPreparing(state, assetUrl))
  const assetId = image.id || image._id
  const isDeleting = deletingId != null && deletingId === assetId
  const isVideo = image.metadata?.type?.startsWith('video/') || image.type === 'video'

  const { status, progress, error, name } = image
  const isPending = status === 'pending'
  const isUploading = status === 'uploading' || isLegacyUploading
  const isFailed = status === 'failed'

  const isDisabled = isUploading || isDeleting || isPreparing || isPending || isFailed

  return (
    <div
      className={`group relative aspect-square rounded-xl overflow-hidden bg-white/5 border transition-all ${
        isSelected ? 'border-[#7c4af0] shadow-[0_0_12px_rgba(124,74,240,0.3)]' : 'border-white/10'
      } ${isDisabled
        ? 'opacity-40 cursor-not-allowed'
        : 'cursor-pointer hover:border-purple-500/50'
        }`}
      onClick={(e) => {
        if (isDisabled) return
        // If clicking the top area, toggle selection
        onAdd(image)
      }}
      draggable={!isDisabled}
      onDragStart={(e) => {
        if (isDisabled) { e.preventDefault(); return }
        e.dataTransfer.setData('application/vevara-asset', JSON.stringify({
          url: assetUrl,
          width: image.metadata?.width || 300,
          height: image.metadata?.height || 200,
          type: isVideo ? 'video' : 'image',
        }))
        e.dataTransfer.effectAllowed = 'copy'
      }}
    >
      {/* Thumbnail / Placeholder */}
      {isVideo ? (
        <div className="w-full h-full relative">
          {image.metadata?.thumbnail || image.thumbnail ? (
            <img src={image.metadata?.thumbnail || image.thumbnail} className="w-full h-full object-cover" alt="" />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-zinc-900">
              <Film className="w-6 h-6 text-white/20" />
            </div>
          )}
          {!isDisabled && <div className="absolute top-2 right-2 px-1 py-0.5 rounded bg-black/60 text-[8px] font-bold text-white tracking-widest">VIDEO</div>}
        </div>
      ) : (
        <div className="w-full h-full bg-zinc-900 flex items-center justify-center overflow-hidden">
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
               <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center">
                  {isVideo ? <Film className="w-4 h-4 text-white/40" /> : <Loader2 className="w-4 h-4 text-white/40 animate-pulse" />}
               </div>
               <span className="text-[9px] text-white/40 font-medium truncate w-full px-2">{name}</span>
            </div>
          )}
        </div>
      )}

      {/* Selection Checkbox (Top-Left) */}
      {!isDisabled && (
        <div 
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
                    className="text-white/10"
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
}
