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
      
      menu.style.position = 'fixed'
      menu.style.top = `${triggerRect.bottom + 4}px`
      menu.style.left = `${triggerRect.left}px`
      menu.style.zIndex = '9999'
    }
  }, [isOpen])

  return (
    <div className="relative" ref={dropdownRef}>
      <div ref={triggerRef} onClick={() => setIsOpen(!isOpen)}>{trigger}</div>
      {isOpen && createPortal(
        <div 
          ref={menuRef}
          className="fixed bg-zinc-800 border border-zinc-700 rounded-md shadow-lg min-w-[160px]"
          style={{ zIndex: 9999 }}
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
      className="px-4 py-2 text-sm text-white hover:bg-zinc-700 cursor-pointer first:rounded-t-md last:rounded-b-md"
      onClick={handleClick}
    >
      {children}
    </div>
  )
}

export { DropdownMenu, DropdownMenuItem }

