import { useState, useEffect, useCallback, useMemo, useContext } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { ThemeContext } from '../../../app/context/ThemeContext'
import { X, Search, Image as ImageIcon, Film, Loader2, AlertCircle } from 'lucide-react'
import { DragToCloseHandle } from './DragToCloseHandle'
import { AssetCard } from './AssetCard'
import api from '../../../api/client'
import { addLayerAndSelect, selectCurrentSceneId } from '../../../store/slices/projectSlice'

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
    const [searchQuery, setSearchQuery] = useState('')
    const [activeTab, setActiveTab] = useState('All')
    const [width, setWidth] = useState(320)

    const [sharedAssets, setSharedAssets] = useState([])
    const [isFetching, setIsFetching] = useState(true)
    const [fetchError, setFetchError] = useState(null)

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
            const isImage = (image.type === 'image' || image.metadata?.type?.startsWith('image/')) && (!image.assetType || image.assetType === 'image')
            const isIcon = (image.type === 'image' || image.metadata?.type?.startsWith('image/')) && image.assetType === 'icon'

            const matchesTab = activeTab === 'All' ||
                (activeTab === 'Images' && isImage) ||
                (activeTab === 'Icons' && isIcon) ||
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
                url: image.url || image.src,
                src: image.url || image.src,
                ...(image.metadata || {}),
                ...(isVideo && image.metadata?.duration ? { duration: image.metadata.duration } : {}),
            }
        }))
    }, [dispatch, currentSceneId, worldWidth, worldHeight])

    const isMobile = typeof window !== 'undefined' && window.innerWidth < 1024

    const totalCount = sharedAssets.length
    const imageCount = sharedAssets.filter(img => (img.type === 'image' || img.metadata?.type?.startsWith('image/')) && (!img.assetType || img.assetType === 'image')).length
    const iconCount = sharedAssets.filter(img => (img.type === 'image' || img.metadata?.type?.startsWith('image/')) && img.assetType === 'icon').length
    const videoCount = sharedAssets.filter(img => img.type === 'video' || img.metadata?.type?.startsWith('video/')).length

    return (
        <div
            className="flex flex-col h-full relative transition-all duration-300"
            style={{
                width: isMobile ? '100%' : `${width}px`,
                backgroundColor: isMobile ? 'transparent' : (isLight ? '#f3f4f7' : '#090a0d'),
                backdropFilter: isMobile ? 'none' : 'blur(20px)',
                WebkitBackdropFilter: isMobile ? 'none' : 'blur(20px)',
                borderRight: isMobile ? 'none' : `1px solid ${isLight ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.05)'}`,
            }}
        >
            {!isMobile && <DragToCloseHandle onClose={onClose} onWidthChange={setWidth} initialWidth={width} minWidth={200} />}

            <div className={`px-6 pt-6 pb-5 border-b ${isLight ? 'border-black/5' : 'border-white/5'}`}>
                <div className="flex items-center justify-between mb-4">
                    <h2 className={`text-[20px] font-semibold tracking-tight ${isLight ? 'text-gray-900' : 'text-white'}`}>Media</h2>
                    {onClose && (
                        <button 
                            onClick={onClose} 
                            className={`transition-all duration-300 p-2 rounded-[10px] ${isLight ? 'text-gray-400 hover:text-gray-900 hover:bg-gray-100' : 'text-white/40 hover:text-white hover:bg-white/10'}`}
                        >
                            <X className="h-5 w-5" strokeWidth={2} />
                        </button>
                    )}
                </div>

                <div className="relative">
                    <Search className="absolute left-3.5 top-1/2 transform -translate-y-1/2 h-4 w-4 text-zinc-500" strokeWidth={2} />
                    <input
                        type="text"
                        placeholder="Search media..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className={`w-full pl-10 pr-4 py-2.5 border rounded-[12px] text-[14px] focus:outline-none focus:ring-1 transition-all ${
                            isLight 
                                ? 'bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-500 focus:border-purple-500 focus:ring-purple-500/20' 
                                : 'bg-white/5 border-white/10 text-white placeholder-zinc-600 focus:border-white/20 focus:ring-white/20'
                        }`}
                    />
                </div>
            </div>

            {fetchError && (
                <div className="mx-4 mt-2 p-3 bg-red-900/50 border border-red-700 rounded-lg flex gap-2">
                    <AlertCircle className="h-4 w-4 text-red-400 flex-shrink-0" />
                    <p className="text-red-300 text-sm flex-1">{fetchError}</p>
                </div>
            )}

            <div className={`flex border-b px-6 ${isLight ? 'border-black/5' : 'border-white/5'}`}>
                {['All', 'Images', 'Icons', 'Videos'].map(tab => (
                    <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`px-4 py-4 text-[13px] font-semibold tracking-wide relative transition-colors ${activeTab === tab ? 'text-[#7c4af0]' : (isLight ? 'text-gray-500 hover:text-gray-900' : 'text-zinc-500 hover:text-white')}`}
                    >
                        {tab} <span className="opacity-40 ml-1">{tab === 'All' ? totalCount : tab === 'Images' ? imageCount : tab === 'Icons' ? iconCount : videoCount}</span>
                        {activeTab === tab && (
                            <div className="absolute bottom-0 left-2 right-2 h-[2px] bg-[#7c4af0] rounded-t-full" />
                        )}
                    </button>
                ))}
            </div>

            <div className="flex-1 overflow-y-auto p-6 custom-scrollbar scrollbar-hide">
                {isFetching && !sharedAssets.length ? (
                    <SkeletonGrid isLight={isLight} />
                ) : filteredImages.length === 0 ? (
                    <div className="h-64 flex flex-col items-center justify-center text-center">
                        <div className={`p-4 rounded-full mb-4 ${isLight ? 'bg-black/5' : 'bg-white/5'}`}>
                            <ImageIcon className={`h-8 w-8 ${isLight ? 'text-slate-300' : 'text-zinc-600'}`} />
                        </div>
                        <p className={`text-[14px] font-medium ${isLight ? 'text-slate-400' : 'text-zinc-500'}`}>
                            {searchQuery ? 'No matching media' : 'No assets available'}
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-2 gap-4">
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
