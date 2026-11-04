import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import ProductPicker from '@/components/ProductPicker'
import { Empty, ErrorBox, Field, Modal, PageHeader, PageLoader, Spinner, StatusBadge, Table, useToast } from '@/components/ui'
import { get, post } from '@/lib/api'
import { useAction, useLocations, useProducts } from '@/lib/hooks'
import { productLabel } from '@/lib/catalog'
import type { StockRow } from '@/lib/types'
import { fmt, fmtDate } from '@/lib/utils'

export default function Adjustments() {
  const { can } = useAuth(); const { data: prods = [] } = useProducts(); const { data: locs = [] } = useLocations(); const [open, setOpen] = useState(false)
  const owner = can('approvals.manage')
  const q = useQuery({ queryKey: ['adjustments'], queryFn: () => get<any[]>('/adjustments'), enabled: can('adjustments.view') })
  return (
    <>
      <PageHeader title="Inventory adjustments" subtitle="Stock only changes after the owner approves an adjustment request." actions={can('adjustments.create') && <button className="btn-primary" onClick={() => setOpen(true)}><Plus className="h-4 w-4" />{owner ? 'New adjustment' : 'Request adjustment'}</button>} />
      {can('adjustments.view') && (q.isLoading ? <PageLoader /> : q.error ? <ErrorBox error={q.error} onRetry={() => q.refetch()} /> : (
        <Table head={['When', 'Product', 'Location', 'Before', 'Change', 'Reason', 'Requested by', 'Status']} empty={!q.data?.length && <Empty>No adjustments recorded.</Empty>}>
          {q.data?.map((a) => { const p = prods.find((x) => x.id === a.productId); return (
            <tr key={a.id}><td className="td whitespace-nowrap text-slate-600">{fmtDate(a.by.at)}</td><td className="td">{p ? productLabel(p) : a.productId}</td><td className="td">{locs.find((l) => l.id === a.locationId)?.name}</td><td className="td">{fmt(a.before)}</td><td className={`td font-semibold ${a.delta < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{a.delta > 0 ? '+' : ''}{fmt(a.delta)}</td><td className="td text-slate-600">{a.reason}{a.decisionComment && <p className="text-xs text-slate-400">Owner: {a.decisionComment}</p>}</td><td className="td">{a.by.name}</td><td className="td"><StatusBadge status={a.status ?? 'approved'} /></td></tr>) })}
        </Table>
      ))}
      {open && <Form owner={owner} onClose={() => setOpen(false)} />}
    </>
  )
}

function Form({ owner, onClose }: { owner: boolean; onClose: () => void }) {
  const toast = useToast()
  const { data: prods = [] } = useProducts(); const { data: locs = [] } = useLocations()
  const [productId, setProductId] = useState<number | ''>(''), [locationId, setLocationId] = useState<number | ''>(''), [newQty, setNewQty] = useState(''), [reason, setReason] = useState('')
  const stock = useQuery({ queryKey: ['stock', locationId, productId, 'adj'], queryFn: () => get<StockRow[]>(`/stock?locationId=${locationId}&productId=${productId}`), enabled: !!locationId && !!productId })
  const current = stock.data?.[0]
  const save = useAction(() => post('/adjustments', { productId, locationId, newQty: Number(newQty), reason }), {
    invalidate: ['adjustments', 'stock', 'dashboard', 'approvals'],
    onSuccess: (r: any) => { toast('ok', r.status === 'pending' ? 'Request submitted - stock changes only after the owner approves' : 'Adjustment applied'); onClose() },
  })
  const delta = newQty === '' ? null : Number(newQty) - (current?.onHand ?? 0)
  return (
    <Modal open onClose={onClose} title={owner ? 'New inventory adjustment' : 'Request an inventory adjustment'}>
      <div className="space-y-4">
        <Field label="Product" hint="Search by product name - results show the variation (colour, size)"><ProductPicker products={prods} value={productId} onChange={setProductId} /></Field>
        <Field label="Location"><select className="input" value={locationId} onChange={(e) => setLocationId(Number(e.target.value) || '')}><option value="">Select…</option>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
        {productId && locationId && <p className="rounded-lg bg-slate-50 p-3 text-sm">System quantity: <b>{fmt(current?.onHand ?? 0)}</b> (reserved {fmt(current?.reserved ?? 0)})</p>}
        <Field label="Correct physical quantity"><input className="input" type="number" min={0} value={newQty} onChange={(e) => setNewQty(e.target.value)} /></Field>
        {delta !== null && productId && locationId && <p className={`text-sm font-medium ${delta < 0 ? 'text-red-600' : 'text-emerald-600'}`}>This will {delta < 0 ? 'remove' : 'add'} {fmt(Math.abs(delta))}</p>}
        <Field label="Reason (required)"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. damaged in storage, miscount at receipt" /></Field>
        {!owner && <p className="rounded-lg bg-indigo-50 p-3 text-xs text-indigo-800">Owner approval needed: stock does not change until the owner approves this request.</p>}
        <ErrorBox error={save.error} />
        <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={!productId || !locationId || newQty === '' || reason.trim().length < 3 || save.isPending} onClick={() => save.mutate(undefined)}>{save.isPending && <Spinner />}{owner ? 'Apply adjustment' : 'Submit request'}</button></div>
      </div>
    </Modal>
  )
}
