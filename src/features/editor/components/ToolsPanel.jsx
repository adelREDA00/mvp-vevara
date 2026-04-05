import { useState } from 'react'
import { X, Search, Wand2, Sparkles, Palette, Layers, AlertTriangle } from 'lucide-react'
import { DragToCloseHandle } from './DragToCloseHandle'

function ToolsPanel({ onClose }) {
  const [searchQuery, setSearchQuery] = useState('')
  const [width, setWidth] = useState(320)

  const tools = [
    {
      icon: Sparkles,
      name: 'Background Removal',
      description: 'Remove backgrounds from images instantly',
      isComingSoon: true
    },
    {
      icon: Wand2,
      name: 'Quality Enhancement',
      description: 'Upscale and improve image clarity',
      isComingSoon: true
    },
  ]

  const filteredTools = tools.filter(tool =>
    tool.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    tool.description.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <div
      className="flex flex-col h-full relative transition-all duration-300"
      style={{
        width: typeof window !== 'undefined' && window.innerWidth < 1024 ? '100%' : `${width}px`,
        backgroundColor: typeof window !== 'undefined' && window.innerWidth < 1024 ? 'transparent' : '#090a0d',
        backdropFilter: typeof window !== 'undefined' && window.innerWidth < 1024 ? 'none' : 'blur(20px)',
        WebkitBackdropFilter: typeof window !== 'undefined' && window.innerWidth < 1024 ? 'none' : 'blur(20px)',
        borderRight: typeof window !== 'undefined' && window.innerWidth < 1024 ? 'none' : '1px solid rgba(255, 255, 255, 0.05)',
      }}
    >
      <DragToCloseHandle onClose={onClose} onWidthChange={setWidth} initialWidth={width} minWidth={200} />

      <div className="px-6 pt-6 pb-5 border-b border-white/5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[20px] font-semibold text-white tracking-tight">Tools</h2>
          {onClose && (
            <button
              onClick={onClose}
              className="text-white/40 hover:text-white hover:bg-white/10 transition-all duration-300 p-2 rounded-[10px]"
            >
              <X className="h-5 w-5" strokeWidth={2} />
            </button>
          )}
        </div>

        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 transform -translate-y-1/2 h-4 w-4 text-zinc-500" strokeWidth={2} />
          <input
            type="text"
            placeholder="Search AI tools..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-[12px] text-white text-[14px] placeholder-zinc-600 focus:outline-none focus:border-white/20 focus:ring-1 focus:ring-white/20 transition-all"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 scrollbar-hide">
        <div className="space-y-3">
          {filteredTools.map((tool, index) => {
            const Icon = tool.icon
            return (
              <button
                key={index}
                title={tool.isComingSoon ? "This is currently under development" : ""}
                className={`w-full text-left px-5 py-5 rounded-[16px] bg-white/5 transition-all duration-300 border border-white/5 flex-shrink-0 relative group shadow-sm ${tool.isComingSoon ? 'opacity-60 cursor-not-allowed grayscale-[0.5]' : 'hover:bg-white/10 hover:border-white/10 hover:shadow-medium active:scale-[0.98]'}`}
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-[#7c4af0]/10 rounded-[12px] flex items-center justify-center flex-shrink-0 transition-colors group-hover:bg-[#7c4af0]/20">
                    <Icon className="h-6 w-6 text-[#7c4af0]" strokeWidth={2} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="text-[15px] font-semibold text-white tracking-tight">{tool.name}</p>
                      {tool.isComingSoon && (
                        <span className="text-[9px] bg-yellow-500/10 text-yellow-500 px-1.5 py-0.5 rounded-full font-bold uppercase tracking-widest">Soon</span>
                      )}
                    </div>
                    <p className="text-[13px] text-zinc-500 leading-snug group-hover:text-zinc-400 transition-colors">{tool.description}</p>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default ToolsPanel
