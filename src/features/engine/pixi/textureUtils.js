import * as PIXI from 'pixi.js'

const _isMobile = typeof window !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)

/**
 * Robust texture loading utility that handles PIXI Asset cache and blob URLs.
 * Checks PIXI cache first to avoid redundant fetches, especially critical for blobs.
 * 
 * [MOBILE FIX] On mobile:
 *   - Caps textures to 1536px (from 2048) to reduce GPU memory
 *   - Disables mipmapping to save ~3x GPU memory per texture
 *   - Forces Image() path for all URLs to ensure capping is applied
 * 
 * @param {string} imageUrl - The URL of the image to load.
 * @returns {Promise<PIXI.Texture|null>} - Resolves with the PIXI Texture or null.
 */
export const loadTextureRobust = async (imageUrl) => {
    if (!imageUrl) return null

    // 1. Try Cache directly first
    if (PIXI.Assets.cache.has(imageUrl)) {
        const cachedAsset = PIXI.Assets.cache.get(imageUrl)
        if (cachedAsset) return cachedAsset
    }

    // [MOBILE FIX] Lowered from 2048 to 1536 for more GPU headroom on iOS
    const MAX_DIMENSION = _isMobile ? 1536 : 4096

    // Helper to resize image via offscreen canvas if it exceeds mobile limits
    const getCappedSource = (img) => {
        if (_isMobile && (img.width > MAX_DIMENSION || img.height > MAX_DIMENSION)) {
            const canvas = document.createElement('canvas')
            const scale = Math.min(MAX_DIMENSION / img.width, MAX_DIMENSION / img.height)
            canvas.width = Math.round(img.width * scale)
            canvas.height = Math.round(img.height * scale)
            const ctx = canvas.getContext('2d')
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
            return canvas
        }
        return img
    }

    // 2. For blobs or mobile: use manual Image() path for guaranteed dimension capping
    if (imageUrl.startsWith('blob:') || _isMobile) {
        return new Promise((resolve, reject) => {
            const img = new Image()
            img.crossOrigin = 'anonymous'
            img.onload = () => {
                try {
                    const source = getCappedSource(img)
                    const texture = PIXI.Texture.from(source)
                    if (texture.source) {
                        // [MOBILE FIX] Disable mipmapping on mobile — saves ~3x GPU memory per texture
                        // This was the #1 remaining crash vector: this function runs BEFORE createLayer.js
                        // and sets source properties that createLayer.js cannot override.
                        if (_isMobile) {
                            texture.source.autoGenerateMipmaps = false
                        } else {
                            texture.source.autoGenerateMipmaps = true
                            texture.source.mipMap = 'on'
                        }
                        texture.source.scaleMode = 'linear'
                    }
                    PIXI.Assets.cache.set(imageUrl, texture)
                    resolve(texture)
                } catch (e) {
                    reject(e)
                }
            }
            img.onerror = () => reject(new Error('Failed to load image'))
            img.src = imageUrl
        })
    }

    // 3. For regular URLs on Desktop: Use PIXI's asset loader
    try {
        const isSVG = imageUrl.includes('.svg')
        const loadConfig = isSVG ? { data: { resolution: 2, scale: 2 } } : undefined
        const texture = await PIXI.Assets.load(imageUrl, loadConfig)
        return texture
    } catch (error) {
        console.warn(`Failed to load texture via Assets.load: ${imageUrl}`, error)
        try {
            const texture = PIXI.Texture.from(imageUrl)
            return texture
        } catch (fallbackError) {
            console.error(`Final fallback failed for: ${imageUrl}`, fallbackError)
            return null
        }
    }
}

/**
 * Ensures a font is loaded in the browser and registered with PIXI.
 * This is critical for getting accurate text metrics before the first render.
 * 
 * @param {string} fontFamily - The name of the font family.
 * @param {string} url - The URL to the font file.
 */
export const registerFont = async (fontFamily, url) => {
    if (!fontFamily || !url) return

    try {
        // 1. Add to browser FontFaceSet
        const fontFace = new FontFace(fontFamily, `url(${url})`)
        await fontFace.load()
        document.fonts.add(fontFace)

        // 2. Add to PIXI Assets
        PIXI.Assets.add({ alias: fontFamily, src: url })
        await PIXI.Assets.load(fontFamily)
    } catch (e) {
        console.warn(`Failed to register font: ${fontFamily}`, e)
    }
}
