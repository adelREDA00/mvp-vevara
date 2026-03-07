/**
 * Creates and configures PIXI.js application with viewport for interactive canvas rendering.
 */

import * as PIXI from 'pixi.js'
import { Viewport } from 'pixi-viewport'

export async function createApp(config = {}) {
  const {
    width = 800,
    height = 600,
    worldWidth,
    worldHeight,
    antialias = true,
    resolution,
    autoDensity = true,
  } = config

  const baseDPR = window.devicePixelRatio || 1
  // Cap resolution at 2 to avoid memory issues on high-DPI mobile devices
  // Use Math.min instead of Math.max to avoid forcing supersampling on standard screens
  const defaultResolution = resolution || Math.min(baseDPR, 2)
  const fixedWorldWidth = worldWidth || width
  const fixedWorldHeight = worldHeight || height

  // Set global text resolution
  PIXI.TextStyle.defaultTextStyle.resolution = defaultResolution

  const app = new PIXI.Application()

  try {
    // Try primary initialization
    await app.init({
      width,
      height,
      backgroundColor: 0x0f1015,
      resolution: defaultResolution,
      autoDensity,
      preference: 'webgl',
      // 'default' lets the browser/driver pick; 'high-performance' can cause
      // thermal throttling and context loss on low-end / integrated GPUs.
      powerPreference: 'default',
      antialias: true,
      premultipliedAlpha: true,
    })
  } catch (error) {
    console.warn('PixiJS primary init failed, trying fallback:', error)
    try {
      // Fallback: lower resolution and no antialias for weaker hardware
      await app.init({
        width,
        height,
        backgroundColor: 0x0f1015,
        antialias: false,
        resolution: 1,
        autoDensity: false,
        preference: 'webgl',
      })
    } catch (fallbackError) {
      console.error('PixiJS fallback init also failed:', fallbackError)
      if (app.renderer) {
        app.destroy({ removeView: true })
      }
      throw new Error(`Failed to initialize PixiJS: ${fallbackError.message}`)
    }
  }

  // ─── WebGL context-loss mitigation ────────────────────────────────────────
  // Cap the ticker to 60 fps.  On 120/144 Hz monitors PIXI defaults to the
  // display refresh rate, doubling GPU work per second on low-end hardware and
  // increasing the chance of a GPU TDR (which manifests as context loss).
  app.ticker.maxFPS = 60
  // Prevent PIXI from "catching up" with a massive delta after a tab switch or
  // a brief GPU stall — large deltas cause a single very expensive frame.
  app.ticker.minFPS = 10

  // Intercept context-lost events: calling preventDefault() signals to the
  // browser that we want a context-restore attempt instead of a permanent loss.
  //
  // NOTE: Some GPU drivers / browsers fire a spurious webglcontextlost event
  // immediately after context creation as part of their own setup handshake.
  // We defer listener registration by two animation frames so that transient
  // init-time event is already gone before we start watching — this stops the
  // false-positive warning that appears on every page load without any user
  // interaction.  Real context losses caused by heavy GPU usage come much later
  // and are always caught once the two-frame window has passed.
  if (app.canvas) {
    const canvas = app.canvas
    const attachContextListeners = () => {
      canvas.addEventListener('webglcontextlost', (event) => {
        // If the app is already destroyed or in the process of being destroyed, 
        // this is an intentional loss (e.g., page navigation) and should be silent.
        // CRITICAL: Do NOT call preventDefault() during intentional destruction —
        // it tells the browser to hold onto GPU resources, starving the new context.
        if (app.destroyed || app._isBeingDestroyed) return

        event.preventDefault()
        console.warn('[PIXI] WebGL context lost — attempting recovery')
      }, false)

      canvas.addEventListener('webglcontextrestored', () => {
        if (app.destroyed) return
        console.log('[PIXI] WebGL context restored')
      }, false)
    }
    // Double rAF: first frame lets the browser complete its own context setup,
    // second frame ensures any deferred GPU driver events have already fired.
    requestAnimationFrame(() => requestAnimationFrame(attachContextListeners))
  }
  // ──────────────────────────────────────────────────────────────────────────

  // Create viewport
  const viewportConfig = {
    screenWidth: width,
    screenHeight: height,
    worldWidth: fixedWorldWidth,
    worldHeight: fixedWorldHeight,
    events: app.renderer?.events
  }

  const viewport = new Viewport(viewportConfig)
  app.stage.addChild(viewport)
  viewport.moveCenter(fixedWorldWidth / 2, fixedWorldHeight / 2)

  // Viewport setup
  const computePadding = () => Math.max(fixedWorldWidth, fixedWorldHeight) * 0.5
  const updateViewportClamp = () => {
    const padding = computePadding()
    viewport.clamp({
      left: -padding,
      top: -padding,
      right: fixedWorldWidth + padding,
      bottom: fixedWorldHeight + padding,
    })
  }

  viewport.drag({ pressDrag: false, wheel: false }).pinch().decelerate()
  updateViewportClamp()
  viewport.on('zoomed', updateViewportClamp)
  viewport.clampZoom({ minScale: 0.1, maxScale: 4.0 })

  const layersContainer = new PIXI.Container()
  layersContainer.label = 'layers'
  viewport.addChild(layersContainer)

  const stageContainer = new PIXI.Container()
  stageContainer.label = 'stage'
  layersContainer.addChild(stageContainer)

  return {
    app,
    viewport,
    stageContainer,
    layersContainer,
  }
}

