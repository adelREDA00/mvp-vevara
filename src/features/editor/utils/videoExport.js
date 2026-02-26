import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'
import * as PIXI from 'pixi.js'
import { MotionEngine } from '../../engine/motion/MotionEngine'
import { createTextLayer, createShapeLayer, createImageLayer, createVideoLayer } from '../../engine/pixi/createLayer'

let ffmpeg = null

export const initFFmpeg = async (onLog = null) => {
    if (ffmpeg) return ffmpeg

    console.log('🧪 [FFmpeg] Step 1: Creating instance...')
    ffmpeg = new FFmpeg()

    if (onLog) {
        ffmpeg.on('log', ({ message }) => {
            onLog(message)
            console.log(`[FFmpeg Console] ${message}`)
        })
    }

    console.log('🧪 [FFmpeg] Step 2: Preparing URLs...')
    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm'

    try {
        console.log('🧪 [FFmpeg] Step 3: Calling ffmpeg.load()...')
        // We wrap load in a timeout since it can hang indefinitely if SharedArrayBuffer is blocked
        const loadPromise = ffmpeg.load({
            coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
            wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
        })

        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('FFmpeg load timeout - possible SharedArrayBuffer blockage')), 15000)
        )

        await Promise.race([loadPromise, timeoutPromise])
        console.log('✅ [FFmpeg] Step 4: Load success!')
    } catch (error) {
        console.error('❌ [FFmpeg] Load failed or timed out:', error)
        if (error.message.includes('timeout')) {
            console.error('💡 TIP: This usually means the browser is blocking SharedArrayBuffer. Ensure you RESTART the dev server and refresh.')
        }
        throw error
    }

    return ffmpeg
}

/**
 * Captures the project frame by frame and encodes it to a video.
 */
