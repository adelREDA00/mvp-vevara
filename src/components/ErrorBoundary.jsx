import React from 'react'
import { AlertTriangle } from 'lucide-react'

/**
 * ErrorBoundary component that catches React render errors and displays
 * a recovery UI with option to redirect to the dashboard.
 */
class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props)
        this.state = { hasError: false, error: null, errorInfo: null }
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error }
    }

    componentDidCatch(error, errorInfo) {
        this.setState({ errorInfo })
        console.error('[ErrorBoundary] Caught error:', error)
        console.error('[ErrorBoundary] Component stack:', errorInfo?.componentStack)
    }

    handleGoToDashboard = () => {
        // Full page reload to ensure clean state
        window.location.href = '/dashboard'
    }

    handleRetry = () => {
        this.setState({ hasError: false, error: null, errorInfo: null })
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="fixed inset-0 bg-[#0f1015] flex items-center justify-center z-[9999]">
                    <div className="max-w-md w-full mx-4">
                        {/* Error Card */}
                        <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-8 text-center">
                            <div className="w-14 h-14 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-5">
                                <AlertTriangle className="w-7 h-7 text-red-400" />
                            </div>

                            <h2 className="text-xl font-medium text-white mb-2">
                                Something went wrong
                            </h2>
                            <p className="text-white/40 text-sm mb-6 leading-relaxed">
                                An unexpected error occurred. Your project data may still be safe.
                                Please return to the dashboard and try again.
                            </p>

                            {/* Error details (collapsed) */}
                            {this.state.error && (
                                <details className="mb-6 text-left">
                                    <summary className="text-xs text-white/20 cursor-pointer hover:text-white/40 transition-colors">
                                        Technical details
                                    </summary>
                                    <pre className="mt-2 p-3 bg-black/30 rounded-lg text-[10px] text-red-300/60 overflow-auto max-h-32 font-mono">
                                        {this.state.error.toString()}
                                        {this.state.errorInfo?.componentStack?.slice(0, 500)}
                                    </pre>
                                </details>
                            )}

                            <div className="flex gap-3">
                                <button
                                    onClick={this.handleRetry}
                                    className="flex-1 px-5 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 text-white rounded-xl text-sm font-medium transition-all"
                                >
                                    Try Again
                                </button>
                                <button
                                    onClick={this.handleGoToDashboard}
                                    className="flex-1 px-5 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-sm font-medium transition-all"
                                >
                                    Go to Dashboard
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )
        }

        return this.props.children
    }
}

export default ErrorBoundary
