import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { login, setup } from './helpers.js'
import { listBackups, runBackup, decryptFile } from '../src/backup.js'
import { config } from '../src/config.js'
import { openDb } from '../src/db.js'

async function world() {
  const w = setup()
  await w.mk('s@x.com', 'super_admin')
  const s = await login(w.app, 's@x.com')
  const loc = async (name: string) => (await s.call('post', '/api/locations', { name })).body.id as number
  const A = await loc('Warehouse A'), B = await loc('Warehouse B')
  const prod = (await s.call('post', '/api/products', { name: 'Widget', description: 'd', color: 'Red', weight: '500g', unitWeightKg: 0.5, boxWeightKg: 12, caseSize: 10, uom: 'unit', reorderLevel: 5 })).body
  const client = (await s.call('post', '/api/clients', { name: 'Real Customer Inc', contact: 'c', address: 'a' })).body
  const stockOf = async (l: number) => ((await s.call('get', `/api/stock?locationId=${l}`)).body as any[]).find((x) => x.productId === prod.id) ?? { onHand: 0, reserved: 0, available: 0 }
  const receive = async (qty: number, l = A) => {
    await w.mk(`ap${Math.random()}@x.com`, 'super_admin')
    const o = (await s.call('post', '/api/inbound', { locationId: l, lines: [{ productId: prod.id, loose: qty }] })).body
    return (await s.call('post', `/api/inbound/${o.id}/approve`, {})).body
  }
  return { ...w, s, A, B, prod, client, stockOf, receive }
}

describe('stock flows', () => {
  it('auto-generates SKUs and keeps them unique per variation', async () => {
    const { s, prod } = await world()
    expect(prod.sku).toMatch(/^WID-RED-500G-0001$/)
    const p2 = (await s.call('post', '/api/products', { name: 'Widget', description: '', color: 'Red', weight: '500g', unitWeightKg: 1, boxWeightKg: 1, caseSize: 1, uom: 'unit' })).body
    expect(p2.sku).toBe('WID-RED-500G-0002')
  })
  it('inbound -> reserve -> convert -> confirm updates every bucket correctly', async () => {
    const { s, A, prod, client, stockOf, receive, db } = await world()
    await receive(100)
    expect(await stockOf(A)).toMatchObject({ onHand: 100, reserved: 0, available: 100 })
    const rs = (await s.call('post', '/api/reserves', { locationId: A, clientId: client.id, lines: [{ productId: prod.id, cases: 3 }] })).body // 30 units
    expect(await stockOf(A)).toMatchObject({ onHand: 100, reserved: 30, available: 70 })
    // cannot over-reserve
    expect((await s.call('post', '/api/reserves', { locationId: A, lines: [{ productId: prod.id, loose: 71 }] })).status).toBe(409)
    // convert shipping 25 of the 30 -> difference needs a comment
    expect((await s.call('post', `/api/reserves/${rs.id}/convert`, { actual: [{ productId: prod.id, loose: 25 }] })).status).toBe(400)
    const cv = await s.call('post', `/api/reserves/${rs.id}/convert`, { actual: [{ productId: prod.id, loose: 25 }], comment: 'short picked' })
    expect(cv.status).toBe(200)
    expect(cv.body.reserve.lines[0]).toMatchObject({ qty: 30, actualQty: 25, difference: 5 })
    expect(await stockOf(A)).toMatchObject({ onHand: 100, reserved: 25, available: 75 })
    expect((await s.call('post', `/api/outbound/${cv.body.outbound.id}/confirm`)).status).toBe(200)
    expect(await stockOf(A)).toMatchObject({ onHand: 75, reserved: 0, available: 75 })
    expect((await s.call('post', `/api/outbound/${cv.body.outbound.id}/confirm`)).status).toBe(409) // no double ship
    expect(db.movements.count()).toBeGreaterThan(4)
    const ov = (await s.call('get', `/api/products/${prod.id}/overview`)).body
    expect(ov.totals).toMatchObject({ onHand: 75, reserved: 0, outboundTotal: 25 })
  })
  it('transfers move stock through "in transit" and log the receiver', async () => {
    const { s, A, B, prod, stockOf, receive } = await world()
    await receive(50)
    const t = (await s.call('post', '/api/transfers', { fromLocationId: A, toLocationId: B, lines: [{ productId: prod.id, loose: 20 }] })).body
    expect((await s.call('post', `/api/transfers/${t.id}/submit`)).status).toBe(200)
    expect(await stockOf(A)).toMatchObject({ onHand: 30 })
    const d = (await s.call('get', '/api/dashboard')).body
    expect(d.kpis.inTransit).toBe(20)
    const rc = await s.call('post', `/api/transfers/${t.id}/receive`, {})
    expect(rc.body.receivedBy).toMatchObject({ name: 's', location: 'Warehouse B' })
    expect(await stockOf(B)).toMatchObject({ onHand: 20 })
    expect((await s.call('get', '/api/dashboard')).body.kpis.inTransit).toBe(0)
  })
  it('outbound edit re-allocates, cancel releases, inbound needs a second approver', async () => {
    const { s, A, prod, client, stockOf, receive, mk, app } = await world()
    await receive(40)
    const o = (await s.call('post', '/api/outbound', { locationId: A, clientId: client.id, lines: [{ productId: prod.id, loose: 10 }] })).body
    expect((await s.call('put', `/api/outbound/${o.id}`, { clientId: client.id, lines: [{ productId: prod.id, loose: 25 }] })).status).toBe(200)
    expect(await stockOf(A)).toMatchObject({ reserved: 25 })
    await s.call('post', `/api/outbound/${o.id}/cancel`)
    expect(await stockOf(A)).toMatchObject({ reserved: 0, onHand: 40 })
    // segregation of duties for non-super users
    await mk('op@x.com', 'admin', ['inbound.create', 'inbound.approve', 'inbound.view'])
    const op = await login(app, 'op@x.com')
    const inb = (await op.call('post', '/api/inbound', { locationId: A, lines: [{ productId: prod.id, loose: 5 }] })).body
    expect((await op.call('post', `/api/inbound/${inb.id}/approve`, {})).status).toBe(403)
  })
  it('audit highlights differences and applies them only on confirm; adjustments are logged', async () => {
    const { s, A, prod, stockOf, receive } = await world()
    await receive(10)
    const a = (await s.call('post', '/api/audits', { locationId: A })).body
    expect((await s.call('post', `/api/audits/${a.id}/confirm`)).status).toBe(400) // uncounted lines
    await s.call('put', `/api/audits/${a.id}/counts`, { counts: [{ productId: prod.id, locationId: A, counted: 7 }] })
    expect(await stockOf(A)).toMatchObject({ onHand: 10 })
    const c = await s.call('post', `/api/audits/${a.id}/confirm`)
    expect(c.body.changes[0]).toMatchObject({ system: 10, counted: 7, delta: -3 })
    expect(await stockOf(A)).toMatchObject({ onHand: 7 })
    expect((await s.call('post', '/api/adjustments', { productId: prod.id, locationId: A, newQty: 9, reason: 'found box' })).status).toBe(201)
    expect(await stockOf(A)).toMatchObject({ onHand: 9 })
  })
})

