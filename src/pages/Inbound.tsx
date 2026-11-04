import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, FileUp, Plus, X } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import LinesEditor, { emptyLine, toPayload, type LineDraft } from '@/components/LinesEditor'
import { LinesTable, Who } from '@/components/OrderBits'
import { Empty, ErrorBox, Field, Modal, PageHeader, PageLoader, Spinner, StatusBadge, Table, useToast, SimpleSteps } from '@/components/ui'
import { get, post } from '@/lib/api'
import { useSimple } from '@/lib/simple'
import { useAction, useLocations, useProducts } from '@/lib/hooks'
import { fmt, fmtDate } from '@/lib/utils'

export default function Inbound() {
  const { can } = useAuth()
  const { data: locs } = useLocations()
  const [status, setStatus] = useState(''); const [creating, setCreating] = useState(false); const [open, setOpen] = useState<any>(null)
  const q = useQuery({ queryKey: ['inbound', status], queryFn: () => get<any[]>(`/inbound${status ? `?status=${status}` : ''}`), enabled: can('inbound.view') })
  const loc = (id: number) => locs?.find((l) => l.id === id)?.name ?? id
  return (
    <>
      <PageHeader title="Inbound orders" subtitle="Packing lists received at a warehouse. Stock is added when a second person approves." actions={can('inbound.create') && <button className="btn-primary" onClick={() => setCreating(true)}><Plus className="h-4 w-4" />New inbound order</button>} />
      {can('inbound.view') && <>
        <div className="mb-4 flex gap-2">{['', 'pending', 'approved', 'rejected'].map((s) => <button key={s} className={status === s ? 'btn-primary' : 'btn-secondary'} onClick={() => setStatus(s)}>{s || 'All'}</button>)}</div>
        {q.isLoading ? <PageLoader /> : q.error ? <ErrorBox error={q.error} onRetry={() => q.refetch()} /> : (
          <Table head={['#', 'Location', 'Reference', 'Units', 'Entered by', 'Status', '']} empty={!q.data?.length && <Empty>No inbound orders.</Empty>}>
            {q.data?.map((o) => (
              <tr key={o.id} className="hover:bg-slate-50"><td className="td font-medium">#{o.id}</td><td className="td">{loc(o.locationId)}</td><td className="td text-slate-600">{o.reference || '-'}</td>
                <td className="td">{fmt(o.lines.reduce((a: number, l: any) => a + l.qty, 0))}</td><td className="td"><p>{o.enteredBy.name}</p><p className="text-xs text-slate-400">{fmtDate(o.enteredBy.at)}</p></td><td className="td"><StatusBadge status={o.status} /></td>
                <td className="td text-right"><button className="btn-ghost" onClick={() => setOpen(o)}>{o.status === 'pending' && can('inbound.approve') ? 'Review' : 'View'}</button></td></tr>
            ))}
          </Table>
        )}
      </>}
      {creating && <NewInbound onClose={() => setCreating(false)} />}
      {open && <Review order={open} onClose={() => setOpen(null)} loc={String(loc(open.locationId))} />}
    </>
  )
}

