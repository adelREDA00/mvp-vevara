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
import { syncTiltedDisplay } from '../../engine/pixi/perspectiveTilt.js';

let ffmpeg = null;

const _canUseMT = () => {
    // ALWAYS disable multi-threading. Multi-threaded WebAssembly FFmpeg (@ffmpeg/core-mt) 
    // is highly unstable and deadlocks/freezes in production cross-origin isolated environments.
    // The single-threaded build is completely stable and works flawlessly.
    return false;
};

export const initFFmpeg = async (onLog = null) => {
    if (ffmpeg) return ffmpeg;
    ffmpeg = new FFmpeg();
    ffmpeg.on('log', ({ message }) => {
        if (onLog) onLog(message);
    });
    const useMT = _canUseMT();
    const baseURL = useMT
        ? 'https://unpkg.com/@ffmpeg/core-mt@0.12.6/dist/esm'
        : 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
    try {
        const loadArgs = {
            coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
            wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
        };
        if (useMT) {
            loadArgs.workerURL = await toBlobURL(`${baseURL}/ffmpeg-core.worker.js`, 'text/javascript');
        }
        ffmpeg._isMultiThread = useMT;
        const loadPromise = ffmpeg.load(loadArgs);
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('FFmpeg load timeout')), 20000)
        );
        await Promise.race([loadPromise, timeoutPromise]);
    } catch (error) {
        ffmpeg = null;
        throw error;
    }
    return ffmpeg;
};

