

/**
 * Pauses the viewport drag plugin to prevent conflicts during custom interactions.
 * This is commonly used when implementing custom drag behaviors that should take
 * precedence over the viewport's built-in drag functionality.
 *
 * @param {PIXI.Container} viewport - The viewport instance
 */
export function pauseViewportDragPlugin(viewport) {
  if (!viewport?.plugins) return

  const dragPlugin = viewport.plugins.get('drag')
  if (dragPlugin) {
    dragPlugin.pause()
  }
}

/**
 * Resumes the viewport drag plugin after custom interactions are complete.
 * This restores the viewport's built-in drag functionality.
 *
 * @param {PIXI.Container} viewport - The viewport instance
 */
export function resumeViewportDragPlugin(viewport) {
  if (!viewport?.plugins) return

  const dragPlugin = viewport.plugins.get('drag')
  if (dragPlugin) {
    dragPlugin.resume()
  }
}
