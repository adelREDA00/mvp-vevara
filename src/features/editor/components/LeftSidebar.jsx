import {
  Layout,
  Grid3x3,
  Type,
  Crown,
  Upload,
  Wand2,
  FolderOpen,
  User,
  Image,
  Zap,
  Frame,
} from 'lucide-react'
import { Link } from 'react-router-dom'

export const SIDEBAR_ITEMS = [
  { icon: Grid3x3, label: 'Elements' },
  { icon: Frame, label: 'Frames' },
  { icon: Image, label: 'Media' },
  { icon: Type, label: 'Text' },
  { icon: Upload, label: 'Uploads' },
  // { icon: Wand2, label: 'Tools' },
  // { icon: Zap, label: 'Motion' },
]

function LeftSidebar({ activeItem, isMotionOpen, onItemClick }) {
  return (
    <div
      className="w-[72px] lg:w-[80px] h-full flex flex-col items-center flex-shrink-0 overflow-y-auto transition-all duration-300"
      style={{
        backgroundColor: '#0f1015',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
      }}
    >
      {/* Spacer to push nav items to vertical center */}
      <div className="flex-1 min-h-0" aria-hidden />
      <div className="flex flex-col items-center gap-3 py-6 flex-shrink-0 w-full px-2">
        {SIDEBAR_ITEMS.map((item) => {
          const Icon = item.icon
          const isActive = item.label === 'Motion' ? isMotionOpen : activeItem === item.label
          return (
            <button
              key={item.label}
              onClick={() => onItemClick?.(item.label)}
              className={`flex flex-col items-center justify-center gap-1.5 rounded-[12px] transition-all duration-300 touch-manipulation w-full aspect-square relative group ${isActive ? 'bg-white/10 shadow-medium text-white' : 'text-zinc-400 hover:text-white hover:bg-white/5 active:bg-white/10'}`}
            >
              {isActive && (
                <div className="absolute left-0 w-1 h-6 bg-[#7c4af0] rounded-r-full" />
              )}
              <Icon 
                className={`h-5 w-5 flex-shrink-0 transition-all duration-300 ${isActive ? 'scale-110' : 'group-hover:scale-110'}`} 
                strokeWidth={isActive ? 2 : 1.5} 
              />
              <span className={`text-[10px] font-medium leading-tight text-center transition-opacity duration-300 ${isActive ? 'opacity-100' : 'opacity-60 group-hover:opacity-100'}`}>{item.label}</span>
            </button>
          )
        })}
      </div>
      <div className="flex-1 min-h-0" aria-hidden />
    </div>
  )
}

export default LeftSidebar

