// Location access: a super admin can limit a person to chosen locations; everything is enforced on the server.
import { describe, expect, it } from 'vitest'
import { login, setup } from './helpers.js'

const OPS = ['dashboard.view', 'products.view', 'products.create', 'locations.view', 'locations.manage', 'inbound.view', 'inbound.create', 'inbound.approve', 'transfers.view', 'transfers.create', 'transfers.receive', 'reserves.view', 'reserves.create', 'reserves.convert', 'outbound.view', 'outbound.create', 'outbound.confirm', 'adjustments.view', 'adjustments.create', 'audits.view', 'audits.create', 'audits.count', 'reports.inventory', 'reports.orders', 'clients.view', 'approvals.manage']

async function world() {
  const w = setup()
  await w.mk('super@x.com', 'super_admin')
  const sup = await login(w.app, 'super@x.com')
  const K = (await sup.call('post', '/api/locations', { name: 'Karachi' })).body.id as number
  const D = (await sup.call('post', '/api/locations', { name: 'Dubai' })).body.id as number
  const client = (await sup.call('post', '/api/clients', { name: 'Acme' })).body.id as number
  const p = (await sup.call('post', '/api/products', { name: 'Roll' })).body
  const stock = async (loc: number, qty: number) => { const i = (await sup.call('post', '/api/inbound', { locationId: loc, lines: [{ productId: p.id, loose: qty }] })).body; await sup.call('post', `/api/inbound/${i.id}/approve`, {}) }
  await stock(K, 50); await stock(D, 30)
  // create people through the real users API (as the super admin would from the screen)
  const mkUser = async (email: string, extra: object) => { const r = await sup.call('post', '/api/users', { name: email.split('@')[0], email, role: 'user', permissions: OPS, ...extra }); if (r.status !== 201) throw new Error(JSON.stringify(r.body)); await w.db.users.update(r.body.user.id, { ...(w.db.users.get(r.body.user.id) as any), mustChangePassword: false, passwordHash: (w.db.users.get(sup ? 1 : 1) as any).passwordHash }); return r.body.user }
  const opK = await mkUser('opk@x.com', { locationIds: [K] }); const opD = await mkUser('opd@x.com', { locationIds: [D] })
  const none = await mkUser('none@x.com', { locationIds: [] }); const legacy = await mkUser('legacy@x.com', {})
  const as = (email: string) => login(w.app, email, 'Correct-Horse-9-Battery')
  return { ...w, sup, K, D, p, client, stock, opK, opD, none, legacy, as }
}

describe('users API: giving location access', () => {
  it('saves the list, shows it back, validates the ids, and only a super admin can change it', async () => {
    const { sup, K, D, opK, as } = await world()
    expect(opK.locationIds).toEqual([K])
    const list = (await sup.call('get', '/api/users')).body as any[]
    expect(list.find((u) => u.email === 'legacy@x.com').locationIds).toBeUndefined() // older users: no restriction
    expect((await sup.call('patch', `/api/users/${opK.id}`, { locationIds: [K, D, D] })).body.locationIds).toEqual([K, D]) // duplicates dropped
    expect((await sup.call('patch', `/api/users/${opK.id}`, { locationIds: [9999] })).status).toBe(404)
    expect((await sup.call('post', '/api/users', { name: 'x', email: 'bad@x.com', role: 'user', permissions: [], locationIds: [-1] })).status).toBe(400)
    const k = await as('opk@x.com')
    expect((await k.call('patch', `/api/users/${opK.id}`, { locationIds: [K, D] })).status).toBe(403)
    expect((await k.call('get', '/api/auth/me')).body.user.locationIds).toEqual([K, D])
  })
  it('super admins are never restricted, whatever is stored', async () => {
    const { sup, K, w2 } = Object.assign(await world(), { w2: 0 }) as any
    const me = await sup.call('get', '/api/auth/me'); expect(me.body.user.locationIds).toBeUndefined()
    const made = await sup.call('post', '/api/users', { name: 'S2', email: 's2@x.com', role: 'super_admin', permissions: [], locationIds: [K] })
    expect(made.body.user.locationIds).toBeUndefined()
  })
})

