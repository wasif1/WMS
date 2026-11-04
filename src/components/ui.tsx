import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Info, Loader2, RefreshCw, WifiOff, X } from 'lucide-react'
import { describeError, errorLine } from '@/lib/errors'
import { cn } from '@/lib/utils'

export const Spinner = ({ className }: { className?: string }) => <Loader2 className={cn('h-4 w-4 animate-spin', className)} />
export const PageLoader = () => <div className="flex justify-center py-20 text-slate-400"><Spinner className="h-6 w-6" /></div>

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>{subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}</div>
      <div className="flex flex-wrap gap-2">{actions}</div>
    </div>
  )
}

const tones: Record<string, string> = {
  gray: 'bg-slate-100 text-slate-700', green: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20', amber: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  red: 'bg-red-50 text-red-700 ring-red-600/20', blue: 'bg-blue-50 text-blue-700 ring-blue-600/20', indigo: 'bg-indigo-50 text-indigo-700 ring-indigo-600/20',
}
export const Badge = ({ tone = 'gray', children }: { tone?: keyof typeof tones; children: ReactNode }) =>
  <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ring-transparent', tones[tone])}>{children}</span>

const statusTone: Record<string, keyof typeof tones> = {
  pending: 'amber', approved: 'green', rejected: 'red', draft: 'gray', in_transit: 'blue', received: 'green', cancelled: 'gray', active: 'indigo',
  converted: 'green', saved: 'amber', confirmed: 'green', counting: 'blue', submitted: 'amber',
}
const statusText: Record<string, string> = { pending: 'awaiting approval', submitted: 'awaiting approval', in_transit: 'in transit' }
export const StatusBadge = ({ status }: { status: string }) => <Badge tone={statusTone[status] ?? 'gray'}>{statusText[status] ?? status.replace('_', ' ')}</Badge>

export const Card = ({ className, children }: { className?: string; children: ReactNode }) => <div className={cn('card', className)}>{children}</div>
/** Short numbered help shown at the top of a form for staff on the simple screen. */
export function SimpleSteps({ steps }: { steps: string[] }) {
  return (
    <ol className="mb-4 space-y-2 rounded-xl border border-sky-200 bg-sky-50 p-4 text-base text-sky-900" aria-label="How to fill this in">
      {steps.map((t, i) => <li key={i} className="flex gap-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-600 text-sm font-bold text-white">{i + 1}</span><span className="pt-0.5">{t}</span></li>)}
    </ol>
  )
}
export const Empty = ({ children }: { children: ReactNode }) => <div className="px-4 py-12 text-center text-sm text-slate-500">{children}</div>

export function Table({ head, children, empty }: { head: ReactNode[]; children: ReactNode; empty?: ReactNode }) {
  return (
    <Card className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200">
        <thead className="bg-slate-50/70"><tr>{head.map((h, i) => <th key={i} className="th">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
      {empty}
    </Card>
  )
}

export function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: ReactNode }) {
  return <label className="block"><span className="label">{label}</span>{children}{hint && !error && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}{error && <span className="mt-1 block text-xs text-red-600">{error}</span>}</label>
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()} role="dialog" aria-modal="true" aria-label={title}>
      <div className={cn('mt-10 w-full rounded-2xl bg-white shadow-xl', wide ? 'max-w-4xl' : 'max-w-lg')}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><h2 className="text-base font-semibold">{title}</h2><button className="btn-ghost !p-1.5" onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></button></div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

export function Kpi({ label, value, hint, icon, tone = 'indigo' }: { label: string; value: ReactNode; hint?: string; icon?: ReactNode; tone?: 'indigo' | 'green' | 'amber' | 'red' | 'blue' }) {
  const bg = { indigo: 'bg-indigo-50 text-indigo-600', green: 'bg-emerald-50 text-emerald-600', amber: 'bg-amber-50 text-amber-600', red: 'bg-red-50 text-red-600', blue: 'bg-blue-50 text-blue-600' }[tone]
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between"><div><p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p><p className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">{value}</p></div>{icon && <div className={cn('rounded-lg p-2.5', bg)}>{icon}</div>}</div>
      {hint && <p className="mt-2 text-xs text-slate-500">{hint}</p>}
    </Card>
  )
}

