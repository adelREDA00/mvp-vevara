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
                className={`relative w-full ${maxWidth} border rounded-2xl shadow-2xl overflow-hidden pointer-events-auto animate-in zoom-in-95 fade-in duration-300 ${className} ${isLight ? 'border-black/5' : 'border-white/10'
                    }`}
                style={{
                    backgroundColor: isLight ? '#ffffff' : '#090A0D',
                }}
            >


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
