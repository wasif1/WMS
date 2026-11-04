import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { get } from '@/lib/api'
import { Badge, Card, Empty, ErrorBox, PageHeader, PageLoader } from '@/components/ui'
import { fmt, fmtDate } from '@/lib/utils'
import { productLabel, variationOf } from '@/lib/catalog'
import type { Product } from '@/lib/types'

const typeLabel: Record<string, string> = { inbound: 'Inbound', transfer_out: 'Transfer out', transfer_in: 'Transfer in', reserve: 'Reserved', unreserve: 'Released', outbound: 'Outbound', adjustment: 'Adjustment', audit: 'Audit' }

interface Overview {
  product: Product
  totals: { onHand: number; reserved: number; available: number; boxes: number | null }
  byLocation: { locationId: number; location: string; onHand: number; reserved: number; available: number; boxes: number | null }[]
  movements: any[]
}

export default function ProductDetail() {
  const { id } = useParams()
  return <ProductOverview id={id} />
}

/** Availability by location + movement history. Used by the product page and the operator's quick-view. */
export function ProductOverview({ id, hideBack }: { id?: string | number; hideBack?: boolean }) {
  const [loc, setLoc] = useState('')
  const q = useQuery({ queryKey: ['product-overview', id, loc], queryFn: () => get<Overview>(`/products/${id}/overview${loc ? `?locationId=${loc}` : ''}`), placeholderData: (prev) => prev })
  if (q.isLoading) return <PageLoader />
  if (q.error && !q.data) return <>{!hideBack && <Link to="/products" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="h-4 w-4" />Products</Link>}<ErrorBox error={q.error} onRetry={() => q.refetch()} /></>
  const { product: p, totals: t, byLocation, movements } = q.data!
  return (
    <>
      {!hideBack && <Link to="/products" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="h-4 w-4" />Products</Link>}
      <PageHeader title={productLabel(p)} subtitle={[variationOf(p), p.weight, p.caseSize ? `case pack ${p.caseSize}` : 'sold loose', `measured in ${p.uom}`, `SKU ${p.sku}`].filter(Boolean).join(' · ')} actions={p.active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>} />

      <h2 className="mb-3 text-sm font-semibold">Availability by location</h2>
      <Card className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-100">
          <thead className="bg-slate-50/70"><tr>{['Location', 'On hand', 'Reserved', 'Total units available', 'Total boxes'].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">
            {byLocation.map((l) => <tr key={l.locationId}><td className="td font-medium">{l.location}</td><td className="td">{fmt(l.onHand)}</td><td className="td">{fmt(l.reserved)}</td><td className="td font-semibold">{fmt(l.available)}</td><td className="td">{l.boxes === null ? <span className="text-slate-400">n/a</span> : fmt(l.boxes)}</td></tr>)}
          </tbody>
          {byLocation.length > 0 && <tfoot className="border-t-2 border-slate-200 bg-slate-50/70"><tr><td className="td font-semibold">All locations</td><td className="td font-semibold">{fmt(t.onHand)}</td><td className="td font-semibold">{fmt(t.reserved)}</td><td className="td font-bold">{fmt(t.available)}</td><td className="td font-bold">{t.boxes === null ? <span className="font-normal text-slate-400">n/a</span> : fmt(t.boxes)}</td></tr></tfoot>}
        </table>
        {byLocation.length === 0 && <Empty>No stock at any location.</Empty>}
      </Card>

      <div className="mb-3 mt-8 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Movement history</h2>
        <label className="flex items-center gap-2 text-sm text-slate-600">Location
          <select className="input !w-auto" aria-label="Filter by location" value={loc} onChange={(e) => setLoc(e.target.value)}>
            <option value="">All locations</option>
            {byLocation.map((l) => <option key={l.locationId} value={l.locationId}>{l.location}</option>)}
          </select>
        </label>
      </div>
      <Card className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-100"><thead className="bg-slate-50/70"><tr>{['When', 'Type', 'Location', 'Change', 'Reserved Δ', 'On hand after', 'By', 'Ref'].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">{movements.map((m) => <tr key={m.id}><td className="td whitespace-nowrap text-slate-600">{fmtDate(m.at)}</td><td className="td"><Badge tone={m.type === 'inbound' || m.type === 'transfer_in' ? 'green' : m.type === 'outbound' ? 'indigo' : 'gray'}>{typeLabel[m.type]}</Badge></td><td className="td">{m.location}</td><td className={`td font-medium ${m.onHandDelta < 0 ? 'text-red-600' : m.onHandDelta > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>{m.onHandDelta > 0 ? '+' : ''}{fmt(m.onHandDelta)}</td><td className="td text-slate-500">{m.reservedDelta ? (m.reservedDelta > 0 ? '+' : '') + fmt(m.reservedDelta) : '-'}</td><td className="td">{fmt(m.onHandAfter)}</td><td className="td text-slate-600">{m.user}</td><td className="td text-xs text-slate-500">{m.refLabel}</td></tr>)}</tbody></table>
        {movements.length === 0 && <Empty>No movements{loc ? ' at this location' : ''} yet.</Empty>}
      </Card>
    </>
  )
}
