import React, { createContext, useState, useEffect, useContext, useRef } from 'react';
import { useSelector } from 'react-redux';

export const ThemeContext = createContext({
  theme: 'dark',
  setTheme: () => {},
  isLight: false
});

export const ThemeProvider = ({ children }) => {
  const { isAuthenticated, user } = useSelector((state) => state.auth);
  const lastSyncRef = useRef(null);

  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem('editorTheme') || 'light';
    } catch {
      return 'light';
    }
  });

  const isLight = theme === 'light';

  // Handle automatic theme switching: 
  // 1. If not logged in, force 'dark' mode by default.
  // 2. If logged in, sync with the user's saved preference.
  useEffect(() => {
    const currentSyncKey = isAuthenticated ? `user-${user?.id}-${user?.theme || 'light'}` : 'guest';
    
    if (lastSyncRef.current !== currentSyncKey) {
      if (!isAuthenticated) {
        setTheme('light');
      } else if (user?.theme) {
        setTheme(user.theme);
      }
      lastSyncRef.current = currentSyncKey;
    }
  }, [isAuthenticated, user?.id, user?.theme]);

  useEffect(() => {
    try {
      localStorage.setItem('editorTheme', theme);
    } catch {}
    
    if (theme === 'light') {
      document.body.classList.add('theme-light');
    } else {
      document.body.classList.remove('theme-light');
    }
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, isLight }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);

