/**
 * Hook to manage the editor's layout and responsive sizing.
 * Handles canvas centering, bottom section resizing, and maintains proper
 * aspect ratios. Manages the height calculations for top toolbar, controls,
 * and bottom sections while ensuring the canvas remains properly positioned.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

export function useEditorLayout({ aspectRatio, selectedLayerIds }) {
  const topToolbarRef = useRef(null)
  const topControlsRef = useRef(null)
  const canvasScrollRef = useRef(null)
  const bottomSectionRef = useRef(null)
  const playbackControlsRef = useRef(null)
  const scenesBarRef = useRef(null)
  const bottomControlsRef = useRef(null)

  const [bottomSectionHeight, setBottomSectionHeight] = useState(0)
  const [topControlsHeight, setTopControlsHeight] = useState(0)
  const [topToolbarHeight, setTopToolbarHeight] = useState(0)
  const [customBottomHeight, setCustomBottomHeight] = useState(null)
  const [isResizingBottom, setIsResizingBottom] = useState(false)
  const [minBottomHeight, setMinBottomHeight] = useState(40)

  const isResizingBottomRef = useRef(false)

  const centerCanvas = useCallback(() => {
    if (!canvasScrollRef.current) return
    const scrollContainer = canvasScrollRef.current

    requestAnimationFrame(() => {
      const container = canvasScrollRef.current
      if (!container) return

      const containerWidth = container.clientWidth
      const containerHeight = container.clientHeight
      const scrollWidth = container.scrollWidth
      const scrollHeight = container.scrollHeight

      const wrapper = container.querySelector('div[class*="flex px-2"]')
      const canvasElement = wrapper?.querySelector('div[class*="bg-white relative shadow-2xl"]')

      if (canvasElement) {
        const canvasRect = canvasElement.getBoundingClientRect()
        const containerRect = container.getBoundingClientRect()

        const canvasCenterX = canvasRect.left + canvasRect.width / 2
        const containerCenterX = containerRect.left + containerWidth / 2
        const offsetX = canvasCenterX - containerCenterX
        const targetScrollLeft = container.scrollLeft + offsetX
        container.scrollLeft = Math.max(0, Math.min(targetScrollLeft, scrollWidth - containerWidth))
      } else {
        const centerX = (scrollWidth - containerWidth) / 2
        container.scrollLeft = Math.max(0, centerX)
      }

      if (canvasElement) {
        const canvasRect = canvasElement.getBoundingClientRect()
        const containerRect = container.getBoundingClientRect()

        const canvasCenterY = canvasRect.top + canvasRect.height / 2
        const containerCenterY = containerRect.top + containerHeight / 2
        const offsetY = canvasCenterY - containerCenterY
        const targetScrollTop = container.scrollTop + offsetY
        container.scrollTop = Math.max(0, Math.min(targetScrollTop, scrollHeight - containerHeight))
      } else {
        const centerY = (scrollHeight - containerHeight) / 2
        container.scrollTop = Math.max(0, centerY)
      }
    })
  }, [])

  useEffect(() => {
    const timeout = setTimeout(() => {
      centerCanvas()
    }, 150)

    return () => clearTimeout(timeout)
  }, [aspectRatio, centerCanvas])

  useEffect(() => {
    if (!bottomSectionRef.current) return

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry && customBottomHeight === null && !isResizingBottomRef.current) {
        setBottomSectionHeight(entry.contentRect.height)
      }
    })

    resizeObserver.observe(bottomSectionRef.current)

    return () => {
      resizeObserver.disconnect()
    }
  }, [customBottomHeight])

  useEffect(() => {
    if (customBottomHeight !== null) {
      setBottomSectionHeight(customBottomHeight)
    }
  }, [customBottomHeight])

  useEffect(() => {
    setMinBottomHeight(170)

    const handleResize = () => {
      setTimeout(() => centerCanvas(), 150)
    }

    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [centerCanvas])

  useEffect(() => {
    if (!isResizingBottom) return

    isResizingBottomRef.current = true

    const handleMouseMove = (e) => {
      if (!bottomSectionRef.current) return

      const windowHeight = window.innerHeight
      const mouseY = e.clientY
      const newHeight = windowHeight - mouseY
      const maxHeight = windowHeight * 0.7
      const clampedHeight = Math.max(minBottomHeight, Math.min(newHeight, maxHeight))
      setCustomBottomHeight(clampedHeight)
    }

    const handleMouseUp = () => {
      setIsResizingBottom(false)
      isResizingBottomRef.current = false
    }

    document.body.style.cursor = 'ns-resize'
    document.body.style.userSelect = 'none'

    document.addEventListener('mousemove', handleMouseMove, { passive: true })
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      isResizingBottomRef.current = false
    }
  }, [isResizingBottom, minBottomHeight])

  useEffect(() => {
    if (!topToolbarRef.current) {
      const height =
        typeof window !== 'undefined' && window.innerWidth >= 768 ? 56 : 48
      setTopToolbarHeight(height)
      return
    }

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) {
        setTopToolbarHeight(entry.contentRect.height)
      }
    })

    resizeObserver.observe(topToolbarRef.current)

    return () => {
      resizeObserver.disconnect()
    }
  }, [])

  useEffect(() => {
    if (!topControlsRef.current) {
      setTopControlsHeight(0)
      return
    }

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) {
        setTopControlsHeight(entry.contentRect.height)
      }
    })

    resizeObserver.observe(topControlsRef.current)

    return () => {
      resizeObserver.disconnect()
    }
  }, [selectedLayerIds])

  useEffect(() => {
    const timeout = setTimeout(() => {
      centerCanvas()
    }, 200)

    return () => clearTimeout(timeout)
  }, [centerCanvas])

  const handleBottomResizeMouseDown = useCallback((event) => {
    event.preventDefault()
    event.stopPropagation()
    setIsResizingBottom(true)
    isResizingBottomRef.current = true
  }, [])

  return {
    topToolbarRef,
    topControlsRef,
    canvasScrollRef,
    bottomSectionRef,
    playbackControlsRef,
    scenesBarRef,
    bottomControlsRef,
    bottomSectionHeight,
    topControlsHeight,
    topToolbarHeight,
    customBottomHeight,
    isResizingBottom,
    handleBottomResizeMouseDown,
  }
}