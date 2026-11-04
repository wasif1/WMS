import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, ShieldCheck, X } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { Badge, Card, Empty, ErrorBox, Field, Modal, PageHeader, PageLoader, Spinner, StatusBadge } from '@/components/ui'
import { get, post } from '@/lib/api'
import { useAction } from '@/lib/hooks'
import { fmt, fmtDate } from '@/lib/utils'

interface Item { type: 'product' | 'location' | 'adjustment' | 'audit'; id: number; status: 'pending' | 'approved' | 'rejected'; title: string; summary: string; submittedBy?: { name: string; at: string }; decidedBy?: { name: string; at: string }; decisionComment?: string; details: any }
const TYPE: Record<Item['type'], string> = { product: 'New product', location: 'New location', adjustment: 'Stock adjustment', audit: 'Inventory audit' }

export default function Approvals() {
  const { can } = useAuth()
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected' | ''>('pending')
  const [rejecting, setRejecting] = useState<Item | null>(null)
  const q = useQuery({ queryKey: ['approvals', status], queryFn: () => get<{ owner: boolean; pending: number; items: Item[] }>(`/approvals${status ? `?status=${status}` : ''}`) })
  const owner = can('approvals.manage')
  const refresh = ['approvals', 'products', 'locations', 'adjustments', 'audits', 'audit', 'stock', 'dashboard']
  const approve = useAction((i: Item) => post(`/approvals/${i.type}/${i.id}/approve`), { ok: 'Approved', invalidate: refresh })
  return (
    <>
      <PageHeader title={owner ? 'Owner approvals' : 'My requests'} subtitle={owner ? 'Nothing goes live until you review and approve it here.' : 'Items you submitted are waiting for the owner. They go live once approved.'} />
      <div className="mb-4 flex flex-wrap gap-2">{([['pending', 'Awaiting approval'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['', 'All']] as const).map(([s, l]) => <button key={s} className={status === s ? 'btn-primary' : 'btn-secondary'} onClick={() => setStatus(s)}>{l}{s === 'pending' && q.data ? ` (${q.data.pending})` : ''}</button>)}</div>
      <ErrorBox error={q.error ?? approve.error} />
      {q.isLoading ? <PageLoader /> : !q.data?.items.length ? <Card><Empty><ShieldCheck className="mx-auto mb-2 h-8 w-8 text-slate-300" />{status === 'pending' ? 'Nothing is waiting for approval.' : 'No requests to show.'}</Empty></Card> : (
        <div className="space-y-3">
          {q.data.items.map((i) => (
            <Card key={`${i.type}${i.id}`} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="mb-1 flex items-center gap-2"><Badge tone="indigo">{TYPE[i.type]}</Badge><StatusBadge status={i.status} /></div>
                  <p className="font-semibold">{i.title}</p>
                  <p className="text-sm text-slate-600">{i.summary}</p>
                  <p className="mt-1 text-xs text-slate-400">Submitted by {i.submittedBy?.name} · {fmtDate(i.submittedBy?.at)}{i.decidedBy && <> · {i.status === 'approved' ? 'Approved' : 'Rejected'} by {i.decidedBy.name}{i.decisionComment ? ` ("${i.decisionComment}")` : ''}</>}</p>
                </div>
                {owner && i.status === 'pending' && (
                  <div className="flex gap-2"><button className="btn-secondary text-red-600" onClick={() => setRejecting(i)}><X className="h-4 w-4" />Reject</button><button className="btn-primary" disabled={approve.isPending} onClick={() => approve.mutate(i)}>{approve.isPending ? <Spinner /> : <Check className="h-4 w-4" />}Approve</button></div>
                )}
              </div>
              {i.type === 'audit' && i.details.differences.length > 0 && (
                <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200"><table className="min-w-full text-sm"><thead className="bg-slate-50"><tr>{['Product', 'Location', 'System', 'Counted', 'Difference'].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{i.details.differences.map((d: any, n: number) => <tr key={n} className="bg-red-50/40"><td className="td">{d.product}</td><td className="td">{d.location}</td><td className="td">{fmt(d.system)}</td><td className="td">{fmt(d.counted)}</td><td className={`td font-semibold ${d.delta < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{d.delta > 0 ? '+' : ''}{fmt(d.delta)}</td></tr>)}</tbody></table></div>
              )}
            </Card>
          ))}
        </div>
      )}
      {rejecting && <Reject item={rejecting} onClose={() => setRejecting(null)} refresh={refresh} />}
    </>
  )
}

function Reject({ item, onClose, refresh }: { item: Item; onClose: () => void; refresh: string[] }) {
  const [reason, setReason] = useState('')
  const reject = useAction(() => post(`/approvals/${item.type}/${item.id}/reject`, { comment: reason }), { ok: 'Rejected - nothing was changed', invalidate: refresh, onSuccess: onClose })
  return (
    <Modal open onClose={onClose} title={`Reject: ${item.title}`}>
      <div className="space-y-4"><Field label="Reason (the team will see this)"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></Field><ErrorBox error={reject.error} />
        <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-danger" disabled={!reason.trim() || reject.isPending} onClick={() => reject.mutate(undefined)}>Reject</button></div></div>
    </Modal>
  )
}
