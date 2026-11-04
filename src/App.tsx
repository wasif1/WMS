import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import Layout from '@/components/Layout'
import { PageLoader } from '@/components/ui'
import Login from '@/pages/Login'
import Account from '@/pages/Account'

const Dashboard = lazy(() => import('@/pages/Dashboard'))
const Products = lazy(() => import('@/pages/Products'))
const ProductDetail = lazy(() => import('@/pages/ProductDetail'))
const Locations = lazy(() => import('@/pages/Locations'))
const Inbound = lazy(() => import('@/pages/Inbound'))
const Transfers = lazy(() => import('@/pages/Transfers'))
const Reserves = lazy(() => import('@/pages/Reserves'))
const Outbound = lazy(() => import('@/pages/Outbound'))
const Adjustments = lazy(() => import('@/pages/Adjustments'))
const Audits = lazy(() => import('@/pages/Audits'))
const Reports = lazy(() => import('@/pages/Reports'))
const Clients = lazy(() => import('@/pages/Clients'))
const UsersPage = lazy(() => import('@/pages/Users'))
const Admin = lazy(() => import('@/pages/Admin'))
const Logs = lazy(() => import('@/pages/Logs'))
const Approvals = lazy(() => import('@/pages/Approvals'))

function Guard({ perms, superOnly, children }: { perms?: string[]; superOnly?: boolean; children: React.ReactNode }) {
  const { can, user } = useAuth()
  const ok = superOnly ? user?.role === 'super_admin' : !perms || can(...perms)
  return ok ? <>{children}</> : <div className="card mx-auto mt-16 max-w-md p-8 text-center"><h2 className="text-lg font-semibold">No access</h2><p className="mt-2 text-sm text-slate-500">You don't have permission to view this page. Ask a super admin if you need it.</p></div>
}

/** First page the user is allowed to see, so a "dashboard only" user (or anyone without it) lands somewhere sensible. */
function Home() {
  const { can } = useAuth()
  if (can('dashboard.view')) return <Dashboard />
  const first = [['products.view', '/products'], ['inbound.view', '/inbound'], ['transfers.view', '/transfers'], ['reserves.view', '/reserves'], ['outbound.view', '/outbound'], ['reports.inventory', '/reports']].find(([p]) => can(p))
  return first ? <Navigate to={first[1]} replace /> : <Navigate to="/account" replace />
}

export default function App() {
  const { user, loading } = useAuth()
  if (loading) return <PageLoader />
  if (!user) return <Login />
  const gated = user.mustChangePassword || user.mfaSetupRequired
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route element={<Layout />}>
          {gated ? <Route path="*" element={<Account />} /> : (<>
            <Route index element={<Home />} />
            <Route path="approvals" element={<Guard perms={['approvals.manage', 'products.create', 'locations.manage', 'adjustments.create', 'audits.create', 'audits.count']}><Approvals /></Guard>} />
            <Route path="products" element={<Guard perms={['products.view']}><Products /></Guard>} />
            <Route path="products/:id" element={<Guard perms={['products.view']}><ProductDetail /></Guard>} />
            <Route path="locations" element={<Guard perms={['locations.view', 'locations.manage']}><Locations /></Guard>} />
            <Route path="inbound" element={<Guard perms={['inbound.view', 'inbound.create']}><Inbound /></Guard>} />
            <Route path="transfers" element={<Guard perms={['transfers.view', 'transfers.create']}><Transfers /></Guard>} />
            <Route path="reserves" element={<Guard perms={['reserves.view', 'reserves.create']}><Reserves /></Guard>} />
            <Route path="outbound" element={<Guard perms={['outbound.view', 'outbound.create']}><Outbound /></Guard>} />
            <Route path="adjustments" element={<Guard perms={['adjustments.view', 'adjustments.create']}><Adjustments /></Guard>} />
            <Route path="audits" element={<Guard perms={['audits.view', 'audits.create']}><Audits /></Guard>} />
            <Route path="reports" element={<Guard perms={['reports.inventory', 'reports.orders']}><Reports /></Guard>} />
            <Route path="clients" element={<Guard perms={['clients.view', 'clients.manage', 'clients.reveal']}><Clients /></Guard>} />
            <Route path="users" element={<Guard superOnly><UsersPage /></Guard>} />
            <Route path="backups" element={<Guard superOnly><Admin /></Guard>} />
            <Route path="logs" element={<Guard perms={['logs.view']}><Logs /></Guard>} />
            <Route path="account" element={<Account />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </>)}
        </Route>
      </Routes>
    </Suspense>
  )
}
