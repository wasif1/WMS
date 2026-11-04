import { useState } from 'react'
import { t, Trans } from '@/i18n'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, Pencil, Plus } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import ClientSelect, { clientLabel } from '@/components/ClientSelect'
import LinesEditor, { emptyLine, toPayload, type LineDraft } from '@/components/LinesEditor'
import { LinesTable, Who } from '@/components/OrderBits'
import { Empty, ErrorBox, Field, Modal, PageHeader, PageLoader, Spinner, StatusBadge, Table, SimpleSteps } from '@/components/ui'
import { get, post, put } from '@/lib/api'
import { useSimple } from '@/lib/simple'
import { useAction, useLocations, useProducts } from '@/lib/hooks'
import type { StockRow } from '@/lib/types'
import { fmt, fmtDate } from '@/lib/utils'

export default function Outbound() {
  const { can } = useAuth(); const { data: locs = [] } = useLocations(); const { data: prods = [] } = useProducts()
  const [form, setForm] = useState<any | 'new' | null>(null), [open, setOpen] = useState<any>(null), [status, setStatus] = useState('')
  const q = useQuery({ queryKey: ['outbound', status], queryFn: () => get<any[]>(`/outbound${status ? `?status=${status}` : ''}`), enabled: can('outbound.view') })
  return (
    <>
      <PageHeader title={t("Outbound orders")} subtitle={t("Save → review → confirm. Confirming removes the stock from the system.")} actions={can('outbound.create') && <button className="btn-primary" onClick={() => setForm('new')}><Plus className="h-4 w-4" />{t("New outbound order")}</button>} />
      {can('outbound.view') && <>
        <div className="mb-4 flex flex-wrap gap-2">{['', 'saved', 'confirmed', 'cancelled'].map((s) => <button key={s} className={status === s ? 'btn-primary' : 'btn-secondary'} onClick={() => setStatus(s)}>{s || t("All")}</button>)}</div>
        {q.isLoading ? <PageLoader /> : q.error ? <ErrorBox error={q.error} onRetry={() => q.refetch()} /> : (
          <Table head={['#', t("Location"), t("Client"), t("Units"), t("Created by"), t("Status"), '']} empty={!q.data?.length && <Empty>{t("No outbound orders.")}</Empty>}>
            {q.data?.map((o) => <tr key={o.id} className="hover:bg-slate-50"><td className="td font-medium">#{o.id}{o.sourceReserveId && <span className="ms-1 text-xs text-slate-400">{t('(from reserve #{id})', { id: o.sourceReserveId })}</span>}</td><td className="td">{locs.find((l) => l.id === o.locationId)?.name}</td><td className="td">{clientLabel(o.client)}</td><td className="td">{fmt(o.lines.reduce((a: number, l: any) => a + l.qty, 0))}</td><td className="td"><p>{o.createdBy.name}</p><p className="text-xs text-slate-400">{fmtDate(o.createdBy.at)}</p></td><td className="td"><StatusBadge status={o.status} /></td><td className="td text-end"><button className="btn-ghost" onClick={() => setOpen(o)}>{o.status === 'saved' ? t("Review") : t("View")}</button></td></tr>)}
          </Table>
        )}
      </>}
      {form && <OrderForm order={form === 'new' ? undefined : form} onClose={() => setForm(null)} />}
      {open && <Review order={open} prods={prods} onClose={() => setOpen(null)} onEdit={() => { setForm(open); setOpen(null) }} loc={locs.find((l) => l.id === open.locationId)?.name} />}
    </>
  )
}

export function OrderForm({ order, onClose }: { order?: any; onClose: () => void }) {
  const simple = useSimple()
  const { data: locs = [] } = useLocations(); const { data: prods = [] } = useProducts()
  const [locationId, setLocationId] = useState<number | ''>(order?.locationId ?? ''), [clientId, setClientId] = useState<number | ''>(order?.clientId ?? ''), [note, setNote] = useState(order?.note ?? '')
  const [lines, setLines] = useState<LineDraft[]>(order ? order.lines.map((l: any) => ({ productId: l.productId, cases: l.cases, loose: l.loose })) : [emptyLine()])
  const stock = useQuery({ queryKey: ['stock', locationId, order?.id], queryFn: async () => {
    const rows = await get<StockRow[]>(`/stock?locationId=${locationId}`)
    // when editing, this order's own allocation is already counted as reserved - give it back for display
    return order ? rows.map((r) => ({ ...r, available: r.available + (order.lines.find((l: any) => l.productId === r.productId)?.qty ?? 0) })) : rows
  }, enabled: !!locationId })
  const save = useAction(() => order ? put(`/outbound/${order.id}`, { clientId, note, lines: toPayload(lines) }) : post('/outbound', { locationId, clientId, note, lines: toPayload(lines) }), { ok: t("Outbound order saved - please review and confirm"), invalidate: ['outbound', 'stock', 'dashboard'], onSuccess: onClose })
  return (
    <Modal open onClose={onClose} title={order ? (simple ? t('Change customer order #{id}', { id: order.id }) : t('Edit outbound #{id}', { id: order.id })) : simple ? t("Send out to a customer") : t("New outbound order")} wide>
      <div className="space-y-4">
        {simple && <SimpleSteps steps={[t('Choose the warehouse the goods leave from, and the customer.'), t('Choose each product and how many. Count the boxes before you save.'), t('Press the blue button. Then press “Check & confirm” under “Waiting for you”.')]} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("Ship from")}><select className="input" disabled={!!order} value={locationId} onChange={(e) => setLocationId(Number(e.target.value) || '')}><option value="">{t("Select…")}</option>{locs.filter((l) => l.active).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
          <Field label={t("Customer")}><ClientSelect value={clientId} onChange={setClientId} /></Field>
        </div>
        {locationId ? <LinesEditor lines={lines} onChange={setLines} products={prods} stock={stock.data ?? []} /> : <p className="text-sm text-slate-500">{t("Choose a location to add products.")}</p>}
        <p className="text-xs text-slate-500">{t("Verify the physical quantity before saving. Saving holds the stock; you confirm on the next screen.")}</p>
        <Field label={t("Note")}><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <ErrorBox error={save.error} />
        <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={onClose}>{t("Cancel")}</button><button className="btn-primary" disabled={!locationId || !clientId || save.isPending} onClick={() => save.mutate(undefined)}>{save.isPending && <Spinner />}{simple ? t("Save, then check") : t("Save order")}</button></div>
      </div>
    </Modal>
  )
}

export function Review({ order, prods, loc, onClose, onEdit }: { order: any; prods: any[]; loc?: string; onClose: () => void; onEdit: () => void }) {
  const { can } = useAuth(); const inv = ['outbound', 'stock', 'dashboard', 'reserves']
  const confirm = useAction(() => post(`/outbound/${order.id}/confirm`), { ok: t("Outbound confirmed - inventory shipped"), invalidate: inv, onSuccess: onClose })
  const cancel = useAction(() => post(`/outbound/${order.id}/cancel`), { ok: t("Order cancelled, stock released"), invalidate: inv, onSuccess: onClose })
  const saved = order.status === 'saved'
  return (
    <Modal open onClose={onClose} title={t('Outbound #{id} · {loc}', { id: order.id, loc: loc ?? '' })} wide>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1"><StatusBadge status={order.status} /><span className="text-sm"><Trans k="Customer: {name}" vars={{ name: <b>{clientLabel(order.client)}</b> }} /></span><Who a={order.createdBy} label={t("Created by")} /><Who a={order.confirmedBy} label={t("Confirmed by")} /></div>
        {saved && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{t("Final review: this is the last step where you can edit before the order leaves the system.")}</div>}
        <LinesTable lines={order.lines} products={prods} />
        {order.note && <p className="text-sm text-slate-600">{t('Note: {note}', { note: order.note })}</p>}
        <ErrorBox error={confirm.error ?? cancel.error} />
        {saved && <div className="flex flex-wrap justify-end gap-2">
          {can('outbound.create') && <><button className="btn-secondary text-red-600" onClick={() => cancel.mutate(undefined)}>{t("Cancel order")}</button><button className="btn-secondary" onClick={onEdit}><Pencil className="h-4 w-4" />{t("Edit")}</button></>}
          {can('outbound.confirm') && <button className="btn-primary" disabled={confirm.isPending} onClick={() => confirm.mutate(undefined)}>{confirm.isPending ? <Spinner /> : <CheckCircle2 className="h-4 w-4" />}{t("Confirm & send out")}</button>}
        </div>}
      </div>
    </Modal>
  )
}
