// Every failure a user can hit must come back as a sentence they can act on, with a stable code, and never leak internals.
import { describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { login, PW, setup } from './helpers.js'

async function owner() {
  const w = setup(); await w.mk('own@x.com', 'super_admin')
  return { ...w, o: await login(w.app, 'own@x.com') }
}
const noJargon = (m: string) => { expect(m).not.toMatch(/zod|undefined|\bnull\b|\[object|expected [a-z]+,|invalid_|at \S+\.(ts|js)|stack|sqlite|SELECT |Error:/i) }

describe('validation errors are plain language, name the field and list every problem', () => {
  it('too short text', async () => {
    const { o } = await owner()
    const r = await o.call('post', '/api/adjustments', { productId: 1, locationId: 1, newQty: 5, reason: 'a' })
    expect(r.status).toBe(400); expect(r.body.code).toBe('validation')
    expect(r.body.error).toBe('Reason must be at least 3 characters.')
    expect(r.body.fields).toEqual([{ field: 'reason', message: 'Reason must be at least 3 characters' }])
  })
  it('missing and wrong-type values', async () => {
    const { o } = await owner()
    const r = await o.call('post', '/api/adjustments', { productId: 'abc', newQty: -5, reason: 'okay reason' })
    expect(r.status).toBe(400)
    const msgs = r.body.fields.map((f: any) => f.message)
    expect(msgs).toContain('Product must be a number'); expect(msgs).toContain('Location is required'); expect(msgs).toContain('Correct physical quantity must be 0 or more')
    expect(r.body.error).toMatch(/^Please fix 3 things:/); noJargon(r.body.error)
  })
  it('invalid choice, bad email, unexpected field, nested line numbers', async () => {
    const { o, db } = await owner()
    expect((await o.call('post', '/api/products', { uom: 'gallon' })).body.error).toMatch(/Measured by must be one of: unit, kg, m, bundle/)
    expect((await o.call('post', '/api/users', { name: 'N', email: 'not-an-email', role: 'user', permissions: [] })).body.error).toBe('Email must be a valid email address.')
    expect((await o.call('post', '/api/products', { name: 'x', hacker: 1 })).body.error).toMatch(/contains fields that are not allowed \(hacker\)/)
    const loc = (await o.call('post', '/api/locations', { name: 'W' })).body
    const r = await o.call('post', '/api/inbound', { locationId: loc.id, lines: [{ productId: 1, loose: 1 }, { productId: 'x', loose: -1 }] })
    expect(r.body.fields.map((f: any) => f.message)).toContain('Products, line 2, Product must be a number')
    expect(db.products.count()).toBe(0)
  })
  it('empty list says what to do', async () => {
    const { o } = await owner()
    const loc = (await o.call('post', '/api/locations', { name: 'W' })).body
    expect((await o.call('post', '/api/inbound', { locationId: loc.id, lines: [] })).body.error).toBe('Products needs at least one item.')
  })
  it('weak passwords tell the user how to fix it, attached to the right field', async () => {
    const { o } = await owner()
    const r = await o.call('post', '/api/auth/password', { currentPassword: PW, newPassword: 'short' })
    expect(r.body).toMatchObject({ code: 'weak_password', error: 'Password must be at least 12 characters long.', fields: [{ field: 'newPassword' }] })
    expect((await o.call('post', '/api/auth/password', { currentPassword: 'nope-nope-nope', newPassword: 'A-brand-new-passphrase-42' })).body).toMatchObject({ code: 'wrong_password', error: 'Your current password is incorrect.' })
  })
  it('bad ids and unreadable bodies', async () => {
    const { o } = await owner()
    expect((await o.call('get', '/api/products/abc/overview')).body.error).toMatch(/link is not valid/)
    const r = await o.agent.post('/api/products').set('X-CSRF-Token', o.csrf).set('Content-Type', 'application/json').send('{"name":')
    expect(r.status).toBe(400); expect(r.body.error).toMatch(/couldn't read that request/); noJargon(r.body.error)
    const big = await o.call('post', '/api/products', { name: 'x'.repeat(300_000) })
    expect(big.status).toBe(413); expect(big.body).toMatchObject({ code: 'too_large' })
  })
})

describe('sign-in and session errors tell people what to do', () => {
  it('wrong password mentions the lockout rule without revealing whether the account exists', async () => {
    const { app, mk } = setup(); await mk('a@x.com', 'user')
    const known = await request(app).post('/api/auth/login').send({ email: 'a@x.com', password: 'wrong-wrong-wrong' })
    const unknown = await request(app).post('/api/auth/login').send({ email: 'ghost@x.com', password: 'wrong-wrong-wrong' })
    expect(known.status).toBe(401); expect(known.body).toEqual(unknown.body)
    expect(known.body).toMatchObject({ code: 'invalid_credentials' }); expect(known.body.error).toMatch(/locked for 15 minutes after 5 wrong attempts/)
  })
  it('no cookie, expired session, disabled account, csrf and origin each have a specific code and message', async () => {
    const { app, mk, db } = setup(); const u = await mk('a@x.com', 'super_admin')
    const none = await request(app).get('/api/products'); expect(none.body).toMatchObject({ code: 'unauthenticated', error: 'Please sign in to continue.' })
    const s = await login(app, 'a@x.com')
    expect((await s.agent.post('/api/locations').send({ name: 'x' })).body).toMatchObject({ code: 'csrf', error: 'Your session is out of date. Please reload the page and try again.' })
    expect((await s.agent.post('/api/locations').set('X-CSRF-Token', s.csrf).set('Origin', 'https://evil.example').send({ name: 'x' })).body.code).toBe('bad_origin')
    const sess = (db.sessions.all() as any[])[0]
    db.sessions.update(sess.id, { ...sess, lastSeen: Date.now() - 3 * 3_600_000 }, { token_idx: (db.sql.prepare('SELECT token_idx FROM sessions').get() as any).token_idx })
    expect((await s.call('get', '/api/products')).body).toMatchObject({ code: 'session_expired', error: 'Your session has expired for security. Please sign in again.' })
    const s2 = await login(app, 'a@x.com'); db.users.update(u.id, { ...(db.users.get(u.id) as any), active: false }, { email_idx: (db.sql.prepare('SELECT email_idx FROM users').get() as any).email_idx })
    expect((await s2.call('get', '/api/products')).body.code).toBe('account_disabled')
  })
  it('forced password change explains itself', async () => {
    const { app, mk } = setup(); await mk('a@x.com', 'super_admin', [], { mustChangePassword: true })
    const s = await login(app, 'a@x.com')
    expect((await s.call('get', '/api/products')).body).toMatchObject({ code: 'password_change_required', error: 'You must set a new password before you can continue.' })
  })
  it('permission errors say what to do; super-admin-only says so', async () => {
    const { app, mk } = setup(); await mk('u@x.com', 'user', ['dashboard.view'])
    const s = await login(app, 'u@x.com')
    expect((await s.call('get', '/api/inbound')).body).toMatchObject({ code: 'forbidden', error: "You don't have permission to do this. Ask a super admin to grant you access." })
    expect((await s.call('get', '/api/users')).body).toMatchObject({ code: 'super_admin_only', error: 'Only a super admin can do this.' })
  })
  it('too many sign-in attempts returns a friendly 429 with a Retry-After', async () => {
    const { app } = setup(); let last: any
    for (let i = 0; i < 24; i++) { last = await request(app).post('/api/auth/login').send({ email: 'x@x.com', password: `wrong-guess-${i}-zz` }); if (last.status === 429) break }
    expect(last.status).toBe(429); expect(last.body).toMatchObject({ code: 'rate_limited' }); expect(last.body.error).toMatch(/Too many sign-in attempts/); expect(last.headers['retry-after']).toBeTruthy()
  }, 60000)
})

describe('business-rule conflicts name the product, place and numbers', () => {
  async function stocked() {
    const w = await owner()
    const loc = (await w.o.call('post', '/api/locations', { name: 'Karachi Main' })).body
    const p = (await w.o.call('post', '/api/products', { name: 'Cotton T-Shirt', color: 'Black', size: 'L', caseSize: 24 })).body
    const inb = (await w.o.call('post', '/api/inbound', { locationId: loc.id, lines: [{ productId: p.id, loose: 10 }] })).body
    await w.o.call('post', `/api/inbound/${inb.id}/approve`, {}); const cl = (await w.o.call('post', '/api/clients', { name: 'C' })).body
    return { ...w, loc, p, cl }
  }
  it('not enough stock', async () => {
    const { o, loc, p, cl } = await stocked()
    await o.call('post', '/api/reserves', { locationId: loc.id, lines: [{ productId: p.id, loose: 4 }] })
    const r = await o.call('post', '/api/outbound', { locationId: loc.id, clientId: cl.id, lines: [{ productId: p.id, loose: 8 }] })
    expect(r.status).toBe(409); expect(r.body.code).toBe('insufficient_stock')
    expect(r.body.error).toBe('Not enough available stock: Cotton T-Shirt - Black · L at Karachi Main has 6 available right now (4 of 10 is already reserved).')
    const t = await o.call('post', '/api/transfers', { fromLocationId: loc.id, toLocationId: (await o.call('post', '/api/locations', { name: 'Lahore' })).body.id, lines: [{ productId: p.id, loose: 50 }] })
    const sub = await o.call('post', `/api/transfers/${t.body.id}/submit`); expect(sub.body.error).toMatch(/has only 10 on hand, but 50 is needed/)
  })
  it('stale clicks (already processed) explain that someone else may have done it', async () => {
    const { o, loc, p, cl } = await stocked()
    const ob = (await o.call('post', '/api/outbound', { locationId: loc.id, clientId: cl.id, lines: [{ productId: p.id, loose: 1 }] })).body
    await o.call('post', `/api/outbound/${ob.id}/confirm`)
    const again = await o.call('post', `/api/outbound/${ob.id}/confirm`)
    expect(again.status).toBe(409); expect(again.body).toMatchObject({ code: 'already_processed' }); expect(again.body.error).toMatch(/already confirmed, possibly by someone else. Refresh the page/)
  })
  it('missing items, duplicates and unusable products say why', async () => {
    const { o, loc } = await stocked()
    expect((await o.call('post', '/api/inbound', { locationId: loc.id, lines: [{ productId: 9999, loose: 1 }] })).body.error).toMatch(/One of the products could not be found. It may have been removed/)
    expect((await o.call('post', '/api/locations', { name: 'karachi main' })).body).toMatchObject({ code: 'duplicate', fields: [{ field: 'name' }] })
    expect((await o.call('post', '/api/users', { name: 'N', email: 'own@x.com', role: 'user', permissions: [] })).body).toMatchObject({ code: 'duplicate', fields: [{ field: 'email' }] })
    expect((await o.call('get', '/api/products/999/overview')).body.code).toBe('not_found')
  })
  it('lower-level reasons are explained (no case pack, decimals, comment required)', async () => {
    const { o, loc } = await stocked()
    const loose = (await o.call('post', '/api/products', { name: 'Cable', uom: 'm' })).body
    expect((await o.call('post', '/api/inbound', { locationId: loc.id, lines: [{ productId: loose.id, cases: 2 }] })).body.error).toBe('Cable has no case pack, so enter the amount under "Loose units" instead of cases.')
    const unit = (await o.call('post', '/api/products', { name: 'Bolt' })).body
    expect((await o.call('post', '/api/inbound', { locationId: loc.id, lines: [{ productId: unit.id, loose: 1.5 }] })).body.error).toBe('Bolt is counted in whole numbers - remove the decimals.')
    const inb = (await o.call('post', '/api/inbound', { locationId: loc.id, lines: [{ productId: unit.id, loose: 5 }] })).body
    const r = await o.call('post', `/api/inbound/${inb.id}/approve`, { verified: [{ productId: unit.id, loose: 4 }] })
    expect(r.body).toMatchObject({ code: 'validation', fields: [{ field: 'comment' }] }); expect(r.body.error).toMatch(/Please add a comment explaining why/)
  })
})

describe('unexpected failures never leak internals and carry a reference id', () => {
  it('500: generic message, request id in body and header, details only in the server log', async () => {
    const { o, db } = await owner()
    const spy = vi.spyOn(db.products, 'all').mockImplementation(() => { throw new Error('SQLITE_CORRUPT: secret internal detail at /srv/app/db.ts:99') })
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await o.call('get', '/api/products')
    expect(r.status).toBe(500)
    expect(r.body.code).toBe('server_error'); expect(r.body.requestId).toMatch(/^[0-9a-f]{10}$/); expect(r.headers['x-request-id']).toBe(r.body.requestId)
    expect(r.body.error).toMatch(/Something went wrong on our side/); expect(JSON.stringify(r.body)).not.toMatch(/SQLITE|secret|db\.ts/)
    expect(log.mock.calls.join(' ')).toContain(`ref=${r.body.requestId}`); expect(log.mock.calls.join(' ')).toContain('secret internal detail')
    spy.mockRestore(); log.mockRestore()
  })
  it('every error body has a string error and a code', async () => {
    const { o, app } = await owner()
    for (const res of [await o.call('get', '/api/nope'), await o.call('post', '/api/products', { x: 1 }), await request(app).get('/api/products')]) {
      expect(typeof res.body.error).toBe('string'); expect(typeof res.body.code).toBe('string'); noJargon(res.body.error)
    }
  })
})
