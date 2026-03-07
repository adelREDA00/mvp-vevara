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
        backgroundColor: typeof window !== 'undefined' && window.innerWidth < 1024 ? 'transparent' : '#0f1015',
        backdropFilter: typeof window !== 'undefined' && window.innerWidth < 1024 ? 'none' : 'blur(20px)',
        WebkitBackdropFilter: typeof window !== 'undefined' && window.innerWidth < 1024 ? 'none' : 'blur(20px)',
        borderRight: typeof window !== 'undefined' && window.innerWidth < 1024 ? 'none' : '1px solid rgba(255, 255, 255, 0.05)',
      }}
    >
      <DragToCloseHandle onClose={onClose} onWidthChange={setWidth} initialWidth={width} minWidth={200} />

      <div className="px-4 pt-4 pb-3 border-b border-zinc-800/50">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-white">Tools</h2>
          {onClose && (
            <button
              onClick={onClose}
              className="text-zinc-400 hover:text-white transition-colors p-1 rounded-md hover:bg-zinc-800"
            >
              <X className="h-4 w-4" strokeWidth={1.5} />
            </button>
          )}
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-zinc-500" strokeWidth={1.5} />
          <input
            type="text"
            placeholder="Search tools"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-white text-sm placeholder-zinc-500 focus:outline-none focus:border-zinc-700 focus:ring-1 focus:ring-zinc-700"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="space-y-2">
          {filteredTools.map((tool, index) => {
            const Icon = tool.icon
            return (
              <button
                key={index}
                title={tool.isComingSoon ? "This is currently under development coming soon" : ""}
                className={`w-full text-left px-4 py-3 rounded-lg bg-zinc-900 transition-colors border border-zinc-800 ${tool.isComingSoon ? 'opacity-80 cursor-not-allowed' : 'hover:bg-zinc-800'}`}
              >
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-purple-500/10 rounded-md flex-shrink-0 relative">
                    <Icon className="h-5 w-5 text-purple-400" strokeWidth={1.5} />
                    {tool.isComingSoon && (
                      <div className="absolute -top-1 -right-1 bg-yellow-500 rounded-full p-0.5 border border-zinc-900 shadow-sm">
                        <AlertTriangle className="h-2.5 w-2.5 text-zinc-900" fill="currentColor" strokeWidth={3} />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-white">{tool.name}</p>
                      {tool.isComingSoon && (
                        <span className="text-[10px] text-yellow-500/80 font-bold uppercase tracking-wider">Soon</span>
                      )}
                    </div>
                    <p className="text-xs text-zinc-400 mt-0.5">{tool.description}</p>
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
