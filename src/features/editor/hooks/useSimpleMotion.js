import { useCallback, useState, useEffect, useRef, useMemo } from 'react'
import { useSelector, useDispatch } from 'react-redux'
import { getGlobalMotionEngine } from '../../engine/motion'
import { selectSceneMotionFlow, selectLayers, selectProjectTimelineInfo, selectTotalProjectDuration, selectSceneMotionFlows } from '../../../store/slices/projectSlice'
import { applyTransformInline } from './useCanvasLayers'
import { createVideoLayer } from '../../engine/pixi/createLayer'

/**
 * Hook for managing motion playback on the canvas.
 * Refactored for scene-based motion flows where steps contain layerActions.
 * 
 * @param {Map} layerObjects - Map of layerId -> PIXI object
 * @param {string} currentSceneId - Current scene ID for fetching motion data
 * @param {number} totalTimeInSeconds - Total scene duration in seconds
 * @param {function} onPlayingChange - Callback when playing state changes (optional)
 */
export function useSimpleMotion(layerObjects, currentSceneId, totalTimeInSeconds = 0, onPlayingChange = null, motionCaptureMode = null) {
    const dispatch = useDispatch()

    // Get all layers for resetting state during transitions
    const layers = useSelector(selectLayers)

    // When capture is active or transitioning (e.g. after add-step fast preview), skip resetting
    // PIXI objects to base in prepareEngine so the video/layer stays at end-of-step position.
    const motionCaptureModeRef = useRef(motionCaptureMode)
    motionCaptureModeRef.current = motionCaptureMode

    // Get project timeline info for all scenes
    const timelineInfo = useSelector(selectProjectTimelineInfo)
    const totalProjectDuration = useSelector(selectTotalProjectDuration)

    // Get scene-based motion flow for the current scene
    const sceneMotionFlow = useSelector((state) =>
        currentSceneId ? selectSceneMotionFlow(state, currentSceneId) : null
    )

    // Find info for the current scene in the global timeline
    const currentSceneTimelineInfo = useMemo(() => {
        if (!timelineInfo || !currentSceneId) return null
        return timelineInfo.find(s => s.id === currentSceneId)
    }, [timelineInfo, currentSceneId])

    const startTimeOffset = currentSceneTimelineInfo?.startTime || 0

    const motionEngine = getGlobalMotionEngine()
    const [isPlayingInternal, setIsPlayingInternal] = useState(false)
    const [playheadTime, setPlayheadTime] = useState(0)
    const [isBuffering, setIsBuffering] = useState(false)

    // Wrapper for setIsPlaying to support external synchronization
    const setIsPlaying = useCallback((val) => {
        setIsPlayingInternal(val)
        if (onPlayingChange) onPlayingChange(val)
    }, [onPlayingChange])

    // Use refs for values needed in callbacks to avoid dependency cycles
    const layerObjectsRef = useRef(layerObjects)
    const sceneMotionFlowsRef = useRef({})
    const layersRef = useRef(layers)
    const sceneMotionFlowRef = useRef(sceneMotionFlow)
    const currentSceneIdRef = useRef(currentSceneId)
    const totalTimeRef = useRef(totalTimeInSeconds)

    // Track the last prepared data signature to avoid redundant re-prepares
    const lastPreparedDataRef = useRef(null)

    // Update refs when props/store change
    useEffect(() => {
        layerObjectsRef.current = layerObjects
    }, [layerObjects])

    // Update other refs
    sceneMotionFlowRef.current = sceneMotionFlow
    currentSceneIdRef.current = currentSceneId
    totalTimeRef.current = totalTimeInSeconds
    // [BASE EDITING FIX] Update layers ref in effect to ensure it's updated before prepareEngine runs
    useEffect(() => {
        layersRef.current = layers
    }, [layers])

    // Prepare engine with PROJECT-WIDE motion data
    // [PERFORMANCE FIX] Use refs for data that changes frequently to keep the callback stable.
    // This stops the infinite re-render loop caused by prepareEngine recreating while playing/scrubbing.
    const timelineInfoRef = useRef(timelineInfo)
    useEffect(() => {
        timelineInfoRef.current = timelineInfo
    }, [timelineInfo])

    const prepareEngine = useCallback((force = false) => {
        const objects = layerObjectsRef.current
        const timeline = timelineInfoRef.current

        // [FIX] Anti-Reset: Skip prepare if a manual override is in progress
        if (!force && lastPreparedDataRef.current && typeof lastPreparedDataRef.current === 'string' && lastPreparedDataRef.current.startsWith('preview-override-')) {
            return
        }

        const flowsMap = sceneMotionFlowsRef.current

        if (!objects || !timeline || !flowsMap) return

        layersRef.current = layersRef.current || layers

        // Create a signature of the project-wide data
        const layerPositionsHash = timeline?.flatMap(s => s.layers || []).map(layerId => {
            const l = layersRef.current[layerId]
            return l ? `${l.x},${l.y},${l.rotation},${l.scaleX},${l.scaleY},${l.data?.fill || l.data?.color || ''},${l.opacity},${l.data?.showingFront ?? ''}` : ''
        }).join('|')

        const sceneTimingsHash = timeline?.map(s => `${s.id}:${s.startTime}-${s.endTime}`).join('|')

        const currentDataSignature = JSON.stringify({
            sceneCount: timeline.length,
            layerCount: objects.size,
            totalDuration: totalProjectDuration,
            layerPositionsHash,
            sceneTimingsHash,
            flowsHash: JSON.stringify(flowsMap)
        })

        if (!force && lastPreparedDataRef.current === currentDataSignature) {
            return
        }

        const currentPlayheadTime = motionEngine.masterTimeline?.time() || 0
        motionEngine.unloadAllMotions()

        const capture = motionCaptureModeRef.current
        const skipResetForCapture = capture?.isActive || capture?.isTransitioning

        const currentLayers = layersRef.current
        if (objects && currentLayers && !skipResetForCapture) {
            objects.forEach((pixiObject, layerId) => {
                const baseLayerData = currentLayers[layerId]
                if (baseLayerData) {
                    const sceneId = baseLayerData.sceneId
                    const sceneInfo = timeline?.find(s => s.id === sceneId)
                    const startTimeOffset = sceneInfo?.startTime || 0
                    applyTransformInline(pixiObject, baseLayerData, null, layerId, capture, true, null, null, startTimeOffset)
                }
            })
        }

        motionEngine.loadProjectMotionFlow(timeline, flowsMap, objects, {
            allLayers: currentLayers
        })

        if (currentPlayheadTime > 0) {
            motionEngine.seek(currentPlayheadTime)
            setPlayheadTime(currentPlayheadTime)
        }

        lastPreparedDataRef.current = currentDataSignature
    }, [motionEngine, totalProjectDuration])

    // Get all motion flows for project-wide tracking
    const allMotionFlows = useSelector(selectSceneMotionFlows)
    useEffect(() => {
        // Keep internal ref updated for prepareEngine logic
        sceneMotionFlowsRef.current = allMotionFlows
    }, [allMotionFlows])

    // [BASE EDITING FIX] Create a hash of layer base states to detect when base state changes
    // This ensures the engine rebuilds when user edits the base initial state
    // Match the format used in prepareEngine's layerPositionsHash for consistency
    const layersBaseStateHash = useMemo(() => {
        if (!layers || !timelineInfo) return ''
        // Create hash matching prepareEngine's format: only scene layers, same property order
        return timelineInfo?.flatMap(s => s.layers || []).map(layerId => {
            const l = layers[layerId]
            return l ? `${l.x},${l.y},${l.rotation},${l.scaleX},${l.scaleY},${l.data?.fill || l.data?.color || ''},${l.opacity},${l.data?.showingFront ?? ''}` : ''
        }).join('|')
    }, [layers, timelineInfo])

    // Rebuild engine when project structure, motion flow, OR base layer state changes
    const flowsJson = JSON.stringify(allMotionFlows)
    useEffect(() => {
        // If we're currently playing, we defer the rebuild to avoid visual jumps
        // But we MUST re-prepare once playback stops to sync with the latest Redux state
        if (isPlayingInternal) {
            return
        }

        // [FIX] Skip engine rebuild during active motion capture to prevent snap-back.
        // onInteractionEnd dispatches Redux actions that change flowsJson, triggering this effect.
        // Rebuilding the engine resets PIXI positions via GSAP tween initialization and seek,
        // causing a visible flicker before the ticker can re-enforce captured positions.
        // The engine will be properly rebuilt when capture mode ends (via tweenTo or cancel).
        const capture = motionCaptureModeRef.current
        if (capture?.isActive) return

        // [BASE EDITING FIX] Ensure layersRef is updated before prepareEngine runs
        // This is critical because prepareEngine uses layersRef.current for hash calculation
        layersRef.current = layers

        prepareEngine(false)
    }, [prepareEngine, flowsJson, timelineInfo.length, totalProjectDuration, isPlayingInternal, layersBaseStateHash, layers])

    // ... (Listen for engine events and sync isPlaying state - no changes needed)
    useEffect(() => {
        // [FIX] Never trigger this timeout rebuild while playing or during a preview 
        if (isPlayingInternal) {
            return
        }

        // Use a single frame delay (16ms) instead of 100ms to ensure faster sync after splits
        const timer = setTimeout(() => {
            // [FIX] Skip rebuild during active motion capture (same reason as above effect)
            const capture = motionCaptureModeRef.current
            if (capture?.isActive) return
            prepareEngine()
        }, 16)
        return () => clearTimeout(timer)
    }, [prepareEngine, currentSceneId, isPlayingInternal])
    useEffect(() => {
        const handleMotionComplete = () => {
            setIsPlaying(false)
        }

        const handleUpdate = (time) => {
            setPlayheadTime(time)
        }

        // Set up callbacks
        motionEngine.onAllComplete(handleMotionComplete)
        motionEngine.onUpdate(handleUpdate)

        return () => {
            // Clean up callbacks
            motionEngine.onAllCompleteCallbacks = motionEngine.onAllCompleteCallbacks.filter(
                cb => cb !== handleMotionComplete
            )
            motionEngine.onUpdateCallbacks = motionEngine.onUpdateCallbacks.filter(
                cb => cb !== handleUpdate
            )
        }
    }, [motionEngine])

    // Sync React isPlaying state with MotionEngine
    useEffect(() => {
        const checkPlayingState = () => {
            if (motionEngine.isPlaying !== isPlayingInternal) {
                setIsPlaying(motionEngine.isPlaying)
            }
        }
        const interval = setInterval(checkPlayingState, 200)
        return () => clearInterval(interval)
    }, [motionEngine, isPlayingInternal])

    // [PERF] Pre-warm video layers only for current scene + next scene (N+1 lookahead).
    // Previously pre-warmed ALL scenes upfront, which created too many HTMLVideoElement decoders
    // (each consuming 30-80MB on mobile). The engine's 0.8s pre-seek lookahead in syncMedia()
    // handles near-future scenes, so we only need the immediate neighborhood.
    useEffect(() => {
        if (!timelineInfo || !allMotionFlows || !layers) return

        // Find current scene index
        const currentIndex = timelineInfo.findIndex(s => s.id === currentSceneId)
        if (currentIndex === -1) return

        // Only pre-warm current scene and next scene
        const scenesToWarm = new Set()
        scenesToWarm.add(currentIndex)
        if (currentIndex + 1 < timelineInfo.length) {
            scenesToWarm.add(currentIndex + 1)
        }

        // Track which layers we've warmed so we can unregister distant ones
        const warmedLayerIds = new Set()

        scenesToWarm.forEach(idx => {
            const sceneInfo = timelineInfo[idx]
            const sceneLayers = sceneInfo.layers || []
            sceneLayers.forEach(layerId => {
                const layer = layers[layerId]
                if (layer && layer.type === 'video' && layer.data?.url) {
                    warmedLayerIds.add(layerId)
                    createVideoLayer(layer, { id: layerId }).then(container => {
                        const videoElement = container?._videoElement
                        if (videoElement) {
                            motionEngine.registerBackgroundMedia(layerId, videoElement, {
                                sceneId: sceneInfo.id,
                                sourceStartTime: layer.data.sourceStartTime,
                                sourceEndTime: layer.data.sourceEndTime
                            })
                        }
                    }).catch(err => {
                        console.warn(`[useSimpleMotion] Failed to pre-warm video ${layerId}:`, err)
                    })
                }
            })
        })

        // Unregister background media for distant scenes to free decoders
        timelineInfo.forEach((sceneInfo, idx) => {
            if (scenesToWarm.has(idx)) return
            const sceneLayers = sceneInfo.layers || []
            sceneLayers.forEach(layerId => {
                const layer = layers[layerId]
                if (layer && layer.type === 'video' && !warmedLayerIds.has(layerId)) {
                    motionEngine.unregisterBackgroundMedia(layerId)
                }
            })
        })
    }, [timelineInfo, allMotionFlows, layers, motionEngine, currentSceneId])

    // Track project-wide buffering state from MotionEngine
    useEffect(() => {
        const checkBuffering = () => {
            const buffering = motionEngine.isBuffering
            if (buffering !== isBuffering) {
                setIsBuffering(buffering)
            }
        }

        // Sync more frequently during playback for smoother UI
        const interval = setInterval(checkBuffering, isPlayingInternal ? 100 : 500)
        return () => clearInterval(interval)
    }, [motionEngine, isBuffering, isPlayingInternal])

    // ============================================================================
    // PLAYBACK CONTROLS
    // ============================================================================

    const playAll = useCallback(() => {
        // [FIX] Use force=false here. A forced rebuild can race with the pause
        // state set by a scene cut, causing the video to restart unexpectedly.
        // The engine should only rebuild if the data has genuinely changed.
        prepareEngine(false)

        // Let the engine handle play/resume/restart logic
        motionEngine.playAll()
        setIsPlaying(true)
    }, [motionEngine, prepareEngine])

    // Pause all motions
    const pauseAll = useCallback(() => {
        motionEngine.pauseAll()
        setIsPlaying(false)
        // Do NOT seek - marker should stay at the pause point for resume
    }, [motionEngine])

    // Stop and seek to scene start (used when clicking canvas or selecting layers)  
    const stopAndSeekToSceneStart = useCallback(() => {
        motionEngine.pauseAll()
        setIsPlaying(false)

        // Seek to current scene's start time
        const sceneStartTime = currentSceneTimelineInfo?.startTime || 0
        motionEngine.seek(sceneStartTime)
        setPlayheadTime(sceneStartTime)
    }, [motionEngine, currentSceneTimelineInfo])

    /**
     * Pause playback at the current time without resetting or seeking.
     * This is the preferred behavior for canvas clicks and selection changes.
     */
    const pausePlayback = useCallback(() => {
        motionEngine.pauseAll()
        setIsPlaying(false)
        // [FIX] Clear marker on pause to ensure next rebuild isn't blocked 
        // if this was an interrupted transition
        if (lastPreparedDataRef.current && typeof lastPreparedDataRef.current === 'string' && lastPreparedDataRef.current.startsWith('preview-override-')) {
            lastPreparedDataRef.current = null
        }
    }, [motionEngine])

    // Stop all motions (reset to beginning)
    const stopAll = useCallback(() => {
        motionEngine.stopAll()
        setIsPlaying(false)
        setPlayheadTime(0)
        // [FIX] Clear marker on stop to ensure next rebuild isn't blocked
        if (lastPreparedDataRef.current && typeof lastPreparedDataRef.current === 'string' && lastPreparedDataRef.current.startsWith('preview-override-')) {
            lastPreparedDataRef.current = null
        }
    }, [motionEngine])

    // Seek to specific time.
    // [PERF] Uses lightweight scrub() for continuous playhead dragging (detected via
    // rapid successive calls), and full seek() for discrete jumps (scene clicks, etc).
    const lastSeekTimeRef = useRef(0)
    const seek = useCallback((time) => {
        // [PERF] Detect continuous scrubbing: if last seek was < 80ms ago, use
        // lightweight scrub path that skips prepareEngine and uses relaxed video sync.
        const now = performance.now()
        const isContinuousScrub = now - lastSeekTimeRef.current < 80
        lastSeekTimeRef.current = now

        if (isContinuousScrub) {
            // Fast path: skip prepareEngine, use lightweight scrub
            motionEngine.scrub(time)
        } else {
            // Full path: ensure engine is up to date, force exact sync
            prepareEngine(false)
            motionEngine.seek(time)
        }
        setPlayheadTime(time)
    }, [motionEngine, prepareEngine])

    const tweenTo = useCallback((time, options = {}) => {
        const objects = layerObjectsRef.current
        const flowsMap = sceneMotionFlowsRef.current
        const timeline = timelineInfoRef.current



        // If a flow is provided (e.g. from MotionPanel after an edit), reload the project-wide engine 
        // but with the OVERRIDDEN flow for the specific scene.
        if (options.flow && currentSceneIdRef.current) {

            // Force engine state to playing EARLY so applyTransformInline knows to stop overrides
            motionEngine.isPlaying = true
            motionEngine.unloadAllMotions()
            const currentLayers = layersRef.current
            if (objects && currentLayers) {
                objects.forEach((pixiObject, layerId) => {
                    const baseLayerData = currentLayers[layerId]
                    if (baseLayerData) {
                        const sceneId = baseLayerData.sceneId
                        const sceneInfo = timeline?.find(s => s.id === sceneId)
                        const startTimeOffset = sceneInfo?.startTime || 0
                        applyTransformInline(pixiObject, baseLayerData, null, layerId, null, true, null, null, startTimeOffset) // force=true!
                    }
                })
            }
            // Object registration handled by useCanvasLayers

            const sharedContext = {
                builders: new Map(),
                stateTracker: new Map()
            }

            // Load all scenes, but use the provided OVERRIDDEN flow for the current active scene
            timeline.forEach(sceneInfo => {
                const flowToLoad = sceneInfo.id === currentSceneIdRef.current ? options.flow : flowsMap[sceneInfo.id]
                if (flowToLoad) {
                    motionEngine.loadSceneMotionFlow(flowToLoad, objects || new Map(), {
                        startTimeOffset: sceneInfo.startTime,
                        allLayers: currentLayers
                    }, sharedContext)
                }
            })

            // Finalize all accumulated timelines into master
            sharedContext.builders.forEach((builder, layerId) => {
                motionEngine.activeTimelines.set(layerId, builder.timeline)
                if (builder.timeline.instance) {
                    builder.timeline.instance.paused(false)
                    motionEngine.masterTimeline.add(builder.timeline.instance, 0)
                }
            })

            motionEngine.setTotalDuration(totalProjectDuration)

            // Update signature to match the temporary override state
            // [FIX] Anti-Reset: Use a recognizable marker that prepareEngine can skip
            const newMarker = 'preview-override-' + Date.now()
            lastPreparedDataRef.current = newMarker
        } else {
            // Just ensure it's prepared with whatever it has
            prepareEngine(false)
        }

        // Handle optional startTime for precise segment transitions
        if (options.startTime !== undefined) {
            motionEngine.seek(options.startTime)
        }

        setIsPlaying(true)

        // [FIX] Cleanup marker on transition complete
        const originalOnComplete = options.onComplete
        const wrappedOptions = {
            ...options,
            onComplete: () => {
                if (lastPreparedDataRef.current && typeof lastPreparedDataRef.current === 'string' && lastPreparedDataRef.current.startsWith('preview-override-')) {
                    lastPreparedDataRef.current = null
                }
                if (originalOnComplete) originalOnComplete()
            }
        }

        return motionEngine.tweenTo(time, wrappedOptions)
    }, [motionEngine, prepareEngine, setIsPlaying, totalProjectDuration])
    
    // [COLOR SYNC FIX] Helper to convert RGB components to hex string
    const rgbToHex = (r, g, b) => {
        const toHex = (n) => Math.round(n).toString(16).padStart(2, '0')
        return `#${toHex(r)}${toHex(g)}${toHex(b)}`
    }

    /**
     * Get current visual transforms for all registered layers.
     * Useful for synchronizing capture mode with the current engine state.
     */
    const getLayerCurrentTransforms = useCallback(() => {
        const transforms = new Map()
        if (layerObjects) {
            layerObjects.forEach((obj, id) => {
                if (obj && !obj.destroyed) {
                    // [COLOR SYNC FIX] Capture color from GSAP animated state or visual style
                    // Prioritize _animatedColorState if it exists (numeric) or _color (FlowText string)
                    const numericColor = obj._animatedColorState?.numeric ?? obj._storedColor
                    const hexColor = obj._color ?? (numericColor !== undefined ? (typeof numericColor === 'string' ? numericColor : '#' + numericColor.toString(16).padStart(6, '0')) : null)
                    
                    transforms.set(id, {
                        ...obj._lastCapturedTransform, // Fallback for specialized properties
                        id: id,
                        x: obj.x,
                        y: obj.y,
                        rotation: (obj.rotation * 180) / Math.PI,
                        scaleX: obj.scale.x,
                        scaleY: obj.scale.y,
                        opacity: obj.alpha,
                        blur: obj._blurLogicalStrength ?? 0,
                        color: obj._animatedColorState ? rgbToHex(obj._animatedColorState.r, obj._animatedColorState.g, obj._animatedColorState.b) : (hexColor ?? (obj.style?.fill)),
                        width: obj.isFlowText ? (obj.wordWrapWidth || 100) : (obj.width || 100),
                        height: obj.isFlowText ? (obj._actualHeight || 40) : (obj.height || 100),
                        cropX: obj.cropX,
                        cropY: obj.cropY,
                        cropWidth: obj.cropWidth,
                        cropHeight: obj.cropHeight,
                        mediaWidth: obj._mediaWidth ?? obj.mediaWidth,
                        mediaHeight: obj._mediaHeight ?? obj.mediaHeight,
                        cornerRadius: obj.cornerRadius ?? (obj._storedShapeData?.cornerRadius ?? 0)
                    })
                }
            })
        }
        return transforms
    }, [layerObjects])

    return {
        playAll,
        pauseAll,
        stopAndSeekToSceneStart,
        pausePlayback,
        stopAll,
        seek,
        tweenTo,
        getLayerCurrentTransforms,
        prepareEngine, // [EXPOSE] Allow external code to force engine rebuild
        layerObjects,
        isPlaying: isPlayingInternal,
        isBuffering,
        playheadTime
    }
}
