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
  Music,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { ThemeContext } from '../../../app/context/ThemeContext'
import React from 'react'

export const SIDEBAR_ITEMS = [
  { icon: Grid3x3, label: 'Elements' },
  { icon: Frame, label: 'Frames' },
  { icon: Image, label: 'Bg wall' },
  { icon: Music, label: 'Audio' },
  { icon: Type, label: 'Text' },
  { icon: Upload, label: 'Uploads' },
  // { icon: Wand2, label: 'Tools' },
  // { icon: Zap, label: 'Motion' },
]

function LeftSidebar({ activeItem, isMotionOpen, onItemClick }) {
  const { theme } = React.useContext(ThemeContext)
  const isLight = theme === 'light'

  return (
    <div
      className={`w-[72px] lg:w-[80px] h-full flex flex-col justify-between items-center flex-shrink-0 overflow-y-auto no-scrollbar transition-all duration-300 pb-2`}
      style={{
        backgroundColor: isLight ? '#f3f4f7' : '#090a0d',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
      }}
    >
      {/* Top list of items */}
      <div className="flex flex-col items-center gap-2.5 py-3 flex-shrink-0 w-full px-2">
        {SIDEBAR_ITEMS.map((item) => {
          const Icon = item.icon
          const isActive = item.label === 'Motion' ? isMotionOpen : activeItem === item.label
          return (
            <button
              key={item.label}
              onClick={() => onItemClick?.(item.label)}
              className={`flex flex-col items-center justify-center gap-1.5 rounded-[12px] transition-all duration-300 touch-manipulation w-14 h-14 lg:w-16 lg:h-16 flex-shrink-0 relative group ${isActive
                ? isLight
                  ? 'bg-gray-100 shadow-medium text-gray-900'
                  : 'bg-white/10 shadow-medium text-white'
                : isLight
                  ? 'text-gray-500 hover:text-gray-900 hover:bg-gray-50 active:bg-gray-100'
                  : 'text-zinc-400 hover:text-white hover:bg-white/5 active:bg-white/10'
                }`}
            >

              <Icon
                className={`h-[22px] w-[22px] flex-shrink-0 transition-all duration-300`}
                strokeWidth={isActive ? 2 : 1.5}
              />
              <span className={`text-[11px] font-medium leading-tight text-center transition-opacity duration-300 ${isActive ? 'opacity-100' : 'opacity-60 group-hover:opacity-100'}`}>{item.label}</span>
            </button>
          )
        })}
      </div>

      {/* Bottom area - empty to let top items align correctly */}
      <div className="w-full h-2 flex-shrink-0" />
    </div>
  )
}

export default LeftSidebar

