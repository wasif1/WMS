import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { get } from '@/lib/api'
import { Badge, Card, Empty, ErrorBox, Kpi, PageHeader, PageLoader, Table } from '@/components/ui'
import { fmt, fmtDate } from '@/lib/utils'
import type { Product } from '@/lib/types'

const typeLabel: Record<string, string> = { inbound: 'Inbound', transfer_out: 'Transfer out', transfer_in: 'Transfer in', reserve: 'Reserved', unreserve: 'Released', outbound: 'Outbound', adjustment: 'Adjustment', audit: 'Audit' }

export default function ProductDetail() {
  const { id } = useParams()
  const q = useQuery({ queryKey: ['product-overview', id], queryFn: () => get<any>(`/products/${id}/overview`) })
  if (q.isLoading) return <PageLoader />
  if (q.error) return <ErrorBox error={q.error} />
  const { product: p, totals: t, byLocation, movements } = q.data as { product: Product; totals: Record<string, number>; byLocation: any[]; movements: any[] }
  return (
    <>
      <Link to="/products" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="h-4 w-4" />Products</Link>
      <PageHeader title={p.name} subtitle={`${p.sku} · ${[p.color, p.weight].filter(Boolean).join(' · ') || 'no variation'} · case pack ${p.caseSize} ${p.uom}`} actions={p.active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Total on hand" value={fmt(t.onHand)} hint={`≈ ${fmt(t.boxes)} boxes`} />
        <Kpi label="Available" value={fmt(t.available)} tone="green" />
        <Kpi label="Reserved" value={fmt(t.reserved)} tone="amber" />
        <Kpi label="In transit" value={fmt(t.inTransit)} tone="blue" />
        <Kpi label="Inbound pending" value={fmt(t.inboundPending)} hint="Awaiting approval" />
        <Kpi label="Outbound pending" value={fmt(t.outboundPending)} hint="Saved, not confirmed" tone="amber" />
        <Kpi label="Total shipped" value={fmt(t.outboundTotal)} hint="Confirmed outbound" tone="green" />
      </div>
      <h2 className="mb-3 mt-8 text-sm font-semibold">Availability by location</h2>
      <Table head={['Location', 'On hand', 'Reserved', 'Available']} empty={byLocation.length === 0 && <Empty>No stock at any location.</Empty>}>
        {byLocation.map((l) => <tr key={l.locationId}><td className="td font-medium">{l.location}</td><td className="td">{fmt(l.onHand)}</td><td className="td">{fmt(l.reserved)}</td><td className="td font-semibold">{fmt(l.available)}</td></tr>)}
      </Table>
      <h2 className="mb-3 mt-8 text-sm font-semibold">Movement history</h2>
      <Card className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-100"><thead className="bg-slate-50/70"><tr>{['When', 'Type', 'Location', 'Change', 'Reserved Δ', 'On hand after', 'By', 'Ref'].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">{movements.map((m) => <tr key={m.id}><td className="td whitespace-nowrap text-slate-600">{fmtDate(m.at)}</td><td className="td"><Badge tone={m.type === 'inbound' || m.type === 'transfer_in' ? 'green' : m.type === 'outbound' ? 'indigo' : 'gray'}>{typeLabel[m.type]}</Badge></td><td className="td">{m.location}</td><td className={`td font-medium ${m.onHandDelta < 0 ? 'text-red-600' : m.onHandDelta > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>{m.onHandDelta > 0 ? '+' : ''}{fmt(m.onHandDelta)}</td><td className="td text-slate-500">{m.reservedDelta ? (m.reservedDelta > 0 ? '+' : '') + fmt(m.reservedDelta) : '-'}</td><td className="td">{fmt(m.onHandAfter)}</td><td className="td text-slate-600">{m.user}</td><td className="td text-xs text-slate-500">{m.refType ? `${m.refType} #${m.refId}` : m.note}</td></tr>)}</tbody></table>
        {movements.length === 0 && <Empty>No movements yet.</Empty>}
      </Card>
    </>
  )
}
