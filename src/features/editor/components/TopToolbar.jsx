import { useState, useContext } from 'react'
import { useSelector, useDispatch } from 'react-redux'
import { Link } from 'react-router-dom'
import {
  Share2,
  Download,
  Eye,
  EyeOff,
  FileText,
  Maximize2,
  ChevronDown,
  Layers,
  Menu,
  LayoutDashboard,
  MoreVertical,
  Undo2,
  Redo2,
  Home,
  Play,
} from 'lucide-react'
import { ThemeContext } from '../../../app/context/ThemeContext'
import { DropdownMenu, DropdownMenuItem } from './DropdownMenu'
import Modal from './Modal'
import { selectCanUndo, selectCanRedo } from '../../../store/slices/historySlice'
import { updateUserTheme, setLocalTheme } from '../../../store/slices/authSlice'

const AspectShape = ({ aspect }) => {
  if (aspect === '9:16') {
    return <div className="w-2.5 h-4 border border-current rounded-sm flex-shrink-0" style={{ borderWidth: '1.5px' }} />
  }
  if (aspect === '1:1') {
    return <div className="w-3.5 h-3.5 border border-current rounded-sm flex-shrink-0" style={{ borderWidth: '1.5px' }} />
  }
  if (aspect === '16:9') {
    return <div className="w-4 h-2.5 border border-current rounded-sm flex-shrink-0" style={{ borderWidth: '1.5px' }} />
  }
  return null
}

