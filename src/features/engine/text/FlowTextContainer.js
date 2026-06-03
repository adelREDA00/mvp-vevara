import * as PIXI from 'pixi.js'
import { prepareWithSegments, layoutWithLines } from '@chenglou/pretext'
import { calculateAvailableSpansAtY, layoutWaterFlow, getLocalObstacles } from './textFlowEngine'

/**
 * FlowTextContainer
 * 
 * A high-performance PIXI container for text wrapping.
 * Uses Pretext for layout and pools PIXI.Text objects for lines.
 * 
 * PIVOT SYSTEM:
 *   pivot.x = width / 2
 *   pivot.y = actualHeight / 2
 * This ensures Redux (x, y) represents the CENTER of the text box.
 * Unlike PIXI.Text (which uses anchor to offset rendering), Container
 * has no anchor, so pivot must always be the geometric center.
 * Text alignment is applied by offsetting child line positions in _syncLines.
 */
export class FlowTextContainer extends PIXI.Container {
  constructor(config) {
    super()

    this.id = config.id
    this.data = config.data || {}
    this._content = this.data.content || 'Text'
    this._fontFamily = this.data.fontFamily || 'Arial'
    this._fontSize = this.data.fontSize || 24
    this._color = this.data.color || '#000000'
    this._textAlign = this.data.textAlign || 'left'
    this._fontWeight = this.data.fontWeight || 'normal'
    this._fontStyle = this.data.fontStyle || 'normal'
    this._lineHeight = this._fontSize * 1.2
    this._wordWrapWidth = config.width || 200
    this._actualHeight = this._lineHeight // Initial estimate before first layout
    this._revealProgress = 1 // 0 to 1 for typewriter effect

    // Pooling: re-use text objects for lines
    this._linePool = []
    this._activeLines = []

    // Metadata for engine
    this.isFlowText = true
    this._lastObstaclesHash = ''

    // [STABILITY FIX] Use a stable zero-pivot.
    // Line positions from the engine are now centered around (0,0).
    // This ensures coordinate mapping is invariant to text height changes.
    this.pivot.set(0, 0)

    // Anchor metadata for selection box alignment (0.5, 0.5 = centered)
    this.anchor = { set: (x, y) => { }, x: 0.5, y: 0.5 }

    // Pre-calculate segments and perform initial refresh to settle pivot
    this._prepare()
    this.refresh([])

    // [INTERACTION FIX] Ensure initial hitArea covers the estimated height
    this.hitArea = new PIXI.Rectangle(-this._wordWrapWidth / 2, -this._actualHeight / 2, this._wordWrapWidth, this._actualHeight)
  }

  _prepare() {
    const font = `${this._fontSize}px "${this._fontFamily}"`
    // [PRETEXT FIX] Explicitly pass pre-wrap to preserve \n hard breaks and extra spaces
    this._prepared = prepareWithSegments(this._content, font, { whiteSpace: 'pre-wrap' })
  }

  updateText() {
    this._content = this.data.content || 'Text'
    this._fontFamily = this.data.fontFamily || 'Arial'
    this._fontSize = this.data.fontSize || 24
    this._color = this._color || this.data.color || '#000000'
    this._textAlign = this.data.textAlign || 'left'
    this._fontWeight = this.data.fontWeight || 'normal'
    this._fontStyle = this.data.fontStyle || 'normal'
    this._lineHeight = this._fontSize * 1.2

    const anchorX = this._textAlign === 'center' ? 0.5 : (this._textAlign === 'right' ? 1 : 0)
    this.anchor.x = anchorX
    this.anchor.y = 0

    // Constant stable pivot
    this.pivot.set(0, 0)
    this.anchor.x = 0.5
    this.anchor.y = 0.5

    this._prepare()
    this.refresh(this._lastObstacles || [])
  }

