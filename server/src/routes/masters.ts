import { Router } from 'express'
import { T, statusWord } from '../i18n/index.js'
import { z } from 'zod'
import type { Ctx } from '../context.js'
import { hasPerm, requirePerm, requireSuper } from '../auth.js'
import { assertLoc, canLoc } from '../scope.js'
import { blindIndex } from '../crypto.js'
import { AppError, bad, forbidden, notFound } from '../errors.js'
import { ip, nowIso, wrap } from '../http.js'
import type { Actor, Client, Location, Product, User } from '../models.js'
import { idParam, optStr, parse, str } from '../validation.js'
import { isApproved } from '../catalog.js'
import { customUoms, listUoms, saveCustomUoms, uomKey, uomOf } from '../uoms.js'

const alnum = (s: string, n: number) => s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, n)

export function skuFor(ctx: Ctx, p: { name?: string; color?: string; size?: string; weight?: string }) {
  const base = [alnum(p.name ?? '', 3).padEnd(3, 'X') === 'XXX' && !p.name ? 'PRD' : alnum(p.name ?? '', 3).padEnd(3, 'X'), p.color ? alnum(p.color, 3) : '', p.size ? alnum(p.size, 4) : '', p.weight ? alnum(p.weight, 5) : ''].filter(Boolean).join('-')
  const key = blindIndex(base, 'skuseq')
  const row = ctx.db.settings.byIdx('key_idx', key)
  const n = ((row?.n as number) ?? 0) + 1
  if (row) ctx.db.settings.update(row.id, { n }, { key_idx: key })
  else ctx.db.settings.insert({ n }, { key_idx: key })
  return `${base}-${String(n).padStart(4, '0')}`
}

/** NO field is mandatory: products are measured in different ways (cases, weight, length, bundles). */
const opt = (max: number) => z.string().trim().max(max).optional().transform((v) => v || undefined)
const productShape = {
  name: opt(150), description: opt(1000), color: opt(40), size: opt(40), weight: opt(40),
  caseSize: z.number().int().positive().max(1_000_000).nullish().transform((v) => v ?? undefined),
  uom: z.string().trim().min(1).max(40), // checked against the built-in + super-admin units in the handler
  reorderLevel: z.number().nonnegative().max(1e9),
}
// create: sensible defaults for what is left out. update: NO defaults, so an edit never resets fields it did not send.
const productSchema = z.object({ ...productShape, uom: productShape.uom.default('unit'), reorderLevel: productShape.reorderLevel.default(0) }).strict()
const productUpdateSchema = z.object({ ...productShape, active: z.boolean() }).partial().strict()

