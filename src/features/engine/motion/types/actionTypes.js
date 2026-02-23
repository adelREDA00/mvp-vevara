/**
 * Motion action type constants
 * Defines the available animation action types in the motion system
 */

export const ACTION_TYPES = {
  MOVE: 'move',
  ROTATE: 'rotate',
  SCALE: 'scale',
  FADE: 'fade',
  CROP: 'crop',
  HOLD: 'hold',
}

/**
 * Easing function presets for GSAP animations
 */
export const EASING_PRESETS = {
  linear: 'none',
  easeIn: 'power1.in',
  easeOut: 'power1.out',
  easeInOut: 'power1.inOut',
  bounce: 'bounce.out',
  elastic: 'elastic.out(1, 0.3)',
  back: 'back.out(1.7)',
}
