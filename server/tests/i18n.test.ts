import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { login, PW, setup } from './helpers.js'
import { T, render, langOf } from '../src/i18n/index.js'
import { ur } from '../src/i18n/ur.js'

const URDU = /[؀-ۿ]/
const hasUrdu = (s: string) => URDU.test(s)

/** Every message template the server can produce, found in the source (T('...'), notFound('...'), validation labels). */
function templatesInSource(): Map<string, string> {
  const root = path.resolve(__dirname, '../src'); const out = new Map<string, string>()
  const files = (d: string): string[] => fs.readdirSync(d).flatMap((f) => { const p = path.join(d, f); return fs.statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') && !p.endsWith('ur.ts') ? [p] : [] })
  for (const f of files(root)) {
    const sf = ts.createSourceFile(f, fs.readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true)
    const add = (s: string, n: ts.Node) => { if (!out.has(s)) out.set(s, `${path.relative(root, f)}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`) }
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.arguments[0] && (ts.isStringLiteral(n.arguments[0]) || ts.isNoSubstitutionTemplateLiteral(n.arguments[0]))) {
        if (['T', 'notFound', 'bad', 'conflict', 'forbidden', 'unauthenticated'].includes(n.expression.text)) add((n.arguments[0] as ts.StringLiteral).text, n)
      }
      if (ts.isParameter(n) && n.initializer && ts.isStringLiteral(n.initializer) && ts.isArrowFunction(n.parent) && /errors\.ts$/.test(f) && ['m', 'what'].includes(n.name.getText())) add(n.initializer.text, n) // default messages
      if (ts.isVariableDeclaration(n) && n.name.getText() === 'LABELS' && n.initializer && ts.isObjectLiteralExpression(n.initializer)) n.initializer.properties.forEach((p) => { if (ts.isPropertyAssignment(p) && ts.isStringLiteral(p.initializer)) add(p.initializer.text, p) })
      ts.forEachChild(n, visit)
    }
    visit(sf)
  }
  for (const k of ['That item', 'SKU', 'Variation', 'UOM', 'On hand', 'Reserved', 'Available', 'Boxes', 'Number', 'Date', 'Lines', 'Units', 'Created by', 'Inbound', 'Transfer', 'Reserve', 'Outbound', 'units', 'kg', 'm', 'bundles', 'Audit']) if (!out.has(k)) out.set(k, 'extra')
  return out
}

describe('server dictionary coverage', () => {
  const keys = templatesInSource()
  it('finds a realistic number of messages', () => expect(keys.size).toBeGreaterThan(150))
  it('every message template used in the code has an Urdu translation', () => {
    const missing = [...keys].filter(([k]) => !ur[k]).map(([k, where]) => `${where}  ${k}`)
    expect(missing).toEqual([])
  })
  it('translations keep every {placeholder} (none lost or invented) and are real Urdu text', () => {
    const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')
    const bad = Object.entries(ur).filter(([en, u]) => ph(en) !== ph(u) || (!hasUrdu(u) && en.replace(/\{\w+\}|[.\s]/g, '') !== '')).map(([en]) => en)
    expect(bad).toEqual([])
  })
  it('no stale entries: every dictionary key is still used by the code', () => {
    const stale = Object.keys(ur).filter((k) => !keys.has(k) && !/^(awaiting approval|approved|rejected|draft|in transit|received|cancelled|active|converted|saved|confirmed|counting)$/.test(k))
    expect(stale).toEqual([])
  })
})

describe('rendering', () => {
  it('detects the language from Accept-Language', () => { expect(langOf('ur')).toBe('ur'); expect(langOf('ur-PK,ur;q=0.9')).toBe('ur'); expect(langOf('en-US')).toBe('en'); expect(langOf(undefined)).toBe('en') })
  it('fills placeholders, including nested messages and lists, in both languages', () => {
    const m = T('{label} must be at least {n} characters', { label: T('Reason'), n: 3 })
    expect(render(m, 'en')).toBe('Reason must be at least 3 characters'); expect(render(m, 'ur')).toBe('وجہ کم از کم 3 حروف کا ہونا چاہیے')
    expect(render(T('Unknown template {x}', { x: 1 }), 'ur')).toBe('Unknown template 1') // falls back to English
  })
})

