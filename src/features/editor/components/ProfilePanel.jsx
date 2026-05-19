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
      className="flex flex-col h-full relative transition-all duration-300"
      style={{
        width: isMobile ? '100%' : '320px',
        backgroundColor: isMobile ? 'transparent' : (isLight ? '#f3f4f7' : '#090a0d'),
        backdropFilter: isMobile ? 'none' : 'blur(20px)',
        WebkitBackdropFilter: isMobile ? 'none' : 'blur(20px)',
        borderRight: isMobile ? 'none' : `1px solid ${isLight ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.05)'}`,
      }}
    >
      {/* Header */}
      <div className={`hidden lg:block px-6 pt-6 pb-5 border-b ${isLight ? 'border-black/5' : 'border-white/5'}`}>
        <div className="flex items-center justify-between">
          <h2 className={`text-[20px] font-semibold tracking-tight ${isLight ? 'text-gray-900' : 'text-white'}`}>Account</h2>
          {onClose && (
            <button
              onClick={onClose}
              className={`transition-all duration-300 p-2 rounded-[10px] ${isLight ? 'text-gray-400 hover:text-gray-900 hover:bg-gray-100' : 'text-white/40 hover:text-white hover:bg-white/10'}`}
            >
              <X className="h-5 w-5" strokeWidth={2} />
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 scrollbar-hide">
        
        {isAuthenticated ? (
          <div className="flex flex-col gap-6">
            
            {/* User Info - Flat & Borderless */}
            <div className="flex items-center gap-3.5 pb-6 border-b border-black/5 dark:border-white/5">
              <div className="w-11 h-11 rounded-xl bg-gradient-to-tr from-[#7c4af0] to-[#a88beb] flex items-center justify-center text-white font-semibold text-[15px] shadow-sm flex-shrink-0">
                {getUserInitials()}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className={`text-[14px] font-semibold truncate ${isLight ? 'text-slate-900' : 'text-white'}`}>
                  {user?.username || 'Authenticated User'}
                </h3>
                <p className={`text-[12px] truncate ${isLight ? 'text-slate-500' : 'text-white/40'}`}>
                  {user?.email}
                </p>
              </div>
            </div>

            {/* Custom Theme Switcher Row - Clean & Minimalist */}
            <div className="flex items-center justify-between pb-6 border-b border-black/5 dark:border-white/5">
              <span className={`text-[13px] font-medium ${isLight ? 'text-slate-600' : 'text-zinc-400'}`}>Theme</span>
              <div className={`flex rounded-lg p-0.5 ${isLight ? 'bg-gray-200/60' : 'bg-white/[0.06]'}`}>
                <button
                  onClick={() => handleThemeChange('light')}
                  className={`flex items-center justify-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-semibold transition-all ${
                    theme === 'light'
                      ? isLight
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'bg-white/10 text-white shadow-sm'
                      : isLight
                        ? 'text-slate-500 hover:text-slate-900'
                        : 'text-white/40 hover:text-white/80'
                  }`}
                >
                  <Sun className={`h-3.5 w-3.5 transition-colors ${theme === 'light' ? 'text-amber-500' : ''}`} />
                  <span>Light</span>
                </button>
                <button
                  onClick={() => handleThemeChange('dark')}
                  className={`flex items-center justify-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-semibold transition-all ${
                    theme === 'dark'
                      ? isLight
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'bg-white/10 text-white shadow-sm'
                      : isLight
                        ? 'text-slate-500 hover:text-slate-900'
                        : 'text-white/40 hover:text-white/80'
                  }`}
                >
                  <Moon className={`h-3.5 w-3.5 transition-colors ${theme === 'dark' ? 'text-indigo-400' : ''}`} />
                  <span>Dark</span>
                </button>
              </div>
            </div>

            {/* Account Actions */}
            <div className="flex flex-col gap-2.5">
              <button
                onClick={handleDashboard}
                className="w-full h-10 px-4 bg-[#7c4af0] hover:bg-[#6940c9] text-white rounded-[12px] text-[13px] font-semibold flex items-center justify-center gap-2 transition-all shadow-medium active:scale-[0.98]"
              >
                Go to Dashboard
              </button>

              <button
                onClick={handleLogout}
                className={`w-full h-9 px-4 rounded-[12px] text-[12px] font-semibold flex items-center justify-center gap-1.5 transition-all active:scale-[0.95] ${
                  isLight
                    ? 'bg-red-50 hover:bg-red-100/60 text-red-600 border border-red-200/50'
                    : 'bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20'
                }`}
              >
                <LogOut className="h-3.5 w-3.5" />
                Log Out
              </button>
            </div>

          </div>
        ) : (
          /* Guest Info - Elegant Minimalist Centered Layout */
          <div className="py-6 px-1 text-center flex flex-col items-center">
            <div className="w-12 h-12 bg-[#7c4af0]/10 rounded-full flex items-center justify-center mb-5">
              <Smile className="h-6 w-6 text-[#7c4af0]" strokeWidth={1.5} />
            </div>
            <h3 className={`text-[16px] font-semibold mb-1.5 ${isLight ? 'text-slate-900' : 'text-white'}`}>Guest Account</h3>
            <p className={`text-[12.5px] mb-6 leading-relaxed max-w-[220px] mx-auto ${isLight ? 'text-slate-500' : 'text-white/40'}`}>
              Login to sync your projects and access professional features.
            </p>
            
            <div className="w-full flex flex-col gap-5">
              <button
                onClick={handleDashboard}
                className="w-full py-2.5 bg-[#7c4af0] hover:bg-[#6940c9] text-white rounded-[12px] text-[13px] font-semibold transition-all shadow-medium active:scale-[0.98]"
              >
                Log in
              </button>
              
              {/* Clean flat Theme switcher */}
              <div className="flex items-center justify-between pt-5 border-t border-black/5 dark:border-white/5 w-full">
                <span className={`text-[13px] font-medium ${isLight ? 'text-slate-600' : 'text-zinc-400'}`}>Theme</span>
                <div className={`flex rounded-lg p-0.5 ${isLight ? 'bg-gray-200/60' : 'bg-white/[0.06]'}`}>
                  <button
                    onClick={() => handleThemeChange('light')}
                    className={`flex items-center justify-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-semibold transition-all ${
                      theme === 'light'
                        ? isLight
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'bg-white/10 text-white shadow-sm'
                        : isLight
                          ? 'text-slate-500 hover:text-slate-900'
                          : 'text-white/40 hover:text-white/80'
                    }`}
                  >
                    <Sun className={`h-3 w-3 transition-colors ${theme === 'light' ? 'text-amber-500' : ''}`} />
                    <span>Light</span>
                  </button>
                  <button
                    onClick={() => handleThemeChange('dark')}
                    className={`flex items-center justify-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-semibold transition-all ${
                      theme === 'dark'
                        ? isLight
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'bg-white/10 text-white shadow-sm'
                        : isLight
                          ? 'text-slate-500 hover:text-slate-900'
                          : 'text-white/40 hover:text-white/80'
                    }`}
                  >
                    <Moon className={`h-3 w-3 transition-colors ${theme === 'dark' ? 'text-indigo-400' : ''}`} />
                    <span>Dark</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default ProfilePanel
