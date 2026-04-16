import React, { useEffect, useState, useContext } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { ThemeContext } from '../../../app/context/ThemeContext'

const Modal = ({
    isOpen,
    onClose,
    title,
    children,
    showCloseButton = true,
    maxWidth = 'max-w-md',
    className = ""
}) => {
    const [isMounted, setIsMounted] = useState(false)
    const { theme } = useContext(ThemeContext)
    const isLight = theme === 'light'

    useEffect(() => {
        setIsMounted(true)
        if (isOpen) {
            document.body.style.overflow = 'hidden'
        } else {
            document.body.style.overflow = 'unset'
        }
        return () => {
            document.body.style.overflow = 'unset'
        }
    }, [isOpen])

    if (!isOpen || !isMounted) return null

    return createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-in fade-in duration-300 pointer-events-auto"
                onClick={onClose}
            />

            {/* Modal Container */}
            <div
                className={`relative w-full ${maxWidth} border rounded-2xl shadow-2xl overflow-hidden pointer-events-auto animate-in zoom-in-95 fade-in duration-300 ${className} ${
                  isLight ? 'border-black/5' : 'border-white/10'
                }`}
                style={{
                    backgroundColor: isLight ? 'rgba(255, 255, 255, 0.95)' : 'rgba(15, 16, 21, 0.8)',
                    backdropFilter: 'blur(24px)',
                    WebkitBackdropFilter: 'blur(24px)',
                }}
            >
                {/* Header */}
                {(title || showCloseButton) && (
                    <div className={`flex items-center justify-between px-6 py-4 border-b ${isLight ? 'border-black/5' : 'border-white/5'}`}>
                        <h3 className={`text-[15px] font-medium tracking-tight ${isLight ? 'text-gray-900' : 'text-white/90'}`}>{title}</h3>
                        {showCloseButton && (
                            <button
                                onClick={onClose}
                                className={`p-1 rounded-lg transition-all outline-none ${isLight ? 'hover:bg-black/5 text-gray-400 hover:text-gray-900' : 'hover:bg-white/5 text-white/40 hover:text-white'}`}
                            >
                                <X className="w-5 h-5" />
                            </button>
                        )}
                    </div>
                )}

                {/* Content */}
                <div className="p-6">
                    {children}
                </div>
            </div>
        </div>,
        document.body
    )
}

export default Modal
