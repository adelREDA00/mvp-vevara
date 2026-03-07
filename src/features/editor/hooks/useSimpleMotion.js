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
    const prepareEngine = useCallback((force = false) => {
        const objects = layerObjectsRef.current

        // [FIX] Anti-Reset: Skip prepare if a manual override is in progress
        // This prevents Redux state updates (from dispatching actions) 
        // from clearing the engine right as a preview starts.
        if (!force && lastPreparedDataRef.current && typeof lastPreparedDataRef.current === 'string' && lastPreparedDataRef.current.startsWith('preview-override-')) {
            return
        }


        const flowsMap = sceneMotionFlowsRef.current // We need access to all flows

        if (!objects || !timelineInfo || !flowsMap) return

        // [BASE EDITING FIX] Ensure layersRef is up to date before calculating hash
        // This is critical because layers might have changed but ref hasn't been updated yet
        layersRef.current = layers

        // Create a signature of the project-wide data
        // [FIX] Include base layer transforms to ensure engine rebuilds when layers move/rotate in normal mode
        const layerPositionsHash = timelineInfo?.flatMap(s => s.layers || []).map(layerId => {
            const l = layersRef.current[layerId]
            return l ? `${l.x},${l.y},${l.rotation},${l.scaleX},${l.scaleY}` : ''
        }).join('|')

        const sceneTimingsHash = timelineInfo?.map(s => `${s.id}:${s.startTime}-${s.endTime}`).join('|')

        const currentDataSignature = JSON.stringify({
            sceneCount: timelineInfo.length,
            layerCount: objects.size,
            totalDuration: totalProjectDuration,
            layerPositionsHash,
            sceneTimingsHash, // [FIX] Include scene timings to detect trims/moves
            // Check if any scene's steps or actions have changed
            flowsHash: JSON.stringify(flowsMap)
        })

        // Skip prepare if the data hasn't changed (unless forced)
        if (!force && lastPreparedDataRef.current === currentDataSignature) {
            return
        }


        // CRITICAL: Save current playhead position for resume after rebuild
        const currentPlayheadTime = motionEngine.masterTimeline?.time() || 0

        // 1. Unload all to avoid leaking timelines
        motionEngine.unloadAllMotions()

        // 2. Register all objects from the project
        // Even if they are hidden in current scene, they need to be registered for seamless transitions
        // Initial transform handled by useCanvasLayers

        // 2. Reset PIXI objects to their base Redux state BEFORE rebuilding timelines —
        // unless we're in motion capture (or transitioning into it). In that case layers must
        // stay at their current visual position (e.g. end of step-1 when entering step-2).
        const capture = motionCaptureModeRef.current
        const skipResetForCapture = capture?.isActive || capture?.isTransitioning
        if (typeof console !== 'undefined' && console.log) {
            console.log('[useSimpleMotion] prepareEngine', {
                skipResetForCapture,
                captureActive: capture?.isActive,
                captureTransitioning: capture?.isTransitioning,
                stepId: capture?.stepId
            })
        }
        const currentLayers = layersRef.current
        if (objects && currentLayers && !skipResetForCapture) {
            objects.forEach((pixiObject, layerId) => {
                const baseLayerData = currentLayers[layerId]
                if (baseLayerData) {
                    applyTransformInline(pixiObject, baseLayerData, null, layerId, null, true)
                }
            })
        }

        // 3. Load Project-Wide Motion Flow
        // This loads all scenes into a single masterTimeline at their respective offsets.
        // We pass layersRef.current as 'allLayers' for the engine's internal state tracker.
        motionEngine.loadProjectMotionFlow(timelineInfo, flowsMap, objects, {
            allLayers: currentLayers
        })

        // CRITICAL: Restore playhead position after rebuild
        if (currentPlayheadTime > 0) {
            motionEngine.seek(currentPlayheadTime)
            setPlayheadTime(currentPlayheadTime)
        }

        // Remember what we prepared
        lastPreparedDataRef.current = currentDataSignature
    }, [motionEngine, timelineInfo, totalProjectDuration, layers])

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
            return l ? `${l.x},${l.y},${l.rotation},${l.scaleX},${l.scaleY}` : ''
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

    // [PROJECT-WIDE SYNC] Pre-warm and register all video layers in the project 
    // This allows the engine to pre-seek videos in upcoming scenes even before they are mounted on stage.
    useEffect(() => {
        if (!timelineInfo || !allMotionFlows || !layers) return

        // Scan all scenes for video layers
        timelineInfo.forEach(sceneInfo => {
            const sceneLayers = sceneInfo.layers || []
            sceneLayers.forEach(layerId => {
                const layer = layers[layerId]
                if (layer && layer.type === 'video' && layer.data?.url) {
                    // Pre-warm the video element (gets it into createLayer's cache)
                    // We call createVideoLayer but don't add the result to anything.
                    // It will ensure the HTMLVideoElement is created and stored in videoElementCache.
                    createVideoLayer(layer, { id: layerId }).then(container => {
                        const videoElement = container?._videoElement
                        if (videoElement) {
                            // Register with engine for background syncing
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
    }, [timelineInfo, allMotionFlows, layers, motionEngine])

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

    // Seek to specific time
    const seek = useCallback((time) => {
        // [SEEK OPTIMIZATION] Use signature-based preparation (prepareEngine(false)) 
        // to avoid heavy rebuilding during rapid scrubbing if state hasn't changed.
        prepareEngine(false)

        // Seek immediately - prepareEngine is synchronous and timelines are ready
        motionEngine.seek(time)
        setPlayheadTime(time)
    }, [motionEngine, prepareEngine])

    // Tween to specific time (fast-play)
    const tweenTo = useCallback((time, options = {}) => {
        const objects = layerObjectsRef.current
        const flowsMap = sceneMotionFlowsRef.current

        // If a flow is provided (e.g. from MotionPanel after an edit), reload the project-wide engine 
        // but with the OVERRIDDEN flow for the specific scene.
        if (options.flow && currentSceneIdRef.current) {

            // Force engine state to playing EARLY so applyTransformInline knows to stop overrides
            motionEngine.isPlaying = true
            const currentLayers = layersRef.current
            if (objects && currentLayers) {
                objects.forEach((pixiObject, layerId) => {
                    const baseLayerData = currentLayers[layerId]
                    if (baseLayerData) {
                        applyTransformInline(pixiObject, baseLayerData, null, layerId, null, true) // force=true!
                    }
                })
            }

            motionEngine.unloadAllMotions()
            // Object registration handled by useCanvasLayers

            const sharedContext = {
                builders: new Map(),
                stateTracker: new Map()
            }

            // Load all scenes, but use the provided OVERRIDDEN flow for the current active scene
            timelineInfo.forEach(sceneInfo => {
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
    }, [motionEngine, prepareEngine, setIsPlaying, timelineInfo, totalProjectDuration])

    /**
     * Get current visual transforms for all registered layers.
     * Useful for synchronizing capture mode with the current engine state.
     */
    const getLayerCurrentTransforms = useCallback(() => {
        const transforms = new Map()
        if (layerObjects) {
            layerObjects.forEach((obj, id) => {
                if (obj && !obj.destroyed) {
                    transforms.set(id, {
                        x: obj.x,
                        y: obj.y,
                        rotation: (obj.rotation * 180) / Math.PI,
                        scaleX: obj.scale.x,
                        scaleY: obj.scale.y,
                        // Visual crop properties (reactive)
                        cropX: obj.cropX,
                        cropY: obj.cropY,
                        cropWidth: obj.cropWidth,
                        cropHeight: obj.cropHeight,
                        mediaWidth: obj._mediaWidth ?? obj.mediaWidth,
                        mediaHeight: obj._mediaHeight ?? obj.mediaHeight
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
