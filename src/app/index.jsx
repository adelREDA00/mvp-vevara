import { useEffect } from 'react'
import { useDispatch } from 'react-redux'
import { Provider } from 'react-redux'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { store } from '../store'
import { checkAuth } from '../store/slices/authSlice'
import EditorPage from '../features/editor/pages/EditorPage'
import LoginPage from '../features/auth/pages/LoginPage'
import RegisterPage from '../features/auth/pages/RegisterPage'
import DashboardPage from '../features/dashboard/pages/DashboardPage'
import ErrorBoundary from '../components/ErrorBoundary'

function AppContent() {
  const dispatch = useDispatch()

  useEffect(() => {
    dispatch(checkAuth())
  }, [dispatch])

  return (
    <Router>
      <Routes>
        <Route path="/" element={<EditorPage />} />
        <Route path="/project/:projectId" element={<EditorPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  )
}

function App() {
  return (
    <Provider store={store}>
      <ErrorBoundary>
        <AppContent />
      </ErrorBoundary>
    </Provider>
  )
}

export default App