const clientLetters = (n: number) => { let s = ''; for (n++; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s }

/** Real client data is only ever returned to users holding `clients.reveal`. Everyone else sees the alias. */
export const presentClient = (u: User, c: Client | undefined) =>
  !c ? null : hasPerm(u, 'clients.reveal') ? { id: c.id, alias: c.alias, name: c.name, contact: c.contact, address: c.address, revealed: true } : { id: c.id, alias: c.alias, revealed: false }

/** The "owner" is anyone holding approvals.manage (super admins always do). Their own submissions are approved immediately. */
export const isOwner = (u: User) => hasPerm(u, 'approvals.manage')
export const submission = (u: User): { status: 'pending' | 'approved'; submittedBy: Actor; decidedBy?: Actor } => {
  const a: Actor = { userId: u.id, name: u.name, at: nowIso() }
  return isOwner(u) ? { status: 'approved', submittedBy: a, decidedBy: a } : { status: 'pending', submittedBy: a }
}

export function masterRoutes(ctx: Ctx) {
  const r = Router()

  // ---- Locations -------------------------------------------------------------------------------
  const locSchema = z.object({ name: str(100), address: optStr(300), active: z.boolean().default(true) }).strict()
  r.get('/locations', requirePerm('locations.view', 'locations.manage', 'inbound.view', 'inbound.create', 'transfers.view', 'transfers.create', 'reserves.view', 'reserves.create', 'outbound.view', 'outbound.create', 'adjustments.view', 'adjustments.create', 'audits.view', 'audits.create', 'reports.inventory', 'reports.orders', 'products.view', 'dashboard.view'),
    wrap((req, res) => res.json((ctx.db.locations.all() as Location[]).filter((l) => isApproved(l) && canLoc(req.user!, l.id)))))
  // Names only, of every active location: a restricted person still has to be able to NAME where a transfer is going.
  r.get('/locations/destinations', requirePerm('transfers.view', 'transfers.create', 'transfers.receive'),
    wrap((_req, res) => res.json((ctx.db.locations.all() as Location[]).filter((l) => isApproved(l) && l.active).map((l) => ({ id: l.id, name: l.name })))))
  r.post('/locations', requirePerm('locations.manage'), wrap((req, res) => {
    const b = parse(locSchema, req.body)
    if ((ctx.db.locations.all() as Location[]).some((l) => l.status !== 'rejected' && l.name.toLowerCase() === b.name.toLowerCase())) throw new AppError(409, T("A location with this name already exists. Please use a different name."), 'duplicate', [{ field: 'name', message: T("This name is already used.") }])
    const l = ctx.db.locations.insert({ ...b, createdAt: nowIso(), ...submission(req.user!) })
    ctx.audit.log(req.user!, l.status === 'approved' ? 'location.create' : 'location.request', { entity: 'location', entityId: l.id, detail: b.name, ip: ip(req) })
    res.status(201).json(l)
  }))
  r.put('/locations/:id', requirePerm('locations.manage'), wrap((req, res) => {
    const id = idParam(req); const l = ctx.db.locations.get(id) as Location | undefined
    if (!l || !isApproved(l)) throw notFound('Location')
    assertLoc(req.user!, id)
    const b = parse(locSchema, req.body)
    if ((ctx.db.locations.all() as Location[]).some((x) => x.id !== id && x.status !== 'rejected' && x.name.toLowerCase() === b.name.toLowerCase())) throw new AppError(409, T("A location with this name already exists. Please use a different name."), 'duplicate', [{ field: 'name', message: T("This name is already used.") }])
    const next = { ...l, ...b }
    ctx.db.locations.update(id, next)
    ctx.audit.log(req.user!, 'location.update', { entity: 'location', entityId: id, ip: ip(req) })
    res.json(next)
  }))

  // ---- Products --------------------------------------------------------------------------------
  const prodView = requirePerm('products.view', 'products.create', 'inbound.create', 'inbound.view', 'transfers.create', 'reserves.create', 'outbound.create', 'adjustments.create', 'adjustments.view', 'audits.view', 'reports.inventory', 'reports.orders', 'dashboard.view')
  // Pending / rejected products are NOT visible in the Products list until the owner approves them.
  r.get('/products', prodView, wrap((_req, res) => res.json((ctx.db.products.all() as Product[]).filter(isApproved))))
  const checkUom = (key?: string) => { if (key !== undefined && !uomOf(ctx.db, key)) throw bad(T('"{unit}" is not a unit of measure you can use. Pick one from the list, or ask the super admin to add it.', { unit: key }), 'bad_uom') }

  // ---- Units of measure (built-in + added by the super admin) ----------------------------------
  const uomSchema = z.object({ name: str(40), short: str(12), decimals: z.boolean().default(false) }).strict()
  const uomEditSchema = z.object({ name: str(40), short: str(12) }).strict()
  const sameName = (name: string, exceptKey?: string) => listUoms(ctx.db).some((u) => u.key !== exceptKey && u.label.toLowerCase() === name.toLowerCase())
  r.get('/uoms', prodView, wrap((_req, res) => res.json(listUoms(ctx.db))))
  r.post('/uoms', requireSuper, wrap((req, res) => {
    const b = parse(uomSchema, req.body)
    if (sameName(b.name)) throw bad(T('A unit called "{name}" already exists.', { name: b.name }), 'duplicate')
    const u = { key: uomKey(ctx.db, b.name), label: b.name, short: b.short, decimals: b.decimals }
    saveCustomUoms(ctx.db, [...customUoms(ctx.db), u])
    ctx.audit.log(req.user!, 'uom.create', { entity: 'uom', detail: u.label, ip: ip(req) })
    res.status(201).json({ ...u, builtin: false })
  }))
  r.put('/uoms/:key', requireSuper, wrap((req, res) => {
    const key = String(req.params.key); const cur = uomOf(ctx.db, key)
    if (!cur) throw notFound('Unit')
    if (cur.builtin) throw bad(T('The built-in units cannot be changed or deleted.'), 'builtin')
    const b = parse(uomEditSchema, req.body)
    if (sameName(b.name, key)) throw bad(T('A unit called "{name}" already exists.', { name: b.name }), 'duplicate')
    // "allow decimals" is fixed once created: changing it could make existing stock quantities invalid
    saveCustomUoms(ctx.db, customUoms(ctx.db).map((x) => (x.key === key ? { ...x, label: b.name, short: b.short } : x)))
    ctx.audit.log(req.user!, 'uom.update', { entity: 'uom', detail: b.name, ip: ip(req) })
    res.json({ ...cur, label: b.name, short: b.short })
  }))
  r.delete('/uoms/:key', requireSuper, wrap((req, res) => {
    const key = String(req.params.key); const cur = uomOf(ctx.db, key)
    if (!cur) throw notFound('Unit')
    if (cur.builtin) throw bad(T('The built-in units cannot be changed or deleted.'), 'builtin')
    const used = (ctx.db.products.all() as Product[]).filter((p) => p.uom === key).length
    if (used) throw bad(T('"{unit}" is used by {n} product(s), so it cannot be deleted. Change those products to another unit first.', { unit: cur.label, n: used }), 'in_use')
    saveCustomUoms(ctx.db, customUoms(ctx.db).filter((u) => u.key !== key))
    ctx.audit.log(req.user!, 'uom.delete', { entity: 'uom', detail: cur.label, ip: ip(req) })
    res.status(204).end()
  }))

  r.post('/products', requirePerm('products.create'), wrap((req, res) => {
    const b = parse(productSchema, req.body)
    checkUom(b.uom)
    const sku = skuFor(ctx, b)
    const p = ctx.db.products.insert({ ...b, sku, active: true, createdAt: nowIso(), ...submission(req.user!) }, { sku_idx: blindIndex(sku, 'sku') }) as Product
    ctx.audit.log(req.user!, p.status === 'approved' ? 'product.create' : 'product.request', { entity: 'product', entityId: p.id, detail: sku, ip: ip(req) })
    res.status(201).json(p)
  }))
  r.put('/products/:id', requirePerm('products.edit'), wrap((req, res) => {
    const id = idParam(req); const p = ctx.db.products.get(id) as Product | undefined
    if (!p || !isApproved(p)) throw notFound('Product')
    const b = parse(productUpdateSchema, req.body)
    if (b.uom !== undefined && b.uom !== p.uom) checkUom(b.uom)
    const next = { ...p, ...b, sku: p.sku }
    if (b.caseSize === undefined && 'caseSize' in (req.body ?? {})) delete next.caseSize // explicit null clears it
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
    if (!hasPerm(req.user!, 'clients.reveal')) throw forbidden(T("Editing client details needs the \"see real client details\" permission. Ask a super admin to grant it."))
    const next = { ...c, ...parse(clientSchema, req.body) }
    ctx.db.clients.update(id, next)
    ctx.audit.log(req.user!, 'client.update', { entity: 'client', entityId: id, ip: ip(req) })
    res.json(presentClient(req.user!, next))
  }))
  return r
}
