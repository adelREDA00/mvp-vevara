import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { X, Search, Upload as UploadIcon, Image, Video, File, Trash2, AlertCircle, Film, RefreshCw, Loader2 } from 'lucide-react'
import { DragToCloseHandle } from './DragToCloseHandle'
import { AssetCard } from './AssetCard'
import {
  selectUploadedImagesArray,
  selectIsUploading,
  selectIsFetching,
  selectUploadError,
  selectFetchError,
  selectImageCount,
  selectVideoCount,
  selectTotalCount,
  uploadFile,
  deleteUpload,
  clearUploadError,
  clearFetchError,
  fetchUploads,
  selectLastUploadedId,
  selectHasLargeUpload,
  selectUploadProgress,
  cancelUpload,
} from '../../../store/slices/uploadsSlice'

// NEW: Added imports for creating image layers on the canvas
import { addLayerAndSelect, selectCurrentSceneId, selectLayers, selectIsAssetPreparing } from '../../../store/slices/projectSlice'

// Utility functions
const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

const formatDimensions = (width, height) => {
  if (!width || !height) return ''
  return `${width} × ${height}`
}

// Skeleton shimmer component for loading state
function SkeletonGrid() {
  return (
    <div className="grid grid-cols-2 gap-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="aspect-square rounded-xl bg-white/5 overflow-hidden relative"
        >
          <div
            className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent animate-[shimmer_1.5s_ease-in-out_infinite]"
            style={{ transform: 'translateX(-100%)', animation: `shimmer 1.5s ease-in-out infinite ${i * 200}ms` }}
          />
        </div>
      ))}
      <style>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
    </div>
  )
}

