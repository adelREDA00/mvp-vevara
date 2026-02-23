import { useMemo } from 'react'

/**
 * Hook to calculate world dimensions based on aspect ratio string (e.g., "16:9").
 * Returns standard resolutions (1920x1080 for landscape, 1080x1920 for portrait)
 * or scaled dimensions for custom ratios.
 * 
 * @param {string} aspectRatio - Aspect ratio string (e.g., "16:9", "9:16", "1:1")
 * @returns {{ worldWidth: number, worldHeight: number }} Calculated world dimensions
 */
export function useWorldDimensions(aspectRatio) {
    // Parse aspect ratio - memoized to avoid repeated parsing
    const [widthRatio, heightRatio] = useMemo(() => {
        if (!aspectRatio) return [16, 9]
        return aspectRatio.split(':').map(Number)
    }, [aspectRatio])

    // Memoize world dimensions calculation
    const dimensions = useMemo(() => {
        // Use common standard resolutions based on aspect ratio
        const aspectRatioValue = widthRatio / heightRatio

        // For landscape (16:9, 4:3, etc.), use 1920x1080 as base
        // For portrait (9:16, 3:4, etc.), use 1080x1920 as base
        // Scale proportionally to maintain aspect ratio

        if (aspectRatioValue >= 1) {
            // Landscape or square
            // Standard: 1920x1080 for 16:9
            const baseWidth = 1920
            const baseHeight = 1080
            const baseAspect = baseWidth / baseHeight

            if (Math.abs(aspectRatioValue - baseAspect) < 0.01) {
                // Close to 16:9, use standard
                return { worldWidth: 1920, worldHeight: 1080 }
            } else {
                // Scale to match aspect ratio
                const worldHeight = 1080
                const worldWidth = Math.round(worldHeight * aspectRatioValue)
                return { worldWidth, worldHeight }
            }
        } else {
            // Portrait
            // Standard: 1080x1920 for 9:16
            const baseWidth = 1080
            const baseHeight = 1920
            const baseAspect = baseWidth / baseHeight

            if (Math.abs(aspectRatioValue - baseAspect) < 0.01) {
                // Close to 9:16, use standard
                return { worldWidth: 1080, worldHeight: 1920 }
            } else {
                // Scale to match aspect ratio
                const worldWidth = 1080
                const worldHeight = Math.round(worldWidth / aspectRatioValue)
                return { worldWidth, worldHeight }
            }
        }
    }, [widthRatio, heightRatio])

    return dimensions
}
