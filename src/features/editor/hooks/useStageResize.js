import { useEffect, useState } from 'react'

/**
 * Hook to dynamically resize and fit the canvas stage to the window while maintaining aspect ratio.
 * Calculates optimal canvas dimensions based on window size, accounting for sidebar, toolbar,
 * and control panel sizes. Handles responsive breakpoints and mobile optimization.
 * Returns canvas dimensions and scale factor for proper rendering.
 *
 * @param {number} aspectWidth - Target aspect ratio width component (default: 16)
 * @param {number} aspectHeight - Target aspect ratio height component (default: 9)
 * @returns {{ width: number, height: number, scale: number }} Canvas dimensions and scale
 */
export function useStageResize(aspectWidth = 16, aspectHeight = 9) {
  const [dimensions, setDimensions] = useState({ width: 0, height: 0, scale: 1 })

  useEffect(() => {
    function updateDimensions() {
      // Responsive sidebar widths
      const sidebarWidth = window.innerWidth < 640 ? 56 : window.innerWidth < 768 ? 64 : 80
      
      // Properties panel (MotionInspector) is absolutely positioned, so it doesn't affect layout
      
      // Responsive toolbar heights
      const topBarHeight = window.innerWidth < 640 ? 48 : 56
      const canvasControlsHeight = window.innerWidth < 640 ? 48 : 56
      const thumbnailsHeight = window.innerWidth < 640 ? 80 : window.innerWidth < 768 ? 88 : 96
      const bottomToolbarHeight = window.innerWidth < 640 ? 40 : 40
      
      // Account for left sidebar + padding (properties panel is absolute, so doesn't affect layout)
      const windowWidth = window.innerWidth - sidebarWidth - 32
      const windowHeight = window.innerHeight - topBarHeight - canvasControlsHeight - thumbnailsHeight - bottomToolbarHeight - 16 // Account for all bars + padding
      
      const aspectRatio = aspectWidth / aspectHeight
      const windowRatio = windowWidth / windowHeight

      let width, height, scale

      if (windowRatio > aspectRatio) {
        // Window is wider, fit to height
        height = Math.min(windowHeight * 0.9, windowWidth / aspectRatio)
        width = height * aspectRatio
        scale = height / aspectHeight
      } else {
        // Window is taller, fit to width
        width = Math.min(windowWidth * 0.95, windowHeight * aspectRatio)
        height = width / aspectRatio
        scale = width / aspectWidth
      }
      
      // Ensure minimum and maximum sizes for mobile
      const minSize = 200
      const maxWidth = window.innerWidth < 640 ? windowWidth * 0.95 : 1200
      const maxHeight = window.innerHeight < 640 ? windowHeight * 0.95 : 800
      
      width = Math.max(minSize, Math.min(width, maxWidth))
      height = Math.max(minSize, Math.min(height, maxHeight))
      scale = Math.min(scale, width / aspectWidth, height / aspectHeight)

      setDimensions({ width, height, scale })
    }

    updateDimensions()
    window.addEventListener('resize', updateDimensions)
    // Also listen for orientation changes on mobile
    window.addEventListener('orientationchange', () => {
      setTimeout(updateDimensions, 100)
    })
    
    return () => {
      window.removeEventListener('resize', updateDimensions)
      window.removeEventListener('orientationchange', updateDimensions)
    }
  }, [aspectWidth, aspectHeight])

  return dimensions
}

