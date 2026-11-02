/**
 * DEMO MODE ONLY (VITE_DEMO=true, used for the GitHub Pages build).
 * A tiny in-browser stand-in for the API so the UI can be tested on static hosting.
 * Data is fake, lives in this browser's localStorage, and is NOT encrypted - the real server is in /server.
 */
import { ALL_KEYS, PERMISSIONS } from '../../server/src/permissions'
import { ApiError } from './api'

const KEY = 'wms-demo-db-v1', DEMO_PW = 'Demo-Passw0rd-2026'
type A = any
const now = () => new Date().toISOString()
const err = (s: number, m: string, code?: string) => new ApiError(s, m, code)
const r3 = (n: number) => Math.round(n * 1000) / 1000

function seed(): A {
  const db: A = { seq: {}, users: [], locations: [], products: [], clients: [], stock: [], movements: [], inbound: [], transfers: [], reserves: [], outbound: [], adjustments: [], audits: [], logs: [], outbox: [], settings: { auditEmails: [] } }
  const id = (k: string) => (db.seq[k] = (db.seq[k] ?? 0) + 1)
  db.id = id
  const user = (name: string, email: string, role: string, permissions: string[]) => db.users.push({ id: id('u'), name, email, role, permissions, password: DEMO_PW, active: true, mustChangePassword: false, totpEnabled: false, createdAt: now() })
  user('Sara Admin', 'super@demo.test', 'super_admin', [])
  user('Dana Dashboard', 'dashboard@demo.test', 'user', ['dashboard.view'])
  user('Omar Operator', 'operator@demo.test', 'user', ['dashboard.view', 'products.view', 'inbound.view', 'inbound.create', 'transfers.view', 'transfers.create', 'transfers.receive', 'reserves.view', 'reserves.create', 'outbound.view', 'outbound.create', 'clients.view'])
  user('Mia Manager', 'manager@demo.test', 'admin', ['dashboard.view', 'products.view', 'products.create', 'products.edit', 'inbound.view', 'inbound.approve', 'outbound.view', 'outbound.confirm', 'reports.inventory', 'reports.orders', 'clients.view', 'clients.reveal'])
  for (const n of ['Karachi Main', 'Lahore Hub', 'Dubai Port']) db.locations.push({ id: id('l'), name: n, address: n + ' Industrial Area', active: true })
  const specs: [string, string, string, string, number, number, string][] = [
    ['Cotton T-Shirt', 'White', 'M', 'Plain cotton tee', 24, 0.2, 'COT-WHI-M'], ['Cotton T-Shirt', 'Black', 'L', 'Plain cotton tee', 24, 0.22, 'COT-BLA-L'], ['Basmati Rice', '', '5kg', 'Premium long grain', 4, 5, 'BAS-5KG'],
    ['Olive Oil', '', '1L', 'Extra virgin', 12, 1, 'OLI-1L'], ['Steel Bottle', 'Silver', '750ml', 'Insulated bottle', 20, 0.4, 'STE-SIL-750ML'], ['LED Bulb', 'Warm', '9W', 'Energy saver', 50, 0.08, 'LED-WAR-9W'],
  ]
  for (const [name, color, weight, description, caseSize, w, base] of specs) { const p = { id: id('p'), sku: `${base}-0001`, name, description, color: color || undefined, weight, unitWeightKg: w, boxWeightKg: 1.2, caseSize, uom: 'unit', reorderLevel: 100, active: true }; db.products.push(p) }
  ;['Acme Retail Ltd', 'Blue Star Traders', 'Harbor Foods'].forEach((name, i) => db.clients.push({ id: id('c'), alias: `Client ${'ABC'[i]}`, name, contact: 'contact@example.test', address: 'Somewhere' }))
  let s = 7; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647
  for (const l of db.locations) for (const p of db.products) db.stock.push({ productId: p.id, locationId: l.id, onHand: Math.round(120 + rnd() * 900), reserved: 0 })
  const st = (p: number, l: number) => db.stock.find((x: A) => x.productId === p && x.locationId === l)
  st(1, 1).reserved = 50
  const a = { userId: 1, name: 'Sara Admin', at: now() }
  db.reserves.push({ id: id('r'), locationId: 1, clientId: 1, note: 'Spring campaign', lines: [{ productId: 1, cases: 0, loose: 50, qty: 50 }], status: 'active', createdBy: a })
  db.inbound.push({ id: id('i'), locationId: 2, reference: 'MSKU-123456', notifyEmails: [], lines: [{ productId: 4, cases: 10, loose: 0, qty: 120 }], status: 'pending', comments: [], enteredBy: { ...a, name: 'Omar Operator', userId: 3 } })
  return db
}

