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
  LayoutDashboard,
  MoreVertical,
} from 'lucide-react'
import { DropdownMenu, DropdownMenuItem } from './DropdownMenu'
import Modal from './Modal'

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
  const [isResizeModalOpen, setIsResizeModalOpen] = useState(false)
  const [isExportModalOpen, setIsExportModalOpen] = useState(false)

  const handleNameSubmit = () => {
    setIsEditingName(false)
    if (onProjectNameChange && editedName !== projectName) {
      onProjectNameChange(editedName)
    }
  }

  const getUserInitials = () => {
    if (!user || !user.email) return ''
    return user.email.substring(0, 2).toUpperCase()
  }

  const handleResizeOption = (w, h) => {
    if (onCanvasSizeChange) onCanvasSizeChange(w, h)
    setIsResizeModalOpen(false)
  }

  const handleExportOption = (res) => {
    if (onExport) onExport(res)
    setIsExportModalOpen(false)
  }

  const handleLogoClick = () => {
    if (onNavigate) {
      onNavigate(isAuthenticated ? "/dashboard" : "/login")
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
        {/* Left Section: Logo, Save, Resize */}
        <div className="flex items-center gap-2 md:gap-3 flex-shrink-0">
          {/* App Logo - Behaves like user/dash icon */}
          <button
            onClick={handleLogoClick}
            className="flex items-center justify-center h-7 w-7 md:h-8 md:w-8 flex-shrink-0 hover:opacity-80 transition-opacity"
          >
            <img
              src="/logo.svg"
              alt="App Logo"
              className="h-full w-full object-contain"
            />
          </button>

          {/* Desktop Only Actions */}
          <div className="hidden md:flex items-center gap-2 md:gap-3">
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
              className="bg-transparent text-white text-center font-normal outline-none max-w-[80px] sm:max-w-xs md:max-w-md text-[16px] md:text-sm scale-[0.6875] md:scale-100 origin-center truncate border-none placeholder:text-white/80"
              placeholder="Untitled"
            />
          </div>
        </div>

        {/* Right Section: User (Circle), Export, Sidebar Toggle (Mobile) */}
        <div className="flex items-center gap-1.5 md:gap-2.5 flex-shrink-0">
          {/* Mobile Only: 3 Dots Menu */}
          <div className="md:hidden">
            <DropdownMenu
              trigger={
                <button className="text-white/80 hover:text-white hover:bg-white/10 active:bg-white/20 h-8 w-8 rounded-lg transition-all flex items-center justify-center touch-manipulation border border-white/5">
                  <MoreVertical className="h-4 w-4" strokeWidth={1.5} />
                </button>
              }
            >
              <DropdownMenuItem onClick={onSave}>
                <div className="flex items-center gap-2">
                  <FileText className="h-3.5 w-3.5" />
                  <span>{isSaving ? 'Saving...' : 'Save'}</span>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setIsResizeModalOpen(true)}>
                <div className="flex items-center gap-2">
                  <Maximize2 className="h-3.5 w-3.5" />
                  <span>Resize</span>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setIsExportModalOpen(true)}>
                <div className="flex items-center gap-2">
                  <Download className="h-3.5 w-3.5" />
                  <span>Export</span>
                </div>
              </DropdownMenuItem>
            </DropdownMenu>
          </div>

          {/* Desktop Only: Export Button */}
          <div className="hidden md:block">
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
          </div>

          <button
            onClick={() => onNavigate && onNavigate(isAuthenticated ? "/dashboard" : "/login")}
            className="h-8 w-8 rounded-full bg-[#1a1b23] hover:bg-[#25262e] active:bg-[#2a2b33] flex items-center justify-center transition-all border border-white/10 overflow-hidden flex-shrink-0"
            title={isAuthenticated ? "Dashboard" : "Login"}
          >
            {isAuthenticated ? (
              <span className="text-white text-[10px] font-bold">{getUserInitials()}</span>
            ) : (
              <User className="h-4 w-4 text-white" strokeWidth={1.5} />
            )}
          </button>

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

      {/* Resize Modal (Mobile) */}
      <Modal
        isOpen={isResizeModalOpen}
        onClose={() => setIsResizeModalOpen(false)}
        title="Choose Canvas Size"
      >
        <div className="space-y-2">
          <button
            onClick={() => handleResizeOption(1080, 1920)}
            className="w-full text-left p-3 rounded-lg bg-white/5 hover:bg-white/10 text-white text-sm transition-colors border border-white/5"
          >
            Vertical Video (TikTok / Reels / Shorts) – 1080 × 1920
          </button>
          <button
            onClick={() => handleResizeOption(1080, 1080)}
            className="w-full text-left p-3 rounded-lg bg-white/5 hover:bg-white/10 text-white text-sm transition-colors border border-white/5"
          >
            Square Video (IG / FB Feed) – 1080 × 1080
          </button>
          <button
            onClick={() => handleResizeOption(1920, 1080)}
            className="w-full text-left p-3 rounded-lg bg-white/5 hover:bg-white/10 text-white text-sm transition-colors border border-white/5"
          >
            Landscape Video (YouTube / FB / IG) – 1920 × 1080
          </button>
          <button
            onClick={() => handleResizeOption(1920, 1080)}
            className="w-full text-left p-3 rounded-lg bg-white/5 hover:bg-white/10 text-white text-sm transition-colors border border-white/5"
          >
            Presentation (16:9) – 1920 × 1080
          </button>
        </div>
      </Modal>

      {/* Export Modal (Mobile) */}
      <Modal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        title="Select Export Resolution"
      >
        <div className="space-y-2">
          <button
            onClick={() => handleExportOption('720p')}
            className="w-full text-left p-3 rounded-lg bg-white/5 hover:bg-white/10 text-white text-sm transition-colors border border-white/5"
          >
            720p (HD) (fast)
          </button>
          <button
            onClick={() => handleExportOption('1080p')}
            className="w-full text-left p-3 rounded-lg bg-white/5 hover:bg-white/10 text-white text-sm transition-colors border border-white/5"
          >
            1080p (Full HD) (fast)
          </button>
          <button
            onClick={() => handleExportOption('1440p')}
            className="w-full text-left p-3 rounded-lg bg-white/5 hover:bg-white/10 text-white text-sm transition-colors border border-white/5"
          >
            2K (QHD) (medium)
          </button>
          <button
            onClick={() => handleExportOption('2160p')}
            className="w-full text-left p-3 rounded-lg bg-white/5 hover:bg-white/10 text-white text-sm transition-colors border border-white/5"
          >
            4K (Ultra HD) (slightly slow)
          </button>
        </div>
      </Modal>
    </div>
  )
}

export default TopToolbar

