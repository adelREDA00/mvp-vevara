import React, { useState } from 'react'
import { ArrowRight, Smartphone, Monitor } from 'lucide-react'
import Modal from '../../editor/components/Modal'

const ProjectConfigModal = ({ isOpen, onClose, mode, onCreate }) => {
    // Mode specific configuration
    const config = {
        app: {
            title: "App & Software Showcase",
            categories: [
                "App Walkthrough",
                "Launch Video",
                "Feature Announcement",
                "Promo",
            ]
        },
        ads: {
            title: "Ads & Marketing",
            categories: [
                "Product showcase",
                "Sale/promo announcement",
            ]
        }
    }

    const activeConfig = config[mode] || config.app
    const [selectedCategory, setSelectedCategory] = useState(activeConfig.categories[0])
    const [selectedPlatform, setSelectedPlatform] = useState("9:16")

    // Reset selection when modal mode changes
    React.useEffect(() => {
        setSelectedCategory(activeConfig.categories[0])
    }, [mode])

    const handleCreate = () => {
        onCreate(selectedCategory, selectedPlatform)
    }

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title=""
            showCloseButton={true}
            maxWidth="max-w-xl"
        >
            <div className="py-0 text-[var(--dashboard-text)] flex flex-col space-y-4 select-none font-sans">

                {/* Main Configuration Form */}
                <div className="space-y-6">
                    {/* Question 1: What are you making? */}
                    <div className="space-y-2">
                        <label className="text-[11px] font-bold uppercase tracking-wider text-[var(--dashboard-text-muted)] opacity-60">
                            What are you making?
                        </label>
                        <div className="flex flex-wrap gap-2">
                            {activeConfig.categories.map((category) => {
                                const isSelected = selectedCategory === category
                                return (
                                    <button
                                        key={category}
                                        onClick={() => setSelectedCategory(category)}
                                        className={`px-4 py-2.5 rounded-lg border text-[12.5px] font-semibold transition-all cursor-pointer ${isSelected
                                            ? "border-transparent bg-slate-700 dark:bg-slate-600 text-white font-bold"
                                            : "border-[var(--dashboard-border)] bg-transparent text-[var(--dashboard-text-muted)] hover:border-[var(--dashboard-text)]/40 hover:text-[var(--dashboard-text)]"
                                            }`}
                                    >
                                        {category}
                                    </button>
                                )
                            })}
                        </div>
                    </div>

                    {/* Question 2: What platform? */}
                    <div className="space-y-2">
                        <label className="text-[11px] font-bold uppercase tracking-wider text-[var(--dashboard-text-muted)] opacity-60">
                            What platform?
                        </label>
                        <div className="grid grid-cols-2 gap-3">
                            {/* Platform 1: 9:16 */}
                            <button
                                onClick={() => setSelectedPlatform("9:16")}
                                className={`p-4 rounded-xl border text-left transition-all cursor-pointer flex items-center gap-3.5 ${selectedPlatform === "9:16"
                                    ? "border-transparent bg-slate-700 dark:bg-slate-600 text-white"
                                    : "border-[var(--dashboard-border)] bg-transparent hover:border-[var(--dashboard-text)]/40 text-[var(--dashboard-text-muted)] hover:text-[var(--dashboard-text)]"
                                    }`}
                            >
                                <Smartphone size={16} className={selectedPlatform === "9:16" ? "text-white" : "opacity-60"} />
                                <div className="flex flex-col">
                                    <span className={`text-[12.5px] font-bold ${selectedPlatform === "9:16" ? "text-white" : "text-inherit"}`}>
                                        TikTok / Instagram
                                    </span>
                                    <span className={`text-[9.5px] ${selectedPlatform === "9:16" ? "text-white/80" : "opacity-60"}`}>Vertical — 9:16</span>
                                </div>
                            </button>

                            {/* Platform 2: 16:9 */}
                            <button
                                onClick={() => setSelectedPlatform("16:9")}
                                className={`p-4 rounded-xl border text-left transition-all cursor-pointer flex items-center gap-3.5 ${selectedPlatform === "16:9"
                                    ? "border-transparent bg-slate-700 dark:bg-slate-600 text-white"
                                    : "border-[var(--dashboard-border)] bg-transparent hover:border-[var(--dashboard-text)]/40 text-[var(--dashboard-text-muted)] hover:text-[var(--dashboard-text)]"
                                    }`}
                            >
                                <Monitor size={16} className={selectedPlatform === "16:9" ? "text-white" : "opacity-60"} />
                                <div className="flex flex-col">
                                    <span className={`text-[12.5px] font-bold ${selectedPlatform === "16:9" ? "text-white" : "text-inherit"}`}>
                                        LinkedIn / Twitter
                                    </span>
                                    <span className={`text-[9.5px] ${selectedPlatform === "16:9" ? "text-white/80" : "opacity-60"}`}>Horizontal — 16:9</span>
                                </div>
                            </button>
                        </div>
                    </div>
                </div>

                {/* Action Buttons */}
                <div className="flex items-center justify-end gap-3 pt-3 border-t border-[var(--dashboard-border)]">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-[12px] font-bold text-[var(--dashboard-text-muted)] hover:text-[var(--dashboard-text)] transition-colors cursor-pointer"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleCreate}
                        className="px-5 py-2 bg-[#7c4af0] hover:bg-[#6a3fd4] text-white text-[12px] font-bold rounded-lg transition-all flex items-center gap-2 cursor-pointer"
                    >
                        <span>Create project</span>
                        <ArrowRight size={13} strokeWidth={2.5} />
                    </button>
                </div>

            </div>
        </Modal>
    )
}

export default ProjectConfigModal
