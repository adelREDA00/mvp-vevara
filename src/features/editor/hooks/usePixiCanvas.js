import { useEffect, useRef, useState, useCallback } from 'react'
import * as PIXI from 'pixi.js'
import { createApp, drawArtboardBackground, releaseOrphanedWebGLContexts } from '../../engine/pixi/createApp'


/**
 * Hook to manage the Pixi.js canvas lifecycle and application instance.
 * Creates and initializes the PIXI application, viewport, and containers.
 * Handles canvas resizing, zoom management, and provides access to the PIXI app instance.
 * Manages the separation between world coordinates and screen coordinates.
 *
 * [STABILITY REWRITE]
 * The retry mechanism now uses an always-incrementing `initKey` so every call
 * to `retry()` is guaranteed to trigger the useEffect, even on the very first
 * failure.  Previous approach reset `retryCount` to 0 which could no-op.
 */
export function usePixiCanvas(containerRef, { width, height, worldWidth, worldHeight, zoom = 100 }) {
  const appRef = useRef(null)
  const [isReady, setIsReady] = useState(false)
  const [error, setError] = useState(null)

  // `initKey` is an always-incrementing counter.  Changing it forces the
  // initialization useEffect to re-run.  Unlike the old `retryCount` approach,
  // this guarantees a re-trigger even when the value was already 0.
  const initKeyRef = useRef(0)
  const [initKey, setInitKey] = useState(0)

  // Track auto-retry attempts (capped at 3) — separate from manual retries
  const autoRetryCountRef = useRef(0)

  // ─── Robust App Destruction ─────────────────────────────────────────────
  // Centralised cleanup to ensure GPU resources are released in every case.
  const destroyApp = useCallback((appInstance) => {
    if (!appInstance) return

    try {
      appInstance._isBeingDestroyed = true
      if (appInstance.ticker) appInstance.ticker.stop()

      // Force GPU context loss to immediately free the WebGL context slot
      if (appInstance.renderer?.canvas) {
        try {
          const gl =
            appInstance.renderer.canvas.getContext('webgl2') ||
            appInstance.renderer.canvas.getContext('webgl')
          if (gl) {
            const ext = gl.getExtension('WEBGL_lose_context')
            if (ext) ext.loseContext()
          }
        } catch (_) {}
      }

      // Remove canvas from DOM
      if (containerRef.current && appInstance.renderer?.canvas) {
        try {
          if (containerRef.current.contains(appInstance.renderer.canvas)) {
            containerRef.current.removeChild(appInstance.renderer.canvas)
          }
        } catch (_) {}
      }

      // Destroy the application
      if (appInstance.renderer && !appInstance.destroyed) {
        appInstance.destroy({ removeView: true, children: true, texture: true })
      }
    } catch (e) {
      console.warn('[usePixiCanvas] Error during app cleanup:', e)
    }
  }, [containerRef])

  // ─── Initialization Effect ──────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return

    let isMounted = true
    let pendingApp = null

    const init = async () => {
      // Clean up any existing app before re-initializing
      if (appRef.current?.app) {
        destroyApp(appRef.current.app)
        appRef.current = null
      }

      // Clear any stale child canvases left behind by a previous failed init
      if (containerRef.current) {
        const staleCanvases = containerRef.current.querySelectorAll('canvas')
        staleCanvases.forEach((c) => {
          try {
            const gl = c.getContext('webgl2') || c.getContext('webgl')
            if (gl) gl.getExtension('WEBGL_lose_context')?.loseContext()
            c.remove()
          } catch (_) {}
        })
      }

      try {
        const result = await createApp({
          width: width || 800,
          height: height || 600,
          worldWidth,
          worldHeight,
        })

        if (!isMounted) {
          destroyApp(result.app)
          return
        }

        const { app, viewport, stageContainer, layersContainer, artboardSurface, artboardShadow } = result
        pendingApp = app

        // Mount the canvas to the container
        if (app.renderer && app.renderer.canvas) {
          const canvas = app.renderer.canvas
          canvas.style.width = '100%'
          canvas.style.height = '100%'
          canvas.style.display = 'block'
          canvas.style.touchAction = 'none' // Prevent browser scrolling on mobile
          containerRef.current.appendChild(canvas)
        }

        appRef.current = { app, viewport, stageContainer, layersContainer, artboardSurface, artboardShadow }
        autoRetryCountRef.current = 0 // Reset auto-retry on success
        setError(null)
        setIsReady(true)
      } catch (error) {
        if (!isMounted) return

        // Ensure any partially initialized app is cleaned up
        if (pendingApp) {
          destroyApp(pendingApp)
          pendingApp = null
        }

        console.error('[usePixiCanvas] Failed to initialize PixiJS:', error)
        setError(error)
        setIsReady(false)

        // Auto-retry up to 3 times with exponential backoff
        if (autoRetryCountRef.current < 3) {
          const attempt = autoRetryCountRef.current
          const delay = Math.pow(2, attempt) * 1000 // 1s, 2s, 4s
          console.log(`[usePixiCanvas] Auto-retry ${attempt + 1}/3 in ${delay}ms`)

          setTimeout(() => {
            if (!isMounted) return
            autoRetryCountRef.current++
            // Release orphaned contexts before auto-retry
            releaseOrphanedWebGLContexts()
            initKeyRef.current++
            setInitKey(initKeyRef.current)
          }, delay)
        }
      }
    }

    init()

    return () => {
      isMounted = false
      if (appRef.current?.app) {
        destroyApp(appRef.current.app)
        appRef.current = null
      } else if (pendingApp) {
        destroyApp(pendingApp)
      }

      // Deep Cleanup: Clear global PIXI Assets cache to prevent memory leaks
      // when repeatedly switching between Dashboard and Editor.
      try {
        PIXI.Assets.unloadAll()
        if (PIXI.Assets.cache) {
          PIXI.Assets.cache.reset()
        }
      } catch (_) {
        // Ignore cleanup errors during unmount
      }

      setIsReady(false)
    }
  }, [containerRef, initKey, destroyApp])

  // Handle resize - separate from zoom to avoid performance issues
  useEffect(() => {
    if (!appRef.current || !width || !height) return

    // If not ready, skip but don't fail - allows recovery later
    if (!isReady) {
      console.warn('Skipping resize - Pixi.js app not ready yet')
      return
    }

    const { app, viewport } = appRef.current

    // Safety checks
    if (!app || !viewport) {
      console.warn('Skipping resize - app or viewport not available')
      return
    }
    if (!app.renderer || app.destroyed) {
      console.error('Skipping resize - app renderer destroyed')
      setError(new Error('App renderer destroyed during resize'))
      return
    }
    if (viewport.destroyed) {
      console.error('Skipping resize - viewport destroyed')
      setError(new Error('Viewport destroyed during resize'))
      return
    }

    try {
      // Resize the app renderer (screen/viewport size changes)
      app.renderer.resize(width, height)

      // Update viewport screen dimensions (visible viewport size)
      viewport.screenWidth = width
      viewport.screenHeight = height

      // World dimensions stay fixed - don't update them on resize
      // This ensures the world coordinate system remains constant
      // Only update if explicitly provided (for initial setup or aspect ratio changes)
      if (worldWidth !== undefined && worldHeight !== undefined) {
        viewport.worldWidth = worldWidth
        viewport.worldHeight = worldHeight
      }
    } catch (error) {
      console.error('Error resizing viewport:', error)
      setError(error)
    }
  }, [width, height, worldWidth, worldHeight, isReady])

  // Redraw artboard background when world dimensions change (e.g. aspect ratio shift)
  useEffect(() => {
    if (!appRef.current || !isReady) return
    const { artboardSurface, artboardShadow } = appRef.current
    if (artboardSurface && artboardShadow && worldWidth && worldHeight) {
      drawArtboardBackground(artboardSurface, artboardShadow, worldWidth, worldHeight)
    }
  }, [worldWidth, worldHeight, isReady])

  // Zoom handling moved to Stage.jsx for unified behavior

  // ─── Manual Retry ───────────────────────────────────────────────────────
  // The user can trigger this from the error UI.  It always forces a full
  // re-initialization cycle regardless of the current state.
  const retry = useCallback(() => {
    console.log('[usePixiCanvas] Manual retry requested')

    // 1. Clean up the current app if any
    if (appRef.current?.app) {
      destroyApp(appRef.current.app)
      appRef.current = null
    }

    // 2. Release orphaned GPU contexts across the page
    releaseOrphanedWebGLContexts()

    // 3. Reset auto-retry counter so we get fresh attempts
    autoRetryCountRef.current = 0

    // 4. Clear error/ready state
    setError(null)
    setIsReady(false)

    // 5. Increment initKey (always unique) to force the effect to re-run
    //    We use a small delay to give the GPU driver a moment to reclaim
    //    the contexts we just released.
    setTimeout(() => {
      initKeyRef.current++
      setInitKey(initKeyRef.current)
    }, 300)
  }, [destroyApp])

  return {
    pixiApp: appRef.current?.app,
    viewport: appRef.current?.viewport,
    stageContainer: appRef.current?.stageContainer,
    layersContainer: appRef.current?.layersContainer,
    artboardSurface: appRef.current?.artboardSurface,
    artboardShadow: appRef.current?.artboardShadow,
    isReady,
    error,
    retry,
  }
}
