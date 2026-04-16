import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';
import * as PIXI from 'pixi.js';
import { MotionEngine } from '../../engine/motion/MotionEngine.js';
import { 
    createTextLayer, 
    createShapeLayer, 
    createImageLayer, 
    createFrameLayer, 
    attachAssetToFrame as attachAssetToFramePixi,
    attachBackAssetToFrame
} from '../../engine/pixi/createLayer.js';

let ffmpeg = null;

export const initFFmpeg = async (onLog = null) => {
    if (ffmpeg) return ffmpeg;
    ffmpeg = new FFmpeg();
    if (onLog) {
        ffmpeg.on('log', ({ message }) => {
            onLog(message);
        });
    }
    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
    try {
        const loadPromise = ffmpeg.load({
            coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
            wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
        });
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('FFmpeg load timeout')), 15000)
        );
        await Promise.race([loadPromise, timeoutPromise]);
    } catch (error) {
        throw error;
    }
    return ffmpeg;
};

/**
 * Creates an HTMLVideoElement completely isolated from the editor's video cache.
 * This prevents the export from interfering with editor playback state.
 */
async function createExportVideoElement(videoUrl) {
    const video = document.createElement('video');
    video.src = videoUrl;
    video.muted = true;
    video.loop = false;
    video.playsInline = true;
    video.preload = 'auto';
    video.autoplay = false;
    video.crossOrigin = 'anonymous';

    await new Promise((resolve, reject) => {
        if (video.readyState >= 3 && video.videoWidth > 0) {
            resolve();
            return;
        }

        let timeoutId;
        const cleanup = () => {
            video.removeEventListener('canplaythrough', onReady);
            video.removeEventListener('canplay', onReady);
            video.removeEventListener('loadeddata', onReady);
            video.removeEventListener('error', onError);
            if (timeoutId) clearTimeout(timeoutId);
        };
        const onReady = () => {
            if (video.videoWidth > 0 || video.readyState >= 2) {
                cleanup();
                resolve();
            }
        };
        const onError = () => {
            cleanup();
            reject(new Error(`Failed to load video: ${videoUrl}`));
        };

        video.addEventListener('canplaythrough', onReady);
        video.addEventListener('canplay', onReady);
        video.addEventListener('loadeddata', onReady);
        video.addEventListener('error', onError);

        timeoutId = setTimeout(() => {
            cleanup();
            if (video.readyState >= 2) {
                resolve();
            } else {
                reject(new Error(`Video load timeout: ${videoUrl}`));
            }
        }, 15000);
    });

    video.pause();
    return video;
}

/**
 * Builds a PIXI Container with video sprite using an ISOLATED video element.
 * Mirrors the structure of createVideoLayer but bypasses the shared cache.
 */
async function createExportVideoLayer(layer) {
    const url = layer.data?.url || layer.data?.src;
    if (!url) throw new Error('Video layer requires data.url or data.src');

    const videoElement = await createExportVideoElement(url);

    const texture = PIXI.Texture.from(videoElement, {
        resourceOptions: { autoPlay: false, muted: true, loop: false, playsinline: true }
    });

    const container = new PIXI.Container();
    const sprite = new PIXI.Sprite(texture);

    container._videoSprite = sprite;
    container._videoTexture = texture;
    container._videoElement = videoElement;
    container.addChild(sprite);

    const texW = videoElement.videoWidth || layer.data?.width || 300;
    const texH = videoElement.videoHeight || layer.data?.height || 200;
    const w = layer.width || texW;
    const h = layer.height || (layer.width ? (texH / texW) * layer.width : texH);

    container._mediaWidth = layer.mediaWidth ?? w;
    container._mediaHeight = layer.mediaHeight ?? h;
    container._originalWidth = w;
    container._originalHeight = h;

    const cropX = layer.cropX ?? 0;
    const cropY = layer.cropY ?? 0;
    const cropW = layer.cropWidth ?? w;
    const cropH = layer.cropHeight ?? h;

    sprite.width = layer.mediaWidth ?? w;
    sprite.height = layer.mediaHeight ?? h;
    sprite.anchor.set(0, 0);
    sprite.x = -cropX;
    sprite.y = -cropY;

    const mask = new PIXI.Graphics();
    mask.rect(0, 0, cropW, cropH);
    mask.fill(0xffffff);
    container.addChild(mask);
    container.mask = mask;
    container._cropMask = mask;

    const ax = layer.anchorX ?? 0.5;
    const ay = layer.anchorY ?? 0.5;
    container.pivot.set(cropW * ax, cropH * ay);

    container.x = layer.x || 0;
    container.y = layer.y || 0;
    container.alpha = layer.opacity ?? 1;

    container._sourceStartTime = layer.data?.sourceStartTime || 0;
    container._sourceEndTime = layer.data?.sourceEndTime || (layer.data?.duration || 0);

    if (layer.id) container.label = `layer-${layer.id}`;

    return container;
}