const call = (app: any, agent: any, csrf: string, method: 'get' | 'post' | 'put', url: string, body?: object, lang = 'ur') => {
  const t = agent[method](url).set('X-CSRF-Token', csrf).set('Accept-Language', lang)
  return body ? t.send(body) : t
}
async function world() { const w = setup(); await w.mk('own@x.com', 'super_admin'); const s = await login(w.app, 'own@x.com'); return { ...w, s, ur: (m: any, u: string, b?: object) => call(w.app, s.agent, s.csrf, m, u, b, 'ur'), en: (m: any, u: string, b?: object) => call(w.app, s.agent, s.csrf, m, u, b, 'en') } }

describe('API answers in the caller\'s language', () => {
  it('validation errors: summary and each field in Urdu, codes unchanged', async () => {
    const { ur: u, en } = await world()
    const r = await u('post', '/api/adjustments', { productId: 1, locationId: 1, newQty: 5, reason: 'a' })
    expect(r.status).toBe(400); expect(r.body.code).toBe('validation')
    expect(r.body.error).toBe('وجہ کم از کم 3 حروف کا ہونا چاہیے۔'); expect(r.body.fields[0]).toEqual({ field: 'reason', message: 'وجہ کم از کم 3 حروف کا ہونا چاہیے' })
    expect((await en('post', '/api/adjustments', { productId: 1, locationId: 1, newQty: 5, reason: 'a' })).body.error).toBe('Reason must be at least 3 characters.')
    const many = await u('post', '/api/adjustments', { productId: 'x', newQty: -1, reason: 'okay reason' })
    expect(many.body.error).toMatch(/^براہِ کرم 3 چیزیں درست کریں: /); expect(many.body.fields.map((f: any) => f.message)).toContain('پروڈکٹ عدد ہونا چاہیے')
  })
  it('business conflicts name the product and place and numbers, in Urdu', async () => {
    const { ur: u } = await world()
    const loc = (await u('post', '/api/locations', { name: 'Karachi Main' })).body
    const p = (await u('post', '/api/products', { name: 'Cotton T-Shirt', color: 'Black', size: 'L', caseSize: 24 })).body
    const inb = (await u('post', '/api/inbound', { locationId: loc.id, lines: [{ productId: p.id, loose: 10 }] })).body
    await u('post', `/api/inbound/${inb.id}/approve`, {})
    const cl = (await u('post', '/api/clients', { name: 'C' })).body
    await u('post', '/api/reserves', { locationId: loc.id, lines: [{ productId: p.id, loose: 4 }] })
    const r = await u('post', '/api/outbound', { locationId: loc.id, clientId: cl.id, lines: [{ productId: p.id, loose: 8 }] })
    expect(r.status).toBe(409); expect(r.body.code).toBe('insufficient_stock')
    expect(r.body.error).toBe('دستیاب اسٹاک کم ہے: Karachi Main میں Cotton T-Shirt - Black · L کا اس وقت 6 دستیاب ہے (10 میں سے 4 پہلے ہی محفوظ ہے)۔')
    const ob = (await u('post', '/api/outbound', { locationId: loc.id, clientId: cl.id, lines: [{ productId: p.id, loose: 1 }] })).body
    await u('post', `/api/outbound/${ob.id}/confirm`)
    expect((await u('post', `/api/outbound/${ob.id}/confirm`)).body.error).toBe('یہ آرڈر پہلے ہی تصدیق شدہ ہو چکا ہے، ممکن ہے کسی اور نے کیا ہو۔ تازہ ترین دیکھنے کے لیے صفحہ ریفریش کریں۔')
  })
  it('auth, permission, not-found and unknown-route errors', async () => {
    const { app, mk } = setup(); await mk('u@x.com', 'user', ['dashboard.view'])
    expect((await request(app).get('/api/products').set('Accept-Language', 'ur')).body).toMatchObject({ code: 'unauthenticated', error: 'براہِ کرم جاری رکھنے کے لیے لاگ اِن کریں۔' })
    const bad = await request(app).post('/api/auth/login').set('Accept-Language', 'ur').send({ email: 'u@x.com', password: 'wrong-wrong-wrong' })
    expect(bad.body.code).toBe('invalid_credentials'); expect(bad.body.error).toBe(ur['Incorrect email or password. For security, an account is locked for 15 minutes after 5 wrong attempts.'])
    const s = await login(app, 'u@x.com')
    const f = await call(app, s.agent, s.csrf, 'get', '/api/inbound', undefined, 'ur'); expect(f.body.code).toBe('forbidden'); expect(hasUrdu(f.body.error)).toBe(true)
    expect((await call(app, s.agent, s.csrf, 'get', '/api/users', undefined, 'ur')).body.error).toBe('یہ کام صرف سپر ایڈمن کر سکتا ہے۔')
  })
  it('weak password message is Urdu and attached to the field', async () => {
    const { ur: u } = await world()
    const r = await u('post', '/api/auth/password', { currentPassword: PW, newPassword: 'short' })
    expect(r.body).toMatchObject({ code: 'weak_password', error: 'پاس ورڈ کم از کم 12 حروف کا ہونا چاہیے۔', fields: [{ field: 'newPassword' }] })
  })
  it('a 500 stays generic (Urdu) and still carries the reference id', async () => {
    const { app, mk, db } = setup(); await mk('o@x.com', 'super_admin'); const s = await login(app, 'o@x.com')
    const { vi } = await import('vitest'); const spy = vi.spyOn(db.products, 'all').mockImplementation(() => { throw new Error('secret') }); const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await call(app, s.agent, s.csrf, 'get', '/api/products', undefined, 'ur')
    expect(r.status).toBe(500); expect(r.body.error).toBe(ur['Something went wrong on our side. Please try again in a moment. If it keeps happening, contact support and quote the reference below.']); expect(r.body.requestId).toMatch(/^[0-9a-f]{10}$/); expect(JSON.stringify(r.body)).not.toContain('secret')
    spy.mockRestore(); log.mockRestore()
  })
})

