import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, HashRouter } from 'react-router-dom'
import { DEMO } from './lib/api'
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import { AuthProvider } from './auth/AuthContext'
import { OfflineBanner, ToastProvider, toastError } from './components/ui'
import ErrorBoundary from './components/ErrorBoundary'
import { ApiError } from './lib/api'
import './index.css'
import { initTextSize, initTheme } from './lib/theme'

initTheme()
initTextSize()

// Any page that fails to LOAD data tells the user (once), instead of silently showing an empty list. Sign-outs are handled by the auth layer.
const queryClient = new QueryClient({ queryCache: new QueryCache({ onError: (e) => { if (!(e instanceof ApiError && e.status === 401)) toastError(e) } }), defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: 15_000 } } })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary variant="app"><QueryClientProvider client={queryClient}>
      <ToastProvider>
        <OfflineBanner />
        <AuthProvider>
          {DEMO ? <HashRouter><App /></HashRouter> : <BrowserRouter><App /></BrowserRouter>}
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider></ErrorBoundary>
  </StrictMode>,
)
