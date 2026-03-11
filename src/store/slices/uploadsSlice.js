import { createSlice, createSelector, createAsyncThunk } from '@reduxjs/toolkit'
import api from '../../api/client'

// [NEW] Module-level variable to store the abort controller for the current upload
// This avoids putting non-serializable values in the Redux state
let currentAbortController = null;

export const fetchUploads = createAsyncThunk(
  'uploads/fetch',
  async (_, { rejectWithValue }) => {
    try {
      const data = await api.get('/uploads')
      return data
    } catch (error) {
      return rejectWithValue(error.message)
    }
  }
)

/**
 * Helper: extract dimensions from a video file before uploading.
 * Returns { width, height, duration } or fallback zeros.
 */
function getVideoDimensions(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.muted = true
    video.playsInline = true

    const cleanup = () => {
      URL.revokeObjectURL(url)
      video.src = ''
    }

    video.onloadedmetadata = () => {
      // Seek to 0.1s to avoid black start frame
      video.currentTime = 0.1
    }

    video.onseeked = () => {
      // Capture frame
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')

      // Keep thumbnails small for speed and memory (max 320px)
      const maxDim = 320
      let w = video.videoWidth
      let h = video.videoHeight
      if (w > maxDim || h > maxDim) {
        const scale = maxDim / Math.max(w, h)
        w *= scale
        h *= scale
      }

      canvas.width = w
      canvas.height = h
      ctx.drawImage(video, 0, 0, w, h)

      const thumbnailDataUrl = canvas.toDataURL('image/jpeg', 0.7)

      resolve({
        width: video.videoWidth || 0,
        height: video.videoHeight || 0,
        duration: video.duration || 0,
        thumbnail: thumbnailDataUrl
      })
      cleanup()
    }

    video.onerror = () => {
      resolve({ width: 0, height: 0, duration: 0 })
      cleanup()
    }

    // Timeout fallback in case metadata or seek never loads
    setTimeout(() => {
      // Return zeroes but allow upload to proceed after 4s (instead of 15s)
      resolve({ width: 0, height: 0, duration: 0 })
      cleanup()
    }, 4000)

    video.src = url
  })
}

export const uploadFile = createAsyncThunk(
  'uploads/upload',
  async (file, { dispatch, rejectWithValue }) => {
    try {
      // Create a new AbortController for this upload
      if (currentAbortController) currentAbortController.abort();
      currentAbortController = new AbortController()
      const signal = currentAbortController.signal;

      const formData = new FormData()
      formData.append('file', file)

      // Extract media dimensions before upload (now with 4s timeout)
      let dimensions = { width: 0, height: 0, duration: 0 }
      if (file.type.startsWith('image/')) {
        const url = URL.createObjectURL(file)
        const img = new window.Image()
        dimensions = await new Promise((resolve) => {
          img.onload = () => {
            URL.revokeObjectURL(url)
            resolve({ width: img.width, height: img.height, duration: 0 })
          }
          img.onerror = () => {
            URL.revokeObjectURL(url)
            resolve({ width: 0, height: 0, duration: 0 })
          }
          img.src = url
        })
      } else if (file.type.startsWith('video/')) {
        dimensions = await getVideoDimensions(file)
      }

      formData.append('metadata', JSON.stringify(dimensions))

      const data = await api.upload('/uploads', formData, {
        signal, // [NEW] Pass the abort signal
        onProgress: (percent) => {
          dispatch(setUploadProgress(percent))
        }
      })
      return data
    } catch (error) {
      if (error.message === 'cancelled') {
        return rejectWithValue('cancelled')
      }
      return rejectWithValue(error.message)
    }
  }
)

export const deleteUpload = createAsyncThunk(
  'uploads/delete',
  async (id, { rejectWithValue }) => {
    try {
      await api.delete(`/uploads/${id}`)
      return id
    } catch (error) {
      return rejectWithValue(error.message)
    }
  }
)

const initialState = {
  uploadedImages: {}, // id -> { id, name, url, metadata, uploadedAt }
  isFetching: false,
  fetchError: null,
  uploadingCount: 0,
  uploadProgress: 0, // Current upload progress (%)
  hasLargeUpload: false,
  uploadError: null,
  lastUploadedId: null,
}

