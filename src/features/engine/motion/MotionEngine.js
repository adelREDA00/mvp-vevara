import * as PIXI from 'pixi.js'
import { gsap } from 'gsap'
import { MotionTimeline } from './MotionTimeline.js'
import { getActionHandler } from './actions/index.js'
import { hexToRgb, rgbToNum, applyColor } from './actions/ColorChangeAction.js'
import { syncTiltedDisplay, markTiltTextureDirty, syncTiltMesh, removeTiltFromObject } from '../pixi/perspectiveTilt.js'
import { PRESET_REGISTRY } from './presets.js'

/**
 * MotionEngine is the main coordinator for all layer animations.
 * It manages which layers are registered and handles loading their 
 * motion flows into GSAP timelines.
 */
// [PERF] Mobile detection for throttling
const _isMobileDevice = typeof window !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)

export class MotionEngine {
  constructor() {
    if (typeof window !== 'undefined') {
      window.__globalMotionEngine = this
    }
    this.activeTimelines = new Map() // layerId -> MotionTimeline
    this.registeredObjects = new Map() // layerId -> PIXI.DisplayObject
    this.backgroundMedia = new Map() // layerId -> { _videoElement, _sceneId, _sourceStartTime, _sourceEndTime }
    // [PERF] Index of only video-bearing registered objects for fast syncMedia iteration
    this._videoObjects = new Map() // layerId -> PIXI.DisplayObject (subset of registeredObjects)
    this.transitionContainer = null

    // [Dimentions Tracking] For relative occupancy filtering
    this.projectWidth = 1920
    this.projectHeight = 1080

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
        // [PERF] On mobile, throttle syncMedia to ~30fps (every 33ms) to reduce CPU overhead.
        // Audio sync tolerance is 100ms, so 33ms intervals are well within bounds.
        const now = performance.now()
        if (!_isMobileDevice || !this._lastSyncTime || now - this._lastSyncTime > 33) {
          this.syncMedia(time, false)
          this._lastSyncTime = now
        }
        // [PERF] Throttle refreshFlows to ~10fps during playback.
        // Text reflow does not need per-frame precision during animation.
        if (!this.isPlaying || !this._lastFlowRefresh || now - this._lastFlowRefresh > 100) {
          this.refreshFlows()
          this._lastFlowRefresh = now
        }
        // [TILT] Per-frame sync for any tilted layers. This MUST run every frame —
        // syncTiltMesh copies the pixiObject's live position/scale/rotation to the
        // mesh at 60fps. Throttling this causes visible jitter during animations
        // because the mesh lags behind the moving pixiObject. The GPU-expensive
        // RTT capture is throttled inside syncTiltMesh itself (per-pixiObject
        // time gate) — only the cheap transform copies run unthrottled here.
        this._syncTiltedLayers()
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
    // [PERF] Track all video elements registered with the engine for orphan cleanup
    // Replaces document.querySelectorAll('video') DOM queries
    this._allTrackedVideos = new Set()
    this.isInternalPaused = false // Track if engine paused itself due to buffering
    // When true, syncMedia forces all in-range videos muted (fast preview / tweenTo)
    this._muteVideosForFastPreview = false

    // [BLUR SCRUB FIX] Timestamp of last seek/scrub so getIsPlaying() can treat "recently seeked"
    // as "playing" for a short grace period. This stops useCanvasLayers from resetting layers
    // (e.g. blur filter) to Redux base state during timeline scrubbing.
    // [STABILITY FIX] Metadata for recently seeked to prevent resets
    this._lastInteractionTime = 0
    // [PERF] Flag for scrubbing mode - relaxes video sync thresholds during playhead dragging
    this._isScrubbing = false

    // Debug tracking structures
    this.stepRanges = []
    this.transitionRanges = []
    this._lastStepId = null
    this._lastTransitionState = null
  }

  /**
   * Update the engine's known project dimensions for accurate relative filtering.
   */
  setProjectConfig(config = {}) {
    if (config.width) this.projectWidth = config.width
    if (config.height) this.projectHeight = config.height
  }

  /**
   * Refresh all Liquid Flow text layers by harvesting current world-space 
   * coordinates of all potential obstacles.
   */
  /**
   * Per-frame sync of all tilted layers. Mirrors transforms onto each
   * perspective mesh and re-asserts the tilt-hide invariant so GSAP-touched
   * alphas don't reveal the original underneath the mesh. Iterating
   * registeredObjects is O(n) but the early-exit in syncTiltedDisplay (no
   * mesh / not hidden) keeps the per-frame cost negligible.
   */
  _syncTiltedLayers(force = false) {
    if (!this.registeredObjects || this.registeredObjects.size === 0) return
    // [PERF / RC2] Timestamp dedup: during seek/scrub, this method gets called
    // 3-4 times within the same event-loop tick (masterTimeline.seek → onUpdate,
    // masterTimeline.render → onUpdate, explicit _applyAnimatedTilt loop, and
    // then an explicit _syncTiltedLayers() call).  Each full pass iterates
    // all registered objects and can trigger expensive RTT recaptures for
    // video/dirty layers.  The 2ms window collapses all same-tick calls into
    // a single effective pass without risking stale data across frames.
    // [FORCE SYNC FIX] If force is true, we bypass this 2ms throttle to ensure
    // that the final state (especially alpha/sentinel) is correctly synchronized.
    const now = performance.now()
    if (!this.isExport && !force && this._lastTiltSyncTime && now - this._lastTiltSyncTime < 2) return
    this._lastTiltSyncTime = now
    
    this.registeredObjects.forEach((obj) => {
      if (!obj || obj.destroyed) return
      if (obj._isEditingText) {
        if (obj._tiltMesh) {
          removeTiltFromObject(obj)
        }
        return
      }
      if (!obj._tiltMesh || obj._tiltMesh.destroyed) return
      syncTiltedDisplay(obj, { force })
    })
  }

  refreshFlows() {
    // 1. Gather all potential obstacles (non-text layers in the current screen)
    const obstacles = []

    // [AUTOMATIC BOUNDARY DETECTION] Use the background layer to find true project dimensions
    // fallback to standard 1080p if background not yet registered.
    let screenWidth = 1920
    let screenHeight = 1080

    this.registeredObjects.forEach((obj) => {
      if (obj.isBackground && !obj.destroyed) {
        const bounds = obj.getBounds()
        screenWidth = Math.max(screenWidth, bounds.width)
        screenHeight = Math.max(screenHeight, bounds.height)
      }
    })

    this.registeredObjects.forEach((obj, id) => {
      // Skip destroyed objects or those without bounds
      if (!obj || obj.destroyed || !obj.getBounds) return

      // [LIQUID FLOW] Only wrap around Shapes, Images, and Frames.
      const isText = obj.isFlowText || obj instanceof PIXI.Text
      const isBackground = obj.isBackground === true || obj.label?.toLowerCase().includes('background')
      const isMask = obj.isMask === true || obj.label?.toLowerCase().includes('mask') || obj.isMasking === true

      // Skip the source container (to avoid text wrapping around itself)
      if (obj.isFlowText) return

      // [FILTER] Filter out environment layers (backgrounds, global masks)
      if (isBackground || isMask) return

      const bounds = obj.getBounds()

      // Hybrid Occupancy Filter: Skip layers that cover >95% of the screen
      if (screenWidth > 0 && screenHeight > 0) {
        const occupancyX = bounds.width / screenWidth
        const occupancyY = bounds.height / screenHeight

        if (occupancyX > 0.95 && occupancyY > 0.95) {
          return
        }

        // [POLYGON WRAP FIX] Harvest exact geometric path for perfect hugging
        let localPath = obj._storedShapeData?.shapePath
        if (!localPath && obj._storedShapeData?.shapeType !== 'circle' && obj.shapeType !== 'circle') {
          const lb = obj.getLocalBounds()
          localPath = [
            { x: lb.x, y: lb.y },
            { x: lb.x + lb.width, y: lb.y },
            { x: lb.x + lb.width, y: lb.y + lb.height },
            { x: lb.x, y: lb.y + lb.height }
          ]
        }

        // Convert to absolute world space
        const worldPath = localPath ? localPath.map(p => obj.worldTransform.apply(p)) : null

        obstacles.push({
          id,
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          worldPath: worldPath,
          shapeType: obj._storedShapeData?.shapeType || obj.shapeType || (obj instanceof PIXI.Graphics ? 'rect' : 'img'),
          cornerRadius: obj._storedShapeData?.cornerRadius !== undefined ? obj._storedShapeData.cornerRadius : (obj.cornerRadius || 0)
        })
      }
    })

    // 2. Notify all text flow containers to recalculate wrapping
    this.registeredObjects.forEach((obj) => {
      if (obj.isFlowText && obj.refresh) {
        // [SYNC FIX] Force updates to the text container's own world matrix
        // so its inverse mappings use the absolute latest canvas coordinates,
        // eliminating jitter and coordinate lag during drag interactions.
        if (obj.getBounds) obj.getBounds()
        obj.refresh(obstacles)
      }
    })
  }

  get isBuffering() {
    // [PERF FIX] Only consider the timeline "buffering" if ALL active videos are
    // stalled, not just one. Previously, one slow video would pause the entire
    // timeline causing a play-pause oscillation that made all videos stutter.
    // With multiple videos, brief individual buffering is normal and the timeline
    // should keep advancing to avoid cascading stalls.
    if (this._activeVideoElements.size === 0) return false
    let bufferingCount = 0
    for (const video of this._activeVideoElements) {
      if (video.seeking || video.readyState < 3) bufferingCount++
    }
    // Only stall the timeline if ALL active videos are buffering
    return bufferingCount === this._activeVideoElements.size
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

    // [PERF] Track video elements for orphan cleanup (replaces DOM queries)
    // and index video-bearing objects for fast syncMedia iteration
    if (pixiObject._videoElement) {
      this._allTrackedVideos.add(pixiObject._videoElement)
      this._videoObjects.set(layerId, pixiObject)
    }

    // [FIX] Immediate Sync: Sync media state immediately when a new layer is added.
    const currentTime = this.masterTimeline.time()

    // [GSAP FIX] Ensure the object has all reactive properties defined so GSAP can safely set/animate them.
    this._ensureGSAPProperties(pixiObject)

    this.syncMedia(currentTime, false)
  }

