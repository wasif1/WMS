import { useState } from 'react'
import { t, Trans, ts } from '@/i18n'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Archive, ArrowLeftRight, CheckCircle2, Clock, Download, PackageMinus, TrendingDown } from 'lucide-react'
import { get } from '@/lib/api'
import { Card, ErrorBox, Kpi, Num, PageHeader, PageLoader } from '@/components/ui'
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
const PERIODS: { id: Period; label: string; note: string }[] = [{ id: 'week', label: ts('Weekly'), note: ts('last 7 days') }, { id: 'month', label: ts('Monthly'), note: ts('last 30 days') }, { id: 'year', label: ts('Yearly'), note: ts('last 12 months') }]
const COLORS = { inbound: '#10b981', outbound: '#6366f1', reserved: '#f59e0b', transfers: '#0ea5e9' }

export default function Dashboard() {
  const { user } = useAuth()
  const [period, setPeriod] = useState<Period>('month')
  const q = useQuery({ queryKey: ['dashboard', period], queryFn: () => get<Dash>(`/dashboard?period=${period}`), refetchInterval: 60_000, placeholderData: (p) => p })
  if (q.isLoading) return <PageLoader />
  if (q.error && !q.data) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />
  const d = q.data!, k = d.kpis
  const note = t(PERIODS.find((p) => p.id === period)!.note)
  const axis = { fontSize: 12, fill: '#64748b' }
  const pendingParts = [d.pending.inboundApproval && t('{n} inbound to approve', { n: d.pending.inboundApproval }), d.pending.outboundToConfirm && t('{n} outbound to confirm', { n: d.pending.outboundToConfirm }), d.pending.transfersToSend && t('{n} transfer drafts', { n: d.pending.transfersToSend }), d.pending.ownerApprovals && t('{n} owner approvals', { n: d.pending.ownerApprovals })].filter(Boolean).join(' · ')
  return (
    <>
      <PageHeader title={t('Welcome back, {name}', { name: user?.name.split(' ')[0] ?? '' })} subtitle={t('Order activity · {note}', { note })}
        actions={<div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5" role="tablist" aria-label={t("Period")}>{PERIODS.map((p) => <button key={p.id} role="tab" aria-selected={period === p.id} className={cn('rounded-md px-3 py-1.5 text-sm font-medium', period === p.id ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100')} onClick={() => setPeriod(p.id)}>{t(p.label)}</button>)}</div>} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Kpi label={t("Inbound orders")} value={fmt(k.inbound)} hint={note} icon={<Download className="h-5 w-5" />} tone="green" />
        <Kpi label={t("Outbound orders")} value={fmt(k.outbound)} hint={note} icon={<PackageMinus className="h-5 w-5" />} />
        <Kpi label={t("Reserved orders")} value={fmt(k.reserved)} hint={t('{n} active right now', { n: k.activeReserves })} icon={<Archive className="h-5 w-5" />} tone="amber" />
        <Kpi label={t("Pending")} value={fmt(k.pending)} hint={pendingParts || t("Nothing waiting for action")} icon={<Clock className="h-5 w-5" />} tone={k.pending ? 'red' : 'green'} />
        <Kpi label={t("Transfers")} value={fmt(k.transfers)} hint={t('{n} in transit right now', { n: k.transfersInTransit })} icon={<ArrowLeftRight className="h-5 w-5" />} tone="blue" />
        <Kpi label={t("Completed")} value={fmt(k.completed)} hint={t('Orders finished · {note}', { note })} icon={<CheckCircle2 className="h-5 w-5" />} tone="green" />
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <h2 className="mb-4 text-sm font-semibold">{t('Orders over time · {note}', { note })}</h2>
          <div className="h-64" dir="ltr"><ResponsiveContainer>
            <BarChart data={d.trend}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} /><XAxis dataKey="label" tick={axis} tickFormatter={(l: string) => (period === 'year' ? l.slice(2) : l.slice(5))} interval={period === 'month' ? 4 : 0} /><YAxis tick={axis} allowDecimals={false} /><Tooltip /><Legend />
              <Bar dataKey="inbound" name={t("Inbound")} stackId="a" fill={COLORS.inbound} /><Bar dataKey="outbound" name={t("Outbound")} stackId="a" fill={COLORS.outbound} /><Bar dataKey="transfers" name={t("Transfers")} stackId="a" fill={COLORS.transfers} /><Bar dataKey="reserved" name={t("Reserved")} stackId="a" fill={COLORS.reserved} /></BarChart>
          </ResponsiveContainer></div>
        </Card>
        <Card className="p-5">
          <h2 className="mb-4 text-sm font-semibold">{t("Orders by location")}</h2>
          <div className="h-64" dir="ltr"><ResponsiveContainer>
            <BarChart data={d.byLocation} layout="vertical" margin={{ left: 10 }}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis type="number" tick={axis} allowDecimals={false} /><YAxis type="category" dataKey="name" tick={axis} width={90} /><Tooltip /><Legend />
              <Bar dataKey="inbound" name={t("Inbound")} stackId="a" fill={COLORS.inbound} /><Bar dataKey="outbound" name={t("Outbound")} stackId="a" fill={COLORS.outbound} /><Bar dataKey="transfers" name={t("Transfers")} stackId="a" fill={COLORS.transfers} /><Bar dataKey="reserved" name={t("Reserved")} stackId="a" fill={COLORS.reserved} /></BarChart>
          </ResponsiveContainer></div>
        </Card>
        <Card className="p-5 lg:col-span-2">
          <h2 className="mb-1 text-sm font-semibold">{t("Top products by orders")}</h2>
          <p className="mb-3 text-xs text-slate-500">{t('Number of orders containing each product · {note}', { note })}</p>
          {d.topProducts.length === 0 ? <p className="py-16 text-center text-sm text-slate-500">{t("No orders in this period.")}</p> : (
            <div dir="ltr" style={{ height: Math.max(180, d.topProducts.length * 38) }}><ResponsiveContainer>
              <BarChart data={d.topProducts} layout="vertical" margin={{ left: 20 }}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis type="number" tick={axis} allowDecimals={false} /><YAxis type="category" dataKey="name" tick={axis} width={150} /><Tooltip /><Legend />
                <Bar dataKey="outbound" name={t("Outbound")} stackId="a" fill={COLORS.outbound} /><Bar dataKey="reserved" name={t("Reserved")} stackId="a" fill={COLORS.reserved} /><Bar dataKey="transfers" name={t("Transfers")} stackId="a" fill={COLORS.transfers} /><Bar dataKey="inbound" name={t("Inbound")} stackId="a" fill={COLORS.inbound} /></BarChart>
            </ResponsiveContainer></div>
          )}
        </Card>
        <Card className="p-5">
          <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold"><TrendingDown className="h-4 w-4 text-amber-500" />{t('No sales in {n} days', { n: d.noSales.days })}</h2>
          <p className="mb-3 text-xs text-slate-500"><Trans k="{n} active product(s) without an outbound order" vars={{ n: <Num>{d.noSales.total}</Num> }} /></p>
          {d.noSales.items.length === 0 ? <p className="py-10 text-center text-sm text-slate-500">{t("Every active product has sold recently 🎉")}</p> :
            <ul className="divide-y divide-slate-100">{d.noSales.items.map((l) => <li key={l.name} className="flex items-center justify-between gap-2 py-2.5 text-sm"><div className="min-w-0"><p className="truncate font-medium">{l.name}</p><p className="text-xs text-slate-500">{l.lastSale ? t('Last sale {when}', { when: fmtDate(l.lastSale) }) : t("Never sold")}</p></div><span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">{t('{n} on hand', { n: fmt(l.unitsOnHand) })}</span></li>)}</ul>}
          <Link to="/products" className="mt-2 block text-center text-xs font-medium text-brand-600 hover:underline">{t("View all products")}</Link>
        </Card>
      </div>
    </>
  )
}
