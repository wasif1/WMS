import { useState } from 'react'
import { t, Trans, ts } from '@/i18n'
import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import ClientSelect, { clientLabel } from '@/components/ClientSelect'
import LinesEditor, { emptyLine, toPayload, type LineDraft } from '@/components/LinesEditor'
import { LinesTable, Who } from '@/components/OrderBits'
import { Empty, ErrorBox, Field, Modal, PageHeader, PageLoader, Spinner, StatusBadge, Table, SimpleSteps } from '@/components/ui'
import { get, post } from '@/lib/api'
import { useSimple } from '@/lib/simple'
import { useAction, useLocations, useProducts } from '@/lib/hooks'
import type { StockRow } from '@/lib/types'
import { fmt, fmtDate } from '@/lib/utils'
import { productLabel } from '@/lib/catalog'

export default function Reserves() {
  const { can } = useAuth(); const { data: locs = [] } = useLocations(); const { data: prods = [] } = useProducts()
  const [creating, setCreating] = useState(false), [open, setOpen] = useState<any>(null), [status, setStatus] = useState('')
  const q = useQuery({ queryKey: ['reserves', status], queryFn: () => get<any[]>(`/reserves${status ? `?status=${status}` : ''}`), enabled: can('reserves.view') })
  return (
    <>
      <PageHeader title={t("Reserved inventory")} subtitle={t("Hold stock for future use. Reserved units are removed from available stock.")} actions={can('reserves.create') && <button className="btn-primary" onClick={() => setCreating(true)}><Plus className="h-4 w-4" />{t("New reserve order")}</button>} />
      {can('reserves.view') && <>
        <div className="mb-4 flex flex-wrap gap-2">{['', 'active', 'converted', 'cancelled'].map((s) => <button key={s} className={status === s ? 'btn-primary' : 'btn-secondary'} onClick={() => setStatus(s)}>{s || t("All")}</button>)}</div>
        {q.isLoading ? <PageLoader /> : q.error ? <ErrorBox error={q.error} onRetry={() => q.refetch()} /> : (
          <Table head={['#', t("Location"), t("Client"), t("Units"), t("Reserved by"), t("Status"), '']} empty={!q.data?.length && <Empty>{t("No reserve orders.")}</Empty>}>
            {q.data?.map((o) => <tr key={o.id} className="hover:bg-slate-50"><td className="td font-medium">#{o.id}</td><td className="td">{locs.find((l) => l.id === o.locationId)?.name}</td><td className="td">{clientLabel(o.client)}</td><td className="td">{fmt(o.lines.reduce((a: number, l: any) => a + l.qty, 0))}</td><td className="td"><p>{o.createdBy.name}</p><p className="text-xs text-slate-400">{fmtDate(o.createdBy.at)}</p></td><td className="td"><StatusBadge status={o.status} /></td><td className="td text-end"><button className="btn-ghost" onClick={() => setOpen(o)}>{o.status === 'active' && can('reserves.convert') ? t("Process") : t("View")}</button></td></tr>)}
          </Table>
        )}
      </>}
      {creating && <NewReserve onClose={() => setCreating(false)} />}
      {open && <Process order={open} prods={prods} onClose={() => setOpen(null)} />}
    </>
  )
}

export function NewReserve({ onClose }: { onClose: () => void }) {
  const simple = useSimple()
  const { data: locs = [] } = useLocations(); const { data: prods = [] } = useProducts()
  const [locationId, setLocationId] = useState<number | ''>(''), [clientId, setClientId] = useState<number | ''>(''), [note, setNote] = useState(''), [lines, setLines] = useState<LineDraft[]>([emptyLine()])
  const stock = useQuery({ queryKey: ['stock', locationId], queryFn: () => get<StockRow[]>(`/stock?locationId=${locationId}`), enabled: !!locationId })
  const save = useAction(() => post('/reserves', { locationId, clientId: clientId || undefined, note, lines: toPayload(lines) }), { ok: t("Reserve order placed - confirmation emailed"), invalidate: ['reserves', 'stock', 'dashboard'], onSuccess: onClose })
  return (
    <Modal open onClose={onClose} title={simple ? t("Keep stock for a customer") : t("New reserve order")} wide>
      <div className="space-y-4">
        {simple && <SimpleSteps steps={[t('Choose the warehouse and (if you know it) the customer.'), t('Choose each product and how many to keep aside.'), t('Press Save. Nobody else can sell these goods now.')]} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("Location")}><select className="input" value={locationId} onChange={(e) => setLocationId(Number(e.target.value) || '')}><option value="">{t("Select…")}</option>{locs.filter((l) => l.active).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
          <Field label={t("Client (optional)")}><ClientSelect value={clientId} onChange={setClientId} optional /></Field>
        </div>
        {locationId ? <LinesEditor lines={lines} onChange={setLines} products={prods} stock={stock.data ?? []} /> : <p className="text-sm text-slate-500">{t("Choose a location to see available stock.")}</p>}
        <Field label={t("Note")}><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <ErrorBox error={save.error} />
        <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={onClose}>{t("Cancel")}</button><button className="btn-primary" disabled={!locationId || save.isPending} onClick={() => save.mutate(undefined)}>{save.isPending && <Spinner />}{simple ? t("Save") : t("Place reserve order")}</button></div>
      </div>
    </Modal>
  )
}

export function Process({ order, prods, onClose }: { order: any; prods: any[]; onClose: () => void }) {
  const { can } = useAuth(); const [comment, setComment] = useState(''); const [clientId, setClientId] = useState<number | ''>(order.clientId ?? '')
  const [actual, setActual] = useState<Record<number, number>>(Object.fromEntries(order.lines.map((l: any) => [l.productId, l.qty])))
  const inv = ['reserves', 'outbound', 'stock', 'dashboard']
  const cancel = useAction(() => post(`/reserves/${order.id}/cancel`), { ok: t("Reservation released"), invalidate: inv, onSuccess: onClose })
  const convert = useAction(() => post(`/reserves/${order.id}/convert`, { actual: order.lines.map((l: any) => ({ productId: l.productId, loose: actual[l.productId] ?? 0 })), comment }), { ok: t("Moved to outbound - review and confirm it on the Outbound page"), invalidate: inv, onSuccess: onClose })
  const diff = order.lines.some((l: any) => (actual[l.productId] ?? 0) !== l.qty)
  const active = order.status === 'active' && can('reserves.convert')
  return (
    <Modal open onClose={onClose} title={t('Reserve order #{id}', { id: order.id })} wide>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1"><StatusBadge status={order.status} /><span className="text-sm"><Trans k="Client: {name}" vars={{ name: <b>{clientLabel(order.client)}</b> }} /></span><Who a={order.createdBy} label={t("Reserved by")} /><Who a={order.closedBy} label={t("Closed by")} /></div>
        {order.note && <p className="text-sm text-slate-600">{t('Note: {note}', { note: order.note })}</p>}
        {active ? (<>
          {!order.clientId && <Field label={t("A client is required to move to outbound")}><ClientSelect value={clientId} onChange={setClientId} /></Field>}
          <h3 className="text-sm font-semibold">{t("Confirm quantities leaving the warehouse")}</h3>
          <Table head={[t("Product"), t("Reserved"), t("Actually shipping")]}>{order.lines.map((l: any) => <tr key={l.productId}><td className="td">{(() => { const x = prods.find((p) => p.id === l.productId); return x ? productLabel(x) : l.productId })()}</td><td className="td">{fmt(l.qty)}</td><td className="td"><input className="input max-w-[8rem]" type="number" min={0} value={actual[l.productId] ?? 0} onChange={(e) => setActual({ ...actual, [l.productId]: Number(e.target.value) })} /></td></tr>)}</Table>
          {diff && <Field label={t("Comment (required - differs from reserved)")}><input className="input" value={comment} onChange={(e) => setComment(e.target.value)} /></Field>}
          <ErrorBox error={convert.error ?? cancel.error} />
          <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={() => cancel.mutate(undefined)}>{t("Release reservation")}</button><button className="btn-primary" disabled={convert.isPending || (diff && !comment.trim()) || (!order.clientId && !clientId)} onClick={() => convert.mutate(undefined)}>{convert.isPending && <Spinner />}{t("Move to outbound")}</button></div>
        </>) : <LinesTable lines={order.lines} products={prods} extra={order.status === 'converted' ? [{ head: ts('Shipped'), cell: (l) => fmt(l.actualQty) }, { head: ts('Difference'), cell: (l) => <span className={l.difference ? 'font-medium text-red-600' : 'text-slate-400'}>{fmt(l.difference)}</span> }] : undefined} />}
      </div>
    </Modal>
  )
}
