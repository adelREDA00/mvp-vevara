import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { X, Search, Upload as UploadIcon, Image, Video, File, Trash2, AlertCircle, Film, RefreshCw, Loader2 } from 'lucide-react'
import { DragToCloseHandle } from './DragToCloseHandle'
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
} from '../../../store/slices/uploadsSlice'

// NEW: Added imports for creating image layers on the canvas
import { addLayerAndSelect, selectCurrentSceneId, selectLayers } from '../../../store/slices/projectSlice'

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
    Array.from(files).forEach(file => dispatch(uploadFile(file)))
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

      <div className="px-4 pt-4 pb-3 border-b border-zinc-800/50">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-white">Uploads</h2>
          {onClose && (
            <button onClick={onClose} className="text-zinc-400 hover:text-white p-1 rounded-md hover:bg-zinc-800">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {isAuthenticated ? (
          <>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-zinc-500" />
              <input
                type="text"
                placeholder="Search uploads"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-white text-sm"
              />
            </div>

            <button
              onClick={handleUploadClick}
              disabled={isUploading}
              className="w-full mt-3 px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium flex items-center justify-center gap-2"
            >
              {isUploading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <UploadIcon className="h-4 w-4" />
                  Upload Files
                </>
              )}
            </button>
            <input ref={fileInputRef} type="file" multiple accept="image/*,video/*" onChange={handleFileInputChange} className="hidden" />
          </>
        ) : (
          <div className="py-8 px-4 text-center bg-gradient-to-b from-purple-500/10 to-transparent rounded-2xl border border-purple-500/20 mb-2">
            <div className="w-12 h-12 bg-purple-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <UploadIcon className="h-6 w-6 text-purple-400" />
            </div>
            <h3 className="text-white font-semibold mb-2">Want to upload?</h3>
            <p className="text-zinc-400 text-xs mb-4 leading-relaxed">
              Open account to upload your own assets and use premium templates.
            </p>
            <button
              onClick={() => window.location.href = '/login'}
              className="w-full py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium transition-all shadow-lg shadow-purple-500/25"
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

          <div className="flex border-b border-zinc-800/50 px-4">
            {['All', 'Images', 'Videos'].map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-3 text-sm font-medium relative ${activeTab === tab ? 'text-purple-400' : 'text-zinc-400'}`}
              >
                {tab} ({tab === 'All' ? totalCount : tab === 'Images' ? imageCount : videoCount})
                {activeTab === tab && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-purple-400" />}
              </button>
            ))}
          </div>

          <div
            className={`flex-1 overflow-y-auto p-4 custom-scrollbar ${isDragOver ? 'bg-purple-500/10 border-2 border-dashed border-purple-400' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {isUploading && (
              <div className="mb-4 p-4 rounded-xl bg-purple-500/10 border border-purple-500/20">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-purple-400">
                    {hasLargeUpload ? 'Uploading large files...' : 'Processing media...'}
                  </span>
                  <div className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse" />
                </div>
                <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden mb-2">
                  <div className="h-full bg-purple-500 animate-[progress_2s_ease-in-out_infinite]" style={{ width: '40%' }} />
                </div>
                {hasLargeUpload && (
                  <p className="text-[10px] text-zinc-400 leading-tight">
                    This file is large and may take some time. Please don't leave the page.
                  </p>
                )}
              </div>
            )}

            {/* Loading skeleton */}
            {isFetching && !uploadedImages.length ? (
              <SkeletonGrid />
            ) : filteredImages.length === 0 ? (
              <div className="h-48 flex flex-col items-center justify-center text-center opacity-40">
                <UploadIcon className="h-8 w-8 mb-3 text-zinc-600" />
                <p className="text-sm text-zinc-500">
                  {searchQuery ? 'No matching media' : 'Drop files here or click Upload'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {filteredImages.map((image) => {
                  const isProcessing = isUploading && image.id === lastUploadedId
                  const isDeleting = deletingId === image.id
                  const isVideo = image.metadata?.type?.startsWith('video/')

                  return (
                    <div
                      key={image.id}
                      className={`group relative aspect-square rounded-xl overflow-hidden bg-white/5 border border-white/10 transition-all ${isProcessing || isDeleting
                        ? 'opacity-50 cursor-not-allowed'
                        : 'cursor-pointer hover:border-purple-500/50'
                        }`}
                      onClick={() => !isProcessing && !isDeleting && handleAddImageLayer(image)}
                    >
                      {isVideo ? (
                        <div className="w-full h-full relative">
                          {image.metadata?.thumbnail ? (
                            <img src={image.metadata.thumbnail} className="w-full h-full object-cover" alt="" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center bg-zinc-900"><Film className="w-6 h-6 text-white/20" /></div>
                          )}
                          <div className="absolute top-2 right-2 px-1 py-0.5 rounded bg-black/60 text-[8px] font-bold text-white tracking-widest">VIDEO</div>
                        </div>
                      ) : (
                        <img
                          src={image.url}
                          className="w-full h-full object-cover"
                          alt=""
                          onError={(e) => {
                            // Show placeholder for broken images
                            e.target.onerror = null
                            e.target.style.display = 'none'
                            e.target.parentElement.classList.add('flex', 'items-center', 'justify-center')
                            const icon = document.createElement('div')
                            icon.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="text-white/20"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>'
                            e.target.parentElement.appendChild(icon)
                          }}
                        />
                      )}

                      {!isProcessing && !isDeleting && (
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <button
                            onClick={(e) => handleDeleteImage(image.id, e)}
                            className="p-2 bg-red-500/80 hover:bg-red-500 rounded-full text-white"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      )}

                      {isDeleting && (
                        <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                          <Loader2 className="h-5 w-5 text-white animate-spin" />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

export default UploadsPanel
