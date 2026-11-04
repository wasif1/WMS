// The "simple one-page screen" switch for warehouse staff.
import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { login, PW, setup } from './helpers.js'

describe('simple one-page screen flag', () => {
  it('a super admin turns it on/off per user; /me reports it; everyone else keeps the full app', async () => {
    const { app, mk } = setup(); await mk('boss@x.com', 'super_admin')
    const boss = await login(app, 'boss@x.com')
    const made = await boss.call('post', '/api/users', { name: 'Omar', email: 'omar@x.com', role: 'user', permissions: ['inbound.create', 'products.view'], simpleScreen: true })
    expect(made.status).toBe(201); expect(made.body.user.simpleScreen).toBe(true)
    const plain = await boss.call('post', '/api/users', { name: 'Pat', email: 'pat@x.com', role: 'user', permissions: ['dashboard.view'] })
    expect(plain.body.user.simpleScreen).toBe(false)
    // sign in as the temp-password user is gated, so flip the password flag for the check
    const users = (await boss.call('get', '/api/users')).body as any[]
    expect(users.find((u) => u.email === 'omar@x.com').simpleScreen).toBe(true); expect(users.find((u) => u.email === 'pat@x.com').simpleScreen).toBe(false)
    const off = await boss.call('patch', `/api/users/${made.body.user.id}`, { simpleScreen: false }); expect(off.body.simpleScreen).toBe(false)
    expect((await boss.call('patch', `/api/users/${made.body.user.id}`, { simpleScreen: true })).body.simpleScreen).toBe(true)
  })
  it('/me exposes the flag to the signed-in operator', async () => {
    const { app, mk } = setup(); await mk('op@x.com', 'user', ['inbound.create'], { simpleScreen: true })
    const op = await login(app, 'op@x.com')
    expect((await op.call('get', '/api/auth/me')).body.user).toMatchObject({ simpleScreen: true, role: 'user' })
  })
  it('super admins can never be locked into the simple screen, and a user cannot switch it themselves', async () => {
    const { app, mk } = setup(); await mk('boss@x.com', 'super_admin'); const u = await mk('op@x.com', 'user', ['inbound.create'], { simpleScreen: true }); await mk('legacy@x.com', 'super_admin', [], { simpleScreen: true })
    const boss = await login(app, 'boss@x.com'); const op = await login(app, 'op@x.com'); const legacy = await login(app, 'legacy@x.com')
    expect((await legacy.call('get', '/api/auth/me')).body.user.simpleScreen).toBe(false) // even if the data says true
    const mine = await op.call('patch', `/api/users/${u.id}`, { simpleScreen: false }); expect(mine.status).toBe(403) // only super admins manage users
    const promote = await boss.call('patch', `/api/users/${u.id}`, { role: 'super_admin' }); expect(promote.body.simpleScreen).toBe(false)
    expect((await boss.call('post', '/api/users', { name: 'X', email: 'x@x.com', role: 'user', permissions: [], simpleScreen: 'yes' })).body.fields[0].message).toMatch(/Simple Screen must be yes or no/i)
    void request; void PW
  })
})