function TopToolbar({
  projectName = 'Untitled Project',
  onShare,
  onExport,
  onRequestGifOptions,
  onPreview,
  onEnterPreview,
  onProjectNameChange,
  onSave,
  isSaving,
  isDirty = false,
  lastSaved = null,
  onCanvasSizeChange,
  onCopyAndResize,
  onToggleSidebar,
  onNavigate,
  onUndo,
  onRedo,
  hideExport = false,
  sidebarWidth = '0px',
  showPasteboard = true,
  onTogglePasteboard,
}) {
  const { isAuthenticated } = useSelector((state) => state.auth)
  const dispatch = useDispatch()
  const canUndo = useSelector(selectCanUndo)
  const canRedo = useSelector(selectCanRedo)
  const { theme } = useContext(ThemeContext)
  const [isEditingName, setIsEditingName] = useState(false)
  const [editedName, setEditedName] = useState(projectName)
  const [isResizeModalOpen, setIsResizeModalOpen] = useState(false)
  const [isExportModalOpen, setIsExportModalOpen] = useState(false)

  const isLight = theme === 'light'

  // Redesigned state variables
  const [exportFormat, setExportFormat] = useState('mp4')
  const [exportResolution, setExportResolution] = useState('1080p')
  const [gifWidth, setGifWidth] = useState(720)
  const [gifFps, setGifFps] = useState(24)
  const [gifLoop, setGifLoop] = useState(0)

  const [resizeAspect, setResizeAspect] = useState('9:16')
  const [resizeStatus, setResizeStatus] = useState('idle')
  const [copiedProject, setCopiedProject] = useState(null)

  const handleNameSubmit = () => {
    setIsEditingName(false)
    if (onProjectNameChange && editedName !== projectName) {
      onProjectNameChange(editedName)
    }
  }

  const handleResizeThisDesign = (closeMenu = null) => {
    let w = 1080, h = 1920
    if (resizeAspect === '1:1') {
      w = 1080; h = 1080;
    } else if (resizeAspect === '16:9') {
      w = 1920; h = 1080;
    }
    if (onCanvasSizeChange) onCanvasSizeChange(w, h)
    setIsResizeModalOpen(false)
    if (closeMenu) closeMenu()
  }

  const handleCopyAndResizeAction = async () => {
    let w = 1080, h = 1920
    let formatLabel = 'Vertical'
    if (resizeAspect === '1:1') {
      w = 1080; h = 1080;
      formatLabel = 'Square'
    } else if (resizeAspect === '16:9') {
      w = 1920; h = 1080;
      formatLabel = 'Landscape'
    }

    try {
      setResizeStatus('copying')
      await new Promise(r => setTimeout(r, 600))

      setResizeStatus('resizing')
      const result = await onCopyAndResize?.(w, h)
      await new Promise(r => setTimeout(r, 400))

      setResizeStatus('completed')
      setCopiedProject({
        id: result?.id,
        name: result?.name || 'Copied Project',
        format: formatLabel
      })
    } catch (err) {
      console.error(err)
      setResizeStatus('error')
    }
  }

  const handleLogoClick = () => {
    if (onNavigate) {
      onNavigate("/dashboard")
    }
  }

  return (
    <div className="relative z-50">
      {/* Main Header Bar */}
      <div
        className="h-10 md:h-[var(--header-height)] flex items-center justify-between pl-3 md:pl-5 pr-2 sm:px-3 md:px-4 gap-1 sm:gap-2 md:gap-3 flex-shrink-0 scrollbar-hide overflow-x-auto overflow-y-hidden relative z-50 transition-all duration-200"
        style={{
          backgroundColor: '#19171C',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',

        }}
      >
        {/* Left Section: Logo, Save, Resize */}
        <div className="flex items-center gap-3 md:gap-4 flex-shrink-0">
          {/* App Logo - Home Icon */}
          <button
            onClick={handleLogoClick}
            className="flex h-9 w-9 rounded-[10px] hover:bg-white/10 active:bg-white/20 items-center justify-center transition-all text-[#F5F5F5] hover:text-white"
            title="Home"
          >
            <Home className="h-4 w-4" strokeWidth={2} />
          </button>


          {/* Desktop Only Actions */}
          <div className="hidden md:flex items-center gap-3">
            {/* Save Button */}
            <button
              onClick={onSave}
              disabled={isSaving}
              className="text-[#F5F5F5] hover:text-white hover:bg-white/10 active:bg-white/20 h-9 px-3 rounded-[10px] transition-all flex items-center gap-2 touch-manipulation whitespace-nowrap text-sm font-semibold disabled:opacity-50"
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

            {/* Resize Button with Redesigned Dropdown */}
            <DropdownMenu
              style={{
                backgroundColor: isLight ? '#ffffff' : '#090A0D',
                borderColor: isLight ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.1)',
                color: isLight ? '#1f2937' : '#F5F5F5',
                width: '300px',
                padding: '16px'
              }}
              trigger={
                <button className="text-[#F5F5F5] hover:text-white hover:bg-white/10 active:bg-white/20 h-9 px-3 rounded-[10px] transition-all flex items-center gap-1.5 touch-manipulation whitespace-nowrap text-sm font-semibold">
                  <Maximize2 className="h-3.5 w-3.5" strokeWidth={2} />
                  <span className="hidden sm:inline">Resize</span>
                  <ChevronDown className="h-3 w-3 opacity-50" strokeWidth={2} />
                </button>
              }
            >
              {(close) => (
                <div className="flex flex-col gap-3">
                  {resizeStatus === 'idle' ? (
                    <>
                      <div className={`text-xs font-bold uppercase tracking-wider mb-1 ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>
                        Select Aspect Ratio
                      </div>
                      <div className="flex flex-col gap-1.5">
                        {[
                          { label: 'Vertical', aspect: '9:16' },
                          { label: 'Square', aspect: '1:1' },
                          { label: 'Landscape', aspect: '16:9' },
                        ].map((opt) => (
                          <button
                            type="button"
                            key={opt.aspect}
                            onClick={() => setResizeAspect(opt.aspect)}
                            className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-all border flex items-center gap-2.5 ${resizeAspect === opt.aspect
                              ? isLight
                                ? 'bg-black/5 border-black/30 text-black font-semibold'
                                : 'bg-white/10 border-white/30 text-white font-semibold'
                              : isLight
                                ? 'bg-transparent border-transparent text-gray-500 hover:bg-black/5 hover:text-black'
                                : 'bg-transparent border-transparent text-white/50 hover:bg-white/5 hover:text-white'
                              }`}
                          >
                            <AspectShape aspect={opt.aspect} />
                            <span>{opt.label}</span>
                          </button>
                        ))}
                      </div>

                      <div className={`flex flex-col gap-2 mt-2 pt-2 border-t ${isLight ? 'border-black/5' : 'border-white/5'}`}>
                        <button
                          type="button"
                          onClick={handleCopyAndResizeAction}
                          className="w-full bg-[#7c4af0] hover:bg-[#6b3ee3] text-white py-2 rounded-lg text-sm font-semibold transition-all shadow-lg shadow-purple-500/10"
                        >
                          Copy & Resize
                        </button>
                        <button
                          type="button"
                          onClick={() => handleResizeThisDesign(close)}
                          className={`w-full py-2 rounded-lg text-sm font-semibold transition-all border ${isLight
                            ? 'bg-white hover:bg-gray-50 border-gray-200 text-gray-755'
                            : 'bg-white/5 hover:bg-white/10 border-white/10 text-white'
                            }`}
                        >
                          Resize This Design
                        </button>
                      </div>
                    </>
                  ) : resizeStatus === 'copying' || resizeStatus === 'resizing' ? (
                    <div className="flex flex-col py-4 px-1 text-left">
                      <div className={`text-sm font-semibold mb-2 ${isLight ? 'text-gray-900' : 'text-white'}`}>
                        {resizeStatus === 'copying' ? 'Copying progress...' : 'Resize progress...'}
                      </div>
                      <div className="w-full h-2 rounded-full overflow-hidden bg-black/10 dark:bg-white/10 mb-3">
                        <div
                          className="h-full bg-gradient-to-r from-cyan-400 to-[#7c4af0] rounded-full transition-all duration-500 ease-out"
                          style={{ width: `${resizeStatus === 'copying' ? 45 : 85}%` }}
                        />
                      </div>
                      <div className="text-xs text-gray-400">Please wait a moment...</div>
                    </div>
                  ) : resizeStatus === 'completed' && copiedProject ? (
                    <div className="flex flex-col gap-3 py-2">
                      <div className={`text-sm font-semibold text-center ${isLight ? 'text-gray-900' : 'text-white'}`}>
                        Copied & resized to {copiedProject.format}!
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          if (onNavigate) {
                            onNavigate(`/project/${copiedProject.id}`)
                          } else {
                            window.location.href = `/project/${copiedProject.id}`
                          }
                          setResizeStatus('idle')
                          setCopiedProject(null)
                          close()
                        }}
                        className="w-full bg-[#7c4af0] hover:bg-[#6b3ee3] text-white py-2.5 rounded-lg text-sm font-semibold transition-all shadow-lg shadow-purple-500/15"
                      >
                        Open {copiedProject.format} Version
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setResizeStatus('idle')
                          setCopiedProject(null)
                          close()
                        }}
                        className={`w-full py-2.5 rounded-lg text-sm font-semibold transition-all border ${isLight ? 'bg-white hover:bg-gray-50 border-gray-200 text-gray-700' : 'bg-white/5 hover:bg-white/10 border-white/10 text-white'
                          }`}
                      >
                        Close
                      </button>
                    </div>
                  ) : (
                    <div className="text-center py-4">
                      <div className="text-sm text-red-400">An error occurred</div>
                      <button
                        type="button"
                        onClick={() => setResizeStatus('idle')}
                        className="mt-3 bg-[#7c4af0] hover:bg-[#6b3ee3] text-white px-3 py-1.5 rounded-lg text-xs font-semibold"
                      >
                        Try Again
                      </button>
                    </div>
                  )}
                </div>
              )}
            </DropdownMenu>
          </div>

          {/* Undo / Redo */}
          <div className="flex items-center gap-0.5">
            <button
              onClick={onUndo}
              disabled={!canUndo}
              className="text-[#F5F5F5] hover:text-white hover:bg-white/10 active:bg-white/20 h-8 w-8 rounded-[8px] transition-all flex items-center justify-center touch-manipulation disabled:opacity-30 disabled:pointer-events-none"
              title="Undo (Ctrl+Z)"
            >
              <Undo2 className="h-4 w-4" strokeWidth={2} />
            </button>
            <button
              onClick={onRedo}
              disabled={!canRedo}
              className="text-[#F5F5F5] hover:text-white hover:bg-white/10 active:bg-white/20 h-8 w-8 rounded-[8px] transition-all flex items-center justify-center touch-manipulation disabled:opacity-30 disabled:pointer-events-none"
              title="Redo (Ctrl+Shift+Z)"
            >
              <Redo2 className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>



        </div>

        {/* Center Section - Project Name or Open Account Button */}
        <div
          className="absolute inset-x-0 bottom-0 h-full flex items-center justify-center pointer-events-none"
          style={{
            left: sidebarWidth,
            right: 0,
            transform: sidebarWidth !== '0px' ? 'translateX(-40px)' : 'none'
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
              className="bg-transparent text-[#F5F5F5] text-center font-semibold outline-none max-w-[100px] xs:max-w-[120px] sm:max-w-xs md:max-w-md text-[15px] md:text-[16px] origin-center truncate border-none placeholder:text-white/40 focus:placeholder:opacity-0 transition-all"
              placeholder="Untitled"
            />
          </div>
        </div>

        {/* Right Section: User (Circle), Export, Sidebar Toggle (Mobile) */}
        <div className="flex items-center gap-1.5 md:gap-2.5 flex-shrink-0">
          {/* Pasteboard Toggle Button (Always Visible) */}
          <button
            onClick={() => onTogglePasteboard?.()}
            className="text-[#F5F5F5] hover:text-white hover:bg-white/10 active:bg-white/20 font-semibold gap-1.5 h-9 px-2 md:px-3 text-sm rounded-[10px] transition-all flex items-center touch-manipulation whitespace-nowrap"
            title={showPasteboard ? "Switch to Canvas View" : "Switch to Workspace View"}
          >
            {showPasteboard ? (
              <Eye className="h-4 w-4" strokeWidth={2} />
            ) : (
              <EyeOff className="h-4 w-4" strokeWidth={2} />
            )}
            <span className="hidden md:inline">
              {showPasteboard ? "Workspace View" : "Canvas View"}
            </span>
          </button>

          {/* Preview Button */}
          {onEnterPreview && (
            <button
              onClick={onEnterPreview}
              className="text-[#F5F5F5] hover:text-white hover:bg-white/10 active:bg-white/20 font-semibold gap-1.5 h-9 px-2 md:px-3 text-sm rounded-[10px] transition-all flex items-center touch-manipulation whitespace-nowrap"
              title="Preview"
            >
              <Play className="h-3.5 w-3.5" strokeWidth={2} fill="currentColor" />
              <span className="hidden md:inline">Preview</span>
            </button>
          )}

          {/* Mobile Only: 3 Dots Menu */}
          <div className="md:hidden">
            <DropdownMenu
              style={{
                backgroundColor: isLight ? '#ffffff' : '#19171C',
                borderColor: isLight ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.1)',
                color: isLight ? '#1f2937' : '#F5F5F5'
              }}
              trigger={
                <button className="text-[#F5F5F5] hover:text-white hover:bg-white/10 active:bg-white/20 h-8 w-8 rounded-lg transition-all flex items-center justify-center touch-manipulation">
                  <MoreVertical className="h-4 w-4" strokeWidth={1.5} />
                </button>
              }
            >
              <DropdownMenuItem onClick={onSave} className={isLight ? 'hover:bg-black/5 text-gray-900' : 'hover:bg-white/5 text-white'}>
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
              <DropdownMenuItem onClick={() => setIsResizeModalOpen(true)} className={isLight ? 'hover:bg-black/5 text-gray-900' : 'hover:bg-white/5 text-white'}>
                <div className="flex items-center gap-2">
                  <Maximize2 className="h-3.5 w-3.5" />
                  <span>Resize</span>
                </div>
              </DropdownMenuItem>
              {!hideExport && (
                <DropdownMenuItem onClick={() => setIsExportModalOpen(true)} className={isLight ? 'hover:bg-black/5 text-gray-900' : 'hover:bg-white/5 text-white'}>
                  <div className="flex items-center gap-2">
                    <Download className="h-3.5 w-3.5" />
                    <span>Export</span>
                  </div>
                </DropdownMenuItem>
              )}

            </DropdownMenu>
          </div>

          {/* Desktop Only: Redesigned Export Dropdown */}
          {!hideExport && (
            <div className="hidden md:block">
              <DropdownMenu
                style={{
                  backgroundColor: isLight ? '#ffffff' : '#090A0D',
                  borderColor: isLight ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.1)',
                  color: isLight ? '#1f2937' : '#F5F5F5',
                  width: '320px',
                  padding: '16px'
                }}
                trigger={
                  <button
                    className="text-[#F5F5F5] hover:text-white hover:bg-white/10 active:bg-white/20 font-semibold gap-1.5 h-9 px-3 text-sm rounded-[10px] transition-all flex items-center touch-manipulation whitespace-nowrap"
                    title="Export"
                  >
                    <Download className="h-3.5 w-3.5" strokeWidth={2} />
                    <span className="hidden sm:inline">Export</span>
                    <ChevronDown className="h-3 w-3 ml-0.5 opacity-50" strokeWidth={2} />
                  </button>
                }
              >
                {(close) => (
                  <div className="flex flex-col gap-4">
                    {/* Format Selection Tabs */}
                    <div className={`flex p-1 rounded-lg ${isLight ? 'bg-black/5' : 'bg-white/5'}`}>
                      <button
                        type="button"
                        onClick={() => setExportFormat('mp4')}
                        className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all ${exportFormat === 'mp4' ? 'bg-[#7c4af0] text-white shadow-sm' : 'text-gray-400 hover:text-gray-600'
                          }`}
                      >
                        MP4 Video
                      </button>
                      <button
                        type="button"
                        onClick={() => setExportFormat('gif')}
                        className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all ${exportFormat === 'gif' ? 'bg-[#7c4af0] text-white shadow-sm' : 'text-gray-400 hover:text-gray-600'
                          }`}
                      >
                        GIF
                      </button>
                    </div>

                    {/* Dynamic Settings */}
                    {exportFormat === 'mp4' ? (
                      <div className="flex flex-col gap-2">
                        <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                          Resolution
                        </label>
                        <div className="flex flex-col gap-1.5">
                          {[
                            { id: '720p', label: '720p (HD)', desc: 'Fast render' },
                            { id: '1080p', label: '1080p (Full HD)', desc: 'Recommended' },
                            { id: '1440p', label: '2K (QHD)', desc: 'High quality' },
                            { id: '2160p', label: '4K (Ultra HD)', desc: 'Slow render' },
                          ].map((opt) => (
                            <button
                              type="button"
                              key={opt.id}
                              onClick={() => setExportResolution(opt.id)}
                              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-all border ${exportResolution === opt.id
                                ? isLight
                                  ? 'bg-black/5 border-black/30 text-black font-semibold'
                                  : 'bg-white/10 border-white/30 text-white font-semibold'
                                : isLight
                                  ? 'bg-transparent border-transparent text-gray-500 hover:bg-black/5 hover:text-black'
                                  : 'bg-transparent border-transparent text-white/50 hover:bg-white/5 hover:text-white'
                                }`}
                            >
                              <span className="font-semibold">{opt.label}</span>
                              <span className="text-[11px] opacity-60">{opt.desc}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-4">
                        {/* Width */}
                        <div className="flex flex-col gap-2">
                          <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                            Width (pixels)
                          </label>
                          <div className={`grid grid-cols-4 gap-1 p-1 rounded-lg ${isLight ? 'bg-black/5' : 'bg-white/5'}`}>
                            {[360, 480, 720, 1080].map((w) => (
                              <button
                                type="button"
                                key={w}
                                onClick={() => setGifWidth(w)}
                                className={`py-1 text-[11px] font-semibold rounded-md transition-all ${gifWidth === w
                                  ? isLight
                                    ? 'bg-black/10 text-black font-bold shadow-sm'
                                    : 'bg-white/15 text-white font-bold shadow-sm'
                                  : 'text-gray-400 hover:text-gray-600'
                                  }`}
                              >
                                {w}p
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* FPS */}
                        <div className="flex flex-col gap-2">
                          <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                            Frame Rate (FPS)
                          </label>
                          <div className={`grid grid-cols-4 gap-1 p-1 rounded-lg ${isLight ? 'bg-black/5' : 'bg-white/5'}`}>
                            {[12, 15, 24, 30].map((f) => (
                              <button
                                type="button"
                                key={f}
                                onClick={() => setGifFps(f)}
                                className={`py-1 text-[11px] font-semibold rounded-md transition-all ${gifFps === f
                                  ? isLight
                                    ? 'bg-black/10 text-black font-bold shadow-sm'
                                    : 'bg-white/15 text-white font-bold shadow-sm'
                                  : 'text-gray-400 hover:text-gray-600'
                                  }`}
                              >
                                {f}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Loop */}
                        <div className="flex flex-col gap-2">
                          <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                            Loop Mode
                          </label>
                          <div className={`grid grid-cols-2 gap-1 p-1 rounded-lg ${isLight ? 'bg-black/5' : 'bg-white/5'}`}>
                            {[
                              { val: 0, label: 'Infinite' },
                              { val: 1, label: 'Once' },
                            ].map((l) => (
                              <button
                                type="button"
                                key={l.val}
                                onClick={() => setGifLoop(l.val)}
                                className={`py-1 text-[11px] font-semibold rounded-md transition-all ${gifLoop === l.val
                                  ? isLight
                                    ? 'bg-black/10 text-black font-bold shadow-sm'
                                    : 'bg-white/15 text-white font-bold shadow-sm'
                                  : 'text-gray-400 hover:text-gray-600'
                                  }`}
                              >
                                {l.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Export Action */}
                    <button
                      type="button"
                      onClick={() => {
                        if (exportFormat === 'mp4') {
                          onExport?.({ format: 'mp4', resolution: exportResolution })
                        } else {
                          onExport?.({
                            format: 'gif',
                            gifOptions: { width: gifWidth, fps: gifFps, loop: gifLoop }
                          })
                        }
                        close()
                      }}
                      className="w-full bg-[#7c4af0] hover:bg-[#6b3ee3] text-white py-2 rounded-lg text-sm font-semibold transition-all shadow-lg shadow-purple-500/10"
                    >
                      Export Design
                    </button>
                  </div>
                )}
              </DropdownMenu>
            </div>
          )}

          {/* Mobile Panel Toggle */}
          <button
            onClick={onToggleSidebar}
            className="lg:hidden text-[#F5F5F5] hover:text-white hover:bg-white/10 active:bg-white/20 h-8 w-8 rounded-lg transition-all flex items-center justify-center touch-manipulation"
            title="Open Sidebar"
          >
            <Menu className="h-4 w-4" strokeWidth={1.5} />
          </button>

        </div>
      </div>

      {/* Resize Modal (Mobile) */}
      <Modal
        isOpen={isResizeModalOpen}
        onClose={() => {
          setIsResizeModalOpen(false)
          setResizeStatus('idle')
          setCopiedProject(null)
        }}
        title="Resize Design"
      >
        <div className="space-y-4 pt-2">
          {resizeStatus === 'idle' ? (
            <>
              <div className="flex flex-col gap-2">
                {[
                  { label: 'Vertical', aspect: '9:16' },
                  { label: 'Square', aspect: '1:1' },
                  { label: 'Landscape', aspect: '16:9' },
                ].map((opt) => (
                  <button
                    type="button"
                    key={opt.aspect}
                    onClick={() => setResizeAspect(opt.aspect)}
                    className={`w-full text-left p-4 rounded-xl text-sm transition-all border flex items-center gap-2.5 ${resizeAspect === opt.aspect
                      ? isLight
                        ? 'bg-black/5 border-black/30 text-black font-semibold'
                        : 'bg-white/10 border-white/30 text-white font-semibold'
                      : isLight
                        ? 'bg-transparent border-transparent text-gray-900 hover:bg-black/5'
                        : 'bg-transparent border-transparent text-white hover:bg-white/5'
                      }`}
                  >
                    <AspectShape aspect={opt.aspect} />
                    <span className="font-semibold">{opt.label}</span>
                  </button>
                ))}
              </div>

              <div className={`flex flex-col gap-2 pt-4 border-t ${isLight ? 'border-black/5' : 'border-white/5'}`}>
                <button
                  type="button"
                  onClick={handleCopyAndResizeAction}
                  className="w-full bg-[#7c4af0] hover:bg-[#6b3ee3] text-white py-3 rounded-xl text-sm font-semibold transition-all shadow-lg"
                >
                  Copy & Resize
                </button>
                <button
                  type="button"
                  onClick={() => handleResizeThisDesign()}
                  className={`w-full py-3 rounded-xl text-sm font-semibold transition-all border ${isLight ? 'bg-white hover:bg-gray-50 border-gray-200 text-gray-700' : 'bg-white/5 hover:bg-white/10 border-white/10 text-white'
                    }`}
                >
                  Resize This Design
                </button>
              </div>
            </>
          ) : resizeStatus === 'copying' || resizeStatus === 'resizing' ? (
            <div className="flex flex-col py-6 text-left">
              <div className={`text-sm font-semibold mb-2 ${isLight ? 'text-gray-900' : 'text-white'}`}>
                {resizeStatus === 'copying' ? 'Copying progress...' : 'Resize progress...'}
              </div>
              <div className="w-full h-2 rounded-full overflow-hidden bg-black/10 dark:bg-white/10 mb-3">
                <div
                  className="h-full bg-gradient-to-r from-cyan-400 to-[#7c4af0] rounded-full transition-all duration-500 ease-out"
                  style={{ width: `${resizeStatus === 'copying' ? 45 : 85}%` }}
                />
              </div>
              <div className="text-xs text-gray-450">Please wait a moment...</div>
            </div>
          ) : resizeStatus === 'completed' && copiedProject ? (
            <div className="flex flex-col gap-3 py-4">
              <div className={`text-sm font-semibold text-center ${isLight ? 'text-gray-900' : 'text-white'}`}>
                Copied & resized to {copiedProject.format}!
              </div>
              <button
                type="button"
                onClick={() => {
                  if (onNavigate) {
                    onNavigate(`/project/${copiedProject.id}`)
                  } else {
                    window.location.href = `/project/${copiedProject.id}`
                  }
                  setIsResizeModalOpen(false)
                  setResizeStatus('idle')
                  setCopiedProject(null)
                }}
                className="w-full bg-[#7c4af0] hover:bg-[#6b3ee3] text-white py-3 rounded-xl text-sm font-semibold transition-all shadow-lg"
              >
                Open {copiedProject.format} Version
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsResizeModalOpen(false)
                  setResizeStatus('idle')
                  setCopiedProject(null)
                }}
                className={`w-full py-3 rounded-xl text-sm font-semibold transition-all border ${isLight ? 'bg-white hover:bg-gray-50 border-gray-200 text-gray-700' : 'bg-white/5 hover:bg-white/10 border-white/10 text-white'
                  }`}
              >
                Close
              </button>
            </div>
          ) : (
            <div className="text-center py-6">
              <div className="text-sm text-red-400">An error occurred</div>
              <button
                type="button"
                onClick={() => setResizeStatus('idle')}
                className="mt-4 bg-[#7c4af0] hover:bg-[#6b3ee3] text-white px-4 py-2 rounded-xl text-xs font-semibold"
              >
                Try Again
              </button>
            </div>
          )}
        </div>
      </Modal>

      {/* Export Modal (Mobile) */}
      <Modal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        title="Export Design"
      >
        <div className="space-y-4 pt-2">
          {/* Format Selection Tabs */}
          <div className={`flex p-1 rounded-xl ${isLight ? 'bg-black/5' : 'bg-white/5'}`}>
            <button
              type="button"
              onClick={() => setExportFormat('mp4')}
              className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${exportFormat === 'mp4' ? 'bg-[#7c4af0] text-white shadow-sm' : 'text-gray-400 hover:text-white'
                }`}
            >
              MP4 Video
            </button>
            <button
              type="button"
              onClick={() => setExportFormat('gif')}
              className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${exportFormat === 'gif' ? 'bg-[#7c4af0] text-white shadow-sm' : 'text-gray-400 hover:text-white'
                }`}
            >
              GIF
            </button>
          </div>

          {/* Dynamic Settings */}
          {exportFormat === 'mp4' ? (
            <div className="flex flex-col gap-2">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                Resolution
              </label>
              <div className="flex flex-col gap-1.5">
                {[
                  { id: '720p', label: '720p (HD)', desc: 'Fast render' },
                  { id: '1080p', label: '1080p (Full HD)', desc: 'Recommended' },
                  { id: '1440p', label: '2K (QHD)', desc: 'High quality' },
                  { id: '2160p', label: '4K (Ultra HD)', desc: 'Slow render' },
                ].map((opt) => (
                  <button
                    type="button"
                    key={opt.id}
                    onClick={() => setExportResolution(opt.id)}
                    className={`w-full flex items-center justify-between p-4 rounded-xl text-sm transition-all border ${exportResolution === opt.id
                      ? isLight
                        ? 'bg-black/5 border-black/30 text-black font-semibold'
                        : 'bg-white/10 border-white/30 text-white font-semibold'
                      : isLight
                        ? 'bg-transparent border-transparent text-gray-500 hover:bg-black/5'
                        : 'bg-transparent border-transparent text-white/50 hover:bg-white/5'
                      }`}
                  >
                    <span className="font-semibold">{opt.label}</span>
                    <span className="opacity-60 text-xs">{opt.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {/* Width */}
              <div className="flex flex-col gap-2">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                  Width (pixels)
                </label>
                <div className={`grid grid-cols-4 gap-1 p-1 rounded-xl ${isLight ? 'bg-black/5' : 'bg-white/5'}`}>
                  {[360, 480, 720, 1080].map((w) => (
                    <button
                      type="button"
                      key={w}
                      onClick={() => setGifWidth(w)}
                      className={`py-2 text-xs font-semibold rounded-lg transition-all ${gifWidth === w
                        ? isLight
                          ? 'bg-black/10 text-black font-bold shadow-sm'
                          : 'bg-white/15 text-white font-bold shadow-sm'
                        : 'text-gray-400 hover:text-white'
                        }`}
                    >
                      {w}p
                    </button>
                  ))}
                </div>
              </div>

              {/* FPS */}
              <div className="flex flex-col gap-2">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                  Frame Rate (FPS)
                </label>
                <div className={`grid grid-cols-4 gap-1 p-1 rounded-xl ${isLight ? 'bg-black/5' : 'bg-white/5'}`}>
                  {[12, 15, 24, 30].map((f) => (
                    <button
                      type="button"
                      key={f}
                      onClick={() => setGifFps(f)}
                      className={`py-2 text-xs font-semibold rounded-lg transition-all ${gifFps === f
                        ? isLight
                          ? 'bg-black/10 text-black font-bold shadow-sm'
                          : 'bg-white/15 text-white font-bold shadow-sm'
                        : 'text-gray-400 hover:text-white'
                        }`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>

              {/* Loop */}
              <div className="flex flex-col gap-2">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                  Loop Mode
                </label>
                <div className={`grid grid-cols-2 gap-1 p-1 rounded-xl ${isLight ? 'bg-black/5' : 'bg-white/5'}`}>
                  {[
                    { val: 0, label: 'Infinite' },
                    { val: 1, label: 'Once' },
                  ].map((l) => (
                    <button
                      type="button"
                      key={l.val}
                      onClick={() => setGifLoop(l.val)}
                      className={`py-2 text-xs font-semibold rounded-lg transition-all ${gifLoop === l.val
                        ? isLight
                          ? 'bg-black/10 text-black font-bold shadow-sm'
                          : 'bg-white/15 text-white font-bold shadow-sm'
                        : 'text-gray-400 hover:text-white'
                        }`}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Export Action */}
          <button
            type="button"
            onClick={() => {
              if (exportFormat === 'mp4') {
                onExport?.({ format: 'mp4', resolution: exportResolution })
              } else {
                onExport?.({
                  format: 'gif',
                  gifOptions: { width: gifWidth, fps: gifFps, loop: gifLoop }
                })
              }
              setIsExportModalOpen(false)
            }}
            className="w-full bg-[#7c4af0] hover:bg-[#6b3ee3] text-white py-3 rounded-xl text-sm font-semibold transition-all shadow-lg mt-2"
          >
            Export Design
          </button>
        </div>
      </Modal>
    </div>
  )
}

export default TopToolbar

