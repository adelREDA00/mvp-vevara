/**
 * Creates and configures PIXI.js application with viewport for interactive canvas rendering.
 *
 * [STABILITY REWRITE]
 * PixiJS v8's `autoDetectRenderer` has a critical caching bug:
 * `isWebGLSupported()` stores its result in a module-scoped variable.
 * If WebGL contexts are temporarily exhausted (browsers cap at ~8-16 active
 * contexts), the check is permanently cached as `false` for the entire page
 * session. Every subsequent init falls through to CanvasRenderer → crash.
 *
 * The fix: we bypass `autoDetectRenderer` entirely by constructing a
 * `WebGLRenderer` directly and wiring it into `Application` ourselves.
 * This skips the cached support-check and the impossible CanvasRenderer
 * fallback chain entirely.
 */

import * as PIXI from 'pixi.js'
import { WebGLRenderer } from 'pixi.js'
import { Viewport } from 'pixi-viewport'

// ─── GPU Context Management ────────────────────────────────────────────────
// Release any orphaned WebGL contexts from the page.  Browsers enforce a
// hard limit (often 8–16 contexts); exhausting them causes ALL subsequent
// context creation to fail — including PixiJS's own support-detection canvas.

/**
 * Scavenges all `<canvas>` elements on the page and force-loses their
 * WebGL contexts so the browser frees the underlying GPU allocations.
 * This is the nuclear option — only use before a fresh init attempt.
 */
export function releaseOrphanedWebGLContexts() {
  try {
    const canvases = document.querySelectorAll('canvas')
    let released = 0
    canvases.forEach((canvas) => {
      // Skip canvases that are currently mounted inside our pixi-container
      if (canvas.closest('#pixi-container')) return
      try {
        const gl =
          canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: false }) ||
          canvas.getContext('webgl', { failIfMajorPerformanceCaveat: false })
        if (gl) {
          const ext = gl.getExtension('WEBGL_lose_context')
          if (ext) {
            ext.loseContext()
            released++
          }
        }
      } catch (_) {
        // Canvas may already be in a bad state — ignore
      }
    })
  } catch (_) {
    // DOM access can fail in edge cases (e.g. during page teardown)
  }
}

/**
 * Verifies that WebGL is truly available *right now* by creating a fresh
 * temporary canvas.  This does NOT rely on PixiJS's cached check.
 * Returns the context type string ('webgl2' | 'webgl') or null.
 */
function probeWebGLAvailability() {
  const testCanvas = document.createElement('canvas')
  testCanvas.width = 1
  testCanvas.height = 1

  for (const ctxType of ['webgl2', 'webgl']) {
    try {
      const gl = testCanvas.getContext(ctxType, {
        failIfMajorPerformanceCaveat: false,
        stencil: true,
      })
      if (gl) {
        // Clean up immediately so we don't waste a context slot
        const ext = gl.getExtension('WEBGL_lose_context')
        if (ext) ext.loseContext()
        return ctxType
      }
    } catch (_) {
      // try next type
    }
  }
  return null
}