let db: A
const load = (): A => {
  try { const v = localStorage.getItem(KEY); if (v) { const d = JSON.parse(v); d.id = (k: string) => (d.seq[k] = (d.seq[k] ?? 0) + 1); return d } } catch { /* ignore */ }
  return seed()
}
const save = () => { try { const { id: _i, ...rest } = db; void _i; localStorage.setItem(KEY, JSON.stringify(rest)) } catch { /* ignore */ } }
export const resetDemo = () => { try { localStorage.removeItem(KEY); sessionStorage.removeItem('wms-demo-user') } catch { /* ignore */ } db = seed(); save() }

const curId = () => { try { return Number(sessionStorage.getItem('wms-demo-user')) || 0 } catch { return 0 } }
const effective = (u: A) => (u.role === 'super_admin' ? [...ALL_KEYS, 'users.manage', 'backups.manage'] : u.permissions)
const pub = (u: A) => ({ id: u.id, name: u.name, email: u.email, role: u.role, active: u.active, permissions: effective(u), mustChangePassword: !!u.mustChangePassword, totpEnabled: !!u.totpEnabled, mfaSetupRequired: false, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt, locked: false })
const can = (u: A, ...p: string[]) => u.role === 'super_admin' || p.some((x) => u.permissions.includes(x))
const log = (u: A, action: string, detail = '') => db.logs.push({ id: db.id('log'), at: now(), userName: u?.name ?? 'anonymous', action, detail, ip: 'demo' })

const stockRow = (p: number, l: number) => { let s = db.stock.find((x: A) => x.productId === p && x.locationId === l); if (!s) { s = { productId: p, locationId: l, onHand: 0, reserved: 0 }; db.stock.push(s) } return s }
function apply(p: number, l: number, d: { onHand?: number; reserved?: number }, m: { type: string; userId: number; refType?: string; refId?: number; note?: string }) {
  const s = stockRow(p, l); const onHand = r3(s.onHand + (d.onHand ?? 0)), reserved = r3(s.reserved + (d.reserved ?? 0))
  if (onHand < 0) throw err(409, 'Insufficient stock on hand')
  if (reserved < 0) throw err(409, 'Reserved quantity cannot be negative')
  if (reserved > onHand) throw err(409, 'Insufficient available stock (reserved would exceed on hand)')
  s.onHand = onHand; s.reserved = reserved
  db.movements.push({ id: db.id('m'), productId: p, locationId: l, type: m.type, onHandDelta: d.onHand ?? 0, reservedDelta: d.reserved ?? 0, onHandAfter: onHand, refType: m.refType, refId: m.refId, userId: m.userId, note: m.note, at: now() })
}
function build(input: A[], zero = false) {
  if (!input?.length) throw err(400, 'At least one line is required')
  return input.map((l) => {
    const p = db.products.find((x: A) => x.id === l.productId); if (!p) throw err(404, 'Product not found')
    const qty = r3((l.cases ?? 0) * p.caseSize + (l.loose ?? 0))
    if (qty < 0 || (qty === 0 && !zero)) throw err(400, `Quantity for ${p.sku} must be greater than zero`)
    return { productId: p.id, cases: l.cases ?? 0, loose: l.loose ?? 0, qty }
  })
}
const actor = (u: A) => ({ userId: u.id, name: u.name, at: now() })
const client = (u: A, id?: number) => { const c = db.clients.find((x: A) => x.id === id); if (!c) return null; return can(u, 'clients.reveal') ? { ...c, revealed: true } : { id: c.id, alias: c.alias, revealed: false } }
const wc = (u: A, o: A) => ({ ...o, client: o.clientId ? client(u, o.clientId) : null })
const sku = (id: number) => db.products.find((p: A) => p.id === id)?.sku
const mail = (to: string[], subject: string) => db.outbox.push({ id: db.id('mail'), to, subject, at: now(), status: 'not_configured' })
const sum = (ls: A[]) => ls.reduce((a, l) => a + l.qty, 0)
const inTransit = () => db.transfers.filter((t: A) => t.status === 'in_transit').reduce((a: number, t: A) => a + sum(t.lines), 0)
const csv = (rows: A[]) => (rows.length ? [Object.keys(rows[0]).join(','), ...rows.map((r) => Object.values(r).map((v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : /^[=+\-@]/.test(s) ? "'" + s : s }).join(','))].join('\n') : '')
const qs = (path: string) => Object.fromEntries(new URLSearchParams(path.split('?')[1] ?? ''))

type H = (u: A, b: A, m: RegExpMatchArray, q: Record<string, string>) => unknown
const routes: [string, RegExp, string[] | 'super' | null, H][] = []
const R = (method: string, re: string, perm: string[] | 'super' | null, h: H) => routes.push([method, new RegExp(`^${re}$`), perm, h])
const find = (arr: A[], id: string, what: string) => { const x = arr.find((o) => o.id === Number(id)); if (!x) throw err(404, `${what} not found`); return x }

