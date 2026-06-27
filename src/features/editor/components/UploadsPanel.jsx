import { useState, useRef, useEffect, useMemo, useCallback, useContext } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { ThemeContext } from '../../../app/context/ThemeContext'
import { X, Search, Upload as UploadIcon, Image, Video, File, Trash2, AlertCircle, Film, RefreshCw, Loader2, Globe, Lock, Smile, Music } from 'lucide-react'
import { DragToCloseHandle } from './DragToCloseHandle'
import { AssetCard } from './AssetCard'
import {
  selectUploadedImagesArray,
  selectIsUploading,
  selectIsFetching,
  selectUploadError,
  selectFetchError,
  selectImageCount,
  selectIconCount,
  selectVideoCount,
  selectAudioCount,
  selectTotalCount,
  uploadFile,
  startBatchUpload,
  deleteUpload,
  clearUploadError,
  clearFetchError,
  fetchUploads,
  selectLastUploadedId,
  selectHasLargeUpload,
  selectUploadProgress,
  selectUploadQueueArray,
  cancelUpload,
} from '../../../store/slices/uploadsSlice'

import { addLayerAndSelect, addAudioTrack, selectCurrentSceneId, selectLayers, selectIsAssetPreparing } from '../../../store/slices/projectSlice'
import Modal from './Modal'
import { assetCacheWarmer } from '../../engine/pixi/textureUtils'

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
function SkeletonGrid({ isLight }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className={`aspect-square rounded-xl overflow-hidden relative ${isLight ? 'bg-black/5' : 'bg-white/5'}`}
        >
          <div
            className={`absolute inset-0 bg-gradient-to-r from-transparent to-transparent animate-[shimmer_1.5s_ease-in-out_infinite] ${isLight ? 'via-black/5' : 'via-white/5'}`}
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
  const [selectedIds, setSelectedIds] = useState([])
  const [activeTab, setActiveTab] = useState('All')
  const [isDragOver, setIsDragOver] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const [confirmModal, setConfirmModal] = useState({ isOpen: false, title: '', message: '', onConfirm: null })
  const [isPublic, setIsPublic] = useState(true)
  const [assetType, setAssetType] = useState('image')
  const fileInputRef = useRef(null)

  // Audio preview state
  const [playingTrackId, setPlayingTrackId] = useState(null)
  const previewAudioRef = useRef(null)
  const previewTimeoutRef = useRef(null)

  const stopPreview = useCallback(() => {
    if (previewAudioRef.current) {
      previewAudioRef.current.pause()
      previewAudioRef.current = null
    }
    if (previewTimeoutRef.current) {
      clearTimeout(previewTimeoutRef.current)
      previewTimeoutRef.current = null
    }
    setPlayingTrackId(null)
  }, [])

  const handlePlayPause = useCallback((track, e) => {
    if (e && e.stopPropagation) e.stopPropagation()
    if (playingTrackId === track.id) {
      stopPreview()
    } else {
      stopPreview()
      const audioUrl = track.url || track.src
      if (!audioUrl) return
      const audio = new Audio(audioUrl)
      audio.volume = 0.5
      previewAudioRef.current = audio
      setPlayingTrackId(track.id)
      audio.play().catch(err => console.warn('Preview failed', err))

      audio.onended = () => {
        stopPreview()
      }

      // Stop after 7 seconds (5-8 seconds requirement)
      previewTimeoutRef.current = setTimeout(() => {
        stopPreview()
      }, 7000)
    }
  }, [playingTrackId, stopPreview])

  // Stop preview when clicking anywhere else
  useEffect(() => {
    const handleGlobalClick = (e) => {
      if (!e.target.closest('[data-audio-preview-btn]')) {
        stopPreview()
      }
    }
    document.addEventListener('click', handleGlobalClick, { capture: true })
    return () => {
      document.removeEventListener('click', handleGlobalClick, { capture: true })
      stopPreview()
    }
  }, [stopPreview])

  const uploadedImages = useSelector(selectUploadedImagesArray)
  const isUploading = useSelector(selectIsUploading)
  const isFetching = useSelector(selectIsFetching)
  const uploadError = useSelector(selectUploadError)
  const fetchError = useSelector(selectFetchError)
  const lastUploadedId = useSelector(selectLastUploadedId)
  const totalCount = useSelector(selectTotalCount)
  const imageCount = useSelector(selectImageCount)
  const iconCount = useSelector(selectIconCount)
  const videoCount = useSelector(selectVideoCount)
  const audioCount = useSelector(selectAudioCount)
  const hasLargeUpload = useSelector(selectHasLargeUpload)
  const uploadProgress = useSelector(selectUploadProgress)
  const uploadQueue = useSelector(selectUploadQueueArray)
  const currentSceneId = useSelector(selectCurrentSceneId)
  const allLayers = useSelector(selectLayers)
  const { theme, user } = useContext(ThemeContext)
  // Get user from state if not in context
  const authUser = useSelector((state) => state.auth.user)
  const isDesigner = authUser?.isDesigner
  const isLight = theme === 'light'

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

  // Warm PIXI assets cache in the background for uploaded assets
  useEffect(() => {
    if (uploadedImages.length > 0) {
      assetCacheWarmer.add(uploadedImages)
    }
  }, [uploadedImages])

  const filteredImages = useMemo(() => {
    if (!uploadedImages.length) return []
    return uploadedImages.filter(image => {
      const isAudio = image.metadata?.type?.startsWith('audio/') || image.assetType === 'audio'
      const isVideo = image.metadata?.type?.startsWith('video/')
      const isIcon = image.assetType === 'icon'
      const isImage = !isAudio && !isVideo && !isIcon

      const matchesTab = activeTab === 'All' ||
        (activeTab === 'Images' && isImage) ||
        (activeTab === 'Icons' && isIcon) ||
        (activeTab === 'Audio' && isAudio) ||
        (activeTab === 'Videos' && isVideo)
      return matchesTab
    })
  }, [uploadedImages, activeTab])

  const displayItems = useMemo(() => {
    // Filter queue items based on tab
    const filteredQueue = uploadQueue.filter(item => {
      const matchesTab = activeTab === 'All' ||
        (activeTab === 'Images' && item.type?.startsWith('image/')) ||
        (activeTab === 'Icons' && false) || // Queue doesn't support icon filtering yet
        (activeTab === 'Audio' && item.type?.startsWith('audio/')) ||
        (activeTab === 'Videos' && item.type?.startsWith('video/'))
      return matchesTab
    })
    return [...filteredQueue, ...filteredImages]
  }, [uploadQueue, filteredImages, activeTab])

  const handleFileSelect = useCallback((files) => {
    if (!files || files.length === 0) return
    dispatch(startBatchUpload({ files, isPublic, assetType }))
  }, [dispatch, isPublic, assetType])

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
    const title = 'Delete Asset'
    const message = inUse 
      ? 'This asset is currently used in your project. Deleting it will cause affected layers to show a placeholder. Continue?'
      : 'Are you sure you want to delete this asset?'

    setConfirmModal({
      isOpen: true,
      title,
      message,
      onConfirm: () => {
        setDeletingId(imageId)
        dispatch(deleteUpload(imageId)).finally(() => {
          setDeletingId(null)
          setSelectedIds(prev => prev.filter(id => id !== imageId))
          setConfirmModal(prev => ({ ...prev, isOpen: false }))
        })
      }
    })
  }, [dispatch, uploadedImages, isAssetInUse])

  const handleToggleSelect = useCallback((id) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    )
  }, [])

  const handleBulkDelete = useCallback(async () => {
    if (selectedIds.length === 0) return

    const inUseAssets = selectedIds.filter(id => {
      const asset = uploadedImages.find(img => img.id === id)
      return asset && isAssetInUse(asset.url)
    })

    const title = `Delete ${selectedIds.length} Asset${selectedIds.length > 1 ? 's' : ''}`
    const message = inUseAssets.length > 0
      ? `${inUseAssets.length} of the selected assets are currently in use. Deleting them will cause affected layers to show a placeholder. Continue?`
      : `Are you sure you want to delete ${selectedIds.length} selected assets?`

    setConfirmModal({
      isOpen: true,
      title,
      message,
      onConfirm: async () => {
        try {
          await Promise.all(selectedIds.map(id => dispatch(deleteUpload(id)).unwrap()))
          setSelectedIds([])
          setConfirmModal(prev => ({ ...prev, isOpen: false }))
        } catch (err) {
          console.error('Bulk delete failed:', err)
        }
      }
    })
  }, [dispatch, selectedIds, uploadedImages, isAssetInUse])

  const handleClearError = () => dispatch(clearUploadError())
  const handleRetryFetch = () => { dispatch(clearFetchError()); dispatch(fetchUploads()) }

  const handleAddImageLayer = useCallback((image) => {
    // Audio assets: dispatch addAudioTrack instead of adding a canvas layer
    const isAudio = image.metadata?.type?.startsWith('audio/') || image.assetType === 'audio'
    if (isAudio) {
      dispatch(addAudioTrack({
        assetId: image.id,
        assetUrl: image.url,
        name: image.name || 'Audio',
        duration: image.metadata?.duration || 0,
        waveform: image.metadata?.waveform || [],
      }))
      return
    }

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
        width: isMobile ? '100%' : '320px',
        backgroundColor: isMobile ? 'transparent' : (isLight ? '#f3f4f7' : '#090a0d'),
        backdropFilter: isMobile ? 'none' : 'blur(20px)',
        WebkitBackdropFilter: isMobile ? 'none' : 'blur(20px)',
        borderRight: isMobile ? 'none' : `1px solid ${isLight ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.05)'}`,
      }}
    >

      <div className={`px-6 lg:pt-6 pt-0 pb-5 border-b ${isLight ? 'border-black/5' : 'border-white/5'}`}>
        <div className="hidden lg:flex items-center justify-between mb-4">
          <h2 className={`text-[20px] font-semibold tracking-tight ${isLight ? 'text-gray-900' : 'text-white'}`}>Uploads</h2>
          {onClose && (
            <button 
                onClick={onClose} 
                className={`transition-all duration-300 p-2 rounded-[10px] ${isLight ? 'text-gray-400 hover:text-gray-900 hover:bg-gray-100' : 'text-white/40 hover:text-white hover:bg-white/10'}`}
            >
              <X className="h-5 w-5" strokeWidth={2} />
            </button>
          )}
        </div>

        {isAuthenticated ? (
          <div className="flex flex-col gap-2.5">
            {isDesigner && (
              <div className={`p-3 rounded-[16px] border mb-1 flex flex-col gap-3 ${isLight ? 'bg-white border-black/5' : 'bg-white/5 border-white/5'}`}>
                <div className="flex items-center justify-between">
                  <span className={`text-[12px] font-semibold ${isLight ? 'text-gray-500' : 'text-zinc-500'}`}>Visibility</span>
                  <div className="flex bg-black/5 rounded-lg p-0.5">
                    <button
                      onClick={() => setIsPublic(true)}
                      className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-bold transition-all ${isPublic ? 'bg-white shadow-sm text-[#7c4af0]' : 'text-zinc-500 hover:text-zinc-400'}`}
                    >
                      <Globe className="h-3 w-3" /> Public
                    </button>
                    <button
                      onClick={() => setIsPublic(false)}
                      className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-bold transition-all ${!isPublic ? 'bg-white shadow-sm text-red-500' : 'text-zinc-500 hover:text-zinc-400'}`}
                    >
                      <Lock className="h-3 w-3" /> Private
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <span className={`text-[12px] font-semibold ${isLight ? 'text-gray-500' : 'text-zinc-500'}`}>Asset Type</span>
                  <div className="flex bg-black/5 rounded-lg p-0.5">
                    <button
                      onClick={() => setAssetType('image')}
                      className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-bold transition-all ${assetType === 'image' ? 'bg-white shadow-sm text-[#7c4af0]' : 'text-zinc-500 hover:text-zinc-400'}`}
                    >
                      <Image className="h-3 w-3" /> Image
                    </button>
                    <button
                      onClick={() => setAssetType('icon')}
                      className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-bold transition-all ${assetType === 'icon' ? 'bg-white shadow-sm text-[#7c4af0]' : 'text-zinc-500 hover:text-zinc-400'}`}
                    >
                      <Smile className="h-3 w-3" /> Icon
                    </button>
                  </div>
                </div>
              </div>
            )}

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

            {selectedIds.length > 0 && (
                <button
                onClick={handleBulkDelete}
                className="w-full h-9 px-4 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded-[12px] text-[13px] font-semibold flex items-center justify-center gap-2 transition-all active:scale-[0.95]"
                >
                <Trash2 className="h-3.5 w-3.5" />
                Delete Selected ({selectedIds.length})
                </button>
            )}
            <input ref={fileInputRef} type="file" multiple accept="image/*,video/*,audio/*" onChange={handleFileInputChange} className="hidden" />
          </div>
        ) : (
          <div className={`py-8 px-5 text-center rounded-[20px] border mb-2 shadow-small ${isLight ? 'bg-slate-50 border-slate-100' : 'bg-white/5 border-white/5'}`}>
            <div className="w-14 h-14 bg-[#7c4af0]/10 rounded-full flex items-center justify-center mx-auto mb-5">
              <UploadIcon className="h-7 w-7 text-[#7c4af0]" strokeWidth={2} />
            </div>
            <h3 className={`text-[16px] font-semibold mb-2 ${isLight ? 'text-slate-900' : 'text-white'}`}>Want to upload?</h3>
            <p className={`text-[13px] mb-5 leading-relaxed ${isLight ? 'text-slate-500' : 'text-white/40'}`}>
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

          <div className={`flex border-b px-6 ${isLight ? 'border-black/5' : 'border-white/5'}`}>
            {/* Role-based tabs: designers see Icons tab; normal users see Audio tab instead */}
            {(isDesigner
              ? ['All', 'Images', 'Icons', 'Audio', 'Videos']
              : ['All', 'Images', 'Audio', 'Videos']
            ).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-4 text-[13px] font-semibold tracking-wide relative transition-colors ${activeTab === tab ? 'text-[#7c4af0]' : (isLight ? 'text-gray-500 hover:text-gray-900' : 'text-zinc-500 hover:text-white')}`}
              >
                {tab} <span className="opacity-40 ml-1">{tab === 'All' ? totalCount : tab === 'Images' ? imageCount : tab === 'Icons' ? iconCount : tab === 'Audio' ? audioCount : videoCount}</span>
                {activeTab === tab && (
                  <div className="absolute bottom-0 left-2 right-2 h-[2px] bg-[#7c4af0] rounded-t-full" />
                )}
              </button>
            ))}
          </div>

          <div
            className={`flex-1 overflow-y-auto p-6 custom-scrollbar scrollbar-hide ${isDragOver ? (isLight ? 'bg-purple-50 border-2 border-dashed border-purple-200' : 'bg-[#7c4af0]/5 border-2 border-dashed border-[#7c4af0]/30') : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {isUploading && (
              <div className={`mb-6 p-4 rounded-[16px] border shadow-medium ${isLight ? 'bg-white border-purple-100' : 'bg-white/5 border-white/10'}`}>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[12px] font-semibold text-[#7c4af0] tracking-tight">
                    {uploadQueue.length > 0 
                      ? `Uploading ${uploadQueue.filter(u => u.status === 'uploading').length} of ${uploadQueue.length} files...`
                      : 'Processing...'}
                  </span>
                  <button
                    onClick={() => dispatch(cancelUpload())}
                    className={`text-[10px] font-bold uppercase tracking-widest transition-colors ${isLight ? 'text-black/30 hover:text-red-500' : 'text-white/30 hover:text-red-400'}`}
                  >
                    Cancel All
                  </button>
                </div>
                <div className={`w-full h-1.5 rounded-full overflow-hidden mb-3 ${isLight ? 'bg-black/5' : 'bg-white/5'}`}>
                  <div
                    className={`h-full bg-[#7c4af0] transition-all duration-300 shadow-[0_0_8px_rgba(124,74,240,0.4)] ${uploadProgress === 0 ? 'animate-[progress_2s_ease-in-out_infinite]' : ''}`}
                    style={{ 
                        width: uploadQueue.length > 0 
                            ? `${(uploadQueue.filter(u => u.status === 'completed').length / uploadQueue.length) * 100}%` 
                            : `${Math.max(uploadProgress, 10)}%` 
                    }}
                  />
                </div>
                {hasLargeUpload && (
                  <p className="text-[11px] text-zinc-500 leading-normal">
                    Large files detected. This might take a few moments.
                  </p>
                )}
              </div>
            )}

            {/* Loading skeleton */}
            {isFetching && !uploadedImages.length ? (
              <SkeletonGrid isLight={isLight} />
            ) : filteredImages.length === 0 ? (
              <div className="h-64 flex flex-col items-center justify-center text-center">
                <div className={`p-4 rounded-full mb-4 ${isLight ? 'bg-black/5' : 'bg-white/5'}`}>
                  <UploadIcon className={`h-8 w-8 ${isLight ? 'text-slate-300' : 'text-zinc-600'}`} />
                </div>
                <p className={`text-[14px] font-medium ${isLight ? 'text-slate-400' : 'text-zinc-500'}`}>
                  Drop files here to start
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                {displayItems.map((image) => (
                  <AssetCard
                    key={image.id}
                    image={image}
                    isUploading={image.status === 'uploading'}
                    isSelected={selectedIds.includes(image.id)}
                    onToggleSelect={handleToggleSelect}
                    deletingId={deletingId}
                    onDelete={handleDeleteImage}
                    onAdd={handleAddImageLayer}
                    isPlaying={playingTrackId === image.id}
                    onPlayPause={handlePlayPause}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Confirmation Modal */}
      <Modal
        isOpen={confirmModal.isOpen}
        onClose={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
        title={confirmModal.title}
        maxWidth="max-w-xs"
      >
        <div className="flex flex-col items-center text-center">
          <div className="w-12 h-12 bg-red-500/10 rounded-full flex items-center justify-center mb-4">
            <Trash2 className="h-6 w-6 text-red-500" />
          </div>
          <p className={`text-[13px] leading-relaxed mb-6 px-2 ${isLight ? 'text-slate-600' : 'text-white/70'}`}>
            {confirmModal.message}
          </p>
          <div className="flex flex-col w-full gap-2">
            <button
              onClick={confirmModal.onConfirm}
              className="w-full py-2.5 bg-red-500 hover:bg-red-600 text-white rounded-xl text-[14px] font-semibold transition-all shadow-lg active:scale-[0.98]"
            >
              Delete
            </button>
            <button
              onClick={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
              className={`w-full py-2.5 rounded-xl text-[14px] font-medium transition-all active:scale-[0.98] ${
                isLight ? 'bg-slate-100 text-slate-500 hover:bg-slate-200' : 'bg-white/5 text-white/60 hover:text-white'
              }`}
            >
              Cancel
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

export default UploadsPanel
