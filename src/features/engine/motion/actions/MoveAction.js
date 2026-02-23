/**
 * MoveAction - Handles move animations for motion steps
 * Applies GSAP animations to PIXI DisplayObjects for x/y position changes
 */

import { gsap } from 'gsap'
import { MotionPathPlugin } from 'gsap/MotionPathPlugin'
import { CustomEase } from "gsap/CustomEase";

// Register the plugin
gsap.registerPlugin(MotionPathPlugin)
gsap.registerPlugin(CustomEase);

export class MoveAction {
  constructor() {
    this.type = 'move'
  }

  /**
   * Execute a move action on a PIXI DisplayObject
   * @param {PIXI.DisplayObject} pixiObject - The PIXI object to animate
   * @param {Object} actionData - Motion action data from Redux
   * @param {Object} options - Animation options
   * @returns {Promise} - Resolves when animation completes
   */
  execute(pixiObject, actionData, options = {}) {
    const { values = {} } = actionData
    const duration = values.duration || 2000
    CustomEase.create("myEase", "0.5,0,0,1");

    const easing = "myEase"

    // Pure relative system: target = start + offset
    const startX = options.startState?.x ?? pixiObject.x
    const startY = options.startState?.y ?? pixiObject.y

    const dx = values.dx ?? 0
    const dy = values.dy ?? 0

    const targetX = startX + dx
    const targetY = startY + dy

    const animationDuration = (duration) / 1000 // Convert ms to seconds

    // Resolve easing function
    const gsapEasing = easing || 'none'

    // Build GSAP vars object dynamically to only include changed properties.
    const gsapVars = {
      duration: animationDuration,
      ease: gsapEasing,
      immediateRender: false,
      overwrite: 'auto',
      ...options.gsapOptions
    }

    const fromVars = {
      x: startX,
      y: startY,
      immediateRender: false
    }

    // Check for curved path
    if (values.controlPoints && Array.isArray(values.controlPoints) && values.controlPoints.length > 0) {
      // [FIX] RELATIVE COORDINATES: controlPoints are now stored as relative offsets
      // from the startState. We must map them back to world space for GSAP.
      const worldControlPoints = values.controlPoints.map(cp => ({
        x: startX + cp.x,
        y: startY + cp.y
      }))

      // Create a full path including current position and target position
      // This ensures smooth entry and exit from the curve handles
      const path = [
        { x: startX, y: startY },
        ...worldControlPoints,
        { x: targetX, y: targetY }
      ]

      gsapVars.motionPath = {
        path: path,
        autoRotate: false,
        useRadians: true
      }
    } else {
      gsapVars.x = targetX
      gsapVars.y = targetY
    }

    return gsap.fromTo(pixiObject, fromVars, gsapVars)
  }
}