// ---- auth
R('GET', '/auth/me', null, (u) => ({ user: pub(u), csrf: 'demo' }))
R('POST', '/auth/logout', null, () => { sessionStorage.removeItem('wms-demo-user'); return { ok: true } })
R('POST', '/auth/password', null, (u, b) => { if (b.currentPassword !== u.password) throw err(400, 'Current password is incorrect'); if (String(b.newPassword).length < 12) throw err(400, 'Password must be at least 12 characters'); u.password = b.newPassword; u.mustChangePassword = false; return { ok: true } })
R('POST', '/auth/totp/setup', null, () => ({ secret: 'DEMOSECRETDEMOSECRET', otpauthUrl: 'otpauth://totp/WMS:demo?secret=DEMOSECRETDEMOSECRET&issuer=WMS' }))
R('POST', '/auth/totp/enable', null, () => { throw err(400, 'Two-factor is disabled in demo mode') })
R('POST', '/auth/totp/disable', null, () => { throw err(400, 'Two-factor is disabled in demo mode') })
// ---- users
R('GET', '/users/meta', 'super', () => ({ permissions: PERMISSIONS }))
R('GET', '/users', 'super', () => db.users.map(pub))
R('POST', '/users', 'super', (u, b) => {
  if (db.users.some((x: A) => x.email.toLowerCase() === String(b.email).toLowerCase())) throw err(409, 'A user with this email already exists')
  const temp = `Temp-${Math.random().toString(36).slice(2, 10)}-${Math.floor(1000 + Math.random() * 9000)}`
  const n = { id: db.id('u'), name: b.name, email: b.email.toLowerCase(), role: b.role, permissions: b.role === 'super_admin' ? [] : b.permissions ?? [], password: temp, active: true, mustChangePassword: true, createdAt: now() }
  db.users.push(n); log(u, 'user.create', n.email); return { user: pub(n), temporaryPassword: temp }
})
R('PATCH', '/users/(\\d+)', 'super', (u, b, m) => {
  const t = find(db.users, m[1], 'User'); const wasSuper = t.role === 'super_admin' && t.active
  const next = { ...t, ...(b.name !== undefined && { name: b.name }), ...(b.role && { role: b.role }), ...(b.permissions && { permissions: b.permissions }), ...(b.active !== undefined && { active: b.active }) }
  if (wasSuper && (next.role !== 'super_admin' || !next.active) && db.users.filter((x: A) => x.role === 'super_admin' && x.active).length <= 1) throw err(400, 'There must be at least one active super admin')
  Object.assign(t, next); log(u, 'user.update', t.email); return pub(t)
})
R('POST', '/users/(\\d+)/reset-password', 'super', (u, _b, m) => { const t = find(db.users, m[1], 'User'); t.password = `Temp-${Math.random().toString(36).slice(2, 10)}-4821`; t.mustChangePassword = true; log(u, 'user.reset_password', t.email); return { temporaryPassword: t.password } })
R('POST', '/users/(\\d+)/(unlock|reset-mfa)', 'super', () => ({ ok: true }))
// ---- masters
const viewAny = ['dashboard.view', 'products.view', 'inbound.view', 'inbound.create', 'transfers.view', 'transfers.create', 'reserves.view', 'reserves.create', 'outbound.view', 'outbound.create', 'adjustments.view', 'adjustments.create', 'audits.view', 'audits.create', 'reports.inventory', 'reports.orders', 'locations.view', 'locations.manage']
R('GET', '/locations', viewAny, () => db.locations)
R('POST', '/locations', ['locations.manage'], (u, b) => { if (!b.name?.trim()) throw err(400, 'name: Required'); const l = { id: db.id('l'), name: b.name, address: b.address ?? '', active: b.active ?? true }; db.locations.push(l); log(u, 'location.create', l.name); return l })
R('PUT', '/locations/(\\d+)', ['locations.manage'], (u, b, m) => { const l = find(db.locations, m[1], 'Location'); Object.assign(l, { name: b.name, address: b.address ?? '', active: b.active }); log(u, 'location.update', l.name); return l })
R('GET', '/products', viewAny, () => db.products)
R('POST', '/products', ['products.create'], (u, b) => {
  const alnum = (s: string, n: number) => s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, n)
  const base = [alnum(b.name, 3).padEnd(3, 'X'), b.color ? alnum(b.color, 3) : '', b.weight ? alnum(b.weight, 5) : ''].filter(Boolean).join('-')
  const n = (db.seq['sku:' + base] = (db.seq['sku:' + base] ?? (db.products.filter((p: A) => p.sku.startsWith(base + '-')).length)) + 1)
  const p = { ...b, id: db.id('p'), sku: `${base}-${String(n).padStart(4, '0')}`, active: true }; db.products.push(p); log(u, 'product.create', p.sku); return p
})
R('PUT', '/products/(\\d+)', ['products.edit'], (u, b, m) => { const p = find(db.products, m[1], 'Product'); Object.assign(p, b, { sku: p.sku }); log(u, 'product.update', p.sku); return p })
const cv = ['clients.view', 'clients.manage', 'clients.reveal', 'reserves.create', 'outbound.create', 'reserves.view', 'outbound.view']
R('GET', '/clients', cv, (u) => db.clients.map((c: A) => client(u, c.id)))
R('POST', '/clients', ['clients.manage'], (u, b) => { const n = db.clients.length; const c = { id: db.id('c'), alias: `Client ${String.fromCharCode(65 + (n % 26))}${n >= 26 ? Math.floor(n / 26) : ''}`, name: b.name, contact: b.contact ?? '', address: b.address ?? '' }; db.clients.push(c); log(u, 'client.create', c.alias); return client(u, c.id) })
R('PUT', '/clients/(\\d+)', ['clients.manage'], (u, b, m) => { if (!can(u, 'clients.reveal')) throw err(400, 'Editing client details requires the "see real client details" permission'); const c = find(db.clients, m[1], 'Client'); Object.assign(c, { name: b.name, contact: b.contact, address: b.address }); return client(u, c.id) })
// ---- stock
R('GET', '/stock', ['dashboard.view', 'products.view', 'inbound.view', 'transfers.create', 'reserves.create', 'outbound.create', 'adjustments.view', 'adjustments.create', 'audits.view', 'reports.inventory'], (_u, _b, _m, q) =>
  db.stock.filter((s: A) => (!q.locationId || s.locationId === +q.locationId) && (!q.productId || s.productId === +q.productId)).map((s: A) => ({ ...s, available: s.onHand - s.reserved })))
