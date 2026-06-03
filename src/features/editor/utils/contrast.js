/**
 * Theme-aware contrast helper for layer preview cards.
 *
 * Preview cards show a miniature of a layer (text/shape) on top of a card background.
 * If the layer's own color is light (e.g. white text), a light card makes it invisible,
 * and vice-versa. Given the layer's effective color, this returns a card background that
 * always contrasts with it, so the preview stays readable regardless of the editor theme.
 */

// Parse a CSS hex string or PIXI numeric color into { r, g, b }, or null if not resolvable.
function parseColor(color) {
  if (color === undefined || color === null || color === 'transparent') return null

  if (typeof color === 'number') {
    return {
      r: (color >> 16) & 0xff,
      g: (color >> 8) & 0xff,
      b: color & 0xff,
    }
  }

  if (typeof color !== 'string') return null
  let hex = color.trim().replace('#', '')
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('')
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null
  const n = parseInt(hex, 16)
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff }
}

// Perceived luminance (0-255). > ~140 reads as "light".
export function getLuminance(color) {
  const rgb = parseColor(color)
  if (!rgb) return null
  return 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b
}

/**
 * Returns a card background color that contrasts with the given layer color.
 * Falls back to `null` (let the caller use its theme default) when the color
 * can't be parsed (e.g. transparent shapes).
 *
 * @param {string|number} color   The layer's effective text/fill color.
 * @param {boolean} isLight        Whether the editor is in light theme (used only for fallback tuning).
 * @returns {string|null}          A CSS color for the card background, or null.
 */
export function getContrastCardBg(color, isLight = false) {
  const lum = getLuminance(color)
  if (lum === null) return null
  // Light content → dark card; dark content → light card.
  return lum > 140 ? '#1e2230' : '#eceef3'
}
