import { gsap } from 'gsap'
import { MotionTimeline } from './MotionTimeline.js'
import { getActionHandler } from './actions/index.js'

/**
 * MotionEngine is the main coordinator for all layer animations.
 * It manages which layers are registered and handles loading their 
 * motion flows into GSAP timelines.
 */
export class MotionEngine {
  constructor() {
    this.activeTimelines = new Map() // layerId -> MotionTimeline
    this.registeredObjects = new Map() // layerId -> PIXI.DisplayObject
    this.backgroundMedia = new Map() // layerId -> { _videoElement, _sceneId, _sourceStartTime, _sourceEndTime }

    this.isPlaying = false
    this.onAllCompleteCallbacks = []
    this.onUpdateCallbacks = []
    this.onPlayCallbacks = []
    this.onPauseCallbacks = []

    // Master timeline to coordinate all animations
    this.masterTimeline = gsap.timeline({
      paused: true,
      onComplete: () => this._handleAllComplete(),
      onUpdate: () => {
        const time = this.masterTimeline.time()
        // [SCRIB SYNC] Standard sync handles playhead movement and scrubbing
        this.syncMedia(time, false)
        this._handleUpdate()
      }
    })

    // [DEADLOCK FIX] Global Ticker Heartbeat
    // When the engine is paused due to buffering (isInternalPaused), 
    // timeline updates stop. We need a persistent loop to:
    // 1. Keep checking if buffering is finished.
    // 2. Keep the UI's isBuffering state updated.
    this._tickHandler = () => this._tick()
    gsap.ticker.add(this._tickHandler)

    // Scene timing mapping for media synchronization
    this.sceneRanges = new Map() // sceneId -> { startTime, endTime }

    // TRACKING: State for UI buffering indicator
    this._activeVideoElements = new Set()
    this.isInternalPaused = false // Track if engine paused itself due to buffering
    // When true, syncMedia forces all in-range videos muted (fast preview / tweenTo)
    this._muteVideosForFastPreview = false
  }

  get isBuffering() {
    // Engine is buffering ONLY if an ACTIVE (in-range) video is seeking OR not ready
    for (const video of this._activeVideoElements) {
      if (video.seeking || video.readyState < 3) return true
    }
    return false
  }

  /**
   * Register a PIXI object so the engine knows what to animate
   */
  registerLayerObject(layerId, pixiObject, customData = {}) {
    // [FIX] Clear from background media if it's now a formal PIXI object
    this.backgroundMedia.delete(layerId)

    this.registeredObjects.set(layerId, pixiObject)
    if (customData.sceneId) {
      pixiObject._sceneId = customData.sceneId
    }
    // Set fallback media info if provided
    if (customData.sourceStartTime !== undefined) pixiObject._sourceStartTime = customData.sourceStartTime
    if (customData.sourceEndTime !== undefined) pixiObject._sourceEndTime = customData.sourceEndTime

    // [FIX] Immediate Sync: Sync media state immediately when a new layer is added.
    const currentTime = this.masterTimeline.time()
    this.syncMedia(currentTime, false)
  }

  /**
   * Unregister a PIXI object from the engine
   */
  unregisterLayerObject(layerId) {
    this.registeredObjects.delete(layerId)
    this.unloadMotionFlow(layerId)
  }

  /**
   * Clear all registered objects
   */
  clearRegisteredObjects() {
    this.registeredObjects.clear()
    this.backgroundMedia.clear()
  }

  /**
   * Reset the entire engine. Stops playback, clears all memory, removes GSAP tickers.
   */
  reset() {
    // 1. Unload all layer motions
    this.unloadAllMotions()

    // 2. Kill master timeline
    if (this.masterTimeline) {
      this.masterTimeline.kill()
    }

    // 3. Remove ticker
    if (this._tickHandler) {
      gsap.ticker.remove(this._tickHandler)
    }

    // 4. Clear all callbacks
    this.onAllCompleteCallbacks = []
    this.onUpdateCallbacks = []
    this.onPlayCallbacks = []
    this.onPauseCallbacks = []

    // 5. Clear sets and maps
    this._activeVideoElements.clear()
    this.clearRegisteredObjects()
    this.sceneRanges.clear()

    // 6. Reset state variables
    this.isPlaying = false
    this.isInternalPaused = false
  }

