import { useState } from 'react'
import { X, Search } from 'lucide-react'
import { DragToCloseHandle } from './DragToCloseHandle'

function DesignPanel({ onClose }) {
  const [searchQuery, setSearchQuery] = useState('')
  const [width, setWidth] = useState(320)

  return (
    <div
      className="flex flex-col h-full relative backdrop-blur-md transition-all duration-300"
      style={{
        width: typeof window !== 'undefined' && window.innerWidth < 1024 ? '100%' : `${width}px`,
        backgroundColor: typeof window !== 'undefined' && window.innerWidth < 1024 ? 'transparent' : 'rgba(13, 18, 22, 0.85)',
        backdropFilter: typeof window !== 'undefined' && window.innerWidth < 1024 ? 'none' : 'blur(12px)',
        WebkitBackdropFilter: typeof window !== 'undefined' && window.innerWidth < 1024 ? 'none' : 'blur(12px)',
        borderRight: typeof window !== 'undefined' && window.innerWidth < 1024 ? 'none' : '0.5px solid rgba(255, 255, 255, 0.1)',
      }}
    >
      <DragToCloseHandle onClose={onClose} onWidthChange={setWidth} initialWidth={width} minWidth={200} />

      <div className="px-4 pt-4 pb-3 border-b border-zinc-800/50">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-white">Design</h2>
          {onClose && (
            <button
              onClick={onClose}
              className="text-white/70 hover:text-white hover:bg-white/10 transition-all duration-200 p-1 rounded-lg"
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
            className="w-full pl-9 pr-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-white text-sm placeholder-zinc-500 focus:outline-none focus:border-zinc-700 focus:ring-1 focus:ring-zinc-700"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-white mb-3">Design Templates</h3>
            <div className="grid grid-cols-2 gap-3">
              {[1, 2, 3, 4].map((item) => (
                <div key={item} className="bg-zinc-900 rounded-lg p-2 cursor-pointer hover:bg-zinc-800 transition-colors">
                  <div className="aspect-square bg-zinc-800 rounded mb-2 flex items-center justify-center">
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

