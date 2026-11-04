import { useState } from 'react'
import { PackageCheck } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { ErrorBox, Field, Spinner } from '@/components/ui'
import ThemeToggle from '@/components/ThemeToggle'
import { DEMO } from '@/lib/api'

export default function Login() {
  const { login, loginMfa, notice, clearNotice } = useAuth()
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [code, setCode] = useState('')
  const [mfaToken, setMfaToken] = useState<string>(), [err, setErr] = useState<unknown>(), [busy, setBusy] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(undefined); clearNotice()
    try {
      if (mfaToken) await loginMfa(mfaToken, code.replace(/\s/g, ''))
      else { const r = await login(email, password); if (r.mfaToken) setMfaToken(r.mfaToken) }
    } catch (x) { setErr(x); if (mfaToken && /expired/i.test((x as Error).message)) setMfaToken(undefined) } finally { setBusy(false); setPassword('') }
  }
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-50 via-white to-slate-100 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center"><div className="rounded-2xl bg-brand-600 p-3 text-white shadow-lg"><PackageCheck className="h-7 w-7" /></div><h1 className="mt-4 text-2xl font-semibold tracking-tight">Warehouse Management</h1><p className="mt-1 text-sm text-slate-500">Sign in to continue</p></div>
        <form onSubmit={submit} className="card space-y-4 p-6" autoComplete="on">
          {!mfaToken ? (<>
            <Field label="Email"><input className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus /></Field>
            <Field label="Password"><input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          </>) : (
            <Field label="Authenticator code" hint="Enter the 6-digit code from your authenticator app"><input className="input text-center text-lg tracking-[0.4em]" inputMode="numeric" autoComplete="one-time-code" maxLength={7} required value={code} onChange={(e) => setCode(e.target.value)} autoFocus /></Field>
          )}
          {notice && !err && <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm text-amber-800">{notice}</div>}
          <ErrorBox error={err} />
          <button className="btn-primary w-full" disabled={busy}>{busy && <Spinner />}{mfaToken ? 'Verify' : 'Sign in'}</button>
        </form>
        {DEMO && (
          <div className="card mt-4 space-y-2 p-4 text-xs">
            <p className="font-semibold text-slate-700">Demo mode - fake data stored only in your browser</p>
            <p className="text-slate-500">Password for all: <code className="rounded bg-slate-100 px-1">Demo-Passw0rd-2026</code></p>
            {[['super@demo.test', 'Super admin - everything'], ['owner@demo.test', 'Owner - approves requests'], ['operator@demo.test', 'Operator - simple one-page screen'], ['team@demo.test', 'Team - full app, submits requests'], ['manager@demo.test', 'Manager - inbound approval, real clients'], ['dashboard@demo.test', 'Dashboard only']].map(([e, d]) => (
              <button key={e} type="button" className="flex w-full justify-between rounded px-2 py-1 text-left hover:bg-slate-100" onClick={() => { setEmail(e); setPassword('Demo-Passw0rd-2026') }}><span className="font-mono">{e}</span><span className="text-slate-500">{d}</span></button>
            ))}
          </div>
        )}
        <p className="mt-4 text-center text-xs text-slate-400">Protected system. All activity is logged.</p>
        <div className="mt-2 flex justify-center"><ThemeToggle /></div>
      </div>
    </div>
  )
}
