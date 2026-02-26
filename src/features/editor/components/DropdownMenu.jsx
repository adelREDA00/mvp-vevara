import React, { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'

function DropdownMenu({ trigger, children }) {
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
      const menuWidth = 220 // Default min-width or estimated width

      let left = triggerRect.left

      // Collision detection: check if menu would go off the right edge
      if (left + menuWidth > viewportWidth) {
        left = Math.max(8, viewportWidth - menuWidth - 8)
      }

      menu.style.position = 'fixed'
      menu.style.top = `${triggerRect.bottom + 4}px`
      menu.style.left = `${left}px`
      menu.style.zIndex = '9999'
    }
  }, [isOpen])

  return (
    <div className="relative" ref={dropdownRef}>
      <div ref={triggerRef} onClick={() => setIsOpen(!isOpen)}>{trigger}</div>
      {isOpen && createPortal(
        <div
          ref={menuRef}
          className="fixed shadow-2xl min-w-[200px] py-1 border border-white/10 rounded-xl overflow-hidden"
          style={{
            zIndex: 9999,
            backgroundColor: 'rgba(24, 24, 27, 0.75)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
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

function DropdownMenuItem({ children, onClick, onClose }) {
  const handleClick = () => {
    if (onClick) onClick()
    if (onClose) onClose()
  }

  return (
    <div
      className="px-4 py-2.5 text-sm text-white/90 hover:text-white hover:bg-white/10 cursor-pointer transition-colors mx-1 my-0.5 rounded-lg"
      onClick={handleClick}
    >
      {children}
    </div>
  )
}

export { DropdownMenu, DropdownMenuItem }

