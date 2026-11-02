import { Router } from 'express'
import { z } from 'zod'
import type { Ctx } from '../context.js'
import { hasPerm, requirePerm } from '../auth.js'
import { blindIndex } from '../crypto.js'
import { bad, conflict, notFound } from '../errors.js'
import { ip, nowIso, wrap } from '../http.js'
import type { Client, Location, Product, User } from '../models.js'
import { idParam, optStr, parse, str } from '../validation.js'

const alnum = (s: string, n: number) => s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, n)

export function skuFor(ctx: Ctx, name: string, color?: string, weight?: string) {
  const base = [alnum(name, 3).padEnd(3, 'X'), color ? alnum(color, 3) : '', weight ? alnum(weight, 5) : ''].filter(Boolean).join('-')
  const key = blindIndex(base, 'skuseq')
  const row = ctx.db.settings.byIdx('key_idx', key)
  const n = ((row?.n as number) ?? 0) + 1
  if (row) ctx.db.settings.update(row.id, { n }, { key_idx: key })
  else ctx.db.settings.insert({ n }, { key_idx: key })
  return `${base}-${String(n).padStart(4, '0')}`
}

const productSchema = z.object({
  name: str(150), description: optStr(1000), color: z.string().trim().max(40).optional(), weight: z.string().trim().max(40).optional(),
  unitWeightKg: z.number().nonnegative().max(100000), boxWeightKg: z.number().nonnegative().max(100000),
  caseSize: z.number().int().positive().max(1_000_000), uom: z.enum(['unit', 'kg']), reorderLevel: z.number().nonnegative().max(1e9).default(0),
}).strict()

