import React, { useState, useRef, useEffect, useContext } from 'react'
import { createPortal } from 'react-dom'
import { X, Droplet, ArrowLeft } from 'lucide-react'
import { ThemeContext } from '../../../app/context/ThemeContext'
import AdvancedColorPickerModal from './AdvancedColorPickerModal'

const PRESET_COLORS = [
  // Sleek transition palette (pinks & purples)
  '#5b21b6', '#7c3aed', '#8b5cf6', '#a78bfa', '#c084fc',
  // Vibrant theme accents
  '#6367FF', '#3b82f6', '#06b6d4', '#10b981', '#f59e0b',
  // Utility and solid tones
  '#ef4444', '#ec4899', '#ffffff', '#94a3b8', '#000000'
]

function TransitionColorPickerModal({ initialColor, onColorSelect, onClose, anchorElement }) {
  const { theme } = useContext(ThemeContext)
  const isLight = theme === 'light'
  
  const [activeTab, setActiveTab] = useState('presets') // 'presets' or 'custom'
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const modalRef = useRef(null)

  // Recalculate and update placement relative to anchor element
  useEffect(() => {
    const updatePosition = () => {
      if (anchorElement && modalRef.current) {
        const rect = anchorElement.getBoundingClientRect()
        
        const modalWidth = activeTab === 'presets' ? 240 : 280
        const modalHeight = activeTab === 'presets' ? 220 : 340

        let top, left

        // On mobile/narrow screens, render at bottom center as a gorgeous popup sheet
        if (window.innerWidth < 1024) {
          left = (window.innerWidth - modalWidth) / 2
          top = window.innerHeight - modalHeight - 16
        } else {
          // On desktop, float it beautifully to the right of the sidebar color circle!
          left = rect.right + 12
          top = rect.top + (rect.height / 2) - (modalHeight / 2)
          
          // Clamp top/bottom to stay on screen safely
          const maxTop = window.innerHeight - modalHeight - 16
          top = Math.max(16, Math.min(top, maxTop))
          
          // Clamp left to avoid off-screen overflow
          const maxLeft = window.innerWidth - modalWidth - 16
          left = Math.max(16, Math.min(left, maxLeft))
        }
        
        setPosition({ top, left })
      }
    }

    updatePosition()
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('resize', updatePosition)
    
    // Quick delay to ensure DOM dimensions are computed under tab transitions
    const timer = setTimeout(updatePosition, 30)

    return () => {
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('resize', updatePosition)
      clearTimeout(timer)
    }
  }, [anchorElement, activeTab])

  // Handle click outside to close the picker
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (
        modalRef.current && 
        !modalRef.current.contains(e.target) && 
        anchorElement && 
        !anchorElement.contains(e.target)
      ) {
        onClose()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onClose, anchorElement])

  const content = (
    <div
      ref={modalRef}
      className={`fixed rounded-xl border z-[10000] shadow-2xl flex flex-col overflow-hidden select-none ${
        isLight 
          ? 'border-black/10 bg-white/95 text-slate-800' 
          : 'border-white/10 bg-[#0c0d12]/95 text-white'
      }`}
      style={{
        width: activeTab === 'presets' ? '240px' : '280px',
        top: `${position.top}px`,
        left: `${position.left}px`,
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        opacity: position.top === 0 ? 0 : 1,
        transform: position.top === 0 ? 'scale(0.95)' : 'scale(1)',
        transition: 'opacity 0.15s cubic-bezier(0.16, 1, 0.3, 1), transform 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
        transformOrigin: typeof window !== 'undefined' && window.innerWidth < 1024 ? 'bottom center' : 'left center',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {activeTab === 'presets' ? (
        <>
          {/* Header */}
          <div className={`px-3 py-2.5 flex items-center justify-between border-b ${
            isLight ? 'border-black/5 bg-black/5' : 'border-white/5 bg-white/5'
          }`}>
            <span className="text-[10px] font-extrabold uppercase tracking-widest opacity-60">Presets</span>
            <button
              onClick={onClose}
              className={`p-1 rounded-md transition-colors ${
                isLight ? 'hover:bg-black/5 text-slate-400 hover:text-slate-800' : 'hover:bg-white/5 text-zinc-400 hover:text-white'
              }`}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Color Grid */}
          <div className="p-3.5 flex-1">
            <div className="grid grid-cols-5 gap-2">
              {PRESET_COLORS.map((color, index) => {
                const isSelected = initialColor?.toLowerCase() === color.toLowerCase()
                return (
                  <button
                    key={index}
                    onClick={() => {
                      onColorSelect(color)
                    }}
                    className={`w-8 h-8 rounded-full border shadow-sm transition-all duration-200 hover:scale-110 active:scale-90 ${
                      isSelected 
                        ? 'ring-2 ring-[#7c4af0] scale-105 border-white' 
                        : isLight ? 'border-black/10 hover:border-black/20' : 'border-white/10 hover:border-white/20'
                    }`}
                    style={{ backgroundColor: color }}
                    title={color}
                  />
                )
              })}
            </div>
          </div>

          {/* Custom Toggle Button */}
          <div className={`p-2.5 border-t text-center ${
            isLight ? 'border-black/5 bg-black/5' : 'border-white/5 bg-white/5'
          }`}>
            <button
              onClick={() => setActiveTab('custom')}
              className="w-full py-1.5 px-3 rounded-lg border text-[10px] font-bold tracking-wider uppercase flex items-center justify-center gap-1.5 transition-all duration-200 bg-gradient-to-r from-[#7c4af0] to-purple-600 text-white border-transparent shadow-sm hover:brightness-110 active:scale-[0.98]"
            >
              <Droplet className="h-3 w-3" />
              Custom Color
            </button>
          </div>
        </>
      ) : (
        <>
          {/* Back to Presets Header */}
          <div className={`px-3 py-2 flex items-center justify-between border-b ${
            isLight ? 'border-black/5 bg-black/5' : 'border-white/5 bg-white/5'
          }`}>
            <button
              onClick={() => setActiveTab('presets')}
              className={`flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider transition-colors ${
                isLight ? 'text-slate-500 hover:text-slate-800' : 'text-zinc-400 hover:text-white'
              }`}
            >
              <ArrowLeft className="h-3 w-3" />
              Presets
            </button>
            <button
              onClick={onClose}
              className={`p-1 rounded-md transition-colors ${
                isLight ? 'hover:bg-black/5 text-slate-400 hover:text-slate-800' : 'hover:bg-white/5 text-zinc-400 hover:text-white'
              }`}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Inline Advanced Color Picker */}
          <div className="flex-1 bg-transparent overflow-hidden">
            <AdvancedColorPickerModal
              initialColor={initialColor && initialColor !== 'transparent' ? initialColor : '#7c3aed'}
              onColorSelect={onColorSelect}
              onClose={onClose}
              isInline={true}
              hideHeader={true}
            />
          </div>
        </>
      )}
    </div>
  )

  return createPortal(content, document.body)
}

export default TransitionColorPickerModal