// ---- inbound
R('GET', '/inbound', ['inbound.view'], (_u, _b, _m, q) => db.inbound.filter((o: A) => !q.status || o.status === q.status).slice().reverse())
R('POST', '/inbound', ['inbound.create'], (u, b) => { const o = { id: db.id('i'), locationId: b.locationId, reference: b.reference ?? '', notifyEmails: b.notifyEmails ?? [], lines: build(b.lines), status: 'pending', comments: b.comments ? [{ by: u.name, at: now(), text: b.comments }] : [], enteredBy: actor(u) }; db.inbound.push(o); log(u, 'inbound.create', `#${o.id}`); return o })
R('POST', '/inbound/(\\d+)/approve', ['inbound.approve'], (u, b, m) => {
  const o = find(db.inbound, m[1], 'Inbound order'); if (o.status !== 'pending') throw err(409, `Order is already ${o.status}`)
  if (o.enteredBy.userId === u.id && u.role !== 'super_admin') throw err(403, 'Segregation of duties: someone else must approve a packing list you entered')
  const verified = b.verified ? build(b.verified, true) : o.lines
  const differs = o.lines.some((l: A) => (verified.find((v: A) => v.productId === l.productId)?.qty ?? 0) !== l.qty)
  if (differs && !b.comment) throw err(400, 'Verified quantities differ from the packing list - a comment is required')
  for (const l of verified) if (l.qty > 0) apply(l.productId, o.locationId, { onHand: l.qty }, { type: 'inbound', userId: u.id, refType: 'inbound', refId: o.id })
  Object.assign(o, { status: 'approved', verified, decidedBy: actor(u) }); if (b.comment) o.comments.push({ by: u.name, at: now(), text: b.comment })
  mail([...o.notifyEmails, u.email], `Inbound #${o.id} approved`); log(u, 'inbound.approve', `#${o.id}`); return o
})
R('POST', '/inbound/(\\d+)/reject', ['inbound.approve'], (u, b, m) => { const o = find(db.inbound, m[1], 'Inbound order'); if (o.status !== 'pending') throw err(409, `Order is already ${o.status}`); Object.assign(o, { status: 'rejected', decidedBy: actor(u) }); o.comments.push({ by: u.name, at: now(), text: b.comment }); return o })
// ---- transfers
R('GET', '/transfers', ['transfers.view'], (_u, _b, _m, q) => db.transfers.filter((o: A) => !q.status || o.status === q.status).slice().reverse())
R('POST', '/transfers', ['transfers.create'], (u, b) => { if (b.fromLocationId === b.toLocationId) throw err(400, 'Source and destination must differ'); const o = { id: db.id('t'), fromLocationId: b.fromLocationId, toLocationId: b.toLocationId, note: b.note ?? '', lines: build(b.lines), status: 'draft', createdBy: actor(u) }; db.transfers.push(o); return o })
R('POST', '/transfers/(\\d+)/submit', ['transfers.create'], (u, _b, m) => { const o = find(db.transfers, m[1], 'Transfer order'); if (o.status !== 'draft') throw err(409, `Order is already ${o.status}`); for (const l of o.lines) apply(l.productId, o.fromLocationId, { onHand: -l.qty }, { type: 'transfer_out', userId: u.id, refType: 'transfer', refId: o.id }); Object.assign(o, { status: 'in_transit', submittedBy: actor(u) }); return o })
R('POST', '/transfers/(\\d+)/cancel', ['transfers.create'], (_u, _b, m) => { const o = find(db.transfers, m[1], 'Transfer order'); if (o.status !== 'draft') throw err(409, 'Only drafts can be cancelled'); o.status = 'cancelled'; return o })
R('POST', '/transfers/(\\d+)/receive', ['transfers.receive'], (u, b, m) => {
  const o = find(db.transfers, m[1], 'Transfer order'); if (o.status !== 'in_transit') throw err(409, `Order is ${o.status}, not in transit`)
  const received = b.received ? build(b.received, true) : o.lines
  const discrepancy = o.lines.map((l: A) => ({ productId: l.productId, sent: l.qty, received: received.find((x: A) => x.productId === l.productId)?.qty ?? 0 })).filter((d: A) => d.sent !== d.received)
  if (discrepancy.length && !b.comment) throw err(400, 'Received quantities differ from what was sent - a comment is required')
  for (const l of received) if (l.qty > 0) apply(l.productId, o.toLocationId, { onHand: l.qty }, { type: 'transfer_in', userId: u.id, refType: 'transfer', refId: o.id })
  Object.assign(o, { status: 'received', receivedLines: received, discrepancy, receivedBy: { ...actor(u), locationId: o.toLocationId, location: db.locations.find((l: A) => l.id === o.toLocationId)?.name } }); return o
})
// ---- reserves / outbound
const release = (o: A, uid: number, refType: string) => { for (const l of o.lines) apply(l.productId, o.locationId, { reserved: -l.qty }, { type: 'unreserve', userId: uid, refType, refId: o.id }) }
const allocate = (lines: A[], loc: number, uid: number, id: number) => { for (const l of lines) apply(l.productId, loc, { reserved: l.qty }, { type: 'reserve', userId: uid, refType: 'outbound', refId: id }) }
R('GET', '/reserves', ['reserves.view'], (u, _b, _m, q) => db.reserves.filter((o: A) => !q.status || o.status === q.status).slice().reverse().map((o: A) => wc(u, o)))
R('POST', '/reserves', ['reserves.create'], (u, b) => { const lines = build(b.lines); const o = { id: db.id('r'), locationId: b.locationId, clientId: b.clientId, note: b.note ?? '', lines, status: 'active', createdBy: actor(u) }; for (const l of lines) apply(l.productId, b.locationId, { reserved: l.qty }, { type: 'reserve', userId: u.id, refType: 'reserve', refId: o.id }); db.reserves.push(o); mail([u.email], `Reserve order #${o.id} placed`); return wc(u, o) })
R('POST', '/reserves/(\\d+)/cancel', ['reserves.convert'], (u, _b, m) => { const o = find(db.reserves, m[1], 'Reserve order'); if (o.status !== 'active') throw err(409, `Order is already ${o.status}`); release(o, u.id, 'reserve'); Object.assign(o, { status: 'cancelled', closedBy: actor(u) }); return wc(u, o) })
R('POST', '/reserves/(\\d+)/convert', ['reserves.convert', 'outbound.create'], (u, b, m) => {
  const o = find(db.reserves, m[1], 'Reserve order'); if (o.status !== 'active') throw err(409, `Order is already ${o.status}`)
  if (!o.clientId) throw err(400, 'Attach a client to the reserve order before converting it to outbound')
  const actual = build(b.actual, true); const lines = o.lines.map((l: A) => { const a = actual.find((x: A) => x.productId === l.productId)?.qty ?? 0; return { ...l, actualQty: a, difference: l.qty - a } })
  const ship = actual.filter((a: A) => a.qty > 0); if (!ship.length) throw err(400, 'Nothing to ship - cancel the reserve order instead')
  if (lines.some((l: A) => l.difference) && !b.comment) throw err(400, 'Actual quantities differ from reserved - a comment is required')
  release(o, u.id, 'reserve'); const ob = { id: db.id('o'), locationId: o.locationId, clientId: o.clientId, note: b.comment ?? '', lines: ship, status: 'saved', sourceReserveId: o.id, createdBy: actor(u) }
  allocate(ship, o.locationId, u.id, ob.id); db.outbound.push(ob); Object.assign(o, { lines, status: 'converted', outboundId: ob.id, closedBy: actor(u) }); return { reserve: wc(u, o), outbound: wc(u, ob) }
})
R('GET', '/outbound', ['outbound.view'], (u, _b, _m, q) => db.outbound.filter((o: A) => !q.status || o.status === q.status).slice().reverse().map((o: A) => wc(u, o)))
R('POST', '/outbound', ['outbound.create'], (u, b) => { const lines = build(b.lines); const o = { id: db.id('o'), locationId: b.locationId, clientId: b.clientId, note: b.note ?? '', lines, status: 'saved', createdBy: actor(u) }; allocate(lines, b.locationId, u.id, o.id); db.outbound.push(o); return wc(u, o) })
R('PUT', '/outbound/(\\d+)', ['outbound.create'], (u, b, m) => { const o = find(db.outbound, m[1], 'Outbound order'); if (o.status !== 'saved') throw err(409, 'Only saved orders can be edited'); const lines = build(b.lines); release(o, u.id, 'outbound'); allocate(lines, o.locationId, u.id, o.id); Object.assign(o, { clientId: b.clientId, note: b.note ?? '', lines }); return wc(u, o) })
R('POST', '/outbound/(\\d+)/confirm', ['outbound.confirm'], (u, _b, m) => { const o = find(db.outbound, m[1], 'Outbound order'); if (o.status !== 'saved') throw err(409, `Order is already ${o.status}`); for (const l of o.lines) apply(l.productId, o.locationId, { onHand: -l.qty, reserved: -l.qty }, { type: 'outbound', userId: u.id, refType: 'outbound', refId: o.id }); Object.assign(o, { status: 'confirmed', confirmedBy: actor(u) }); mail([u.email], `Outbound #${o.id} confirmed`); return wc(u, o) })
R('POST', '/outbound/(\\d+)/cancel', ['outbound.create'], (u, _b, m) => { const o = find(db.outbound, m[1], 'Outbound order'); if (o.status !== 'saved') throw err(409, `Order is already ${o.status}`); release(o, u.id, 'outbound'); Object.assign(o, { status: 'cancelled', closedBy: actor(u) }); return wc(u, o) })
// ---- adjustments / audits
R('GET', '/adjustments', ['adjustments.view'], () => db.adjustments.slice().reverse())
R('POST', '/adjustments', ['adjustments.create'], (u, b) => { const s = stockRow(b.productId, b.locationId); const delta = r3(b.newQty - s.onHand); if (!delta) throw err(400, 'Quantity is unchanged'); if (String(b.reason ?? '').trim().length < 3) throw err(400, 'reason: too short'); const before = s.onHand; apply(b.productId, b.locationId, { onHand: delta }, { type: 'adjustment', userId: u.id, note: b.reason }); const a = { id: db.id('a'), ...b, before, delta, by: actor(u) }; db.adjustments.push(a); log(u, 'adjustment.create', `${sku(b.productId)} ${delta}`); return a })
R('GET', '/audits', ['audits.view'], () => db.audits.slice().reverse().map((a: A) => ({ ...a, lines: undefined, lineCount: a.lines.length, diffCount: a.lines.filter((l: A) => l.counted != null && l.counted !== l.system).length })))
R('GET', '/audits/(\\d+)', ['audits.view'], (_u, _b, m) => find(db.audits, m[1], 'Audit'))
R('POST', '/audits', ['audits.create'], (u, b) => { const locs = db.locations.filter((l: A) => l.active && (!b.locationId || l.id === b.locationId)); const lines = locs.flatMap((l: A) => db.products.filter((p: A) => p.active).map((p: A) => ({ productId: p.id, locationId: l.id, system: stockRow(p.id, l.id).onHand, counted: null }))); const a = { id: db.id('au'), name: b.name || `Audit ${now().slice(0, 10)}`, lines, status: 'counting', createdBy: actor(u) }; db.audits.push(a); return a })
R('PUT', '/audits/(\\d+)/counts', ['audits.count'], (_u, b, m) => { const a = find(db.audits, m[1], 'Audit'); if (a.status !== 'counting') throw err(409, 'Audit is closed'); for (const c of b.counts) { const l = a.lines.find((x: A) => x.productId === c.productId && x.locationId === c.locationId); if (l) l.counted = c.counted } return a })
R('POST', '/audits/(\\d+)/confirm', ['audits.confirm'], (u, _b, m) => {
  const a = find(db.audits, m[1], 'Audit'); if (a.status !== 'counting') throw err(409, 'Audit is closed'); if (a.lines.some((l: A) => l.counted == null)) throw err(400, 'Enter a physical count for every line before confirming')
  const changes: A[] = []; for (const l of a.lines) { const d = r3(l.counted - stockRow(l.productId, l.locationId).onHand); if (d) { apply(l.productId, l.locationId, { onHand: d }, { type: 'audit', userId: u.id, refType: 'audit', refId: a.id }); changes.push({ productId: l.productId, locationId: l.locationId, system: l.system, counted: l.counted, delta: d }) } }
  Object.assign(a, { status: 'confirmed', confirmedBy: actor(u), changes }); mail([u.email], `Inventory audit #${a.id} confirmed`); return a
})
// ---- insights
R('GET', '/dashboard', ['dashboard.view'], () => {
  const on = sum(db.stock.map((s: A) => ({ qty: s.onHand }))), res = sum(db.stock.map((s: A) => ({ qty: s.reserved })))
  const tot = (id: number) => db.stock.filter((s: A) => s.productId === id).reduce((a: A, s: A) => ({ o: a.o + s.onHand, r: a.r + s.reserved }), { o: 0, r: 0 })
  const act = db.products.filter((p: A) => p.active); const low = act.filter((p: A) => p.reorderLevel > 0 && tot(p.id).o - tot(p.id).r <= p.reorderLevel)
  const days = 30, trend: A[] = []; for (let i = days; i >= 0; i--) trend.push({ date: new Date(Date.now() - i * 864e5).toISOString().slice(0, 10), inbound: 0, outbound: 0 })
  for (const m of db.movements) { const t = trend.find((x) => x.date === m.at.slice(0, 10)); if (!t) continue; if (m.type === 'inbound') t.inbound += m.onHandDelta; if (m.type === 'outbound') t.outbound -= m.onHandDelta }
  const cnt = (rows: A[], s: string) => rows.filter((o) => o.status === s).length
  return {
    kpis: { totalOnHand: on, reserved: res, available: on - res, inTransit: inTransit(), activeSkus: act.length, locations: db.locations.filter((l: A) => l.active).length, lowStockCount: low.length, pendingInbound: cnt(db.inbound, 'pending'), transfersInTransit: cnt(db.transfers, 'in_transit'), activeReserves: cnt(db.reserves, 'active'), pendingOutbound: cnt(db.outbound, 'saved'), outboundThisMonth: db.outbound.filter((o: A) => o.status === 'confirmed' && o.confirmedBy?.at?.startsWith(now().slice(0, 7))).length },
    byLocation: db.locations.filter((l: A) => l.active).map((l: A) => ({ name: l.name, onHand: db.stock.filter((s: A) => s.locationId === l.id).reduce((a: number, s: A) => a + s.onHand, 0), reserved: db.stock.filter((s: A) => s.locationId === l.id).reduce((a: number, s: A) => a + s.reserved, 0) })),
    topProducts: db.products.map((p: A) => ({ name: p.sku, onHand: tot(p.id).o })).sort((a: A, b: A) => b.onHand - a.onHand).slice(0, 8), trend,
    lowStock: low.slice(0, 8).map((p: A) => ({ sku: p.sku, name: p.name, available: tot(p.id).o - tot(p.id).r, reorderLevel: p.reorderLevel })),
  }
})
R('GET', '/products/(\\d+)/overview', ['products.view'], (_u, _b, m) => {
  const p = find(db.products, m[1], 'Product'); const st = db.stock.filter((s: A) => s.productId === p.id); const t = st.reduce((a: A, s: A) => ({ onHand: a.onHand + s.onHand, reserved: a.reserved + s.reserved }), { onHand: 0, reserved: 0 })
  const q = (rows: A[], f: (o: A) => boolean) => rows.filter(f).reduce((a, o) => a + (o.lines.find((l: A) => l.productId === p.id)?.qty ?? 0), 0)
  const L = (id: number) => db.locations.find((l: A) => l.id === id)?.name, U = (id: number) => db.users.find((u: A) => u.id === id)?.name
  const tr = db.transfers.filter((x: A) => x.status === 'in_transit').reduce((a: number, x: A) => a + (x.lines.find((l: A) => l.productId === p.id)?.qty ?? 0), 0)
  return { product: p, totals: { ...t, available: t.onHand - t.reserved, inTransit: tr, inboundPending: q(db.inbound, (o) => o.status === 'pending'), outboundTotal: q(db.outbound, (o) => o.status === 'confirmed'), outboundPending: q(db.outbound, (o) => o.status === 'saved'), boxes: Math.ceil(t.onHand / p.caseSize) },
    byLocation: st.map((s: A) => ({ locationId: s.locationId, location: L(s.locationId), onHand: s.onHand, reserved: s.reserved, available: s.onHand - s.reserved })), movements: db.movements.filter((x: A) => x.productId === p.id).slice().reverse().slice(0, 200).map((x: A) => ({ ...x, location: L(x.locationId), user: U(x.userId) })) }
})
R('GET', '/reports/inventory', ['reports.inventory'], (_u, _b, _m, q) => {
  const rows = db.stock.filter((s: A) => !q.locationId || s.locationId === +q.locationId).map((s: A) => { const p = db.products.find((x: A) => x.id === s.productId); return { SKU: p.sku, Product: p.name, Variation: [p.color, p.weight].filter(Boolean).join(' / '), Location: db.locations.find((l: A) => l.id === s.locationId)?.name, 'Case pack': p.caseSize, UOM: p.uom, 'On hand': s.onHand, Reserved: s.reserved, Available: s.onHand - s.reserved, Boxes: Math.ceil(s.onHand / p.caseSize) } })
  return q.format === 'csv' ? csv(rows) : rows
})
R('GET', '/reports/orders', ['reports.orders'], (u, _b, _m, q) => {
  const loc = (id: number) => db.locations.find((l: A) => l.id === id)?.name ?? ''
  const sets: [string, A[], (o: A) => string][] = [['inbound', db.inbound, (o) => loc(o.locationId)], ['transfer', db.transfers, (o) => `${loc(o.fromLocationId)} -> ${loc(o.toLocationId)}`], ['reserve', db.reserves, (o) => loc(o.locationId)], ['outbound', db.outbound, (o) => loc(o.locationId)]]
  const rows = sets.filter(([t]) => !q.type || q.type === t).flatMap(([t, all, l]) => all.filter((o) => (!q.status || o.status === q.status) && (!q.locationId || [o.locationId, o.fromLocationId, o.toLocationId].includes(+q.locationId))).map((o) => { const c = client(u, o.clientId) as A; const by = o.createdBy ?? o.enteredBy; return { Type: t, Number: o.id, Date: by.at, Status: o.status, Location: l(o), Client: c ? (c.revealed ? c.name : c.alias) : '', Lines: o.lines.length, Units: sum(o.lines), 'Created by': by.name } })).sort((a, b) => b.Date.localeCompare(a.Date))
  return q.format === 'csv' ? csv(rows) : rows
})
// ---- admin
R('GET', '/admin/logs', ['logs.view'], (_u, _b, _m, q) => { const all = db.logs.slice().reverse(); const o = +(q.offset ?? 0), l = +(q.limit ?? 50); return { total: all.length, items: all.slice(o, o + l) } })
R('GET', '/admin/logs/verify', ['logs.view'], () => ({ ok: true, checked: db.logs.length }))
R('GET', '/admin/settings', 'super', () => ({ auditEmails: db.settings.auditEmails, backupCron: '0 2 * * 0', backupKeep: 3, mfaRequired: false, smtpConfigured: false }))
R('PUT', '/admin/settings', 'super', (_u, b) => { db.settings.auditEmails = b.auditEmails; return { ok: true } })
R('GET', '/admin/outbox', 'super', () => db.outbox.slice().reverse())
R('GET', '/admin/backups', 'super', () => ({ cron: '0 2 * * 0', keep: 3, items: db.settings.backups ?? [] }))
R('POST', '/admin/backups', 'super', () => { const f = `wms-${now().replace(/[-:T]/g, '').slice(0, 14)}.db.enc`; db.settings.backups = [{ file: f, bytes: 48_000, createdAt: now() }, ...(db.settings.backups ?? [])].slice(0, 3); return { file: f, bytes: 48_000 } })

