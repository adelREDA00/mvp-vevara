import { useState, useContext } from 'react'
import { useSelector, useDispatch } from 'react-redux'
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
  Undo2,
  Redo2,
  Moon,
  Sun,
} from 'lucide-react'
import { ThemeContext } from '../../../app/context/ThemeContext'
import { DropdownMenu, DropdownMenuItem } from './DropdownMenu'
import Modal from './Modal'
import { selectCanUndo, selectCanRedo } from '../../../store/slices/historySlice'
import { updateUserTheme, setLocalTheme } from '../../../store/slices/authSlice'

function TopToolbar({
  projectName = 'Untitled Project',
  onShare,
  onExport,
  onRequestGifOptions,
  onPreview,
  onProjectNameChange,
  onSave,
  isSaving,
  isDirty = false,
  lastSaved = null,
  onCanvasSizeChange,
  onToggleSidebar,
  onNavigate,
  onUndo,
  onRedo,
  hideExport = false,
  sidebarWidth = '0px',
}) {
  const { isAuthenticated, user } = useSelector((state) => state.auth)
  const dispatch = useDispatch()
  const canUndo = useSelector(selectCanUndo)
  const canRedo = useSelector(selectCanRedo)
  const { theme, setTheme } = useContext(ThemeContext)

  const handleThemeToggle = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light'
    setTheme(newTheme)
    
    // Sync with backend if authenticated
    if (isAuthenticated) {
      dispatch(setLocalTheme(newTheme))
      dispatch(updateUserTheme(newTheme))
    }
  }
  const [isEditingName, setIsEditingName] = useState(false)
  const [editedName, setEditedName] = useState(projectName)
  const [isResizeModalOpen, setIsResizeModalOpen] = useState(false)
  const [isExportModalOpen, setIsExportModalOpen] = useState(false)

  const isLight = theme === 'light'

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
    if (res === 'gif') {
      setIsExportModalOpen(false)
      if (onRequestGifOptions) onRequestGifOptions()
      return
    }
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
        className="h-10 md:h-[var(--header-height)] flex items-center justify-between pl-3 md:pl-5 pr-2 sm:px-3 md:px-4 gap-1 sm:gap-2 md:gap-3 flex-shrink-0 scrollbar-hide overflow-x-auto overflow-y-hidden relative z-50 transition-all duration-200"
        style={{
          backgroundColor: '#7c4af0',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)'
        }}
      >
        {/* Left Section: Logo, Save, Resize */}
        <div className="flex items-center gap-3 md:gap-4 flex-shrink-0">
          {/* App Logo - Text "vevara" */}
          <button
            onClick={handleLogoClick}
            className="flex items-center h-8 flex-shrink-0 hover:opacity-80 transition-opacity text-white text-[17px] md:text-[19px] font-semibold tracking-[-0.02em] pr-2"
          >
            vevara
          </button>

          {/* Undo / Redo */}
          <div className="flex items-center gap-1 bg-white/5 rounded-[12px] p-1 border border-white/5">
            <button
              onClick={onUndo}
              disabled={!canUndo}
              className="text-white/80 hover:text-white hover:bg-white/10 active:bg-white/20 h-8 w-8 rounded-[8px] transition-all flex items-center justify-center touch-manipulation disabled:opacity-30 disabled:pointer-events-none"
              title="Undo (Ctrl+Z)"
            >
              <Undo2 className="h-4 w-4" strokeWidth={2} />
            </button>
            <button
              onClick={onRedo}
              disabled={!canRedo}
              className="text-white/80 hover:text-white hover:bg-white/10 active:bg-white/20 h-8 w-8 rounded-[8px] transition-all flex items-center justify-center touch-manipulation disabled:opacity-30 disabled:pointer-events-none"
              title="Redo (Ctrl+Shift+Z)"
            >
              <Redo2 className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>

          {/* Desktop Only Actions */}
          <div className="hidden md:flex items-center gap-3">
            {/* Save Button */}
            <button
              onClick={onSave}
              disabled={isSaving}
              className="text-white hover:bg-white/10 active:bg-white/20 h-9 px-4 rounded-[10px] transition-all flex items-center gap-2 touch-manipulation whitespace-nowrap text-sm font-semibold border border-white/10 shadow-sm disabled:opacity-50 bg-white/5"
              title={isDirty ? "Unsaved Changes" : "Project Saved"}
            >
              <div className="relative flex items-center justify-center">
                <FileText className="h-3.5 w-3.5" strokeWidth={2} />
                {!isSaving && (
                  <div 
                    className={`absolute -top-1 -right-1 w-2 h-2 rounded-full border border-[#7c4af0] shadow-sm transition-colors duration-300 ${isDirty ? 'bg-red-500 animate-pulse' : 'bg-green-500'}`} 
                  />
                )}
              </div>
              <span className="xs:inline">{isSaving ? 'Saving...' : 'Save'}</span>
            </button>

            {/* Resize Button with Dropdown */}
            <DropdownMenu
              trigger={
                <button className="text-white/80 hover:text-white hover:bg-white/10 active:bg-white/20 h-9 px-4 rounded-[10px] transition-all flex items-center gap-1.5 touch-manipulation whitespace-nowrap text-sm font-semibold border border-white/5">
                  <Maximize2 className="h-3.5 w-3.5" strokeWidth={2} />
                  <span className="hidden sm:inline">Resize</span>
                  <ChevronDown className="h-3 w-3 opacity-50" strokeWidth={2} />
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

        {/* Center Section - Project Name (centered relative to workspace) */}
        <div 
          className="absolute inset-x-0 bottom-0 h-full flex items-center justify-center pointer-events-none"
          style={{ 
            left: sidebarWidth,
            right: 0
          }}
        >
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
              className="bg-transparent text-white text-center font-semibold outline-none max-w-[100px] xs:max-w-[120px] sm:max-w-xs md:max-w-md text-[15px] md:text-[16px] origin-center truncate border-none placeholder:text-white/40 focus:placeholder:opacity-0 transition-all"
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
                <div className="flex items-center gap-2 w-full">
                  <div className="relative">
                    <FileText className="h-3.5 w-3.5" />
                    {!isSaving && (
                      <div className={`absolute -top-1 -right-0.5 w-1.5 h-1.5 rounded-full border border-zinc-800 ${isDirty ? 'bg-red-500' : 'bg-green-500'}`} />
                    )}
                  </div>
                  <span className="flex-1">{isSaving ? 'Saving...' : 'Save'}</span>
                  {!isSaving && (
                    <span className={`text-[9px] font-bold uppercase ${isDirty ? 'text-red-400' : 'text-green-400'}`}>
                      {isDirty ? 'Unsaved' : 'Saved'}
                    </span>
                  )}
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setIsResizeModalOpen(true)}>
                <div className="flex items-center gap-2">
                  <Maximize2 className="h-3.5 w-3.5" />
                  <span>Resize</span>
                </div>
              </DropdownMenuItem>
              {!hideExport && (
                <DropdownMenuItem onClick={() => setIsExportModalOpen(true)}>
                  <div className="flex items-center gap-2">
                    <Download className="h-3.5 w-3.5" />
                    <span>Export</span>
                  </div>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={handleThemeToggle}>
                <div className="flex items-center gap-2">
                  {theme === 'light' ? (
                    <Moon className="h-3.5 w-3.5" />
                  ) : (
                    <Sun className="h-3.5 w-3.5" />
                  )}
                  <span>{theme === 'light' ? 'Dark Mode' : 'Light Mode'}</span>
                </div>
              </DropdownMenuItem>
            </DropdownMenu>
          </div>

          {/* Desktop Only: Export Button */}
          {!hideExport && (
            <div className="hidden md:block">
              <DropdownMenu
                trigger={
                  <button
                    className="bg-white/10 text-white hover:bg-white/20 active:bg-white/30 font-semibold gap-1.5 h-9 px-4 text-sm rounded-[10px] transition-all flex items-center touch-manipulation whitespace-nowrap border border-white/10 shadow-sm"
                    title="Export"
                  >
                    <Download className="h-3.5 w-3.5" strokeWidth={2} />
                    <span className="hidden sm:inline">Export</span>
                    <ChevronDown className="h-3 w-3 ml-0.5 opacity-50" strokeWidth={2} />
                  </button>
                }
              >
                <div className="px-3 py-1.5 text-[11px] uppercase tracking-wider text-gray-400 font-bold border-b border-white/5 mb-1">
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
                <div className="px-3 py-1.5 text-[11px] uppercase tracking-wider text-gray-400 font-bold border-b border-white/5 mb-1 mt-1">
                  Animation
                </div>
                <DropdownMenuItem onClick={() => onRequestGifOptions && onRequestGifOptions()}>
                  GIF...
                </DropdownMenuItem>
              </DropdownMenu>
            </div>
          )}

          <button
            onClick={handleThemeToggle}
            className="hidden md:flex h-9 w-9 rounded-[10px] bg-white/5 hover:bg-white/10 active:bg-white/20 items-center justify-center transition-all border border-white/5 shadow-sm text-white/80 hover:text-white"
            title={theme === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode'}
          >
            {theme === 'light' ? (
              <Moon className="h-4 w-4" strokeWidth={2} />
            ) : (
              <Sun className="h-4 w-4" strokeWidth={2} />
            )}
          </button>

          <button
            onClick={() => onNavigate && onNavigate(isAuthenticated ? "/dashboard" : "/login")}
            className="h-9 w-9 rounded-[10px] bg-[#1a1b23] hover:bg-[#25262e] active:bg-[#2a2b33] flex items-center justify-center transition-all border border-white/10 overflow-hidden flex-shrink-0 shadow-sm"
            title={isAuthenticated ? "Dashboard" : "Login"}
          >
            {isAuthenticated ? (
              <span className="text-white text-[11px] font-bold">{getUserInitials()}</span>
            ) : (
              <User className="h-4.5 w-4.5 text-white" strokeWidth={2} />
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
          {[
            { label: 'Vertical Video (TikTok / Reels / Shorts) – 1080 × 1920', w: 1080, h: 1920 },
            { label: 'Square Video (IG / FB Feed) – 1080 × 1080', w: 1080, h: 1080 },
            { label: 'Landscape Video (YouTube / FB / IG) – 1920 × 1080', w: 1920, h: 1080 },
            { label: 'Presentation (16:9) – 1920 × 1080', w: 1920, h: 1080 },
          ].map((opt, i) => (
            <button
              key={i}
              onClick={() => handleResizeOption(opt.w, opt.h)}
              className={`w-full text-left p-4 rounded-xl text-sm transition-all border ${
                isLight 
                  ? 'bg-black/5 hover:bg-black/10 text-gray-900 border-black/5' 
                  : 'bg-white/5 hover:bg-white/10 text-white border-white/5'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </Modal>

      {/* Export Modal (Mobile) */}
      <Modal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        title="Select Export Resolution"
      >
        <div className="space-y-2">
          {[
            { label: '720p (HD) (fast)', id: '720p' },
            { label: '1080p (Full HD) (fast)', id: '1080p' },
            { label: '2K (QHD) (medium)', id: '1440p' },
            { label: '4K (Ultra HD) (slightly slow)', id: '2160p' },
            { label: 'GIF (480p, 15fps)', id: 'gif' },
          ].map((opt, i) => (
            <button
              key={i}
              onClick={() => handleExportOption(opt.id)}
              className={`w-full text-left p-4 rounded-xl text-sm transition-all border ${
                isLight 
                  ? 'bg-black/5 hover:bg-black/10 text-gray-900 border-black/5' 
                  : 'bg-white/5 hover:bg-white/10 text-white border-white/5'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </Modal>
    </div>
  )
}

export default TopToolbar

