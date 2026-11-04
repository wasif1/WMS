import { useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Archive, ArrowLeftRight, BarChart3, CheckCircle2, ClipboardCheck, Clock, Download, Eye, HelpCircle, MapPin, PackageMinus, PackagePlus, PackageSearch, Search, SlidersHorizontal, Truck, X, XCircle } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { Badge, Card, Empty, ErrorBox, Modal, PageLoader } from '@/components/ui'
import { get } from '@/lib/api'
import { useLocations, useProducts } from '@/lib/hooks'
import { hasOwnerWorkflow, matchProduct, summarizeStock, tilesFor, type TileId } from '@/lib/operator'
import { variationOf } from '@/lib/catalog'
import type { Product, StockRow } from '@/lib/types'
import { cn, fmt, fmtDate } from '@/lib/utils'
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
  download: <Download className="h-8 w-8" />, transfer: <ArrowLeftRight className="h-8 w-8" />, archive: <Archive className="h-8 w-8" />, outbound: <PackageMinus className="h-8 w-8" />,
  count: <ClipboardCheck className="h-8 w-8" />, fix: <SlidersHorizontal className="h-8 w-8" />, product: <PackagePlus className="h-8 w-8" />, place: <MapPin className="h-8 w-8" />, report: <BarChart3 className="h-8 w-8" />,
}
const TONES: Record<string, string> = {
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200 hover:bg-emerald-100', sky: 'bg-sky-50 text-sky-700 ring-sky-200 hover:bg-sky-100', amber: 'bg-amber-50 text-amber-700 ring-amber-200 hover:bg-amber-100',
  indigo: 'bg-indigo-50 text-indigo-700 ring-indigo-200 hover:bg-indigo-100', teal: 'bg-teal-50 text-teal-700 ring-teal-200 hover:bg-teal-100', rose: 'bg-rose-50 text-rose-700 ring-rose-200 hover:bg-rose-100',
  violet: 'bg-violet-50 text-violet-700 ring-violet-200 hover:bg-violet-100', slate: 'bg-slate-100 text-slate-700 ring-slate-200 hover:bg-slate-200', cyan: 'bg-cyan-50 text-cyan-700 ring-cyan-200 hover:bg-cyan-100',
}

type Open =
  | { kind: 'tile'; id: TileId }
  | { kind: 'product'; product: Product }
  | { kind: 'receive'; order: any } | { kind: 'inboundReview'; order: any } | { kind: 'outboundReview'; order: any } | { kind: 'outboundEdit'; order: any }
  | { kind: 'reserveProcess'; order: any } | { kind: 'audit'; id: number } | { kind: 'help' }

const hello = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening' }

export default function SimpleHome() {
  const { user, can } = useAuth()
  const tiles = tilesFor(can)
  const [open, setOpen] = useState<Open | null>(null)
  const owner = can('approvals.manage')

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">{hello()}, {user?.name.split(' ')[0]} 👋</h1>
        <p className="mt-1 text-lg text-slate-600">What do you want to do today? Press a big button, or search for a product.</p>
      </section>

      <TodoList onOpen={setOpen} />

      {tiles.length > 0 && (
        <section aria-labelledby="jobs">
          <h2 id="jobs" className="mb-3 text-xl font-bold text-slate-900">Do a job</h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {tiles.map((t) => (
              <button key={t.id} type="button" onClick={() => setOpen({ kind: 'tile', id: t.id })}
                className={cn('flex min-h-[7.5rem] items-center gap-4 rounded-2xl p-5 text-left ring-1 transition focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/40', TONES[t.tone])}>
                <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-white/70">{ICONS[t.icon]}</span>
                <span><span className="block text-xl font-bold leading-tight">{t.title}</span><span className="mt-1 block text-base opacity-90">{t.help}</span></span>
              </button>
            ))}
          </div>
        </section>
      )}

      {can('products.view') && <Finder onOpen={(p) => setOpen({ kind: 'product', product: p })} />}
      {(hasOwnerWorkflow(can) || can('inbound.create')) && <MyRequests owner={owner} />}
      {can('dashboard.view') && <Overview />}

      <button type="button" className="btn-secondary mx-auto !h-12 !px-6 !text-base" onClick={() => setOpen({ kind: 'help' })}><HelpCircle className="h-5 w-5" />How do I use this screen?</button>

      <Dialogs open={open} close={() => setOpen(null)} setOpen={setOpen} />
    </div>
  )
}

