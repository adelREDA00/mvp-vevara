import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { X, Search, Upload as UploadIcon, Image, Video, File, Trash2, AlertCircle } from 'lucide-react'
import { DragToCloseHandle } from './DragToCloseHandle'
import {
  selectUploadedImagesArray,
  selectIsUploading,
  selectUploadError,
  selectImageCount,
  selectVideoCount,
  selectTotalCount,
  uploadFile,
  deleteUploadedImage,
  clearUploadError,
  initializeUploadsFromStorage,
} from '../../../store/slices/uploadsSlice'

// NEW: Added imports for creating image layers on the canvas
import { addLayerAndSelect, selectCurrentSceneId } from '../../../store/slices/projectSlice'

// Utility functions moved outside component to prevent recreation
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

// NEW: Added aspectRatio prop to calculate canvas dimensions for proper image positioning
function UploadsPanel({ onClose, aspectRatio }) {
  const dispatch = useDispatch()
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState('All')
  const [width, setWidth] = useState(320)
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef(null)

  const uploadedImages = useSelector(selectUploadedImagesArray)
  const isUploading = useSelector(selectIsUploading)
  const uploadError = useSelector(selectUploadError)
  const totalCount = useSelector(selectTotalCount)
  const imageCount = useSelector(selectImageCount)
  const videoCount = useSelector(selectVideoCount)

  // NEW: Get current scene ID to create layers in the correct scene
  const currentSceneId = useSelector(selectCurrentSceneId)

  // NEW: World dimensions calculation (same logic as ElementsPanel)
  // Calculates canvas dimensions based on aspect ratio for proper image positioning
  const getCurrentAspectRatio = () => {
    return aspectRatio || '16:9'
  }

  const getWorldDimensions = () => {
    const aspectRatio = getCurrentAspectRatio()
    const [widthRatio, heightRatio] = aspectRatio.split(':').map(Number)
    const aspectRatioValue = widthRatio / heightRatio

    if (aspectRatioValue >= 1) {
      // Landscape or square - use 1920x1080 as base
      const baseWidth = 1920
      const baseHeight = 1080
      const baseAspect = baseWidth / baseHeight

      if (Math.abs(aspectRatioValue - baseAspect) < 0.01) {
        // Close to 16:9, use standard dimensions
        return { worldWidth: 1920, worldHeight: 1080 }
      } else {
        // Scale to match aspect ratio
        const worldHeight = 1080
        const worldWidth = Math.round(worldHeight * aspectRatioValue)
        return { worldWidth, worldHeight }
      }
    } else {
      // Portrait - use 1080x1920 as base
      const baseWidth = 1080
      const baseHeight = 1920
      const baseAspect = baseWidth / baseHeight

      if (Math.abs(aspectRatioValue - baseAspect) < 0.01) {
        // Close to 9:16, use standard dimensions
        return { worldWidth: 1080, worldHeight: 1920 }
      } else {
        // Scale to match aspect ratio
        const worldWidth = 1080
        const worldHeight = Math.round(worldWidth / aspectRatioValue)
        return { worldWidth, worldHeight }
      }
    }
  }

  // NEW: Get canvas dimensions for centering images
  const { worldWidth, worldHeight } = getWorldDimensions()

  // Initialize uploads from storage on mount
  useEffect(() => {
    dispatch(initializeUploadsFromStorage())
  }, [dispatch])

  // Memoize filtered images to prevent recalculation on every render
  const filteredImages = useMemo(() => {
    if (!uploadedImages.length) return []

    return uploadedImages.filter(image => {
      const matchesSearch = searchQuery === '' ||
        image.name.toLowerCase().includes(searchQuery.toLowerCase())

      const matchesTab = activeTab === 'All' ||
        (activeTab === 'Images' && image.metadata?.type?.startsWith('image/')) ||
        (activeTab === 'Videos' && image.metadata?.type?.startsWith('video/'))

      return matchesSearch && matchesTab
    })
  }, [uploadedImages, searchQuery, activeTab])

  // Memoize event handlers to prevent recreation on every render
  const handleFileSelect = useCallback((files) => {
    if (!files || files.length === 0) return

    Array.from(files).forEach(file => {
      dispatch(uploadFile(file))
    })
  }, [dispatch])

  const handleFileInputChange = useCallback((e) => {
    handleFileSelect(e.target.files)
    // Reset input
    e.target.value = ''
  }, [handleFileSelect])

  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleDragOver = useCallback((e) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e) => {
    e.preventDefault()
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    setIsDragOver(false)
    handleFileSelect(e.dataTransfer.files)
  }, [handleFileSelect])

  const handleDeleteImage = useCallback((imageId, e) => {
    e.stopPropagation()
    dispatch(deleteUploadedImage(imageId))
  }, [dispatch])

  // NEW: Main function that creates an image layer when user clicks on uploaded image
  // This is the core functionality that adds uploaded images to the canvas
  const handleAddImageLayer = useCallback((image) => {
    // Don't create layer if no scene is active
    if (!currentSceneId) return

    // Get original image dimensions from metadata (stored during upload)
    const imageWidth = image.metadata?.width || 300
    const imageHeight = image.metadata?.height || 200

    // NEW: Scale down very large images to prevent canvas overflow
    // Maintains aspect ratio while keeping images manageable
    const maxSize = 400 // Maximum dimension allowed
    let finalWidth = imageWidth
    let finalHeight = imageHeight

    // If image is larger than maxSize in any dimension, scale it down proportionally
    if (finalWidth > maxSize || finalHeight > maxSize) {
      const scale = maxSize / Math.max(finalWidth, finalHeight)
      finalWidth *= scale
      finalHeight *= scale
    }

    // Position image at center of canvas
    const centerX = worldWidth / 2
    const centerY = worldHeight / 2

    // Create the layer in Redux store and select it
    dispatch(addLayerAndSelect({
      sceneId: currentSceneId,        // Which scene to add to
      type: image.metadata?.type?.startsWith('video/') ? 'video' : 'image', // Layer type
      name: image.name || (image.metadata?.type?.startsWith('video/') ? 'Video Layer' : 'Image Layer'),
      x: centerX,                     // Center horizontally
      y: centerY,                     // Center vertically
      width: finalWidth,              // Scaled width
      height: finalHeight,            // Scaled height
      anchorX: 0.5,                   // Center anchor point
      anchorY: 0.5,                   // Center anchor point
      mediaWidth: imageWidth,          // Original full media width
      mediaHeight: imageHeight,        // Original full media height
      data: {                         // Data for PIXI
        url: image.url,               // Blob URL
        src: image.url,               // Duplicate for compatibility
        ...image.metadata             // Original metadata
      }
    }))
  }, [dispatch, currentSceneId, worldWidth, worldHeight])

  const handleClearError = useCallback(() => {
    dispatch(clearUploadError())
  }, [dispatch])

  return (
    <div
      className="flex flex-col h-full relative backdrop-blur-md transition-all duration-300"
      style={{
        width: typeof window !== 'undefined' && window.innerWidth < 1024 ? '100%' : `${width}px`,
        backgroundColor: 'rgba(13, 18, 22, 0.85)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderRight: '0.5px solid rgba(255, 255, 255, 0.1)',
      }}
    >
      <DragToCloseHandle onClose={onClose} onWidthChange={setWidth} initialWidth={width} minWidth={200} />

      <div className="px-4 pt-4 pb-3 border-b border-zinc-800/50">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-white">Uploads</h2>
          {onClose && (
            <button
              onClick={onClose}
              className="text-zinc-400 hover:text-white transition-colors p-1 rounded-md hover:bg-zinc-800"
            >
              <X className="h-4 w-4" strokeWidth={1.5} />
            </button>
          )}
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-zinc-500" strokeWidth={1.5} />
          <input
            type="text"
            placeholder="Search uploads"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-white text-sm placeholder-zinc-500 focus:outline-none focus:border-zinc-700 focus:ring-1 focus:ring-zinc-700"
          />
        </div>

        <button
          onClick={handleUploadClick}
          disabled={isUploading}
          className="w-full mt-3 px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-800 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
        >
          <UploadIcon className="h-4 w-4" strokeWidth={1.5} />
          {isUploading ? 'Uploading...' : 'Upload Files'}
        </button>

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,video/*"
          onChange={handleFileInputChange}
          className="hidden"
        />
      </div>

      {/* Upload Error Display */}
      {uploadError && (
        <div className="mx-4 mt-2 p-3 bg-red-900/50 border border-red-700 rounded-lg flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-red-400 flex-shrink-0" />
          <p className="text-red-300 text-sm flex-1">{uploadError}</p>
          <button
            onClick={handleClearError}
            className="text-red-400 hover:text-red-300 p-1"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="flex border-b border-zinc-800/50 px-4">
        <button
          onClick={() => setActiveTab('All')}
          className={`px-4 py-3 text-sm font-medium transition-colors relative ${activeTab === 'All'
            ? 'text-purple-400'
            : 'text-zinc-400 hover:text-white'
            }`}
        >
          All ({totalCount})
          {activeTab === 'All' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-purple-400" />
          )}
        </button>
        <button
          onClick={() => setActiveTab('Images')}
          className={`px-4 py-3 text-sm font-medium transition-colors relative ${activeTab === 'Images'
            ? 'text-purple-400'
            : 'text-zinc-400 hover:text-white'
            }`}
        >
          Images ({imageCount})
          {activeTab === 'Images' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-purple-400" />
          )}
        </button>
        <button
          onClick={() => setActiveTab('Videos')}
          className={`px-4 py-3 text-sm font-medium transition-colors relative ${activeTab === 'Videos'
            ? 'text-purple-400'
            : 'text-zinc-400 hover:text-white'
            }`}
        >
          Videos ({videoCount})
          {activeTab === 'Videos' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-purple-400" />
          )}
        </button>
      </div>

      <div
        className={`flex-1 overflow-y-auto p-4 ${isDragOver ? 'bg-purple-500/10 border-2 border-dashed border-purple-400' : ''
          }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {filteredImages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center text-zinc-500">
            {totalCount === 0 ? (
              <>
                <UploadIcon className="h-12 w-12 mb-4 opacity-50" />
                <p className="text-sm mb-2">No uploads yet</p>
                <p className="text-xs">Drag and drop files here or click "Upload Files"</p>
              </>
            ) : (
              <>
                <File className="h-12 w-12 mb-4 opacity-50" />
                <p className="text-sm">No matches found</p>
                <p className="text-xs">Try adjusting your search or filter</p>
              </>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {filteredImages.map((image) => (
              <div
                key={image.id}
                className="group relative bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden hover:border-zinc-700 transition-colors cursor-pointer"
                onClick={() => handleAddImageLayer(image)} // NEW: Click handler to add image to canvas
                draggable
                onDragStart={(e) => {
                  // Set drag data for canvas drop
                  e.dataTransfer.setData('application/json', JSON.stringify({
                    type: 'uploaded-image',
                    imageId: image.id,
                    url: image.url,
                    metadata: image.metadata
                  }))
                }}
              >
                {/* Image/Video Preview */}
                <div className="aspect-square bg-zinc-800 flex items-center justify-center overflow-hidden">
                  {image.metadata?.type?.startsWith('image/') ? (
                    <img
                      src={image.url}
                      alt={image.name}
                      className="w-full h-full object-cover"
                      draggable={false}
                    />
                  ) : image.metadata?.thumbnail ? (
                    <img
                      src={image.metadata.thumbnail}
                      alt={image.name}
                      className="w-full h-full object-cover"
                      draggable={false}
                    />
                  ) : (
                    <div className="flex flex-col items-center text-zinc-500">
                      <Video className="h-8 w-8 mb-2" />
                      <span className="text-xs">Video</span>
                    </div>
                  )}
                </div>

                {/* Overlay with actions */}
                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <button
                    onClick={(e) => handleDeleteImage(image.id, e)}
                    className="p-2 bg-red-600 hover:bg-red-700 rounded-full text-white transition-colors"
                    title="Delete"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                {/* Image Info */}
                <div className="p-2">
                  <p className="text-xs text-white font-medium truncate mb-1" title={image.name}>
                    {image.name}
                  </p>
                  <div className="flex items-center justify-between text-xs text-zinc-400">
                    <span>{formatFileSize(image.metadata?.size || 0)}</span>
                    {image.metadata?.width && image.metadata?.height && (
                      <span>{formatDimensions(image.metadata.width, image.metadata.height)}</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Drag overlay */}
        {isDragOver && (
          <div className="absolute inset-0 bg-purple-500/20 border-2 border-dashed border-purple-400 rounded-lg flex items-center justify-center">
            <div className="text-center text-purple-300">
              <UploadIcon className="h-8 w-8 mx-auto mb-2" />
              <p className="text-sm font-medium">Drop files here to upload</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default UploadsPanel

