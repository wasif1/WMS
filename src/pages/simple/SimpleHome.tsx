import { useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Archive, ArrowLeftRight, BarChart3, CheckCircle2, ChevronRight, ClipboardCheck, Clock, Download, HelpCircle, MapPin, PackageCheck, PackageMinus, PackagePlus, PackageSearch, Search, SlidersHorizontal, Truck, X, XCircle } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { Badge, Card, Empty, ErrorBox, Modal, PageLoader } from '@/components/ui'
import { get } from '@/lib/api'
import { useLocations, useProducts } from '@/lib/hooks'
import { hasOwnerWorkflow, matchProduct, stockLevel, summarizeStock, tilesFor, type StockLevel, type TileId } from '@/lib/operator'
import { variationOf } from '@/lib/catalog'
import type { Product, StockRow } from '@/lib/types'
import { cn, fmt, fmtDate } from '@/lib/utils'
import { locale, t, ts } from '@/i18n'
import { approvalSummary } from '@/i18n/describe'
import { NewInbound, Review as InboundReview } from '../Inbound'
import { Detail as TransferDetail, NewTransfer } from '../Transfers'
import { NewReserve, Process as ReserveProcess } from '../Reserves'
import { OrderForm, Review as OutboundReview } from '../Outbound'
import { Form as AdjustmentForm } from '../Adjustments'
import { Create as AuditCreate, Sheet as AuditSheet } from '../Audits'
import { ProductForm } from '../Products'
import { LocForm } from '../Locations'
import Reports from '../Reports'
import { ProductOverview } from '../ProductDetail'

const ICONS: Record<string, ReactNode> = {
  download: <Download className="h-7 w-7" />, transfer: <ArrowLeftRight className="h-7 w-7" />, archive: <Archive className="h-7 w-7" />, outbound: <PackageMinus className="h-7 w-7" />,
  count: <ClipboardCheck className="h-6 w-6" />, fix: <SlidersHorizontal className="h-6 w-6" />, product: <PackagePlus className="h-6 w-6" />, place: <MapPin className="h-6 w-6" />, report: <BarChart3 className="h-6 w-6" />,
}
/** solid icon badge + soft card tint per job (each job keeps the same colour everywhere) */
const TONES: Record<string, { badge: string; card: string }> = {
  green: { badge: 'from-emerald-500 to-emerald-600', card: 'hover:border-emerald-300 hover:bg-emerald-50/60' },
  sky: { badge: 'from-sky-500 to-sky-600', card: 'hover:border-sky-300 hover:bg-sky-50/60' },
  indigo: { badge: 'from-indigo-500 to-indigo-600', card: 'hover:border-indigo-300 hover:bg-indigo-50/60' },
  amber: { badge: 'from-amber-500 to-amber-600', card: 'hover:border-amber-300 hover:bg-amber-50/60' },
  teal: { badge: 'from-teal-500 to-teal-600', card: 'hover:border-teal-300 hover:bg-teal-50/60' },
  rose: { badge: 'from-rose-500 to-rose-600', card: 'hover:border-rose-300 hover:bg-rose-50/60' },
  violet: { badge: 'from-violet-500 to-violet-600', card: 'hover:border-violet-300 hover:bg-violet-50/60' },
  slate: { badge: 'from-slate-500 to-slate-600', card: 'hover:border-slate-300 hover:bg-slate-100' },
  cyan: { badge: 'from-cyan-500 to-cyan-600', card: 'hover:border-cyan-300 hover:bg-cyan-50/60' },
}

type Open =
  | { kind: 'tile'; id: TileId }
  | { kind: 'product'; product: Product }
  | { kind: 'receive'; order: any } | { kind: 'inboundReview'; order: any } | { kind: 'outboundReview'; order: any } | { kind: 'outboundEdit'; order: any }
  | { kind: 'reserveProcess'; order: any } | { kind: 'audit'; id: number } | { kind: 'help' }

const greeting = (name: string) => { const h = new Date().getHours(); return h < 12 ? t('Good morning, {name}', { name }) : h < 17 ? t('Good afternoon, {name}', { name }) : t('Good evening, {name}', { name }) }