const clientLetters = (n: number) => { let s = ''; for (n++; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s }

/** Real client data is only ever returned to users holding `clients.reveal`. Everyone else sees the alias. */
export const presentClient = (u: User, c: Client | undefined) =>
  !c ? null : hasPerm(u, 'clients.reveal') ? { id: c.id, alias: c.alias, name: c.name, contact: c.contact, address: c.address, revealed: true } : { id: c.id, alias: c.alias, revealed: false }

export function masterRoutes(ctx: Ctx) {
  const r = Router()

  // ---- Locations -------------------------------------------------------------------------------
  const locSchema = z.object({ name: str(100), address: optStr(300), active: z.boolean().default(true) }).strict()
  r.get('/locations', requirePerm('locations.view', 'inbound.view', 'inbound.create', 'transfers.view', 'transfers.create', 'reserves.view', 'reserves.create', 'outbound.view', 'outbound.create', 'adjustments.view', 'adjustments.create', 'audits.view', 'audits.create', 'reports.inventory', 'reports.orders', 'products.view', 'dashboard.view'),
    wrap((_req, res) => res.json(ctx.db.locations.all())))
  r.post('/locations', requirePerm('locations.manage'), wrap((req, res) => {
    const b = parse(locSchema, req.body)
    if ((ctx.db.locations.all() as Location[]).some((l) => l.name.toLowerCase() === b.name.toLowerCase())) throw conflict('Location name already exists')
    const l = ctx.db.locations.insert({ ...b, createdAt: nowIso() })
    ctx.audit.log(req.user!, 'location.create', { entity: 'location', entityId: l.id, detail: b.name, ip: ip(req) })
    res.status(201).json(l)
  }))
  r.put('/locations/:id', requirePerm('locations.manage'), wrap((req, res) => {
    const id = idParam(req); const l = ctx.db.locations.get(id) as Location | undefined
    if (!l) throw notFound('Location')
    const next = { ...l, ...parse(locSchema, req.body) }
    ctx.db.locations.update(id, next)
    ctx.audit.log(req.user!, 'location.update', { entity: 'location', entityId: id, ip: ip(req) })
    res.json(next)
  }))

  // ---- Products --------------------------------------------------------------------------------
  const prodView = requirePerm('products.view', 'inbound.create', 'inbound.view', 'transfers.create', 'reserves.create', 'outbound.create', 'adjustments.create', 'audits.view', 'reports.inventory', 'reports.orders', 'dashboard.view')
  r.get('/products', prodView, wrap((_req, res) => res.json(ctx.db.products.all())))
  r.post('/products', requirePerm('products.create'), wrap((req, res) => {
    const b = parse(productSchema, req.body)
    const sku = skuFor(ctx, b.name, b.color, b.weight)
    const p = ctx.db.products.insert({ ...b, sku, active: true, createdAt: nowIso() }, { sku_idx: blindIndex(sku, 'sku') }) as Product
    ctx.audit.log(req.user!, 'product.create', { entity: 'product', entityId: p.id, detail: sku, ip: ip(req) })
    res.status(201).json(p)
  }))
  r.put('/products/:id', requirePerm('products.edit'), wrap((req, res) => {
    const id = idParam(req); const p = ctx.db.products.get(id) as Product | undefined
    if (!p) throw notFound('Product')
    const b = parse(productSchema.extend({ active: z.boolean() }).partial().strict(), req.body)
    const next = { ...p, ...b, sku: p.sku }
    ctx.db.products.update(id, next, { sku_idx: blindIndex(p.sku, 'sku') })
    ctx.audit.log(req.user!, 'product.update', { entity: 'product', entityId: id, ip: ip(req) })
    res.json(next)
  }))

  // ---- Clients (anonymised) --------------------------------------------------------------------
  const clientView = requirePerm('clients.view', 'clients.manage', 'clients.reveal', 'reserves.create', 'outbound.create', 'reserves.view', 'outbound.view')
  r.get('/clients', clientView, wrap((req, res) => res.json((ctx.db.clients.all() as Client[]).map((c) => presentClient(req.user!, c)))))
  r.get('/clients/:id', clientView, wrap((req, res) => {
    const c = ctx.db.clients.get(idParam(req)) as Client | undefined
    if (!c) throw notFound('Client')
    if (hasPerm(req.user!, 'clients.reveal')) ctx.audit.log(req.user!, 'client.reveal', { entity: 'client', entityId: c.id, ip: ip(req) })
    res.json(presentClient(req.user!, c))
  }))
  const clientSchema = z.object({ name: str(150), contact: optStr(200), address: optStr(300) }).strict()
  r.post('/clients', requirePerm('clients.manage'), wrap((req, res) => {
    const b = parse(clientSchema, req.body)
    const key = blindIndex('counter', 'clientseq')
    const row = ctx.db.settings.byIdx('key_idx', key)
    const n = (row?.n as number) ?? 0
    if (row) ctx.db.settings.update(row.id, { n: n + 1 }, { key_idx: key }); else ctx.db.settings.insert({ n: 1 }, { key_idx: key })
    const c = ctx.db.clients.insert({ ...b, alias: `Client ${clientLetters(n)}`, createdAt: nowIso() }) as Client
    ctx.audit.log(req.user!, 'client.create', { entity: 'client', entityId: c.id, detail: c.alias, ip: ip(req) })
    res.status(201).json(presentClient(req.user!, c))
  }))
  r.put('/clients/:id', requirePerm('clients.manage'), wrap((req, res) => {
    const id = idParam(req); const c = ctx.db.clients.get(id) as Client | undefined
    if (!c) throw notFound('Client')
    // Editing real details requires the reveal right too, so a manager cannot read data via the edit form.
    if (!hasPerm(req.user!, 'clients.reveal')) throw bad('Editing client details requires the "see real client details" permission')
    const next = { ...c, ...parse(clientSchema, req.body) }
    ctx.db.clients.update(id, next)
    ctx.audit.log(req.user!, 'client.update', { entity: 'client', entityId: id, ip: ip(req) })
    res.json(presentClient(req.user!, next))
  }))
  return r
}
