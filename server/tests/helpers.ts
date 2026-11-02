import request from 'supertest'
import { createApp } from '../src/app.js'
import { openDb } from '../src/db.js'
import { blindIndex, hashPassword } from '../src/crypto.js'

export const PW = 'Correct-Horse-9-Battery'
export function setup() {
  const db = openDb(':memory:')
  const { app, ctx, inv } = createApp(db)
  const mk = async (email: string, role: 'super_admin' | 'admin' | 'user', permissions: string[] = [], extra: object = {}) =>
    db.users.insert({ name: email.split('@')[0], email, role, permissions, passwordHash: await hashPassword(PW), active: true, mustChangePassword: false, failedLogins: 0, createdAt: new Date().toISOString(), ...extra }, { email_idx: blindIndex(email, 'email') })
  return { db, app, ctx, inv, mk }
}
export async function login(app: any, email: string, password = PW) {
  const agent = request.agent(app)
  const r = await agent.post('/api/auth/login').send({ email, password })
  if (r.status !== 200) throw new Error('login failed ' + r.status + JSON.stringify(r.body))
  const csrf: string = r.body.csrf
  const call = (method: 'get' | 'post' | 'put' | 'patch' | 'delete', url: string, body?: object) => {
    const t = (agent as any)[method](url).set('X-CSRF-Token', csrf)
    return body ? t.send(body) : t
  }
  return { agent, csrf, call }
}
