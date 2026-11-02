import { useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { useAuth } from '@/auth/AuthContext'
import { Card, ErrorBox, Field, PageHeader, Badge, useToast } from '@/components/ui'
import { post } from '@/lib/api'
import { useAction } from '@/lib/hooks'
import { ShieldCheck } from 'lucide-react'

export default function Account() {
  const { user, refresh } = useAuth(); const toast = useToast()
  const [cur, setCur] = useState(''), [nw, setNw] = useState(''), [nw2, setNw2] = useState('')
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string }>(), [code, setCode] = useState(''), [dPw, setDPw] = useState('')
  const change = useAction(() => post('/auth/password', { currentPassword: cur, newPassword: nw }), { ok: 'Password changed. Other devices were signed out.', onSuccess: () => { setCur(''); setNw(''); setNw2(''); refresh() } })
  const start = useAction(() => post('/auth/totp/setup'), { onSuccess: setSetup })
  const enable = useAction(() => post('/auth/totp/enable', { code }), { ok: 'Two-factor authentication enabled', onSuccess: () => { setSetup(undefined); setCode(''); refresh() } })
  const disable = useAction(() => post('/auth/totp/disable', { password: dPw, code }), { ok: 'Two-factor disabled', onSuccess: () => { setCode(''); setDPw(''); refresh() } })
  return (
    <div className="max-w-2xl">
      <PageHeader title="My account" subtitle={`${user?.name} · ${user?.email}`} />
      {user?.mustChangePassword && <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">You must set a new password before using the system.</div>}
      {user?.mfaSetupRequired && <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Two-factor authentication is required. Enable it below to continue.</div>}
      <Card className="mb-6 space-y-4 p-6">
        <h2 className="font-semibold">Change password</h2>
        <Field label="Current password"><input className="input" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></Field>
        <Field label="New password" hint="At least 12 characters, with letters and a number or symbol."><input className="input" type="password" autoComplete="new-password" value={nw} onChange={(e) => setNw(e.target.value)} /></Field>
        <Field label="Confirm new password" error={nw2 && nw !== nw2 ? 'Passwords do not match' : undefined}><input className="input" type="password" autoComplete="new-password" value={nw2} onChange={(e) => setNw2(e.target.value)} /></Field>
        <ErrorBox error={change.error} />
        <button className="btn-primary" disabled={!cur || !nw || nw !== nw2 || change.isPending} onClick={() => change.mutate(undefined)}>Update password</button>
      </Card>
      <Card className="space-y-4 p-6">
        <div className="flex items-center justify-between"><h2 className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-4 w-4 text-brand-600" />Two-factor authentication</h2>{user?.totpEnabled ? <Badge tone="green">Enabled</Badge> : <Badge tone="amber">Off</Badge>}</div>
        {!user?.totpEnabled && !setup && <><p className="text-sm text-slate-600">Add a second step at sign-in using an authenticator app (Google Authenticator, Authy, 1Password…). Strongly recommended for all users.</p><button className="btn-primary" onClick={() => start.mutate(undefined)}>Set up</button></>}
        {setup && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">Scan this QR code with your authenticator app, then enter the 6-digit code.</p>
            <div className="flex flex-wrap items-center gap-5"><div className="rounded-lg border border-slate-200 bg-white p-3"><QRCodeSVG value={setup.otpauthUrl} size={150} /></div><div className="text-xs text-slate-500">Can't scan? Enter this key manually:<p className="mt-1 select-all break-all rounded bg-slate-100 px-2 py-1 font-mono text-sm text-slate-800">{setup.secret}</p></div></div>
            <div className="flex gap-2"><input className="input max-w-[10rem] text-center tracking-widest" inputMode="numeric" maxLength={6} placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} /><button className="btn-primary" disabled={code.length !== 6} onClick={() => enable.mutate(undefined)}>Verify & enable</button></div>
            <ErrorBox error={enable.error} />
          </div>
        )}
        {user?.totpEnabled && (
          <div className="space-y-3 border-t border-slate-100 pt-4"><p className="text-sm text-slate-600">To turn it off, confirm your password and a current code.</p>
            <div className="flex flex-wrap gap-2"><input className="input max-w-[12rem]" type="password" placeholder="Password" value={dPw} onChange={(e) => setDPw(e.target.value)} /><input className="input max-w-[8rem]" inputMode="numeric" maxLength={6} placeholder="Code" value={code} onChange={(e) => setCode(e.target.value)} /><button className="btn-secondary" disabled={!dPw || code.length !== 6} onClick={() => { disable.mutate(undefined); toast('info', 'Verifying…') }}>Disable</button></div><ErrorBox error={disable.error} /></div>
        )}
      </Card>
    </div>
  )
}
