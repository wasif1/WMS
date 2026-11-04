// Regression tests for the NIQ review comments (one describe block per comment).
import { describe, expect, it } from 'vitest'
import { login, setup } from './helpers.js'

async function world() {
  const w = setup()
  await w.mk('owner@x.com', 'super_admin')
  await w.mk('team@x.com', 'user', ['products.create', 'products.view', 'locations.manage', 'locations.view', 'adjustments.create', 'adjustments.view', 'audits.create', 'audits.count', 'audits.view', 'inbound.create', 'inbound.view', 'dashboard.view', 'outbound.create', 'outbound.view', 'clients.view', 'reports.inventory'])
  const owner = await login(w.app, 'owner@x.com'); const team = await login(w.app, 'team@x.com')
  return { ...w, owner, team }
}
const prodBody = { name: 'Steel Wire Roll', color: 'Silver', size: 'M', weight: '1.5 kg', caseSize: 10, uom: 'kg' }

describe('2.2 Add product: no field mandatory, one weight field, flexible measuring', () => {
  it('accepts an empty product and any measuring unit; case pack is optional', async () => {
    const { owner } = await world()
    const empty = await owner.call('post', '/api/products', {})
    expect(empty.status).toBe(201); expect(empty.body.sku).toBe('PRD-0001'); expect(empty.body.caseSize).toBeUndefined()
    for (const uom of ['unit', 'kg', 'm', 'bundle']) expect((await owner.call('post', '/api/products', { name: 'P', uom })).status).toBe(201)
    expect((await owner.call('post', '/api/products', { name: 'P', uom: 'gallon' })).status).toBe(400)
  })
  it('rejects the old duplicate weight fields (unitWeightKg / boxWeightKg)', async () => {
    const { owner } = await world()
    expect((await owner.call('post', '/api/products', { name: 'P', unitWeightKg: 1 })).status).toBe(400)
    expect((await owner.call('post', '/api/products', { name: 'P', boxWeightKg: 1 })).status).toBe(400)
  })
  it('SKU is generated from name + colour + size + weight', async () => {
    const { owner } = await world()
    expect((await owner.call('post', '/api/products', prodBody)).body.sku).toBe('STE-SIL-M-15KG-0001')
  })
  it('loose-only products work: cases are refused when no case pack exists', async () => {
    const { owner, db } = await world()
    const p = (await owner.call('post', '/api/products', { name: 'Loose Cable', uom: 'm' })).body
    const loc = (await owner.call('post', '/api/locations', { name: 'W1' })).body
    expect((await owner.call('post', '/api/inbound', { locationId: loc.id, lines: [{ productId: p.id, cases: 2 }] })).status).toBe(400)
    const ok = await owner.call('post', '/api/inbound', { locationId: loc.id, lines: [{ productId: p.id, loose: 12.5 }] })
    expect(ok.status).toBe(201); expect(ok.body.lines[0].qty).toBe(12.5)
    expect(db.products.count()).toBeGreaterThan(0)
  })
})

describe('2.3 New product approval', () => {
  it('team submissions stay hidden until the owner approves; owner submissions are live immediately', async () => {
    const { owner, team } = await world()
    const sub = await team.call('post', '/api/products', prodBody)
    expect(sub.body.status).toBe('pending')
    expect((await team.call('get', '/api/products')).body).toHaveLength(0)
    expect((await owner.call('get', '/api/products')).body).toHaveLength(0) // pending is not in the Products list for anyone
    expect((await team.call('get', `/api/products/${sub.body.id}/overview`)).status).toBe(404)
    const loc = (await owner.call('post', '/api/locations', { name: 'W1' })).body
    expect((await owner.call('post', '/api/inbound', { locationId: loc.id, lines: [{ productId: sub.body.id, loose: 1 }] })).status).toBe(400) // cannot be used
    const ap = await owner.call('post', `/api/approvals/product/${sub.body.id}/approve`, {})
    expect(ap.status).toBe(200); expect(ap.body.status).toBe('approved')
    expect((await team.call('get', '/api/products')).body).toHaveLength(1)
    const own = await owner.call('post', '/api/products', { name: 'Owner item' })
    expect(own.body.status).toBe('approved'); expect((await team.call('get', '/api/products')).body).toHaveLength(2)
  })
  it('rejected products never appear and cannot be approved later', async () => {
    const { owner, team } = await world()
    const sub = (await team.call('post', '/api/products', prodBody)).body
    expect((await owner.call('post', `/api/approvals/product/${sub.id}/reject`, {})).status).toBe(400) // reason required
    expect((await owner.call('post', `/api/approvals/product/${sub.id}/reject`, { comment: 'duplicate' })).body.status).toBe('rejected')
    expect((await owner.call('get', '/api/products')).body).toHaveLength(0)
    expect((await owner.call('post', `/api/approvals/product/${sub.id}/approve`, {})).status).toBe(409)
  })
  it('the team cannot approve, and cannot inject a status when submitting', async () => {
    const { team } = await world()
    expect((await team.call('post', '/api/products', { ...prodBody, status: 'approved' })).status).toBe(400)
    const sub = (await team.call('post', '/api/products', prodBody)).body
    expect((await team.call('post', `/api/approvals/product/${sub.id}/approve`, {})).status).toBe(403)
  })
})

