import React from 'react'
import { Plus, Layers, Sparkles } from 'lucide-react'
import Modal from '../../editor/components/Modal'

const TemplateThumbnail = ({ project }) => {
    const videoRef = React.useRef(null)
    const [isVisible, setIsVisible] = React.useState(false)
    const [isLoaded, setIsLoaded] = React.useState(false)

    React.useEffect(() => {
        const observer = new IntersectionObserver(
            ([entry]) => {
                setIsVisible(entry.isIntersecting)
            },
            { threshold: 0.1 }
        )

        if (videoRef.current) {
            observer.observe(videoRef.current)
        }

        return () => observer.disconnect()
    }, [])

    React.useEffect(() => {
        if (!videoRef.current) return

        if (isVisible) {
            videoRef.current.play().catch(e => {
                console.log('Autoplay blocked or video missing:', e)
            })
        } else {
            videoRef.current.pause()
        }
    }, [isVisible])

    return (
        <div className="aspect-video bg-[#1a1b23] border border-white/5 rounded-[16px] overflow-hidden relative mb-3 group-hover:border-[#6940c9]/40 transition-all duration-300 shadow-sm">
            {project.videoUrl ? (
                <video
                    ref={videoRef}
                    src={project.videoUrl}
                    className={`w-full h-full object-contain transition-opacity duration-500 ${isLoaded ? 'opacity-100' : 'opacity-0'}`}
                    muted
                    loop
                    playsInline
                    preload="auto"
                    onLoadedData={() => setIsLoaded(true)}
                    poster={project.thumbnail}
                />
            ) : null}

            {(!project.videoUrl || !isLoaded) && (
                <div className={`absolute inset-0 transition-opacity duration-300 ${isLoaded ? 'opacity-0' : 'opacity-100'}`}>
                    {project.thumbnail ? (
                        <img
                            src={project.thumbnail}
                            alt={`${project.name} thumbnail`}
                            className="w-full h-full object-contain"
                        />
                    ) : (
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-600 gap-3">
                            <Layers size={32} strokeWidth={1.5} className="opacity-50" />
                            <span className="text-[10px] font-semibold uppercase tracking-widest opacity-50">Preview</span>
                        </div>
                    )}
                </div>
            )}

            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-[#6940c9]/10 backdrop-blur-[2px] duration-300">
                <div className="h-8 px-4 bg-white text-black text-[11px] font-bold rounded-[8px] shadow-sm transform translate-y-2 group-hover:translate-y-0 transition-all duration-300 flex items-center gap-2">
                    USE TEMPLATE
                </div>
            </div>
        </div>
    )
}

const ProjectStarterModal = ({ 
    isOpen, 
    onClose, 
    onSelectBlank, 
    onSelectTemplate,
    featuredTemplates = [] 
}) => {
    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="Start a new project"
            maxWidth="max-w-6xl"
        >
            <div className="max-h-[80vh] overflow-y-auto no-scrollbar py-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
                    {/* Blank Project Card */}
                    <div 
                        className="group cursor-pointer"
                        onClick={onSelectBlank}
                    >
                        <div className="aspect-video bg-[#090a0d] border border-dashed border-white/10 rounded-[16px] flex flex-col items-center justify-center gap-3 hover:border-[#6940c9]/40 transition-all duration-300 hover:bg-[#6940c9]/5">
                            <div className="w-10 h-10 bg-white/5 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform duration-300 group-hover:bg-[#6940c9]/20">
                                <Plus size={24} strokeWidth={2} className="text-white/30 group-hover:text-[#6940c9]" />
                            </div>
                            <span className="text-[12px] font-semibold text-white/40 group-hover:text-white uppercase tracking-widest">Blank Project</span>
                        </div>
                        <div className="px-1 mt-3">
                            <h3 className="text-[14px] font-medium text-white/80 group-hover:text-white transition-colors">Start from scratch</h3>
                            <p className="text-[12px] text-white/20 mt-0.5 font-normal">A clean canvas for your ideas</p>
                        </div>
                    </div>

                    {/* Featured Templates */}
                    {featuredTemplates.map((template) => (
                        <div 
                            key={template._id}
                            className="group cursor-pointer"
                            onClick={() => onSelectTemplate(template._id)}
                        >
                            <TemplateThumbnail project={template} />
                            <div className="px-1 mt-3">
                                <div className="flex items-center gap-2 mb-0.5">
                                    <h3 className="text-[14px] font-medium text-white/80 group-hover:text-white transition-colors truncate">{template.name}</h3>
                                    <Sparkles size={12} className="text-[#6940c9] opacity-0 group-hover:opacity-100 transition-opacity" />
                                </div>
                                <p className="text-[12px] text-white/20 font-normal uppercase tracking-tight">Featured Template</p>
                            </div>
                        </div>
                    ))}
                </div>

                {featuredTemplates.length === 0 && (
                    <div className="py-12 flex flex-col items-center justify-center border border-dashed border-white/5 rounded-2xl bg-white/[0.01]">
                        <p className="text-[13px] text-white/20 font-normal">Load more templates from the dashboard</p>
                    </div>
                )}
            </div>
        </Modal>
    )
}

export default ProjectStarterModal
