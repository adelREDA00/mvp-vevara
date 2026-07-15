import React, { useState, useEffect, useCallback, useMemo, useContext, useRef } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { ThemeContext } from '../../../app/context/ThemeContext'
import { X, Image as ImageIcon, Loader2, AlertCircle } from 'lucide-react'
import { DragToCloseHandle } from './DragToCloseHandle'
import { AssetCard } from './AssetCard'
import api from '../../../api/client'
import { addLayerAndSelect, selectCurrentSceneId } from '../../../store/slices/projectSlice'
import { assetCacheWarmer } from '../../engine/pixi/textureUtils'

const BATCH_SIZE = 6

function SkeletonGrid({ isLight }) {
    return (
        <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className={`aspect-square rounded-xl overflow-hidden relative ${isLight ? 'bg-black/5' : 'bg-white/5'}`}>
                    <div
                        className={`absolute inset-0 bg-gradient-to-r from-transparent to-transparent animate-[shimmer_1.5s_ease-in-out_infinite] ${isLight ? 'via-black/5' : 'via-white/5'}`}
                        style={{ transform: 'translateX(-100%)', animation: `shimmer 1.5s ease-in-out infinite ${i * 200}ms` }}
                    />
                </div>
            ))}
            <style>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
        </div>
    )
}

