import { useState, useEffect, useRef, useMemo } from 'react'
import * as PIXI from 'pixi.js'

const isMobileDevice = typeof window !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)

// Mobile: cap texture dimensions to prevent GPU OOM
const MOBILE_MAX_TEXTURE_SIZE = 1024

export function useAssetPreloader(layers, isCanvasReady) {
    const [isPreloading, setIsPreloading] = useState(true)
    const [progress, setProgress] = useState({ loaded: 0, total: 0, percent: 0 })

    // Stabilize the dependency: only re-trigger when the SET of asset URLs changes,
    // not when any layer property (position, opacity, etc.) changes.
    const assetUrls = useMemo(() => {
        if (!layers) return []
        const urls = []
        for (const layer of Object.values(layers)) {
            if (layer && (layer.type === 'image' || layer.type === 'video')) {
                const url = layer.data?.url || layer.data?.src
                if (url) urls.push({ url, type: layer.type })
            }
        }
        // Sort for stable comparison
        urls.sort((a, b) => a.url.localeCompare(b.url))
        return urls
    }, [layers])

    // Serialize to a string key so the effect only re-runs when the actual URL set changes
    const assetKey = useMemo(() => {
        return assetUrls.map(a => `${a.type}:${a.url}`).join('|')
    }, [assetUrls])

    // Track whether we've already completed a preload cycle to avoid re-running
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
                    // Load into PIXI asset cache
                    const texture = await PIXI.Assets.load(url)

                    // [MOBILE FIX] Disable mipmapping on mobile to save ~3x GPU memory per texture
                    if (isMobileDevice && texture?.source) {
                        texture.source.autoGenerateMipmaps = false
                        texture.source.scaleMode = 'linear'
                    }
                } else if (type === 'video') {
                    // For videos, use the robust configuration but DON'T create video elements here.
                    // createVideoLayer() in useCanvasLayers handles the actual element creation.
                    // We only warm the network cache for non-blob URLs.
                    if (!url.startsWith('blob:')) {
                        await PIXI.Assets.load({
                            src: url,
                            data: {
                                resourceOptions: {
                                    autoPlay: false,
                                    muted: true,
                                    playsinline: true,
                                    preload: isMobileDevice ? 'metadata' : 'auto',
                                    crossOrigin: 'anonymous'
                                }
                            }
                        })
                    }
                    // For blob URLs: skip — createVideoLayer will handle them directly.
                    // This prevents creating duplicate video elements (the main cause of mobile OOM).
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
            // [MOBILE FIX] Wait for fonts first — they're small but critical for text rendering
            try {
                if (document.fonts) {
                    await Promise.race([
                        document.fonts.ready,
                        new Promise(resolve => setTimeout(resolve, 3000)) // 3s timeout
                    ])
                }
            } catch (e) {
                // Font loading failure is non-fatal
            }

            if (!isMounted) return

            // Sequential on mobile (1 at a time), parallel on desktop (3 at a time)
            const CONCURRENCY_LIMIT = isMobileDevice ? 1 : 3

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