  /**
   * Refreshes the text layout based on world obstacles.
   */
  refresh(worldObstacles) {
    // [PERFORMANCE] Fingerprint-based dirty check.
    // If obstacles haven't moved or changed dimensions, skip the expensive layout calculation.
    const currentHash = this._getObstaclesHash(worldObstacles)
    const contentHash = `${this._content}:${this._wordWrapWidth}:${this._fontSize}:${this._textAlign}:${this._fontFamily}:${this._color}:${this.data.fontWeight || 'normal'}:${this.data.fontStyle || 'normal'}`

    if (this._lastObstaclesHash === currentHash && this._lastContentHash === contentHash) {
      return
    }

    this._lastObstaclesHash = currentHash
    this._lastContentHash = contentHash
    this._lastObstacles = worldObstacles

    const localObstacles = getLocalObstacles(this, worldObstacles)

    // Calculate layout using water flow engine
    const { lines, height, width } = layoutWaterFlow(
      this._prepared,
      this._wordWrapWidth,
      this._lineHeight,
      localObstacles,
      this._actualHeight || 100
    )

    // Sync PIXI.Text objects from pool
    this._syncLines(lines)

    // [STABILITY] actualHeight is used for selection box and interaction center calculations.
    // The pivot remains (0, 0) as lines are pre-centered by the engine.
    this._actualHeight = height
    this._actualWidth = width > 0 ? width : this._wordWrapWidth

    // [INTERACTION FIX] Update hitArea to cover the full width and height.
    // FlowTextContainer uses a centered coordinate system where (0,0) is the text box center.
    this.hitArea = new PIXI.Rectangle(-this._wordWrapWidth / 2, -height / 2, this._wordWrapWidth, height)
  }

  _getObstaclesHash(obstacles) {
    // [BIDIRECTIONAL FIX] Include our own world transform in the hash.
    // If the text container moves, rotates, or scales, it affects the relative 
    // position of world-space obstacles in local space, so we MUST invalidate.
    const t = this.worldTransform
    let hash = `self:${t.tx.toFixed(1)},${t.ty.toFixed(1)},${t.a.toFixed(3)},${t.b.toFixed(3)},${t.c.toFixed(3)},${t.d.toFixed(3)}|`

    if (!obstacles || obstacles.length === 0) return hash + 'none'

    // Create a fast-to-compute string representing the state of all obstacles
    for (let i = 0; i < obstacles.length; i++) {
      const o = obstacles[i]
      // Round to whole pixels to completely ignore sub-pixel micro-drifts during interaction
      hash += `${o.id}:${Math.round(o.x)},${Math.round(o.y)},${Math.round(o.width)},${Math.round(o.height)}|`
    }
    return hash
  }