/**
 * Normalize an asset record from the backend into our Redux-friendly shape.
 */
function normalizeAsset(item) {
  // Use metadata.mimeType from backend if available, fall back to type field
  const mimeType = item.metadata?.mimeType ||
    (item.type === 'video' ? 'video/mp4' : 'image/jpeg')

  return {
    id: item._id,
    name: item.name,
    // Use relative URL directly — Vite proxy handles /uploads in dev
    url: item.url,
    metadata: {
      ...item.metadata,
      type: mimeType,
    },
    uploadedAt: new Date(item.createdAt).getTime(),
  }
}

const uploadsSlice = createSlice({
  name: 'uploads',
  initialState,
  reducers: {
    clearUploadError: (state) => {
      state.uploadError = null
    },
    clearFetchError: (state) => {
      state.fetchError = null
    },
    setUploadProgress: (state, action) => {
      state.uploadProgress = action.payload
    },
    cancelUpload: (state) => {
      if (currentAbortController) {
        currentAbortController.abort()
        currentAbortController = null
      }
      state.uploadingCount = 0
      state.uploadProgress = 0
      state.hasLargeUpload = false
    },
  },
  extraReducers: (builder) => {
    builder
      // === Fetch uploads ===
      .addCase(fetchUploads.pending, (state) => {
        state.isFetching = true
        state.fetchError = null
      })
      .addCase(fetchUploads.fulfilled, (state, action) => {
        const images = {}
        if (Array.isArray(action.payload)) {
          action.payload.forEach(item => {
            images[item._id] = normalizeAsset(item)
          })
        }
        state.uploadedImages = images
        state.isFetching = false
      })
      .addCase(fetchUploads.rejected, (state, action) => {
        state.isFetching = false
        state.fetchError = action.payload || 'Failed to load uploads'
      })

      // === Upload file ===
      .addCase(uploadFile.pending, (state, action) => {
        state.uploadingCount += 1
        state.uploadProgress = 0
        // Check if this specific file is large (> 50MB)
        if (action.meta.arg.size > 50 * 1024 * 1024) {
          state.hasLargeUpload = true
        }
        state.uploadError = null
      })
      .addCase(uploadFile.fulfilled, (state, action) => {
        const item = action.payload
        const imageId = item._id
        state.uploadedImages[imageId] = normalizeAsset(item)
        state.uploadingCount = Math.max(0, state.uploadingCount - 1)
        state.uploadProgress = 0
        if (state.uploadingCount === 0) {
          state.hasLargeUpload = false
        }
        state.lastUploadedId = imageId
      })
      .addCase(uploadFile.rejected, (state, action) => {
        state.uploadingCount = Math.max(0, state.uploadingCount - 1)
        state.uploadProgress = 0
        if (state.uploadingCount === 0) {
          state.hasLargeUpload = false
        }
        state.uploadError = action.payload || 'Upload failed'
      })

      // === Delete upload ===
      .addCase(deleteUpload.fulfilled, (state, action) => {
        delete state.uploadedImages[action.payload]
        if (state.lastUploadedId === action.payload) {
          state.lastUploadedId = null
        }
      })
      .addCase(deleteUpload.rejected, (state, action) => {
        state.uploadError = action.payload || 'Failed to delete file'
      })
  },
})

export const { clearUploadError, clearFetchError, cancelUpload } = uploadsSlice.actions

// Selectors
export const selectUploadedImages = (state) => state.uploads.uploadedImages
export const selectUploadedImagesArray = createSelector(
  [selectUploadedImages],
  (uploadedImages) => Object.values(uploadedImages).sort((a, b) => b.uploadedAt - a.uploadedAt)
)
export const selectIsUploading = (state) => state.uploads.uploadingCount > 0
export const selectHasLargeUpload = (state) => state.uploads.hasLargeUpload
export const selectIsFetching = (state) => state.uploads.isFetching
export const selectUploadError = (state) => state.uploads.uploadError
export const selectFetchError = (state) => state.uploads.fetchError
export const selectLastUploadedId = (state) => state.uploads.lastUploadedId
export const selectUploadProgress = (state) => state.uploads.uploadProgress
const { setUploadProgress } = uploadsSlice.actions
export { setUploadProgress }

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

export default uploadsSlice.reducer
