/**
 * Data Model Definitions for Vevara Editor
 * 
 * These are the schemas/types for all data structures in the app
 */

/**
 * Scene - Represents a composition/timeline
 * @typedef {Object} Scene
 * @property {string} id - Unique identifier
 * @property {string} name - Display name (e.g., "Scene 1")
 * @property {number} duration - Duration in seconds
 * @property {string} transition - Transition type ('None', 'Crossfade', 'Slide', etc.)
 * @property {string[]} layers - Array of layer IDs in this scene
 */

/**
 * Layer - A single element on the canvas (text, shape, image, video, etc.)
 * @typedef {Object} Layer
 * @property {string} id - Unique identifier
 * @property {string} sceneId - Parent scene ID
 * @property {string} type - Layer type: 'text' | 'shape' | 'image' | 'video' | 'group' | 'camera'
 * @property {string} name - Display name
 * @property {boolean} visible - Whether layer is visible
 * @property {boolean} locked - Whether layer is locked from editing
 * @property {number} opacity - Opacity (0.0 - 1.0)
 * 
 * // Transform properties
 * @property {number} x - X position (center point)
 * @property {number} y - Y position (center point)
 * @property {number} width - Width in pixels
 * @property {number} height - Height in pixels
 * @property {number} rotation - Rotation in degrees
 * @property {number} scaleX - Horizontal scale (1.0 = 100%)
 * @property {number} scaleY - Vertical scale (1.0 = 100%)
 * @property {number} anchorX - Anchor point X (0.0 - 1.0, 0.5 = center)
 * @property {number} anchorY - Anchor point Y (0.0 - 1.0, 0.5 = center)
 * 
 * // Layer-specific data
 * @property {Object} data - Type-specific properties
 *   For text: { content: string, fontFamily: string, fontSize: number, color: string, ... }
 *   For shape: { fill: string, stroke: string, cornerRadius: number, ... }
 *   For image: { src: string, url: string, ... }
 *   For video: { src: string, url: string, ... }
 * 
 * @property {number} createdAt - Timestamp
 * @property {number} updatedAt - Timestamp
 * 
 * // Crop properties (for image/video layers, Canva-style crop & resize)
 * @property {number} [cropX] - X offset of the crop window from the media top-left
 * @property {number} [cropY] - Y offset of the crop window from the media top-left
 * @property {number} [cropWidth] - Width of the visible crop window
 * @property {number} [cropHeight] - Height of the visible crop window
 * @property {number} [mediaWidth] - Full intrinsic width of the media (image/video)
 * @property {number} [mediaHeight] - Full intrinsic height of the media (image/video)
 */

/**
 * Segment - An animation segment/keyframe sequence for a layer
 * @typedef {Object} Segment
 * @property {string} id - Unique identifier
 * @property {string} layerId - Parent layer ID
 * @property {number} startTime - Start time in seconds
 * @property {number|null} endTime - End time in seconds (null = indefinite)
 * @property {Keyframe[]} keyframes - Array of keyframes for this segment
 */

/**
 * Keyframe - A single keyframe in an animation
 * @typedef {Object} Keyframe
 * @property {string} id - Unique identifier
 * @property {number} time - Time in seconds
 * @property {string} property - Property being animated ('x', 'y', 'opacity', 'rotation', etc.)
 * @property {number|string|Object} value - The value at this keyframe
 * @property {string} easing - Easing function ('linear', 'ease-in', 'ease-out', 'ease-in-out', 'bezier', etc.)
 * @property {number[]} bezierControlPoints - For bezier easing: [x1, y1, x2, y2]
 */

/**
 * Project - Complete project state
 * @typedef {Object} Project
 * @property {Scene[]} scenes - All scenes in the project
 * @property {Object<string, Layer>} layers - Map of layer ID to layer object
 * @property {Object<string, Segment[]>} segmentsByLayer - Map of layer ID to array of segments
 * @property {Object<string, MotionFlow>} motionFlows - Motion flow data per layer
 * @property {string} projectName - Project display name
 * @property {string|null} currentSceneId - Currently active scene ID
 */

/**
 * Transform - Transform properties for a layer
 * @typedef {Object} Transform
 * @property {number} x
 * @property {number} y
 * @property {number} width
 * @property {number} height
 * @property {number} rotation
 * @property {number} scaleX
 * @property {number} scaleY
 */

/**
 * Layer Type Definitions
 */
export const LAYER_TYPES = {
  TEXT: 'text',
  SHAPE: 'shape',
  IMAGE: 'image',
  VIDEO: 'video',
  GROUP: 'group',
  CAMERA: 'camera',
  BACKGROUND: 'background',
}

/**
 * Transition Types
 */
export const TRANSITION_TYPES = {
  NONE: 'None',
  CROSSFADE: 'Crossfade',
  SLIDE: 'Slide',
  FADE: 'Fade',
  WIPE: 'Wipe',
}

/**
 * Easing Functions
 */
export const EASING_TYPES = {
  LINEAR: 'linear',
  EASE_IN: 'ease-in',
  EASE_OUT: 'ease-out',
  EASE_IN_OUT: 'ease-in-out',
  BEZIER: 'bezier',
}

/**
 * Motion Flow System - Core Data Structures for Motion Animation
 * ==================================================================
 */

/**
 * MotionFlow - Container for motion data per layer
 * @typedef {Object} MotionFlow
 * @property {MotionStep[]} steps - Array of motion steps in sequence
 * @property {number} pageDuration - Total duration of the motion flow in milliseconds (default: 6000ms)
 */

/**
 * MotionStep - A single step in a motion sequence
 * @typedef {Object} MotionStep
 * @property {string} id - Unique identifier for this step
 * @property {MotionAction[]} actions - Array of actions to execute in this step
 */

/**
 * MotionAction - Individual animation action within a step
 * @typedef {Object} MotionAction
 * @property {string} id - Unique identifier for this action
 * @property {string} type - Type of motion action: 'move' | 'rotate' | 'scale' | 'fade' | 'hold'
 * @property {Object} values - Action-specific parameters
 *   For 'move': { x: number, y: number, duration?: number, easing?: string }
 *   For 'rotate': { angle: number, duration?: number, easing?: string }
 *   For 'scale': { scaleX: number, scaleY: number, duration?: number, easing?: string }
 *   For 'fade': { opacity: number, duration?: number, easing?: string }
 *   For 'hold': { duration: number }
 */

/**
 * Motion Action Types - Available motion action types
 */
export const MOTION_ACTION_TYPES = {
  MOVE: 'move',
  ROTATE: 'rotate',
  SCALE: 'scale',
  FADE: 'fade',
  HOLD: 'hold',
}

/**
 * Default layer values
 */
export const DEFAULT_LAYER = {
  visible: true,
  locked: false,
  opacity: 1.0,
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
  anchorX: 0.5,
  anchorY: 0.5,
}

