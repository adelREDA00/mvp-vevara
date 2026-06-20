import React, { useState, useEffect, useContext, useRef } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useNavigate, Link } from 'react-router-dom'
import api from '../../../api/client'
import { logoutUser, updateUserTheme, setLocalTheme } from '../../../store/slices/authSlice'
import {
    Plus, Folder, Layout, LogOut, Settings, User as UserIcon,
    ExternalLink, Trash2, ChevronDown, Layers, Loader2, X,
    Music, Presentation, Sparkles, Box, Wand2, Play, Share2,
    Search, Menu, Sun, Moon, Rocket, Video, ArrowRight, MoreHorizontal, Copy
} from 'lucide-react'
import { DropdownMenu, DropdownMenuItem } from '../../editor/components/DropdownMenu'
import Modal from '../../editor/components/Modal'
import { uid } from '../../../utils/ids'
import ProjectStarterModal from '../components/ProjectStarterModal'
import CreateFromScratchModal from '../components/CreateFromScratchModal'
import ProjectConfigModal from '../components/ProjectConfigModal'
import DashboardSidebar from '../components/DashboardSidebar'
import DashboardHero from '../components/DashboardHero'
import TemplateThumbnail from '../components/TemplateThumbnail'
import { ThemeContext } from '../../../app/context/ThemeContext'

const TUTORIAL_VIDEO_URL = "/first.mp4"

const CATEGORY_STYLES = {
    'All': { icon: Layers, color: '#475569' },
    'Ads & Marketing': { icon: Presentation, color: '#10b981' },
    'Product Demos': { icon: Play, color: '#f59e0b' },
    'Animated Elements': { icon: Wand2, color: '#64748b' },
}

