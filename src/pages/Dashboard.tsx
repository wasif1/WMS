import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Archive, ArrowLeftRight, CheckCircle2, Clock, Download, PackageMinus, TrendingDown } from 'lucide-react'
import { get } from '@/lib/api'
import { Card, ErrorBox, Kpi, PageHeader, PageLoader } from '@/components/ui'
import { cn, fmt, fmtDate } from '@/lib/utils'
import { useAuth } from '@/auth/AuthContext'

type Period = 'week' | 'month' | 'year'
interface Dash {
  period: Period
  kpis: { inbound: number; outbound: number; reserved: number; transfers: number; pending: number; completed: number; activeReserves: number; transfersInTransit: number }
  pending: { inboundApproval: number; outboundToConfirm: number; transfersToSend: number; transfersToReceive: number; ownerApprovals: number }
  trend: { label: string; inbound: number; outbound: number; transfers: number; reserved: number }[]
  byLocation: { name: string; inbound: number; outbound: number; reserved: number; transfers: number }[]
  topProducts: { name: string; inbound: number; outbound: number; reserved: number; transfers: number; total: number }[]
  noSales: { days: number; total: number; items: { name: string; unitsOnHand: number; lastSale: string | null }[] }
}
const PERIODS: { id: Period; label: string; note: string }[] = [{ id: 'week', label: 'Weekly', note: 'last 7 days' }, { id: 'month', label: 'Monthly', note: 'last 30 days' }, { id: 'year', label: 'Yearly', note: 'last 12 months' }]
const COLORS = { inbound: '#10b981', outbound: '#6366f1', reserved: '#f59e0b', transfers: '#0ea5e9' }