  /**
   * Register a video element for a layer that isn't currently on the stage.
   * This allows the engine to pre-seek videos in upcoming scenes.
   */
  registerBackgroundMedia(layerId, videoElement, data = {}) {
    // If already registered as a formal object, don't override with background
    if (this.registeredObjects.has(layerId)) return

    this.backgroundMedia.set(layerId, {
      _videoElement: videoElement,
      _sceneId: data.sceneId,
      _sourceStartTime: data.sourceStartTime || 0,
      _sourceEndTime: data.sourceEndTime,
      isBackground: true
    })
  }

  unregisterBackgroundMedia(layerId) {
    this.backgroundMedia.delete(layerId)
  }

  /**
   * Load motion data for a layer and build its animation timeline
   */
  /**
   * Load motion data for a layer and build its animation timeline
   * @deprecated Use loadSceneMotionFlow for scene-based motion flows
   */
  loadMotionFlow(layerId, motionFlow, options = {}) {
    const pixiObject = this.registeredObjects.get(layerId)

    if (!pixiObject) {
      console.warn(`MotionEngine: Cannot load motion for ${layerId}. Object not registered.`)
      return
    }

    // 1. Reset: Remove any old animations for this layer
    this.unloadMotionFlow(layerId)

    // 2. Setup: Create a new timeline container
    const timeline = new MotionTimeline(layerId)

    // Note: Individual timeline completion is now handled by the masterTimeline
    // but we keep the callback for individual layer logic if needed in future
    timeline.create()

    // 3. Build: Convert Redux steps into GSAP movements
    const steps = motionFlow?.steps || []
    let currentTimeOffset = 0 // Tracks the "clock" for the timeline in seconds

    steps.forEach((step) => {
      let longestActionInStep = 0

      step.actions.forEach((action) => {
        const handler = getActionHandler(action.type)
        if (!handler) return

        // Source of truth: values.duration (synced from Redux)
        const durationMs = action.values?.duration || action.duration || 2000
        const duration = durationMs / 1000
        longestActionInStep = Math.max(longestActionInStep, duration)

        // Inject the movement into the timeline at the current offset
        timeline.add((gsapTimeline) => {
          const tween = handler.execute(pixiObject, action, options)
          gsapTimeline.add(tween, currentTimeOffset)
        })
      })

      // Move the "clock" forward by the duration of the longest action in this step
      currentTimeOffset += longestActionInStep
    })

    this.activeTimelines.set(layerId, timeline)

    // 4. Add to Master: Sync this timeline with the master clock
    if (timeline.instance) {
      this.masterTimeline.add(timeline.instance, 0)
    }
  }

