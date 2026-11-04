import { Router } from 'express'
import { z } from 'zod'
import type { Ctx } from '../context.js'
import { hasPerm, requirePerm } from '../auth.js'
import { notFound } from '../errors.js'
import { isApproved, productLabel, variationOf } from '../catalog.js'
import { wrap } from '../http.js'
import type { Client, Line, Location, Movement, Product, Stock, User } from '../models.js'
import { Inventory } from '../inventory.js'
import { idParam } from '../validation.js'

/** Neutralise spreadsheet formula injection in exports (OWASP CSV injection). */
const cell = (v: unknown) => {
  let s = v == null ? '' : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const toCsv = (rows: Record<string, unknown>[]) =>
  rows.length ? [Object.keys(rows[0]).map(cell).join(','), ...rows.map((r) => Object.values(r).map(cell).join(','))].join('\n') : ''

export function insightRoutes(ctx: Ctx, inv: Inventory) {
  const r = Router()
  const products = () => new Map((ctx.db.products.all() as Product[]).map((p) => [p.id, p]))
  const locations = () => new Map((ctx.db.locations.all() as Location[]).map((l) => [l.id, l]))
  const sendCsv = (res: any, name: string, rows: Record<string, unknown>[]) => {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`)
    res.send(toCsv(rows))
  }

  // ---------------- Dashboard (ORDER data, not unit data) ----------------
  const DAY = 86_400_000
  r.get('/dashboard', requirePerm('dashboard.view'), wrap((req, res) => {
    const { period } = z.object({ period: z.enum(['week', 'month', 'year']).default('month') }).parse(req.query)
    const P = products(), L = locations()
    const now = Date.now(), span = { week: 7, month: 30, year: 365 }[period]
    const since = now - span * DAY
    const inWin = (iso?: string, from = since) => !!iso && Date.parse(iso) >= from
    const rows = {
      inbound: (ctx.db.inbound_orders.all() as any[]).filter((o) => o.status !== 'rejected'),
      outbound: (ctx.db.outbound_orders.all() as any[]).filter((o) => o.status !== 'cancelled'),
      reserve: (ctx.db.reserve_orders.all() as any[]).filter((o) => o.status !== 'cancelled'),
      transfer: (ctx.db.transfer_orders.all() as any[]).filter((o) => o.status !== 'cancelled'),
    }
    const created = (o: any) => (o.enteredBy ?? o.createdBy).at as string
    const win = (k: keyof typeof rows) => rows[k].filter((o) => inWin(created(o)))
    const completedIn = [
      ...(ctx.db.inbound_orders.all() as any[]).filter((o) => o.status === 'approved').map((o) => o.decidedBy?.at),
      ...(ctx.db.transfer_orders.all() as any[]).filter((o) => o.status === 'received').map((o) => o.receivedBy?.at),
      ...(ctx.db.outbound_orders.all() as any[]).filter((o) => o.status === 'confirmed').map((o) => o.confirmedBy?.at),
      ...(ctx.db.reserve_orders.all() as any[]).filter((o) => o.status === 'converted').map((o) => o.closedBy?.at),
    ].filter((at) => inWin(at)).length
    const pendingApprovals = [ctx.db.products, ctx.db.locations, ctx.db.adjustments].reduce((n, st) => n + (st.all() as any[]).filter((o) => o.status === 'pending').length, 0) + (ctx.db.audits.all() as any[]).filter((a) => a.status === 'submitted').length
    const pending = {
      inboundApproval: rows.inbound.filter((o) => o.status === 'pending').length,
      outboundToConfirm: rows.outbound.filter((o) => o.status === 'saved').length,
      transfersToSend: rows.transfer.filter((o) => o.status === 'draft').length,
      transfersToReceive: rows.transfer.filter((o) => o.status === 'in_transit').length,
      ownerApprovals: pendingApprovals,
    }

    // trend: daily buckets (week/month) or monthly buckets (year)
    const buckets: { label: string; inbound: number; outbound: number; transfers: number; reserved: number }[] = []
    const key = (iso: string) => (period === 'year' ? iso.slice(0, 7) : iso.slice(0, 10))
    if (period === 'year') { const d = new Date(now); d.setUTCDate(1); for (let i = 11; i >= 0; i--) { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)); buckets.push({ label: x.toISOString().slice(0, 7), inbound: 0, outbound: 0, transfers: 0, reserved: 0 }) } }
    else for (let i = span - 1; i >= 0; i--) buckets.push({ label: new Date(now - i * DAY).toISOString().slice(0, 10), inbound: 0, outbound: 0, transfers: 0, reserved: 0 })
    const bump = (k: 'inbound' | 'outbound' | 'transfers' | 'reserved', list: any[]) => { for (const o of list) { const b = buckets.find((x) => x.label === key(created(o))); if (b) b[k]++ } }
    bump('inbound', rows.inbound); bump('outbound', rows.outbound); bump('transfers', rows.transfer); bump('reserved', rows.reserve)

    // orders by location (counts)
    const byLocation = [...L.values()].filter((l) => l.active).map((l) => ({
      name: l.name,
      inbound: win('inbound').filter((o) => o.locationId === l.id).length,
      outbound: win('outbound').filter((o) => o.locationId === l.id).length,
      reserved: win('reserve').filter((o) => o.locationId === l.id).length,
      transfers: win('transfer').filter((o) => o.fromLocationId === l.id || o.toLocationId === l.id).length,
    }))

    // top products BY ORDERS (number of orders containing the product), split by order type
    const tally = new Map<number, { inbound: number; outbound: number; reserved: number; transfers: number }>()
    const add = (list: any[], k: 'inbound' | 'outbound' | 'reserved' | 'transfers') => { for (const o of list) for (const l of o.lines as Line[]) { const t = tally.get(l.productId) ?? { inbound: 0, outbound: 0, reserved: 0, transfers: 0 }; t[k]++; tally.set(l.productId, t) } }
    add(win('inbound'), 'inbound'); add(win('outbound'), 'outbound'); add(win('reserve'), 'reserved'); add(win('transfer'), 'transfers')
    const label = (id: number) => { const p = P.get(id); return p ? productLabel(p) : `#${id}` }
    const topProducts = [...tally.entries()].map(([id, t]) => ({ name: label(id), ...t, total: t.inbound + t.outbound + t.reserved + t.transfers })).sort((a, b) => b.total - a.total).slice(0, 8)

    // insight: active products with NO sales (outbound orders) in the last 30 days, regardless of the selected period
    const since30 = now - 30 * DAY
    const sold = new Set<number>(); const lastSale = new Map<number, string>()
    for (const o of rows.outbound) for (const l of o.lines as Line[]) { if (inWin(created(o), since30)) sold.add(l.productId); const prev = lastSale.get(l.productId); if (!prev || created(o) > prev) lastSale.set(l.productId, created(o)) }
    const totals = inv.totals()
    const noSales = [...P.values()].filter((p) => p.active && isApproved(p) && !sold.has(p.id)).map((p) => ({ name: productLabel(p), unitsOnHand: totals.get(p.id)?.onHand ?? 0, lastSale: lastSale.get(p.id) ?? null }))

    res.json({
      period, since: new Date(since).toISOString(),
      kpis: {
        inbound: win('inbound').length, outbound: win('outbound').length, reserved: win('reserve').length, transfers: win('transfer').length,
        pending: pending.inboundApproval + pending.outboundToConfirm + pending.transfersToSend + pending.ownerApprovals,
        completed: completedIn, activeReserves: rows.reserve.filter((o) => o.status === 'active').length, transfersInTransit: pending.transfersToReceive,
      },
      pending, trend: buckets, byLocation, topProducts, noSales: { days: 30, total: noSales.length, items: noSales.slice(0, 10) },
    })
  }))

  // ---------------- Product-level page ----------------
  r.get('/products/:id/overview', requirePerm('products.view'), wrap((req, res) => {
    const id = idParam(req); const p = ctx.db.products.get(id) as Product | undefined
    if (!p || !isApproved(p)) throw notFound('Product')
    const q = z.object({ locationId: z.coerce.number().int().positive().optional() }).parse(req.query)
    const L = locations(), U = new Map((ctx.db.users.all() as User[]).map((u) => [u.id, u.name]))
    const A = new Map((ctx.db.audits.all() as any[]).map((a) => [a.id, a.name as string]))
    const stock = (ctx.db.stock.all() as Stock[]).filter((s) => s.productId === id)
    const moves = (ctx.db.movements.all() as Movement[]).filter((m) => m.productId === id && (!q.locationId || m.locationId === q.locationId)).reverse().slice(0, 200)
    const refLabel = (m: Movement) => (m.refType === 'audit' ? A.get(m.refId ?? -1) ?? `Audit #${m.refId}` : m.refType === 'adjustment' ? m.note ?? 'Adjustment' : m.refType ? `${m.refType} #${m.refId}` : m.note ?? '')
    const rowsByLoc = stock.map((s) => ({ locationId: s.locationId, location: L.get(s.locationId)?.name, onHand: s.onHand, reserved: s.reserved, available: s.onHand - s.reserved, boxes: p.caseSize ? Math.ceil((s.onHand - s.reserved) / p.caseSize) : null }))
    const totalAvail = rowsByLoc.reduce((a, r2) => a + r2.available, 0)
    res.json({
      product: p,
      // the full pipeline lives in this table (the summary cards were removed on request)
      byLocation: rowsByLoc,
      totals: { onHand: rowsByLoc.reduce((a, r2) => a + r2.onHand, 0), reserved: rowsByLoc.reduce((a, r2) => a + r2.reserved, 0), available: totalAvail, boxes: p.caseSize ? Math.ceil(totalAvail / p.caseSize) : null },
      movements: moves.map((m) => ({ ...m, location: L.get(m.locationId)?.name, user: U.get(m.userId), refLabel: refLabel(m) })),
    })
  }))

  // ---------------- Reports ----------------
  r.get('/reports/inventory', requirePerm('reports.inventory'), wrap((req, res) => {
    const q = z.object({ locationId: z.coerce.number().int().optional(), format: z.enum(['json', 'csv']).default('json') }).parse(req.query)
    const P = products(), L = locations()
    const rows = (ctx.db.stock.all() as Stock[]).filter((s) => !q.locationId || s.locationId === q.locationId).map((s) => {
      const p = P.get(s.productId)
      return { SKU: p?.sku, Product: p?.name ?? p?.sku, Variation: p ? variationOf(p) : '', Weight: p?.weight ?? '', Location: L.get(s.locationId)?.name, 'Case pack': p?.caseSize ?? '', UOM: p?.uom, 'On hand': s.onHand, Reserved: s.reserved, Available: s.onHand - s.reserved, Boxes: p?.caseSize ? Math.ceil(s.onHand / p.caseSize) : '' }
    })
    if (q.format === 'csv') return sendCsv(res, 'inventory-report.csv', rows)
    res.json(rows)
  }))

  r.get('/reports/orders', requirePerm('reports.orders'), wrap((req, res) => {
    const q = z.object({ type: z.enum(['inbound', 'transfer', 'reserve', 'outbound']).optional(), status: z.string().max(30).optional(), locationId: z.coerce.number().int().optional(), clientId: z.coerce.number().int().optional(), from: z.string().max(10).optional(), to: z.string().max(10).optional(), format: z.enum(['json', 'csv']).default('json') }).parse(req.query)
    const L = locations(), C = new Map((ctx.db.clients.all() as Client[]).map((c) => [c.id, c]))
    const reveal = hasPerm(req.user!, 'clients.reveal')
    const sets: [string, any[], (o: any) => string, (o: any) => string][] = [
      ['inbound', ctx.db.inbound_orders.all(), (o) => o.enteredBy.at, (o) => L.get(o.locationId)?.name ?? ''],
      ['transfer', ctx.db.transfer_orders.all(), (o) => o.createdBy.at, (o) => `${L.get(o.fromLocationId)?.name} -> ${L.get(o.toLocationId)?.name}`],
      ['reserve', ctx.db.reserve_orders.all(), (o) => o.createdBy.at, (o) => L.get(o.locationId)?.name ?? ''],
      ['outbound', ctx.db.outbound_orders.all(), (o) => o.createdBy.at, (o) => L.get(o.locationId)?.name ?? ''],
    ]
    const rows = sets.filter(([t]) => !q.type || q.type === t).flatMap(([t, all, at, loc]) =>
      all.filter((o: any) => (!q.status || o.status === q.status) && (!q.clientId || o.clientId === q.clientId) &&
        (!q.locationId || [o.locationId, o.fromLocationId, o.toLocationId].includes(q.locationId)) && (!q.from || at(o).slice(0, 10) >= q.from) && (!q.to || at(o).slice(0, 10) <= q.to))
        .map((o: any) => ({ Type: t, Number: o.id, Date: at(o), Status: o.status, Location: loc(o), Client: o.clientId ? (reveal ? C.get(o.clientId)?.name : C.get(o.clientId)?.alias) : '', Lines: o.lines.length, Units: o.lines.reduce((a: number, l: Line) => a + l.qty, 0), 'Created by': (o.createdBy ?? o.enteredBy).name })))
      .sort((a, b) => b.Date.localeCompare(a.Date))
    if (q.format === 'csv') return sendCsv(res, 'orders-report.csv', rows)
    res.json(rows)
  }))
  return r
}
