import { Router } from 'express'
import { z } from 'zod'
import type { Ctx } from '../context.js'
import { hasPerm, requirePerm } from '../auth.js'
import { notFound } from '../errors.js'
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

  // ---------------- Dashboard ----------------
  r.get('/dashboard', requirePerm('dashboard.view'), wrap((_req, res) => {
    const P = products(), L = locations()
    const stock = ctx.db.stock.all() as Stock[]
    const totals = inv.totals(), transit = inv.inTransit()
    const sum = (f: (s: Stock) => number) => stock.reduce((a, s) => a + f(s), 0)
    const onHand = sum((s) => s.onHand), reserved = sum((s) => s.reserved)
    const inTransit = [...transit.values()].reduce((a, b) => a + b, 0)
    const activeProducts = [...P.values()].filter((p) => p.active)
    const lowStock = activeProducts.filter((p) => p.reorderLevel > 0 && (totals.get(p.id)?.onHand ?? 0) - (totals.get(p.id)?.reserved ?? 0) <= p.reorderLevel)
    const byLocation = [...L.values()].filter((l) => l.active).map((l) => ({ name: l.name, onHand: stock.filter((s) => s.locationId === l.id).reduce((a, s) => a + s.onHand, 0), reserved: stock.filter((s) => s.locationId === l.id).reduce((a, s) => a + s.reserved, 0) }))
    const top = [...totals.entries()].map(([id, t]) => ({ name: P.get(id)?.sku ?? `#${id}`, onHand: t.onHand })).sort((a, b) => b.onHand - a.onHand).slice(0, 8)

    const days = 30, since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
    const trend = new Map<string, { date: string; inbound: number; outbound: number }>()
    for (let i = days; i >= 0; i--) { const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10); trend.set(d, { date: d, inbound: 0, outbound: 0 }) }
    for (const m of ctx.db.movements.all() as Movement[]) {
      const t = trend.get(m.at.slice(0, 10)); if (!t || m.at.slice(0, 10) < since) continue
      if (m.type === 'inbound') t.inbound += m.onHandDelta
      if (m.type === 'outbound') t.outbound += -m.onHandDelta
    }
    const count = (rows: any[], s: string) => rows.filter((o) => o.status === s).length
    const rows = { inbound: ctx.db.inbound_orders.all() as any[], transfer: ctx.db.transfer_orders.all() as any[], reserve: ctx.db.reserve_orders.all() as any[], outbound: ctx.db.outbound_orders.all() as any[] }
    const monthStart = new Date().toISOString().slice(0, 7)
    res.json({
      kpis: {
        totalOnHand: onHand, reserved, available: onHand - reserved, inTransit,
        activeSkus: activeProducts.length, locations: [...L.values()].filter((l) => l.active).length, lowStockCount: lowStock.length,
        pendingInbound: count(rows.inbound, 'pending'), transfersInTransit: count(rows.transfer, 'in_transit'), activeReserves: count(rows.reserve, 'active'),
        pendingOutbound: count(rows.outbound, 'saved'),
        outboundThisMonth: rows.outbound.filter((o) => o.status === 'confirmed' && o.confirmedBy?.at?.startsWith(monthStart)).length,
      },
      byLocation, topProducts: top, trend: [...trend.values()],
      lowStock: lowStock.slice(0, 8).map((p) => ({ sku: p.sku, name: p.name, available: (totals.get(p.id)?.onHand ?? 0) - (totals.get(p.id)?.reserved ?? 0), reorderLevel: p.reorderLevel })),
    })
  }))

  // ---------------- Product-level page ----------------
  r.get('/products/:id/overview', requirePerm('products.view'), wrap((req, res) => {
    const id = idParam(req); const p = ctx.db.products.get(id) as Product | undefined
    if (!p) throw notFound('Product')
    const L = locations(), U = new Map((ctx.db.users.all() as User[]).map((u) => [u.id, u.name]))
    const stock = (ctx.db.stock.all() as Stock[]).filter((s) => s.productId === id)
    const t = inv.totals().get(id) ?? { onHand: 0, reserved: 0 }
    const qtyOf = (rows: any[], pred: (o: any) => boolean) => rows.filter(pred).reduce((a, o) => a + ((o.lines as Line[]).find((l) => l.productId === id)?.qty ?? 0), 0)
    const moves = (ctx.db.movements.all() as Movement[]).filter((m) => m.productId === id).reverse().slice(0, 200)
    res.json({
      product: p,
      totals: {
        onHand: t.onHand, reserved: t.reserved, available: t.onHand - t.reserved, inTransit: inv.inTransit().get(id) ?? 0,
        inboundPending: qtyOf(ctx.db.inbound_orders.all() as any[], (o) => o.status === 'pending'),
        outboundTotal: qtyOf(ctx.db.outbound_orders.all() as any[], (o) => o.status === 'confirmed'),
        outboundPending: qtyOf(ctx.db.outbound_orders.all() as any[], (o) => o.status === 'saved'),
        boxes: p.caseSize ? Math.ceil(t.onHand / p.caseSize) : 0,
      },
      byLocation: stock.map((s) => ({ locationId: s.locationId, location: L.get(s.locationId)?.name, onHand: s.onHand, reserved: s.reserved, available: s.onHand - s.reserved })),
      movements: moves.map((m) => ({ ...m, location: L.get(m.locationId)?.name, user: U.get(m.userId) })),
    })
  }))

  // ---------------- Reports ----------------
  r.get('/reports/inventory', requirePerm('reports.inventory'), wrap((req, res) => {
    const q = z.object({ locationId: z.coerce.number().int().optional(), format: z.enum(['json', 'csv']).default('json') }).parse(req.query)
    const P = products(), L = locations()
    const rows = (ctx.db.stock.all() as Stock[]).filter((s) => !q.locationId || s.locationId === q.locationId).map((s) => {
      const p = P.get(s.productId)
      return { SKU: p?.sku, Product: p?.name, Variation: [p?.color, p?.weight].filter(Boolean).join(' / '), Location: L.get(s.locationId)?.name, 'Case pack': p?.caseSize, UOM: p?.uom, 'On hand': s.onHand, Reserved: s.reserved, Available: s.onHand - s.reserved, Boxes: p?.caseSize ? Math.ceil(s.onHand / p.caseSize) : 0 }
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
