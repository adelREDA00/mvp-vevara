import { Trash2, Film, Loader2 } from 'lucide-react'
import { useSelector } from 'react-redux'
import { selectIsAssetPreparing } from '../../../store/slices/projectSlice'

export function AssetCard({ image, isUploading, deletingId, onDelete, onAdd }) {
  const isPreparing = useSelector(state => selectIsAssetPreparing(state, image.url))
  const isDeleting = deletingId === image.id
  const isVideo = image.metadata?.type?.startsWith('video/') || image.type === 'video'

  const isDisabled = isUploading || isDeleting || isPreparing

  return (
    <div
      className={`group relative aspect-square rounded-xl overflow-hidden bg-white/5 border border-white/10 transition-all ${isDisabled
        ? 'opacity-60 cursor-not-allowed'
        : 'cursor-pointer hover:border-purple-500/50'
        }`}
      onClick={() => !isDisabled && onAdd(image)}
    >
      {isVideo ? (
        <div className="w-full h-full relative">
          {image.metadata?.thumbnail ? (
            <img src={image.metadata.thumbnail} className="w-full h-full object-cover" alt="" />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-zinc-900">
              <Film className="w-6 h-6 text-white/20" />
            </div>
          )}
          <div className="absolute top-2 right-2 px-1 py-0.5 rounded bg-black/60 text-[8px] font-bold text-white tracking-widest">VIDEO</div>
        </div>
      ) : (
        <img
          src={image.metadata?.thumbnail || image.url}
          className="w-full h-full object-cover"
          alt=""
          onError={(e) => {
            e.target.onerror = null
            e.target.style.display = 'none'
            e.target.parentElement.classList.add('flex', 'items-center', 'justify-center')
            const icon = document.createElement('div')
            icon.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="text-white/20"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>'
            e.target.parentElement.appendChild(icon)
          }}
        />
      )}

      {/* Hover Actions (Delete) */}
      {!isDisabled && (
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          {onDelete && (
            <button
              onClick={(e) => onDelete(image.id, e)}
              className="p-2 bg-red-500/80 hover:bg-red-500 rounded-full text-white transition-transform hover:scale-110"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      )}

      {/* Preparing Overlay (Adding to Canvas Spinner) */}
      {isPreparing && (
        <div className="absolute inset-0 bg-purple-500/20 backdrop-blur-[2px] flex flex-col items-center justify-center gap-2">
          <Loader2 className="h-6 w-6 text-purple-400 animate-spin" />
          <span className="text-[10px] font-bold text-purple-300 uppercase tracking-widest">Adding...</span>
        </div>
      )}

      {/* Deleting Overlay */}
      {isDeleting && (
        <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
          <Loader2 className="h-5 w-5 text-white animate-spin" />
        </div>
      )}

      {/* Uploading Overlay */}
      {isUploading && (
        <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
           <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
        </div>
      )}
    </div>
  )
}