export async function demoHandle(method: string, fullPath: string, body: A): Promise<unknown> {
  db ??= load()
  await new Promise((r) => setTimeout(r, 120)) // feel like a network call
  const path = fullPath.split('?')[0], q = qs(fullPath)
  if (method === 'POST' && path === '/auth/login') {
    const u = db.users.find((x: A) => x.email.toLowerCase() === String(body.email).toLowerCase())
    if (!u || !u.active || u.password !== body.password) throw err(401, 'Invalid email or password')
    sessionStorage.setItem('wms-demo-user', String(u.id)); u.lastLoginAt = now(); log(u, 'auth.login'); save(); return { user: pub(u), csrf: 'demo' }
  }
  for (const [m, re, perm, h] of routes) {
    const match = m === method ? path.match(re) : null; if (!match) continue
    const u = db.users.find((x: A) => x.id === curId() && x.active)
    if (!u) throw err(401, 'Authentication required')
    if (u.mustChangePassword && !['/auth/me', '/auth/password', '/auth/logout'].includes(path)) throw err(403, 'Password change required', 'password_change_required')
    if (perm === 'super' ? u.role !== 'super_admin' : perm && !can(u, ...perm)) throw err(403, 'You do not have permission to do this')
    const out = h(u, body ?? {}, match, q); save(); return JSON.parse(JSON.stringify(out ?? null))
  }
  throw err(404, 'Not found')
}
