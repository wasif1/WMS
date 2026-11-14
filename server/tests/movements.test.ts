// Product detail: "In Transit" per location, and "Action by" in the movement history.
import { describe, expect, it } from 'vitest'
import { login, setup } from './helpers.js'

async function world() {
  const w = setup()
  await w.mk('owner@x.com', 'super_admin', [], { name: 'Olivia Owner' })
  await w.mk('team@x.com', 'user', ['products.view', 'adjustments.create', 'adjustments.view', 'audits.create', 'audits.count', 'audits.view', 'transfers.create', 'transfers.view', 'transfers.receive', 'locations.view', 'inbound.create', 'inbound.view'], { name: 'Tariq Team' })
  const owner = await login(w.app, 'owner@x.com'); const team = await login(w.app, 'team@x.com')
  const A = (await owner.call('post', '/api/locations', { name: 'Karachi Main' })).body.id
  const B = (await owner.call('post', '/api/locations', { name: 'Dubai Port' })).body.id
  const p = (await owner.call('post', '/api/products', { name: 'Steel Wire Roll', caseSize: 10 })).body
  const inb = (await team.call('post', '/api/inbound', { locationId: A, lines: [{ productId: p.id, loose: 50 }] })).body
  await owner.call('post', `/api/inbound/${inb.id}/approve`, {})
  const ov = async (qs = '') => (await owner.call('get', `/api/products/${p.id}/overview${qs}`)).body
  return { ...w, owner, team, A, B, p, ov }
}

describe('In Transit column (Availability by location)', () => {
  it('is 0 everywhere until something is on the way', async () => {
    const { ov } = await world()
    const o = await ov()
    expect(o.byLocation.every((r: any) => r.inTransit === 0)).toBe(true); expect(o.totals.inTransit).toBe(0)
  })

  it('shows the units at the destination while in transit (even with no stock there yet), and clears on receipt', async () => {
    const { owner, team, A, B, p, ov } = await world()
    const t = (await team.call('post', '/api/transfers', { fromLocationId: A, toLocationId: B, lines: [{ productId: p.id, loose: 20 }] })).body
    expect((await ov()).totals.inTransit).toBe(0) // a draft has not left yet
    await team.call('post', `/api/transfers/${t.id}/submit`)
    const o = await ov(); const dest = o.byLocation.find((r: any) => r.locationId === B); const src = o.byLocation.find((r: any) => r.locationId === A)
    expect(dest).toMatchObject({ location: 'Dubai Port', onHand: 0, inTransit: 20, inTransitFrom: ['Karachi Main'] })
    expect(src).toMatchObject({ onHand: 30, inTransit: 0 })
    expect(o.totals.inTransit).toBe(20)
    await owner.call('post', `/api/transfers/${t.id}/receive`, {})
    const after = await ov(); const d2 = after.byLocation.find((r: any) => r.locationId === B)
    expect(d2).toMatchObject({ onHand: 20, inTransit: 0, inTransitFrom: [] }); expect(after.totals.inTransit).toBe(0)
  })

  it('adds several transfers together and ignores other products', async () => {
    const { owner, team, A, B, p, ov } = await world()
    const other = (await owner.call('post', '/api/products', { name: 'Other' })).body
    const inb = (await team.call('post', '/api/inbound', { locationId: A, lines: [{ productId: other.id, loose: 9 }] })).body
    await owner.call('post', `/api/inbound/${inb.id}/approve`, {})
    for (const [pid, q] of [[p.id, 5], [p.id, 7], [other.id, 4]] as const) {
      const t = (await team.call('post', '/api/transfers', { fromLocationId: A, toLocationId: B, lines: [{ productId: pid, loose: q }] })).body
      await team.call('post', `/api/transfers/${t.id}/submit`)
    }
    expect((await ov()).byLocation.find((r: any) => r.locationId === B).inTransit).toBe(12)
  })
})

describe('Action by column (Movement history)', () => {
  it('names who entered the inbound, who requested an adjustment and who submitted an audit, apart from who approved', async () => {
    const { owner, team, A, p, ov } = await world()
    const adj = (await team.call('post', '/api/adjustments', { productId: p.id, locationId: A, newQty: 60, reason: 'Found' })).body
    await owner.call('post', `/api/approvals/adjustment/${adj.id}/approve`, {})
    const a = (await team.call('post', '/api/audits', { locationId: A, name: 'Nov count' })).body
    await team.call('put', `/api/audits/${a.id}/counts`, { counts: [{ productId: p.id, locationId: A, counted: 55 }] })
    await team.call('post', `/api/audits/${a.id}/submit`)
    await owner.call('post', `/api/approvals/audit/${a.id}/approve`, {})
    const m = (await ov()).movements
    const by = (type: string) => m.find((x: any) => x.type === type)
    expect(by('inbound')).toMatchObject({ actionBy: 'Tariq Team', user: 'Olivia Owner' })
    expect(by('adjustment')).toMatchObject({ actionBy: 'Tariq Team', user: 'Olivia Owner' })
    expect(by('audit')).toMatchObject({ actionBy: 'Tariq Team', user: 'Olivia Owner', refName: 'Nov count' })
  })

  it('transfers: sender on the way out, receiver on the way in', async () => {
    const { owner, team, A, B, p, ov } = await world()
    const t = (await team.call('post', '/api/transfers', { fromLocationId: A, toLocationId: B, lines: [{ productId: p.id, loose: 10 }] })).body
    await team.call('post', `/api/transfers/${t.id}/submit`); await owner.call('post', `/api/transfers/${t.id}/receive`, {})
    const m = (await ov()).movements
    expect(m.find((x: any) => x.type === 'transfer_out').actionBy).toBe('Tariq Team')
    expect(m.find((x: any) => x.type === 'transfer_in').actionBy).toBe('Olivia Owner')
  })

  it('every movement has someone named (falls back to the user who posted it)', async () => {
    const { ov } = await world()
    expect((await ov()).movements.every((x: any) => typeof x.actionBy === 'string' && x.actionBy.length > 0)).toBe(true)
  })
})
