import React, { useState, useEffect } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Link, useNavigate } from 'react-router-dom'
import { register, clearError } from '../../../store/slices/authSlice'
import { UserPlus, User, Lock, AlertCircle, Mail, ExternalLink, Globe } from 'lucide-react'
import { isInAppBrowser } from '../../../utils/inAppBrowser'
import InAppBrowserModal from '../components/InAppBrowserModal'
import { useTheme } from '../../../app/context/ThemeContext'

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
    const { theme, isLight } = useTheme()

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
        <div className={`min-h-[100dvh] bg-[var(--dashboard-bg)] flex flex-col items-center justify-start md:justify-center p-4 md:p-12 font-normal selection:bg-[var(--dashboard-accent)]/10 overflow-y-auto overflow-x-hidden relative text-[var(--dashboard-text)]`}>
            <div className={`w-full max-w-[440px] bg-[var(--dashboard-card-bg)] rounded-[16px] border border-[var(--dashboard-border)] relative z-10 flex flex-col shadow-none my-auto overflow-hidden shrink-0`}>
                <div className="p-8 md:p-10 relative">
                    <div className="w-full">
                        <div className="mb-8 text-center">
                            <h2 className="text-2xl font-bold text-[var(--dashboard-text)] tracking-tight">Create account</h2>
                            <p className="text-[var(--dashboard-text-muted)] mt-1.5 text-[14px]">Start your creative journey</p>
                        </div>

                        <div className="space-y-4">
                            <a
                                href="/api/auth/google"
                                onClick={handleGoogleClick}
                                className={`w-full h-[46px] bg-[var(--dashboard-card-bg)] text-[var(--dashboard-text)] font-bold border border-[var(--dashboard-border)] rounded-[8px] transition-all duration-200 flex items-center justify-center gap-3 text-[14px] hover:bg-[var(--dashboard-card-hover)]`}
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
                                    className={`w-full h-[46px] bg-transparent border border-[var(--dashboard-border)] hover:border-[var(--dashboard-border-hover)] text-[var(--dashboard-text)] font-semibold rounded-[8px] transition-all duration-200 flex items-center justify-center gap-3 text-[14px]`}
                                >
                                    <Mail size={18} className="text-[var(--dashboard-text-muted)]" />
                                    <span>Continue using email</span>
                                </button>
                            ) : (
                                <div className="animate-in fade-in slide-in-from-top-4 duration-500">
                                    <div className="relative my-6">
                                        <div className="absolute inset-0 flex items-center">
                                            <div className="w-full border-t border-[var(--dashboard-border)]"></div>
                                        </div>
                                        <div className="relative flex justify-center text-[10px] font-bold uppercase tracking-[0.25em]">
                                            <span className="bg-[var(--dashboard-card-bg)] px-4 text-[var(--dashboard-text-muted)]/60">Email Registration</span>
                                        </div>
                                    </div>

                                    <form onSubmit={handleSubmit} className="space-y-4">
                                        <div className="space-y-1.5">
                                            <label className="text-[11px] font-bold text-[var(--dashboard-text-muted)]/85 uppercase tracking-wider ml-0.5">Email Address</label>
                                            <div className="relative group/input">
                                                <Mail size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--dashboard-text-muted)]/60 group-focus-within/input:text-[var(--dashboard-accent)] transition-colors" />
                                                <input
                                                    type="email"
                                                    value={email}
                                                    onChange={(e) => {
                                                        setEmail(e.target.value)
                                                        if (error) dispatch(clearError())
                                                    }}
                                                    className={`w-full h-[46px] bg-[var(--dashboard-card-bg)] border border-[var(--dashboard-border)] rounded-[8px] pl-11 pr-4 text-[var(--dashboard-text)] placeholder:text-[var(--dashboard-text-muted)]/40 focus:outline-none focus:border-[var(--dashboard-accent)] transition-all text-[14px]`}
                                                    placeholder="name@example.com"
                                                    required
                                                />
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="space-y-1.5">
                                                <label className="text-[11px] font-bold text-[var(--dashboard-text-muted)]/85 uppercase tracking-wider ml-0.5">Password</label>
                                                <div className="relative group/input">
                                                    <Lock size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--dashboard-text-muted)]/60 group-focus-within/input:text-[var(--dashboard-accent)] transition-colors" />
                                                    <input
                                                        type="password"
                                                        value={password}
                                                        onChange={(e) => {
                                                            setPassword(e.target.value)
                                                            if (error) dispatch(clearError())
                                                        }}
                                                        className={`w-full h-[46px] bg-[var(--dashboard-card-bg)] border border-[var(--dashboard-border)] rounded-[8px] pl-11 pr-4 text-[var(--dashboard-text)] placeholder:text-[var(--dashboard-text-muted)]/40 focus:outline-none focus:border-[var(--dashboard-accent)] transition-all text-[14px]`}
                                                        placeholder="••••••••"
                                                        required
                                                    />
                                                </div>
                                            </div>

                                            <div className="space-y-1.5">
                                                <label className="text-[11px] font-bold text-[var(--dashboard-text-muted)]/85 uppercase tracking-wider ml-0.5">Confirm</label>
                                                <div className="relative group/input">
                                                    <Lock size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--dashboard-text-muted)]/60 group-focus-within/input:text-[var(--dashboard-accent)] transition-colors" />
                                                    <input
                                                        type="password"
                                                        value={confirmPassword}
                                                        onChange={(e) => {
                                                            setConfirmPassword(e.target.value)
                                                            setLocalError(null)
                                                        }}
                                                        className={`w-full h-[46px] bg-[var(--dashboard-card-bg)] border border-[var(--dashboard-border)] rounded-[8px] pl-11 pr-4 text-[var(--dashboard-text)] placeholder:text-[var(--dashboard-text-muted)]/40 focus:outline-none focus:border-[var(--dashboard-accent)] transition-all text-[14px]`}
                                                        placeholder="Repeat"
                                                        required
                                                    />
                                                </div>
                                            </div>
                                        </div>

                                        {(error || localError) && (
                                            <div className="flex items-center gap-3 text-rose-600 bg-rose-500/10 border border-rose-500/20 p-3.5 rounded-[8px] text-[13px] animate-in fade-in slide-in-from-top-2">
                                                <AlertCircle size={16} className="shrink-0" />
                                                <p className="font-semibold">{error || localError}</p>
                                            </div>
                                        )}

                                        <button
                                            type="submit"
                                            disabled={status === 'loading'}
                                            className={`w-full h-[46px] bg-[var(--dashboard-accent)] hover:bg-[var(--dashboard-accent-hover)] disabled:bg-[var(--dashboard-accent)]/50 disabled:cursor-not-allowed ${isLight ? 'text-white' : 'text-[#06121A]'} font-bold rounded-[8px] transition-all duration-200 mt-2 flex items-center justify-center gap-2 text-[14px] shadow-sm`}
                                        >
                                            {status === 'loading' ? (
                                                <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
                                            ) : (
                                                <>
                                                    <span>Create Account</span>
                                                    <UserPlus size={16} className="opacity-70" />
                                                </>
                                            )}
                                        </button>
                                    </form>
                                </div>
                            )}
                        </div>

                        <p className="text-center mt-8 text-[var(--dashboard-text-muted)] text-[14px]">
                            Already have an account?{' '}
                            <Link to="/login" className="text-[var(--dashboard-accent)] hover:text-[var(--dashboard-accent-hover)] font-bold transition-all ml-1 underline underline-offset-4">
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
