import { useEffect, useRef, useCallback } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Provider } from 'react-redux'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { store } from '../store'
import { checkAuth, startMigration, updateMigrationProgress, migrationComplete, migrationFailed, resetMigration } from '../store/slices/authSlice'
import EditorPage from '../features/editor/pages/EditorPage'
import ExportPage from '../features/editor/pages/ExportPage'
import LoginPage from '../features/auth/pages/LoginPage'
import RegisterPage from '../features/auth/pages/RegisterPage'
import DashboardPage from '../features/dashboard/pages/DashboardPage'
import ErrorBoundary from '../components/ErrorBoundary'
import { ThemeProvider } from './context/ThemeContext'
import MigrationToast from '../components/MigrationToast'
import { hasProjectsToMigrate, migrateLocalProjects } from '../services/projectMigrationService'

function AppContent() {
  const dispatch = useDispatch()
  const { isAuthenticated, migration } = useSelector((state) => state.auth)
  const wasGuestRef = useRef(false)
  const migrationTriggeredRef = useRef(false)
  const cancelledRef = useRef(false)

  // Track whether the user was previously a guest (had local data or onboarding completed)
  useEffect(() => {
    if (!isAuthenticated && !migrationTriggeredRef.current) {
      const hasLocalProjects = hasProjectsToMigrate();
      const localAssetsStr = localStorage.getItem('vevara_guest_assets') || '[]';
      const hasLocalAssets = JSON.parse(localAssetsStr).length > 0;
      const localOnboardingCompleted = localStorage.getItem('vevara_onboarding_completed') === 'true';
      const localExampleIntroSeen = localStorage.getItem('vevara_seen_example_project_intro') === 'true';

      if (hasLocalProjects || hasLocalAssets || localOnboardingCompleted || localExampleIntroSeen) {
        wasGuestRef.current = true
      }
    }
  }, [isAuthenticated])

  const runMigration = useCallback(async () => {
    if (migrationTriggeredRef.current || cancelledRef.current) return
    migrationTriggeredRef.current = true
    cancelledRef.current = false

    // Migrate onboarding completion status if true in local storage
    const localOnboardingCompleted = localStorage.getItem('vevara_onboarding_completed') === 'true'
    if (localOnboardingCompleted) {
      try {
        const api = (await import('../api/client')).default
        await api.put('/auth/onboarding', { hasCompletedOnboarding: true })
        // Also update local storage user if exists
        const userString = localStorage.getItem('vevara_user')
        if (userString) {
          const user = JSON.parse(userString)
          user.hasCompletedOnboarding = true
          localStorage.setItem('vevara_user', JSON.stringify(user))
        }
      } catch (error) {
        console.error('[Migration] Failed to migrate onboarding status:', error)
      }
    }

    // Migrate example project intro status if true in local storage
    const localExampleIntroSeen = localStorage.getItem('vevara_seen_example_project_intro') === 'true'
    if (localExampleIntroSeen) {
      try {
        const api = (await import('../api/client')).default
        await api.put('/auth/example-intro', { hasSeenExampleProjectIntro: true })
        // Also update local storage user if exists
        const userString = localStorage.getItem('vevara_user')
        if (userString) {
          const user = JSON.parse(userString)
          user.hasSeenExampleProjectIntro = true
          localStorage.setItem('vevara_user', JSON.stringify(user))
        }
      } catch (error) {
        console.error('[Migration] Failed to migrate example project intro status:', error)
      }
    }

    const localAssetRecords = await import('../services/localAssetService').then(m => m.getAllLocalAssetRecords())
    const localProjects = await import('../services/localProjectService').then(m => m.getAllFullProjects())

    const totalItems = localAssetRecords.length + localProjects.length
    if (totalItems === 0) {
      dispatch(migrationComplete({ progress: 0, errors: [] }))
      return
    }

    dispatch(startMigration({
      total: totalItems,
      currentItem: 'Starting migration...',
      hasProjects: localProjects.length > 0,
      hasAssets: localAssetRecords.length > 0,
    }))

    const errors = []
    let completed = 0
    const assetMap = {} // Maps local assetId to remote file URL

    const api = (await import('../api/client')).default

    // Phase 1: Upload assets
    for (const record of localAssetRecords) {
      if (cancelledRef.current) {
        dispatch(resetMigration())
        return
      }

      dispatch(updateMigrationProgress({
        progress: completed,
        currentItem: `Moving asset "${record.name || 'Unnamed Asset'}"...`,
      }))

      try {
        const blob = new Blob([record.data], { type: record.type })
        const file = new File([blob], record.name, { type: record.type })
        
        const formData = new FormData()
        formData.append('file', file)
        
        // Retrieve metadata and thumbnail from local storage guest assets
        let metadata = { width: 0, height: 0, duration: 0 }
        try {
          const guestAssets = JSON.parse(localStorage.getItem('vevara_guest_assets') || '[]')
          const found = guestAssets.find(a => a.id === record.id || a._id === record.id)
          if (found && found.metadata) {
            metadata = found.metadata
          } else {
            // Fallback: extract metadata from file
            const { getImageThumbnail, getVideoDimensions, getAudioMetadata } = await import('../store/slices/uploadsSlice')
            if (file.type.startsWith('image/')) {
              metadata = await getImageThumbnail(file)
            } else if (file.type.startsWith('video/')) {
              metadata = await getVideoDimensions(file)
            } else if (file.type.startsWith('audio/')) {
              const audioMeta = await getAudioMetadata(file)
              metadata = { width: 0, height: 0, duration: audioMeta.duration, waveform: audioMeta.waveform || [] }
            }
          }
        } catch (_) {}
        formData.append('metadata', JSON.stringify(metadata))

        const response = await api.upload('/uploads', formData)

        if (response && (response.url || response.fileUrl)) {
          assetMap[record.id] = response.url || response.fileUrl
        }
        completed++
      } catch (error) {
        errors.push({ asset: record.name, error: error.message })
        completed++
      }
    }

    // Phase 2: Upload projects (rehydrated with new asset URLs)
    for (const project of localProjects) {
      if (cancelledRef.current) {
        dispatch(resetMigration())
        return
      }

      dispatch(updateMigrationProgress({
        progress: completed,
        currentItem: `Moving project "${project.name || 'Untitled Project'}"...`,
      }))

      try {
        // Rewrite project layers to remote URLs (supports normal layers & card frame layers)
        const migratedLayers = {}
        if (project.layers) {
          for (const [layerId, layer] of Object.entries(project.layers)) {
            if (layer && layer.data) {
              let updatedData = { ...layer.data }
              let needsUpdate = false

              if (layer.type === 'frame') {
                const frontLocalId = layer.data._localAssetId
                const backLocalId = layer.data.backLocalAssetId
                if (frontLocalId && assetMap[frontLocalId]) {
                  updatedData.assetUrl = assetMap[frontLocalId]
                  updatedData._localAssetId = undefined
                  needsUpdate = true
                }
                if (backLocalId && assetMap[backLocalId]) {
                  updatedData.backAssetUrl = assetMap[backLocalId]
                  updatedData.backLocalAssetId = undefined
                  needsUpdate = true
                }
              } else {
                const localId = layer.data._localAssetId || layer.data.assetId
                if (localId && assetMap[localId]) {
                  updatedData.url = assetMap[localId]
                  updatedData.src = assetMap[localId]
                  updatedData._localAssetId = undefined
                  needsUpdate = true
                }
              }

              if (needsUpdate) {
                migratedLayers[layerId] = {
                  ...layer,
                  data: updatedData
                }
                continue
              }
            }
            migratedLayers[layerId] = layer
          }
        }

        // Rewrite project audio tracks to remote URLs
        const migratedAudioTracks = []
        if (project.audioTracks) {
          for (const track of project.audioTracks) {
            const localId = track._localAssetId || track.assetId
            if (localId && assetMap[localId]) {
              migratedAudioTracks.push({
                ...track,
                assetUrl: assetMap[localId],
                _localAssetId: undefined,
              })
            } else {
              migratedAudioTracks.push(track)
            }
          }
        }

        await api.post('/projects', {
          name: project.name || 'Untitled Project',
          data: {
            scenes: project.scenes || [],
            layers: migratedLayers,
            sceneMotionFlows: project.sceneMotionFlows || {},
            audioTracks: migratedAudioTracks,
            aspectRatio: project.aspectRatio || '16:9',
          },
          thumbnail: project.thumbnail || null,
        })
        completed++
      } catch (error) {
        errors.push({ project: project.name, error: error.message })
        completed++
      }
    }

    dispatch(updateMigrationProgress({ progress: completed }))

    if (cancelledRef.current) {
      dispatch(resetMigration())
      return
    }

    // Clean up local storage after successful migration
    if (errors.length === 0) {
      try {
        const { clearAllProjects } = await import('../services/localProjectService')
        clearAllProjects()
        const { clearAllAssets } = await import('../services/localAssetService')
        await clearAllAssets()
        localStorage.removeItem('vevara_seen_example_project_intro')
      } catch (cleanupErr) {
        console.error('[Migration] Cleanup failed:', cleanupErr)
      }
    }

    dispatch(migrationComplete({ progress: completed, errors }))
  }, [dispatch])

  // Trigger migration when user becomes authenticated after being a guest
  useEffect(() => {
    if (isAuthenticated && wasGuestRef.current && !migrationTriggeredRef.current) {
      // Small delay to let the DashboardPage load first
      const timer = setTimeout(() => runMigration(), 800)
      return () => clearTimeout(timer)
    }
  }, [isAuthenticated, runMigration])

  useEffect(() => {
    dispatch(checkAuth())
  }, [dispatch])

  const handleCancel = useCallback(() => {
    cancelledRef.current = true
    dispatch(resetMigration())
  }, [dispatch])

  const handleRetry = useCallback(() => {
    migrationTriggeredRef.current = false
    cancelledRef.current = false
    dispatch(resetMigration())
    setTimeout(() => runMigration(), 300)
  }, [dispatch, runMigration])

  const handleDismiss = useCallback(() => {
    dispatch(resetMigration())
  }, [dispatch])

  return (
    <>
      <Router>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/ads" element={<Navigate to="/dashboard" replace />} />
          <Route path="/sass" element={<Navigate to="/dashboard" replace />} />
          <Route path="/project/:projectId" element={<EditorPage />} />
          <Route path="/export" element={<ExportPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Router>

      <MigrationToast
        isActive={migration.isActive}
        progress={migration.progress}
        total={migration.total}
        currentItem={migration.currentItem}
        errors={migration.errors}
        completed={migration.completed}
        failed={migration.failed}
        hasProjects={migration.hasProjects}
        hasAssets={migration.hasAssets}
        onCancel={handleCancel}
        onRetry={handleRetry}
        onDismiss={handleDismiss}
      />
    </>
  )
}

function App() {
  return (
    <Provider store={store}>
      <ThemeProvider>
        <ErrorBoundary>
          <AppContent />
        </ErrorBoundary>
      </ThemeProvider>
    </Provider>
  )
}

export default App