const CategoryCircle = ({ label, active, onClick, isStuck }) => {
    const style = CATEGORY_STYLES[label] || { icon: Layout, color: '#475569' }
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
    const [toast, setToast] = useState(null)
    const [selectedProjectIds, setSelectedProjectIds] = useState([])
    const [isBulkDeleteConfirmOpen, setIsBulkDeleteConfirmOpen] = useState(false)
    const [isBulkDeleting, setIsBulkDeleting] = useState(false)
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
    const [isDeleting, setIsDeleting] = useState(false)
    const [bottomFeedback, setBottomFeedback] = useState('')
    const [feedbackStatus, setFeedbackStatus] = useState('idle') // idle, loading, success, error
    const [isCreateScratchModalOpen, setIsCreateScratchModalOpen] = useState(false)
    const [isProjectConfigModalOpen, setIsProjectConfigModalOpen] = useState(false)
    const [configModalMode, setConfigModalMode] = useState('app')

    const CATEGORIES = [
        'All',
        'Ads & Marketing',
        'Product Demos',
        'Animated Elements'
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
                        duration: 10.0,
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

    const HERO_TEMPLATE_MAPPINGS = {
        app: {
            "App Walkthrough": {
                "9:16": "6a159ee81ddc8874b8383c4b",
                "16:9": "6a15dd3d1ddc8874b8385a41"
            },
            "Launch Video": {
                "9:16": "6a171d561ddc8874b83889b6",
                "16:9": "6a1603431ddc8874b8385f6a"
            },
            "Feature Announcement": {
                "9:16": "6a159ee81ddc8874b8383c4b",
                "16:9": "6a15dd3d1ddc8874b8385a41"
            },

            "Promo": {
                "9:16": "6a173dfd1ddc8874b83893a2",
                "16:9": "6a172c0e1ddc8874b8388e1a"
            }
        },
        ads: {
            "Product showcase": {
                "9:16": "6a159ee81ddc8874b8383c4b",
                "16:9": "6a15dd3d1ddc8874b8385a41"
            },
            "Sale/promo announcement": {
                "9:16": "6a196bd51ddc8874b838e502",
                "16:9": "6a1967e71ddc8874b838e255"
            },
        }
    }

    const handleCreateFromConfig = async (category, platform) => {
        setIsProjectConfigModalOpen(false)
        const templateId = HERO_TEMPLATE_MAPPINGS[configModalMode]?.[category]?.[platform] ||
            (configModalMode === 'app' ? "6a0eb3c31ddc8874b8361a7f" : "6a0eb9d31ddc8874b8361bc6")
        await handleDuplicateTemplate(templateId)
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

    const handleCopyProject = async (project) => {
        try {
            const newProject = await api.post(`/projects/${project._id}/duplicate`)
            setProjects(prev => [newProject, ...prev])
            setToast({ message: `successfly copied "${project.name}"` })
            setTimeout(() => setToast(null), 3000)
        } catch (error) {
            console.error('Failed to copy project:', error)
            alert('Failed to copy project. Please try again.')
        }
    }

    const handleDeleteProject = (e, id) => {
        if (e && e.stopPropagation) {
            e.stopPropagation()
        }
        setProjectToDelete(id)
    }

    const toggleSelectProject = (e, id) => {
        if (e && e.stopPropagation) {
            e.stopPropagation()
        }
        setSelectedProjectIds(prev => 
            prev.includes(id) ? prev.filter(pId => pId !== id) : [...prev, id]
        )
    }

    const handleBulkDelete = async () => {
        try {
            setIsBulkDeleting(true)
            await Promise.all(selectedProjectIds.map(id => api.delete(`/projects/${id}`)))
            setProjects(prev => prev.filter(p => !selectedProjectIds.includes(p._id)))
            setToast({ message: `successfly deleted ${selectedProjectIds.length} projects` })
            setSelectedProjectIds([])
            setIsBulkDeleteConfirmOpen(false)
            setTimeout(() => setToast(null), 3000)
        } catch (error) {
            console.error('Failed to bulk delete projects:', error)
            alert('Failed to delete projects. Please try again.')
        } finally {
            setIsBulkDeleting(false)
        }
    }

    const isSelectionMode = selectedProjectIds.length > 0

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

    const isSubmitDisabled = !bottomFeedback.trim() || feedbackStatus === 'loading';

    const handleAddExample = (example) => {
        setBottomFeedback(prev => {
            const trimmed = prev.trim();
            if (!trimmed) return example;
            if (trimmed.endsWith(',')) return `${trimmed} ${example}`;
            return `${trimmed}, ${example}`;
        });
    };

    const currentSelectedExamples = bottomFeedback
        .split(',')
        .map(val => val.trim().toLowerCase());

    const availableExamples = [
        'App walkthrough',
        'Feature announcement',
        'Launch video',
        'Product promo',
        'Animated presentation',
        'Social media ad',
        'Landing page demo'
    ].filter(example => !currentSelectedExamples.includes(example.toLowerCase()));

    const sortedProjects = [...projects].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))

    return (
        <div className="min-h-screen bg-[var(--dashboard-sidebar-bg)] text-[var(--dashboard-text)] font-medium selection:bg-slate-500/10 flex overflow-x-hidden">
            {toast && (
                <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[10000] animate-in fade-in slide-in-from-top-4 duration-300">
                    <div className={`${isLight ? 'bg-white text-slate-800 border-slate-200 shadow-lg' : 'bg-slate-900 text-white border-slate-850 shadow-2xl'} border rounded-full px-6 py-2.5 flex items-center gap-2 text-[12px] font-semibold tracking-wide`}>
                        <Sparkles size={14} className="text-emerald-500 animate-pulse" />
                        <span>{toast.message}</span>
                    </div>
                </div>
            )}
            {/* Sidebar */}
            <DashboardSidebar
                isOpen={isSidebarOpen}
                onClose={() => setIsSidebarOpen(false)}
                onCreateProject={() => setIsCreateScratchModalOpen(true)}
            />

            {/* Content Wrapper (Scrollable) */}
            <div
                ref={scrollContainerRef}
                className="flex-1 lg:ml-[var(--sidebar-width)] h-screen overflow-y-auto transition-all custom-scrollbar pb-2 md:pb-3 pr-2 md:pr-3 pt-1 md:pt-2"
            >
                <div className="min-h-full bg-[var(--dashboard-bg)] rounded-[16px] md:rounded-[24px] border border-[var(--dashboard-border)] shadow-md dashboard-page-container flex flex-col relative">
                    {/* Updates Banner */}
                    <div className="w-full bg-slate-900 dark:bg-slate-950 py-2.5 px-4 md:px-10 border-b border-slate-800 dark:border-slate-900 flex items-center justify-center z-20 rounded-t-[15px] md:rounded-t-[23px] text-white">
                        <div className="text-[11px] font-extrabold text-center tracking-wider uppercase flex items-center gap-2 justify-center">
                            <span className="bg-emerald-500 text-black text-[9px] font-black px-1.5 py-0.5 rounded tracking-wide">Update</span>
                            <span className="opacity-90">new 2d tilt enging now live (2d persepcive titl is now imporved )</span>
                        </div>
                    </div>

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
                                                <div className="w-8 h-8 rounded-full bg-slate-600 flex items-center justify-center text-white font-bold text-[11px] shadow-md group-hover:scale-105 transition-transform">
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

                        {/* Create New Project Section */}
                        <section className="mb-16 relative">
                            <style>{`
                                @keyframes dashMove {
                                    to { stroke-dashoffset: -80; }
                                }
                                @keyframes pingDot {
                                    0%, 100% { opacity: 1; transform: scale(1); }
                                    50% { opacity: 0.4; transform: scale(1.6); }
                                }
                                .dash-anim {
                                    stroke-dasharray: 5 5;
                                    stroke-dashoffset: 0;
                                    animation: dashMove 4s linear infinite;
                                }
                                .group:hover .dash-anim { animation-duration: 1.8s; }
                                .dot-ping {
                                    animation: pingDot 2s ease-in-out infinite;
                                    transform-origin: center;
                                }
                            `}</style>

                            <div className="flex items-center justify-between mb-6">
                                <h2 className="text-[20px] font-clean tracking-tight text-[var(--dashboard-text)]">Create new project</h2>
                            </div>

                            {/* Max-width wrapper so cards stay compact on wide screens */}
                            <div className="w-full grid grid-cols-1 md:grid-cols-2 gap-6">
                                {/* Card 1: Product Launch Videos */}
                                <div
                                    onClick={() => {
                                        setConfigModalMode('app')
                                        setIsProjectConfigModalOpen(true)
                                    }}
                                    className="group relative overflow-hidden h-[110px] md:h-[136px] bg-gradient-to-r from-[#7c4af0] via-[#6a3fd4] to-[#5127be] rounded-[24px] border border-white/10 cursor-pointer shadow-lg hover:shadow-2xl hover:shadow-[#7c4af0]/25 hover:scale-[1.01] transition-all duration-500 ease-out flex items-center justify-between select-none"
                                >
                                    {/* Left text label */}
                                    <div className="pl-8 md:pl-12 flex flex-col justify-center h-full z-10 py-2">
                                        <h3 className="text-[17px] md:text-[22px] font-extrabold tracking-tight text-white leading-tight">
                                            App & Software Showcase
                                        </h3>
                                        <p className="text-[11px] md:text-[12px] text-white/80 font-semibold mt-0.5 max-w-[85%] truncate md:max-w-none">
                                            Walkthroughs, demos & feature reveals
                                        </p>
                                        <div className="py-1 px-3 bg-white text-black font-extrabold text-[10px] rounded-lg mt-2 flex items-center gap-1.5 hover:bg-white/95 transition-all w-fit shadow-md">
                                            <span>Start creating</span>
                                            <ArrowRight size={10} strokeWidth={2.5} />
                                        </div>
                                    </div>

                                    {/* Layered custom mockups */}
                                    <div className="absolute right-0 top-0 bottom-0 w-[45%] md:w-[40%] overflow-hidden pointer-events-none">
                                        {/* Back backing card shape */}
                                        <div className="absolute right-[10%] bottom-[-5%] w-[80%] h-[90%] bg-white/10 backdrop-blur-md rounded-xl transform rotate-[-12deg] z-0 transition-transform duration-500 group-hover:rotate-[-8deg]" />
                                        {/* Front mockup card image */}
                                        <div
                                            className="absolute right-[2%] bottom-[-10%] w-[80%] h-[100%] bg-cover bg-center rounded-xl border border-white/20 shadow-2xl transform rotate-[-4deg] z-10 transition-all duration-500 group-hover:scale-105 group-hover:rotate-[-2deg]"
                                            style={{ backgroundImage: "url('/sass.png')" }}
                                        />
                                    </div>
                                </div>

                                {/* Card 2: Product Promo Videos */}
                                <div
                                    onClick={() => {
                                        setConfigModalMode('ads')
                                        setIsProjectConfigModalOpen(true)
                                    }}
                                    className="group relative overflow-hidden h-[110px] md:h-[136px] bg-gradient-to-r from-[#00ab6b] via-[#05c46b] to-[#3bf681] rounded-[24px] border border-white/10 cursor-pointer shadow-lg hover:shadow-2xl hover:shadow-[#0bb85c]/30 hover:scale-[1.01] transition-all duration-500 ease-out flex items-center justify-between select-none"
                                >
                                    {/* Left text label */}
                                    <div className="pl-8 md:pl-12 flex flex-col justify-center h-full z-10 py-2">
                                        <h3 className="text-[17px] md:text-[22px] font-extrabold tracking-tight text-white leading-tight">
                                            Ads & Marketing
                                        </h3>
                                        <p className="text-[11px] md:text-[12px] text-white/80 font-semibold mt-0.5 max-w-[85%] truncate md:max-w-none">
                                            Promotions, ads & social content
                                        </p>
                                        <div className="py-1 px-3 bg-white text-black font-extrabold text-[10px] rounded-lg mt-2 flex items-center gap-1.5 hover:bg-white/95 transition-all w-fit shadow-md">
                                            <span>Start creating</span>
                                            <ArrowRight size={10} strokeWidth={2.5} />
                                        </div>
                                    </div>

                                    {/* Layered custom mockups */}
                                    <div className="absolute right-0 top-0 bottom-0 w-[45%] md:w-[40%] overflow-hidden pointer-events-none">
                                        {/* Back backing card shape */}
                                        <div className="absolute right-[12%] bottom-[-5%] w-[75%] h-[90%] bg-white/10 backdrop-blur-md rounded-xl transform rotate-[10deg] z-0 transition-transform duration-500 group-hover:rotate-[6deg]" />
                                        {/* Front phone mockup card image */}
                                        <div
                                            className="absolute right-[2%] bottom-[-15%] w-[80%] h-[115%] bg-cover bg-center rounded-t-xl border border-white/20 shadow-2xl transform rotate-[2deg] z-10 transition-all duration-500 group-hover:scale-105 group-hover:rotate-[0deg]"
                                            style={{ backgroundImage: "url('/ads.png')" }}
                                        />
                                    </div>
                                </div>
                            </div>
                        </section>

                        {/* Recent Projects Section */}
                        {(loading || projects.length > 0) && (
                            <section id="projects" className="scroll-mt-24 mb-16">
                                <div className="flex items-center justify-between mb-8">
                                    <h2 className="text-[20px] font-clean tracking-tight text-[var(--dashboard-text)]">Your projects</h2>
                                </div>

                                {loading ? (
                                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-6">
                                        {[1, 2, 3, 4, 5, 6].map(i => (
                                            <div key={i} className="aspect-[16/10] bg-[var(--dashboard-card-bg)] rounded-[12px] animate-pulse border border-[var(--dashboard-border)]" />
                                        ))}
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-6">
                                        {/* Add New Project Card - Always visible */}
                                        <div
                                            onClick={() => setIsCreateScratchModalOpen(true)}
                                            className="aspect-[16/10] w-full border-2 border-dashed border-[var(--dashboard-border)] rounded-xl flex flex-col items-center justify-center gap-3 cursor-pointer hover:border-slate-500/30 hover:bg-slate-550/5 transition-all group"
                                        >
                                            <div className="w-10 h-10 bg-slate-500/10 rounded-full flex items-center justify-center text-slate-600 dark:text-slate-400 group-hover:scale-110 transition-transform">
                                                <Plus size={20} strokeWidth={2} />
                                            </div>
                                            <p className="text-[var(--dashboard-text-muted)] font-medium text-[11px] text-center px-4">Create new</p>
                                        </div>

                                        {/* Project List */}
                                        {sortedProjects.map((project) => (
                                            <div
                                                key={project._id}
                                                className="group cursor-pointer"
                                                onClick={(e) => {
                                                    if (isSelectionMode) {
                                                        toggleSelectProject(e, project._id)
                                                    } else {
                                                        window.location.href = `/project/${project._id}`
                                                    }
                                                }}
                                            >
                                                <div className={`aspect-[16/10] bg-[var(--dashboard-card-bg)] border rounded-[12px] overflow-hidden relative mb-3 transition-all duration-300 shadow-sm ${
                                                    selectedProjectIds.includes(project._id)
                                                        ? 'border-purple-400 ring-2 ring-purple-400/25'
                                                        : 'border-[var(--dashboard-border)] group-hover:border-slate-500/40'
                                                }`}>
                                                    {project.thumbnail ? (
                                                        <img
                                                            src={project.thumbnail}
                                                            alt={`${project.name} thumbnail`}
                                                            className="w-full h-full object-cover"
                                                        />
                                                    ) : (
                                                        <div className="absolute inset-0 flex flex-col items-center justify-center text-[var(--dashboard-text-muted)] gap-3 opacity-20">
                                                            <Layers size={28} strokeWidth={1.5} />
                                                        </div>
                                                    )}

                                                    <button
                                                        onClick={(e) => toggleSelectProject(e, project._id)}
                                                        className={`absolute top-2 left-2 z-20 w-7 h-7 rounded-md flex items-center justify-center border transition-all duration-200 ${
                                                            selectedProjectIds.includes(project._id)
                                                                ? 'bg-purple-500 border-purple-500 text-white'
                                                                : `bg-black/40 backdrop-blur-md hover:bg-black/60 border-white/10 text-transparent ${
                                                                    isSelectionMode ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                                                                  }`
                                                        }`}
                                                    >
                                                        {selectedProjectIds.includes(project._id) && (
                                                            <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={4.5}>
                                                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                                            </svg>
                                                        )}
                                                    </button>

                                                    <div className="absolute top-2 right-2 z-10" onClick={(e) => e.stopPropagation()}>
                                                        <DropdownMenu
                                                            trigger={
                                                                <button className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-md hover:bg-black/60 text-white border border-white/10 rounded-md transition-all duration-200 shadow-sm outline-none">
                                                                    <MoreHorizontal size={14} />
                                                                </button>
                                                            }
                                                            className="bg-[var(--dashboard-card-bg)] border border-[var(--dashboard-border)] shadow-xl"
                                                        >
                                                            <DropdownMenuItem 
                                                                onClick={() => handleCopyProject(project)}
                                                                className="hover:bg-[var(--dashboard-card-hover)] cursor-pointer text-[var(--dashboard-text)]"
                                                            >
                                                                <div className="flex items-center gap-2">
                                                                    <Copy size={14} className="text-slate-400" />
                                                                    <span className="text-[13px] font-semibold">Make a Copy</span>
                                                                </div>
                                                            </DropdownMenuItem>
                                                            <DropdownMenuItem 
                                                                onClick={() => setProjectToDelete(project._id)}
                                                                className="hover:bg-rose-500/10 cursor-pointer text-rose-500"
                                                            >
                                                                <div className="flex items-center gap-2">
                                                                    <Trash2 size={14} />
                                                                    <span className="text-[13px] font-semibold">Delete</span>
                                                                </div>
                                                            </DropdownMenuItem>
                                                        </DropdownMenu>
                                                    </div>
                                                </div>
                                                <div className="px-0.5">
                                                    <h3 className="text-[13px] font-semibold text-[var(--dashboard-text)] group-hover:text-slate-700 dark:group-hover:text-slate-350 transition-colors truncate">{project.name}</h3>
                                                    <p className="text-[10px] text-[var(--dashboard-text-muted)] mt-0.5 font-medium uppercase tracking-tight opacity-70">Edited {new Date(project.updatedAt).toLocaleDateString()}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </section>
                        )}

                        {/* Categories - Vibing Circular Filters (Sticky) - Commented out for now
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
                                                    const element = document.getElementById('templates')
                                                    if (element && scrollContainerRef.current) {
                                                        element.scrollIntoView({ behavior: 'smooth' })
                                                    }
                                                }}
                                                isStuck={isFilterStuck}
                                            />
                                        ))}
                                    </div>

                                    <div className={`absolute right-0 top-0 bottom-0 w-6 bg-gradient-to-l ${isFilterStuck ? 'from-[var(--dashboard-bg)]/80' : 'from-transparent'} to-transparent z-10 pointer-events-none transition-opacity duration-500 ${canScrollRight ? 'opacity-100' : 'opacity-0'}`} />
                                </div>
                            </div>
                        </section>
                        */}

                        {/* Templates Section - Commented out for now
                        {templateProjects.length > 0 && (
                            <section id="templates" className="scroll-mt-24 mb-24">
                                <div className="flex items-center justify-between mb-8">
                                    <h2 className="text-[20px] font-clean tracking-tight text-[var(--dashboard-text)]">Try a Template</h2>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-8">
                                    {templateProjects
                                        .filter(project => {
                                            const projectCat = project.category || ''
                                            return projectCat.trim() !== '' &&
                                                projectCat.toLowerCase() !== 'none' &&
                                                projectCat.toLowerCase() !== 'undefined'
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
                        */}


                        {/* Editor Updates Section */}
                        <section id="roadmap" className="scroll-mt-24 mb-16 pt-16 border-t border-[var(--dashboard-border)]">
                            <div className="w-full max-w-2xl">
                                <h2 className="text-[18px] font-bold tracking-tight text-[var(--dashboard-text)] mb-8">Editor Updates</h2>
                                
                                <div className="relative pl-6 border-l-2 border-[var(--dashboard-border)] ml-3 space-y-6 py-2">
                                    {[
                                        { label: "Transition between pages", done: true },
                                        { label: "Preset animation for text & elements", done: true },
                                        { label: "Templates system", done: false },
                                        { label: "Drag & drop ready motion videos for app walkthrough and launches", done: false },
                                        { label: "Color gradient support", done: false },
                                        { label: "Audio support", done: false },
                                        { label: "Device mockups", done: false },
                                        { label: "Presentation mode", done: false }
                                    ].map((item, idx) => (
                                        <div key={idx} className="relative flex items-start gap-3.5">
                                            {/* Dot on line */}
                                            <div className={`absolute -left-[31px] top-1.5 w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center ${
                                                item.done 
                                                    ? 'bg-emerald-500 border-[var(--dashboard-bg)] text-white shadow-[0_0_8px_rgba(16,185,129,0.3)]' 
                                                    : 'bg-zinc-700 border-[var(--dashboard-bg)] text-zinc-400 dark:bg-zinc-800'
                                            }`}>
                                                {item.done && (
                                                    <svg className="w-1.5 h-1.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={5}>
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                                    </svg>
                                                )}
                                            </div>
                                            <div className="flex flex-col">
                                                <p className={`text-[13px] font-semibold leading-tight ${item.done ? 'text-[var(--dashboard-text)]' : 'text-[var(--dashboard-text-muted)] opacity-70'}`}>
                                                    {item.label}
                                                </p>
                                                <span className={`text-[9px] font-extrabold uppercase tracking-wider mt-0.5 ${item.done ? 'text-emerald-500' : 'text-slate-500'}`}>
                                                    {item.done ? 'Released' : 'Coming soon'}
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </section>

                        {/* AI Video Idea Generation Section */}
                        <section id="ai-idea-generator" className="scroll-mt-24 mb-16 pt-16 border-t border-[var(--dashboard-border)]">
                            <div className="w-full">
                                <div className="bg-[var(--dashboard-card-bg)] border border-[var(--dashboard-border)] rounded-[20px] p-6 space-y-5">
                                    <div className="flex flex-col gap-1">
                                        <h3 className="text-[14px] font-bold text-[var(--dashboard-text)]">
                                            What would you like to see on the editor?
                                        </h3>
                                        <p className="text-[12px] text-[var(--dashboard-text-muted)] font-medium">
                                            Get custom templates for your business, just describe what you want
                                        </p>
                                    </div>

                                    <form
                                        onSubmit={handleFeedbackSubmit}
                                        className="relative group/input space-y-4"
                                    >
                                        <div className="flex items-center bg-[var(--dashboard-bg)] border border-[var(--dashboard-border)] rounded-xl px-4 py-3 focus-within:border-slate-500 transition-all">
                                            {feedbackStatus === 'success' ? (
                                                <div className="flex items-center justify-center w-full py-1 text-slate-600 dark:text-slate-400 animate-in fade-in zoom-in duration-300">
                                                    <span className="font-bold text-[13px]">Got it 🙌 This will be available in the next update</span>
                                                </div>
                                            ) : (
                                                <>
                                                    <input
                                                        type="text"
                                                        value={bottomFeedback}
                                                        onChange={(e) => setBottomFeedback(e.target.value)}
                                                        disabled={feedbackStatus === 'loading'}
                                                        placeholder="I would like you to add gradient color option"
                                                        className="w-full bg-transparent border-none outline-none text-[13px] font-medium text-[var(--dashboard-text)] placeholder:text-[var(--dashboard-text-muted)]/40"
                                                    />
                                                    <button
                                                        type="submit"
                                                        disabled={isSubmitDisabled}
                                                        className="bg-slate-700 dark:bg-slate-600 text-white px-5 py-2 rounded-lg font-bold text-[11px] hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                                    >
                                                        {feedbackStatus === 'loading' ? '...' : 'Submit'}
                                                    </button>
                                                </>
                                            )}
                                        </div>

                                        {feedbackStatus !== 'success' && availableExamples.length > 0 && (
                                            <div className="flex flex-col gap-2 pt-1">
                                                <p className="text-[10px] text-[var(--dashboard-text-muted)]/50 font-bold uppercase tracking-wider">
                                                    Popular ideas:
                                                </p>
                                                <div className="flex flex-wrap gap-2">
                                                    {availableExamples.map((example) => (
                                                        <button
                                                            key={example}
                                                            type="button"
                                                            onClick={() => handleAddExample(example)}
                                                            className={`px-3 py-1.5 text-[11px] font-semibold rounded-full border transition-all duration-200 hover:-translate-y-0.5 active:scale-95 cursor-pointer ${isLight
                                                                ? 'bg-gray-100 hover:bg-gray-200/80 border-gray-200 text-gray-700 shadow-sm'
                                                                : 'bg-white/5 hover:bg-white/10 border-white/10 text-gray-300 shadow-md'
                                                                }`}
                                                        >
                                                            {example}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </form>
                                </div>
                            </div>
                        </section>

                        {/* High Usage System Notice - Styled to be very soft, compact, and completely neutral */}
                        <div className="mt-8 p-3 rounded-xl border border-[var(--dashboard-border)] bg-[var(--dashboard-card-bg)]/40 flex items-center justify-center gap-2.5 text-[var(--dashboard-text-muted)] max-w-3xl mx-auto opacity-75 hover:opacity-100 transition-opacity">
                            <svg className="w-4 h-4 shrink-0 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <p className="text-[11px] font-medium leading-normal text-center">
                                <span className="font-bold text-[var(--dashboard-text)] opacity-90">System Update:</span> Due to high demand, asset uploads may take slightly longer. We are upgrading our servers and exiting beta soon. Please use PC for the best experience.
                            </p>
                        </div>
                    </div>

                    {/* Footer */}
                    <footer className="mt-auto px-4 md:px-10 py-12 border-t border-[var(--dashboard-border)] flex flex-col md:flex-row items-center justify-between text-[var(--dashboard-text-muted)] text-[11px] font-semibold gap-4">
                        <div className="flex items-center gap-6">
                            <span>© {new Date().getFullYear()} Vevara Motion</span>
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
                    <div className="w-10 h-10 border-4 border-slate-500/10 border-t-slate-500 rounded-full animate-spin" />
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

            <CreateFromScratchModal
                isOpen={isCreateScratchModalOpen}
                onClose={() => setIsCreateScratchModalOpen(false)}
                onConfirm={() => {
                    setIsCreateScratchModalOpen(false);
                    handleCreateProject();
                }}
            />

            <ProjectConfigModal
                isOpen={isProjectConfigModalOpen}
                onClose={() => setIsProjectConfigModalOpen(false)}
                mode={configModalMode}
                onCreate={handleCreateFromConfig}
            />

            <div className={`fixed left-1/2 -translate-x-1/2 z-[999] transition-all duration-500 ease-out w-max max-w-[95vw] ${
                                                isSelectionMode 
                                                    ? 'bottom-16 opacity-100 scale-100' 
                                                    : 'bottom-0 opacity-0 scale-95 pointer-events-none'
                                            }`}>
                                                <div className={`flex items-center gap-3 md:gap-6 px-4 md:px-6 py-3 rounded-full border shadow-2xl whitespace-nowrap ${
                                                    isLight 
                                                        ? 'bg-white border-slate-200 text-slate-800' 
                                                        : 'bg-slate-900 border-slate-800 text-white'
                                                }`}>
                                                    <button
                                                        onClick={() => setSelectedProjectIds([])}
                                                        className={`w-7 h-7 flex items-center justify-center rounded-full transition-all shrink-0 ${
                                                            isLight ? 'hover:bg-slate-100 text-slate-500' : 'hover:bg-white/5 text-slate-400'
                                                        }`}
                                                    >
                                                        <X size={15} />
                                                    </button>
                                                    <span className="text-[13px] font-semibold tracking-wide shrink-0">
                                                        {selectedProjectIds.length} selected
                                                    </span>
                                                    <div className={`w-px h-5 shrink-0 ${isLight ? 'bg-slate-200' : 'bg-slate-800'}`} />
                                                    <button
                                                        onClick={() => setIsBulkDeleteConfirmOpen(true)}
                                                        className="flex items-center gap-1.5 bg-rose-500 hover:bg-rose-600 text-white text-[12px] md:text-[13px] font-semibold px-4 md:px-5 py-2 rounded-full shadow-md transition-all shrink-0 animate-pulse"
                                                    >
                                                        <Trash2 size={13} />
                                                        <span>Delete</span>
                                                    </button>
                                                </div>
                                            </div>

            <Modal
                isOpen={isBulkDeleteConfirmOpen}
                onClose={() => !isBulkDeleting && setIsBulkDeleteConfirmOpen(false)}
                title="Delete Projects"
                maxWidth="max-w-sm"
            >
                <div className="space-y-6">
                    <p className="text-[14px] text-[var(--dashboard-text-muted)] leading-relaxed font-medium">
                        Permanently delete these {selectedProjectIds.length} designs? This cannot be undone.
                    </p>
                    <div className="flex gap-3">
                        <button
                            disabled={isBulkDeleting}
                            onClick={() => setIsBulkDeleteConfirmOpen(false)}
                            className="h-10 flex-1 bg-[var(--dashboard-card-bg)] text-[var(--dashboard-text)] rounded-lg text-[13px] font-semibold border border-[var(--dashboard-border)] disabled:opacity-50"
                        >
                            Cancel
                        </button>
                        <button
                            disabled={isBulkDeleting}
                            onClick={handleBulkDelete}
                            className="h-10 flex-1 bg-rose-500 text-white rounded-lg text-[13px] font-semibold flex items-center justify-center gap-2 disabled:opacity-50 hover:bg-rose-600 transition-colors"
                        >
                            {isBulkDeleting ? (
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
        </div>
    )
}

export default DashboardPage
