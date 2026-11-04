import { useState } from 'react'
import { t, ts } from '@/i18n'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import ErrorBoundary from './ErrorBoundary'
import { useQuery } from '@tanstack/react-query'
import { get } from '@/lib/api'
import { Archive, ArrowLeftRight, BadgeCheck, BarChart3, Boxes, ClipboardCheck, DatabaseBackup, Download, EyeOff, FileText, LayoutDashboard, LogOut, Menu, PackageCheck, PackageMinus, ScrollText, Settings2, ShieldCheck, SlidersHorizontal, Users, Warehouse, type LucideIcon } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { cn } from '@/lib/utils'
import ThemeToggle from './ThemeToggle'
import LanguageToggle from './LanguageToggle'
import { DEMO } from '@/lib/api'

interface Item { to: string; label: string; icon: LucideIcon; perms: string[]; superOnly?: boolean }
const groups: { title: string; items: Item[] }[] = [
  { title: ts('Overview'), items: [{ to: '/', label: ts('Dashboard'), icon: LayoutDashboard, perms: ['dashboard.view'] }] },
  { title: ts('Inventory'), items: [
    { to: '/approvals', label: ts('Approvals'), icon: BadgeCheck, perms: ['approvals.manage', 'products.create', 'locations.manage', 'adjustments.create', 'audits.create', 'audits.count'] },
    { to: '/products', label: ts('Products'), icon: Boxes, perms: ['products.view'] },
    { to: '/locations', label: ts('Locations'), icon: Warehouse, perms: ['locations.view', 'locations.manage'] },
    { to: '/adjustments', label: ts('Adjustments'), icon: SlidersHorizontal, perms: ['adjustments.view', 'adjustments.create'] },
    { to: '/audits', label: ts('Inventory audits'), icon: ClipboardCheck, perms: ['audits.view', 'audits.create'] },
  ] },
  { title: ts('Orders'), items: [
    { to: '/inbound', label: ts('Inbound'), icon: Download, perms: ['inbound.view', 'inbound.create'] },
    { to: '/transfers', label: ts('Transfers'), icon: ArrowLeftRight, perms: ['transfers.view', 'transfers.create'] },
    { to: '/reserves', label: ts('Reserved'), icon: Archive, perms: ['reserves.view', 'reserves.create'] },
    { to: '/outbound', label: ts('Outbound'), icon: PackageMinus, perms: ['outbound.view', 'outbound.create'] },
  ] },
  { title: ts('Insights'), items: [
    { to: '/reports', label: ts('Reports'), icon: BarChart3, perms: ['reports.inventory', 'reports.orders'] },
    { to: '/clients', label: ts('Clients'), icon: EyeOff, perms: ['clients.view', 'clients.manage', 'clients.reveal'] },
  ] },
  { title: ts('Administration'), items: [
    { to: '/users', label: ts('Users & access'), icon: Users, perms: [], superOnly: true },
    { to: '/backups', label: ts('Backups & settings'), icon: DatabaseBackup, perms: [], superOnly: true },
    { to: '/logs', label: ts('Activity log'), icon: ScrollText, perms: ['logs.view'] },
  ] },
]

export default function Layout() {
  const { user, can, logout } = useAuth()
  const [open, setOpen] = useState(false)
  const loc = useLocation()
  const showApprovals = can('approvals.manage', 'products.create', 'locations.manage', 'adjustments.create', 'audits.create', 'audits.count')
  const pend = useQuery({ queryKey: ['approvals', 'pending'], queryFn: () => get<{ pending: number }>('/approvals?status=pending'), enabled: showApprovals, refetchInterval: 60_000 })
  const visible = (i: Item) => (i.superOnly ? user?.role === 'super_admin' : can(...i.perms))
  return (
    <div className="min-h-screen lg:flex">
      <aside className={cn('fixed inset-y-0 start-0 z-40 flex w-64 flex-col border-e border-slate-200 bg-white transition-transform lg:static lg:translate-x-0', open ? 'translate-x-0' : '-translate-x-full')}>
        <div className="flex h-16 items-center gap-2.5 border-b border-slate-100 px-5">
          <div className="rounded-lg bg-brand-600 p-1.5 text-white"><PackageCheck className="h-5 w-5" /></div>
          <div><p className="text-sm font-semibold leading-none">{t("WMS")}</p><p className="mt-1 text-[11px] text-slate-500">{t("Warehouse Management")}</p></div>
        </div>
        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4" onClick={() => setOpen(false)}>
          {groups.map((g) => {
            const items = g.items.filter(visible)
            if (!items.length) return null
            return (
              <div key={g.title}>
                <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{t(g.title)}</p>
                {items.map((i) => (
                  <NavLink key={i.to} to={i.to} end={i.to === '/'} className={({ isActive }) => cn('flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium', isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100')}>
                    <i.icon className="h-4 w-4" />{t(i.label)}{i.to === '/approvals' && !!pend.data?.pending && <span className="ms-auto rounded-full bg-red-600 px-1.5 text-[11px] font-semibold text-white" aria-label={t("{n} awaiting approval", { n: pend.data.pending })}>{pend.data.pending}</span>}
                  </NavLink>
                ))}
              </div>
            )
          })}
        </nav>
        <div className="border-t border-slate-100 p-3">
          <NavLink to="/account" className="flex items-center gap-3 rounded-lg p-2 hover:bg-slate-100">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700">{user?.name.slice(0, 1).toUpperCase()}</div>
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{user?.name}</p><p className="flex items-center gap-1 text-xs text-slate-500">{user?.role === 'super_admin' ? <ShieldCheck className="h-3 w-3" /> : <Settings2 className="h-3 w-3" />}{user?.role.replace('_', ' ')}</p></div>
          </NavLink>
          <LanguageToggle signedIn className="mt-1 w-full justify-start" />
          <ThemeToggle className="w-full justify-start" />
          <button className="btn-ghost w-full justify-start" onClick={logout}><LogOut className="h-4 w-4" />{t("Sign out")}</button>
        </div>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-slate-900/30 lg:hidden" onClick={() => setOpen(false)} />}
      <div className="min-w-0 flex-1">
        <header className="flex h-14 items-center gap-3 border-b border-slate-200 bg-white px-4 lg:hidden">
          <button className="btn-ghost !p-2" onClick={() => setOpen(true)} aria-label={t("Open menu")}><Menu className="h-5 w-5" /></button>
          <span className="flex items-center gap-1.5 font-semibold"><FileText className="h-4 w-4 text-brand-600" />{t("WMS")}</span><span className="ms-auto flex"><LanguageToggle signedIn hideLabelOnMobile /><ThemeToggle hideLabelOnMobile /></span>
        </header>
        {DEMO && <div className="bg-amber-50 px-4 py-1.5 text-center text-xs text-amber-800">{t("Demo mode: fake data in your browser only. Not the secure production backend.")}</div>}
        <main className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8"><ErrorBoundary key={loc.pathname} variant="page"><Outlet /></ErrorBoundary></main>
      </div>
    </div>
  )
}
