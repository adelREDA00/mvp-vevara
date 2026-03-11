import { useState, useEffect, useRef, useMemo } from 'react'
import * as PIXI from 'pixi.js'

const isMobileDevice = typeof window !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)

export function useAssetPreloader(layers, isCanvasReady) {
    const [isPreloading, setIsPreloading] = useState(true)
    const [progress, setProgress] = useState({ loaded: 0, total: 0, percent: 0 })

    // Stabilize the dependency: only re-trigger when the SET of asset URLs changes
    const assetUrls = useMemo(() => {
        if (!layers) return []
        const urls = []
        for (const layer of Object.values(layers)) {
            if (layer && (layer.type === 'image' || layer.type === 'video')) {
                const url = layer.data?.url || layer.data?.src
                if (url) urls.push({ url, type: layer.type })
            }
        }
        urls.sort((a, b) => a.url.localeCompare(b.url))
        return urls
    }, [layers])

    const assetKey = useMemo(() => {
        return assetUrls.map(a => `${a.type}:${a.url}`).join('|')
    }, [assetUrls])

    const completedKeyRef = useRef(null)

    useEffect(() => {
        if (!isCanvasReady) return

        // Already completed for this exact set of assets
        if (completedKeyRef.current === assetKey) {
            setIsPreloading(false)
            return
        }

        // [MOBILE FIX] On mobile, skip ALL preloading — let useCanvasLayers handle it
        // sequentially through loadTextureRobust. This eliminates the double-loading
        // crash vector where both the preloader AND useCanvasLayers load the same
        // textures simultaneously, doubling GPU memory usage.
        if (isMobileDevice) {
            setProgress({ loaded: assetUrls.length, total: assetUrls.length, percent: 100 })
            completedKeyRef.current = assetKey
            setIsPreloading(false)
            return
        }

        if (assetUrls.length === 0) {
            setIsPreloading(false)
            setProgress({ loaded: 0, total: 0, percent: 100 })
            completedKeyRef.current = assetKey
            return
        }

        // --- Desktop preloading path (unchanged) ---
        let loadedCount = 0
        let isMounted = true

        setIsPreloading(true)
        setProgress({ loaded: 0, total: assetUrls.length, percent: 0 })

        const loadAsset = async (asset) => {
            const { url, type } = asset
            try {
                if (type === 'image') {
                    await PIXI.Assets.load(url)
                } else if (type === 'video') {
                    if (!url.startsWith('blob:')) {
                        await PIXI.Assets.load({
                            src: url,
                            data: {
                                resourceOptions: {
                                    autoPlay: false,
                                    muted: true,
                                    playsinline: true,
                                    preload: 'auto',
                                    crossOrigin: 'anonymous'
                                }
                            }
                        })
                    }
                }
            } catch (err) {
                console.warn(`[useAssetPreloader] Failed to preload asset: ${url}`, err)
            } finally {
                if (isMounted) {
                    loadedCount++
                    const percent = Math.round((loadedCount / assetUrls.length) * 100)
                    setProgress({ loaded: loadedCount, total: assetUrls.length, percent })
                }
            }
        }

        const runPreloader = async () => {
            // Wait for fonts first
            try {
                if (document.fonts) {
                    await Promise.race([
                        document.fonts.ready,
                        new Promise(resolve => setTimeout(resolve, 3000))
                    ])
                }
            } catch (e) { /* non-fatal */ }

            if (!isMounted) return

            // Desktop: parallel loading (3 at a time)
            const CONCURRENCY_LIMIT = 3
            for (let i = 0; i < assetUrls.length; i += CONCURRENCY_LIMIT) {
                if (!isMounted) return
                const chunk = assetUrls.slice(i, i + CONCURRENCY_LIMIT)
                await Promise.all(chunk.map(loadAsset))
            }

            if (!isMounted) return
            completedKeyRef.current = assetKey
            setIsPreloading(false)
        }

        runPreloader()

        return () => {
            isMounted = false
        }
    }, [assetKey, assetUrls, isCanvasReady])

    return { isPreloading, progress }
}