/**
 * Seeks a video element to an exact time and waits for the decoded frame.
 * [PERF] For sequential frames (natural playback order), uses requestVideoFrameCallback
 * which leverages the browser's hardware-accelerated decode pipeline instead of
 * expensive random-access I-frame seeking.
 */
const _hasRVFC = typeof HTMLVideoElement !== 'undefined' && 'requestVideoFrameCallback' in HTMLVideoElement.prototype;

function seekVideoToTime(video, targetTime, fps) {
    return new Promise(resolve => {
        if (Math.abs(video.currentTime - targetTime) < 0.01 && !video.seeking && video.readyState >= 2) {
            resolve();
            return;
        }

        // [PERF] Check if this is a sequential frame (natural playback order)
        // If the target is roughly one frame ahead, let the video play naturally
        // and use requestVideoFrameCallback for much faster decoding.
        if (_hasRVFC && fps) {
            const frameDelta = 1 / fps;
            const delta = targetTime - video.currentTime;
            const isSequential = delta > 0 && delta < frameDelta * 2.5;

            if (isSequential && !video.paused) {
                let timeoutId;
                const callbackId = video.requestVideoFrameCallback(() => {
                    if (timeoutId) clearTimeout(timeoutId);
                    resolve();
                });
                timeoutId = setTimeout(() => {
                    video.cancelVideoFrameCallback(callbackId);
                    // Fallback to seek if natural playback didn't deliver in time
                    video.currentTime = targetTime;
                    const onSeeked = () => {
                        video.removeEventListener('seeked', onSeeked);
                        resolve();
                    };
                    video.addEventListener('seeked', onSeeked);
                    setTimeout(() => { video.removeEventListener('seeked', onSeeked); resolve(); }, 3000);
                }, 200);
                return;
            }
        }

        let timeoutId;
        const onSeeked = () => {
            video.removeEventListener('seeked', onSeeked);
            if (timeoutId) clearTimeout(timeoutId);
            resolve();
        };

        video.addEventListener('seeked', onSeeked);
        video.currentTime = targetTime;

        timeoutId = setTimeout(() => {
            video.removeEventListener('seeked', onSeeked);
            resolve();
        }, 3000);
    });
}

/**
 * Captures the current canvas contents as JPEG bytes.
 * Uses toBlob for better performance, with toDataURL fallback.
 */
function captureFrame(canvas) {
    return new Promise(resolve => {
        canvas.toBlob(blob => {
            if (!blob) {
                const b64 = canvas.toDataURL('image/jpeg', 0.95);
                const bin = atob(b64.split(',')[1]);
                const arr = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
                resolve(arr);
                return;
            }
            blob.arrayBuffer().then(buf => resolve(new Uint8Array(buf)));
        }, 'image/jpeg', 0.95);
    });
}

/**
 * Collects all unmuted video layers in the project with their timing info.
 * Used to extract and mix audio tracks from original video files.
 */
function collectAudioSources(scenes, layers, timelineInfo) {
    const sources = [];
    for (const scene of scenes) {
        if (!scene.layers) continue;
        const sceneInfo = timelineInfo.find(s => s.id === scene.id);
        if (!sceneInfo) continue;

        for (const layerId of scene.layers) {
            const layer = layers[layerId];
            if (layer?.type !== 'video') continue;
            if (layer.data?.muted !== false) continue;

            const videoUrl = layer.data?.url || layer.data?.src;
            if (!videoUrl) continue;

            sources.push({
                videoUrl,
                sourceStartTime: layer.data.sourceStartTime || 0,
                duration: sceneInfo.duration,
                globalStartTime: sceneInfo.startTime,
            });
        }
    }
    return sources;
}

/**
 * Mixes audio from unmuted video sources into the rendered video.
 * Falls back to the silent video if audio mixing fails.
 */