  /**
   * Load scene-based motion flow and build animation timelines for all affected layers.
   * This new method handles the refactored data structure where:
   * - sceneMotionFlow.steps is an array of steps
   * - Each step has layerActions: { [layerId]: [actions] }
   * 
   * @param {Object} sceneMotionFlow - Scene motion flow data { steps: [...], pageDuration }
   * @param {Map} layerObjects - Map of layerId -> PIXI.DisplayObject  
   * @param {Object} options - Animation options (including startTimeOffset in seconds, and allLayers Redux state)
   * @param {Object} sharedContext - Optional { builders, stateTracker } for accumulating across scenes
   */
  loadSceneMotionFlow(sceneMotionFlow, layerObjects, options = {}, sharedContext = null) {
    if (!sceneMotionFlow || !sceneMotionFlow.steps) {
      return
    }

    const { startTimeOffset = 0 } = options

    const steps = sceneMotionFlow.steps
    const pageDuration = sceneMotionFlow.pageDuration || 6000
    const stepCount = steps.length
    const stepDurationMs = stepCount > 0 ? pageDuration / stepCount : pageDuration

    // Track which layers have motion and build their timelines incrementally
    // If sharedContext is provided, we use those maps to accumulate across scenes
    const layerTimelineBuilders = sharedContext?.builders || new Map() // layerId -> { timeline, currentTimeOffset }

    // [FIX] STATE TRACKER: Tracks predicted state of each layer as we build steps.
    const layerStateTracker = sharedContext?.stateTracker || new Map() // layerId -> { x, y, scaleX, scaleY, rotation }

    // CRITICAL: Use the passed objects Map if available, fallback to internal registry
    const objectsToUse = (layerObjects && layerObjects.size > 0) ? layerObjects : this.registeredObjects

    // Initialize state tracker with base values from Redux (allLayers) if available, 
    // otherwise fallback to current PIXI object values.
    // This is critical because PIXI objects might be at mid-animation positions when loading is triggered.
    const { allLayers = {} } = options

    // ONLY initialize state tracker if we aren't continuing from a previous scene
    if (layerStateTracker.size === 0) {
      objectsToUse.forEach((obj, id) => {
        // [FIX] Safety check: Ensure obj exists and isn't destroyed
        if (!obj || obj.destroyed) return

        const baseLayer = allLayers?.[id]
        layerStateTracker.set(id, {
          x: baseLayer?.x ?? obj.x ?? 0,
          y: baseLayer?.y ?? obj.y ?? 0,
          scaleX: baseLayer?.scaleX ?? obj.scale?.x ?? 1,
          scaleY: baseLayer?.scaleY ?? obj.scale?.y ?? 1,
          rotation: baseLayer?.rotation ?? (obj.rotation ? (obj.rotation * 180) / Math.PI : 0),
          // Track crop state
          cropX: baseLayer?.cropX ?? (obj._storedCropX ?? 0),
          cropY: baseLayer?.cropY ?? (obj._storedCropY ?? 0),
          cropWidth: baseLayer?.cropWidth ?? (obj._storedCropWidth ?? obj._originalWidth ?? obj.width ?? 100),
          cropHeight: baseLayer?.cropHeight ?? (obj._storedCropHeight ?? obj._originalHeight ?? obj.height ?? 100),
          mediaWidth: baseLayer?.mediaWidth ?? (obj._storedMediaWidth ?? obj._mediaWidth ?? obj._originalWidth ?? obj.width ?? 100),
          mediaHeight: baseLayer?.mediaHeight ?? (obj._storedMediaHeight ?? obj._mediaHeight ?? obj._originalHeight ?? obj.height ?? 100),
          trimStart: baseLayer?.data?.trimStart ?? (obj._storedTrimStart ?? 0),
          trimEnd: baseLayer?.data?.trimEnd ?? (obj._storedTrimEnd ?? 0)
        })
      })
    }

    steps.forEach((step, stepIndex) => {
      // Use absolute startTime if available, fallback to index-based calculation
      const stepStartTimeMs = step.startTime != null ? step.startTime : (stepIndex * stepDurationMs)
      const stepStartTime = startTimeOffset + stepStartTimeMs / 1000
      if (!step.layerActions) return

      // Iterate over each layer's actions in this step
      Object.entries(step.layerActions).forEach(([layerId, actions]) => {
        const pixiObject = objectsToUse.get(layerId)
        if (!pixiObject || pixiObject.destroyed) return

        // Get predicted start state for this layer at this step
        const startState = { ...layerStateTracker.get(layerId) }

        // Initialize timeline builder for this layer if not exists
        if (!layerTimelineBuilders.has(layerId)) {
          // Unload if not sharing context (regular single-scene load)
          if (!sharedContext) {
            this.unloadMotionFlow(layerId)
          }
          const timeline = new MotionTimeline(layerId)
          timeline.create()
          layerTimelineBuilders.set(layerId, { timeline, currentTimeOffset: 0 })
        }

        const builder = layerTimelineBuilders.get(layerId)
        // Use the step's effective duration (respects customDuration)
        const stepDuration = (step.duration || stepDurationMs) / 1000

        // Add all actions for this layer in this step
        // Scene end boundary in seconds — tweens must not exceed this
        const sceneEndTime = startTimeOffset + pageDuration / 1000

        actions.forEach((action) => {
          const handler = getActionHandler(action.type)
          if (!handler) return

          let actionDuration = action.values?.duration
            ? action.values.duration / 1000
            : stepDuration

          // Clamp: never let a tween extend past the scene boundary
          const maxDuration = sceneEndTime - stepStartTime
          if (maxDuration > 0) {
            actionDuration = Math.min(actionDuration, maxDuration)
          } else {
            return
          }

          builder.timeline.add((gsapTimeline) => {
            const tween = handler.execute(pixiObject, action, {
              ...options,
              duration: actionDuration,
              startTime: stepStartTime,
              sceneStartOffset: startTimeOffset,
              startState // [FIX] Pass predicted state to handler
            })
            gsapTimeline.add(tween, stepStartTime)
          })

          // UPDATE STATE TRACKER: Predict where the layer will be after this action
          // This ensures the NEXT step's MoveAction knows the correct start point.
          if (action.type === 'move') {
            const state = layerStateTracker.get(layerId)
            if (state) {
              const dx = action.values?.dx !== undefined ? action.values.dx : 0
              const dy = action.values?.dy !== undefined ? action.values.dy : 0
              state.x += dx
              state.y += dy
            }
          } else if (action.type === 'scale') {
            const state = layerStateTracker.get(layerId)
            if (state) {
              const dsx = action.values?.dsx !== undefined ? action.values.dsx : 1
              const dsy = action.values?.dsy !== undefined ? action.values.dsy : 1
              state.scaleX *= dsx
              state.scaleY *= dsy
            }
          } else if (action.type === 'rotate') {
            const state = layerStateTracker.get(layerId)
            if (state) {
              const dangle = action.values?.dangle !== undefined ? action.values.dangle : 0
              state.rotation += dangle
            }
          } else if (action.type === 'crop') {
            const state = layerStateTracker.get(layerId)
            if (state && action.values) {
              if (action.values.cropX !== undefined) state.cropX = action.values.cropX
              if (action.values.cropY !== undefined) state.cropY = action.values.cropY
              if (action.values.cropWidth !== undefined) state.cropWidth = action.values.cropWidth
              if (action.values.cropHeight !== undefined) state.cropHeight = action.values.cropHeight
              if (action.values.mediaWidth !== undefined) state.mediaWidth = action.values.mediaWidth
              if (action.values.mediaHeight !== undefined) state.mediaHeight = action.values.mediaHeight
              if (action.values.trimStart !== undefined) state.trimStart = action.values.trimStart
              if (action.values.trimEnd !== undefined) state.trimEnd = action.values.trimEnd
            }
          }
        })
      })
    })

    // Finalize: Add all built timelines to the master and register them
    // Skip finalization IF we are in shared mode (let the owner finalize)
    if (sharedContext) return

    let totalTwensCreated = 0
    layerTimelineBuilders.forEach((builder, layerId) => {
      this.activeTimelines.set(layerId, builder.timeline)

      if (builder.timeline.instance) {
        // Child timelines MUST be unpaused to scrub with parent
        builder.timeline.instance.paused(false)
        this.masterTimeline.add(builder.timeline.instance, 0)
        totalTwensCreated += builder.timeline.instance.getChildren().length
      }
    })

    console.log(`✅ [MotionEngine] Loaded Flow at offset ${startTimeOffset}s: ${layerTimelineBuilders.size} layers, ${totalTwensCreated} actions. Total Engine Duration: ${this.masterTimeline.duration().toFixed(2)}s`)
  }

