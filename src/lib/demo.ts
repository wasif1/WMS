/**
 * DEMO MODE ONLY (VITE_DEMO=true, used for the GitHub Pages build).
 * A tiny in-browser stand-in for the API so the UI can be tested on static hosting.
 * Data is fake, lives in this browser's localStorage, and is NOT encrypted - the real server is in /server.
 */
import { ALL_KEYS, PERMISSIONS } from '../../server/src/permissions'
import { ApiError } from './api'
import { BUILTIN_UOMS } from './uomList'
import { T, list, render, statusWord, type Msg } from '../../server/src/i18n/index'
import { getLang, t } from '@/i18n'

const KEY = 'wms-demo-db-v4', DEMO_PW = 'Demo-Passw0rd-2026'
type A = any
const now = () => new Date().toISOString()
/** Same message templates (and Urdu dictionary) as the real server, so the demo speaks both languages too. */
const rm = (m: Msg | string) => (typeof m === 'string' ? m : render(m, getLang()))
const err = (s: number, m: Msg | string, code?: string, fields?: { field: string; message: Msg | string }[]) => new ApiError(s, rm(m), code, fields?.map((f) => ({ field: f.field, message: rm(f.message) })))
const r3 = (n: number) => Math.round(n * 1000) / 1000

function seed(): A {
  const db: A = { seq: {}, users: [], locations: [], products: [], clients: [], stock: [], movements: [], inbound: [], transfers: [], reserves: [], outbound: [], adjustments: [], audits: [], logs: [], outbox: [], settings: { auditEmails: [] } }
  const id = (k: string) => (db.seq[k] = (db.seq[k] ?? 0) + 1)
  db.id = id
  const user = (name: string, email: string, role: string, permissions: string[], simpleScreen = false) => db.users.push({ id: id('u'), name, email, role, permissions, simpleScreen, password: DEMO_PW, active: true, mustChangePassword: false, totpEnabled: false, createdAt: now() })
  user('Sara Admin', 'super@demo.test', 'super_admin', [])
  user('Dana Dashboard', 'dashboard@demo.test', 'user', ['dashboard.view'])
  user('Omar Operator', 'operator@demo.test', 'user', ['dashboard.view', 'products.view', 'products.create', 'locations.view', 'locations.manage', 'inbound.view', 'inbound.create', 'transfers.view', 'transfers.create', 'transfers.receive', 'reserves.view', 'reserves.create', 'outbound.view', 'outbound.create', 'adjustments.view', 'adjustments.create', 'audits.view', 'audits.create', 'audits.count', 'clients.view', 'reports.inventory'], true)
  user('Tara Team', 'team@demo.test', 'user', ['dashboard.view', 'products.view', 'products.create', 'locations.view', 'locations.manage', 'inbound.view', 'inbound.create', 'transfers.view', 'transfers.create', 'transfers.receive', 'reserves.view', 'reserves.create', 'outbound.view', 'outbound.create', 'adjustments.view', 'adjustments.create', 'audits.view', 'audits.create', 'audits.count', 'clients.view', 'reports.inventory'])
  user('Mia Manager', 'manager@demo.test', 'admin', ['dashboard.view', 'products.view', 'products.create', 'products.edit', 'inbound.view', 'inbound.approve', 'outbound.view', 'outbound.confirm', 'reports.inventory', 'reports.orders', 'clients.view', 'clients.reveal', 'locations.view', 'adjustments.view', 'audits.view'])
  user('Olivia Owner', 'owner@demo.test', 'admin', ['approvals.manage', 'dashboard.view', 'products.view', 'products.create', 'products.edit', 'locations.view', 'locations.manage', 'adjustments.view', 'adjustments.create', 'audits.view', 'audits.create', 'audits.count', 'reports.inventory', 'reports.orders', 'clients.view'])
  const a = { userId: 1, name: 'Sara Admin', at: now() }
  const live = { status: 'approved', submittedBy: a, decidedBy: a }
  for (const n of ['Karachi Main', 'Lahore Hub', 'Dubai Port']) db.locations.push({ id: id('l'), name: n, address: n + ' Industrial Area', active: true, ...live })
  // name, colour, size, weight, details, case pack (0 = loose), measured in
  const specs: [string, string, string, string, string, number, string][] = [
    ['Cotton T-Shirt', 'White', 'M', '', 'Plain cotton tee', 24, 'unit'], ['Cotton T-Shirt', 'Black', 'L', '', 'Plain cotton tee', 24, 'unit'], ['Basmati Rice', '', '', '5 kg', 'Premium long grain', 4, 'unit'],
    ['Olive Oil', '', '', '1 L', 'Extra virgin', 12, 'unit'], ['Steel Wire Roll', 'Silver', '', '1.5 kg', 'Galvanised wire', 0, 'kg'], ['LED Bulb', 'Warm', '', '9 W', 'Energy saver', 50, 'unit'],
  ]
  for (const [name, color, size, weight, description, caseSize, uom] of specs) db.products.push({ id: id('p'), sku: skuBase(name, color, size, weight, db) , name, description, color: color || undefined, size: size || undefined, weight: weight || undefined, caseSize: caseSize || undefined, uom, reorderLevel: 100, active: true, createdAt: now(), ...live })
  ;['Acme Retail Ltd', 'Blue Star Traders', 'Harbor Foods'].forEach((name, i) => db.clients.push({ id: id('c'), alias: `Client ${'ABC'[i]}`, name, contact: 'contact@example.test', address: 'Somewhere' }))
  let s = 7; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647
  for (const l of db.locations) for (const p of db.products) db.stock.push({ productId: p.id, locationId: l.id, onHand: Math.round(120 + rnd() * 900), reserved: 0 })
  const st = (p: number, l: number) => db.stock.find((x: A) => x.productId === p && x.locationId === l)
  st(1, 1).reserved = 50
  for (const x of db.stock) db.movements.push({ id: db.id('m'), productId: x.productId, locationId: x.locationId, type: 'inbound', onHandDelta: x.onHand, reservedDelta: 0, onHandAfter: x.onHand, userId: 1, note: 'Opening stock', at: new Date(Date.now() - 45 * 864e5).toISOString() })
  // some order history so the dashboard has something to show
  const ago = (d: number) => new Date(Date.now() - d * 864e5).toISOString()
  const who = (d: number, n = 'Sara Admin', uid = 1) => ({ userId: uid, name: n, at: ago(d) })
  db.reserves.push({ id: id('r'), locationId: 1, clientId: 1, note: 'Spring campaign', lines: [{ productId: 1, cases: 0, loose: 50, qty: 50 }], status: 'active', createdBy: who(1) })
  db.inbound.push({ id: id('i'), locationId: 2, reference: 'MSKU-123456', notifyEmails: [], lines: [{ productId: 4, cases: 10, loose: 0, qty: 120 }], status: 'pending', comments: [], enteredBy: who(0, 'Omar Operator', 3) })
  const hist: [number, number, number, number][] = [[1, 1, 12, 3], [2, 2, 5, 9], [3, 1, 30, 2], [1, 3, 8, 18], [2, 1, 3, 25], [6, 2, 40, 6], [1, 1, 20, 40], [4, 2, 6, 90]]
  for (const [pid, loc, qty, days] of hist) { db.outbound.push({ id: id('o'), locationId: loc, clientId: 1 + (pid % 3), note: '', lines: [{ productId: pid, cases: 0, loose: qty, qty }], status: 'confirmed', createdBy: who(days), confirmedBy: who(days) }); db.inbound.push({ id: id('i'), locationId: loc, reference: `PL-${days}`, notifyEmails: [], lines: [{ productId: pid, cases: 0, loose: qty * 4, qty: qty * 4 }], status: 'approved', comments: [], enteredBy: who(days + 1, 'Omar Operator', 3), decidedBy: who(days) }) }
  db.transfers.push({ id: id('t'), fromLocationId: 1, toLocationId: 2, note: '', lines: [{ productId: 3, cases: 0, loose: 10, qty: 10 }], status: 'received', createdBy: who(7), receivedBy: { ...who(6), locationId: 2, location: 'Lahore Hub' } })
  // pending owner approvals so the approval workflow can be tried straight away
  const op = who(0, 'Omar Operator', 3)
  db.products.push({ id: id('p'), sku: 'COP-RED-2M-0001', name: 'Copper Cable', color: 'Red', size: '2 m', description: 'Submitted by the team', uom: 'm', reorderLevel: 0, active: true, createdAt: now(), status: 'pending', submittedBy: op })
  db.locations.push({ id: id('l'), name: 'AWT II', address: 'Awaiting owner approval', active: true, status: 'pending', submittedBy: op })
  db.adjustments.push({ id: id('a'), productId: 5, locationId: 1, newQty: st(5, 1).onHand + 10, reason: 'Missing items found', before: st(5, 1).onHand, delta: 10, by: op, status: 'pending' })
  return db
}

