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
  { icon: Grid3x3, label: 'Elements' },
  { icon: Type, label: 'Text' },
  { icon: Upload, label: 'Uploads' },
  { icon: Wand2, label: 'Tools' },
]

function LeftSidebar({ activeItem, onItemClick }) {
  return (
    <div className="w-16 lg:w-20 h-full flex flex-col items-center py-2 gap-2 flex-shrink-0 overflow-y-auto" style={{
      backgroundColor: typeof window !== 'undefined' && window.innerWidth < 1024 ? 'transparent' : 'rgba(13, 18, 22, 0.4)',
      backdropFilter: typeof window !== 'undefined' && window.innerWidth < 1024 ? 'none' : 'blur(8px)',
      WebkitBackdropFilter: typeof window !== 'undefined' && window.innerWidth < 1024 ? 'none' : 'blur(8px)',
      borderRight: '1px solid rgba(255, 255, 255, 0.05)',
    }}>
      {sidebarItems.map((item) => {
        const Icon = item.icon
        const isActive = activeItem === item.label
        return (
          <button
            key={item.label}
            onClick={() => onItemClick && onItemClick(item.label)}
            className={`flex flex-col items-center justify-center p-1.5 text-white/60 hover:text-white active:text-white hover:bg-white/5 active:bg-white/10 gap-1 rounded-xl transition-all duration-300 touch-manipulation w-[85%] aspect-square min-h-[48px] ${isActive ? 'text-white bg-white/15 shadow-xl border border-white/5' : ''
              }`}
          >
            <Icon className={`h-[18px] w-[18px] flex-shrink-0 transition-transform duration-300 ${isActive ? 'scale-110' : ''}`} strokeWidth={2} />
            <span className={`text-[10px] font-semibold leading-tight text-center ${isActive ? 'opacity-100' : 'opacity-80'}`}>{item.label}</span>
          </button>
        )
      })}

      <div className="flex-1" />
    </div>
  )
}

export default LeftSidebar

