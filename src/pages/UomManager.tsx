import { useState, type FormEvent } from 'react'
import { Pencil, Ruler, Trash2 } from 'lucide-react'
import { t } from '@/i18n'
import { Badge, Card, Confirm, ErrorBox, Field, Modal, Spinner, Table } from '@/components/ui'
import { del, post, put } from '@/lib/api'
import { useAction } from '@/lib/hooks'
import { uomLabel, uomShort, useUoms, type Uom } from '@/lib/uoms'

/** Super admin: add the ways products can be counted (litres, pairs, rolls…) beyond the built-in four. */
export default function UomManager() {
  const q = useUoms()
  const [name, setName] = useState(''); const [short, setShort] = useState(''); const [decimals, setDecimals] = useState(false)
  const [edit, setEdit] = useState<Uom | null>(null); const [remove, setRemove] = useState<Uom | null>(null)
  const add = useAction(() => post('/uoms', { name, short, decimals }), { ok: t('Unit added'), invalidate: ['uoms'], onSuccess: () => { setName(''); setShort(''); setDecimals(false) } })
  const submit = (e: FormEvent) => { e.preventDefault(); add.mutate(undefined as never) }
  const list = q.data ?? []
  return (
    <Card className="mt-6 p-5">
      <h2 className="mb-1 flex items-center gap-2 font-semibold"><Ruler className="h-4 w-4 text-brand-600" />{t('Units of measure')}</h2>
      <p className="mb-4 text-sm text-slate-600">{t('How a product is counted. People pick one when they add a product. The first four are built in; add your own (litres, pairs, rolls…).')}</p>
      <ErrorBox error={q.error} onRetry={() => q.refetch()} />
      <Table head={[t('Name'), t('Short name'), t('Decimals'), '']}>
        {list.map((u) => (
          <tr key={u.key}>
            <td className="td font-medium">{uomLabel(u.key)} {u.builtin && <Badge>{t('built in')}</Badge>}</td>
            <td className="td">{uomShort(u.key)}</td>
            <td className="td">{u.decimals ? t('Yes') : t('Whole numbers only')}</td>
            <td className="td text-end">{!u.builtin && <span className="inline-flex gap-1">
              <button className="btn-secondary !px-2" aria-label={t('Edit')} onClick={() => setEdit(u)}><Pencil className="h-4 w-4" /></button>
              <button className="btn-secondary !px-2 text-red-600" aria-label={t('Delete')} onClick={() => setRemove(u)}><Trash2 className="h-4 w-4" /></button>
            </span>}</td>
          </tr>
        ))}
      </Table>
      <form onSubmit={submit} className="mt-5 grid gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
        <Field label={t('Name')} hint={t('e.g. Litres, Pairs, Rolls')}><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} /></Field>
        <Field label={t('Short name')} hint={t('e.g. L, pr')}><input className="input" value={short} onChange={(e) => setShort(e.target.value)} maxLength={12} /></Field>
        <button className="btn-primary" disabled={add.isPending || !name.trim() || !short.trim()}>{add.isPending && <Spinner />}{t('Add unit')}</button>
        <label className="flex items-center gap-2 text-sm sm:col-span-3"><input type="checkbox" checked={decimals} onChange={(e) => setDecimals(e.target.checked)} />{t('Allow decimals (for weight, length, volume). This cannot be changed later.')}</label>
      </form>
      <ErrorBox error={add.error} />
      {edit && <EditUnit unit={edit} onClose={() => setEdit(null)} />}
      <Remove unit={remove} onClose={() => setRemove(null)} />
    </Card>
  )
}

function EditUnit({ unit, onClose }: { unit: Uom; onClose: () => void }) {
  const [name, setName] = useState(unit.label); const [short, setShort] = useState(unit.short)
  const save = useAction(() => put(`/uoms/${unit.key}`, { name, short }), { ok: t('Unit saved'), invalidate: ['uoms', 'products'], onSuccess: onClose })
  return (
    <Modal open onClose={onClose} title={t('Edit unit')}>
      <div className="space-y-3">
        <Field label={t('Name')}><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} /></Field>
        <Field label={t('Short name')}><input className="input" value={short} onChange={(e) => setShort(e.target.value)} maxLength={12} /></Field>
        <ErrorBox error={save.error} />
        <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={onClose}>{t('Cancel')}</button><button className="btn-primary" disabled={save.isPending || !name.trim() || !short.trim()} onClick={() => save.mutate(undefined as never)}>{save.isPending && <Spinner />}{t('Save')}</button></div>
      </div>
    </Modal>
  )
}

function Remove({ unit, onClose }: { unit: Uom | null; onClose: () => void }) {
  const rm = useAction(() => del(`/uoms/${unit?.key}`), { ok: t('Unit deleted'), invalidate: ['uoms'], onSuccess: onClose })
  return (
    <Confirm open={!!unit} onClose={onClose} title={t('Delete this unit?')} danger busy={rm.isPending} confirmLabel={t('Delete')} onConfirm={() => rm.mutate(undefined as never)}
      message={<><p>{t('Delete "{unit}"? You can only delete a unit that no product uses.', { unit: unit?.label ?? '' })}</p><ErrorBox error={rm.error} /></>} />
  )
}