  /**
   * Load entire project motion flow (all scenes).
   * @param {Array} timelineInfo - Array of scenes with startTime/endTime info
   * @param {Object} sceneMotionFlowsMap - Map of sceneId -> motionFlow
   * @param {Map} allLayerObjects - Map of layerId -> PIXI.DisplayObject
   * @param {Object} options - Animation options
   */
  loadProjectMotionFlow(timelineInfo, sceneMotionFlowsMap, allLayerObjects, options = {}) {
    console.log(`🎬 [MotionEngine] Loading Project Flow: ${timelineInfo.length} scenes`)

    // IMPORTANT: Clear ALL previous animations before loading the new project state.
    this.unloadAllMotions()
    this.sceneRanges.clear()

    // Shared context to accumulate across all scenes
    const sharedContext = {
      builders: new Map(),
      stateTracker: new Map()
    }

    // Load each scene with its respective start time offset
    timelineInfo.forEach(sceneInfo => {
      // ALWAYS track range for media sync if we have sceneInfo
      // Use timelineInfo's startTime/endTime as the absolute source of truth
      this.sceneRanges.set(sceneInfo.id, {
        startTime: sceneInfo.startTime,
        endTime: sceneInfo.endTime
      })

      const flow = sceneMotionFlowsMap[sceneInfo.id]
      if (flow) {
        this.loadSceneMotionFlow(flow, allLayerObjects, {
          ...options,
          startTimeOffset: sceneInfo.startTime,
          allLayers: options.allLayers // Pass through the base state
        }, sharedContext) // Pass shared context for accumulation
      }
    })

    // Now FINALIZE all accumulated timelines
    let totalTwensCreated = 0
    sharedContext.builders.forEach((builder, layerId) => {
      this.activeTimelines.set(layerId, builder.timeline)

      if (builder.timeline.instance) {
        // Child timelines MUST be unpaused to scrub with parent
        builder.timeline.instance.paused(false)
        this.masterTimeline.add(builder.timeline.instance, 0)
        totalTwensCreated += builder.timeline.instance.getChildren().length
      }
    })

    // Set total duration based on the last scene's end time
    if (timelineInfo.length > 0) {
      const lastScene = timelineInfo[timelineInfo.length - 1]
      this.setTotalDuration(lastScene.endTime)
    }

    console.log(`✅ [MotionEngine] Project Flow Loaded. Total Duration: ${this.masterTimeline.duration().toFixed(2)}s`)
  }

