import { createSlice, createSelector, createAsyncThunk } from '@reduxjs/toolkit'
import api from '../../api/client'

// [NEW] Module-level variable to store the abort controllers for multiple uploads
// Keyed by tempId. This avoids putting non-serializable values in the Redux state
let abortControllers = {};

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
export function getVideoDimensions(file) {
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
      // Seek to 1.0s (or 10% of duration if shorter) to avoid black start frame
      const seekTime = video.duration ? Math.min(1.0, video.duration * 0.1) : 1.0
      video.currentTime = seekTime
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

/**
 * Helper to extract dimensions and a highly compressed base64 thumbnail from an image file before uploading.
 * Keeps thumbnails extremely small (max 200px, 0.6 quality) to optimize payload size.
 */
export function getImageThumbnail(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const img = new window.Image()
    const cleanup = () => {
      URL.revokeObjectURL(url)
    }

    img.onload = () => {
      const maxDim = 200
      let w = img.width
      let h = img.height
      if (w > maxDim || h > maxDim) {
        const scale = maxDim / Math.max(w, h)
        w *= scale
        h *= scale
      }

      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      canvas.width = w
      canvas.height = h
      ctx.drawImage(img, 0, 0, w, h)

      const thumbnailDataUrl = canvas.toDataURL('image/jpeg', 0.6)
      resolve({
        width: img.width || 0,
        height: img.height || 0,
        duration: 0,
        thumbnail: thumbnailDataUrl
      })
      cleanup()
    }

    img.onerror = () => {
      resolve({ width: 0, height: 0, duration: 0 })
      cleanup()
    }

    img.src = url
  })
}


/**
 * Extract duration and waveform data from an audio file before uploading.
 * Uses the Web Audio API (no external library).
 * Returns { duration, waveform: Float32Array→Array of 100 amplitude samples }
 */
export function getAudioMetadata(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const cleanup = () => URL.revokeObjectURL(url)

    fetch(url)
      .then(r => r.arrayBuffer())
      .then(buf => {
        const ctx = new (window.AudioContext || window.webkitAudioContext)()
        return ctx.decodeAudioData(buf).then(decoded => {
          const duration = decoded.duration

          // Downsample channel 0 to 100 amplitude points for waveform display
          const channel = decoded.getChannelData(0)
          const sampleCount = 100
          const blockSize = Math.floor(channel.length / sampleCount)
          const waveform = []
          let maxVal = 0
          for (let i = 0; i < sampleCount; i++) {
            let sum = 0
            for (let j = 0; j < blockSize; j++) {
              sum += Math.abs(channel[i * blockSize + j])
            }
            const avg = sum / blockSize
            if (avg > maxVal) maxVal = avg
            waveform.push(avg)
          }

          // Normalize waveform array to [0.0, 1.0] range
          const normalizedWaveform = maxVal > 0
            ? waveform.map(v => Math.min(1, v / maxVal))
            : waveform

          ctx.close().catch(() => {})
          cleanup()
          resolve({ duration, waveform: normalizedWaveform })
        })
      })
      .catch(() => {
        cleanup()
        resolve({ duration: 0, waveform: [] })
      })
  })
}

export const uploadFile = createAsyncThunk(
  'uploads/upload',
  async ({ tempId, file, isPublic = true, assetType = 'image' }, { dispatch, rejectWithValue }) => {
    try {
      // Create a new AbortController for this upload
      if (abortControllers[tempId]) abortControllers[tempId].abort();
      abortControllers[tempId] = new AbortController()
      const signal = abortControllers[tempId].signal;

      const formData = new FormData()
      formData.append('file', file)
      formData.append('isPublic', isPublic)
      formData.append('assetType', assetType)

      // Extract media dimensions before upload
      let dimensions = { width: 0, height: 0, duration: 0 }
      if (file.type.startsWith('image/')) {
        dimensions = await getImageThumbnail(file)
      } else if (file.type.startsWith('video/')) {
        dimensions = await getVideoDimensions(file)
      } else if (file.type.startsWith('audio/')) {
        const audioMeta = await getAudioMetadata(file)
        dimensions = { width: 0, height: 0, duration: audioMeta.duration, waveform: audioMeta.waveform }
      }

      formData.append('metadata', JSON.stringify(dimensions))

      const data = await api.upload('/uploads', formData, {
        signal,
        onProgress: (percent) => {
          dispatch(updateUploadProgress({ tempId, progress: percent }))
        }
      })
      
      // Cleanup controller on success
      delete abortControllers[tempId];
      return { tempId, data }
    } catch (error) {
      delete abortControllers[tempId];
      if (error.message === 'cancelled') {
        return rejectWithValue({ tempId, error: 'cancelled' })
      }
      return rejectWithValue({ tempId, error: error.message })
    }
  }
)

/**
 * Thunk to orchestrate batch uploads with concurrency control.
 */
