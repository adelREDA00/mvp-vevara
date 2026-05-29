import { gsap } from 'gsap'
import { CustomEase } from "gsap/CustomEase";
import { applyTiltToObject, syncTiltMesh } from '../../pixi/perspectiveTilt.js'

// Register the plugin
gsap.registerPlugin(CustomEase);

// Hard ceiling on tilt input.  Beyond ~60° the perspective quadrilateral
// gets narrow enough that PIXI's PerspectiveMesh interior-vertex math
// becomes numerically unstable — the layer visually shoots outside its
// selection box ("to infinity") and looks torn.  60° is dramatic but keeps
// the mesh well-behaved on every GPU, and matches the ceiling most design
// tools (Figma, After Effects' rotate panel) expose.  The UI still paints
// a recommended-safe zone at ±45° for best-looking results.
const TILT_HARD_LIMIT = 60

function clampTilt(v) {
  return Math.max(-TILT_HARD_LIMIT, Math.min(TILT_HARD_LIMIT, Number(v) || 0))
}

/**
 * TiltAction — Animates 3D perspective tilt (tiltX / tiltY) on a PIXI
 * DisplayObject using PerspectiveMesh for true perspective distortion.
 *
 * tiltX: positive = left side closer to viewer, right side recedes
 * tiltY: positive = bottom closer to viewer, top recedes
 *
 * Action values schema:   { tiltX: number, tiltY: number, duration: ms, easing: string }
 * State tracker schema:   { tiltX: degrees, tiltY: degrees }
 */
export class TiltAction {
  constructor() {
    this.type = 'tilt'
  }

  execute(pixiObject, actionData, options = {}) {
    const { values = {} } = actionData
    const duration = (values.duration || 2000) / 1000
    const easing = "myEase"

    const startTiltX = clampTilt(
      options.startState?.tiltX ?? (pixiObject._tiltXDeg ?? 0)
    )
    const startTiltY = clampTilt(
      options.startState?.tiltY ?? (pixiObject._tiltYDeg ?? 0)
    )

    const targetTiltX = clampTilt(values.tiltX !== undefined ? values.tiltX : startTiltX)
    const targetTiltY = clampTilt(values.tiltY !== undefined ? values.tiltY : startTiltY)

    if (Math.abs(targetTiltX - startTiltX) < 0.01 && Math.abs(targetTiltY - startTiltY) < 0.01) {
      return gsap.to({}, { duration })
    }

    // GSAP warns ("Missing plugin?") when tweening custom props on a PIXI object.
    // Tween a plain JS proxy instead, then mirror values onto the degree fields
    // that syncTiltMesh reads.
    if (!pixiObject._tiltProxy) pixiObject._tiltProxy = { tiltX: 0, tiltY: 0 }
    pixiObject._tiltProxy.tiltX = startTiltX
    pixiObject._tiltProxy.tiltY = startTiltY
    pixiObject._tiltXDeg = startTiltX
    pixiObject._tiltYDeg = startTiltY

    const renderer = pixiObject._pixiRenderer || null

    // Ensure the mesh exists for the WHOLE animation, even when current tilt
    // is exactly 0 — otherwise `applyTiltToObject(0,0,...)` would tear it down
    // every frame the proxy crosses zero, causing visible flicker / vanish.
    // We pass `keepMesh: true` so applyTiltToObject keeps the mesh sticky for
    // the duration of the animation.
    pixiObject._applyAnimatedTilt = () => {
      if (pixiObject.destroyed) return
      const tx = pixiObject._tiltXDeg || 0
      const ty = pixiObject._tiltYDeg || 0
      if (!pixiObject._tiltMesh) {
        // Use a tiny non-zero seed so the mesh is created and visible even at 0.
        applyTiltToObject(pixiObject, tx || 0.001, ty, renderer, { keepMesh: true })
        // Restore actual angles so syncTiltMesh draws the real corners.
        pixiObject._tiltXDeg = tx
        pixiObject._tiltYDeg = ty
        syncTiltMesh(pixiObject, null)
      } else {
        // Mark hidden in case some prior tween / capture-mode reset cleared
        // the flag — syncTiltMesh's defensive block re-asserts alpha=0.
        pixiObject._tiltHidden = true
        syncTiltMesh(pixiObject, null)
      }
    }

    // pixiObject._applyAnimatedTilt() - Removed immediate call to prevent premature hiding

    return gsap.fromTo(pixiObject._tiltProxy,
      { tiltX: startTiltX, tiltY: startTiltY },
      {
        duration,
        ease: easing,
        immediateRender: false,
        overwrite: false,
        tiltX: targetTiltX,
        tiltY: targetTiltY,
        onUpdate: () => {
          pixiObject._tiltXDeg = pixiObject._tiltProxy.tiltX
          pixiObject._tiltYDeg = pixiObject._tiltProxy.tiltY
          
          // [PERF] During export, mark dirty on every update so we capture 
          // the intermediate frames of the tilt animation.
          if (options.isExport) pixiObject._tiltTextureDirty = true

          if (pixiObject._applyAnimatedTilt) pixiObject._applyAnimatedTilt()
        },
        onComplete: () => {
          pixiObject._tiltXDeg = pixiObject._tiltProxy.tiltX
          pixiObject._tiltYDeg = pixiObject._tiltProxy.tiltY
          if (options.isExport) pixiObject._tiltTextureDirty = true
          if (pixiObject._applyAnimatedTilt) pixiObject._applyAnimatedTilt()
        }
      }
    )
  }
}
