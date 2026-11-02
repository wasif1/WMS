import { Router, type Request } from 'express'
import { z } from 'zod'
import type { Ctx } from '../context.js'
import { requirePerm } from '../auth.js'
import { bad, conflict, forbidden, notFound } from '../errors.js'
import { ip, nowIso, wrap } from '../http.js'
import type { Actor, Client, Comment, Line, Location, Product, User } from '../models.js'
import { Inventory } from '../inventory.js'
import { emails, idParam, lineInput, lines as linesSchema, optStr, parse } from '../validation.js'
import { presentClient } from './masters.js'

const dateQ = z.object({ status: z.string().max(30).optional(), locationId: z.coerce.number().int().optional(), clientId: z.coerce.number().int().optional(), from: z.string().max(30).optional(), to: z.string().max(30).optional() })

export function orderRoutes(ctx: Ctx, inv: Inventory) {
  const r = Router()
  const actor = (u: User): Actor => ({ userId: u.id, name: u.name, at: nowIso() })
  const comment = (u: User, text: string): Comment[] => (text ? [{ by: u.name, at: nowIso(), text }] : [])
  const locName = (id?: number) => (ctx.db.locations.get(id ?? -1) as Location | undefined)?.name ?? `#${id}`
  const sku = (id: number) => (ctx.db.products.get(id) as Product | undefined)?.sku ?? `#${id}`
  const checkLoc = (id: number) => { const l = ctx.db.locations.get(id) as Location | undefined; if (!l) throw notFound('Location'); if (!l.active) throw bad(`Location ${l.name} is inactive`); return l }
  const checkClient = (id: number) => { if (!ctx.db.clients.get(id)) throw notFound('Client') }
  const inRange = (at: string, q: z.infer<typeof dateQ>) => (!q.from || at >= q.from) && (!q.to || at <= q.to + 'T23:59:59.999Z')
  const lineStr = (ls: Line[]) => ls.map((l) => `  - ${sku(l.productId)}: ${l.qty}`).join('\n')
  const mail = (to: string[], subject: string, body: string) => ctx.mailer.send(to, subject, body)
  const withClient = (req: Request, o: any) => ({ ...o, client: o.clientId ? presentClient(req.user!, ctx.db.clients.get(o.clientId) as Client) : null })
  const emailOf = (id: number) => (ctx.db.users.get(id) as User | undefined)?.email ?? ''

  // ============================ STOCK ============================
  r.get('/stock', requirePerm('dashboard.view', 'products.view', 'inbound.view', 'transfers.create', 'reserves.create', 'outbound.create', 'adjustments.view', 'adjustments.create', 'audits.view', 'reports.inventory'),
    wrap((req, res) => {
      const q = z.object({ locationId: z.coerce.number().int().optional(), productId: z.coerce.number().int().optional() }).parse(req.query)
      res.json((ctx.db.stock.all() as any[])
        .filter((s) => (!q.locationId || s.locationId === q.locationId) && (!q.productId || s.productId === q.productId))
        .map((s) => ({ productId: s.productId, locationId: s.locationId, onHand: s.onHand, reserved: s.reserved, available: s.onHand - s.reserved })))
    }))

  // ============================ INBOUND ============================
  const inboundSchema = z.object({ locationId: z.number().int().positive(), reference: optStr(100), comments: optStr(1000), notifyEmails: emails.default([]), lines: linesSchema }).strict()
  r.get('/inbound', requirePerm('inbound.view'), wrap((req, res) => {
    const q = dateQ.parse(req.query)
    res.json((ctx.db.inbound_orders.all() as any[]).filter((o) => (!q.status || o.status === q.status) && (!q.locationId || o.locationId === q.locationId) && inRange(o.enteredBy.at, q)).reverse())
  }))
  r.post('/inbound', requirePerm('inbound.create'), wrap((req, res) => {
    const b = parse(inboundSchema, req.body)
    checkLoc(b.locationId)
    const o = ctx.db.inbound_orders.insert({
      locationId: b.locationId, reference: b.reference, notifyEmails: b.notifyEmails, lines: inv.buildLines(b.lines), status: 'pending',
      comments: comment(req.user!, b.comments), enteredBy: actor(req.user!),
    })
    ctx.audit.log(req.user!, 'inbound.create', { entity: 'inbound', entityId: o.id, detail: locName(b.locationId), ip: ip(req) })
    res.status(201).json(o)
  }))
  r.post('/inbound/:id/approve', requirePerm('inbound.approve'), wrap((req, res) => {
    const id = idParam(req); const o = ctx.db.inbound_orders.get(id) as any
    if (!o) throw notFound('Inbound order')
    if (o.status !== 'pending') throw conflict(`Order is already ${o.status}`)
    const u = req.user!
    if (o.enteredBy.userId === u.id && u.role !== 'super_admin') throw forbidden('Segregation of duties: someone else must approve a packing list you entered')
    const b = parse(z.object({ verified: z.array(lineInput).optional(), comment: optStr(1000) }).strict(), req.body)
    const verified: Line[] = b.verified ? inv.buildLines(b.verified, true) : o.lines
    const differs = o.lines.some((l: Line) => (verified.find((v) => v.productId === l.productId)?.qty ?? 0) !== l.qty)
    if (differs && !b.comment) throw bad('Verified quantities differ from the packing list - a comment is required')
    ctx.db.tx(() => {
      for (const l of verified) if (l.qty > 0) inv.apply(l.productId, o.locationId, { onHand: l.qty }, { type: 'inbound', userId: u.id, refType: 'inbound', refId: id })
      ctx.db.inbound_orders.update(id, { ...o, status: 'approved', verified, decidedBy: actor(u), comments: [...o.comments, ...comment(u, b.comment)] })
    })
    ctx.audit.log(u, 'inbound.approve', { entity: 'inbound', entityId: id, ip: ip(req) })
    mail([...o.notifyEmails, emailOf(o.enteredBy.userId), u.email], `Inbound #${id} approved - ${locName(o.locationId)}`,
      `Inbound order #${id} at ${locName(o.locationId)}\nEntered by: ${o.enteredBy.name} (${o.enteredBy.at})\nApproved by: ${u.name} (${nowIso()})\nReference: ${o.reference || '-'}\n\nVerified quantities:\n${lineStr(verified)}\n${b.comment ? `\nComment: ${b.comment}\n` : ''}${differs ? '\nNOTE: verified quantities differ from the packing list.\n' : ''}`)
    res.json(ctx.db.inbound_orders.get(id))
  }))
  r.post('/inbound/:id/reject', requirePerm('inbound.approve'), wrap((req, res) => {
    const id = idParam(req); const o = ctx.db.inbound_orders.get(id) as any
    if (!o) throw notFound('Inbound order')
    if (o.status !== 'pending') throw conflict(`Order is already ${o.status}`)
    const b = parse(z.object({ comment: z.string().trim().min(1).max(1000) }).strict(), req.body)
    ctx.db.inbound_orders.update(id, { ...o, status: 'rejected', decidedBy: actor(req.user!), comments: [...o.comments, ...comment(req.user!, b.comment)] })
    ctx.audit.log(req.user!, 'inbound.reject', { entity: 'inbound', entityId: id, ip: ip(req) })
    res.json(ctx.db.inbound_orders.get(id))
  }))

  // ============================ TRANSFERS ============================
  const transferSchema = z.object({ fromLocationId: z.number().int().positive(), toLocationId: z.number().int().positive(), note: optStr(1000), lines: linesSchema }).strict()
  r.get('/transfers', requirePerm('transfers.view'), wrap((req, res) => {
    const q = dateQ.parse(req.query)
    res.json((ctx.db.transfer_orders.all() as any[]).filter((o) => (!q.status || o.status === q.status) && (!q.locationId || o.fromLocationId === q.locationId || o.toLocationId === q.locationId) && inRange(o.createdBy.at, q)).reverse())
  }))
  r.post('/transfers', requirePerm('transfers.create'), wrap((req, res) => {
    const b = parse(transferSchema, req.body)
    if (b.fromLocationId === b.toLocationId) throw bad('Source and destination must differ')
    checkLoc(b.fromLocationId); checkLoc(b.toLocationId)
    const o = ctx.db.transfer_orders.insert({ ...b, lines: inv.buildLines(b.lines), status: 'draft', createdBy: actor(req.user!) })
    ctx.audit.log(req.user!, 'transfer.create', { entity: 'transfer', entityId: o.id, ip: ip(req) })
    res.status(201).json(o)
  }))
  r.post('/transfers/:id/submit', requirePerm('transfers.create'), wrap((req, res) => {
    const id = idParam(req); const o = ctx.db.transfer_orders.get(id) as any
    if (!o) throw notFound('Transfer order')
    if (o.status !== 'draft') throw conflict(`Order is already ${o.status}`)
    ctx.db.tx(() => {
      for (const l of o.lines as Line[]) inv.apply(l.productId, o.fromLocationId, { onHand: -l.qty }, { type: 'transfer_out', userId: req.user!.id, refType: 'transfer', refId: id })
      ctx.db.transfer_orders.update(id, { ...o, status: 'in_transit', submittedBy: actor(req.user!) })
    })
    ctx.audit.log(req.user!, 'transfer.submit', { entity: 'transfer', entityId: id, ip: ip(req) })
    res.json(ctx.db.transfer_orders.get(id))
  }))
  r.post('/transfers/:id/cancel', requirePerm('transfers.create'), wrap((req, res) => {
    const id = idParam(req); const o = ctx.db.transfer_orders.get(id) as any
    if (!o) throw notFound('Transfer order')
    if (o.status !== 'draft') throw conflict('Only drafts can be cancelled')
    ctx.db.transfer_orders.update(id, { ...o, status: 'cancelled' })
    ctx.audit.log(req.user!, 'transfer.cancel', { entity: 'transfer', entityId: id })
    res.json(ctx.db.transfer_orders.get(id))
  }))
  r.post('/transfers/:id/receive', requirePerm('transfers.receive'), wrap((req, res) => {
    const id = idParam(req); const o = ctx.db.transfer_orders.get(id) as any
    if (!o) throw notFound('Transfer order')
    if (o.status !== 'in_transit') throw conflict(`Order is ${o.status}, not in transit`)
    const b = parse(z.object({ received: z.array(lineInput).optional(), comment: optStr(1000) }).strict(), req.body)
    const received: Line[] = b.received ? inv.buildLines(b.received, true) : o.lines
    for (const rl of received) if (!o.lines.some((l: Line) => l.productId === rl.productId)) throw bad('Received line is not on the transfer')
    const discrepancy = o.lines.map((l: Line) => ({ productId: l.productId, sent: l.qty, received: received.find((x) => x.productId === l.productId)?.qty ?? 0 })).filter((d: any) => d.sent !== d.received)
    if (discrepancy.length && !b.comment) throw bad('Received quantities differ from what was sent - a comment is required')
    ctx.db.tx(() => {
      for (const l of received) if (l.qty > 0) inv.apply(l.productId, o.toLocationId, { onHand: l.qty }, { type: 'transfer_in', userId: req.user!.id, refType: 'transfer', refId: id })
      ctx.db.transfer_orders.update(id, { ...o, status: 'received', receivedLines: received, discrepancy, receivedBy: { ...actor(req.user!), locationId: o.toLocationId, location: locName(o.toLocationId) }, receiveComment: b.comment })
    })
    ctx.audit.log(req.user!, 'transfer.receive', { entity: 'transfer', entityId: id, ip: ip(req) })
    res.json(ctx.db.transfer_orders.get(id))
  }))

  // ============================ RESERVES ============================
  const reserveSchema = z.object({ locationId: z.number().int().positive(), clientId: z.number().int().positive().optional(), note: optStr(1000), lines: linesSchema }).strict()
  const listWithClient = (store: any, dateField: string) => wrap((req, res) => {
    const q = dateQ.parse(req.query)
    res.json((store.all() as any[]).filter((o) => (!q.status || o.status === q.status) && (!q.locationId || o.locationId === q.locationId) && (!q.clientId || o.clientId === q.clientId) && inRange(o[dateField].at, q)).reverse().map((o) => withClient(req, o)))
  })
  r.get('/reserves', requirePerm('reserves.view'), listWithClient(ctx.db.reserve_orders, 'createdBy'))
  r.post('/reserves', requirePerm('reserves.create'), wrap((req, res) => {
    const b = parse(reserveSchema, req.body)
    checkLoc(b.locationId); if (b.clientId) checkClient(b.clientId)
    const lines = inv.buildLines(b.lines)
    const o = ctx.db.tx(() => {
      const created = ctx.db.reserve_orders.insert({ ...b, lines, status: 'active', createdBy: actor(req.user!) })
      for (const l of lines) inv.apply(l.productId, b.locationId, { reserved: l.qty }, { type: 'reserve', userId: req.user!.id, refType: 'reserve', refId: created.id })
      return created
    })
    ctx.audit.log(req.user!, 'reserve.create', { entity: 'reserve', entityId: o.id, ip: ip(req) })
    mail([req.user!.email], `Reserve order #${o.id} placed`, `Reserve order #${o.id} at ${locName(b.locationId)}\nReserved by: ${req.user!.name} (${o.createdBy.at})\n\nItems:\n${lineStr(lines)}\n${b.note ? `\nNote: ${b.note}\n` : ''}`)
    res.status(201).json(withClient(req, o))
  }))
  const release = (o: any, userId: number, type: 'unreserve', refType: string, refId: number) => {
    for (const l of o.lines as Line[]) inv.apply(l.productId, o.locationId, { reserved: -l.qty }, { type, userId, refType, refId })
  }
  r.post('/reserves/:id/cancel', requirePerm('reserves.convert'), wrap((req, res) => {
    const id = idParam(req); const o = ctx.db.reserve_orders.get(id) as any
    if (!o) throw notFound('Reserve order')
    if (o.status !== 'active') throw conflict(`Order is already ${o.status}`)
    ctx.db.tx(() => { release(o, req.user!.id, 'unreserve', 'reserve', id); ctx.db.reserve_orders.update(id, { ...o, status: 'cancelled', closedBy: actor(req.user!) }) })
    ctx.audit.log(req.user!, 'reserve.cancel', { entity: 'reserve', entityId: id, ip: ip(req) })
    res.json(withClient(req, ctx.db.reserve_orders.get(id)))
  }))
  r.post('/reserves/:id/convert', requirePerm('reserves.convert', 'outbound.create'), wrap((req, res) => {
    const id = idParam(req); const o = ctx.db.reserve_orders.get(id) as any
    if (!o) throw notFound('Reserve order')
    if (o.status !== 'active') throw conflict(`Order is already ${o.status}`)
    if (!o.clientId) throw bad('Attach a client to the reserve order before converting it to outbound')
    const b = parse(z.object({ actual: z.array(lineInput).min(1), comment: optStr(1000) }).strict(), req.body)
    const actual = inv.buildLines(b.actual, true)
    for (const a of actual) if (!o.lines.some((l: Line) => l.productId === a.productId)) throw bad('Line is not on the reserve order')
    const lines = (o.lines as Line[]).map((l) => { const a = actual.find((x) => x.productId === l.productId); const aq = a?.qty ?? 0; return { ...l, actualQty: aq, difference: l.qty - aq } })
    const shipping = actual.filter((a) => a.qty > 0)
    if (!shipping.length) throw bad('Nothing to ship - cancel the reserve order instead')
    const diff = lines.some((l) => l.difference !== 0)
    if (diff && !b.comment) throw bad('Actual quantities differ from reserved - a comment is required')
    const out = ctx.db.tx(() => {
      release(o, req.user!.id, 'unreserve', 'reserve', id)
      const ob = ctx.db.outbound_orders.insert({ locationId: o.locationId, clientId: o.clientId, note: b.comment, lines: shipping, status: 'saved', sourceReserveId: id, createdBy: actor(req.user!) })
      for (const l of shipping) inv.apply(l.productId, o.locationId, { reserved: l.qty }, { type: 'reserve', userId: req.user!.id, refType: 'outbound', refId: ob.id })
      ctx.db.reserve_orders.update(id, { ...o, lines, status: 'converted', outboundId: ob.id, closedBy: actor(req.user!), comments: comment(req.user!, b.comment) })
      return ob
    })
    ctx.audit.log(req.user!, 'reserve.convert', { entity: 'reserve', entityId: id, detail: `outbound #${out.id}`, ip: ip(req) })
    mail([emailOf(o.createdBy.userId), req.user!.email], `Reserve order #${id} moved to outbound #${out.id}`,
      `Reserve order #${id} was converted to outbound order #${out.id} by ${req.user!.name} (${nowIso()}).\n\n${lines.map((l) => `  - ${sku(l.productId)}: reserved ${l.qty}, shipping ${l.actualQty}${l.difference ? `, DIFFERENCE ${l.difference}` : ''}`).join('\n')}\n${b.comment ? `\nComment: ${b.comment}\n` : ''}`)
    res.json({ reserve: withClient(req, ctx.db.reserve_orders.get(id)), outbound: withClient(req, out) })
  }))

  // ============================ OUTBOUND ============================
  const outboundSchema = z.object({ locationId: z.number().int().positive(), clientId: z.number().int().positive(), note: optStr(1000), lines: linesSchema }).strict()
  const allocate = (ls: Line[], locationId: number, userId: number, refId: number) => { for (const l of ls) inv.apply(l.productId, locationId, { reserved: l.qty }, { type: 'reserve', userId, refType: 'outbound', refId }) }
  r.get('/outbound', requirePerm('outbound.view'), listWithClient(ctx.db.outbound_orders, 'createdBy'))
  r.get('/outbound/:id', requirePerm('outbound.view'), wrap((req, res) => {
    const o = ctx.db.outbound_orders.get(idParam(req)); if (!o) throw notFound('Outbound order'); res.json(withClient(req, o))
  }))
  r.post('/outbound', requirePerm('outbound.create'), wrap((req, res) => {
    const b = parse(outboundSchema, req.body)
    checkLoc(b.locationId); checkClient(b.clientId)
    const lines = inv.buildLines(b.lines)
    const o = ctx.db.tx(() => { const c = ctx.db.outbound_orders.insert({ ...b, lines, status: 'saved', createdBy: actor(req.user!) }); allocate(lines, b.locationId, req.user!.id, c.id); return c })
    ctx.audit.log(req.user!, 'outbound.save', { entity: 'outbound', entityId: o.id, ip: ip(req) })
    res.status(201).json(withClient(req, o))
  }))
  r.put('/outbound/:id', requirePerm('outbound.create'), wrap((req, res) => {
    const id = idParam(req); const o = ctx.db.outbound_orders.get(id) as any
    if (!o) throw notFound('Outbound order')
    if (o.status !== 'saved') throw conflict('Only saved orders can be edited')
    const b = parse(outboundSchema.omit({ locationId: true }), req.body)
    checkClient(b.clientId)
    const lines = inv.buildLines(b.lines)
    ctx.db.tx(() => {
      release(o, req.user!.id, 'unreserve', 'outbound', id)
      allocate(lines, o.locationId, req.user!.id, id)
      ctx.db.outbound_orders.update(id, { ...o, ...b, lines, editedBy: actor(req.user!) })
    })
    ctx.audit.log(req.user!, 'outbound.edit', { entity: 'outbound', entityId: id, ip: ip(req) })
    res.json(withClient(req, ctx.db.outbound_orders.get(id)))
  }))
  r.post('/outbound/:id/confirm', requirePerm('outbound.confirm'), wrap((req, res) => {
    const id = idParam(req); const o = ctx.db.outbound_orders.get(id) as any
    if (!o) throw notFound('Outbound order')
    if (o.status !== 'saved') throw conflict(`Order is already ${o.status}`)
    ctx.db.tx(() => {
      for (const l of o.lines as Line[]) inv.apply(l.productId, o.locationId, { onHand: -l.qty, reserved: -l.qty }, { type: 'outbound', userId: req.user!.id, refType: 'outbound', refId: id })
      ctx.db.outbound_orders.update(id, { ...o, status: 'confirmed', confirmedBy: actor(req.user!) })
    })
    ctx.audit.log(req.user!, 'outbound.confirm', { entity: 'outbound', entityId: id, ip: ip(req) })
    mail([req.user!.email, emailOf(o.createdBy.userId)], `Outbound #${id} confirmed`, `Outbound order #${id} from ${locName(o.locationId)} confirmed by ${req.user!.name} (${nowIso()}).\n\nItems:\n${lineStr(o.lines)}\n`)
    res.json(withClient(req, ctx.db.outbound_orders.get(id)))
  }))
  r.post('/outbound/:id/cancel', requirePerm('outbound.create'), wrap((req, res) => {
    const id = idParam(req); const o = ctx.db.outbound_orders.get(id) as any
    if (!o) throw notFound('Outbound order')
    if (o.status !== 'saved') throw conflict(`Order is already ${o.status}`)
    ctx.db.tx(() => { release(o, req.user!.id, 'unreserve', 'outbound', id); ctx.db.outbound_orders.update(id, { ...o, status: 'cancelled', closedBy: actor(req.user!) }) })
    ctx.audit.log(req.user!, 'outbound.cancel', { entity: 'outbound', entityId: id, ip: ip(req) })
    res.json(withClient(req, ctx.db.outbound_orders.get(id)))
  }))

  // ============================ ADJUSTMENTS ============================
  r.get('/adjustments', requirePerm('adjustments.view'), wrap((_req, res) => res.json((ctx.db.adjustments.all() as any[]).reverse())))
  r.post('/adjustments', requirePerm('adjustments.create'), wrap((req, res) => {
    const b = parse(z.object({ productId: z.number().int().positive(), locationId: z.number().int().positive(), newQty: z.number().finite().nonnegative().max(1e9), reason: z.string().trim().min(3).max(500) }).strict(), req.body)
    if (!ctx.db.products.get(b.productId)) throw notFound('Product'); checkLoc(b.locationId)
    const s = inv.getStock(b.productId, b.locationId)
    const delta = Math.round((b.newQty - s.onHand) * 1000) / 1000
    if (delta === 0) throw bad('Quantity is unchanged')
    const a = ctx.db.tx(() => {
      inv.apply(b.productId, b.locationId, { onHand: delta }, { type: 'adjustment', userId: req.user!.id, note: b.reason })
      return ctx.db.adjustments.insert({ ...b, before: s.onHand, delta, by: actor(req.user!) })
    })
    ctx.audit.log(req.user!, 'adjustment.create', { entity: 'adjustment', entityId: a.id, detail: `${sku(b.productId)} ${delta > 0 ? '+' : ''}${delta}`, ip: ip(req) })
    res.status(201).json(a)
  }))

  // ============================ AUDITS ============================
  const auditEmails = () => ((ctx.db.settings.all() as any[]).find((s) => s.auditEmails)?.auditEmails as string[]) ?? []
  r.get('/audits', requirePerm('audits.view'), wrap((_req, res) => res.json((ctx.db.audits.all() as any[]).reverse().map((a) => ({ ...a, lines: undefined, lineCount: a.lines.length, diffCount: a.lines.filter((l: any) => l.counted != null && l.counted !== l.system).length })))))
  r.get('/audits/:id', requirePerm('audits.view'), wrap((req, res) => { const a = ctx.db.audits.get(idParam(req)); if (!a) throw notFound('Audit'); res.json(a) }))
  r.post('/audits', requirePerm('audits.create'), wrap((req, res) => {
    const b = parse(z.object({ name: z.string().trim().max(100).optional(), locationId: z.number().int().positive().optional() }).strict(), req.body)
    if (b.locationId) checkLoc(b.locationId)
    const locs = (ctx.db.locations.all() as Location[]).filter((l) => l.active && (!b.locationId || l.id === b.locationId))
    const prods = (ctx.db.products.all() as Product[]).filter((p) => p.active)
    const lines = locs.flatMap((l) => prods.map((p) => ({ productId: p.id, locationId: l.id, system: inv.getStock(p.id, l.id).onHand, counted: null as number | null })))
    if (!lines.length) throw bad('Nothing to audit')
    const a = ctx.db.audits.insert({ name: b.name || `Audit ${nowIso().slice(0, 10)}`, scope: b.locationId ?? null, lines, status: 'counting', createdBy: actor(req.user!) })
    ctx.audit.log(req.user!, 'audit.create', { entity: 'audit', entityId: a.id, ip: ip(req) })
    res.status(201).json(a)
  }))
  r.put('/audits/:id/counts', requirePerm('audits.count'), wrap((req, res) => {
    const id = idParam(req); const a = ctx.db.audits.get(id) as any
    if (!a) throw notFound('Audit')
    if (a.status !== 'counting') throw conflict('Audit is closed')
    const b = parse(z.object({ counts: z.array(z.object({ productId: z.number().int(), locationId: z.number().int(), counted: z.number().finite().nonnegative().max(1e9).nullable() }).strict()).max(5000) }).strict(), req.body)
    for (const c of b.counts) {
      const l = a.lines.find((x: any) => x.productId === c.productId && x.locationId === c.locationId)
      if (!l) throw bad('Count for a line that is not part of this audit')
      l.counted = c.counted
    }
    ctx.db.audits.update(id, { ...a, countedBy: actor(req.user!) })
    res.json(ctx.db.audits.get(id))
  }))
  r.post('/audits/:id/confirm', requirePerm('audits.confirm'), wrap((req, res) => {
    const id = idParam(req); const a = ctx.db.audits.get(id) as any
    if (!a) throw notFound('Audit')
    if (a.status !== 'counting') throw conflict('Audit is closed')
    if (a.lines.some((l: any) => l.counted == null)) throw bad('Enter a physical count for every line before confirming')
    const u = req.user!
    const changes = ctx.db.tx(() => {
      const out: any[] = []
      for (const l of a.lines) {
        const s = inv.getStock(l.productId, l.locationId) // apply against live stock, record what the system held at audit time
        const delta = Math.round((l.counted - s.onHand) * 1000) / 1000
        if (delta !== 0) { inv.apply(l.productId, l.locationId, { onHand: delta }, { type: 'audit', userId: u.id, refType: 'audit', refId: id }); out.push({ productId: l.productId, locationId: l.locationId, system: l.system, counted: l.counted, delta }) }
      }
      ctx.db.audits.update(id, { ...a, status: 'confirmed', confirmedBy: actor(u), changes: out })
      return out
    })
    ctx.audit.log(u, 'audit.confirm', { entity: 'audit', entityId: id, detail: `${changes.length} changes`, ip: ip(req) })
    mail([...auditEmails(), u.email], `Inventory audit #${id} confirmed - ${changes.length} change(s)`,
      `Audit "${a.name}" confirmed by ${u.name} (${nowIso()}).\n\n${changes.length ? changes.map((c) => `  - ${sku(c.productId)} @ ${locName(c.locationId)}: system ${c.system} -> counted ${c.counted} (${c.delta > 0 ? '+' : ''}${c.delta})`).join('\n') : 'No differences found.'}\n`)
    res.json(ctx.db.audits.get(id))
  }))

  return r
}