// ──────────────────────────────────────────────────────────────────────────

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
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
  // Cap resolution at 2 to avoid memory issues on high-DPI mobile devices
  const defaultResolution = resolution || Math.min(baseDPR, 2)
  const fixedWorldWidth = worldWidth || width
  const fixedWorldHeight = worldHeight || height

  // Set global text resolution
  PIXI.TextStyle.defaultTextStyle.resolution = defaultResolution


  // ─── Phase 1: Verify WebGL availability ─────────────────────────────────
  // We probe WebGL ourselves (fresh canvas, no cache) to avoid PixiJS's
  // permanently-cached `isWebGLSupported()` returning a stale `false`.

  let probeResult = probeWebGLAvailability()

  if (!probeResult) {
    // WebGL is currently unavailable.  The most common cause is context
    // exhaustion.  Release orphaned contexts and retry once after a short
    // delay to give the GPU driver time to reclaim resources.
    console.warn('[PIXI] WebGL probe failed — releasing orphaned contexts and retrying')
    releaseOrphanedWebGLContexts()

    // Give the browser an event-loop tick + a short delay to finalize cleanup
    await new Promise((r) => setTimeout(r, 500))

    probeResult = probeWebGLAvailability()
    if (!probeResult) {
      throw new Error(
        'WebGL is unavailable on this device. Please close other browser tabs ' +
        'using GPU resources and try again, or enable hardware acceleration in ' +
        'your browser settings.'
      )
    }
  }



  // ─── Phase 2: Create renderer directly (bypass autoDetectRenderer) ──────
  // This is the key stability fix.  `Application.init()` calls
  // `autoDetectRenderer()` which uses a cached `isWebGLSupported()` check.
  // If that check ever returned false (even transiently), all future inits
  // fail with "CanvasRenderer is not yet implemented".
  //
  // By creating WebGLRenderer directly, we completely skip that code path.

  const app = new PIXI.Application()

  const rendererOptions = {
    width,
    height,
    backgroundColor: 0x0f1015,
    resolution: defaultResolution,
    autoDensity,
    failIfMajorPerformanceCaveat: false,
    powerPreference: isMobile ? 'low-power' : 'high-performance',
    antialias: true,
    premultipliedAlpha: true,
    hello: true, // Show renderer info in console for debugging
  }

  // Primary init — full quality
  let renderer
  try {
    renderer = new WebGLRenderer()
    await renderer.init(rendererOptions)
    app.renderer = renderer

    // Run Application plugins manually (TickerPlugin, etc.)
    // PixiJS registers these via the extension system and they are normally
    // called inside Application.init().  We invoke them here so the ticker,
    // resize plugin, etc. are still wired up correctly.
    PIXI.Application._plugins.forEach((plugin) => {
      plugin.init.call(app, rendererOptions)
    })

  } catch (primaryError) {
    console.warn('[PIXI] Primary init failed, trying low-power fallback:', primaryError)

    // Clean up the failed renderer
    try {
      if (renderer && !renderer.destroyed) renderer.destroy(true)
    } catch (_) { }

    // Fallback: low-power, no antialias, resolution 1
    const fallbackOptions = {
      width,
      height,
      backgroundColor: 0x0f1015,
      antialias: false,
      resolution: 1,
      autoDensity: false,
      failIfMajorPerformanceCaveat: false,
      powerPreference: 'low-power',
      hello: true,
    }

    try {
      renderer = new WebGLRenderer()
      await renderer.init(fallbackOptions)
      app.renderer = renderer

      PIXI.Application._plugins.forEach((plugin) => {
        plugin.init.call(app, fallbackOptions)
      })

      console.log(`[PIXI] Fallback init successful: ${renderer.name}`)
    } catch (fallbackError) {
      console.error('[PIXI] Fallback init also failed:', fallbackError)
      try {
        if (renderer && !renderer.destroyed) renderer.destroy(true)
      } catch (_) { }
      throw new Error(
        `Graphics engine failed to start: ${fallbackError.message}. ` +
        `Try closing other GPU-heavy tabs or restarting your browser.`
      )
    }
  }

  // ─── Phase 3: Configure stability settings ─────────────────────────────

  // Texture Garbage Collection
  if (app.renderer.textureGC) {
    app.renderer.textureGC.maxIdle = 30000
    app.renderer.textureGC.checkCountMax = 100
  }

  // Cap ticker to 60 fps — on 120/144 Hz monitors PIXI defaults to the
  // display refresh rate which doubles GPU work and increases TDR risk.
  app.ticker.maxFPS = 60
  // Prevent PIXI from "catching up" with a massive delta after a tab switch
  // or a brief GPU stall.
  app.ticker.minFPS = 10

  // ─── Phase 4: WebGL context-loss listeners ──────────────────────────────
  if (app.renderer && app.renderer.canvas) {
    const canvas = app.renderer.canvas
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

  // ─── Phase 5: Create viewport and containers ───────────────────────────

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

  // ─── Artboard Background & Shadow ───────────────────────────────────
  const artboardContainer = new PIXI.Container()
  artboardContainer.label = 'artboard'
  viewport.addChild(artboardContainer)

  const artboardShadow = new PIXI.Graphics()
  artboardShadow.label = 'shadow'
  artboardContainer.addChild(artboardShadow)

  const artboardSurface = new PIXI.Graphics()
  artboardSurface.label = 'surface'
  artboardContainer.addChild(artboardSurface)

  drawArtboardBackground(artboardSurface, artboardShadow, fixedWorldWidth, fixedWorldHeight)

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
    artboardSurface,
    artboardShadow,
  }
}

/**
 * Draws/Redraws the artboard surface and its shadow.
 */
export function drawArtboardBackground(surface, shadow, width, height) {
  if (!surface || !shadow) return

  // 1. Draw Shadow
  // We use a simple blurred rect behind the artboard.
  shadow.clear()
  // Subtle offset to the bottom-right for a natural look
  shadow.rect(2, 2, width, height)
  shadow.fill({ color: 0x000000, alpha: 0.12 })

  if (!shadow.filters || shadow.filters.length === 0) {
    const blur = new PIXI.BlurFilter()
    blur.strength = 8
    blur.quality = 3
    shadow.filters = [blur]
  }

  // 2. Draw Artboard Surface (The "Paper")
  surface.clear()
  surface.rect(0, 0, width, height)
  // Clean premium white surface
  surface.fill(0xffffff)
}
