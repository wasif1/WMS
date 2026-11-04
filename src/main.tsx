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
import '@fontsource/noto-naskh-arabic/arabic-400.css'
import '@fontsource/noto-naskh-arabic/arabic-500.css'
import '@fontsource/noto-naskh-arabic/arabic-600.css'
import '@fontsource/noto-naskh-arabic/arabic-700.css'
import './index.css'
import { initTextSize, initTheme } from './lib/theme'
import { initLang, useLang } from './i18n'

initTheme()
initTextSize()
initLang()

/** Re-mounts the app when the language changes so every string, direction and format updates at once. */
function LangRoot({ children }: { children: React.ReactNode }) { const lang = useLang(); return <div key={lang} className="contents">{children}</div> }

// Any page that fails to LOAD data tells the user (once), instead of silently showing an empty list. Sign-outs are handled by the auth layer.
const queryClient = new QueryClient({ queryCache: new QueryCache({ onError: (e) => { if (!(e instanceof ApiError && e.status === 401)) toastError(e) } }), defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: 15_000 } } })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary variant="app"><QueryClientProvider client={queryClient}>
      <ToastProvider>
        <OfflineBanner />
        <AuthProvider>
          <LangRoot>{DEMO ? <HashRouter><App /></HashRouter> : <BrowserRouter><App /></BrowserRouter>}</LangRoot>
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider></ErrorBoundary>
  </StrictMode>,
)