describe('3.1 Locations need owner approval', () => {
  it('a requested location is unusable until approved', async () => {
    const { owner, team } = await world()
    const req = (await team.call('post', '/api/locations', { name: 'New Depot' })).body
    expect(req.status).toBe('pending')
    expect((await team.call('get', '/api/locations')).body).toHaveLength(0)
    expect((await owner.call('post', '/api/transfers', { fromLocationId: req.id, toLocationId: req.id, lines: [] })).status).toBe(400)
    expect((await team.call('post', '/api/audits', { locationId: req.id })).status).toBe(404)
    await owner.call('post', `/api/approvals/location/${req.id}/approve`, {})
    expect((await team.call('get', '/api/locations')).body.map((l: any) => l.name)).toEqual(['New Depot'])
  })
  it('duplicate names are refused even while pending', async () => {
    const { team } = await world()
    await team.call('post', '/api/locations', { name: 'Depot' })
    expect((await team.call('post', '/api/locations', { name: 'depot' })).status).toBe(409)
  })
})

describe('4 / 6 Adjustments and audits need owner approval', () => {
  async function stocked() {
    const w = await world()
    const loc = (await w.owner.call('post', '/api/locations', { name: 'W1' })).body
    const p = (await w.owner.call('post', '/api/products', { name: 'Cotton T-Shirt', color: 'Black', size: 'L', caseSize: 24 })).body
    const inb = (await w.owner.call('post', '/api/inbound', { locationId: loc.id, lines: [{ productId: p.id, loose: 50 }] })).body
    await w.owner.call('post', `/api/inbound/${inb.id}/approve`, {})
    const on = async () => ((await w.owner.call('get', `/api/stock?locationId=${loc.id}`)).body as any[])[0].onHand
    return { ...w, loc, p, on }
  }
  it('an adjustment request changes nothing until approved, then applies the requested change', async () => {
    const { owner, team, loc, p, on } = await stocked()
    const r = await team.call('post', '/api/adjustments', { productId: p.id, locationId: loc.id, newQty: 60, reason: 'Missing items found' })
    expect(r.body).toMatchObject({ status: 'pending', delta: 10, before: 50 })
    expect(await on()).toBe(50)
    await owner.call('post', `/api/approvals/adjustment/${r.body.id}/approve`, {})
    expect(await on()).toBe(60)
    expect((await owner.call('post', `/api/approvals/adjustment/${r.body.id}/approve`, {})).status).toBe(409) // no double-apply
    expect(await on()).toBe(60)
  })
  it('a rejected adjustment never touches stock', async () => {
    const { owner, team, loc, p, on } = await stocked()
    const r = (await team.call('post', '/api/adjustments', { productId: p.id, locationId: loc.id, newQty: 0, reason: 'write off' })).body
    await owner.call('post', `/api/approvals/adjustment/${r.id}/reject`, { comment: 'Not justified' })
    expect(await on()).toBe(50)
    expect((await team.call('get', '/api/adjustments')).body[0]).toMatchObject({ status: 'rejected', decisionComment: 'Not justified' })
  })
  it('approval applies the CHANGE, so stock movements made in between are kept', async () => {
    const { owner, team, loc, p, on } = await stocked()
    const r = (await team.call('post', '/api/adjustments', { productId: p.id, locationId: loc.id, newQty: 40, reason: 'damaged' })).body // -10
    const inb = (await owner.call('post', '/api/inbound', { locationId: loc.id, lines: [{ productId: p.id, loose: 100 }] })).body
    await owner.call('post', `/api/inbound/${inb.id}/approve`, {})
    await owner.call('post', `/api/approvals/adjustment/${r.id}/approve`, {})
    expect(await on()).toBe(140)
  })
  it('audit: submit -> owner sees counted vs system -> approve applies; reject changes nothing', async () => {
    const { owner, team, loc, on } = await stocked()
    const a = (await team.call('post', '/api/audits', { locationId: loc.id, name: 'November count' })).body
    const line = a.lines[0]
    await team.call('put', `/api/audits/${a.id}/counts`, { counts: [{ productId: line.productId, locationId: loc.id, counted: 44 }] })
    expect((await team.call('post', `/api/audits/${a.id}/submit`)).body.status).toBe('submitted')
    expect((await team.call('put', `/api/audits/${a.id}/counts`, { counts: [] })).status).toBe(409) // locked after submit
    const list = (await owner.call('get', '/api/approvals?status=pending')).body
    expect(list.pending).toBe(1)
    expect(list.items[0].details.differences[0]).toMatchObject({ system: 50, counted: 44, delta: -6 })
    expect(await on()).toBe(50)
    expect((await team.call('post', `/api/approvals/audit/${a.id}/approve`, {})).status).toBe(403)
    await owner.call('post', `/api/approvals/audit/${a.id}/approve`, {})
    expect(await on()).toBe(44)
    // second audit, rejected
    const a2 = (await team.call('post', '/api/audits', { locationId: loc.id })).body
    await team.call('put', `/api/audits/${a2.id}/counts`, { counts: [{ productId: a2.lines[0].productId, locationId: loc.id, counted: 1 }] })
    await team.call('post', `/api/audits/${a2.id}/submit`)
    await owner.call('post', `/api/approvals/audit/${a2.id}/reject`, { comment: 'recount' })
    expect(await on()).toBe(44)
  })
  it('team members only see their own requests; the owner sees everything', async () => {
    const { owner, team, mk, app } = await stocked()
    await team.call('post', '/api/locations', { name: 'Mine' })
    await mk('other@x.com', 'user', ['locations.manage'])
    const other = await login(app, 'other@x.com')
    await other.call('post', '/api/locations', { name: 'Theirs' })
    expect((await team.call('get', '/api/approvals')).body.items.map((i: any) => i.title)).toEqual(['Mine'])
    expect((await owner.call('get', '/api/approvals?status=pending')).body.items.map((i: any) => i.title).sort()).toEqual(['Mine', 'Theirs'])
  })
})

