import * as PIXI from 'pixi.js'

// perspectiveTilt.js
// Per-layer 3D perspective effect built on PIXI.PerspectiveMesh.
//
// Architecture overview
// ---------------------
//   - Redux layer.tiltX / layer.tiltY is the source of truth for the angle.
//   - The mesh is a visual slave: a sibling of the original PIXI object,
//     positioned/scaled/rotated to match it, textured from a render texture
//     (RTT) that captures the layer's actual visible output.
//   - Every layer type goes through the SAME path: capture-to-RTT →
//     mesh.texture = RTT → mesh.setCorners(...) using the SAME w/h that the
//     RTT was captured at. This keeps the mesh visually identical to the
//     untilted layer when tilt = 0 and consistent with the layer at any tilt.
//   - For cropped containers (image, video, frame) we render the masked
//     container to an RTT sized to the crop region, so the mesh shows the
//     correctly-cropped pixels, not the stretched full-resolution sprite.
//   - The original is hidden via alpha=0 (instead of visible=false) so PIXI's
//     hit-testing keeps working — the user can still click and drag the
//     tilted layer.  applyTransformInline checks `_tiltHidden` before writing
//     opacity, so the alpha=0 sentinel survives Redux re-syncs.
// [SENTINEL FIX] We now use 1e-6 as the hide sentinel instead of 0. This
// allows us to distinguish between "hidden for tilt" and "user-intended 
// invisible (0)".
export const TILT_HIDE_SENTINEL = 0.000001
//   - Anything that changes the layer's appearance (color, text, image swap,
//     resize, crop, frame placeholder, etc.) calls `markTiltTextureDirty` so
//     the next sync re-captures the RTT.

const MESH_VERTICES = 32
const MIN_TILT_RAD = 0.0001 // Numerical guard around 0° to avoid div-by-zero.

// [QUALITY / PERF] Upper bound on the larger RTT dimension (in physical
// pixels).  Tuned for low-end GPUs: 2048 comfortably covers any reasonable
// on-screen layer size while keeping per-capture cost and GPU memory
// predictable.  Above this the dimension is clamped so 4K+ sources can't
// blow memory or stall resizes / drags on low-end hardware.
const MAX_RTT_DIMENSION = 2048

// [QUALITY / PERF] We allow RTT resolution to scale up to 4.0 if the layer
// is significantly scaled up on stage, but no further. This ensures that
// a small layer scaled 10x doesn't look blurry when tilted, while still
// respecting the MAX_RTT_DIMENSION ceiling.
const MAX_RTT_RESOLUTION = 4.0

// Runtime toggles kept for internal troubleshooting only.
const _tiltForceGenerate = () => typeof window !== 'undefined' && window.__TILT_FORCE_GENERATE_TEXTURE === true
const _tiltDisableRenderGroup = () => typeof window !== 'undefined' && window.__TILT_DISABLE_RENDER_GROUP === true
// [IMG-QUALITY DIAG] Set window.__TILT_DEBUG_QUALITY = true in devtools to
// emit a one-line-per-capture log block that surfaces the texture sampling
// state for tilted IMAGE layers — used to pinpoint which of the candidate
// resolution / scaleMode / mipmap / antialias defaults is causing visible
// blur. Off by default so production isn't spammed.
const _tiltDebugQuality = () => typeof window !== 'undefined' && window.__TILT_DEBUG_QUALITY === true

const getIsPlayingOrScrubbing = () => {
  if (typeof window === 'undefined') return false
  const engine = window.__globalMotionEngine
  if (!engine) return false
  return !!(engine.isPlaying || engine._isScrubbing)
}

function _tdbg(...args) {
  void args
}
function _twarn(...args) {
  console.warn('[Tilt]', ...args)
}

// ---------------------------------------------------------------------------
// Post-render RTT validation (diagnostic only).
// Reads back a small region via renderer.extract.pixels and returns the
// max non-zero channel value observed.  A pure-black / fully-transparent
// capture returns 0 — the exact symptom of the "tilt = black layer" export
// bug.  Expensive: causes a GPU→CPU sync.  Gated behind
// diagnostics are disabled in production.
// ---------------------------------------------------------------------------
function _validateRTTHasPixels(renderer, renderTexture, label) {
  void renderer
  void renderTexture
  void label
  return null
}

