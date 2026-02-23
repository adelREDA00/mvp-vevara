import React from 'react'

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props)
        this.state = { hasError: false, error: null, errorInfo: null }
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error }
    }

    componentDidCatch(error, errorInfo) {
        console.error('Uncaught error:', error, errorInfo)
        this.setState({ error, errorInfo })
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="p-4 bg-red-900 text-white h-screen flex flex-col items-center justify-center text-center">
                    <h1 className="text-2xl font-bold mb-4">Something went wrong</h1>
                    <p className="mb-2">The editor crashed. check console for details.</p>
                    <pre className="bg-black/50 p-4 rounded text-left overflow-auto max-w-full text-xs">
                        {this.state.error && this.state.error.toString()}
                        <br />
                        {this.state.errorInfo && this.state.errorInfo.componentStack}
                    </pre>
                    <button
                        className="mt-4 px-4 py-2 bg-blue-600 rounded hover:bg-blue-700"
                        onClick={() => window.location.reload()}
                    >
                        Reload Page
                    </button>
                </div>
            )
        }

        return this.props.children
    }
}

export default ErrorBoundary