export default function Dashboard() {
  const { user } = useAuth()
  const [period, setPeriod] = useState<Period>('month')
  const q = useQuery({ queryKey: ['dashboard', period], queryFn: () => get<Dash>(`/dashboard?period=${period}`), refetchInterval: 60_000, placeholderData: (p) => p })
  if (q.isLoading) return <PageLoader />
  if (q.error && !q.data) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />
  const d = q.data!, k = d.kpis
  const note = PERIODS.find((p) => p.id === period)!.note
  const axis = { fontSize: 12, fill: '#64748b' }
  const pendingParts = [d.pending.inboundApproval && `${d.pending.inboundApproval} inbound to approve`, d.pending.outboundToConfirm && `${d.pending.outboundToConfirm} outbound to confirm`, d.pending.transfersToSend && `${d.pending.transfersToSend} transfer drafts`, d.pending.ownerApprovals && `${d.pending.ownerApprovals} owner approvals`].filter(Boolean).join(' · ')
  return (
    <>
      <PageHeader title={`Welcome back, ${user?.name.split(' ')[0]}`} subtitle={`Order activity · ${note}`}
        actions={<div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5" role="tablist" aria-label="Period">{PERIODS.map((p) => <button key={p.id} role="tab" aria-selected={period === p.id} className={cn('rounded-md px-3 py-1.5 text-sm font-medium', period === p.id ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100')} onClick={() => setPeriod(p.id)}>{p.label}</button>)}</div>} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Kpi label="Inbound orders" value={fmt(k.inbound)} hint={note} icon={<Download className="h-5 w-5" />} tone="green" />
        <Kpi label="Outbound orders" value={fmt(k.outbound)} hint={note} icon={<PackageMinus className="h-5 w-5" />} />
        <Kpi label="Reserved orders" value={fmt(k.reserved)} hint={`${k.activeReserves} active right now`} icon={<Archive className="h-5 w-5" />} tone="amber" />
        <Kpi label="Pending" value={fmt(k.pending)} hint={pendingParts || 'Nothing waiting for action'} icon={<Clock className="h-5 w-5" />} tone={k.pending ? 'red' : 'green'} />
        <Kpi label="Transfers" value={fmt(k.transfers)} hint={`${k.transfersInTransit} in transit right now`} icon={<ArrowLeftRight className="h-5 w-5" />} tone="blue" />
        <Kpi label="Completed" value={fmt(k.completed)} hint={`Orders finished · ${note}`} icon={<CheckCircle2 className="h-5 w-5" />} tone="green" />
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <h2 className="mb-4 text-sm font-semibold">Orders over time · {note}</h2>
          <div className="h-64"><ResponsiveContainer>
            <BarChart data={d.trend}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} /><XAxis dataKey="label" tick={axis} tickFormatter={(l: string) => (period === 'year' ? l.slice(2) : l.slice(5))} interval={period === 'month' ? 4 : 0} /><YAxis tick={axis} allowDecimals={false} /><Tooltip /><Legend />
              <Bar dataKey="inbound" name="Inbound" stackId="a" fill={COLORS.inbound} /><Bar dataKey="outbound" name="Outbound" stackId="a" fill={COLORS.outbound} /><Bar dataKey="transfers" name="Transfers" stackId="a" fill={COLORS.transfers} /><Bar dataKey="reserved" name="Reserved" stackId="a" fill={COLORS.reserved} /></BarChart>
          </ResponsiveContainer></div>
        </Card>
        <Card className="p-5">
          <h2 className="mb-4 text-sm font-semibold">Orders by location</h2>
          <div className="h-64"><ResponsiveContainer>
            <BarChart data={d.byLocation} layout="vertical" margin={{ left: 10 }}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis type="number" tick={axis} allowDecimals={false} /><YAxis type="category" dataKey="name" tick={axis} width={90} /><Tooltip /><Legend />
              <Bar dataKey="inbound" name="Inbound" stackId="a" fill={COLORS.inbound} /><Bar dataKey="outbound" name="Outbound" stackId="a" fill={COLORS.outbound} /><Bar dataKey="transfers" name="Transfers" stackId="a" fill={COLORS.transfers} /><Bar dataKey="reserved" name="Reserved" stackId="a" fill={COLORS.reserved} /></BarChart>
          </ResponsiveContainer></div>
        </Card>
        <Card className="p-5 lg:col-span-2">
          <h2 className="mb-1 text-sm font-semibold">Top products by orders</h2>
          <p className="mb-3 text-xs text-slate-500">Number of orders containing each product · {note}</p>
          {d.topProducts.length === 0 ? <p className="py-16 text-center text-sm text-slate-500">No orders in this period.</p> : (
            <div style={{ height: Math.max(180, d.topProducts.length * 38) }}><ResponsiveContainer>
              <BarChart data={d.topProducts} layout="vertical" margin={{ left: 20 }}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis type="number" tick={axis} allowDecimals={false} /><YAxis type="category" dataKey="name" tick={axis} width={150} /><Tooltip /><Legend />
                <Bar dataKey="outbound" name="Outbound" stackId="a" fill={COLORS.outbound} /><Bar dataKey="reserved" name="Reserved" stackId="a" fill={COLORS.reserved} /><Bar dataKey="transfers" name="Transfers" stackId="a" fill={COLORS.transfers} /><Bar dataKey="inbound" name="Inbound" stackId="a" fill={COLORS.inbound} /></BarChart>
            </ResponsiveContainer></div>
          )}
        </Card>
        <Card className="p-5">
          <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold"><TrendingDown className="h-4 w-4 text-amber-500" />No sales in {d.noSales.days} days</h2>
          <p className="mb-3 text-xs text-slate-500">{d.noSales.total} active product(s) without an outbound order</p>
          {d.noSales.items.length === 0 ? <p className="py-10 text-center text-sm text-slate-500">Every active product has sold recently 🎉</p> :
            <ul className="divide-y divide-slate-100">{d.noSales.items.map((l) => <li key={l.name} className="flex items-center justify-between gap-2 py-2.5 text-sm"><div className="min-w-0"><p className="truncate font-medium">{l.name}</p><p className="text-xs text-slate-500">{l.lastSale ? `Last sale ${fmtDate(l.lastSale)}` : 'Never sold'}</p></div><span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">{fmt(l.unitsOnHand)} on hand</span></li>)}</ul>}
          <Link to="/products" className="mt-2 block text-center text-xs font-medium text-brand-600 hover:underline">View all products</Link>
        </Card>
      </div>
    </>
  )
}