/** Inline, human-readable error. Pass anything thrown; shows what happened, what to do, each field problem, and a reference for server faults. */
let inlineErrors = 0 // how many <ErrorBox>es are on screen; lets the toast layer avoid saying the same thing twice
export function ErrorBox({ error, onRetry }: { error?: unknown; onRetry?: () => void }) {
  const shown = !!error
  useEffect(() => { if (!shown) return; inlineErrors++; return () => { inlineErrors-- } }, [shown])
  if (!error) return null
  const d = describeError(error)
  const Icon = d.kind === 'network' ? WifiOff : AlertTriangle
  return (
    <div role="alert" className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-800">
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{d.title}</p>
        {d.message && <p className="mt-0.5">{d.message}</p>}
        {d.fields.length > 1 && <ul className="mt-1 list-disc space-y-0.5 pl-4">{d.fields.map((f, i) => <li key={i}>{f.message}.</li>)}</ul>}
        {d.requestId && <p className="mt-1 text-xs opacity-80">Reference: <code className="select-all rounded bg-red-100 px-1">{d.requestId}</code></p>}
        {(onRetry && d.retryable) && <button type="button" className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-red-300 bg-white px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-100" onClick={onRetry}><RefreshCw className="h-3.5 w-3.5" />Try again</button>}
      </div>
    </div>
  )
}

/** Banner shown while the browser has no connection. */
export function OfflineBanner() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)
  useEffect(() => {
    const up = () => setOnline(true), down = () => setOnline(false)
    window.addEventListener('online', up); window.addEventListener('offline', down)
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down) }
  }, [])
  if (online) return null
  return <div role="status" className="fixed inset-x-0 top-0 z-[70] flex items-center justify-center gap-2 bg-slate-900 px-4 py-2 text-sm text-white"><WifiOff className="h-4 w-4" />You're offline. Changes can't be saved until your connection is back.</div>
}

// ---- toasts ----
interface Toast { id: number; kind: 'ok' | 'err' | 'info'; text: string }
const ToastCtx = createContext<(kind: Toast['kind'], text: string) => void>(() => {})
let emit: ((kind: Toast['kind'], text: string) => void) | null = null
let lastErr = { text: '', at: 0 }
/** Toast from outside React (e.g. the data-loading layer). Identical errors within 4s are shown once. */
export const toastError = (e: unknown) => {
  // wait a beat: if the page shows the error inline (with a Try again button) a toast would just repeat it
  setTimeout(() => {
    if (inlineErrors > 0) return
    const text = errorLine(e); if (text === lastErr.text && Date.now() - lastErr.at < 4000) return
    lastErr = { text, at: Date.now() }; emit?.('err', text)
  }, 200)
}
export const useToast = () => useContext(ToastCtx)
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([])
  const push = useCallback((kind: Toast['kind'], text: string) => {
    const id = Date.now() + Math.random()
    setItems((s) => [...s.slice(-2), { id, kind, text }]); setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), 4000)
  }, [])
  useEffect(() => { emit = push; return () => { emit = null } }, [push])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-[60] flex w-80 flex-col gap-2" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className="pointer-events-auto flex items-start gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-lg">
            {t.kind === 'ok' ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" /> : t.kind === 'err' ? <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" /> : <Info className="h-4 w-4 shrink-0 text-blue-600" />}
            <span className="min-w-0 break-words">{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

export function Confirm({ open, title, message, confirmLabel = 'Confirm', danger, onConfirm, onClose, busy }: { open: boolean; title: string; message: ReactNode; confirmLabel?: string; danger?: boolean; busy?: boolean; onConfirm: () => void; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="text-sm text-slate-600">{message}</div>
      <div className="mt-5 flex justify-end gap-2"><button className="btn-secondary" onClick={onClose}>Cancel</button><button className={danger ? 'btn-danger' : 'btn-primary'} disabled={busy} onClick={onConfirm}>{busy && <Spinner />}{confirmLabel}</button></div>
    </Modal>
  )
}
