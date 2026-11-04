import { useState } from 'react'
import { t } from '@/i18n'
import { useQuery } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { Empty, ErrorBox, PageHeader, PageLoader, Table, StatusBadge, useToast } from '@/components/ui'
import { downloadCsv, get } from '@/lib/api'
import { useLocations } from '@/lib/hooks'
import { fmt, fmtDate } from '@/lib/utils'

export default function Reports() {
  const { can } = useAuth(); const [tab, setTab] = useState<'inventory' | 'orders'>(can('reports.inventory') ? 'inventory' : 'orders')
  return (
    <>
      <PageHeader title={t("Reports")} subtitle={t("Stock and order reports with filters and CSV export")} />
      <div className="mb-5 flex gap-2 border-b border-slate-200">
        {can('reports.inventory') && <button className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === 'inventory' ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500'}`} onClick={() => setTab('inventory')}>{t("Inventory")}</button>}
        {can('reports.orders') && <button className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === 'orders' ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500'}`} onClick={() => setTab('orders')}>{t("Orders")}</button>}
      </div>
      {tab === 'inventory' ? <Inventory /> : <Orders />}
    </>
  )
}

function Inventory() {
  const { data: locs = [] } = useLocations(); const [loc, setLoc] = useState(''); const toast = useToast()
  const qs = loc ? `?locationId=${loc}` : ''
  const q = useQuery({ queryKey: ['rep-inv', loc], queryFn: () => get<any[]>(`/reports/inventory${qs}`) })
  return (<>
    <div className="mb-4 flex flex-wrap items-center gap-3"><select className="input max-w-xs" value={loc} onChange={(e) => setLoc(e.target.value)}><option value="">{t("All warehouses")}</option>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
      <button className="btn-secondary" onClick={() => downloadCsv(`/reports/inventory${qs ? qs + '&' : '?'}format=csv`, 'inventory-report.csv').catch((e) => toast('err', e.message))}><Download className="h-4 w-4" />{t("Export CSV")}</button></div>
    {q.isLoading ? <PageLoader /> : q.error ? <ErrorBox error={q.error} onRetry={() => q.refetch()} /> : (
      <Table head={[t("SKU"), t("Product"), t("Variation"), t("Location"), t("Case pack"), t("On hand"), t("Reserved"), t("Available"), t("Boxes")]} empty={!q.data?.length && <Empty>{t("No stock to report.")}</Empty>}>
        {q.data?.map((r, i) => <tr key={i}><td className="td font-mono text-xs">{r.SKU}</td><td className="td">{r.Product}</td><td className="td text-slate-600">{r.Variation || '-'}</td><td className="td">{r.Location}</td><td className="td">{r['Case pack']}</td><td className="td">{fmt(r['On hand'])}</td><td className="td">{fmt(r.Reserved)}</td><td className="td font-semibold">{fmt(r.Available)}</td><td className="td">{fmt(r.Boxes)}</td></tr>)}
      </Table>)}
  </>)
}

function Orders() {
  const { data: locs = [] } = useLocations(); const toast = useToast()
  const [f, setF] = useState({ type: '', status: '', locationId: '', from: '', to: '' })
  const qs = '?' + new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]).toString()
  const q = useQuery({ queryKey: ['rep-ord', qs], queryFn: () => get<any[]>(`/reports/orders${qs}`) })
  const set = (k: string, v: string) => setF({ ...f, [k]: v })
  return (<>
    <div className="mb-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <select className="input" value={f.type} onChange={(e) => set('type', e.target.value)}><option value="">{t("All types")}</option><option value="inbound">{t("Inbound")}</option><option value="transfer">{t("Transfer")}</option><option value="reserve">{t("Reserve")}</option><option value="outbound">{t("Outbound")}</option></select>
      <select className="input" value={f.status} onChange={(e) => set('status', e.target.value)}><option value="">{t("Any status")}</option>{['pending', 'approved', 'rejected', 'draft', 'in_transit', 'received', 'active', 'converted', 'saved', 'confirmed', 'cancelled'].map((s) => <option key={s}>{s}</option>)}</select>
      <select className="input" value={f.locationId} onChange={(e) => set('locationId', e.target.value)}><option value="">{t("All locations")}</option>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
      <input className="input" type="date" value={f.from} onChange={(e) => set('from', e.target.value)} aria-label={t("From date")} /><input className="input" type="date" value={f.to} onChange={(e) => set('to', e.target.value)} aria-label={t("To date")} />
      <button className="btn-secondary" onClick={() => downloadCsv(`/reports/orders${qs}${qs.length > 1 ? '&' : ''}format=csv`, 'orders-report.csv').catch((e) => toast('err', e.message))}><Download className="h-4 w-4" />{t("Export CSV")}</button>
    </div>
    {q.isLoading ? <PageLoader /> : q.error ? <ErrorBox error={q.error} onRetry={() => q.refetch()} /> : (
      <Table head={[t("Type"), '#', t("Date"), t("Status"), t("Location"), t("Client"), t("Lines"), t("Units"), t("By")]} empty={!q.data?.length && <Empty>{t("No orders match.")}</Empty>}>
        {q.data?.map((r, i) => <tr key={i}><td className="td capitalize">{r.Type}</td><td className="td">#{r.Number}</td><td className="td whitespace-nowrap text-slate-600">{fmtDate(r.Date)}</td><td className="td"><StatusBadge status={r.Status} /></td><td className="td">{r.Location}</td><td className="td">{r.Client || '-'}</td><td className="td">{r.Lines}</td><td className="td">{fmt(r.Units)}</td><td className="td">{r['Created by']}</td></tr>)}
      </Table>)}
  </>)
}
