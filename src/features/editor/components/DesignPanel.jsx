import { ThemeContext } from '../../../app/context/ThemeContext'
import React, { useState, useContext } from 'react'
import { X, Search } from 'lucide-react'
import { DragToCloseHandle } from './DragToCloseHandle'

function DesignPanel({ onClose }) {
  const [searchQuery, setSearchQuery] = useState('')
  const [width, setWidth] = useState(320)
  const { theme } = useContext(ThemeContext)
  const isLight = theme === 'light'

  return (
    <div
      className="flex flex-col h-full relative transition-all duration-300"
      style={{
        width: typeof window !== 'undefined' && window.innerWidth < 1024 ? '100%' : `${width}px`,
        backgroundColor: typeof window !== 'undefined' && window.innerWidth < 1024 ? 'transparent' : (isLight ? '#f3f4f7' : '#090a0d'),
        backdropFilter: typeof window !== 'undefined' && window.innerWidth < 1024 ? 'none' : 'blur(20px)',
        WebkitBackdropFilter: typeof window !== 'undefined' && window.innerWidth < 1024 ? 'none' : 'blur(20px)',
        borderRight: typeof window !== 'undefined' && window.innerWidth < 1024 ? 'none' : `1px solid ${isLight ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.05)'}`,
      }}
    >
      <DragToCloseHandle onClose={onClose} onWidthChange={setWidth} initialWidth={width} minWidth={200} />

      <div className={`px-4 pt-4 pb-3 border-b ${isLight ? 'border-black/5' : 'border-zinc-800/50'}`}>
        <div className="flex items-center justify-between mb-3">
          <h2 className={`text-lg font-semibold ${isLight ? 'text-slate-900' : 'text-white'}`}>Design</h2>
          {onClose && (
            <button
              onClick={onClose}
              className={`transition-all duration-200 p-1 rounded-lg ${isLight ? 'text-slate-400 hover:bg-slate-100 hover:text-slate-900' : 'text-white/70 hover:text-white hover:bg-white/10'}`}
            >
              <X className="h-4 w-4" strokeWidth={2} />
            </button>
          )}
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-zinc-500" strokeWidth={1.5} />
          <input
            type="text"
            placeholder="Search designs"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={`w-full pl-9 pr-4 py-2 border rounded-lg text-sm transition-all focus:outline-none focus:ring-1 ${
              isLight 
                ? 'bg-slate-50 border-slate-200 text-slate-900 placeholder-slate-400 focus:border-purple-500 focus:ring-purple-500/20' 
                : 'bg-zinc-900 border-zinc-800 text-white placeholder-zinc-500 focus:border-zinc-700 focus:ring-zinc-700'
            }`}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="space-y-4">
          <div>
            <h3 className={`text-sm font-semibold mb-3 ${isLight ? 'text-slate-700' : 'text-white'}`}>Design Templates</h3>
            <div className="grid grid-cols-2 gap-3">
              {[1, 2, 3, 4].map((item) => (
                <div key={item} className={`rounded-lg p-2 cursor-pointer transition-colors ${isLight ? 'bg-white shadow-sm border border-slate-100 hover:bg-slate-50' : 'bg-zinc-900 hover:bg-zinc-800'}`}>
                  <div className={`aspect-square rounded mb-2 flex items-center justify-center ${isLight ? 'bg-slate-50' : 'bg-zinc-800'}`}>
                    <span className="text-zinc-500 text-xs">Design {item}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default DesignPanel