async function mixAudioIntoVideo(ffmpegInst, audioSources, onProgress) {
    try {
        onProgress?.({ status: 'encoding', progress: 96 });

        // [MEMORY OPTIMIZATION] Deduplicate audio source files.
        // Multiple layers may use the same source video. Writing it once saves MEMFS.
        const writtenSources = new Map();

        for (let i = 0; i < audioSources.length; i++) {
            const url = audioSources[i].videoUrl;
            if (writtenSources.has(url)) {
                audioSources[i].fsName = writtenSources.get(url);
                continue;
            }

            const sessionId = ffmpegInst._session_id || 'v1';
            const fileName = `${sessionId}_audio_src_${i}.mp4`;
            const response = await fetch(url);
            const arrayBuffer = await response.arrayBuffer();
            await ffmpegInst.writeFile(fileName, new Uint8Array(arrayBuffer));
            
            writtenSources.set(url, fileName);
            audioSources[i].fsName = fileName;
        }

        onProgress?.({ status: 'encoding', progress: 97 });

        const sessionId = ffmpegInst._session_id || 'v1';
        const videoOnlyFile = `${sessionId}_video_only.mp4`;
        const outputFile = `${sessionId}_output.mp4`;

        const args = ['-i', videoOnlyFile];
        const filterParts = [];

        for (let i = 0; i < audioSources.length; i++) {
            const src = audioSources[i];
            args.push('-ss', src.sourceStartTime.toFixed(3));
            args.push('-t', src.duration.toFixed(3));
            args.push('-i', src.fsName);

            const delayMs = Math.round(src.globalStartTime * 1000);
            filterParts.push(`[${i + 1}:a]adelay=${delayMs}|${delayMs}[a${i}]`);
        }

        let filterComplex;
        if (audioSources.length === 1) {
            const delayMs = Math.round(audioSources[0].globalStartTime * 1000);
            filterComplex = `[1:a]adelay=${delayMs}|${delayMs}[aout]`;
        } else {
            const labels = audioSources.map((_, i) => `[a${i}]`).join('');
            filterComplex = filterParts.join('; ') +
                `; ${labels}amix=inputs=${audioSources.length}:duration=longest:dropout_transition=0[aout]`;
        }

        args.push('-filter_complex', filterComplex);
        args.push('-map', '0:v', '-map', '[aout]');
        args.push('-c:v', 'copy', '-c:a', 'aac');
        args.push(outputFile);

        await ffmpegInst.exec(args);

        try { await ffmpegInst.deleteFile(videoOnlyFile); } catch (e) { /* ignore */ }
        
        // Cleanup only unique file names
        const uniqueFiles = new Set(audioSources.map(s => s.fsName));
        for (const fileName of uniqueFiles) {
            try { await ffmpegInst.deleteFile(fileName); } catch (e) { /* ignore */ }
        }

        return true;
    } catch (audioError) {
        console.warn('Export: Audio mixing failed, falling back to silent video:', audioError);
        const sessionId = ffmpegInst._session_id || 'v1';
        const videoOnlyFile = `${sessionId}_video_only.mp4`;
        const outputFile = `${sessionId}_output.mp4`;
        try {
            const silentData = await ffmpegInst.readFile(videoOnlyFile);
            await ffmpegInst.writeFile(outputFile, silentData);
            await ffmpegInst.deleteFile(videoOnlyFile);
        } catch (e) { /* ignore */ }

        for (let i = 0; i < audioSources.length; i++) {
            try { await ffmpegInst.deleteFile(`${sessionId}_audio_src_${i}.mp4`); } catch (e) { /* ignore */ }
        }

        return false;
    }
}

/**
 * Safely cleans up all export-specific resources without affecting the editor.
 * Designed to be idempotent — safe to call multiple times or on partially-initialized state.
 *
 * CRITICAL — WHY WE NEVER CALL app.destroy() OR renderer.destroy():
 * PIXI v8 has global shared state for batch geometry (BatcherPipe), buffer systems,
 * and GPU program caches. Calling renderer.destroy() triggers runners.destroy.emit()
 * which tears down these global pools. The editor's renderer still depends on them,
 * so the editor crashes with "Cannot read properties of null (reading 'geometry')"
 * in BatcherPipe.execute on the next frame.
 *
 * Instead we:
 *   1. Stop the export ticker (no more render calls)
 *   2. Detach all children from the stage (removes references)
 *   3. Release the WebGL context via WEBGL_lose_context extension
 *   4. Remove the offscreen canvas from the DOM
 *   5. Null out all references and let GC handle the rest
 */
