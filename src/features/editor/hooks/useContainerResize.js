import { useEffect, useState, useRef } from 'react'

/**
 * Hook to dynamically track the size of a container element using ResizeObserver.
 * Returns the actual dimensions of the container, allowing the viewport to fill
 * the available space left by UI elements (navbar, sidebar, bottom section).
 *
 * @param {React.RefObject} containerRef - Reference to the container element
 * @returns {{ width: number, height: number }} Container dimensions
 */
export function useContainerResize(containerRef) {
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 })
  const resizeObserverRef = useRef(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // Create ResizeObserver to track container size changes
    resizeObserverRef.current = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect

        // If dimensions are 0, try parent dimensions
        let finalWidth = width
        let finalHeight = height

        if (finalWidth === 0 || finalHeight === 0) {
          const parentRect = entry.target.parentElement?.getBoundingClientRect()
          if (parentRect) {
            finalWidth = parentRect.width || window.innerWidth * 0.8
            finalHeight = parentRect.height || window.innerHeight * 0.6
          }
        }

        setDimensions({ width: finalWidth, height: finalHeight })
      }
    })

    // Start observing the container
    resizeObserverRef.current.observe(container)

    // Initial size measurement
    const rect = container.getBoundingClientRect()

    // If initial dimensions are 0, try to get parent dimensions as fallback
    let initialWidth = rect.width
    let initialHeight = rect.height

    if (initialWidth === 0 || initialHeight === 0) {
      const parentRect = container.parentElement?.getBoundingClientRect()
      if (parentRect) {
        initialWidth = parentRect.width || window.innerWidth * 0.8
        initialHeight = parentRect.height || window.innerHeight * 0.6
      }
    }

    setDimensions({ width: initialWidth, height: initialHeight })

    // Cleanup
    return () => {
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect()
      }
    }
  }, [containerRef])

  return dimensions
}
