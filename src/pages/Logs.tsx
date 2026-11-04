import { useState } from 'react'
import { actionLabel } from '@/i18n/labels'
import { t } from '@/i18n'
import { useQuery } from '@tanstack/react-query'
import { ShieldCheck, ShieldAlert } from 'lucide-react'
import { Badge, Empty, ErrorBox, PageHeader, PageLoader, Table } from '@/components/ui'
import { get } from '@/lib/api'
import { fmtDate } from '@/lib/utils'

export default function Logs() {
  const [page, setPage] = useState(0); const size = 50
  const q = useQuery({ queryKey: ['logs', page], queryFn: () => get<{ total: number; items: any[] }>(`/admin/logs?limit=${size}&offset=${page * size}`) })
  const v = useQuery({ queryKey: ['logs-verify'], queryFn: () => get<{ ok: boolean; checked: number }>('/admin/logs/verify') })
  return (
    <>
      <PageHeader title={t("Activity log")} subtitle={t("Who did what and when. Entries are chained so tampering is detectable.")} actions={v.data && (v.data.ok ? <Badge tone="green"><ShieldCheck className="me-1 h-3.5 w-3.5" />{t('Integrity verified · {n} entries', { n: v.data.checked })}</Badge> : <Badge tone="red"><ShieldAlert className="me-1 h-3.5 w-3.5" />{t("TAMPERING DETECTED")}</Badge>)} />
      {q.isLoading ? <PageLoader /> : q.error ? <ErrorBox error={q.error} onRetry={() => q.refetch()} /> : (<>
        <Table head={[t("When"), t("User"), t("Action"), t("Detail"), t("IP")]} empty={!q.data?.items.length && <Empty>{t("No activity.")}</Empty>}>
          {q.data?.items.map((l) => <tr key={l.id}><td className="td whitespace-nowrap text-slate-600">{fmtDate(l.at)}</td><td className="td">{l.userName}</td><td className="td text-xs">{actionLabel(l.action)}</td><td className="td text-slate-600">{l.entity ? `${l.entity} #${l.entityId ?? ''} ` : ''}{l.detail}</td><td className="td text-xs text-slate-400">{l.ip}</td></tr>)}
        </Table>
        <div className="mt-4 flex items-center justify-between text-sm text-slate-500"><span>{t('{n} entries', { n: q.data?.total ?? 0 })}</span><div className="flex gap-2"><button className="btn-secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>{t("Previous")}</button><button className="btn-secondary" disabled={(page + 1) * size >= (q.data?.total ?? 0)} onClick={() => setPage(page + 1)}>{t("Next")}</button></div></div>
      </>)}
    </>
  )
}
