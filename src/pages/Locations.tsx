import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { Badge, Empty, ErrorBox, Field, Modal, PageHeader, PageLoader, Spinner, Table, useToast } from '@/components/ui'
import { post, put } from '@/lib/api'
import { useAction, useLocations } from '@/lib/hooks'
import type { Location } from '@/lib/types'

export default function Locations() {
  const { can } = useAuth(); const { data, isLoading, error, refetch } = useLocations()
  const [edit, setEdit] = useState<Location | 'new' | null>(null)
  const owner = can('approvals.manage')
  return (
    <>
      <PageHeader title="Locations" subtitle="Published warehouses and storage locations. New locations go live after owner approval." actions={can('locations.manage') && <button className="btn-primary" onClick={() => setEdit('new')}><Plus className="h-4 w-4" />{owner ? 'Add location' : 'Request new location'}</button>} />
      <ErrorBox error={error} onRetry={() => refetch()} />
      {isLoading ? <PageLoader /> : error ? null : (
        <Table head={['Name', 'Address', 'Status', '']} empty={!data?.length && <Empty>No published locations yet.</Empty>}>
          {data?.map((l) => <tr key={l.id} className="hover:bg-slate-50"><td className="td font-medium">{l.name}</td><td className="td text-slate-600">{l.address || '-'}</td><td className="td">{l.active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</td><td className="td text-right">{can('locations.manage') && <button className="btn-ghost" onClick={() => setEdit(l)}>Edit</button>}</td></tr>)}
        </Table>
      )}
      {edit && <LocForm loc={edit === 'new' ? undefined : edit} owner={owner} onClose={() => setEdit(null)} />}
    </>
  )
}

function LocForm({ loc, owner, onClose }: { loc?: Location; owner: boolean; onClose: () => void }) {
  const toast = useToast()
  const [name, setName] = useState(loc?.name ?? ''), [address, setAddress] = useState(loc?.address ?? ''), [active, setActive] = useState(loc?.active ?? true)
  const save = useAction(() => (loc ? put(`/locations/${loc.id}`, { name, address, active }) : post('/locations', { name, address, active })), {
    invalidate: ['locations', 'approvals'],
    onSuccess: (r: Location) => { toast('ok', loc ? 'Saved' : r.status === 'pending' ? 'Request submitted - the location is published after the owner approves it' : 'Location added'); onClose() },
  })
  return (
    <Modal open onClose={onClose} title={loc ? 'Edit location' : owner ? 'Add location' : 'Request new location'}>
      <div className="space-y-4">
        <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
        <Field label="Address"><input className="input" value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />Active (inventory and reserve orders available)</label>
        {!loc && !owner && <p className="rounded-lg bg-indigo-50 p-3 text-xs text-indigo-800">Owner approval needed: the location is only published after the owner approves it.</p>}
        <ErrorBox error={save.error} />
        <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={!name.trim() || save.isPending} onClick={() => save.mutate(undefined)}>{save.isPending && <Spinner />}{loc ? 'Save' : owner ? 'Add location' : 'Submit request'}</button></div>
      </div>
    </Modal>
  )
}