  _syncLines(linesData) {
    this._lastLines = linesData // Store for revealProgress updates

    // 1. Calculate total character count (grapheme-aware)
    let totalChars = 0
    for (let i = 0; i < linesData.length; i++) {
      // [PERF] Use spread to handle multi-code-unit graphemes correctly
      totalChars += [...linesData[i].text].length
    }

    let charsToShow = Math.floor(this._revealProgress * totalChars)

    // Return all active lines to pool
    this._activeLines.forEach(l => l.visible = false)
    this._activeLines = []

    linesData.forEach((ld, i) => {
      let lineObj = this._linePool[i]
      if (!lineObj) {
        lineObj = new PIXI.Text({
          text: '',
          style: {
            fontFamily: this._fontFamily,
            fontSize: this._fontSize,
            fill: this._color,
            resolution: 2, // Hardcoded sharp resolution
            antialias: true
          }
        })
        this._linePool.push(lineObj)
        this.addChild(lineObj)
      }

      // [STYLE SYNC] Inherit formatting from Redux data
      if (lineObj.style) {
        lineObj.style.fontFamily = this._fontFamily || 'Arial'
        lineObj.style.fontSize = this._fontSize || 24
        lineObj.style.fill = this._color || '#000000'
        lineObj.style.fontWeight = this.data?.fontWeight || 'normal'
        lineObj.style.fontStyle = this.data?.fontStyle || 'normal'
        lineObj.style.align = this._textAlign || 'left'
      }

      // [TYPEWRITER] Slice text based on reveal progress
      let lineText = ld.text
      if (this._revealProgress < 1) {
        const graphemes = [...lineText]
        const lineLen = graphemes.length

        if (charsToShow <= 0) {
          lineText = ''
        } else if (charsToShow < lineLen) {
          lineText = graphemes.slice(0, charsToShow).join('')
          charsToShow = 0
        } else {
          charsToShow -= lineLen
        }
      }

      lineObj.text = lineText
      // Position each line at layout offset + alignment adjustment.
      const availableW = ld.spanWidth || (this._wordWrapWidth - ld.x)
      let alignX = ld.x

      if (this._textAlign === 'center') {
        alignX += (availableW - ld.width) / 2
      } else if (this._textAlign === 'right') {
        alignX += availableW - ld.width
      }
      lineObj.x = alignX
      lineObj.y = ld.y
      lineObj.visible = lineText.length > 0

      // SCALE LOCK: Ensure no character distortion
      lineObj.scale.set(1)

      this._activeLines.push(lineObj)
    })
  }

  /**
   * Efficiently update text color without full re-layout.
   * Called during animation for smooth 60fps performance.
   */
  updateColor(hex) {
    if (this._color === hex) return
    this._color = hex

    // Update active lines directly
    for (let i = 0; i < this._activeLines.length; i++) {
      const line = this._activeLines[i]
      if (line.style) {
        line.style.fill = hex
      }
    }

    // Invalidate content hash to prevent refresh logic from thinking it's dirty 
    // and re-calculating everything if a regular refresh() is called later
    this._lastContentHash = `${this._content}:${this._wordWrapWidth}:${this._fontSize}:${this._textAlign}:${this._fontFamily}:${this._color}:${this.data.fontWeight || 'normal'}:${this.data.fontStyle || 'normal'}`
  }

  // Recursive resolution sync for children
  set resolution(val) {
    this._resolution = val
    this._linePool.forEach(l => {
      if (l.style) l.style.resolution = val
    })
  }

  get resolution() { return this._resolution || 2 }

  /**
   * revealProgress: 0 to 1 property used by TypewriterAction for character reveal.
   */
  get revealProgress() { return this._revealProgress }
  set revealProgress(val) {
    if (this._revealProgress !== val) {
      this._revealProgress = Math.max(0, Math.min(1, val))
      if (this._lastLines) {
        this._syncLines(this._lastLines)
      }
    }
  }

  // [BUG FIX] Decouple logical width (wrapping boundary) from scale
  get wordWrapWidth() { return this._wordWrapWidth }
  set wordWrapWidth(val) {
    if (this._wordWrapWidth !== val) {
      this._wordWrapWidth = val
      this.refresh(this._lastObstacles || [])
    }
  }

  // Prevent PIXI from scaling children when .width is set from Redux
  // CRITICAL: Override both getter and setter to prevent PIXI.Container's 
  // default behavior of setting scale when .width is assigned.
  get width() { return this._wordWrapWidth }
  set width(val) { this.wordWrapWidth = val }

  get height() { return this._actualHeight || 100 }
  set height(val) { /* Ignored: height is managed by content */ }

  getLocalBounds() {
    // Content is centered around (0,0) — lines span [-w/2, w/2] horizontally and [-h/2, h/2] vertically
    const h = this.height
    const w = this._wordWrapWidth
    const rect = new PIXI.Rectangle(-w / 2, -h / 2, w, h)

    // We only log if this is called frequently or during interaction
    // console.log(`[FLOW-BOUNDS] id=${this.id} y=${rect.y} h=${rect.height}`)

    return rect
  }
}
