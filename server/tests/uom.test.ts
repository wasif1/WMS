// Units of measure: built-ins plus units added by the super admin.
import { describe, expect, it } from 'vitest'
import { login, setup } from './helpers.js'

async function world() {
  const w = setup()
  await w.mk('super@x.com', 'super_admin')
  await w.mk('team@x.com', 'user', ['products.create', 'products.view', 'products.edit', 'inbound.create', 'inbound.view'])
  const sup = await login(w.app, 'super@x.com'); const team = await login(w.app, 'team@x.com')
  return { ...w, sup, team }
}

describe('Units of measure', () => {
  it('everyone signed in sees the four built-in units; anonymous users see nothing', async () => {
    const { team, app } = await world()
    const list = (await team.call('get', '/api/uoms')).body
    expect(list.map((u: any) => u.key)).toEqual(['unit', 'kg', 'm', 'bundle'])
    expect(list.every((u: any) => u.builtin)).toBe(true)
    expect((await (await import('supertest')).default(app).get('/api/uoms')).status).toBe(401)
  })

  it('only the super admin can add, rename or delete units', async () => {
    const { sup, team } = await world()
    expect((await team.call('post', '/api/uoms', { name: 'Litres', short: 'L', decimals: true })).status).toBe(403)
    const made = await sup.call('post', '/api/uoms', { name: 'Litres', short: 'L', decimals: true })
    expect(made.status).toBe(201); expect(made.body).toMatchObject({ key: 'litres', label: 'Litres', short: 'L', decimals: true, builtin: false })
    expect((await team.call('put', '/api/uoms/litres', { name: 'Liters', short: 'L' })).status).toBe(403)
    expect((await team.call('delete', '/api/uoms/litres')).status).toBe(403)
    expect((await sup.call('put', '/api/uoms/litres', { name: 'Liters', short: 'ltr' })).body).toMatchObject({ label: 'Liters', short: 'ltr', decimals: true })
    expect((await team.call('get', '/api/uoms')).body.map((u: any) => u.label)).toContain('Liters')
  })

  it('refuses duplicate names, built-in edits, bad input and keeps keys unique', async () => {
    const { sup } = await world()
    expect((await sup.call('post', '/api/uoms', { name: 'bundles', short: 'b' })).status).toBe(400) // same as built-in, any case
    expect((await sup.call('post', '/api/uoms', { name: '', short: 'x' })).status).toBe(400)
    expect((await sup.call('post', '/api/uoms', { name: 'Pairs', short: 'pr', extra: 1 })).status).toBe(400)
    await sup.call('post', '/api/uoms', { name: 'Pairs', short: 'pr' })
    expect((await sup.call('post', '/api/uoms', { name: 'PAIRS', short: 'pr' })).status).toBe(400)
    expect((await sup.call('put', '/api/uoms/kg', { name: 'Kilos', short: 'k' })).status).toBe(400)
    expect((await sup.call('delete', '/api/uoms/kg')).status).toBe(400)
    expect((await sup.call('delete', '/api/uoms/nope')).status).toBe(404)
    const a = (await sup.call('post', '/api/uoms', { name: 'Roll (big)', short: 'r' })).body.key
    const b = await sup.call('post', '/api/uoms', { name: 'Roll big', short: 'r' }) // different name, same slug
    expect(a).toBe('roll-big'); expect(b.status).toBe(201); expect(b.body.key).toBe('roll-big-2')
  })

  it('products can use a custom unit; unknown units are refused; decimals follow the unit', async () => {
    const { sup, team } = await world()
    expect((await team.call('post', '/api/products', { name: 'Paint', uom: 'litres' })).status).toBe(400) // not added yet
    await sup.call('post', '/api/uoms', { name: 'Litres', short: 'L', decimals: true })
    await sup.call('post', '/api/uoms', { name: 'Pairs', short: 'pr', decimals: false })
    const loc = (await sup.call('post', '/api/locations', { name: 'W1' })).body
    const paint = (await sup.call('post', '/api/products', { name: 'Paint', uom: 'litres' })).body
    const shoes = (await sup.call('post', '/api/products', { name: 'Shoes', uom: 'pairs' })).body
    expect(paint.uom).toBe('litres')
    expect((await sup.call('post', '/api/inbound', { locationId: loc.id, lines: [{ productId: paint.id, loose: 2.5 }] })).status).toBe(201)
    expect((await sup.call('post', '/api/inbound', { locationId: loc.id, lines: [{ productId: shoes.id, loose: 2.5 }] })).status).toBe(400)
    expect((await sup.call('post', '/api/inbound', { locationId: loc.id, lines: [{ productId: shoes.id, loose: 3 }] })).status).toBe(201)
    expect((await sup.call('put', `/api/products/${shoes.id}`, { uom: 'unknown' })).status).toBe(400)
  })

  it('a unit that products use cannot be deleted; an unused one can', async () => {
    const { sup } = await world()
    await sup.call('post', '/api/uoms', { name: 'Litres', short: 'L', decimals: true })
    await sup.call('post', '/api/uoms', { name: 'Pairs', short: 'pr' })
    await sup.call('post', '/api/products', { name: 'Paint', uom: 'litres' })
    const blocked = await sup.call('delete', '/api/uoms/litres')
    expect(blocked.status).toBe(400); expect(blocked.body.error).toMatch(/used by 1 product/)
    expect((await sup.call('delete', '/api/uoms/pairs')).status).toBe(204)
    expect((await sup.call('get', '/api/uoms')).body.map((u: any) => u.key)).not.toContain('pairs')
  })

  it('error messages follow the language', async () => {
    const { sup } = await world()
    const r = await sup.agent.post('/api/uoms').set('X-CSRF-Token', sup.csrf).set('Accept-Language', 'ur').send({ name: 'Kilos', short: 'k' })
    expect(r.status).toBe(201)
    const dup = await sup.agent.post('/api/uoms').set('X-CSRF-Token', sup.csrf).set('Accept-Language', 'ur').send({ name: 'kilos', short: 'k' })
    expect(dup.status).toBe(400); expect(dup.body.error).toMatch(/[؀-ۿ]/)
  })
})
