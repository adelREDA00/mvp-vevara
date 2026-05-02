import { useEffect, useRef } from 'react'

/**
 * Hook to optimize performance based on tab visibility.
 * Pauses rendering and animations when the tab is hidden to save GPU/CPU resources.
 * 
 * @param {Object} app - PIXI.Application instance
 * @param {Object} motionControls - Motion controls from useSimpleMotion
 * @param {boolean} isExporting - Whether a video export is currently in progress
 */
export function usePerformanceOptimization(app, motionControls, isExporting = false) {
    const wasPlayingRef = useRef(false)

    useEffect(() => {
        if (!app || !motionControls) return

        if (isExporting) {
            console.log('[Performance] Export active - pausing editor rendering')
            if (app.ticker) {
                app.ticker.stop()
            }
        } else if (!document.hidden) {
            if (app.ticker) {
                app.ticker.start()
            }
        }
    }, [app, motionControls, isExporting])

    useEffect(() => {
        if (!app || !motionControls) return

        const handleVisibilityChange = () => {
            if (document.hidden) {
                if (isExporting) return

                console.log('[Performance] Tab hidden - pausing rendering and animations')
                
                if (app.ticker) {
                    app.ticker.stop()
                }

                if (motionControls.isPlaying) {
                    wasPlayingRef.current = true
                    motionControls.pauseAll()
                } else {
                    wasPlayingRef.current = false
                }

                const videos = document.querySelectorAll('video')
                videos.forEach(v => {
                    if (!v.paused) {
                        v.pause()
                    }
                })
            } else {
                if (isExporting) return

                console.log('[Performance] Tab visible - resuming rendering')

                if (app.ticker) {
                    app.ticker.start()
                }
            }
        }

        document.addEventListener('visibilitychange', handleVisibilityChange)
        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange)
        }
    }, [app, motionControls, isExporting])

}