  /**
   * Synchronize media playback (videos) with the current master timeline time.
   * @param {number} currentTime - Global time in seconds
   * @param {boolean} force - If true, bypass synchronization threshold (crucial for seeks)
   */
  syncMedia(currentTime, force = false) {
    const isPaused = !this.isPlaying

    if (force || this._lastSyncIsPlaying !== this.isPlaying) {
      this._lastSyncIsPlaying = this.isPlaying
    }

    const mediaIntents = new Map() // videoElement -> { shouldPlay, targetTime, inAnyRange, layerId }

    // Logic to calculate intent for a given object/data
    const processObject = (obj, id) => {
      let videoElement = obj._videoElement
      if (!videoElement && obj._videoSprite) {
        const source = obj._videoSprite.texture?.source
        if (source && source.resource instanceof HTMLVideoElement) {
          videoElement = source.resource
          obj._videoElement = videoElement
        }
      }

      if (!videoElement) return

      const sceneId = obj._sceneId
      const range = this.sceneRanges.get(sceneId)

      if (range) {
        if (!mediaIntents.has(videoElement)) {
          mediaIntents.set(videoElement, { shouldPlay: false, targetTime: -1, inAnyRange: false, layerId: id })
        }

        const intent = mediaIntents.get(videoElement)
        const startTime = range.startTime
        const endTime = range.endTime
        const inRange = currentTime >= startTime - 0.001 && currentTime < endTime

        if (inRange) {
          const sourceStart = obj._sourceStartTime || 0
          const sourceEnd = obj._sourceEndTime
          const localTime = currentTime - startTime
          const adjustedLocalTime = Math.max(0, localTime + sourceStart)
          const finalTime = sourceEnd !== undefined ? Math.min(adjustedLocalTime, sourceEnd) : adjustedLocalTime

          const isAtEnd = sourceEnd !== undefined && adjustedLocalTime >= sourceEnd - 0.01

          if (this.isPlaying && !isAtEnd) {
            intent.shouldPlay = true
          }
          intent.targetTime = finalTime
          intent.inAnyRange = true
          intent.layerId = id
        } else {
          // Pass 2: Pre-seek lookahead
          const timeUntilStart = startTime - currentTime
          if (timeUntilStart > 0 && timeUntilStart <= 0.8 && this.isPlaying) {
            const sourceStart = obj._sourceStartTime || 0
            // If not already active, set a pre-seek target
            if (!intent.inAnyRange && intent.targetTime === -1) {
              intent.targetTime = sourceStart
            }
          }
        }
      }
    }

    // 1. Process active PIXI objects
    this.registeredObjects.forEach((obj, id) => processObject(obj, id))

    // 2. Process background media (not on stage but in project)
    this.backgroundMedia.forEach((data, id) => {
      if (!this.registeredObjects.has(id)) {
        processObject(data, id)
      }
    })

    // Update active video tracking for isBuffering getter
    // [FIX] We ONLY include active (in-range) videos here.
    // Background pre-seeks should NOT trigger the buffering spinner or pause the timeline
    // until the playhead actually crosses into their scene boundary.
    this._activeVideoElements.clear()
    mediaIntents.forEach((intent, video) => {
      if (intent.inAnyRange) {
        this._activeVideoElements.add(video)
      }
    })

    // [AUTO-PAUSE LOGIC]
    // If the project is supposed to be playing but videos are buffering/seeking:
    // 1. Pause the master timeline internally
    // 2. Clear the internal-pause flag and resume when ready
    const needsBuffering = this.isBuffering
    if (this.isPlaying) {
      if (needsBuffering && !this.isInternalPaused) {
        // console.log('⏸️ [MotionEngine] Buffering... Internal Pause')
        this.masterTimeline.pause()
        this.isInternalPaused = true
      } else if (!needsBuffering && this.isInternalPaused) {
        // console.log('▶️ [MotionEngine] Buffering complete. Internal Resume')
        this.masterTimeline.play()
        this.isInternalPaused = false
      }
    } else {
      // Ensure internal pause is cleared if user manually stops playback
      this.isInternalPaused = false
    }

    // 3. Final Pass: Apply intents to DOM video elements
    mediaIntents.forEach((intent, videoElement) => {
      // [Bug 1 Fix] Tighter sync tolerance:
      // - 100ms (0.1s) for active playback (standard A/V sync window)
      // - 40ms (0.04s) for paused/static sync (perfect alignment)
      // - 0 for forced seeks (ensure exact frame match)
      const threshold = force ? 0 : (isPaused ? 0.04 : 0.1)
      const deviation = Math.abs(videoElement.currentTime - intent.targetTime)

      const isSeeking = videoElement.seeking

      // [REFINED SEEK GUARD]
      // Allow overriding a seek if:
      // 1. We are NOT seeking (standard deviation check)
      // 2. OR we ARE seeking, but the targetTime has moved significantly (>0.2s) 
      //    since the last time we updated this videoElement. This prevents "decoder lockout"
      //    where a slow decoder stays stale while the playhead has moved on.
      const lastTarget = videoElement._lastMotionTargetTime || -1
      const targetMovedSignificantly = Math.abs(intent.targetTime - lastTarget) > 0.2

      if (intent.targetTime !== -1 && (force || (deviation > threshold && (!isSeeking || targetMovedSignificantly)))) {
        // [LOOKAHEAD LOG]
        if (deviation > 0.1 && (force || isPaused)) {
          // console.log(`[MotionEngine] Seek: ${videoElement.src.split('/').pop()} -> ${intent.targetTime.toFixed(2)}s (dev=${deviation.toFixed(2)}s, override=${targetMovedSignificantly})`)
        }
        videoElement.currentTime = intent.targetTime
        videoElement._lastMotionTargetTime = intent.targetTime // Track last request
      }

      // [FAST PREVIEW] Mute all videos during tweenTo so preview is silent
      if (this._muteVideosForFastPreview) {
        videoElement.muted = true
      }

      // [Bug 2 Fix] Play/Pause with isPlaying guard:
      if (intent.shouldPlay) {
        if (videoElement.paused && !videoElement._isPlayPending) {
          videoElement._isPlayPending = true
          videoElement.play()
            .then(() => {
              videoElement._isPlayPending = false
            })
            .catch(e => {
              videoElement._isPlayPending = false
              if (e.name !== 'AbortError') {
                console.warn('⚠️ [MotionEngine] Play failed:', e.name, e.message)
              }
            })
        }
      } else {
        // [FIX] Priority Pause: We MUST call pause even if a play is pending.
        // Failing to do so causes the "video continues playing after pause/cut" bugs.
        if (!videoElement.paused) {
          videoElement.pause()
        }
      }

      // [A/V SYNC FIX] Force the PIXI VideoSource to update its WebGL texture immediately.
      // Because audio plays instantly from the HTMLAudio/Video element, but WebGL takes 
      // an extra frame to pull from the canvas/video, visual playback appears ~1-2 frames behind.
      // By forcing update here (tied to GSAP ticker), we minimize that pipeline delay.
      if (intent.shouldPlay || (!isPaused && deviation > 0)) {
        // Find the PIXI object for this video
        const obj = [...this.registeredObjects.values()].find(o =>
          o._videoElement === videoElement ||
          (o._videoSprite && o._videoSprite.texture?.source?.resource === videoElement)
        );
        if (obj) {
          const sprite = obj._videoSprite;
          if (sprite && sprite.texture && sprite.texture.source) {
            sprite.texture.source.update();
          }
        }
      }
    })

    // Orphan cleanup: pause any playing video elements NOT tracked by mediaIntents.
    // Run at most every 3 seconds to avoid main-thread stutter.
    const now = Date.now()
    if (!this._lastCleanupTime || now - this._lastCleanupTime > 3000) {
      this._lastCleanupTime = now
      const allVideos = document.querySelectorAll('video')
      allVideos.forEach(v => {
        if (!v.paused && !mediaIntents.has(v)) {
          v.pause()
        }
      })
    }
  }


