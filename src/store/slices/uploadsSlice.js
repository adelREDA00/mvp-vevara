import { createSlice, createSelector } from '@reduxjs/toolkit'
import { uid } from '../../utils/ids'

const generateId = uid

const initialState = {
  uploadedImages: {}, // id -> { id, name, url, file, metadata: {width, height, size, type}, uploadedAt }
  isUploading: false,
  uploadError: null,
  lastUploadedId: null, // Track the most recently uploaded image for selection
}

const uploadsSlice = createSlice({
  name: 'uploads',
  initialState,
  reducers: {
    // Start image upload process
    uploadImageStart: (state) => {
      state.isUploading = true
      state.uploadError = null
    },

    // Successfully upload an image
    uploadImageSuccess: (state, action) => {
      const { id, name, url, file, metadata } = action.payload
      const imageId = id || generateId()

      state.uploadedImages[imageId] = {
        id: imageId,
        name: name || 'Untitled Image',
        url,
        file, // Store file reference for potential re-upload to server
        metadata: {
          width: metadata?.width || 0,
          height: metadata?.height || 0,
          size: metadata?.size || 0,
          type: metadata?.type || 'unknown',
          ...metadata,
        },
        uploadedAt: Date.now(),
        updatedAt: Date.now(),
      }

      state.isUploading = false
      state.lastUploadedId = imageId
    },

    // Handle upload failure
    uploadImageFailure: (state, action) => {
      state.uploadError = action.payload
      state.isUploading = false
    },

    // Update existing uploaded image metadata
    updateUploadedImage: (state, action) => {
      const { id, ...updates } = action.payload
      const image = state.uploadedImages[id]
      if (image) {
        Object.assign(image, updates, { updatedAt: Date.now() })
      }
    },

    // Delete an uploaded image
    deleteUploadedImage: (state, action) => {
      const imageId = action.payload
      const image = state.uploadedImages[imageId]

      if (image) {
        // Clean up blob URLs
        if (image.url && image.url.startsWith('blob:')) {
          try {
            URL.revokeObjectURL(image.url)
          } catch (e) {
            // Ignore errors if URL is already revoked
          }
        }

        // Clean up localStorage entry if it exists
        if (image.file && typeof image.file === 'string' && image.file.startsWith('vevara_image_')) {
          try {
            localStorage.removeItem(image.file)
          } catch (e) {
            // Ignore localStorage errors
          }
        }

        delete state.uploadedImages[imageId]

        // Clear lastUploadedId if it was the deleted image
        if (state.lastUploadedId === imageId) {
          state.lastUploadedId = null
        }
      }
    },

    // Clear all uploaded images
    clearUploadedImages: (state) => {
      // Clean up blob URLs and localStorage entries before clearing
      Object.keys(state.uploadedImages).forEach(imageId => {
        const image = state.uploadedImages[imageId]

        // Clean up blob URLs
        if (image.url && image.url.startsWith('blob:')) {
          try {
            URL.revokeObjectURL(image.url)
          } catch (e) {
            // Ignore cleanup errors
          }
        }

        // Clean up localStorage entries
        if (image.file && typeof image.file === 'string' && image.file.startsWith('vevara_image_')) {
          try {
            localStorage.removeItem(image.file)
          } catch (e) {
            // Ignore localStorage errors
          }
        }
      })

      state.uploadedImages = {}
      state.lastUploadedId = null
    },

    // Load uploaded images from storage (for persistence)
    loadUploadedImages: (state, action) => {
      const images = action.payload || {}

      // ENHANCEMENT: Preserve current session-only uploads (like videos)
      // that are not persisted to localStorage. This prevents them from
      // disappearing from the panel when it remounts/re-initializes.
      Object.keys(state.uploadedImages).forEach(id => {
        const existing = state.uploadedImages[id]
        // If it's a blob URL and has no localStorage key (file: null), keep it
        if (existing.url?.startsWith('blob:') && !existing.file) {
          if (!images[id]) {
            images[id] = existing
          }
        }
      })

      state.uploadedImages = images
    },

    // Set last uploaded ID (useful for auto-selection)
    setLastUploadedId: (state, action) => {
      state.lastUploadedId = action.payload
    },

    // Clear upload error
    clearUploadError: (state) => {
      state.uploadError = null
    },
  },
})

export const {
  uploadImageStart,
  uploadImageSuccess,
  uploadImageFailure,
  updateUploadedImage,
  deleteUploadedImage,
  clearUploadedImages,
  loadUploadedImages,
  setLastUploadedId,
  clearUploadError,
} = uploadsSlice.actions


// Selectors
export const selectUploadedImages = (state) => state.uploads.uploadedImages
export const selectUploadedImageById = (state, imageId) => state.uploads.uploadedImages[imageId]
export const selectIsUploading = (state) => state.uploads.isUploading
export const selectUploadError = (state) => state.uploads.uploadError
export const selectLastUploadedId = (state) => state.uploads.lastUploadedId

// Memoized selector for uploaded images array
export const selectUploadedImagesArray = createSelector(
  [selectUploadedImages],
  (uploadedImages) => Object.values(uploadedImages).sort((a, b) => b.uploadedAt - a.uploadedAt)
)

