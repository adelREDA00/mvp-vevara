import { useState } from 'react'
import {
  Share2,
  Download,
  Eye,
  FileText,
  Maximize2,
  ChevronDown,
  Layers,
} from 'lucide-react'
import { DropdownMenu, DropdownMenuItem } from './DropdownMenu'

function TopToolbar({
  projectName = 'Untitled Project',
  onShare,
  onExport,
  onPreview,
  onProjectNameChange,
  lastSaved = null,
  onCanvasSizeChange,
}) {
  const [isEditingName, setIsEditingName] = useState(false)
  const [editedName, setEditedName] = useState(projectName)



  const handleNameSubmit = () => {
    setIsEditingName(false)
    if (onProjectNameChange && editedName !== projectName) {
      onProjectNameChange(editedName)
    }
  }


  return (
    <div className="relative z-50">
      {/* Main Header Bar */}
      <div
        className="h-10 md:h-12 flex items-center justify-between px-2 sm:px-3 md:px-4 gap-1 sm:gap-2 md:gap-4 flex-shrink-0 overflow-x-auto overflow-y-visible relative z-50 backdrop-blur-md"
        style={{
          backgroundColor: '#7c3aed',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)'
        }}
      >
        {/* Left Section: Logo, File and Resize buttons with dropdowns */}
        <div className="flex items-center gap-2 md:gap-3 flex-shrink-0">
          {/* App Logo */}
          <div className="flex items-center justify-center h-7 w-7 md:h-8 md:w-8 flex-shrink-0">
            <img
              src="/logo.svg"
              alt="App Logo"
              className="h-full w-full object-contain"
            />
          </div>

          {/* File Button with Dropdown */}
          <DropdownMenu
            trigger={
              <button className="text-white hover:bg-white/20 active:bg-white/30 h-8 px-3 rounded-md transition-colors flex items-center gap-1.5 touch-manipulation whitespace-nowrap text-xs font-medium">
                <FileText className="h-4 w-4" strokeWidth={1.5} />
                <span className="hidden sm:inline">File</span>
                <ChevronDown className="h-3 w-3" strokeWidth={1.5} />
              </button>
            }
          >
            <DropdownMenuItem onClick={() => { }}>
              New Project
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => { }}>
              Open Project
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => { }}>
              Save
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => { }}>
              Save As
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => { }}>
              Export
            </DropdownMenuItem>
          </DropdownMenu>

          {/* Resize Button with Dropdown */}
          <DropdownMenu
            trigger={
              <button className="text-white hover:bg-white/20 active:bg-white/30 h-8 px-3 rounded-md transition-colors flex items-center gap-1.5 touch-manipulation whitespace-nowrap text-xs font-medium">
                <Maximize2 className="h-4 w-4" strokeWidth={1.5} />
                <span className="hidden sm:inline">Resize</span>
                <ChevronDown className="h-3 w-3" strokeWidth={1.5} />
              </button>
            }
          >
            <DropdownMenuItem onClick={() => onCanvasSizeChange && onCanvasSizeChange(1080, 1920)}>
              Vertical Video (TikTok / Reels / Shorts) – 1080 × 1920
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onCanvasSizeChange && onCanvasSizeChange(1080, 1080)}>
              Square Video (IG / FB Feed) – 1080 × 1080
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onCanvasSizeChange && onCanvasSizeChange(1920, 1080)}>
              Landscape Video (YouTube / FB / IG) – 1920 × 1080
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onCanvasSizeChange && onCanvasSizeChange(1920, 1080)}>
              Presentation (16:9) – 1920 × 1080
            </DropdownMenuItem>
          </DropdownMenu>
        </div>

        {/* Center Section - Project Name (centered) */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="pointer-events-auto">
            <input
              type="text"
              value={isEditingName ? editedName : projectName}
              onFocus={() => setIsEditingName(true)}
              onBlur={handleNameSubmit}
              onChange={(e) => setEditedName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleNameSubmit()
                if (e.key === 'Escape') {
                  setEditedName(projectName)
                  setIsEditingName(false)
                }
              }}
              className="bg-transparent text-white text-center font-normal outline-none max-w-[140px] sm:max-w-xs md:max-w-md text-[11px] sm:text-xs md:text-sm truncate border-none placeholder:text-white/80"
              placeholder="Untitled"
            />
          </div>
        </div>

        {/* Right Section: Share, Export, Preview, Chat */}
        <div className="flex items-center gap-1 md:gap-2 flex-shrink-0">
          {/* Mobile Menu Toggle - Visible only on mobile/tablet */}
          <button
            onClick={() => onPreview && onPreview()} // Use a prop to signify menu toggle if needed, or I'll just update EditorPage to handle it
            className="lg:hidden text-white hover:bg-white/20 active:bg-white/30 h-8 w-8 rounded-md transition-colors flex items-center justify-center touch-manipulation"
            title="Menu"
            id="mobile-menu-button"
          >
            <Layers className="h-5 w-5" strokeWidth={2} />
          </button>

          {/* Share Button */}
          <button
            onClick={onShare}
            className="hidden xs:flex text-white hover:bg-white/20 active:bg-white/30 h-8 px-3 rounded-md transition-colors items-center gap-1.5 touch-manipulation whitespace-nowrap text-xs font-medium"
            title="Share"
          >
            <Share2 className="h-4 w-4" strokeWidth={1.5} />
            <span className="hidden sm:inline">Share</span>
          </button>


          {/* Preview Button */}
          <button
            onClick={onPreview}
            className="text-white hover:bg-white/20 active:bg-white/30 h-8 px-3 rounded-md transition-colors flex items-center gap-1.5 touch-manipulation whitespace-nowrap text-xs font-medium"
            title="Preview"
          >
            <Eye className="h-4 w-4" strokeWidth={1.5} />
            <span className="hidden sm:inline">Preview</span>
          </button>


          {/* Export Button */}
          <button
            onClick={onExport}
            className="bg-white text-purple-600 hover:bg-white/90 active:bg-white/80 font-medium gap-1.5 h-8 px-3 text-xs rounded-md transition-colors flex items-center touch-manipulation whitespace-nowrap"
            title="Export"
          >
            <Download className="h-3.5 w-3.5" strokeWidth={1.5} />
            <span className="hidden sm:inline">Export</span>
          </button>

        </div>
      </div>

      {/* Status Text - Under Header Right */}
      <div className="absolute top-14 right-3 md:right-4 text-xs text-gray-500" style={{
        borderTop: '1px solid rgba(255, 255, 255, 0.1)'
      }}>
        {/* Status text will be displayed here */}
      </div>
    </div>
  )
}

export default TopToolbar

