// DEV ONLY: fills an empty database with demo data and users. Refuses to run in production.
import { openDb } from '../db.js'
import { isProd } from '../config.js'
import { blindIndex, hashPassword, randomToken } from '../crypto.js'
import { Inventory } from '../inventory.js'
import { skuFor } from '../routes/masters.js'
import { Audit } from '../audit.js'

if (isProd) { console.error('Refusing to seed demo data in production'); process.exit(1) }
const db = openDb()
if (db.products.count() > 0) { console.error('Database is not empty'); process.exit(1) }
const inv = new Inventory(db)
const now = () => new Date().toISOString()
const ctx = { db, mailer: null as any, audit: new Audit(db) } as any
const mkUser = async (name: string, email: string, role: any, permissions: string[]) => {
  const pw = process.env.WMS_DEMO_PASSWORD ?? randomToken(9) + '-42'
  const u = db.users.insert({ name, email, role, permissions, passwordHash: await hashPassword(pw), active: true, mustChangePassword: false, failedLogins: 0, createdAt: now() }, { email_idx: blindIndex(email, 'email') })
  console.log(`  ${role.padEnd(12)} ${email}  password: ${pw}`)
  return u
}
console.log('Demo users:')
const boss = await mkUser('Sara Admin', 'super@demo.test', 'super_admin', [])
await mkUser('Olivia Owner', 'owner@demo.test', 'admin', ['approvals.manage', 'dashboard.view', 'products.view', 'products.create', 'products.edit', 'locations.view', 'locations.manage', 'adjustments.view', 'adjustments.create', 'audits.view', 'audits.create', 'audits.count', 'reports.inventory', 'reports.orders', 'clients.view'])
await mkUser('Dana Dashboard', 'dashboard@demo.test', 'user', ['dashboard.view'])
await mkUser('Omar Operator', 'operator@demo.test', 'user', ['dashboard.view', 'products.view', 'inbound.view', 'inbound.create', 'transfers.view', 'transfers.create', 'transfers.receive', 'reserves.view', 'reserves.create', 'outbound.view', 'outbound.create', 'clients.view', 'products.create', 'locations.manage', 'locations.view', 'adjustments.view', 'adjustments.create', 'audits.view', 'audits.create', 'audits.count'])
await mkUser('Mia Manager', 'manager@demo.test', 'admin', ['dashboard.view', 'products.view', 'products.create', 'products.edit', 'inbound.view', 'inbound.approve', 'outbound.view', 'outbound.confirm', 'reports.inventory', 'reports.orders', 'clients.view', 'clients.reveal', 'locations.view', 'adjustments.view', 'audits.view'])

// name, colour, size, weight, details, case pack (0 = loose/none), measured in
const locs = ['Karachi Main', 'Lahore Hub', 'Dubai Port'].map((name) => db.locations.insert({ name, address: name + ' Industrial Area', active: true, createdAt: now(), status: 'approved' }))
const specs: [string, string, string, string, string, number, string][] = [
  ['Cotton T-Shirt', 'White', 'M', '', 'Plain cotton tee', 24, 'unit'], ['Cotton T-Shirt', 'Black', 'L', '', 'Plain cotton tee', 24, 'unit'], ['Basmati Rice', '', '', '5 kg', 'Premium long grain', 4, 'unit'],
  ['Olive Oil', '', '', '1 L', 'Extra virgin', 12, 'unit'], ['Steel Wire Roll', 'Silver', '', '1.5 kg', 'Galvanised wire', 0, 'kg'], ['LED Bulb', 'Warm', '', '9 W', 'Energy saver', 50, 'unit'],
]
const stamp = { status: 'approved', submittedBy: { userId: boss.id, name: boss.name, at: now() }, decidedBy: { userId: boss.id, name: boss.name, at: now() } }
const prods = specs.map(([name, color, size, weight, description, caseSize, uom]) => {
  const sku = skuFor(ctx, { name, color: color || undefined, size: size || undefined, weight: weight || undefined })
  return db.products.insert({ sku, name, description, color: color || undefined, size: size || undefined, weight: weight || undefined, caseSize: caseSize || undefined, uom, reorderLevel: 100, active: true, createdAt: now(), ...stamp }, { sku_idx: blindIndex(sku, 'sku') })
})
const clients = ['Acme Retail Ltd', 'Blue Star Traders', 'Harbor Foods'].map((name, i) => db.clients.insert({ name, contact: 'contact@example.test', address: 'Somewhere', alias: `Client ${'ABC'[i]}`, createdAt: now() }))
db.settings.insert({ n: 3 }, { key_idx: blindIndex('counter', 'clientseq') })
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
for (const l of locs) for (const p of prods) inv.apply(p.id, l.id, { onHand: Math.round(120 + rnd() * 900) }, { type: 'inbound', userId: boss.id, refType: 'inbound', note: 'seed' })
inv.apply(prods[2].id, locs[1].id, { onHand: -inv.getStock(prods[2].id, locs[1].id).onHand + 60 }, { type: 'adjustment', userId: boss.id, note: 'seed' })
inv.apply(prods[0].id, locs[0].id, { reserved: 50 }, { type: 'reserve', userId: boss.id, refType: 'reserve', refId: 1 })
const a = { userId: boss.id, name: boss.name, at: now() }
db.reserve_orders.insert({ locationId: locs[0].id, clientId: clients[0].id, note: 'seed', lines: [{ productId: prods[0].id, cases: 0, loose: 50, qty: 50 }], status: 'active', createdBy: a })
db.inbound_orders.insert({ locationId: locs[1].id, reference: 'MSKU-123456', notifyEmails: [], lines: [{ productId: prods[3].id, cases: 10, loose: 0, qty: 120 }], status: 'pending', comments: [], enteredBy: { ...a, name: 'Omar Operator' } })
console.log('Demo data created.')
