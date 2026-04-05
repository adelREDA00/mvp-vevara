import { useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { X } from 'lucide-react'
import { addLayerAndSelect, selectCurrentSceneId } from '../../../store/slices/projectSlice'

function FramesPanel({ onClose, aspectRatio }) {
  const dispatch = useDispatch()
  const currentSceneId = useSelector(selectCurrentSceneId)

  const getCurrentAspectRatio = () => {
    return aspectRatio || '16:9'
  }

  const getWorldDimensions = () => {
    const aspectRatio = getCurrentAspectRatio()
    const [widthRatio, heightRatio] = aspectRatio.split(':').map(Number)
    const aspectRatioValue = widthRatio / heightRatio

    if (aspectRatioValue >= 1) {
      const baseWidth = 1920
      const baseHeight = 1080
      const baseAspect = baseWidth / baseHeight

      if (Math.abs(aspectRatioValue - baseAspect) < 0.01) {
        return { worldWidth: 1920, worldHeight: 1080 }
      } else {
        const worldHeight = 1080
        const worldWidth = Math.round(worldHeight * aspectRatioValue)
        return { worldWidth, worldHeight }
      }
    } else {
      const baseWidth = 1080
      const baseHeight = 1920
      const baseAspect = baseWidth / baseHeight

      if (Math.abs(aspectRatioValue - baseAspect) < 0.01) {
        return { worldWidth: 1080, worldHeight: 1920 }
      } else {
        const worldWidth = 1080
        const worldHeight = Math.round(worldWidth / aspectRatioValue)
        return { worldWidth, worldHeight }
      }
    }
  }

  const { worldWidth, worldHeight } = getWorldDimensions()

  const framePresets = [
    { id: 'frame-square', name: 'Square Frame', width: 200, height: 200, label: '1:1' },
    { id: 'frame-landscape', name: 'Landscape Frame', width: 280, height: 180, label: '16:9' },
    { id: 'frame-portrait', name: 'Portrait Frame', width: 160, height: 240, label: '9:16' },
    { id: 'frame-wide', name: 'Wide Frame', width: 300, height: 140, label: '21:9' },
    { id: 'frame-classic', name: 'Classic Frame', width: 240, height: 180, label: '4:3' },
  ]

  const handleAddFrame = (preset) => {
    if (!currentSceneId) return
    const centerX = worldWidth / 2
    const centerY = worldHeight / 2
    dispatch(addLayerAndSelect({
      sceneId: currentSceneId,
      type: 'frame',
      name: preset.name,
      x: centerX,
      y: centerY,
      width: preset.width,
      height: preset.height,
      anchorX: 0.5,
      anchorY: 0.5,
      data: {},
    }))
  }

  const handleAddCardFrame = (preset) => {
    if (!currentSceneId) return
    const centerX = worldWidth / 2
    const centerY = worldHeight / 2
    dispatch(addLayerAndSelect({
      sceneId: currentSceneId,
      type: 'frame',
      name: preset.name.replace('Frame', 'Card'),
      x: centerX,
      y: centerY,
      width: preset.width,
      height: preset.height,
      anchorX: 0.5,
      anchorY: 0.5,
      data: { isCardFrame: true, showingFront: true },
    }))
  }

  const renderFramePreview = (item) => {
    const { preset } = item
    const maxDim = Math.max(preset.width, preset.height)
    const w = (preset.width / maxDim) * 40
    const h = (preset.height / maxDim) * 40
    const rx = (56 - w) / 2
    const ry = (56 - h) / 2

    return (
      <button
        onClick={item.onClick}
        className="w-full aspect-square flex flex-col items-center justify-center hover:bg-white/5 rounded-[12px] transition-all duration-300 group relative gap-1.5 border border-transparent hover:border-white/10 shadow-sm"
        title={preset.name}
      >
        <svg viewBox="0 0 56 56" className="w-[44px] h-[44px] flex-shrink-0 opacity-80 group-hover:opacity-100 transition-opacity">
          <rect x={rx} y={ry} width={w} height={h} rx="3" fill="none" stroke="#a1a1aa" strokeWidth="1.5" strokeDasharray="4 2" />
          {/* Plus icon in center */}
          <line x1="24" y1="28" x2="32" y2="28" stroke="#71717a" strokeWidth="1.5" />
          <line x1="28" y1="24" x2="28" y2="32" stroke="#71717a" strokeWidth="1.5" />
        </svg>
        <span className="text-[10px] text-zinc-500 font-medium tracking-wide">{preset.label}</span>
      </button>
    )
  }

  const renderTwoSidedFramePreview = (item) => {
    const { preset } = item
    const maxDim = Math.max(preset.width, preset.height)
    const w = (preset.width / maxDim) * 40
    const h = (preset.height / maxDim) * 40
    const rx = (56 - w) / 2
    const ry = (56 - h) / 2

    return (
      <button
        onClick={item.onClick}
        className="w-full aspect-square flex flex-col items-center justify-center hover:bg-white/5 rounded-[12px] transition-all duration-300 group relative gap-1.5 border border-transparent hover:border-white/10 shadow-sm"
        title={preset.name}
      >
        <svg viewBox="0 0 56 56" className="w-[44px] h-[44px] flex-shrink-0 opacity-80 group-hover:opacity-100 transition-opacity">
          <rect x={rx + 2} y={ry + 2} width={w} height={h} rx="3" fill="none" stroke="#71717a" strokeWidth="1" strokeDasharray="4 2" />
          <rect x={rx - 1} y={ry - 1} width={w} height={h} rx="3" fill="none" stroke="#a1a1aa" strokeWidth="1.5" strokeDasharray="4 2" />
          {/* Two-rotation arrow icon in center */}
          <path d="M34 22v6h-6M22 28a6 6 0 0 1 10-4.5L34 26M22 34v-6h6M34 28a6 6 0 0 1-10 4.5L22 30" 
            stroke="#71717a" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="text-[10px] text-zinc-500 font-medium tracking-wide">{preset.label}</span>
      </button>
    )
  }

  const GridSection = ({ items, sectionName, renderItem }) => (
    <div className="mb-8">
      <div className="flex items-center justify-between px-6 mb-4">
        <h3 className="text-[14px] font-semibold text-white/50 uppercase tracking-widest">{sectionName}</h3>
        <span className="text-[12px] text-zinc-600 font-medium">{items.length} items</span>
      </div>
      <div className="px-6">
        <div className="grid grid-cols-3 gap-4">
          {items.map((item) => (
            <div key={item.id}>{renderItem(item)}</div>
          ))}
        </div>
      </div>
    </div>
  )

  return (
    <div
      className="flex flex-col h-full relative transition-all duration-300"
      style={{
        width: typeof window !== 'undefined' && window.innerWidth < 1024 ? '100%' : '320px',
        backgroundColor: typeof window !== 'undefined' && window.innerWidth < 1024 ? 'transparent' : '#090a0d',
        backdropFilter: typeof window !== 'undefined' && window.innerWidth < 1024 ? 'none' : 'blur(20px)',
        WebkitBackdropFilter: typeof window !== 'undefined' && window.innerWidth < 1024 ? 'none' : 'blur(20px)',
        borderRight: typeof window !== 'undefined' && window.innerWidth < 1024 ? 'none' : '1px solid rgba(255, 255, 255, 0.05)',
      }}
    >
      <div className="px-6 pt-6 pb-4 border-b border-white/5">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-[20px] font-semibold text-white tracking-tight">Frames</h2>
          {onClose && (
            <button onClick={onClose} className="text-white/40 hover:text-white hover:bg-white/10 transition-all duration-300 p-2 rounded-[10px]">
              <X className="h-5 w-5" strokeWidth={2} />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="py-4">
          <GridSection
            sectionName="Frames"
            items={framePresets.map(p => ({ id: p.id, preset: p, onClick: () => handleAddFrame(p) }))}
            renderItem={renderFramePreview}
          />
          <GridSection
            sectionName="Two-Sided Frames"
            items={framePresets.map(p => ({ id: p.id.replace('frame-', 'two-sided-'), preset: { ...p, name: p.name.replace('Frame', 'Two-Sided') }, onClick: () => handleAddCardFrame(p) }))}
            renderItem={renderTwoSidedFramePreview}
          />
        </div>
      </div>
    </div>
  )
}

export default FramesPanel
