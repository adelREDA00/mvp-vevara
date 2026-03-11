import { useState, useEffect, useRef, useMemo } from 'react'
import * as PIXI from 'pixi.js'
import { loadTextureRobust } from '../../engine/pixi/textureUtils'

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

        if (assetUrls.length === 0) {
            setIsPreloading(false)
            setProgress({ loaded: 0, total: 0, percent: 100 })
            completedKeyRef.current = assetKey
            return
        }

        let loadedCount = 0
        let isMounted = true

        setIsPreloading(true)
        setProgress({ loaded: 0, total: assetUrls.length, percent: 0 })

        const loadAsset = async (asset) => {
            const { url, type } = asset
            try {
                if (type === 'image') {
                    // [UNIFIED LOAD] Use loadTextureRobust so preloader and layers share the same 
                    // image cache and mobile capping logic. This prevents double-memory usage.
                    await loadTextureRobust(url)
                } else if (type === 'video') {
                    // For videos, we create a temporary element to ensure it's buffered
                    await new Promise((resolve) => {
                        const video = document.createElement('video')
                        video.src = url
                        video.muted = true
                        video.playsInline = true
                        video.preload = 'auto'
                        
                        const onCanPlay = () => {
                            video.removeEventListener('canplaythrough', onCanPlay)
                            video.removeEventListener('error', onCanPlay)
                            resolve()
                        }
                        
                        // Wait for enough data (readyState 4) for smooth playback start
                        video.addEventListener('canplaythrough', onCanPlay)
                        video.addEventListener('error', onCanPlay)
                        
                        // 15s timeout for preloading individual video
                        setTimeout(resolve, 15000)
                    })
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
            // [STRICT] Wait for fonts first on ALL devices. 
            // This is critical for accurate text metrics on the first render.
            try {
                if (document.fonts) {
                    await Promise.race([
                        document.fonts.ready,
                        new Promise(resolve => setTimeout(resolve, 5000))
                    ])
                }
            } catch (e) { /* non-fatal */ }

            if (!isMounted) return

            // Sequential loading on mobile to prevent CPU/memory spikes
            const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
            const CONCURRENCY_LIMIT = isMobile ? 1 : 3

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