  /**
   * Remove a single layer's animation
   */
  unloadMotionFlow(layerId) {
    const timeline = this.activeTimelines.get(layerId)
    if (timeline) {
      this.masterTimeline.remove(timeline.instance)
      timeline.destroy()
      this.activeTimelines.delete(layerId)
    }
  }

  /**
   * Clear every animation currently loaded
   */
  unloadAllMotions() {
    // [FIX] Pause all tracked video elements BEFORE clearing to prevent orphan playback.
    // Without this, videos continue playing through the engine rebuild triggered by scene cuts.
    this.registeredObjects.forEach((obj) => {
      let videoElement = obj._videoElement
      if (!videoElement && obj._videoSprite) {
        const source = obj._videoSprite.texture?.source
        if (source && source.resource instanceof HTMLVideoElement) {
          videoElement = source.resource
        }
      }
      if (videoElement && !videoElement.paused) {
        videoElement.pause()
        videoElement._isPlayPending = false
      }
    })
    this.masterTimeline.clear()
    this.activeTimelines.forEach(tl => tl.destroy())
    this.activeTimelines.clear()
    this.isPlaying = false
  }

  /**
   * Start playing all animations at once
   */
  playAll() {
    this.isPlaying = true
    this.onPlayCallbacks.forEach(cb => cb())

    // Check if we're at or past the end (completed)
    const isAtEnd = this.masterTimeline.progress() >= 1

    if (isAtEnd) {
      console.log('🔄 Animation complete, restarting from beginning')
      // Reset all individual timelines first
      this.activeTimelines.forEach((tl) => {
        if (tl.instance) {
          tl.instance.progress(0)
        }
      })
      // Restart the master timeline from the beginning
      this.masterTimeline.restart()
    } else {
      console.log('▶️ Resuming/playing animation')
      this.syncMedia(this.masterTimeline.time())
      // Ensure all individual timelines are resumed
      this.activeTimelines.forEach((tl) => {
        if (tl.instance && tl.instance.paused()) {
          tl.instance.resume()
        }
      })
      this.masterTimeline.play()
    }
  }