  /**
   * Defines reactive properties (getters/setters) on a PIXI object for GSAP tracking.
   * This prevents "Invalid property" errors during scene initialization and ensures
   * that visual updates (like cropping or card flips) trigger immediately when 
   * GSAP modifies these values.
   */
  _ensureGSAPProperties(pixiObject) {
    if (!pixiObject || pixiObject.destroyed || pixiObject._hasGSAPProperties) return

    const properties = [
      'cropX', 'cropY', 'cropWidth', 'cropHeight',
      'mediaWidth', 'mediaHeight', 'showingFront',
      'cornerRadius', 'blur'
    ]

    properties.forEach(prop => {
      const privateProp = `_${prop}`

      // Initialize private storage if not already there (prefixed with _)
      if (pixiObject[privateProp] === undefined) {
        let defaultValue = 0
        if (prop === 'cropWidth') defaultValue = pixiObject.width || 100
        if (prop === 'cropHeight') defaultValue = pixiObject.height || 100
        if (prop === 'mediaWidth') defaultValue = pixiObject._originalWidth || pixiObject.width || 100
        if (prop === 'mediaHeight') defaultValue = pixiObject._originalHeight || pixiObject.height || 100
        if (prop === 'showingFront') defaultValue = true // Default to showing front
        if (prop === 'blur') defaultValue = -1 // Use -1 as sentinel so setter always fires for 0!

        pixiObject[privateProp] = defaultValue
      }

      // Define public getter/setter so GSAP can "see" and "set" the property
      if (Object.getOwnPropertyDescriptor(pixiObject, prop)?.configurable !== false) {
        Object.defineProperty(pixiObject, prop, {
          get() { return this[privateProp] },
          set(val) {
            if (this[privateProp] !== val) {
              this[privateProp] = val
              // Trigger visual update if the object supports it (e.g. from CropAction)
              if (this._updateCropVisuals) {
                this._updateCropVisuals()
              }

              if (this._applyAnimatedCornerRadius) {
                this._applyAnimatedCornerRadius()
              }

              if (prop === 'blur') {
                this._blurLogicalStrength = val
                if (this._applyAnimatedBlur) this._applyAnimatedBlur()
              }

              // [TILT SYNC] Any change to these custom properties (crop, radius, flip) 
              // must invalidate the tilt mesh's cached texture so it re-captures 
              // the updated visual state of the original layer.
              // [PERF] Redundant calls to syncTiltMesh are skipped here. The engine's
              // single _syncTiltedLayers() pass at the end of the frame will handle the sync.
              if (this._tiltMesh && !this._tiltMesh.destroyed) {
                markTiltTextureDirty(this)
              }

              // Special case for card frames - toggle visibility when showingFront changes
              if (prop === 'showingFront' && this._isCardFrame) {
                const isShowing = val !== false
                if (this._imageSprite) this._imageSprite.visible = isShowing && !!this._frameHasAsset
                if (this._backSprite) this._backSprite.visible = !isShowing && !!this._frameHasBackAsset

                // Update placeholder if no asset
                const activeHasAsset = isShowing ? this._frameHasAsset : this._frameHasBackAsset
                if (this._framePlaceholder) {
                  const isDropTarget = this._isDropTarget === true
                  if (!isDropTarget) {
                    this._framePlaceholder.visible = !activeHasAsset
                  }

                  // [UX] Update placeholder label for empty card frames
                  if (!activeHasAsset && this._frameLabel) {
                    const customLabel = (this._frameData?.label || '').trim()
                    if (!customLabel) {
                      this._frameLabel.text = isShowing ? 'Front' : 'Back'
                    }
                  }
                }
              }

              // [FIX] Force visibility sync for normal frames whenever their state changes
              if (this._isFrame && !this._isCardFrame) {
                if (this._imageSprite) this._imageSprite.visible = !!this._frameHasAsset
                if (this._framePlaceholder && !this._isDropTarget) {
                  this._framePlaceholder.visible = !this._frameHasAsset
                }
              }
            }
          },
          configurable: true
        })
      }
    })

    pixiObject._hasGSAPProperties = true
  }

  /**
   * Unregister a PIXI object from the engine
   */
  unregisterLayerObject(layerId) {
    // [PERF] Clean up video indexes
    const obj = this.registeredObjects.get(layerId)
    if (obj) {
      if (obj._videoElement) {

        // [SCENE CUT FIX] Explicitly check if this video element is still being used 
        // by another registered layer before pausing it. If it's shared (e.g. split segments),
        // let the other layer manage its playback and muted state to avoid audio glitches.
        let isShared = false
        this.registeredObjects.forEach((otherObj, otherId) => {
          if (otherId !== layerId && otherObj._videoElement === obj._videoElement) {
            isShared = true
          }
        })

        if (!isShared) {
          try {
            obj._videoElement.pause()
            obj._videoElement.muted = true
            this._activeVideoElements.delete(obj._videoElement)
          } catch (e) { }
        }

        this._videoObjects.delete(layerId)
        // Only remove from tracked videos if not also in backgroundMedia
        let stillTracked = false
        this.backgroundMedia.forEach((data) => {
          if (data._videoElement === obj._videoElement) stillTracked = true
        })
        if (!stillTracked) {
          this._allTrackedVideos.delete(obj._videoElement)
        }
      }
      this.registeredObjects.delete(layerId)
      this.unloadMotionFlow(layerId)
    }
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

    // [PERF] Track video element for orphan cleanup
    if (videoElement) {
      this._allTrackedVideos.add(videoElement)
    }
  }