function ImagesPanel({ onClose, aspectRatio }) {
    const dispatch = useDispatch()

    const [sharedAssets, setSharedAssets] = useState([])
    const [isFetching, setIsFetching] = useState(false)
    const [fetchError, setFetchError] = useState(null)
    const [hasMore, setHasMore] = useState(true)
    const [isInitialLoad, setIsInitialLoad] = useState(true)

    const sentinelRef = useRef(null)
    const currentSceneId = useSelector(selectCurrentSceneId)
    const { theme } = useContext(ThemeContext)
    const isLight = theme === 'light'

    const getCurrentAspectRatio = () => aspectRatio || '16:9'

    const getWorldDimensions = () => {
        const ar = getCurrentAspectRatio()
        const [widthRatio, heightRatio] = ar.split(':').map(Number)
        const aspectRatioValue = widthRatio / heightRatio

        if (aspectRatioValue >= 1) {
            const baseHeight = 1080
            const worldWidth = Math.round(baseHeight * aspectRatioValue)
            return { worldWidth, worldHeight: 1080 }
        } else {
            const baseWidth = 1080
            const worldHeight = Math.round(baseWidth / aspectRatioValue)
            return { worldWidth: 1080, worldHeight }
        }
    }

    const { worldWidth, worldHeight } = getWorldDimensions()

    const fetchNextBatch = useCallback(async (reset = false) => {
        if (isFetching) return
        const currentSkip = reset ? 0 : sharedAssets.length
        try {
            setIsFetching(true)
            const data = await api.get(`/uploads/shared?assetType=image&limit=${BATCH_SIZE}&skip=${currentSkip}`)
            if (data.length < BATCH_SIZE) {
                setHasMore(false)
            } else {
                setHasMore(true)
            }
            if (reset) {
                setSharedAssets(data)
            } else {
                setSharedAssets(prev => [...prev, ...data])
            }
            setFetchError(null)
        } catch (err) {
            setFetchError(err.message || 'Failed to fetch Bg wall assets')
        } finally {
            setIsFetching(false)
            setIsInitialLoad(false)
        }
    }, [isFetching, sharedAssets.length])

    // Initial fetch on mount
    useEffect(() => {
        fetchNextBatch(true)
    }, [])

    // Warm PIXI assets cache in the background for shared library assets
    useEffect(() => {
        if (sharedAssets.length > 0) {
            assetCacheWarmer.add(sharedAssets)
        }
    }, [sharedAssets])

    // Intersection observer for scroll pagination
    useEffect(() => {
        const sentinel = sentinelRef.current
        if (!sentinel || !hasMore || isFetching || isInitialLoad) return

        const observer = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting) {
                fetchNextBatch(false)
            }
        }, {
            root: null,
            rootMargin: '150px',
            threshold: 0.1
        })

        observer.observe(sentinel)
        return () => {
            if (sentinel) observer.unobserve(sentinel)
        }
    }, [sentinelRef.current, hasMore, isFetching, isInitialLoad, fetchNextBatch])

    const handleAddImageLayer = useCallback((image) => {
        if (!currentSceneId) return
        const imageWidth = image.metadata?.width || 300
        const imageHeight = image.metadata?.height || 200
        const maxSize = 400
        let finalWidth = imageWidth
        let finalHeight = imageHeight

        if (finalWidth > maxSize || finalHeight > maxSize) {
            const scale = maxSize / Math.max(finalWidth, finalHeight)
            finalWidth *= scale
            finalHeight *= scale
        }

        const isVideo = image.type === 'video' || image.metadata?.type?.startsWith('video/')

        dispatch(addLayerAndSelect({
            sceneId: currentSceneId,
            type: isVideo ? 'video' : 'image',
            name: image.name || (isVideo ? 'Video' : 'Image'),
            x: worldWidth / 2,
            y: worldHeight / 2,
            width: finalWidth,
            height: finalHeight,
            anchorX: 0.5,
            anchorY: 0.5,
            mediaWidth: imageWidth,
            mediaHeight: imageHeight,
            data: {
                url: image.url || image.src,
                src: image.url || image.src,
                thumbnail: image.metadata?.thumbnail || image.thumbnail || null,
                ...(image.metadata || {}),
                ...(isVideo && image.metadata?.duration ? { duration: image.metadata.duration } : {}),
            }
        }))
    }, [dispatch, currentSceneId, worldWidth, worldHeight])

    const isMobile = typeof window !== 'undefined' && window.innerWidth < 1024

    return (
        <div
            className="flex flex-col h-full relative transition-all duration-300 pt-0 lg:pt-12"
            style={{
                width: isMobile ? '100%' : '320px',
                backgroundColor: isMobile ? 'transparent' : (isLight ? '#f3f4f7' : '#090a0d'),
                backdropFilter: isMobile ? 'none' : 'blur(20px)',
                WebkitBackdropFilter: isMobile ? 'none' : 'blur(20px)',
                borderRight: isMobile ? 'none' : `1px solid ${isLight ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.05)'}`,
            }}
        >
            {onClose && (
                <button
                    onClick={onClose}
                    className={`absolute top-3 right-3 z-50 transition-all duration-300 p-2 rounded-[10px] ${isLight ? 'text-gray-400 hover:text-gray-900 hover:bg-gray-100' : 'text-white/40 hover:text-white hover:bg-white/10'} hidden lg:block`}
                >
                    <X className="h-5 w-5" strokeWidth={2} />
                </button>
            )}

            {fetchError && (
                <div className="mx-4 mt-2 p-3 bg-red-900/50 border border-red-700 rounded-lg flex gap-2">
                    <AlertCircle className="h-4 w-4 text-red-400 flex-shrink-0" />
                    <p className="text-red-300 text-sm flex-1">{fetchError}</p>
                </div>
            )}

            <div className="flex-1 overflow-y-auto p-6 custom-scrollbar scrollbar-hide">
                {isInitialLoad && isFetching ? (
                    <SkeletonGrid isLight={isLight} />
                ) : sharedAssets.length === 0 ? (
                    <div className="h-64 flex flex-col items-center justify-center text-center">
                        <div className={`p-4 rounded-full mb-4 ${isLight ? 'bg-black/5' : 'bg-white/5'}`}>
                            <ImageIcon className={`h-8 w-8 ${isLight ? 'text-slate-300' : 'text-zinc-600'}`} />
                        </div>
                        <p className={`text-[14px] font-medium ${isLight ? 'text-slate-400' : 'text-zinc-500'}`}>
                            No Bg wall assets available
                        </p>
                    </div>
                ) : (
                    <>
                        <div className="grid grid-cols-2 gap-4">
                            {sharedAssets.map((image) => (
                                <AssetCard
                                    key={image._id || image.id}
                                    image={image}
                                    onAdd={handleAddImageLayer}
                                />
                            ))}
                        </div>
                        {hasMore && (
                            <div ref={sentinelRef} className="h-14 flex items-center justify-center mt-4">
                                <Loader2 className="h-5 w-5 animate-spin text-[#7c4af0]" />
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    )
}

export default React.memo(ImagesPanel)