let _cleanupInProgress = false;
function cleanupExportResources(exportEngine, app, exportVideoElements, layerObjects) {
    if (_cleanupInProgress) return;
    _cleanupInProgress = true;

    try {
        // --- Export motion engine ---
        if (exportEngine && !exportEngine._destroyed) {
            try {
                exportEngine.destroy();
                exportEngine._destroyed = true;
            } catch (e) { /* ignore */ }
        }
    } catch (e) { /* ignore */ }

    // --- Export-isolated video elements (NOT shared with the editor) ---
    if (exportVideoElements && exportVideoElements.length > 0) {
        for (const video of exportVideoElements) {
            try {
                if (video) {
                    video.pause();
                    video.removeAttribute('src');
                    video.load();
                }
            } catch (e) { /* ignore */ }
        }
        exportVideoElements.length = 0;
    }

    try {
        if (app && !app._exportDestroyed) {
            app._exportDestroyed = true;

            // 1. Stop the ticker so no more render frames are scheduled
            try {
                if (app.ticker) {
                    app.ticker.stop();
                    app.ticker.destroy();
                }
            } catch (e) { /* ignore */ }

            // 2. Detach all layer objects from the render tree.
            //    We only removeChild — we do NOT call .destroy() on any PIXI
            //    objects because that can cascade into destroying shared GPU
            //    resources (geometry, buffers, programs) used by the editor.
            if (layerObjects && layerObjects.size > 0) {
                layerObjects.forEach((obj) => {
                    try {
                        if (!obj || obj.destroyed) return;
                        if (obj.parent) {
                            obj.parent.removeChild(obj);
                        }
                    } catch (e) { /* ignore */ }
                });
                layerObjects.clear();
            }

            // 3. Clear the stage's children
            try {
                if (app.stage) {
                    app.stage.removeChildren();
                }
            } catch (e) { /* ignore */ }

            // 4. Release the WebGL context directly.
            //    This frees GPU memory without going through PIXI's destroy
            //    pipeline which would corrupt the editor's shared state.
            try {
                if (app.canvas) {
                    const gl = app.canvas.getContext('webgl2') || app.canvas.getContext('webgl');
                    if (gl) {
                        const loseCtx = gl.getExtension('WEBGL_lose_context');
                        if (loseCtx) loseCtx.loseContext();
                    }
                }
            } catch (e) { /* ignore */ }

            // 5. Remove the offscreen canvas from the DOM
            try {
                if (app.canvas?.parentNode) {
                    app.canvas.parentNode.removeChild(app.canvas);
                }
            } catch (e) { /* ignore */ }

            // DO NOT call app.destroy() or app.renderer.destroy()
            // — that triggers PIXI's internal system runners which
            // destroy global BatcherPipe geometry shared with the editor.
        }
    } catch (e) {
        console.error('Export: Cleanup error', e);
    } finally {
        _cleanupInProgress = false;
    }
}

async function cleanupTempFiles(ffmpegInst, totalFramesNum, audioSourceCount, sessionId) {
    if (totalFramesNum > 0) {
        // We chunk in ~3 sec batches, max 180 frames per batch. Loop 200 just to be safe if aborted inside batch.
        const batchPromises = [];
        for (let i = 0; i <= 200; i++) {
            batchPromises.push(ffmpegInst.deleteFile(`${sessionId}_batch_${String(i).padStart(5, '0')}.jpg`).catch(() => { }));
        }
        await Promise.all(batchPromises);

        // Cleanup chunk.ts files in case of aborts before concatenation
        const maxChunks = Math.ceil(totalFramesNum / 10);
        const chunkPromises = [];
        for (let i = 0; i < maxChunks; i++) {
            chunkPromises.push(
                ffmpegInst.deleteFile(`${sessionId}_chunk_${String(i).padStart(3, '0')}.mp4`).catch(() => { })
            );
        }
        await Promise.all(chunkPromises);

        try { await ffmpegInst.deleteFile(`${sessionId}_concat.txt`); } catch (e) { /* ignore */ }
    }
    try { await ffmpegInst.deleteFile(`${sessionId}_output.mp4`); } catch (e) { /* ignore */ }
    try { await ffmpegInst.deleteFile(`${sessionId}_video_only.mp4`); } catch (e) { /* ignore */ }
    for (let i = 0; i < audioSourceCount; i++) {
        try { await ffmpegInst.deleteFile(`${sessionId}_audio_src_${i}.mp4`); } catch (e) { /* ignore */ }
    }
}

