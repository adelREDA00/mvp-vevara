import React, { useState, useEffect } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Link, useNavigate } from 'react-router-dom'
import { login, clearError } from '../../../store/slices/authSlice'
import { LogIn, User, Lock, AlertCircle, ExternalLink, Globe } from 'lucide-react'
import { isInAppBrowser } from '../../../utils/inAppBrowser'
import InAppBrowserModal from '../components/InAppBrowserModal'

const LoginPage = () => {
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const dispatch = useDispatch()
    const navigate = useNavigate()
    const { status, error, isAuthenticated } = useSelector((state) => state.auth)
    const [showInAppModal, setShowInAppModal] = useState(false)
    const [isInApp, setIsInApp] = useState(false)

    useEffect(() => {
        setIsInApp(isInAppBrowser())
    }, [])

    useEffect(() => {
        if (isAuthenticated) {
            navigate('/dashboard')
        }
    }, [isAuthenticated, navigate])

    const handleSubmit = async (e) => {
        e.preventDefault()
        const resultAction = await dispatch(login({ email, password }))
        if (login.fulfilled.match(resultAction)) {
            navigate('/dashboard')
        }
    }

    const handleGoogleClick = (e) => {
        if (isInApp) {
            e.preventDefault()
            setShowInAppModal(true)
        }
    }

    return (
        <div className="min-h-[100dvh] bg-[#0f1015] flex flex-col items-center justify-start md:justify-center p-0 md:p-12 font-extralight selection:bg-[#6940c9]/30 overflow-y-auto overflow-x-hidden relative">
            {/* Background elements */}
            <div className="absolute -top-[10%] -left-[10%] w-[50%] h-[50%] bg-[#6940c9]/3 rounded-full blur-[80px] pointer-events-none" />
            <div className="absolute -bottom-[10%] -right-[10%] w-[40%] h-[40%] bg-[#6940c9]/2 rounded-full blur-[80px] pointer-events-none" />

            <div className="w-full max-w-4xl bg-transparent md:bg-white/[0.01] md:backdrop-blur-3xl rounded-none md:rounded-[2.5rem] relative z-10 flex flex-col md:flex-row md:shadow-[0_32px_64px_-16px_rgba(0,0,0,0.5)] my-auto overflow-hidden shrink-0">
                {/* Left Column: Branding / Welcome */}
                <div className="md:w-5/12 p-4 md:p-12 flex flex-col justify-center md:bg-gradient-to-br md:from-white/[0.03] md:to-transparent relative shrink-0">
                    <div className="absolute top-0 right-0 w-px h-full bg-gradient-to-b from-transparent via-white/5 to-transparent hidden md:block" />

                    <div className="flex flex-row md:flex-col items-center md:items-start gap-3 md:gap-0">
                        <Link to="/" className="inline-block md:mb-12 hover:opacity-80 transition-opacity">
                            <img src="/logo.svg" alt="Vevara" className="w-6 h-6 md:w-10 md:h-10" />
                        </Link>
                        <h1 className="text-lg md:text-4xl font-normal text-white tracking-tight leading-tight">
                            Animate by <span className="text-[#6940c9] italic">designing.</span>
                        </h1>
                        <p className="hidden md:block text-white/40 mt-2 text-[13px] md:text-[14px] leading-relaxed max-w-[280px]">
                            A new way to create motion videos. No timelines no keyframes. Just design.
                        </p>
                    </div>

                    <div className="mt-8 md:mt-0 hidden md:block">
                        <div className="flex items-center gap-3">
                            <div className="flex -space-x-2">
                                {[1, 2, 3].map(i => (
                                    <div key={i} className="w-6 h-6 rounded-full border border-[#0f1015] bg-[#1a1b23] flex items-center justify-center">
                                        <div className="w-full h-full rounded-full bg-gradient-to-br from-[#6940c9]/20 to-transparent" />
                                    </div>
                                ))}
                            </div>
                            <p className="text-[11px] text-white/20 font-medium tracking-wide uppercase">Join 200+ creators</p>
                        </div>
                    </div>
                </div>

                {/* Right Column: Form */}
                <div className="md:w-7/12 p-4 md:p-12 relative">
                    <div className="max-w-[320px] mx-auto md:mx-0">
                        <div className="mb-3 md:mb-8">
                            <h2 className="text-xl font-normal text-white">Sign in</h2>
                            <p className="text-white/20 mt-1 text-[12px]">Continue your creative journey</p>
                        </div>

                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="space-y-1.5">
                                <label className="text-[10px] font-bold text-white/40 uppercase tracking-[0.2em] ml-1">Account</label>
                                <div className="relative group/input">
                                    <User className="absolute left-4 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/10 group-focus-within/input:text-[#6940c9] transition-colors" />
                                    <input
                                        type="email"
                                        value={email}
                                        onChange={(e) => {
                                            setEmail(e.target.value)
                                            if (error) dispatch(clearError())
                                        }}
                                        className="w-full bg-white/[0.03] rounded-2xl py-2.5 md:py-3.5 pl-11 pr-4 text-white placeholder:text-white/5 focus:outline-none focus:bg-[#6940c9]/[0.05] transition-all text-[14px]"
                                        placeholder="Email address"
                                        required
                                    />
                                </div>
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-[10px] font-bold text-white/40 uppercase tracking-[0.2em] ml-1">Security</label>
                                <div className="relative group/input">
                                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/10 group-focus-within/input:text-[#6940c9] transition-colors" />
                                    <input
                                        type="password"
                                        value={password}
                                        onChange={(e) => {
                                            setPassword(e.target.value)
                                            if (error) dispatch(clearError())
                                        }}
                                        className="w-full bg-white/[0.03] rounded-2xl py-2.5 md:py-3.5 pl-11 pr-4 text-white placeholder:text-white/5 focus:outline-none focus:bg-[#6940c9]/[0.05] transition-all text-[14px]"
                                        placeholder="••••••••"
                                        required
                                    />
                                </div>
                            </div>

                            {error && (
                                <div className="flex items-center gap-2.5 text-rose-400/80 bg-rose-400/5 p-3 rounded-xl text-[12px] animate-in fade-in slide-in-from-top-2">
                                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                                    <p className="font-medium">{error}</p>
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={status === 'loading'}
                                className="w-full bg-[#6940c9] hover:bg-[#7b52da] disabled:bg-[#6940c9]/50 disabled:cursor-not-allowed text-white font-semibold py-2.5 md:py-3.5 rounded-2xl shadow-xl shadow-[#6940c9]/20 transition-all duration-300 transform active:scale-[0.98] mt-4 flex items-center justify-center gap-2 text-[14px]"
                            >
                                {status === 'loading' ? (
                                    <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
                                ) : (
                                    <>
                                        <span>Continue</span>
                                        <ExternalLink className="w-3.5 h-3.5 opacity-40" />
                                    </>
                                )}
                            </button>
                        </form>

                        <div className="relative my-4 md:my-8">
                            <div className="absolute inset-0 flex items-center">
                                <div className="w-full border-t border-white/5"></div>
                            </div>
                            <div className="relative flex justify-center text-[10px] uppercase tracking-widest font-bold">
                                <span className="bg-[#0f1015] md:bg-transparent px-4 text-white/10">or</span>
                            </div>
                        </div>

                        <a
                            href="/api/auth/google"
                            onClick={handleGoogleClick}
                            className="w-full bg-white text-black font-semibold py-2.5 md:py-3.5 rounded-2xl shadow-xl transition-all duration-300 transform active:scale-[0.98] flex items-center justify-center gap-3 text-[14px] hover:bg-white/90"
                        >
                            <svg className="w-4 h-4" viewBox="0 0 24 24">
                                <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                                <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                                <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                                <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.66l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                            </svg>
                            <span>Google Account</span>
                        </a>

                        <p className="text-center mt-6 md:mt-10 text-white/30 text-[12px]">
                            New here? {' '}
                            <Link to="/register" className="text-white hover:text-white/80 font-medium transition-all ml-1 underline underline-offset-4 decoration-white/10 hover:decoration-white/30">
                                create an account
                            </Link>
                        </p>
                    </div>
                </div>
            </div>

            <InAppBrowserModal
                isOpen={showInAppModal}
                onClose={() => setShowInAppModal(false)}
            />
        </div>


    )
}

export default LoginPage
