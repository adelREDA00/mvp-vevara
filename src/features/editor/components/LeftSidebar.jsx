import {
  Layout,
  Grid3x3,
  Type,
  Crown,
  Upload,
  Wand2,
  FolderOpen,
  Grid2x2,
  User,
  Image,
} from 'lucide-react'
import { Link } from 'react-router-dom'

export const SIDEBAR_ITEMS = [
  { icon: Grid3x3, label: 'Elements' },
  { icon: Type, label: 'Text' },
  { icon: Upload, label: 'Uploads' },
  { icon: Image, label: 'Images' },
  { icon: Wand2, label: 'Tools' },
]

function LeftSidebar({ activeItem, onItemClick }) {
  return (
    <div
      className="w-16 lg:w-20 h-full flex flex-col items-center flex-shrink-0 overflow-y-auto"
      style={{
        backgroundColor: '#0f1015',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
      }}
    >
      {/* Spacer to push nav items to vertical center */}
      <div className="flex-1 min-h-0" aria-hidden />
      <div className="flex flex-col items-center gap-2 py-2 flex-shrink-0">
        {SIDEBAR_ITEMS.map((item) => {
          const Icon = item.icon
          const isActive = activeItem === item.label
          return (
            <button
              key={item.label}
              onClick={() => onItemClick?.(item.label)}
              className={`flex flex-col items-center justify-center p-2 lg:p-2 gap-1 rounded-xl transition-all duration-300 touch-manipulation w-[85%] aspect-square min-h-[48px] lg:min-h-[52px] ${isActive ? 'bg-white/10 shadow-lg text-white' : 'text-zinc-400 hover:text-white hover:bg-white/5 active:bg-white/10'}`}
            >
              <Icon className={`h-[17px] w-[17px] lg:h-5 lg:w-5 flex-shrink-0 transition-transform duration-300 ${isActive ? 'scale-110' : ''}`} strokeWidth={1.5} />
              <span className={`text-[9px] lg:text-[10px] font-medium leading-tight text-center ${isActive ? 'opacity-100' : 'opacity-80'}`}>{item.label}</span>
            </button>
          )
        })}
      </div>
      <div className="flex-1 min-h-0" aria-hidden />
    </div>
  )
}

export default LeftSidebar