export const exportVideo = async ({
    scenes,
    layers,
    sceneMotionFlows,
    timelineInfo,
    aspectRatio = '16:9',
    resolution = '1080p',
    fps = 30,
    onProgress = null,
    signal = null,
    editorMotionControls = null
}) => {
    if (editorMotionControls?.isPlaying) {
        try { editorMotionControls.pauseAll(); } catch (e) { /* ignore */ }
    }

    const sessionId = `exp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const ffmpegInst = await initFFmpeg();
    ffmpegInst._session_id = sessionId; // Temporary stash for helper functions

    const [widthRatio, heightRatio] = aspectRatio.split(':').map(Number);
    const projectAspect = widthRatio / heightRatio;

    let worldWidth, worldHeight;
    if (projectAspect >= 1) {
        worldHeight = 1080;
        worldWidth = Math.round(worldHeight * projectAspect);
    } else {
        worldWidth = 1080;
        worldHeight = Math.round(worldWidth / projectAspect);
    }

    let targetHeight = 1080;
    if (resolution === '720p') targetHeight = 720;
    else if (resolution === '1440p') targetHeight = 1440;
    else if (resolution === '2160p') targetHeight = 2160;

    let targetWidth = Math.round(targetHeight * projectAspect);
    targetWidth = targetWidth % 2 === 0 ? targetWidth : targetWidth - 1;
    targetHeight = targetHeight % 2 === 0 ? targetHeight : targetHeight - 1;

    const audioSources = collectAudioSources(scenes, layers, timelineInfo);
    const hasAudio = audioSources.length > 0;

    let app = null;
    let exportEngine = null;
    let totalFramesNum = 0;
    const layerObjects = new Map();
    const exportVideoElements = [];

    try {
        if (signal?.aborted) throw new Error('cancelled');

        // Set global text resolution for export renderer
        PIXI.TextStyle.defaultTextStyle.resolution = 1;

        app = new PIXI.Application();
        await app.init({
            width: targetWidth,
            height: targetHeight,
            backgroundColor: 0x000000,
            antialias: true,
            preserveDrawingBuffer: true,
            roundPixels: true,
            resolution: 1,
            // [STABILITY] Force WebGL for exports as well to avoid WebGPU instability
            preference: 'webgl',
            hello: true
        });

        console.log(`[PIXI-EXPORT] Init successful: ${app.renderer.name}`);

        app.ticker.stop();

        const stageContainer = new PIXI.Container();
        app.stage.addChild(stageContainer);
        const scaleX = targetWidth / worldWidth;
        const scaleY = targetHeight / worldHeight;
        stageContainer.scale.set(scaleX, scaleY);

        exportEngine = new MotionEngine();
        // [EXPORT FIX] Disable internal media sync in the engine.
        // The export loop manually seeks each video frame-by-frame (see loop below).
        // If the engine also tries to sync, it creates a "double-seek" overhead that
        // overwhelms the decoder, causing the 33% hang.
        exportEngine.syncMedia = () => { };

        onProgress?.({ status: 'initializing', progress: 0 });

        for (const scene of scenes) {
            if (!scene.layers) continue;
            for (const layerId of scene.layers) {
                if (signal?.aborted) throw new Error('cancelled');

                const layer = layers[layerId];
                if (!layer) continue;

                let pixiObject = null;
                try {
                    if (layer.type === 'text') {
                        pixiObject = createTextLayer(layer);
                    } else if (layer.type === 'shape') {
                        pixiObject = createShapeLayer(layer);
                    } else if (layer.type === 'image') {
                        pixiObject = await createImageLayer(layer);
                    } else if (layer.type === 'video') {
                        pixiObject = await createExportVideoLayer(layer);
                        if (pixiObject._videoElement) {
                            exportVideoElements.push(pixiObject._videoElement);
                        }
                    } else if (layer.type === 'frame') {
                        pixiObject = createFrameLayer(layer);
                        
                        // Helper to load and attach an asset to a frame side
                        const setupFrameSide = async (url, side) => {
                            if (!url) return;
                            try {
                                const { loadTextureRobust } = await import('../../engine/pixi/textureUtils.js');
                                const texture = await loadTextureRobust(url);
                                if (!texture) return;
                                
                                const fw = layer.cropWidth ?? layer.width;
                                const fh = layer.cropHeight ?? layer.height;
                                
                                if (side === 'front') {
                                    attachAssetToFramePixi(pixiObject, texture, fw, fh);
                                    // Apply stored crop state from Redux for the front side
                                    const sprite = pixiObject._imageSprite;
                                    if (sprite) {
                                        sprite.width = layer.mediaWidth ?? fw;
                                        sprite.height = layer.mediaHeight ?? fh;
                                        sprite.x = -(layer.cropX ?? 0);
                                        sprite.y = -(layer.cropY ?? 0);
                                    }
                                } else {
                                    attachBackAssetToFrame(pixiObject, texture, fw, fh);
                                    // Back side currently uses default cover-fit from attachBackAssetToFrame.
                                    // If we ever store back-specific crops in Redux, we'd apply them here.
                                }
                                
                                if (pixiObject._cropMask) {
                                    const mask = pixiObject._cropMask;
                                    mask.clear();
                                    mask.rect(0, 0, fw, fh);
                                    mask.fill(0xffffff);
                                }

                                // If it's a video, track it for seeking
                                const source = texture.source;
                                if (source && source.resource instanceof HTMLVideoElement) {
                                    const video = source.resource;
                                    if (!exportVideoElements.includes(video)) {
                                        exportVideoElements.push(video);
                                    }
                                    
                                    // Store metadata for the manual seek loop
                                    video._layerSourceStartTime = layer.data?.sourceStartTime || 0;
                                    video._layerSourceEndTime = layer.data?.sourceEndTime || (layer.data?.duration || 0);
                                    video._parentLayer = pixiObject;
                                }
                            } catch (e) {
                                console.warn(`Export: Failed to load frame ${side} asset`, e);
                            }
                        };
                        
                        await setupFrameSide(layer.data?.assetUrl, 'front');
                        await setupFrameSide(layer.data?.backAssetUrl, 'back');
                    } else if (layer.type === 'background') {
                        const graphics = new PIXI.Graphics();
                        graphics.rect(0, 0, worldWidth, worldHeight);
                        graphics.fill(layer.data?.color || 0x000000);
                        pixiObject = graphics;
                        pixiObject.isBackground = true;

                        // [COLOR FIX] Store background metadata for redrawing during colorChange actions in export
                        pixiObject._storedWidth = worldWidth;
                        pixiObject._storedHeight = worldHeight;
                        pixiObject._storedAnchorX = 0;
                        pixiObject._storedAnchorY = 0;
                        pixiObject._storedColor = layer.data?.color || 0x000000;

                        if (layer.data?.imageUrl) {
                            try {
                                const { loadTextureRobust } = await import('../../engine/pixi/textureUtils.js');
                                const bgTexture = await loadTextureRobust(layer.data.imageUrl);
                                if (bgTexture) {
                                    const bgContainer = new PIXI.Container();
                                    bgContainer.addChild(graphics);

                                    // [COLOR FIX] Link the container to its background graphics for the color action
                                    bgContainer._backgroundGraphics = graphics;
                                    bgContainer._storedWidth = worldWidth;
                                    bgContainer._storedHeight = worldHeight;

                                    const bgSprite = new PIXI.Sprite(bgTexture);
                                    const scale = Math.max(worldWidth / bgTexture.width, worldHeight / bgTexture.height);
                                    bgSprite.scale.set(scale);
                                    bgSprite.x = (worldWidth - bgTexture.width * scale) / 2;
                                    bgSprite.y = (worldHeight - bgTexture.height * scale) / 2;
                                    bgContainer.addChild(bgSprite);
                                    pixiObject = bgContainer;
                                }
                            } catch (e) {
                                console.warn('Export: Failed to load background image', e);
                            }
                        }
                    }

                    if (pixiObject) {
                        // [EXPORT FIX] Apply base transform properties (rotation, scale) from the layer config.
                        // Most creation functions in createLayer.js only handle (x, y, alpha), 
                        // so we must explicitly apply rotation and scale here to ensure Frame 0 is correct.
                        pixiObject.rotation = (layer.rotation || 0) * (Math.PI / 180);
                        if (pixiObject.scale) {
                            pixiObject.scale.set(layer.scaleX ?? 1, layer.scaleY ?? 1);
                        }

                        stageContainer.addChild(pixiObject);
                        layerObjects.set(layerId, pixiObject);
                        exportEngine.registerLayerObject(layerId, pixiObject, { sceneId: layer.sceneId });
                    }
                } catch (e) {
                    console.warn(`Export: Failed to load layer ${layerId}:`, e);
                }
            }
        }

        const exportScale = targetWidth / worldWidth;
        exportEngine.loadProjectMotionFlow(timelineInfo, sceneMotionFlows, layerObjects, { 
            allLayers: layers,
            isExport: true,
            exportScale: exportScale
        });

        const totalDuration = timelineInfo.reduce((acc, s) => acc + s.duration, 0);
        totalFramesNum = Math.ceil(totalDuration * fps);

        onProgress?.({ status: 'rendering', progress: 0 });

        // [PERF] Start all export videos playing (muted) so sequential frame
        // capture via requestVideoFrameCallback can use hardware-accelerated decoding
        // instead of expensive random-access seeks for every frame.
        for (const video of exportVideoElements) {
            if (video) {
                video.muted = true;
                video.currentTime = 0;
                video.playbackRate = 1;
                try { await video.play(); } catch (e) { /* ignore autoplay blocks */ }
            }
        }

        // [PERF] Build video lookup indexes once before the loop instead of per-frame.
        // videoToLayerObj: video element -> PIXI container (reverse lookup)
        // sceneVideoMap: sceneId -> [{ video, obj }] (scene-grouped for fast iteration)
        const videoToLayerObj = new Map();
        const sceneVideoMap = new Map();
        for (const video of exportVideoElements) {
            if (!video) continue;
            const obj = video._parentLayer || [...layerObjects.values()].find(o => o._videoElement === video);
            if (!obj) continue;
            videoToLayerObj.set(video, obj);
            const sceneId = obj._sceneId;
            if (sceneId) {
                if (!sceneVideoMap.has(sceneId)) sceneVideoMap.set(sceneId, []);
                sceneVideoMap.get(sceneId).push({ video, obj });
            }
        }

        // =====================================================================
        // CHUNKED FRAME-BY-FRAME RENDER LOOP
        // =====================================================================
        const batchSize = fps * 3; // 3 seconds per batch
        let currentBatchIndex = 0;
        let framesInCurrentBatch = 0;
        const chunkFiles = [];

        for (let frame = 0; frame <= totalFramesNum; frame++) {
            if (signal?.aborted) throw new Error('cancelled');

            const time = frame / fps;

            layerObjects.forEach((obj) => {
                if (!obj || obj.destroyed) return;
                const sceneId = obj._sceneId;
                const range = exportEngine?.sceneRanges?.get(sceneId);
                if (range) {
                    // [VISIBILITY FIX] Add epsilon to endTime check to ensure the last frame
                    // of a scene (and the last frame of the project) is included.
                    // This prevents the "black frame" flicker at scene transitions.
                    obj.visible = (time >= range.startTime - 0.001 && time < range.endTime + 0.001);
                } else {
                    obj.visible = false;
                }
            });

            if (exportEngine && !exportEngine._destroyed) {
                exportEngine.seek(time);
            }
            // [BLUR EXPORT FIX] Force blur filter padding recalculation after seek.
            // [BLUR EXPORT FIX] Force blur filter padding recalculation after seek.
            layerObjects.forEach((obj, id) => {
                if (!obj || obj.destroyed || !obj.visible) return;
                
                try {
                    if (obj._blurFilter && obj.filters && Array.isArray(obj.filters) && obj.filters.includes(obj._blurFilter)) {
                        if (typeof obj._applyAnimatedBlur === 'function') {
                            obj._applyAnimatedBlur();
                        }
                        if (obj._blurFilter.updatePadding) {
                            obj._blurFilter.updatePadding();
                        }
                    }
                } catch (e) {
                    console.error(`[videoExport] Error syncing blur for object ${id}:`, e);
                }
            });

            // [PERF] Only iterate videos in active scenes (using pre-built scene index)
            // instead of all exportVideoElements. Seek in parallel.
            const seekPromises = [];
            sceneVideoMap.forEach((entries, sceneId) => {
                const range = exportEngine?.sceneRanges?.get(sceneId);
                if (!range) return;
                // Skip entire scene's videos if time is outside range
                if (time < range.startTime - 0.001 || time >= range.endTime + 0.001) return;

                for (const { video, obj } of entries) {
                    if (!obj || obj.destroyed || !obj.visible) continue;

                    const srcStart = video._layerSourceStartTime !== undefined ? video._layerSourceStartTime : (obj._sourceStartTime || 0);
                    const srcEnd = video._layerSourceEndTime !== undefined ? video._layerSourceEndTime : obj._sourceEndTime;

                    const localTime = time - range.startTime;
                    let targetVideoTime = Math.max(0, localTime + srcStart);
                    if (srcEnd !== undefined) targetVideoTime = Math.min(targetVideoTime, srcEnd);

                    seekPromises.push(
                        seekVideoToTime(video, targetVideoTime, fps).then(() => {
                            const sprites = [obj._videoSprite, obj._imageSprite, obj._backSprite].filter(Boolean);
                            for (const s of sprites) {
                                if (s.texture?.source?.resource === video) {
                                    try { s.texture.source.update(); } catch (e) { /* texture/source may be destroyed */ }
                                }
                            }
                        })
                    );
                }
            });
            if (seekPromises.length > 0) {
                await Promise.all(seekPromises);
            }

            if (app && !app._exportDestroyed && app.renderer && !app.renderer.destroyed) {
                // [GHOSTING FIX] Explicitly clear the framebuffer before rendering each frame.
                // With preserveDrawingBuffer:true, some WebGL implementations retain previous
                // frame data in semi-transparent/anti-aliased edge regions, causing ghost trails.
                app.renderer.clear();
                app.render();
            }

            const frameData = await captureFrame(app.canvas);
            await ffmpegInst.writeFile(`${sessionId}_batch_${String(framesInCurrentBatch).padStart(5, '0')}.jpg`, frameData);
            framesInCurrentBatch++;

            if (frame % 5 === 0) {
                onProgress?.({
                    status: 'rendering',
                    progress: Math.round((frame / totalFramesNum) * 90)
                });
                await new Promise(r => setTimeout(r, 0));
            }

            if (signal?.aborted) throw new Error('cancelled');

            // If we reached batch size, or we are at the last frame
            if (framesInCurrentBatch === batchSize || frame === totalFramesNum) {
                const chunkName = `${sessionId}_chunk_${String(currentBatchIndex).padStart(3, '0')}.mp4`;
                
                // Encode this batch
                await ffmpegInst.exec([
                    '-framerate', fps.toString(),
                    '-i', `${sessionId}_batch_%05d.jpg`,
                    '-c:v', 'libx264',
                    '-preset', 'ultrafast',
                    '-pix_fmt', 'yuv420p',
                    chunkName
                ]);

                chunkFiles.push(chunkName);

                // Delete the batch frames from MEMFS immediately to free memory
                const deletePromises = [];
                for (let i = 0; i < framesInCurrentBatch; i++) {
                    deletePromises.push(ffmpegInst.deleteFile(`${sessionId}_batch_${String(i).padStart(5, '0')}.jpg`).catch(() => { }));
                }
                await Promise.all(deletePromises);

                currentBatchIndex++;
                framesInCurrentBatch = 0;
            }
        }

        // =====================================================================
        // ENCODING PHASE
        // =====================================================================
        if (signal?.aborted) throw new Error('cancelled');
        onProgress?.({ status: 'encoding', progress: 95 });

        const videoFileName = hasAudio ? `${sessionId}_video_only.mp4` : `${sessionId}_output.mp4`;
        
        // Build a concat list for FFmpeg
        let concatText = '';
        for (const chunk of chunkFiles) {
            concatText += `file '${chunk}'\n`;
        }
        await ffmpegInst.writeFile(`${sessionId}_concat.txt`, new TextEncoder().encode(concatText));

        // Use the concat demuxer to instantly merge the chunks
        await ffmpegInst.exec([
            '-f', 'concat',
            '-safe', '0',
            '-i', `${sessionId}_concat.txt`,
            '-c', 'copy',
            '-fflags', '+genpts',
            videoFileName
        ]);

        // Clean up intermediate chunks + concat.txt (main video is saved)
        const cleanupPromises = chunkFiles.map(chunk => ffmpegInst.deleteFile(chunk).catch(() => { }));
        cleanupPromises.push(ffmpegInst.deleteFile(`${sessionId}_concat.txt`).catch(() => { }));
        await Promise.all(cleanupPromises);

        if (signal?.aborted) throw new Error('cancelled');

        // =====================================================================
        // AUDIO MIXING PHASE (only for unmuted video layers)
        // =====================================================================
        if (hasAudio) {
            await mixAudioIntoVideo(ffmpegInst, audioSources, onProgress);
        }

        if (signal?.aborted) throw new Error('cancelled');

        onProgress?.({ status: 'encoding', progress: 100 });
        const data = await ffmpegInst.readFile(`${sessionId}_output.mp4`);
        return new Blob([data.buffer], { type: 'video/mp4' });

    } catch (error) {
        // Re-throw cancellation as-is, wrap other errors for context
        if (error.message === 'cancelled') throw error;
        throw error;
    } finally {
        cleanupExportResources(exportEngine, app, exportVideoElements, layerObjects);
        try {
            await cleanupTempFiles(ffmpegInst, totalFramesNum, audioSources.length, sessionId);
        } catch (e) {
            console.warn('Export: Temp file cleanup warning', e);
        }
    }
};
