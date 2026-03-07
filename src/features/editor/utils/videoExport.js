import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';
import * as PIXI from 'pixi.js';
import { MotionEngine } from '../../engine/motion/MotionEngine.js';
import { createTextLayer, createShapeLayer, createImageLayer } from '../../engine/pixi/createLayer.js';

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
 */
function seekVideoToTime(video, targetTime) {
    return new Promise(resolve => {
        if (Math.abs(video.currentTime - targetTime) < 0.01 && !video.seeking && video.readyState >= 2) {
            resolve();
            return;
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

        for (let i = 0; i < audioSources.length; i++) {
            const response = await fetch(audioSources[i].videoUrl);
            const arrayBuffer = await response.arrayBuffer();
            await ffmpegInst.writeFile(`audio_src_${i}.mp4`, new Uint8Array(arrayBuffer));
        }

        onProgress?.({ status: 'encoding', progress: 97 });

        const args = ['-i', 'video_only.mp4'];
        const filterParts = [];

        for (let i = 0; i < audioSources.length; i++) {
            const src = audioSources[i];
            args.push('-ss', src.sourceStartTime.toFixed(3));
            args.push('-t', src.duration.toFixed(3));
            args.push('-i', `audio_src_${i}.mp4`);

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
                `; ${labels}amix=inputs=${audioSources.length}:duration=first:dropout_transition=0[aout]`;
        }

        args.push('-filter_complex', filterComplex);
        args.push('-map', '0:v', '-map', '[aout]');
        args.push('-c:v', 'copy', '-c:a', 'aac', '-shortest');
        args.push('output.mp4');

        await ffmpegInst.exec(args);

        try { await ffmpegInst.deleteFile('video_only.mp4'); } catch (e) { /* ignore */ }
        for (let i = 0; i < audioSources.length; i++) {
            try { await ffmpegInst.deleteFile(`audio_src_${i}.mp4`); } catch (e) { /* ignore */ }
        }

        return true;
    } catch (audioError) {
        console.warn('Export: Audio mixing failed, falling back to silent video:', audioError);
        try {
            const silentData = await ffmpegInst.readFile('video_only.mp4');
            await ffmpegInst.writeFile('output.mp4', silentData);
            await ffmpegInst.deleteFile('video_only.mp4');
        } catch (e) { /* ignore */ }

        for (let i = 0; i < audioSources.length; i++) {
            try { await ffmpegInst.deleteFile(`audio_src_${i}.mp4`); } catch (e) { /* ignore */ }
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

async function cleanupTempFiles(ffmpegInst, totalFramesNum, audioSourceCount) {
    if (totalFramesNum > 0) {
        const batchSize = 50;
        for (let start = 0; start <= totalFramesNum; start += batchSize) {
            const end = Math.min(start + batchSize, totalFramesNum);
            const promises = [];
            for (let i = start; i <= end; i++) {
                promises.push(
                    ffmpegInst.deleteFile(`frame_${String(i).padStart(5, '0')}.jpg`).catch(() => { })
                );
            }
            await Promise.all(promises);
        }
    }
    try { await ffmpegInst.deleteFile('output.mp4'); } catch (e) { /* ignore */ }
    try { await ffmpegInst.deleteFile('video_only.mp4'); } catch (e) { /* ignore */ }
    for (let i = 0; i < audioSourceCount; i++) {
        try { await ffmpegInst.deleteFile(`audio_src_${i}.mp4`); } catch (e) { /* ignore */ }
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

    const ffmpegInst = await initFFmpeg();

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

        app = new PIXI.Application();
        await app.init({
            width: targetWidth,
            height: targetHeight,
            backgroundColor: 0x000000,
            antialias: true,
            preserveDrawingBuffer: true,
            resolution: 1,
        });

        app.ticker.stop();

        const stageContainer = new PIXI.Container();
        app.stage.addChild(stageContainer);
        stageContainer.scale.set(targetWidth / worldWidth, targetHeight / worldHeight);

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
                    } else if (layer.type === 'background') {
                        const graphics = new PIXI.Graphics();
                        graphics.rect(0, 0, worldWidth, worldHeight);
                        graphics.fill(layer.data?.color || 0x000000);
                        pixiObject = graphics;

                        if (layer.data?.imageUrl) {
                            try {
                                const { loadTextureRobust } = await import('../../engine/pixi/textureUtils.js');
                                const bgTexture = await loadTextureRobust(layer.data.imageUrl);
                                if (bgTexture) {
                                    const bgContainer = new PIXI.Container();
                                    bgContainer.addChild(graphics);
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
                        stageContainer.addChild(pixiObject);
                        layerObjects.set(layerId, pixiObject);
                        exportEngine.registerLayerObject(layerId, pixiObject, { sceneId: layer.sceneId });
                    }
                } catch (e) {
                    console.warn(`Export: Failed to load layer ${layerId}:`, e);
                }
            }
        }

        exportEngine.loadProjectMotionFlow(timelineInfo, sceneMotionFlows, layerObjects, { allLayers: layers });

        const totalDuration = timelineInfo.reduce((acc, s) => acc + s.duration, 0);
        totalFramesNum = Math.ceil(totalDuration * fps);

        onProgress?.({ status: 'rendering', progress: 0 });

        // =====================================================================
        // FRAME-BY-FRAME RENDER LOOP
        // =====================================================================
        for (let frame = 0; frame <= totalFramesNum; frame++) {
            if (signal?.aborted) throw new Error('cancelled');

            const time = frame / fps;

            layerObjects.forEach((obj) => {
                if (!obj || obj.destroyed) return;
                const sceneId = obj._sceneId;
                const range = exportEngine?.sceneRanges?.get(sceneId);
                if (range) {
                    obj.visible = (time >= range.startTime - 0.001 && time < range.endTime);
                } else {
                    obj.visible = false;
                }
            });

            if (exportEngine && !exportEngine._destroyed) {
                exportEngine.seek(time);
            }

            for (const video of exportVideoElements) {
                if (!video) continue;
                const obj = [...layerObjects.values()].find(o => o._videoElement === video);
                if (!obj || obj.destroyed || !obj.visible) continue;

                const range = exportEngine?.sceneRanges?.get(obj._sceneId);
                if (!range) continue;

                const srcStart = obj._sourceStartTime || 0;
                const srcEnd = obj._sourceEndTime;
                const localTime = time - range.startTime;
                let targetVideoTime = Math.max(0, localTime + srcStart);
                if (srcEnd !== undefined) targetVideoTime = Math.min(targetVideoTime, srcEnd);

                await seekVideoToTime(video, targetVideoTime);

                if (obj._videoSprite?.texture?.source) {
                    try { obj._videoSprite.texture.source.update(); } catch (e) { /* texture may be destroyed */ }
                }
            }

            if (app && !app._exportDestroyed && app.renderer && !app.renderer.destroyed) {
                app.render();
            }

            const frameData = await captureFrame(app.canvas);
            await ffmpegInst.writeFile(`frame_${String(frame).padStart(5, '0')}.jpg`, frameData);

            if (frame % 5 === 0) {
                onProgress?.({
                    status: 'rendering',
                    progress: Math.round((frame / totalFramesNum) * 90)
                });
                await new Promise(r => setTimeout(r, 0));
            }
        }

        // =====================================================================
        // ENCODING PHASE
        // =====================================================================
        if (signal?.aborted) throw new Error('cancelled');
        onProgress?.({ status: 'encoding', progress: 95 });

        const videoFileName = hasAudio ? 'video_only.mp4' : 'output.mp4';
        await ffmpegInst.exec([
            '-framerate', fps.toString(),
            '-i', 'frame_%05d.jpg',
            '-c:v', 'libx264',
            '-preset', 'ultrafast',
            '-pix_fmt', 'yuv420p',
            videoFileName
        ]);

        if (signal?.aborted) throw new Error('cancelled');

        // =====================================================================
        // AUDIO MIXING PHASE (only for unmuted video layers)
        // =====================================================================
        if (hasAudio) {
            await mixAudioIntoVideo(ffmpegInst, audioSources, onProgress);
        }

        if (signal?.aborted) throw new Error('cancelled');

        onProgress?.({ status: 'encoding', progress: 100 });
        const data = await ffmpegInst.readFile('output.mp4');
        return new Blob([data.buffer], { type: 'video/mp4' });

    } catch (error) {
        // Re-throw cancellation as-is, wrap other errors for context
        if (error.message === 'cancelled') throw error;
        throw error;
    } finally {
        cleanupExportResources(exportEngine, app, exportVideoElements, layerObjects);
        try {
            await cleanupTempFiles(ffmpegInst, totalFramesNum, audioSources.length);
        } catch (e) {
            console.warn('Export: Temp file cleanup warning', e);
        }
    }
};
