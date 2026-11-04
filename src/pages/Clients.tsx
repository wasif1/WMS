import { useState } from 'react'
import { t } from '@/i18n'
import { Eye, EyeOff, Plus } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { Badge, Empty, ErrorBox, Field, Modal, PageHeader, PageLoader, Spinner, Table } from '@/components/ui'
import { post, put } from '@/lib/api'
import { useAction, useClients } from '@/lib/hooks'
import type { Client } from '@/lib/types'

export default function Clients() {
  const { can } = useAuth(); const { data, isLoading, error, refetch } = useClients(); const [edit, setEdit] = useState<Client | 'new' | null>(null)
  const reveal = can('clients.reveal')
  return (
    <>
      <PageHeader title={t("Clients")} subtitle={reveal ? t("You can see real client details.") : t("Client identities are anonymised. Real details are visible only to users a super admin has granted access.")}
        actions={can('clients.manage') && <button className="btn-primary" onClick={() => setEdit('new')}><Plus className="h-4 w-4" />{t("Add client")}</button>} />
      <div className={`mb-4 flex items-center gap-2 rounded-lg border p-3 text-sm ${reveal ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-slate-200 bg-white text-slate-600'}`}>{reveal ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}{reveal ? t("Real client data is showing. Access to it is logged.") : t("Showing aliases only.")}</div>
      <ErrorBox error={error} onRetry={() => refetch()} />
      {isLoading ? <PageLoader /> : error ? null : (
        <Table head={[t("Alias"), ...(reveal ? [t("Name"), t("Contact"), t("Address")] : []), '']} empty={!data?.length && <Empty>{t("No clients yet.")}</Empty>}>
          {data?.map((c) => <tr key={c.id} className="hover:bg-slate-50"><td className="td font-medium"><Badge tone="indigo">{c.alias}</Badge></td>{reveal && <><td className="td">{c.name}</td><td className="td text-slate-600">{c.contact || '-'}</td><td className="td text-slate-600">{c.address || '-'}</td></>}<td className="td text-end">{can('clients.manage') && reveal && <button className="btn-ghost" onClick={() => setEdit(c)}>{t("Edit")}</button>}</td></tr>)}
        </Table>
      )}
      {edit && <Form client={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </>
  )
}

function Form({ client, onClose }: { client?: Client; onClose: () => void }) {
  const [name, setName] = useState(client?.name ?? ''), [contact, setContact] = useState(client?.contact ?? ''), [address, setAddress] = useState(client?.address ?? '')
  const save = useAction(() => (client ? put(`/clients/${client.id}`, { name, contact, address }) : post('/clients', { name, contact, address })), { ok: client ? t("Client updated") : t("Client added - alias assigned automatically"), invalidate: ['clients'], onSuccess: onClose })
  return (
    <Modal open onClose={onClose} title={client ? t('Edit {name}', { name: client.alias }) : t("Add client")}><div className="space-y-4">
      <Field label={t("Real name")}><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
      <Field label={t("Contact")}><input className="input" value={contact} onChange={(e) => setContact(e.target.value)} /></Field>
      <Field label={t("Address")}><input className="input" value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
      <p className="text-xs text-slate-500">{t("Everyone without the \"see real client details\" permission will only see an alias like \"Client A\".")}</p>
      <ErrorBox error={save.error} /><div className="flex justify-end gap-2"><button className="btn-secondary" onClick={onClose}>{t("Cancel")}</button><button className="btn-primary" disabled={!name.trim() || save.isPending} onClick={() => save.mutate(undefined)}>{save.isPending && <Spinner />}{t("Save")}</button></div></div></Modal>
  )
}
