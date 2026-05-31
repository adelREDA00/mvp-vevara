import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { saveAs } from 'file-saver'
import { exportVideo } from '../utils/videoExport'
import api from '../../../api/client'

const preloadFonts = async (layers) => {
  if (!layers) return
  const fontFamilies = new Set()
  Object.values(layers).forEach((layer) => {
    if (layer && (layer.type === 'text' || layer.data?.enableFlow)) {
      const fontFamily = layer.data?.fontFamily
      if (fontFamily) {
        fontFamilies.add(fontFamily)
      }
    }
  })

  console.log('[ExportPage] Preloading font families:', Array.from(fontFamilies))

  const loadPromises = Array.from(fontFamilies).map(async (fontFamily) => {
    try {
      await document.fonts.load(`12px "${fontFamily}"`)
      await document.fonts.load(`bold 12px "${fontFamily}"`)
      await document.fonts.load(`italic 12px "${fontFamily}"`)
    } catch (err) {
      console.warn(`[ExportPage] Failed to load font face: ${fontFamily}`, err)
    }
  })

  await Promise.all(loadPromises)

  try {
    await document.fonts.ready
    console.log('[ExportPage] Browser font faces are fully loaded.')
  } catch (e) {
    console.warn('[ExportPage] Warning waiting for fonts ready:', e)
  }
}

