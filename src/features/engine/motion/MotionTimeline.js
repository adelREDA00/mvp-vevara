import { gsap } from 'gsap'

/**
 * MotionTimeline is a wrapper around a GSAP Timeline.
 * It makes it easier to manage animations for a single layer, 
 * including playing, pausing, and cleaning up.
 */
export class MotionTimeline {
  constructor(layerId) {
    this.layerId = layerId
    this.instance = null // This will hold the GSAP timeline

    // Status flags
    this.isActive = false
    this.isPaused = false

    // Time information
    this.currentTime = 0
    this.totalDuration = 0

    // List of functions to call when the animation finishes
    this.completeCallbacks = []
  }

  /**
   * Initialize the GSAP timeline
   */
  create(options = {}) {
    // If there's already an animation active, kill it first
    this.destroy()

    this.instance = gsap.timeline({
      paused: true, // Start paused so we can control when it plays
      onComplete: () => {
        this.isActive = false
        this.isPaused = false
        this._runCompleteCallbacks()
      },
      onUpdate: () => {
        // Keep track of the current time as the animation plays
        this.currentTime = this.instance.time()
      },
      ...options,
    })

    this.totalDuration = this.instance.duration()
    return this.instance
  }

  /**
   * Add a movement or action to this timeline
   * @param {Function} animationFn - A function that gets the GSAP timeline as its first argument
   */
  add(animationFn) {
    if (!this.instance) {
      console.error('MotionTimeline: You must call create() before adding animations.')
      return this
    }

    // Execute the function to inject the tween into the GSAP timeline
    animationFn(this.instance)

    // Update the total duration
    this.totalDuration = this.instance.duration()
    return this
  }

  /**
   * Start or Resume the animation
   */
  play() {
    if (!this.instance) return

    if (this.isPaused) {
      this.instance.resume()
    } else {
      this.instance.restart()
    }

    this.isActive = true
    this.isPaused = false
  }

  /**
   * Pause the animation exactly where it is
   */
  pause() {
    if (!this.instance) return

    this.instance.pause()
    this.isActive = false
    this.isPaused = true
  }

  /**
   * Stop the animation and jump back to the start
   */
  stop() {
    if (!this.instance) return

    this.instance.pause(0)
    this.isActive = false
    this.isPaused = false
    this.currentTime = 0
  }

  /**
   * Jump to a specific second in the animation
   */
  seek(seconds) {
    if (!this.instance) return

    this.instance.seek(seconds)
    this.currentTime = seconds
  }

  /**
   * Change how fast the animation plays (e.g., 2 for double speed)
   */
  setSpeed(rate) {
    if (!this.instance) return
    this.instance.timeScale(rate)
  }

  /**
   * Get the current percentage of completion (0 to 1)
   */
  getPercentage() {
    return this.instance ? this.instance.progress() : 0
  }

  /**
   * Register a function to be called when the animation finishes
   */
  onComplete(callback) {
    if (typeof callback === 'function') {
      this.completeCallbacks.push(callback)
    }
  }

  /**
   * Remove all animations and callbacks to free up memory
   */
  destroy() {
    if (this.instance) {
      this.instance.kill()
      this.instance = null
    }

    this.isActive = false
    this.isPaused = false
    this.currentTime = 0
    this.totalDuration = 0
    this.completeCallbacks = []
  }

  /**
   * Helper to run all registered "finished" functions
   * @private
   */
  _runCompleteCallbacks() {
    this.completeCallbacks.forEach(callback => {
      try {
        callback(this.layerId)
      } catch (err) {
        console.error('MotionTimeline: Callback error', err)
      }
    })
  }

  // --- COMPATIBILITY GETTERS ---
  // These help keep the MotionEngine working without too many changes
  getIsPlaying() { return this.isActive }
  getIsPaused() { return this.isPaused }
  getDuration() { return this.totalDuration }
  getProgress() { return this.getPercentage() }
  onUpdate() { /* Currently unused in simplified version */ }
}
