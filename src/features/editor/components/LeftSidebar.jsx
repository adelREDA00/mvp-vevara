import {
  Layout,
  Grid3x3,
  Type,
  Crown,
  Upload,
  Wand2,
  FolderOpen,
  Grid2x2,
} from 'lucide-react'

const sidebarItems = [
  { icon: Layout, label: 'Design' },
  { icon: Grid3x3, label: 'Elements' },
  { icon: Type, label: 'Text' },
  // { icon: Palette, label: 'Color' },
  // { icon: Crown, label: 'Brand' },
  { icon: Upload, label: 'Uploads' },
  { icon: Wand2, label: 'Tools' },
  { icon: FolderOpen, label: 'Projects' },
  { icon: Grid2x2, label: 'Apps' },
  // { icon: Settings, label: 'Advanced' },
]

function LeftSidebar({ activeItem, onItemClick }) {
  return (
    <div className="w-14 sm:w-16 md:w-20 h-full flex flex-col items-center py-2 sm:py-3 md:py-4 gap-1 sm:gap-1.5 md:gap-2 flex-shrink-0 overflow-y-auto backdrop-blur-md" style={{
      backgroundColor: 'rgba(13, 18, 22, 0.85)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      borderRight: '1px solid rgba(13, 18, 22, 0.8)'
    }}>
      {sidebarItems.map((item) => {
        const Icon = item.icon
        const isActive = activeItem === item.label
        return (
          <button
            key={item.label}
            onClick={() => onItemClick && onItemClick(item.label)}
            className={`flex flex-col items-center justify-center h-14 w-14 sm:h-14 sm:w-14 md:h-16 md:w-16 text-white/70 hover:text-white active:text-white hover:bg-white/10 active:bg-white/20 gap-0.5 sm:gap-0.5 md:gap-1 rounded-lg transition-all duration-200 touch-manipulation min-h-[56px] min-w-[56px] md:min-h-[64px] md:min-w-[64px] ${isActive ? 'text-white bg-white/20 shadow-lg' : ''
              }`}
          >
            <Icon className="h-4 w-4 sm:h-4 sm:w-4 md:h-4 md:w-4 flex-shrink-0" strokeWidth={2} />
            <span className="text-[9px] sm:text-[10px] md:text-xs font-medium leading-tight text-center">{item.label}</span>
          </button>
        )
      })}

      <div className="flex-1" />
    </div>
  )
}

export default LeftSidebar

