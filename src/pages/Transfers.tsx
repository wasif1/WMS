import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Plus, Send, Truck } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import LinesEditor, { emptyLine, toPayload, type LineDraft } from '@/components/LinesEditor'
import { LinesTable, Who } from '@/components/OrderBits'
import { Empty, ErrorBox, Field, Modal, PageHeader, PageLoader, Spinner, StatusBadge, Table, SimpleSteps } from '@/components/ui'
import { get, post } from '@/lib/api'
import { useSimple } from '@/lib/simple'
import { useAction, useLocations, useProducts } from '@/lib/hooks'
import type { StockRow } from '@/lib/types'
import { fmt, fmtDate } from '@/lib/utils'
import { productLabel } from '@/lib/catalog'

export default function Transfers() {
  const { can } = useAuth(); const { data: locs = [] } = useLocations(); const { data: prods = [] } = useProducts()
  const [creating, setCreating] = useState(false); const [open, setOpen] = useState<any>(null); const [status, setStatus] = useState('')
  const q = useQuery({ queryKey: ['transfers', status], queryFn: () => get<any[]>(`/transfers${status ? `?status=${status}` : ''}`), enabled: can('transfers.view') })
  const loc = (id: number) => locs.find((l) => l.id === id)?.name ?? id
  return (
    <>
      <PageHeader title="Transfer orders" subtitle="Move inventory between locations. Stock stays 'in transit' until the receiver confirms." actions={can('transfers.create') && <button className="btn-primary" onClick={() => setCreating(true)}><Plus className="h-4 w-4" />New transfer</button>} />
      {can('transfers.view') && <>
        <div className="mb-4 flex flex-wrap gap-2">{['', 'draft', 'in_transit', 'received'].map((s) => <button key={s} className={status === s ? 'btn-primary' : 'btn-secondary'} onClick={() => setStatus(s)}>{s ? s.replace('_', ' ') : 'All'}</button>)}</div>
        {q.isLoading ? <PageLoader /> : q.error ? <ErrorBox error={q.error} onRetry={() => q.refetch()} /> : (
          <Table head={['#', 'Route', 'Units', 'Created by', 'Status', '']} empty={!q.data?.length && <Empty>No transfers.</Empty>}>
            {q.data?.map((o) => <tr key={o.id} className="hover:bg-slate-50"><td className="td font-medium">#{o.id}</td><td className="td"><span className="inline-flex items-center gap-1.5">{loc(o.fromLocationId)}<ArrowRight className="h-3.5 w-3.5 text-slate-400" />{loc(o.toLocationId)}</span></td><td className="td">{fmt(o.lines.reduce((a: number, l: any) => a + l.qty, 0))}</td><td className="td"><p>{o.createdBy.name}</p><p className="text-xs text-slate-400">{fmtDate(o.createdBy.at)}</p></td><td className="td"><StatusBadge status={o.status} /></td>
              <td className="td text-right"><button className="btn-ghost" onClick={() => setOpen(o)}>{o.status === 'in_transit' && can('transfers.receive') ? 'Receive' : o.status === 'draft' && can('transfers.create') ? 'Submit' : 'View'}</button></td></tr>)}
          </Table>
        )}
      </>}
      {creating && <NewTransfer onClose={() => setCreating(false)} />}
      {open && <Detail order={open} onClose={() => setOpen(null)} prods={prods} loc={loc} />}
    </>
  )
}

