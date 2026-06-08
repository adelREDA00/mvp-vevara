import { useContext, useMemo, useRef, useEffect, useState } from 'react'
import { ThemeContext } from '../../../app/context/ThemeContext'
import { Check, Film } from 'lucide-react'
import { LAYER_TYPES } from '../../../store/models'
import { getContrastCardBg } from '../utils/contrast'

/**
 * CSS Keyframes for all preset animations.
 * Injected once into the DOM. Each preset card references these by name.
 */
const PRESET_KEYFRAMES_CSS = `
/* ── IN PRESETS ────────────────────────────────────────────────────────── */
@keyframes preset-fade-in {
  0%, 10% { opacity: 0; }
  60% { opacity: 1; }
  85%, 100% { opacity: 1; }
}
@keyframes preset-slide-in-left {
  0%, 10% { opacity: 0; transform: translateX(-60%); }
  60% { opacity: 1; transform: translateX(0); }
  85%, 100% { opacity: 1; transform: translateX(0); }
}
@keyframes preset-slide-in-right {
  0%, 10% { opacity: 0; transform: translateX(60%); }
  60% { opacity: 1; transform: translateX(0); }
  85%, 100% { opacity: 1; transform: translateX(0); }
}
@keyframes preset-slide-in-top {
  0%, 10% { opacity: 0; transform: translateY(-60%); }
  60% { opacity: 1; transform: translateY(0); }
  85%, 100% { opacity: 1; transform: translateY(0); }
}
@keyframes preset-slide-in-bottom {
  0%, 10% { opacity: 0; transform: translateY(60%); }
  60% { opacity: 1; transform: translateY(0); }
  85%, 100% { opacity: 1; transform: translateY(0); }
}
@keyframes preset-grow-in {
  0%, 10% { opacity: 0; transform: scale(0.1); }
  60% { opacity: 1; transform: scale(1); }
  85%, 100% { opacity: 1; transform: scale(1); }
}
@keyframes preset-shrink-in {
  0%, 10% { opacity: 0; transform: scale(1.8); }
  60% { opacity: 1; transform: scale(1); }
  85%, 100% { opacity: 1; transform: scale(1); }
}
@keyframes preset-spin-in {
  0%, 10% { opacity: 0; transform: rotate(-360deg) scale(0.5); }
  60% { opacity: 1; transform: rotate(0deg) scale(1); }
  85%, 100% { opacity: 1; transform: rotate(0deg) scale(1); }
}
@keyframes preset-blur-in {
  0%, 10% { opacity: 0; filter: blur(8px); }
  60% { opacity: 1; filter: blur(0); }
  85%, 100% { opacity: 1; filter: blur(0); }
}
@keyframes preset-blur-slide-in {
  0%, 10% { opacity: 0; filter: blur(8px); transform: translateX(-40%); }
  60% { opacity: 1; filter: blur(0); transform: translateX(0); }
  85%, 100% { opacity: 1; filter: blur(0); transform: translateX(0); }
}
@keyframes preset-blur-slide-in-left {
  0%, 10% { opacity: 0; filter: blur(8px); transform: translateX(-40%); }
  60% { opacity: 1; filter: blur(0); transform: translateX(0); }
  85%, 100% { opacity: 1; filter: blur(0); transform: translateX(0); }
}
@keyframes preset-blur-slide-in-right {
  0%, 10% { opacity: 0; filter: blur(8px); transform: translateX(40%); }
  60% { opacity: 1; filter: blur(0); transform: translateX(0); }
  85%, 100% { opacity: 1; filter: blur(0); transform: translateX(0); }
}
@keyframes preset-blur-slide-in-top {
  0%, 10% { opacity: 0; filter: blur(8px); transform: translateY(-40%); }
  60% { opacity: 1; filter: blur(0); transform: translateY(0); }
  85%, 100% { opacity: 1; filter: blur(0); transform: translateY(0); }
}
@keyframes preset-blur-slide-in-bottom {
  0%, 10% { opacity: 0; filter: blur(8px); transform: translateY(40%); }
  60% { opacity: 1; filter: blur(0); transform: translateY(0); }
  85%, 100% { opacity: 1; filter: blur(0); transform: translateY(0); }
}
@keyframes preset-blur-scale-in {
  0%, 10% { opacity: 0; filter: blur(8px); transform: scale(0.5); }
  60% { opacity: 1; filter: blur(0); transform: scale(1); }
  85%, 100% { opacity: 1; filter: blur(0); transform: scale(1); }
}
@keyframes preset-typewriter-in {
  0%, 5%  { opacity: 1; clip-path: inset(0 100% 0 0); }
  70%     { opacity: 1; clip-path: inset(0 0 0 0); }
  85%, 100% { opacity: 1; clip-path: inset(0 0 0 0); }
}

/* ── OUT PRESETS ───────────────────────────────────────────────────────── */
@keyframes preset-fade-out {
  0%, 15% { opacity: 1; }
  65% { opacity: 0; }
  85%, 100% { opacity: 0; }
}
@keyframes preset-slide-out-left {
  0%, 15% { opacity: 1; transform: translateX(0); }
  65% { opacity: 0; transform: translateX(-60%); }
  85%, 100% { opacity: 0; transform: translateX(-60%); }
}
@keyframes preset-slide-out-right {
  0%, 15% { opacity: 1; transform: translateX(0); }
  65% { opacity: 0; transform: translateX(60%); }
  85%, 100% { opacity: 0; transform: translateX(60%); }
}
@keyframes preset-slide-out-top {
  0%, 15% { opacity: 1; transform: translateY(0); }
  65% { opacity: 0; transform: translateY(-60%); }
  85%, 100% { opacity: 0; transform: translateY(-60%); }
}
@keyframes preset-slide-out-bottom {
  0%, 15% { opacity: 1; transform: translateY(0); }
  65% { opacity: 0; transform: translateY(60%); }
  85%, 100% { opacity: 0; transform: translateY(60%); }
}
@keyframes preset-grow-out {
  0%, 15% { opacity: 1; transform: scale(1); }
  65% { opacity: 0; transform: scale(1.8); }
  85%, 100% { opacity: 0; transform: scale(1.8); }
}
@keyframes preset-shrink-out {
  0%, 15% { opacity: 1; transform: scale(1); }
  65% { opacity: 0; transform: scale(0.1); }
  85%, 100% { opacity: 0; transform: scale(0.1); }
}
@keyframes preset-spin-out {
  0%, 15% { opacity: 1; transform: rotate(0deg) scale(1); }
  65% { opacity: 0; transform: rotate(360deg) scale(0.5); }
  85%, 100% { opacity: 0; transform: rotate(360deg) scale(0.5); }
}
@keyframes preset-blur-out {
  0%, 15% { opacity: 1; filter: blur(0); }
  65% { opacity: 0; filter: blur(8px); }
  85%, 100% { opacity: 0; filter: blur(8px); }
}
@keyframes preset-blur-slide-out {
  0%, 15% { opacity: 1; filter: blur(0); transform: translateX(0); }
  65% { opacity: 0; filter: blur(8px); transform: translateX(40%); }
  85%, 100% { opacity: 0; filter: blur(8px); transform: translateX(40%); }
}
@keyframes preset-blur-slide-out-left {
  0%, 15% { opacity: 1; filter: blur(0); transform: translateX(0); }
  65% { opacity: 0; filter: blur(8px); transform: translateX(-40%); }
  85%, 100% { opacity: 0; filter: blur(8px); transform: translateX(-40%); }
}
@keyframes preset-blur-slide-out-right {
  0%, 15% { opacity: 1; filter: blur(0); transform: translateX(0); }
  65% { opacity: 0; filter: blur(8px); transform: translateX(40%); }
  85%, 100% { opacity: 0; filter: blur(8px); transform: translateX(40%); }
}
@keyframes preset-blur-slide-out-top {
  0%, 15% { opacity: 1; filter: blur(0); transform: translateY(0); }
  65% { opacity: 0; filter: blur(8px); transform: translateY(-40%); }
  85%, 100% { opacity: 0; filter: blur(8px); transform: translateY(-40%); }
}
@keyframes preset-blur-slide-out-bottom {
  0%, 15% { opacity: 1; filter: blur(0); transform: translateY(0); }
  65% { opacity: 0; filter: blur(8px); transform: translateY(40%); }
  85%, 100% { opacity: 0; filter: blur(8px); transform: translateY(40%); }
}
@keyframes preset-blur-scale-out {
  0%, 15% { opacity: 1; filter: blur(0); transform: scale(1); }
  65% { opacity: 0; filter: blur(8px); transform: scale(0.5); }
  85%, 100% { opacity: 0; filter: blur(8px); transform: scale(0.5); }
}
`