describe('language preference, audit default name, CSV', () => {
  it('saves the user\'s language and returns it from /me', async () => {
    const { app, mk } = setup(); await mk('a@x.com', 'user', ['dashboard.view']); const s = await login(app, 'a@x.com')
    expect((await s.call('get', '/api/auth/me')).body.user.language).toBeUndefined()
    expect((await s.call('post', '/api/auth/language', { language: 'ur' })).body).toMatchObject({ ok: true, language: 'ur' })
    expect((await s.call('get', '/api/auth/me')).body.user.language).toBe('ur')
    expect((await s.call('post', '/api/auth/language', { language: 'fr' })).status).toBe(400)
  })
  it('new audits are named in the caller\'s language', async () => {
    const { ur: u, en } = await world()
    const loc = (await u('post', '/api/locations', { name: 'W' })).body; await u('post', '/api/products', { name: 'P' })
    expect((await u('post', '/api/audits', { locationId: loc.id })).body.name).toMatch(/^آڈٹ \d{8}$/)
    expect((await en('post', '/api/audits', { locationId: loc.id })).body.name).toMatch(/^Audit \d{8}$/)
  })
  it('CSV exports have Urdu headers and values, and a BOM so Excel reads them', async () => {
    const { ur: u, en } = await world()
    const loc = (await u('post', '/api/locations', { name: 'W1' })).body, p = (await u('post', '/api/products', { name: 'Tee', color: 'Black', caseSize: 24 })).body
    const inb = (await u('post', '/api/inbound', { locationId: loc.id, lines: [{ productId: p.id, cases: 2 }] })).body; await u('post', `/api/inbound/${inb.id}/approve`, {})
    const csv = (await u('get', '/api/reports/inventory?format=csv')).text
    expect(csv.charCodeAt(0)).toBe(0xfeff); expect(csv.split('\n')[0]).toContain('پروڈکٹ کوڈ'); expect(csv.split('\n')[0]).toContain('دستیاب'); expect(csv.split('\n')[1]).toContain('یونٹس')
    const orders = (await u('get', '/api/reports/orders?format=csv')).text; expect(orders).toContain('منظور شدہ'); expect(orders).toContain('آمد')
    expect((await en('get', '/api/reports/inventory?format=csv')).text.split('\n')[0]).toContain('SKU')
  })
  it('approval items carry structured data (no English sentences) so any language can be shown', async () => {
    const { app, mk } = setup(); await mk('own@x.com', 'super_admin'); await mk('t@x.com', 'user', ['locations.manage']); const o = await login(app, 'own@x.com'), t = await login(app, 't@x.com')
    await t.call('post', '/api/locations', { name: 'New Depot', address: '1 Road' })
    const item = (await o.call('get', '/api/approvals?status=pending')).body.items[0]
    expect(item).toMatchObject({ type: 'location', title: 'New Depot', details: { address: '1 Road' } }); expect(item.summary).toBeUndefined()
  })
})