// Memoized selectors for filtered counts (used in tabs)
export const selectImageCount = createSelector(
  [selectUploadedImagesArray],
  (images) => images.filter(img => img.metadata?.type?.startsWith('image/')).length
)

export const selectVideoCount = createSelector(
  [selectUploadedImagesArray],
  (images) => images.filter(img => img.metadata?.type?.startsWith('video/')).length
)

export const selectTotalCount = createSelector(
  [selectUploadedImagesArray],
  (images) => images.length
)

// Thunk for handling file upload with localStorage persistence
export const uploadFile = (file) => async (dispatch) => {
  try {
    dispatch(uploadImageStart())

    const isVideo = file.type.startsWith('video/')
    const isImage = file.type.startsWith('image/')

    // Validate file type
    if (!isImage && !isVideo) {
      throw new Error('Please select an image or video file')
    }

    // Create object URL for immediate use
    const url = URL.createObjectURL(file)

    let dimensions = { width: 0, height: 0 }
    let thumbnail = null

    if (isImage) {
      // Get image dimensions
      const img = new Image()
      dimensions = await new Promise((resolve, reject) => {
        img.onload = () => resolve({ width: img.width, height: img.height })
        img.onerror = () => reject(new Error('Failed to load image'))
        img.src = url
      })
    } else if (isVideo) {
      // Get video dimensions and generate thumbnail
      const video = document.createElement('video')
      video.muted = true
      video.playsInline = true
      video.preload = 'metadata'

      dimensions = await new Promise((resolve) => {
        video.onloadedmetadata = () => {
          resolve({
            width: video.videoWidth,
            height: video.videoHeight,
            duration: video.duration
          })
        }
        video.onerror = () => resolve({ width: 0, height: 0, duration: 0 })
        video.src = url
      })

      // Generate thumbnail at 0.1s
      try {
        thumbnail = await new Promise((resolve) => {
          video.currentTime = 0.1
          video.onseeked = () => {
            const canvas = document.createElement('canvas')
            canvas.width = video.videoWidth
            canvas.height = video.videoHeight
            const ctx = canvas.getContext('2d')
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
            resolve(canvas.toDataURL('image/jpeg', 0.7))
          }
          // Timeout as fallback
          setTimeout(() => resolve(null), 2000)
        })
      } catch (e) {
        console.warn('Failed to generate video thumbnail:', e)
      }
    }

    const metadata = {
      width: dimensions.width,
      height: dimensions.height,
      duration: dimensions.duration || 0,
      size: file.size,
      type: file.type,
      originalName: file.name,
      thumbnail,
    }

    // PRODUCTION PREP: In a live app with a node server, you would do something like:
    /*
    const formData = new FormData();
    formData.append('file', file);
    const response = await api.post('/uploads', formData);
    const serverUrl = response.data.url;
    dispatch(uploadImageSuccess({ name: file.name, url: serverUrl, metadata }));
    */

    // For now, we continue with localStorage/Blob implementation
    try {
      // Skip localStorage for videos as they are usually too large
      if (isVideo) {
        dispatch(uploadImageSuccess({
          name: file.name,
          url,
          file: null, // Session-only
          metadata,
        }))
        return
      }

      // Handle Image persistence (existing logic)
      const reader = new FileReader()
      const base64 = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result)
        reader.onerror = reject
        reader.readAsDataURL(file)
      })

      const dataSize = JSON.stringify({
        data: base64,
        metadata,
        uploadedAt: Date.now(),
      }).length

      if (dataSize > 1024 * 1024) {
        console.warn('Image too large for localStorage persistence, using session-only storage')
        dispatch(uploadImageSuccess({
          name: file.name,
          url,
          file: null,
          metadata,
        }))
      } else {
        const storageKey = `vevara_image_${Date.now()}_${file.name}`
        localStorage.setItem(storageKey, JSON.stringify({
          data: base64,
          metadata,
          uploadedAt: Date.now(),
        }))

        dispatch(uploadImageSuccess({
          name: file.name,
          url,
          file: storageKey,
          metadata,
        }))
      }

    } catch (storageError) {
      console.warn('Failed to persist to localStorage:', storageError)
      dispatch(uploadImageSuccess({
        name: file.name,
        url,
        file: null,
        metadata,
      }))
    }

  } catch (error) {
    dispatch(uploadImageFailure(error.message))
  }
}

// Thunk to initialize uploads from localStorage on app start
export const initializeUploadsFromStorage = () => (dispatch) => {
  try {
    const images = {}

    // More efficient: use Object.keys() and filter in one pass
    const imageKeys = Object.keys(localStorage).filter(key => key.startsWith('vevara_image_'))

    // Process all images synchronously but efficiently
    imageKeys.forEach(key => {
      try {
        const stored = JSON.parse(localStorage.getItem(key))
        const imageId = generateId()

        images[imageId] = {
          id: imageId,
          name: stored.metadata?.originalName || 'Stored Image',
          url: stored.data, // base64 data
          file: key, // localStorage key
          metadata: stored.metadata,
          uploadedAt: stored.uploadedAt,
          updatedAt: stored.uploadedAt,
        }
      } catch (e) {
        // Skip corrupted entries silently
      }
    })

    dispatch(loadUploadedImages(images))
  } catch (error) {
    console.error('Failed to load images from storage:', error)
  }
}

export default uploadsSlice.reducer
