import { useEffect, useRef, useState, useCallback } from 'react'
import { createApp } from '../../engine/pixi/createApp'


/**
 * Hook to manage the Pixi.js canvas lifecycle and application instance.
 * Creates and initializes the PIXI application, viewport, and containers.
 * Handles canvas resizing, zoom management, and provides access to the PIXI app instance.
 * Manages the separation between world coordinates and screen coordinates.
 */
export function usePixiCanvas(containerRef, { width, height, worldWidth, worldHeight, zoom = 100 }) {
  const appRef = useRef(null)
  const [isReady, setIsReady] = useState(false)
  const [error, setError] = useState(null)
  const [retryCount, setRetryCount] = useState(0)

  // Create canvas only once - don't recreate on resize
  useEffect(() => {
    if (!containerRef.current) return
    if (appRef.current) return // Already created, don't recreate

    let isMounted = true
    let pendingApp = null

    const init = async () => {
      try {
        const result = await createApp({
          width: width || 800,
          height: height || 600,
          worldWidth,
          worldHeight,
        })

        if (!isMounted) {
          result.app.destroy({ children: true, texture: true })
          return
        }

        const { app, viewport, stageContainer, layersContainer } = result
        pendingApp = app

        // Mount the canvas to the container
        app.canvas.style.width = '100%'
        app.canvas.style.height = '100%'
        app.canvas.style.display = 'block'
        app.canvas.style.touchAction = 'none' // Prevent browser scrolling on mobile
        containerRef.current.appendChild(app.canvas)

        appRef.current = { app, viewport, stageContainer, layersContainer }
        setIsReady(true)
      } catch (error) {
        if (!isMounted) return
        console.error('Failed to initialize Pixi.js application:', error)
        setError(error)
        setIsReady(false)

        if (retryCount < 3) {
          const delay = Math.pow(2, retryCount) * 1000
          setTimeout(() => {
            if (isMounted) setRetryCount(prev => prev + 1)
          }, delay)
        }
      }
    }

    init()

    return () => {
      isMounted = false
      if (appRef.current?.app) {
        const { app } = appRef.current
        if (containerRef.current && app.canvas && containerRef.current.contains(app.canvas)) {
          containerRef.current.removeChild(app.canvas)
        }
        // [FIX] Safety check before destroy
        if (app.renderer && !app.destroyed) {
          app.destroy({ children: true, texture: true })
        }
        appRef.current = null
      } else if (pendingApp) {
        // [FIX] Safety check for pending app
        if (pendingApp.renderer && !pendingApp.destroyed) {
          pendingApp.destroy({ children: true, texture: true })
        }
      }
      setIsReady(false)
    }
  }, [containerRef, retryCount])

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

  // Zoom handling moved to Stage.jsx for unified behavior

  return {
    pixiApp: appRef.current?.app,
    viewport: appRef.current?.viewport,
    stageContainer: appRef.current?.stageContainer,
    layersContainer: appRef.current?.layersContainer,
    isReady,
    error,
    retryCount,
    // Provide a manual retry function for external use
    retry: useCallback(() => {
      setError(null)
      setRetryCount(0)
      setIsReady(false)
    }, []),
  }
}