describe('what a restricted person sees', () => {
  it('locations, stock, product page, reports and dashboard cover only their locations', async () => {
    const { sup, as, K, D, p } = await world()
    const k = await as('opk@x.com')
    expect((await k.call('get', '/api/locations')).body.map((l: any) => l.name)).toEqual(['Karachi'])
    expect((await k.call('get', '/api/locations/destinations')).body.map((l: any) => l.name).sort()).toEqual(['Dubai', 'Karachi']) // can still NAME a destination
    expect((await k.call('get', '/api/stock')).body.map((s: any) => s.locationId)).toEqual([K])
    expect((await k.call('get', `/api/stock?locationId=${D}`)).body).toEqual([])
    const ov = (await k.call('get', `/api/products/${p.id}/overview`)).body
    expect(ov.byLocation.map((r: any) => r.locationId)).toEqual([K]); expect(ov.totals.onHand).toBe(50)
    expect(ov.movements.every((m: any) => m.locationId === K)).toBe(true)
    expect((await k.call('get', `/api/products/${p.id}/overview?locationId=${D}`)).status).toBe(403)
    expect((await k.call('get', '/api/reports/inventory')).body.map((r: any) => r.Location)).toEqual(['Karachi'])
    const dash = (await k.call('get', '/api/dashboard')).body
    expect(dash.byLocation.map((b: any) => b.name)).toEqual(['Karachi']); expect(dash.kpis.inbound).toBe(1)
    const all = (await sup.call('get', '/api/dashboard')).body; expect(all.kpis.inbound).toBe(2); expect(all.byLocation).toHaveLength(2)
    expect((await sup.call('get', '/api/locations')).body).toHaveLength(2)
  })
  it('a person with an empty list sees nothing; an older user with no list sees everything', async () => {
    const { as } = await world()
    const n = await as('none@x.com'), l = await as('legacy@x.com')
    expect((await n.call('get', '/api/locations')).body).toEqual([]); expect((await n.call('get', '/api/stock')).body).toEqual([])
    expect((await l.call('get', '/api/locations')).body).toHaveLength(2); expect((await l.call('get', '/api/stock')).body).toHaveLength(2)
  })
  it('in-transit units show only at a location the person may see', async () => {
    const { sup, as, K, D, p } = await world()
    const t = (await sup.call('post', '/api/transfers', { fromLocationId: K, toLocationId: D, lines: [{ productId: p.id, loose: 5 }] })).body
    await sup.call('post', `/api/transfers/${t.id}/submit`)
    const k = await as('opk@x.com'), d = await as('opd@x.com')
    expect((await k.call('get', `/api/products/${p.id}/overview`)).body.totals.inTransit).toBe(0)
    expect((await d.call('get', `/api/products/${p.id}/overview`)).body.totals.inTransit).toBe(5)
  })
})