export const startBatchUpload = createAsyncThunk(
  'uploads/startBatch',
  async ({ files, isPublic = true, assetType = 'image' }, { dispatch }) => {
    const fileArray = Array.from(files)
    const uploads = fileArray.map(file => ({
      tempId: crypto.randomUUID(),
      file,
      name: file.name,
      size: file.size,
      type: file.type
    }))

    // Enqueue all immediately
    uploads.forEach(u => {
      dispatch(enqueueUpload({
        tempId: u.tempId,
        name: u.name,
        size: u.size,
        type: u.type
      }))
    })

    // Concurrency control: process max 3 at a time
    const limit = 3
    let active = 0
    let index = 0

    const next = async () => {
      if (index >= uploads.length) return
      
      const current = uploads[index++]
      active++
      
      try {
        await dispatch(uploadFile({ 
          tempId: current.tempId, 
          file: current.file,
          isPublic,
          assetType
        })).unwrap()
      } catch (err) {
        // Error handled by uploadFile.rejected
      } finally {
        active--
        await next()
      }
    }

    // Start initial batch
    const initialBatch = []
    for (let i = 0; i < Math.min(limit, uploads.length); i++) {
      initialBatch.push(next())
    }
    
    await Promise.all(initialBatch)
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
  uploadQueue: {}, // tempId -> { id: tempId, name, size, type, progress, status, error, createdAt }
  isFetching: false,
  fetchError: null,
  uploadingCount: 0,
  uploadProgress: 0, // Legacy: overall or last progress if needed
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
    (item.type === 'video' ? 'video/mp4' : item.type === 'audio' ? 'audio/mpeg' : 'image/jpeg')

  return {
    id: item._id,
    name: item.name,
    // Use relative URL directly — Vite proxy handles /uploads in dev
    url: item.url,
    isPublic: item.isPublic,
    assetType: item.assetType,
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
    enqueueUpload: (state, action) => {
      const { tempId, name, size, type } = action.payload
      state.uploadQueue[tempId] = {
        id: tempId,
        name,
        size,
        type,
        progress: 0,
        status: 'pending',
        createdAt: Date.now()
      }
    },
    updateUploadProgress: (state, action) => {
      const { tempId, progress } = action.payload
      if (state.uploadQueue[tempId]) {
        state.uploadQueue[tempId].progress = progress
        state.uploadQueue[tempId].status = 'uploading'
      }
    },
    cancelUpload: (state, action) => {
      const tempId = action.payload
      if (tempId && abortControllers[tempId]) {
        abortControllers[tempId].abort()
        delete abortControllers[tempId]
      } else if (!tempId) {
        // Cancel all
        Object.values(abortControllers).forEach(ctrl => ctrl.abort())
        abortControllers = {}
      }

      if (tempId) {
        delete state.uploadQueue[tempId]
      } else {
        state.uploadQueue = {}
        state.uploadingCount = 0
        state.uploadProgress = 0
        state.hasLargeUpload = false
      }
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
        // Check if this specific file is large (> 50MB) 
        // Note: action.meta.arg is { tempId, file }
        const { tempId, file } = action.meta.arg || {}
        if (tempId && !state.uploadQueue[tempId]) {
          state.uploadQueue[tempId] = {
            id: tempId,
            name: file?.name || 'File',
            size: file?.size || 0,
            type: file?.type || '',
            progress: 0,
            status: 'pending',
            createdAt: Date.now()
          }
        }
        if (action.meta.arg.file?.size > 50 * 1024 * 1024) {
          state.hasLargeUpload = true
        }
        state.uploadError = null
      })
      .addCase(uploadFile.fulfilled, (state, action) => {
        const { tempId, data: item } = action.payload
        const imageId = item._id
        state.uploadedImages[imageId] = normalizeAsset(item)
        state.uploadingCount = Math.max(0, state.uploadingCount - 1)
        
        // Remove from queue on success
        delete state.uploadQueue[tempId]
        
        if (state.uploadingCount === 0) {
          state.hasLargeUpload = false
          state.uploadProgress = 0
        }
        state.lastUploadedId = imageId
      })
      .addCase(uploadFile.rejected, (state, action) => {
        state.uploadingCount = Math.max(0, state.uploadingCount - 1)
        const { tempId, error } = action.payload || {}
        
        if (tempId && state.uploadQueue[tempId]) {
          state.uploadQueue[tempId].status = 'failed'
          state.uploadQueue[tempId].error = error || 'Upload failed'
        }

        if (state.uploadingCount === 0) {
          state.hasLargeUpload = false
          state.uploadProgress = 0
        }
        state.uploadError = error || 'Upload failed'
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

export const { 
  clearUploadError, 
  clearFetchError, 
  cancelUpload, 
  enqueueUpload, 
  updateUploadProgress 
} = uploadsSlice.actions

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
export const selectUploadQueue = (state) => state.uploads.uploadQueue
export const selectUploadQueueArray = createSelector(
  [selectUploadQueue],
  (queue) => Object.values(queue).sort((a, b) => b.createdAt - a.createdAt)
)
const { setUploadProgress } = uploadsSlice.actions
export { setUploadProgress }

export const selectImageCount = createSelector(
  [selectUploadedImagesArray],
  (images) => images.filter(img => (img.metadata?.type?.startsWith('image/') || img.type === 'image') && img.assetType === 'image').length
)

export const selectIconCount = createSelector(
  [selectUploadedImagesArray],
  (images) => images.filter(img => (img.metadata?.type?.startsWith('image/') || img.type === 'image') && img.assetType === 'icon').length
)

export const selectVideoCount = createSelector(
  [selectUploadedImagesArray],
  (images) => images.filter(img => img.metadata?.type?.startsWith('video/') || img.type === 'video').length
)

export const selectAudioCount = createSelector(
  [selectUploadedImagesArray],
  (images) => images.filter(img => img.metadata?.type?.startsWith('audio/') || img.assetType === 'audio').length
)

export const selectAudioAssetsArray = createSelector(
  [selectUploadedImagesArray],
  (images) => images.filter(img => img.metadata?.type?.startsWith('audio/') || img.assetType === 'audio')
)

export const selectTotalCount = createSelector(
  [selectUploadedImagesArray],
  (images) => images.length
)

export default uploadsSlice.reducer
