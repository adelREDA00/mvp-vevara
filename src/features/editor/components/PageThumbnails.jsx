import { Plus, ChevronDown } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'

function PageThumbnail({ 
  duration, 
  isActive = false, 
  onClick, 
  pageIndex, 
  width = null,
  onWidthChange,
  defaultWidth = 96
}) {
  const [cardWidth, setCardWidth] = useState(width !== null ? width : defaultWidth)
  const [isResizing, setIsResizing] = useState(false)
  const [resizeSide, setResizeSide] = useState(null) // 'left' or 'right'
  const [startX, setStartX] = useState(0)
  const [startWidth, setStartWidth] = useState(0)
  const [leftOffset, setLeftOffset] = useState(0) // Track permanent left offset for left-side resizing
  const [startLeftOffset, setStartLeftOffset] = useState(0) // Track starting offset when beginning resize
  const cardRef = useRef(null)
  
  // Refs for event handlers to ensure cleanup works correctly
  const handleMouseMoveRef = useRef(null)
  const handleMouseUpRef = useRef(null)

  // Update local width when prop changes
  useEffect(() => {
    if (width !== null) {
      setCardWidth(width)
    }
  }, [width])

  const handleMouseMove = (e) => {
    if (!isResizing || !resizeSide) return

    const deltaX = e.clientX - startX
    let newWidth = startWidth

    if (resizeSide === 'right') {
      // Resize from right: dragging right increases width, dragging left decreases
      newWidth = Math.max(48, startWidth + deltaX) // Minimum width of 48px
    } else if (resizeSide === 'left') {
      // Resize from left: dragging left increases width, dragging right decreases
      // deltaX is negative when dragging left, so we subtract it (which adds to width)
      newWidth = Math.max(48, startWidth - deltaX) // Minimum width of 48px
      // Calculate new offset: shift left by the amount width increased
      const widthDelta = newWidth - startWidth
      setLeftOffset(startLeftOffset - widthDelta)
    }

    setCardWidth(newWidth)
    if (onWidthChange) {
      onWidthChange(pageIndex, newWidth)
    }
  }

  const handleMouseUp = () => {
    setIsResizing(false)
    setResizeSide(null)
    if (handleMouseMoveRef.current) {
      document.removeEventListener('mousemove', handleMouseMoveRef.current)
    }
    if (handleMouseUpRef.current) {
      document.removeEventListener('mouseup', handleMouseUpRef.current)
    }
  }

  // Update refs on each render
  useEffect(() => {
    handleMouseMoveRef.current = handleMouseMove
    handleMouseUpRef.current = handleMouseUp
  })

  const handleMouseDown = (e, side) => {
    e.stopPropagation()
    e.preventDefault()
    setIsResizing(true)
    setResizeSide(side)
    setStartX(e.clientX)
    setStartWidth(cardWidth)
    setStartLeftOffset(leftOffset) // Capture current offset when starting resize
    
    // Add global mouse event listeners
    if (handleMouseMoveRef.current) {
      document.addEventListener('mousemove', handleMouseMoveRef.current)
    }
    if (handleMouseUpRef.current) {
      document.addEventListener('mouseup', handleMouseUpRef.current)
    }
  }

  useEffect(() => {
    return () => {
      document.removeEventListener('mousemove', handleMouseMoveRef.current)
      document.removeEventListener('mouseup', handleMouseUpRef.current)
    }
  }, [])

  const handleCardClick = (e) => {
    // Don't trigger onClick if clicking on resize handle or if we're resizing
    if (e.target.classList.contains('resize-handle') || isResizing) {
      return
    }
    // Check if click originated from a resize handle
    if (e.target.closest('.resize-handle')) {
      return
    }
    if (onClick) {
      onClick()
    }
  }

  return (
    <div 
      className="relative group flex-shrink-0"
      ref={cardRef}
      style={{ 
        width: `${cardWidth}px`,
        marginLeft: `${leftOffset}px`,
        transition: isResizing ? 'none' : 'margin-left 0.1s ease-out, width 0.1s ease-out',
        paddingLeft: '4px',
        paddingRight: '4px',
      }}
    >
      {/* Left resize handle - extends into card area for easier grabbing */}
      <div
        className="resize-handle absolute left-0 top-0 bottom-0 cursor-ew-resize z-30 select-none"
        onMouseDown={(e) => {
          e.stopPropagation()
          e.preventDefault()
          handleMouseDown(e, 'left')
        }}
        style={{
          cursor: 'ew-resize',
          width: '12px',
          left: '0px',
          backgroundColor: isResizing && resizeSide === 'left' ? 'rgba(59, 130, 246, 0.9)' : 'transparent',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          MozUserSelect: 'none',
          msUserSelect: 'none',
          pointerEvents: 'auto',
        }}
        onMouseEnter={(e) => {
          if (!isResizing) {
            e.currentTarget.style.backgroundColor = 'rgba(59, 130, 246, 0.6)'
            e.currentTarget.style.cursor = 'ew-resize'
          }
        }}
        onMouseLeave={(e) => {
          if (!isResizing || resizeSide !== 'left') {
            e.currentTarget.style.backgroundColor = 'transparent'
          }
        }}
        title="Drag to resize width"
      />

      {/* Card content */}
      <div
        onClick={handleCardClick}
        onMouseDown={(e) => {
          // Prevent card click if clicking near the edges (resize zones)
          const rect = e.currentTarget.getBoundingClientRect()
          const clickX = e.clientX - rect.left
          const cardWidth = rect.width
          
          // If clicking within 12px of left or right edge, don't trigger card click
          if (clickX < 12 || clickX > cardWidth - 12) {
            e.stopPropagation()
          }
        }}
        className={`h-10 sm:h-11 md:h-14 bg-white rounded-lg border-2 cursor-pointer shadow-lg transition-colors touch-manipulation flex-shrink-0 relative ${
          isActive ? 'border-blue-500' : 'border-transparent hover:border-blue-500 active:border-blue-400'
        }`}
        style={{ 
          width: '100%',
          minWidth: '48px',
          pointerEvents: 'auto',
        }}
      >
        <div className="absolute bottom-0.5 left-0.5 sm:bottom-1 sm:left-1 md:bottom-1.5 md:left-1.5 text-black text-[8px] sm:text-[8px] md:text-[9px] pointer-events-none z-10">
          {duration}
        </div>
      </div>
      
      {/* Right resize handle - extends into card area for easier grabbing */}
      <div
        className="resize-handle absolute right-0 top-0 bottom-0 cursor-ew-resize z-30 select-none"
        onMouseDown={(e) => {
          e.stopPropagation()
          e.preventDefault()
          handleMouseDown(e, 'right')
        }}
        style={{
          cursor: 'ew-resize',
          width: '12px',
          right: '0px',
          backgroundColor: isResizing && resizeSide === 'right' ? 'rgba(59, 130, 246, 0.9)' : 'transparent',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          MozUserSelect: 'none',
          msUserSelect: 'none',
          pointerEvents: 'auto',
        }}
        onMouseEnter={(e) => {
          if (!isResizing) {
            e.currentTarget.style.backgroundColor = 'rgba(59, 130, 246, 0.6)'
            e.currentTarget.style.cursor = 'ew-resize'
          }
        }}
        onMouseLeave={(e) => {
          if (!isResizing || resizeSide !== 'right') {
            e.currentTarget.style.backgroundColor = 'transparent'
          }
        }}
        title="Drag to resize width"
      />
    </div>
  )
}