async function createExportVideoElement(videoUrl, exportCtx = { active: true }) {
    const video = document.createElement('video');
    video.src = videoUrl;
    video.muted = true;
    video.loop = false;
    video.playsInline = true;
    video.preload = 'auto'; // Re-enable auto preload with Media Fragments to buffer target segments in-memory for instant 20ms seeks!
    video.autoplay = false;
    video.crossOrigin = 'anonymous';

    await new Promise((resolve, reject) => {
        if (video.readyState >= 3 && video.videoWidth > 0) {
            resolve();
            return;
        }

        let timeoutId;
        let checkIntervalId;

        const cleanup = () => {
            video.removeEventListener('canplaythrough', onReady);
            video.removeEventListener('canplay', onReady);
            video.removeEventListener('loadeddata', onReady);
            video.removeEventListener('error', onError);
            if (timeoutId) clearTimeout(timeoutId);
            if (checkIntervalId) clearInterval(checkIntervalId);
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

        // Periodically check if export has been cancelled to abort load immediately
        checkIntervalId = setInterval(() => {
            if (!exportCtx.active) {
                cleanup();
                reject(new Error('cancelled'));
            }
        }, 100);

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

async function optimizeVideoForSeeking(url, layer, ffmpegInst, sessionId) {
    // ALWAYS skip client-side video seeking optimization in the browser.
    // Client-side FFmpeg re-encoding of video layers is extremely CPU and memory intensive,
    // causing browsers to run out of WASM memory and freeze/deadlock indefinitely at 0% in production
    // (especially when larger video sizes bypass safety checks due to stripped headers).
    // Native HTML5 Media Fragments (#t=start,end) and seek events are highly stable, fast, and precise.
    return null;
}

async function compressAndWriteFrame({ canvas, filename, ffmpegInst, quality, exportCtx }) {
    if (exportCtx && !exportCtx.active) return;
    let bitmap;
    try {
        bitmap = await createImageBitmap(canvas);
    } catch (e) {
        if (exportCtx && !exportCtx.active) return;
        // Fallback if createImageBitmap is not supported
        const frameData = await captureFrame(canvas, false, quality);
        if (exportCtx && !exportCtx.active) return;
        await ffmpegInst.writeFile(filename, frameData);
        return;
    }

    try {
        if (exportCtx && !exportCtx.active) {
            try { bitmap.close(); } catch (e) { }
            return;
        }
        const blob = await new Promise((resolve, reject) => {
            try {
                const offscreen = typeof OffscreenCanvas !== 'undefined'
                    ? new OffscreenCanvas(bitmap.width, bitmap.height)
                    : document.createElement('canvas');

                if (!offscreen.width) {
                    offscreen.width = bitmap.width;
                    offscreen.height = bitmap.height;
                }

                const ctx = offscreen.getContext('2d');
                if (!ctx) {
                    reject(new Error('Failed to get 2D context'));
                    return;
                }
                ctx.drawImage(bitmap, 0, 0);
                bitmap.close();

                if (typeof offscreen.convertToBlob === 'function') {
                    offscreen.convertToBlob({ type: 'image/jpeg', quality })
                        .then(resolve)
                        .catch(reject);
                } else if (typeof offscreen.toBlob === 'function') {
                    offscreen.toBlob(b => {
                        if (b) resolve(b);
                        else reject(new Error('toBlob returned null'));
                    }, 'image/jpeg', quality);
                } else {
                    reject(new Error('Canvas serialization not supported'));
                }
            } catch (err) {
                reject(err);
            }
        });

        if (exportCtx && !exportCtx.active) return;
        const buf = await blob.arrayBuffer();
        if (exportCtx && !exportCtx.active) return;
        await ffmpegInst.writeFile(filename, new Uint8Array(buf));
    } catch (err) {
        const isAbort = (exportCtx && !exportCtx.active) ||
            err.message?.includes('terminate') ||
            err.message?.includes('not loaded') ||
            err.message?.includes('aborted');
        if (isAbort) return;

        console.error(`[videoExport] Background compression failed for ${filename}, falling back:`, err);
        if (bitmap) {
            try { bitmap.close(); } catch (e) { }
        }
        const frameData = await captureFrame(canvas, false, quality);
        if (exportCtx && !exportCtx.active) return;
        await ffmpegInst.writeFile(filename, frameData);
    }
}

async function createExportVideoLayer(layer, ffmpegWrapper = null, sessionId = '', exportCtx = { active: true }) {
    const url = layer.data?.url || layer.data?.src;
    if (!url) throw new Error('Video layer requires data.url or data.src');

    if (!exportCtx.active) return null;

    let targetUrl = url;
    let isOptimized = false;
    let optimizedDuration = 0;
    let blobToRevoke = null;

    if (ffmpegWrapper && ffmpegWrapper.inst && sessionId) {
        try {
            const optResult = await optimizeVideoForSeeking(url, layer, ffmpegWrapper.inst, sessionId);
            if (!exportCtx.active) {
                if (optResult?.optimizedUrl) try { URL.revokeObjectURL(optResult.optimizedUrl); } catch (e) { }
                return null;
            }
            if (optResult) {
                targetUrl = optResult.optimizedUrl;
                isOptimized = true;
                optimizedDuration = optResult.duration;
                blobToRevoke = optResult.optimizedUrl;
            }
        } catch (optErr) {
            console.warn(`[videoExport] Failed to optimize layer video: ${url}. Using original.`, optErr);
            if (!exportCtx.active) {
                if (blobToRevoke) try { URL.revokeObjectURL(blobToRevoke); } catch (e) { }
                return null;
            }
            // Self-healing: if FFmpeg crashed/terminated, reset it so a clean instance is reloaded for batch chunk encoding
            if (optErr.message?.includes('terminate') || optErr.message?.includes('abort') || optErr.message?.includes('wasm') || optErr.message?.includes('memory')) {
                try {
                    ffmpeg = null;
                    const newInst = await initFFmpeg(null);
                    newInst._session_id = sessionId;
                    ffmpegWrapper.inst = newInst;
                } catch (reloadErr) {
                    console.error('[videoExport] FFmpeg self-healing reload failed:', reloadErr);
                }
            }
        }
    }

    // Apply native HTML5 Media Fragment fallback (#t=start,end) to strictly buffer ONLY this segment, ensuring lightning-fast seeks
    if (!isOptimized) {
        const srcStart = layer.data?.sourceStartTime || 0;
        const srcEnd = layer.data?.sourceEndTime || (layer.data?.duration || 0);
        const duration = srcEnd - srcStart;
        if (duration > 0) {
            targetUrl = `${url}#t=${srcStart.toFixed(3)},${srcEnd.toFixed(3)}`;
        }
    }

    if (!exportCtx.active) {
        if (blobToRevoke) try { URL.revokeObjectURL(blobToRevoke); } catch (e) { }
        return null;
    }

    const videoElements = [];
    const textures = [];
    const bufferSize = 1; // Change from 3 to 1 to use a single video element and ensure sequential frame accuracy without decoder contention

    for (let i = 0; i < bufferSize; i++) {
        if (!exportCtx.active) {
            for (const v of videoElements) {
                try { v.pause(); v.src = ''; v.load(); } catch (e) { }
            }
            if (blobToRevoke) try { URL.revokeObjectURL(blobToRevoke); } catch (e) { }
            return null;
        }
        const video = await createExportVideoElement(targetUrl, exportCtx);
        if (!exportCtx.active) {
            try { video.pause(); video.src = ''; video.load(); } catch (e) { }
            for (const v of videoElements) {
                try { v.pause(); v.src = ''; v.load(); } catch (e) { }
            }
            if (blobToRevoke) try { URL.revokeObjectURL(blobToRevoke); } catch (e) { }
            return null;
        }
        if (isOptimized) {
            video._isOptimized = true;
            video._optimizedDuration = optimizedDuration;
            video._blobToRevoke = blobToRevoke;
        }
        video._layerSourceStartTime = layer.data?.sourceStartTime || 0;
        video._layerSourceEndTime = layer.data?.sourceEndTime || (layer.data?.duration || 0);

        // autoUpdate:false disables PIXI's rVFC-based auto-texture-upload while the video
        // is playing (during play-forward seek). Without this, PIXI's VideoSource races
        // with our explicit source.update() calls and can overwrite the correct paused
        // frame with a different video frame, causing every 3rd export frame to flicker.
        // The export pipeline drives all texture updates manually via source.update().
        const tex = PIXI.Texture.from(video, {
            resourceOptions: { autoPlay: false, autoUpdate: false, muted: true, loop: false, playsinline: true }
        });
        videoElements.push(video);
        textures.push(tex);
    }

    const container = new PIXI.Container();
    const sprite = new PIXI.Sprite(textures[0]);

    container._videoElements = videoElements;
    container._videoTextures = textures;
    container._seekPromises = new Array(bufferSize).fill(null);
    container._lastSeekTimes = new Array(bufferSize).fill(-999);
    container._videoSprite = sprite;
    container._videoTexture = textures[0];
    container._videoElement = videoElements[0];
    container.addChild(sprite);

    const texW = videoElements[0].videoWidth || layer.data?.width || 300;
    const texH = videoElements[0].videoHeight || layer.data?.height || 200;
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
    container._storedCropWidth = cropW;
    container._storedCropHeight = cropH;

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

// allowPlayForward=true  → used for MAIN seeks (run before PIXI render, main thread idle,
//                           play-forward is fast and accurate ±1 frame).
// allowPlayForward=false → used for PRE-SEEKS (run concurrently with PIXI render; the main
//                           thread is blocked by WebGL, so play-forward overshoots 200-600ms
//                           and produces wrong video frames). Use exact random-access seek
//                           instead — it runs in the background while PIXI renders.
function seekVideoToTime(video, targetTime, fps, allowPlayForward = true) {
    const startTime = performance.now();
    const src = video.src ? video.src.substring(video.src.lastIndexOf('/') + 1) : 'unknown';

    return new Promise(resolve => {
        // One-full-frame tolerance at the target fps.
        const tolerance = 1.0 / fps;

        // Fast guard: within one frame of target (handles normal sequential capture)
        if (Math.abs(video.currentTime - targetTime) < tolerance && !video.seeking && video.readyState >= 2) {
            resolve();
            return;
        }

        const behind = targetTime - video.currentTime;

        // Play-forward path: letting the video decoder advance naturally is dramatically faster
        // than a random-access seek through P-frames on a large unoptimized video file.
        // Only used for main seeks (allowPlayForward=true) where the main thread is idle
        // (we are awaiting this Promise before PIXI starts rendering). Pre-seeks run during
        // PIXI render and must use exact random-access seeks for frame accuracy.
        if (allowPlayForward && behind > tolerance && behind <= 0.35 && !video.seeking && video.readyState >= 2) {
            let pollId;
            let safetyId;
            let resolved = false;

            const doResolve = () => {
                if (resolved) return;
                resolved = true;
                clearInterval(pollId);
                clearTimeout(safetyId);
                try { video.pause(); } catch (e) { }
                // Yield one event-loop tick so Chrome can commit the paused video frame
                // to the GPU buffer before source.update() reads it. Without this delay
                // (matching the setTimeout in the random-access seek path), the texture
                // captures the pre-play frame, causing every 3rd export frame to repeat.
                setTimeout(resolve, 0);
            };

            pollId = setInterval(() => {
                // Stop 40ms before the actual target to account for browser pause latency (~25ms).
                // This prevents the play-forward from overshooting past the target, which would
                // create a negative 'behind' on the next cycle and trigger backward random-access seeks.
                if (video.currentTime >= targetTime - 0.040) doResolve();
            }, 8);

            safetyId = setTimeout(doResolve, 500);

            const playPromise = video.play();
            if (playPromise !== undefined) {
                playPromise.catch(() => {
                    // play() blocked by autoplay policy — fall back to regular seek
                    if (!resolved) {
                        resolved = true;
                        clearInterval(pollId);
                        clearTimeout(safetyId);
                        video.addEventListener('seeked', resolve, { once: true });
                        video.currentTime = targetTime;
                        setTimeout(resolve, 800);
                    }
                });
            }
            return;
        }

        // Random-access seek: used for backward seeks, large forward jumps, and initial positioning.

        let resolved = false;
        let timeoutId;

        const doResolve = (type) => {
            if (resolved) return;
            resolved = true;
            if (timeoutId) clearTimeout(timeoutId);
            video.removeEventListener('seeked', onSeeked);
            resolve();
        };

        const onSeeked = () => {
            setTimeout(() => doResolve('seeked'), 0);
        };

        video.addEventListener('seeked', onSeeked);
        video.currentTime = targetTime;

        timeoutId = setTimeout(() => {
            console.warn(`[videoExport] [seekVideoToTime] ${src} seek TIMEOUT at ${targetTime.toFixed(3)}s. Proceeding anyway.`);
            doResolve('timeout');
        }, 800);
    });
}

function captureFrame(canvas, isGif = false, quality = 0.85) {
    return new Promise(resolve => {
        const format = isGif ? 'image/png' : 'image/jpeg';
        canvas.toBlob(blob => {
            if (!blob) {
                const b64 = canvas.toDataURL(format, isGif ? undefined : quality);
                const bin = atob(b64.split(',')[1]);
                const arr = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
                resolve(arr);
                return;
            }
            blob.arrayBuffer().then(buf => resolve(new Uint8Array(buf)));
        }, format, isGif ? undefined : quality);
    });
}

function collectAudioSources(scenes, layers, timelineInfo) {
    const sources = [];
    for (const scene of scenes) {
        if (!scene.layers) continue;
        const sceneInfo = timelineInfo.find(s => s.id === scene.id);
        if (!sceneInfo) continue;

        for (const layerId of scene.layers) {
            const layer = layers[layerId];
            if (!layer) continue;

            if (layer.type === 'video') {
                if (layer.data?.muted !== false) continue;
                const videoUrl = layer.data?.url || layer.data?.src;
                if (!videoUrl) continue;

                sources.push({
                    videoUrl,
                    sourceStartTime: layer.data.sourceStartTime || 0,
                    duration: sceneInfo.duration,
                    globalStartTime: sceneInfo.startTime,
                });
            } else if (layer.type === 'frame') {
                // Front side check
                if (layer.data?.assetIsVideo && layer.data?.muted === false) {
                    const videoUrl = layer.data?.assetUrl;
                    if (videoUrl) {
                        sources.push({
                            videoUrl,
                            sourceStartTime: layer.data.sourceStartTime || 0,
                            duration: sceneInfo.duration,
                            globalStartTime: sceneInfo.startTime,
                        });
                    }
                }
                // Back side check
                if (layer.data?.backAssetIsVideo && layer.data?.backMuted === false) {
                    const videoUrl = layer.data?.backAssetUrl;
                    if (videoUrl) {
                        sources.push({
                            videoUrl,
                            sourceStartTime: layer.data.backSourceStartTime || 0,
                            duration: sceneInfo.duration,
                            globalStartTime: sceneInfo.startTime,
                        });
                    }
                }
            }
        }
    }
    return sources;
}

async function mixAudioIntoVideo(ffmpegInst, audioSources, onProgress) {
    try {
        onProgress?.({ status: 'encoding', progress: 96 });

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
            // No input-side -ss: the files are already in WASM memory, so skipping seek
            // costs nothing. atrim operates on decoded PCM samples (not AAC packets), giving
            // sub-millisecond accuracy regardless of packet boundaries.
            args.push('-i', src.fsName);

            const trimStart = src.sourceStartTime.toFixed(6);
            const trimEnd = (src.sourceStartTime + src.duration).toFixed(6);
            const delayMs = Math.round(src.globalStartTime * 1000);
            
            let filter = `[${i + 1}:a]atrim=start=${trimStart}:end=${trimEnd},asetpts=PTS-STARTPTS`;
            if (delayMs > 0) {
                filter += `,adelay=${delayMs}:all=true`;
            }
            filter += `,aresample=async=1[a${i}]`;
            filterParts.push(filter);
        }

        let filterComplex;
        if (audioSources.length === 1) {
            const src = audioSources[0];
            const trimStart = src.sourceStartTime.toFixed(6);
            const trimEnd = (src.sourceStartTime + src.duration).toFixed(6);
            const delayMs = Math.round(src.globalStartTime * 1000);
            
            let filter = `[1:a]atrim=start=${trimStart}:end=${trimEnd},asetpts=PTS-STARTPTS`;
            if (delayMs > 0) {
                filter += `,adelay=${delayMs}:all=true`;
            }
            filter += `,aresample=async=1[aout]`;
            filterComplex = filter;
        } else {
            const labels = audioSources.map((_, i) => `[a${i}]`).join('');
            filterComplex = filterParts.join('; ') +
                `; ${labels}amix=inputs=${audioSources.length}:duration=longest:dropout_transition=0,aresample=async=1[aout]`;
        }

        args.push('-filter_complex', filterComplex);
        args.push('-map', '0:v', '-map', '[aout]');
        args.push('-c:v', 'copy', '-c:a', 'aac');
        args.push(outputFile);

        await ffmpegInst.exec(args);

        try { await ffmpegInst.deleteFile(videoOnlyFile); } catch (e) { /* ignore */ }

        const uniqueFiles = new Set(audioSources.map(s => s.fsName));
        for (const fileName of uniqueFiles) {
            try { await ffmpegInst.deleteFile(fileName); } catch (e) { /* ignore */ }
        }

        return true;
    } catch (audioError) {
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

let _cleanupInProgress = false;
function cleanupExportResources(exportEngine, app, exportVideoElements, layerObjects, loadedUrls) {
    if (_cleanupInProgress) return;
    _cleanupInProgress = true;

    // 1. Cleanup Export Engine (MotionEngine)
    try {
        if (exportEngine && !exportEngine._destroyed) {
            exportEngine.destroy();
            exportEngine._destroyed = true;
        }
    } catch (e) { /* ignore */ }

    // 2. Cleanup Video Elements
    if (exportVideoElements && exportVideoElements.length > 0) {
        for (const video of exportVideoElements) {
            try {
                if (video) {
                    video.pause();
                    const blobToRevoke = video._blobToRevoke;
                    video.src = '';
                    video.removeAttribute('src');
                    try { video.load(); } catch (e) { }
                    if (blobToRevoke) {
                        try { URL.revokeObjectURL(blobToRevoke); } catch (e) { }
                    }
                    // Explicitly remove from DOM if it was added for some reason
                    if (video.parentNode) video.parentNode.removeChild(video);
                }
            } catch (e) { /* ignore */ }
        }
        exportVideoElements.length = 0;
    }

    // 3. Cleanup Layer Objects (Sprites, Graphics, etc.)
    if (layerObjects && layerObjects.size > 0) {
        layerObjects.forEach((obj) => {
            try {
                if (!obj || obj.destroyed) return;

                // Safely destroy export-specific video textures
                if (obj._videoTextures) {
                    for (const tex of obj._videoTextures) {
                        try { tex.destroy(true); } catch (e) { /* ignore */ }
                    }
                } else if (obj._videoTexture) {
                    try { obj._videoTexture.destroy(true); } catch (e) { /* ignore */ }
                }

                // [FIX] Destroy the object, but NEVER destroy other shared textures here
                obj.destroy({ children: true, texture: false });
            } catch (e) { /* ignore */ }
        });
        layerObjects.clear();
    }

    // 4. [FIX] Removed: Assets.unload(url) loop.
    // In PIXI 8, Assets.unload is global. Calling it here destroys textures 
    // that are still being used by the main editor, causing project "corruption".
    // We let the editor manage the lifecycle of these assets.
    if (loadedUrls) {
        loadedUrls.clear();
    }

    // 5. Cleanup PIXI Application and Renderer
    try {
        if (app && !app._exportDestroyed) {
            app._exportDestroyed = true;

            // Stop ticker immediately to prevent any further render calls
            if (app.ticker) {
                try { app.ticker.stop(); } catch (e) { /* ignore */ }
            }

            // [FIX] Capture references before app.destroy() nulls them out
            const canvas = app.canvas;
            const host = app._exportCanvasHost;

            // PIXI 8: Use the correct options object for destroy
            // This handles renderer, stage, and canvas cleanup.
            // removeView: true removes the canvas from the DOM.
            // texture: false ensures we don't destroy textures shared with the editor.
            app.destroy({
                removeView: true,
                children: true,
                texture: false
            });

            // Double safety for WebGL context loss and cleanup
            if (canvas) {
                try {
                    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
                    if (gl) {
                        gl.getExtension('WEBGL_lose_context')?.loseContext();
                    }
                    if (canvas.parentNode) {
                        canvas.parentNode.removeChild(canvas);
                    }
                } catch (e) { /* ignore */ }
            }

            // Cleanup host container if it still exists
            try {
                if (host && host.parentNode) {
                    host.parentNode.removeChild(host);
                }
            } catch (e) { /* ignore */ }
        }
    } catch (e) {
        console.warn('[videoExport] Error during app cleanup:', e);
    } finally {
        _cleanupInProgress = false;
    }
}


async function cleanupTempFiles(ffmpegInst, totalFramesNum, audioSourceCount, sessionId) {
    if (totalFramesNum > 0) {
        const batchPromises = [];
        for (let i = 0; i <= 300; i++) {
            const padded = String(i).padStart(5, '0');
            batchPromises.push(ffmpegInst.deleteFile(`${sessionId}_batch_${padded}.jpg`).catch(() => { }));
            batchPromises.push(ffmpegInst.deleteFile(`${sessionId}_batch_A_${padded}.jpg`).catch(() => { }));
            batchPromises.push(ffmpegInst.deleteFile(`${sessionId}_batch_B_${padded}.jpg`).catch(() => { }));
        }
        const gifFrameLimit = Math.min(totalFramesNum + 5, 100000);
        for (let i = 0; i < gifFrameLimit; i++) {
            batchPromises.push(ffmpegInst.deleteFile(`${sessionId}_frame_${String(i).padStart(5, '0')}.png`).catch(() => { }));
        }
        await Promise.all(batchPromises);

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
    try { await ffmpegInst.deleteFile(`${sessionId}_output.gif`); } catch (e) { /* ignore */ }
    try { await ffmpegInst.deleteFile(`${sessionId}_palette.png`); } catch (e) { /* ignore */ }
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
    format = 'mp4',
    gifOptions = { width: 480, fps: 15, loop: 0 },
    onProgress = null,
    signal = null,
    editorMotionControls = null
}) => {
    const exportCtx = { active: true };

    if (editorMotionControls?.isPlaying) {
        try {
            editorMotionControls.pauseAll();
        } catch (e) { /* ignore */ }
    }

    const isGif = format === 'gif';

    if (isGif) {
        fps = gifOptions?.fps || 15;
    }

    const sessionId = `exp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    let ffmpegInst = await initFFmpeg(null);
    ffmpegInst._session_id = sessionId;

    const ffmpegWrapper = { inst: ffmpegInst };

    const abortHandler = () => {
        exportCtx.active = false;
        try {
            if (ffmpegWrapper.inst) ffmpegWrapper.inst.terminate();
        } catch (e) { /* ignore */ }
        if (ffmpeg === ffmpegWrapper.inst) ffmpeg = null;
    };
    if (signal) {
        signal.addEventListener('abort', abortHandler);
    }

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
    let targetWidth;
    if (isGif) {
        const gifW = Math.max(120, Math.min(1920, gifOptions?.width || 480));
        targetWidth = gifW % 2 === 0 ? gifW : gifW - 1;
        targetHeight = Math.round(targetWidth / projectAspect);
        targetHeight = targetHeight % 2 === 0 ? targetHeight : targetHeight - 1;
    } else {
        if (resolution === '720p') targetHeight = 720;
        else if (resolution === '1440p') targetHeight = 1440;
        else if (resolution === '2160p') targetHeight = 2160;
        targetWidth = Math.round(targetHeight * projectAspect);
        targetWidth = targetWidth % 2 === 0 ? targetWidth : targetWidth - 1;
        targetHeight = targetHeight % 2 === 0 ? targetHeight : targetHeight - 1;
    }

    const audioSources = isGif ? [] : collectAudioSources(scenes, layers, timelineInfo);
    const hasAudio = audioSources.length > 0;

    let app = null;
    let exportEngine = null;
    let totalFramesNum = 0;
    let pendingEncode = Promise.resolve();
    let pendingWrites = [];
    const layerObjects = new Map();
    const exportVideoElements = [];
    const loadedUrls = new Set();


    try {
        if (signal?.aborted) throw new Error('cancelled');

        PIXI.TextStyle.defaultTextStyle.resolution = 1;

        app = new PIXI.Application();
        await app.init({
            width: targetWidth,
            height: targetHeight,
            backgroundColor: 0x000000,
            backgroundAlpha: 1,
            antialias: true,
            preserveDrawingBuffer: true,
            roundPixels: !isGif,
            resolution: 1,
            preference: 'webgl',
            hello: true
        });

        app.renderer._isExportRenderer = true;

        try {
            if (typeof document !== 'undefined' && app.canvas && !app.canvas.parentNode) {
                const host = document.createElement('div');
                host.setAttribute('data-pixi-export-host', '1');
                host.style.cssText = 'position:fixed;left:-99999px;top:-99999px;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;';
                host.appendChild(app.canvas);
                document.body.appendChild(host);
                app._exportCanvasHost = host;
            }
        } catch (e) { /* non-browser/SSR: ignore */ }

        app.ticker.stop();

        const stageContainer = new PIXI.Container();
        app.stage.addChild(stageContainer);
        const scaleX = targetWidth / worldWidth;
        const scaleY = targetHeight / worldHeight;
        stageContainer.scale.set(scaleX, scaleY);

        exportEngine = new MotionEngine();
        exportEngine.syncMedia = () => { };
        exportEngine.setProjectConfig({ width: worldWidth, height: worldHeight });

        onProgress?.({ status: 'initializing', progress: 0 });

        const addLoadedUrl = (url) => {
            if (url && (url.startsWith('http') || url.startsWith('blob:'))) {
                loadedUrls.add(url);
            }
        };

        // Fire all image texture fetches in parallel before the serial layer loop.
        // Each createImageLayer awaits a network fetch — running them concurrently
        // cuts total image load time from sum-of-fetches down to max-single-fetch.
        const imageLayerCache = new Map();
        for (const scene of scenes) {
            if (!scene.layers) continue;
            for (const layerId of scene.layers) {
                if (signal?.aborted) break;
                const layer = layers[layerId];
                if (!layer || layer.type !== 'image') continue;
                imageLayerCache.set(layerId, createImageLayer(layer).catch(e => {
                    console.error(`[videoExport] [ImagePreload] ${layerId}:`, e);
                    return null;
                }));
            }
        }

        for (const scene of scenes) {
            if (!scene.layers) continue;
            for (const layerId of scene.layers) {
                if (signal?.aborted || !exportCtx.active) throw new Error('cancelled');

                const layer = layers[layerId];
                if (!layer) {
                    console.warn(`[videoExport] Layer not found: ${layerId}`);
                    continue;
                }

                let pixiObject = null;

                try {
                    if (layer.type === 'text') {
                        pixiObject = createTextLayer(layer);
                    } else if (layer.type === 'shape') {
                        pixiObject = createShapeLayer(layer);
                    } else if (layer.type === 'image') {
                        if (layer.data?.url) addLoadedUrl(layer.data.url);
                        pixiObject = await (imageLayerCache.get(layerId) ?? createImageLayer(layer));
                    } else if (layer.type === 'video') {
                        if (layer.data?.url) addLoadedUrl(layer.data.url);
                        pixiObject = await createExportVideoLayer(layer, ffmpegWrapper, sessionId, exportCtx);
                        ffmpegInst = ffmpegWrapper.inst; // Re-sync lexical instance in case of self-healing reload!
                        if (!exportCtx.active || signal?.aborted) {
                            if (pixiObject) {
                                try { pixiObject.destroy({ children: true }); } catch (e) { }
                            }
                            throw new Error('cancelled');
                        }
                        if (pixiObject) {
                            if (pixiObject._videoElements) {
                                exportVideoElements.push(...pixiObject._videoElements);
                            } else if (pixiObject._videoElement) {
                                exportVideoElements.push(pixiObject._videoElement);
                            }
                        }
                    } else if (layer.type === 'frame') {
                        pixiObject = createFrameLayer(layer);

                        const setupFrameSide = async (url, side) => {
                            if (!url) return;
                            if (!exportCtx.active) return;
                            addLoadedUrl(url);
                            try {
                                let targetUrl = url;
                                let isOptimized = false;
                                let optimizedDuration = 0;
                                let blobToRevoke = null;

                                const isVideoUrl = (side === 'front' ? !!layer.data?.assetIsVideo : !!layer.data?.backAssetIsVideo) ||
                                                   (typeof url === 'string' && !!url.toLowerCase().match(/\.(mp4|webm|ogg|mov|m4v)/));
                                if (isVideoUrl && ffmpegInst) {
                                    try {
                                        const optResult = await optimizeVideoForSeeking(url, layer, ffmpegInst, sessionId);
                                        if (!exportCtx.active) {
                                            if (optResult?.optimizedUrl) try { URL.revokeObjectURL(optResult.optimizedUrl); } catch (e) { }
                                            return;
                                        }
                                        if (optResult) {
                                            targetUrl = optResult.optimizedUrl;
                                            isOptimized = true;
                                            optimizedDuration = optResult.duration;
                                            blobToRevoke = optResult.optimizedUrl;
                                        }
                                    } catch (optErr) {
                                        console.warn(`[videoExport] Failed to optimize frame video: ${url}. Using original.`, optErr);
                                        if (!exportCtx.active) {
                                            if (blobToRevoke) try { URL.revokeObjectURL(blobToRevoke); } catch (e) { }
                                            return;
                                        }
                                        if (optErr.message?.includes('terminate') || optErr.message?.includes('abort') || optErr.message?.includes('wasm') || optErr.message?.includes('memory')) {
                                            try {
                                                ffmpeg = null;
                                                ffmpegInst = await initFFmpeg(null);
                                                ffmpegInst._session_id = sessionId;
                                                ffmpegWrapper.inst = ffmpegInst;
                                            } catch (rErr) {
                                                console.error('[videoExport] Reload failed:', rErr);
                                            }
                                        }
                                    }
                                }

                                // Apply Media Fragment Fallback to frame layer URL if unoptimized
                                if (!isOptimized && isVideoUrl) {
                                    const srcStart = side === 'front' 
                                        ? (layer.data?.sourceStartTime || 0) 
                                        : (layer.data?.backSourceStartTime || 0);
                                    const srcEnd = side === 'front' 
                                        ? (layer.data?.sourceEndTime || (layer.data?.duration || 0)) 
                                        : (layer.data?.backSourceEndTime || (layer.data?.backDuration || 0));
                                    const duration = srcEnd - srcStart;
                                    if (duration > 0) {
                                        targetUrl = `${url}#t=${srcStart.toFixed(3)},${srcEnd.toFixed(3)}`;
                                    }
                                }

                                if (!exportCtx.active) {
                                    if (blobToRevoke) try { URL.revokeObjectURL(blobToRevoke); } catch (e) { }
                                    return;
                                }

                                let texture;
                                if (isVideoUrl) {
                                    const video = await createExportVideoElement(targetUrl, exportCtx);
                                    if (!exportCtx.active) {
                                        try { video.pause(); video.src = ''; video.load(); } catch (e) { }
                                        if (blobToRevoke) try { URL.revokeObjectURL(blobToRevoke); } catch (e) { }
                                        return;
                                    }
                                    if (isOptimized) {
                                        video._isOptimized = true;
                                        video._optimizedDuration = optimizedDuration;
                                        video._blobToRevoke = blobToRevoke;
                                    }
                                    
                                    const srcStart = side === 'front' 
                                        ? (layer.data?.sourceStartTime || 0) 
                                        : (layer.data?.backSourceStartTime || 0);
                                    const srcEnd = side === 'front' 
                                        ? (layer.data?.sourceEndTime || (layer.data?.duration || 0)) 
                                        : (layer.data?.backSourceEndTime || (layer.data?.backDuration || 0));

                                    video._layerSourceStartTime = srcStart;
                                    video._layerSourceEndTime = srcEnd;

                                    texture = PIXI.Texture.from(video, {
                                        resourceOptions: { autoPlay: false, autoUpdate: false, muted: true, loop: false, playsinline: true }
                                    });
                                } else {
                                    const { loadTextureRobust } = await import('../../engine/pixi/textureUtils.js');
                                    texture = await loadTextureRobust(targetUrl, false);
                                }

                                if (!exportCtx.active) {
                                    if (blobToRevoke) try { URL.revokeObjectURL(blobToRevoke); } catch (e) { }
                                    if (texture) try { texture.destroy(true); } catch (e) { }
                                    return;
                                }

                                if (!texture) {
                                    console.warn(`[videoExport]     [FrameSideLoad] texture failed: ${url}`);
                                    if (blobToRevoke) {
                                        try { URL.revokeObjectURL(blobToRevoke); } catch (e) { }
                                    }
                                    return;
                                }

                                const fw = layer.cropWidth ?? layer.width;
                                const fh = layer.cropHeight ?? layer.height;

                                if (side === 'front') {
                                    attachAssetToFramePixi(pixiObject, texture, fw, fh);
                                    const sprite = pixiObject._imageSprite;
                                    if (sprite) {
                                        sprite.width = layer.mediaWidth ?? fw;
                                        sprite.height = layer.mediaHeight ?? fh;
                                        sprite.x = -(layer.cropX ?? 0);
                                        sprite.y = -(layer.cropY ?? 0);
                                    }
                                } else {
                                    attachBackAssetToFrame(pixiObject, texture, fw, fh);
                                }

                                if (pixiObject._cropMask) {
                                    const mask = pixiObject._cropMask;
                                    mask.clear();
                                    mask.rect(0, 0, fw, fh);
                                    mask.fill(0xffffff);
                                }

                                const source = texture.source;
                                if (source && source.resource instanceof HTMLVideoElement) {
                                    const video = source.resource;
                                    if (!exportVideoElements.includes(video)) {
                                        exportVideoElements.push(video);
                                    }

                                    const srcStart = side === 'front' 
                                        ? (layer.data?.sourceStartTime || 0) 
                                        : (layer.data?.backSourceStartTime || 0);
                                    const srcEnd = side === 'front' 
                                        ? (layer.data?.sourceEndTime || (layer.data?.duration || 0)) 
                                        : (layer.data?.backSourceEndTime || (layer.data?.backDuration || 0));

                                    video._layerSourceStartTime = srcStart;
                                    video._layerSourceEndTime = srcEnd;
                                    video._parentLayer = pixiObject;

                                    if (isOptimized) {
                                        video._isOptimized = true;
                                        video._optimizedDuration = optimizedDuration;
                                        video._blobToRevoke = blobToRevoke;
                                    }
                                } else {
                                    if (blobToRevoke) {
                                        try { URL.revokeObjectURL(blobToRevoke); } catch (e) { }
                                    }
                                }
                            } catch (e) {
                                console.error(`[videoExport]     [FrameSideLoad] side: ${side} FAILED:`, e);
                            }
                        };

                        await setupFrameSide(layer.data?.assetUrl, 'front');
                        if (!exportCtx.active || signal?.aborted) throw new Error('cancelled');
                        await setupFrameSide(layer.data?.backAssetUrl, 'back');
                        if (!exportCtx.active || signal?.aborted) throw new Error('cancelled');
                    } else if (layer.type === 'background') {
                        const graphics = new PIXI.Graphics();
                        graphics.rect(0, 0, worldWidth, worldHeight);
                        graphics.fill(layer.data?.color || 0x000000);
                        pixiObject = graphics;
                        pixiObject.isBackground = true;

                        pixiObject._storedWidth = worldWidth;
                        pixiObject._storedHeight = worldHeight;
                        pixiObject._storedAnchorX = 0;
                        pixiObject._storedAnchorY = 0;
                        pixiObject._storedColor = layer.data?.color || 0x000000;

                        if (layer.data?.imageUrl) {
                            addLoadedUrl(layer.data.imageUrl);
                            try {
                                const { loadTextureRobust } = await import('../../engine/pixi/textureUtils.js');
                                const bgTexture = await loadTextureRobust(layer.data.imageUrl);

                                if (bgTexture) {
                                    const bgContainer = new PIXI.Container();
                                    bgContainer.addChild(graphics);

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
                                console.error('[videoExport]     [BackgroundLoad] FAILED:', e);
                            }
                        }
                    }

                    if (pixiObject) {
                        pixiObject.rotation = (layer.rotation || 0) * (Math.PI / 180);
                        if (pixiObject.scale) {
                            pixiObject.scale.set(layer.scaleX ?? 1, layer.scaleY ?? 1);
                        }

                        pixiObject._pixiRenderer = app.renderer;

                        stageContainer.addChild(pixiObject);
                        layerObjects.set(layerId, pixiObject);
                        exportEngine.registerLayerObject(layerId, pixiObject, { sceneId: layer.sceneId });
                    }
                } catch (e) {
                    if (e.message === 'cancelled') throw e;
                    console.error(`[videoExport]   [LayerInit] FAILED for ${layerId}:`, e);
                }
            }
        }

        const exportScale = targetWidth / worldWidth;

        if (app && !app._exportDestroyed && app.renderer && !app.renderer.destroyed) {
            try {
                app.renderer.clear();
                app.render();
            } catch (_e) { /* ignore warm-up failures */ }
        }

        exportEngine.loadProjectMotionFlow(timelineInfo, sceneMotionFlows, layerObjects, {
            allLayers: layers,
            isExport: true,
            exportScale: exportScale,
            transitionContainer: stageContainer
        });

        // Disable the per-frame obstacle layout pass when there are no Liquid Flow text
        // containers — it's an O(n) getBounds() sweep that is a no-op for most projects.
        const hasFlowText = [...layerObjects.values()].some(obj => obj && !obj.destroyed && obj.isFlowText);
        if (!hasFlowText) {
            exportEngine.refreshFlows = () => { };
        }

        const totalDuration = timelineInfo.reduce((acc, s) => acc + s.duration, 0);
        totalFramesNum = Math.ceil(totalDuration * fps);

        onProgress?.({ status: 'rendering', progress: 0 });

        for (const video of exportVideoElements) {
            if (video) {
                video.muted = true;
                video.playbackRate = 1;
                try { video.pause(); } catch (e) { /* ignore */ }
            }
        }

        // Pre-position all video elements at their source start positions immediately before
        // the frame loop. Pre-positioning during layer creation doesn't work reliably because
        // preload='auto' re-advances currentTime over the multi-second layer-init gap.
        // Parallel seeks here cap the one-time overhead at the slowest single seek (~300ms).
        if (exportVideoElements.length > 0) {
            await Promise.all(exportVideoElements.map(video => {
                if (!video || video._isOptimized) return Promise.resolve();
                const initPos = video._layerSourceStartTime || 0;
                if (initPos <= 0 || Math.abs(video.currentTime - initPos) < 0.05) return Promise.resolve();
                video.currentTime = initPos;
                return new Promise(resolve => {
                    video.addEventListener('seeked', resolve, { once: true });
                    setTimeout(resolve, 700);
                });
            }));
        }

        const sceneVideoLayersMap = new Map();
        for (const [layerId, obj] of layerObjects.entries()) {
            if (!obj || obj.destroyed) continue;
            const isVideoLayer = !!(obj._videoElements || obj._videoElement || obj._frontVideoElement || obj._backVideoElement);
            if (!isVideoLayer) continue;

            const sceneId = obj._sceneId;
            if (sceneId) {
                if (!sceneVideoLayersMap.has(sceneId)) sceneVideoLayersMap.set(sceneId, []);
                sceneVideoLayersMap.get(sceneId).push(obj);
            }
        }

        const _mem = (typeof navigator !== 'undefined' && navigator.deviceMemory) || 4;
        const _cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
        const _secondsPerBatch = _mem <= 2 ? 1 : _mem <= 4 ? 2 : _cores >= 8 ? 5 : 3;
        const batchSize = fps * _secondsPerBatch;
        let currentBatchIndex = 0;
        let framesInCurrentBatch = 0;
        const chunkFiles = [];

        pendingWrites = [];
        let generation = 'A';

        let gifFrameIndex = 0;
        let gifOffscreenCtx = null;
        const gifFrames = [];
        if (isGif) {
            const offscreenCanvas = document.createElement('canvas');
            offscreenCanvas.width = targetWidth;
            offscreenCanvas.height = targetHeight;
            gifOffscreenCtx = offscreenCanvas.getContext('2d', { willReadFrequently: true });
        }

        pendingEncode = Promise.resolve();


        for (let frame = 0; frame <= totalFramesNum; frame++) {
            if (signal?.aborted) throw new Error('cancelled');

            const time = frame / fps;

            layerObjects.forEach((obj) => {
                if (!obj || obj.destroyed) return;
                const sceneId = obj._sceneId;
                const range = exportEngine?.sceneRanges?.get(sceneId);
                if (range) {
                    obj.visible = (time >= range.startTime - 0.001 && time < range.endTime + 0.001);
                } else {
                    obj.visible = false;
                }
            });

            if (exportEngine && !exportEngine._destroyed) {
                exportEngine.seek(time);
            }

            layerObjects.forEach((obj) => {
                if (!obj || obj.destroyed || !obj.visible) return;
                try {
                    if (obj._blurFilter && obj.filters && Array.isArray(obj.filters) && obj.filters.includes(obj._blurFilter)) {
                        if (typeof obj._applyAnimatedBlur === 'function') obj._applyAnimatedBlur();
                        if (obj._blurFilter.updatePadding) obj._blurFilter.updatePadding();
                    }
                } catch (e) { /* ignore */ }
                if (obj._tiltMesh) {
                    try {
                        if (typeof obj._applyAnimatedColor === 'function') obj._applyAnimatedColor();
                    } catch (e) { /* ignore */ }
                }
            });

            const seekPromises = [];
            sceneVideoLayersMap.forEach((layersList, sceneId) => {
                const range = exportEngine?.sceneRanges?.get(sceneId);
                if (!range) return;
                if (time < range.startTime - 0.001 || time >= range.endTime + 0.001) return;

                for (const obj of layersList) {
                    if (!obj || obj.destroyed || !obj.visible) continue;

                    const localTime = time - range.startTime;

                    if (obj._videoElements) {
                        const bufferSize = obj._videoElements.length;
                        const activeIndex = frame % bufferSize;

                        const activeVideo = obj._videoElements[activeIndex];
                        const activeTexture = obj._videoTextures[activeIndex];

                        obj._videoSprite.texture = activeTexture;
                        obj._videoTexture = activeTexture;
                        obj._videoElement = activeVideo;

                        const getTargetTime = (vid, tOffset) => {
                            let target;
                            if (vid._isOptimized) {
                                target = Math.max(0, tOffset);
                                const duration = vid._optimizedDuration || (vid._layerSourceEndTime !== undefined && vid._layerSourceStartTime !== undefined ? (vid._layerSourceEndTime - vid._layerSourceStartTime) : (obj._sourceEndTime - obj._sourceStartTime));
                                target = Math.min(target, duration);
                            } else {
                                const srcStart = vid._layerSourceStartTime !== undefined ? vid._layerSourceStartTime : (obj._sourceStartTime || 0);
                                const srcEnd = vid._layerSourceEndTime !== undefined ? vid._layerSourceEndTime : obj._sourceEndTime;
                                target = Math.max(0, tOffset + srcStart);
                                if (srcEnd !== undefined) target = Math.min(target, srcEnd);
                            }
                            return target;
                        };

                        const currentTargetTime = getTargetTime(activeVideo, localTime);
                        let currentSeekP;

                        if (obj._lastSeekTimes[activeIndex] === currentTargetTime && obj._seekPromises[activeIndex]) {
                            currentSeekP = obj._seekPromises[activeIndex];
                        } else {
                            currentSeekP = seekVideoToTime(activeVideo, currentTargetTime, fps, false).then(() => {
                                try { activeTexture.source.update(); } catch (e) { }

                                // Trigger future pre-seeks stabs ONLY after the current frame's seek completes!
                                // This staggers seeks, allowing the decoder to prioritize the active frame,
                                // preventing concurrent seek contention & initial loading timeouts.
                                for (let offset = 1; offset < bufferSize; offset++) {
                                    const futureFrame = frame + offset;
                                    if (futureFrame > totalFramesNum) continue;

                                    const futureTime = futureFrame / fps;
                                    if (futureTime >= range.endTime + 0.001) continue;

                                    const futureIndex = futureFrame % bufferSize;
                                    const futureVideo = obj._videoElements[futureIndex];
                                    const futureTexture = obj._videoTextures[futureIndex];

                                    const futureLocalTime = futureTime - range.startTime;
                                    const futureTargetTime = getTargetTime(futureVideo, futureLocalTime);

                                    if (obj._lastSeekTimes[futureIndex] !== futureTargetTime) {
                                        // Pre-seeks run during PIXI render (main thread blocked by WebGL).
                                        // Use exact random-access seek (allowPlayForward=false) so the video
                                        // lands on the correct frame regardless of render duration.
                                        const p = seekVideoToTime(futureVideo, futureTargetTime, fps, false).then(() => {
                                            try { futureTexture.source.update(); } catch (e) { }
                                        });
                                        obj._seekPromises[futureIndex] = p;
                                        obj._lastSeekTimes[futureIndex] = futureTargetTime;
                                    }
                                }
                            });
                            obj._seekPromises[activeIndex] = currentSeekP;
                            obj._lastSeekTimes[activeIndex] = currentTargetTime;
                        }
                        seekPromises.push(currentSeekP);

                    } else if (obj._videoElement) {
                        const video = obj._videoElement;
                        let targetVideoTime;

                        if (video._isOptimized) {
                            targetVideoTime = Math.max(0, localTime);
                            const duration = video._optimizedDuration || (video._layerSourceEndTime !== undefined && video._layerSourceStartTime !== undefined ? (video._layerSourceEndTime - video._layerSourceStartTime) : (obj._sourceEndTime - obj._sourceStartTime));
                            targetVideoTime = Math.min(targetVideoTime, duration);
                        } else {
                            const srcStart = video._layerSourceStartTime !== undefined ? video._layerSourceStartTime : (obj._sourceStartTime || 0);
                            const srcEnd = video._layerSourceEndTime !== undefined ? video._layerSourceEndTime : obj._sourceEndTime;
                            targetVideoTime = Math.max(0, localTime + srcStart);
                            if (srcEnd !== undefined) targetVideoTime = Math.min(targetVideoTime, srcEnd);
                        }

                        seekPromises.push(
                            seekVideoToTime(video, targetVideoTime, fps, false).then(() => {
                                const sprites = [obj._videoSprite, obj._imageSprite, obj._backSprite].filter(Boolean);
                                for (const s of sprites) {
                                    if (s.texture?.source?.resource === video) {
                                        try { s.texture.source.update(); } catch (e) { }
                                    }
                                }
                            })
                        );
                    }
                }
            });
            if (seekPromises.length > 0) {
                await Promise.all(seekPromises);
            }

            // Only video-tilted layers need a second syncTiltedDisplay here — their GPU
            // texture must be recaptured after the video seek updates currentTime.
            // Non-video tilted layers were already synced inside exportEngine.seek().
            layerObjects.forEach((obj) => {
                if (!obj || obj.destroyed || !obj.visible) return;
                if (!obj._tiltMesh || obj._tiltMesh.destroyed) return;
                if (!(obj._videoElement || obj._videoSprite)) return;
                try {
                    obj._tiltTextureDirty = true;
                    if (syncTiltedDisplay) syncTiltedDisplay(obj);
                } catch (e) { /* ignore */ }
            });

            if (app && !app._exportDestroyed && app.renderer && !app.renderer.destroyed) {
                app.renderer.clear();
                app.render();
            }

            if (isGif) {
                gifOffscreenCtx.clearRect(0, 0, targetWidth, targetHeight);
                gifOffscreenCtx.drawImage(app.canvas, 0, 0);
                const pixels = gifOffscreenCtx.getImageData(0, 0, targetWidth, targetHeight).data;
                gifFrames.push(pixels);
                gifFrameIndex++;
            } else {
                const filename = `${sessionId}_batch_${generation}_${String(framesInCurrentBatch).padStart(5, '0')}.jpg`;
                const writeP = compressAndWriteFrame({
                    canvas: app.canvas,
                    filename,
                    ffmpegInst,
                    quality: 0.85,
                    exportCtx
                }).catch(e => {
                    if (exportCtx.active) {
                        console.error(`[videoExport] Error in background frame write:`, e);
                        throw e;
                    }
                });
                pendingWrites.push(writeP);
                framesInCurrentBatch++;
            }

            if (frame % 5 === 0) {
                const progress = Math.round((frame / totalFramesNum) * 90);
                onProgress?.({
                    status: 'rendering',
                    progress
                });

                await new Promise(r => setTimeout(r, 0));
            }

            if (signal?.aborted) throw new Error('cancelled');

            if (!isGif && (framesInCurrentBatch === batchSize || frame === totalFramesNum)) {
                const capturedGen = generation;
                const capturedFrames = framesInCurrentBatch;
                const chunkName = `${sessionId}_chunk_${String(currentBatchIndex).padStart(3, '0')}.mp4`;

                const writesForThisBatch = pendingWrites;
                pendingWrites = [];
                await Promise.all(writesForThisBatch);
                if (signal?.aborted) throw new Error('cancelled');

                await pendingEncode;
                if (signal?.aborted) throw new Error('cancelled');

                pendingEncode = ffmpegInst.exec([
                    '-y',
                    '-framerate', fps.toString(),
                    '-i', `${sessionId}_batch_${capturedGen}_%05d.jpg`,
                    '-c:v', 'libx264',
                    '-preset', 'ultrafast',
                    '-pix_fmt', 'yuv420p',
                    chunkName
                ]).then(async () => {
                    const deletes = [];
                    for (let i = 0; i < capturedFrames; i++) {
                        deletes.push(
                            ffmpegInst.deleteFile(
                                `${sessionId}_batch_${capturedGen}_${String(i).padStart(5, '0')}.jpg`
                            ).catch(() => { })
                        );
                    }
                    await Promise.all(deletes);
                });

                chunkFiles.push(chunkName);
                currentBatchIndex++;
                framesInCurrentBatch = 0;
                generation = generation === 'A' ? 'B' : 'A';
            }
        }

        if (!isGif) {
            onProgress?.({ status: 'encoding', progress: 91 });
            try { await pendingEncode; }
            catch (e) { if (signal?.aborted) throw new Error('cancelled'); throw e; }
            onProgress?.({ status: 'encoding', progress: 93 });
        }

        if (signal?.aborted) throw new Error('cancelled');

        if (isGif) {
            onProgress?.({ status: 'encoding', progress: 92 });

            const { GIFEncoder, quantize } = await import('gifenc');
            const encoder = GIFEncoder();
            const delayMs = Math.max(20, Math.round(1000 / fps));
            const loopValue = Number.isFinite(gifOptions?.loop) ? gifOptions.loop : 0;
            const repeat = loopValue === 0 ? 0 : -1;

            const MAX_SAMPLES = 100;
            const step = Math.max(1, Math.floor(gifFrames.length / MAX_SAMPLES));
            const sampledFrames = [];
            for (let i = 0; i < gifFrames.length; i += step) {
                sampledFrames.push(gifFrames[i]);
                if (sampledFrames.length >= MAX_SAMPLES) break;
            }
            const bytesPerFrame = gifFrames[0].length;
            const combined = new Uint8ClampedArray(sampledFrames.length * bytesPerFrame);
            for (let i = 0; i < sampledFrames.length; i++) {
                combined.set(sampledFrames[i], i * bytesPerFrame);
            }
            const globalPalette = quantize(combined, 256, { format: 'rgb565' });

            const colorCache = new Int16Array(16777216);
            colorCache.fill(-1);

            const applyPaletteStable = (rgba, palette) => {
                const data = new Uint32Array(rgba.buffer, rgba.byteOffset, rgba.byteLength / 4);
                const length = data.length;
                const index = new Uint8Array(length);

                for (let j = 0; j < length; j++) {
                    const color = data[j];
                    const r = color & 0xff;
                    const g = (color >> 8) & 0xff;
                    const b = (color >> 16) & 0xff;

                    const key = (r << 16) | (g << 8) | b;

                    let idx = colorCache[key];
                    if (idx === -1) {
                        let mindist = 1e100;
                        let k = 0;
                        for (let p = 0; p < palette.length; p++) {
                            const px = palette[p];
                            const curdist = (px[0] - r) ** 2 + (px[1] - g) ** 2 + (px[2] - b) ** 2;
                            if (curdist < mindist) {
                                mindist = curdist;
                                k = p;
                            }
                        }
                        idx = k;
                        colorCache[key] = idx;
                    }
                    index[j] = idx;
                }
                return index;
            };

            for (let i = 0; i < gifFrames.length; i++) {
                if (signal?.aborted) throw new Error('cancelled');

                const index = applyPaletteStable(gifFrames[i], globalPalette, targetWidth);

                encoder.writeFrame(index, targetWidth, targetHeight, {
                    palette: globalPalette,
                    delay: delayMs,
                    first: i === 0,
                    repeat,
                    dispose: 1,
                });

                if (i % 4 === 0) {
                    const pct = Math.min(99, 92 + Math.round(((i + 1) / gifFrames.length) * 7));
                    onProgress?.({ status: 'encoding', progress: pct });
                    await new Promise(r => setTimeout(r, 0));
                }
            }
            encoder.finish();

            onProgress?.({ status: 'encoding', progress: 100 });
            return new Blob([encoder.bytes()], { type: 'image/gif' });
        }

        onProgress?.({ status: 'encoding', progress: 94 });

        const videoFileName = hasAudio ? `${sessionId}_video_only.mp4` : `${sessionId}_output.mp4`;

        let concatText = '';
        for (const chunk of chunkFiles) {
            concatText += `file '${chunk}'\n`;
        }
        await ffmpegInst.writeFile(`${sessionId}_concat.txt`, new TextEncoder().encode(concatText));

        onProgress?.({ status: 'encoding', progress: 95 });

        await ffmpegInst.exec([
            '-y',
            '-f', 'concat',
            '-safe', '0',
            '-i', `${sessionId}_concat.txt`,
            '-c', 'copy',
            '-fflags', '+genpts',
            videoFileName
        ]);

        onProgress?.({ status: 'encoding', progress: 96 });

        const cleanupPromises = chunkFiles.map(chunk => ffmpegInst.deleteFile(chunk).catch(() => { }));
        cleanupPromises.push(ffmpegInst.deleteFile(`${sessionId}_concat.txt`).catch(() => { }));
        await Promise.all(cleanupPromises);

        if (signal?.aborted) throw new Error('cancelled');

        if (hasAudio) {
            await mixAudioIntoVideo(ffmpegInst, audioSources, onProgress);
        } else {
            onProgress?.({ status: 'encoding', progress: 98 });
        }

        if (signal?.aborted) throw new Error('cancelled');

        onProgress?.({ status: 'encoding', progress: 100 });
        const data = await ffmpegInst.readFile(`${sessionId}_output.mp4`);
        return new Blob([data.buffer], { type: 'video/mp4' });

    } catch (error) {
        if (error.message === 'cancelled') throw error;
        throw error;
    } finally {
        exportCtx.active = false;
        if (signal) {
            signal.removeEventListener('abort', abortHandler);
        }
        try { if (pendingWrites.length) await Promise.all(pendingWrites); } catch (e) { /* ignore */ }
        try { await pendingEncode; } catch (e) { /* ignore */ }
        cleanupExportResources(exportEngine, app, exportVideoElements, layerObjects, loadedUrls);
        try {
            await cleanupTempFiles(ffmpegInst, totalFramesNum, audioSources.length, sessionId);
        } catch (e) {
            /* ignore */
        }
    }
};
