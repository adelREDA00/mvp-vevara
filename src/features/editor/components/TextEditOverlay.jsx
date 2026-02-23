import { useRef, useEffect, useState, useMemo, useCallback } from 'react'

/**
 * TextEditOverlay provides a seamless HTML-based text editing experience.
 * It replaces the brittle PIXI-to-HTML syncing logic with a direct 1:1 match
 * of styles, letting the browser handle naturally wrapping text.
 */
function TextEditOverlay({
  layer,
  textObject,
  onTextChange,
  onFinishEditing,
  viewport,
  canvasContainer,
}) {
  const editableDivRef = useRef()
  const [isInitialized, setIsInitialized] = useState(false)

  // Reset initialization when layer changes
  useEffect(() => {
    setIsInitialized(false)
  }, [layer?.id])

  // Initialize content once per editing session
  useEffect(() => {
    if (layer?.data?.content && editableDivRef.current && !isInitialized) {
      // Direct assignment of content. We let the browser handle wrapping.
      editableDivRef.current.innerText = layer.data.content
      setIsInitialized(true)

      // Auto-focus and select all text for immediate editing
      setTimeout(() => {
        editableDivRef.current.focus()
        // Select all text
        const range = document.createRange()
        range.selectNodeContents(editableDivRef.current)
        const selection = window.getSelection()
        selection.removeAllRanges()
        selection.addRange(range)
      }, 0)
    }
  }, [layer?.data?.content, isInitialized, layer?.id])

  const handleTextChange = (e) => {
    // browser's innerText on contentEditable often adds a trailing \n
    let newText = e.target.innerText || ''
    if (newText.endsWith('\n')) {
      newText = newText.slice(0, -1)
    }
    onTextChange(newText)
  }

  const handleBlur = () => {
    onFinishEditing()
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      onFinishEditing()
    }
  }

  const handlePaste = (e) => {
    e.preventDefault()
    const text = e.clipboardData.getData('text/plain')

    // Use execCommand to insert plain text (preserves undo history in some browsers)
    // or manually insert if cursor position is needed.
    document.execCommand('insertText', false, text)

    // Ensure the manual change triggers the Redux update immediately
    if (editableDivRef.current) {
      onTextChange(editableDivRef.current.innerText)
    }
  }

  // Consolidate styling logic to ensure perfect parity during all viewport changes
  const syncStyles = useCallback(() => {
    if (!layer || !viewport || !canvasContainer || !editableDivRef.current) return

    const zoomScale = viewport.scale.x
    const screenPos = viewport.toScreen(layer.x || 0, layer.y || 0)
    const canvasRect = canvasContainer.getBoundingClientRect()

    // Calculate current screen units
    // [WRAP FIX] Math.floor width to avoid sub-pixel DOM wrapping discrepancies
    const scaledWidth = Math.floor((layer.width || 200) * zoomScale)
    const fontSize = (layer.data?.fontSize || 24) * zoomScale
    const lineHeight = fontSize * 1.2

    const style = editableDivRef.current.style

    // Core Layout
    // Position accurately at the center origin
    style.left = `${canvasRect.left + screenPos.x}px`
    style.top = `${canvasRect.top + screenPos.y}px`
    style.width = `${scaledWidth}px` // [WRAP FIX] Match PIXI wordWrapWidth exactly

    // Text Metrics
    style.fontSize = `${fontSize}px`
    style.lineHeight = `${lineHeight}px`

    // Center and Rotate: Using translate(-50%, -50%) ensures the HTML overlay 
    // is centered on the PIXI coordinate, and rotate() matches the layer's rotation.
    const rotation = layer.rotation || 0
    // [SYNC FIX] 0.35px nudge for baseline alignment parity
    style.transform = `translate(-50%, -50%) rotate(${rotation}deg) translateY(0.35px)`

    // Constant Styles
    style.fontFamily = layer.data?.fontFamily || 'Arial'
    style.fontWeight = layer.data?.fontWeight || 'normal'
    style.color = layer.data?.color || '#000000'
    style.textAlign = layer.data?.textAlign || 'left'
    style.letterSpacing = '0' // [WRAP FIX] Match PIXI
    style.wordSpacing = '0'   // [WRAP FIX] Match PIXI
    style.padding = '0'
    style.margin = '0'
    style.border = 'none'
    style.outline = 'none'
    style.boxSizing = 'content-box'
    style.opacity = layer.opacity !== undefined ? layer.opacity : 1
    style.webkitFontSmoothing = 'antialiased' // Ensure crisp DOM text match
  }, [layer, viewport, canvasContainer])

  // Synchronize overlay position and styling on initial render and prop changes
  useEffect(() => {
    syncStyles()
  }, [syncStyles])

  // Continuous tracking for smooth zoom/pan (Canva-style performance)
  useEffect(() => {
    if (!viewport || !canvasContainer || !layer) return

    let animationFrameId = null
    let lastViewportX = viewport.x
    let lastViewportY = viewport.y
    let lastViewportScale = viewport.scale.x

    const checkViewportChanges = () => {
      if (viewport.x !== lastViewportX ||
        viewport.y !== lastViewportY ||
        viewport.scale.x !== lastViewportScale) {

        syncStyles()

        lastViewportX = viewport.x
        lastViewportY = viewport.y
        lastViewportScale = viewport.scale.x
      }
      animationFrameId = requestAnimationFrame(checkViewportChanges)
    }

    animationFrameId = requestAnimationFrame(checkViewportChanges)

    // Also sync on specific viewport events for immediate reaction
    viewport.on('moved', syncStyles)
    viewport.on('zoomed', syncStyles)

    return () => {
      if (animationFrameId) cancelAnimationFrame(animationFrameId)
      viewport.off('moved', syncStyles)
      viewport.off('zoomed', syncStyles)
    }
  }, [layer, viewport, canvasContainer, syncStyles])

  if (!layer) return null

  return (
    <div
      ref={editableDivRef}
      contentEditable
      suppressContentEditableWarning={true}
      onInput={handleTextChange}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      className="text-edit-overlay"
      style={{
        // Default style - will be overridden by the sync effect
        position: 'fixed',
        zIndex: 10000,
        outline: 'none',
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
        wordBreak: 'break-word',
      }}
    />
  )
}

export default TextEditOverlay


