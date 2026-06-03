/**
 * Motion Presets Registry
 * Defines preset generators for relative animations (In/Out)
 * 
 * Architecture:
 * - Each preset defines getActions() that returns action descriptors
 * - Actions with `startOffset` set the initial state BEFORE the animation starts
 * - The action's `values` define the animation target (what to animate TO)
 * - `category` groups presets in the UI
 * - `cssPreview` defines CSS keyframe parameters for lightweight card previews
 * - `icon` is a Lucide icon name for fallback display
 */

export const PRESET_CATEGORIES = {
  FADE: 'Fade',
  SLIDE: 'Slide',
  SCALE: 'Scale',
  ROTATION: 'Rotation',
  BLUR: 'Blur',
  TYPEWRITER: 'Typewriter',
}

export const PRESET_REGISTRY = {
  // ═══════════════════════════════════════════════════════════════════════════
  // IN PRESETS
  // ═══════════════════════════════════════════════════════════════════════════

  // ── FADE ────────────────────────────────────────────────────────────────────
  fade_in: {
    id: 'fade_in',
    name: 'Fade In',
    type: 'IN',
    category: PRESET_CATEGORIES.FADE,
    icon: 'Eye',
    cssPreview: { keyframes: 'preset-fade-in', duration: '1.2s' },
    getActions: (startState, stepDuration) => [
      {
        type: 'fade',
        startOffset: { opacity: 0 },
        values: { opacity: startState.opacity ?? 1, duration: stepDuration }
      }
    ]
  },

  // ── SLIDE ───────────────────────────────────────────────────────────────────
  slide_in_left: {
    id: 'slide_in_left',
    name: 'Slide In Left',
    type: 'IN',
    category: PRESET_CATEGORIES.SLIDE,
    icon: 'ArrowRight',
    cssPreview: { keyframes: 'preset-slide-in-left', duration: '1.2s' },
    getActions: (startState, stepDuration) => [
      {
        type: 'move',
        startOffset: { x: -150 },
        values: { dx: 150, dy: 0, duration: stepDuration }
      },
      {
        type: 'fade',
        startOffset: { opacity: 0 },
        values: { opacity: startState.opacity ?? 1, duration: stepDuration }
      }
    ]
  },
  slide_in_right: {
    id: 'slide_in_right',
    name: 'Slide In Right',
    type: 'IN',
    category: PRESET_CATEGORIES.SLIDE,
    icon: 'ArrowLeft',
    cssPreview: { keyframes: 'preset-slide-in-right', duration: '1.2s' },
    getActions: (startState, stepDuration) => [
      {
        type: 'move',
        startOffset: { x: 150 },
        values: { dx: -150, dy: 0, duration: stepDuration }
      },
      {
        type: 'fade',
        startOffset: { opacity: 0 },
        values: { opacity: startState.opacity ?? 1, duration: stepDuration }
      }
    ]
  },
  slide_in_top: {
    id: 'slide_in_top',
    name: 'Slide In Top',
    type: 'IN',
    category: PRESET_CATEGORIES.SLIDE,
    icon: 'ArrowDown',
    cssPreview: { keyframes: 'preset-slide-in-top', duration: '1.2s' },
    getActions: (startState, stepDuration) => [
      {
        type: 'move',
        startOffset: { y: -150 },
        values: { dx: 0, dy: 150, duration: stepDuration }
      },
      {
        type: 'fade',
        startOffset: { opacity: 0 },
        values: { opacity: startState.opacity ?? 1, duration: stepDuration }
      }
    ]
  },
  slide_in_bottom: {
    id: 'slide_in_bottom',
    name: 'Slide In Bottom',
    type: 'IN',
    category: PRESET_CATEGORIES.SLIDE,
    icon: 'ArrowUp',
    cssPreview: { keyframes: 'preset-slide-in-bottom', duration: '1.2s' },
    getActions: (startState, stepDuration) => [
      {
        type: 'move',
        startOffset: { y: 150 },
        values: { dx: 0, dy: -150, duration: stepDuration }
      },
      {
        type: 'fade',
        startOffset: { opacity: 0 },
        values: { opacity: startState.opacity ?? 1, duration: stepDuration }
      }
    ]
  },

  // ── SCALE ───────────────────────────────────────────────────────────────────
  grow_in: {
    id: 'grow_in',
    name: 'Grow In',
    type: 'IN',
    category: PRESET_CATEGORIES.SCALE,
    icon: 'Maximize2',
    cssPreview: { keyframes: 'preset-grow-in', duration: '1.2s' },
    getActions: (startState, stepDuration) => [
      {
        type: 'scale',
        startOffset: { scaleX: 0.01, scaleY: 0.01 },
        values: { dsx: 100, dsy: 100, duration: stepDuration }
      },
      {
        type: 'fade',
        startOffset: { opacity: 0 },
        values: { opacity: startState.opacity ?? 1, duration: stepDuration }
      }
    ]
  },
  shrink_in: {
    id: 'shrink_in',
    name: 'Shrink In',
    type: 'IN',
    category: PRESET_CATEGORIES.SCALE,
    icon: 'Minimize2',
    cssPreview: { keyframes: 'preset-shrink-in', duration: '1.2s' },
    getActions: (startState, stepDuration) => [
      {
        type: 'scale',
        startOffset: { scaleX: 2, scaleY: 2 },
        values: { dsx: 0.5, dsy: 0.5, duration: stepDuration }
      },
      {
        type: 'fade',
        startOffset: { opacity: 0 },
        values: { opacity: startState.opacity ?? 1, duration: stepDuration }
      }
    ]
  },

  // ── ROTATION ────────────────────────────────────────────────────────────────
  spin_in: {
    id: 'spin_in',
    name: 'Spin In',
    type: 'IN',
    category: PRESET_CATEGORIES.ROTATION,
    icon: 'RotateCw',
    cssPreview: { keyframes: 'preset-spin-in', duration: '1.2s' },
    getActions: (startState, stepDuration) => [
      {
        type: 'rotate',
        startOffset: { rotation: -360 },
        values: { dangle: 360, duration: stepDuration }
      },
      {
        type: 'fade',
        startOffset: { opacity: 0 },
        values: { opacity: startState.opacity ?? 1, duration: stepDuration }
      }
    ]
  },

  // ── BLUR ────────────────────────────────────────────────────────────────────
  blur_in: {
    id: 'blur_in',
    name: 'Blur In',
    type: 'IN',
    category: PRESET_CATEGORIES.BLUR,
    icon: 'Droplets',
    cssPreview: { keyframes: 'preset-blur-in', duration: '1.2s' },
    getActions: (startState, stepDuration) => [
      {
        type: 'blur',
        startOffset: { blur: 20 },
        values: { blur: 0, duration: stepDuration }
      },
      {
        type: 'fade',
        startOffset: { opacity: 0 },
        values: { opacity: startState.opacity ?? 1, duration: stepDuration }
      }
    ]
  },
  blur_slide_in_left: {
    id: 'blur_slide_in_left',
    name: 'Blur + Slide In Left',
    type: 'IN',
    category: PRESET_CATEGORIES.BLUR,
    icon: 'Droplets',
    cssPreview: { keyframes: 'preset-blur-slide-in-left', duration: '1.2s' },
    getActions: (startState, stepDuration) => [
      { type: 'blur', startOffset: { blur: 20 }, values: { blur: 0, duration: stepDuration } },
      { type: 'move', startOffset: { x: -100 }, values: { dx: 100, dy: 0, duration: stepDuration } },
      { type: 'fade', startOffset: { opacity: 0 }, values: { opacity: startState.opacity ?? 1, duration: stepDuration } }
    ]
  },
  blur_slide_in_right: {
    id: 'blur_slide_in_right',
    name: 'Blur + Slide In Right',
    type: 'IN',
    category: PRESET_CATEGORIES.BLUR,
    icon: 'Droplets',
    cssPreview: { keyframes: 'preset-blur-slide-in-right', duration: '1.2s' },
    getActions: (startState, stepDuration) => [
      { type: 'blur', startOffset: { blur: 20 }, values: { blur: 0, duration: stepDuration } },
      { type: 'move', startOffset: { x: 100 }, values: { dx: -100, dy: 0, duration: stepDuration } },
      { type: 'fade', startOffset: { opacity: 0 }, values: { opacity: startState.opacity ?? 1, duration: stepDuration } }
    ]
  },
  blur_slide_in_top: {
    id: 'blur_slide_in_top',
    name: 'Blur + Slide In Top',
    type: 'IN',
    category: PRESET_CATEGORIES.BLUR,
    icon: 'Droplets',
    cssPreview: { keyframes: 'preset-blur-slide-in-top', duration: '1.2s' },
    getActions: (startState, stepDuration) => [
      { type: 'blur', startOffset: { blur: 20 }, values: { blur: 0, duration: stepDuration } },
      { type: 'move', startOffset: { y: -100 }, values: { dx: 0, dy: 100, duration: stepDuration } },
      { type: 'fade', startOffset: { opacity: 0 }, values: { opacity: startState.opacity ?? 1, duration: stepDuration } }
    ]
  },
  blur_slide_in_bottom: {
    id: 'blur_slide_in_bottom',
    name: 'Blur + Slide In Bottom',
    type: 'IN',
    category: PRESET_CATEGORIES.BLUR,
    icon: 'Droplets',
    cssPreview: { keyframes: 'preset-blur-slide-in-bottom', duration: '1.2s' },
    getActions: (startState, stepDuration) => [
      { type: 'blur', startOffset: { blur: 20 }, values: { blur: 0, duration: stepDuration } },
      { type: 'move', startOffset: { y: 100 }, values: { dx: 0, dy: -100, duration: stepDuration } },
      { type: 'fade', startOffset: { opacity: 0 }, values: { opacity: startState.opacity ?? 1, duration: stepDuration } }
    ]
  },
  blur_scale_in: {
    id: 'blur_scale_in',
    name: 'Blur + Scale In',
    type: 'IN',
    category: PRESET_CATEGORIES.BLUR,
    icon: 'Droplets',
    cssPreview: { keyframes: 'preset-blur-scale-in', duration: '1.2s' },
    getActions: (startState, stepDuration) => [
      {
        type: 'blur',
        startOffset: { blur: 20 },
        values: { blur: 0, duration: stepDuration }
      },
      {
        type: 'scale',
        startOffset: { scaleX: 0.5, scaleY: 0.5 },
        values: { dsx: 2, dsy: 2, duration: stepDuration }
      },
      {
        type: 'fade',
        startOffset: { opacity: 0 },
        values: { opacity: startState.opacity ?? 1, duration: stepDuration }
      }
    ]
  },

  // ── TYPEWRITER ────────────────────────────────────────────────────────────
  // Text-only entrance preset. Reuses the existing TypewriterAction (mapped via
  // the action factory) unchanged — it animates the layer's revealProgress so the
  // text types in character by character. Gated to TEXT layers in MotionPanel.
  typewriter_in: {
    id: 'typewriter_in',
    name: 'Typewriter',
    type: 'IN',
    category: PRESET_CATEGORIES.TYPEWRITER,
    icon: 'Type',
    cssPreview: { keyframes: 'preset-typewriter-in', duration: '1.6s' },
    getActions: (startState, stepDuration) => [
      {
        type: 'typewriter',
        values: { duration: stepDuration, easing: 'none' }
      }
    ]
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // OUT PRESETS
  // ═══════════════════════════════════════════════════════════════════════════

  // ── FADE ────────────────────────────────────────────────────────────────────
  fade_out: {
    id: 'fade_out',
    name: 'Fade Out',
    type: 'OUT',
    category: PRESET_CATEGORIES.FADE,
    icon: 'EyeOff',
    cssPreview: { keyframes: 'preset-fade-out', duration: '1.2s' },
    getActions: (startState, stepDuration) => [
      {
        type: 'fade',
        values: { opacity: 0, duration: stepDuration }
      }
    ]
  },

  // ── SLIDE ───────────────────────────────────────────────────────────────────
  slide_out_left: {
    id: 'slide_out_left',
    name: 'Slide Out Left',
    type: 'OUT',
    category: PRESET_CATEGORIES.SLIDE,
    icon: 'ArrowLeft',
    cssPreview: { keyframes: 'preset-slide-out-left', duration: '1.2s' },
    getActions: (startState, stepDuration) => [
      {
        type: 'move',
        values: { dx: -150, dy: 0, duration: stepDuration }
      },
      {
        type: 'fade',
        values: { opacity: 0, duration: stepDuration }
      }
    ]
  },
  slide_out_right: {
    id: 'slide_out_right',
    name: 'Slide Out Right',
    type: 'OUT',
    category: PRESET_CATEGORIES.SLIDE,
    icon: 'ArrowRight',
    cssPreview: { keyframes: 'preset-slide-out-right', duration: '1.2s' },
    getActions: (startState, stepDuration) => [
      {
        type: 'move',
        values: { dx: 150, dy: 0, duration: stepDuration }
      },
      {
        type: 'fade',
        values: { opacity: 0, duration: stepDuration }
      }
    ]
  },
  slide_out_top: {
    id: 'slide_out_top',
    name: 'Slide Out Top',
    type: 'OUT',
    category: PRESET_CATEGORIES.SLIDE,
    icon: 'ArrowUp',
    cssPreview: { keyframes: 'preset-slide-out-top', duration: '1.2s' },
    getActions: (startState, stepDuration) => [
      {
        type: 'move',
        values: { dx: 0, dy: -150, duration: stepDuration }
      },
      {
        type: 'fade',
        values: { opacity: 0, duration: stepDuration }
      }
    ]
  },
  slide_out_bottom: {
    id: 'slide_out_bottom',
    name: 'Slide Out Bottom',
    type: 'OUT',
    category: PRESET_CATEGORIES.SLIDE,
    icon: 'ArrowDown',
    cssPreview: { keyframes: 'preset-slide-out-bottom', duration: '1.2s' },
    getActions: (startState, stepDuration) => [
      {
        type: 'move',
        values: { dx: 0, dy: 150, duration: stepDuration }
      },
      {
        type: 'fade',
        values: { opacity: 0, duration: stepDuration }
      }
    ]
  },

  // ── SCALE ───────────────────────────────────────────────────────────────────
  grow_out: {
    id: 'grow_out',
    name: 'Grow Out',
    type: 'OUT',
    category: PRESET_CATEGORIES.SCALE,
    icon: 'Maximize2',
    cssPreview: { keyframes: 'preset-grow-out', duration: '1.2s' },
    getActions: (startState, stepDuration) => [
      {
        type: 'scale',
        values: { dsx: 2, dsy: 2, duration: stepDuration }
      },
      {
        type: 'fade',
        values: { opacity: 0, duration: stepDuration }
      }
    ]
  },
  shrink_out: {
    id: 'shrink_out',
    name: 'Shrink Out',
    type: 'OUT',
    category: PRESET_CATEGORIES.SCALE,
    icon: 'Minimize2',
    cssPreview: { keyframes: 'preset-shrink-out', duration: '1.2s' },
    getActions: (startState, stepDuration) => [
      {
        type: 'scale',
        values: { dsx: 0.01, dsy: 0.01, duration: stepDuration }
      },
      {
        type: 'fade',
        values: { opacity: 0, duration: stepDuration }
      }
    ]
  },

  // ── ROTATION ────────────────────────────────────────────────────────────────
  spin_out: {
    id: 'spin_out',
    name: 'Spin Out',
    type: 'OUT',
    category: PRESET_CATEGORIES.ROTATION,
    icon: 'RotateCcw',
    cssPreview: { keyframes: 'preset-spin-out', duration: '1.2s' },
    getActions: (startState, stepDuration) => [
      {
        type: 'rotate',
        values: { dangle: 360, duration: stepDuration }
      },
      {
        type: 'fade',
        values: { opacity: 0, duration: stepDuration }
      }
    ]
  },

  // ── BLUR ────────────────────────────────────────────────────────────────────
  blur_out: {
    id: 'blur_out',
    name: 'Blur Out',
    type: 'OUT',
    category: PRESET_CATEGORIES.BLUR,
    icon: 'Droplets',
    cssPreview: { keyframes: 'preset-blur-out', duration: '1.2s' },
    getActions: (startState, stepDuration) => [
      {
        type: 'blur',
        values: { blur: 20, duration: stepDuration }
      },
      {
        type: 'fade',
        values: { opacity: 0, duration: stepDuration }
      }
    ]
  },
  blur_slide_out_left: {
    id: 'blur_slide_out_left',
    name: 'Blur + Slide Out Left',
    type: 'OUT',
    category: PRESET_CATEGORIES.BLUR,
    icon: 'Droplets',
    cssPreview: { keyframes: 'preset-blur-slide-out-left', duration: '1.2s' },
    getActions: (startState, stepDuration) => [
      { type: 'blur', values: { blur: 20, duration: stepDuration } },
      { type: 'move', values: { dx: -100, dy: 0, duration: stepDuration } },
      { type: 'fade', values: { opacity: 0, duration: stepDuration } }
    ]
  },
  blur_slide_out_right: {
    id: 'blur_slide_out_right',
    name: 'Blur + Slide Out Right',
    type: 'OUT',
    category: PRESET_CATEGORIES.BLUR,
    icon: 'Droplets',
    cssPreview: { keyframes: 'preset-blur-slide-out-right', duration: '1.2s' },
    getActions: (startState, stepDuration) => [
      { type: 'blur', values: { blur: 20, duration: stepDuration } },
      { type: 'move', values: { dx: 100, dy: 0, duration: stepDuration } },
      { type: 'fade', values: { opacity: 0, duration: stepDuration } }
    ]
  },
  blur_slide_out_top: {
    id: 'blur_slide_out_top',
    name: 'Blur + Slide Out Top',
    type: 'OUT',
    category: PRESET_CATEGORIES.BLUR,
    icon: 'Droplets',
    cssPreview: { keyframes: 'preset-blur-slide-out-top', duration: '1.2s' },
    getActions: (startState, stepDuration) => [
      { type: 'blur', values: { blur: 20, duration: stepDuration } },
      { type: 'move', values: { dx: 0, dy: -100, duration: stepDuration } },
      { type: 'fade', values: { opacity: 0, duration: stepDuration } }
    ]
  },
  blur_slide_out_bottom: {
    id: 'blur_slide_out_bottom',
    name: 'Blur + Slide Out Bottom',
    type: 'OUT',
    category: PRESET_CATEGORIES.BLUR,
    icon: 'Droplets',
    cssPreview: { keyframes: 'preset-blur-slide-out-bottom', duration: '1.2s' },
    getActions: (startState, stepDuration) => [
      { type: 'blur', values: { blur: 20, duration: stepDuration } },
      { type: 'move', values: { dx: 0, dy: 100, duration: stepDuration } },
      { type: 'fade', values: { opacity: 0, duration: stepDuration } }
    ]
  },
  blur_scale_out: {
    id: 'blur_scale_out',
    name: 'Blur + Scale Out',
    type: 'OUT',
    category: PRESET_CATEGORIES.BLUR,
    icon: 'Droplets',
    cssPreview: { keyframes: 'preset-blur-scale-out', duration: '1.2s' },
    getActions: (startState, stepDuration) => [
      {
        type: 'blur',
        values: { blur: 20, duration: stepDuration }
      },
      {
        type: 'scale',
        values: { dsx: 0.5, dsy: 0.5, duration: stepDuration }
      },
      {
        type: 'fade',
        values: { opacity: 0, duration: stepDuration }
      }
    ]
  },
}

// ═══════════════════════════════════════════════════════════════════════════
// BACKWARD COMPATIBILITY ALIASES
// Old preset IDs that may exist in saved project data.
// These map to their closest new equivalent so existing projects still work.
// They are NOT included in getPresetGroups() output (no `category`).
// ═══════════════════════════════════════════════════════════════════════════
PRESET_REGISTRY.slide_in = { ...PRESET_REGISTRY.slide_in_left, id: 'slide_in', _isAlias: true }
PRESET_REGISTRY.slide_out = { ...PRESET_REGISTRY.slide_out_right, id: 'slide_out', _isAlias: true }
PRESET_REGISTRY.zoom_in = { ...PRESET_REGISTRY.grow_in, id: 'zoom_in', _isAlias: true }
PRESET_REGISTRY.zoom_out = { ...PRESET_REGISTRY.shrink_out, id: 'zoom_out', _isAlias: true }
// Blur Slide gained directional variants — map the old single-direction IDs to the
// closest new equivalent (left-origin IN / right-travel OUT) so saved projects still work.
PRESET_REGISTRY.blur_slide_in = { ...PRESET_REGISTRY.blur_slide_in_left, id: 'blur_slide_in', _isAlias: true }
PRESET_REGISTRY.blur_slide_out = { ...PRESET_REGISTRY.blur_slide_out_right, id: 'blur_slide_out', _isAlias: true }

/**
 * Get all presets grouped by category for a given type (IN/OUT).
 * Returns an array of { category, presets: [...] } for the UI.
 * Excludes backward-compatibility aliases (those without a category).
 */
export function getPresetGroups(type) {
  const groups = new Map()
  Object.values(PRESET_REGISTRY).forEach(preset => {
    if (preset.type !== type) return
    if (preset._isAlias) return // Skip backward-compat aliases
    const cat = preset.category || 'Other'
    if (!groups.has(cat)) groups.set(cat, [])
    groups.get(cat).push(preset)
  })
  return Array.from(groups.entries()).map(([category, presets]) => ({
    category,
    presets
  }))
}
