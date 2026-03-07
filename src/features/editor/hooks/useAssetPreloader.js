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

        let loadedCount = 0
        const totalCount = loadableLayers.length
        let isMounted = true

        const checkDone = () => {
            if (!isMounted) return
            loadedCount++
            if (loadedCount >= totalCount) {
                // Add a tiny delay to ensure PIXI has time to render the next frame after loading
                setTimeout(() => {
                    if (isMounted) setIsPreloading(false)
                }, 500)
            }
        }

        loadableLayers.forEach(layer => {
            const url = layer.data.url
            if (layer.type === 'image') {
                const img = new Image()
                img.onload = checkDone
                img.onerror = checkDone // Continue even if one fails
                img.src = url
            } else if (layer.type === 'video') {
                const video = document.createElement('video')
                video.onloadeddata = checkDone
                video.onerror = checkDone
                video.src = url
                video.load()
            }
        })

        return () => {
            isMounted = false
        }
    }, [layers, isCanvasReady])

    return isPreloading
}
