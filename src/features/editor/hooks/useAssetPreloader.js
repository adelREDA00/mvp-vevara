import { useState, useEffect, useRef } from 'react'
import * as PIXI from 'pixi.js'

export function useAssetPreloader(layers, isCanvasReady) {
    const [isPreloading, setIsPreloading] = useState(true)
    const [progress, setProgress] = useState({ loaded: 0, total: 0, percent: 0 })
    const lastLayersCount = useRef(-1)

    useEffect(() => {
        if (!isCanvasReady || !layers) return

        const layerValues = Object.values(layers)

        // Only trigger full preload on initial load
        if (lastLayersCount.current === -1) {
            lastLayersCount.current = layerValues.length
        } else if (lastLayersCount.current > 0 && !isPreloading) {
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
        let loadedCount = 0
        let isMounted = true

        if (isMounted) {
            setProgress({ loaded: 0, total: loadableLayers.length, percent: 0 })
        }

        const loadAsset = async (layer) => {
            const url = layer.data.url || layer.data.src
            try {
                if (layer.type === 'image') {
                    // Use PIXI.Assets to ensure it's in the cache
                    await PIXI.Assets.load(url)
                } else if (layer.type === 'video') {
                    // For videos, we still use the more robust configuration
                    await PIXI.Assets.load({
                        src: url,
                        data: {
                            resourceOptions: {
                                autoPlay: false,
                                muted: true,
                                playsinline: true,
                                preload: 'auto', // Force full buffering on mobile
                                crossOrigin: 'anonymous'
                            }
                        }
                    })
                }
            } catch (err) {
                console.warn(`[useAssetPreloader] Failed to preload asset: ${url}`, err)
            } finally {
                if (isMounted) {
                    loadedCount++
                    const percent = Math.round((loadedCount / loadableLayers.length) * 100)
                    setProgress({ loaded: loadedCount, total: loadableLayers.length, percent })
                }
            }
        }

        const runPreloader = async () => {
            // Sequential loading on mobile to prevent OOM
            const CONCURRENCY_LIMIT = isMobileDevice ? 1 : 3

            for (let i = 0; i < loadableLayers.length; i += CONCURRENCY_LIMIT) {
                if (!isMounted) return
                const chunk = loadableLayers.slice(i, i + CONCURRENCY_LIMIT)
                await Promise.all(chunk.map(loadAsset))
            }

            if (!isMounted) return
            setIsPreloading(false)
        }

        runPreloader()

        return () => {
            isMounted = false
        }
    }, [layers, isCanvasReady])

    return { isPreloading, progress }
}
