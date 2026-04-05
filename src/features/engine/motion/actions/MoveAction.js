/**
 * MoveAction - Handles move animations for motion steps
 * Applies GSAP animations to PIXI DisplayObjects for x/y position changes
 */

import { gsap } from 'gsap'
import { MotionPathPlugin } from 'gsap/MotionPathPlugin'
import { CustomEase } from "gsap/CustomEase";
import { getCatmullRomPath } from '../../../editor/utils/curveUtils'

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
      overwrite: false,
      ...options.gsapOptions
    }

    const fromVars = {
      immediateRender: false
    }

    // [FIX] Only explicitly animate x and y if a delta shift is provided to prevent overwriting other Parallel actions
    if (values.dx !== undefined && values.dx !== 0) {
      fromVars.x = startX
      gsapVars.x = targetX
    }
    if (values.dy !== undefined && values.dy !== 0) {
      fromVars.y = startY
      gsapVars.y = targetY
    }

    // Check for curved path
    if (values.controlPoints && Array.isArray(values.controlPoints) && values.controlPoints.length > 0) {
      // RELATIVE COORDINATES: controlPoints are stored as relative offsets
      // Map them back to world space for GSAP.
      const worldControlPoints = values.controlPoints.map(cp => ({
        x: startX + cp.x,
        y: startY + cp.y
      }))

      // [SMOOTH PATHING]: Generate a high-resolution Centripetal Catmull-Rom spline.
      // This bypasses GSAP's default 'thru' heuristic and ensures professional-grade 
      // motion quality that is consistent across all layers.
      const fullPoints = [
        { x: startX, y: startY },
        ...worldControlPoints,
        { x: targetX, y: targetY }
      ]
      
      const smoothPath = getCatmullRomPath(fullPoints, 20) // Use 20 segments per loop for high precision

      gsapVars.motionPath = {
        path: smoothPath,
        autoRotate: false,
        useRadians: true
      }
      
      // CRITICAL: When using motionPath, we MUST NOT tween x/y directly in gsapVars
      // The motionPath plugin takes full control over x and y.
      delete gsapVars.x
      delete gsapVars.y

      // Ensure start position is in fromVars so motionPath builds the curve correctly
      fromVars.x = startX
      fromVars.y = startY
    }

    
    // [DEBUG]

    return gsap.fromTo(pixiObject, fromVars, gsapVars)
  }
}