describe('what a restricted person can do', () => {
  it('inbound, reserve, outbound and adjustments only at their own locations', async () => {
    const { sup, as, K, D, p, client } = await world()
    const k = await as('opk@x.com')
    const line = [{ productId: p.id, loose: 2 }]
    const denied = async (r: any) => { const x = await r; expect(x.status).toBe(403); expect(x.body.code).toBe('location_denied') }
    await denied(k.call('post', '/api/inbound', { locationId: D, lines: line }))
    await denied(k.call('post', '/api/reserves', { locationId: D, lines: line }))
    await denied(k.call('post', '/api/outbound', { locationId: D, clientId: client, lines: line }))
    await denied(k.call('post', '/api/adjustments', { productId: p.id, locationId: D, newQty: 10, reason: 'recount' }))
    expect((await k.call('post', '/api/inbound', { locationId: K, lines: line })).status).toBe(201)
    expect((await k.call('post', '/api/reserves', { locationId: K, lines: line })).status).toBe(201)
    expect((await k.call('post', '/api/outbound', { locationId: K, clientId: client, lines: line })).status).toBe(201)
    expect((await k.call('post', '/api/adjustments', { productId: p.id, locationId: K, newQty: 60, reason: 'found' })).status).toBe(201)
    // lists hold only their own locations' orders
    await sup.call('post', '/api/inbound', { locationId: D, lines: line })
    expect(((await k.call('get', '/api/inbound')).body as any[]).every((o) => o.locationId === K)).toBe(true)
    expect(((await k.call('get', '/api/adjustments')).body as any[]).every((a) => a.locationId === K)).toBe(true)
  })

  it('cannot act on an order that belongs to another location, even by guessing its number', async () => {
    const { sup, as, D, p, client } = await world()
    const line = [{ productId: p.id, loose: 2 }]
    const ib = (await sup.call('post', '/api/inbound', { locationId: D, lines: line })).body
    const rs = (await sup.call('post', '/api/reserves', { locationId: D, clientId: client, lines: line })).body
    const ob = (await sup.call('post', '/api/outbound', { locationId: D, clientId: client, lines: line })).body
    const k = await as('opk@x.com')
    const attempts: (() => Promise<any>)[] = [
      () => k.call('post', `/api/inbound/${ib.id}/approve`, {}), () => k.call('post', `/api/inbound/${ib.id}/reject`, { comment: 'no' }),
      () => k.call('post', `/api/reserves/${rs.id}/cancel`, {}), () => k.call('post', `/api/reserves/${rs.id}/convert`, { actual: line }),
      () => k.call('get', `/api/outbound/${ob.id}`), () => k.call('put', `/api/outbound/${ob.id}`, { clientId: client, lines: line }),
      () => k.call('post', `/api/outbound/${ob.id}/confirm`, {}), () => k.call('post', `/api/outbound/${ob.id}/cancel`, {}),
    ]
    for (const go of attempts) expect((await go()).status).toBe(403)
    expect((await sup.call('get', `/api/outbound/${ob.id}`)).body.status).toBe('saved') // untouched
  })

  it('transfers: send from your own location, receive at your own; the destination can be anywhere', async () => {
    const { as, K, D, p } = await world()
    const k = await as('opk@x.com'), d = await as('opd@x.com')
    expect((await d.call('post', '/api/transfers', { fromLocationId: K, toLocationId: D, lines: [{ productId: p.id, loose: 5 }] })).status).toBe(403) // source is not theirs
    const t = (await k.call('post', '/api/transfers', { fromLocationId: K, toLocationId: D, lines: [{ productId: p.id, loose: 5 }] })).body
    expect((await d.call('post', `/api/transfers/${t.id}/submit`)).status).toBe(403) // only the source side sends
    expect((await k.call('post', `/api/transfers/${t.id}/submit`)).status).toBe(200)
    expect((await k.call('post', `/api/transfers/${t.id}/receive`, {})).status).toBe(403) // only the destination receives
    expect(((await d.call('get', '/api/transfers')).body as any[]).map((x) => x.id)).toEqual([t.id]) // both ends see it
    expect((await d.call('post', `/api/transfers/${t.id}/receive`, {})).status).toBe(200)
    const n = await as('none@x.com'); expect((await n.call('get', '/api/transfers')).body).toEqual([])
  })

  it('audits only cover their locations; audits covering other locations are out of reach', async () => {
    const { sup, as, K, p } = await world()
    const k = await as('opk@x.com')
    const mine = (await k.call('post', '/api/audits', { name: 'K audit' })).body // "all locations" -> only Karachi lines
    expect(mine.lines.every((l: any) => l.locationId === K)).toBe(true)
    const wide = (await sup.call('post', '/api/audits', { name: 'Everything' })).body // covers Karachi AND Dubai
    expect(wide.lines.length).toBeGreaterThan(mine.lines.length)
    expect(((await k.call('get', '/api/audits')).body as any[]).map((a) => a.name)).toEqual(['K audit'])
    expect((await k.call('get', `/api/audits/${wide.id}`)).status).toBe(404)
    expect((await k.call('put', `/api/audits/${wide.id}/counts`, { counts: [] })).status).toBe(404)
    expect((await k.call('post', `/api/audits/${wide.id}/submit`)).status).toBe(404)
    expect((await k.call('post', '/api/audits', { locationId: (await sup.call('get', '/api/locations')).body.find((l: any) => l.name === 'Dubai').id })).status).toBe(403)
    void p
  })

  it('approvals: a restricted approver only sees and decides requests for their own locations', async () => {
    const { sup, as, K, D, p, db } = await world()
    // a request at each location, made by the super admin acting as the team would (pending rows)
    const mk = async (loc: number) => (db.adjustments.insert({ productId: p.id, locationId: loc, newQty: 99, reason: 'r', before: 50, delta: 49, by: { userId: 1, name: 's', at: new Date().toISOString() }, status: 'pending' }) as any).id
    const aK = await mk(K), aD = await mk(D)
    const k = await as('opk@x.com') // holds approvals.manage but only Karachi
    const items = ((await k.call('get', '/api/approvals?type=adjustment')).body.items as any[]).map((i) => i.id)
    expect(items).toEqual([aK])
    expect((await k.call('post', `/api/approvals/adjustment/${aD}/approve`, {})).status).toBe(403)
    expect((await k.call('post', `/api/approvals/adjustment/${aK}/approve`, {})).status).toBe(200)
    expect(((await sup.call('get', '/api/approvals?type=adjustment&status=pending')).body.items as any[]).map((i) => i.id)).toEqual([aD])
  })

  it('editing a location is limited to the ones they may use', async () => {
    const { as, K, D } = await world()
    const k = await as('opk@x.com')
    expect((await k.call('put', `/api/locations/${D}`, { name: 'Dubai 2', address: '', active: true })).status).toBe(403)
    expect((await k.call('put', `/api/locations/${K}`, { name: 'Karachi 2', address: '', active: true })).status).toBe(200)
  })

  it('error text follows the language', async () => {
    const { as, D, p } = await world()
    const k = await as('opk@x.com')
    const r = await k.agent.post('/api/inbound').set('X-CSRF-Token', k.csrf).set('Accept-Language', 'ur').send({ locationId: D, lines: [{ productId: p.id, loose: 1 }] })
    expect(r.status).toBe(403); expect(r.body.error).toMatch(/[؀-ۿ]/)
  })
})
