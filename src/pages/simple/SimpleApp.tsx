import { Link, Navigate, Route, Routes } from 'react-router-dom'
import { LogOut, PackageCheck, Type, UserCircle } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import ErrorBoundary from '@/components/ErrorBoundary'
import ThemeToggle from '@/components/ThemeToggle'
import { useTextSize } from '@/lib/theme'
import Account from '../Account'
import SimpleHome from './SimpleHome'

/** One page, no side menu. The header has only the few things a staff member needs. */
export default function SimpleApp({ gated }: { gated: boolean }) {
  const { user, logout } = useAuth()
  const size = useTextSize()
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-3">
          <Link to="/" className="flex items-center gap-3">
            <span className="rounded-xl bg-brand-600 p-2 text-white"><PackageCheck className="h-6 w-6" /></span>
            <span><span className="block text-lg font-bold leading-none text-slate-900">Warehouse</span><span className="text-sm text-slate-500">{user?.name}</span></span>
          </Link>
          <nav className="flex flex-wrap items-center gap-1.5" aria-label="Page options">
            <button type="button" className="btn-secondary !h-11 !text-base" aria-pressed={size.large} onClick={size.toggle}><Type className="h-5 w-5" /><span className="hidden sm:inline">{size.large ? 'Normal text' : 'Bigger text'}</span></button>
            <ThemeToggle hideLabelOnMobile className="!h-11 !border !border-slate-300 !bg-white !text-base" />
            {!gated && <Link to="/account" className="btn-secondary !h-11 !text-base"><UserCircle className="h-5 w-5" /><span className="hidden sm:inline">My account</span></Link>}
            <button type="button" className="btn-secondary !h-11 !text-base" onClick={logout}><LogOut className="h-5 w-5" /><span className="hidden sm:inline">Sign out</span></button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-4 pb-16 sm:p-6">
        <ErrorBoundary variant="page">
          {gated ? <Account /> : (
            <Routes>
              <Route index element={<SimpleHome />} />
              <Route path="account" element={<div><Link to="/" className="mb-4 inline-flex items-center gap-2 text-lg font-semibold text-brand-700">← Back to my page</Link><Account /></div>} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          )}
        </ErrorBoundary>
      </main>
    </div>
  )
}
