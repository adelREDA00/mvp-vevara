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

    const zoomScale = viewport.scale.x
    const screenPos = viewport.toScreen(layer.x || 0, layer.y || 0)
    const canvasRect = canvasContainer.getBoundingClientRect()

    const scaledWidth = Math.floor((layer.width || 200) * zoomScale)
    const fontSize = (layer.data?.fontSize || 24) * zoomScale
    const lineHeight = fontSize * 1.2

    const style = editableDivRef.current.style

    style.left = `${canvasRect.left + screenPos.x}px`
    style.top = `${canvasRect.top + screenPos.y}px`
    style.width = `${scaledWidth}px`

    style.fontSize = `${fontSize}px`
    style.lineHeight = `${lineHeight}px`

    const rotation = layer.rotation || 0
    style.transform = `translate(-50%, -50%) rotate(${rotation}deg) translateY(0.35px)`

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
    style.opacity = layer.opacity !== undefined ? layer.opacity : 1
    style.webkitFontSmoothing = 'antialiased'
  }, [layer, viewport, canvasContainer])

  useEffect(() => {
    syncStyles()
  }, [syncStyles])

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
    viewport.on('moved', syncStyles)
    viewport.on('zoomed', syncStyles)

    return () => {
      if (animationFrameId) cancelAnimationFrame(animationFrameId)
      viewport.off('moved', syncStyles)
      viewport.off('zoomed', syncStyles)
    }
  }, [layer, viewport, canvasContainer, syncStyles])

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