export default function SimpleHome() {
  const { user, can } = useAuth()
  const tiles = tilesFor(can)
  const [open, setOpen] = useState<Open | null>(null)
  const owner = can('approvals.manage')
  const primary = tiles.filter((x) => x.primary), more = tiles.filter((x) => !x.primary)

  return (
    <div className="space-y-8">
      <Hero name={user?.name.split(' ')[0] ?? ''} canSearch={can('products.view')} onOpen={(p) => setOpen({ kind: 'product', product: p })} />
      <TodoList onOpen={setOpen} />

      {tiles.length > 0 && (
        <section aria-labelledby="jobs" className="space-y-4">
          <h2 id="jobs" className="text-2xl font-bold text-slate-900">{t('Do a job')}</h2>
          {primary.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2">
              {primary.map((x) => (
                <button key={x.id} type="button" onClick={() => setOpen({ kind: 'tile', id: x.id })}
                  className={cn('group flex items-center gap-4 rounded-2xl border-2 border-slate-200 bg-white p-5 text-start shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/40', TONES[x.tone].card)}>
                  <span className={cn('flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow', TONES[x.tone].badge)}>{ICONS[x.icon]}</span>
                  <span className="min-w-0 flex-1"><span className="block text-xl font-bold leading-snug text-slate-900">{t(x.title)}</span><span className="mt-0.5 block text-base text-slate-600">{t(x.help)}</span></span>
                  <ChevronRight className="h-6 w-6 shrink-0 text-slate-300 transition group-hover:text-slate-500 rtl:rotate-180" />
                </button>
              ))}
            </div>
          )}
          {more.length > 0 && (
            <>
              {primary.length > 0 && <h3 className="pt-1 text-lg font-semibold text-slate-700">{t('Other jobs')}</h3>}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {more.map((x) => (
                  <button key={x.id} type="button" onClick={() => setOpen({ kind: 'tile', id: x.id })}
                    className={cn('flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 text-start transition focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/40', TONES[x.tone].card)}>
                    <span className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white', TONES[x.tone].badge)}>{ICONS[x.icon]}</span>
                    <span className="min-w-0"><span className="block text-lg font-semibold leading-snug text-slate-900">{t(x.title)}</span><span className="block text-sm text-slate-500">{t(x.help)}</span></span>
                  </button>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      {(hasOwnerWorkflow(can) || can('inbound.create')) && <MyRequests owner={owner} />}
      {can('dashboard.view') && <Overview />}

      <button type="button" className="btn-secondary mx-auto !h-12 !px-6 !text-base" onClick={() => setOpen({ kind: 'help' })}><HelpCircle className="h-5 w-5" />{t('How do I use this screen?')}</button>
      <Dialogs open={open} close={() => setOpen(null)} setOpen={setOpen} />
    </div>
  )
}

// ---------------------------------------------------------------- Hero: greeting + the search box
function Hero({ name, canSearch, onOpen }: { name: string; canSearch: boolean; onOpen: (p: Product) => void }) {
  const [q, setQ] = useState(''), [loc, setLoc] = useState(''), [onlyStock, setOnlyStock] = useState(false), [all, setAll] = useState(false)
  const products = useProducts(canSearch); const locs = useLocations(canSearch)
  const stock = useQuery({ queryKey: ['stock', 'all'], queryFn: () => get<StockRow[]>('/stock'), enabled: canSearch })
  const L = new Map((locs.data ?? []).map((l) => [l.id, l.name]))
  const searching = q.trim() !== '' || loc !== '' || onlyStock || all
  const rows = useMemo(() => {
    const locId = loc ? Number(loc) : undefined
    return (products.data ?? []).filter((p) => p.active && matchProduct(p, q)).map((p) => ({ p, s: summarizeStock(p, stock.data ?? [], locId) })).filter((r) => !onlyStock || r.s.available > 0)
  }, [products.data, stock.data, q, loc, onlyStock])
  const shown = rows.slice(0, 30)
  const today = new Date().toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' })
  return (
    <section aria-label={t('Search')} className="space-y-4">
      <div className="overflow-hidden rounded-3xl bg-gradient-to-br from-brand-600 via-brand-600 to-indigo-500 p-6 text-white shadow-lg sm:p-8">
        <p className="text-sm font-medium text-white/80">{today}</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">{greeting(name)}</h1>
        <p className="mt-1 text-lg text-white/90">{canSearch ? t('What are you looking for? Type a product name, colour, size or code.') : t('What do you want to do today? Press a big button below.')}</p>
        {canSearch && (
          <>
            <div className="relative mt-5">
              <Search className="pointer-events-none absolute start-4 top-1/2 h-6 w-6 -translate-y-1/2 text-slate-400" />
              <input className="!h-14 w-full rounded-2xl border-0 bg-white !ps-12 !pe-12 !text-lg text-slate-900 shadow-lg placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-white/40" type="search" inputMode="search" autoComplete="off" aria-label={t('Search products')} placeholder={t('Search name, colour or code…')} value={q} onChange={(e) => setQ(e.target.value)} />
              {q && <button type="button" aria-label={t('Clear search')} className="absolute end-3 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-slate-400 hover:bg-slate-100" onClick={() => setQ('')}><X className="h-5 w-5" /></button>}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-base text-white/90">
              <label className="flex items-center gap-2">{t('Warehouse')}
                <select className="!h-10 !w-auto !rounded-lg !border-0 !bg-white/95 !py-1 !text-base text-slate-900" aria-label={t('Warehouse')} value={loc} onChange={(e) => setLoc(e.target.value)}><option value="">{t('All warehouses')}</option>{(locs.data ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
              </label>
              <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" className="h-5 w-5 rounded" checked={onlyStock} onChange={(e) => setOnlyStock(e.target.checked)} />{t('Only show what is in stock')}</label>
              {!searching && <button type="button" className="font-semibold underline underline-offset-4 hover:text-white" onClick={() => setAll(true)}>{t('Show all products')}</button>}
            </div>
          </>
        )}
      </div>

      {canSearch && searching && (
        <Card className="space-y-3 p-4 sm:p-5">
          <ErrorBox error={products.error ?? stock.error} onRetry={() => { products.refetch(); stock.refetch() }} />
          {products.isLoading ? <PageLoader /> : (
            <>
              <div className="flex items-center justify-between gap-2"><p className="text-base font-semibold text-slate-700" aria-live="polite">{q ? t('{n} found for “{q}”', { n: rows.length, q }) : t('{n} products', { n: rows.length })}</p>{(q || loc || onlyStock || all) && <button type="button" className="text-base font-semibold text-brand-700 underline underline-offset-4" onClick={() => { setQ(''); setLoc(''); setOnlyStock(false); setAll(false) }}>{t('Clear')}</button>}</div>
              {shown.length === 0 ? <Empty><PackageSearch className="mx-auto mb-2 h-10 w-10 text-slate-300" />{t('Nothing found. Try fewer words, or check the spelling.')}</Empty> : (
                <ul className="grid gap-3 lg:grid-cols-2">{shown.map(({ p, s }) => <li key={p.id}><ProductCard p={p} s={s} L={L} onOpen={onOpen} /></li>)}</ul>
              )}
              {rows.length > shown.length && <p className="text-center text-base text-slate-500">{t('Showing the first {n}. Type more letters to narrow it down.', { n: shown.length })}</p>}
            </>
          )}
        </Card>
      )}
    </section>
  )
}

const LEVEL: Record<StockLevel, { text: string; cls: string; icon: ReactNode }> = {
  in: { text: ts('In stock'), cls: 'bg-emerald-100 text-emerald-800', icon: <CheckCircle2 className="h-4 w-4" /> },
  low: { text: ts('Low stock'), cls: 'bg-amber-100 text-amber-800', icon: <AlertTriangle className="h-4 w-4" /> },
  out: { text: ts('Out of stock'), cls: 'bg-red-100 text-red-800', icon: <XCircle className="h-4 w-4" /> },
}
function ProductCard({ p, s, L, onOpen }: { p: Product; s: ReturnType<typeof summarizeStock>; L: Map<number, string>; onOpen: (p: Product) => void }) {
  const lv = LEVEL[stockLevel(p, s.available)]
  return (
    <button type="button" onClick={() => onOpen(p)} className="flex h-full w-full items-start justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4 text-start transition hover:border-brand-500 hover:shadow focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/30">
      <span className="min-w-0">
        <span className="block text-lg font-bold leading-snug text-slate-900">{p.name || t('Unnamed product')}</span>
        <span className="block text-base text-slate-600">{[variationOf(p), p.weight].filter(Boolean).join(' · ') || t('No colour or size')}</span>
        <span className="mt-1 inline-block rounded bg-slate-100 px-2 py-0.5 font-mono text-sm text-slate-600" dir="ltr">{t('Code: {sku}', { sku: p.sku })}</span>
        {s.byLocation.length > 0 && <span className="mt-2 flex flex-wrap gap-1.5">{s.byLocation.map((b) => <span key={b.locationId} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-sm text-slate-700">{L.get(b.locationId) ?? '…'}: <b>{fmt(b.available)}</b></span>)}</span>}
      </span>
      <span className="shrink-0 text-end">
        <span className={cn('block text-3xl font-bold leading-none', s.available > 0 ? 'text-slate-900' : 'text-red-600')}>{fmt(s.available)}</span>
        <span className="block text-sm text-slate-500">{t('available')}</span>
        {s.boxes !== null && <span className="block text-sm text-slate-500">{t('≈ {n} boxes', { n: fmt(s.boxes) })}</span>}
        <span className={cn('mt-2 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-sm font-semibold', lv.cls)}>{lv.icon}{t(lv.text)}</span>
      </span>
    </button>
  )
}

// ---------------------------------------------------------------- Things waiting for me
function TodoList({ onOpen }: { onOpen: (o: Open) => void }) {
  const { can } = useAuth(); const locs = useLocations()
  const lname = (id: number) => locs.data?.find((l) => l.id === id)?.name ?? '…'
  const units = (o: any) => fmt(o.lines.reduce((a: number, l: any) => a + l.qty, 0))
  const both = (a: boolean, b: boolean) => a && b
  const transfers = useQuery({ queryKey: ['transfers', 'todo'], queryFn: () => get<any[]>('/transfers?status=in_transit'), enabled: both(can('transfers.view'), can('transfers.receive')) })
  const drafts = useQuery({ queryKey: ['transfers', 'drafts'], queryFn: () => get<any[]>('/transfers?status=draft'), enabled: both(can('transfers.view'), can('transfers.create')) })
  const outbound = useQuery({ queryKey: ['outbound', 'todo'], queryFn: () => get<any[]>('/outbound?status=saved'), enabled: both(can('outbound.view'), can('outbound.confirm', 'outbound.create')) })
  const reserves = useQuery({ queryKey: ['reserves', 'todo'], queryFn: () => get<any[]>('/reserves?status=active'), enabled: both(can('reserves.view'), can('reserves.convert')) })
  const inbound = useQuery({ queryKey: ['inbound', 'todo'], queryFn: () => get<any[]>('/inbound?status=pending'), enabled: both(can('inbound.view'), can('inbound.approve')) })
  const audits = useQuery({ queryKey: ['audits', 'todo'], queryFn: () => get<any[]>('/audits'), enabled: both(can('audits.view'), can('audits.count')) })
  const route = (o: any) => `${lname(o.fromLocationId)} ⟶ ${lname(o.toLocationId)}`
  const items: { key: string; icon: ReactNode; tone: string; title: string; sub: string; button: string; go: () => void }[] = [
    ...(transfers.data ?? []).map((o) => ({ key: `t${o.id}`, tone: 'sky', icon: <Truck className="h-7 w-7" />, title: t('Goods arriving: {route}', { route: route(o) }), sub: t('{n} units on the way. Check them when they arrive.', { n: units(o) }), button: t('Receive'), go: () => onOpen({ kind: 'receive', order: o }) })),
    ...(drafts.data ?? []).map((o) => ({ key: `d${o.id}`, tone: 'sky', icon: <ArrowLeftRight className="h-7 w-7" />, title: t('Ready to send: {route}', { route: route(o) }), sub: t('{n} units saved. Press Send when the goods leave.', { n: units(o) }), button: t('Send it'), go: () => onOpen({ kind: 'receive', order: o }) })),
    ...(outbound.data ?? []).map((o) => ({ key: `o${o.id}`, tone: 'indigo', icon: <PackageMinus className="h-7 w-7" />, title: t('Customer order #{id} is ready to check', { id: o.id }), sub: t('{n} units from {place}. Check, then confirm.', { n: units(o), place: lname(o.locationId) }), button: t('Check & confirm'), go: () => onOpen({ kind: 'outboundReview', order: o }) })),
    ...(reserves.data ?? []).map((o) => ({ key: `r${o.id}`, tone: 'amber', icon: <Archive className="h-7 w-7" />, title: t('Stock kept aside #{id}', { id: o.id }), sub: t('{n} units at {place}. Send it out when the customer collects.', { n: units(o), place: lname(o.locationId) }), button: t('Open'), go: () => onOpen({ kind: 'reserveProcess', order: o }) })),
    ...(inbound.data ?? []).map((o) => ({ key: `i${o.id}`, tone: 'green', icon: <Download className="h-7 w-7" />, title: t('Delivery #{id} waits for a check', { id: o.id }), sub: t('{n} units entered by {name}. Check the boxes, then approve.', { n: units(o), name: o.enteredBy.name }), button: t('Check'), go: () => onOpen({ kind: 'inboundReview', order: o }) })),
    ...(audits.data ?? []).filter((a) => a.status === 'counting').map((a) => ({ key: `a${a.id}`, tone: 'teal', icon: <ClipboardCheck className="h-7 w-7" />, title: t('Counting in progress: {name}', { name: a.name }), sub: t('Count the stock and write the numbers. Then send it for approval.'), button: t('Continue counting'), go: () => onOpen({ kind: 'audit', id: a.id }) })),
  ]
  const all = [transfers, drafts, outbound, reserves, inbound, audits]
  const loading = all.some((x) => x.isLoading)
  const error = all.find((x) => x.error)?.error
  const relevant = can('transfers.create') || can('transfers.receive') || can('outbound.confirm') || can('reserves.convert') || can('inbound.approve') || can('audits.count')
  if (!relevant) return null
  return (
    <section aria-labelledby="todo" className="space-y-3">
      <h2 id="todo" className="flex items-center gap-3 text-2xl font-bold text-slate-900">{t('Waiting for you')} {items.length > 0 && <span className="rounded-full bg-red-600 px-3 py-0.5 text-lg text-white" aria-label={t('{n} waiting', { n: items.length })}>{items.length}</span>}</h2>
      <ErrorBox error={error} />
      {loading ? <PageLoader /> : items.length === 0 ? (
        <Card className="flex items-center gap-3 !border-emerald-200 !bg-emerald-50 px-5 py-4 text-lg font-medium text-emerald-800"><CheckCircle2 className="h-7 w-7 shrink-0" />{t('Nothing is waiting for you. Good work!')}</Card>
      ) : (
        <ul className="space-y-3">{items.map((i) => (
          <li key={i.key}><Card className="flex flex-wrap items-center gap-4 !border-s-4 !border-s-amber-400 p-4">
            <span className={cn('flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br text-white', TONES[i.tone].badge)}>{i.icon}</span>
            <div className="min-w-0 flex-1"><p className="text-lg font-bold text-slate-900">{i.title}</p><p className="text-base text-slate-600">{i.sub}</p></div>
            <button type="button" className="btn-primary !h-12 !px-6 !text-base" onClick={i.go}>{i.button}</button>
          </Card></li>))}</ul>
      )}
    </section>
  )
}

// ---------------------------------------------------------------- My requests (owner approval feedback)
function MyRequests({ owner }: { owner: boolean }) {
  const { user, can } = useAuth()
  const q = useQuery({ queryKey: ['approvals', 'mine'], queryFn: () => get<{ items: any[] }>('/approvals'), enabled: hasOwnerWorkflow(can) })
  const deliveries = useQuery({ queryKey: ['inbound', 'mine'], queryFn: () => get<any[]>('/inbound?status=pending'), enabled: can('inbound.view') && can('inbound.create') })
  const mine = (deliveries.data ?? []).filter((o) => o.enteredBy.userId === user?.id)
  const items = (q.data?.items ?? []).slice(0, 6)
  if (!q.data && !q.error && hasOwnerWorkflow(can)) return null
  const word: Record<string, { text: string; tone: 'amber' | 'green' | 'red'; icon: ReactNode }> = {
    pending: { text: ts('Waiting for the owner'), tone: 'amber', icon: <Clock className="h-5 w-5" /> }, approved: { text: ts('Approved'), tone: 'green', icon: <CheckCircle2 className="h-5 w-5" /> }, rejected: { text: ts('Not approved'), tone: 'red', icon: <XCircle className="h-5 w-5" /> },
  }
  const kind: Record<string, string> = { product: ts('New product'), location: ts('New warehouse'), adjustment: ts('Stock fix'), audit: ts('Stock count') }
  const empty = items.length === 0 && mine.length === 0
  return (
    <section aria-labelledby="mine" className="space-y-3">
      <div><h2 id="mine" className="text-2xl font-bold text-slate-900">{owner ? t('Latest requests') : t('My requests')}</h2><p className="text-base text-slate-500">{owner ? t('Requests from the team.') : t('Some things need the owner to say OK first. You can see the answer here.')}</p></div>
      <ErrorBox error={q.error} onRetry={() => q.refetch()} />
      {empty ? <Card className="p-5 text-lg text-slate-500">{t('You have not sent any requests yet.')}</Card> : (
        <ul className="space-y-3">
          {mine.map((o) => (
            <li key={`dl${o.id}`}><Card className="flex flex-wrap items-center justify-between gap-3 p-4"><div className="min-w-0"><p className="text-sm font-semibold text-slate-400">{t('Goods received')}</p><p className="text-lg font-bold text-slate-900">{t('Delivery #{id}', { id: o.id })}{o.reference ? ` · ${o.reference}` : ''}</p><p className="text-base text-slate-600">{t('{n} units - a manager must check the boxes', { n: fmt(o.lines.reduce((a: number, l: any) => a + l.qty, 0)) })}</p><p className="mt-1 text-sm text-slate-400">{fmtDate(o.enteredBy.at)}</p></div><Badge tone="amber"><span className="me-1.5 inline-flex"><Clock className="h-5 w-5" /></span><span className="text-base">{t('Waiting for a manager')}</span></Badge></Card></li>
          ))}
          {items.map((i) => { const w = word[i.status] ?? word.pending; return (
            <li key={`${i.type}${i.id}`}><Card className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0"><p className="text-sm font-semibold text-slate-400">{t(kind[i.type])}</p><p className="text-lg font-bold text-slate-900">{i.title}</p><p className="text-base text-slate-600">{approvalSummary(i)}</p>
                {i.status === 'rejected' && i.decisionComment && <p className="mt-1 rounded-lg bg-red-50 p-2 text-base text-red-700">{t('Owner says: “{reason}”', { reason: i.decisionComment })}</p>}<p className="mt-1 text-sm text-slate-400">{fmtDate(i.submittedBy?.at)}</p></div>
              <Badge tone={w.tone}><span className="me-1.5 inline-flex">{w.icon}</span><span className="text-base">{t(w.text)}</span></Badge>
            </Card></li>) })}
        </ul>
      )}
    </section>
  )
}

// ---------------------------------------------------------------- This week in numbers
function Overview() {
  const q = useQuery({ queryKey: ['dashboard', 'week'], queryFn: () => get<any>('/dashboard?period=week'), refetchInterval: 60_000 })
  if (!q.data) return q.error ? <ErrorBox error={q.error} onRetry={() => q.refetch()} /> : null
  const k = q.data.kpis
  const items = [
    { label: t('Received'), value: k.inbound, icon: <Download className="h-6 w-6" />, cls: 'text-emerald-700 bg-emerald-50' },
    { label: t('Sent out'), value: k.outbound, icon: <PackageMinus className="h-6 w-6" />, cls: 'text-indigo-700 bg-indigo-50' },
    { label: t('Moved'), value: k.transfers, icon: <ArrowLeftRight className="h-6 w-6" />, cls: 'text-sky-700 bg-sky-50' },
    { label: t('Waiting'), value: k.pending, icon: <Clock className="h-6 w-6" />, cls: k.pending ? 'text-amber-700 bg-amber-50' : 'text-emerald-700 bg-emerald-50' },
  ]
  return (
    <section aria-labelledby="week" className="space-y-3">
      <h2 id="week" className="text-2xl font-bold text-slate-900">{t('This week in numbers')}</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {items.map((i) => (
          <Card key={i.label} className="flex items-center gap-3 p-4">
            <span className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-xl', i.cls)}>{i.icon}</span>
            <div><p className="text-3xl font-bold leading-none text-slate-900">{fmt(i.value)}</p><p className="mt-1 text-base font-semibold text-slate-700">{i.label}</p></div>
          </Card>
        ))}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------- All the pop-up windows (the SAME forms as the full app)
function Dialogs({ open, close, setOpen }: { open: Open | null; close: () => void; setOpen: (o: Open | null) => void }) {
  const { can } = useAuth(); const owner = can('approvals.manage')
  const prods = useProducts(); const locs = useLocations()
  if (!open) return null
  const loc = (id: number) => locs.data?.find((l) => l.id === id)?.name ?? id
  const P = prods.data ?? []
  if (open.kind === 'help') return <Help onClose={close} />
  if (open.kind === 'product') return <Modal open onClose={close} title={t('Product')} wide><ProductOverview id={open.product.id} hideBack /></Modal>
  if (open.kind === 'receive') return <TransferDetail order={open.order} prods={P} loc={loc} onClose={close} />
  if (open.kind === 'inboundReview') return <InboundReview order={open.order} loc={String(loc(open.order.locationId))} onClose={close} />
  if (open.kind === 'outboundReview') return <OutboundReview order={open.order} prods={P} loc={String(loc(open.order.locationId))} onClose={close} onEdit={() => setOpen({ kind: 'outboundEdit', order: open.order })} />
  if (open.kind === 'outboundEdit') return <OrderForm order={open.order} onClose={close} />
  if (open.kind === 'reserveProcess') return <ReserveProcess order={open.order} prods={P} onClose={close} />
  if (open.kind === 'audit') return <AuditSheet id={open.id} onClose={close} />
  switch (open.id) {
    case 'inbound': return <NewInbound onClose={close} />
    case 'transfer': return <NewTransfer onClose={close} />
    case 'reserve': return <NewReserve onClose={close} />
    case 'outbound': return <OrderForm onClose={close} />
    case 'count': return <AuditCreate onClose={close} onDone={(id) => setOpen({ kind: 'audit', id })} />
    case 'fix': return <AdjustmentForm owner={owner} onClose={close} />
    case 'newProduct': return <ProductForm owner={owner} onClose={close} />
    case 'newLocation': return <LocForm owner={owner} onClose={close} />
    case 'reports': return <Modal open onClose={close} title={t('Stock list & reports')} wide><Reports /></Modal>
  }
}

function Help({ onClose }: { onClose: () => void }) {
  const steps: string[] = [
    t('To find a product, type in the big search box. You can type the name, the colour, the size or the code. Press a product to see where it is.'),
    t('To do a job, press one of the big coloured buttons. A window opens. Fill it in and press the blue button at the bottom.'),
    t('Some things need the owner to say OK first (new product, new warehouse, fixing a number, a stock count). Press the button, send it, and the answer will show under “My requests”.'),
    t('Made a mistake? Do not worry. Nothing changes until you press the final blue button. You can close any window with the X.'),
    t('Text too small? Press “Bigger text” at the top of the page.'),
  ]
  return (
    <Modal open onClose={onClose} title={t('How to use this screen')} wide>
      <ol className="space-y-4">{steps.map((s, i) => <li key={i} className="flex gap-4"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-600 text-lg font-bold text-white">{i + 1}</span><p className="pt-1 text-lg text-slate-700">{s}</p></li>)}</ol>
      <div className="mt-6 flex justify-end"><button className="btn-primary !h-12 !px-8 !text-base" onClick={onClose}>{t('OK, I understand')}</button></div>
    </Modal>
  )
}
void PackageCheck
