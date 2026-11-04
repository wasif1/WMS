import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Copy, KeyRound, Lock, Plus, ShieldCheck, ShieldOff, Unlock } from 'lucide-react'
import { Badge, Empty, ErrorBox, Field, Modal, PageHeader, PageLoader, Spinner, Table, useToast } from '@/components/ui'
import { get, patch, post } from '@/lib/api'
import { useAction } from '@/lib/hooks'
import type { Me, PermDef } from '@/lib/types'
import { fmtDate } from '@/lib/utils'

const PRESETS: { name: string; desc: string; role: 'admin' | 'user'; perms: (all: PermDef[]) => string[] }[] = [
  { name: 'Dashboard only', desc: 'Sees KPIs, nothing else', role: 'user', perms: () => ['dashboard.view'] },
  { name: 'Viewer', desc: 'Read-only access to inventory & orders', role: 'user', perms: (a) => a.map((p) => p.key).filter((k) => k.endsWith('.view') && k !== 'logs.view') },
  { name: 'Warehouse operator', desc: 'Receive, transfer, reserve, count', role: 'user', perms: () => ['dashboard.view', 'products.view', 'locations.view', 'inbound.view', 'inbound.create', 'transfers.view', 'transfers.create', 'transfers.receive', 'reserves.view', 'reserves.create', 'outbound.view', 'outbound.create', 'audits.view', 'audits.count', 'clients.view', 'adjustments.create', 'adjustments.view', 'products.create', 'locations.manage'] },
  { name: 'Manager', desc: 'Everything except owner approvals, real client data & logs', role: 'admin', perms: (a) => a.map((p) => p.key).filter((k) => !['clients.reveal', 'logs.view', 'approvals.manage'].includes(k)) },
  { name: 'Owner (approver)', desc: 'Reviews & approves products, locations, adjustments, audits', role: 'admin', perms: () => ['approvals.manage', 'dashboard.view', 'products.view', 'locations.view', 'adjustments.view', 'audits.view', 'reports.inventory', 'reports.orders'] },
]

export default function UsersPage() {
  const users = useQuery({ queryKey: ['users'], queryFn: () => get<Me[]>('/users') })
  const meta = useQuery({ queryKey: ['perm-meta'], queryFn: () => get<{ permissions: PermDef[] }>('/users/meta') })
  const [edit, setEdit] = useState<Me | 'new' | null>(null); const [secret, setSecret] = useState<{ title: string; pw: string }>()
  const toast = useToast()
  const useUserAction = (path: (u: Me) => string, ok: string) => useAction((u: Me) => post(path(u)), { ok, invalidate: ['users'] })
  const unlock = useUserAction((u) => `/users/${u.id}/unlock`, 'Account unlocked'), resetMfa = useUserAction((u) => `/users/${u.id}/reset-mfa`, 'Two-factor reset')
  const reset = useAction((u: Me) => post(`/users/${u.id}/reset-password`).then((r) => ({ ...r, u })), { invalidate: ['users'], onSuccess: (r) => setSecret({ title: `New temporary password for ${r.u.name}`, pw: r.temporaryPassword }) })
  if (users.isLoading || meta.isLoading) return <PageLoader />
  return (
    <>
      <PageHeader title="Users & access" subtitle="Decide exactly what each person can see and do. Changes apply immediately." actions={<button className="btn-primary" onClick={() => setEdit('new')}><Plus className="h-4 w-4" />Add user</button>} />
      <ErrorBox error={users.error} />
      <Table head={['User', 'Role', 'Access', 'Security', 'Last sign-in', '']} empty={!users.data?.length && <Empty>No users.</Empty>}>
        {users.data?.map((u) => (
          <tr key={u.id} className="hover:bg-slate-50">
            <td className="td"><p className="font-medium">{u.name}</p><p className="text-xs text-slate-500">{u.email}</p></td>
            <td className="td">{u.role === 'super_admin' ? <Badge tone="indigo">Super admin</Badge> : <Badge>{u.role}</Badge>} {!u.active && <Badge tone="red">disabled</Badge>}</td>
            <td className="td text-sm text-slate-600">{u.role === 'super_admin' ? 'Full access' : u.permissions.length === 1 && u.permissions[0] === 'dashboard.view' ? 'Dashboard only' : `${u.permissions.length} permissions`}</td>
            <td className="td"><span className="inline-flex items-center gap-1 text-xs">{u.totpEnabled ? <><ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />2FA</> : <><ShieldOff className="h-3.5 w-3.5 text-slate-400" />no 2FA</>}</span>{u.locked && <Badge tone="red"><Lock className="mr-1 h-3 w-3" />locked</Badge>}{u.mustChangePassword && <p className="text-xs text-amber-600">must change password</p>}</td>
            <td className="td text-xs text-slate-500">{fmtDate(u.lastLoginAt)}</td>
            <td className="td whitespace-nowrap text-right">
              {u.locked && <button className="btn-ghost" title="Unlock" onClick={() => unlock.mutate(u)}><Unlock className="h-4 w-4" /></button>}
              <button className="btn-ghost" title="Reset password" onClick={() => reset.mutate(u)}><KeyRound className="h-4 w-4" /></button>
              {u.totpEnabled && <button className="btn-ghost" title="Reset 2FA" onClick={() => resetMfa.mutate(u)}><ShieldOff className="h-4 w-4" /></button>}
              <button className="btn-ghost" onClick={() => setEdit(u)}>Edit</button>
            </td>
          </tr>
        ))}
      </Table>
      {edit && <UserForm user={edit === 'new' ? undefined : edit} perms={meta.data!.permissions} onClose={() => setEdit(null)} onCreated={(title, pw) => setSecret({ title, pw })} />}
      <Modal open={!!secret} onClose={() => setSecret(undefined)} title={secret?.title ?? ''}>
        <p className="text-sm text-slate-600">Share this one-time password securely. It is shown only once and must be changed at first sign-in.</p>
        <div className="mt-3 flex items-center gap-2"><code className="flex-1 select-all rounded-lg bg-slate-100 px-3 py-2 font-mono text-sm">{secret?.pw}</code><button className="btn-secondary" onClick={() => { navigator.clipboard?.writeText(secret!.pw); toast('ok', 'Copied') }}><Copy className="h-4 w-4" /></button></div>
        <div className="mt-5 flex justify-end"><button className="btn-primary" onClick={() => setSecret(undefined)}>Done</button></div>
      </Modal>
    </>
  )
}