function skuBase(name: string, color: string, size: string, weight: string, db: A) {
  const al = (x: string, n: number) => x.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, n)
  const base = [al(name, 3).padEnd(3, 'X') === 'XXX' && !name ? 'PRD' : al(name, 3).padEnd(3, 'X'), color ? al(color, 3) : '', size ? al(size, 4) : '', weight ? al(weight, 5) : ''].filter(Boolean).join('-')
  const n = (db.seq['sku:' + base] = (db.seq['sku:' + base] ?? 0) + 1)
  return `${base}-${String(n).padStart(4, '0')}`
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
const pub = (u: A) => ({ id: u.id, name: u.name, email: u.email, role: u.role, active: u.active, simpleScreen: u.role !== 'super_admin' && !!u.simpleScreen, language: u.language, permissions: effective(u), mustChangePassword: !!u.mustChangePassword, totpEnabled: !!u.totpEnabled, mfaSetupRequired: false, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt, locked: false })
const can = (u: A, ...p: string[]) => u.role === 'super_admin' || p.some((x) => u.permissions.includes(x))
const log = (u: A, action: string, detail = '') => db.logs.push({ id: db.id('log'), at: now(), userName: u?.name ?? 'anonymous', action, detail, ip: 'demo' })

const stockRow = (p: number, l: number) => { let s = db.stock.find((x: A) => x.productId === p && x.locationId === l); if (!s) { s = { productId: p, locationId: l, onHand: 0, reserved: 0 }; db.stock.push(s) } return s }
const names = (p: number, l: number) => ({ product: plabel(db.products.find((x: A) => x.id === p)), location: db.locations.find((x: A) => x.id === l)?.name ?? '' })
function apply(p: number, l: number, d: { onHand?: number; reserved?: number }, m: { type: string; userId: number; refType?: string; refId?: number; note?: string }) {
  const s = stockRow(p, l); const onHand = r3(s.onHand + (d.onHand ?? 0)), reserved = r3(s.reserved + (d.reserved ?? 0))
  if (onHand < 0) throw err(409, T('Not enough stock: {product} at {location} has only {onHand} on hand, but {needed} is needed.', { ...names(p, l), onHand: s.onHand, needed: Math.abs(d.onHand ?? 0) }), 'insufficient_stock')
  if (reserved < 0) throw err(409, T('This would release more than is reserved for {product} at {location}. Refresh the page and try again.', names(p, l)), 'stock_changed')
  if (reserved > onHand) throw err(409, T('Not enough available stock: {product} at {location} has {available} available right now ({reserved} of {onHand} is already reserved).', { ...names(p, l), available: r3(s.onHand - s.reserved), reserved: s.reserved, onHand: s.onHand }), 'insufficient_stock')
  s.onHand = onHand; s.reserved = reserved
  db.movements.push({ id: db.id('m'), productId: p, locationId: l, type: m.type, onHandDelta: d.onHand ?? 0, reservedDelta: d.reserved ?? 0, onHandAfter: onHand, refType: m.refType, refId: m.refId, userId: m.userId, note: m.note, at: now() })
}
function build(input: A[], zero = false) {
  if (!input?.length) throw err(400, 'Add at least one product before saving.')
  return input.map((l) => {
    const p = db.products.find((x: A) => x.id === l.productId); if (!p) throw err(404, T('{what} could not be found. It may have been removed - refresh the page and try again.', { what: T('One of the products') }), 'not_found')
    if (!approved(p)) throw err(400, T('{product} is still waiting for owner approval, so it cannot be used yet.', { product: plabel(p) }))
    if ((l.cases ?? 0) > 0 && !p.caseSize) throw err(400, T('{product} has no case pack, so enter the amount under "Loose units" instead of cases.', { product: plabel(p) }))
    const qty = r3((l.cases ?? 0) * (p.caseSize ?? 0) + (l.loose ?? 0))
    if (qty < 0 || (qty === 0 && !zero)) throw err(400, T('Enter a quantity greater than zero for {product}.', { product: plabel(p) }))
    if (!(uomsAll().find((u) => u.key === p.uom)?.decimals ?? false) && (!Number.isInteger(qty) || !Number.isInteger(l.cases ?? 0))) throw err(400, T('{product} is counted in whole numbers - remove the decimals.', { product: plabel(p) }))
    return { productId: p.id, cases: l.cases ?? 0, loose: l.loose ?? 0, qty }
  })
}
const actor = (u: A) => ({ userId: u.id, name: u.name, at: now() })
const approved = (x: A) => (x.status ?? 'approved') === 'approved'
const isOwner = (u: A) => can(u, 'approvals.manage')
const submission = (u: A) => (isOwner(u) ? { status: 'approved', submittedBy: actor(u), decidedBy: actor(u) } : { status: 'pending', submittedBy: actor(u) })
const variation = (p: A) => [p.color, p.size].filter(Boolean).join(' · ')
const plabel = (p: A) => [p?.name || p?.sku || 'Unnamed product', p ? variation(p) : ''].filter(Boolean).join(' - ')
const client = (u: A, id?: number) => { const c = db.clients.find((x: A) => x.id === id); if (!c) return null; return can(u, 'clients.reveal') ? { ...c, revealed: true } : { id: c.id, alias: c.alias, revealed: false } }
const wc = (u: A, o: A) => ({ ...o, client: o.clientId ? client(u, o.clientId) : null })
const sku = (id: number) => plabel(db.products.find((p: A) => p.id === id))
const mail = (to: string[], subject: string) => db.outbox.push({ id: db.id('mail'), to, subject, at: now(), status: 'not_configured' })
const sum = (ls: A[]) => ls.reduce((a, l) => a + l.qty, 0)
const csv = (rows0: A[]) => {
  const lang = getLang()
  const word = (k: string, v: unknown) => (typeof v !== 'string' ? v : k === 'Status' ? render(statusWord(v), lang) : k === 'Type' ? render(T(v.charAt(0).toUpperCase() + v.slice(1)), lang) : k === 'UOM' ? render(T(v === 'unit' ? 'units' : v === 'bundle' ? 'bundles' : v), lang) : v)
  const rows = rows0.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [render(T(k), lang), word(k, v)])))
  return rows.length ? '\uFEFF' + [Object.keys(rows[0]).join(','), ...rows.map((r) => Object.values(r).map((v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : /^[=+\-@]/.test(s) ? "'" + s : s }).join(','))].join('\n') : ''
}
const qs = (path: string) => Object.fromEntries(new URLSearchParams(path.split('?')[1] ?? ''))

