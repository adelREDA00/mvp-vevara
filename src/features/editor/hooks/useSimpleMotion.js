import { useCallback, useState, useEffect, useRef, useMemo } from 'react'
import { useSelector, useDispatch } from 'react-redux'
import { getGlobalMotionEngine } from '../../engine/motion'
import { selectSceneMotionFlow, selectLayers, selectProjectTimelineInfo, selectTotalProjectDuration, selectSceneMotionFlows, selectAspectRatio, selectIsTimelineDragging, selectIsCanvasInteracting } from '../../../store/slices/projectSlice'
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
export function useSimpleMotion(layerObjects, currentSceneId, totalTimeInSeconds = 0, onPlayingChange = null, motionCaptureMode = null, stageContainer = null, editingTextLayerId = null) {
    const dispatch = useDispatch()

    // Get all layers for resetting state during transitions
    const layers = useSelector(selectLayers)
    const aspectRatio = useSelector(selectAspectRatio)
    const isTimelineDragging = useSelector(selectIsTimelineDragging)
    const isCanvasInteracting = useSelector(selectIsCanvasInteracting)

    // Calculate dimensions matching current aspect ratio
    const [widthRatio, heightRatio] = useMemo(() => {
        if (!aspectRatio) return [16, 9]
        return aspectRatio.split(':').map(Number)
    }, [aspectRatio])

    const { worldWidth, worldHeight } = useMemo(() => {
        const aspectRatioValue = widthRatio / heightRatio
        if (aspectRatioValue >= 1) {
            const baseWidth = 1920
            const baseHeight = 1080
            const baseAspect = baseWidth / baseHeight
            if (Math.abs(aspectRatioValue - baseAspect) < 0.01) {
                return { worldWidth: 1920, worldHeight: 1080 }
            } else {
                const worldHeight = 1080
                const worldWidth = Math.round(worldHeight * aspectRatioValue)
                return { worldWidth, worldHeight }
            }
        } else {
            const baseWidth = 1080
            const baseHeight = 1920
            const baseAspect = baseWidth / baseHeight
            if (Math.abs(aspectRatioValue - baseAspect) < 0.01) {
                return { worldWidth: 1080, worldHeight: 1920 }
            } else {
                const worldWidth = 1080
                const worldHeight = Math.round(worldWidth / aspectRatioValue)
                return { worldWidth, worldHeight }
            }
        }
    }, [widthRatio, heightRatio])

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

    // [TILT/PERF] During motion capture, every slider tick fires a Redux
    // dispatch which would otherwise unload+rebuild every scene's timeline
    // here — that's the slider lag the user sees ("layer jumps to final
    // value instead of updating smoothly").  Visual feedback during capture
    // is already provided by trackedLayers → applyTransformInline.  We
    // defer engine rebuilds until capture exits (handled by a dedicated
    // effect below).  Force=true callers (capture exit, options.flow) still
    // run through.
    const captureNow = motionCaptureModeRef.current
    if (!force && (captureNow?.isActive || captureNow?.isTransitioning)) {
      return
    }

    // Create a signature of the project-wide data
    const layerPositionsHash = timeline?.flatMap(s => s.layers || []).map(layerId => {
      const l = layersRef.current[layerId]
      return l ? `${l.x},${l.y},${l.rotation},${l.scaleX},${l.scaleY},${l.opacity},${l.blur},${l.tiltX},${l.tiltY},${l.cornerRadius},${l.cropX},${l.cropY},${l.cropWidth},${l.cropHeight},${l.data?.showingFront},${l.data?.url},${l.data?.src},${l.data?.assetUrl},${l.data?.backAssetUrl},${l.data?.assetIsVideo},${l.data?.backAssetIsVideo},${l.data?.fill},${l.data?.color}` : ''
    }).join('|')

    const sceneTimingsHash = timeline?.map(s => `${s.id}:${s.startTime}-${s.endTime}`).join('|')
    const transitionsSignature = timeline?.map(s => {
      const colorsStr = s.transitionColors ? s.transitionColors.join(',') : ''
      return `${s.id}:${s.transition || 'None'}:${colorsStr}:${s.transitionDirection || ''}`
    }).join('|')

    const currentDataSignature = JSON.stringify({
      sceneCount: timeline.length,
      layerCount: objects.size,
      totalDuration: totalProjectDuration,
      aspectRatio,
      layerPositionsHash,
      sceneTimingsHash,
      transitionsSignature,
      flowsHash: JSON.stringify(flowsMap)
    })

    if (!force && lastPreparedDataRef.current === currentDataSignature) {
      // [PRESET BASE FIX] Even on a signature match (no rebuild needed), re-seek to
      // restore GSAP-managed state (e.g., preset alpha=0 baseline). Without this,
      // any external force-reset of PIXI properties (from applyTransformInline force=true
      // triggered by layer edits) permanently clobbers the preset's initial visual state
      // because GSAP is never told to reapply its .set() baseline tweens.
      const currentTime = motionEngine.masterTimeline?.time() || 0
      // force=true: re-seeking to the current time is a GSAP no-op, so without
      // forcing a render the baseline .set() (e.g. preset alpha=0) is never
      // re-applied after a direct layer edit clobbered it.
      motionEngine.seek(currentTime, { force: true })
      return
    }

        motionEngine.setProjectConfig({ width: worldWidth, height: worldHeight })
        const currentPlayheadTime = motionEngine.masterTimeline?.time() || 0
        motionEngine.unloadAllMotions()
 
        const capture = motionCaptureModeRef.current
        const skipResetForCapture = capture?.isActive || capture?.isTransitioning

        const currentLayers = layersRef.current
        if (objects && currentLayers && !skipResetForCapture) {
            objects.forEach((pixiObject, layerId) => {
                const baseLayerData = currentLayers[layerId]
                if (baseLayerData) {
                    applyTransformInline(pixiObject, baseLayerData, null, layerId, null, true)
                }
            })
        }

        motionEngine.loadProjectMotionFlow(timeline, flowsMap, objects, {
            allLayers: currentLayers,
            transitionContainer: stageContainer,
            totalDuration: totalProjectDuration
        })

        // [FIX] Seek unconditionally to ensure baseline offsets are applied immediately, even at t=0
        // force=true: after a rebuild the master is fresh at t=0, so seeking to a
        // currentPlayheadTime of 0 would otherwise be a GSAP no-op and skip the baseline.
        motionEngine.seek(currentPlayheadTime, { force: true })
        setPlayheadTime(currentPlayheadTime)

        lastPreparedDataRef.current = currentDataSignature
    }, [motionEngine, totalProjectDuration, stageContainer, worldWidth, worldHeight, aspectRatio])

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
            return l ? `${l.x},${l.y},${l.rotation},${l.scaleX},${l.scaleY},${l.opacity},${l.blur},${l.tiltX},${l.tiltY},${l.cornerRadius},${l.cropX},${l.cropY},${l.cropWidth},${l.cropHeight},${l.data?.showingFront},${l.data?.url},${l.data?.src},${l.data?.assetUrl},${l.data?.backAssetUrl},${l.data?.assetIsVideo},${l.data?.backAssetIsVideo},${l.data?.fill},${l.data?.color}` : ''
        }).join('|')
    }, [layers, timelineInfo])

    // Memoize a hash of scene transitions to detect when transitions change
    const transitionsHash = useMemo(() => {
        if (!timelineInfo) return ''
        return timelineInfo.map(s => {
            const colorsStr = s.transitionColors ? s.transitionColors.join(',') : ''
            return `${s.id}:${s.transition || 'None'}:${colorsStr}:${s.transitionDirection || ''}`
        }).join('|')
    }, [timelineInfo])

    // Rebuild engine when project structure, motion flow, OR base layer state changes
    const flowsJson = JSON.stringify(allMotionFlows)
    useEffect(() => {
        // If we're currently playing, we defer the rebuild to avoid visual jumps
        // But we MUST re-prepare once playback stops to sync with the latest Redux state
        if (isPlayingInternal) {
            return
        }

        // [TIMELINE DRAG PERF FIX] Skip rebuilding during active timeline dragging/resizing
        if (isTimelineDragging) {
            return
        }

        // [CANVAS INTERACT PERF FIX] Skip during resize/crop/scale canvas interactions.
        // Every updateLayer dispatch during a normal-mode resize changes layersBaseStateHash,
        // which would otherwise trigger a full GSAP timeline teardown + rebuild every frame.
        // When isCanvasInteracting flips back to false this effect re-runs once, picking up
        // all dimension changes accumulated during the interaction in one batch.
        if (isCanvasInteracting) {
            return
        }

        // [BASE EDITING FIX] Ensure layersRef is updated before prepareEngine runs
        // This is critical because prepareEngine uses layersRef.current for hash calculation
        layersRef.current = layers

        prepareEngine(false)
    }, [prepareEngine, flowsJson, timelineInfo.length, totalProjectDuration, isPlayingInternal, layersBaseStateHash, layers, transitionsHash, stageContainer, isTimelineDragging, isCanvasInteracting])

  // [TILT/PERF] When motion capture exits, run the deferred engine rebuild
  // so the freshly captured tilt/blur/etc. actions get loaded into GSAP
  // before the user previews or scrubs.  We track previous state in a ref
  // so this only fires on the active→inactive transition, not on every
  // unrelated motionCaptureMode prop change.
  const wasInCaptureRef = useRef(false)
  useEffect(() => {
    const isInCapture = !!(motionCaptureMode?.isActive || motionCaptureMode?.isTransitioning)
    if (wasInCaptureRef.current && !isInCapture) {
      // Force a full rebuild — signature compare can't see the deferred
      // dispatches, and the Redux flow may have advanced multiple times
      // since the last prepare.
      layersRef.current = layers
      prepareEngine(true)
    }
    wasInCaptureRef.current = isInCapture
  }, [motionCaptureMode?.isActive, motionCaptureMode?.isTransitioning, prepareEngine, layers])

  // Rebuild engine and re-seek when text editing finishes to cleanly re-create/sync perspective tilt meshes
  const prevEditingTextLayerIdRef = useRef(editingTextLayerId)
  useEffect(() => {
    if (prevEditingTextLayerIdRef.current && !editingTextLayerId) {
      layersRef.current = layers
      prepareEngine(true)
    }
    prevEditingTextLayerIdRef.current = editingTextLayerId
  }, [editingTextLayerId, prepareEngine, layers])

  // [FIX] Pause all video layers immediately when entering or during motion capture mode
  useEffect(() => {
    const isInCapture = !!(motionCaptureMode?.isActive || motionCaptureMode?.isTransitioning)
    if (isInCapture) {
      // Force pause in the engine
      motionEngine.isPlaying = false
      motionEngine.pauseAll()

      const pauseVideo = (videoElement) => {
        if (videoElement && !videoElement.paused) {
          try {
            videoElement.pause()
            videoElement._isPlayPending = false
          } catch (e) {
            console.warn('[useSimpleMotion] Failed to pause video in capture mode:', e)
          }
        }
      }

      if (motionEngine.registeredObjects) {
        motionEngine.registeredObjects.forEach((obj) => {
          const videoElement = obj._videoElement
          if (videoElement) {
            pauseVideo(videoElement)
          }
        })
      }

      if (motionEngine.backgroundMedia) {
        motionEngine.backgroundMedia.forEach((data) => {
          const videoElement = data._videoElement
          if (videoElement) {
            pauseVideo(videoElement)
          }
        })
      }
    }
  }, [motionCaptureMode?.isActive, motionCaptureMode?.isTransitioning, motionEngine])

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

    // [PROJECT-WIDE SYNC] Stable video URLs signature to avoid thrashing on every layer change
    const videoUrlsSignature = useMemo(() => {
        if (!timelineInfo || !layers) return '';
        return timelineInfo
            .flatMap(sceneInfo => sceneInfo.layers || [])
            .map(layerId => {
                const layer = layers[layerId];
                return (layer && layer.type === 'video') ? `${layerId}:${layer.data?.url || ''}` : '';
            })
            .filter(Boolean)
            .join('|');
    }, [timelineInfo, layers]);

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
    }, [videoUrlsSignature, timelineInfo, allMotionFlows, motionEngine])

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
        const timeline = timelineInfoRef.current

        // [PRESET PREVIEW SANITIZATION] Kill any local preset preview timelines
        // that are still running. A leftover preview tween would continue writing
        // pixiObject.x / .alpha / .scale every frame and fight the engine's
        // freshly-loaded timeline — producing the "stale / mixed preset" bug
        // when the user changes a preset and clicks Save before the 1s preview
        // has finished, or when the engine is otherwise restarted mid-preview.
        if (objects) {
            objects.forEach((pixiObject) => {
                if (pixiObject && !pixiObject.destroyed) {
                    if (pixiObject._previewTimeline) {
                        try { pixiObject._previewTimeline.kill() } catch {}
                        pixiObject._previewTimeline = null
                    }
                    if (pixiObject._isPlayingPresetPreview) {
                        pixiObject._isPlayingPresetPreview = false
                        const snap = pixiObject._originalPreviewSnap
                        if (snap) {
                            pixiObject.x = snap.x
                            pixiObject.y = snap.y
                            pixiObject.alpha = snap.alpha
                            pixiObject.rotation = snap.rotation
                            if (pixiObject.scale) pixiObject.scale.set(snap.scaleX, snap.scaleY)
                            if (pixiObject.revealProgress !== undefined && snap.revealProgress !== undefined) {
                                pixiObject.revealProgress = snap.revealProgress
                            }
                            if (pixiObject._blurFilter) {
                                pixiObject._blurFilter.strength = snap.blurStrength
                                const has = pixiObject.filters?.includes(pixiObject._blurFilter)
                                if (snap.hadBlurFilter && !has) {
                                    pixiObject.filters = pixiObject.filters ? [...pixiObject.filters, pixiObject._blurFilter] : [pixiObject._blurFilter]
                                } else if (!snap.hadBlurFilter && has) {
                                    pixiObject.filters = pixiObject.filters.filter(f => f !== pixiObject._blurFilter)
                                    if (!pixiObject.filters.length) pixiObject.filters = null
                                }
                            }
                            if (snap.intendedAlpha !== undefined) {
                                pixiObject._intendedAlpha = snap.intendedAlpha
                            }
                            pixiObject._originalPreviewSnap = null
                        }
                    }
                }
            })
        }

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
            timeline.forEach(sceneInfo => {
                const flowToLoad = sceneInfo.id === currentSceneIdRef.current ? options.flow : flowsMap[sceneInfo.id]
                if (flowToLoad) {
                    motionEngine.loadSceneMotionFlow(flowToLoad, objects || new Map(), {
                        startTimeOffset: sceneInfo.startTime,
                        allLayers: currentLayers,
                        transitionContainer: stageContainer
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
            // force=true: when re-editing a step the playhead is already parked at
            // the step start, so seeking to that same time would be a GSAP no-op and
            // the freshly-loaded preset's baseline (.set) would never be applied —
            // causing the post-save preview to show the stale "old preset" start state.
            motionEngine.seek(options.startTime, { force: true })
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
                        blur: typeof obj._blurLogicalStrength === 'number' ? obj._blurLogicalStrength : 0,
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
