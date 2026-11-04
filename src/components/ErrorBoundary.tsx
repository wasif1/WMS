import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, Home, RefreshCw, WifiOff } from 'lucide-react'

/** The page's code could not be downloaded (connection dropped, or a new version was deployed). */
export const isChunkLoadError = (e: Error) => /dynamically imported module|Loading chunk|Importing a module script failed|error loading dynamically/i.test(String(e?.message))

interface Props { children: ReactNode; /** compact = inside the page area (sidebar stays usable); full = whole app */ variant?: 'page' | 'app' }
interface State { error: Error | null }

/** Catches rendering crashes so people see an explanation and a way out instead of a blank screen. */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }
  static getDerivedStateFromError(error: Error): State { return { error } }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('[ui crash]', error, info.componentStack) }
  render() {
    if (!this.state.error) return this.props.children
    const full = this.props.variant === 'app'
    const chunk = isChunkLoadError(this.state.error)
    return (
      <div role="alert" className={full ? 'flex min-h-screen items-center justify-center p-6' : 'flex justify-center py-16'}>
        <div className="card max-w-md space-y-4 p-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600">{chunk ? <WifiOff className="h-6 w-6" /> : <AlertTriangle className="h-6 w-6" />}</div>
          {chunk ? (<>
            <h2 className="text-lg font-semibold">We couldn't load this page</h2>
            <p className="text-sm text-slate-600">Your internet connection may have dropped, or a newer version of the system was released. Check your connection and reload the page. Nothing you did was lost.</p>
            <button className="btn-primary" onClick={() => window.location.reload()}><RefreshCw className="h-4 w-4" />Reload the page</button>
          </>) : (<>
            <h2 className="text-lg font-semibold">This page ran into a problem</h2>
            <p className="text-sm text-slate-600">Something went wrong while showing this screen. Your data is safe - nothing was lost or changed. Try again, or go back to the dashboard.</p>
            <div className="flex flex-wrap justify-center gap-2">
              <button className="btn-primary" onClick={() => this.setState({ error: null })}><RefreshCw className="h-4 w-4" />Try again</button>
              <button className="btn-secondary" onClick={() => { window.location.href = window.location.pathname + (window.location.hash ? '#/' : '') }}><Home className="h-4 w-4" />Go to dashboard</button>
            </div>
            <button className="text-xs text-slate-400 underline" onClick={() => window.location.reload()}>Reload the page</button>
          </>)}
        </div>
      </div>
    )
  }
}
