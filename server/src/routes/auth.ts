import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import type { Ctx } from '../context.js'
import { authenticate, createSession, destroySession, destroyUserSessions, effectivePerms } from '../auth.js'
import { blindIndex, dummyHash, hashPassword, newTotpSecret, randomToken, verifyPassword, verifyTotp } from '../crypto.js'
import { AppError, bad } from '../errors.js'
import { ip, nowIso, wrap } from '../http.js'
import type { User } from '../models.js'
import { checkPassword, parse } from '../validation.js'
import { config } from '../config.js'

const MAX_FAILS = 5
const LOCK_MS = 15 * 60_000
const GENERIC = 'Invalid email or password'

export const publicUser = (u: User) => ({
  id: u.id, name: u.name, email: u.email, role: u.role, active: u.active,
  permissions: effectivePerms(u), mustChangePassword: u.mustChangePassword,
  totpEnabled: !!u.totpSecret, mfaSetupRequired: config.requireMfa && !u.totpSecret,
  lastLoginAt: u.lastLoginAt, createdAt: u.createdAt, locked: !!u.lockedUntil && u.lockedUntil > Date.now(),
})

export function authRoutes(ctx: Ctx) {
  const r = Router()
  const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts, try again later' } })
  const pendingMfa = new Map<string, { userId: number; exp: number; tries: number }>()

  const finishLogin = (req: any, res: any, user: User) => {
    ctx.db.users.update(user.id, { ...user, failedLogins: 0, lockedUntil: undefined, lastLoginAt: nowIso() }, { email_idx: blindIndex(user.email, 'email') })
    const csrf = createSession(ctx, req, res, user)
    ctx.audit.log(user, 'auth.login', { ip: ip(req) })
    return { user: publicUser({ ...user, lastLoginAt: nowIso() }), csrf }
  }

  const fail = (user: User) => {
    const failedLogins = user.failedLogins + 1
    const locked = failedLogins >= MAX_FAILS
    ctx.db.users.update(user.id, { ...user, failedLogins: locked ? 0 : failedLogins, lockedUntil: locked ? Date.now() + LOCK_MS : user.lockedUntil }, { email_idx: blindIndex(user.email, 'email') })
    ctx.audit.log(user, locked ? 'auth.locked' : 'auth.login_failed')
  }

  r.post('/login', loginLimiter, wrap(async (req, res) => {
    const { email, password } = parse(z.object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(256) }).strict(), req.body)
    const user = ctx.db.users.byIdx('email_idx', blindIndex(email, 'email')) as User | undefined
    const ok = await verifyPassword(password, user?.passwordHash ?? (await dummyHash))
    if (!user || !user.active) throw new AppError(401, GENERIC)
    if (user.lockedUntil && user.lockedUntil > Date.now()) throw new AppError(401, GENERIC) // do not reveal lock state
    if (!ok) { fail(user); throw new AppError(401, GENERIC) }
    if (user.totpSecret) {
      const mfaToken = randomToken(24)
      pendingMfa.set(mfaToken, { userId: user.id, exp: Date.now() + 5 * 60_000, tries: 0 })
      return res.json({ mfaRequired: true, mfaToken })
    }
    res.json(finishLogin(req, res, user))
  }))

  r.post('/login/mfa', loginLimiter, wrap(async (req, res) => {
    const { mfaToken, code } = parse(z.object({ mfaToken: z.string().max(100), code: z.string().max(10) }).strict(), req.body)
    const p = pendingMfa.get(mfaToken)
    if (!p || p.exp < Date.now()) throw new AppError(401, 'Verification expired, sign in again')
    const user = ctx.db.users.get(p.userId) as User | undefined
    if (!user || !user.active || !user.totpSecret) throw new AppError(401, 'Verification failed')
    const step = verifyTotp(user.totpSecret, code)
    if (step === null || (user.totpLastStep !== undefined && step <= user.totpLastStep)) {
      if (++p.tries >= 5) pendingMfa.delete(mfaToken)
      fail(user)
      throw new AppError(401, 'Invalid code')
    }
    pendingMfa.delete(mfaToken)
    res.json(finishLogin(req, res, { ...user, totpLastStep: step }))
  }))

  const auth = authenticate(ctx)

  r.post('/logout', auth, wrap((req, res) => {
    ctx.audit.log(req.user!, 'auth.logout', { ip: ip(req) })
    destroySession(ctx, req, res)
    res.json({ ok: true })
  }))

  r.get('/me', auth, wrap((req, res) => res.json({ user: publicUser(req.user!), csrf: req.csrf })))

  r.post('/password', auth, wrap(async (req, res) => {
    const { currentPassword, newPassword } = parse(z.object({ currentPassword: z.string().max(256), newPassword: z.string().max(256) }).strict(), req.body)
    const u = req.user!
    if (!(await verifyPassword(currentPassword, u.passwordHash))) throw new AppError(400, 'Current password is incorrect')
    if (currentPassword === newPassword) throw bad('New password must be different')
    checkPassword(newPassword, u)
    ctx.db.users.update(u.id, { ...u, passwordHash: await hashPassword(newPassword), mustChangePassword: false }, { email_idx: blindIndex(u.email, 'email') })
    destroyUserSessions(ctx, u.id, req.sessionId) // sign out every other device
    ctx.audit.log(u, 'auth.password_changed', { ip: ip(req) })
    res.json({ ok: true })
  }))

  r.post('/totp/setup', auth, wrap((req, res) => {
    const u = req.user!
    if (u.totpSecret) throw bad('Two-factor is already enabled')
    const secret = newTotpSecret()
    ctx.db.users.update(u.id, { ...u, totpPending: secret }, { email_idx: blindIndex(u.email, 'email') })
    const url = `otpauth://totp/WMS:${encodeURIComponent(u.email)}?secret=${secret}&issuer=WMS&algorithm=SHA1&digits=6&period=30`
    res.json({ secret, otpauthUrl: url })
  }))

  r.post('/totp/enable', auth, wrap((req, res) => {
    const { code } = parse(z.object({ code: z.string().max(10) }).strict(), req.body)
    const u = req.user!
    const step = u.totpPending ? verifyTotp(u.totpPending, code) : null
    if (step === null) throw bad('Invalid code')
    ctx.db.users.update(u.id, { ...u, totpSecret: u.totpPending, totpPending: undefined, totpLastStep: step }, { email_idx: blindIndex(u.email, 'email') })
    ctx.audit.log(u, 'auth.totp_enabled')
    res.json({ ok: true })
  }))

  r.post('/totp/disable', auth, wrap(async (req, res) => {
    const { password, code } = parse(z.object({ password: z.string().max(256), code: z.string().max(10) }).strict(), req.body)
    const u = req.user!
    if (config.requireMfa) throw bad('Two-factor is mandatory on this system')
    if (!u.totpSecret || !(await verifyPassword(password, u.passwordHash)) || verifyTotp(u.totpSecret, code) === null) throw bad('Invalid password or code')
    ctx.db.users.update(u.id, { ...u, totpSecret: undefined }, { email_idx: blindIndex(u.email, 'email') })
    ctx.audit.log(u, 'auth.totp_disabled')
    res.json({ ok: true })
  }))

  return r
}
