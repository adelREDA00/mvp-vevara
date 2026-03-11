import { useState, useEffect, useCallback, useMemo } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { X, Search, Image as ImageIcon, Film, Loader2, AlertCircle } from 'lucide-react'
import { DragToCloseHandle } from './DragToCloseHandle'
import { AssetCard } from './AssetCard'
import api from '../../../api/client'
import { addLayerAndSelect, selectCurrentSceneId } from '../../../store/slices/projectSlice'

function SkeletonGrid() {
    return (
        <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="aspect-square rounded-xl bg-white/5 overflow-hidden relative">
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent animate-[shimmer_1.5s_ease-in-out_infinite]" style={{ transform: 'translateX(-100%)', animation: `shimmer 1.5s ease-in-out infinite ${i * 200}ms` }} />
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
    const [searchQuery, setSearchQuery] = useState('')
    const [activeTab, setActiveTab] = useState('All')
    const [width, setWidth] = useState(320)

    const [sharedAssets, setSharedAssets] = useState([])
    const [isFetching, setIsFetching] = useState(true)
    const [fetchError, setFetchError] = useState(null)

    const currentSceneId = useSelector(selectCurrentSceneId)

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

    useEffect(() => {
        let mounted = true
        const fetchSharedAssets = async () => {
            try {
                setIsFetching(true)
                const data = await api.get('/uploads/shared')
                if (mounted) {
                    setSharedAssets(data)
                    setFetchError(null)
                }
            } catch (err) {
                if (mounted) setFetchError(err.message || 'Failed to fetch assets')
            } finally {
                if (mounted) setIsFetching(false)
            }
        }
        fetchSharedAssets()
        return () => { mounted = false }
    }, [])

    const filteredImages = useMemo(() => {
        if (!sharedAssets.length) return []
        return sharedAssets.filter(image => {
            const matchesSearch = searchQuery === '' || image.name.toLowerCase().includes(searchQuery.toLowerCase())

            // ROBUST TYPE DETECTION: Shared assets might have type at top level or in metadata
            const isVideo = image.type === 'video' || image.metadata?.type?.startsWith('video/')
            const isImage = image.type === 'image' || image.metadata?.type?.startsWith('image/')

            const matchesTab = activeTab === 'All' ||
                (activeTab === 'Images' && isImage) ||
                (activeTab === 'Videos' && isVideo)
            return matchesSearch && matchesTab
        })
    }, [sharedAssets, searchQuery, activeTab])

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
                url: image.url,
                src: image.url,
                ...(image.metadata || {}),
                ...(isVideo && image.metadata?.duration ? { duration: image.metadata.duration } : {}),
            }
        }))
    }, [dispatch, currentSceneId, worldWidth, worldHeight])

    const isMobile = typeof window !== 'undefined' && window.innerWidth < 1024

    const totalCount = sharedAssets.length
    const imageCount = sharedAssets.filter(img => img.type === 'image' || img.metadata?.type?.startsWith('image/')).length
    const videoCount = sharedAssets.filter(img => img.type === 'video' || img.metadata?.type?.startsWith('video/')).length

    return (
        <div
            className="flex flex-col h-full relative transition-all duration-300"
            style={{
                width: isMobile ? '100%' : `${width}px`,
                backgroundColor: isMobile ? 'transparent' : '#0f1015',
                backdropFilter: isMobile ? 'none' : 'blur(20px)',
                WebkitBackdropFilter: isMobile ? 'none' : 'blur(20px)',
                borderRight: isMobile ? 'none' : '1px solid rgba(255, 255, 255, 0.05)',
            }}
        >
            {!isMobile && <DragToCloseHandle onClose={onClose} onWidthChange={setWidth} initialWidth={width} minWidth={200} />}

            <div className="px-4 pt-4 pb-3 border-b border-zinc-800/50">
                <div className="flex items-center justify-between mb-3">
                    <h2 className="text-lg font-semibold text-white">Media</h2>
                    {onClose && (
                        <button onClick={onClose} className="text-zinc-400 hover:text-white p-1 rounded-md hover:bg-zinc-800">
                            <X className="h-4 w-4" />
                        </button>
                    )}
                </div>

            </div>

            {fetchError && (
                <div className="mx-4 mt-2 p-3 bg-red-900/50 border border-red-700 rounded-lg flex gap-2">
                    <AlertCircle className="h-4 w-4 text-red-400 flex-shrink-0" />
                    <p className="text-red-300 text-sm flex-1">{fetchError}</p>
                </div>
            )}

            <div className="flex border-b border-zinc-800/50 px-4">
                {['All', 'Images', 'Videos'].map(tab => (
                    <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`px-4 py-3 text-sm font-medium relative ${activeTab === tab ? 'text-purple-400' : 'text-zinc-400'}`}
                    >
                        {tab} ({tab === 'All' ? totalCount : tab === 'Images' ? imageCount : videoCount})
                        {activeTab === tab && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-purple-400" />}
                    </button>
                ))}
            </div>

            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                {isFetching && !sharedAssets.length ? (
                    <SkeletonGrid />
                ) : filteredImages.length === 0 ? (
                    <div className="h-48 flex flex-col items-center justify-center text-center opacity-40">
                        <ImageIcon className="h-8 w-8 mb-3 text-zinc-600" />
                        <p className="text-sm text-zinc-500">
                            {searchQuery ? 'No matching media' : 'No assets available'}
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-2 gap-3">
                        {filteredImages.map((image) => (
                            <AssetCard
                                key={image._id || image.id}
                                image={image}
                                onAdd={handleAddImageLayer}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}

export default ImagesPanel
