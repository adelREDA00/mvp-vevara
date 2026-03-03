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
        className="h-10 md:h-12 flex items-center justify-between px-2 sm:px-3 md:px-4 gap-1 sm:gap-2 md:gap-4 flex-shrink-0 overflow-x-auto overflow-y-visible relative z-50"
        style={{
          backgroundColor: 'rgba(124, 74, 240, 0.82)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.05)'
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


          {/* Resize Button with Dropdown */}
          <DropdownMenu
            trigger={
              <button className="text-white/80 hover:text-white hover:bg-white/10 active:bg-white/20 h-8 px-3 rounded-lg transition-all flex items-center gap-1.5 touch-manipulation whitespace-nowrap text-[11px] font-medium border border-white/5">
                <Maximize2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                <span className="hidden sm:inline">Resize</span>
                <ChevronDown className="h-3 w-3 opacity-50" strokeWidth={1.5} />
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
            className="lg:hidden text-white/80 hover:text-white hover:bg-white/10 active:bg-white/20 h-8 w-8 rounded-lg transition-all flex items-center justify-center touch-manipulation border border-white/5"
            title="Menu"
            id="mobile-menu-button"
          >
            <Layers className="h-4.5 w-4.5" strokeWidth={1.5} />
          </button>

          {/* Share Button */}
          <button
            onClick={onShare}
            className="hidden xs:flex text-white/80 hover:text-white hover:bg-white/10 active:bg-white/20 h-8 px-3 rounded-lg transition-all items-center gap-1.5 touch-manipulation whitespace-nowrap text-[11px] font-medium border border-white/5"
            title="Share"
          >
            <Share2 className="h-3.5 w-3.5" strokeWidth={1.5} />
            <span className="hidden sm:inline">Share</span>
          </button>




          {/* Export Button with Resolution Dropdown */}
          <DropdownMenu
            trigger={
              <button
                className="bg-white/10 text-white hover:bg-white/20 active:bg-white/30 font-medium gap-1.5 h-8 px-3 text-[11px] rounded-lg transition-all flex items-center touch-manipulation whitespace-nowrap border border-white/10 shadow-sm"
                title="Export"
              >
                <Download className="h-3.5 w-3.5" strokeWidth={1.5} />
                <span className="hidden sm:inline">Export</span>
                <ChevronDown className="h-3 w-3 ml-0.5 opacity-50" strokeWidth={1.5} />
              </button>
            }
          >
            <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-gray-400 font-bold border-b border-white/5 mb-1">
              Select Resolution
            </div>
            <DropdownMenuItem onClick={() => onExport && onExport('720p')}>
              720p (HD)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onExport && onExport('1080p')}>
              1080p (Full HD)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onExport && onExport('1440p')}>
              2K (QHD)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onExport && onExport('2160p')}>
              4K (Ultra HD)
            </DropdownMenuItem>
          </DropdownMenu>

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

