/**
 * Hook to manage the editor sidebar state and interactions.
 * Handles opening/closing sidebar panels and toggling between different sidebar items.
 * Provides utilities for sidebar item selection and panel management.
 */

import { useCallback, useState } from 'react'

export function useEditorSidebar(initialItem = null) {
  const [activeSidebarItem, setActiveSidebarItem] = useState(initialItem)

  const handleSidebarItemClick = useCallback((item) => {
    setActiveSidebarItem((current) => (current === item ? null : item))
  }, [])

  const handleClosePanel = useCallback(() => {
    setActiveSidebarItem(null)
  }, [])

  return {
    activeSidebarItem,
    setActiveSidebarItem,
    handleSidebarItemClick,
    handleClosePanel,
  }
}