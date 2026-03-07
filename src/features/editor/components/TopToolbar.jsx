import { useState } from 'react'
import { useSelector } from 'react-redux'
import { Link } from 'react-router-dom'
import {
  Share2,
  Download,
  Eye,
  FileText,
  Maximize2,
  ChevronDown,
  Layers,
  Shapes,
  User,
} from 'lucide-react'
import { DropdownMenu, DropdownMenuItem } from './DropdownMenu'

function TopToolbar({
  projectName = 'Untitled Project',
  onShare,
  onExport,
  onPreview,
  onProjectNameChange,
  onSave,
  isSaving,
  lastSaved = null,
  onCanvasSizeChange,
  onToggleSidebar,
  onNavigate,
}) {
  const { isAuthenticated, user } = useSelector((state) => state.auth)
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
        {/* Left Section: Logo (desktop only), Save, Resize */}
        <div className="flex items-center gap-2 md:gap-3 flex-shrink-0">
          {/* App Logo - Desktop Only */}
          <Link to="/" className="hidden lg:flex items-center justify-center h-7 w-7 md:h-8 md:w-8 flex-shrink-0 hover:opacity-80 transition-opacity">
            <img
              src="/logo.svg"
              alt="App Logo"
              className="h-full w-full object-contain"
            />
          </Link>

          {/* Save Button */}
          <button
            onClick={onSave}
            disabled={isSaving}
            className="text-white hover:bg-white/10 active:bg-white/20 h-8 px-2.5 sm:px-3 rounded-lg transition-all flex items-center gap-1.5 touch-manipulation whitespace-nowrap text-[11px] font-semibold border border-white/10 shadow-sm disabled:opacity-50 bg-white/5"
            title="Save Project"
          >
            <FileText className="h-3.5 w-3.5" strokeWidth={1.5} />
            <span className="xs:inline">{isSaving ? 'Saving...' : 'Save'}</span>
          </button>

          {/* Resize Button with Dropdown */}
          <DropdownMenu
            trigger={
              <button className="text-white/80 hover:text-white hover:bg-white/10 active:bg-white/20 h-8 px-2.5 sm:px-3 rounded-lg transition-all flex items-center gap-1.5 touch-manipulation whitespace-nowrap text-[11px] font-medium border border-white/5">
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
              className="bg-transparent text-white text-center font-normal outline-none max-w-[100px] sm:max-w-xs md:max-w-md text-[11px] sm:text-xs md:text-sm truncate border-none placeholder:text-white/80"
              placeholder="Untitled"
            />
          </div>
        </div>

        {/* Right Section: User (Circle), Export, Sidebar Toggle (Mobile) */}
        <div className="flex items-center gap-1.5 md:gap-2.5 flex-shrink-0">
          {/* [FIX] Use <a> instead of <Link> to force a full page navigation.
              This ensures the WebGL context and ALL PIXI global GPU state is
              completely released by the browser before loading the dashboard.
              Same approach used by Canva for project isolation. */}
          <button
            onClick={() => onNavigate && onNavigate(isAuthenticated ? "/dashboard" : "/login")}
            className="h-8 w-8 rounded-full bg-[#1a1b23] hover:bg-[#25262e] active:bg-[#2a2b33] flex items-center justify-center transition-all border border-white/10 overflow-hidden flex-shrink-0"
            title={isAuthenticated ? "Dashboard" : "Login"}
          >
            {isAuthenticated && user?.email ? (
              <span className="text-white text-[11px] font-bold uppercase tracking-tight">
                {user.email.substring(0, 2)}
              </span>
            ) : (
              <User className="h-4 w-4 text-white" strokeWidth={1.5} />
            )}
          </button>

          {/* Export Button with Resolution Dropdown */}
          <DropdownMenu
            trigger={
              <button
                className="bg-white/10 text-white hover:bg-white/20 active:bg-white/30 font-medium gap-1.5 h-8 px-2.5 sm:px-3 text-[11px] rounded-lg transition-all flex items-center touch-manipulation whitespace-nowrap border border-white/10 shadow-sm"
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
              720p (HD) (fast)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onExport && onExport('1080p')}>
              1080p (Full HD) (fast)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onExport && onExport('1440p')}>
              2K (QHD) (medium)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onExport && onExport('2160p')}>
              4K (Ultra HD) (slightly slow)
            </DropdownMenuItem>
          </DropdownMenu>

          {/* Mobile Panel Toggle - Always ends right on mobile */}
          <button
            onClick={onToggleSidebar}
            className="lg:hidden bg-[#000]/20 text-white hover:bg-[#000]/30 active:bg-[#000]/40 h-8 w-8 rounded-lg transition-all flex items-center justify-center touch-manipulation border border-white/10 shadow-sm"
            title="Open Sidebar"
          >
            <Shapes className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>
      </div>
    </div>
  )
}

export default TopToolbar

