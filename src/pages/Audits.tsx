import { useState } from 'react'
import { t, Trans, ts } from '@/i18n'
import { useQuery } from '@tanstack/react-query'
import { Plus, Save } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { Empty, ErrorBox, Field, Modal, PageHeader, PageLoader, StatusBadge, Table } from '@/components/ui'
import { get, post, put } from '@/lib/api'
import { useAction, useLocations, useProducts } from '@/lib/hooks'
import { fmt, fmtDate } from '@/lib/utils'
import { productLabel } from '@/lib/catalog'

export default function Audits() {
  const { can } = useAuth(); const [creating, setCreating] = useState(false), [open, setOpen] = useState<number | null>(null)
  const q = useQuery({ queryKey: ['audits'], queryFn: () => get<any[]>('/audits'), enabled: can('audits.view') })
  return (
    <>
      <PageHeader title={t("Inventory audits")} subtitle={t("Count, then submit. The owner reviews the differences and approves before inventory is updated.")} actions={can('audits.create') && <button className="btn-primary" onClick={() => setCreating(true)}><Plus className="h-4 w-4" />{t("Start audit")}</button>} />
      {can('audits.view') && (q.isLoading ? <PageLoader /> : q.error ? <ErrorBox error={q.error} onRetry={() => q.refetch()} /> : (
        <Table head={[t("Audit"), t("Lines"), t("Differences"), t("Started by"), t("Status"), '']} empty={!q.data?.length && <Empty>{t("No audits yet.")}</Empty>}>
          {q.data?.map((a) => <tr key={a.id} className="hover:bg-slate-50"><td className="td font-medium">{a.name}</td><td className="td">{a.lineCount}</td><td className="td">{a.diffCount ? <span className="font-semibold text-red-600">{a.diffCount}</span> : '-'}</td><td className="td"><p>{a.createdBy.name}</p><p className="text-xs text-slate-400">{fmtDate(a.createdBy.at)}</p></td><td className="td"><StatusBadge status={a.status} /></td><td className="td text-end"><button className="btn-ghost" onClick={() => setOpen(a.id)}>{t("Open")}</button></td></tr>)}
        </Table>
      ))}
      {creating && <Create onClose={() => setCreating(false)} onDone={(id) => { setCreating(false); setOpen(id) }} />}
      {open && <Sheet id={open} onClose={() => setOpen(null)} />}
    </>
  )
}

export function Create({ onClose, onDone }: { onClose: () => void; onDone: (id: number) => void }) {
  const { data: locs = [] } = useLocations(); const [name, setName] = useState(''), [loc, setLoc] = useState<number | ''>('')
  const save = useAction(() => post('/audits', { name: name || undefined, locationId: loc || undefined }), { ok: t("Audit sheet generated"), invalidate: ['audits'], onSuccess: (a) => onDone(a.id) })
  return (
    <Modal open onClose={onClose} title={t("Start inventory audit")}><div className="space-y-4">
      <Field label={t("Name (optional)")}><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label={t("Scope")}><select className="input" value={loc} onChange={(e) => setLoc(Number(e.target.value) || '')}><option value="">{t("All warehouses")}</option>{locs.filter((l) => l.active).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
      <ErrorBox error={save.error} /><div className="flex justify-end gap-2"><button className="btn-secondary" onClick={onClose}>{t("Cancel")}</button><button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate(undefined)}>{t("Generate audit report")}</button></div></div></Modal>
  )
}

