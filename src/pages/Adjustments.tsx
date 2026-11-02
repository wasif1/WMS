import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { Empty, ErrorBox, Field, Modal, PageHeader, PageLoader, Spinner, Table } from '@/components/ui'
import { get, post } from '@/lib/api'
import { useAction, useLocations, useProducts } from '@/lib/hooks'
import type { StockRow } from '@/lib/types'
import { fmt, fmtDate } from '@/lib/utils'

export default function Adjustments() {
  const { can } = useAuth(); const { data: prods = [] } = useProducts(); const { data: locs = [] } = useLocations(); const [open, setOpen] = useState(false)
  const q = useQuery({ queryKey: ['adjustments'], queryFn: () => get<any[]>('/adjustments'), enabled: can('adjustments.view') })
  return (
    <>
      <PageHeader title="Inventory adjustments" subtitle="Correct missing or excess stock. Every change is recorded with a reason." actions={can('adjustments.create') && <button className="btn-primary" onClick={() => setOpen(true)}><Plus className="h-4 w-4" />New adjustment</button>} />
      {can('adjustments.view') && (q.isLoading ? <PageLoader /> : (
        <Table head={['When', 'Product', 'Location', 'Before', 'Change', 'Reason', 'By']} empty={!q.data?.length && <Empty>No adjustments recorded.</Empty>}>
          {q.data?.map((a) => <tr key={a.id}><td className="td whitespace-nowrap text-slate-600">{fmtDate(a.by.at)}</td><td className="td font-mono text-xs">{prods.find((p) => p.id === a.productId)?.sku}</td><td className="td">{locs.find((l) => l.id === a.locationId)?.name}</td><td className="td">{fmt(a.before)}</td><td className={`td font-semibold ${a.delta < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{a.delta > 0 ? '+' : ''}{fmt(a.delta)}</td><td className="td text-slate-600">{a.reason}</td><td className="td">{a.by.name}</td></tr>)}
        </Table>
      ))}
      {open && <Form onClose={() => setOpen(false)} />}
    </>
  )
}

function Form({ onClose }: { onClose: () => void }) {
  const { data: prods = [] } = useProducts(); const { data: locs = [] } = useLocations()
  const [productId, setProductId] = useState<number | ''>(''), [locationId, setLocationId] = useState<number | ''>(''), [newQty, setNewQty] = useState(''), [reason, setReason] = useState('')
  const stock = useQuery({ queryKey: ['stock', locationId, 'adj'], queryFn: () => get<StockRow[]>(`/stock?locationId=${locationId}&productId=${productId}`), enabled: !!locationId && !!productId })
  const current = stock.data?.[0]
  const save = useAction(() => post('/adjustments', { productId, locationId, newQty: Number(newQty), reason }), { ok: 'Adjustment recorded', invalidate: ['adjustments', 'stock', 'dashboard'], onSuccess: onClose })
  return (
    <Modal open onClose={onClose} title="New inventory adjustment">
      <div className="space-y-4">
        <Field label="Product"><select className="input" value={productId} onChange={(e) => setProductId(Number(e.target.value) || '')}><option value="">Select…</option>{prods.map((p) => <option key={p.id} value={p.id}>{p.sku} · {p.name}</option>)}</select></Field>
        <Field label="Location"><select className="input" value={locationId} onChange={(e) => setLocationId(Number(e.target.value) || '')}><option value="">Select…</option>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
        {productId && locationId && <p className="rounded-lg bg-slate-50 p-3 text-sm">System quantity: <b>{fmt(current?.onHand ?? 0)}</b> (reserved {fmt(current?.reserved ?? 0)})</p>}
        <Field label="Correct physical quantity"><input className="input" type="number" min={0} value={newQty} onChange={(e) => setNewQty(e.target.value)} /></Field>
        <Field label="Reason (required)"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. damaged in storage, miscount at receipt" /></Field>
        <ErrorBox error={save.error} />
        <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={!productId || !locationId || newQty === '' || reason.trim().length < 3 || save.isPending} onClick={() => save.mutate(undefined)}>{save.isPending && <Spinner />}Apply adjustment</button></div>
      </div>
    </Modal>
  )
}