function UserForm({ user, perms, onClose, onCreated }: { user?: Me; perms: PermDef[]; onClose: () => void; onCreated: (t: string, pw: string) => void }) {
  const [name, setName] = useState(user?.name ?? ''), [email, setEmail] = useState(user?.email ?? ''), [role, setRole] = useState<Me['role']>(user?.role ?? 'user'), [active, setActive] = useState(user?.active ?? true)
  const [sel, setSel] = useState<Set<string>>(new Set(user?.role === 'super_admin' ? [] : user?.permissions ?? ['dashboard.view']))
  const modules = [...new Set(perms.map((p) => p.module))]
  const toggle = (k: string) => setSel((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })
  const save = useAction(() => user ? patch(`/users/${user.id}`, { name, role, active, permissions: [...sel] }) : post('/users', { name, email, role, permissions: [...sel] }),
    { ok: user ? 'User updated' : undefined, invalidate: ['users'], onSuccess: (r) => { if (!user) onCreated(`User created: ${r.user.email}`, r.temporaryPassword); onClose() } })
  const isSuper = role === 'super_admin'
  return (
    <Modal open onClose={onClose} title={user ? `Edit ${user.name}` : 'Add user'} wide>
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Full name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Email"><input className="input" type="email" value={email} disabled={!!user} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Role"><select className="input" value={role} onChange={(e) => setRole(e.target.value as Me['role'])}><option value="user">User</option><option value="admin">Admin</option><option value="super_admin">Super admin (full access)</option></select></Field>
        </div>
        {user && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />Account active</label>}
        {isSuper ? <p className="rounded-lg bg-indigo-50 p-3 text-sm text-indigo-800">Super admins always have every permission, including user management, backups and real client details.</p> : (<>
          <div><p className="label">Quick presets</p><div className="flex flex-wrap gap-2">{PRESETS.map((p) => <button key={p.name} type="button" title={p.desc} className="btn-secondary" onClick={() => { setSel(new Set(p.perms(perms))); setRole(p.role) }}>{p.name}</button>)}<button type="button" className="btn-ghost" onClick={() => setSel(new Set())}>Clear</button></div></div>
          <div className="grid gap-3 sm:grid-cols-2">
            {modules.map((m) => { const ps = perms.filter((p) => p.module === m); const all = ps.every((p) => sel.has(p.key)); return (
              <fieldset key={m} className="rounded-lg border border-slate-200 p-3"><legend className="flex items-center gap-2 px-1 text-sm font-semibold">{m}<button type="button" className="text-xs font-normal text-brand-600 hover:underline" onClick={() => setSel((s) => { const n = new Set(s); ps.forEach((p) => all ? n.delete(p.key) : n.add(p.key)); return n })}>{all ? 'none' : 'all'}</button></legend>
                {ps.map((p) => <label key={p.key} className="flex items-start gap-2 py-1 text-sm"><input type="checkbox" className="mt-0.5" checked={sel.has(p.key)} onChange={() => toggle(p.key)} /><span>{p.label}{p.sensitive && <Badge tone="amber">sensitive</Badge>}</span></label>)}</fieldset>) })}
          </div>
        </>)}
        <ErrorBox error={save.error} />
        <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={!name.trim() || (!user && !email.trim()) || save.isPending} onClick={() => save.mutate(undefined)}>{save.isPending && <Spinner />}{user ? 'Save changes' : 'Create user'}</button></div>
      </div>
    </Modal>
  )
}
