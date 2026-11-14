import { useState } from 'react'
import { t, ts } from '@/i18n'
import { useQuery } from '@tanstack/react-query'
import { Copy, KeyRound, Lock, Plus, ShieldCheck, ShieldOff, Unlock } from 'lucide-react'
import PermissionMatrix from '@/components/PermissionMatrix'
import { Badge, Confirm, Empty, ErrorBox, Field, Modal, PageHeader, PageLoader, Spinner, Table, useToast } from '@/components/ui'
import { get, patch, post } from '@/lib/api'
import { useAction } from '@/lib/hooks'
import type { Me, PermDef } from '@/lib/types'
import { fmtDate } from '@/lib/utils'

const PRESETS: { name: string; desc: string; role: 'admin' | 'user'; simple?: boolean; perms: (all: PermDef[]) => string[] }[] = [
  { name: ts('Dashboard only'), desc: ts('Sees KPIs, nothing else'), role: 'user', perms: () => ['dashboard.view'] },
  { name: ts('Viewer'), desc: ts('Read-only access to inventory & orders'), role: 'user', perms: (a) => a.map((p) => p.key).filter((k) => k.endsWith('.view') && k !== 'logs.view') },
  { name: ts('Warehouse operator'), desc: ts('Receive, transfer, reserve, count - gets the simple one-page screen'), role: 'user', simple: true, perms: () => ['dashboard.view', 'products.view', 'locations.view', 'inbound.view', 'inbound.create', 'transfers.view', 'transfers.create', 'transfers.receive', 'reserves.view', 'reserves.create', 'outbound.view', 'outbound.create', 'audits.view', 'audits.count', 'clients.view', 'adjustments.create', 'adjustments.view', 'products.create', 'locations.manage'] },
  { name: ts('Manager'), desc: ts('Everything except owner approvals, real client data & logs'), role: 'admin', perms: (a) => a.map((p) => p.key).filter((k) => !['clients.reveal', 'logs.view', 'approvals.manage'].includes(k)) },
  { name: ts('Owner (approver)'), desc: ts('Reviews & approves products, locations, adjustments, audits'), role: 'admin', perms: () => ['approvals.manage', 'dashboard.view', 'products.view', 'locations.view', 'adjustments.view', 'audits.view', 'reports.inventory', 'reports.orders'] },
]

export default function UsersPage() {
  const users = useQuery({ queryKey: ['users'], queryFn: () => get<Me[]>('/users') })
  const meta = useQuery({ queryKey: ['perm-meta'], queryFn: () => get<{ permissions: PermDef[] }>('/users/meta') })
  const [edit, setEdit] = useState<Me | 'new' | null>(null); const [secret, setSecret] = useState<{ title: string; pw: string }>()
  const toast = useToast()
  const useUserAction = (path: (u: Me) => string, ok: string) => useAction((u: Me) => post(path(u)), { ok, invalidate: ['users'], toastError: true })
  const unlock = useUserAction((u) => `/users/${u.id}/unlock`, t('Account unlocked')), resetMfa = useUserAction((u) => `/users/${u.id}/reset-mfa`, t('Two-factor reset'))
  const reset = useAction((u: Me) => post(`/users/${u.id}/reset-password`).then((r) => ({ ...r, u })), { invalidate: ['users'], toastError: true, onSuccess: (r) => setSecret({ title: `New temporary password for ${r.u.name}`, pw: r.temporaryPassword }) })
  if (users.isLoading || meta.isLoading) return <PageLoader />
  return (
    <>
      <PageHeader title={t("Users & access")} subtitle={t("Decide exactly what each person can see and do. Changes apply immediately.")} actions={<button className="btn-primary" onClick={() => setEdit('new')}><Plus className="h-4 w-4" />{t("Add user")}</button>} />
      <ErrorBox error={users.error} />
      <Table head={[t("User"), t("Role"), t("Access"), t("Security"), t("Last sign-in"), '']} empty={!users.data?.length && <Empty>{t("No users.")}</Empty>}>
        {users.data?.map((u) => (
          <tr key={u.id} className="hover:bg-slate-50">
            <td className="td"><p className="font-medium">{u.name}</p><p className="text-xs text-slate-500">{u.email}</p></td>
            <td className="td">{u.role === 'super_admin' ? <Badge tone="indigo">{t("Super admin")}</Badge> : <Badge>{u.role}</Badge>} {u.simpleScreen && <Badge tone="green">{t("simple screen")}</Badge>} {!u.active && <Badge tone="red">{t("disabled")}</Badge>}</td>
            <td className="td text-sm text-slate-600">{u.role === 'super_admin' ? t("Full access") : u.permissions.length === 1 && u.permissions[0] === 'dashboard.view' ? t("Dashboard only") : t('{n} permissions', { n: u.permissions.length })}</td>
            <td className="td"><span className="inline-flex items-center gap-1 text-xs">{u.totpEnabled ? <><ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />{t("2FA")}</> : <><ShieldOff className="h-3.5 w-3.5 text-slate-400" />{t("no 2FA")}</>}</span>{u.locked && <Badge tone="red"><Lock className="me-1 h-3 w-3" />{t("locked")}</Badge>}{u.mustChangePassword && <p className="text-xs text-amber-600">{t("must change password")}</p>}</td>
            <td className="td text-xs text-slate-500">{fmtDate(u.lastLoginAt)}</td>
            <td className="td whitespace-nowrap text-end">
              {u.locked && <button className="btn-ghost" title={t("Unlock")} onClick={() => unlock.mutate(u)}><Unlock className="h-4 w-4" /></button>}
              <button className="btn-ghost" title={t("Reset password")} onClick={() => reset.mutate(u)}><KeyRound className="h-4 w-4" /></button>
              {u.totpEnabled && <button className="btn-ghost" title={t("Reset 2FA")} onClick={() => resetMfa.mutate(u)}><ShieldOff className="h-4 w-4" /></button>}
              <button className="btn-ghost" onClick={() => setEdit(u)}>{t("Edit")}</button>
            </td>
          </tr>
        ))}
      </Table>
      {edit && <UserForm user={edit === 'new' ? undefined : edit} perms={meta.data!.permissions} onClose={() => setEdit(null)} onCreated={(title, pw) => setSecret({ title, pw })} />}
      <Modal open={!!secret} onClose={() => setSecret(undefined)} title={secret?.title ?? ''}>
        <p className="text-sm text-slate-600">{t("Share this one-time password securely. It is shown only once and must be changed at first sign-in.")}</p>
        <div className="mt-3 flex items-center gap-2"><code className="flex-1 select-all rounded-lg bg-slate-100 px-3 py-2 font-mono text-sm">{secret?.pw}</code><button className="btn-secondary" onClick={() => { navigator.clipboard?.writeText(secret!.pw); toast('ok', t("Copied")) }}><Copy className="h-4 w-4" /></button></div>
        <div className="mt-5 flex justify-end"><button className="btn-primary" onClick={() => setSecret(undefined)}>{t("Done")}</button></div>
      </Modal>
    </>
  )
}