describe('client anonymisation', () => {
  it('shows aliases to everyone and real data only with clients.reveal', async () => {
    const { s, client, A, prod, receive, mk, app } = await world()
    expect(client.alias).toBe('Client A')
    await receive(10)
    await s.call('post', '/api/outbound', { locationId: A, clientId: client.id, lines: [{ productId: prod.id, loose: 1 }] })
    await mk('v@x.com', 'admin', ['clients.view', 'outbound.view', 'reports.orders'])
    await mk('r@x.com', 'admin', ['clients.view', 'outbound.view', 'reports.orders', 'clients.reveal'])
    const v = await login(app, 'v@x.com'), r = await login(app, 'r@x.com')
    for (const url of ['/api/clients', '/api/outbound', '/api/reports/orders?format=csv']) {
      const body = JSON.stringify((await v.call('get', url)).body) + (await v.call('get', url)).text
      expect(body, url).not.toContain('Real Customer'); expect(body).toContain('Client A')
    }
    expect(JSON.stringify((await r.call('get', '/api/outbound')).body)).toContain('Real Customer Inc')
    expect((await r.call('get', '/api/reports/orders?format=csv')).text).toContain('Real Customer Inc')
  })
})

describe('audit log & backups', () => {
  it('chains log entries and detects tampering', async () => {
    const { s, ctx, db } = await world()
    expect(ctx.audit.verify().ok).toBe(true)
    const rows = db.audit_logs.all()
    const forged = { ...rows[1], action: 'nothing.happened' }
    db.audit_logs.update(rows[1].id, forged)
    expect(ctx.audit.verify()).toMatchObject({ ok: false, brokenAtId: rows[1].id })
    expect((await s.call('get', '/api/admin/logs/verify')).body.ok).toBe(false)
  })
  it('creates encrypted, verified backups and keeps only the newest 3', async () => {
    fs.rmSync(config.backupDir, { recursive: true, force: true })
    const { db, s } = await world()
    // file-based db so VACUUM INTO has data; in-memory also works for VACUUM INTO
    for (let i = 0; i < 5; i++) { await runBackup(db); await new Promise((r) => setTimeout(r, 1100)) }
    const files = listBackups()
    expect(files).toHaveLength(3)
    const raw = fs.readFileSync(`${config.backupDir}/${files[0].file}`)
    expect(raw.includes(Buffer.from('SQLite format'))).toBe(false)
    expect(raw.includes(Buffer.from('Warehouse A'))).toBe(false)
    const out = `${config.backupDir}/restored.db`
    await decryptFile(`${config.backupDir}/${files[0].file}`, out)
    const restored = openDb(out)
    expect(restored.locations.count()).toBe(2)
    // tampering is detected
    raw[40] ^= 0xff; fs.writeFileSync(`${config.backupDir}/${files[0].file}`, raw)
    await expect(decryptFile(`${config.backupDir}/${files[0].file}`, out + '2')).rejects.toThrow()
    expect((await s.call('get', '/api/admin/backups')).body.items.length).toBe(3)
  }, 60000)
})