export function NewInbound({ onClose }: { onClose: () => void }) {
  const simple = useSimple()
  const { data: locs = [] } = useLocations(); const { data: prods = [] } = useProducts(); const toast = useToast()
  const [locationId, setLocationId] = useState<number | ''>(''), [reference, setReference] = useState(''), [comments, setComments] = useState(''), [emails, setEmails] = useState('')
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]); const file = useRef<HTMLInputElement>(null)
  const save = useAction(() => post('/inbound', { locationId, reference, comments, notifyEmails: emails.split(/[,;\s]+/).filter(Boolean), lines: toPayload(lines) }), { ok: 'Inbound order submitted for approval', invalidate: ['inbound'], onSuccess: onClose })
  const importCsv = async (f: File) => {
    const rows = (await f.text()).split(/\r?\n/).map((r) => r.split(',').map((c) => c.trim())).filter((r) => r[0] && !/^sku$/i.test(r[0]))
    const bySku = new Map(prods.map((p) => [p.sku.toLowerCase(), p])); const out: LineDraft[] = []; const miss: string[] = []
    for (const [sku, cases, loose] of rows) { const p = bySku.get(sku.toLowerCase()); if (p) out.push({ productId: p.id, cases: Number(cases) || 0, loose: Number(loose) || 0 }); else miss.push(sku) }
    setLines(out.length ? out : [emptyLine()]); toast(miss.length ? 'err' : 'ok', miss.length ? `Imported ${out.length} lines. Unknown SKUs: ${miss.slice(0, 5).join(', ')}. Add new products first.` : `Imported ${out.length} lines`)
  }
  return (
    <Modal open onClose={onClose} title={simple ? 'Receive stock' : 'New inbound order (packing list)'} wide>
      <div className="space-y-4">
        {simple && <SimpleSteps steps={['Choose the warehouse where the goods arrived.', 'Choose each product and type how many you received.', 'Press the blue button. A manager will check it.']} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={simple ? 'Which warehouse did the goods arrive at?' : 'Receiving location'}><select className="input" value={locationId} onChange={(e) => setLocationId(Number(e.target.value) || '')}><option value="">Select…</option>{locs.filter((l) => l.active).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
          <Field label={simple ? 'Delivery note number (if there is one)' : 'Container / reference'}><input className="input" value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
        </div>
        <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">{simple ? 'What arrived?' : 'Packing list'}</h3>{!simple && <div><input ref={file} type="file" accept=".csv,text/csv" hidden onChange={(e) => e.target.files?.[0] && importCsv(e.target.files[0])} /><button className="btn-secondary" onClick={() => file.current?.click()}><FileUp className="h-4 w-4" />Import CSV (sku,cases,loose)</button></div>}</div>
        <LinesEditor lines={lines} onChange={setLines} products={prods} checkStock={false} />
        <Field label={simple ? 'Note (optional)' : 'Comments'} hint={simple ? 'Write a note if something is missing or different.' : 'Mention if the complete packing list was received or if quantities changed'}><textarea className="input" rows={2} value={comments} onChange={(e) => setComments(e.target.value)} /></Field>
        <Field label={simple ? 'Send a copy by email (optional)' : 'Email the record to (comma separated)'}><input className="input" value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="manager@company.com, finance@company.com" /></Field>
        <ErrorBox error={save.error} />
        <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={!locationId || save.isPending} onClick={() => save.mutate(undefined)}>{save.isPending && <Spinner />}{simple ? 'Send for checking' : 'Submit for approval'}</button></div>
      </div>
    </Modal>
  )
}

export function Review({ order, loc, onClose }: { order: any; loc: string; onClose: () => void }) {
  const { can } = useAuth(); const { data: prods = [] } = useProducts()
  const pending = order.status === 'pending' && can('inbound.approve')
  const [verified, setVerified] = useState<LineDraft[]>(order.lines.map((l: any) => ({ productId: l.productId, cases: l.cases, loose: l.loose })))
  const [comment, setComment] = useState('')
  const approve = useAction(() => post(`/inbound/${order.id}/approve`, { verified: toPayload(verified).map((v) => ({ ...v })), comment }), { ok: 'Inbound approved - stock updated', invalidate: ['inbound', 'dashboard', 'stock'], onSuccess: onClose })
  const reject = useAction(() => post(`/inbound/${order.id}/reject`, { comment }), { ok: 'Inbound rejected', invalidate: ['inbound'], onSuccess: onClose })
  return (
    <Modal open onClose={onClose} title={`Inbound #${order.id} · ${loc}`} wide>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1"><StatusBadge status={order.status} /><Who a={order.enteredBy} label="Entered by" /><Who a={order.decidedBy} label={order.status === 'rejected' ? 'Rejected by' : 'Approved by'} /></div>
        {order.reference && <p className="text-sm text-slate-600">Reference: {order.reference}</p>}
        {order.comments?.map((c: any, i: number) => <p key={i} className="rounded-lg bg-slate-50 p-3 text-sm"><b>{c.by}</b> <span className="text-slate-400">{fmtDate(c.at)}</span><br />{c.text}</p>)}
        {pending ? (<>
          <h3 className="text-sm font-semibold">Verify physical units</h3>
          <p className="-mt-2 text-xs text-slate-500">Adjust to what was actually counted. A comment is required if anything differs from the packing list.</p>
          <LinesEditor lines={verified} onChange={setVerified} products={prods} checkStock={false} readOnlyProducts />
          <Field label="Comment"><textarea className="input" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
          <ErrorBox error={approve.error ?? reject.error} />
          <div className="flex justify-end gap-2"><button className="btn-secondary text-red-600" disabled={!comment.trim() || reject.isPending} onClick={() => reject.mutate(undefined)}><X className="h-4 w-4" />Reject</button><button className="btn-primary" disabled={approve.isPending} onClick={() => approve.mutate(undefined)}>{approve.isPending ? <Spinner /> : <Check className="h-4 w-4" />}Confirm & approve</button></div>
        </>) : (<>
          <h3 className="text-sm font-semibold">Packing list</h3><LinesTable lines={order.lines} products={prods} />
          {order.verified && <><h3 className="text-sm font-semibold">Verified quantities</h3><LinesTable lines={order.verified} products={prods} /></>}
        </>)}
      </div>
    </Modal>
  )
}
