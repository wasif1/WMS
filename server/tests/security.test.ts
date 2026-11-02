import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { login, PW, setup } from './helpers.js'
import { newTotpSecret, totpNow, encrypt, decrypt } from '../src/crypto.js'

describe('authentication & session security', () => {
  it('rejects unauthenticated access and sets hardened headers/cookies', async () => {
    const { app, mk } = setup()
    await mk('a@x.com', 'super_admin')
    expect((await request(app).get('/api/products')).status).toBe(401)
    const r = await request(app).post('/api/auth/login').send({ email: 'a@x.com', password: PW })
    const cookie = String(r.headers['set-cookie'])
    expect(cookie).toMatch(/HttpOnly/i); expect(cookie).toMatch(/SameSite=Strict/i)
    expect(r.headers['x-powered-by']).toBeUndefined()
    expect(r.headers['content-security-policy']).toContain("default-src 'self'")
    expect(r.headers['strict-transport-security']).toBeTruthy()
  })
  it('gives identical errors for unknown user and wrong password, and locks after 5 failures', async () => {
    const { app, mk } = setup()
    await mk('a@x.com', 'user')
    const bad1 = await request(app).post('/api/auth/login').send({ email: 'nobody@x.com', password: 'wrong-password-1' })
    const bad2 = await request(app).post('/api/auth/login').send({ email: 'a@x.com', password: 'wrong-password-1' })
    expect(bad1.status).toBe(401); expect(bad1.body).toEqual(bad2.body)
    for (let i = 0; i < 4; i++) await request(app).post('/api/auth/login').send({ email: 'a@x.com', password: 'wrong-password-1' })
    const locked = await request(app).post('/api/auth/login').send({ email: 'a@x.com', password: PW })
    expect(locked.status).toBe(401) // correct password still refused while locked
  })
  it('requires a CSRF token and a matching Origin on state-changing requests', async () => {
    const { app, mk } = setup()
    await mk('a@x.com', 'super_admin')
    const { agent, csrf } = await login(app, 'a@x.com')
    expect((await agent.post('/api/locations').send({ name: 'W1' })).status).toBe(403)
    expect((await agent.post('/api/locations').set('X-CSRF-Token', 'x'.repeat(32)).send({ name: 'W1' })).status).toBe(403)
    expect((await agent.post('/api/locations').set('X-CSRF-Token', csrf).set('Origin', 'https://evil.example').send({ name: 'W1' })).status).toBe(403)
    expect((await agent.post('/api/locations').set('X-CSRF-Token', csrf).send({ name: 'W1' })).status).toBe(201)
  })
  it('blocks all other routes until a forced password change is done', async () => {
    const { app, mk } = setup()
    await mk('a@x.com', 'super_admin', [], { mustChangePassword: true })
    const { call } = await login(app, 'a@x.com')
    const r = await call('get', '/api/products'); expect(r.status).toBe(403); expect(r.body.code).toBe('password_change_required')
    expect((await call('post', '/api/auth/password', { currentPassword: PW, newPassword: 'short' })).status).toBe(400)
    expect((await call('post', '/api/auth/password', { currentPassword: PW, newPassword: 'A-brand-new-passphrase-42' })).status).toBe(200)
    expect((await call('get', '/api/products')).status).toBe(200)
  })
  it('supports TOTP two-factor and rejects code replay', async () => {
    const { app, mk } = setup()
    await mk('a@x.com', 'super_admin')
    const s = await login(app, 'a@x.com')
    const { secret } = (await s.call('post', '/api/auth/totp/setup')).body
    expect((await s.call('post', '/api/auth/totp/enable', { code: '000000' })).status).toBe(400)
    expect((await s.call('post', '/api/auth/totp/enable', { code: totpNow(secret) })).status).toBe(200)
    const l1 = await request(app).post('/api/auth/login').send({ email: 'a@x.com', password: PW })
    expect(l1.body.mfaRequired).toBe(true)
    const replay = await request(app).post('/api/auth/login/mfa').send({ mfaToken: l1.body.mfaToken, code: totpNow(secret) })
    expect(replay.status).toBe(401) // same 30s step already used when enabling
  })
  it('rejects mass-assignment and malformed input', async () => {
    const { app, mk } = setup()
    await mk('a@x.com', 'super_admin')
    const { call } = await login(app, 'a@x.com')
    expect((await call('post', '/api/locations', { name: 'W', role: 'super_admin' })).status).toBe(400)
    expect((await call('get', '/api/products/abc/overview')).status).toBe(400)
  })
})