export function UserForm({ user, perms, onClose, onCreated }: { user?: Me; perms: PermDef[]; onClose: () => void; onCreated: (t: string, pw: string) => void }) {
  const [simple, setSimple] = useState(user?.simpleScreen ?? false)
  const [name, setName] = useState(user?.name ?? ''), [email, setEmail] = useState(user?.email ?? ''), [role, setRole] = useState<Me['role']>(user?.role ?? 'user'), [active, setActive] = useState(user?.active ?? true)
  const [sel, setSel] = useState<Set<string>>(new Set(user?.role === 'super_admin' ? [] : user?.permissions ?? ['dashboard.view']))
  const [confirmSens, setConfirmSens] = useState<PermDef[] | null>(null)
  const save = useAction(() => user ? patch(`/users/${user.id}`, { name, role, active, permissions: [...sel], simpleScreen: role !== 'super_admin' && simple }) : post('/users', { name, email, role, permissions: [...sel], simpleScreen: role !== 'super_admin' && simple }),
    { ok: user ? t("User updated") : undefined, invalidate: ['users'], onSuccess: (r) => { if (!user) onCreated(`User created: ${r.user.email}`, r.temporaryPassword); onClose() } })
  const isSuper = role === 'super_admin'
  // Sensitive features being NEWLY given (ones the person already had are not asked about again)
  const trySave = () => {
    const fresh = isSuper ? [] : perms.filter((p) => p.sensitive && sel.has(p.key) && !(user?.permissions ?? []).includes(p.key))
    if (fresh.length) setConfirmSens(fresh); else save.mutate(undefined)
  }
  return (
    <>
    <Modal open onClose={() => { if (!confirmSens) onClose() }} title={user ? t('Edit {name}', { name: user.name }) : t("Add user")} wide>
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t("Full name")}><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label={t("Email")}><input className="input" type="email" value={email} disabled={!!user} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label={t("Role")}><select className="input" value={role} onChange={(e) => setRole(e.target.value as Me['role'])}><option value="user">{t("User")}</option><option value="admin">{t("Admin")}</option><option value="super_admin">{t("Super admin (full access)")}</option></select></Field>
        </div>
        {user && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />{t("Account active")}</label>}
        {isSuper ? <p className="rounded-lg bg-indigo-50 p-3 text-sm text-indigo-800">{t("Super admins always have every permission, including user management, backups and real client details.")}</p> : (<>
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900"><input type="checkbox" className="mt-1 h-4 w-4" checked={simple} onChange={(e) => setSimple(e.target.checked)} /><span><b>{t("Simple one-page screen")}</b> {t("(recommended for warehouse staff)")}<br />{t("No side menu. One page with big buttons for only what this person is allowed to do, plus product search. Turn off to give them the full app.")}</span></label>
          <div><p className="label">{t("Quick presets")}</p><div className="flex flex-wrap gap-2">{PRESETS.map((p) => <button key={p.name} type="button" title={t(p.desc)} className="btn-secondary" onClick={() => { setSel(new Set(p.perms(perms))); setRole(p.role); setSimple(!!p.simple) }}>{t(p.name)}</button>)}<button type="button" className="btn-ghost" onClick={() => setSel(new Set())}>{t("Clear")}</button></div></div>
          <PermissionMatrix perms={perms} sel={sel} onChange={setSel} />
        </>)}
        <ErrorBox error={save.error} />
        <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={onClose}>{t("Cancel")}</button><button className="btn-primary" disabled={!name.trim() || (!user && !email.trim()) || save.isPending} onClick={trySave}>{save.isPending && <Spinner />}{user ? t("Save changes") : t("Create user")}</button></div>
      </div>
    </Modal>
      <Confirm open={!!confirmSens} danger busy={save.isPending} title={t('Give sensitive access?')} confirmLabel={t('Yes, give access and save')} onClose={() => setConfirmSens(null)} onConfirm={() => save.mutate(undefined, { onSettled: () => setConfirmSens(null) })}
        message={<div className="space-y-3"><p>{t('You are giving {name} access to these sensitive features:', { name: name.trim() })}</p><ul className="space-y-2">{confirmSens?.map((p) => <li key={p.key} className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-2.5"><i className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-red-600" /><span><b className="text-red-800">{t(p.label)}</b><br /><span className="text-xs text-red-700">{t(p.module)}</span></span></li>)}</ul><p>{t('Only continue if you trust this person with these.')}</p></div>} />
    </>
  )
}
