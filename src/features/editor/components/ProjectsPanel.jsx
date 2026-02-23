import { useState } from 'react'
import { X, Search, FolderOpen, Plus } from 'lucide-react'
import { DragToCloseHandle } from './DragToCloseHandle'

function ProjectsPanel({ onClose }) {
  const [searchQuery, setSearchQuery] = useState('')
  const [width, setWidth] = useState(320)

  const projects = [
    { name: 'Project Alpha', modified: '2 hours ago' },
    { name: 'Project Beta', modified: 'Yesterday' },
    { name: 'Project Gamma', modified: '3 days ago' },
    { name: 'Project Delta', modified: '1 week ago' },
  ]

  return (
    <div
      className="flex flex-col h-full relative backdrop-blur-md transition-all duration-300"
      style={{
        width: typeof window !== 'undefined' && window.innerWidth < 1024 ? '100%' : `${width}px`,
        backgroundColor: 'rgba(13, 18, 22, 0.85)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderRight: '0.5px solid rgba(255, 255, 255, 0.1)',
      }}
    >
      <DragToCloseHandle onClose={onClose} onWidthChange={setWidth} initialWidth={width} minWidth={200} />

      <div className="px-4 pt-4 pb-3 border-b border-zinc-800/50">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-white">Projects</h2>
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
            placeholder="Search projects"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-white text-sm placeholder-zinc-500 focus:outline-none focus:border-zinc-700 focus:ring-1 focus:ring-zinc-700"
          />
        </div>

        <button className="w-full mt-3 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2">
          <Plus className="h-4 w-4" strokeWidth={1.5} />
          New Project
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="space-y-2">
          {projects.map((project, index) => (
            <button
              key={index}
              className="w-full text-left px-4 py-3 rounded-lg bg-zinc-900 hover:bg-zinc-800 transition-colors border border-zinc-800"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 bg-zinc-800 rounded-md flex-shrink-0">
                  <FolderOpen className="h-5 w-5 text-zinc-400" strokeWidth={1.5} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{project.name}</p>
                  <p className="text-xs text-zinc-400 mt-0.5">{project.modified}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export default ProjectsPanel

