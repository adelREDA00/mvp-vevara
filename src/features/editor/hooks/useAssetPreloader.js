import { useState, useEffect, useRef } from 'react'

export function useAssetPreloader(layers, isCanvasReady) {
    const [isPreloading, setIsPreloading] = useState(true)
    const [progress, setProgress] = useState({ loaded: 0, total: 0, percent: 0 })
    const lastLayersCount = useRef(-1)

    useEffect(() => {
        if (!isCanvasReady || !layers) return

        const layerValues = Object.values(layers)

        // Only trigger full preload on initial load (when going from 0 to N layers or initial mount)
        if (lastLayersCount.current === -1) {
            lastLayersCount.current = layerValues.length
        } else if (lastLayersCount.current > 0 && !isPreloading) {
            // If we already preloaded and are just adding/removing layers, don't show the full screen loader again
            return
        }

        const loadableLayers = layerValues.filter(l =>
            l && (l.type === 'image' || l.type === 'video') && (l.data?.url || l.data?.src)
        )

        if (loadableLayers.length === 0) {
            setIsPreloading(false)
            setProgress({ loaded: 0, total: 0, percent: 100 })
            return
        }

        const isMobileDevice = typeof window !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
        const targetPercent = isMobileDevice ? 1.0 : 0.5
        const targetCount = Math.max(1, Math.ceil(loadableLayers.length * targetPercent))
        let loadedCount = 0
        let isMounted = true

        if (isMounted) {
            setProgress({ loaded: 0, total: loadableLayers.length, percent: 0 })
        }

        const loadAsset = (layer) => {
            return new Promise((resolve) => {
                let isResolved = false
                const handleResolve = () => {
                    if (!isResolved) {
                        isResolved = true
                        loadedCount++

                        if (isMounted) {
                            const percent = Math.round((loadedCount / loadableLayers.length) * 100)
                            setProgress({ loaded: loadedCount, total: loadableLayers.length, percent })

                            if (loadedCount >= targetCount && isPreloading) {
                                setIsPreloading(false)
                            }
                        }
                        resolve()
                    }
                }

                // Increased timeout for mobile/slow networks
                const timeoutId = setTimeout(handleResolve, 30000)

                const url = layer.data.url || layer.data.src
                if (layer.type === 'image') {
                    const img = new Image()
                    img.onload = () => { clearTimeout(timeoutId); handleResolve() }
                    img.onerror = () => { clearTimeout(timeoutId); handleResolve() }
                    img.src = url
                } else if (layer.type === 'video') {
                    const video = document.createElement('video')
                    video.muted = true
                    video.playsInline = true

                    // On mobile, we wait for canplaythrough for better stability
                    if (isMobileDevice) {
                        video.preload = 'auto'
                        video.oncanplaythrough = () => { clearTimeout(timeoutId); handleResolve() }
                    } else {
                        video.preload = 'metadata'
                        video.onloadedmetadata = () => { clearTimeout(timeoutId); handleResolve() }
                    }

                    video.onerror = () => { clearTimeout(timeoutId); handleResolve() }
                    video.src = url
                    video.load()
                }
            })
        }

        const runPreloader = async () => {
            // Limit concurrency to save memory
            const CONCURRENCY_LIMIT = isMobileDevice ? 1 : 3

            for (let i = 0; i < loadableLayers.length; i += CONCURRENCY_LIMIT) {
                if (!isMounted) return
                const chunk = loadableLayers.slice(i, i + CONCURRENCY_LIMIT)
                await Promise.all(chunk.map(loadAsset))
            }

            if (!isMounted) return

            if (isPreloading) {
                setIsPreloading(false)
            }
        }

        runPreloader()

        return () => {
            isMounted = false
        }
    }, [layers, isCanvasReady])

    return { isPreloading, progress }
}
