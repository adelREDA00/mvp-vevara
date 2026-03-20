import React, { useState, useEffect } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useNavigate, Link } from 'react-router-dom'
import api from '../../../api/client'
import { logoutUser } from '../../../store/slices/authSlice'
import { Plus, Folder, Layout, LogOut, Settings, User as UserIcon, ExternalLink, Trash2, ChevronDown, Layers, Loader2, X, Music, Presentation, Sparkles, Box, Wand2 } from 'lucide-react'
import { DropdownMenu, DropdownMenuItem } from '../../editor/components/DropdownMenu'
import Modal from '../../editor/components/Modal'
import { uid } from '../../../utils/ids'

const TUTORIAL_VIDEO_URL = "/first.mp4"

const TemplateThumbnail = ({ project }) => {
    const videoRef = React.useRef(null)
    const [isVisible, setIsVisible] = useState(false)
    const [isLoaded, setIsLoaded] = useState(false)

    useEffect(() => {
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

    useEffect(() => {
        if (!videoRef.current) return

        if (isVisible) {
            videoRef.current.play().catch(e => {
                // Autoplay might be blocked or file not found
                console.log('Autoplay blocked or video missing:', e)
            })
        } else {
            videoRef.current.pause()
        }
    }, [isVisible])

    return (
        <div className="aspect-video bg-[#f5f5f5] border border-white/5 rounded-[16px] overflow-hidden relative mb-4 group-hover:border-[#6940c9]/40 transition-all duration-300 shadow-sm">
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

            {/* Fallback Image / Static Thumbnail */}
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
                            <span className="text-[12px] font-semibold uppercase tracking-widest opacity-50">Preview</span>
                        </div>
                    )}
                </div>
            )}

            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-[#6940c9]/5 backdrop-blur-sm duration-300">
                <button className="h-9 px-5 bg-white text-black text-[12px] font-semibold rounded-[10px] shadow-sm transform translate-y-2 group-hover:translate-y-0 transition-all duration-300">DUPLICATE & EDIT</button>
            </div>
        </div>
    )
}