// ---------------------------------------------------------------- Overview (this week, order counts)
function Overview() {
  const q = useQuery({ queryKey: ['dashboard', 'week'], queryFn: () => get<any>('/dashboard?period=week'), refetchInterval: 60_000 })
  if (!q.data) return q.error ? <ErrorBox error={q.error} onRetry={() => q.refetch()} /> : null
  const k = q.data.kpis
  const items = [
    { label: 'Received', value: k.inbound, note: 'this week', icon: <Download className="h-6 w-6" />, cls: 'text-emerald-700 bg-emerald-50' },
    { label: 'Sent out', value: k.outbound, note: 'this week', icon: <PackageMinus className="h-6 w-6" />, cls: 'text-indigo-700 bg-indigo-50' },
    { label: 'Moved', value: k.transfers, note: 'this week', icon: <ArrowLeftRight className="h-6 w-6" />, cls: 'text-sky-700 bg-sky-50' },
    { label: 'Waiting', value: k.pending, note: 'needs someone to act', icon: <Clock className="h-6 w-6" />, cls: k.pending ? 'text-amber-700 bg-amber-50' : 'text-emerald-700 bg-emerald-50' },
  ]
  return (
    <section aria-labelledby="week"><h2 id="week" className="mb-3 text-xl font-bold text-slate-900">This week in numbers</h2>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map((i) => (
        <Card key={i.label} className="flex items-center gap-3 p-4">
          <span className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-xl', i.cls)}>{i.icon}</span>
          <div><p className="text-3xl font-bold leading-none text-slate-900">{fmt(i.value)}</p><p className="mt-1 text-base font-semibold text-slate-700">{i.label}</p><p className="text-sm text-slate-500">{i.note}</p></div>
        </Card>
      ))}
    </div></section>
  )
}

