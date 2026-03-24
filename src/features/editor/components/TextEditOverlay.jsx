import { useRef, useEffect, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'

/**
 * TextEditOverlay provides a seamless HTML-based text editing experience.
 * Rendered via createPortal to document.body to escape the canvas DOM tree
 * (avoids inheriting user-select:none from the stage container).
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

  useEffect(() => {
    setIsInitialized(false)
  }, [layer?.id])

  useEffect(() => {
    if (layer?.data?.content && editableDivRef.current && !isInitialized) {
      editableDivRef.current.innerText = layer.data.content
      setIsInitialized(true)

      setTimeout(() => {
        if (!editableDivRef.current) return
        editableDivRef.current.focus()
        const range = document.createRange()
        range.selectNodeContents(editableDivRef.current)
        const selection = window.getSelection()
        selection.removeAllRanges()
        selection.addRange(range)
      }, 0)
    }
  }, [layer?.data?.content, isInitialized, layer?.id])

  const handleTextChange = (e) => {
    let newText = e.target.innerText || ''
    if (newText.endsWith('\n')) {
      newText = newText.slice(0, -1)
    }
    onTextChange(newText)
  }

  const handleBlur = (e) => {
    if (editableDivRef.current && editableDivRef.current.contains(e.relatedTarget)) {
      return
    }
    onFinishEditing()
  }

  const handleKeyDown = (e) => {
    e.stopPropagation()
    if (e.key === 'Escape') {
      onFinishEditing()
    }
  }

  const handlePaste = (e) => {
    e.preventDefault()
    e.stopPropagation()
    const text = e.clipboardData.getData('text/plain')
    document.execCommand('insertText', false, text)
    if (editableDivRef.current) {
      onTextChange(editableDivRef.current.innerText)
    }
  }

  const syncStyles = useCallback(() => {
    if (!layer || !viewport || !canvasContainer || !editableDivRef.current) return

    // [FIX] Prioritize live PIXI object state for animated layers
    const liveX = textObject?.x ?? (layer.x || 0)
    const liveY = textObject?.y ?? (layer.y || 0)
    const liveRotation = textObject ? (textObject.rotation * 180 / Math.PI) : (layer.rotation || 0)
    const liveAlpha = textObject?.alpha ?? (layer.opacity !== undefined ? layer.opacity : 1)
    
    // [FIX] Synchronize width with intended layer boundaries (wordWrapWidth)
    // IMPORTANT: Width is kept at its BASE value, and live scaling (animation) 
    // is applied via CSS transform: scale() below. This ensures both width 
    // and font-size are perfectly synchronized without double-scaling.
    const liveScaleX = textObject?.scale?.x ?? 1
    const liveScaleY = textObject?.scale?.y ?? 1
    const baseWidth = layer.width || 200

    const zoomScale = viewport.scale.x
    const screenPos = viewport.toScreen(liveX, liveY)
    const canvasRect = canvasContainer.getBoundingClientRect()

    const scaledWidth = Math.floor(baseWidth * zoomScale)

    // [FIX] Mobile auto-zoom prevention: use 16px min font size and scale visually
    const targetFontSize = (layer.data?.fontSize || 24) * zoomScale
    const isMobile = window.matchMedia('(pointer: coarse)').matches
    const mobileMinFont = 16

    let fontSize = targetFontSize
    let visualScale = 1

    if (isMobile && targetFontSize < mobileMinFont) {
      fontSize = mobileMinFont
      visualScale = targetFontSize / mobileMinFont
    }

    const lineHeight = fontSize * 1.2
    const style = editableDivRef.current.style

    // Use fixed positioning relative to viewport to avoid jumping when keyboard opens
    style.left = `${canvasRect.left + screenPos.x}px`
    style.top = `${canvasRect.top + screenPos.y}px`
    style.width = `${scaledWidth / visualScale}px`

    style.fontSize = `${fontSize}px`
    style.lineHeight = `${lineHeight}px`

    // Combined transform: translate to center, rotate, and apply visual scale
    // [FIX] Multiply visualScale (for mobile) by the live animation scale (X and Y)
    // to keep the font-size and width perfectly in sync with the animated PIXI object.
    style.transform = `translate(-50%, -50%) rotate(${liveRotation}deg) scale(${visualScale * liveScaleX}, ${visualScale * liveScaleY})`
    style.transformOrigin = 'center center'

    style.fontFamily = layer.data?.fontFamily || 'Arial'
    style.fontWeight = layer.data?.fontWeight || 'normal'
    style.color = layer.data?.color || '#000000'
    style.textAlign = layer.data?.textAlign || 'left'
    style.letterSpacing = '0'
    style.wordSpacing = '0'
    style.padding = '0'
    style.margin = '0'
    style.border = 'none'
    style.outline = 'none'
    style.boxSizing = 'content-box'
    style.opacity = liveAlpha
    style.webkitFontSmoothing = 'antialiased'
  }, [layer, viewport, canvasContainer, textObject])

  useEffect(() => {
    syncStyles()
  }, [syncStyles])

  useEffect(() => {
    if (!viewport || !canvasContainer || !layer) return

    let animationFrameId = null
    let lastViewportX = viewport.x
    let lastViewportY = viewport.y
    let lastViewportScale = viewport.scale.x
    
    // Track live PIXI object properties
    let lastLayerX = textObject?.x
    let lastLayerY = textObject?.y
    let lastLayerRot = textObject?.rotation
    let lastLayerAlpha = textObject?.alpha
    let lastLayerScaleX = textObject?.scale?.x
    let lastLayerScaleY = textObject?.scale?.y

    const checkUpdates = () => {
      const viewportChanged = viewport.x !== lastViewportX ||
        viewport.y !== lastViewportY ||
        viewport.scale.x !== lastViewportScale
      
      const layerChanged = textObject && (
        textObject.x !== lastLayerX ||
        textObject.y !== lastLayerY ||
        textObject.rotation !== lastLayerRot ||
        textObject.alpha !== lastLayerAlpha ||
        textObject.scale.x !== lastLayerScaleX ||
        textObject.scale.y !== lastLayerScaleY
      )

      if (viewportChanged || layerChanged) {
        syncStyles()
        
        lastViewportX = viewport.x
        lastViewportY = viewport.y
        lastViewportScale = viewport.scale.x
        
        if (textObject) {
          lastLayerX = textObject.x
          lastLayerY = textObject.y
          lastLayerRot = textObject.rotation
          lastLayerAlpha = textObject.alpha
          lastLayerScaleX = textObject.scale.x
          lastLayerScaleY = textObject.scale.y
        }
      }
      animationFrameId = requestAnimationFrame(checkUpdates)
    }

    animationFrameId = requestAnimationFrame(checkUpdates)
    viewport.on('moved', syncStyles)
    viewport.on('zoomed', syncStyles)

    return () => {
      if (animationFrameId) cancelAnimationFrame(animationFrameId)
      viewport.off('moved', syncStyles)
      viewport.off('zoomed', syncStyles)
    }
  }, [layer, viewport, canvasContainer, syncStyles, textObject])

  if (!layer) return null

  const overlayElement = (
    <div
      ref={editableDivRef}
      contentEditable
      suppressContentEditableWarning={true}
      onInput={handleTextChange}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      className="text-edit-overlay"
      style={{
        position: 'fixed',
        zIndex: 10000,
        outline: 'none',
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
        wordBreak: 'break-word',
        userSelect: 'text',
        WebkitUserSelect: 'text',
        MozUserSelect: 'text',
        cursor: 'text',
      }}
    />
  )

  return createPortal(overlayElement, document.body)
}

export default TextEditOverlay
