import { Fragment, useState } from 'react'
import { useUoms } from '@/lib/uoms'
import { moveLabel, uomShort } from '@/i18n/labels'
import { movementRef } from '@/i18n/describe'
import { t, Trans, ts } from '@/i18n'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { get } from '@/lib/api'
import { Badge, Card, Empty, ErrorBox, Num, PageHeader, PageLoader } from '@/components/ui'
import { fmt, fmtDate } from '@/lib/utils'
import { productLabel, variationOf } from '@/lib/catalog'
import type { Product } from '@/lib/types'


interface Overview {
  product: Product
  totals: { onHand: number; reserved: number; available: number; boxes: number | null; inTransit: number }
  byLocation: { locationId: number; location: string; onHand: number; reserved: number; available: number; boxes: number | null; inTransit: number; inTransitFrom: string[] }[]
  movements: any[]
}

export default function ProductDetail() {
  useUoms() // keep unit names / decimal rules fresh after the super admin changes them
  const { id } = useParams()
  return <ProductOverview id={id} />
}

/** Availability by location + movement history. Used by the product page and the operator's quick-view. */
export function ProductOverview({ id, hideBack }: { id?: string | number; hideBack?: boolean }) {
  const [loc, setLoc] = useState('')
  const q = useQuery({ queryKey: ['product-overview', id, loc], queryFn: () => get<Overview>(`/products/${id}/overview${loc ? `?locationId=${loc}` : ''}`), placeholderData: (prev) => prev })
  if (q.isLoading) return <PageLoader />
  if (q.error && !q.data) return <>{!hideBack && <Link to="/products" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="h-4 w-4 rtl:rotate-180" />{t("Products")}</Link>}<ErrorBox error={q.error} onRetry={() => q.refetch()} /></>
  const { product: p, totals: tot, byLocation, movements } = q.data!
  return (
    <>
      {!hideBack && <Link to="/products" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="h-4 w-4 rtl:rotate-180" />{t("Products")}</Link>}
      <PageHeader title={productLabel(p)} subtitle={<>{[variationOf(p), p.weight, p.caseSize ? <Trans key="cp" k="case pack {n}" vars={{ n: <Num>{p.caseSize}</Num> }} /> : t('sold loose'), t('measured in {u}', { u: uomShort(p.uom) }), t('SKU {sku}', { sku: p.sku })].filter(Boolean).flatMap((x, i) => (i ? [' · ', x] : [x])).map((x, i) => <Fragment key={i}>{x}</Fragment>)}</>} actions={p.active ? <Badge tone="green">{t("Active")}</Badge> : <Badge>{t("Inactive")}</Badge>} />

      <h2 className="mb-3 text-sm font-semibold">{t("Availability by location")}</h2>
      <Card className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-100">
          <thead className="bg-slate-50/70"><tr>{[ts('Location'), ts('Total inventory'), ts('Reserved'), ts('In Transit'), ts('On hand'), ts('Total boxes')].map((h) => <th key={h} className="th">{t(h)}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">
            {byLocation.map((l) => <tr key={l.locationId}><td className="td font-medium">{l.location}</td><td className="td">{fmt(l.onHand)}</td><td className="td">{fmt(l.reserved)}</td><td className="td">{l.inTransit > 0 ? <span className="font-semibold text-sky-700">{fmt(l.inTransit)}<span className="block text-xs font-normal text-slate-500">{t('from {place}', { place: l.inTransitFrom.join(', ') })}</span></span> : <span className="text-slate-400">0</span>}</td><td className="td font-semibold">{fmt(l.available)}</td><td className="td">{l.boxes === null ? <span className="text-slate-400">n/a</span> : fmt(l.boxes)}</td></tr>)}
          </tbody>
          {byLocation.length > 0 && <tfoot className="border-t-2 border-slate-200 bg-slate-50/70"><tr><td className="td font-semibold">{t("All locations")}</td><td className="td font-semibold">{fmt(tot.onHand)}</td><td className="td font-semibold">{fmt(tot.reserved)}</td><td className="td font-bold">{tot.inTransit > 0 ? <span className="text-sky-700">{fmt(tot.inTransit)}</span> : <span className="font-normal text-slate-400">0</span>}</td><td className="td font-bold">{fmt(tot.available)}</td><td className="td font-bold">{tot.boxes === null ? <span className="font-normal text-slate-400">n/a</span> : fmt(tot.boxes)}</td></tr></tfoot>}
        </table>
        {byLocation.length === 0 && <Empty>{t("No stock at any location.")}</Empty>}
      </Card>

      <div className="mb-3 mt-8 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">{t("Movement history")}</h2>
        <label className="flex items-center gap-2 text-sm text-slate-600">{t("Location")}
          <select className="input !w-auto" aria-label={t("Filter by location")} value={loc} onChange={(e) => setLoc(e.target.value)}>
            <option value="">{t("All locations")}</option>
            {byLocation.map((l) => <option key={l.locationId} value={l.locationId}>{l.location}</option>)}
          </select>
        </label>
      </div>
      <Card className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-100"><thead className="bg-slate-50/70"><tr>{[ts('When'), ts('Type'), ts('Location'), ts('Change'), ts('Reserved Δ'), ts('On hand after'), ts('Action by'), ts('Approved by'), ts('Ref')].map((h) => <th key={h} className="th">{t(h)}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">{movements.map((m) => <tr key={m.id}><td className="td whitespace-nowrap text-slate-600">{fmtDate(m.at)}</td><td className="td"><Badge tone={m.type === 'inbound' || m.type === 'transfer_in' ? 'green' : m.type === 'outbound' ? 'indigo' : 'gray'}>{moveLabel(m.type)}</Badge></td><td className="td">{m.location}</td><td className={`td font-medium ${m.onHandDelta < 0 ? 'text-red-600' : m.onHandDelta > 0 ? 'text-emerald-600' : 'text-slate-400'}`}><span dir="ltr">{m.onHandDelta > 0 ? '+' : ''}{fmt(m.onHandDelta)}</span></td><td className="td text-slate-500"><span dir="ltr">{m.reservedDelta ? (m.reservedDelta > 0 ? '+' : '') + fmt(m.reservedDelta) : '-'}</span></td><td className="td">{fmt(m.onHandAfter)}</td><td className="td text-slate-700">{m.actionBy ?? m.user}</td><td className="td text-slate-600">{m.user}</td><td className="td text-xs text-slate-500">{movementRef(m)}</td></tr>)}</tbody></table>
        {movements.length === 0 && <Empty>{loc ? t('No movements at this location yet.') : t('No movements yet.')}</Empty>}
      </Card>
    </>
  )
}