export function NewTransfer({ onClose }: { onClose: () => void }) {
  const simple = useSimple()
  const { data: locs = [] } = useLocations(); const { data: prods = [] } = useProducts()
  const [from, setFrom] = useState<number | ''>(''), [to, setTo] = useState<number | ''>(''), [note, setNote] = useState(''), [lines, setLines] = useState<LineDraft[]>([emptyLine()])
  const stock = useQuery({ queryKey: ['stock', from], queryFn: () => get<StockRow[]>(`/stock?locationId=${from}`), enabled: !!from })
  const save = useAction(() => post('/transfers', { fromLocationId: from, toLocationId: to, note, lines: toPayload(lines) }), { ok: 'Transfer order created (draft)', invalidate: ['transfers'], onSuccess: onClose })
  return (
    <Modal open onClose={onClose} title={simple ? 'Move stock' : 'New transfer order'} wide>
      <div className="space-y-4">
        {simple && <SimpleSteps steps={['“From” is where the goods are now. “To” is where they are going.', 'Choose each product and type how many to move.', 'Press Save. Then press “Send it” under “Waiting for you”.']} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="From (source)"><select className="input" value={from} onChange={(e) => setFrom(Number(e.target.value) || '')}><option value="">Select…</option>{locs.filter((l) => l.active).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
          <Field label="To (destination)"><select className="input" value={to} onChange={(e) => setTo(Number(e.target.value) || '')}><option value="">Select…</option>{locs.filter((l) => l.active && l.id !== from).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
        </div>
        {from ? <LinesEditor lines={lines} onChange={setLines} products={prods} stock={stock.data ?? []} /> : <p className="text-sm text-slate-500">Choose a source location to see available quantities.</p>}
        <Field label="Note"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. requested by …" /></Field>
        <ErrorBox error={save.error} />
        <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={!from || !to || save.isPending} onClick={() => save.mutate(undefined)}>{save.isPending && <Spinner />}{simple ? 'Save' : 'Create draft'}</button></div>
      </div>
    </Modal>
  )
}

export function Detail({ order, prods, loc, onClose }: { order: any; prods: any[]; loc: (id: number) => any; onClose: () => void }) {
  const simple = useSimple()
  const { can } = useAuth(); const [comment, setComment] = useState('')
  const [received, setReceived] = useState<Record<number, number>>(Object.fromEntries(order.lines.map((l: any) => [l.productId, l.qty])))
  const inv = ['transfers', 'dashboard', 'stock']
  const submit = useAction(() => post(`/transfers/${order.id}/submit`), { ok: 'Transfer sent - inventory is now in transit', invalidate: inv, onSuccess: onClose })
  const cancel = useAction(() => post(`/transfers/${order.id}/cancel`), { ok: 'Cancelled', invalidate: inv, onSuccess: onClose })
  const receive = useAction(() => post(`/transfers/${order.id}/receive`, { received: order.lines.map((l: any) => ({ productId: l.productId, loose: received[l.productId] ?? 0 })), comment }), { ok: 'Received - inventory updated', invalidate: inv, onSuccess: onClose })
  const differs = order.lines.some((l: any) => (received[l.productId] ?? 0) !== l.qty)
  return (
    <Modal open onClose={onClose} title={`Transfer #${order.id}`} wide>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1"><StatusBadge status={order.status} /><span className="text-sm">{loc(order.fromLocationId)} → {loc(order.toLocationId)}</span><Who a={order.createdBy} label="Created by" /><Who a={order.submittedBy} label="Sent by" /></div>
        {order.receivedBy && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800"><b>Received</b> by {order.receivedBy.name} at {order.receivedBy.location} · {fmtDate(order.receivedBy.at)}</p>}
        {order.note && <p className="text-sm text-slate-600">Note: {order.note}</p>}
        {order.status === 'in_transit' && can('transfers.receive') ? (<>
          <h3 className="flex items-center gap-2 text-sm font-semibold"><Truck className="h-4 w-4" />Verify physical inventory received</h3>
          <Table head={['Product', 'Sent', 'Received']}>{order.lines.map((l: any) => <tr key={l.productId}><td className="td">{(() => { const x = prods.find((p) => p.id === l.productId); return x ? productLabel(x) : l.productId })()}</td><td className="td">{fmt(l.qty)}</td><td className="td"><input className="input max-w-[8rem]" type="number" min={0} value={received[l.productId] ?? 0} onChange={(e) => setReceived({ ...received, [l.productId]: Number(e.target.value) })} /></td></tr>)}</Table>
          {differs && <Field label="Comment (required - quantities differ)"><input className="input" value={comment} onChange={(e) => setComment(e.target.value)} /></Field>}
          <ErrorBox error={receive.error} /><div className="flex justify-end"><button className="btn-primary" disabled={receive.isPending || (differs && !comment.trim())} onClick={() => receive.mutate(undefined)}>{receive.isPending && <Spinner />}Receive inventory</button></div>
        </>) : <LinesTable lines={order.lines} products={prods} extra={order.discrepancy?.length ? [{ head: 'Received', cell: (l) => fmt(order.receivedLines?.find((r: any) => r.productId === l.productId)?.qty) }] : undefined} />}
        {order.status === 'draft' && can('transfers.create') && <><ErrorBox error={submit.error} /><div className="flex justify-end gap-2"><button className="btn-secondary" onClick={() => cancel.mutate(undefined)}>Cancel draft</button><button className="btn-primary" disabled={submit.isPending} onClick={() => submit.mutate(undefined)}><Send className="h-4 w-4" />{simple ? 'Send it' : 'Submit transfer'}</button></div></>}
      </div>
    </Modal>
  )
}