function PageThumbnails({ pages = [], currentPage = 0, onPageClick, onAddPage, onPageWidthChange }) {
  const formatDuration = (duration) => {
    if (typeof duration === 'number') {
      return `${duration.toFixed(1)}s`
    }
    return duration || '0.0s'
  }

  // Initialize page widths if not present
  const [pageWidths, setPageWidths] = useState(() => {
    const widths = {}
    pages.forEach((page, index) => {
      widths[index] = page.width || 96 // Default width
    })
    return widths
  })

  // Update widths when pages change
  useEffect(() => {
    const newWidths = {}
    pages.forEach((page, index) => {
      newWidths[index] = page.width || pageWidths[index] || 96
    })
    setPageWidths(newWidths)
  }, [pages.length])

  const handleWidthChange = (pageIndex, newWidth) => {
    setPageWidths(prev => ({
      ...prev,
      [pageIndex]: newWidth
    }))
    if (onPageWidthChange) {
      onPageWidthChange(pageIndex, newWidth)
    }
  }

  return (
    <div 
      className="flex items-center gap-1.5 sm:gap-2 md:gap-2.5 px-2 sm:px-3 md:px-4 py-1.5 sm:py-2 md:py-2.5 flex-shrink-0 overflow-x-auto scrollbar-hide touch-pan-x backdrop-blur-md" 
      style={{ 
        backgroundColor: 'rgba(13, 18, 22, 0.75)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
      }}
    >
      <div className="flex gap-1.5 sm:gap-2 md:gap-2.5 flex-shrink-0">
        {pages.map((page, index) => (
          <PageThumbnail
            key={index}
            pageIndex={index}
            duration={formatDuration(page.duration || page)}
            isActive={index === currentPage}
            onClick={() => onPageClick && onPageClick(index)}
            width={pageWidths[index]}
            onWidthChange={handleWidthChange}
          />
        ))}
      </div>

      <button
        onClick={onAddPage}
        className="text-zinc-400 hover:text-white active:text-white hover:bg-zinc-800 active:bg-zinc-700 w-12 h-10 sm:w-14 sm:h-11 md:w-[72px] md:h-14 rounded-lg border border-zinc-700 flex-shrink-0 transition-colors flex items-center justify-center touch-manipulation min-w-[48px] sm:min-w-[56px] md:min-w-[72px]"
      >
        <Plus className="h-3 w-3 sm:h-3.5 sm:w-3.5 md:h-4 md:w-4" />
      </button>

      <button className="text-zinc-400 hover:text-white active:text-white hover:bg-zinc-800 active:bg-zinc-700 flex-shrink-0 rounded-md transition-colors flex items-center justify-center h-10 sm:h-11 md:h-14 px-1.5 sm:px-2 md:px-2 touch-manipulation min-w-[32px] sm:min-w-[36px] md:min-w-[40px]">
        <ChevronDown className="h-3 w-3 sm:h-3.5 sm:w-3.5 md:h-4 md:w-4" />
      </button>
    </div>
  )
}

export default PageThumbnails