export function Sheet({ id, onClose }: { id: number; onClose: () => void }) {
  const { can } = useAuth(); const { data: prods = [] } = useProducts(); const { data: locs = [] } = useLocations()
  const q = useQuery({ queryKey: ['audit', id], queryFn: () => get<any>(`/audits/${id}`) })
  const [counts, setCounts] = useState<Record<string, string>>({}), [reason, setReason] = useState('')
  const key = (l: any) => `${l.productId}:${l.locationId}`
  const a = q.data
  const val = (l: any) => counts[key(l)] ?? (l.counted ?? '')
  const open = a?.status === 'counting'
  const inv = ['audit', 'audits', 'approvals', 'stock', 'dashboard']
  const saveCounts = useAction(() => put(`/audits/${id}/counts`, { counts: Object.entries(counts).map(([k, v]) => { const [productId, locationId] = k.split(':').map(Number); return { productId, locationId, counted: v === '' ? null : Number(v) } }) }), { ok: t("Counts saved"), invalidate: inv, onSuccess: () => setCounts({}) })
  const submit = useAction(() => post(`/audits/${id}/submit`), { ok: t("Submitted - the owner will review the differences"), invalidate: inv })
  const approve = useAction(() => post(`/approvals/audit/${id}/approve`), { ok: t("Audit approved - inventory updated and summary emailed"), invalidate: inv })
  const reject = useAction(() => post(`/approvals/audit/${id}/reject`, { comment: reason }), { ok: t("Audit rejected - inventory unchanged"), invalidate: inv })
  const label = (pid: number) => { const p = prods.find((x) => x.id === pid); return p ? productLabel(p) : String(pid) }
  const diffLines = a ? a.lines.filter((l: any) => val(l) !== '' && Number(val(l)) !== l.system) : []
  const done = a ? a.lines.every((l: any) => val(l) !== '') : false
  const review = a?.status === 'submitted' && can('approvals.manage')
  return (
    <Modal open onClose={onClose} title={a ? a.name : t("Audit")} wide>
      {!a ? <PageLoader /> : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-4"><StatusBadge status={a.status} /><span className="text-sm text-slate-600">{t('{n} difference(s) highlighted in red', { n: diffLines.length })}</span>{a.submittedBy && <span className="text-sm text-slate-500">{t('Submitted by {name} · {when}', { name: a.submittedBy.name, when: fmtDate(a.submittedBy.at) })}</span>}</div>
          {(review || a.status === 'approved' || a.status === 'rejected') && (
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="mb-2 text-sm font-semibold">{t("Summary of differences (counted vs system stock)")}</p>
              {diffLines.length === 0 ? <p className="text-sm text-slate-500">{t("No differences - counts match the system.")}</p> : (
                <ul className="divide-y divide-slate-100 text-sm">{diffLines.map((l: any) => <li key={key(l)} className="flex flex-wrap items-center justify-between gap-2 py-1.5"><span>{label(l.productId)} <span className="text-slate-400">@ {locs.find((x) => x.id === l.locationId)?.name}</span></span><span><Trans k="system {sys} → counted {counted} {diff}" vars={{ sys: <b>{fmt(l.system)}</b>, counted: <b>{fmt(Number(val(l)))}</b>, diff: <b className={Number(val(l)) - l.system < 0 ? 'text-red-600' : 'text-emerald-600'}>({Number(val(l)) - l.system > 0 ? '+' : ''}{fmt(Number(val(l)) - l.system)})</b> }} /></span></li>)}</ul>
              )}
            </div>
          )}
          <div className="max-h-[45vh] overflow-auto rounded-lg border border-slate-200">
            <table className="min-w-full divide-y divide-slate-100 text-sm"><thead className="sticky top-0 bg-slate-50"><tr>{[ts('Location'), ts('Product'), ts('System'), ts('Physical count'), ts('Diff')].map((h) => <th key={h} className="th">{t(h)}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-100">{a.lines.map((l: any) => { const v = val(l); const d = v === '' ? null : Number(v) - l.system; return (
                <tr key={key(l)} className={d ? 'bg-red-50' : ''}><td className="td">{locs.find((x) => x.id === l.locationId)?.name}</td><td className="td">{label(l.productId)}</td><td className="td">{fmt(l.system)}</td>
                  <td className="td">{open && can('audits.count') ? <input className="input max-w-[7rem]" type="number" min={0} aria-label={t('Count for {name}', { name: label(l.productId) })} value={v} onChange={(e) => setCounts({ ...counts, [key(l)]: e.target.value })} /> : fmt(l.counted)}</td>
                  <td className={`td font-semibold ${d ? 'text-red-600' : 'text-slate-400'}`}>{d == null ? '-' : d > 0 ? `+${fmt(d)}` : d === 0 ? '0' : fmt(d)}</td></tr>) })}</tbody></table>
          </div>
          {a.status === 'approved' && <p className="text-sm text-slate-600">{t('Approved by {name} · {when} · {n} change(s) applied to inventory.', { name: a.decidedBy?.name ?? '', when: fmtDate(a.decidedBy?.at), n: a.changes?.length ?? 0 })}</p>}
          {a.status === 'rejected' && <p className="text-sm text-slate-600">{t('Rejected by {name}: {reason}. Inventory was not changed.', { name: a.decidedBy?.name ?? '', reason: a.decisionComment ?? '' })}</p>}
          <ErrorBox error={saveCounts.error ?? submit.error ?? approve.error ?? reject.error} />
          {open && <div className="flex flex-wrap justify-end gap-2">
            {can('audits.count') && <button className="btn-secondary" disabled={!Object.keys(counts).length || saveCounts.isPending} onClick={() => saveCounts.mutate(undefined)}><Save className="h-4 w-4" />{t("Save counts")}</button>}
            {can('audits.count') && <button className="btn-primary" disabled={!done || Object.keys(counts).length > 0 || submit.isPending} title={Object.keys(counts).length ? t("Save your counts first") : !done ? t("Count every line first") : ''} onClick={() => submit.mutate(undefined)}>{t("Submit for owner approval")}</button>}
          </div>}
          {a.status === 'submitted' && !review && <p className="rounded-lg bg-indigo-50 p-3 text-sm text-indigo-800">{t("Waiting for the owner. Inventory is not updated until the owner approves.")}</p>}
          {review && (
            <div className="space-y-3 border-t border-slate-100 pt-4">
              <Field label={t("Reason (required only if rejecting)")}><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
              <div className="flex justify-end gap-2"><button className="btn-secondary text-red-600" disabled={!reason.trim() || reject.isPending} onClick={() => reject.mutate(undefined)}>{t("Reject")}</button><button className="btn-primary" disabled={approve.isPending} onClick={() => approve.mutate(undefined)}>{t("Approve & update inventory")}</button></div>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
