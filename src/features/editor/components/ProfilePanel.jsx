import React, { useContext } from 'react'
import { useSelector, useDispatch } from 'react-redux'
import { X, Sun, Moon, LogOut, Smile } from 'lucide-react'
import { ThemeContext } from '../../../app/context/ThemeContext'
import { logoutUser, updateUserTheme, setLocalTheme } from '../../../store/slices/authSlice'

function ProfilePanel({ onClose, onNavigate }) {
  const dispatch = useDispatch()
  const { theme, setTheme } = useContext(ThemeContext)
  const { isAuthenticated, user } = useSelector((state) => state.auth)

  const isLight = theme === 'light'
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 1024

  const handleThemeChange = (newTheme) => {
    if (newTheme === theme) return
    setTheme(newTheme)
    
    if (isAuthenticated) {
      dispatch(setLocalTheme(newTheme))
      dispatch(updateUserTheme(newTheme))
    }
  }

  const handleLogout = async () => {
    try {
      await dispatch(logoutUser()).unwrap()
      if (onNavigate) {
        onNavigate('/login')
      } else {
        window.location.href = '/login'
      }
    } catch (err) {
      console.error('Logout failed:', err)
    }
  }

  const handleDashboard = () => {
    if (onNavigate) {
      onNavigate(isAuthenticated ? '/dashboard' : '/login')
    } else {
      window.location.href = isAuthenticated ? '/dashboard' : '/login'
    }
  }

  const getUserInitials = () => {
    if (!user || !user.email) return 'G'
    return user.email.substring(0, 2).toUpperCase()
  }

  return (
    <div
      className="flex flex-col h-full relative transition-all duration-300 pt-0 lg:pt-12"
      style={{
        width: isMobile ? '100%' : '320px',
        backgroundColor: isMobile ? 'transparent' : (isLight ? '#f3f4f7' : '#090a0d'),
        backdropFilter: isMobile ? 'none' : 'blur(20px)',
        WebkitBackdropFilter: isMobile ? 'none' : 'blur(20px)',
        borderRight: isMobile ? 'none' : `1px solid ${isLight ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.05)'}`,
      }}
    >
      {onClose && (
        <button
          onClick={onClose}
          className={`absolute top-3 right-3 z-50 transition-all duration-300 p-2 rounded-[10px] ${isLight ? 'text-gray-400 hover:text-gray-900 hover:bg-gray-100' : 'text-white/40 hover:text-white hover:bg-white/10'} hidden lg:block`}
        >
          <X className="h-5 w-5" strokeWidth={2} />
        </button>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 scrollbar-hide">
        
        {isAuthenticated ? (
          <div className="flex flex-col gap-6">
            
            {/* User Info - Flat & Borderless */}
            <div className="flex items-center gap-3.5 pb-6 border-b border-black/5 dark:border-white/5">
              <div className="flex-1 min-w-0">
                <p className={`text-[12px] truncate font-semibold text-center ${isLight ? 'text-slate-800' : 'text-zinc-300'}`}>
                  {user?.email}
                </p>
              </div>
            </div>

            {/* Custom Theme Switcher Row - Toggle icons only, no text labels */}
            <div className="flex items-center justify-center pb-6 border-b border-black/5 dark:border-white/5">
              <div className={`flex rounded-lg p-0.5 ${isLight ? 'bg-gray-200/60' : 'bg-white/[0.06]'}`}>
                <button
                  onClick={() => handleThemeChange('light')}
                  className={`flex items-center justify-center p-2 rounded-md transition-all ${
                    theme === 'light'
                      ? isLight
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'bg-white/10 text-white shadow-sm'
                      : isLight
                        ? 'text-slate-500 hover:text-slate-900'
                        : 'text-white/40 hover:text-white/80'
                  }`}
                  title="Light Theme"
                >
                  <Sun className={`h-4 w-4 transition-colors ${theme === 'light' ? 'text-amber-500' : ''}`} />
                </button>
                <button
                  onClick={() => handleThemeChange('dark')}
                  className={`flex items-center justify-center p-2 rounded-md transition-all ${
                    theme === 'dark'
                      ? isLight
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'bg-white/10 text-white shadow-sm'
                      : isLight
                        ? 'text-slate-500 hover:text-slate-900'
                        : 'text-white/40 hover:text-white/80'
                  }`}
                  title="Dark Theme"
                >
                  <Moon className={`h-4 w-4 transition-colors ${theme === 'dark' ? 'text-indigo-400' : ''}`} />
                </button>
              </div>
            </div>

          </div>
        ) : (
          /* Guest Info - Elegant Minimalist Centered Layout */
          <div className="py-6 px-1 text-center flex flex-col items-center gap-5">
            <button
              onClick={handleDashboard}
              className="w-full py-2.5 bg-[#7c4af0] hover:bg-[#6940c9] text-white rounded-[12px] text-[13px] font-semibold transition-all shadow-medium active:scale-[0.98]"
            >
              Log in
            </button>
            
            {/* Clean flat Theme switcher - Toggle icons only, no text labels */}
            <div className="w-full flex items-center justify-center pt-5 border-t border-black/5 dark:border-white/5">
              <div className={`flex rounded-lg p-0.5 ${isLight ? 'bg-gray-200/60' : 'bg-white/[0.06]'}`}>
                <button
                  onClick={() => handleThemeChange('light')}
                  className={`flex items-center justify-center p-2 rounded-md transition-all ${
                    theme === 'light'
                      ? isLight
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'bg-white/10 text-white shadow-sm'
                      : isLight
                        ? 'text-slate-500 hover:text-slate-900'
                        : 'text-white/40 hover:text-white/80'
                  }`}
                  title="Light Theme"
                >
                  <Sun className={`h-4 w-4 transition-colors ${theme === 'light' ? 'text-amber-500' : ''}`} />
                </button>
                <button
                  onClick={() => handleThemeChange('dark')}
                  className={`flex items-center justify-center p-2 rounded-md transition-all ${
                    theme === 'dark'
                      ? isLight
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'bg-white/10 text-white shadow-sm'
                      : isLight
                        ? 'text-slate-500 hover:text-slate-900'
                        : 'text-white/40 hover:text-white/80'
                  }`}
                  title="Dark Theme"
                >
                  <Moon className={`h-4 w-4 transition-colors ${theme === 'dark' ? 'text-indigo-400' : ''}`} />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default ProfilePanel