export const exportVideo = async ({
    scenes,
    layers,
    sceneMotionFlows,
    timelineInfo,
    aspectRatio = '16:9',
    resolution = '1080p',
    fps = 30,
    onProgress = null
}) => {
    const ffmpeg = await initFFmpeg()

    // 1. Calculate target dimensions based on project aspect ratio
    const [widthRatio, heightRatio] = aspectRatio.split(':').map(Number)
    const projectAspect = widthRatio / heightRatio

    // Base standard world dimensions (matches useWorldDimensions.js logic)
    let worldWidth, worldHeight
    if (projectAspect >= 1) {
        // Landscape or Square
        worldHeight = 1080
        worldWidth = Math.round(worldHeight * projectAspect)
    } else {
        // Portrait
        worldWidth = 1080
        worldHeight = Math.round(worldWidth / projectAspect)
    }

    // Determine target export dimensions based on selected resolution height
    let targetHeight = 1080
    if (resolution === '720p') targetHeight = 720
    else if (resolution === '1440p') targetHeight = 1440
    else if (resolution === '2160p') targetHeight = 2160

    let targetWidth = Math.round(targetHeight * projectAspect)

    // FFmpeg requires dimensions to be even numbers
    targetWidth = targetWidth % 2 === 0 ? targetWidth : targetWidth - 1
    targetHeight = targetHeight % 2 === 0 ? targetHeight : targetHeight - 1

    console.log(`🎬 Exporting: ${targetWidth}x${targetHeight} (${aspectRatio}) at ${fps}fps`)

    // 2. Setup hidden Pixi app
    console.log('🎨 Export: Initializing Pixi Application...')
    const app = new PIXI.Application()
    await app.init({
        width: targetWidth,
        height: targetHeight,
        backgroundColor: 0x000000,
        antialias: true,
        preserveDrawingBuffer: true,
        resolution: 1,
    })
    console.log('🎨 Export: Pixi App Ready')

    const stageContainer = new PIXI.Container()
    app.stage.addChild(stageContainer)
    stageContainer.scale.set(targetWidth / worldWidth, targetHeight / worldHeight)

    // 3. Create a dedicated MotionEngine for export
    const exportEngine = new MotionEngine()
    const layerObjects = new Map()
    const videoElements = []

    // Load objects for the export stage respecting Z-order from Redux
    console.log('🏗️ Export: Loading layers in Z-order...')
    for (const scene of scenes) {
        if (!scene.layers) continue

        for (const layerId of scene.layers) {
            const layer = layers[layerId]
            if (!layer) continue

            let pixiObject = null
            try {
                if (layer.type === 'text') pixiObject = createTextLayer(layer)
                else if (layer.type === 'shape') pixiObject = createShapeLayer(layer)
                else if (layer.type === 'image') pixiObject = await createImageLayer(layer)
                else if (layer.type === 'video') {
                    pixiObject = await createVideoLayer(layer)
                    if (pixiObject._videoElement) {
                        videoElements.push(pixiObject._videoElement)
                    }
                } else if (layer.type === 'background') {
                    const graphics = new PIXI.Graphics()
                    graphics.rect(0, 0, worldWidth, worldHeight)
                    graphics.fill(layer.data?.color || 0x000000)
                    pixiObject = graphics
                }

                if (pixiObject) {
                    stageContainer.addChild(pixiObject)
                    layerObjects.set(layerId, pixiObject)
                    exportEngine.registerLayerObject(layerId, pixiObject, { sceneId: layer.sceneId })
                }
            } catch (e) {
                console.warn(`Export: Failed to load layer ${layerId}`, e)
            }
        }
    }

    // Load project motion into the export engine
    exportEngine.loadProjectMotionFlow(timelineInfo, sceneMotionFlows, layerObjects, {
        allLayers: layers
    })

    const totalDuration = timelineInfo.reduce((acc, s) => acc + s.duration, 0)
    const totalFrames = Math.ceil(totalDuration * fps)

    onProgress?.({ status: 'rendering', progress: 0 })

    // 4. Rendering Loop
    console.log(`🎬 Export: Starting render loop for ${totalFrames} frames...`)
    for (let frame = 0; frame <= totalFrames; frame++) {
        const time = frame / fps

        // [MANUAL VISIBILITY SYNC]
        // Ensure layers only appear during their respective scene's time range
        layerObjects.forEach((obj, id) => {
            const sceneId = obj._sceneId
            const range = exportEngine.sceneRanges.get(sceneId)
            if (range) {
                // Buffer of 0.001 to avoid flickering at boundaries
                obj.visible = (time >= range.startTime - 0.001 && time < range.endTime)
            }
        })

        // Seek engine
        exportEngine.seek(time)

        // [CRITICAL] Wait for videos to seek to exact frame
        if (videoElements.length > 0) {
            // Only wait for videos that are currently visible/active
            const activeVideos = videoElements.filter(v => {
                const layerId = [...layerObjects.entries()].find(([_, obj]) => obj._videoElement === v)?.[0]
                const obj = layerObjects.get(layerId)
                return obj && obj.visible
            })

            if (activeVideos.length > 0) {
                await Promise.all(activeVideos.map((video, idx) => {
                    if (video.seeking) {
                        return new Promise(resolve => {
                            const onSeeked = () => {
                                video.removeEventListener('seeked', onSeeked)
                                resolve()
                            }
                            video.addEventListener('seeked', onSeeked)
                            setTimeout(() => {
                                video.removeEventListener('seeked', onSeeked)
                                resolve()
                            }, 1000)
                        })
                    }
                    return Promise.resolve()
                }))
            }
        }

        // Force Pixi to render the frame
        app.render()

        // Capture to JPEG (lower size for FFmpeg FS)
        const base64 = app.canvas.toDataURL('image/jpeg', 0.95)
        // Extract binary data from data URL
        const binaryData = atob(base64.split(',')[1])
        const array = new Uint8Array(binaryData.length)
        for (let i = 0; i < binaryData.length; i++) array[i] = binaryData.charCodeAt(i)

        const fileName = `frame_${frame.toString().padStart(5, '0')}.jpg`
        await ffmpeg.writeFile(fileName, array)

        if (frame % 10 === 0) {
            console.log(`🎬 Export: Rendered frame ${frame}/${totalFrames} (${Math.round((frame / totalFrames) * 100)}%)`)
            onProgress?.({
                status: 'rendering',
                progress: Math.round((frame / totalFrames) * 90) // 0-90% for rendering
            })
        }
    }

    onProgress?.({ status: 'encoding', progress: 95 })

    // 5. Encoding
    console.log('📦 Export: Encoding with FFmpeg...')
    await ffmpeg.exec([
        '-framerate', fps.toString(),
        '-i', 'frame_%05d.jpg',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-pix_fmt', 'yuv420p',
        'output.mp4'
    ])
    console.log('📦 Export: Encoding Complete')

    onProgress?.({ status: 'encoding', progress: 100 })

    const data = await ffmpeg.readFile('output.mp4')
    const videoBlob = new Blob([data.buffer], { type: 'video/mp4' })

    // 6. Cleanup
    console.log('🧹 Export: Cleaning up resources (Passive Cleanup)...')
    try {
        exportEngine.destroy()

        // 1. Surgical removal: Disconnect all objects from the stage
        stageContainer.removeChildren()
        app.stage.removeChildren()

        // 2. Stop all tickers and activity
        app.ticker.stop()
        app.stop()

        // 3. Clear our reference maps
        layerObjects.clear()
        videoElements.length = 0

        // 4. Wait a bit for any internal Pixi processes to settle
        await new Promise(resolve => setTimeout(resolve, 300))

        // CRITICAL FIX: We will NOT call app.destroy() immediately.
        // This is to prevent the "geometry of null" crash in the main app 
        // which shares the same WebGL state/cache. 
        // We'll let the application be GC-ed or destroyed in a more controlled manner later if needed.
        // Instead, just remove the canvas from the "Export" PIXI instance's lifecycle.
        if (app.canvas && app.canvas.parentNode) {
            app.canvas.parentNode.removeChild(app.canvas)
        }

        console.log('🧹 Export: Cleanup Complete (App preserved to prevent crash)')
    } catch (e) {
        console.error('Export: Cleanup error', e)
    }

    // Cleanup FFmpeg FS
    for (let frame = 0; frame <= totalFrames; frame++) {
        try {
            await ffmpeg.deleteFile(`frame_${frame.toString().padStart(5, '0')}.jpg`)
        } catch (e) { }
    }
    await ffmpeg.deleteFile('output.mp4')

    return videoBlob
}
