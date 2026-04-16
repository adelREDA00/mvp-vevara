import React, { useState, useEffect, useContext, useRef } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useNavigate, Link } from 'react-router-dom'
import api from '../../../api/client'
import { logoutUser, updateUserTheme, setLocalTheme } from '../../../store/slices/authSlice'
import {
    Plus, Folder, Layout, LogOut, Settings, User as UserIcon,
    ExternalLink, Trash2, ChevronDown, Layers, Loader2, X,
    Music, Presentation, Sparkles, Box, Wand2, Play, Share2,
    Search, Menu, Sun, Moon
} from 'lucide-react'
import { DropdownMenu, DropdownMenuItem } from '../../editor/components/DropdownMenu'
import Modal from '../../editor/components/Modal'
import { uid } from '../../../utils/ids'
import ProjectStarterModal from '../components/ProjectStarterModal'
import DashboardSidebar from '../components/DashboardSidebar'
import DashboardHero from '../components/DashboardHero'
import TemplateThumbnail from '../components/TemplateThumbnail'
import { ThemeContext } from '../../../app/context/ThemeContext'

const TUTORIAL_VIDEO_URL = "/first.mp4"

const CATEGORY_STYLES = {
    'All': { icon: Layers, color: '#8b5cf6' },
    'Featured': { icon: Sparkles, color: '#f43f5e' },
    'Logo': { icon: Box, color: '#f59e0b' },
    'Ads': { icon: Presentation, color: '#10b981' },
    'Social': { icon: Share2, color: '#ec4899' },
    'Website': { icon: Layout, color: '#06b6d4' },
}

const CategoryCircle = ({ label, active, onClick, isStuck }) => {
    const style = CATEGORY_STYLES[label] || { icon: Layout, color: '#7c4af0' }
    const Icon = style.icon

    return (
        <button
            onClick={onClick}
            className={`flex flex-col items-center group transition-all shrink-0 ${isStuck 
                ? 'min-w-[60px] md:min-w-[75px] pt-0.5 gap-1 md:gap-1' 
                : 'min-w-[70px] md:min-w-[80px] pt-2 gap-1.5 md:gap-2'
                }`}
        >
            <div
                className={`rounded-full flex items-center justify-center transition-all duration-500 border-2 ${isStuck
                    ? 'w-8 h-8 md:w-9 md:h-9'
                    : 'w-10 h-10 md:w-11 md:h-11'
                    } ${active ? 'scale-110' : 'opacity-80 group-hover:opacity-100 group-hover:scale-105'
                    }`}
                style={{
                    backgroundColor: style.color,
                    borderColor: active ? (isStuck ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.25)') : 'transparent',
                    boxShadow: active ? `0 0 12px ${style.color}44` : 'none',
                    color: 'white'
                }}
            >
                <Icon size={isStuck ? 14 : 18} strokeWidth={active ? 2.5 : 2} fill={active ? "rgba(255,255,255,0.2)" : "none"} />
            </div>
            <span className={`font-semibold tracking-tight transition-all duration-300 ${isStuck ? 'text-[9px]' : 'text-[10px]'
                } ${active
                    ? (isStuck ? 'text-[var(--dashboard-text)] scale-105' : 'text-[var(--dashboard-text)] scale-105')
                    : 'text-[var(--dashboard-text-muted)] group-hover:text-[var(--dashboard-text)] opacity-60 group-hover:opacity-100'
                }`}>
                {label === 'YouTube & Podcast Intros/Outros' ? 'Video' : label}
            </span>
        </button>
    )
}


