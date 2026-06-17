import { gsap } from 'gsap'
import { CustomEase } from "gsap/CustomEase";
import { applyTiltToObject, syncTiltMesh, removeTiltFromObject } from '../../pixi/perspectiveTilt.js'

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
    // [COLOR-TILT RACE FIX] Removed syncTiltMesh() from _applyAnimatedTilt.
    //
    // GSAP evaluates tweens in timeline order within a single tick. If the
    // TiltAction's onUpdate fires BEFORE the ColorChangeAction's onUpdate,
    // syncTiltMesh() captures the RTT with the STALE color (before the
    // ColorChangeAction has painted the new frame's interpolated color).
    // By the time ColorChangeAction's onUpdate fires and calls
    // markTiltTextureDirty(), the RTT capture throttle has already been
    // consumed — so the mesh shows the old color until the next throttle
    // window (~6 frames at 60fps). This is the root cause of the
    // alternating-color flicker on tilted layers during multi-step playback.
    //
    // The engine's per-frame _syncTiltedLayers() (from masterTimeline.
    // onUpdate, running AFTER all tween onUpdate callbacks) handles ALL
    // mesh corner updates + RTT captures. _applyAnimatedTilt only needs
    // to ensure the perspective mesh EXISTS (keepMesh lifecycle) and that
    // the tilt-hide invariant is re-asserted. The actual mesh transform
    // and texture sync happens once, after all actions have painted.
    pixiObject._applyAnimatedTilt = () => {
      if (pixiObject.destroyed) return
      // If currently editing this text layer, do not apply tilt and do not hide the original text
      if (pixiObject._isEditingText) {
        if (pixiObject._tiltMesh) {
          // If the mesh exists, clean it up so the flat original is used
          removeTiltFromObject(pixiObject)
        }
        return
      }

      const tx = pixiObject._tiltXDeg || 0
      const ty = pixiObject._tiltYDeg || 0
      if (!pixiObject._tiltMesh) {
        // Create the mesh at a tiny non-zero seed so it's visible even at
        // 0° crossing; the degree fields are restored immediately after.
        applyTiltToObject(pixiObject, tx || 0.001, ty, renderer, { keepMesh: true })
        pixiObject._tiltXDeg = tx
        pixiObject._tiltYDeg = ty
      } else {
        // Re-assert the tilt-hide invariant in case a previous engine
        // rebuild or capture-mode reset cleared _tiltHidden.
        pixiObject._tiltHidden = true
      }
      // The engine's _syncTiltedLayers() → syncTiltedDisplay() → syncTiltMesh()
      // runs later in the same GSAP tick, after ALL action onUpdate callbacks
      // have fired (including ColorChangeAction). That single pass updates
      // mesh corners and captures the RTT with final per-frame state.
    }

    // pixiObject._applyAnimatedTilt() - Removed immediate call to prevent premature hiding

    const toVars = {
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

    const tl = gsap.timeline()
    tl.set(pixiObject._tiltProxy, { tiltX: startTiltX, tiltY: startTiltY }, 0)
    tl.to(pixiObject._tiltProxy, toVars, 0)
    return tl
  }
}
