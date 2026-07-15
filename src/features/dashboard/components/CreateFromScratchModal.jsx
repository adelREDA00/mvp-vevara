import React, { useContext } from 'react'
import { ArrowRight, Sparkles, MoveRight, Upload } from 'lucide-react'
import Modal from '../../editor/components/Modal'
import { ThemeContext } from '../../../app/context/ThemeContext'

const CreateFromScratchModal = ({ isOpen, onClose, onConfirm }) => {
    const { theme } = useContext(ThemeContext)
    const isLight = theme === 'light'

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title=""
            showCloseButton={true}
            maxWidth="max-w-2xl"
        >
            <div className="py-2 text-[var(--dashboard-text)] flex flex-col items-center text-center space-y-4 select-none">

                {/* Highly Visual, Scroll-free Horizontal Steps Diagram (No Circle BGs, Floating Icons) */}
                <div className="flex flex-col md:flex-row items-center justify-center gap-6 md:gap-8 w-full max-w-xl py-2">
                    
                    {/* Step 1: Design (Canva/Figma overlapping) */}
                    <div className="flex flex-col items-center text-center space-y-2.5 w-44 shrink-0">
                        <div className="flex items-center -space-x-2.5 shrink-0 h-14">
                            {/* Canva Logo */}
                            <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-[#00C4CC] via-[#7D2AE8] to-[#FF66C4] flex items-center justify-center shrink-0 border border-white/20 relative z-10 shadow-md">
                                <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-6 h-6">
                                    <path fill="white" d="M45.6,43.1c-1.7,2.3-3.9,4.7-6.8,6.5c-2.8,1.8-6,3.2-9.8,3.2c-3.5,0-6.4-1.8-8-3.3c-2.4-2.3-3.7-5.6-4.1-8.7 c-1.2-9.6,4.7-22.3,13.8-27.8c2.1-1.3,4.4-1.9,6.6-1.9c4.4,0,7.7,3.1,8.1,6.9c0.4,3.4-0.9,6.3-4.7,8.2c-1.9,1-2.9,0.9-3.2,0.5 c-0.2-0.3-0.1-0.8,0.3-1.1c3.5-2.9,3.6-5.3,3.2-8.7c-0.3-2.2-1.7-3.6-3.3-3.6c-6.9,0-16.9,15.5-15.5,26.7c0.5,4.4,3.2,9.5,8.8,9.5 c1.8,0,3.8-0.5,5.5-1.4c3.9-2,5.6-3.4,7.9-6.6c0.3-0.4,0.6-0.9,0.9-1.3c0.2-0.4,0.6-0.5,0.9-0.5c0.3,0,0.7,0.3,0.7,0.8 c0,0.3-0.1,0.9-0.5,1.4C46.3,42.1,46,42.7,45.6,43.1L45.6,43.1z"/>
                                </svg>
                            </div>
                            {/* Figma Logo */}
                            <div className="w-10 h-10 rounded-full bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 flex items-center justify-center shrink-0 shadow-md relative z-0 border border-white/20">
                                <svg viewBox="0 0 38 57" xmlns="http://www.w3.org/2000/svg" className="w-4.5 h-6">
                                    <path d="M19 0H9.5C4.25 0 0 4.25 0 9.5C0 14.75 4.25 19 9.5 19H19V0Z" fill="#F24E1E"/>
                                    <path d="M28.5 0H19V19H28.5C33.75 19 38 14.75 38 9.5C38 4.25 33.75 0 28.5 0Z" fill="#FF7262"/>
                                    <path d="M19 19H9.5C4.25 19 0 23.25 0 28.5C0 33.75 4.25 39 9.5 39H19V19Z" fill="#A259FF"/>
                                    <path d="M19 39H9.5C4.25 39 0 43.25 0 48.5C0 53.75 4.25 58 9.5 58C14.75 58 19 53.75 19 48.5V39Z" fill="#0ACF83"/>
                                    <path d="M28.5 19C23.25 19 19 23.25 19 28.5C19 33.75 23.25 38 28.5 38C33.75 38 38 33.75 38 28.5C38 23.25 33.75 19 28.5 19Z" fill="#1ABC9C"/>
                                </svg>
                            </div>
                        </div>
                        <div className="flex flex-col">
                            <span className="text-[13.5px] font-extrabold text-[var(--dashboard-text)] leading-tight">1. Design</span>
                            <span className="text-[10.5px] text-[var(--dashboard-text-muted)] font-bold opacity-75">in Canva or Figma</span>
                        </div>
                    </div>

                    <MoveRight size={18} className="text-[var(--dashboard-text-muted)] opacity-30 hidden md:block shrink-0 mb-5" />

                    {/* Step 2: Export */}
                    <div className="flex flex-col items-center text-center space-y-2.5 w-44 shrink-0">
                        <div className="flex items-center justify-center shrink-0 h-14">
                            <Upload size={32} strokeWidth={2} className="text-slate-500 dark:text-slate-400" />
                        </div>
                        <div className="flex flex-col">
                            <span className="text-[13.5px] font-extrabold text-[var(--dashboard-text)] leading-tight">2. Export Layers</span>
                            <span className="text-[10.5px] text-[var(--dashboard-text-muted)] font-bold opacity-75">with transparent bg</span>
                        </div>
                    </div>

                    <MoveRight size={18} className="text-[var(--dashboard-text-muted)] opacity-30 hidden md:block shrink-0" />

                    {/* Step 3: Animate */}
                    <div className="flex flex-col items-center text-center space-y-2.5 w-44 shrink-0">
                        <div className="flex items-center justify-center shrink-0 h-14">
                            <img src="/logo.png" alt="Vevara Logo" className="w-11 h-11 object-contain" />
                        </div>
                        <div className="flex flex-col">
                            <span className="text-[13.5px] font-extrabold text-[var(--dashboard-text)] leading-tight">3. Animate!</span>
                            <span className="text-[10.5px] text-[var(--dashboard-text-muted)] font-bold opacity-75">import & animate here</span>
                        </div>
                    </div>
                </div>

                {/* Big, Clear CTA Action Buttons */}
                <div className="flex flex-col items-center gap-2.5 pt-1.5 w-full max-w-xs">
                    <button
                        onClick={onConfirm}
                        className={`w-full h-11 bg-[var(--dashboard-accent)] hover:bg-[var(--dashboard-accent-hover)] ${isLight ? 'text-white' : 'text-[#06121A]'} text-[13px] font-extrabold rounded-xl shadow-lg hover:shadow-[var(--dashboard-accent)]/20 transform hover:-translate-y-0.5 transition-all active:translate-y-0 flex items-center justify-center gap-2 cursor-pointer border border-white/10`}
                    >
                        <span>Create Blank Project</span>
                        <ArrowRight size={13} strokeWidth={2.5} className="animate-pulse" />
                    </button>
                    
                    <button
                        onClick={onClose}
                        className="text-[11.5px] font-bold text-[var(--dashboard-text-muted)] hover:text-[var(--dashboard-text)] transition-colors py-1 cursor-pointer"
                    >
                        Cancel
                    </button>
                </div>

            </div>
        </Modal>
    )
}

export default CreateFromScratchModal
