import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Plus, Save } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { Confirm, Empty, ErrorBox, Field, Modal, PageHeader, PageLoader, StatusBadge, Table } from '@/components/ui'
import { get, post, put } from '@/lib/api'
import { useAction, useLocations, useProducts } from '@/lib/hooks'
import { fmt, fmtDate } from '@/lib/utils'

export default function Audits() {
  const { can } = useAuth(); const [creating, setCreating] = useState(false), [open, setOpen] = useState<number | null>(null)
  const q = useQuery({ queryKey: ['audits'], queryFn: () => get<any[]>('/audits'), enabled: can('audits.view') })
  return (
    <>
      <PageHeader title="Inventory audits" subtitle="Generate a count sheet, enter physical counts, then confirm to apply differences" actions={can('audits.create') && <button className="btn-primary" onClick={() => setCreating(true)}><Plus className="h-4 w-4" />Start audit</button>} />
      {can('audits.view') && (q.isLoading ? <PageLoader /> : (
        <Table head={['#', 'Name', 'Lines', 'Differences', 'Started by', 'Status', '']} empty={!q.data?.length && <Empty>No audits yet.</Empty>}>
          {q.data?.map((a) => <tr key={a.id} className="hover:bg-slate-50"><td className="td font-medium">#{a.id}</td><td className="td">{a.name}</td><td className="td">{a.lineCount}</td><td className="td">{a.diffCount ? <span className="font-semibold text-red-600">{a.diffCount}</span> : '-'}</td><td className="td"><p>{a.createdBy.name}</p><p className="text-xs text-slate-400">{fmtDate(a.createdBy.at)}</p></td><td className="td"><StatusBadge status={a.status} /></td><td className="td text-right"><button className="btn-ghost" onClick={() => setOpen(a.id)}>Open</button></td></tr>)}
        </Table>
      ))}
      {creating && <Create onClose={() => setCreating(false)} onDone={(id) => { setCreating(false); setOpen(id) }} />}
      {open && <Sheet id={open} onClose={() => setOpen(null)} />}
    </>
  )
}

function Create({ onClose, onDone }: { onClose: () => void; onDone: (id: number) => void }) {
  const { data: locs = [] } = useLocations(); const [name, setName] = useState(''), [loc, setLoc] = useState<number | ''>('')
  const save = useAction(() => post('/audits', { name: name || undefined, locationId: loc || undefined }), { ok: 'Audit sheet generated', invalidate: ['audits'], onSuccess: (a) => onDone(a.id) })
  return (
    <Modal open onClose={onClose} title="Start inventory audit"><div className="space-y-4">
      <Field label="Name (optional)"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Scope"><select className="input" value={loc} onChange={(e) => setLoc(Number(e.target.value) || '')}><option value="">All warehouses</option>{locs.filter((l) => l.active).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
      <ErrorBox error={save.error} /><div className="flex justify-end gap-2"><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate(undefined)}>Generate audit report</button></div></div></Modal>
  )
}

function Sheet({ id, onClose }: { id: number; onClose: () => void }) {
  const { can } = useAuth(); const { data: prods = [] } = useProducts(); const { data: locs = [] } = useLocations()
  const q = useQuery({ queryKey: ['audit', id], queryFn: () => get<any>(`/audits/${id}`) })
  const [counts, setCounts] = useState<Record<string, string>>({}), [confirm, setConfirm] = useState(false)
  const key = (l: any) => `${l.productId}:${l.locationId}`
  const a = q.data
  const val = (l: any) => counts[key(l)] ?? (l.counted ?? '')
  const open = a?.status === 'counting'
  const saveCounts = useAction(() => put(`/audits/${id}/counts`, { counts: Object.entries(counts).map(([k, v]) => { const [productId, locationId] = k.split(':').map(Number); return { productId, locationId, counted: v === '' ? null : Number(v) } }) }), { ok: 'Counts saved', invalidate: ['audit', 'audits'], onSuccess: () => setCounts({}) })
  const doConfirm = useAction(() => post(`/audits/${id}/confirm`), { ok: 'Audit confirmed - differences applied and summary emailed', invalidate: ['audit', 'audits', 'stock', 'dashboard'], onSuccess: () => setConfirm(false) })
  const diffs = a ? a.lines.filter((l: any) => val(l) !== '' && Number(val(l)) !== l.system).length : 0
  const done = a ? a.lines.every((l: any) => val(l) !== '') : false
  return (
    <Modal open onClose={onClose} title={a ? `Audit #${a.id} · ${a.name}` : 'Audit'} wide>
      {!a ? <PageLoader /> : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-4"><StatusBadge status={a.status} /><span className="text-sm text-slate-600">{diffs} difference(s) highlighted in red</span></div>
          <div className="max-h-[50vh] overflow-auto rounded-lg border border-slate-200">
            <table className="min-w-full divide-y divide-slate-100 text-sm"><thead className="sticky top-0 bg-slate-50"><tr>{['Location', 'SKU', 'Product', 'System', 'Physical count', 'Diff'].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-100">{a.lines.map((l: any) => { const v = val(l); const d = v === '' ? null : Number(v) - l.system; const p = prods.find((x) => x.id === l.productId); return (
                <tr key={key(l)} className={d ? 'bg-red-50' : ''}><td className="td">{locs.find((x) => x.id === l.locationId)?.name}</td><td className="td font-mono text-xs">{p?.sku}</td><td className="td">{p?.name}</td><td className="td">{fmt(l.system)}</td>
                  <td className="td">{open && can('audits.count') ? <input className="input max-w-[7rem]" type="number" min={0} value={v} onChange={(e) => setCounts({ ...counts, [key(l)]: e.target.value })} /> : fmt(l.counted)}</td>
                  <td className={`td font-semibold ${d ? 'text-red-600' : 'text-slate-400'}`}>{d == null ? '-' : d > 0 ? `+${fmt(d)}` : d === 0 ? '0' : fmt(d)}</td></tr>) })}</tbody></table>
          </div>
          {a.status === 'confirmed' && <p className="text-sm text-slate-600">Confirmed by {a.confirmedBy?.name} · {fmtDate(a.confirmedBy?.at)} · {a.changes.length} change(s) applied.</p>}
          <ErrorBox error={saveCounts.error} />
          {open && <div className="flex justify-end gap-2">
            {can('audits.count') && <button className="btn-secondary" disabled={!Object.keys(counts).length || saveCounts.isPending} onClick={() => saveCounts.mutate(undefined)}><Save className="h-4 w-4" />Save counts</button>}
            {can('audits.confirm') && <button className="btn-primary" disabled={!done || Object.keys(counts).length > 0} title={Object.keys(counts).length ? 'Save your counts first' : !done ? 'Count every line first' : ''} onClick={() => setConfirm(true)}>Confirm audit</button>}
          </div>}
          <Confirm open={confirm} onClose={() => setConfirm(false)} title="Confirm audit?" message={<>This will set system stock to the physical counts for <b>{diffs}</b> line(s) and email the summary. This cannot be undone (only corrected with another audit/adjustment).</>} busy={doConfirm.isPending} onConfirm={() => doConfirm.mutate(undefined)} />
          <ErrorBox error={doConfirm.error} />
        </div>
      )}
    </Modal>
  )
}
