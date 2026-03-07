import { useState, useEffect, useRef } from 'react'

export function useAssetPreloader(layers, isCanvasReady) {
    const [isPreloading, setIsPreloading] = useState(true)
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
            (l.type === 'image' || l.type === 'video') && l.data?.url
        )

        if (loadableLayers.length === 0) {
            setIsPreloading(false)
            return
        }

        let isMounted = true

        const loadAsset = (layer) => {
            return new Promise((resolve) => {
                let isResolved = false
                const handleResolve = () => {
                    if (!isResolved) {
                        isResolved = true
                        resolve()
                    }
                }

                // Prevent hanging indefinitely if an asset fails to respond
                const timeoutId = setTimeout(handleResolve, 15000)

                const url = layer.data.url
                if (layer.type === 'image') {
                    const img = new Image()
                    img.onload = () => { clearTimeout(timeoutId); handleResolve() }
                    img.onerror = () => { clearTimeout(timeoutId); handleResolve() }
                    img.src = url
                } else if (layer.type === 'video') {
                    const video = document.createElement('video')
                    // Wait for metadata, NOT full data frame, to save memory on mobile/low-end
                    video.onloadedmetadata = () => { clearTimeout(timeoutId); handleResolve() }
                    video.onerror = () => { clearTimeout(timeoutId); handleResolve() }
                    video.preload = 'metadata'
                    video.src = url
                }
            })
        }

        const runPreloader = async () => {
            // Limit concurrency to save memory
            const CONCURRENCY_LIMIT = 3

            for (let i = 0; i < loadableLayers.length; i += CONCURRENCY_LIMIT) {
                if (!isMounted) return
                const chunk = loadableLayers.slice(i, i + CONCURRENCY_LIMIT)
                await Promise.all(chunk.map(loadAsset))
            }

            if (!isMounted) return

            // Add a tiny delay to ensure PIXI has time to render the next frame after loading
            setTimeout(() => {
                if (isMounted) setIsPreloading(false)
            }, 500)
        }

        runPreloader()

        return () => {
            isMounted = false
        }
    }, [layers, isCanvasReady])

    return isPreloading
}