// Inject keyframes CSS once into DOM
let _injected = false
function ensureKeyframesInjected() {
  if (_injected) return
  _injected = true
  const style = document.createElement('style')
  style.setAttribute('data-preset-keyframes', 'true')
  style.textContent = PRESET_KEYFRAMES_CSS
  document.head.appendChild(style)
}

// Shrink font size so text always fits within the fixed-size preview card
function getPreviewTextFontSize(text) {
  const len = (text || '').length
  if (len <= 3) return '11px'
  if (len <= 8) return '9px'
  if (len <= 16) return '7px'
  return '5.5px'
}

/**
 * Miniature layer visual for inside a preset preview card.
 * Renders the same visual as the layer but scaled down to fit a ~60x60 card area.
 */
function MiniLayerVisual({ layer, showingFront, isLight }) {
  if (!layer) {
    return (
      <div className={`w-[55%] h-[55%] rounded border-2 border-dashed ${
        isLight ? 'border-slate-300 bg-slate-200/30' : 'border-zinc-700 bg-zinc-800/30'
      }`} />
    )
  }

  // ── IMAGE ──────────────────────────────────────────────────────────────
  if (layer.type === LAYER_TYPES.IMAGE) {
    const src = layer.data?.url || layer.data?.src
    return src
      ? <img src={src} alt="" className="w-[80%] h-[80%] object-contain rounded-sm" />
      : <div className={`w-[55%] h-[55%] rounded ${isLight ? 'bg-slate-200' : 'bg-white/15'}`} />
  }

  // ── VIDEO ──────────────────────────────────────────────────────────────
  if (layer.type === LAYER_TYPES.VIDEO) {
    const thumb = layer.data?.thumbnail
    const assetUrl = layer.data?.url || layer.data?.src
    return (
      <div className="w-[80%] h-[80%] relative overflow-hidden rounded-sm">
        {thumb
          ? <img src={thumb} alt="" className="w-full h-full object-cover" />
          : (assetUrl ? <video src={assetUrl} className="w-full h-full object-cover" preload="metadata" muted playsInline /> : <div className={`w-full h-full ${isLight ? 'bg-slate-100' : 'bg-zinc-800'}`} />)
        }
        <div className={`absolute inset-0 flex items-center justify-center ${isLight ? 'bg-black/10' : 'bg-black/30'}`}>
          <Film className="h-2.5 w-2.5 text-white/60" />
        </div>
      </div>
    )
  }

  // ── TEXT ────────────────────────────────────────────────────────────────
  if (layer.type === LAYER_TYPES.TEXT) {
    const text = layer.data?.content || 'Aa'
    const color = layer.data?.color || (isLight ? '#111' : '#fff')
    const fs = getPreviewTextFontSize(text)
    return (
      <span
        style={{ fontSize: fs, color, lineHeight: 1.1, wordBreak: 'break-all' }}
        className="text-center font-bold max-w-[90%] overflow-hidden"
      >
        {text.slice(0, 20)}
      </span>
    )
  }

  // ── SHAPE ──────────────────────────────────────────────────────────────
  if (layer.type === LAYER_TYPES.SHAPE) {
    const fill = layer.data?.fill
    const shapeType = layer.data?.shapeType || 'rect'
    const fillColor = fill && fill !== 'transparent' ? fill : (isLight ? '#d1d5db' : 'rgba(255,255,255,0.25)')

    if (shapeType === 'circle') {
      return <div className="w-7 h-7 rounded-full" style={{ backgroundColor: fillColor }} />
    }
    if (shapeType === 'triangle') {
      return (
        <div className="w-0 h-0" style={{
          borderLeft: '10px solid transparent',
          borderRight: '10px solid transparent',
          borderBottom: `16px solid ${fillColor}`,
        }} />
      )
    }
    const cornerRadius = layer.data?.cornerRadius
    return (
      <div
        className="w-[55%] h-[55%]"
        style={{
          backgroundColor: fillColor,
          borderRadius: cornerRadius ? `${Math.min(cornerRadius, 8)}px` : '3px'
        }}
      />
    )
  }

  if (layer.type === LAYER_TYPES.FRAME) {
    const isCard = !!layer.data?.isCardFrame
    const showFrontSide = !isCard || showingFront !== false
    const assetUrl = showFrontSide ? layer.data?.assetUrl : layer.data?.backAssetUrl
    const hasAsset = !!assetUrl
    const isVideo = showFrontSide ? !!layer.data?.assetIsVideo : !!layer.data?.backAssetIsVideo

    if (hasAsset) {
      if (isVideo) {
        const thumb = showFrontSide ? layer.data?.thumbnail : layer.data?.backThumbnail
        return (
          <div className="w-[80%] h-[80%] relative overflow-hidden rounded-sm bg-black/5">
            {thumb
              ? <img src={thumb} alt="" className="w-full h-full object-cover" />
              : <video src={assetUrl} className="w-full h-full object-cover" preload="metadata" muted playsInline />
            }
            <div className={`absolute inset-0 flex items-center justify-center ${isLight ? 'bg-black/10' : 'bg-black/30'}`}>
              <Film className="h-2.5 w-2.5 text-white/60" />
            </div>
          </div>
        )
      }
      return <img src={assetUrl} alt="" className="w-[80%] h-[80%] object-contain rounded-sm" />
    }

    return (
      <div className={`w-[55%] h-[55%] rounded border-2 border-dashed ${
        isLight ? 'border-slate-300' : 'border-zinc-600'
      } flex items-center justify-center`}>
        <span className={`text-[5px] font-bold ${isLight ? 'text-slate-400' : 'text-zinc-500'}`}>
          {isCard ? (showFrontSide ? 'Front' : 'Back') : 'Frame'}
        </span>
      </div>
    )
  }

  // ── BACKGROUND ─────────────────────────────────────────────────────────
  if (layer.type === LAYER_TYPES.BACKGROUND) {
    const color = typeof layer.data?.color === 'number'
      ? '#' + layer.data.color.toString(16).padStart(6, '0')
      : (layer.data?.color || (isLight ? '#ffffff' : '#000000'))
    return <div className="w-[70%] h-[70%] rounded" style={{ backgroundColor: color }} />
  }

  // ── FALLBACK ───────────────────────────────────────────────────────────
  return (
    <div className={`w-[55%] h-[55%] rounded border-2 border-dashed ${
      isLight ? 'border-slate-300 bg-slate-200/30' : 'border-zinc-700 bg-zinc-800/30'
    }`} />
  )
}