type H = (u: A, b: A, m: RegExpMatchArray, q: Record<string, string>) => unknown
const uomsAll = () => [...BUILTIN_UOMS, ...((db.settings.uoms ??= []) as A[]).map((u) => ({ ...u, builtin: false }))]
const badUom = (key: string) => err(400, T('"{unit}" is not a unit of measure you can use. Pick one from the list, or ask the super admin to add it.', { unit: key }), 'bad_uom')
const routes: [string, RegExp, string[] | 'super' | null, H][] = []
const R = (method: string, re: string, perm: string[] | 'super' | null, h: H) => routes.push([method, new RegExp(`^${re}$`), perm, h])
const find = (arr: A[], id: string, what: string) => { const x = arr.find((o) => o.id === Number(id)); if (!x) throw err(404, T('{what} could not be found. It may have been removed - refresh the page and try again.', { what: T(what) }), 'not_found'); return x }

// ---- auth
R('GET', '/auth/me', null, (u) => ({ user: pub(u), csrf: 'demo' }))
R('POST', '/auth/logout', null, () => { sessionStorage.removeItem('wms-demo-user'); return { ok: true } })
R('POST', '/auth/password', null, (u, b) => { if (b.currentPassword !== u.password) throw err(400, T('Your current password is incorrect.'), 'wrong_password', [{ field: 'currentPassword', message: T('Your current password is incorrect.') }]); if (String(b.newPassword).length < 12) throw err(400, T('Password must be at least 12 characters long.'), 'weak_password', [{ field: 'newPassword', message: T('Password must be at least 12 characters long.') }]); u.password = b.newPassword; u.mustChangePassword = false; return { ok: true } })
R('POST', '/auth/language', null, (u, b) => { if (!['en', 'ur'].includes(b.language)) throw err(400, T('{msg}.', { msg: T('{label} must be one of: {list}', { label: T('Language'), list: list(['en', 'ur'], ', ') }) }), 'validation'); u.language = b.language; return { ok: true, language: b.language } })
R('POST', '/auth/totp/setup', null, () => ({ secret: 'DEMOSECRETDEMOSECRET', otpauthUrl: 'otpauth://totp/WMS:demo?secret=DEMOSECRETDEMOSECRET&issuer=WMS' }))
R('POST', '/auth/totp/enable', null, () => { throw err(400, t('Two-factor is disabled in demo mode')) })
R('POST', '/auth/totp/disable', null, () => { throw err(400, t('Two-factor is disabled in demo mode')) })
// ---- users
R('GET', '/users/meta', 'super', () => ({ permissions: PERMISSIONS }))
R('GET', '/users', 'super', () => db.users.map(pub))
R('POST', '/users', 'super', (u, b) => {
  if (db.users.some((x: A) => x.email.toLowerCase() === String(b.email).toLowerCase())) throw err(409, T('A user with this email address already exists.'), 'duplicate', [{ field: 'email', message: T('This email is already in use.') }])
  const temp = `Temp-${Math.random().toString(36).slice(2, 10)}-${Math.floor(1000 + Math.random() * 9000)}`
  const n = { id: db.id('u'), name: b.name, email: b.email.toLowerCase(), role: b.role, permissions: b.role === 'super_admin' ? [] : b.permissions ?? [], simpleScreen: b.role !== 'super_admin' && !!b.simpleScreen, password: temp, active: true, mustChangePassword: true, createdAt: now() }
  db.users.push(n); log(u, 'user.create', n.email); return { user: pub(n), temporaryPassword: temp }
})
R('PATCH', '/users/(\\d+)', 'super', (u, b, m) => {
  const t = find(db.users, m[1], 'User'); const wasSuper = t.role === 'super_admin' && t.active
  const next = { ...t, ...(b.name !== undefined && { name: b.name }), ...(b.role && { role: b.role }), ...(b.permissions && { permissions: b.permissions }), ...(b.active !== undefined && { active: b.active }), ...(b.simpleScreen !== undefined && { simpleScreen: b.simpleScreen }) }
  if (wasSuper && (next.role !== 'super_admin' || !next.active) && db.users.filter((x: A) => x.role === 'super_admin' && x.active).length <= 1) throw err(400, T("You can't remove or disable the last active super admin. Make someone else a super admin first."))
  Object.assign(t, next); log(u, 'user.update', t.email); return pub(t)
})
R('POST', '/users/(\\d+)/reset-password', 'super', (u, _b, m) => { const t = find(db.users, m[1], 'User'); t.password = `Temp-${Math.random().toString(36).slice(2, 10)}-4821`; t.mustChangePassword = true; log(u, 'user.reset_password', t.email); return { temporaryPassword: t.password } })
R('POST', '/users/(\\d+)/(unlock|reset-mfa)', 'super', () => ({ ok: true }))
// ---- masters
const viewAny = ['dashboard.view', 'products.view', 'inbound.view', 'inbound.create', 'transfers.view', 'transfers.create', 'reserves.view', 'reserves.create', 'outbound.view', 'outbound.create', 'adjustments.view', 'adjustments.create', 'audits.view', 'audits.create', 'reports.inventory', 'reports.orders', 'locations.view', 'locations.manage']
R('GET', '/locations', viewAny, () => db.locations.filter(approved))
R('POST', '/locations', ['locations.manage'], (u, b) => {
  if (!b.name?.trim()) throw err(400, T('{msg}.', { msg: T('{label} is required', { label: T('Name') }) }), 'validation', [{ field: 'name', message: T('{label} is required', { label: T('Name') }) }])
  if (db.locations.some((l: A) => l.status !== 'rejected' && l.name.toLowerCase() === b.name.toLowerCase())) throw err(409, T('A location with this name already exists. Please use a different name.'), 'duplicate', [{ field: 'name', message: T('This name is already used.') }])
  const l = { id: db.id('l'), name: b.name, address: b.address ?? '', active: b.active ?? true, ...submission(u) }; db.locations.push(l); log(u, l.status === 'approved' ? 'location.create' : 'location.request', l.name); return l
})
R('PUT', '/locations/(\\d+)', ['locations.manage'], (u, b, m) => { const l = find(db.locations.filter(approved), m[1], 'Location'); Object.assign(l, { name: b.name, address: b.address ?? '', active: b.active }); log(u, 'location.update', l.name); return l })
R('GET', '/uoms', viewAny, () => uomsAll())
const uomText = (b: A) => {
  const name = String(b.name ?? '').trim(), short = String(b.short ?? '').trim()
  const need = (v: string, label: string, max: number) => { if (!v) throw err(400, T('{msg}.', { msg: T('{label} cannot be empty', { label: T(label) }) }), 'validation'); if (v.length > max) throw err(400, T('{msg}.', { msg: T('{label} must be at most {n} characters', { label: T(label), n: max }) }), 'validation') }
  need(name, 'Name', 40); need(short, 'Short name', 12); return { name, short }
}
const dupName = (name: string, except?: string) => uomsAll().some((u) => u.key !== except && u.label.toLowerCase() === name.toLowerCase())
R('POST', '/uoms', 'super', (u, b) => {
  const { name, short } = uomText(b)
  if (dupName(name)) throw err(400, T('A unit called "{name}" already exists.', { name }), 'duplicate')
  const base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'unit', taken = new Set(uomsAll().map((x) => x.key))
  let key = base, n = 2; while (taken.has(key)) key = `${base}-${n++}`
  const x = { key, label: name, short, decimals: !!b.decimals }; (db.settings.uoms ??= []).push(x); log(u, 'uom.create', name); return { ...x, builtin: false }
})
R('PUT', '/uoms/([^/]+)', 'super', (u, b, m) => {
  const cur = uomsAll().find((x) => x.key === m[1]); if (!cur) throw err(404, T('{what} could not be found. It may have been removed - refresh the page and try again.', { what: T('Unit') }), 'not_found')
  if (cur.builtin) throw err(400, T('The built-in units cannot be changed or deleted.'), 'builtin')
  const { name, short } = uomText(b); if (dupName(name, cur.key)) throw err(400, T('A unit called "{name}" already exists.', { name }), 'duplicate')
  Object.assign((db.settings.uoms as A[]).find((x) => x.key === cur.key), { label: name, short }); log(u, 'uom.update', name); return { ...cur, label: name, short }
})
R('DELETE', '/uoms/([^/]+)', 'super', (u, _b, m) => {
  const cur = uomsAll().find((x) => x.key === m[1]); if (!cur) throw err(404, T('{what} could not be found. It may have been removed - refresh the page and try again.', { what: T('Unit') }), 'not_found')
  if (cur.builtin) throw err(400, T('The built-in units cannot be changed or deleted.'), 'builtin')
  const used = db.products.filter((p: A) => p.uom === cur.key).length
  if (used) throw err(400, T('"{unit}" is used by {n} product(s), so it cannot be deleted. Change those products to another unit first.', { unit: cur.label, n: used }), 'in_use')
  db.settings.uoms = (db.settings.uoms as A[]).filter((x) => x.key !== cur.key); log(u, 'uom.delete', cur.label); return null
})
R('GET', '/products', viewAny, () => db.products.filter(approved))
R('POST', '/products', ['products.create'], (u, b) => {
  const bad = Object.keys(b).filter((k) => !['name', 'description', 'color', 'size', 'weight', 'caseSize', 'uom', 'reorderLevel'].includes(k)); if (bad.length) throw err(400, T('{msg}.', { msg: T('{label} contains fields that are not allowed ({list})', { label: T('Request'), list: list(bad, ', ') }) }), 'validation')
  if (b.uom && !uomsAll().some((u) => u.key === b.uom)) throw badUom(b.uom)
  const p = { id: db.id('p'), sku: skuBase(b.name ?? '', b.color ?? '', b.size ?? '', b.weight ?? '', db), name: b.name || undefined, description: b.description || undefined, color: b.color || undefined, size: b.size || undefined, weight: b.weight || undefined, caseSize: b.caseSize || undefined, uom: b.uom ?? 'unit', reorderLevel: b.reorderLevel ?? 0, active: true, createdAt: now(), ...submission(u) }
  db.products.push(p); log(u, p.status === 'approved' ? 'product.create' : 'product.request', p.sku); return p
})
R('PUT', '/products/(\\d+)', ['products.edit'], (u, b, m) => { const p = find(db.products.filter(approved), m[1], 'Product'); if (b.uom !== undefined && b.uom !== p.uom && !uomsAll().some((x) => x.key === b.uom)) throw badUom(b.uom); Object.assign(p, b, { sku: p.sku, caseSize: b.caseSize || undefined, name: b.name || undefined }); log(u, 'product.update', p.sku); return p })
const cv = ['clients.view', 'clients.manage', 'clients.reveal', 'reserves.create', 'outbound.create', 'reserves.view', 'outbound.view']
R('GET', '/clients', cv, (u) => db.clients.map((c: A) => client(u, c.id)))
R('POST', '/clients', ['clients.manage'], (u, b) => { const n = db.clients.length; const c = { id: db.id('c'), alias: `Client ${String.fromCharCode(65 + (n % 26))}${n >= 26 ? Math.floor(n / 26) : ''}`, name: b.name, contact: b.contact ?? '', address: b.address ?? '' }; db.clients.push(c); log(u, 'client.create', c.alias); return client(u, c.id) })
R('PUT', '/clients/(\\d+)', ['clients.manage'], (u, b, m) => { if (!can(u, 'clients.reveal')) throw err(403, T('Editing client details needs the "see real client details" permission. Ask a super admin to grant it.'), 'forbidden'); const c = find(db.clients, m[1], 'Client'); Object.assign(c, { name: b.name, contact: b.contact, address: b.address }); return client(u, c.id) })
// ---- stock
R('GET', '/stock', ['dashboard.view', 'products.view', 'inbound.view', 'transfers.create', 'reserves.create', 'outbound.create', 'adjustments.view', 'adjustments.create', 'audits.view', 'reports.inventory'], (_u, _b, _m, q) =>
  db.stock.filter((s: A) => (!q.locationId || s.locationId === +q.locationId) && (!q.productId || s.productId === +q.productId)).map((s: A) => ({ ...s, available: s.onHand - s.reserved })))
