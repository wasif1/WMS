import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertTriangle, ArrowLeftRight, Archive, Boxes, Download, PackageCheck, PackageMinus, Truck, Warehouse } from 'lucide-react'
import { get } from '@/lib/api'
import { Card, ErrorBox, Kpi, PageHeader, PageLoader } from '@/components/ui'
import { fmt } from '@/lib/utils'
import { useAuth } from '@/auth/AuthContext'

interface Dash {
  kpis: Record<string, number>
  byLocation: { name: string; onHand: number; reserved: number }[]
  topProducts: { name: string; onHand: number }[]
  trend: { date: string; inbound: number; outbound: number }[]
  lowStock: { sku: string; name: string; available: number; reorderLevel: number }[]
}

export default function Dashboard() {
  const { user } = useAuth()
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => get<Dash>('/dashboard'), refetchInterval: 60_000 })
  if (q.isLoading) return <PageLoader />
  if (q.error) return <ErrorBox error={q.error} />
  const { kpis: k, byLocation, topProducts, trend, lowStock } = q.data!
  const axis = { fontSize: 12, fill: '#64748b' }
  return (
    <>
      <PageHeader title={`Welcome back, ${user?.name.split(' ')[0]}`} subtitle="Live overview of inventory across all warehouses" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Total on hand" value={fmt(k.totalOnHand)} hint={`${k.activeSkus} active SKUs · ${k.locations} locations`} icon={<Boxes className="h-5 w-5" />} />
        <Kpi label="Available" value={fmt(k.available)} hint="On hand minus reserved" tone="green" icon={<PackageCheck className="h-5 w-5" />} />
        <Kpi label="Reserved" value={fmt(k.reserved)} hint={`${k.activeReserves} active reserve orders`} tone="amber" icon={<Archive className="h-5 w-5" />} />
        <Kpi label="In transit" value={fmt(k.inTransit)} hint={`${k.transfersInTransit} transfers on the way`} tone="blue" icon={<Truck className="h-5 w-5" />} />
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Inbound awaiting approval" value={k.pendingInbound} icon={<Download className="h-5 w-5" />} tone={k.pendingInbound ? 'amber' : 'green'} />
        <Kpi label="Outbound awaiting confirm" value={k.pendingOutbound} icon={<PackageMinus className="h-5 w-5" />} tone={k.pendingOutbound ? 'amber' : 'green'} />
        <Kpi label="Shipped this month" value={k.outboundThisMonth} hint="Confirmed outbound orders" icon={<ArrowLeftRight className="h-5 w-5" />} />
        <Kpi label="Low stock SKUs" value={k.lowStockCount} hint="At or below reorder level" icon={<AlertTriangle className="h-5 w-5" />} tone={k.lowStockCount ? 'red' : 'green'} />
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <h2 className="mb-4 text-sm font-semibold">Inbound vs outbound units · last 30 days</h2>
          <div className="h-64"><ResponsiveContainer>
            <AreaChart data={trend}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="date" tick={axis} tickFormatter={(d: string) => d.slice(5)} interval={4} /><YAxis tick={axis} /><Tooltip /><Legend />
              <Area type="monotone" dataKey="inbound" stroke="#10b981" fill="#10b98122" name="Inbound" /><Area type="monotone" dataKey="outbound" stroke="#6366f1" fill="#6366f122" name="Outbound" /></AreaChart>
          </ResponsiveContainer></div>
        </Card>
        <Card className="p-5">
          <h2 className="mb-4 text-sm font-semibold">Stock by location</h2>
          <div className="h-64"><ResponsiveContainer>
            <BarChart data={byLocation} layout="vertical" margin={{ left: 10 }}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis type="number" tick={axis} /><YAxis type="category" dataKey="name" tick={axis} width={90} /><Tooltip /><Legend />
              <Bar dataKey="onHand" fill="#6366f1" name="On hand" radius={[0, 4, 4, 0]} /><Bar dataKey="reserved" fill="#f59e0b" name="Reserved" radius={[0, 4, 4, 0]} /></BarChart>
          </ResponsiveContainer></div>
        </Card>
        <Card className="p-5 lg:col-span-2">
          <h2 className="mb-4 text-sm font-semibold">Top products by stock</h2>
          <div className="h-60"><ResponsiveContainer>
            <BarChart data={topProducts}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="name" tick={axis} interval={0} angle={-15} textAnchor="end" height={50} /><YAxis tick={axis} /><Tooltip /><Bar dataKey="onHand" fill="#4f46e5" name="On hand" radius={[4, 4, 0, 0]} /></BarChart>
          </ResponsiveContainer></div>
        </Card>
        <Card className="p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Warehouse className="h-4 w-4 text-slate-400" />Low stock watchlist</h2>
          {lowStock.length === 0 ? <p className="py-8 text-center text-sm text-slate-500">Everything is above its reorder level 🎉</p> :
            <ul className="divide-y divide-slate-100">{lowStock.map((l) => <li key={l.sku} className="flex items-center justify-between py-2.5 text-sm"><div><p className="font-medium">{l.sku}</p><p className="text-xs text-slate-500">{l.name}</p></div><span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">{fmt(l.available)} / {fmt(l.reorderLevel)}</span></li>)}</ul>}
          <Link to="/products" className="mt-2 block text-center text-xs font-medium text-brand-600 hover:underline">View all products</Link>
        </Card>
      </div>
    </>
  )
}
