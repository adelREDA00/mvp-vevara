import React, { useState, useEffect, useRef, memo } from 'react'
import { Layers } from 'lucide-react'

/**
 * Optimized TemplateThumbnail component with lazy-loading videos.
 * Only renders the <video> element when it's near the viewport.
 */
const TemplateThumbnail = memo(({ project, buttonText = "Edit Template" }) => {
    const videoRef = useRef(null)
    const containerRef = useRef(null)
    const [isVisible, setIsVisible] = useState(false)
    const [isLoaded, setIsLoaded] = useState(false)
    const [shouldRenderVideo, setShouldRenderVideo] = useState(false)

    useEffect(() => {
        const observer = new IntersectionObserver(
            ([entry]) => {
                const intersecting = entry.isIntersecting
                setIsVisible(intersecting)
                // Once it has been visible, we keep the video rendered if it matches a certain buffer
                // but for maximum performance, we only "render" it when it's within 200px of viewport
                if (intersecting) {
                    setShouldRenderVideo(true)
                }
            },
            { 
                threshold: 0.01,
                rootMargin: '600px' // Start loading video 600px before it enters viewport
            }
        )

        const currentRef = containerRef.current
        if (currentRef) {
            observer.observe(currentRef)
        }

        return () => observer.disconnect()
    }, [project._id])

    useEffect(() => {
        if (!videoRef.current) return

        if (isVisible) {
            videoRef.current.play().catch(e => {
                // Autoplay might be blocked until user interaction
                // console.log('Autoplay blocked or video missing:', e)
            })
        } else {
            videoRef.current.pause()
        }
    }, [isVisible, shouldRenderVideo])

    return (
        <div 
            ref={containerRef}
            id={`template-container-${project._id}`}
            className="aspect-video bg-[var(--dashboard-card-bg)] border border-[var(--dashboard-border)] rounded-[12px] md:rounded-[16px] overflow-hidden relative mb-3 group-hover:border-[var(--dashboard-accent)]/30 transition-all duration-300 shadow-sm"
        >
            {project.videoUrl && shouldRenderVideo ? (
                <video
                    ref={videoRef}
                    src={project.videoUrl}
                    className={`w-full h-full object-contain transition-opacity duration-500 pointer-events-none ${isLoaded ? 'opacity-100' : 'opacity-0'}`}
                    muted
                    loop
                    playsInline
                    autoPlay
                    preload="metadata"
                    onLoadedData={() => setIsLoaded(true)}
                    onCanPlay={() => setIsLoaded(true)}
                />
            ) : null}

            {/* Thumbnail / Placeholder */}
            {(!project.videoUrl || !isLoaded || !shouldRenderVideo) && (
                <div className={`absolute inset-0 transition-opacity duration-300 ${isLoaded && shouldRenderVideo ? 'opacity-0' : 'opacity-100'}`}>
                    {project.thumbnail ? (
                        <img
                            src={project.thumbnail}
                            alt={`${project.name} thumbnail`}
                            className="w-full h-full object-contain"
                            loading="lazy"
                        />
                    ) : (
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-[var(--dashboard-text-muted, #71717a)] gap-3">
                            <Layers size={28} strokeWidth={1.5} className="opacity-50" />
                            <span className="text-[10px] md:text-[11px] font-medium uppercase tracking-widest opacity-50">Preview</span>
                        </div>
                    )}
                </div>
            )}

            {/* Hover Overlay */}
            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20 backdrop-blur-[2px] duration-300">
                <div className="h-8 md:h-9 px-4 md:px-5 bg-white text-black text-[11px] md:text-[12px] font-bold rounded-lg shadow-lg transform translate-y-2 group-hover:translate-y-0 transition-all duration-300 uppercase tracking-tight flex items-center">
                    {buttonText}
                </div>
            </div>
        </div>
    )
})

TemplateThumbnail.displayName = 'TemplateThumbnail'

export default TemplateThumbnail
