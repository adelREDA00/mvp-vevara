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
                className={`fixed top-0 left-0 right-0 h-10 md:h-12 flex items-center justify-between px-4 md:px-6 z-50 transition-all duration-300 ${scrolled
                    ? 'bg-[#0f1015]/80 backdrop-blur-2xl border-b border-white/5 shadow-2xl'
                    : 'bg-transparent'
                    }`}
            >
                <div className="flex items-center gap-6">
                    <a href="/" className="flex items-center gap-2.5 hover:opacity-80 transition-opacity">
                        <img src="/logo.svg" alt="Vevara" className="w-6 h-6" />
                        <span className="font-medium text-[15px] tracking-tight hidden sm:block">Vevara</span>
                    </a>
                </div>
                <div className="flex items-center gap-4">
                    <a
                        href="#learn-vevara"
                        className="hidden sm:flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-white/50 text-[10px] font-bold uppercase tracking-wider hover:bg-white/10 hover:text-white transition-all"
                    >
                        Learn Vevara in 40s
                    </a>
                    {isAuthenticated && (
                        <DropdownMenu
                            trigger={
                                <button className="flex items-center gap-2 group outline-none">
                                    <div className="w-8 h-8 rounded-full bg-[#1a1b23] hover:bg-[#25262e] border border-white/10 flex items-center justify-center transition-all overflow-hidden">
                                        {user?.email ? (
                                            <span className="text-white text-[11px] font-bold uppercase">
                                                {user.email.substring(0, 2)}
                                            </span>
                                        ) : (
                                            <UserIcon className="w-4 h-4 text-white/40" />
                                        )}
                                    </div>
                                    <ChevronDown className="w-3.5 h-3.5 text-white/20 group-hover:text-white/40 transition-colors" />
                                </button>
                            }
                        >
                            <div className="px-4 py-3 border-b border-white/5 mb-1">
                                <p className="text-[11px] font-medium text-white/50 truncate">{user?.email}</p>
                            </div>
                            <DropdownMenuItem onClick={handleLogout}>
                                <div className="flex items-center gap-2.5 text-rose-400">
                                    <LogOut className="w-3.5 h-3.5" />
                                    <span>Logout</span>
                                </div>
                            </DropdownMenuItem>
                        </DropdownMenu>
                    )}
                </div>
            </header>

            {/* Main Content (Now Full Width & Scrollable) */}
            <main className="w-full min-h-screen">
                {/* Hero Section */}
                <section className="pt-24 pb-12 md:pt-32 md:pb-16 px-6 md:px-10 bg-gradient-to-b from-[#6940c9]/5 to-transparent">
                    <div className="max-w-4xl mx-auto text-center">
                        <h1 className="text-3xl md:text-5xl font-extralight tracking-tight leading-loose mb-12">
                            Canva simplicity <span className="text-[#6940c9] italic">Real </span> motion control
                        </h1>

                        <div className="max-w-xl mx-auto space-y-6">
                            {showBetaMessage && (
                                <div className="relative bg-white/[0.03] backdrop-blur-xl border border-white/10 rounded-2xl p-6 text-left animate-in fade-in slide-in-from-top-4 duration-500">
                                    <button
                                        onClick={toggleBetaMessage}
                                        className="absolute top-4 right-4 p-1 rounded-full hover:bg-white/5 text-white/20 hover:text-white transition-all"
                                    >
                                        <X className="w-4 h-4" />
                                    </button>

                                    <div className="space-y-4">
                                        <div className="flex items-center gap-2">
                                            <span className="text-[10px] font-bold uppercase tracking-widest text-[#6940c9] bg-[#6940c9]/10 px-2 py-0.5 rounded">Rédaction</span>
                                        </div>

                                        <div className="space-y-3 text-white/70 text-[13px] leading-relaxed font-light">
                                            <p>Thanks for being one of the first + 200 creators exploring Vevara.</p>
                                            <p>This is an early beta to test a new approach to motion design, so you may encounter bugs in places. I’ll continue improving the app based on your feedback.</p>
                                            <p className="text-red-500 font-medium">For now, Vevara works best on desktop, mobile support is still unstable.</p>
                                            {/* <p className="text-white font-normal italic">Your feedback will help shape the future of the product.</p> */}
                                            <div className="pt-2">
                                                <a href="#learn-vevara" className="inline-flex items-center gap-1.5 text-[#6940c9] hover:text-[#7b52da] font-bold transition-colors">
                                                    Learn Vevara in 40 seconds <ExternalLink className="w-3 h-3" />
                                                </a>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Feedback Input Section */}
                            <div className="bg-white/[0.02] backdrop-blur-md border border-white/5 rounded-2xl p-5 flex flex-col items-start gap-4 shadow-2xl">
                                <div className="w-full flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <h3 className="text-[11px] font-bold uppercase tracking-widest text-white/30">Share your thoughts</h3>
                                        {!showBetaMessage && (
                                            <button
                                                onClick={toggleBetaMessage}
                                                className="text-[12px] text-[#6940c9] hover:text-[#7b52da] font-bold transition-all ml-1 underline underline-offset-4 decoration-[#6940c9]/30 hover:decoration-[#6940c9]"
                                            >
                                                Show update message
                                            </button>
                                        )}
                                    </div>
                                    {feedbackStatus === 'success' && (
                                        <span className="text-[10px] text-emerald-500 font-medium">Feedback sent!</span>
                                    )}
                                </div>
                                <div className="w-full flex items-center gap-3">
                                    <input
                                        type="text"
                                        value={feedbackText}
                                        onChange={(e) => setFeedbackText(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && handleSendFeedback()}
                                        placeholder="What's missing or broken?"
                                        className="flex-1 bg-white/[0.03] border border-white/5 rounded-xl px-4 py-2.5 text-[13px] text-white placeholder:text-white/10 outline-none focus:border-[#6940c9]/30 transition-all font-light"
                                    />
                                    <button
                                        onClick={handleSendFeedback}
                                        disabled={!feedbackText.trim() || feedbackStatus === 'sending'}
                                        className="px-6 py-2.5 bg-[#6940c9] hover:bg-[#7b52da] disabled:opacity-50 disabled:cursor-not-allowed rounded-xl text-[12px] font-bold transition-all flex items-center gap-2"
                                    >
                                        {feedbackStatus === 'sending' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Send'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                <div className="max-w-[1400px] mx-auto px-6 md:px-10 pb-32 space-y-24">
                    {/* Projects Section (Optimized Grid) */}
                    <section id="projects">
                        <div className="flex items-center justify-between mb-10 border-b border-white/5 pb-6">
                            <h2 className="text-2xl font-extralight tracking-tight">Your <span className="font-normal italic">Projects</span></h2>
                            <button
                                onClick={handleCreateProject}
                                className="px-6 py-2.5 bg-[#6940c9] text-white rounded-full text-[13px] font-semibold hover:bg-[#7c4af0] transition-all flex items-center gap-2 shadow-lg shadow-[#6940c9]/20"
                            >
                                <Plus className="w-4 h-4" />
                                New Project
                            </button>
                        </div>

                        {loading ? (
                            <div className="flex items-center justify-center py-24">
                                <div className="w-6 h-6 border-[1.5px] border-[#6940c9]/20 border-t-[#6940c9] rounded-full animate-spin"></div>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-8">
                                {/* 10 Second Tutorial Special Card */}
                                <div
                                    className="group cursor-pointer"
                                    onClick={handleTutorialClick}
                                >
                                    <div className="aspect-video bg-[#1a1b23] border border-[#6940c9]/30 rounded-xl overflow-hidden relative mb-4 group-hover:border-[#6940c9] transition-all flex flex-col items-center justify-center p-6 text-center bg-[radial-gradient(circle_at_center,_rgba(105,64,201,0.15)_0%,_transparent_70%)]">
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
                                                <Wand2 className="w-5 h-5 text-[#6940c9]" />
                                            </div>
                                            <h3 className="text-base font-bold text-white tracking-tight group-hover:text-[#7c4af0] transition-colors">10 second tutorial</h3>
                                            <p className="text-[9px] text-white/40 font-medium uppercase tracking-[0.2em] leading-tight">create your first iphone ad</p>
                                        </div>

                                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-[#0f1015]/60 backdrop-blur-[4px] z-20">
                                            <div className="px-5 py-2 bg-white text-black text-[10px] font-black rounded-full flex items-center gap-2 transform translate-y-4 group-hover:translate-y-0 transition-all duration-500 shadow-2xl">
                                                START GUIDE <Sparkles className="w-3 h-3 text-[#6940c9]" />
                                            </div>
                                        </div>

                                        <div className="absolute top-3 left-3 bg-[#6940c9] rounded px-1.5 py-0.5 text-[8px] font-black text-white tracking-widest uppercase shadow-lg shadow-[#6940c9]/20">
                                            SPECIAL
                                        </div>
                                    </div>
                                    <div className="flex flex-col">
                                        <h3 className="text-[13px] font-medium text-white group-hover:text-[#6940c9] transition-colors">10 second tutorial</h3>
                                        <p className="text-[10px] text-white/40 mt-1 font-light italic">Start your journey here</p>
                                    </div>
                                </div>

                                {projects.map((project) => (
                                    <div
                                        key={project._id}
                                        className="group cursor-pointer"
                                        onClick={() => window.location.href = `/project/${project._id}`}
                                    >
                                        <div className="aspect-video bg-[#050505] border border-white/5 rounded-xl overflow-hidden relative mb-4 group-hover:border-[#6940c9]/40 transition-all">
                                            {project.thumbnail ? (
                                                <img
                                                    src={project.thumbnail}
                                                    alt={`${project.name} thumbnail`}
                                                    className="w-full h-full object-contain"
                                                />
                                            ) : (
                                                <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-600 gap-3">
                                                    <Layers className="w-8 h-8 opacity-50" />
                                                    <span className="text-xs font-medium uppercase tracking-widest opacity-50">Empty Canvas</span>
                                                </div>
                                            )}

                                            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-[#6940c9]/5 backdrop-blur-sm">
                                                <button className="bg-white text-black text-[10px] font-bold px-4 py-2 rounded-lg">EDIT PROJECT</button>
                                            </div>
                                            <div className="absolute top-3 left-3 bg-black/60 border border-white/10 rounded px-1.5 py-0.5 text-[8px] font-bold text-white/40 tracking-widest">
                                                PRIVATE
                                            </div>
                                            <button
                                                onClick={(e) => handleDeleteProject(e, project._id)}
                                                className="absolute top-3 right-3 p-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-500/40 hover:text-rose-500 rounded opacity-0 group-hover:opacity-100 transition-all z-10"
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                        <div className="flex items-start justify-between gap-4">
                                            <div>
                                                <h3 className="text-[13px] font-light text-white/80 group-hover:text-white transition-colors truncate">{project.name}</h3>
                                                <p className="text-[10px] text-white/20 mt-1 uppercase tracking-tighter">Motion • Edited {new Date(project.updatedAt).toLocaleDateString()}</p>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                                <button
                                    onClick={handleCreateProject}
                                    className="aspect-video bg-[#0f1015] border border-dashed border-white/10 rounded-xl flex flex-col items-center justify-center gap-3 group hover:border-[#6940c9]/30 transition-all"
                                >
                                    <div className="w-10 h-10 bg-white/5 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
                                        <Plus className="w-5 h-5 text-white/30" />
                                    </div>
                                    <span className="text-[10px] font-medium text-white/20 group-hover:text-white/40 uppercase tracking-widest">Create New</span>
                                </button>
                            </div>
                        )}
                    </section>

                    {/* Example Projects Section */}
                    {templateProjects.length > 0 && (
                        <section id="template-projects">
                            <div className="flex items-center justify-between mb-10 border-b border-white/5 pb-6">
                                <h2 className="text-2xl font-extralight tracking-tight">Templates <span className="font-normal italic">Projects</span></h2>
                            </div>

                            {loading ? (
                                <div className="flex items-center justify-center py-24">
                                    <div className="w-6 h-6 border-[1.5px] border-[#6940c9]/20 border-t-[#6940c9] rounded-full animate-spin"></div>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-8">
                                    {templateProjects.map((project) => (
                                        <div
                                            key={project._id}
                                            className="group cursor-pointer"
                                            onClick={() => handleDuplicateTemplate(project._id)}
                                        >
                                            <div className="aspect-video bg-[#050505] border border-white/5 rounded-xl overflow-hidden relative mb-4 group-hover:border-[#6940c9]/40 transition-all">
                                                {project.thumbnail ? (
                                                    <img
                                                        src={project.thumbnail}
                                                        alt={`${project.name} thumbnail`}
                                                        className="w-full h-full object-contain"
                                                    />
                                                ) : (
                                                    <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-600 gap-3">
                                                        <Layers className="w-8 h-8 opacity-50" />
                                                        <span className="text-xs font-medium uppercase tracking-widest opacity-50">Empty Canvas</span>
                                                    </div>
                                                )}

                                                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-[#6940c9]/5 backdrop-blur-sm">
                                                    <button className="bg-white text-black text-[10px] font-bold px-4 py-2 rounded-lg">DUPLICATE & EDIT</button>
                                                </div>
                                            </div>
                                            <div className="flex items-start justify-between gap-4">
                                                <div>
                                                    <h3 className="text-[13px] font-light text-white/80 group-hover:text-white transition-colors truncate">{project.name}</h3>
                                                    <p className="text-[10px] text-white/20 mt-1 uppercase tracking-tighter">Template</p>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </section>
                    )}

                    {/* Learn Vevara Section - Wide Video Tutorial */}
                    <section id="learn-vevara" className="text-center flex flex-col items-center scroll-mt-24">
                        <div className="flex flex-col items-center mb-8">
                            <h2 className="text-sm font-bold uppercase tracking-[0.2em] text-white/30 mb-2">Learn Vevara</h2>
                            <div className="h-px w-10 bg-[#6940c9]/30" />
                        </div>

                        <div className="max-w-4xl w-full aspect-video bg-[#050505] border border-white/10 rounded-3xl overflow-hidden relative group shadow-2xl ring-1 ring-white/5 mx-auto">
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

                        <div className="mt-8">
                            <h4 className="text-xl font-extralight tracking-tight text-white/90">Getting Started with <span className="text-[#6940c9] italic font-normal">Vevara</span></h4>


                            <button className="mt-8 text-[11px] text-[#6940c9] hover:text-[#7b52da] font-medium flex items-center gap-1.5 transition-colors mx-auto opacity-50 hover:opacity-100 transition-opacity">
                                EXPLORE ALL <ExternalLink className="w-3 h-3" strokeWidth={2.5} />
                            </button>
                        </div>
                    </section>
                    {/* Upcoming Features Section */}
                    <section className="pt-12">
                        <div className="flex flex-col gap-2 mb-10">
                            <div className="flex items-center gap-2">
                                <Sparkles className="w-4 h-4 text-[#6940c9]" />
                                <h2 className="text-sm font-bold uppercase tracking-[0.2em] text-white/30">Upcoming Features</h2>
                            </div>
                            <h3 className="text-2xl font-extralight tracking-tight">What's <span className="font-normal italic">Next</span> for Vevara</h3>
                        </div>

                        <div className="max-w-2xl space-y-8">
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
                                    <div className="w-8 h-8 rounded-lg bg-white/[0.03] border border-white/5 flex items-center justify-center shrink-0 group-hover:border-[#6940c9]/30 transition-colors">
                                        {React.cloneElement(feature.icon, { className: 'w-4 h-4 text-white/40 group-hover:text-[#6940c9] transition-colors', strokeWidth: 1.5 })}
                                    </div>
                                    <div className="space-y-1">
                                        <h4 className="text-[14px] font-medium text-white/80 group-hover:text-white transition-colors">{feature.title}</h4>
                                        <p className="text-[12px] text-white/30 font-light leading-relaxed">{feature.desc}</p>
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
                <div className="flex flex-col items-center justify-center py-6 space-y-6">
                    <div className="relative">
                        <div className="w-16 h-16 border-4 border-[#6940c9]/20 rounded-full"></div>
                        <div className="w-16 h-16 border-4 border-[#6940c9] border-t-transparent rounded-full animate-spin absolute inset-0"></div>
                        <Layers className="w-6 h-6 text-[#6940c9] absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2" />
                    </div>
                    <div className="text-center space-y-2">
                        <h3 className="text-lg font-medium text-white tracking-tight">Duplicating Template</h3>
                        <p className="text-sm text-white/50 leading-relaxed max-w-[240px] mx-auto">
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
                <div className="space-y-6">
                    <p className="text-[13px] text-white/50 leading-relaxed">
                        Are you sure you want to delete this project? This action cannot be undone and all data will be permanently removed.
                    </p>
                    <div className="flex gap-3">
                        <button
                            onClick={() => setProjectToDelete(null)}
                            className="flex-1 px-4 py-2.5 bg-white/5 hover:bg-white/10 text-white/90 rounded-xl text-[12px] font-medium transition-all border border-white/5"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={confirmDeleteProject}
                            className="flex-1 px-4 py-2.5 bg-rose-500/80 hover:bg-rose-500 text-white rounded-xl text-[12px] font-bold transition-all shadow-lg shadow-rose-500/20"
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