const DashboardPage = () => {
    const dispatch = useDispatch()
    const navigate = useNavigate()
    const { user, isAuthenticated, status } = useSelector((state) => state.auth)
    const { theme, setTheme, isLight } = useContext(ThemeContext)

    const [projects, setProjects] = useState([])
    const [templateProjects, setTemplateProjects] = useState([])
    const [loading, setLoading] = useState(true)
    const [projectToDelete, setProjectToDelete] = useState(null)
    const [selectedCategory, setSelectedCategory] = useState('All')
    const [isProjectStarterModalOpen, setIsProjectStarterModalOpen] = useState(false)
    const [isSidebarOpen, setIsSidebarOpen] = useState(false)
    const [isFilterStuck, setIsFilterStuck] = useState(false)
    const scrollContainerRef = useRef(null)
    const filterRef = useRef(null)
    const filterSentinelRef = useRef(null)
    const categoriesScrollRef = useRef(null)
    const [canScrollLeft, setCanScrollLeft] = useState(false)
    const [canScrollRight, setCanScrollRight] = useState(false)
    const [isMessageCollapsed, setIsMessageCollapsed] = useState(false)
    const [isDeleting, setIsDeleting] = useState(false)
    const [bottomFeedback, setBottomFeedback] = useState('')
    const [feedbackStatus, setFeedbackStatus] = useState('idle') // idle, loading, success, error

    const CATEGORIES = [
        'All',
        'Featured',
        'Logo',
        'Ads',
        'Social',
        'Website',
        // 'YouTube & Podcast Intros/Outros'
    ]

    useEffect(() => {
        const container = scrollContainerRef.current
        if (!container) return

        // Use IntersectionObserver to detect when filter hits the top
        const observer = new IntersectionObserver(
            ([entry]) => {
                setIsFilterStuck(!entry.isIntersecting)
            },
            {
                threshold: [1],
                root: container,
                rootMargin: '-12px 0px 0px 0px' // Adjusted for mobile-friendly top offset
            }
        )

        if (filterSentinelRef.current) {
            observer.observe(filterSentinelRef.current)
        }

        return () => {
            observer.disconnect()
        }
    }, [])

    // Category scroll indicators
    const checkScroll = () => {
        const el = categoriesScrollRef.current
        if (!el) return
        setCanScrollLeft(el.scrollLeft > 10)
        setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 10)
    }

    useEffect(() => {
        const timeoutId = setTimeout(checkScroll, 100)
        window.addEventListener('resize', checkScroll)
        return () => {
            clearTimeout(timeoutId)
            window.removeEventListener('resize', checkScroll)
        }
    }, [templateProjects, selectedCategory, loading])

    // Scroll to section based on hash
    useEffect(() => {
        const hash = window.location.hash
        if (hash) {
            const id = hash.replace('#', '')
            const element = document.getElementById(id)
            if (element && scrollContainerRef.current) {
                // We need to wait a bit for the content to render if needed, but here it should be fine
                element.scrollIntoView({ behavior: 'smooth' })
            }
        }
    }, [window.location.hash])

    useEffect(() => {
        if (status !== 'loading' && status !== 'idle' && !isAuthenticated) {
            navigate('/login')
            return
        }

        const fetchProjects = async () => {
            try {
                setLoading(true)
                const [data, templateData] = await Promise.all([
                    api.get('/projects'),
                    api.get('/projects/template')
                ])
                setProjects(data)
                setTemplateProjects(templateData)
            } catch (error) {
                console.error('Failed to fetch projects:', error)
            } finally {
                setTimeout(() => setLoading(false), 200)
            }
        }

        if (isAuthenticated) {
            fetchProjects()
        }
    }, [isAuthenticated, status, navigate])

    const handleLogout = async () => {
        await dispatch(logoutUser())
        navigate('/login')
    }

    const handleCreateProject = async () => {
        try {
            setIsDuplicating(true)
            const sceneId = uid()
            const bgLayerId = uid()
            const now = Date.now()

            const newProject = await api.post('/projects', {
                name: 'Untitled Project',
                data: {
                    scenes: [{
                        id: sceneId,
                        name: 'Scene 1',
                        duration: 5.0,
                        transition: 'None',
                        backgroundColor: 0xffffff,
                        layers: [bgLayerId]
                    }],
                    layers: {
                        [bgLayerId]: {
                            id: bgLayerId,
                            sceneId: sceneId,
                            type: 'background',
                            name: 'Background',
                            visible: true,
                            locked: false,
                            opacity: 1.0,
                            x: 0,
                            y: 0,
                            width: 1920,
                            height: 1080,
                            rotation: 0,
                            scaleX: 1,
                            scaleY: 1,
                            anchorX: 0,
                            anchorY: 0,
                            data: { color: 0xffffff },
                            createdAt: now,
                            updatedAt: now
                        }
                    },
                    sceneMotionFlows: {}
                }
            })
            window.location.href = `/project/${newProject._id}`
        } catch (error) {
            console.error('Failed to create project:', error)
            setIsDuplicating(false)
        }
    }

    const [isDuplicating, setIsDuplicating] = useState(false)

    const handleDuplicateTemplate = async (templateId) => {
        try {
            setIsDuplicating(true)
            const newProject = await api.post(`/projects/${templateId}/duplicate`)
            window.location.href = `/project/${newProject._id}`
        } catch (error) {
            console.error('Failed to duplicate template:', error)
            setIsDuplicating(false)
        }
    }

    const handleDeleteProject = (e, id) => {
        e.stopPropagation()
        setProjectToDelete(id)
    }

    const confirmDeleteProject = async () => {
        if (!projectToDelete || isDeleting) return
        try {
            setIsDeleting(true)
            await api.delete(`/projects/${projectToDelete}`)
            setProjects(prev => prev.filter(p => p._id !== projectToDelete))
            setProjectToDelete(null)
        } catch (error) {
            console.error('Failed to delete project:', error)
            alert('Failed to delete project. Please try again.')
        } finally {
            setIsDeleting(false)
        }
    }
    const handleFeedbackSubmit = async (e) => {
        if (e) e.preventDefault();
        if (!bottomFeedback.trim() || feedbackStatus === 'loading') return;

        try {
            setFeedbackStatus('loading');
            await api.post('/feedback', { text: bottomFeedback });
            setFeedbackStatus('success');
            setBottomFeedback('');
            setTimeout(() => setFeedbackStatus('idle'), 3000);
        } catch (error) {
            console.error('Failed to send feedback:', error);
            setFeedbackStatus('error');
            setTimeout(() => setFeedbackStatus('idle'), 3000);
        }
    };

    return (
        <div className="min-h-screen bg-[var(--dashboard-sidebar-bg)] text-[var(--dashboard-text)] font-medium selection:bg-[#7c4af0]/20 flex overflow-x-hidden">
            {/* Sidebar */}
            <DashboardSidebar
                isOpen={isSidebarOpen}
                onClose={() => setIsSidebarOpen(false)}
                onCreateProject={() => setIsProjectStarterModalOpen(true)}
            />

            {/* Content Wrapper (Scrollable) */}
            <div
                ref={scrollContainerRef}
                className="flex-1 lg:ml-[var(--sidebar-width)] h-screen overflow-y-auto transition-all custom-scrollbar pb-2 md:pb-3 pr-2 md:pr-3 pt-1 md:pt-2"
            >
                <div className="min-h-full bg-[var(--dashboard-bg)] rounded-[16px] md:rounded-[24px] border border-[var(--dashboard-border)] shadow-md dashboard-page-container flex flex-col relative">
                    {/* Brand Gradient Background - Softer Start */}
                    <div className="absolute inset-x-0 top-0 h-[500px] bg-gradient-to-b from-[var(--dashboard-accent)]/20 via-[var(--dashboard-accent)]/5 to-transparent pointer-events-none z-0 rounded-t-[16px] md:rounded-t-[24px]" />

                    <div className="px-4 md:px-10 pb-4 md:pb-10 max-w-[1600px] mx-auto w-full flex-1 relative z-10">
                        {/* Header */}
                        {/* Header - Non-sticky */}
                        <header className="flex items-center justify-between mb-8 md:mb-6 pt-4 md:pt-10">
                            <div className="flex items-center gap-4">
                                {/* Mobile Menu Button - Top Left Initial Position */}
                                <button
                                    onClick={() => setIsSidebarOpen(true)}
                                    className="lg:hidden w-9 h-9 flex items-center justify-center text-[var(--dashboard-text-muted)] hover:bg-[var(--dashboard-card-hover)] rounded-full transition-all"
                                >
                                    <Menu size={20} />
                                </button>

                                {/* <div className="hidden lg:flex flex-col">
                                    <h2 className="text-[13px] font-bold text-[var(--dashboard-text-muted)] uppercase tracking-widest opacity-40">Vevara Motion</h2>
                                    <p className="text-[16px] font-bold text-[var(--dashboard-text)]">Dashboard</p>
                                </div> */}
                            </div>

                            <div className="flex items-center gap-4">
                                <button
                                    onClick={() => {
                                        const newTheme = theme === 'light' ? 'dark' : 'light'
                                        setTheme(newTheme)
                                        if (isAuthenticated) {
                                            dispatch(setLocalTheme(newTheme))
                                            dispatch(updateUserTheme(newTheme))
                                        }
                                    }}
                                    className="w-9 h-9 flex items-center justify-center text-[var(--dashboard-text-muted)] hover:text-[var(--dashboard-text)] transition-all"
                                >
                                    {isLight ? <Moon size={18} /> : <Sun size={18} />}
                                </button>

                                {isAuthenticated && (
                                    <DropdownMenu
                                        trigger={
                                            <button className="flex items-center gap-2 outline-none group">
                                                <div className="w-8 h-8 rounded-full bg-[var(--dashboard-accent)] flex items-center justify-center text-white font-bold text-[11px] shadow-md group-hover:scale-105 transition-transform">
                                                    {user?.email?.substring(0, 2).toUpperCase()}
                                                </div>
                                                <ChevronDown size={12} className="text-[var(--dashboard-text-muted)] mt-0.5" />
                                            </button>
                                        }
                                        className="bg-[var(--dashboard-card-bg)] border border-[var(--dashboard-border)] shadow-xl"
                                    >
                                        <div className="px-4 py-3 border-b border-[var(--dashboard-border)] mb-1">
                                            <p className="text-[12px] font-medium text-[var(--dashboard-text-muted)] truncate">{user?.email}</p>
                                        </div>
                                        <DropdownMenuItem onClick={handleLogout} className="hover:bg-[var(--dashboard-card-hover)]">
                                            <div className="flex items-center gap-3 text-rose-500">
                                                <LogOut size={16} strokeWidth={2} />
                                                <span className="text-[14px] font-semibold">Logout</span>
                                            </div>
                                        </DropdownMenuItem>
                                    </DropdownMenu>
                                )}
                            </div>
                        </header>

                        <DashboardHero userName={user?.firstName} />

                        {/* Recent Projects Section */}
                        <section id="projects" className="scroll-mt-24 mb-16">
                            <div className="flex items-center justify-between mb-8">
                                <h2 className="text-[20px] font-clean tracking-tight text-[var(--dashboard-text)]">Recent Designs</h2>
                                {/* <div className="flex items-center gap-3">
                                    <button className="text-[12px] font-semibold text-[var(--dashboard-text-muted)] hover:text-[var(--dashboard-text)] flex items-center gap-1.5 border border-[var(--dashboard-border)] rounded-lg px-3 py-1.5 transition-all">
                                        Owner <ChevronDown size={12} />
                                    </button>
                                    <button className="text-[12px] font-semibold text-[var(--dashboard-text-muted)] hover:text-[var(--dashboard-text)] flex items-center gap-1.5 border border-[var(--dashboard-border)] rounded-lg px-3 py-1.5 transition-all">
                                        Any type <ChevronDown size={12} />
                                    </button>
                                </div> */}
                            </div>

                            {loading ? (
                                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-6">
                                    {[1, 2, 3, 4, 5, 6].map(i => (
                                        <div key={i} className="aspect-video bg-[var(--dashboard-card-bg)] rounded-[12px] animate-pulse border border-[var(--dashboard-border)]" />
                                    ))}
                                </div>
                            ) : projects.length === 0 ? (
                                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-6">
                                    <div
                                        onClick={() => setIsProjectStarterModalOpen(true)}
                                        className="aspect-video w-full border-2 border-dashed border-[var(--dashboard-border)] rounded-xl flex flex-col items-center justify-center gap-3 cursor-pointer hover:border-[var(--dashboard-accent)]/30 hover:bg-[var(--dashboard-accent)]/5 transition-all group"
                                    >
                                        <div className="w-10 h-10 bg-[var(--dashboard-accent)]/10 rounded-full flex items-center justify-center text-[var(--dashboard-accent)] group-hover:scale-110 transition-transform">
                                            <Plus size={20} strokeWidth={2} />
                                        </div>
                                        <p className="text-[var(--dashboard-text-muted)] font-medium text-[11px] text-center px-4">Start your first project</p>
                                    </div>
                                </div>
                            ) : (
                                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-6">
                                    {projects.slice(0, 12).map((project) => (
                                        <div
                                            key={project._id}
                                            className="group cursor-pointer"
                                            onClick={() => window.location.href = `/project/${project._id}`}
                                        >
                                            <div className="aspect-video bg-[var(--dashboard-card-bg)] border border-[var(--dashboard-border)] rounded-[12px] overflow-hidden relative mb-3 group-hover:border-[var(--dashboard-accent)]/40 transition-all duration-300 shadow-sm">
                                                {project.thumbnail ? (
                                                    <img
                                                        src={project.thumbnail}
                                                        alt={`${project.name} thumbnail`}
                                                        className="w-full h-full object-contain"
                                                    />
                                                ) : (
                                                    <div className="absolute inset-0 flex flex-col items-center justify-center text-[var(--dashboard-text-muted)] gap-3 opacity-20">
                                                        <Layers size={28} strokeWidth={1.5} />
                                                    </div>
                                                )}

                                                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40 backdrop-blur-[2px] duration-300">
                                                    <button className="h-8 px-4 bg-white text-black text-[11px] font-bold rounded-lg shadow-lg transform translate-y-2 group-hover:translate-y-0 transition-all duration-300 uppercase">Open</button>
                                                </div>
                                                <div className="absolute top-2 left-2 bg-black/40 backdrop-blur-md rounded-md px-1.5 py-0.5 text-[8px] font-bold text-white uppercase tracking-widest flex items-center gap-1">
                                                    <X size={8} className="rotate-45" /> Private
                                                </div>
                                                <button
                                                    onClick={(e) => handleDeleteProject(e, project._id)}
                                                    className="absolute bottom-2 right-2 p-1.5 bg-rose-500/10 hover:bg-rose-500 text-rose-500 hover:text-white rounded-md opacity-0 group-hover:opacity-100 transition-all duration-200 z-10"
                                                >
                                                    <Trash2 size={14} strokeWidth={2} />
                                                </button>
                                            </div>
                                            <div className="px-0.5">
                                                <h3 className="text-[13px] font-semibold text-[var(--dashboard-text)] group-hover:text-[#7c4af0] transition-colors truncate">{project.name}</h3>
                                                <p className="text-[10px] text-[var(--dashboard-text-muted)] mt-0.5 font-medium uppercase tracking-tight opacity-70">Edited {new Date(project.updatedAt).toLocaleDateString()}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </section>

                        {/* Categories - Vibing Circular Filters (Sticky) */}
                        <div ref={filterSentinelRef} className="h-px w-full mb-2 md:mb-4" />
                        <section
                            className="sticky top-2 md:top-6 z-30 mb-8 md:mb-20 flex justify-center pointer-events-none"
                        >
                            <div
                                className={`transition-all duration-500 ease-in-out pointer-events-auto flex items-center relative ${isFilterStuck
                                    ? 'bg-[var(--dashboard-bg)]/90 backdrop-blur-2xl shadow-xl py-0.5 md:py-1 px-2 md:px-8 border border-[var(--dashboard-border)] rounded-full w-fit max-w-[98%] md:max-w-[95%] ring-1 ring-white/5'
                                    : 'bg-transparent py-2 md:py-4 w-full border-none rounded-none justify-center'
                                    }`}
                            >
                                {/* Pinned Mobile Hamburger - Corrected Baseline to Match Circles */}
                                <div
                                    className={`lg:hidden shrink-0 flex items-center justify-center transition-all duration-500 overflow-hidden ${isFilterStuck ? 'w-10 opacity-100 mr-2 ml-1 grow-0' : 'w-0 opacity-0'
                                        }`}
                                >
                                    <button
                                        onClick={() => setIsSidebarOpen(true)}
                                        className="w-8 h-8 rounded-full flex items-center justify-center bg-[var(--dashboard-accent)]/10 border border-[var(--dashboard-accent)]/20 text-[var(--dashboard-accent)] shadow-sm transform transition-transform hover:scale-105"
                                    >
                                        <Menu size={16} />
                                    </button>
                                </div>

                                <div className={`relative max-w-full overflow-hidden rounded-full ${!isFilterStuck ? 'flex-1' : ''}`}>
                                    {/* Left Fade Indicator - More Subtle */}
                                    <div className={`absolute left-0 top-0 bottom-0 w-6 bg-gradient-to-r ${isFilterStuck ? 'from-[var(--dashboard-bg)]/80' : 'from-transparent'} to-transparent z-10 pointer-events-none transition-opacity duration-500 ${canScrollLeft ? 'opacity-100' : 'opacity-0'}`} />

                                    <div
                                        ref={categoriesScrollRef}
                                        onScroll={checkScroll}
                                        className={`flex items-center justify-start md:justify-center overflow-x-auto no-scrollbar scroll-smooth transition-all duration-500 ${isFilterStuck 
                                            ? 'py-1 md:py-1.5 px-4 gap-2 md:gap-6' 
                                            : 'py-2 md:py-4 px-2 gap-4 md:gap-8'
                                            }`}
                                    >
                                        {CATEGORIES.map(cat => (
                                            <CategoryCircle
                                                key={cat}
                                                label={cat}
                                                active={selectedCategory === cat}
                                                onClick={() => {
                                                    setSelectedCategory(cat)
                                                    // Scroll to top of templates section when category is changed
                                                    const element = document.getElementById('templates')
                                                    if (element && scrollContainerRef.current) {
                                                        element.scrollIntoView({ behavior: 'smooth' })
                                                    }
                                                }}
                                                isStuck={isFilterStuck}
                                            />
                                        ))}
                                    </div>

                                    {/* Right Fade Indicator - More Subtle */}
                                    <div className={`absolute right-0 top-0 bottom-0 w-6 bg-gradient-to-l ${isFilterStuck ? 'from-[var(--dashboard-bg)]/80' : 'from-transparent'} to-transparent z-10 pointer-events-none transition-opacity duration-500 ${canScrollRight ? 'opacity-100' : 'opacity-0'}`} />
                                </div>
                            </div>
                        </section>


                        {/* Templates Section */}
                        {templateProjects.length > 0 && (
                            <section id="templates" className="scroll-mt-24">
                                <div className="flex items-center justify-between mb-8">
                                    <h2 className="text-[20px] font-clean tracking-tight text-[var(--dashboard-text)]">Try a Template</h2>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-8">
                                    {templateProjects
                                        .filter(project => {
                                            if (selectedCategory === 'All') return true
                                            const projectCat = project.category || 'none'
                                            return projectCat === selectedCategory
                                        })
                                        .map((project) => (
                                            <div
                                                key={project._id}
                                                className="group cursor-pointer"
                                                onClick={() => handleDuplicateTemplate(project._id)}
                                            >
                                                <TemplateThumbnail project={project} />
                                                <div className="px-0.5">
                                                    <h3 className="text-[15px] font-semibold text-[var(--dashboard-text)] group-hover:text-[#7c4af0] transition-colors truncate">{project.name}</h3>
                                                    <p className="text-[11px] text-[var(--dashboard-text-muted)] mt-1 font-medium uppercase tracking-widest opacity-60">
                                                        {project.category && project.category !== 'none' ? project.category : 'Template'}
                                                    </p>
                                                </div>
                                            </div>
                                        ))}
                                </div>
                            </section>
                        )}

                        {/* Learn & Updates Section */}
                        <section id="learn" className="scroll-mt-24 mb-16 pt-16">
                            <div className="flex items-center justify-between mb-8">
                                <h2 className="text-[20px] font-clean tracking-tight flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-lg bg-[var(--dashboard-accent)]/10 flex items-center justify-center text-[var(--dashboard-accent)]">
                                        <Play size={18} fill="currentColor" />
                                    </div>
                                    Learn & Updates
                                </h2>
                            </div>

                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
                                {/* Videos Section */}
                                <div className="space-y-6">
                                    <div className="aspect-video bg-[var(--dashboard-card-bg)] border-2 border-[var(--dashboard-border)] rounded-[24px] overflow-hidden shadow-sm relative group">
                                        <video
                                            src="/first.mp4"
                                            className="w-full h-full object-cover"
                                            controls
                                            playsInline
                                        />
                                        <div className="absolute top-4 left-4 bg-black/50 backdrop-blur-md px-3 py-1 rounded-full text-[10px] font-bold text-white uppercase tracking-widest border border-white/10">
                                            Quick Start Guide
                                        </div>
                                    </div>
                                    <div className="px-2">
                                        <h3 className="text-[16px] font-bold text-[var(--dashboard-text)] mb-2">Mastering Vevara Motion</h3>
                                        <p className="text-[13px] text-[var(--dashboard-text-muted)] font-medium leading-relaxed opacity-80">
                                            Everything you need to know to create stunning motion designs in minutes. Watch our interactive guide to get started.
                                        </p>
                                    </div>
                                </div>

                                {/* Updates & Feedback Section */}
                                <div className="space-y-6" id="dev-message">
                                    {/* Collapsible Card - Developer Message */}
                                    <div className={`bg-[var(--dashboard-card-bg)] border border-[var(--dashboard-border)] rounded-[20px] overflow-hidden transition-all duration-300 ${isMessageCollapsed ? 'h-[64px]' : 'h-auto pb-6'}`}>
                                        <div
                                            className="flex items-center justify-between px-6 py-4 cursor-pointer hover:bg-[var(--dashboard-card-hover)] transition-colors"
                                            onClick={() => setIsMessageCollapsed(!isMessageCollapsed)}
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-full bg-[var(--dashboard-accent)]/10 flex items-center justify-center text-[var(--dashboard-accent)]">
                                                    <UserIcon size={16} />
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="text-[14px] font-bold tracking-tight">A Message from the Dev</span>
                                                    {isMessageCollapsed && <span className="text-[10px] text-[var(--dashboard-text-muted)] opacity-60 font-medium uppercase tracking-wider">Tap to read full message</span>}
                                                </div>
                                            </div>
                                            <ChevronDown size={18} className={`transition-transform duration-300 text-[var(--dashboard-text-muted)] ${isMessageCollapsed ? '' : 'rotate-180'}`} />
                                        </div>

                                        {!isMessageCollapsed && (
                                            <div className="px-6 space-y-6 animate-in fade-in duration-300">
                                                <div className="py-2 space-y-4">
                                                    <div className="p-4 bg-[var(--dashboard-bg)]/30 rounded-xl border border-[var(--dashboard-border)] border-dashed">
                                                        <p className="text-[14px] leading-relaxed text-[var(--dashboard-text)] font-medium">
                                                            👋 Hi there! <span className="text-[var(--dashboard-accent)] font-semibold">Vevara</span> is currently in Beta.
                                                            We are actively improving the editor every single day to bring you the best motion design experience.
                                                        </p>
                                                        <div className="mt-4 pt-4 border-t border-[var(--dashboard-border)] border-dashed">
                                                            <p className="text-[13px] text-[var(--dashboard-text-muted)] font-medium">
                                                                <span className="text-[var(--dashboard-accent)] font-semibold">Recommended:</span> For the best performance, especially when using Video Elements, we highly recommend using a PC.
                                                            </p>
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="space-y-4 pt-4 border-t border-[var(--dashboard-border)]">
                                                    <div className="flex flex-col gap-1">
                                                        <h4 className="text-[11px] font-bold text-[#7c4af0] uppercase tracking-wider">Request a Template</h4>
                                                        <p className="text-[12px] text-[var(--dashboard-text-muted)] font-medium">Have a specific idea or feature in mind? Tell us and we'll build it faster than you think!</p>
                                                    </div>

                                                    <form 
                                                        onSubmit={handleFeedbackSubmit}
                                                        className="relative group/input"
                                                    >
                                                        <div className="flex items-center bg-[var(--dashboard-bg)] border border-[var(--dashboard-border)] rounded-xl px-4 py-3 focus-within:border-[var(--dashboard-accent)] transition-all">
                                                            {feedbackStatus === 'success' ? (
                                                                <div className="flex items-center justify-center w-full py-1 text-[var(--dashboard-accent)] animate-in fade-in zoom-in duration-300">
                                                                    <span className="font-bold text-[13px]">Thank you for your feedback!</span>
                                                                </div>
                                                            ) : (
                                                                <>
                                                                    <input
                                                                        type="text"
                                                                        value={bottomFeedback}
                                                                        onChange={(e) => setBottomFeedback(e.target.value)}
                                                                        disabled={feedbackStatus === 'loading'}
                                                                        placeholder="Type your idea, request or a bug report..."
                                                                        className="w-full bg-transparent border-none outline-none text-[13px] font-medium text-[var(--dashboard-text)] placeholder:text-[var(--dashboard-text-muted)]/40"
                                                                    />
                                                                    <button 
                                                                        type="submit"
                                                                        disabled={!bottomFeedback.trim() || feedbackStatus === 'loading'}
                                                                        className="bg-[var(--dashboard-accent)] text-white px-5 py-2 rounded-lg font-bold text-[11px] hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                                                    >
                                                                        {feedbackStatus === 'loading' ? '...' : 'Submit'}
                                                                    </button>
                                                                </>
                                                            )}
                                                        </div>
                                                    </form>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </section>
                    </div>

                    {/* Footer */}
                    <footer className="mt-auto px-4 md:px-10 py-12 border-t border-[var(--dashboard-border)] flex flex-col md:flex-row items-center justify-between text-[var(--dashboard-text-muted)] text-[11px] font-semibold gap-4">
                        <div className="flex items-center gap-6">
                            <span>&copy; 2026 Vevara</span>
                            <a href="#" className="hover:text-[var(--dashboard-text)] transition-colors">Privacy Policy</a>
                            <a href="#" className="hover:text-[var(--dashboard-text)] transition-colors">Terms of Service</a>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]" />
                            <span>All Systems Operational</span>
                        </div>
                    </footer>
                </div>
            </div>

            {/* Modal Components */}
            <Modal isOpen={isDuplicating} onClose={() => { }} hideCloseButton={true} maxWidth="max-w-sm">
                <div className="flex flex-col items-center justify-center py-8 space-y-6">
                    <div className="w-10 h-10 border-4 border-[var(--dashboard-accent)]/10 border-t-[var(--dashboard-accent)] rounded-full animate-spin" />
                    <h3 className="text-[16px] font-semibold text-[var(--dashboard-text)] uppercase tracking-tight">Creating Design...</h3>
                </div>
            </Modal>

            <Modal 
                isOpen={!!projectToDelete} 
                onClose={() => !isDeleting && setProjectToDelete(null)} 
                title="Delete Project" 
                maxWidth="max-w-sm"
            >
                <div className="space-y-6">
                    <p className="text-[14px] text-[var(--dashboard-text-muted)] leading-relaxed font-medium">
                        Permanently delete this design? This cannot be undone.
                    </p>
                    <div className="flex gap-3">
                        <button 
                            disabled={isDeleting}
                            onClick={() => setProjectToDelete(null)} 
                            className="h-10 flex-1 bg-[var(--dashboard-card-bg)] text-[var(--dashboard-text)] rounded-lg text-[13px] font-semibold border border-[var(--dashboard-border)] disabled:opacity-50"
                        >
                            Cancel
                        </button>
                        <button 
                            disabled={isDeleting}
                            onClick={confirmDeleteProject} 
                            className="h-10 flex-1 bg-rose-500 text-white rounded-lg text-[13px] font-semibold flex items-center justify-center gap-2 disabled:opacity-50 hover:bg-rose-600 transition-colors"
                        >
                            {isDeleting ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    <span>Deleting...</span>
                                </>
                            ) : (
                                'Delete'
                            )}
                        </button>
                    </div>
                </div>
            </Modal>

            <ProjectStarterModal
                isOpen={isProjectStarterModalOpen}
                onClose={() => setIsProjectStarterModalOpen(false)}
                onSelectBlank={() => { setIsProjectStarterModalOpen(false); handleCreateProject(); }}
                onSelectTemplate={(templateId) => { setIsProjectStarterModalOpen(false); handleDuplicateTemplate(templateId); }}
                featuredTemplates={templateProjects.filter(p => (p.category || '').toLowerCase() === 'featured')}
            />
        </div>
    )
}

export default DashboardPage
