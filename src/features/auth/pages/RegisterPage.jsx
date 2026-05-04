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
    const [showEmailForm, setShowEmailForm] = useState(false)

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
        <div className="min-h-[100dvh] bg-[#090a0d] bg-gradient-to-tr from-[#090a0d] via-[#090a0d] to-[#7b49ef]/5 flex flex-col items-center justify-start md:justify-center p-0 md:p-12 font-normal selection:bg-[#7b49ef]/30 overflow-y-auto overflow-x-hidden relative">
            {/* Background elements */}
            <div className="absolute -top-[15%] -right-[5%] w-[60%] h-[60%] bg-[#7b49ef]/5 rounded-full blur-[120px] pointer-events-none" />
            <div className="absolute -bottom-[15%] -left-[5%] w-[50%] h-[50%] bg-[#6940c9]/3 rounded-full blur-[120px] pointer-events-none" />

            <div className="w-full max-w-[440px] bg-transparent md:bg-white/[0.01] md:backdrop-blur-3xl rounded-none md:rounded-[32px] relative z-10 flex flex-col md:shadow-[0_32px_64px_-16px_rgba(0,0,0,0.5)] my-auto overflow-hidden shrink-0 border border-white/5">
                <div className="p-8 md:p-12 relative">
                    <div className="w-full">
                        <div className="mb-10 text-center">
                            <h2 className="text-3xl font-semibold text-white tracking-tight">Create account</h2>
                            <p className="text-white/30 mt-2 text-[15px]">Start your creative journey</p>
                        </div>

                        <div className="space-y-4">
                            <a
                                href="/api/auth/google"
                                onClick={handleGoogleClick}
                                className="w-full h-14 bg-white text-black font-semibold rounded-[16px] shadow-sm transition-all duration-200 transform active:scale-[0.98] flex items-center justify-center gap-3 text-[16px] hover:bg-zinc-100"
                            >
                                <svg className="w-5 h-5" viewBox="0 0 24 24">
                                    <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                                    <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                                    <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                                    <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.66l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                                </svg>
                                <span>Continue with Google</span>
                            </a>

                            {!showEmailForm ? (
                                <button
                                    onClick={() => setShowEmailForm(true)}
                                    className="w-full h-14 bg-white/[0.03] border border-white/10 hover:border-white/20 text-white font-medium rounded-[16px] shadow-sm transition-all duration-200 transform active:scale-[0.98] flex items-center justify-center gap-3 text-[16px]"
                                >
                                    <Mail size={20} strokeWidth={2} className="text-white/40" />
                                    <span>Continue using email</span>
                                </button>
                            ) : (
                                <div className="animate-in fade-in slide-in-from-top-4 duration-500">
                                    <div className="relative my-8">
                                        <div className="absolute inset-0 flex items-center">
                                            <div className="w-full border-t border-white/5"></div>
                                        </div>
                                        <div className="relative flex justify-center text-[11px] font-bold uppercase tracking-[0.2em]">
                                            <span className="bg-[#090a0d] md:bg-[#121318] px-4 text-white/20">Email Registration</span>
                                        </div>
                                    </div>

                                    <form onSubmit={handleSubmit} className="space-y-5">
                                        <div className="space-y-2">
                                            <label className="text-[11px] font-bold text-white/30 uppercase tracking-[0.15em] ml-1">Email Address</label>
                                            <div className="relative group/input">
                                                <Mail size={18} strokeWidth={2} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/10 group-focus-within/input:text-[#7b49ef] transition-colors" />
                                                <input
                                                    type="email"
                                                    value={email}
                                                    onChange={(e) => {
                                                        setEmail(e.target.value)
                                                        if (error) dispatch(clearError())
                                                    }}
                                                    className="w-full h-12 bg-white/[0.03] border border-white/5 rounded-[12px] pl-11 pr-4 text-white placeholder:text-white/10 focus:outline-none focus:bg-[#7b49ef]/[0.05] focus:border-[#7b49ef]/30 transition-all text-[16px]"
                                                    placeholder="name@example.com"
                                                    required
                                                />
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="space-y-2">
                                                <label className="text-[11px] font-bold text-white/30 uppercase tracking-[0.15em] ml-1">Password</label>
                                                <div className="relative group/input">
                                                    <Lock size={18} strokeWidth={2} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/10 group-focus-within/input:text-[#6940c9] transition-colors" />
                                                    <input
                                                        type="password"
                                                        value={password}
                                                        onChange={(e) => {
                                                            setPassword(e.target.value)
                                                            if (error) dispatch(clearError())
                                                        }}
                                                        className="w-full h-12 bg-white/[0.03] border border-white/5 rounded-[12px] pl-11 pr-4 text-white placeholder:text-white/10 focus:outline-none focus:bg-[#7b49ef]/[0.05] focus:border-[#7b49ef]/30 transition-all text-[16px]"
                                                        placeholder="••••••••"
                                                        required
                                                    />
                                                </div>
                                            </div>

                                            <div className="space-y-2">
                                                <label className="text-[11px] font-bold text-white/30 uppercase tracking-[0.15em] ml-1">Confirm</label>
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
                                        </div>

                                        {(error || localError) && (
                                            <div className="flex items-center gap-3 text-rose-400 bg-rose-400/5 border border-rose-400/10 p-4 rounded-[12px] text-[13px] animate-in fade-in slide-in-from-top-2">
                                                <AlertCircle size={16} strokeWidth={2} className="shrink-0" />
                                                <p className="font-medium">{error || localError}</p>
                                            </div>
                                        )}

                                        <button
                                            type="submit"
                                            disabled={status === 'loading'}
                                            className="w-full h-12 bg-[#7b49ef] hover:bg-[#8c5df2] disabled:bg-[#7b49ef]/50 disabled:cursor-not-allowed text-white font-semibold rounded-[12px] shadow-sm transition-all duration-200 transform active:scale-[0.98] mt-2 flex items-center justify-center gap-2 text-[15px]"
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
                                </div>
                            )}
                        </div>

                        <p className="text-center mt-10 text-white/30 text-[14px]">
                            Already have an account? {' '}
                            <Link to="/login" className="text-white hover:text-[#7b49ef] font-semibold transition-all ml-1 underline underline-offset-4 decoration-white/10 hover:decoration-[#7b49ef]/30">
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
