import React from 'react'
import { Plus, Layers, Sparkles } from 'lucide-react'
import Modal from '../../editor/components/Modal'
import TemplateThumbnail from './TemplateThumbnail'


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
                        <div className="aspect-video bg-[var(--dashboard-card-bg)] border-2 border-dashed border-[var(--dashboard-border)] rounded-[16px] flex flex-col items-center justify-center gap-3 hover:border-[var(--dashboard-accent)]/30 transition-all duration-300 hover:bg-[var(--dashboard-accent)]/5">
                            <div className="w-10 h-10 bg-[var(--dashboard-accent)]/5 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform duration-300 group-hover:bg-[var(--dashboard-accent)]/20">
                                <Plus size={24} strokeWidth={2} className="text-[var(--dashboard-text-muted)] group-hover:text-[var(--dashboard-accent)]" />
                            </div>
                            <span className="text-[12px] font-semibold text-[var(--dashboard-text-muted)] group-hover:text-[var(--dashboard-text)] uppercase tracking-widest">Blank Project</span>
                        </div>
                        <div className="px-1 mt-3">
                            <h3 className="text-[14px] font-medium text-[var(--dashboard-text)] group-hover:text-[var(--dashboard-accent)] transition-colors">Start from scratch</h3>
                            <p className="text-[12px] text-[var(--dashboard-text-muted)] mt-0.5 font-normal opacity-60">A clean canvas for your ideas</p>
                        </div>
                    </div>

                    {/* Featured Templates */}
                    {featuredTemplates.map((template) => (
                        <div 
                            key={template._id}
                            className="group cursor-pointer"
                            onClick={() => onSelectTemplate(template._id)}
                        >
                            <TemplateThumbnail project={template} buttonText="Use Template" />
                            <div className="px-1 mt-3">
                                <div className="flex items-center gap-2 mb-0.5">
                                    <h3 className="text-[14px] font-medium text-[var(--dashboard-text)] group-hover:text-[var(--dashboard-accent)] transition-colors truncate">{template.name}</h3>
                                    <Sparkles size={12} className="text-[var(--dashboard-accent)] opacity-0 group-hover:opacity-100 transition-opacity" />
                                </div>
                                <p className="text-[12px] text-[var(--dashboard-text-muted)] font-normal uppercase tracking-tight opacity-60">Featured Template</p>
                            </div>
                        </div>
                    ))}
                </div>

                {featuredTemplates.length === 0 && (
                    <div className="py-12 flex flex-col items-center justify-center border border-dashed border-[var(--dashboard-border)] rounded-2xl bg-[var(--dashboard-card-bg)]/30">
                        <p className="text-[13px] text-[var(--dashboard-text-muted)] font-normal">Load more templates from the dashboard</p>
                    </div>
                )}
            </div>
        </Modal>
    )
}

export default ProjectStarterModal