  /**
   * Pause every moving layer
   */
  pauseAll() {
    this._muteVideosForFastPreview = false
    this.masterTimeline.pause()
    this.isPlaying = false
    this.onPauseCallbacks.forEach(cb => cb())
    this.syncMedia(this.masterTimeline.time())
  }

  /**
   * Reset everything back to the starting frame
   */
  stopAll() {
    this._muteVideosForFastPreview = false
    this.masterTimeline.pause(0)
    this.isPlaying = false
  }

  /**
   * Seek to a specific time (seconds)
   */
  seek(time) {
    this._muteVideosForFastPreview = false
    // [FIX] Kill any active scrubbing tweens from tweenTo() to prevent fighting
    gsap.killTweensOf(this.masterTimeline, { time: true })

    // [SEEK FIX] Ensure all child timelines are unpaused before seeking
    // This is critical for proper scrubbing - child timelines must be unpaused to scrub with parent
    // Without this, some steps (especially middle steps like step-2) might not execute during scrubbing
    this.activeTimelines.forEach(tl => {
      if (tl.instance) tl.instance.paused(false)
    })

    this.masterTimeline.pause(time)
    this.isPlaying = false

    // Force immediate media sync during seek
    this.syncMedia(time, true)
    this._handleUpdate()
  }

  /**
   * Smoothly animate the playhead to a specific time over a fixed duration.
   * Useful for "fast-play" transitions.
   * 
   * @param {number} targetTime - Time to animate to in seconds
   * @param {Object} options - Animation options (duration, easing, etc.)
   */
  tweenTo(targetTime, options = {}) {
    const {
      duration = 1,
      ease = "power2.inOut",
      onComplete = null
    } = options

    const start = this.masterTimeline.time()
    console.log(`🔵 [MotionEngine] Tweening playhead: ${start.toFixed(2)}s -> ${targetTime.toFixed(2)}s (Duration: ${duration}s)`)

    if (Math.abs(start - targetTime) < 0.001) {
      console.log('🟡 [MotionEngine] Target time is current time, skipping transition.')
      if (onComplete) onComplete()
      return null
    }

    // Ensure all children are definitely unpaused before scrubbing
    this.activeTimelines.forEach(tl => {
      if (tl.instance) tl.instance.paused(false)
    })

    // Kill any existing playhead tweens to avoid conflicts
    gsap.killTweensOf(this.masterTimeline, { time: true })

    this.isPlaying = true
    this._muteVideosForFastPreview = true
    console.log(`⚡ [MotionEngine] Initializing GSAP tweenTo: start=${start.toFixed(2)}s, target=${targetTime.toFixed(2)}s`)

    // Use native GSAP timeline.tweenTo() for more robust scrubbing
    const tween = this.masterTimeline.tweenTo(targetTime, {
      duration,
      ease,
      onStart: () => {
        console.log(`⚡ [MotionEngine] GSAP tween started. Current timeline progress: ${this.masterTimeline.progress().toFixed(2)}`)
      },
      onUpdate: () => {
        // Internal tick for UI/React sync
        this._handleUpdate()
        // Heartbeat log for debugging (every 10 frames approx)
        if (Math.random() < 0.1) {
          console.log(`💓 [MotionEngine] Ticking... time: ${this.masterTimeline.time().toFixed(2)}s`)
        }
      },
      onComplete: () => {
        console.log(`🟢 [MotionEngine] GSAP tween complete at ${this.masterTimeline.time().toFixed(2)}s`)
        this._muteVideosForFastPreview = false
        this.isPlaying = false
        if (onComplete) onComplete()
        this._handleAllComplete()
      }
    })

    console.log(`⚡ [MotionEngine] Tween instance created: duration=${tween.duration()}s`)
    return tween
  }