export default function ExportPage() {
  const [searchParams] = useSearchParams()
  const exportId = searchParams.get('id')
  const projectId = searchParams.get('projectId')
  const format = searchParams.get('format') || 'mp4'
  const resolution = searchParams.get('resolution') || '720p'

  // GIF configurations
  const gifWidth = parseInt(searchParams.get('gifWidth') || '480', 10)
  const gifFps = parseInt(searchParams.get('gifFps') || '15', 10)
  const gifLoop = parseInt(searchParams.get('gifLoop') || '0', 10)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [projectData, setProjectData] = useState(null)

  const [exportState, setExportState] = useState({
    status: 'initializing', // 'initializing', 'rendering', 'encoding', 'completed', 'error'
    progress: 0,
  })

  const exportStartedRef = useRef(false)
  const abortControllerRef = useRef(null)
  const resultBlobRef = useRef(null)

  // Fetch project data (from sessionStorage first, fallback to DB if missing/reloaded)
  useEffect(() => {
    async function loadProject() {
      try {
        setLoading(true)
        setError(null)

        // 1. Try Session Storage (Fast Copy-on-Spawn Path)
        if (exportId) {
          const cached = sessionStorage.getItem(exportId)
          if (cached) {
            const parsed = JSON.parse(cached)
            setProjectData(parsed)
            setLoading(false)
            return
          }
        }

        // 2. Fallback to Database API (if authenticated / reloaded)
        if (projectId) {
          const project = await api.get(`/projects/${projectId}`)
          if (project && project.data) {
            setProjectData({
              projectName: project.name || 'Untitled Project',
              scenes: project.data.scenes || [],
              layers: project.data.layers || {},
              sceneMotionFlows: project.data.sceneMotionFlows || {},
              aspectRatio: project.data.aspectRatio || '16:9',
            })
            setLoading(false)
            return
          }
        }

        throw new Error('Export session invalid or expired. Please close this tab and try again.')
      } catch (err) {
        console.error('[ExportPage] Initialization failed:', err)
        setError(err.message || 'Failed to load project state.')
        setLoading(false)
      }
    }

    loadProject()
  }, [exportId, projectId])

  // Run the export pipeline
  useEffect(() => {
    if (loading || error || !projectData || exportStartedRef.current) return
    exportStartedRef.current = true

    const controller = new AbortController()
    abortControllerRef.current = controller

    async function runExport() {
      try {
        setExportState({ status: 'initializing', progress: 0 })

        // Preload all custom Google Fonts before starting the PIXI rendering pipeline
        await preloadFonts(projectData.layers)
        if (controller.signal.aborted) return

        // Derive timelineInfo (cumulative scene times)
        let cumulativeTime = 0
        const timelineInfo = projectData.scenes.map((scene) => {
          const duration = typeof scene?.duration === 'number' ? scene.duration : 10.0
          const startTime = cumulativeTime
          const endTime = cumulativeTime + duration
          cumulativeTime = endTime
          return {
            ...scene,
            startTime,
            endTime,
            duration,
          }
        })

        const opts = {
          scenes: projectData.scenes,
          layers: projectData.layers,
          sceneMotionFlows: projectData.sceneMotionFlows,
          timelineInfo,
          aspectRatio: projectData.aspectRatio || '16:9',
          resolution,
          fps: format === 'gif' ? gifFps : 30,
          format,
          gifOptions: {
            width: gifWidth,
            fps: gifFps,
            loop: gifLoop,
          },
          onProgress: (update) => {
            if (controller.signal.aborted) return
            setExportState({
              status: update.status,
              progress: update.progress,
            })
          },
          signal: controller.signal,
        }

        const blob = await exportVideo(opts)

        if (controller.signal.aborted) return

        resultBlobRef.current = blob

        // Auto download on completion
        const ext = format === 'gif' ? 'gif' : 'mp4'
        const filename = `${projectData.projectName || 'animation'}_${resolution}.${ext}`
        saveAs(blob, filename)

        setExportState({ status: 'completed', progress: 100 })

        // Clean up sessionStorage to free memory
        if (exportId) {
          try {
            sessionStorage.removeItem(exportId)
          } catch (e) { /* ignore */ }
        }
      } catch (err) {
        if (err.message === 'cancelled') {
          console.log('[ExportPage] Export was cancelled.')
          return
        }
        console.error('[ExportPage] Export failed:', err)
        setExportState({ status: 'error', progress: 0 })
        setError(err.message || 'An error occurred during video rendering.')
      }
    }

    runExport()

    return () => {
      // Abort export on unmount
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }
  }, [loading, error, projectData, format, resolution, gifWidth, gifFps, gifLoop, exportId])

  const handleDownload = useCallback(() => {
    if (!resultBlobRef.current || !projectData) return
    const ext = format === 'gif' ? 'gif' : 'mp4'
    const filename = `${projectData.projectName || 'animation'}_${resolution}.${ext}`
    saveAs(resultBlobRef.current, filename)
  }, [projectData, format, resolution])

  const handleClose = useCallback(() => {
    window.close()
  }, [])

  const handleReturn = useCallback(() => {
    if (projectId) {
      window.location.href = `/project/${projectId}`
    } else {
      window.close()
    }
  }, [projectId])

  const getStatusText = () => {
    switch (exportState.status) {
      case 'initializing':
        return 'Preparing your assets...'
      case 'rendering':
        return 'Rendering animation frames...'
      case 'encoding':
        return 'Compiling clean video chunk stream...'
      case 'completed':
        return 'Export completed!'
      case 'error':
        return 'Export failed'
      default:
        return 'Processing...'
    }
  }

  // Get resolution display string
  const getResolutionPixels = () => {
    if (format === 'gif') return `${gifWidth}px (width)`
    if (resolution === '720p') return '1280×720 px'
    if (resolution === '1440p') return '2560×1440 px'
    if (resolution === '2160p') return '3840×2160 px'
    return '1920×1080 px' // Default 1080p
  }

  // Render Loader / Setup Screen
  if (loading) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center bg-[#f3efff] font-sans text-[#7c4af0]">
        <div className="space-y-4 text-center">
          <p className="text-[14px] font-medium text-[#7c4af0]/80">Loading export snapshot...</p>
        </div>
      </div>
    )
  }

  // Render Error State
  if (error || exportState.status === 'error') {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center bg-[#f3efff] font-sans p-6">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-[0_10px_30px_rgba(124,74,240,0.06)] border border-[#7c4af0]/10">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100 mb-4">
            <svg className="h-6 w-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-gray-900 mb-2">Export Failed</h2>
          <p className="text-sm text-gray-500 mb-6 leading-relaxed">
            {error || 'An unexpected error occurred during rendering.'}
          </p>
          <div className="flex justify-center gap-3">
            <button
              onClick={() => window.location.reload()}
              className="px-5 py-2.5 text-xs font-bold text-white bg-[#7c4af0] hover:bg-[#6839d3] rounded-xl transition-all shadow-md shadow-[#7c4af0]/20"
            >
              Retry Export
            </button>
            <button
              onClick={handleClose}
              className="px-5 py-2.5 text-xs font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-xl transition-all"
            >
              Close Window
            </button>
          </div>
        </div>
      </div>
    )
  }

  const isCompleted = exportState.status === 'completed'

  return (
    <div className="relative flex h-screen w-screen flex-col bg-[#f3efff] font-sans text-[#7c4af0] select-none overflow-hidden">

      {/* 1. Stretched Horizontal Progress Bar at the absolute top */}
      <div className="absolute top-0 left-0 w-full h-[6px] bg-[#7c4af0]/10 z-50">
        <div
          className="h-full bg-[#7c4af0] transition-all duration-300 ease-out"
          style={{ width: `${exportState.progress}%` }}
        />
      </div>

      {/* 2. Top-Left Big Brand Header */}
      <div className="absolute top-8 left-6 md:top-12 md:left-16 z-40">
        <h1
          className="text-3xl md:text-4xl font-extrabold tracking-tight text-[#7c4af0] select-none"
          style={{ fontFamily: 'Poppins, sans-serif' }}
        >
          vevara
        </h1>
      </div>

      {/* 3. Left Panel Metadata & Options (Jitter Style) */}
      <div className="absolute top-24 left-6 right-6 md:right-auto md:top-36 md:left-16 max-w-sm flex flex-col space-y-6 md:space-y-10 z-40">

        {/* Export Properties */}
        <div className="space-y-2 md:space-y-4">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#7c4af0]/60">Export format</span>
            <div className="mt-0.5 font-semibold text-gray-900 text-sm">{getResolutionPixels()}</div>
          </div>
          <div className="flex gap-4 md:block">
            <div className="font-semibold text-gray-900 text-sm">{format.toUpperCase()}</div>
            <div className="font-semibold text-gray-900 text-sm md:mt-1">{format === 'gif' ? `${gifFps} fps` : '30 fps'}</div>
          </div>
        </div>

        {/* Dynamic Status / Prompts */}
        <div className="space-y-2">
          {!isCompleted ? (
            <>
              <div className="text-[13px] font-semibold text-gray-800">
                {getStatusText()}
              </div>
              <p className="text-[12px] font-medium text-[#7c4af0]/75 leading-relaxed bg-[#7c4af0]/5 p-3 rounded-lg border border-[#7c4af0]/10 max-w-[280px]">
                Don't leave this page for fast export
              </p>
            </>
          ) : (
            <div className="space-y-3 md:space-y-4 pt-1 md:pt-2">
              <div className="text-[14px] font-bold text-green-600 flex items-center gap-1.5">
                <svg className="h-5 w-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
                </svg>
                <span>Export Successful!</span>
              </div>
              <p className="text-[12px] text-gray-600 max-w-[280px] leading-relaxed">
                Your download should have started automatically.
              </p>

              <div>
                <button
                  onClick={handleDownload}
                  className="text-[12px] text-[#7c4af0] hover:text-[#5e32c2] font-bold underline underline-offset-4 transition text-left"
                >
                  If your download did not start automatically, click here to download
                </button>
              </div>

              <div className="pt-4 md:pt-6 w-full">
                <button
                  onClick={handleClose}
                  className="w-full py-4 md:py-5 text-sm font-extrabold text-[#7c4af0] bg-white hover:bg-gray-50 rounded-none transition-all tracking-widest uppercase"
                >
                  Close Window
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Cancellation route when processing */}
        {!isCompleted && (
          <div className="pt-2 md:pt-4">
            <button
              onClick={handleClose}
              className="text-[11px] font-bold text-[#7c4af0]/60 hover:text-[#7c4af0] transition hover:underline"
            >
              Cancel Export & Close
            </button>
          </div>
        )}
      </div>

      {/* 4. Bottom-Right Massive Progress Percentage (Jitter Style) */}
      <div
        className="absolute bottom-4 right-6 md:bottom-6 md:right-16 z-30 font-extrabold select-none pointer-events-none transition-all duration-300"
        style={{
          fontSize: 'clamp(80px, 18vw, 240px)',
          lineHeight: '0.8',
          letterSpacing: '-0.06em',
          color: '#7c4af0',
          opacity: 0.85
        }}
      >
        {exportState.progress}%
      </div>

    </div>
  )
}
