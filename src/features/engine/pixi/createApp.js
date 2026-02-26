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
      backgroundColor: 0x0d1216,
      resolution: defaultResolution,
      autoDensity,
      preference: 'webgl',
      // 'high-performance' can cause crashes on some mobile devices due to power/thermal constraints
      // Default allows the browser to choose the best option
      powerPreference: 'default',
      antialias: true,
      premultipliedAlpha: true,
    })
  } catch (error) {
    console.warn('PixiJS primary init failed, trying fallback:', error)
    try {
      // Fallback init: Lower resolution and no antialias
      // Pixi v8 does NOT have a CanvasRenderer, so we just try with safer WebGL/WebGPU settings
      await app.init({
        width,
        height,
        backgroundColor: 0x0d1216,
        antialias: false,
        resolution: 1,
        autoDensity: false,
        preference: 'webgl',
      })
    } catch (fallbackError) {
      console.error('PixiJS fallback init also failed:', fallbackError)
      // [FIX] Safety check: Only destroy if renderer exists, otherwise just null out
      if (app.renderer) {
        app.destroy(true, { children: true, texture: true })
      }
      throw new Error(`Failed to initialize PixiJS: ${fallbackError.message}`)
    }
  }

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

