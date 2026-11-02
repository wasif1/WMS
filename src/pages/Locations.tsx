import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { Badge, Empty, ErrorBox, Field, Modal, PageHeader, PageLoader, Spinner, Table } from '@/components/ui'
import { post, put } from '@/lib/api'
import { useAction, useLocations } from '@/lib/hooks'
import type { Location } from '@/lib/types'

export default function Locations() {
  const { can } = useAuth(); const { data, isLoading } = useLocations()
  const [edit, setEdit] = useState<Location | 'new' | null>(null)
  return (
    <>
      <PageHeader title="Locations" subtitle="Warehouses and storage locations" actions={can('locations.manage') && <button className="btn-primary" onClick={() => setEdit('new')}><Plus className="h-4 w-4" />Add location</button>} />
      {isLoading ? <PageLoader /> : (
        <Table head={['Name', 'Address', 'Status', '']} empty={!data?.length && <Empty>No locations yet. Add your first warehouse.</Empty>}>
          {data?.map((l) => <tr key={l.id} className="hover:bg-slate-50"><td className="td font-medium">{l.name}</td><td className="td text-slate-600">{l.address || '-'}</td><td className="td">{l.active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</td><td className="td text-right">{can('locations.manage') && <button className="btn-ghost" onClick={() => setEdit(l)}>Edit</button>}</td></tr>)}
        </Table>
      )}
      {edit && <LocForm loc={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </>
  )
}

function LocForm({ loc, onClose }: { loc?: Location; onClose: () => void }) {
  const [name, setName] = useState(loc?.name ?? ''), [address, setAddress] = useState(loc?.address ?? ''), [active, setActive] = useState(loc?.active ?? true)
  const save = useAction(() => (loc ? put(`/locations/${loc.id}`, { name, address, active }) : post('/locations', { name, address, active })), { ok: 'Saved', invalidate: ['locations'], onSuccess: onClose })
  return (
    <Modal open onClose={onClose} title={loc ? 'Edit location' : 'Add location'}>
      <div className="space-y-4">
        <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
        <Field label="Address"><input className="input" value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />Active (inventory and reserve orders available)</label>
        <ErrorBox error={save.error} />
        <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={!name.trim() || save.isPending} onClick={() => save.mutate(undefined)}>{save.isPending && <Spinner />}Save</button></div>
      </div>
    </Modal>
  )
}
