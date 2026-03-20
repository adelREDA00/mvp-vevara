import React, { useState, useEffect } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Link, useNavigate } from 'react-router-dom'
import { register, clearError } from '../../../store/slices/authSlice'
import { UserPlus, User, Lock, AlertCircle, Mail, ExternalLink, Globe } from 'lucide-react'
import { isInAppBrowser } from '../../../utils/inAppBrowser'
import InAppBrowserModal from '../components/InAppBrowserModal'

const RegisterPage = () => {
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')
    const [localError, setLocalError] = useState(null)

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
        setLocalError(null)

        if (password !== confirmPassword) {
            setLocalError('Passwords do not match')
            return
        }

        // Derive username from email
        const username = email.split('@')[0];

        const resultAction = await dispatch(register({ username, email, password }))
        if (register.fulfilled.match(resultAction)) {
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
        <div className="min-h-[100dvh] bg-[#0f1015] flex flex-col items-center justify-start md:justify-center p-0 md:p-12 font-normal selection:bg-[#6940c9]/30 overflow-y-auto overflow-x-hidden relative">
            {/* Background elements */}
            <div className="absolute -top-[10%] -right-[10%] w-[50%] h-[50%] bg-[#6940c9]/3 rounded-full blur-[80px] pointer-events-none" />
            <div className="absolute -bottom-[10%] -left-[10%] w-[40%] h-[40%] bg-[#6940c9]/2 rounded-full blur-[80px] pointer-events-none" />

            <div className="w-full max-w-5xl bg-transparent md:bg-white/[0.01] md:backdrop-blur-3xl rounded-none md:rounded-[32px] relative z-10 flex flex-col md:flex-row md:shadow-[0_32px_64px_-16px_rgba(0,0,0,0.5)] my-auto overflow-hidden shrink-0 border border-white/5">
                {/* Left Column: Context / Welcome */}
                <div className="md:w-5/12 p-6 md:p-12 flex flex-col justify-center md:bg-gradient-to-br md:from-white/[0.03] md:to-transparent relative shrink-0">
                    <div className="absolute top-0 right-0 w-px h-full bg-gradient-to-b from-transparent via-white/5 to-transparent hidden md:block" />
                    <div className="flex flex-row md:flex-col items-center md:items-start gap-4 md:gap-0">
                        {/* <Link to="/" className="inline-block md:mb-12 hover:opacity-80 transition-opacity">
                            <span className="font-semibold text-[20px] tracking-tight">vevara</span>
                        </Link> */}
                        <h1 className="text-xl md:text-5xl font-semibold text-white tracking-tight leading-tight">
                            motion that  <span className="text-[#6940c9] italic">stays simple.</span>
                        </h1>
                        {/* <p className="hidden md:block text-white/40 mt-6 text-[15px] leading-relaxed max-w-[320px]">
                            A new way to create motion videos. No timelines no keyframes. Just design.
                        </p> */}
                    </div>
                    <br />
                    <div className="mt-12 md:mt-0">
                        <div className="flex items-center gap-3">
                            <div className="bg-white/5 px-4 py-1.5 rounded-full text-[10px] font-bold text-white/40 uppercase tracking-[0.2em] leading-none border border-white/5">
                                Experimental Alpha
                            </div>
                        </div>
                    </div>
                </div>

                {/* Right Column: Form */}
                <div className="md:w-7/12 p-6 md:p-12">
                    <div className="max-w-[420px] mx-auto md:mx-0">
                        <div className="mb-8">
                            <h2 className="text-2xl font-semibold text-white tracking-tight">Create Account</h2>
                            <p className="text-white/30 mt-1.5 text-[14px]">Join the waitlist for instant access</p>
                        </div>

                        <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-6">

                            <div className="space-y-2 sm:col-span-2">
                                <label className="text-[12px] font-semibold text-white/40 uppercase tracking-[0.15em] ml-1">Email</label>
                                <div className="relative group/input">
                                    <Mail size={18} strokeWidth={2} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/10 group-focus-within/input:text-[#6940c9] transition-colors" />
                                    <input
                                        type="email"
                                        value={email}
                                        onChange={(e) => {
                                            setEmail(e.target.value)
                                            if (error) dispatch(clearError())
                                        }}
                                        className="w-full h-12 bg-white/[0.03] border border-white/5 rounded-[12px] pl-11 pr-4 text-white placeholder:text-white/10 focus:outline-none focus:bg-[#6940c9]/[0.05] focus:border-[#6940c9]/30 transition-all text-[16px]"
                                        placeholder="name@example.com"
                                        required
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="text-[12px] font-semibold text-white/40 uppercase tracking-[0.15em] ml-1">Password</label>
                                <div className="relative group/input">
                                    <Lock size={18} strokeWidth={2} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/10 group-focus-within/input:text-[#6940c9] transition-colors" />
                                    <input
                                        type="password"
                                        value={password}
                                        onChange={(e) => {
                                            setPassword(e.target.value)
                                            if (error) dispatch(clearError())
                                        }}
                                        className="w-full h-12 bg-white/[0.03] border border-white/5 rounded-[12px] pl-11 pr-4 text-white placeholder:text-white/10 focus:outline-none focus:bg-[#6940c9]/[0.05] focus:border-[#6940c9]/30 transition-all text-[16px]"
                                        placeholder="••••••••"
                                        required
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="text-[12px] font-semibold text-white/40 uppercase tracking-[0.15em] ml-1">Confirm</label>
                                <div className="relative group/input">
                                    <Lock size={18} strokeWidth={2} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/10 group-focus-within/input:text-[#6940c9] transition-colors" />
                                    <input
                                        type="password"
                                        value={confirmPassword}
                                        onChange={(e) => {
                                            setConfirmPassword(e.target.value)
                                            setLocalError(null)
                                        }}
                                        className="w-full h-12 bg-white/[0.03] border border-white/5 rounded-[12px] pl-11 pr-4 text-white placeholder:text-white/10 focus:outline-none focus:bg-[#6940c9]/[0.05] focus:border-[#6940c9]/30 transition-all text-[16px]"
                                        placeholder="Repeat"
                                        required
                                    />
                                </div>
                            </div>

                            {(error || localError) && (
                                <div className="flex items-center gap-3 text-rose-400 bg-rose-400/5 border border-rose-400/10 p-4 rounded-[12px] text-[13px] animate-in fade-in slide-in-from-top-2 sm:col-span-2">
                                    <AlertCircle size={16} strokeWidth={2} className="shrink-0" />
                                    <p className="font-medium">{error || localError}</p>
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={status === 'loading'}
                                className="w-full h-12 bg-[#6940c9] hover:bg-[#7b52da] disabled:bg-[#6940c9]/50 disabled:cursor-not-allowed text-white font-semibold rounded-[12px] shadow-sm transition-all duration-200 transform active:scale-[0.98] mt-2 flex items-center justify-center gap-2 text-[15px] sm:col-span-2"
                            >
                                {status === 'loading' ? (
                                    <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
                                ) : (
                                    <>
                                        <span>Create Account</span>
                                        <UserPlus size={16} strokeWidth={2.5} className="opacity-50" />
                                    </>
                                )}
                            </button>
                        </form>

                        <div className="relative my-8">
                            <div className="absolute inset-0 flex items-center">
                                <div className="w-full border-t border-white/5"></div>
                            </div>
                            <div className="relative flex justify-center text-[12px] font-semibold uppercase tracking-widest">
                                <span className="bg-[#0f1015] md:bg-transparent px-4 text-white/10">or</span>
                            </div>
                        </div>

                        <a
                            href="/api/auth/google"
                            onClick={handleGoogleClick}
                            className="w-full h-12 bg-white text-black font-semibold rounded-[12px] shadow-sm transition-all duration-200 transform active:scale-[0.98] flex items-center justify-center gap-3 text-[15px] hover:bg-zinc-100"
                        >
                            <svg className="w-4 h-4" viewBox="0 0 24 24">
                                <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                                <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                                <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                                <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.66l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                            </svg>
                            <span>Google Account</span>
                        </a>

                        <p className="text-center mt-6 text-white/30 text-[14px]">
                            Already member? {' '}
                            <Link to="/login" className="text-white hover:text-[#6940c9] font-semibold transition-all ml-1 underline underline-offset-4 decoration-white/10 hover:decoration-[#6940c9]/30">
                                Sign in
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

export default RegisterPage