function UploadsPanel({ onClose, aspectRatio }) {
  const dispatch = useDispatch()
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState('All')
  const [width, setWidth] = useState(320)
  const [isDragOver, setIsDragOver] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const fileInputRef = useRef(null)

  const uploadedImages = useSelector(selectUploadedImagesArray)
  const isUploading = useSelector(selectIsUploading)
  const isFetching = useSelector(selectIsFetching)
  const uploadError = useSelector(selectUploadError)
  const fetchError = useSelector(selectFetchError)
  const lastUploadedId = useSelector(selectLastUploadedId)
  const totalCount = useSelector(selectTotalCount)
  const imageCount = useSelector(selectImageCount)
  const videoCount = useSelector(selectVideoCount)
  const hasLargeUpload = useSelector(selectHasLargeUpload)
  const uploadProgress = useSelector(selectUploadProgress)
  const currentSceneId = useSelector(selectCurrentSceneId)
  const allLayers = useSelector(selectLayers)

  const getCurrentAspectRatio = () => aspectRatio || '16:9'

  const getWorldDimensions = () => {
    const ar = getCurrentAspectRatio()
    const [widthRatio, heightRatio] = ar.split(':').map(Number)
    const aspectRatioValue = widthRatio / heightRatio

    if (aspectRatioValue >= 1) {
      const baseHeight = 1080
      const worldWidth = Math.round(baseHeight * aspectRatioValue)
      return { worldWidth, worldHeight: 1080 }
    } else {
      const baseWidth = 1080
      const worldHeight = Math.round(baseWidth / aspectRatioValue)
      return { worldWidth: 1080, worldHeight }
    }
  }

  const { worldWidth, worldHeight } = getWorldDimensions()

  useEffect(() => {
    dispatch(fetchUploads())
  }, [dispatch])

  const filteredImages = useMemo(() => {
    if (!uploadedImages.length) return []
    return uploadedImages.filter(image => {
      const matchesSearch = searchQuery === '' || image.name.toLowerCase().includes(searchQuery.toLowerCase())
      const matchesTab = activeTab === 'All' ||
        (activeTab === 'Images' && image.metadata?.type?.startsWith('image/')) ||
        (activeTab === 'Videos' && image.metadata?.type?.startsWith('video/'))
      return matchesSearch && matchesTab
    })
  }, [uploadedImages, searchQuery, activeTab])

  const handleFileSelect = useCallback((files) => {
    if (!files || files.length === 0) return
    const file = files[0] // Support single upload for simplicity or iterate
    dispatch(uploadFile(file))
  }, [dispatch])

  const handleFileInputChange = useCallback((e) => {
    handleFileSelect(e.target.files)
    e.target.value = ''
  }, [handleFileSelect])

  const handleUploadClick = () => fileInputRef.current?.click()
  const handleDragOver = (e) => { e.preventDefault(); setIsDragOver(true) }
  const handleDragLeave = (e) => { e.preventDefault(); setIsDragOver(false) }
  const handleDrop = (e) => { e.preventDefault(); setIsDragOver(false); handleFileSelect(e.dataTransfer.files) }

  // Check if an asset is used by any layer in the project
  const isAssetInUse = useCallback((assetUrl) => {
    return Object.values(allLayers).some(layer => {
      const layerUrl = layer.data?.url || layer.data?.src
      return layerUrl && (layerUrl === assetUrl || layerUrl.endsWith(assetUrl?.split('/').pop()))
    })
  }, [allLayers])

  const handleDeleteImage = useCallback((imageId, e) => {
    e.stopPropagation()
    const image = uploadedImages.find(img => img.id === imageId)
    if (!image) return

    const inUse = isAssetInUse(image.url)
    if (inUse) {
      const confirmed = window.confirm(
        'This asset is currently used in your project. Deleting it will cause affected layers to show a placeholder. Continue?'
      )
      if (!confirmed) return
    }

    setDeletingId(imageId)
    dispatch(deleteUpload(imageId)).finally(() => setDeletingId(null))
  }, [dispatch, uploadedImages, isAssetInUse])

  const handleClearError = () => dispatch(clearUploadError())
  const handleRetryFetch = () => { dispatch(clearFetchError()); dispatch(fetchUploads()) }

  const handleAddImageLayer = useCallback((image) => {
    if (!currentSceneId) return
    const imageWidth = image.metadata?.width || 300
    const imageHeight = image.metadata?.height || 200
    const maxSize = 400
    let finalWidth = imageWidth
    let finalHeight = imageHeight

    if (finalWidth > maxSize || finalHeight > maxSize) {
      const scale = maxSize / Math.max(finalWidth, finalHeight)
      finalWidth *= scale
      finalHeight *= scale
    }

    const isVideo = image.metadata?.type?.startsWith('video/')

    dispatch(addLayerAndSelect({
      sceneId: currentSceneId,
      type: isVideo ? 'video' : 'image',
      name: image.name || (isVideo ? 'Video' : 'Image'),
      x: worldWidth / 2,
      y: worldHeight / 2,
      width: finalWidth,
      height: finalHeight,
      anchorX: 0.5,
      anchorY: 0.5,
      mediaWidth: imageWidth,
      mediaHeight: imageHeight,
      data: {
        url: image.url,
        src: image.url,
        ...(image.metadata || {}),
        // For videos, include duration for proper scene timing
        ...(isVideo && image.metadata?.duration ? { duration: image.metadata.duration } : {}),
      }
    }))
  }, [dispatch, currentSceneId, worldWidth, worldHeight])

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 1024
  const { isAuthenticated } = useSelector((state) => state.auth)

  return (
    <div
      className="flex flex-col h-full relative transition-all duration-300"
      style={{
        width: isMobile ? '100%' : `${width}px`,
        backgroundColor: isMobile ? 'transparent' : '#0f1015',
        backdropFilter: isMobile ? 'none' : 'blur(20px)',
        WebkitBackdropFilter: isMobile ? 'none' : 'blur(20px)',
        borderRight: isMobile ? 'none' : '1px solid rgba(255, 255, 255, 0.05)',
      }}
    >
      {!isMobile && <DragToCloseHandle onClose={onClose} onWidthChange={setWidth} initialWidth={width} minWidth={200} />}

      <div className="px-6 pt-6 pb-5 border-b border-white/5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[20px] font-semibold text-white tracking-tight">Uploads</h2>
          {onClose && (
            <button 
                onClick={onClose} 
                className="text-white/40 hover:text-white hover:bg-white/10 transition-all duration-300 p-2 rounded-[10px]"
            >
              <X className="h-5 w-5" strokeWidth={2} />
            </button>
          )}
        </div>

        {isAuthenticated ? (
          <>
            <div className="relative mb-4">
              <Search className="absolute left-3.5 top-1/2 transform -translate-y-1/2 h-4 w-4 text-zinc-500" strokeWidth={2} />
              <input
                type="text"
                placeholder="Search your uploads..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-[12px] text-white text-[14px] placeholder-zinc-600 focus:outline-none focus:border-white/20 focus:ring-1 focus:ring-white/20 transition-all"
              />
            </div>

            <button
              onClick={handleUploadClick}
              disabled={isUploading}
              className="w-full h-10 px-4 bg-[#7c4af0] hover:bg-[#6940c9] disabled:opacity-50 text-white rounded-[12px] text-[14px] font-semibold flex items-center justify-center gap-2 transition-all shadow-medium active:scale-[0.98]"
            >
              {isUploading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />
                  Uploading...
                </>
              ) : (
                <>
                  <UploadIcon className="h-4 w-4" strokeWidth={2.5} />
                  Upload Files
                </>
              )}
            </button>
            <input ref={fileInputRef} type="file" multiple accept="image/*,video/*" onChange={handleFileInputChange} className="hidden" />
          </>
        ) : (
          <div className="py-8 px-5 text-center bg-white/5 rounded-[20px] border border-white/5 mb-2 shadow-small">
            <div className="w-14 h-14 bg-[#7c4af0]/10 rounded-full flex items-center justify-center mx-auto mb-5">
              <UploadIcon className="h-7 w-7 text-[#7c4af0]" strokeWidth={2} />
            </div>
            <h3 className="text-white text-[16px] font-semibold mb-2">Want to upload?</h3>
            <p className="text-white/40 text-[13px] mb-5 leading-relaxed">
              Create an account to upload your own assets and use premium templates.
            </p>
            <button
              onClick={() => window.location.href = '/login'}
              className="w-full py-2.5 bg-[#7c4af0] hover:bg-[#6940c9] text-white rounded-[12px] text-[14px] font-semibold transition-all shadow-medium active:scale-[0.98]"
            >
              Sign up for free
            </button>
          </div>
        )}
      </div>

      {isAuthenticated && (
        <>
          {/* Upload Error */}
          {uploadError && (
            <div className="mx-4 mt-2 p-3 bg-red-900/50 border border-red-700 rounded-lg flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-red-400 flex-shrink-0" />
              <p className="text-red-300 text-sm flex-1">{uploadError}</p>
              <button onClick={handleClearError} className="text-red-400 flex-shrink-0"><X className="h-4 w-4" /></button>
            </div>
          )}

          {/* Fetch Error */}
          {fetchError && (
            <div className="mx-4 mt-2 p-3 bg-red-900/50 border border-red-700 rounded-lg flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-red-400 flex-shrink-0" />
                <p className="text-red-300 text-sm flex-1">{fetchError}</p>
              </div>
              <button
                onClick={handleRetryFetch}
                className="self-end flex items-center gap-1.5 text-xs text-red-300 hover:text-white px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 rounded-md transition-colors"
              >
                <RefreshCw className="h-3 w-3" />
                Retry
              </button>
            </div>
          )}

          <div className="flex border-b border-white/5 px-6">
            {['All', 'Images', 'Videos'].map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-4 text-[13px] font-semibold tracking-wide relative transition-colors ${activeTab === tab ? 'text-[#7c4af0]' : 'text-zinc-500 hover:text-white'}`}
              >
                {tab} <span className="opacity-40 ml-1">{tab === 'All' ? totalCount : tab === 'Images' ? imageCount : videoCount}</span>
                {activeTab === tab && (
                  <div className="absolute bottom-0 left-2 right-2 h-[2px] bg-[#7c4af0] rounded-t-full" />
                )}
              </button>
            ))}
          </div>

          <div
            className={`flex-1 overflow-y-auto p-6 custom-scrollbar scrollbar-hide ${isDragOver ? 'bg-[#7c4af0]/5 border-2 border-dashed border-[#7c4af0]/30' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {isUploading && (
              <div className="mb-6 p-4 rounded-[16px] bg-white/5 border border-white/10 shadow-medium">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[12px] font-semibold text-[#7c4af0] tracking-tight">
                    {uploadProgress > 0 ? `Uploading... ${uploadProgress}%` : 'Processing...'}
                  </span>
                  <button
                    onClick={() => dispatch(cancelUpload())}
                    className="text-[10px] font-bold uppercase tracking-widest text-white/30 hover:text-red-400 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
                <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden mb-3">
                  <div
                    className={`h-full bg-[#7c4af0] transition-all duration-300 shadow-[0_0_8px_rgba(124,74,240,0.4)] ${uploadProgress === 0 ? 'animate-[progress_2s_ease-in-out_infinite]' : ''}`}
                    style={{ width: `${Math.max(uploadProgress, 10)}%` }}
                  />
                </div>
                {hasLargeUpload && uploadProgress < 100 && (
                  <p className="text-[11px] text-zinc-500 leading-normal">
                    Large file detected. This might take a few moments.
                  </p>
                )}
              </div>
            )}

            {/* Loading skeleton */}
            {isFetching && !uploadedImages.length ? (
              <SkeletonGrid />
            ) : filteredImages.length === 0 ? (
              <div className="h-64 flex flex-col items-center justify-center text-center">
                <div className="p-4 bg-white/5 rounded-full mb-4">
                  <UploadIcon className="h-8 w-8 text-zinc-600" />
                </div>
                <p className="text-[14px] text-zinc-500 font-medium">
                  {searchQuery ? 'No matching uploads' : 'Drop files here to start'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                {filteredImages.map((image) => (
                  <AssetCard
                    key={image.id}
                    image={image}
                    isUploading={isUploading && image.id === lastUploadedId}
                    deletingId={deletingId}
                    onDelete={handleDeleteImage}
                    onAdd={handleAddImageLayer}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

export default UploadsPanel