describe('authorisation', () => {
  it('only super admins can manage users; permissions are enforced per feature', async () => {
    const { app, mk } = setup()
    await mk('adm@x.com', 'admin', ['products.view', 'dashboard.view'])
    const { call } = await login(app, 'adm@x.com')
    expect((await call('get', '/api/users')).status).toBe(403)
    expect((await call('get', '/api/products')).status).toBe(200)
    expect((await call('post', '/api/products', { name: 'x' })).status).toBe(403)
    expect((await call('get', '/api/admin/backups')).status).toBe(403)
    expect((await call('get', '/api/reports/orders')).status).toBe(403)
  })
  it('a dashboard-only user can see KPIs and nothing else', async () => {
    const { app, mk } = setup()
    await mk('d@x.com', 'user', ['dashboard.view'])
    const { call } = await login(app, 'd@x.com')
    expect((await call('get', '/api/dashboard')).status).toBe(200)
    for (const u of ['/api/inbound', '/api/outbound', '/api/clients', '/api/adjustments', '/api/audits', '/api/admin/logs', '/api/reports/inventory'])
      expect((await call('get', u)).status, u).toBe(403)
  })
  it('super admin changes apply immediately (sessions revoked) and the last super admin is protected', async () => {
    const { app, mk, db } = setup()
    const su = await mk('s@x.com', 'super_admin')
    const u = await mk('u@x.com', 'user', ['products.view'])
    const sa = await login(app, 's@x.com'), ua = await login(app, 'u@x.com')
    expect((await ua.call('get', '/api/products')).status).toBe(200)
    expect((await sa.call('patch', `/api/users/${u.id}`, { permissions: ['dashboard.view'] })).status).toBe(200)
    expect((await ua.call('get', '/api/products')).status).toBe(401)
    expect((await sa.call('patch', `/api/users/${su.id}`, { active: false })).status).toBe(400)
    expect(db.users.count()).toBe(2)
  })
  it('creates users with a one-time temporary password and rejects unknown permissions', async () => {
    const { app, mk } = setup()
    await mk('s@x.com', 'super_admin')
    const { call } = await login(app, 's@x.com')
    expect((await call('post', '/api/users', { name: 'N', email: 'n@x.com', role: 'user', permissions: ['hack.all'] })).status).toBe(400)
    const r = await call('post', '/api/users', { name: 'N', email: 'n@x.com', role: 'user', permissions: ['dashboard.view'] })
    expect(r.status).toBe(201); expect(r.body.temporaryPassword.length).toBeGreaterThan(12)
    expect(JSON.stringify(r.body.user)).not.toContain('passwordHash')
  })
})

describe('encryption at rest', () => {
  it('stores no plaintext business data and binds ciphertext to its row', async () => {
    const { app, mk, db } = setup()
    await mk('s@x.com', 'super_admin')
    const { call } = await login(app, 's@x.com')
    await call('post', '/api/locations', { name: 'Secret Warehouse Karachi', address: '12 Hidden Lane' })
    await call('post', '/api/clients', { name: 'Acme Confidential Ltd', contact: 'ceo@acme.test', address: '1 Private Rd' })
    const dump = JSON.stringify([db.sql.prepare('SELECT * FROM locations').all(), db.sql.prepare('SELECT * FROM clients').all(), db.sql.prepare('SELECT * FROM users').all()].map((x) => (x as any[]).map((r) => Buffer.from(r.data).toString('latin1'))))
    for (const s of ['Secret Warehouse', 'Hidden Lane', 'Acme', 'acme.test', 's@x.com']) expect(dump).not.toContain(s)
    // swap two encrypted rows -> authentication must fail
    await call('post', '/api/locations', { name: 'Second' })
    const rows = db.sql.prepare('SELECT id, data FROM locations ORDER BY id').all() as any[]
    db.sql.prepare('UPDATE locations SET data = ? WHERE id = ?').run(rows[1].data, rows[0].id)
    expect(() => db.locations.get(rows[0].id)).toThrow()
    expect(() => decrypt(encrypt('x', 'a'), 'b')).toThrow()
  })
  it('generates unique TOTP secrets', () => expect(newTotpSecret()).not.toBe(newTotpSecret()))
})