  /**
   * Register a function to call when ALL layers finish animating
   */
  onAllComplete(callback) {
    if (typeof callback === 'function') {
      this.onAllCompleteCallbacks.push(callback)
    }
  }

  /**
   * Register a function to call on every update (tick)
   */
  onUpdate(callback) {
    if (typeof callback === 'function') {
      this.onUpdateCallbacks.push(callback)
    }
  }

  onPlay(callback) {
    if (typeof callback === 'function') {
      this.onPlayCallbacks.push(callback)
    }
  }

  onPause(callback) {
    if (typeof callback === 'function') {
      this.onPauseCallbacks.push(callback)
    }
  }

  /**
   * Complete reset: stop animations and clear all registrations
   */
  destroy() {
    this.stopAll()
    if (this._tickHandler) {
      gsap.ticker.remove(this._tickHandler)
    }
    this.registeredObjects.clear()
    this.backgroundMedia.clear()
    this.activeTimelines.clear()
    this.isPlaying = false
    this.onAllCompleteCallbacks = []
    this.onUpdateCallbacks = []
  }

  /**
   * Private heartbeat: runs every frame to handle state recovery.
   * This is critical for resuming playback after buffering.
   * @private
   */
  _tick() {
    // If the engine is waiting for media, we MUST keep checking buffering status
    // even though the master timeline is paused.
    if (this.isInternalPaused && this.isPlaying) {
      this.syncMedia(this.masterTimeline.time(), false)
    }
  }

  /**
   * Ensure the master timeline is at least this long (matching scene duration)
   */
  setTotalDuration(duration) {
    // Remove any previous duration padding
    const padding = this.masterTimeline.getChildren().find(c => c.data === 'duration-padding')
    if (padding) this.masterTimeline.remove(padding)

    // Add a no-op tween at the end to extend duration
    if (duration > 0) {
      this.masterTimeline.add(gsap.to({}, { duration: 0, data: 'duration-padding' }), duration)
    }
  }

  /**
   * Private helper: Handles master timeline completion
   * @private
   */
  _handleAllComplete() {
    this.isPlaying = false
    this.onAllCompleteCallbacks.forEach(cb => {
      try { cb() } catch (e) { console.error(e) }
    })
  }

  /**
   * Private helper: Handles master timeline update
   * @private
   */
  _handleUpdate() {
    this.onUpdateCallbacks.forEach(cb => {
      try { cb(this.masterTimeline.time()) } catch (e) { console.error(e) }
    })
  }

  /**
   * Predicts the state of a layer at a specific time within a scene flow.
   * This is useful for calculating relative deltas during dragging/interactions.
   */
  predictLayerStateAtTime(layerId, sceneId, timeInScene) {
    const pixiObject = this.registeredObjects.get(layerId)
    if (!pixiObject) return null

    // Default to current visually applied transforms (base state)
    const state = {
      x: pixiObject.x,
      y: pixiObject.y,
      scaleX: pixiObject.scale.x,
      scaleY: pixiObject.scale.y,
      rotation: (pixiObject.rotation * 180) / Math.PI
    }

    // Since we don't have easy access to the full project state here, 
    // and we want to know the predicted state before the current step,
    // we should ideally be passed the flow or calculate it.
    // For now, if we are at time 0 of the scene, the pixiObject itself is the base state.
    // If we are mid-scene, we'd need to simulate the steps up to timeInScene.

    // NOTE: In useCanvasInteractions, we call this to know where the layer WAS
    // at the START of a step. If interactions start from a "known" base, 
    // we can return that.

    return state
  }

  // Getters for status
  get currentTime() { return this.masterTimeline.time() }
  get totalDuration() { return this.masterTimeline.duration() }
  getIsPlaying() { return this.isPlaying }

  // --- COMPATIBILITY SHIMS ---
  get timelines() { return this.activeTimelines }
  get layerObjects() { return this.registeredObjects }
  onLayerComplete() { }
  onLayerUpdate() { }
}

