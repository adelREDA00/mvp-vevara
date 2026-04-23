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
    try {
        return typeof self !== 'undefined'
            && self.crossOriginIsolated === true
            && typeof SharedArrayBuffer !== 'undefined'
            && (navigator.hardwareConcurrency || 0) >= 4
            && (navigator.deviceMemory || 4) >= 4;
    } catch (e) {
        return false;
    }
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

const _hasRVFC = typeof HTMLVideoElement !== 'undefined' && 'requestVideoFrameCallback' in HTMLVideoElement.prototype;

function seekVideoToTime(video, targetTime, fps) {
    return new Promise(resolve => {
        if (Math.abs(video.currentTime - targetTime) < 0.01 && !video.seeking && video.readyState >= 2) {
            resolve();
            return;
        }

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

function captureFrame(canvas, isGif = false) {
    return new Promise(resolve => {
        const format = isGif ? 'image/png' : 'image/jpeg';
        canvas.toBlob(blob => {
            if (!blob) {
                const b64 = canvas.toDataURL(format, isGif ? undefined : 0.95);
                const bin = atob(b64.split(',')[1]);
                const arr = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
                resolve(arr);
                return;
            }
            blob.arrayBuffer().then(buf => resolve(new Uint8Array(buf)));
        }, format, isGif ? undefined : 0.95);
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
function cleanupExportResources(exportEngine, app, exportVideoElements, layerObjects) {
    if (_cleanupInProgress) return;
    _cleanupInProgress = true;

    try {
        if (exportEngine && !exportEngine._destroyed) {
            try {
                exportEngine.destroy();
                exportEngine._destroyed = true;
            } catch (e) { /* ignore */ }
        }
    } catch (e) { /* ignore */ }

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

            try {
                if (app.ticker) {
                    app.ticker.stop();
                    app.ticker.destroy();
                }
            } catch (e) { /* ignore */ }

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

            try {
                if (app.stage) {
                    app.stage.removeChildren();
                }
            } catch (e) { /* ignore */ }

            try {
                if (app.canvas) {
                    const gl = app.canvas.getContext('webgl2') || app.canvas.getContext('webgl');
                    if (gl) {
                        const loseCtx = gl.getExtension('WEBGL_lose_context');
                        if (loseCtx) loseCtx.loseContext();
                    }
                }
            } catch (e) { /* ignore */ }

            try {
                if (app.canvas?.parentNode) {
                    app.canvas.parentNode.removeChild(app.canvas);
                }
            } catch (e) { /* ignore */ }

            try {
                const host = app._exportCanvasHost;
                if (host && host.parentNode) {
                    host.parentNode.removeChild(host);
                }
                app._exportCanvasHost = null;
            } catch (e) { /* ignore */ }
        }
    } catch (e) {
        /* ignore */
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
    if (editorMotionControls?.isPlaying) {
        try { editorMotionControls.pauseAll(); } catch (e) { /* ignore */ }
    }

    const isGif = format === 'gif';

    if (isGif) {
        fps = gifOptions?.fps || 15;
    }

    const sessionId = `exp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const ffmpegInst = await initFFmpeg(null);
    ffmpegInst._session_id = sessionId;

    const abortHandler = () => {
        try {
            if (ffmpegInst) ffmpegInst.terminate();
        } catch (e) { /* ignore */ }
        if (ffmpeg === ffmpegInst) ffmpeg = null;
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
                                    
                                    video._layerSourceStartTime = layer.data?.sourceStartTime || 0;
                                    video._layerSourceEndTime = layer.data?.sourceEndTime || (layer.data?.duration || 0);
                                    video._parentLayer = pixiObject;
                                }
                            } catch (e) {
                                /* ignore */
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
                                /* ignore */
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
                    /* ignore */
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
            exportScale: exportScale
        });

        const totalDuration = timelineInfo.reduce((acc, s) => acc + s.duration, 0);
        totalFramesNum = Math.ceil(totalDuration * fps);

        onProgress?.({ status: 'rendering', progress: 0 });

        for (const video of exportVideoElements) {
            if (video) {
                video.muted = true;
                video.currentTime = 0;
                video.playbackRate = 1;
                try { await video.play(); } catch (e) { /* ignore autoplay blocks */ }
            }
        }

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

        const _mem = (typeof navigator !== 'undefined' && navigator.deviceMemory) || 4;
        const _cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
        const _secondsPerBatch = _mem <= 2 ? 1 : _mem <= 4 ? 2 : _cores >= 8 ? 5 : 3;
        const batchSize = fps * _secondsPerBatch;
        let currentBatchIndex = 0;
        let framesInCurrentBatch = 0;
        const chunkFiles = [];

        pendingEncode = Promise.resolve();
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
                    /* ignore */
                }
            });

            layerObjects.forEach((obj, id) => {
                if (!obj || obj.destroyed || !obj.visible) return;
                if (!obj._tiltMesh) return;
                try {
                    if (typeof obj._applyAnimatedColor === 'function') {
                        obj._applyAnimatedColor();
                    }
                } catch (e) {
                    /* ignore */
                }
            });

            const seekPromises = [];
            sceneVideoMap.forEach((entries, sceneId) => {
                const range = exportEngine?.sceneRanges?.get(sceneId);
                if (!range) return;
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

            layerObjects.forEach((obj, id) => {
                if (!obj || obj.destroyed || !obj.visible) return;
                try {
                    if (obj._tiltMesh && !obj._tiltMesh.destroyed) {
                        const isVideo = !!(obj._videoElement || obj._videoSprite);
                        if (isVideo) {
                            obj._tiltTextureDirty = true;
                        }
                        
                        if (syncTiltedDisplay) syncTiltedDisplay(obj);
                    }
                } catch (e) {
                    /* ignore */
                }
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
                const frameData = await captureFrame(app.canvas, isGif);
                const writeP = ffmpegInst.writeFile(
                    `${sessionId}_batch_${generation}_${String(framesInCurrentBatch).padStart(5, '0')}.jpg`,
                    frameData
                ).catch(e => { throw e; });
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
            try { await pendingEncode; }
            catch (e) { if (signal?.aborted) throw new Error('cancelled'); throw e; }
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

        onProgress?.({ status: 'encoding', progress: 95 });

        const videoFileName = hasAudio ? `${sessionId}_video_only.mp4` : `${sessionId}_output.mp4`;

        let concatText = '';
        for (const chunk of chunkFiles) {
            concatText += `file '${chunk}'\n`;
        }
        await ffmpegInst.writeFile(`${sessionId}_concat.txt`, new TextEncoder().encode(concatText));

        await ffmpegInst.exec([
            '-y',
            '-f', 'concat',
            '-safe', '0',
            '-i', `${sessionId}_concat.txt`,
            '-c', 'copy',
            '-fflags', '+genpts',
            videoFileName
        ]);

        const cleanupPromises = chunkFiles.map(chunk => ffmpegInst.deleteFile(chunk).catch(() => { }));
        cleanupPromises.push(ffmpegInst.deleteFile(`${sessionId}_concat.txt`).catch(() => { }));
        await Promise.all(cleanupPromises);

        if (signal?.aborted) throw new Error('cancelled');

        if (hasAudio) {
            await mixAudioIntoVideo(ffmpegInst, audioSources, onProgress);
        }

        if (signal?.aborted) throw new Error('cancelled');

        onProgress?.({ status: 'encoding', progress: 100 });
        const data = await ffmpegInst.readFile(`${sessionId}_output.mp4`);
        return new Blob([data.buffer], { type: 'video/mp4' });

    } catch (error) {
        if (error.message === 'cancelled') throw error;
        throw error;
    } finally {
        if (signal) {
            signal.removeEventListener('abort', abortHandler);
        }
        try { if (pendingWrites.length) await Promise.all(pendingWrites); } catch (e) { /* ignore */ }
        try { await pendingEncode; } catch (e) { /* ignore */ }
        cleanupExportResources(exportEngine, app, exportVideoElements, layerObjects);
        try {
            await cleanupTempFiles(ffmpegInst, totalFramesNum, audioSources.length, sessionId);
        } catch (e) {
            /* ignore */
        }
    }
};
