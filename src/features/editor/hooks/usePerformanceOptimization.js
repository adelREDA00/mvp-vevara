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

        const handleVisibilityChange = () => {
            if (document.hidden) {
                // DON'T pause if we are exporting - we want the export to continue in background 
                // (though most browsers throttle timers anyway, PIXI ticker should stay active for headless rendering)
                if (isExporting) return

                console.log('[Performance] Tab hidden - pausing rendering and animations')
                
                // 1. Stop PIXI Ticker
                if (app.ticker) {
                    app.ticker.stop()
                }

                // 2. Pause MotionEngine if it was playing
                if (motionControls.isPlaying) {
                    wasPlayingRef.current = true
                    motionControls.pauseAll()
                } else {
                    wasPlayingRef.current = false
                }

                // 3. Explicitly pause any HTML Video Elements (double safety)
                const videos = document.querySelectorAll('video')
                videos.forEach(v => {
                    if (!v.paused) {
                        v.pause()
                    }
                })
            } else {
                console.log('[Performance] Tab visible - resuming rendering')

                // 1. Start PIXI Ticker
                if (app.ticker) {
                    app.ticker.start()
                }

                // 2. Resume MotionEngine ONLY if we paused it automatically
                // Note: We don't necessarily want to auto-resume as it might be jarring,
                // but for a smooth experience we can optionally resume.
                // Given the instructions, we should "pause" to be safe. 
                // Let's NOT auto-resume playback to avoid sudden audio/video start.
                // The user can press play when they come back.
            }
        }

        document.addEventListener('visibilitychange', handleVisibilityChange)
        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange)
        }
    }, [app, motionControls, isExporting])
}
