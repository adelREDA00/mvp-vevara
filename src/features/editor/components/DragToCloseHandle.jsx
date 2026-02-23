import { useRef, useEffect } from 'react'

/**
 * Reusable component for resizable panel right borders with drag-to-close
 * Allows resizing the panel, and closes when dragged too far to the left
 */
export function DragToCloseHandle({ onClose, onWidthChange, initialWidth = 320, minWidth = 200, maxWidth = 600 }) {
  const dragStartXRef = useRef(null)
  const dragStartWidthRef = useRef(null)
  const isDraggingRef = useRef(false)
  const currentWidthRef = useRef(initialWidth)

  // Update current width ref when initialWidth changes
  useEffect(() => {
    currentWidthRef.current = initialWidth
  }, [initialWidth])

  const handleMouseDown = (e) => {
    e.preventDefault()
    e.stopPropagation()
    const clientX = e.clientX || (e.touches && e.touches[0].clientX)
    dragStartXRef.current = clientX
    dragStartWidthRef.current = currentWidthRef.current
    isDraggingRef.current = true
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    document.addEventListener('touchmove', handleMouseMove, { passive: false })
    document.addEventListener('touchend', handleMouseUp)
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'
  }

  const handleMouseMove = (e) => {
    if (!isDraggingRef.current || dragStartXRef.current === null || dragStartWidthRef.current === null) return

    const clientX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0].clientX)
    if (clientX === undefined) return

    const deltaX = clientX - dragStartXRef.current
    const newWidth = Math.min(maxWidth, Math.max(minWidth, dragStartWidthRef.current + deltaX))

    // Update width in real-time for resizing
    if (onWidthChange) {
      onWidthChange(newWidth)
      currentWidthRef.current = newWidth
    }

    // Close panel if dragged too far to the left (more than 150px or width becomes very small)
    // This gives a good threshold - user needs to intentionally drag far to close
    if (deltaX < -150 || newWidth < 100) {
      if (onClose) {
        onClose()
        handleMouseUp()
      }
    }
  }

  const handleMouseUp = () => {
    isDraggingRef.current = false
    dragStartXRef.current = null
    dragStartWidthRef.current = null
    document.removeEventListener('mousemove', handleMouseMove)
    document.removeEventListener('mouseup', handleMouseUp)
    document.removeEventListener('touchmove', handleMouseMove)
    document.removeEventListener('touchend', handleMouseUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }

  return (
    <div
      onMouseDown={handleMouseDown}
      onTouchStart={handleMouseDown}
      className="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize z-10 hover:bg-zinc-700/50 transition-colors"
      style={{
        borderRight: '0.5px solid rgba(255, 255, 255, 0.15)',
      }}
    />
  )
}

