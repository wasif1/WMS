import { useState } from 'react'
import { t } from '@/i18n'
import { Plus } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { Badge, Empty, ErrorBox, Field, Modal, PageHeader, PageLoader, Spinner, Table, useToast, SimpleSteps } from '@/components/ui'
import { post, put } from '@/lib/api'
import { useSimple } from '@/lib/simple'
import { useAction, useLocations } from '@/lib/hooks'
import type { Location } from '@/lib/types'

export default function Locations() {
  const { can } = useAuth(); const { data, isLoading, error, refetch } = useLocations()
  const [edit, setEdit] = useState<Location | 'new' | null>(null)
  const owner = can('approvals.manage')
  return (
    <>
      <PageHeader title={t("Locations")} subtitle={t("Published warehouses and storage locations. New locations go live after owner approval.")} actions={can('locations.manage') && <button className="btn-primary" onClick={() => setEdit('new')}><Plus className="h-4 w-4" />{owner ? t("Add location") : t("Request new location")}</button>} />
      <ErrorBox error={error} onRetry={() => refetch()} />
      {isLoading ? <PageLoader /> : error ? null : (
        <Table head={[t("Name"), t("Address"), t("Status"), '']} empty={!data?.length && <Empty>{t("No published locations yet.")}</Empty>}>
          {data?.map((l) => <tr key={l.id} className="hover:bg-slate-50"><td className="td font-medium">{l.name}</td><td className="td text-slate-600">{l.address || '-'}</td><td className="td">{l.active ? <Badge tone="green">{t("Active")}</Badge> : <Badge>{t("Inactive")}</Badge>}</td><td className="td text-end">{can('locations.manage') && <button className="btn-ghost" onClick={() => setEdit(l)}>{t("Edit")}</button>}</td></tr>)}
        </Table>
      )}
      {edit && <LocForm loc={edit === 'new' ? undefined : edit} owner={owner} onClose={() => setEdit(null)} />}
    </>
  )
}

export function LocForm({ loc, owner, onClose }: { loc?: Location; owner: boolean; onClose: () => void }) {
  const simple = useSimple()
  const toast = useToast()
  const [name, setName] = useState(loc?.name ?? ''), [address, setAddress] = useState(loc?.address ?? ''), [active, setActive] = useState(loc?.active ?? true)
  const save = useAction(() => (loc ? put(`/locations/${loc.id}`, { name, address, active }) : post('/locations', { name, address, active })), {
    invalidate: ['locations', 'approvals'],
    onSuccess: (r: Location) => { toast('ok', loc ? t("Saved") : r.status === 'pending' ? t("Request submitted - the location is published after the owner approves it") : t("Location added")); onClose() },
  })
  return (
    <Modal open onClose={onClose} title={loc ? t("Edit location") : simple ? t("Add a new warehouse") : owner ? t("Add location") : t("Request new location")}>
      <div className="space-y-4">
        {simple && <SimpleSteps steps={[t('Type the name of the warehouse or place.'), t('Add the address if you know it.'), t('Press the blue button. The owner will check it before it appears.')]} />}
        <Field label={t("Name")}><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
        <Field label={t("Address")}><input className="input" value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />{t("Active (inventory and reserve orders available)")}</label>
        {!loc && !owner && <p className="rounded-lg bg-indigo-50 p-3 text-xs text-indigo-800">{t("Owner approval needed: the location is only published after the owner approves it.")}</p>}
        <ErrorBox error={save.error} />
        <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={onClose}>{t("Cancel")}</button><button className="btn-primary" disabled={!name.trim() || save.isPending} onClick={() => save.mutate(undefined)}>{save.isPending && <Spinner />}{loc ? t("Save") : owner ? t("Add location") : simple ? t("Send to the owner") : t("Submit request")}</button></div>
      </div>
    </Modal>
  )
}
