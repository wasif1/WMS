import { useState } from 'react'
import { t, ts } from '@/i18n'
import { approvalSummary } from '@/i18n/describe'
import { useQuery } from '@tanstack/react-query'
import { Check, ShieldCheck, X } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { Badge, Card, Empty, ErrorBox, Field, Modal, PageHeader, PageLoader, Spinner, StatusBadge } from '@/components/ui'
import { get, post } from '@/lib/api'
import { useAction } from '@/lib/hooks'
import { fmt, fmtDate } from '@/lib/utils'

interface Item { type: 'product' | 'location' | 'adjustment' | 'audit'; id: number; status: 'pending' | 'approved' | 'rejected'; title: string; submittedBy?: { name: string; at: string }; decidedBy?: { name: string; at: string }; decisionComment?: string; details: any }
const TYPE: Record<Item['type'], string> = { product: ts('New product'), location: ts('New location'), adjustment: ts('Stock adjustment'), audit: ts('Inventory audit') }

export default function Approvals() {
  const { can } = useAuth()
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected' | ''>('pending')
  const [rejecting, setRejecting] = useState<Item | null>(null)
  const q = useQuery({ queryKey: ['approvals', status], queryFn: () => get<{ owner: boolean; pending: number; items: Item[] }>(`/approvals${status ? `?status=${status}` : ''}`) })
  const owner = can('approvals.manage')
  const refresh = ['approvals', 'products', 'locations', 'adjustments', 'audits', 'audit', 'stock', 'dashboard']
  const approve = useAction((i: Item) => post(`/approvals/${i.type}/${i.id}/approve`), { ok: t("Approved"), invalidate: refresh })
  return (
    <>
      <PageHeader title={owner ? t("Owner approvals") : t("My requests")} subtitle={owner ? t("Nothing goes live until you review and approve it here.") : t("Items you submitted are waiting for the owner. They go live once approved.")} />
      <div className="mb-4 flex flex-wrap gap-2">{([['pending', ts('Awaiting approval')], ['approved', ts('Approved')], ['rejected', ts('Rejected')], ['', ts('All')]] as const).map(([s, l]) => <button key={s} className={status === s ? 'btn-primary' : 'btn-secondary'} onClick={() => setStatus(s)}>{t(l)}{s === 'pending' && q.data ? ` (${q.data.pending})` : ''}</button>)}</div>
      <ErrorBox error={q.error ?? approve.error} />
      {q.isLoading ? <PageLoader /> : !q.data?.items.length ? <Card><Empty><ShieldCheck className="mx-auto mb-2 h-8 w-8 text-slate-300" />{status === 'pending' ? t("Nothing is waiting for approval.") : t("No requests to show.")}</Empty></Card> : (
        <div className="space-y-3">
          {q.data.items.map((i) => (
            <Card key={`${i.type}${i.id}`} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="mb-1 flex items-center gap-2"><Badge tone="indigo">{t(TYPE[i.type])}</Badge><StatusBadge status={i.status} /></div>
                  <p className="font-semibold">{i.title}</p>
                  <p className="text-sm text-slate-600">{approvalSummary(i)}</p>
                  <p className="mt-1 text-xs text-slate-400">{t('Submitted by {name} · {when}', { name: i.submittedBy?.name ?? '', when: fmtDate(i.submittedBy?.at) })}{i.decidedBy && <> · {i.status === 'approved' ? t('Approved by {name}', { name: i.decidedBy.name }) : t('Rejected by {name}', { name: i.decidedBy.name })}{i.decisionComment ? ` ("${i.decisionComment}")` : ''}</>}</p>
                </div>
                {owner && i.status === 'pending' && (
                  <div className="flex gap-2"><button className="btn-secondary text-red-600" onClick={() => setRejecting(i)}><X className="h-4 w-4" />{t("Reject")}</button><button className="btn-primary" disabled={approve.isPending} onClick={() => approve.mutate(i)}>{approve.isPending ? <Spinner /> : <Check className="h-4 w-4" />}{t("Approve")}</button></div>
                )}
              </div>
              {i.type === 'audit' && i.details.differences.length > 0 && (
                <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200"><table className="min-w-full text-sm"><thead className="bg-slate-50"><tr>{[ts('Product'), ts('Location'), ts('System'), ts('Counted'), ts('Difference')].map((h) => <th key={h} className="th">{t(h)}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{i.details.differences.map((d: any, n: number) => <tr key={n} className="bg-red-50/40"><td className="td">{d.product}</td><td className="td">{d.location}</td><td className="td">{fmt(d.system)}</td><td className="td">{fmt(d.counted)}</td><td className={`td font-semibold ${d.delta < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{d.delta > 0 ? '+' : ''}{fmt(d.delta)}</td></tr>)}</tbody></table></div>
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
  const reject = useAction(() => post(`/approvals/${item.type}/${item.id}/reject`, { comment: reason }), { ok: t("Rejected - nothing was changed"), invalidate: refresh, onSuccess: onClose })
  return (
    <Modal open onClose={onClose} title={t('Reject: {title}', { title: item.title })}>
      <div className="space-y-4"><Field label={t("Reason (the team will see this)")}><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></Field><ErrorBox error={reject.error} />
        <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={onClose}>{t("Cancel")}</button><button className="btn-danger" disabled={!reason.trim() || reject.isPending} onClick={() => reject.mutate(undefined)}>{t("Reject")}</button></div></div>
    </Modal>
  )
}