// ---------------------------------------------------------------- Product finder
function Finder({ onOpen }: { onOpen: (p: Product) => void }) {
  const [q, setQ] = useState(''), [loc, setLoc] = useState(''), [onlyStock, setOnlyStock] = useState(false), [more, setMore] = useState(false)
  const products = useProducts(); const locs = useLocations()
  const stock = useQuery({ queryKey: ['stock', 'all'], queryFn: () => get<StockRow[]>('/stock') })
  const L = new Map((locs.data ?? []).map((l) => [l.id, l.name]))
  const rows = useMemo(() => {
    const locId = loc ? Number(loc) : undefined
    return (products.data ?? []).filter((p) => p.active && matchProduct(p, q)).map((p) => ({ p, s: summarizeStock(p, stock.data ?? [], locId) })).filter((r) => !onlyStock || r.s.available > 0)
  }, [products.data, stock.data, q, loc, onlyStock])
  const shown = more || q ? rows.slice(0, 40) : rows.slice(0, 6)
  return (
    <section aria-labelledby="find">
      <h2 id="find" className="mb-3 text-xl font-bold text-slate-900">Find a product</h2>
      <Card className="space-y-4 p-4 sm:p-5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-6 w-6 -translate-y-1/2 text-slate-400" />
          <input className="input !h-14 !rounded-xl !pl-12 !pr-12 !text-lg" type="search" inputMode="search" autoComplete="off" aria-label="Search products" placeholder="Search name, colour or code…" value={q} onChange={(e) => setQ(e.target.value)} />
          {q && <button type="button" aria-label="Clear search" className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-slate-400 hover:bg-slate-100" onClick={() => setQ('')}><X className="h-5 w-5" /></button>}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-base">
          <label className="flex items-center gap-2 text-slate-600">Warehouse
            <select className="input !h-11 !w-auto !text-base" aria-label="Warehouse" value={loc} onChange={(e) => setLoc(e.target.value)}><option value="">All warehouses</option>{(locs.data ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-slate-600"><input type="checkbox" className="h-5 w-5" checked={onlyStock} onChange={(e) => setOnlyStock(e.target.checked)} />Only show what is in stock</label>
        </div>

        <ErrorBox error={products.error ?? stock.error} onRetry={() => { products.refetch(); stock.refetch() }} />
        {products.isLoading ? <PageLoader /> : (
          <>
            <p className="text-base text-slate-500" aria-live="polite">{q ? `${rows.length} found for “${q}”` : `Showing ${shown.length} of ${rows.length} products - type above to search`}</p>
            {shown.length === 0 ? <Empty><PackageSearch className="mx-auto mb-2 h-10 w-10 text-slate-300" />Nothing found. Try fewer words, or check the spelling.</Empty> : (
              <ul className="grid gap-3 lg:grid-cols-2">
                {shown.map(({ p, s }) => (
                  <li key={p.id}>
                    <button type="button" onClick={() => onOpen(p)} className="flex w-full items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:border-brand-500 hover:shadow focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/30">
                      <span className="min-w-0">
                        <span className="block truncate text-lg font-bold text-slate-900">{p.name || 'Unnamed product'}</span>
                        <span className="block text-base text-slate-600">{[variationOf(p), p.weight].filter(Boolean).join(' · ') || 'No colour or size'}</span>
                        <span className="mt-1 inline-block rounded bg-slate-100 px-2 py-0.5 font-mono text-sm text-slate-600">Code: {p.sku}</span>
                        {s.byLocation.length > 0 && <span className="mt-2 flex flex-wrap gap-1.5">{s.byLocation.map((b) => <span key={b.locationId} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-sm text-slate-700">{L.get(b.locationId) ?? '…'}: <b>{fmt(b.available)}</b></span>)}</span>}
                      </span>
                      <span className="shrink-0 text-right">
                        <span className={cn('block text-3xl font-bold leading-none', s.available > 0 ? 'text-emerald-700' : 'text-red-600')}>{fmt(s.available)}</span>
                        <span className="block text-sm text-slate-500">available</span>
                        {s.boxes !== null && <span className="block text-sm text-slate-500">≈ {fmt(s.boxes)} boxes</span>}
                        <span className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-brand-700"><Eye className="h-4 w-4" />Open</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {!q && rows.length > 6 && <button type="button" className="btn-secondary !h-12 w-full !text-base" onClick={() => setMore(!more)}>{more ? 'Show fewer' : `Show all ${rows.length} products`}</button>}
          </>
        )}
      </Card>
    </section>
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
  const items: { key: string; icon: ReactNode; title: string; sub: string; button: string; go: () => void }[] = [
    ...(transfers.data ?? []).map((o) => ({ key: `t${o.id}`, icon: <Truck className="h-7 w-7" />, title: `Goods arriving: ${lname(o.fromLocationId)} → ${lname(o.toLocationId)}`, sub: `${units(o)} units on the way. Check them when they arrive.`, button: 'Receive', go: () => onOpen({ kind: 'receive', order: o }) })),
    ...(drafts.data ?? []).map((o) => ({ key: `d${o.id}`, icon: <ArrowLeftRight className="h-7 w-7" />, title: `Ready to send: ${lname(o.fromLocationId)} → ${lname(o.toLocationId)}`, sub: `${units(o)} units saved. Press Send when the goods leave.`, button: 'Send it', go: () => onOpen({ kind: 'receive', order: o }) })),
    ...(outbound.data ?? []).map((o) => ({ key: `o${o.id}`, icon: <PackageMinus className="h-7 w-7" />, title: `Customer order #${o.id} is ready to check`, sub: `${units(o)} units from ${lname(o.locationId)}. Check, then confirm.`, button: 'Check & confirm', go: () => onOpen({ kind: 'outboundReview', order: o }) })),
    ...(reserves.data ?? []).map((o) => ({ key: `r${o.id}`, icon: <Archive className="h-7 w-7" />, title: `Stock kept aside #${o.id}`, sub: `${units(o)} units at ${lname(o.locationId)}. Send it out when the customer collects.`, button: 'Open', go: () => onOpen({ kind: 'reserveProcess', order: o }) })),
    ...(inbound.data ?? []).map((o) => ({ key: `i${o.id}`, icon: <Download className="h-7 w-7" />, title: `Delivery #${o.id} waits for a check`, sub: `${units(o)} units entered by ${o.enteredBy.name}. Check the boxes, then approve.`, button: 'Check', go: () => onOpen({ kind: 'inboundReview', order: o }) })),
    ...(audits.data ?? []).filter((a) => a.status === 'counting').map((a) => ({ key: `a${a.id}`, icon: <ClipboardCheck className="h-7 w-7" />, title: `Counting in progress: ${a.name}`, sub: 'Count the stock and write the numbers. Then send it for approval.', button: 'Continue counting', go: () => onOpen({ kind: 'audit', id: a.id }) })),
  ]
  const all = [transfers, drafts, outbound, reserves, inbound, audits]
  const loading = all.some((x) => x.isLoading)
  const error = all.find((x) => x.error)?.error
  const relevant = can('transfers.create') || can('transfers.receive') || can('outbound.confirm') || can('reserves.convert') || can('inbound.approve') || can('audits.count')
  if (!relevant) return null
  return (
    <section aria-labelledby="todo">
      <h2 id="todo" className="mb-3 text-xl font-bold text-slate-900">Waiting for you {items.length > 0 && <span className="ml-1 rounded-full bg-red-600 px-2.5 py-0.5 text-base text-white">{items.length}</span>}</h2>
      <ErrorBox error={error} />
      {loading ? <PageLoader /> : items.length === 0 ? (
        <Card className="flex items-center gap-3 px-5 py-3 text-lg text-slate-600"><CheckCircle2 className="h-7 w-7 shrink-0 text-emerald-600" />Nothing is waiting for you. Good work!</Card>
      ) : (
        <ul className="space-y-3">{items.map((i) => (
          <li key={i.key}><Card className="flex flex-wrap items-center gap-4 p-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-700">{i.icon}</span>
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
  const mineDeliveries = (deliveries.data ?? []).filter((o) => o.enteredBy.userId === user?.id)
  const items = (q.data?.items ?? []).slice(0, 6)
  if (!q.data && !q.error && hasOwnerWorkflow(can)) return null
  const word: Record<string, { text: string; tone: 'amber' | 'green' | 'red'; icon: ReactNode }> = {
    pending: { text: 'Waiting for the owner', tone: 'amber', icon: <Clock className="h-5 w-5" /> }, approved: { text: 'Approved', tone: 'green', icon: <CheckCircle2 className="h-5 w-5" /> }, rejected: { text: 'Not approved', tone: 'red', icon: <XCircle className="h-5 w-5" /> },
  }
  const kind: Record<string, string> = { product: 'New product', location: 'New warehouse', adjustment: 'Stock fix', audit: 'Stock count' }
  return (
    <section aria-labelledby="mine">
      <h2 id="mine" className="mb-1 text-xl font-bold text-slate-900">{owner ? 'Latest requests' : 'My requests'}</h2>
      <p className="mb-3 text-base text-slate-500">{owner ? 'Requests from the team.' : 'Some things need the owner to say OK first. You can see the answer here.'}</p>
      <ErrorBox error={q.error} onRetry={() => q.refetch()} />
      {mineDeliveries.length > 0 && (
        <ul className="mb-3 space-y-3">{mineDeliveries.map((o) => <li key={`dl${o.id}`}><Card className="flex flex-wrap items-center justify-between gap-3 p-4"><div className="min-w-0"><p className="text-sm font-semibold uppercase tracking-wide text-slate-400">Goods received</p><p className="text-lg font-bold text-slate-900">Delivery #{o.id}{o.reference ? ` · ${o.reference}` : ''}</p><p className="text-base text-slate-600">{fmt(o.lines.reduce((a: number, l: any) => a + l.qty, 0))} units - a manager must check the boxes</p><p className="mt-1 text-sm text-slate-400">{fmtDate(o.enteredBy.at)}</p></div><Badge tone="amber"><span className="mr-1.5 inline-flex"><Clock className="h-5 w-5" /></span><span className="text-base">Waiting for a manager</span></Badge></Card></li>)}</ul>
      )}
      {!hasOwnerWorkflow(can) && mineDeliveries.length === 0 ? <Card className="p-5 text-lg text-slate-500">Nothing sent for checking.</Card> : hasOwnerWorkflow(can) && items.length === 0 && mineDeliveries.length === 0 ? <Card className="p-5 text-lg text-slate-500">You have not sent any requests yet.</Card> : items.length === 0 ? null : (
        <ul className="space-y-3">{items.map((i) => { const w = word[i.status] ?? word.pending; return (
          <li key={`${i.type}${i.id}`}><Card className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0"><p className="text-sm font-semibold uppercase tracking-wide text-slate-400">{kind[i.type]}</p><p className="text-lg font-bold text-slate-900">{i.title}</p><p className="text-base text-slate-600">{i.summary}</p>
              {i.status === 'rejected' && i.decisionComment && <p className="mt-1 rounded-lg bg-red-50 p-2 text-base text-red-700">Owner says: “{i.decisionComment}”</p>}<p className="mt-1 text-sm text-slate-400">{fmtDate(i.submittedBy?.at)}</p></div>
            <Badge tone={w.tone}><span className="mr-1.5 inline-flex">{w.icon}</span><span className="text-base">{w.text}</span></Badge>
          </Card></li>) })}</ul>
      )}
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
  if (open.kind === 'product') return <Modal open onClose={close} title="Product" wide><ProductOverview id={open.product.id} hideBack /></Modal>
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
    case 'reports': return <Modal open onClose={close} title="Stock list & reports" wide><Reports /></Modal>
  }
}

function Help({ onClose }: { onClose: () => void }) {
  const steps: [string, string][] = [
    ['1', 'To find a product, type in the big search box. You can type the name, the colour, the size or the code. Press a product to see where it is.'],
    ['2', 'To do a job, press one of the big coloured buttons. A window opens. Fill it in and press the blue button at the bottom.'],
    ['3', 'Some things need the owner to say OK first (new product, new warehouse, fixing a number, a stock count). Press the button, send it, and the answer will show under “My requests”.'],
    ['4', 'Made a mistake? Do not worry. Nothing changes until you press the final blue button. You can close any window with the X.'],
    ['5', 'Text too small? Press “Bigger text” at the top of the page.'],
  ]
  return (
    <Modal open onClose={onClose} title="How to use this screen" wide>
      <ol className="space-y-4">{steps.map(([n, t]) => <li key={n} className="flex gap-4"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-600 text-lg font-bold text-white">{n}</span><p className="pt-1 text-lg text-slate-700">{t}</p></li>)}</ol>
      <div className="mt-6 flex justify-end"><button className="btn-primary !h-12 !px-8 !text-base" onClick={onClose}>OK, I understand</button></div>
    </Modal>
  )
}