// ---------------------------------------------------------------------------
// [EXPORT-BLACK-MESH v7] Canvas2d text rasteriser.
//
// This is the guaranteed-working path for text capture on a PIXI build whose
// WebGL RTT clear is hard-wired to opaque black and whose `PIXI.Text.texture`
// can show up as null / destroyed even after `updateText(true)` (observed in
// the user's build's export renderer).  Canvas2d transparency is not
// affected by the broken GL clear — we bypass PIXI entirely and draw the
// glyphs onto a fresh `<canvas>` using the same style fields the original
// Text was built with, then wrap that canvas in a PIXI.Texture.
//
// The output dimensions use the tilt layout's `w × h` so the resulting
// texture maps 1:1 onto the PerspectiveMesh vertices.  Resolution follows
// the Text style's `resolution` field (default 2) for crisp glyphs.
// Word-wrap, alignment and letter-spacing are handled to match the most
// common PIXI.Text configurations used by the editor.
//
// Returns a PIXI.Texture tagged with `_tiltCanvas2dOwned=true`.  Because it
// IS tilt-owned (not borrowed from a live display object), the normal
// destroy-on-swap path correctly frees it — we don't mark `_tiltBorrowed`.
// ---------------------------------------------------------------------------
function _rasterizeTextToCanvasTexture(textObj, layoutW, layoutH) {
  try {
    const style = textObj?.style
    if (!style) return null
    const content = typeof textObj.text === 'string' ? textObj.text : ''

    const fontSize = Number(style.fontSize) > 0 ? Number(style.fontSize) : 24
    const fontFamily = style.fontFamily || 'Arial'
    const fontWeight = style.fontWeight || 'normal'
    const fontStyle = style.fontStyle || 'normal'
    const resolution = Number(style.resolution) > 0 ? Number(style.resolution) : 2
    const letterSpacing = Number(style.letterSpacing) || 0
    const lineHeight = Number(style.lineHeight) > 0 ? Number(style.lineHeight) : fontSize * 1.2
    const align = style.align || 'left'
    // [TEXT TILT FIX] ALWAYS prefer style.wordWrapWidth when available so the
    // Canvas2D rasterizer uses the EXACT SAME wrap width as PIXI.TextMetrics.
    // Previously, Canvas2D's measureText() could produce different line breaks
    // than PIXI for the same width, causing the tilted text to show different
    // wrapping (e.g. 4 lines became 2 lines) when the canvas2d path was used.
    // PIXI.TextMetrics uses breakWords:true + wordWrapWidth — we mirror both.
    const wordWrap = style.wordWrap !== false
    const wordWrapWidth = Number(style.wordWrapWidth) > 0
      ? Number(style.wordWrapWidth)
      : (layoutW > 0 ? layoutW : 200)
    // Mirror PIXI's breakWords:true behavior: split at any character boundary
    // when a single word exceeds wordWrapWidth, not just whitespace.
    const breakWords = style.breakWords !== false

    // PIXI accepts fill as string, number or { color } — normalise to CSS.
    let fill = '#000000'
    if (typeof style.fill === 'string') fill = style.fill
    else if (typeof style.fill === 'number') fill = '#' + style.fill.toString(16).padStart(6, '0')
    else if (style.fill && typeof style.fill.color !== 'undefined') {
      const c = style.fill.color
      if (typeof c === 'string') fill = c
      else if (typeof c === 'number') fill = '#' + c.toString(16).padStart(6, '0')
    }

    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    const fontStr = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`
    ctx.font = fontStr

    // [TEXT TILT FIX] Word-wrap with breakWords support.
    // PIXI's TextMetrics respects breakWords for long words — if a word
    // alone exceeds wordWrapWidth, it gets broken at the wrap boundary,
    // not pushed to the next line.  Mirror this with character-level
    // splitting when breakWords is true AND the single word overflows.
    const rawLines = content.length ? content.split('\n') : ['']
    const lines = []
    for (const para of rawLines) {
      if (!wordWrap || !para) {
        lines.push(para)
        continue
      }
      // Tokenise by whitespace (PIXI's default split pattern)
      const words = para.split(/(\s+)/)
      let current = ''
      for (const token of words) {
        // Whitespace tokens are added to current without overflow check
        if (/^\s+$/.test(token)) {
          current += token
          continue
        }
        const test = current + token
        const tw = ctx.measureText(test).width
        if (tw > wordWrapWidth && current.trim()) {
          lines.push(current)
          current = token
          // [TEXT TILT FIX] If the single token itself overflows the line
          // AND breakWords is enabled, split it character-by-character.
          if (breakWords && ctx.measureText(token).width > wordWrapWidth) {
            let charBuf = ''
            for (const ch of token) {
              const charTest = charBuf + ch
              if (ctx.measureText(charTest).width > wordWrapWidth && charBuf) {
                lines.push(charBuf)
                charBuf = ch
              } else {
                charBuf = charTest
              }
            }
            current = charBuf
          }
        } else {
          current = test
        }
      }
      if (current || !para) lines.push(current)
    }
    if (!lines.length) lines.push('')

    // [TEXT TILT FIX] Use layoutW as a hard ceiling for logical width.
    // The tilt mesh's corners are computed from (layoutW, layoutH) — if the
    // canvas2D texture is wider than layoutW, the mesh will compress the text
    // visually.  Clamp textual width to the same mesh boundary PIXI would use.
    let totalContentH = lines.length * lineHeight

    // Measure widest line (accounting for letter spacing).
    let maxLineW = 1
    for (const line of lines) {
      const mw = ctx.measureText(line).width
        + Math.max(0, line.length - 1) * letterSpacing
      if (mw > maxLineW) maxLineW = mw
    }

    // Clamp to layoutW so the rasterised canvas matches the mesh quad exactly.
    const logicalW = Math.max(1, layoutW || 200)
    const logicalH = Math.max(totalContentH, layoutH || 1, 1)

    canvas.width = Math.max(1, Math.ceil(logicalW * resolution))
    canvas.height = Math.max(1, Math.ceil(logicalH * resolution))

    // Canvas starts transparent. Redraw state after resize and paint.
    ctx.scale(resolution, resolution)
    ctx.font = fontStr
    ctx.fillStyle = fill
    ctx.textBaseline = 'top'
    ctx.textAlign = 'left'

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const lineW = ctx.measureText(line).width
        + Math.max(0, line.length - 1) * letterSpacing
      let x = 0
      if (align === 'center') x = (logicalW - lineW) / 2
      else if (align === 'right') x = logicalW - lineW
      const y = i * lineHeight

      if (letterSpacing && line.length > 1) {
        let cx = x
        for (const ch of line) {
          ctx.fillText(ch, cx, y)
          cx += ctx.measureText(ch).width + letterSpacing
        }
      } else {
        ctx.fillText(line, x, y)
      }
    }

    const tex = PIXI.Texture.from(canvas)
    try {
      if (tex.source) tex.source.resolution = resolution
    } catch (_e) { /* ignore */ }
    tex._tiltCanvas2dOwned = true
    return tex
  } catch (e) {
    _twarn(`canvas2d text rasterise failed:`, e?.message || e)
    return null
  }
}

// ---------------------------------------------------------------------------
// [EXPORT-BLACK-MESH v8] RenderTexture → canvas-backed texture conversion.
//
// Runtime evidence showed that
// for non-text layers in export mode, the RTT capture itself is fine —
// the validator reads back real animating content (shape rgb ramping from
// 138 to 255 as it tilts, image rgb=253 for a white image).  Yet the
// exported MP4 still shows black rectangles for those layers.  The only
// structural difference between the "works" case (text, after v7) and
// the "broken" case (non-text) is texture type:
//
//   Text (works in export):        PIXI.Texture.from(HTMLCanvasElement)
//   Non-text (black in export):    PIXI.RenderTexture  ← the broken path
//
// This PIXI v8 build, on this export renderer, evidently has a bug where
// a RenderTexture used as a PerspectiveMesh's texture composites as
// opaque black onto the export canvas even when the RTT itself contains
// correct pixels.  Canvas-backed textures don't hit that code path.
//
// The fix: after a successful RTT capture in export mode, read the RTT
// back to an HTMLCanvasElement (via `renderer.extract.canvas`, which
// handles GL's Y-flip and pre-multiplied alpha correctly) and wrap *that*
// canvas in a plain PIXI.Texture.  The RenderTexture is then destroyed.
// From the mesh's perspective, every tilted layer's texture now has the
// same type as the text fix (canvas-backed) so compositing works for all
// of them.
//
// The extra GPU→CPU readback is expensive, but export already runs off
// the critical path (no framerate pressure) and only samples once per
// dirty capture.  Live canvas is untouched — RTTs are kept there, where
// they render correctly.
// ---------------------------------------------------------------------------
function _rttToCanvasBackedTexture(renderer, renderTexture, label) {
  try {
    if (!renderer?.extract || !renderTexture || renderTexture.destroyed) {
      _twarn(`_rttToCanvasBackedTexture failed early for ${label}: renderer.extract=${!!renderer?.extract}, renderTexture=${!!renderTexture}, destroyed=${renderTexture?.destroyed}`);
      return null
    }
    const canvas = renderer.extract.canvas(renderTexture)

    if (!(canvas instanceof HTMLCanvasElement)) {
      _twarn(`_rttToCanvasBackedTexture: extract.canvas did not return HTMLCanvasElement`);
      return null
    }
    if (canvas.width <= 0 || canvas.height <= 0) {
      _twarn(`_rttToCanvasBackedTexture: canvas dimensions invalid: ${canvas.width}x${canvas.height}`);
      return null
    }

    const rttRes = renderTexture.source?.resolution || 1
    const srcFrame = renderTexture.frame
    const frameX = Math.round((srcFrame?.x || 0) * rttRes)
    const frameY = Math.round((srcFrame?.y || 0) * rttRes)
    const frameW = Math.max(1, Math.round((srcFrame?.width || renderTexture.width) * rttRes))
    const frameH = Math.max(1, Math.round((srcFrame?.height || renderTexture.height) * rttRes))

    let finalCanvas = canvas
    if (frameX !== 0 || frameY !== 0 || frameW !== canvas.width || frameH !== canvas.height) {
      const croppedCanvas = document.createElement('canvas')
      croppedCanvas.width = frameW
      croppedCanvas.height = frameH
      const ctx = croppedCanvas.getContext('2d')
      if (ctx) {
        ctx.drawImage(canvas, frameX, frameY, frameW, frameH, 0, 0, frameW, frameH)
        finalCanvas = croppedCanvas
      } else {
        _twarn(`_rttToCanvasBackedTexture: could not get 2D context of cropped canvas`);
      }
    }

    const tex = PIXI.Texture.from(finalCanvas, {
      scaleMode: 'linear',
      autoGenerateMipmaps: true,
      resolution: rttRes,
    })
    tex._tiltCanvas2dOwned = true   // tilt owns this — safe to destroy on swap

    _tdbg(`RTT→canvas conversion OK for ${label} (${canvas.width}x${canvas.height})`)

    return tex
  } catch (e) {
    _twarn(`_rttToCanvasBackedTexture failed with error for ${label}:`, e?.message || e);
    return null
  }
}

// Resolve the <video> element a tilted layer is sourcing from, regardless of
// whether the video was attached as `_videoElement` (background) or only
// reachable through the `_videoSprite` texture (layer video).
function getTiltVideoElement(pixiObject) {
  if (!pixiObject || pixiObject.destroyed) return null
  if (pixiObject._videoElement instanceof HTMLVideoElement) return pixiObject._videoElement
  const src = pixiObject._videoSprite?.texture?.source?.resource
  if (src instanceof HTMLVideoElement) return src
  return null
}

export function computePerspectiveCorners(w, h, tiltXDeg, tiltYDeg, offsetX = 0, offsetY = 0) {
  const radX = (tiltXDeg || 0) * Math.PI / 180
  const radY = (tiltYDeg || 0) * Math.PI / 180

  const cosX = Math.cos(radX)
  const sinX = Math.sin(radX)
  const cosY = Math.cos(radY)
  const sinY = Math.sin(radY)

  // Perspective coefficients (defines camera distance relative to layer size)
  // 0.35 is a standard coefficient that gives a realistic perspective effect.
  const dX = 0.35
  const dY = 0.35

  const cx = w / 2
  const cy = h / 2

  // We compute the projected coordinates for each of the 4 corners relative to the center (0,0)
  // using 3D rotation (Ry then Rx: yaw then pitch) and perspective projection.
  // This ensures the perspective remains centered around the middle of the layer
  // when both tilt axes are applied.

  const projectCorner = (x, y) => {
    // 1. Rotate around Y-axis (yaw / tiltX)
    const x1 = x * cosX
    const y1 = y
    const z1 = -x * sinX

    // 2. Rotate around X-axis (pitch / tiltY)
    const x2 = x1
    const y2 = y1 * cosY - z1 * sinY
    const z2 = y1 * sinY + z1 * cosY

    // 3. Perspective projection divisor
    // We map the X and Y perspective coefficients (dX, dY) to their respective rotated Z components.
    const div = Math.max(0.1, 1 + (x / cx) * dX * sinX * cosY - (y / cy) * dY * sinY)

    return {
      px: offsetX + cx + x2 / div,
      py: offsetY + cy + y2 / div
    }
  }

  // 1. Top-Left corner (x = -cx, y = -cy)
  const tl = projectCorner(-cx, -cy)

  // 2. Top-Right corner (x = cx, y = -cy)
  const tr = projectCorner(cx, -cy)

  // 3. Bottom-Right corner (x = cx, y = cy)
  const br = projectCorner(cx, cy)

  // 4. Bottom-Left corner (x = -cx, y = cy)
  const bl = projectCorner(-cx, cy)

  return [tl.px, tl.py, tr.px, tr.py, br.px, br.py, bl.px, bl.py]
}

export function markTiltTextureDirty(pixiObject) {
  if (!pixiObject || pixiObject.destroyed) return
  pixiObject._tiltTextureDirty = true
}

// Stamps the current live layout dimensions as the cached capture dims so that
// syncTiltMesh doesn't snap back to pre-resize dimensions when _isResizing flips
// to false. Call this just before clearing _isResizing in handleResizeEnd.
// [BUG1 FIX] Removed the `_tiltCaptureW === undefined` guard so this always
// runs — even on the very first resize before any RTT capture has occurred.
// Without this, the function silently no-opped on first drag, leaving
// _tiltCaptureW undefined so syncTiltMesh fell back to getTiltLayout(), which
// read stale pre-resize dims and caused the mesh to snap back after release.
export function stampTiltCaptureDims(pixiObject) {
  if (!pixiObject?._tiltMesh) return
  const layout = getTiltLayout(pixiObject)
  pixiObject._tiltCaptureW = layout.w
  pixiObject._tiltCaptureH = layout.h
  pixiObject._tiltCaptureOriginX = layout.originX
  pixiObject._tiltCaptureOriginY = layout.originY
}

// ---------------------------------------------------------------------------
// Layer-shape helpers
// ---------------------------------------------------------------------------

function isCroppedMediaContainer(pixiObject) {
  return !!(pixiObject && (pixiObject._imageSprite || pixiObject._videoSprite) && pixiObject instanceof PIXI.Container)
}

// Returns the size of the visible region the mesh should display, plus the
// offset where the capture origin lives relative to the pixiObject's local
// (0,0).  This is the SINGLE place layer-type-specific layout choices live;
// every other function reads from here so the texture, the mesh quad and the
// pivot all stay aligned.
function getTiltLayout(pixiObject) {
  // Cropped media: visible region is [0, cropW] x [0, cropH] in container-local coords.
  if (isCroppedMediaContainer(pixiObject)) {
    const rawW = pixiObject._storedCropWidth ?? pixiObject._cropMask?.width ?? pixiObject.width ?? 1
    const rawH = pixiObject._storedCropHeight ?? pixiObject._cropMask?.height ?? pixiObject.height ?? 1

    // [Bug 3 Fix] Preserve fractional dimensions for all media types (image,
    // video, frame) so the tilt mesh corners match the selection box outline
    // exactly. The ceil'ed dimensions were 1-2px larger than the actual
    // fractional values stored in Redux, causing the mesh to appear off-sized.
    // The RTT allocation uses its own ceil inside captureToTexture().
    const cropW = Math.max(1, rawW)
    const cropH = Math.max(1, rawH)
    return {
      w: cropW,
      h: cropH,
      // Origin in pixiObject-local space where the capture region starts.
      // For cropped containers, the mask covers (0,0)→(cropW,cropH).
      originX: 0,
      originY: 0,
      usePivot: true, // mesh.pivot copies pixiObject.pivot
    }
  }

  // Graphics shapes: trust _storedWidth/_storedHeight/_storedAnchorX/Y stamped
  // by createLayer/redrawShapeWithColors.  getLocalBounds() is unreliable on a
  // PIXI.Graphics right after .clear()+redraw — it can return zero/old bounds
  // for one frame, which would size the RTT to 1×1 and make the mesh appear
  // empty / vanish.  The stored dims are always current.
  if (pixiObject instanceof PIXI.Graphics &&
    typeof pixiObject._storedWidth === 'number' &&
    typeof pixiObject._storedHeight === 'number') {
    // [Bug 3 Fix] Preserve fractional dimensions for shapes (same as images)
    // instead of ceil'ing. The ceil caused the RTT frame to be slightly larger
    // than the actual drawn geometry, creating a mismatch between the tilt mesh
    // corners and the selection box outline read from Redux fractional values.
    const w = Math.max(1, pixiObject._storedWidth)
    const h = Math.max(1, pixiObject._storedHeight)
    const aX = pixiObject._storedAnchorX ?? 0.5
    const aY = pixiObject._storedAnchorY ?? 0.5
    return {
      w,
      h,
      // redrawShapeWithColors centres geometry at (w*(0.5-aX), h*(0.5-aY)),
      // so its drawn region spans (-w*aX, -h*aY) → (w*(1-aX), h*(1-aY)).
      originX: -w * aX,
      originY: -h * aY,
      usePivot: true,
    }
  }

  // Plain Sprite (image without crop wrapper): use width/height, anchor-aware origin.
  if (pixiObject instanceof PIXI.Sprite && !(pixiObject instanceof PIXI.Text)) {
    const w = Math.max(1, Math.ceil(pixiObject.texture?.width || pixiObject.width || 1))
    const h = Math.max(1, Math.ceil(pixiObject.texture?.height || pixiObject.height || 1))
    const anchorX = pixiObject.anchor?.x ?? 0
    const anchorY = pixiObject.anchor?.y ?? 0
    return {
      w,
      h,
      originX: -w * anchorX,
      originY: -h * anchorY,
      usePivot: false, // anchor handles the origin shift, no extra pivot
    }
  }

  // Standard text layers: use sprite-like layout to align mesh with internal sprite positioning.
  const isPixiTextLike = !!(
    (PIXI.Text && pixiObject instanceof PIXI.Text)
    || pixiObject?.constructor?.name === 'Text'
    || (typeof pixiObject?.text === 'string'
      && pixiObject?.style != null
      && typeof pixiObject?.updateText === 'function')
  )
  if (isPixiTextLike) {
    // [TILT-SCALE FIX v2] Use the text's word-wrap width (style.wordWrapWidth)
    // for the logical width.  getLocalBounds().width measures only the glyph
    // extents ("Hi" ≈ 30px), while the selection / hover overlays use
    // style.wordWrapWidth (= layer.width, e.g. 300px).  A mismatch between the
    // tilt mesh base dimensions and the overlay dimensions causes interactions
    // (resize-handle hit targets, corner→mouse deltas) to operate on different
    // spatial scales — producing the "inverted scaling" bug during capture-mode
    // resize of tilted text.
    //
    // Height still comes from getLocalBounds() because it accurately reflects the
    // actual rendered glyph height (which changes with word-wrap reflows).
    const wordWrapWidth = typeof pixiObject.style?.wordWrapWidth === 'number' && pixiObject.style.wordWrapWidth > 0
      ? pixiObject.style.wordWrapWidth
      : (pixiObject.width || 100)
    const w = Math.max(1, Math.ceil(wordWrapWidth))
    let h = pixiObject.height || 40
    try {
      const lb = pixiObject.getLocalBounds()
      if (lb && lb.height > 0) h = lb.height
    } catch (_e) { /* fall back */ }
    h = Math.max(1, Math.ceil(h))
    const anchorX = pixiObject.anchor?.x ?? 0
    const anchorY = pixiObject.anchor?.y ?? 0
    return {
      w,
      h,
      originX: -w * anchorX,
      originY: -h * anchorY,
      usePivot: true,
    }
  }

  // Text and everything else (Containers): use local bounds.
  let lb
  try {
    lb = pixiObject.getLocalBounds()
  } catch (e) {
    lb = { x: 0, y: 0, width: pixiObject.width || 100, height: pixiObject.height || 100 }
  }
  return {
    w: Math.max(1, Math.ceil(lb.width)),
    h: Math.max(1, Math.ceil(lb.height)),
    originX: lb.x || 0,
    originY: lb.y || 0,
    usePivot: true,
  }
}

// ---------------------------------------------------------------------------
// Render-to-texture
// ---------------------------------------------------------------------------

// A tiny detached PIXI.Container reused as a temporary parent during capture.
// Putting the captured object inside this isolated container means PIXI's
// renderer.render({ container, target }) won't compound any of the original
// parent's world transform onto the rendered pixels — a problem that bit us
// after the FIRST capture (when the original parent's worldTransform was
// already non-identity).
//
// [BLACK-MESH FIX] We key the wrapper by renderer instance via a WeakMap.
// A single module-level wrapper was being reused across the editor's
// renderer AND the export's renderer — but a PIXI.Container accumulates
// internal render-state hints (world-transform caches, _didChangeId
// counters, render-group bindings) tied to whichever WebGL context last
// drew it. Reusing it across two contexts produced silently-empty RTT
// captures during export, which composited as black layers. Per-renderer
// wrappers eliminate the cross-context contamination, and the WeakMap
// entry is GC'd automatically when the export renderer is released.
const _wrapperByRenderer = new WeakMap()
function getCaptureWrapper(renderer) {
  const disableRG = _tiltDisableRenderGroup()

  if (!renderer) {
    // Fallback shared wrapper for any caller that doesn't have a renderer
    // handy yet (very early in init). This path doesn't actually render so
    // cross-context state can't accumulate.
    if (!_wrapperByRenderer._fallback || _wrapperByRenderer._fallback.destroyed) {
      _tdbg('Creating fallback capture wrapper')
      _wrapperByRenderer._fallback = new PIXI.Container()
      _wrapperByRenderer._fallback.label = 'tilt-capture-wrapper-fallback'
      // [BLACK-MESH FIX] Promote wrapper to its own render group so PIXI v8
      // treats each RTT render as an isolated scene root. Without this, a
      // detached Container does not own an instruction set and subsequent
      // renderer.render({ container: wrapper, target: rt }) calls can hit
      // cached empty instructions — producing zero-pixel (i.e. black) RTTs
      // during export where the canvas starts cold.
      _wrapperByRenderer._fallback.isRenderGroup = !disableRG
    }
    return _wrapperByRenderer._fallback
  }
  let wrapper = _wrapperByRenderer.get(renderer)
  if (!wrapper || wrapper.destroyed) {
    _tdbg('Creating new capture wrapper for renderer:', renderer.name || 'unknown', '| isRenderGroup=', !disableRG)
    wrapper = new PIXI.Container()
    wrapper.label = 'tilt-capture-wrapper'
    // [BLACK-MESH FIX] See note above — isRenderGroup guarantees PIXI v8
    // builds a dedicated instruction set for this container on every render,
    // which is required for a detached (parent-less) wrapper to produce
    // non-empty pixels into a RenderTexture.
    wrapper.isRenderGroup = !disableRG
    _wrapperByRenderer.set(renderer, wrapper)
  }
  return wrapper
}

// ---------------------------------------------------------------------------
// [EXPORT-BLACK-MESH] Fallback capture path.
// PIXI v8's `renderer.generateTexture({ target, frame, resolution })` is the
// native API for extracting a texture from a display object.  It internally
// bakes the target's local-space transforms into the RTT WITHOUT mutating the
// scene graph (no detach/reparent).  Using it as a fallback lets us recover
// from the "detached wrapper produces empty pixels" failure mode that's been
// observed during export on many drivers/versions of PIXI v8.
// ---------------------------------------------------------------------------
function _captureViaGenerateTexture(pixiObject, renderer, w, h, originX, originY, resolution) {
  if (!renderer || !pixiObject || pixiObject.destroyed) return null
  if (typeof renderer.generateTexture !== 'function') {
    _twarn('renderer.generateTexture unavailable on this renderer — cannot run fallback')
    return null
  }

  // Save every mutable piece of state we plan to touch so a thrown call
  // can't leave the object in a half-applied state on the way back out.
  const savedX = pixiObject.x
  const savedY = pixiObject.y
  const savedScaleX = pixiObject.scale?.x ?? 1
  const savedScaleY = pixiObject.scale?.y ?? 1
  const savedRotation = pixiObject.rotation
  const savedVisible = pixiObject.visible
  const savedAlpha = pixiObject.alpha
  const savedPivotX = pixiObject.pivot?.x ?? 0
  const savedPivotY = pixiObject.pivot?.y ?? 0

  let texture = null
  try {
    // Reset transforms so `frame` maps cleanly onto the drawn content.
    pixiObject.x = 0
    pixiObject.y = 0
    if (pixiObject.scale) pixiObject.scale.set(1, 1)
    pixiObject.rotation = 0
    pixiObject.visible = true
    pixiObject.alpha = 1
    pixiObject.renderable = true
    if (pixiObject.pivot) pixiObject.pivot.set(0, 0)

    // [EXPORT-BLACK-MESH] PIXI.Text rasterises its glyphs into an internal
    // canvas-backed texture lazily.  During export, seek() flows update the
    // text's style/content without forcing an immediate rasterisation, so by
    // the time generateTexture runs the canvas-source can still be blank.
    // The observed symptom is `generateTexture` returning an RTT whose pixels
    // read back as all zeros ("empty RTT") — exactly the failure mode we
    // captured on the text layer during investigation. Forcing
    // updateText before the capture primes the canvas source so the GPU
    // upload has actual glyph data to read.
    if (pixiObject instanceof PIXI.Text && typeof pixiObject.updateText === 'function') {
      try { pixiObject.updateText(true) } catch (_e) { /* defensive */ }
    }

    const frame = new PIXI.Rectangle(originX, originY, w, h)
    texture = renderer.generateTexture({
      target: pixiObject,
      resolution,
      antialias: false,
      frame,
      clearColor: [0, 0, 0, 0],
    })
    _tdbg(`generateTexture OK: ${pixiObject.label || 'unlabeled'} | frame=${originX},${originY},${w},${h} | res=${resolution}`)
  } catch (e) {
    _twarn('generateTexture fallback threw:', e?.message || e)
  } finally {
    // Always restore — even if generateTexture threw mid-flight.
    pixiObject.x = savedX
    pixiObject.y = savedY
    if (pixiObject.scale) pixiObject.scale.set(savedScaleX, savedScaleY)
    pixiObject.rotation = savedRotation
    pixiObject.visible = savedVisible
    pixiObject.alpha = savedAlpha
    if (pixiObject._tiltHidden) {
      pixiObject.renderable = false
    }
    if (pixiObject.pivot) pixiObject.pivot.set(savedPivotX, savedPivotY)
  }

  return texture
}

// Render the pixiObject's visible output into pixiObject._tiltRenderTexture,
// sized to the tilt layout.  Returns the RT (or null if the render failed).
//
// Why we render even for layers that "have a texture" (Sprite, Text):
// we want the mesh to display EXACTLY what the layer would display — including
// crop masks, fills, strokes, text styles — so the mesh shows the right
// pixels and matches the layer 1:1 at tilt=0.
//
// Critical implementation notes:
//  - We DETACH the pixiObject from its real parent and re-attach it inside a
//    throwaway PIXI.Container at identity transform.  PIXI v8's
//    `renderer.render({ container, target })` walks parent.worldTransform when
//    rendering, so leaving the object attached would bake the scene
//    container's pan/zoom/origin into the captured pixels — that's the
//    "shape vanishes after color/resize change" bug.
//  - We hide the sibling tilt mesh first so it doesn't sneak into the RTT
//    (which would feed back as black on the next capture).
//  - We fully reset x/y/scale/rotation/alpha/pivot for the duration of the
//    render so the layer's geometry lands inside [0,0]–[w,h] of the RT.
function captureToTexture(pixiObject, renderer) {
  if (!renderer || pixiObject.destroyed) return null

  const layout = getTiltLayout(pixiObject)
  const { w, h, originX, originY } = layout

  const rttW = Math.max(1, Math.ceil(w))
  const rttH = Math.max(1, Math.ceil(h))

  // [IMG-QUALITY Blur Fix] Account for the layer's scale on the stage.
  // If a layer is 100x100 but scaled to 1000x1000, we need a resolution of 10
  // (capped by MAX_RTT_RESOLUTION and MAX_RTT_DIMENSION) to keep it crisp.
  const layerScale = Math.max(Math.abs(pixiObject.scale?.x || 1), Math.abs(pixiObject.scale?.y || 1))
  const rendererRes = renderer?.resolution || 1
  const isExport = !!renderer?._isExportRenderer

  // [TILT-QUALITY BOOST] Perspective distortion stretches the "near" edge of
  // the mesh. If we only capture at 1:1 screen density, the near edge will
  // look blurry. 
  // [PERF] During export, we use a conservative 1.1x boost to balance quality
  // and render speed (since RTT-to-Canvas readback is the bottleneck).
  // In the editor, we use 1.5x to ensure crispness even during user zoom.
  const boost = isExport ? 1.1 : 1.5
  const targetRes = rendererRes * Math.max(1, layerScale) * boost

  const largestDim = Math.max(rttW, rttH)
  const capResolution = largestDim > 0 ? (MAX_RTT_DIMENSION / largestDim) : rendererRes

  // [CROP PERF] If cropping, cap the resolution to avoid GPU stall during active drag.
  const isCropping = !!pixiObject._isCropping
  const isVideo = !!(pixiObject._videoElement || (pixiObject._videoSprite?.texture?.source?.resource instanceof HTMLVideoElement))
  const cropResCap = isCropping ? (isVideo ? 0.75 : 1.25) : 99

  // Final resolution is the lower of what we need vs what we can afford.
  const resolution = Math.max(0.5, Math.min(targetRes, capResolution, MAX_RTT_RESOLUTION, cropResCap))

  const label = pixiObject.label || pixiObject.constructor?.name || 'unlabeled'

  // [PERF-DEBUG] Log every RTT capture to diagnose tilt slider lag
  const _perfStart = performance.now()
  _tdbg(`captureToTexture start: ${label} | dims: ${w}x${h} | res: ${resolution} | isExport: ${isExport}`)


  // ────────────────────────────────────────────────────────────────────────
  // [EXPORT-BLACK-MESH v6] Robust PIXI.Text detection + early bypass.
  //
  // The earlier `pixiObject instanceof PIXI.Text` check failed silently on
  // this build — the v5 "Text bypass" log never fired despite the debug
  // log clearly reporting `type=Text` on the object.  This is the classic
  // dual-PIXI-instance issue: Vite HMR / the bundler's module dedup can
  // end up with two separate copies of `pixi.js` in memory, so the
  // `PIXI.Text` class referenced HERE is a different constructor than the
  // one the text layer was built with.  `instanceof` then returns false.
  //
  // We fix this by duck-typing on the display object instead of relying
  // on class identity.  A PIXI.Text has: a string `text`, a `style`
  // object, and an `updateText` method.  Any object matching those three
  // is a text layer regardless of which PIXI instance built it.  The
  // constructor-name check is belt-and-braces for minified builds (our
  // debug log already prints `type=Text`, so this name is stable).
  //
  // And we run the whole thing BEFORE the RTT allocation below — if the
  // bypass succeeds we never hit the broken clear path at all, and we
  // don't leak a fresh RenderTexture that we'd immediately throw away.
  // ────────────────────────────────────────────────────────────────────────
  const isPixiTextLike = (
    (PIXI.Text && pixiObject instanceof PIXI.Text)
    || pixiObject?.constructor?.name === 'Text'
    || (typeof pixiObject?.text === 'string'
      && pixiObject?.style != null
      && typeof pixiObject?.updateText === 'function')
  )

  if (isPixiTextLike) {
    // Prime the canvas2d rasteriser so `text.texture` is current (best
    // effort — we don't rely on it actually producing a usable texture).
    if (typeof pixiObject.updateText === 'function') {
      try { pixiObject.updateText(true) } catch (_e) { /* defensive */ }
    }

    // ────────────────────────────────────────────────────────────────────
    // [EXPORT-BLACK-MESH v7] Two-step text bypass.
    //
    // Path 1 — borrow `text.texture` directly.  This is the cheapest
    // option when the live text object already has a usable canvas-backed
    // texture attached.  On this PIXI v8 build, though, `text.texture`
    // frequently shows up as null or destroyed during export (logs:
    // "Text-like object has no usable texture on layer-…"), so we can't
    // depend on it.
    //
    // Path 2 — fresh canvas2d rasterisation.  When path 1 can't return a
    // texture, we draw the glyphs onto a new `<canvas>` ourselves using
    // the Text's style fields and wrap it in a PIXI.Texture.  Canvas2d
    // transparency isn't affected by the broken WebGL RTT clear, so this
    // always produces a texture with correctly transparent padding around
    // the letters — exactly what the tilt mesh needs.
    // ────────────────────────────────────────────────────────────────────
    let bypassTex = null

    try {
      const tex = pixiObject.texture
      if (tex && !tex.destroyed) {
        const tw = tex.width
        const th = tex.height
        const sizeLooksRight = (
          Math.abs(tw - w) / Math.max(w, 1) < 0.1
          && Math.abs(th - h) / Math.max(h, 1) < 0.1
        )
        if (sizeLooksRight) {
          tex._tiltBorrowed = true
          bypassTex = tex
          _tdbg(`Text bypass path1: borrowed text.texture for ${label} (${tw}x${th} vs layout ${w}x${h})`)
        } else {
          _tdbg(`Text bypass path1: text.texture size drift (${tw}x${th} vs ${w}x${h}) — using canvas2d fallback`)
        }
      } else {
        _tdbg(`Text bypass path1: text.texture is ${tex ? 'destroyed' : 'null/undefined'} — using canvas2d fallback`)
      }
    } catch (e) {
      _twarn(`Text bypass path1 read threw:`, e?.message || e)
    }

    if (!bypassTex) {
      const rasterised = _rasterizeTextToCanvasTexture(pixiObject, w, h)
      if (rasterised) {
        bypassTex = rasterised
        _tdbg(`Text bypass path2: rasterised fresh canvas2d texture for ${label} (${rasterised.width}x${rasterised.height} backing ${w}x${h})`)
      }
    }

    if (bypassTex) {
      // Release any prior tilt texture — but never destroy a borrowed
      // live text.texture (would kill the display object's glyph canvas).
      const priorRt = pixiObject._tiltRenderTexture
      if (priorRt && priorRt !== bypassTex && !priorRt.destroyed && !priorRt._tiltBorrowed) {
        priorRt.destroy(true)
      }

      pixiObject._tiltRenderTexture = bypassTex
      pixiObject._tiltCaptureW = w
      pixiObject._tiltCaptureH = h
      pixiObject._tiltRttW = rttW
      pixiObject._tiltRttH = rttH
      pixiObject._tiltCaptureOriginX = originX
      pixiObject._tiltCaptureOriginY = originY
      pixiObject._tiltTextureDirty = false
      return bypassTex
    }

    _twarn(`Text bypass: BOTH paths failed for ${label} — falling through to RTT capture (expect opaque-black output on the broken export clear)`)
  }

  // ────────────────────────────────────────────────────────────────────────
  // Manual override — skip the detach/reparent path and use
  // renderer.generateTexture directly.  Useful for testing whether the
  // primary path is the culprit.  Toggle via
  // window.__TILT_FORCE_GENERATE_TEXTURE = true
  // ────────────────────────────────────────────────────────────────────────
  if (_tiltForceGenerate()) {
    _tdbg(`[force-gen] routing ${label} through renderer.generateTexture`)
    const tex = _captureViaGenerateTexture(pixiObject, renderer, w, h, originX, originY, resolution)
    if (tex) {
      const oldRt = pixiObject._tiltRenderTexture
      pixiObject._tiltRenderTexture = tex
      pixiObject._tiltCaptureW = w
      pixiObject._tiltCaptureH = h
      pixiObject._tiltRttW = rttW
      pixiObject._tiltRttH = rttH
      pixiObject._tiltCaptureOriginX = originX
      pixiObject._tiltCaptureOriginY = originY
      pixiObject._tiltTextureDirty = false
      // Only destroy the prior RT if we actually owned it — a borrowed
      // text.texture from the PIXI.Text bypass must survive the swap.
      if (oldRt && oldRt !== tex && !oldRt.destroyed && !oldRt._tiltBorrowed) oldRt.destroy(true)
      _validateRTTHasPixels(renderer, tex, `force-gen:${label}`)
      return tex
    }
    // Fall through to primary path if generateTexture couldn't run.
  }

  // [BLACK-MESH FIX] Keep the existing RTT alive until the new capture is
  // proven good. The previous code destroyed the old RTT before render and
  // — if the new render silently produced no pixels (or threw) — left
  // mesh.texture bound to a destroyed GL texture, which samples as opaque
  // black on the next composite. This was the root cause of "two tilts
  // work, then crop turns the layer black" in the export pipeline.
  const oldRt = pixiObject._tiltRenderTexture
  const oldRttW = pixiObject._tiltRttW
  const oldRttH = pixiObject._tiltRttH

  // [Jitter Fix / Edge Outlines Fix] Allocate RenderTexture at exact size to prevent
  // bilinear filtering and mipmapping from blending with transparent padding at the edges
  // (which causes blurry/pixelated outlines in Design Mode and black border artifacts in exports).
  // We only use slack padding (64px) during active editor playback or scrubbing to preserve 60fps performance.
  const isPlayingOrScrubbing = getIsPlayingOrScrubbing()
  const slack = isExport ? 1 : (isPlayingOrScrubbing ? 64 : 1)
  const allocW = slack === 1 ? rttW : Math.ceil(rttW / slack) * slack
  const allocH = slack === 1 ? rttH : Math.ceil(rttH / slack) * slack

  // [Jitter Fix] RenderTexture reuse logic.
  // Re-creating the RTT on every frame of a crop/scale animation is expensive
  // and causes jitter. We reuse the old RTT if it's large enough to hold the
  // new content and the resolution hasn't changed significantly.
  const sizeTooSmall = oldRt && (allocW > oldRt.width || allocH > oldRt.height)
  // [PERF] Widened from 128 to 256 to reduce RTT reallocation churn during
  // crop/scale animations. The memory overhead of a slightly oversized RTT is
  // negligible compared to the GPU stall of allocating + deallocating textures.
  // When slack is 1, we require an exact size match to guarantee razor-sharp edges.
  const sizeTooLarge = oldRt && (
    slack === 1
      ? (oldRt.width !== allocW || oldRt.height !== allocH)
      : (allocW < oldRt.width - 256 || allocH < oldRt.height - 256)
  )
  const resMismatch = oldRt && Math.abs(oldRt.resolution - resolution) > 0.01
  const sizeMismatch = oldRt && (sizeTooSmall || sizeTooLarge || resMismatch)
  // If the previous texture was a borrowed text.texture (from the PIXI.Text
  // bypass further up — only reached when a Text object has since become a
  // non-Text layer, or when the bypass fell through on size drift), we must
  // NOT re-use it as a render target.  Writing into PIXI.Text's own texture
  // would corrupt the display object's glyph canvas.
  const oldRtBorrowed = !!(oldRt && oldRt._tiltBorrowed)
  // [EXPORT-BLACK-MESH v8] The export-mode conversion replaces the RTT with
  // a canvas-backed PIXI.Texture.  That IS a valid texture but is NOT a
  // valid `renderer.render` target (it has no framebuffer attached), so
  // the reuse path must allocate a fresh RenderTexture when the previous
  // tilt texture was such a conversion output.
  const oldRtCanvasOwned = !!(oldRt && oldRt._tiltCanvas2dOwned)
  const oldRtUsableAsTarget = !!(oldRt && !oldRt.destroyed && !oldRtBorrowed && !oldRtCanvasOwned)

  let targetRt
  let createdNewRt = false
  if (oldRtUsableAsTarget && !sizeMismatch) {
    targetRt = oldRt
  } else {
    const reason = oldRtBorrowed
      ? 'prev-was-borrowed'
      : oldRtCanvasOwned
        ? 'prev-was-canvas-owned'
        : (sizeMismatch || 'no-old-rt')
    _tdbg(`Creating fresh RTT ${rttW}x${rttH} (mismatch: ${reason})`)
    // Allocate a fresh RT but keep the old one alive — we only swap (and
    // destroy the old) once we know the new render produced valid pixels.
    //
    // [IMG-QUALITY B1] Explicit sampling options:
    //  - scaleMode 'linear': bilinear filtering (defends against drivers
    //    that default to nearest on RenderTextures).
    //  - antialias: smooths sub-pixel edges of the rendered geometry.
    //  - autoGenerateMipmaps: PerspectiveMesh minifies parts of the texture
    //    along the tilt axis. Without mipmaps that minification aliases —
    //    the visible result reads as "blur" / "low-resolution" exactly as
    //    reported for image layers under tilt. Mipmaps must be (re)built
    //    after every render, see updateMipmaps() call below.

    targetRt = PIXI.RenderTexture.create({
      width: allocW,
      height: allocH,
      resolution,
      scaleMode: 'linear',
      antialias: false,
      autoGenerateMipmaps: true,
    })
    createdNewRt = true
  }

  // [VIDEO TILT] If we're capturing a layer that has a <video> source, force
  // PIXI's VideoSource to re-upload the current video frame to the GPU.
  const videoSprite = pixiObject._videoSprite
  const videoSource = videoSprite?.texture?.source
  if (videoSource && typeof videoSource.update === 'function') {
    try {
      _tdbg(`Updating video source for capture`)
      videoSource.update()
    } catch (_e) { /* CORS / tainted: ignore */ }
  }

  // ----- Save state -----
  const savedX = pixiObject.x
  const savedY = pixiObject.y
  const savedScaleX = pixiObject.scale?.x ?? 1
  const savedScaleY = pixiObject.scale?.y ?? 1
  const savedRotation = pixiObject.rotation
  const savedVisible = pixiObject.visible
  const savedAlpha = pixiObject.alpha
  const savedPivotX = pixiObject.pivot?.x ?? 0
  const savedPivotY = pixiObject.pivot?.y ?? 0

  const originalParent = pixiObject.parent
  const originalIndex = originalParent ? originalParent.getChildIndex(pixiObject) : -1

  const mesh = pixiObject._tiltMesh
  const meshVisible = mesh?.visible
  if (mesh && !mesh.destroyed) mesh.visible = false

  const wrapper = getCaptureWrapper(renderer)
  wrapper.position.set(0, 0)

  // [Jitter Fix / Edge Outlines Fix] Scale the wrapper container when slack is 1
  // to fill the allocated RenderTexture exactly. This eliminates any fractional-pixel
  // transparent black padding, preventing bilinear filtering/mipmapping from blending
  // with the background and causing dark fringes or blurry edges.
  const scaleX = slack === 1 ? (allocW / w) : 1
  const scaleY = slack === 1 ? (allocH / h) : 1
  wrapper.scale.set(scaleX, scaleY)

  wrapper.rotation = 0
  wrapper.pivot.set(0, 0)
  wrapper.alpha = 1
  wrapper.visible = true

  if (originalParent) originalParent.removeChild(pixiObject)
  wrapper.addChild(pixiObject)

  // Reset transforms so the visible region lands inside the RT [0,0]–[w,h].
  pixiObject.x = -originX
  pixiObject.y = -originY
  if (pixiObject.scale) pixiObject.scale.set(1, 1)
  pixiObject.rotation = 0
  pixiObject.visible = true
  pixiObject.alpha = 1
  pixiObject.renderable = true
  if (pixiObject.pivot) pixiObject.pivot.set(0, 0)

  // ────────────────────────────────────────────────────────────────────────
  // [EXPORT-BLACK-MESH v5] Plain `clear: true` render for non-text layers.
  //
  // We tried every conceivable way to make this PIXI v8 build produce a
  // transparent RTT clear (per-render `clearColor`, `backgroundAlpha:0`
  // init, overwriting `RenderTarget.clearColor`, explicit
  // `renderer.renderTarget.bind(target, true, [0,0,0,0])`, raw
  // `gl.clearColor + gl.clear` after bind, and `renderer.render` with
  // `clear: false` to stop PIXI re-clearing).  Every single attempt
  // still read back as opaque-black in every corner of the RTT — the
  // GL clear in this build is hard-wired to opaque black and nothing in
  // user space changes that.
  //
  // Worse, the `clear: false + explicit bind` combination regressed
  // non-text layers (shape, image) — they stopped appearing in the
  // export entirely, probably because the explicit bind left PIXI's
  // render-state tracker out of sync with its own expectations.
  //
  // So we go back to the simplest possible thing: a single
  // `renderer.render({ target, clear: true })` call.  For non-text
  // layers this is fine even with an opaque-black clear, because their
  // drawn content covers every pixel of their bounds (a filled Graphics
  // fills its rect; a sprite's quad covers its whole box).  The
  // problematic case — PIXI.Text, where transparent padding leaks the
  // opaque-black clear through — is handled above via the text.texture
  // bypass and never reaches this render path.
  // ────────────────────────────────────────────────────────────────────────
  let captureFailed = false
  try {
    _tdbg(`Executing renderer.render into RTT`)
    renderer.render({
      container: wrapper,
      target: targetRt,
      clear: true,
    })
    _tdbg(`renderer.render call completed`)

    // [IMG-QUALITY B1] Re-build the mipmap chain after every render. PIXI's
    // autoGenerateMipmaps option enables the feature on the source but does
    // NOT regenerate them automatically when the RTT is re-rendered — its
    // contents change every capture, so without this call the mesh keeps
    // sampling stale (or absent) mipmap levels and minification still
    // aliases, defeating the whole point of B1.
    if (targetRt?.source?.autoGenerateMipmaps) {
      try { targetRt.source.updateMipmaps?.() } catch (_e) { /* defensive */ }
    }
  } catch (e) {
    _twarn(`renderer.render FAILED for ${label}:`, e?.message || e)
    captureFailed = true
  }

  // [IMG-QUALITY B-jitter] Constrain the texture's sampled region.
  // When slack is 1, set the frame to the full allocated size (allocW, allocH)
  // because the content has been scaled to fill it exactly (no padding).
  // When slack > 1, set the frame to (w, h) to crop the active region from the padded texture.
  if (!captureFailed && targetRt && !targetRt.destroyed) {
    try {
      const f = targetRt.frame
      if (f) {
        const targetFrameW = slack === 1 ? allocW : w
        const targetFrameH = slack === 1 ? allocH : h
        const drift = (
          Math.abs(f.x) > 1e-3
          || Math.abs(f.y) > 1e-3
          || Math.abs(f.width - targetFrameW) > 1e-3
          || Math.abs(f.height - targetFrameH) > 1e-3
        )
        if (drift) {
          f.x = 0
          f.y = 0
          f.width = targetFrameW
          f.height = targetFrameH
          targetRt.updateUvs?.()
        }
      }
    } catch (_e) { /* defensive */ }
  }

  // ----- Restore state (BEFORE re-parenting) -----
  pixiObject.x = savedX
  pixiObject.y = savedY
  if (pixiObject.scale) pixiObject.scale.set(savedScaleX, savedScaleY)
  pixiObject.rotation = savedRotation
  pixiObject.visible = savedVisible
  pixiObject.alpha = savedAlpha
  if (pixiObject._tiltHidden) {
    pixiObject.renderable = false
  }
  if (pixiObject.pivot) pixiObject.pivot.set(savedPivotX, savedPivotY)

  wrapper.removeChild(pixiObject)
  if (originalParent) {
    const safeIdx = Math.min(originalIndex < 0 ? originalParent.children.length : originalIndex, originalParent.children.length)
    originalParent.addChildAt(pixiObject, safeIdx)
    if (mesh && !mesh.destroyed && mesh.parent === originalParent) {
      const newIdx = originalParent.getChildIndex(pixiObject)
      const meshIdx = originalParent.getChildIndex(mesh)
      const wantedMeshIdx = Math.min(newIdx + 1, originalParent.children.length - 1)
      if (meshIdx !== wantedMeshIdx) originalParent.setChildIndex(mesh, wantedMeshIdx)
    }
  }
  if (mesh && !mesh.destroyed) mesh.visible = meshVisible

  if (captureFailed) {
    // [EXPORT-BLACK-MESH] Primary path threw — try the generateTexture
    // fallback before giving up.  Getting ANY pixels is better than
    // handing mesh.texture a destroyed/empty texture which renders black.
    if (createdNewRt && targetRt && !targetRt.destroyed) {
      targetRt.destroy(true)
    }
    const fallback = _captureViaGenerateTexture(pixiObject, renderer, w, h, originX, originY, resolution)
    if (fallback) {
      _twarn(`primary capture threw for ${label} — generateTexture fallback succeeded`)
      pixiObject._tiltRenderTexture = fallback
      pixiObject._tiltCaptureW = w
      pixiObject._tiltCaptureH = h
      pixiObject._tiltRttW = rttW
      pixiObject._tiltRttH = rttH
      pixiObject._tiltCaptureOriginX = originX
      pixiObject._tiltCaptureOriginY = originY
      pixiObject._tiltTextureDirty = false
      // Skip destroy on a borrowed text.texture — it's not ours to free.
      if (oldRt && oldRt !== fallback && !oldRt.destroyed && !oldRt._tiltBorrowed) oldRt.destroy(true)
      _validateRTTHasPixels(renderer, fallback, `fallback-after-throw:${label}`)
      return fallback
    }
    return null
  }

  // ────────────────────────────────────────────────────────────────────────
  // Post-render validation.  This is the actual signal that identifies the
  // "tilt = black layer" bug during investigation. Validation is now
  // disabled in production and this call is a no-op.
  // ────────────────────────────────────────────────────────────────────────
  const validationResult = _validateRTTHasPixels(renderer, targetRt, label)
  const validationKnownEmpty = validationResult === 0
  if (validationKnownEmpty) {
    _twarn(`primary capture produced EMPTY RTT for ${label} (scene would render black) — attempting generateTexture fallback`)
    const fallback = _captureViaGenerateTexture(pixiObject, renderer, w, h, originX, originY, resolution)
    if (fallback) {
      const fbCheck = _validateRTTHasPixels(renderer, fallback, `fallback:${label}`)
      if (fbCheck === 0) {
        _twarn(`generateTexture fallback ALSO produced empty RTT for ${label} — source geometry may genuinely be blank`)
      }
      // Swap to the fallback.  Destroy the old primary RT so we don't leak.
      pixiObject._tiltRenderTexture = fallback
      pixiObject._tiltCaptureW = w
      pixiObject._tiltCaptureH = h
      pixiObject._tiltRttW = rttW
      pixiObject._tiltRttH = rttH
      pixiObject._tiltCaptureOriginX = originX
      pixiObject._tiltCaptureOriginY = originY
      pixiObject._tiltTextureDirty = false
      if (createdNewRt && targetRt && !targetRt.destroyed) targetRt.destroy(true)
      // Skip destroy on a borrowed text.texture — it's not ours to free.
      if (oldRt && oldRt !== fallback && !oldRt.destroyed && !oldRt._tiltBorrowed) oldRt.destroy(true)
      return fallback
    }
    _twarn(`generateTexture fallback unavailable for ${label} — mesh will render from empty RTT (expect black)`)
  }

  // ────────────────────────────────────────────────────────────────────────
  // [EXPORT-BLACK-MESH v8] Export-only RenderTexture → canvas conversion.
  //
  // When running under the export renderer, a RenderTexture used as a
  // PerspectiveMesh texture renders as an opaque-black rectangle even
  // though the RTT itself contains correct pixels (confirmed by the
  // validator: shapes show rgb 138…255, images show rgb 253).  The text
  // fix proved that canvas-backed textures (PIXI.Texture.from(canvas))
  // DO composite correctly from the same mesh, so we extend the same
  // strategy to every non-text layer here: read the RTT back into an
  // HTMLCanvasElement and wrap it in a plain PIXI.Texture, then hand
  // that to the mesh.  Live canvas is untouched — RTTs are fine there.
  //
  // Conversion runs once per dirty capture, after validation succeeds.
  // If the conversion throws or returns null we fall back to the raw
  // RTT (preserves previous behaviour — at worst we see the same black
  // mesh we were seeing before).
  // ────────────────────────────────────────────────────────────────────────
  if (isExport) {
    const canvasTex = _rttToCanvasBackedTexture(renderer, targetRt, label)
    if (canvasTex) {
      pixiObject._tiltRenderTexture = canvasTex
      pixiObject._tiltCaptureW = w
      pixiObject._tiltCaptureH = h
      pixiObject._tiltRttW = rttW
      pixiObject._tiltRttH = rttH
      pixiObject._tiltCaptureOriginX = originX
      pixiObject._tiltCaptureOriginY = originY
      pixiObject._tiltTextureDirty = false

      // Destroy the intermediate RTT — we don't need GPU-side storage
      // anymore; the canvas-backed texture has its own (shared) source.
      if (targetRt && !targetRt.destroyed && targetRt !== canvasTex) {
        targetRt.destroy(true)
      }
      // Release any previous tilt texture we owned (canvas or RTT),
      // except (a) a borrowed live text.texture and (b) the same ref
      // we just destroyed via targetRt above.
      if (
        oldRt
        && !oldRt.destroyed
        && oldRt !== canvasTex
        && oldRt !== targetRt
        && !oldRt._tiltBorrowed
      ) {
        oldRt.destroy(true)
      }
      return canvasTex
    }
    // Conversion unavailable — fall through to the RTT path below.
    _twarn(`Export canvas conversion returned null for ${label} — keeping RTT (may render black)`)
  }

  // Capture succeeded — promote the new RT (if we allocated one) and only
  // now destroy the previous one.
  if (createdNewRt) {
    pixiObject._tiltRenderTexture = targetRt
    // Skip destroy on a borrowed text.texture — it's not ours to free.
    if (oldRt && !oldRt.destroyed && oldRt !== targetRt && !oldRt._tiltBorrowed) {
      oldRt.destroy(true)
    }
  }

  pixiObject._tiltCaptureW = w
  pixiObject._tiltCaptureH = h
  pixiObject._tiltRttW = rttW
  pixiObject._tiltRttH = rttH
  pixiObject._tiltCaptureOriginX = originX
  pixiObject._tiltCaptureOriginY = originY
  pixiObject._tiltTextureDirty = false



  return targetRt
}

// Pick the texture to put on the mesh.  Prefer the RTT — it gives 1:1 visual
// fidelity even for masked / styled layers — but fall back gracefully if we
// haven't got a renderer yet (very early in init, before _pixiRenderer is
// stamped onto the object by useCanvasLayers).
function resolveMeshTexture(pixiObject, renderer) {
  if (renderer) {
    const captured = captureToTexture(pixiObject, renderer)
    if (captured) return captured
  }

  // Fallbacks (best-effort) — used only when we don't have a renderer yet.
  if (pixiObject instanceof PIXI.Sprite && pixiObject.texture && pixiObject.texture !== PIXI.Texture.EMPTY) {
    return pixiObject.texture
  }
  return PIXI.Texture.WHITE
}

// ---------------------------------------------------------------------------
// Mesh lifecycle
// ---------------------------------------------------------------------------

function ensureMeshParented(pixiObject, mesh) {
  const parent = pixiObject.parent
  if (!parent) return
  const origIdx = parent.getChildIndex(pixiObject)
  if (mesh.parent === parent) {
    const meshIdx = parent.getChildIndex(mesh)
    if (meshIdx !== origIdx + 1) {
      parent.setChildIndex(mesh, Math.min(origIdx + 1, parent.children.length - 1))
    }
  } else {
    parent.addChildAt(mesh, origIdx + 1)
  }
}

// ---------------------------------------------------------------------------
// Video frame sync (fixes the "scrub shows stale frame on tilted video" bug)
// ---------------------------------------------------------------------------
//
// When the user scrubs/seeks a paused video layer that has tilt applied, the
// sequence inside MotionEngine.seek()/scrub() is:
//   1) masterTimeline.pause(time)       → fires onUpdate → _syncTiltedLayers
//      runs, but videoEl.currentTime hasn't moved yet, so no recapture.
//   2) registeredObjects.forEach(...)   → _applyAnimatedTilt() → syncTiltMesh
//      captures the RTT from the still-old video frame.
//   3) syncMedia(time, true)            → sets videoEl.currentTime = target
//      and calls sprite.texture.source.update().
// By the time step 3 finishes the browser may still be decoding the new
// frame, so there's no reliable synchronous moment to recapture.  The robust
// fix is requestVideoFrameCallback: the browser invokes our callback exactly
// when a new decoded frame has been presented to the <video>, regardless of
// whether that frame came from playback, a seek, a scrub, or a scene switch.
// We hook it into every tilted video layer and simply mark the tilt texture
// dirty + resync the mesh on every new frame.

// [PERF] Minimum interval between video-tilt RTT recaptures (ms).
// 50ms ≈ 20fps for playback — more than sufficient for a perspective-warped
// video texture. The tilt mesh doesn't need every decoded frame since the
// perspective distortion itself softens the texture. For scrubbing (seeking
// while paused), we keep a tighter 33ms interval for responsive seeking.
// Throttled further on low-end / mobile devices.
const VIDEO_TILT_CAPTURE_PLAYBACK_MS = 50
const VIDEO_TILT_CAPTURE_SCRUB_MS = 33
const _isLowEndDevice = typeof window !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
function _getVideoCaptureInterval() {
  // On low-end devices, use 66ms (~15fps) to save GPU cycles
  if (_isLowEndDevice) return 100
  return VIDEO_TILT_CAPTURE_PLAYBACK_MS
}
// [PERF] RTT resolution reduction during playback — we render at lower
// resolution to save GPU fill-rate when tilt meshes are being recaptured
// every frame. Still capped by MAX_RTT_DIMENSION.
const PLAYBACK_RTT_RESOLUTION_CAP = 2.0

function attachVideoFrameSync(pixiObject) {
  if (!pixiObject || pixiObject.destroyed) return
  const videoEl = getTiltVideoElement(pixiObject)
  if (!videoEl || typeof videoEl.requestVideoFrameCallback !== 'function') return

  // Already attached — nothing to do.  We use a per-pixiObject handle so
  // re-applying tilt (e.g. animation) doesn't stack multiple callbacks on
  // the same video element.
  if (pixiObject._tiltVideoFrameAttached) return
  pixiObject._tiltVideoFrameAttached = true

  const tick = (_now, _metadata) => {
    // Bail out if tilt has since been removed or the object was destroyed.
    if (!pixiObject || pixiObject.destroyed) {
      pixiObject._tiltVideoFrameHandle = null
      pixiObject._tiltVideoFrameAttached = false
      return
    }
    const mesh = pixiObject._tiltMesh
    if (!mesh || mesh.destroyed) {
      // Mesh was torn down (tilt removed).  Stop re-subscribing — the next
      // applyTiltToObject will re-attach if needed.
      pixiObject._tiltVideoFrameHandle = null
      pixiObject._tiltVideoFrameAttached = false
      return
    }

    // [PERF] When the engine is fully idle (not playing AND not scrubbing),
    // the video frame is static — skip the rVFC subscription.  The playback
    // engine's seek()/scrub() methods explicitly call syncMedia() with a
    // forced texture update that covers the "seeking while paused" path, so
    // we don't miss frame updates during manual scrubbing.  This avoids
    // perpetual GPU RTT recaptures on tilted video layers while the user is
    // simply editing in Design Mode.

    // [PERF] Only subscribe to the next frame if the video is actually
    // playing OR the engine is actively scrubbing/playing.  A paused video
    // with a static frame doesn't need the tilt mesh recaptured every
    // playback-rate frame — the existing RTT capture from the last seek is
    // already correct.  We check the <video> element's paused state plus the
    // per-object throttle below.
    if (videoEl.paused) {
      // Reschedule a check at a much lower frequency (500ms) while paused,
      // in case the video was seeked externally.  This keeps the mesh in
      // eventual sync without the GPU overhead of a per-frame rVFC loop.
      const pausedInterval = 500
      const now = performance.now()
      if (!pixiObject._tiltPausedCheckTime || now - pixiObject._tiltPausedCheckTime > pausedInterval) {
        pixiObject._tiltPausedCheckTime = now
        const currentTime = videoEl.currentTime
        if (pixiObject._tiltLastVideoTime !== currentTime) {
          pixiObject._tiltTextureDirty = true
          pixiObject._tiltLastVideoTime = currentTime
        }
      }
      pixiObject._tiltVideoFrameHandle = setTimeout(() => tick(performance.now(), null), pausedInterval)
      pixiObject._tiltVideoFrameAttached = true  // still "attached" for cleanup tracking
      return
    }

    // [PERF] Throttle: only mark dirty if enough time has passed since the
    // last RTT capture.  The browser fires rVFC at the video's native frame
    // rate (24–60fps), but we only need to recapture at much lower rate
    // (~10-20fps) since perspective distortion softens texture detail anyway.
    // The actual capture happens in the next syncTiltMesh call from
    // _syncTiltedLayers (the engine's per-frame loop), not here — we just
    // set the flag.
    const now = performance.now()
    const lastCapture = pixiObject._tiltLastCaptureTime || 0
    const interval = _getVideoCaptureInterval()
    if (now - lastCapture >= interval) {
      pixiObject._tiltTextureDirty = true
      pixiObject._tiltLastVideoTime = videoEl.currentTime
      // NOTE: We intentionally do NOT call syncTiltMesh here.
      // The engine's _syncTiltedLayers() (called from masterTimeline.onUpdate)
      // will pick up the dirty flag and do the capture in the same frame.
      // Calling syncTiltMesh here too would cause a redundant capture.
    }

    // Re-subscribe for the next frame.
    pixiObject._tiltVideoFrameHandle = videoEl.requestVideoFrameCallback(tick)
  }

  pixiObject._tiltVideoFrameHandle = videoEl.requestVideoFrameCallback(tick)
}

function detachVideoFrameSync(pixiObject) {
  if (!pixiObject) return
  pixiObject._tiltVideoFrameAttached = false
  const handle = pixiObject._tiltVideoFrameHandle
  if (handle == null) return
  const videoEl = getTiltVideoElement(pixiObject)
  if (videoEl && typeof videoEl.cancelVideoFrameCallback === 'function') {
    try { videoEl.cancelVideoFrameCallback(handle) } catch (_e) { /* ignore */ }
  }
  pixiObject._tiltVideoFrameHandle = null
}

// Public: set up (or refresh) the mesh for a given tilt.
// `force` forces a texture recapture even if not flagged dirty (used after the
// caller knows the visible content changed but didn't have a chance to call
// markTiltTextureDirty — e.g. very first apply).
export function applyTiltToObject(pixiObject, tiltXDeg, tiltYDeg, renderer, options = {}) {
  if (!pixiObject || pixiObject.destroyed) return

  const wantTilt = Math.abs(tiltXDeg) >= 0.01 || Math.abs(tiltYDeg) >= 0.01
  const keepMesh = options.keepMesh === true // animations pass true so 0-crossings don't destroy/recreate

  if (!wantTilt && !keepMesh) {
    removeTiltFromObject(pixiObject)
    return
  }

  // Persist the angle on the object so per-frame syncs can pick it up
  // without consulting Redux.
  pixiObject._tiltXDeg = tiltXDeg
  pixiObject._tiltYDeg = tiltYDeg

  // Defensive: any legacy skew value would compound with the perspective.
  if (pixiObject.skew) pixiObject.skew.set(0, 0)

  let mesh = pixiObject._tiltMesh
  const needFreshTexture = !mesh || mesh.destroyed || pixiObject._tiltTextureDirty || options.force === true
  const texture = needFreshTexture
    ? resolveMeshTexture(pixiObject, renderer)
    : (mesh.texture || resolveMeshTexture(pixiObject, renderer))

  if (!mesh || mesh.destroyed) {
    mesh = new PIXI.PerspectiveMesh({
      texture,
      verticesX: MESH_VERTICES,
      verticesY: MESH_VERTICES,
    })
    mesh.eventMode = pixiObject.eventMode || 'static'
    mesh.cursor = pixiObject.cursor || 'pointer'
    mesh.label = pixiObject.label || 'tilt-perspective-mesh'

    // Forward pointer events to the original object so interaction/hover outlines work correctly
    mesh.on('pointerenter', (e) => {
      if (!pixiObject.destroyed) pixiObject.emit('pointerenter', e)
    })
    mesh.on('pointerleave', (e) => {
      if (!pixiObject.destroyed) pixiObject.emit('pointerleave', e)
    })
    mesh.on('pointerdown', (e) => {
      if (!pixiObject.destroyed) pixiObject.emit('pointerdown', e)
    })

    pixiObject._tiltMesh = mesh
  } else if (texture && mesh.texture !== texture) {
    mesh.texture = texture
  }

  ensureMeshParented(pixiObject, mesh)

  // Capture the current "intended" alpha BEFORE we zero the original.
  // syncTiltMesh applies it to mesh.alpha so the displayed opacity is
  // preserved when transitioning from non-tilted -> tilted.
  // [SENTINEL FIX] Only capture if we aren't currently using the sentinel.
  if (Math.abs(pixiObject.alpha - TILT_HIDE_SENTINEL) > 1e-7 || pixiObject._intendedAlpha === undefined) {
    pixiObject._intendedAlpha = Math.abs(pixiObject.alpha - TILT_HIDE_SENTINEL) > 1e-7 ? pixiObject.alpha : 1.0
  }

  // alpha=TILT_HIDE_SENTINEL instead of visible=false so PIXI hit-testing still works.
  // [SENTINEL FIX] 1e-6 allows us to distinguish from user-set alpha=0.
  pixiObject._tiltHidden = true
  pixiObject.alpha = TILT_HIDE_SENTINEL
  pixiObject.renderable = false

  // Override eventMode to none to prevent selection area overshoot on flat bounds
  if (pixiObject._originalEventMode === undefined) {
    pixiObject._originalEventMode = pixiObject.eventMode || 'static'
  }
  pixiObject.eventMode = 'none'

  syncTiltMesh(pixiObject, null)

  // [VIDEO TILT] Keep the mesh in sync with the underlying <video> on every
  // new decoded frame.
  // [PERF] During export, we disable this auto-sync mechanism. The export 
  // loop (videoExport.js) handles frame seeking and synchronization manually 
  // to ensure absolute frame-by-frame precision. Auto-sync would create 
  // redundant captures and race conditions.
  const isExport = !!renderer?._isExportRenderer
  if (!isExport) {
    attachVideoFrameSync(pixiObject)
  }
}

// Cheap per-frame slave: refresh transforms + corners.  No RTT recapture
// unless _tiltTextureDirty is set (e.g. after a content change).  Safe to
// call every frame from interaction handlers.
export function syncTiltMesh(pixiObject, layer, options = {}) {
  if (!pixiObject || pixiObject.destroyed) return
  const mesh = pixiObject._tiltMesh
  if (!mesh || mesh.destroyed) return

  const renderer = pixiObject._pixiRenderer || null
  const isExport = !!renderer?._isExportRenderer

  const tiltXDeg = pixiObject._tiltXDeg || 0
  const tiltYDeg = pixiObject._tiltYDeg || 0

  // [CROP FIX] Detect cropping from options or property flag
  const isCropping = !!options.isCropping || !!pixiObject._isCropping
  const isActivelyResizing = !options.force && !isCropping && !!pixiObject._isResizing

  // [PERF-CRITICAL] Global capture throttle — gates ALL code paths.
  // syncTiltMesh is called from 4+ different sites (applyTransformInline,
  // _syncTiltedLayers, CropAction reactive setters, useCanvasInteractions
  // ticker, etc). Without a per-pixiObject time throttle here, GPU RTT
  // captures happen at 60fps, 5-8x per frame. This is the SINGLE gate
  // that reduces captures to a sustainable rate.
  //   - Playback: 100ms (~10fps) — tilt distortion softens texture anyway
  //   - Video playback: per-video interval (typically 33-100ms)
  //   - Scrubbed/paused: 50ms (~20fps) — responsive enough for seeking
  //   - Force/export: immediate (0ms) — for resize-end sync and export
  //   - Cropping: throttled to 33ms (30fps) for images, 66ms (15fps) for video to keep it smooth and fast
  // [COLOR-ANIMATION FIX] When _tiltTextureDirty is set every frame (e.g. during a
  // ColorChangeAction animation), the 100ms throttle causes the mesh RTT to show
  // stale color for ~6 frames before snapping to the fresh capture — visible as
  // a color "stutter" / flicker.  Bypass the time throttle whenever the layer is
  // actively dirty, so per-frame color changes are captured every frame.
  const label = pixiObject.label || 'tilt-layer'
  const isVideo = !!(pixiObject._videoElement || (pixiObject._videoSprite?.texture?.source?.resource instanceof HTMLVideoElement))
  const captureInterval = options.force
    ? 0
    : (isCropping ? (isVideo ? 66 : 33) : (pixiObject._tiltTextureDirty ? 0 : (isVideo ? _getVideoCaptureInterval() : 100)))
  const now = performance.now()
  const elapsedSinceCapture = now - (pixiObject._tiltLastCaptureTime || 0)
  const isCaptureThrottled = !isExport && captureInterval > 0 && elapsedSinceCapture < captureInterval

  // [JITTER FIX] When the layout dimensions differ from the last captured
  // dimensions (scale/crop/resize animations), the mesh corners will be
  // computed at the new size but the cached RTT texture was captured at
  // the old size — causing a visible "snap back" jitter every throttled
  // frame. Bypass the time throttle whenever dimensions genuinely changed.
  const liveLayout = getTiltLayout(pixiObject)
  const dimsChanged = Math.abs((pixiObject._tiltCaptureW || 0) - liveLayout.w) > 0.5
    || Math.abs((pixiObject._tiltCaptureH || 0) - liveLayout.h) > 0.5

  const shouldCapture = options.force || (pixiObject._tiltTextureDirty && !isActivelyResizing && (!isCaptureThrottled || dimsChanged))

  // Re-capture the texture if visible content changed and we are NOT actively resizing.
  // [Bug 3 Fix] When `force` is true, always recapture regardless of the dirty flag or
  // resize state — this ensures the mesh's RTT always matches the post-Redux-sync PIXI state.
  if (shouldCapture) {
    const renderer = pixiObject._pixiRenderer || null
    _tdbg(`syncTiltMesh: texture dirty, requesting recapture for ${pixiObject.label || 'unlabeled'}`)
    if (renderer) {
      const refreshed = captureToTexture(pixiObject, renderer)
      if (refreshed && mesh.texture !== refreshed) {
        mesh.texture = refreshed
      }
      pixiObject._tiltLastCaptureTime = performance.now()
    } else {
      _twarn(`syncTiltMesh: cannot recapture, no renderer on ${pixiObject.label || 'unlabeled'}`)
      pixiObject._tiltTextureDirty = false
    }
  }

  // Compute the same w/h that captureToTexture used last time so the mesh
  // quad matches the texture exactly.  When no capture has happened yet, fall
  // back to live layout — the mesh will visually catch up on the next sync.
  // If actively resizing, we bypass the cached capture dimensions so the mesh corners 
  // update in real-time according to the live layout dimensions.
  // [Bug 3 Fix] When `force` is true, always recompute from live layout.
  // The cached _tiltCaptureW/H was stamped BEFORE Redux sync, but the RTT
  // was just recaptured AFTER Redux sync. If _storedCropWidth changed between
  // stamp and capture, the cached dims no longer match the actual RTT content.
  const w = pixiObject._tiltCaptureW
  const h = pixiObject._tiltCaptureH
  const useCapture = (typeof w === 'number') && (typeof h === 'number') && !isActivelyResizing && !options.force

  let dimW, dimH, originX, originY, usePivot
  if (useCapture) {
    dimW = w
    dimH = h
    originX = pixiObject._tiltCaptureOriginX || 0
    originY = pixiObject._tiltCaptureOriginY || 0
    const isPixiTextLike = !!(
      (PIXI.Text && pixiObject instanceof PIXI.Text)
      || pixiObject?.constructor?.name === 'Text'
      || (typeof pixiObject?.text === 'string'
        && pixiObject?.style != null
        && typeof pixiObject?.updateText === 'function')
    )
    usePivot = !(pixiObject instanceof PIXI.Sprite) || isCroppedMediaContainer(pixiObject) || isPixiTextLike
  } else {
    const layout = getTiltLayout(pixiObject)
    dimW = layout.w
    dimH = layout.h
    originX = layout.originX
    originY = layout.originY
    usePivot = layout.usePivot
  }

  const corners = computePerspectiveCorners(dimW, dimH, tiltXDeg, tiltYDeg, originX, originY)
  mesh.setCorners(...corners)

  mesh.position.copyFrom(pixiObject.position)
  if (pixiObject.scale && mesh.scale) mesh.scale.copyFrom(pixiObject.scale)
  mesh.rotation = pixiObject.rotation

  if (usePivot && pixiObject.pivot && mesh.pivot) {
    mesh.pivot.copyFrom(pixiObject.pivot)
  } else if (mesh.pivot) {
    mesh.pivot.set(0, 0)
  }

  // If tilted, ensure original object is not hit-testable to prevent selection overshoot
  if (pixiObject._tiltHidden) {
    if (pixiObject.eventMode !== 'none') {
      pixiObject._originalEventMode = pixiObject.eventMode
      pixiObject.eventMode = 'none'
    }
  }

  // Sync interactivity, cursor, and label so the mesh responds to clicks/selection identical to the original
  let targetEventMode = pixiObject._originalEventMode || 'static'
  if (pixiObject._isInteracting || pixiObject._isResizing) {
    targetEventMode = 'none'
  }
  mesh.eventMode = targetEventMode
  mesh.cursor = pixiObject.cursor || 'pointer'
  if (pixiObject.label) {
    mesh.label = pixiObject.label
  }

  // ---- Tilt-hide invariant (defensive) ---------------------------------
  // GSAP tweens (FadeAction, baseline `set`s, etc.) write directly to
  // pixiObject.alpha and don't know that the original is supposed to stay
  // hidden behind the perspective mesh.  Re-assert alpha=0 every sync so
  // the original never re-appears alongside the mesh — and capture whatever
  // alpha GSAP tried to write as the "intended" displayed opacity, which
  // we forward to mesh.alpha so fades still look right on the mesh.
  if (pixiObject._tiltHidden) {
    if (Math.abs(pixiObject.alpha - TILT_HIDE_SENTINEL) > 1e-7) {
      // Some other tween (FadeAction) or direct write (useCanvasLayers) 
      // wrote to the original's alpha. Capture that as the intended 
      // displayed alpha then re-hide.
      pixiObject._intendedAlpha = pixiObject.alpha
      pixiObject.alpha = TILT_HIDE_SENTINEL
    }
    // _intendedAlpha is the single source of truth for displayed opacity
    // when tilted — interactive code (useCanvasLayers step 6) writes the
    // user/captured opacity into it, and the defensive block above keeps
    // it in sync with any FadeAction tween on the original.
    let desiredAlpha
    if (typeof pixiObject._intendedAlpha === 'number') {
      desiredAlpha = pixiObject._intendedAlpha
    } else if (layer?.opacity !== undefined && layer?.opacity !== null) {
      desiredAlpha = layer.opacity
    } else {
      desiredAlpha = 1
    }
    mesh.alpha = desiredAlpha
  } else {
    // Not tilted-hidden (we may be in keepMesh during a 0-crossing animation):
    // mesh just mirrors the layer/object opacity.
    if (layer?.opacity !== undefined && layer?.opacity !== null) {
      mesh.alpha = layer.opacity
    } else if (typeof pixiObject._intendedAlpha === 'number') {
      mesh.alpha = pixiObject._intendedAlpha
    } else {
      mesh.alpha = pixiObject.alpha != null ? pixiObject.alpha : 1
    }
  }

  // Honour layer visibility — important during scene transitions.
  //
  // Read pixiObject.visible directly instead of a cached flag.  The previous
  // implementation relied on `_tiltOwnerVisible`, which was only refreshed
  // from inside applyTransformInline step 8.  That step is skipped whenever
  // applyTransformInline early-returns (during playback, and for ~200ms
  // after any seek because MotionEngine.getIsPlaying() stays true inside
  // that grace window).  As a result the cached flag went stale in exactly
  // the two cases that mattered:
  //   • Scene switch while paused → the stale `true` leaked tilted meshes
  //     from other scenes onto the current scene's canvas.
  //   • Playback crossing a scene boundary → the stale `false` hid the
  //     destination scene's tilted meshes until the user paused and reselected.
  // The per-frame _syncTiltedLayers tick kept re-asserting the wrong value
  // from the cache, masking useCanvasLayers' correct visibility writes.
  //
  // captureToTexture temporarily sets pixiObject.visible=true but restores
  // it before returning, and that capture always runs BEFORE this block
  // when called from syncTiltMesh, so reading .visible here is safe.
  mesh.visible = pixiObject.visible !== false

  ensureMeshParented(pixiObject, mesh)

  // Sync filters (e.g. blur) onto the perspective mesh so animated filters apply to the mesh
  if (pixiObject.filters) {
    if (mesh.filters !== pixiObject.filters) {
      mesh.filters = pixiObject.filters
    }
  } else {
    if (mesh.filters) {
      mesh.filters = null
    }
  }

  // Touch the value to avoid IDE warning on unused MIN_TILT_RAD.
  void MIN_TILT_RAD
}

/**
 * Lightweight per-frame sync for engine animation loops. Mirrors the
 * original PIXI object's transform onto the perspective mesh and re-asserts
 * the tilt-hide invariant so GSAP-touched alphas don't reveal the original.
 * Cheap enough to call every tick for every tilted registered object.
 */
export function syncTiltedDisplay(pixiObject, options = {}) {
  if (typeof options === 'string') {
    options = {}
  }
  if (!pixiObject || pixiObject.destroyed) return
  const mesh = pixiObject._tiltMesh
  if (!mesh || mesh.destroyed) return

  const renderer = pixiObject._pixiRenderer || null
  const isExport = !!renderer?._isExportRenderer

  const now = performance.now()
  if (!isExport && !options.force && pixiObject._tiltSyncedThisFrame && now - pixiObject._tiltSyncedThisFrame < 2) {
    return
  }
  pixiObject._tiltSyncedThisFrame = now

  const videoEl = pixiObject._videoElement
    || (pixiObject._videoSprite?.texture?.source?.resource instanceof HTMLVideoElement
      ? pixiObject._videoSprite.texture.source.resource
      : null)
  if (videoEl) {
    const t = videoEl.currentTime
    if (pixiObject._tiltLastVideoTime !== t) {
      const lastCapture = pixiObject._tiltLastCaptureTime || 0
      const interval = _getVideoCaptureInterval()
      if (isExport || now - lastCapture >= interval) {
        pixiObject._tiltTextureDirty = true
        pixiObject._tiltLastVideoTime = t
      }
    }
  }

  syncTiltMesh(pixiObject, null, options)
}

export function removeTiltFromObject(pixiObject) {
  if (!pixiObject) return

  // Unhook the rVFC loop before we tear down the mesh so the browser stops
  // scheduling calls we no longer need.
  detachVideoFrameSync(pixiObject)

  const mesh = pixiObject._tiltMesh
  if (mesh) {
    if (mesh.parent) mesh.parent.removeChild(mesh)
    if (!mesh.destroyed) mesh.destroy()
    pixiObject._tiltMesh = null
  }

  if (pixiObject._tiltRenderTexture) {
    // Skip destroy on a borrowed text.texture — PIXI.Text owns its own
    // texture lifecycle.  Destroying it here would kill the glyph canvas
    // the live Text display object is still using.
    if (!pixiObject._tiltRenderTexture.destroyed && !pixiObject._tiltRenderTexture._tiltBorrowed) {
      pixiObject._tiltRenderTexture.destroy(true)
    }
    pixiObject._tiltRenderTexture = null
  }

  if (!pixiObject.destroyed && pixiObject._tiltHidden) {
    // Restore the displayed opacity that the tilt system was hiding.
    // [SENTINEL FIX] Re-assert the intended alpha once the sentinel is gone.
    const restoreAlpha = (typeof pixiObject._intendedAlpha === 'number') ? pixiObject._intendedAlpha : 1
    pixiObject.alpha = restoreAlpha

    // Restore renderable state
    pixiObject.renderable = true

    // Restore the original eventMode
    if (pixiObject._originalEventMode !== undefined) {
      pixiObject.eventMode = pixiObject._originalEventMode
      delete pixiObject._originalEventMode
    }

    delete pixiObject._tiltHidden
  }

  delete pixiObject._tiltXDeg
  delete pixiObject._tiltYDeg
  delete pixiObject._tiltTextureDirty
  delete pixiObject._tiltCaptureW
  delete pixiObject._tiltCaptureH
  delete pixiObject._tiltRttW
  delete pixiObject._tiltRttH
  delete pixiObject._tiltCaptureOriginX
  delete pixiObject._tiltCaptureOriginY
  delete pixiObject._tiltOwnerVisible
  delete pixiObject._intendedAlpha
  delete pixiObject._originalEventMode
  // [PERF] Clean up throttle/dedup tracking added for RC1/RC5 fixes
  delete pixiObject._tiltLastCaptureTime
  delete pixiObject._tiltSyncedThisFrame
  delete pixiObject._tiltLastVideoTime

  if (pixiObject.skew && !pixiObject.destroyed) {
    pixiObject.skew.set(0, 0)
  }
}

// Force a texture recapture on next sync.  Kept for callers that want to be
// explicit (and for backwards compatibility).
export function updateTiltTexture(pixiObject, renderer) {
  if (!pixiObject || pixiObject.destroyed) return
  pixiObject._tiltTextureDirty = true
  if (pixiObject._tiltMesh && !pixiObject._tiltMesh.destroyed && renderer) {
    const refreshed = captureToTexture(pixiObject, renderer)
    if (refreshed && pixiObject._tiltMesh.texture !== refreshed) {
      pixiObject._tiltMesh.texture = refreshed
    }
  }
}
