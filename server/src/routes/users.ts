import { Router } from 'express'
import { z } from 'zod'
import type { Ctx } from '../context.js'
import { destroyUserSessions, requireSuper } from '../auth.js'
import { blindIndex, hashPassword, randomToken } from '../crypto.js'
import { AppError, bad, notFound } from '../errors.js'
import { ip, nowIso, wrap } from '../http.js'
import type { User } from '../models.js'
import { ALL_KEYS, PERMISSIONS } from '../permissions.js'
import { idParam, parse, str } from '../validation.js'
import { publicUser } from './auth.js'

const perms = z.array(z.enum(ALL_KEYS as [string, ...string[]])).max(100)
const createSchema = z.object({ name: str(100), email: z.string().trim().email().max(254), role: z.enum(['super_admin', 'admin', 'user']), permissions: perms }).strict()
const updateSchema = z.object({ name: str(100), role: z.enum(['super_admin', 'admin', 'user']), permissions: perms, active: z.boolean() }).strict().partial()

const tempPassword = () => `${randomToken(9)}-${Math.floor(1000 + Math.random() * 9000)}`

export function userRoutes(ctx: Ctx) {
  const r = Router()
  r.use(requireSuper) // only super admins manage users - this is the privilege-escalation boundary
  const idx = (u: User) => ({ email_idx: blindIndex(u.email, 'email') })
  const activeSupers = () => (ctx.db.users.all() as User[]).filter((u) => u.role === 'super_admin' && u.active).length

  r.get('/meta', wrap((_req, res) => res.json({ permissions: PERMISSIONS })))
  r.get('/', wrap((_req, res) => res.json((ctx.db.users.all() as User[]).map(publicUser))))

  r.post('/', wrap(async (req, res) => {
    const b = parse(createSchema, req.body)
    if (ctx.db.users.byIdx('email_idx', blindIndex(b.email, 'email'))) throw new AppError(409, 'A user with this email address already exists.', 'duplicate', [{ field: 'email', message: 'This email is already in use.' }])
    const temp = tempPassword()
    const u = ctx.db.users.insert(
      { name: b.name, email: b.email.toLowerCase(), role: b.role, permissions: b.role === 'super_admin' ? [] : b.permissions, passwordHash: await hashPassword(temp), active: true, mustChangePassword: true, failedLogins: 0, createdAt: nowIso() },
      { email_idx: blindIndex(b.email, 'email') },
    ) as User
    ctx.audit.log(req.user!, 'user.create', { entity: 'user', entityId: u.id, detail: `${u.email} (${u.role})`, ip: ip(req) })
    res.status(201).json({ user: publicUser(u), temporaryPassword: temp }) // shown once, user must change it on first login
  }))

  r.patch('/:id', wrap((req, res) => {
    const id = idParam(req)
    const u = ctx.db.users.get(id) as User | undefined
    if (!u) throw notFound('User')
    const b = parse(updateSchema, req.body)
    const next = { ...u, ...b } as User
    if (next.role === 'super_admin') next.permissions = []
    const losesSuper = u.role === 'super_admin' && u.active && (next.role !== 'super_admin' || !next.active)
    if (losesSuper && activeSupers() <= 1) throw bad("You can't remove or disable the last active super admin. Make someone else a super admin first.")
    ctx.db.users.update(id, next, idx(next))
    if (b.active === false || b.role || b.permissions) destroyUserSessions(ctx, id) // force re-auth so new rights apply immediately
    ctx.audit.log(req.user!, 'user.update', { entity: 'user', entityId: id, detail: JSON.stringify({ ...b, permissions: b.permissions?.length }), ip: ip(req) })
    res.json(publicUser(next))
  }))

  r.post('/:id/reset-password', wrap(async (req, res) => {
    const id = idParam(req)
    const u = ctx.db.users.get(id) as User | undefined
    if (!u) throw notFound('User')
    const temp = tempPassword()
    ctx.db.users.update(id, { ...u, passwordHash: await hashPassword(temp), mustChangePassword: true, failedLogins: 0, lockedUntil: undefined }, idx(u))
    destroyUserSessions(ctx, id)
    ctx.audit.log(req.user!, 'user.reset_password', { entity: 'user', entityId: id, ip: ip(req) })
    res.json({ temporaryPassword: temp })
  }))

  r.post('/:id/unlock', wrap((req, res) => {
    const id = idParam(req)
    const u = ctx.db.users.get(id) as User | undefined
    if (!u) throw notFound('User')
    ctx.db.users.update(id, { ...u, failedLogins: 0, lockedUntil: undefined }, idx(u))
    ctx.audit.log(req.user!, 'user.unlock', { entity: 'user', entityId: id })
    res.json({ ok: true })
  }))

  r.post('/:id/reset-mfa', wrap((req, res) => {
    const id = idParam(req)
    const u = ctx.db.users.get(id) as User | undefined
    if (!u) throw notFound('User')
    ctx.db.users.update(id, { ...u, totpSecret: undefined, totpPending: undefined }, idx(u))
    destroyUserSessions(ctx, id)
    ctx.audit.log(req.user!, 'user.reset_mfa', { entity: 'user', entityId: id })
    res.json({ ok: true })
  }))

  return r
}