  unregisterBackgroundMedia(layerId) {
    const data = this.backgroundMedia.get(layerId)
    if (data?._videoElement) {
      // Only remove from tracked set if not also in _videoObjects
      let stillTracked = false
      this._videoObjects.forEach((obj) => {
        if (obj._videoElement === data._videoElement) stillTracked = true
      })
      if (!stillTracked) {
        this._allTrackedVideos.delete(data._videoElement)
      }
    }
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

    // [DEBUG]

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
          opacity: baseLayer?.opacity ?? obj.alpha ?? 1,
          // Track crop state
          cropX: baseLayer?.cropX ?? (obj._storedCropX ?? 0),
          cropY: baseLayer?.cropY ?? (obj._storedCropY ?? 0),
          cropWidth: baseLayer?.cropWidth ?? (obj._storedCropWidth ?? obj._originalWidth ?? obj.width ?? 100),
          cropHeight: baseLayer?.cropHeight ?? (obj._storedCropHeight ?? obj._originalHeight ?? obj.height ?? 100),
          mediaWidth: baseLayer?.mediaWidth ?? (obj._storedMediaWidth ?? obj._mediaWidth ?? obj._originalWidth ?? obj.width ?? 100),
          mediaHeight: baseLayer?.mediaHeight ?? (obj._storedMediaHeight ?? obj._mediaHeight ?? obj._originalHeight ?? obj.height ?? 100),
          trimStart: baseLayer?.data?.trimStart ?? (obj._storedTrimStart ?? 0),
          trimEnd: baseLayer?.data?.trimEnd ?? (obj._storedTrimEnd ?? 0),
          blur: baseLayer?.blur ?? (obj._blurFilter?.strength ?? 0),
          cornerRadius: baseLayer?.data?.cornerRadius ?? (obj._storedShapeData?.cornerRadius ?? 0),
          color: baseLayer?.data?.fill || baseLayer?.data?.color || null,
          // Card frame flip state — defaults to true (front) if not explicitly set
          showingFront: baseLayer?.data?.showingFront !== false,
          // [TYPEWRITER] Track reveal progress across steps
          revealProgress: baseLayer?.revealProgress ?? (obj.revealProgress !== undefined ? obj.revealProgress : 1),
          // [TILT] Track perspective tilt across steps (degrees)
          tiltX: baseLayer?.tiltX ?? (obj._tiltXDeg ?? 0),
          tiltY: baseLayer?.tiltY ?? (obj._tiltYDeg ?? 0),
        })
      })
    }

    steps.forEach((step, stepIndex) => {
      // Use absolute startTime if available, fallback to index-based calculation
      const stepStartTimeMs = step.startTime != null ? step.startTime : (stepIndex * stepDurationMs)
      const stepStartTime = startTimeOffset + stepStartTimeMs / 1000
      const stepDurationMsValue = step.duration || stepDurationMs
      const stepEndTime = stepStartTime + stepDurationMsValue / 1000

      if (!this.stepRanges) this.stepRanges = []
      if (!this.stepRanges.some(r => r.stepId === step.id)) {
        this.stepRanges.push({
          stepId: step.id,
          startTime: stepStartTime,
          endTime: stepEndTime
        })
      }

      const stepLayerActions = step.layerActions || {}
      const stepLayerPresets = step.layerPresets || {}

      // Gather all unique layer IDs in this step containing either custom actions or presets
      const activeLayerIds = new Set([
        ...Object.keys(stepLayerActions),
        ...Object.keys(stepLayerPresets)
      ])

      activeLayerIds.forEach(layerId => {
        const pixiObject = objectsToUse.get(layerId)
        if (!pixiObject || pixiObject.destroyed) return

        const originalActions = stepLayerActions[layerId] || []

        // [FIX] ACTION SANITIZATION: If a single step has BOTH a MoveAction and a CropAction, 
        // they can contain conflicting dx/dy values due to legacy data or concurrent resizing.
        const hasMove = originalActions.some(a => a.type === 'move')
        const actions = originalActions.map(a => {
          if (a.type === 'crop') {
            if (hasMove) {
              const safeValues = { ...a.values }
              delete safeValues.dx
              delete safeValues.dy
              return { ...a, values: safeValues }
            }
          }
          return a
        })

        // Get predicted start state for this layer at this step
        const startState = { ...layerStateTracker.get(layerId) }
        const stepDurationMsValue = step.duration || stepDurationMs

        // Check if there is an IN preset as the FIRST animation for this layer.
        // [FIX] "First animation boundary" must depend on whether the layer has been
        // animated yet (`!layerTimelineBuilders.has(layerId)`), NOT on the scene's
        // step index. A static layer whose first animation is an IN preset on a later
        // step (e.g. step 3) is still that layer's first animation boundary and must
        // have its pre-step offset anchored correctly — see the deferred-anchor logic
        // in the baseline .set() block below.
        const firstStepPreset = stepLayerPresets[layerId]
        const isFirstStepInPreset = !layerTimelineBuilders.has(layerId) && firstStepPreset && firstStepPreset.type === 'IN' && PRESET_REGISTRY[firstStepPreset.id]
        const cumulativeStartOffset = { x: 0, y: 0, opacity: undefined, scaleX: undefined, scaleY: undefined, rotation: undefined, blur: undefined }
        if (isFirstStepInPreset) {
          const presetActionsForOffsets = PRESET_REGISTRY[firstStepPreset.id].getActions(startState, stepDurationMsValue)
          presetActionsForOffsets.forEach(pAction => {
            if (pAction.startOffset) {
              if (pAction.startOffset.x !== undefined) cumulativeStartOffset.x += pAction.startOffset.x
              if (pAction.startOffset.y !== undefined) cumulativeStartOffset.y += pAction.startOffset.y
              if (pAction.startOffset.opacity !== undefined) cumulativeStartOffset.opacity = pAction.startOffset.opacity
              if (pAction.startOffset.scaleX !== undefined) cumulativeStartOffset.scaleX = pAction.startOffset.scaleX
              if (pAction.startOffset.scaleY !== undefined) cumulativeStartOffset.scaleY = pAction.startOffset.scaleY
              if (pAction.startOffset.rotation !== undefined) cumulativeStartOffset.rotation = pAction.startOffset.rotation
              if (pAction.startOffset.blur !== undefined) cumulativeStartOffset.blur = pAction.startOffset.blur
            }
          })
        }

        // Initialize timeline builder for this layer if not exists
        if (!layerTimelineBuilders.has(layerId)) {
          // Unload if not sharing context (regular single-scene load)
          if (!sharedContext) {
            this.unloadMotionFlow(layerId)
          }
          const timeline = new MotionTimeline(layerId)
          timeline.create()
          layerTimelineBuilders.set(layerId, { timeline, currentTimeOffset: 0 })

          // [GSAP STATE CACHE FIX]
          // Force a 0-duration baseline state into the GSAP timeline exactly at the scene's start time.
          if (startState) {
            timeline.add((gsapTimeline) => {
              // [TILT] If the layer is tilted at scene start, alpha is owned by the perspective tilt system
              const willStartTilted = (
                Math.abs(startState.tiltX || 0) > 0.01 ||
                Math.abs(startState.tiltY || 0) > 0.01
              )

              const baselineX = startState.x + cumulativeStartOffset.x
              const baselineY = startState.y + cumulativeStartOffset.y
              const baselineRotation = (startState.rotation + (cumulativeStartOffset.rotation !== undefined ? cumulativeStartOffset.rotation : 0)) * (Math.PI / 180)
              const baselineScaleX = cumulativeStartOffset.scaleX !== undefined ? cumulativeStartOffset.scaleX : startState.scaleX
              const baselineScaleY = cumulativeStartOffset.scaleY !== undefined ? cumulativeStartOffset.scaleY : startState.scaleY
              const baselineOpacity = cumulativeStartOffset.opacity !== undefined ? cumulativeStartOffset.opacity : (startState.opacity !== undefined ? startState.opacity : 1)

              const baseline = {
                x: baselineX,
                y: baselineY,
                rotation: baselineRotation,
                cropX: startState.cropX !== undefined ? startState.cropX : 0,
                cropY: startState.cropY !== undefined ? startState.cropY : 0,
                cropWidth: startState.cropWidth,
                cropHeight: startState.cropHeight,
                mediaWidth: startState.mediaWidth,
                mediaHeight: startState.mediaHeight,
                showingFront: startState.showingFront !== false,
                cornerRadius: startState.cornerRadius !== undefined ? startState.cornerRadius : 0,
                blur: cumulativeStartOffset.blur !== undefined ? cumulativeStartOffset.blur : (startState.blur !== undefined ? startState.blur : 0),
              }

              if (willStartTilted) {
                pixiObject._intendedAlpha = baselineOpacity
              } else {
                baseline.alpha = baselineOpacity
              }

              // [TYPEWRITER] Only apply revealProgress if the object supports it
              if (pixiObject.revealProgress !== undefined) {
                baseline.revealProgress = startState.revealProgress !== undefined ? startState.revealProgress : 1
              }

              // [FIRST-PRESET PRE-STEP STATE]
              // Anchor the layer's baseline at the scene start. When this is the layer's
              // FIRST animation and that animation is an IN preset (isFirstStepInPreset),
              // `baseline` already carries the preset's pre-step offset (e.g. alpha 0,
              // x-150) via cumulativeStartOffset. Baking it in at the scene start means the
              // layer holds its pre-step state for the ENTIRE time before the preset's step
              // — so scrubbing anywhere before that step shows the correct "before" visual
              // (e.g. opacity 0), regardless of which step the preset lives on. This matches
              // the per-layer animation history: earlier scene steps that animate OTHER
              // layers never make this layer "already animated".
              gsapTimeline.set(pixiObject, baseline, startTimeOffset) // Anchor explicitly at the beginning of the scene

              // Scale must be set on the inner .scale object natively
              if (pixiObject.scale) {
                gsapTimeline.set(pixiObject.scale, {
                  x: baselineScaleX,
                  y: baselineScaleY,
                }, startTimeOffset)
              }

              // [TILT] Anchor perspective tilt baseline so backward scrubs restore correct tilt.
              pixiObject._tiltXDeg = startState.tiltX ?? 0
              pixiObject._tiltYDeg = startState.tiltY ?? 0
              if (!pixiObject._tiltProxy) pixiObject._tiltProxy = { tiltX: 0, tiltY: 0 }
              pixiObject._tiltProxy.tiltX = pixiObject._tiltXDeg
              pixiObject._tiltProxy.tiltY = pixiObject._tiltYDeg

              gsapTimeline.set(pixiObject._tiltProxy, {
                tiltX: pixiObject._tiltXDeg,
                tiltY: pixiObject._tiltYDeg,
                onUpdate: () => {
                  pixiObject._tiltXDeg = pixiObject._tiltProxy.tiltX
                  pixiObject._tiltYDeg = pixiObject._tiltProxy.tiltY
                  if (pixiObject._applyAnimatedTilt) pixiObject._applyAnimatedTilt()
                },
              }, startTimeOffset)

              // [COLOR STATE CONSISTENCY FIX] Anchor the BASE color at scene start for ALL
              // layer types, not just backgrounds. Previously only background layers got a
              // baseline .set() for _animatedColorState, which meant that scrubbing backward
              // before a shape/text color change step would leave _animatedColorState at the
              // value the forward tween last wrote — causing the layer to retain the motion
              // color permanently (Bug 1) and bleed color into subsequent steps (Bug 3).
              //
              // For each layer type, startState.color is populated from the Redux base:
              //   - Backgrounds: baseLayer.data.color (0xRRGGBB numeric)
              //   - Shapes: baseLayer.data.fill ("#RRGGBB" string)
              //   - Text: baseLayer.data.color ("#RRGGBB" string)
              const hasColorAnimationInScene = steps.some(s => {
                const actions = s.layerActions?.[layerId] || []
                const hasCustomColorChange = actions.some(a => a.type === 'colorChange')
                const preset = s.layerPresets?.[layerId]
                let hasPresetColorChange = false
                if (preset && PRESET_REGISTRY[preset.id]) {
                  const presetActions = PRESET_REGISTRY[preset.id].getActions(startState, s.duration || stepDurationMs)
                  hasPresetColorChange = presetActions.some(a => a.type === 'colorChange')
                }
                return hasCustomColorChange || hasPresetColorChange
              })

              if (hasColorAnimationInScene && startState.color != null) {
                const baseRgb = hexToRgb(startState.color)
                if (!pixiObject._animatedColorState || typeof pixiObject._animatedColorState !== 'object') {
                  pixiObject._animatedColorState = { r: baseRgb.r, g: baseRgb.g, b: baseRgb.b }
                } else {
                  // Seed the baseline even if the proxy already exists (e.g. from a previous
                  // scene) so a seek before any color tween in this scene shows the correct base.
                  pixiObject._animatedColorState.r = baseRgb.r
                  pixiObject._animatedColorState.g = baseRgb.g
                  pixiObject._animatedColorState.b = baseRgb.b
                }
                if (!pixiObject._applyAnimatedColor) {
                  pixiObject._applyAnimatedColor = () => {
                    if (pixiObject._animatedColorState) {
                      const num = rgbToNum(pixiObject._animatedColorState.r, pixiObject._animatedColorState.g, pixiObject._animatedColorState.b)
                      pixiObject._animatedColorState.numeric = num
                      applyColor(pixiObject, num)
                    }
                  }
                }
                gsapTimeline.set(pixiObject._animatedColorState, {
                  r: baseRgb.r, g: baseRgb.g, b: baseRgb.b,
                  onUpdate: () => { if (pixiObject._applyAnimatedColor) pixiObject._applyAnimatedColor() }
                }, startTimeOffset)
              }
            })
          }
        }

        const builder = layerTimelineBuilders.get(layerId)
        // Use the step's effective duration (respects customDuration)
        const stepDuration = stepDurationMsValue / 1000

        // Add all actions for this layer in this step
        // Scene end boundary in seconds — tweens must not exceed this
        const sceneEndTime = startTimeOffset + pageDuration / 1000

        // Track which properties we've already updated deltas for in THIS STEP
        // to avoid double-counting if multiple actions has dx/dy/dsx/dsy
        const updatedDeltas = new Set()

        // Resolve Presets vs Custom — COMPOSE rather than filter.
        //
        // The user adds custom actions ON TOP of a preset. They expect the
        // preset's initialization (e.g. slide-in-left starts the layer at
        // x-150, alpha=0 before the step) to remain intact AND the custom
        // action's delta to be added to the preset's animation.
        //
        // Old behaviour FILTERED the preset action whenever a custom action of
        // the same type existed. That broke the preset's startOffset for that
        // property — the custom action's fromVars used `startState`, not the
        // offset baseline, so the layer either jumped at step start or lost
        // the preset's pre-step state entirely.
        //
        // New behaviour MERGES the preset action and the custom action into a
        // single action that preserves the preset's startOffset and adds the
        // custom delta on top of the preset delta.
        let resolvedActions = []
        const preset = stepLayerPresets[layerId]
        if (preset && PRESET_REGISTRY[preset.id]) {
          const presetActions = PRESET_REGISTRY[preset.id].getActions(startState, stepDurationMsValue)
          const customByType = new Map()
          actions.forEach(a => { if (a) customByType.set(a.type, a) })

          const composedFromPreset = presetActions.map(pAction => {
            const custom = customByType.get(pAction.type)
            if (!custom) {
              // No custom override — use the preset action as-is
              return {
                id: `preset_${preset.id}_${pAction.type}_${step.id}`,
                _isPresetAction: true,
                ...pAction
              }
            }

            // Compose: keep preset's startOffset, merge values per-type
            const pValues = pAction.values || {}
            const cValues = custom.values || {}
            const mergedValues = { ...pValues, ...cValues }

            // Per-type delta composition — the preset's delta and the custom
            // delta should ADD (move/rotate) or MULTIPLY (scale) so the
            // animation slides from the preset offset to the custom target.
            if (pAction.type === 'move') {
              mergedValues.dx = (pValues.dx || 0) + (cValues.dx || 0)
              mergedValues.dy = (pValues.dy || 0) + (cValues.dy || 0)
              if (cValues.controlPoints !== undefined) mergedValues.controlPoints = cValues.controlPoints
            } else if (pAction.type === 'scale') {
              mergedValues.dsx = (pValues.dsx ?? 1) * (cValues.dsx ?? 1)
              mergedValues.dsy = (pValues.dsy ?? 1) * (cValues.dsy ?? 1)
            } else if (pAction.type === 'rotate') {
              mergedValues.dangle = (pValues.dangle || 0) + (cValues.dangle || 0)
            }
            // fade / blur / colorChange / cornerRadius / tilt: custom values
            // already override via { ...pValues, ...cValues } — preset's
            // startOffset still gates the pre-step visual state, custom's
            // final target wins for the post-step state.

            // Custom action's duration overrides if explicitly provided
            if (cValues.duration !== undefined) mergedValues.duration = cValues.duration

            return {
              id: custom.id || `preset_${preset.id}_${pAction.type}_${step.id}`,
              _isPresetAction: true, // keep startOffset state-tracking skip
              _isComposedAction: true,
              type: pAction.type,
              startOffset: pAction.startOffset,
              values: mergedValues
            }
          })

          // Custom actions that don't have a matching preset action of the
          // same type still run normally.
          const presetTypes = new Set(presetActions.map(p => p.type))
          const remainingCustomActions = actions.filter(a => !presetTypes.has(a.type))

          resolvedActions = [...composedFromPreset, ...remainingCustomActions]
        } else {
          resolvedActions = [...actions]
        }

        // [FIX] Detect flip+scale co-occurrence to prevent both fighting over scale.x
        const hasFlip = resolvedActions.some(a => a.type === 'flip')
        const coScaleAction = hasFlip ? resolvedActions.find(a => a.type === 'scale') : null
        const flipTargetScaleX = coScaleAction
          ? startState.scaleX * (coScaleAction.values?.dsx ?? 1)
          : undefined

        resolvedActions.forEach((action) => {
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

          // Apply preset startOffsets to startState if present
          const adjustedStartState = { ...startState }
          if (action.startOffset) {
            if (action.startOffset.x !== undefined) adjustedStartState.x += action.startOffset.x
            if (action.startOffset.y !== undefined) adjustedStartState.y += action.startOffset.y
            if (action.startOffset.opacity !== undefined) adjustedStartState.opacity = action.startOffset.opacity
            if (action.startOffset.scaleX !== undefined) adjustedStartState.scaleX = startState.scaleX * action.startOffset.scaleX
            if (action.startOffset.scaleY !== undefined) adjustedStartState.scaleY = startState.scaleY * action.startOffset.scaleY
            if (action.startOffset.rotation !== undefined) adjustedStartState.rotation = startState.rotation + action.startOffset.rotation
            if (action.startOffset.blur !== undefined) adjustedStartState.blur = action.startOffset.blur
          }

          // When flip and scale co-exist: flip owns scale.x, scale skips it
          const actionOptions = {
            ...options,
            duration: actionDuration,
            startTime: stepStartTime,
            sceneStartOffset: startTimeOffset,
            startState: adjustedStartState
          }
          if (hasFlip && action.type === 'flip' && flipTargetScaleX !== undefined) {
            actionOptions.flipTargetScaleX = flipTargetScaleX
          }
          if (hasFlip && action.type === 'scale') {
            actionOptions.skipScaleX = true
          }

          builder.timeline.add((gsapTimeline) => {
            const tween = handler.execute(pixiObject, action, actionOptions)
            if (tween) {
              gsapTimeline.add(tween, stepStartTime)
            }
          })

          // UPDATE STATE TRACKER: Predict where the layer will be after this action
          // This ensures the NEXT step knows the correct start point.
          const state = layerStateTracker.get(layerId)
          if (!state) return

          // [COMPOSITION FIX] State tracker rules for the three action kinds:
          //
          //   1. Custom action (no preset)            – apply delta only.
          //      Layer ends at startState + dx.
          //
          //   2. Pure preset action (e.g. user picked a preset, no custom
          //      override for this type) – the tween is net-zero (startOffset
          //      and delta cancel: -150 + 150 = 0). Skip BOTH startOffset and
          //      delta application; the layer ends where it started.
          //
          //   3. Composed action (preset + custom of the same type, merged in
          //      the resolution step above) – apply BOTH startOffset AND delta.
          //      For composed move:  startOffset.x = -150,  dx = 150 + custom_dx
          //      Net change = -150 + 150 + custom_dx = custom_dx, which is what
          //      the user expects: the preset's slide envelope is preserved
          //      AND the custom delta is added on top.
          const isComposed = action._isComposedAction === true
          const isPureNetZeroPreset = action._isPresetAction && action.startOffset && !isComposed
          const shouldApplyStartOffset = action.startOffset && (!action._isPresetAction || isComposed)

          if (shouldApplyStartOffset) {
            if (action.startOffset.x !== undefined && !updatedDeltas.has('position_offset')) {
              state.x += action.startOffset.x
              updatedDeltas.add('position_offset')
            }
            if (action.startOffset.y !== undefined && !updatedDeltas.has('position_offset_y')) {
              state.y += action.startOffset.y
              updatedDeltas.add('position_offset_y')
            }
            if (action.startOffset.opacity !== undefined) {
              state.opacity = action.startOffset.opacity
            }
            if (action.startOffset.scaleX !== undefined) {
              state.scaleX *= action.startOffset.scaleX
            }
            if (action.startOffset.scaleY !== undefined) {
              state.scaleY *= action.startOffset.scaleY
            }
            if (action.startOffset.rotation !== undefined) {
              state.rotation += action.startOffset.rotation
            }
          }

          // Use isPureNetZeroPreset (composed = false, custom = false) to gate the
          // per-type delta block below.
          const isNetZeroPresetAction = isPureNetZeroPreset

          if ((action.type === 'move' || action.type === 'crop') && !isNetZeroPresetAction) {
            if (!updatedDeltas.has('position')) {
              const dx = action.values?.dx !== undefined ? action.values.dx : 0
              const dy = action.values?.dy !== undefined ? action.values.dy : 0
              state.x += dx
              state.y += dy
              if (dx !== 0 || dy !== 0) {
                updatedDeltas.add('position')
              }
            }

            if (action.type === 'crop' && action.values) {
              if (action.values.cropX !== undefined) state.cropX = action.values.cropX
              if (action.values.cropY !== undefined) state.cropY = action.values.cropY
              if (action.values.cropWidth !== undefined) state.cropWidth = action.values.cropWidth
              if (action.values.cropHeight !== undefined) state.cropHeight = action.values.cropHeight
              if (action.values.mediaWidth !== undefined) state.mediaWidth = action.values.mediaWidth
              if (action.values.mediaHeight !== undefined) state.mediaHeight = action.values.mediaHeight
              if (action.values.trimStart !== undefined) state.trimStart = action.values.trimStart
              if (action.values.trimEnd !== undefined) state.trimEnd = action.values.trimEnd
            }
          } else if (action.type === 'scale' && !isNetZeroPresetAction) {
            if (!updatedDeltas.has('scale')) {
              const dsx = action.values?.dsx !== undefined ? action.values.dsx : 1
              const dsy = action.values?.dsy !== undefined ? action.values.dsy : 1
              state.scaleX *= dsx
              state.scaleY *= dsy
              if (dsx !== 1 || dsy !== 1) updatedDeltas.add('scale')
            }
          } else if (action.type === 'rotate' && !isNetZeroPresetAction) {
            if (!updatedDeltas.has('rotation')) {
              const dangle = action.values?.dangle !== undefined ? action.values.dangle : 0
              state.rotation += dangle
              if (dangle !== 0) updatedDeltas.add('rotation')
            }
          } else if (action.type === 'typewriter') {
            state.revealProgress = 1
            state.opacity = 1
          } else if (action.type === 'fade' && !isNetZeroPresetAction) {
            if (action.values?.opacity !== undefined) {
              state.opacity = action.values.opacity
            }
          } else if (action.type === 'blur' && !isNetZeroPresetAction) {
            if (action.values?.blur !== undefined) {
              state.blur = action.values.blur
            }
          } else if (action.type === 'cornerRadius') {
            if (action.values?.cornerRadius !== undefined) {
              state.cornerRadius = action.values.cornerRadius
            }
          } else if (action.type === 'colorChange') {
            if (action.values?.color !== undefined) {
              state.color = action.values.color
            }
          } else if (action.type === 'tilt') {
            if (action.values?.tiltX !== undefined) state.tiltX = action.values.tiltX
            if (action.values?.tiltY !== undefined) state.tiltY = action.values.tiltY
          } else if (action.type === 'flip') {
            if (!pixiObject._flipActions) pixiObject._flipActions = []
            pixiObject._flipActions.push({
              time: stepStartTime,
              duration: actionDuration,
              wasShowingFront: state.showingFront
            })
            state.showingFront = !state.showingFront
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

  }

  /**
   * Load entire project motion flow (all scenes).
   * @param {Array} timelineInfo - Array of scenes with startTime/endTime info
   * @param {Object} sceneMotionFlowsMap - Map of sceneId -> motionFlow
   * @param {Map} allLayerObjects - Map of layerId -> PIXI.DisplayObject
   * @param {Object} options - Animation options
   */
  loadProjectMotionFlow(timelineInfo, sceneMotionFlowsMap, allLayerObjects, options = {}) {
    this.isExport = !!options.isExport

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

    // Set total duration based on options.totalDuration or the last scene's end time
    if (options.totalDuration !== undefined) {
      this.setTotalDuration(options.totalDuration)
    } else if (timelineInfo.length > 0) {
      const lastScene = timelineInfo[timelineInfo.length - 1]
      this.setTotalDuration(lastScene.endTime)
    }

    // [TRANSITIONS] Setup scene transitions dynamically
    this.setupTransitions(timelineInfo, options)
  }

  setupTransitions(timelineInfo, options = {}) {
    const parentContainer = options.transitionContainer
    if (!parentContainer || parentContainer.destroyed) return

    // Clean up any existing transition container first
    this.clearTransitions()

    // Create a new transition container
    this.transitionContainer = new PIXI.Container()
    this.transitionContainer.label = 'engine-transitions-overlay'
    this.transitionContainer.eventMode = 'none'

    parentContainer.addChild(this.transitionContainer)

    this.transitionRanges = []

    // Build transitions for each scene boundary
    timelineInfo.forEach((sceneInfo, index) => {
      if (index === 0) return

      const transitionType = sceneInfo.transition || 'None'
      if (!transitionType || transitionType === 'None') return

      const T = sceneInfo.startTime // Boundary time in seconds

      if (transitionType === 'Fade') {
        const parseColor = (col) => {
          if (typeof col === 'string') {
            return parseInt(col.replace('#', '0x'), 16)
          }
          return col
        }

        const transitionColors = sceneInfo.transitionColors || ['#000000']
        const colors = transitionColors.map(parseColor)
        const fadeColor = colors[0] !== undefined ? colors[0] : 0x000000

        const fadeOverlay = new PIXI.Graphics()
        fadeOverlay.rect(0, 0, this.projectWidth, this.projectHeight)
        fadeOverlay.fill({ color: fadeColor })
        fadeOverlay.alpha = 0
        fadeOverlay.visible = false
        fadeOverlay.eventMode = 'none'
        this.transitionContainer.addChild(fadeOverlay)

        this.transitionRanges.push({
          type: 'Fade',
          startTime: T - 0.4,
          endTime: T + 0.4,
          boundaryTime: T
        })

        // Ensure it is completely hidden outside the transition window
        this.masterTimeline.set(fadeOverlay, { alpha: 0, visible: false }, T - 0.4)
        this.masterTimeline.set(fadeOverlay, { visible: true }, T - 0.4)

        // Add to GSAP masterTimeline using fromTo with immediateRender: false to avoid dynamic start capture issues
        this.masterTimeline.fromTo(fadeOverlay,
          { alpha: 0 },
          { alpha: 1, duration: 0.4, ease: 'power1.in', immediateRender: false },
          T - 0.4
        )
        this.masterTimeline.fromTo(fadeOverlay,
          { alpha: 1 },
          { alpha: 0, duration: 0.4, ease: 'power1.out', immediateRender: false },
          T
        )
        this.masterTimeline.set(fadeOverlay, { alpha: 0, visible: false }, T + 0.4)
      }
      else if (transitionType === 'LiquidShapes') {
        const liquidContainer = new PIXI.Container()
        liquidContainer.visible = false
        liquidContainer.eventMode = 'none'
        this.transitionContainer.addChild(liquidContainer)

        const parseColor = (col) => {
          if (typeof col === 'string') {
            return parseInt(col.replace('#', '0x'), 16)
          }
          return col
        }

        // [BUG 2 FIX] Default palette doubles as a per-index fallback so a stale
        // shorter transitionColors array (e.g. a 1-color Fade palette left behind
        // when switching transition type) can never produce an undefined color.
        const defaultPalette = ['#5b21b6', '#7c3aed', '#8b5cf6', '#a78bfa']
        const transitionColors = sceneInfo.transitionColors || defaultPalette
        const colors = transitionColors.map(parseColor)
        const direction = sceneInfo.transitionDirection || 'left'
        const width = this.projectWidth
        const height = this.projectHeight
        const rects = []

        this.transitionRanges.push({
          type: 'LiquidShapes',
          startTime: T - 0.5,
          endTime: T + 0.55,
          boundaryTime: T
        })

        for (let i = 0; i < 4; i++) {
          const rect = new PIXI.Graphics()
          rect.eventMode = 'none'
          rect.clear()
          rect.rect(0, 0, width, height)
          rect.fill({ color: colors[i] ?? parseColor(defaultPalette[i]) })

          let startProps = { x: width, y: 0 }
          let endProps = { x: -width, y: 0 }

          if (direction === 'right') {
            startProps = { x: -width, y: 0 }
            endProps = { x: width, y: 0 }
          } else if (direction === 'top') {
            startProps = { x: 0, y: height }
            endProps = { x: 0, y: -height }
          } else if (direction === 'bottom') {
            startProps = { x: 0, y: -height }
            endProps = { x: 0, y: height }
          }

          rect.x = startProps.x
          rect.y = startProps.y

          liquidContainer.addChild(rect)
          rects.push(rect)

          const startOffset = -0.5 + i * 0.05
          const endOffset = 0.35 + i * 0.05

          this.masterTimeline.fromTo(rect,
            startProps,
            { ...endProps, duration: 0.9, ease: 'power2.inOut', immediateRender: false },
            T + startOffset
          )

          this.masterTimeline.set(rect, startProps, T - 0.5)
          this.masterTimeline.set(rect, endProps, T + endOffset)
        }

        // Ensure the entire liquidContainer is invisible outside the transition window
        this.masterTimeline.set(liquidContainer, { visible: false }, T - 0.5)
        this.masterTimeline.set(liquidContainer, { visible: true }, T - 0.5)
        this.masterTimeline.set(liquidContainer, { visible: false }, T + 0.55)
      }
      else if (transitionType === 'BubbleWipe') {
        const liquidContainer = new PIXI.Container()
        liquidContainer.visible = false
        liquidContainer.eventMode = 'none'
        this.transitionContainer.addChild(liquidContainer)

        const parseColor = (col) => {
          if (typeof col === 'string') {
            return parseInt(col.replace('#', '0x'), 16)
          }
          return col
        }

        // [BUG 2 FIX] Default palette doubles as a per-index fallback (see LiquidShapes).
        const defaultPalette = ['#ec4899', '#f43f5e', '#d946ef', '#8b5cf6']
        const transitionColors = sceneInfo.transitionColors || defaultPalette
        const colors = transitionColors.map(parseColor)
        const direction = sceneInfo.transitionDirection || 'bottom-left'
        const width = this.projectWidth
        const height = this.projectHeight

        const maxRadius = Math.sqrt(width * width + height * height) * 0.8
        const circles = []

        this.transitionRanges.push({
          type: 'BubbleWipe',
          startTime: T - 0.7,
          endTime: T + 1.15,
          boundaryTime: T
        })

        for (let i = 0; i < 4; i++) {
          const circle = new PIXI.Graphics()
          circle.eventMode = 'none'
          circle.clear()
          circle.circle(0, 0, maxRadius)
          circle.fill({ color: colors[i] ?? parseColor(defaultPalette[i]) })

          let startX, startY, exitX, exitY, midX, midY

          if (direction === 'bottom-right') {
            startX = -maxRadius
            startY = -maxRadius
            exitX = width + maxRadius
            exitY = height + maxRadius
            midX = width * (0.3 + i * 0.08)
            midY = height * (0.6 + i * 0.08)
          } else if (direction === 'top-left') {
            startX = width + maxRadius
            startY = height + maxRadius
            exitX = -maxRadius
            exitY = -maxRadius
            midX = width * (0.7 - i * 0.08)
            midY = height * (0.4 - i * 0.08)
          } else if (direction === 'top-right') {
            startX = -maxRadius
            startY = height + maxRadius
            exitX = width + maxRadius
            exitY = -maxRadius
            midX = width * (0.3 + i * 0.08)
            midY = height * (0.4 - i * 0.08)
          } else {
            // bottom-left (default)
            startX = width + maxRadius
            startY = -maxRadius
            exitX = -maxRadius
            exitY = height + maxRadius
            midX = width * (0.7 - i * 0.08)
            midY = height * (0.6 + i * 0.08)
          }

          circle.x = startX
          circle.y = startY

          // Instrument for debugging transition state desync
          circle._debugInfo = { index: i, startX, startY, midX, midY, exitX, exitY }

          liquidContainer.addChild(circle)
          circles.push(circle)

          const startOffset = -0.65 + i * 0.12

          // [BUG 1 FIX] Single deterministic tween (start → mid → exit) via GSAP
          // keyframes instead of two chained fromTo tweens. The previous two-tween
          // structure left a fragile mid-point boundary between two
          // immediateRender:false tweens with no trailing anchor, which stranded a
          // circle at its mid position during backward/forced re-render (scrubbing).
          // This mirrors the robust single-tween pattern LiquidShapes uses. A
          // leading zero-duration keyframe anchors the start so the sweep is fully
          // self-contained (keyframes is the documented .to() form).
          this.masterTimeline.to(circle,
            {
              immediateRender: false,
              keyframes: [
                { x: startX, y: startY, duration: 0 },
                { x: midX, y: midY, duration: 0.6, ease: 'power2.in' },
                { x: exitX, y: exitY, duration: 0.6, ease: 'power2.out' },
              ],
            },
            T + startOffset
          )

          // Leading anchor: hold at the start corner before the sweep begins.
          this.masterTimeline.set(circle, { x: startX, y: startY }, T - 0.7)
          // [BUG 1 FIX] Trailing anchor: hold off-screen at the exit corner after
          // the sweep completes, exactly like LiquidShapes' end set(). Gives the
          // forced re-render in seek()/scrub() a well-defined post-exit endpoint.
          this.masterTimeline.set(circle, { x: exitX, y: exitY }, T + startOffset + 1.2)
        }

        // Keep the container visible throughout the entire extended window
        this.masterTimeline.set(liquidContainer, { visible: false }, T - 0.7)
        this.masterTimeline.set(liquidContainer, { visible: true }, T - 0.7)
        this.masterTimeline.set(liquidContainer, { visible: false }, T + 1.15)
      }
    })
  }

  clearTransitions() {
    if (this.transitionContainer) {
      try {
        if (!this.transitionContainer.destroyed && this.transitionContainer.parent) {
          this.transitionContainer.parent.removeChild(this.transitionContainer)
        }
        this.transitionContainer.destroy({ children: true })
      } catch (e) {
        console.warn('Error clearing transitions:', e)
      }
      this.transitionContainer = null
    }
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
    const videoToObject = new Map() // videoElement -> PIXI object (reverse lookup for texture updates)

    // Logic to calculate intent for a given object/data
    const processObject = (obj, id) => {
      if (!obj || obj.destroyed) {
        // [PERF] Cleanup stale objects discovered during sync pass
        if (id) this._videoObjects.delete(id)
        return
      }
      let videoElement = obj._isCardFrame
        ? (obj.showingFront !== false ? obj._frontVideoElement : obj._backVideoElement)
        : obj._videoElement

      if (!videoElement) {
        // [SYNC TARGET FIX] Search all possible sprite slots for an active video resource.
        // Direct video layers use _videoSprite, but card frames with video assets 
        // use _imageSprite (front) or _backSprite (back).
        const targetSprites = [obj._videoSprite, obj._imageSprite, obj._backSprite].filter(Boolean)
        for (const sprite of targetSprites) {
          const source = sprite.texture?.source
          if (source && source.resource instanceof HTMLVideoElement) {
            videoElement = source.resource
            if (obj._isCardFrame) {
              if (sprite === obj._imageSprite) {
                obj._frontVideoElement = videoElement
              } else if (sprite === obj._backSprite) {
                obj._backVideoElement = videoElement
              }
            } else {
              obj._videoElement = videoElement
            }
            break
          }
        }
      }

      if (!videoElement) return

      // [PERF] Lazily promote to _videoObjects index on first discovery
      if (id && !this._videoObjects.has(id) && this.registeredObjects.has(id)) {
        this._videoObjects.set(id, obj)
        this._allTrackedVideos.add(videoElement)
      }

      // [PERF] Build reverse lookup for O(1) access in texture update pass
      if (!videoToObject.has(videoElement)) {
        videoToObject.set(videoElement, obj)
      }

      const sceneId = obj._sceneId
      const range = this.sceneRanges.get(sceneId)

      if (range) {
        if (!mediaIntents.has(videoElement)) {
          mediaIntents.set(videoElement, { shouldPlay: false, targetTime: -1, inAnyRange: false, layerId: id, layerMuted: true })
        }

        const intent = mediaIntents.get(videoElement)
        const startTime = range.startTime
        const endTime = range.endTime
        const inRange = currentTime >= startTime - 0.001 && currentTime < endTime



        if (inRange) {
          const isShowingFront = obj.showingFront !== false
          const sourceStart = obj._isCardFrame
            ? (isShowingFront ? (obj._sourceStartTime || 0) : (obj._backSourceStartTime || 0))
            : (obj._sourceStartTime || 0)
          const sourceEnd = obj._isCardFrame
            ? (isShowingFront ? obj._sourceEndTime : obj._backSourceEndTime)
            : obj._sourceEndTime
          const localTime = currentTime - startTime
          const adjustedLocalTime = Math.max(0, localTime + sourceStart)

          // [FIX] Robust boundary check: Cap by physical video duration if available
          const videoDuration = videoElement.duration
          const effectiveEnd = (videoDuration && !isNaN(videoDuration) && videoDuration > 0)
            ? (sourceEnd !== undefined ? Math.min(sourceEnd, videoDuration) : videoDuration)
            : sourceEnd

          const finalTime = effectiveEnd !== undefined ? Math.min(adjustedLocalTime, effectiveEnd) : adjustedLocalTime
          const isAtEnd = effectiveEnd !== undefined && adjustedLocalTime >= effectiveEnd - 0.01

          if (this.isPlaying && !isAtEnd && !this._muteVideosForFastPreview) {
            intent.shouldPlay = true
          }
          intent.targetTime = finalTime
          intent.inAnyRange = true
          intent.layerId = id
          // [VIDEO-IN-FRAME FIX] Carry the in-range layer's muted preference.
          // This ensures that after a scene split, the muted state comes from
          // the segment that is actually playing, not from a stale reference.
          // [ROBUSTNESS] If multiple objects for the same element are in range, 
          // any UNMUTED preference takes precedence to prevent audio flickering.
          const objMuted = obj._isCardFrame
            ? (isShowingFront ? (obj._frontLayerMuted !== false) : (obj._backLayerMuted !== false))
            : (obj._layerMuted !== undefined ? obj._layerMuted : true)

          if (intent.layerMuted !== false) {
            intent.layerMuted = objMuted
          }
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

    // 1. Process video-bearing PIXI objects only (skips text, shape, image layers)
    const isActuallyPlaying = this.isPlaying && !this.isInternalPaused



    // Pass 1: Harvest intents from all registered video objects
    this._videoObjects.forEach((obj, id) => processObject(obj, id))

    // 2. Process background media (not on stage but in project)
    this.backgroundMedia.forEach((data, id) => {
      if (!this._videoObjects.has(id)) {
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
        this.masterTimeline.pause()
        this.isInternalPaused = true
      } else if (!needsBuffering && this.isInternalPaused) {
        // [FIX] Only auto-resume if NOT in a fast preview (tweenTo) transition.
        // Letting the timeline play during tweenTo causes it to keep moving 
        // after the transition finishes.
        if (!this._muteVideosForFastPreview) {
          this.masterTimeline.play()
        }
        this.isInternalPaused = false
      }
    } else {
      // Ensure internal pause is cleared if user manually stops playback
      this.isInternalPaused = false
    }

    // 3. Final Pass: Apply intents to DOM video elements
    mediaIntents.forEach((intent, videoElement) => {
      // [PERF FIX] Adaptive sync tolerance based on context:
      // - 0 for forced seeks (exact frame match for programmatic jumps)
      // - 150ms during continuous scrubbing (user is dragging fast, don't seek every pixel)
      // - 40ms for paused/static (perfect alignment after releasing scrub)
      // - 250ms for active playback (let the browser's video pipeline run freely)
      const threshold = force ? 0 : (isPaused ? (this._isScrubbing ? 0.15 : 0.04) : 0.25)
      const deviation = Math.abs(videoElement.currentTime - intent.targetTime)

      const isSeeking = videoElement.seeking

      // [REFINED SEEK GUARD]
      // Allow overriding a seek if:
      // 1. We are NOT seeking (standard deviation check)
      // 2. OR we ARE seeking, but the targetTime has moved significantly (>0.2s)
      //    since the last time we updated this videoElement. This prevents "decoder lockout"
      //    where a slow decoder stays stale while the playhead has moved on.
      const lastTarget = videoElement._lastMotionTargetTime || -1
      // [PERF] During scrubbing, allow larger movement before overriding a pending seek.
      // This prevents seek storms when the user drags fast across the timeline.
      const overrideThreshold = this._isScrubbing ? 0.5 : 0.2
      const targetMovedSignificantly = Math.abs(intent.targetTime - lastTarget) > overrideThreshold

      // [PERF FIX] During active playback, don't re-seek videos that are already
      // playing and roughly in sync. Let the browser's hardware decoder run freely.
      // Only seek when deviation is large enough to be noticeable.
      const isAlreadyPlaying = !videoElement.paused && intent.shouldPlay
      const needsSeek = !isAlreadyPlaying || deviation > threshold

      const isFastPreview = this._muteVideosForFastPreview
      const skipSeekForFastPreview = isFastPreview && !force
      if (intent.targetTime !== -1 && needsSeek && !skipSeekForFastPreview && (force || (deviation > threshold && (!isSeeking || targetMovedSignificantly)))) {

        videoElement.currentTime = intent.targetTime
        videoElement._lastMotionTargetTime = intent.targetTime // Track last request
      }

      // [FAST PREVIEW] Mute all videos during tweenTo so preview is silent
      if (this._muteVideosForFastPreview) {
        videoElement.muted = true
      } else if (intent.inAnyRange) {
        // [SYNC] Resume if in range
        if (intent.shouldPlay && videoElement.paused && !videoElement._playPending) {
          videoElement._playPending = true
          const playPromise = videoElement.play()
          if (playPromise !== undefined) {
            playPromise.then(() => {
              videoElement._playPending = false
            }).catch((err) => {
              videoElement._playPending = false
              // [AUTOPLAY POLICY FIX] If the browser blocks unmuted playback,
              // it forcefully pauses the video. We must fallback to muted playback
              // to prevent the engine from infinitely trying to play it and causing a stutter loop.
              if (err.name === 'NotAllowedError') {
                console.warn(`[MotionEngine] Autoplay blocked for ${intent.layerId}. Falling back to muted.`)
                videoElement.muted = true
                videoElement.play().catch(() => { }) // Try again muted
              }
            })
          } else {
            videoElement._playPending = false
          }
        }
        const shouldMute = intent.layerMuted !== false
        if (videoElement.muted !== shouldMute) {
          videoElement.muted = shouldMute
        }
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

      // [A/V SYNC FIX] Force the PIXI VideoSource to update its WebGL texture.
      // When a video is PAUSED and we've just seeked, PIXI won't auto-update the
      // texture, so we must force it. During active playback, PIXI's VideoResource
      // already auto-updates the texture each frame, so we skip the manual call
      // to avoid redundant GPU uploads (especially costly with multiple videos).
      //
      // [PERF] Only force-update for paused/seeked videos, not actively playing ones.
      const justSeeked = force || (deviation > threshold && needsSeek)
      const videoIsPlaying = !videoElement.paused && intent.shouldPlay
      if (justSeeked || (!videoIsPlaying && (intent.shouldPlay || (!isPaused && deviation > 0)))) {
        const currentVideoTime = videoElement.currentTime
        const lastUpdated = videoElement._lastTextureUpdateTime
        if (force || currentVideoTime !== lastUpdated) {
          const obj = videoToObject.get(videoElement)
          if (obj) {
            const sprite = obj._videoSprite || (obj.showingFront !== false ? obj._imageSprite : obj._backSprite)
            if (sprite && sprite.texture && sprite.texture.source) {
              try {
                sprite.texture.source.update()
                videoElement._lastTextureUpdateTime = currentVideoTime
              } catch (securityError) {
                // [SECURITY GUARD] Handle CORS / Tainted Canvas issues without crashing the app.
                // We only log this once per unique error to avoid console flooding.
                if (!videoElement._hasReportedSecurityError) {
                  console.warn(`⚠️ [MotionEngine] WebGL Security Policy blocked texture update for video: ${videoElement.src}. Ensure the server permits CORS.`, securityError)
                  videoElement._hasReportedSecurityError = true
                }
              }
            }
          }
        }
      }
    })

    // Orphan cleanup: pause any playing video elements NOT tracked by mediaIntents.
    // Run at most every 3 seconds to avoid main-thread stutter.
    // [PERF] Uses tracked set instead of document.querySelectorAll('video') DOM query.
    const now = Date.now()
    if (!this._lastCleanupTime || now - this._lastCleanupTime > 3000) {
      this._lastCleanupTime = now
      this._allTrackedVideos.forEach(v => {
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

    // [COLOR SYNC FIX] Remove animated state handlers if this layer no longer has motion
    const obj = this.registeredObjects.get(layerId)
    if (obj) {
      delete obj._animatedColorState
      delete obj._applyAnimatedColor
      delete obj._lastAppliedColor

      // [TILT] Only clear the animation hook. The PerspectiveMesh represents the
      // base tilt state (owned by applyTransformInline via Redux) and must survive
      // engine rebuilds. Mesh lifecycle is handled by applyTilt/removeTilt when
      // Redux tiltX/tiltY transitions to/from zero.
      delete obj._applyAnimatedTilt
      delete obj._tiltProxy
    }
  }

  /**
   * Clear every animation currently loaded
   */
  unloadAllMotions() {
    // [FIX] Pause all tracked video elements BEFORE clearing to prevent orphan playback.
    // Without this, videos continue playing through the engine rebuild triggered by scene cuts.
    this.registeredObjects.forEach((obj) => {
      let videoElement = obj._isCardFrame
        ? (obj.showingFront !== false ? obj._frontVideoElement : obj._backVideoElement)
        : obj._videoElement

      if (!videoElement) {
        const targetSprites = [obj._videoSprite, obj._imageSprite, obj._backSprite].filter(Boolean)
        for (const sprite of targetSprites) {
          const source = sprite.texture?.source
          if (source && source.resource instanceof HTMLVideoElement) {
            videoElement = source.resource
            break
          }
        }
      }
      if (videoElement && !videoElement.paused) {
        videoElement.pause()
        videoElement._isPlayPending = false
      }
    })
    // Clear flip metadata from registered objects before clearing timelines
    this.registeredObjects.forEach((obj) => {
      if (obj._flipActions) delete obj._flipActions

      // [COLOR SYNC FIX] Clear persistent animated state handlers on full engine restart
      delete obj._animatedColorState
      delete obj._applyAnimatedColor
      delete obj._lastAppliedColor
      delete obj._animatedFillColor

      // [TILT] Only clear the animation hook — do NOT destroy the PerspectiveMesh.
      // The mesh represents Redux base state and applyTransformInline (called by
      // prepareEngine right after unload) will re-sync / tear it down if base tilt
      // has become zero. Destroying here caused visible tilt loss on every slider
      // update because layersBaseStateHash includes tiltX/tiltY.
      delete obj._applyAnimatedTilt
      delete obj._tiltProxy

      // [BLUR FIX v2] Preserve the blur filter through engine rebuilds.
      // The filter is owned by syncBlurFilter (static path) and _applyAnimatedBlur
      // (animated path).  Clearing the filter entirely creates a visual gap where
      // blur=0 is briefly visible before applyTransformInline re-syncs it — this
      // is the root cause of the "blur resets after layer interaction" bug.
      // Only remove the animation hook so the reloaded GSAP timeline can re-attach
      // a fresh _applyAnimatedBlur; the filter itself stays at its current strength.
      obj._blurLogicalStrength = 0
      delete obj._applyAnimatedBlur
    })
    this.masterTimeline.clear()
    this.activeTimelines.forEach(tl => tl.destroy())
    this.activeTimelines.clear()
    this.isPlaying = false
    this.clearTransitions()
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
      // Reset all individual timelines first
      this.activeTimelines.forEach((tl) => {
        if (tl.instance) {
          tl.instance.progress(0)
        }
      })
      // Restart the master timeline from the beginning
      this.masterTimeline.restart()
    } else {
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
    // [FLOW TEXT FIX] Ensure layout is properly restored when returning to time 0
    this.refreshFlows()
  }

  /**
   * Seek to a specific time (seconds).
   * Full seek: forces exact video sync, text reflow, and flip state evaluation.
   * Use for programmatic seeks (scene clicks, step navigation, etc).
   */
  seek(time, options = {}) {


    // NOTE: `options.force` is now implicit — seek() always forces a re-render
    // (see the [BASE STATE FIX] note below). The param is kept for call-site compat.
    this._muteVideosForFastPreview = false
    this._lastInteractionTime = Date.now()
    this._isScrubbing = false

    // [FIX] Kill any active scrubbing tweens from tweenTo() to prevent fighting
    gsap.killTweensOf(this.masterTimeline, { time: true })

    // [SEEK FIX] Ensure all child timelines are unpaused before seeking
    // This is critical for proper scrubbing - child timelines must be unpaused to scrub with parent
    // Without this, some steps (especially middle steps like step-2) might not execute during scrubbing
    this.activeTimelines.forEach(tl => {
      if (tl.instance) tl.instance.paused(false)
    })

    // [PRESET BASE FIX] Use seek(time, false) + pause() instead of pause(time).
    // GSAP's pause(atTime) can be a no-op when the playhead is already at atTime
    // (e.g., t=0 after engine rebuild). seek(time, false) always repositions and
    // applies all tween states — including the .set() baseline tweens that establish
    // the preset's initial visual state (e.g., alpha=0 for Fade In presets).
    this.masterTimeline.seek(time, false)

    // [BASE STATE FIX] ALWAYS force a full re-render at the seeked time.
    // GSAP skips re-rendering a tween whose local time/progress is unchanged — in
    // particular a 0-duration `.set()` stays at progress 1 for every t past its
    // position, so GSAP never re-applies it. That breaks several cases:
    //   1. Scrubbing BACKWARD into the interval before a layer's first tween: the
    //      baseline .set() (layer base x/y/rotation/scale/alpha/crop/blur/...) is not
    //      re-applied and `fromTo` tweens (immediateRender:false) don't write before
    //      their start, so the property sticks at the value the forward tween last
    //      wrote (e.g. Step 1's end position). Same for transition graphics whose
    //      visibility/position is anchored by `set(..., 0)` (e.g. BubbleWipe circles).
    //   2. Re-seeking after a direct layer edit clobbered a PIXI prop, or saving an
    //      edited step whose playhead is already parked at the step start (GSAP's
    //      seek() is a no-op when `time` equals the current time).
    // Forcing the render (suppressEvents=true so we don't double-fire callbacks)
    // re-applies every tween/.set() at the current time, making GSAP authoritative
    // for every property and every transition uniformly. Export already gets this
    // for free because it seeks deterministically frame-by-frame.
    this.masterTimeline.render(this.masterTimeline.time(), true, true)

    this.masterTimeline.pause()
    this.isPlaying = false

    // Apply GSAP-controlled state (color, blur, flip) to PIXI objects after seek.
    // Some properties need an explicit visual update call because onUpdate callbacks
    // may not reliably fire during masterTimeline.seek() in nested timeline configurations.
    this.registeredObjects.forEach((obj) => {
      // [FIX] Safety check: skip destroyed objects that may still be in the map
      // (e.g. if unregisterLayerObject was delayed or missed)
      if (obj.destroyed) return

      if (obj._applyAnimatedColor) obj._applyAnimatedColor()
      if (obj._applyAnimatedBlur) obj._applyAnimatedBlur()
      if (obj._applyAnimatedCornerRadius) obj._applyAnimatedCornerRadius()
      // [TILT] Mirror the tilt proxy that GSAP advances onto the degree
      // fields BEFORE _applyAnimatedTilt reads them. masterTimeline.pause(t)
      // updates the tween targets but does NOT reliably fire onUpdate for
      // every nested set()/fromTo combo, so _tiltXDeg/Y can otherwise lag
      // behind the actual scrubbed/seeked playhead, leaving the mesh stuck
      // at the previous tilt (the "snaps back to initial" / "scrub shows
      // wrong tilt" bugs).
      if (obj._tiltProxy) {
        if (typeof obj._tiltProxy.tiltX === 'number') obj._tiltXDeg = obj._tiltProxy.tiltX
        if (typeof obj._tiltProxy.tiltY === 'number') obj._tiltYDeg = obj._tiltProxy.tiltY
      }
      if (obj._applyAnimatedTilt) obj._applyAnimatedTilt()
      // [TEXT TILT SEEK FIX] For text layers, the tilt may be animated via
      // a motion step action (which sets _tiltProxy) OR via base layer property
      // (Redux tiltX/tiltY) which may not have a GSAP _tiltProxy.  Ensure
      // syncTiltedDisplay is called for ANY tilted layer that has a mesh,
      // regardless of whether _tiltProxy exists, so the mesh corners + RTT
      // reflect the correct tilt state for the current playhead position.
      if (obj._tiltMesh && !obj._tiltMesh.destroyed) {
        syncTiltedDisplay(obj)
      }
    })

    // [FIX] Evaluate flip visibility deterministically based on time position.
    // GSAP nested timeline onUpdate callbacks don't reliably fire during pause(time),
    // so we explicitly resolve which side each card frame should show.
    this._evaluateFlipStates(time)

    // Force immediate media sync during seek
    this.syncMedia(time, true)

    // [TILT VIDEO SEEK] Re-run the tilted-layer sync now that syncMedia has
    // advanced every video element's currentTime and forced its GPU texture
    // to refresh.  Without this, the earlier syncTiltedDisplay pass (which
    // fires from masterTimeline.pause(time) BEFORE syncMedia touched the
    // videos) captured the pre-seek frame into each tilted layer's RTT — so
    // scrubbing a tilted video froze the mesh on the previous frame even
    // though the underlying <video> had jumped to the new time.  The second
    // pass, running AFTER syncMedia, re-reads the now-updated currentTime,
    // flags the texture dirty, and recaptures with the fresh frame.
    // (requestVideoFrameCallback in perspectiveTilt.js also catches this,
    // but only on browsers that support it — this call covers every browser
    // and also handles the sub-16ms window before rVFC fires.)
    // [PERF] Non-forced sync — mesh corners are re-applied (CPU-only) but
    // GPU RTT recaptures are skipped per the per-object throttle gate in
    // syncTiltMesh.  For video layers, requestVideoFrameCallback marks the
    // texture dirty after a new video frame decodes, which triggers the
    // recapture on the next natural tick — we don't need to force it here.
    this._syncTiltedLayers(true)

    // [FLOW TEXT FIX] Ensure word wrapping calculates the latest layout synchronously
    this.refreshFlows()

    this._handleUpdate()
    this._logScrubState(time)
  }

  /**
   * Lightweight seek optimized for continuous playhead scrubbing.
   * [PERF] Skips expensive operations that are unnecessary during rapid mouse drags:
   * - Uses relaxed video sync (force=false) instead of force=true
   * - Throttles refreshFlows to every 150ms instead of every call
   * - Throttles flip state evaluation to every 100ms
   * - Applies animated state only to video-bearing objects + backgrounds
   * This makes scrubbing smooth with multiple video layers on mobile/low-end.
   */
  scrub(time) {

    this._lastInteractionTime = Date.now()
    this._isScrubbing = true

    // Kill active tweenTo transitions
    gsap.killTweensOf(this.masterTimeline, { time: true })

    // Ensure child timelines can scrub with parent
    this.activeTimelines.forEach(tl => {
      if (tl.instance && tl.instance.paused()) tl.instance.paused(false)
    })

    this.masterTimeline.pause(time)
    // [BASE STATE FIX] Force a full re-render so zero-duration baseline .set() tweens
    // (layer base transforms + transition graphics visibility/position) re-apply when
    // scrubbing backward into a pre-tween interval. pause(time) alone leaves unchanged
    // .set()s un-rendered (GSAP optimization), stranding props at the last forward
    // value. See seek() for the full rationale. suppressEvents=true avoids double ticks.
    this.masterTimeline.render(time, true, true)
    this.isPlaying = false

    // [PERF] Apply animated state (color/blur/corner) — needed for visual accuracy.
    // But skip flip evaluation on every scrub (throttled below).
    this.registeredObjects.forEach((obj) => {
      if (obj.destroyed) return
      if (obj._applyAnimatedColor) obj._applyAnimatedColor()
      if (obj._applyAnimatedBlur) obj._applyAnimatedBlur()
      if (obj._applyAnimatedCornerRadius) obj._applyAnimatedCornerRadius()
      // [TILT] Mirror proxy → degrees so the mesh follows the scrubbed
      // playhead (see seek() for the same reasoning).
      if (obj._tiltProxy) {
        if (typeof obj._tiltProxy.tiltX === 'number') obj._tiltXDeg = obj._tiltProxy.tiltX
        if (typeof obj._tiltProxy.tiltY === 'number') obj._tiltYDeg = obj._tiltProxy.tiltY
      }
      if (obj._applyAnimatedTilt) obj._applyAnimatedTilt()
      // [TEXT TILT SEEK FIX] Apply the same fix as seek() - ensure any tilted
      // layer's mesh corners reflect the correct tilt for the scrubbed position.
      if (obj._tiltMesh && !obj._tiltMesh.destroyed) {
        syncTiltedDisplay(obj)
      }
    })

    // [PERF] Throttle flip state evaluation during scrubbing (~100ms)
    const now = performance.now()
    if (!this._lastFlipEvalTime || now - this._lastFlipEvalTime > 100) {
      this._evaluateFlipStates(time)
      this._lastFlipEvalTime = now
    }

    // [PERF] Use non-forced sync: allows 40ms tolerance for paused videos,
    // avoiding redundant seeks that stall the video decoder.
    this.syncMedia(time, false)

    // [TILT VIDEO SCRUB] See seek() for a full explanation.  The tilted
    // layer RTT must be refreshed AFTER syncMedia has moved each video's
    // currentTime and forced a texture upload, otherwise the mesh shows the
    // pre-scrub frame.  This is the cross-browser complement to the
    // requestVideoFrameCallback hook in perspectiveTilt.js.
    // [PERF] Non-forced sync — mesh corners are re-applied (CPU-only).
    // GPU RTT recaptures happen only when the video frame callback marks
    // the texture dirty (after a new frame decodes), not on every scrub event.
    this._syncTiltedLayers(true)

    // [PERF] Throttle text reflow during scrubbing (~150ms)
    if (!this._lastScrubFlowRefresh || now - this._lastScrubFlowRefresh > 150) {
      this.refreshFlows()
      this._lastScrubFlowRefresh = now
    }

    this._handleUpdate()
    this._logScrubState(time)
  }

  /**
   * Evaluate flip visibility for all card frames at a given time.
   * Called after seek/pause to ensure correct side is displayed,
   * since GSAP nested timeline callbacks don't reliably fire during pause(time).
   */
  _evaluateFlipStates(time) {
    this.registeredObjects.forEach((obj) => {
      if (obj.destroyed || !obj._flipActions?.length) return
      if (!obj._imageSprite || !obj._backSprite) return

      // Walk through flip actions in chronological order to determine current side
      let showingFront = obj._flipActions[0].wasShowingFront
      for (const flip of obj._flipActions) {
        const flipMidpoint = flip.time + (flip.duration / 2)
        if (time >= flipMidpoint) {
          // Past this flip's midpoint — the swap has happened
          showingFront = !flip.wasShowingFront
        } else {
          // Before or during first half — still on the pre-flip side
          showingFront = flip.wasShowingFront
          break
        }
      }

      // Sync the backing field so external consumers (drop handlers, etc.)
      // can read the current visual flip state without re-evaluating flip actions.
      obj._showingFront = showingFront

      obj._imageSprite.visible = showingFront && obj._frameHasAsset
      obj._backSprite.visible = !showingFront && obj._frameHasBackAsset
      if (obj._framePlaceholder && !obj._isDropTarget) {
        const activeHasAsset = showingFront
          ? obj._frameHasAsset
          : obj._frameHasBackAsset
        obj._framePlaceholder.visible = !activeHasAsset
        // Update placeholder label ("Front"/"Back") for empty card frames during seek/scrub
        if (!activeHasAsset && obj._frameLabel) {
          const customLabel = (obj._frameData?.label || '').trim()
          if (!customLabel) {
            obj._frameLabel.text = showingFront ? 'Front' : 'Back'
          }
        }
      }
    })
  }

  _logScrubState(time) {
    // 1. Step boundary checks
    if (this.stepRanges && this.stepRanges.length > 0) {
      const activeStep = this.stepRanges.find(r => time >= r.startTime && time <= r.endTime)
      const activeStepId = activeStep ? activeStep.stepId : null

      if (activeStepId !== this._lastStepId) {
        if (activeStepId) {

          const layersInfo = []
          this.registeredObjects.forEach((obj, id) => {
            if (obj && !obj.destroyed) {
              const reportedAlpha = obj._tiltHidden && typeof obj._intendedAlpha === 'number'
                ? obj._intendedAlpha
                : obj.alpha
              layersInfo.push(`  Layer ID: ${id} -> x: ${obj.x.toFixed(2)}, y: ${obj.y.toFixed(2)}, scaleX: ${obj.scale?.x.toFixed(2)}, scaleY: ${obj.scale?.y.toFixed(2)}, alpha: ${reportedAlpha.toFixed(2)}${obj._tiltHidden ? ' (tilted)' : ''}`)
            }
          })
        }
        this._lastStepId = activeStepId
      }
    }

    // 2. Transition boundary checks
    if (this.transitionRanges && this.transitionRanges.length > 0) {
      const activeTransition = this.transitionRanges.find(r => time >= r.startTime && time <= r.endTime)
      const activeTransitionType = activeTransition ? activeTransition.type : null

      if (activeTransitionType !== this._lastTransitionState) {
        const printTransitionContainerChildren = (container, depth = 0) => {
          if (!container) return []
          const lines = []
          const indent = '  '.repeat(depth)
          const label = container.label || container.constructor.name || 'PIXI Object'

          let debugStr = ''
          if (container._debugInfo) {
            const di = container._debugInfo
            debugStr = ` [Bubble ${di.index}: start(${di.startX.toFixed(0)}, ${di.startY.toFixed(0)}) -> mid(${di.midX.toFixed(0)}, ${di.midY.toFixed(0)}) -> exit(${di.exitX.toFixed(0)}, ${di.exitY.toFixed(0)})]`
          }

          lines.push(`${indent}${label} (visible: ${container.visible}, alpha: ${container.alpha.toFixed(2)}, x: ${container.x.toFixed(2)}, y: ${container.y.toFixed(2)})${debugStr}`)
          if (container.children && container.children.length > 0) {
            container.children.forEach(child => {
              lines.push(...printTransitionContainerChildren(child, depth + 1))
            })
          }
          return lines
        }

        if (activeTransitionType) {
          if (this.transitionContainer) {
            const childLogs = printTransitionContainerChildren(this.transitionContainer)
          }
        } else {
          if (this.transitionContainer) {
            const childLogs = printTransitionContainerChildren(this.transitionContainer)
          }
        }
        this._lastTransitionState = activeTransitionType
      }
    }
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

    if (Math.abs(start - targetTime) < 0.001) {
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

    // Use native GSAP timeline.tweenTo() for more robust scrubbing
    const tween = this.masterTimeline.tweenTo(targetTime, {
      duration,
      ease,
      onStart: () => {
        this._lastInteractionTime = Date.now()
      },
      onUpdate: () => {
        this._lastInteractionTime = Date.now()
        // [FAST-PREVIEW COLOR FLICKER FIX] Apply GSAP-managed visual state each frame,
        // exactly like seek()/scrub(). The ColorChangeAction (and blur/corner/tilt)
        // write to a proxy (_animatedColorState / _blurFilter / _tiltProxy) and rely on
        // a per-frame apply; their nested-timeline onUpdate callbacks don't fire
        // reliably while the master playhead is tweened by tweenTo(), so without this
        // the color flickers between the stale proxy value and the target during the
        // post-save fast preview. This makes fast-preview match normal scrubbing.
        this.registeredObjects.forEach((obj) => {
          if (obj.destroyed) return
          if (obj._applyAnimatedColor) obj._applyAnimatedColor()
          if (obj._applyAnimatedBlur) obj._applyAnimatedBlur()
          if (obj._applyAnimatedCornerRadius) obj._applyAnimatedCornerRadius()
          // Mirror the tilt proxy GSAP advances onto the degree fields before apply.
          if (obj._tiltProxy) {
            if (typeof obj._tiltProxy.tiltX === 'number') obj._tiltXDeg = obj._tiltProxy.tiltX
            if (typeof obj._tiltProxy.tiltY === 'number') obj._tiltYDeg = obj._tiltProxy.tiltY
          }
          if (obj._applyAnimatedTilt) obj._applyAnimatedTilt()
        })
        // Evaluate flip visibility during fast preview
        this._evaluateFlipStates(this.masterTimeline.time())
        // [FLOW TEXT FIX] Ensure continuous word wrap recalculation during fast-preview playback
        this.refreshFlows()
        // Internal tick for UI/React sync
        this._handleUpdate()
      },
      onComplete: () => {
        this._muteVideosForFastPreview = false
        this.isPlaying = false
        // [FIX] Force sync media to pause videos when tweenTo completes (isPlaying is now false)
        this.syncMedia(targetTime, true)
        // Final flip evaluation at target time
        this._evaluateFlipStates(targetTime)
        // [FLOW TEXT FIX] Ensure final rest layout state is accurate
        this.refreshFlows()
        if (onComplete) onComplete()
        this._handleAllComplete()
      }
    })

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
  /** Returns true when playing OR within 200ms of a seek/scrub so canvas layer sync skips overwriting GSAP-driven state (e.g. blur). */
  getIsPlaying() {
    const graceMs = 200
    const recentlySeeked = this._lastInteractionTime > 0 && (Date.now() - this._lastInteractionTime < graceMs)
    return this.isPlaying || recentlySeeked
  }

  // --- COMPATIBILITY SHIMS ---
  get timelines() { return this.activeTimelines }
  get layerObjects() { return this.registeredObjects }
  onLayerComplete() { }
  onLayerUpdate() { }
}

