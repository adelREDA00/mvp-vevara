import React, { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'

function DropdownMenu({ trigger, children, className = "" }) {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef(null)
  const triggerRef = useRef(null)
  const menuRef = useRef(null)

  useEffect(() => {
    function handleClickOutside(event) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target) &&
        menuRef.current &&
        !menuRef.current.contains(event.target)
      ) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  useEffect(() => {
    if (isOpen && triggerRef.current && menuRef.current) {
      const triggerRect = triggerRef.current.getBoundingClientRect()
      const menu = menuRef.current
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight
      const menuWidth = menu.offsetWidth || 220
      const menuHeight = menu.offsetHeight || 200

      let left = triggerRect.left

      if (left + menuWidth > viewportWidth) {
        left = Math.max(8, viewportWidth - menuWidth - 8)
      }

      const spaceBelow = viewportHeight - triggerRect.bottom
      const spaceAbove = triggerRect.top

      // If space below is not enough for the dropdown, and there is more space above, open upwards
      const openUpwards = spaceBelow < menuHeight + 12 && spaceAbove > spaceBelow

      menu.style.position = 'fixed'
      if (openUpwards) {
        menu.style.top = `${triggerRect.top - menuHeight - 8}px`
      } else {
        menu.style.top = `${triggerRect.bottom + 8}px`
      }
      menu.style.left = `${left}px`
      menu.style.zIndex = '9999'
    }
  }, [isOpen])

  return (
    <div className="relative" ref={dropdownRef}>
      <div ref={triggerRef} className="cursor-pointer" onClick={() => setIsOpen(!isOpen)}>{trigger}</div>
      {isOpen && createPortal(
        <div
          ref={menuRef}
          className={`fixed shadow-2xl min-w-[200px] py-1 border rounded-xl overflow-hidden animate-in fade-in zoom-in duration-200 ${className}`}
          style={{
            zIndex: 9999,
            backgroundColor: 'var(--dropdown-bg)',
            borderColor: 'var(--dropdown-border)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
          }}
        >
          {typeof children === 'function'
            ? children(() => setIsOpen(false))
            : React.Children.map(children, (child) =>
              React.isValidElement(child)
                ? React.cloneElement(child, { onClose: () => setIsOpen(false) })
                : child
            )}
        </div>,
        document.body
      )}
    </div>
  )
}

function DropdownMenuItem({ children, onClick, onClose, className = "" }) {
  const handleClick = () => {
    if (onClick) onClick()
    if (onClose) onClose()
  }

  return (
    <div
      className={`px-4 py-2.5 text-sm cursor-pointer transition-colors mx-1 my-0.5 rounded-lg flex items-center gap-2 ${className}`}
      style={{
        color: 'var(--dropdown-text)',
      }}
      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--dropdown-hover)'}
      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
      onClick={handleClick}
    >
      {children}
    </div>
  )
}

export { DropdownMenu, DropdownMenuItem }