/**
 * PresetPreviewCard — renders a preset card with a live looping CSS animation
 * of the selected layer's visual. Lightweight: pure CSS animations, no PixiJS.
 */
export default function PresetPreviewCard({ preset, layer, showingFront, isActive, onClick, isLight: isLightProp, isMobile = false }) {
  const themeCtx = useContext(ThemeContext)
  const isLight = isLightProp !== undefined ? isLightProp : themeCtx?.theme === 'light'

  // Ensure CSS keyframes are injected
  useEffect(() => {
    ensureKeyframesInjected()
  }, [])

  // Animation style from preset's cssPreview metadata
  const animationStyle = useMemo(() => {
    if (!preset?.cssPreview) return {}
    return {
      animation: `${preset.cssPreview.keyframes} ${preset.cssPreview.duration || '1.2s'} ease-in-out infinite`,
      willChange: 'transform, opacity, filter',
    }
  }, [preset?.cssPreview])

  const color = layer?.data?.color || layer?.data?.fill || (isLight ? '#111' : '#fff')
  const contrastBg = getContrastCardBg(color, isLight)

  return (
    <div
      onClick={onClick}
      className="flex flex-col items-center cursor-pointer group w-full"
    >
      {/* Card Square — contains animated mini layer */}
      <div
        className={`w-full aspect-square rounded-xl flex items-center justify-center overflow-hidden transition-all duration-200 relative ${
          isActive
            ? 'border-2 border-[#7c4af0] bg-[#7c4af0]/5 shadow-sm shadow-[#7c4af0]/15'
            : (isLight ? 'bg-slate-100 hover:bg-slate-200/85 border border-transparent' : 'bg-zinc-900/40 hover:bg-zinc-900/80 border border-white/[0.04]')
        }`}
        style={contrastBg ? { backgroundColor: contrastBg } : undefined}
      >
        {/* Animated layer preview */}
        <div
          className="flex items-center justify-center w-full h-full"
          style={animationStyle}
        >
          <MiniLayerVisual layer={layer} showingFront={showingFront} isLight={isLight} />
        </div>

        {/* Active checkmark badge */}
        {isActive && (
          <div className={`absolute rounded-full bg-[#7c4af0] flex items-center justify-center text-white shrink-0 ${isMobile ? 'top-1 right-1 w-3 h-3' : 'top-1.5 right-1.5 w-3.5 h-3.5'}`}>
            <Check className="h-2 w-2" strokeWidth={3.5} />
          </div>
        )}
      </div>

      {/* Label centered beneath card */}
      <span className={`font-medium text-center transition-colors truncate max-w-full px-0.5 ${isMobile ? 'text-[8px] mt-1' : 'text-[9px] mt-1.5'} ${
        isActive
          ? 'text-[#7c4af0]'
          : (isLight ? 'text-slate-500 group-hover:text-slate-700' : 'text-zinc-400 group-hover:text-zinc-200')
      }`}>
        {preset?.name || 'Preset'}
      </span>
    </div>
  )
}
