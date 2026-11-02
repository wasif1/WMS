import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, Pencil, Plus } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import ClientSelect, { clientLabel } from '@/components/ClientSelect'
import LinesEditor, { emptyLine, toPayload, type LineDraft } from '@/components/LinesEditor'
import { LinesTable, Who } from '@/components/OrderBits'
import { Empty, ErrorBox, Field, Modal, PageHeader, PageLoader, Spinner, StatusBadge, Table } from '@/components/ui'
import { get, post, put } from '@/lib/api'
import { useAction, useLocations, useProducts } from '@/lib/hooks'
import type { StockRow } from '@/lib/types'
import { fmt, fmtDate } from '@/lib/utils'

export default function Outbound() {
  const { can } = useAuth(); const { data: locs = [] } = useLocations(); const { data: prods = [] } = useProducts()
  const [form, setForm] = useState<any | 'new' | null>(null), [open, setOpen] = useState<any>(null), [status, setStatus] = useState('')
  const q = useQuery({ queryKey: ['outbound', status], queryFn: () => get<any[]>(`/outbound${status ? `?status=${status}` : ''}`), enabled: can('outbound.view') })
  return (
    <>
      <PageHeader title="Outbound orders" subtitle="Save → review → confirm. Confirming removes the stock from the system." actions={can('outbound.create') && <button className="btn-primary" onClick={() => setForm('new')}><Plus className="h-4 w-4" />New outbound order</button>} />
      {can('outbound.view') && <>
        <div className="mb-4 flex flex-wrap gap-2">{['', 'saved', 'confirmed', 'cancelled'].map((s) => <button key={s} className={status === s ? 'btn-primary' : 'btn-secondary'} onClick={() => setStatus(s)}>{s || 'All'}</button>)}</div>
        {q.isLoading ? <PageLoader /> : (
          <Table head={['#', 'Location', 'Client', 'Units', 'Created by', 'Status', '']} empty={!q.data?.length && <Empty>No outbound orders.</Empty>}>
            {q.data?.map((o) => <tr key={o.id} className="hover:bg-slate-50"><td className="td font-medium">#{o.id}{o.sourceReserveId && <span className="ml-1 text-xs text-slate-400">(from R#{o.sourceReserveId})</span>}</td><td className="td">{locs.find((l) => l.id === o.locationId)?.name}</td><td className="td">{clientLabel(o.client)}</td><td className="td">{fmt(o.lines.reduce((a: number, l: any) => a + l.qty, 0))}</td><td className="td"><p>{o.createdBy.name}</p><p className="text-xs text-slate-400">{fmtDate(o.createdBy.at)}</p></td><td className="td"><StatusBadge status={o.status} /></td><td className="td text-right"><button className="btn-ghost" onClick={() => setOpen(o)}>{o.status === 'saved' ? 'Review' : 'View'}</button></td></tr>)}
          </Table>
        )}
      </>}
      {form && <OrderForm order={form === 'new' ? undefined : form} onClose={() => setForm(null)} />}
      {open && <Review order={open} prods={prods} onClose={() => setOpen(null)} onEdit={() => { setForm(open); setOpen(null) }} loc={locs.find((l) => l.id === open.locationId)?.name} />}
    </>
  )
}

function OrderForm({ order, onClose }: { order?: any; onClose: () => void }) {
  const { data: locs = [] } = useLocations(); const { data: prods = [] } = useProducts()
  const [locationId, setLocationId] = useState<number | ''>(order?.locationId ?? ''), [clientId, setClientId] = useState<number | ''>(order?.clientId ?? ''), [note, setNote] = useState(order?.note ?? '')
  const [lines, setLines] = useState<LineDraft[]>(order ? order.lines.map((l: any) => ({ productId: l.productId, cases: l.cases, loose: l.loose })) : [emptyLine()])
  const stock = useQuery({ queryKey: ['stock', locationId, order?.id], queryFn: async () => {
    const rows = await get<StockRow[]>(`/stock?locationId=${locationId}`)
    // when editing, this order's own allocation is already counted as reserved - give it back for display
    return order ? rows.map((r) => ({ ...r, available: r.available + (order.lines.find((l: any) => l.productId === r.productId)?.qty ?? 0) })) : rows
  }, enabled: !!locationId })
  const save = useAction(() => order ? put(`/outbound/${order.id}`, { clientId, note, lines: toPayload(lines) }) : post('/outbound', { locationId, clientId, note, lines: toPayload(lines) }), { ok: 'Outbound order saved - please review and confirm', invalidate: ['outbound', 'stock', 'dashboard'], onSuccess: onClose })
  return (
    <Modal open onClose={onClose} title={order ? `Edit outbound #${order.id}` : 'New outbound order'} wide>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Ship from"><select className="input" disabled={!!order} value={locationId} onChange={(e) => setLocationId(Number(e.target.value) || '')}><option value="">Select…</option>{locs.filter((l) => l.active).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
          <Field label="Customer"><ClientSelect value={clientId} onChange={setClientId} /></Field>
        </div>
        {locationId ? <LinesEditor lines={lines} onChange={setLines} products={prods} stock={stock.data ?? []} /> : <p className="text-sm text-slate-500">Choose a location to add products.</p>}
        <p className="text-xs text-slate-500">Verify the physical quantity before saving. Saving holds the stock; you confirm on the next screen.</p>
        <Field label="Note"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <ErrorBox error={save.error} />
        <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={!locationId || !clientId || save.isPending} onClick={() => save.mutate(undefined)}>{save.isPending && <Spinner />}Save order</button></div>
      </div>
    </Modal>
  )
}

function Review({ order, prods, loc, onClose, onEdit }: { order: any; prods: any[]; loc?: string; onClose: () => void; onEdit: () => void }) {
  const { can } = useAuth(); const inv = ['outbound', 'stock', 'dashboard', 'reserves']
  const confirm = useAction(() => post(`/outbound/${order.id}/confirm`), { ok: 'Outbound confirmed - inventory shipped', invalidate: inv, onSuccess: onClose })
  const cancel = useAction(() => post(`/outbound/${order.id}/cancel`), { ok: 'Order cancelled, stock released', invalidate: inv, onSuccess: onClose })
  const saved = order.status === 'saved'
  return (
    <Modal open onClose={onClose} title={`Outbound #${order.id} · ${loc ?? ''}`} wide>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1"><StatusBadge status={order.status} /><span className="text-sm">Customer: <b>{clientLabel(order.client)}</b></span><Who a={order.createdBy} label="Created by" /><Who a={order.confirmedBy} label="Confirmed by" /></div>
        {saved && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Final review: this is the last step where you can edit before the order leaves the system.</div>}
        <LinesTable lines={order.lines} products={prods} />
        {order.note && <p className="text-sm text-slate-600">Note: {order.note}</p>}
        <ErrorBox error={confirm.error ?? cancel.error} />
        {saved && <div className="flex flex-wrap justify-end gap-2">
          {can('outbound.create') && <><button className="btn-secondary text-red-600" onClick={() => cancel.mutate(undefined)}>Cancel order</button><button className="btn-secondary" onClick={onEdit}><Pencil className="h-4 w-4" />Edit</button></>}
          {can('outbound.confirm') && <button className="btn-primary" disabled={confirm.isPending} onClick={() => confirm.mutate(undefined)}>{confirm.isPending ? <Spinner /> : <CheckCircle2 className="h-4 w-4" />}Confirm & send out</button>}
        </div>}
      </div>
    </Modal>
  )
}
