import React, { useState, useRef, useEffect, useMemo, useCallback, useContext } from 'react'
import { useDispatch, useSelector, useStore } from 'react-redux'
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
  getVideoDimensions,
  getImageThumbnail,
  getAudioMetadata,
} from '../../../store/slices/uploadsSlice'

import { addLayerAndSelect, addAudioTrack, selectCurrentSceneId, selectIsAssetPreparing } from '../../../store/slices/projectSlice'
import Modal from './Modal'
import { assetCacheWarmer } from '../../engine/pixi/textureUtils'
import { storeAsset, getAssetMetadata, getAssetUrl, deleteAsset } from '../../../services/localAssetService'

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
  const store = useStore()
  const [selectedIds, setSelectedIds] = useState([])
  const [activeTab, setActiveTab] = useState('All')
  const [isDragOver, setIsDragOver] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const [confirmModal, setConfirmModal] = useState({ isOpen: false, title: '', message: '', onConfirm: null })
  const [isPublic, setIsPublic] = useState(true)
  const [assetType, setAssetType] = useState('image')
  const fileInputRef = useRef(null)
  // Safe limit: 200MB total (IndexedDB works up to ~500MB on most browsers; be conservative)
  const GUEST_STORAGE_LIMIT = 200 * 1024 * 1024
  const GUEST_SINGLE_FILE_LIMIT = 100 * 1024 * 1024 // 100MB per file
  // Local guest asset metadata (stored in localStorage as JSON)
  const LOCAL_ASSETS_KEY = 'vevara_local_uploaded_assets'
  const getLocalAssets = () => {
    try {
      return JSON.parse(localStorage.getItem(LOCAL_ASSETS_KEY) || '[]')
    } catch { return [] }
  }
  const saveLocalAssets = (assets) => {
    try { localStorage.setItem(LOCAL_ASSETS_KEY, JSON.stringify(assets)) } catch {}
  }
  const [localAssets, setLocalAssets] = useState(getLocalAssets)
  // Track guest uploads in a local state array for display
  const [guestUploads, setGuestUploads] = useState([])
  const guestUploadsRef = useRef([])
  const guestHydratedRef = useRef(false)
  const GUEST_ASSETS_KEY = 'vevara_guest_assets'

  /**
   * Save asset metadata to localStorage (small JSON, no binary data).
   * Binary blobs live in IndexedDB via storeAsset().
   */
  const saveGuestAssets = () => {
    try {
      // Only persist metadata — the binary data is in IndexedDB
      const meta = guestUploadsRef.current.map(a => ({
        _id: a._id || a.id,
        id: a._id || a.id,
        name: a.name,
        type: a.type || a.assetType,
        assetType: a.assetType || a.type,
        metadata: {
          mimeType: a.metadata?.mimeType || a.metadata?.type || a.type,
          type: a.metadata?.type || a.metadata?.mimeType || a.type,
          width: a.metadata?.width || 0,
          height: a.metadata?.height || 0,
          duration: a.metadata?.duration || 0,
          size: a.metadata?.size || 0,
          thumbnail: a.metadata?.thumbnail || null,
        },
        uploadedAt: a.uploadedAt || a.createdAt || Date.now(),
        createdAt: a.createdAt || a.uploadedAt || Date.now(),
      }))
      localStorage.setItem(GUEST_ASSETS_KEY, JSON.stringify(meta))
    } catch { /* quota exceeded — not critical, assets still in IDB */ }
  }

  /**
   * On mount: read asset metadata from localStorage, then re-create blob URLs
   * from IndexedDB so the guest asset library survives page refreshes.
   */
  const loadGuestAssets = useCallback(async () => {
    if (guestHydratedRef.current) return
    guestHydratedRef.current = true
    try {
      const stored = JSON.parse(localStorage.getItem(GUEST_ASSETS_KEY) || '[]')
      if (stored.length === 0) return

      // Rehydrate each asset by recreating its blob URL from IndexedDB
      const hydrated = []
      for (const meta of stored) {
        try {
          const blobUrl = await getAssetUrl(meta.id)
          if (blobUrl) {
            hydrated.push({
              ...meta,
              url: blobUrl,
            })
          }
        } catch (err) {
          // If the IDB entry is missing, skip this asset — don't block the rest
          console.warn('[GuestAssets] Failed to rehydrate asset:', meta.id, err)
        }
      }
      guestUploadsRef.current = hydrated
      setGuestUploads(hydrated)
    } catch (err) {
      console.error('[GuestAssets] Failed to load assets:', err)
    }
  }, [])
  // Load stored guest assets on mount
  useEffect(() => { loadGuestAssets() }, [loadGuestAssets])

  // Listen for guest-asset-added events from EmptyState/Stage
  useEffect(() => {
    const handleGuestAssetAdded = () => {
      guestHydratedRef.current = false
      loadGuestAssets()
    }
    window.addEventListener('vevara:guest-asset-added', handleGuestAssetAdded)
    return () => window.removeEventListener('vevara:guest-asset-added', handleGuestAssetAdded)
  }, [loadGuestAssets])

  const addGuestAsset = (asset) => {
    guestUploadsRef.current = [asset, ...guestUploadsRef.current]
    saveGuestAssets()
    setGuestUploads(guestUploadsRef.current)
  }

  const removeGuestAsset = async (id) => {
    guestUploadsRef.current = guestUploadsRef.current.filter(a => a.id !== id)
    saveGuestAssets()
    setGuestUploads(guestUploadsRef.current)
    // Also clean up from IndexedDB
    try { await deleteAsset(id) } catch {}
  }

  // Track total storage used by guest assets (approximate, from metadata)
  const guestStorageUsed = useMemo(() =>
    guestUploads.reduce((sum, a) => sum + (a.metadata?.size || 0), 0),
  [guestUploads])

  // Infinite Scroll State
  const [visibleCount, setVisibleCount] = useState(16)
  const sentinelRef = useRef(null)

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
  const { isAuthenticated } = useSelector((state) => state.auth)
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
    // Only fetch uploads from server if authenticated
    if (isAuthenticated) {
      dispatch(fetchUploads())
    }
  }, [dispatch, isAuthenticated])

  // Warm PIXI assets cache in the background for uploaded assets
  useEffect(() => {
    if (uploadedImages.length > 0) {
      assetCacheWarmer.add(uploadedImages)
    }
  }, [uploadedImages])

  // Use guest assets when unauthenticated, server assets when authenticated
  const displayAssets = isAuthenticated ? uploadedImages : guestUploads
  
  // For authenticated users we compute counts from server data; for guests we compute from local
  const localImageCount = guestUploads.filter(a => (a.metadata?.type || '').startsWith('image/') || a.assetType === 'image').length
  const localVideoCount = guestUploads.filter(a => (a.metadata?.type || '').startsWith('video/') || a.assetType === 'video').length
  const localAudioCount = guestUploads.filter(a => (a.metadata?.type || '').startsWith('audio/') || a.assetType === 'audio').length

  const filteredImages = useMemo(() => {
    const assets = isAuthenticated ? uploadedImages : guestUploads
    if (!assets.length) return []
    return assets.filter(image => {
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
    }, [isAuthenticated, uploadedImages, guestUploads, activeTab])

  const displayItems = useMemo(() => {
    // For guest users, skip the upload queue (that's Redux/API based)
    if (!isAuthenticated) return filteredImages
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
  }, [isAuthenticated, uploadQueue, filteredImages, activeTab])

  const visibleItems = useMemo(() => {
    return displayItems.slice(0, visibleCount)
  }, [displayItems, visibleCount])

  useEffect(() => {
    setVisibleCount(16)
  }, [activeTab])

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return

    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        setVisibleCount((prev) => prev + 16)
      }
    }, {
      root: null,
      rootMargin: '150px',
      threshold: 0.1
    })

    observer.observe(sentinel)
    return () => {
      if (sentinel) observer.unobserve(sentinel)
    }
  }, [sentinelRef.current, displayItems.length])

  const handleFileSelect = useCallback(async (files) => {
    if (!files || files.length === 0) return

    // Read auth status directly from store to avoid closure issues
    const currentAuth = store.getState().auth
    if (!currentAuth.isAuthenticated) {
      const fileArray = Array.from(files)

      // Pre-check: warn about large files before attempting to store them
      let totalNewBytes = 0
      for (const file of fileArray) {
        totalNewBytes += file.size
      }
      const afterStorage = guestStorageUsed + totalNewBytes
      if (afterStorage > GUEST_STORAGE_LIMIT) {
        setConfirmModal({
          isOpen: true,
          title: 'Storage Limit',
          message: `This file is too large to store locally. Create an account to upload larger assets.\n\nCurrent: ${formatFileSize(guestStorageUsed)}\nAdding: ${formatFileSize(totalNewBytes)}\nLimit: ${formatFileSize(GUEST_STORAGE_LIMIT)}`,
          onConfirm: () => {
            setConfirmModal(prev => ({ ...prev, isOpen: false }))
            window.location.href = '/login'
          },
          onCancel: () => {
            setConfirmModal(prev => ({ ...prev, isOpen: false }))
          },
          confirmLabel: 'Create Account',
          cancelLabel: 'Cancel',
        })
        return
      }

      for (const file of fileArray) {
        if (file.size > GUEST_SINGLE_FILE_LIMIT) {
          setConfirmModal({
            isOpen: true,
            title: 'File Too Large',
            message: `"${file.name}" (${formatFileSize(file.size)}) exceeds the ${formatFileSize(GUEST_SINGLE_FILE_LIMIT)} per-file limit for local storage.\n\nCreate an account to upload larger files.`,
            onConfirm: () => {
              setConfirmModal(prev => ({ ...prev, isOpen: false }))
              window.location.href = '/login'
            },
            onCancel: () => {
              setConfirmModal(prev => ({ ...prev, isOpen: false }))
            },
            confirmLabel: 'Create Account',
            cancelLabel: 'Skip',
          })
          continue
        }
        try {
          const stored = await storeAsset(file)
          const blobUrl = URL.createObjectURL(file)
          // Get dimensions for images/video
          let dimensions = { width: 0, height: 0, duration: 0, thumbnail: null, waveform: [] }
          if (file.type.startsWith('image/')) {
            dimensions = await getImageThumbnail(file)
          } else if (file.type.startsWith('video/')) {
            dimensions = await getVideoDimensions(file)
          } else if (file.type.startsWith('audio/')) {
            const audioMeta = await getAudioMetadata(file)
            dimensions = { width: 0, height: 0, duration: audioMeta.duration, waveform: audioMeta.waveform || [], thumbnail: null }
          }

          // Create a virtual "uploaded" asset entry matching the API response shape
          const mimeType = file.type
          const assetType_ = file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : 'image'
          const assetEntry = {
            _id: stored.id,
            id: stored.id,
            name: file.name,
            url: blobUrl,
            type: assetType_,
            assetType: assetType_,
            isPublic: true,
            metadata: {
              mimeType,
              type: mimeType,
              width: dimensions.width || 0,
              height: dimensions.height || 0,
              duration: dimensions.duration || 0,
              size: file.size,
              thumbnail: dimensions.thumbnail || null,
              waveform: dimensions.waveform || [],
            },
            uploadedAt: Date.now(),
            createdAt: Date.now(),
          }
          addGuestAsset(assetEntry)
          // Guest uploads should NOT auto-insert into canvas.
          // Assets go to the Uploads panel only, matching authenticated behavior.
        } catch (err) {
          console.error('[GuestUpload] Failed to store asset:', err)
        }
      }
      return
    }

    dispatch(startBatchUpload({ files, isPublic, assetType }))
  }, [dispatch, isPublic, assetType, currentSceneId, worldWidth, worldHeight, store, addGuestAsset, guestStorageUsed, GUEST_STORAGE_LIMIT, GUEST_SINGLE_FILE_LIMIT])

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
    const allLayers = store.getState().project.layers || {}
    return Object.values(allLayers).some(layer => {
      const layerUrl = layer.data?.url || layer.data?.src
      return layerUrl && (layerUrl === assetUrl || layerUrl.endsWith(assetUrl?.split('/').pop()))
    })
  }, [store])

  const handleDeleteImage = useCallback((imageId, e) => {
    e.stopPropagation()
    // Guest: delete from local storage
    if (!isAuthenticated) {
      setConfirmModal({
        isOpen: true,
        title: 'Delete Asset',
        message: 'Are you sure you want to delete this asset?',
        onConfirm: async () => {
          setDeletingId(imageId)
          try {
            await removeGuestAsset(imageId)
          } catch (err) {
            console.error('[GuestDelete] Failed to delete asset:', err)
          } finally {
            setDeletingId(null)
            setSelectedIds(prev => prev.filter(id => id !== imageId))
            setConfirmModal(prev => ({ ...prev, isOpen: false }))
          }
        },
        onCancel: () => setConfirmModal(prev => ({ ...prev, isOpen: false })),
      })
      return
    }
    // Auth: delete from server
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
  }, [dispatch, uploadedImages, isAssetInUse, isAuthenticated, removeGuestAsset])

  const handleToggleSelect = useCallback((id) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    )
  }, [])

  const handleBulkDelete = useCallback(async () => {
    if (selectedIds.length === 0) return

    // Guest: bulk delete from local storage
    if (!isAuthenticated) {
      setConfirmModal({
        isOpen: true,
        title: `Delete ${selectedIds.length} Asset${selectedIds.length > 1 ? 's' : ''}`,
        message: `Are you sure you want to delete ${selectedIds.length} selected assets?`,
        onConfirm: async () => {
          try {
            await Promise.all(selectedIds.map(id => removeGuestAsset(id)))
            setSelectedIds([])
            setConfirmModal(prev => ({ ...prev, isOpen: false }))
          } catch (err) {
            console.error('Guest bulk delete failed:', err)
          }
        },
        onCancel: () => setConfirmModal(prev => ({ ...prev, isOpen: false })),
      })
      return
    }

    // Auth: bulk delete from server
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
  }, [dispatch, selectedIds, uploadedImages, isAssetInUse, isAuthenticated, removeGuestAsset])

  const handleClearError = () => dispatch(clearUploadError())
  const handleRetryFetch = () => { dispatch(clearFetchError()); dispatch(fetchUploads()) }

  const handleAddImageLayer = useCallback((image) => {
    // Audio assets: dispatch addAudioTrack instead of adding a canvas layer
    const isAudio = (image.metadata?.type || image.metadata?.mimeType || '').startsWith('audio/') || image.type === 'audio' || image.assetType === 'audio'
    if (isAudio) {
      const hasAssetId = !!(image._id || image.id)
      dispatch(addAudioTrack({
        assetId: hasAssetId ? (image._id || image.id) : null,
        assetUrl: image.url,
        name: image.name || 'Audio',
        duration: image.metadata?.duration || 0,
        waveform: image.metadata?.waveform || [],
        // Store the local asset ID so tracks can be rehydrated on project reload
        _localAssetId: hasAssetId ? (image._id || image.id) : undefined,
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

    const isVideo = (image.metadata?.type || image.metadata?.mimeType || '').startsWith('video/') || image.type === 'video' || image.assetType === 'video'

    // In guest mode, store the IndexedDB assetId so it can be rehydrated on project reopen
    const hasAssetId = !!(image._id || image.id)

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
        thumbnail: image.metadata?.thumbnail || image.thumbnail || null,
        ...(image.metadata || {}),
        // Store the local asset ID so the layer can be rehydrated on project reload
        ...(hasAssetId && !image.url?.startsWith('/') ? { _localAssetId: image._id || image.id } : {}),
        // For videos, include duration for proper scene timing
        ...(isVideo && image.metadata?.duration ? { duration: image.metadata.duration } : {}),
      }
    }))
  }, [dispatch, currentSceneId, worldWidth, worldHeight])

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 1024

  return (
    <div
      className="flex flex-col h-full relative transition-all duration-300 pt-0 lg:pt-12"
      style={{
        width: isMobile ? '100%' : '320px',
        backgroundColor: isMobile ? 'transparent' : (isLight ? '#f3f4f7' : '#090a0d'),
        backdropFilter: isMobile ? 'none' : 'blur(20px)',
        WebkitBackdropFilter: isMobile ? 'none' : 'blur(20px)',
        borderRight: isMobile ? 'none' : `1px solid ${isLight ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.05)'}`,
      }}
    >
      {onClose && (
        <button 
            onClick={onClose} 
            className={`absolute top-3 right-3 z-50 transition-all duration-300 p-2 rounded-[10px] ${isLight ? 'text-gray-400 hover:text-gray-900 hover:bg-gray-100' : 'text-white/40 hover:text-white hover:bg-white/10'} hidden lg:block`}
        >
          <X className="h-5 w-5" strokeWidth={2} />
        </button>
      )}

      <div className="px-6 pt-0 pb-5">
        <div className="flex flex-col gap-2.5">
            {isAuthenticated && isDesigner && (
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
      </div>

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
                {tab} <span className="opacity-40 ml-1">{tab === 'All' 
                ? (isAuthenticated ? totalCount : guestUploads.length) 
                : tab === 'Images' 
                  ? (isAuthenticated ? imageCount : localImageCount) 
                  : tab === 'Icons' 
                    ? iconCount 
                    : tab === 'Audio' 
                      ? (isAuthenticated ? audioCount : localAudioCount) 
                      : (isAuthenticated ? videoCount : localVideoCount)
              }</span>
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

            {/* Loading skeleton - only for authenticated fetch */}
            {isFetching && !uploadedImages.length && isAuthenticated ? (
              <SkeletonGrid isLight={isLight} />
            ) : filteredImages.length === 0 && visibleItems.length === 0 ? (
              <div className="h-64 flex flex-col items-center justify-center text-center">
                <div className={`p-4 rounded-full mb-4 ${isLight ? 'bg-black/5' : 'bg-white/5'}`}>
                  <UploadIcon className={`h-8 w-8 ${isLight ? 'text-slate-300' : 'text-zinc-600'}`} />
                </div>
                <p className={`text-[14px] font-medium ${isLight ? 'text-slate-400' : 'text-zinc-500'}`}>
                  Drop files here to start
                </p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-4">
                  {visibleItems.map((image) => (
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
                      isSelectionMode={selectedIds.length > 0}
                    />
                  ))}
                </div>
                {visibleCount < displayItems.length && (
                  <div ref={sentinelRef} className="h-14 flex items-center justify-center mt-4">
                    <Loader2 className="h-5 w-5 animate-spin text-[#7c4af0]" />
                  </div>
                )}
              </>
            )}
          </div>
        </>

      {/* Confirmation Modal */}
      <Modal
        isOpen={confirmModal.isOpen}
        onClose={() => {
          if (confirmModal.onCancel) confirmModal.onCancel()
          else setConfirmModal(prev => ({ ...prev, isOpen: false }))
        }}
        title={confirmModal.title}
        maxWidth="max-w-xs"
      >
        <div className="flex flex-col items-center text-center">
          <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-4 ${confirmModal.confirmLabel === 'Create Account' ? 'bg-purple-500/10' : 'bg-red-500/10'}`}>
            {confirmModal.confirmLabel === 'Create Account' ? (
              <UploadIcon className="h-6 w-6 text-purple-500" />
            ) : (
              <Trash2 className="h-6 w-6 text-red-500" />
            )}
          </div>
          <p className={`text-[13px] leading-relaxed mb-6 px-2 whitespace-pre-line ${isLight ? 'text-slate-600' : 'text-white/70'}`}>
            {confirmModal.message}
          </p>
          <div className="flex flex-col w-full gap-2">
            <button
              onClick={confirmModal.onConfirm}
              className={`w-full py-2.5 rounded-xl text-[14px] font-semibold transition-all shadow-lg active:scale-[0.98] ${confirmModal.confirmLabel === 'Create Account' ? 'bg-purple-600 hover:bg-purple-700 text-white' : 'bg-red-500 hover:bg-red-600 text-white'}`}
            >
              {confirmModal.confirmLabel || 'Delete'}
            </button>
            <button
              onClick={() => {
                if (confirmModal.onCancel) confirmModal.onCancel()
                else setConfirmModal(prev => ({ ...prev, isOpen: false }))
              }}
              className={`w-full py-2.5 rounded-xl text-[14px] font-medium transition-all active:scale-[0.98] ${
                isLight ? 'bg-slate-100 text-slate-500 hover:bg-slate-200' : 'bg-white/5 text-white/60 hover:text-white'
              }`}
            >
              {confirmModal.cancelLabel || 'Cancel'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

export default React.memo(UploadsPanel)