describe('1 Dashboard: order data, top products by orders, no-sale insight, period filters', () => {
  async function busy() {
    const w = await world()
    const loc = (await w.owner.call('post', '/api/locations', { name: 'W1' })).body
    const sold = (await w.owner.call('post', '/api/products', { name: 'Sold Item', color: 'Red' })).body
    const idle = (await w.owner.call('post', '/api/products', { name: 'Idle Item', size: 'XL' })).body
    const inb = (await w.owner.call('post', '/api/inbound', { locationId: loc.id, lines: [{ productId: sold.id, loose: 100 }, { productId: idle.id, loose: 5 }] })).body
    await w.owner.call('post', `/api/inbound/${inb.id}/approve`, {})
    const cl = (await w.owner.call('post', '/api/clients', { name: 'Real Co' })).body
    for (let i = 0; i < 3; i++) { const o = (await w.owner.call('post', '/api/outbound', { locationId: loc.id, clientId: cl.id, lines: [{ productId: sold.id, loose: 5 }] })).body; if (i < 2) await w.owner.call('post', `/api/outbound/${o.id}/confirm`) }
    await w.owner.call('post', '/api/reserves', { locationId: loc.id, lines: [{ productId: sold.id, loose: 1 }] })
    return { ...w, loc, sold, idle }
  }
  it('cards are order counts (Inbound, Outbound, Reserved, Pending, Transfers, Completed), not units', async () => {
    const { owner } = await busy()
    const d = (await owner.call('get', '/api/dashboard?period=month')).body
    expect(d.kpis).toMatchObject({ inbound: 1, outbound: 3, reserved: 1, transfers: 0, completed: 3, pending: 1 }) // pending = 1 saved outbound
    for (const unitKey of ['totalOnHand', 'available', 'inTransit', 'lowStockCount']) expect(d.kpis[unitKey]).toBeUndefined()
    expect(d.pending).toMatchObject({ outboundToConfirm: 1, inboundApproval: 0 })
  })
  it('top products are ranked by number of orders and split by order type', async () => {
    const { owner } = await busy()
    const d = (await owner.call('get', '/api/dashboard')).body
    expect(d.topProducts[0]).toMatchObject({ name: 'Sold Item - Red', outbound: 3, reserved: 1, inbound: 1, total: 5 })
    expect(d.topProducts[1]).toMatchObject({ name: 'Idle Item - XL', total: 1 })
  })
  it('flags active products with no sales in the last 30 days', async () => {
    const { owner } = await busy()
    const d = (await owner.call('get', '/api/dashboard')).body
    expect(d.noSales.days).toBe(30)
    expect(d.noSales.items).toEqual([{ name: 'Idle Item - XL', unitsOnHand: 5, lastSale: null }])
  })
  it('weekly / monthly / yearly filters change the window and bucket size; bad periods are refused', async () => {
    const { owner } = await busy()
    const get = async (p: string) => (await owner.call('get', `/api/dashboard?period=${p}`)).body
    expect((await get('week')).trend).toHaveLength(7)
    expect((await get('month')).trend).toHaveLength(30)
    const y = await get('year'); expect(y.trend).toHaveLength(12); expect(y.trend[0].label).toMatch(/^\d{4}-\d{2}$/)
    expect(y.kpis.outbound).toBe(3)
    expect([400, 500]).toContain((await owner.call('get', '/api/dashboard?period=decade')).status)
  })
  it('old orders fall outside a shorter window', async () => {
    const { owner, db } = await busy()
    const o = (db.outbound_orders.all() as any[])[0]
    db.outbound_orders.update(o.id, { ...o, createdBy: { ...o.createdBy, at: new Date(Date.now() - 20 * 86_400_000).toISOString() } })
    expect((await owner.call('get', '/api/dashboard?period=week')).body.kpis.outbound).toBe(2)
    expect((await owner.call('get', '/api/dashboard?period=month')).body.kpis.outbound).toBe(3)
  })
})

