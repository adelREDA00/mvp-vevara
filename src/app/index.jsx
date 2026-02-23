import { Provider } from 'react-redux'
import { store } from '../store'
import EditorPage from '../features/editor/pages/EditorPage'
import ErrorBoundary from '../components/ErrorBoundary'

function App() {
  return (
    <Provider store={store}>
      <ErrorBoundary>
        <EditorPage />
      </ErrorBoundary>
    </Provider>
  )
}

export default App

