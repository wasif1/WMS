import { useState } from 'react'
import { t, Trans, ts } from '@/i18n'
import { useQuery } from '@tanstack/react-query'
import { DatabaseBackup, Lock, Mail } from 'lucide-react'
import { Badge, Card, Empty, ErrorBox, Field, PageHeader, PageLoader, Spinner, Table } from '@/components/ui'
import { get, post, put } from '@/lib/api'
import { useAction } from '@/lib/hooks'
import { fmtDate } from '@/lib/utils'

const SCHEDULES: Record<string, string> = { '0 2 * * 0': ts('Weekly - Sundays at 02:00'), '0 2 1 * *': ts('Monthly - 1st at 02:00'), '0 2 * * *': ts('Daily at 02:00') }
const human = (cron: string) => (SCHEDULES[cron] ? t(SCHEDULES[cron]) : cron)

export default function Admin() {
  const backups = useQuery({ queryKey: ['backups'], queryFn: () => get<any>('/admin/backups') })
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => get<any>('/admin/settings') })
  const outbox = useQuery({ queryKey: ['outbox'], queryFn: () => get<any[]>('/admin/outbox') })
  const [emails, setEmails] = useState<string>()
  const run = useAction(() => post('/admin/backups'), { ok: t("Encrypted backup created and verified"), invalidate: ['backups'] })
  const save = useAction(() => put('/admin/settings', { auditEmails: (emails ?? '').split(/[,;\s]+/).filter(Boolean) }), { ok: t("Settings saved"), invalidate: ['settings'] })
  if (backups.isLoading || settings.isLoading) return <PageLoader />
  const b = backups.data, s = settings.data
  return (
    <>
      <PageHeader title={t("Backups & settings")} subtitle={t("Encrypted, verified backups. Only the newest copies are kept.")} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="flex items-center gap-2 font-semibold"><DatabaseBackup className="h-4 w-4 text-brand-600" />{t("Database backups")}</h2><button className="btn-primary" disabled={run.isPending} onClick={() => run.mutate(undefined)}>{run.isPending && <Spinner />}{t("Back up now")}</button></div>
          <p className="mb-4 text-sm text-slate-600"><Trans k="Schedule: {when} · keeping the newest {n}. Each file is AES-256-GCM encrypted with a separate key and checked (decrypt + integrity test) before older copies are removed." vars={{ when: <b>{human(b.cron)}</b>, n: <b>{b.keep}</b> }} /></p>
          <ErrorBox error={run.error ?? backups.error} />
          <Table head={[t("File"), t("Created"), t("Size")]} empty={!b.items.length && <Empty>{t("No backups yet.")}</Empty>}>{b.items.map((f: any) => <tr key={f.file}><td className="td font-mono text-xs">{f.file}</td><td className="td">{fmtDate(f.createdAt)}</td><td className="td">{t('{n} KB', { n: (f.bytes / 1024).toFixed(1) })}</td></tr>)}</Table>
          <p className="mt-3 text-xs text-slate-500">{t("Copy these files to a second location (another server or object storage). The encryption key is kept separately and is required to restore.")}</p>
        </Card>
        <div className="space-y-6">
          <Card className="space-y-3 p-5"><h2 className="flex items-center gap-2 font-semibold"><Lock className="h-4 w-4 text-brand-600" />{t("Security status")}</h2>
            <p className="flex justify-between text-sm"><span>{t("Two-factor required")}</span>{s.mfaRequired ? <Badge tone="green">{t("Yes")}</Badge> : <Badge tone="amber">{t("Optional")}</Badge>}</p>
            <p className="flex justify-between text-sm"><span>{t("Email delivery (SMTP)")}</span>{s.smtpConfigured ? <Badge tone="green">{t("Configured")}</Badge> : <Badge tone="amber">{t("Not set")}</Badge>}</p>
          </Card>
          <Card className="space-y-3 p-5"><h2 className="flex items-center gap-2 font-semibold"><Mail className="h-4 w-4 text-brand-600" />{t("Audit summary recipients")}</h2>
            <Field label={t("Emails (comma separated)")}><input className="input" value={emails ?? s.auditEmails.join(', ')} onChange={(e) => setEmails(e.target.value)} /></Field>
            <ErrorBox error={save.error} /><button className="btn-secondary" disabled={save.isPending} onClick={() => save.mutate(undefined)}>{t("Save")}</button></Card>
        </div>
      </div>
      <h2 className="mb-3 mt-8 text-sm font-semibold">{t("Recent emails")} {!s.smtpConfigured && <span className="font-normal text-amber-600">{t("(SMTP not configured - messages are only stored here, not sent)")}</span>}</h2>
      <Table head={[t("When"), t("To"), t("Subject"), t("Status")]} empty={!outbox.data?.length && <Empty>{t("No emails yet.")}</Empty>}>{outbox.data?.slice(0, 20).map((m) => <tr key={m.id}><td className="td whitespace-nowrap text-slate-600">{fmtDate(m.at)}</td><td className="td text-xs">{m.to.join(', ')}</td><td className="td">{m.subject}</td><td className="td"><Badge tone={m.status === 'sent' ? 'green' : m.status === 'failed' ? 'red' : 'amber'}>{m.status.replace('_', ' ')}</Badge></td></tr>)}</Table>
    </>
  )
}
