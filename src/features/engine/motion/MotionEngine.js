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

    this.isPlaying = false
    this.onAllCompleteCallbacks = []
    this.onUpdateCallbacks = []

    // Master timeline to coordinate all animations
    this.masterTimeline = gsap.timeline({
      paused: true,
      onComplete: () => this._handleAllComplete(),
      onUpdate: () => {
        const time = this.masterTimeline.time()
        this.syncMedia(time)
        this._handleUpdate()
      }
    })

    // Scene timing mapping for media synchronization
    this.sceneRanges = new Map() // sceneId -> { startTime, endTime }
  }

  /**
   * Register a PIXI object so the engine knows what to animate
   */
  registerLayerObject(layerId, pixiObject, customData = {}) {
    this.registeredObjects.set(layerId, pixiObject)
    if (customData.sceneId) {
      pixiObject._sceneId = customData.sceneId
    }
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
        const baseLayer = allLayers[id]
        layerStateTracker.set(id, {
          x: baseLayer?.x !== undefined ? baseLayer.x : obj.x,
          y: baseLayer?.y !== undefined ? baseLayer.y : obj.y,
          scaleX: baseLayer?.scaleX !== undefined ? baseLayer.scaleX : obj.scale.x,
          scaleY: baseLayer?.scaleY !== undefined ? baseLayer.scaleY : obj.scale.y,
          rotation: baseLayer?.rotation !== undefined ? baseLayer.rotation : (obj.rotation * 180) / Math.PI,
          // Track crop state
          cropX: baseLayer?.cropX !== undefined ? baseLayer.cropX : (obj._storedCropX ?? 0),
          cropY: baseLayer?.cropY !== undefined ? baseLayer.cropY : (obj._storedCropY ?? 0),
          cropWidth: baseLayer?.cropWidth !== undefined ? baseLayer.cropWidth : (obj._storedCropWidth ?? obj._originalWidth ?? obj.width),
          cropHeight: baseLayer?.cropHeight !== undefined ? baseLayer.cropHeight : (obj._storedCropHeight ?? obj._originalHeight ?? obj.height),
          mediaWidth: baseLayer?.mediaWidth !== undefined ? baseLayer.mediaWidth : (obj._storedMediaWidth ?? obj._mediaWidth ?? obj._originalWidth ?? obj.width),
          mediaHeight: baseLayer?.mediaHeight !== undefined ? baseLayer.mediaHeight : (obj._storedMediaHeight ?? obj._mediaHeight ?? obj._originalHeight ?? obj.height),
          trimStart: baseLayer?.data?.trimStart !== undefined ? baseLayer.data.trimStart : (obj._storedTrimStart ?? 0),
          trimEnd: baseLayer?.data?.trimEnd !== undefined ? baseLayer.data.trimEnd : (obj._storedTrimEnd ?? 0)
        })
      })
    }

    steps.forEach((step, stepIndex) => {
      // ... same logic for timing ...
      const stepStartTime = startTimeOffset + (stepIndex * stepDurationMs) / 1000
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
        const stepDuration = stepDurationMs / 1000

        // Add all actions for this layer in this step
        actions.forEach((action) => {
          const handler = getActionHandler(action.type)
          if (!handler) return

          const actionDuration = action.values?.duration
            ? action.values.duration / 1000
            : stepDuration

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
   */
  syncMedia(currentTime) {
    const isPaused = this.masterTimeline.paused()

    // Performance: Only log occasionally or on significant state changes
    const shouldLog = Math.random() < 0.05 || this._lastPausedState !== isPaused
    this._lastPausedState = isPaused

    if (shouldLog) {
      console.log(`🎬 [MotionEngine] syncMedia: time=${currentTime.toFixed(3)}s, isPaused=${isPaused}, objects=${this.registeredObjects.size}`)
    }

    this.registeredObjects.forEach((obj, layerId) => {
      // 1. Detect video element
      let videoElement = obj._videoElement

      if (!videoElement && obj._videoSprite) {
        const source = obj._videoSprite.texture?.source
        if (source && source.resource instanceof HTMLVideoElement) {
          videoElement = source.resource
          obj._videoElement = videoElement
        }
      }

      if (videoElement) {
        const sceneId = obj._sceneId
        const range = this.sceneRanges.get(sceneId)

        if (range) {
          const localTime = currentTime - range.startTime
          // Use a small epsilon to avoid seam issues
          const inRange = currentTime >= range.startTime && currentTime < range.endTime

          if (shouldLog) {
            console.log(`🎥 [MotionEngine] Video ${layerId}: scene=${sceneId}, inRange=${inRange}, local=${localTime.toFixed(3)}s, vidTime=${videoElement.currentTime.toFixed(3)}s, vidPaused=${videoElement.paused}`)
          }

          if (inRange) {
            // [FIX] Trimming support: add trimStart to the local offset
            const trimStart = obj._storedTrimStart || 0
            const adjustedLocalTime = Math.max(0, localTime + trimStart)

            // Sync time (threshold 0.15s to avoid constant seeking jitter)
            if (Math.abs(videoElement.currentTime - adjustedLocalTime) > 0.15) {
              videoElement.currentTime = adjustedLocalTime
            }

            // Sync play/pause state
            if (isPaused) {
              if (!videoElement.paused) videoElement.pause()
            } else {
              if (videoElement.paused) {
                videoElement.play().catch(e => {
                  console.warn(`⚠️ [MotionEngine] Play failed for ${layerId}:`, e.message)
                })
              }
            }
          } else {
            // Outside scene range - ensure it's paused
            if (!videoElement.paused) videoElement.pause()
          }
        } else if (shouldLog) {
          console.warn(`⚠️ [MotionEngine] No range for scene ${sceneId} (layer ${layerId})`)
        }
      }
    })
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
    this.masterTimeline.pause()
    this.isPlaying = false
    this.syncMedia(this.masterTimeline.time())
  }

  /**
   * Reset everything back to the starting frame
   */
  stopAll() {
    this.masterTimeline.pause(0)
    this.isPlaying = false
  }

  /**
   * Seek to a specific time (seconds)
   */
  seek(time) {
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

    // Use native GSAP timeline.tweenTo() for more robust scrubbing
    return this.masterTimeline.tweenTo(targetTime, {
      duration,
      ease,
      onStart: () => {
        console.log('⚡ [MotionEngine] Fast-play transition started')
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
        console.log(`🟢 [MotionEngine] Fast-play transition complete at ${this.masterTimeline.time().toFixed(2)}s`)
        this.isPlaying = false
        if (onComplete) onComplete()
        this._handleAllComplete()
      }
    })
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

  /**
   * Complete reset: stop animations and clear all registrations
   */
  destroy() {
    this.unloadAllMotions()
    this.registeredObjects.clear()
    this.isPlaying = false
    this.onAllCompleteCallbacks = []
    this.onUpdateCallbacks = []
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