const DashboardPage = () => {
    const dispatch = useDispatch()
    const navigate = useNavigate()
    const { user, isAuthenticated, status } = useSelector((state) => state.auth)
    const [projects, setProjects] = useState([])
    const [templateProjects, setTemplateProjects] = useState([])
    const [loading, setLoading] = useState(true)
    const [scrolled, setScrolled] = useState(false)
    const [projectToDelete, setProjectToDelete] = useState(null)
    const [feedbackText, setFeedbackText] = useState('')
    const [feedbackStatus, setFeedbackStatus] = useState('idle') // idle, sending, success, error
    const [showBetaMessage, setShowBetaMessage] = useState(() => {
        return localStorage.getItem('vevara_hide_beta_message') !== 'true'
    })
    const [selectedCategory, setSelectedCategory] = useState('All')

    const CATEGORIES = [
        'All',
        'Logo',
        'Ads',
        'Social',
        "Website",
        'YouTube & Podcast Intros/Outros'
    ]

    const toggleBetaMessage = () => {
        const newState = !showBetaMessage
        setShowBetaMessage(newState)
        if (!newState) {
            localStorage.setItem('vevara_hide_beta_message', 'true')
        } else {
            localStorage.removeItem('vevara_hide_beta_message')
        }
    }

    const handleSendFeedback = async () => {
        if (!feedbackText.trim() || feedbackStatus === 'sending') return

        try {
            setFeedbackStatus('sending')
            await api.post('/api/feedback', { text: feedbackText })
            setFeedbackStatus('success')
            setFeedbackText('')
            setTimeout(() => setFeedbackStatus('idle'), 3000)
        } catch (error) {
            console.error('Failed to send feedback:', error)
            setFeedbackStatus('error')
            setTimeout(() => setFeedbackStatus('idle'), 3000)
        }
    }

    useEffect(() => {
        const handleScroll = () => {
            setScrolled(window.scrollY > 20)
        }
        window.addEventListener('scroll', handleScroll)
        return () => window.removeEventListener('scroll', handleScroll)
    }, [])

    useEffect(() => {
        // Only redirect if we are sure the user is not authenticated
        // Wait for status to NOT be loading or idle (which means checkAuth hasn't finished)
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
                console.log('[Dashboard] Projects loaded:', data.length)
                if (data.length > 0) {
                    console.log('[Dashboard] Sample project thumbnail present:', !!data[0].thumbnail)
                    if (data[0].thumbnail) {
                        console.log('[Dashboard] Thumbnail length:', data[0].thumbnail.length)
                    }
                }
                setProjects(data)
                setTemplateProjects(templateData)
            } catch (error) {
                console.error('Failed to fetch projects:', error)
            } finally {
                // Wait a bit for premium feel
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

    const handleTutorialClick = async () => {
        await dispatch(logoutUser())
        window.location.href = '/'
    }


    const handleCreateProject = async () => {
        try {
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
            // [FIX] Force full page reload when entering the editor.
            // PIXI.js has global GPU state (batch geometry, buffer systems) that
            // can't be cleaned up within a SPA navigation. A full page load
            // guarantees a fresh WebGL context — same approach Canva uses.
            window.location.href = `/project/${newProject._id}`
        } catch (error) {
            console.error('Failed to create project:', error)
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
        if (!projectToDelete) return
        try {
            await api.delete(`/projects/${projectToDelete}`)
            setProjects(projects.filter(p => p._id !== projectToDelete))
        } catch (error) {
            console.error('Failed to delete project:', error)
        } finally {
            setProjectToDelete(null)
        }
    }


    return (
        <div className="min-h-[100dvh] bg-[#0f1015] text-white font-extralight selection:bg-[#6940c9]/30 overflow-x-hidden">
            {/* Top Navigation Bar (Reactive) */}
            <header
                className={`fixed top-0 left-0 right-0 h-[var(--header-height)] flex items-center justify-between px-6 md:px-8 z-50 transition-all duration-200 ease-in-out ${scrolled
                    ? 'bg-[#0f1015]/80 backdrop-blur-2xl border-b border-white/5 shadow-sm'
                    : 'bg-transparent'
                    }`}
            >
                <div className="flex items-center gap-8">
                    <a href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
                        <span className="font-semibold text-[16px] tracking-tight">vevara</span>
                    </a>
                </div>
                <div className="flex items-center gap-4">
                    <a
                        href="#learn-vevara"
                        className="hidden sm:flex items-center gap-2 px-3 h-8 rounded-full bg-white/5 border border-white/10 text-white/50 text-[12px] font-medium uppercase tracking-wider hover:bg-white/10 hover:text-white transition-all duration-200"
                    >
                        Learn Vevara in 40s
                    </a>
                    {isAuthenticated && (
                        <DropdownMenu
                            trigger={
                                <button className="flex items-center gap-2 group outline-none">
                                    <div className="w-8 h-8 rounded-full bg-[#1a1b23] hover:bg-[#25262e] border border-white/10 flex items-center justify-center transition-all duration-200 overflow-hidden shadow-sm">
                                        {user?.email ? (
                                            <span className="text-white text-[12px] font-semibold uppercase">
                                                {user.email.substring(0, 2)}
                                            </span>
                                        ) : (
                                            <UserIcon size={16} strokeWidth={2} className="text-white/40" />
                                        )}
                                    </div>
                                    <ChevronDown size={14} strokeWidth={2} className="text-white/20 group-hover:text-white/40 transition-colors" />
                                </button>
                            }
                        >
                            <div className="px-4 py-3 border-b border-white/5 mb-1">
                                <p className="text-[12px] font-medium text-white/50 truncate">{user?.email}</p>
                            </div>
                            <DropdownMenuItem onClick={handleLogout}>
                                <div className="flex items-center gap-3 text-rose-400">
                                    <LogOut size={16} strokeWidth={2} />
                                    <span className="text-[14px] font-medium">Logout</span>
                                </div>
                            </DropdownMenuItem>
                        </DropdownMenu>
                    )}
                </div>
            </header>

            {/* Main Content (Now Full Width & Scrollable) */}
            <main className="w-full min-h-screen">
                {/* Hero Section */}
                <section className="pt-32 pb-16 px-6 md:px-8 bg-gradient-to-b from-[#6940c9]/5 to-transparent">
                    <div className="max-w-[1200px] mx-auto text-center">
                        <h1 className="text-3xl md:text-5xl font-medium tracking-tight leading-tight mb-16">
                            control <span className="text-[#6940c9] italic font-semibold"> motion</span> step by step.
                        </h1>

                        <div className="max-w-xl mx-auto space-y-8">
                            {showBetaMessage && (
                                <div className="relative bg-white/[0.03] backdrop-blur-xl border border-white/10 rounded-[20px] p-8 text-left animate-in fade-in slide-in-from-top-4 duration-200">
                                    <button
                                        onClick={toggleBetaMessage}
                                        className="absolute top-4 right-4 p-1.5 rounded-full hover:bg-white/5 text-white/20 hover:text-white transition-all duration-200"
                                    >
                                        <X size={16} strokeWidth={2} />
                                    </button>

                                    <div className="space-y-6">
                                        <div className="flex items-center gap-2">
                                            <span className="text-[12px] font-semibold uppercase tracking-widest text-[#6940c9] bg-[#6940c9]/10 px-2.5 py-1 rounded-[6px]">Rédaction</span>
                                        </div>

                                        <div className="space-y-4 text-white/70 text-[14px] leading-relaxed font-normal">
                                            <p>Thanks for being one of the first + 200 creators exploring Vevara.</p>
                                            <p>This is an early beta to test a new approach to motion design, so you may encounter bugs in places. I’ll continue improving the app based on your feedback.</p>
                                            <p className="text-rose-500 font-medium">For now, Vevara works best on desktop, mobile support is still unstable.</p>
                                            <div className="pt-4">
                                                <a href="#learn-vevara" className="inline-flex items-center gap-2 text-[#6940c9] hover:text-[#7b52da] font-semibold transition-colors duration-200">
                                                    Learn Vevara in 40 seconds <ExternalLink size={14} strokeWidth={2.5} />
                                                </a>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Feedback Input Section */}
                            <div className="bg-white/[0.02] backdrop-blur-md border border-white/5 rounded-[20px] p-4 sm:p-6 flex flex-col items-start gap-4 shadow-sm">
                                <div className="w-full flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <h3 className="text-[12px] font-semibold uppercase tracking-widest text-white/30">Share your thoughts</h3>
                                        {!showBetaMessage && (
                                            <button
                                                onClick={toggleBetaMessage}
                                                className="text-[12px] text-[#6940c9] hover:text-[#7b52da] font-semibold transition-all duration-200 ml-1 underline underline-offset-4 decoration-[#6940c9]/30 hover:decoration-[#6940c9]"
                                            >
                                                Show update message
                                            </button>
                                        )}
                                    </div>
                                    {feedbackStatus === 'success' && (
                                        <span className="text-[12px] text-emerald-500 font-medium">Feedback sent!</span>
                                    )}
                                </div>
                                <div className="w-full flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                                    <input
                                        type="text"
                                        value={feedbackText}
                                        onChange={(e) => setFeedbackText(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && handleSendFeedback()}
                                        placeholder="What's missing or broken?"
                                        className="h-11 flex-1 bg-white/[0.03] border border-white/5 rounded-[12px] px-4 text-[14px] text-white placeholder:text-white/20 outline-none focus:border-[#6940c9]/40 transition-all duration-200 font-normal w-full"
                                    />
                                    <button
                                        onClick={handleSendFeedback}
                                        disabled={!feedbackText.trim() || feedbackStatus === 'sending'}
                                        className="h-11 px-6 bg-[#6940c9] hover:bg-[#7b52da] disabled:opacity-50 disabled:cursor-not-allowed rounded-[12px] text-[14px] font-semibold transition-all duration-200 flex items-center justify-center gap-2 shadow-sm w-full sm:w-auto"
                                    >
                                        {feedbackStatus === 'sending' ? <Loader2 size={16} strokeWidth={2} className="animate-spin" /> : 'Send'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                <div className="max-w-[1200px] mx-auto px-6 md:px-8 pb-32 space-y-24">
                    {/* Projects Section (Optimized Grid) */}
                    <section id="projects">
                        <div className="flex items-center justify-between mb-8 border-b border-white/5 pb-6">
                            <h2 className="text-2xl font-semibold tracking-tight">Your <span className="font-normal italic">Projects</span></h2>
                            <button
                                onClick={handleCreateProject}
                                className="h-10 px-6 bg-[#6940c9] text-white rounded-[12px] text-[14px] font-semibold hover:bg-[#7c4af0] transition-all duration-200 flex items-center gap-2 shadow-sm"
                            >
                                <Plus size={18} strokeWidth={2.5} />
                                New Project
                            </button>
                        </div>

                        {loading ? (
                            <div className="flex items-center justify-center py-24">
                                <div className="w-6 h-6 border-[1.5px] border-[#6940c9]/20 border-t-[#6940c9] rounded-full animate-spin"></div>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
                                {/* 10 Second Tutorial Special Card */}
                                <div
                                    className="group cursor-pointer"
                                    onClick={handleTutorialClick}
                                >
                                    <div className="aspect-video bg-[#1a1b23] border border-[#6940c9]/30 rounded-[16px] overflow-hidden relative mb-4 group-hover:border-[#6940c9] transition-all duration-300 flex flex-col items-center justify-center p-6 text-center bg-[radial-gradient(circle_at_center,_rgba(105,64,201,0.15)_0%,_transparent_70%)] shadow-sm">
                                        {/* Aesthetic Background Image */}
                                        <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-80 group-hover:opacity-100 transition-opacity duration-700 flex items-center justify-center p-4">
                                            <img
                                                src="/img2.png"
                                                alt="Tutorial Preview"
                                                className="h-[120%] w-auto object-contain scale-[0.7] rotate-[8deg] group-hover:rotate-[4deg] group-hover:scale-[0.75] transition-all duration-1000 drop-shadow-2xl"
                                            />
                                            <div className="absolute inset-0 bg-gradient-to-t from-[#0f1015]/60 via-transparent to-transparent"></div>
                                        </div>

                                        <div className="absolute inset-0 opacity-10 group-hover:opacity-20 transition-opacity bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')]"></div>

                                        <div className="relative z-10 space-y-2 group-hover:opacity-0 transition-opacity duration-300">
                                            <div className="w-10 h-10 bg-[#6940c9]/20 rounded-full flex items-center justify-center mx-auto mb-2 border border-[#6940c9]/30 group-hover:scale-110 transition-transform duration-500">
                                                <Wand2 size={20} className="text-[#6940c9]" />
                                            </div>
                                            <h3 className="text-[16px] font-semibold text-white tracking-tight group-hover:text-[#7c4af0] transition-colors">10 second tutorial</h3>
                                            <p className="text-[10px] text-white/40 font-semibold uppercase tracking-[0.2em] leading-tight">create your first iphone ad</p>
                                        </div>

                                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-[#0f1015]/60 backdrop-blur-[4px] z-20">
                                            <div className="h-9 px-5 bg-white text-black text-[12px] font-bold rounded-full flex items-center gap-2 transform translate-y-4 group-hover:translate-y-0 transition-all duration-300 shadow-sm">
                                                START GUIDE <Sparkles size={14} className="text-[#6940c9]" />
                                            </div>
                                        </div>

                                        <div className="absolute top-3 left-3 bg-[#6940c9] rounded-[4px] px-1.5 py-0.5 text-[10px] font-bold text-white tracking-widest uppercase shadow-sm">
                                            SPECIAL
                                        </div>
                                    </div>
                                    <div className="flex flex-col">
                                        <h3 className="text-[14px] font-medium text-white group-hover:text-[#6940c9] transition-colors">10 second tutorial</h3>
                                        <p className="text-[12px] text-white/40 mt-1 font-normal italic">Start your journey here</p>
                                    </div>
                                </div>

                                {projects.map((project) => (
                                    <div
                                        key={project._id}
                                        className="group cursor-pointer"
                                        onClick={() => window.location.href = `/project/${project._id}`}
                                    >
                                        <div className="aspect-video bg-[#f5f5f5] border border-white/5 rounded-[16px] overflow-hidden relative mb-4 group-hover:border-[#6940c9]/40 transition-all duration-300 shadow-sm">
                                            {project.thumbnail ? (
                                                <img
                                                    src={project.thumbnail}
                                                    alt={`${project.name} thumbnail`}
                                                    className="w-full h-full object-contain"
                                                />
                                            ) : (
                                                <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-600 gap-3">
                                                    <Layers size={32} strokeWidth={1.5} className="opacity-50" />
                                                    <span className="text-[12px] font-semibold uppercase tracking-widest opacity-50">Empty Canvas</span>
                                                </div>
                                            )}

                                            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-[#6940c9]/5 backdrop-blur-sm duration-300">
                                                <button className="h-9 px-5 bg-white text-black text-[12px] font-semibold rounded-[10px] shadow-sm transform translate-y-2 group-hover:translate-y-0 transition-all duration-300">EDIT PROJECT</button>
                                            </div>
                                            <div className="absolute top-3 left-3 bg-black/60 border border-white/10 rounded-[4px] px-1.5 py-0.5 text-[10px] font-semibold text-white/40 tracking-widest">
                                                PRIVATE
                                            </div>
                                            <button
                                                onClick={(e) => handleDeleteProject(e, project._id)}
                                                className="absolute top-3 right-3 p-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-500/40 hover:text-rose-500 rounded-[8px] opacity-0 group-hover:opacity-100 transition-all duration-200 z-10"
                                            >
                                                <Trash2 size={16} strokeWidth={2} />
                                            </button>
                                        </div>
                                        <div className="flex items-start justify-between gap-4 px-1">
                                            <div className="min-w-0">
                                                <h3 className="text-[14px] font-medium text-white/80 group-hover:text-white transition-colors truncate">{project.name}</h3>
                                                <p className="text-[12px] text-white/20 mt-1 uppercase tracking-tight">Motion • Edited {new Date(project.updatedAt).toLocaleDateString()}</p>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                                <button
                                    onClick={handleCreateProject}
                                    className="aspect-video bg-[#0f1015] border border-dashed border-white/10 rounded-[16px] flex flex-col items-center justify-center gap-3 group hover:border-[#6940c9]/30 transition-all duration-300"
                                >
                                    <div className="w-10 h-10 bg-white/5 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                                        <Plus size={24} strokeWidth={2} className="text-white/30" />
                                    </div>
                                    <span className="text-[12px] font-semibold text-white/20 group-hover:text-white/40 uppercase tracking-widest">Create New</span>
                                </button>
                            </div>
                        )}
                    </section>

                    {/* Templates Section */}
                    {templateProjects.length > 0 && (
                        <section id="templates">
                            <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 border-b border-white/5 pb-6 gap-6">
                                <h2 className="text-2xl font-semibold tracking-tight shrink-0">Templates</h2>

                                {/* Category Filters */}
                                <div className="w-full md:w-auto flex items-center gap-2 overflow-x-auto no-scrollbar py-2 -mx-2 px-2">
                                    {CATEGORIES.map(cat => (
                                        <button
                                            key={cat}
                                            onClick={() => setSelectedCategory(cat)}
                                            className={`h-8 px-4 rounded-full text-[12px] font-semibold uppercase tracking-wider transition-all duration-200 whitespace-nowrap border ${selectedCategory === cat
                                                ? 'bg-[#6940c9] border-[#6940c9] text-white shadow-sm'
                                                : 'bg-white/5 border-white/10 text-white/40 hover:text-white hover:bg-white/10'
                                                }`}
                                        >
                                            {cat}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {loading ? (
                                <div className="flex items-center justify-center py-24">
                                    <div className="w-6 h-6 border-[1.5px] border-[#6940c9]/20 border-t-[#6940c9] rounded-full animate-spin"></div>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
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
                                                <div className="flex items-start justify-between gap-4 px-1">
                                                    <div className="min-w-0">
                                                        <h3 className="text-[14px] font-medium text-white/80 group-hover:text-white transition-colors truncate">{project.name}</h3>
                                                        <p className="text-[12px] text-white/20 mt-1 uppercase tracking-tight">
                                                            {project.category && project.category !== 'none' ? project.category : 'Template'}
                                                        </p>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                </div>
                            )}

                            {/* Empty State for Filter */}
                            {!loading && templateProjects.filter(project => {
                                if (selectedCategory === 'All') return true
                                const projectCat = project.category || 'none'
                                return projectCat === selectedCategory
                            }).length === 0 && (
                                    <div className="flex flex-col items-center justify-center py-24 text-white/20">
                                        <Sparkles size={48} strokeWidth={1.5} className="mb-4 opacity-20" />
                                        <p className="text-[14px] font-normal">No templates found in this category</p>
                                        <button
                                            onClick={() => setSelectedCategory('All')}
                                            className="mt-4 text-[12px] font-semibold text-[#6940c9] hover:underline uppercase tracking-widest"
                                        >
                                            Show all templates
                                        </button>
                                    </div>
                                )}
                        </section>
                    )}

                    {/* Learn Vevara Section - Wide Video Tutorial */}
                    <section id="learn-vevara" className="text-center flex flex-col items-center scroll-mt-24">
                        <div className="flex flex-col items-center mb-8">
                            <h2 className="text-[12px] font-semibold uppercase tracking-[0.2em] text-white/30 mb-2">Learn Vevara</h2>
                            <div className="h-px w-10 bg-[#6940c9]/30" />
                        </div>

                        <div className="max-w-4xl w-full aspect-video bg-[#050505] border border-white/10 rounded-[24px] overflow-hidden relative group shadow-sm ring-1 ring-white/5 mx-auto">
                            <video
                                className="w-full h-full object-cover"
                                controls
                                playsInline
                                preload="metadata"
                            >
                                <source src={TUTORIAL_VIDEO_URL} type="video/mp4" />
                                Your browser does not support the video tag.
                            </video>

                            {/* Premium overlay effect when hovered */}
                            <div className="absolute inset-0 pointer-events-none bg-gradient-to-t from-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
                        </div>

                        <div className="mt-12">
                            <h4 className="text-xl font-medium tracking-tight text-white/90">Getting Started with <span className="text-[#6940c9] italic font-semibold">vevara</span></h4>


                            <button className="mt-8 text-[12px] text-[#6940c9] hover:text-[#7b52da] font-semibold flex items-center gap-2 transition-colors duration-200 mx-auto opacity-50 hover:opacity-100">
                                EXPLORE ALL <ExternalLink size={14} strokeWidth={2.5} />
                            </button>
                        </div>
                    </section>
                    {/* Upcoming Features Section */}
                    <section className="pt-16">
                        <div className="flex flex-col gap-3 mb-12">
                            <div className="flex items-center gap-2">
                                <Sparkles size={16} strokeWidth={2} className="text-[#6940c9]" />
                                <h2 className="text-[12px] font-semibold uppercase tracking-[0.2em] text-white/30">Upcoming Features</h2>
                            </div>
                            <h3 className="text-2xl font-semibold tracking-tight">What's <span className="font-normal italic">Next</span> for vevara</h3>
                        </div>

                        <div className="max-w-2xl space-y-10">
                            {[
                                {
                                    icon: <Presentation />,
                                    title: "Presentation Mode",
                                    desc: "Create animated school presentations with premium fluid transitions."
                                },
                                {
                                    icon: <Wand2 />,
                                    title: "Blur & Alpha Animation",
                                    desc: "Cinematic depth with standard blur transitions and transparency controls."
                                },
                                {
                                    icon: <Music />,
                                    title: "Music Support",
                                    desc: "Integrated audio tracks with waveform-perfect syncing."
                                },
                                {
                                    icon: <Box />,
                                    title: "Reusable Smart Templates",
                                    desc: "High-quality animation content with pre-built logic-driven layouts."
                                },
                                {
                                    icon: <Layers />,
                                    title: "Animated Component Library",
                                    desc: "Ready-to-use animated components and high-quality image assets."
                                }
                            ].map((feature, i) => (
                                <div key={i} className="flex items-start gap-5 group">
                                    <div className="w-10 h-10 rounded-[12px] bg-white/[0.03] border border-white/5 flex items-center justify-center shrink-0 group-hover:border-[#6940c9]/30 transition-colors duration-200 shadow-sm">
                                        {React.cloneElement(feature.icon, { size: 20, className: 'text-white/40 group-hover:text-[#6940c9] transition-colors', strokeWidth: 1.5 })}
                                    </div>
                                    <div className="space-y-1.5 pt-1">
                                        <h4 className="text-[16px] font-medium text-white/80 group-hover:text-white transition-colors">{feature.title}</h4>
                                        <p className="text-[14px] text-white/30 font-normal leading-relaxed">{feature.desc}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>

                </div>
            </main>

            {/* Global Custom CSS for scrollbars */}
            <style dangerouslySetInnerHTML={{
                __html: `
                .no-scrollbar::-webkit-scrollbar { display: none; }
                .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
                body { overflow-y: auto !important; }
            `}} />

            {/* Duplicating Template Loading Modal */}
            <Modal
                isOpen={isDuplicating}
                onClose={() => { }} // User cannot close this manually
                hideCloseButton={true}
                maxWidth="max-w-sm"
            >
                <div className="flex flex-col items-center justify-center py-8 space-y-8">
                    <div className="relative">
                        <div className="w-16 h-16 border-4 border-[#6940c9]/10 rounded-full"></div>
                        <div className="w-16 h-16 border-4 border-[#6940c9] border-t-transparent rounded-full animate-spin absolute inset-0"></div>
                        <Layers size={24} strokeWidth={2} className="text-[#6940c9] absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2" />
                    </div>
                    <div className="text-center space-y-3">
                        <h3 className="text-[20px] font-semibold text-white tracking-tight">Duplicating Template</h3>
                        <p className="text-[14px] text-white/50 leading-relaxed max-w-[240px] mx-auto font-normal">
                            Setting up a fresh copy of everything for you...
                        </p>
                    </div>
                </div>
            </Modal>

            {/* Delete Confirmation Modal */}
            <Modal
                isOpen={!!projectToDelete}
                onClose={() => setProjectToDelete(null)}
                title="Delete Project"
                maxWidth="max-w-sm"
            >
                <div className="space-y-8">
                    <p className="text-[14px] text-white/50 leading-relaxed font-normal">
                        Are you sure you want to delete this project? This action cannot be undone and all data will be permanently removed.
                    </p>
                    <div className="flex gap-4">
                        <button
                            onClick={() => setProjectToDelete(null)}
                            className="h-11 flex-1 px-4 bg-white/5 hover:bg-white/10 text-white/90 rounded-[12px] text-[14px] font-medium transition-all duration-200 border border-white/5"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={confirmDeleteProject}
                            className="h-11 flex-1 px-4 bg-rose-500/80 hover:bg-rose-500 text-white rounded-[12px] text-[14px] font-semibold transition-all duration-200 shadow-sm"
                        >
                            Delete
                        </button>
                    </div>
                </div>
            </Modal>
        </div>
    )
}

export default DashboardPage