// ---- inbound
R('GET', '/inbound', ['inbound.view'], (_u, _b, _m, q) => db.inbound.filter((o: A) => !q.status || o.status === q.status).slice().reverse())
R('POST', '/inbound', ['inbound.create'], (u, b) => { const o = { id: db.id('i'), locationId: b.locationId, reference: b.reference ?? '', notifyEmails: b.notifyEmails ?? [], lines: build(b.lines), status: 'pending', comments: b.comments ? [{ by: u.name, at: now(), text: b.comments }] : [], enteredBy: actor(u) }; db.inbound.push(o); log(u, 'inbound.create', `#${o.id}`); return o })
R('POST', '/inbound/(\\d+)/approve', ['inbound.approve'], (u, b, m) => {
  const o = find(db.inbound, m[1], 'Inbound order'); if (o.status !== 'pending') throw err(409, T('This order was already {status}, possibly by someone else. Refresh the page to see the latest.', { status: statusWord(o.status) }), 'already_processed')
  if (o.enteredBy.userId === u.id && u.role !== 'super_admin') throw err(403, T('You entered this packing list, so someone else must approve it (separation of duties).'), 'separation_of_duties')
  const verified = b.verified ? build(b.verified, true) : o.lines
  const differs = o.lines.some((l: A) => (verified.find((v: A) => v.productId === l.productId)?.qty ?? 0) !== l.qty)
  if (differs && !b.comment) throw err(400, T('The verified quantities differ from the packing list. Please add a comment explaining why.'), 'validation', [{ field: 'comment', message: T('A comment is required when quantities differ.') }])
  for (const l of verified) if (l.qty > 0) apply(l.productId, o.locationId, { onHand: l.qty }, { type: 'inbound', userId: u.id, refType: 'inbound', refId: o.id })
  Object.assign(o, { status: 'approved', verified, decidedBy: actor(u) }); if (b.comment) o.comments.push({ by: u.name, at: now(), text: b.comment })
  mail([...o.notifyEmails, u.email], `Inbound #${o.id} approved`); log(u, 'inbound.approve', `#${o.id}`); return o
})
R('POST', '/inbound/(\\d+)/reject', ['inbound.approve'], (u, b, m) => { const o = find(db.inbound, m[1], 'Inbound order'); if (o.status !== 'pending') throw err(409, T('This order was already {status}, possibly by someone else. Refresh the page to see the latest.', { status: statusWord(o.status) }), 'already_processed'); Object.assign(o, { status: 'rejected', decidedBy: actor(u) }); o.comments.push({ by: u.name, at: now(), text: b.comment }); return o })
// ---- transfers
R('GET', '/transfers', ['transfers.view'], (_u, _b, _m, q) => db.transfers.filter((o: A) => !q.status || o.status === q.status).slice().reverse())
R('POST', '/transfers', ['transfers.create'], (u, b) => { if (b.fromLocationId === b.toLocationId) throw err(400, T("Choose two different locations - the source and destination can't be the same."), 'validation', [{ field: 'toLocationId', message: T('Pick a different destination.') }]); const o = { id: db.id('t'), fromLocationId: b.fromLocationId, toLocationId: b.toLocationId, note: b.note ?? '', lines: build(b.lines), status: 'draft', createdBy: actor(u) }; db.transfers.push(o); return o })
R('POST', '/transfers/(\\d+)/submit', ['transfers.create'], (u, _b, m) => { const o = find(db.transfers, m[1], 'Transfer order'); if (o.status !== 'draft') throw err(409, T('This order was already {status}, possibly by someone else. Refresh the page to see the latest.', { status: statusWord(o.status) }), 'already_processed'); for (const l of o.lines) apply(l.productId, o.fromLocationId, { onHand: -l.qty }, { type: 'transfer_out', userId: u.id, refType: 'transfer', refId: o.id }); Object.assign(o, { status: 'in_transit', submittedBy: actor(u) }); return o })
R('POST', '/transfers/(\\d+)/cancel', ['transfers.create'], (_u, _b, m) => { const o = find(db.transfers, m[1], 'Transfer order'); if (o.status !== 'draft') throw err(409, T('Only draft transfers can be cancelled. This one has already been sent.'), 'already_processed'); o.status = 'cancelled'; return o })
R('POST', '/transfers/(\\d+)/receive', ['transfers.receive'], (u, b, m) => {
  const o = find(db.transfers, m[1], 'Transfer order'); if (o.status !== 'in_transit') throw err(409, T('This transfer is {status}, so it cannot be received. Refresh the page to see the latest.', { status: statusWord(o.status) }), 'already_processed')
  const received = b.received ? build(b.received, true) : o.lines
  const discrepancy = o.lines.map((l: A) => ({ productId: l.productId, sent: l.qty, received: received.find((x: A) => x.productId === l.productId)?.qty ?? 0 })).filter((d: A) => d.sent !== d.received)
  if (discrepancy.length && !b.comment) throw err(400, T('The received quantities differ from what was sent. Please add a comment explaining why.'), 'validation', [{ field: 'comment', message: T('A comment is required when quantities differ.') }])
  for (const l of received) if (l.qty > 0) apply(l.productId, o.toLocationId, { onHand: l.qty }, { type: 'transfer_in', userId: u.id, refType: 'transfer', refId: o.id })
  Object.assign(o, { status: 'received', receivedLines: received, discrepancy, receivedBy: { ...actor(u), locationId: o.toLocationId, location: db.locations.find((l: A) => l.id === o.toLocationId)?.name } }); return o
})
// ---- reserves / outbound
const release = (o: A, uid: number, refType: string) => { for (const l of o.lines) apply(l.productId, o.locationId, { reserved: -l.qty }, { type: 'unreserve', userId: uid, refType, refId: o.id }) }
const allocate = (lines: A[], loc: number, uid: number, id: number) => { for (const l of lines) apply(l.productId, loc, { reserved: l.qty }, { type: 'reserve', userId: uid, refType: 'outbound', refId: id }) }
R('GET', '/reserves', ['reserves.view'], (u, _b, _m, q) => db.reserves.filter((o: A) => !q.status || o.status === q.status).slice().reverse().map((o: A) => wc(u, o)))
R('POST', '/reserves', ['reserves.create'], (u, b) => { const lines = build(b.lines); const o = { id: db.id('r'), locationId: b.locationId, clientId: b.clientId, note: b.note ?? '', lines, status: 'active', createdBy: actor(u) }; for (const l of lines) apply(l.productId, b.locationId, { reserved: l.qty }, { type: 'reserve', userId: u.id, refType: 'reserve', refId: o.id }); db.reserves.push(o); mail([u.email], `Reserve order #${o.id} placed`); return wc(u, o) })
R('POST', '/reserves/(\\d+)/cancel', ['reserves.convert'], (u, _b, m) => { const o = find(db.reserves, m[1], 'Reserve order'); if (o.status !== 'active') throw err(409, T('This order was already {status}, possibly by someone else. Refresh the page to see the latest.', { status: statusWord(o.status) }), 'already_processed'); release(o, u.id, 'reserve'); Object.assign(o, { status: 'cancelled', closedBy: actor(u) }); return wc(u, o) })
R('POST', '/reserves/(\\d+)/convert', ['reserves.convert', 'outbound.create'], (u, b, m) => {
  const o = find(db.reserves, m[1], 'Reserve order'); if (o.status !== 'active') throw err(409, T('This order was already {status}, possibly by someone else. Refresh the page to see the latest.', { status: statusWord(o.status) }), 'already_processed')
  if (!o.clientId) throw err(400, T('Choose a client for this reserve order before moving it to outbound.'), 'validation', [{ field: 'clientId', message: T('A client is required.') }])
  const actual = build(b.actual, true); const lines = o.lines.map((l: A) => { const a = actual.find((x: A) => x.productId === l.productId)?.qty ?? 0; return { ...l, actualQty: a, difference: l.qty - a } })
  const ship = actual.filter((a: A) => a.qty > 0); if (!ship.length) throw err(400, T('Every quantity is zero, so there is nothing to ship. Release the reservation instead.'))
  if (lines.some((l: A) => l.difference) && !b.comment) throw err(400, T('The quantities leaving differ from what was reserved. Please add a comment explaining why.'), 'validation', [{ field: 'comment', message: T('A comment is required when quantities differ.') }])
  release(o, u.id, 'reserve'); const ob = { id: db.id('o'), locationId: o.locationId, clientId: o.clientId, note: b.comment ?? '', lines: ship, status: 'saved', sourceReserveId: o.id, createdBy: actor(u) }
  allocate(ship, o.locationId, u.id, ob.id); db.outbound.push(ob); Object.assign(o, { lines, status: 'converted', outboundId: ob.id, closedBy: actor(u) }); return { reserve: wc(u, o), outbound: wc(u, ob) }
})
R('GET', '/outbound', ['outbound.view'], (u, _b, _m, q) => db.outbound.filter((o: A) => !q.status || o.status === q.status).slice().reverse().map((o: A) => wc(u, o)))
R('POST', '/outbound', ['outbound.create'], (u, b) => { const lines = build(b.lines); const o = { id: db.id('o'), locationId: b.locationId, clientId: b.clientId, note: b.note ?? '', lines, status: 'saved', createdBy: actor(u) }; allocate(lines, b.locationId, u.id, o.id); db.outbound.push(o); return wc(u, o) })
R('PUT', '/outbound/(\\d+)', ['outbound.create'], (u, b, m) => { const o = find(db.outbound, m[1], 'Outbound order'); if (o.status !== 'saved') throw err(409, T('Only saved orders can be edited. This one has already been confirmed or cancelled.'), 'already_processed'); const lines = build(b.lines); release(o, u.id, 'outbound'); allocate(lines, o.locationId, u.id, o.id); Object.assign(o, { clientId: b.clientId, note: b.note ?? '', lines }); return wc(u, o) })
R('POST', '/outbound/(\\d+)/confirm', ['outbound.confirm'], (u, _b, m) => { const o = find(db.outbound, m[1], 'Outbound order'); if (o.status !== 'saved') throw err(409, T('This order was already {status}, possibly by someone else. Refresh the page to see the latest.', { status: statusWord(o.status) }), 'already_processed'); for (const l of o.lines) apply(l.productId, o.locationId, { onHand: -l.qty, reserved: -l.qty }, { type: 'outbound', userId: u.id, refType: 'outbound', refId: o.id }); Object.assign(o, { status: 'confirmed', confirmedBy: actor(u) }); mail([u.email], `Outbound #${o.id} confirmed`); return wc(u, o) })
R('POST', '/outbound/(\\d+)/cancel', ['outbound.create'], (u, _b, m) => { const o = find(db.outbound, m[1], 'Outbound order'); if (o.status !== 'saved') throw err(409, T('This order was already {status}, possibly by someone else. Refresh the page to see the latest.', { status: statusWord(o.status) }), 'already_processed'); release(o, u.id, 'outbound'); Object.assign(o, { status: 'cancelled', closedBy: actor(u) }); return wc(u, o) })
// ---- adjustments / audits
R('GET', '/adjustments', ['adjustments.view'], () => db.adjustments.map((a: A) => ({ ...a, status: a.status ?? 'approved' })).reverse())
R('POST', '/adjustments', ['adjustments.create'], (u, b) => {
  const s = stockRow(b.productId, b.locationId); const delta = r3(b.newQty - s.onHand); if (!delta) throw err(400, T('That is the same as the current stock, so there is nothing to adjust.'), 'validation', [{ field: 'newQty', message: T('Enter a different quantity.') }]); if (String(b.reason ?? '').trim().length < 3) throw err(400, T('{msg}.', { msg: T('{label} must be at least {n} characters', { label: T('Reason'), n: 3 }) }), 'validation')
  if (b.newQty < s.reserved) throw err(409, T("Stock can't go below {reserved}, because that many units are already reserved here. Release the reservation first or enter {reserved} or more.", { reserved: s.reserved }), 'insufficient_stock')
  const sub = submission(u); const a = { id: db.id('a'), ...b, before: s.onHand, delta, by: sub.submittedBy, status: sub.status, decidedBy: (sub as A).decidedBy }
  if (sub.status === 'approved') apply(b.productId, b.locationId, { onHand: delta }, { type: 'adjustment', userId: u.id, refType: 'adjustment', refId: a.id, note: b.reason })
  db.adjustments.push(a); log(u, 'adjustment.request', `${sku(b.productId)} ${delta}`); return a
})
R('GET', '/audits', ['audits.view'], () => db.audits.slice().reverse().map((a: A) => ({ ...a, lines: undefined, lineCount: a.lines.length, diffCount: a.lines.filter((l: A) => l.counted != null && l.counted !== l.system).length })))
R('GET', '/audits/(\\d+)', ['audits.view'], (_u, _b, m) => find(db.audits, m[1], 'Audit'))
R('POST', '/audits', ['audits.create'], (u, b) => { const locs = db.locations.filter((l: A) => approved(l) && l.active && (!b.locationId || l.id === b.locationId)); const lines = locs.flatMap((l: A) => db.products.filter((p: A) => approved(p) && p.active).map((p: A) => ({ productId: p.id, locationId: l.id, system: stockRow(p.id, l.id).onHand, counted: null }))); const a = { id: db.id('au'), name: b.name || `${t('Audit')} ${now().slice(0, 10).replace(/-/g, '')}`, lines, status: 'counting', createdBy: actor(u) }; db.audits.push(a); return a })
R('PUT', '/audits/(\\d+)/counts', ['audits.count'], (_u, b, m) => { const a = find(db.audits, m[1], 'Audit'); if (a.status !== 'counting') throw err(409, T('This audit has already been submitted, so the counts can no longer be changed.'), 'already_processed'); for (const c of b.counts) { const l = a.lines.find((x: A) => x.productId === c.productId && x.locationId === c.locationId); if (l) l.counted = c.counted } return a })
R('POST', '/audits/(\\d+)/submit', ['audits.count'], (u, _b, m) => { const a = find(db.audits, m[1], 'Audit'); if (a.status !== 'counting') throw err(409, T('This audit was already submitted.'), 'already_processed'); if (a.lines.some((l: A) => l.counted == null)) throw err(400, T('Enter a physical count for every line before submitting. Lines with no count are still empty.')); Object.assign(a, { status: 'submitted', submittedBy: actor(u) }); return a })
// ---- owner approvals
const kinds: Record<string, A[]> = { product: [], location: [], adjustment: [], audit: [] }
const stores = () => ({ product: db.products, location: db.locations, adjustment: db.adjustments, audit: db.audits }) as Record<string, A[]>
const stOf = (k: string, o: A) => (k === 'audit' ? (o.status === 'submitted' ? 'pending' : o.status === 'counting' ? 'draft' : o.status) : o.status ?? 'approved')
const lname = (id: number) => db.locations.find((l: A) => l.id === id)?.name ?? `#${id}`
const presentA = (k: string, o: A) => {
  const base = { type: k, id: o.id, status: stOf(k, o), submittedBy: k === 'adjustment' ? o.by : o.submittedBy, decidedBy: o.decidedBy, decisionComment: o.decisionComment }
  if (k === 'product') return { ...base, title: plabel(o), details: { sku: o.sku, description: o.description, color: o.color, size: o.size, weight: o.weight, caseSize: o.caseSize, uom: o.uom } }
  if (k === 'location') return { ...base, title: o.name, details: { address: o.address } }
  if (k === 'adjustment') return { ...base, title: `${sku(o.productId)} @ ${lname(o.locationId)}`, details: { before: o.before, delta: o.delta, newQty: o.newQty, reason: o.reason } }
  const diffs = o.lines.filter((l: A) => l.counted != null && l.counted !== l.system).map((l: A) => ({ product: sku(l.productId), location: lname(l.locationId), system: l.system, counted: l.counted, delta: l.counted - l.system }))
  return { ...base, title: o.name, details: { differences: diffs, lineCount: o.lines.length } }
}
R('GET', '/approvals', ['approvals.manage', 'products.create', 'locations.manage', 'adjustments.create', 'audits.create', 'audits.count'], (u, _b, _m, q) => {
  const owner = isOwner(u); const out: A[] = []
  for (const k of Object.keys(kinds)) for (const o of stores()[k]) { const st = stOf(k, o); if (st === 'draft') continue; if (q.status && st !== q.status) continue; const by = (k === 'adjustment' ? o.by : o.submittedBy); if (!owner && by?.userId !== u.id) continue; out.push(presentA(k, o)) }
  out.sort((a, b) => String(b.submittedBy?.at).localeCompare(String(a.submittedBy?.at)))
  return { owner, pending: out.filter((o) => o.status === 'pending').length, items: out }
})
const decide = (approve: boolean): H => (u, b, m) => {
  const k = m[1]; const list = stores()[k]; if (!list) throw err(404, T('{what} could not be found. It may have been removed - refresh the page and try again.', { what: T('That kind of request') }), 'not_found')
  const o = find(list, m[2], 'Request'); if (stOf(k, o) !== 'pending') throw err(409, T('This request has already been decided. Refresh the page to see the latest.'), 'already_processed')
  if (!approve && !String(b.comment ?? '').trim()) throw err(400, T('{msg}.', { msg: T('{label} cannot be empty', { label: T('Comment') }) }), 'validation')
  if (approve && k === 'adjustment') apply(o.productId, o.locationId, { onHand: o.delta }, { type: 'adjustment', userId: u.id, refType: 'adjustment', refId: o.id, note: o.reason })
  if (approve && k === 'audit') { const ch: A[] = []; for (const l of o.lines) { const d = r3(l.counted - l.system); if (d) { apply(l.productId, l.locationId, { onHand: d }, { type: 'audit', userId: u.id, refType: 'audit', refId: o.id }); ch.push({ productId: l.productId, locationId: l.locationId, system: l.system, counted: l.counted, delta: d }) } } o.changes = ch; mail([u.email], `Inventory audit "${o.name}" approved`) }
  Object.assign(o, { status: approve ? 'approved' : 'rejected', decidedBy: actor(u), decisionComment: b.comment || undefined }); log(u, `${k}.${approve ? 'approve' : 'reject'}`, String(o.id)); return presentA(k, o)
}
R('POST', '/approvals/(product|location|adjustment|audit)/(\\d+)/approve', ['approvals.manage'], decide(true))
R('POST', '/approvals/(product|location|adjustment|audit)/(\\d+)/reject', ['approvals.manage'], decide(false))
// ---- insights
R('GET', '/dashboard', ['dashboard.view'], (_u, _b, _m, q) => {
  const period = (['week', 'month', 'year'].includes(q.period) ? q.period : 'month') as 'week' | 'month' | 'year'
  const DAY = 864e5, span = { week: 7, month: 30, year: 365 }[period], t0 = Date.now(), since = t0 - span * DAY
  const inW = (iso?: string, from = since) => !!iso && Date.parse(iso) >= from
  const rows: Record<string, A[]> = { inbound: db.inbound.filter((o: A) => o.status !== 'rejected'), outbound: db.outbound.filter((o: A) => o.status !== 'cancelled'), reserve: db.reserves.filter((o: A) => o.status !== 'cancelled'), transfer: db.transfers.filter((o: A) => o.status !== 'cancelled') }
  const created = (o: A) => (o.enteredBy ?? o.createdBy).at as string
  const win = (k: string) => rows[k].filter((o) => inW(created(o)))
  const completed = [...db.inbound.filter((o: A) => o.status === 'approved').map((o: A) => o.decidedBy?.at), ...db.transfers.filter((o: A) => o.status === 'received').map((o: A) => o.receivedBy?.at), ...db.outbound.filter((o: A) => o.status === 'confirmed').map((o: A) => o.confirmedBy?.at), ...db.reserves.filter((o: A) => o.status === 'converted').map((o: A) => o.closedBy?.at)].filter((x) => inW(x)).length
  const owner = [db.products, db.locations, db.adjustments].reduce((n: number, l: A[]) => n + l.filter((o) => o.status === 'pending').length, 0) + db.audits.filter((a: A) => a.status === 'submitted').length
  const pending = { inboundApproval: rows.inbound.filter((o) => o.status === 'pending').length, outboundToConfirm: rows.outbound.filter((o) => o.status === 'saved').length, transfersToSend: rows.transfer.filter((o) => o.status === 'draft').length, transfersToReceive: rows.transfer.filter((o) => o.status === 'in_transit').length, ownerApprovals: owner }
  const key = (iso: string) => (period === 'year' ? iso.slice(0, 7) : iso.slice(0, 10)); const trend: A[] = []
  if (period === 'year') { const d = new Date(t0); for (let i = 11; i >= 0; i--) trend.push({ label: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)).toISOString().slice(0, 7), inbound: 0, outbound: 0, transfers: 0, reserved: 0 }) }
  else for (let i = span - 1; i >= 0; i--) trend.push({ label: new Date(t0 - i * DAY).toISOString().slice(0, 10), inbound: 0, outbound: 0, transfers: 0, reserved: 0 })
  const bump = (k: string, list: A[]) => { for (const o of list) { const b = trend.find((x) => x.label === key(created(o))); if (b) b[k]++ } }
  bump('inbound', rows.inbound); bump('outbound', rows.outbound); bump('transfers', rows.transfer); bump('reserved', rows.reserve)
  const byLocation = db.locations.filter((l: A) => approved(l) && l.active).map((l: A) => ({ name: l.name, inbound: win('inbound').filter((o) => o.locationId === l.id).length, outbound: win('outbound').filter((o) => o.locationId === l.id).length, reserved: win('reserve').filter((o) => o.locationId === l.id).length, transfers: win('transfer').filter((o) => o.fromLocationId === l.id || o.toLocationId === l.id).length }))
  const tally = new Map<number, A>(); const add = (list: A[], k: string) => { for (const o of list) for (const l of o.lines) { const t = tally.get(l.productId) ?? { inbound: 0, outbound: 0, reserved: 0, transfers: 0 }; t[k]++; tally.set(l.productId, t) } }
  add(win('inbound'), 'inbound'); add(win('outbound'), 'outbound'); add(win('reserve'), 'reserved'); add(win('transfer'), 'transfers')
  const topProducts = [...tally.entries()].map(([id, t]) => ({ name: sku(id), ...t, total: t.inbound + t.outbound + t.reserved + t.transfers })).sort((a, b) => b.total - a.total).slice(0, 8)
  const since30 = t0 - 30 * DAY; const sold = new Set<number>(); const last = new Map<number, string>()
  for (const o of rows.outbound) for (const l of o.lines) { if (inW(created(o), since30)) sold.add(l.productId); if (!last.get(l.productId) || created(o) > last.get(l.productId)!) last.set(l.productId, created(o)) }
  const noSales = db.products.filter((p: A) => p.active && approved(p) && !sold.has(p.id)).map((p: A) => ({ name: plabel(p), unitsOnHand: db.stock.filter((s: A) => s.productId === p.id).reduce((a: number, s: A) => a + s.onHand, 0), lastSale: last.get(p.id) ?? null }))
  return { period, since: new Date(since).toISOString(), kpis: { inbound: win('inbound').length, outbound: win('outbound').length, reserved: win('reserve').length, transfers: win('transfer').length, pending: pending.inboundApproval + pending.outboundToConfirm + pending.transfersToSend + pending.ownerApprovals, completed, activeReserves: rows.reserve.filter((o) => o.status === 'active').length, transfersInTransit: pending.transfersToReceive }, pending, trend, byLocation, topProducts, noSales: { days: 30, total: noSales.length, items: noSales.slice(0, 10) } }
})
R('GET', '/products/(\\d+)/overview', ['products.view'], (_u, _b, m, q) => {
  const p = find(db.products.filter(approved), m[1], 'Product'); const L = (id: number) => db.locations.find((l: A) => l.id === id)?.name, U = (id: number) => db.users.find((u: A) => u.id === id)?.name
  const A = new Map<number, string>(db.audits.map((a: A) => [a.id, a.name])); const ref = (x: A) => (x.refType === 'audit' ? A.get(x.refId) : undefined)
  const rowsL = db.stock.filter((s: A) => s.productId === p.id).map((s: A) => ({ locationId: s.locationId, location: L(s.locationId), onHand: s.onHand, reserved: s.reserved, available: s.onHand - s.reserved, boxes: p.caseSize ? Math.ceil((s.onHand - s.reserved) / p.caseSize) : null }))
  const avail = rowsL.reduce((a: number, r: A) => a + r.available, 0)
  return { product: p, byLocation: rowsL, totals: { onHand: rowsL.reduce((a: number, r: A) => a + r.onHand, 0), reserved: rowsL.reduce((a: number, r: A) => a + r.reserved, 0), available: avail, boxes: p.caseSize ? Math.ceil(avail / p.caseSize) : null },
    movements: db.movements.filter((x: A) => x.productId === p.id && (!q.locationId || x.locationId === +q.locationId)).slice().reverse().slice(0, 200).map((x: A) => ({ ...x, location: L(x.locationId), user: U(x.userId), refName: ref(x) })) }
})
R('GET', '/reports/inventory', ['reports.inventory'], (_u, _b, _m, q) => {
  const rows = db.stock.filter((s: A) => !q.locationId || s.locationId === +q.locationId).map((s: A) => { const p = db.products.find((x: A) => x.id === s.productId); return { SKU: p.sku, Product: p.name ?? p.sku, Variation: variation(p), Weight: p.weight ?? '', Location: db.locations.find((l: A) => l.id === s.locationId)?.name, 'Case pack': p.caseSize ?? '', UOM: p.uom, 'On hand': s.onHand, Reserved: s.reserved, Available: s.onHand - s.reserved, Boxes: p.caseSize ? Math.ceil(s.onHand / p.caseSize) : '' } })
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
    if (!u || !u.active || u.password !== body.password) throw err(401, T('Incorrect email or password. For security, an account is locked for 15 minutes after 5 wrong attempts.'), 'invalid_credentials')
    sessionStorage.setItem('wms-demo-user', String(u.id)); u.lastLoginAt = now(); log(u, 'auth.login'); save(); return { user: pub(u), csrf: 'demo' }
  }
  for (const [m, re, perm, h] of routes) {
    const match = m === method ? path.match(re) : null; if (!match) continue
    const u = db.users.find((x: A) => x.id === curId() && x.active)
    if (!u) throw err(401, T('Please sign in to continue.'), 'unauthenticated')
    if (u.mustChangePassword && !['/auth/me', '/auth/password', '/auth/logout'].includes(path)) throw err(403, T('You must set a new password before you can continue.'), 'password_change_required')
    if (perm === 'super' ? u.role !== 'super_admin' : perm && !can(u, ...perm)) throw err(403, perm === 'super' ? T('Only a super admin can do this.') : T("You don't have permission to do this. Ask a super admin to grant you access."), perm === 'super' ? 'super_admin_only' : 'forbidden')
    const out = h(u, body ?? {}, match, q); save(); return JSON.parse(JSON.stringify(out ?? null))
  }
  throw err(404, T("That page or action doesn't exist."), 'not_found')
}