describe('5 / 7 Product detail & movement history', () => {
  it('has no summary cards; availability by location carries units available and boxes; movements filter by location and name audits', async () => {
    const w = await world()
    const A = (await w.owner.call('post', '/api/locations', { name: 'Karachi Main' })).body, B = (await w.owner.call('post', '/api/locations', { name: 'AWT II' })).body
    const p = (await w.owner.call('post', '/api/products', { name: 'Steel Wire Roll', caseSize: 10 })).body
    const au = (await w.owner.call('post', '/api/audits', { name: 'Audit 20261104' })).body
    await w.owner.call('put', `/api/audits/${au.id}/counts`, { counts: au.lines.map((l: any) => ({ productId: l.productId, locationId: l.locationId, counted: l.locationId === A.id ? 15 : 10 })) })
    await w.owner.call('post', `/api/audits/${au.id}/submit`); await w.owner.call('post', `/api/approvals/audit/${au.id}/approve`, {})
    await w.owner.call('post', '/api/adjustments', { productId: p.id, locationId: A.id, newQty: 25, reason: 'Missing items found' })
    const ov = (await w.owner.call('get', `/api/products/${p.id}/overview`)).body
    expect(ov.totals).toMatchObject({ onHand: 35, available: 35, boxes: 4 })
    expect(ov.byLocation.find((l: any) => l.locationId === A.id)).toMatchObject({ onHand: 25, available: 25, boxes: 3 })
    expect(ov.movements.find((m: any) => m.type === 'audit').refLabel).toBe('Audit 20261104') // audit NAME, not "Audit #1"
    expect(ov.movements.map((m: any) => m.refLabel).join()).not.toMatch(/audit #/i)
    const onlyB = (await w.owner.call('get', `/api/products/${p.id}/overview?locationId=${B.id}`)).body
    expect(onlyB.movements).toHaveLength(1); expect(onlyB.movements[0].location).toBe('AWT II')
    expect(onlyB.byLocation).toHaveLength(2) // availability table is not filtered
  })
})

describe('Reports use the cleaned-up columns', () => {
  it('splits Variation (colour/size) from Weight', async () => {
    const w = await world()
    const loc = (await w.owner.call('post', '/api/locations', { name: 'W1' })).body
    const p = (await w.owner.call('post', '/api/products', { name: 'Tee', color: 'Black', size: 'L', weight: '200 g', caseSize: 24 })).body
    const inb = (await w.owner.call('post', '/api/inbound', { locationId: loc.id, lines: [{ productId: p.id, cases: 2 }] })).body
    await w.owner.call('post', `/api/inbound/${inb.id}/approve`, {})
    const rows = (await w.owner.call('get', '/api/reports/inventory')).body
    expect(rows[0]).toMatchObject({ Variation: 'Black · L', Weight: '200 g', 'Case pack': 24, 'On hand': 48, Boxes: 2 })
  })
})

describe('Regression: editing a product never resets fields it did not touch (zod defaults)', () => {
  it('toggling active keeps uom, case pack, reorder level, weight', async () => {
    const { owner } = await world()
    const p = (await owner.call('post', '/api/products', { name: 'Wire', uom: 'kg', weight: '1.5 kg', caseSize: 10, reorderLevel: 7 })).body
    const r = await owner.call('put', `/api/products/${p.id}`, { active: false })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ active: false, uom: 'kg', weight: '1.5 kg', caseSize: 10, reorderLevel: 7, name: 'Wire', sku: p.sku })
    const clear = await owner.call('put', `/api/products/${p.id}`, { caseSize: null })
    expect(clear.body.caseSize).toBeUndefined(); expect(clear.body.uom).toBe('kg')
  })
})
