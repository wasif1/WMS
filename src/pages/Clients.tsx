import { useState } from 'react'
import { Eye, EyeOff, Plus } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { Badge, Empty, ErrorBox, Field, Modal, PageHeader, PageLoader, Spinner, Table } from '@/components/ui'
import { post, put } from '@/lib/api'
import { useAction, useClients } from '@/lib/hooks'
import type { Client } from '@/lib/types'

export default function Clients() {
  const { can } = useAuth(); const { data, isLoading } = useClients(); const [edit, setEdit] = useState<Client | 'new' | null>(null)
  const reveal = can('clients.reveal')
  return (
    <>
      <PageHeader title="Clients" subtitle={reveal ? 'You can see real client details.' : 'Client identities are anonymised. Real details are visible only to users a super admin has granted access.'}
        actions={can('clients.manage') && <button className="btn-primary" onClick={() => setEdit('new')}><Plus className="h-4 w-4" />Add client</button>} />
      <div className={`mb-4 flex items-center gap-2 rounded-lg border p-3 text-sm ${reveal ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-slate-200 bg-white text-slate-600'}`}>{reveal ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}{reveal ? 'Real client data is showing. Access to it is logged.' : 'Showing aliases only.'}</div>
      {isLoading ? <PageLoader /> : (
        <Table head={['Alias', ...(reveal ? ['Name', 'Contact', 'Address'] : []), '']} empty={!data?.length && <Empty>No clients yet.</Empty>}>
          {data?.map((c) => <tr key={c.id} className="hover:bg-slate-50"><td className="td font-medium"><Badge tone="indigo">{c.alias}</Badge></td>{reveal && <><td className="td">{c.name}</td><td className="td text-slate-600">{c.contact || '-'}</td><td className="td text-slate-600">{c.address || '-'}</td></>}<td className="td text-right">{can('clients.manage') && reveal && <button className="btn-ghost" onClick={() => setEdit(c)}>Edit</button>}</td></tr>)}
        </Table>
      )}
      {edit && <Form client={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </>
  )
}

function Form({ client, onClose }: { client?: Client; onClose: () => void }) {
  const [name, setName] = useState(client?.name ?? ''), [contact, setContact] = useState(client?.contact ?? ''), [address, setAddress] = useState(client?.address ?? '')
  const save = useAction(() => (client ? put(`/clients/${client.id}`, { name, contact, address }) : post('/clients', { name, contact, address })), { ok: client ? 'Client updated' : 'Client added - alias assigned automatically', invalidate: ['clients'], onSuccess: onClose })
  return (
    <Modal open onClose={onClose} title={client ? `Edit ${client.alias}` : 'Add client'}><div className="space-y-4">
      <Field label="Real name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
      <Field label="Contact"><input className="input" value={contact} onChange={(e) => setContact(e.target.value)} /></Field>
      <Field label="Address"><input className="input" value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
      <p className="text-xs text-slate-500">Everyone without the "see real client details" permission will only see an alias like "Client A".</p>
      <ErrorBox error={save.error} /><div className="flex justify-end gap-2"><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={!name.trim() || save.isPending} onClick={() => save.mutate(undefined)}>{save.isPending && <Spinner />}Save</button></div></div></Modal>
  )
}
