import type { NextFunction, Request, Response } from 'express'
import { config } from './config.js'
import { blindIndex, randomToken, safeEqual } from './crypto.js'
import type { Ctx } from './context.js'
import type { Session, User } from './models.js'
import { AppError, forbidden } from './errors.js'
import { ALL_KEYS } from './permissions.js'

export const COOKIE = config.secureCookies ? '__Host-wms_sid' : 'wms_sid'
const sidIdx = (t: string) => blindIndex(t, 'session')

export const hasPerm = (u: User, p: string) => u.role === 'super_admin' || u.permissions.includes(p)
export const effectivePerms = (u: User) => (u.role === 'super_admin' ? [...ALL_KEYS, 'users.manage', 'backups.manage'] : u.permissions)

function parseCookies(h?: string) {
  const out: Record<string, string> = {}
  for (const part of (h ?? '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
  }
  return out
}

export function setSessionCookie(res: Response, token: string) {
  res.cookie(COOKIE, token, {
    httpOnly: true, secure: config.secureCookies, sameSite: 'strict', path: '/', maxAge: config.sessionMaxMs,
  })
}

export function createSession(ctx: Ctx, req: Request, res: Response, user: User) {
  const token = randomToken(32)
  const now = Date.now()
  const csrf = randomToken(24)
  ctx.db.sessions.insert(
    { userId: user.id, csrf, createdAt: now, lastSeen: now, ip: req.ip, ua: String(req.headers['user-agent'] ?? '').slice(0, 200) } satisfies Session,
    { token_idx: sidIdx(token) },
  )
  setSessionCookie(res, token)
  return csrf
}

export function destroySession(ctx: Ctx, req: Request, res: Response) {
  const t = parseCookies(req.headers.cookie)[COOKIE]
  if (t) {
    const s = ctx.db.sessions.byIdx('token_idx', sidIdx(t))
    if (s) ctx.db.sessions.delete(s.id)
  }
  res.clearCookie(COOKIE, { path: '/' })
}

export function destroyUserSessions(ctx: Ctx, userId: number, exceptId?: number) {
  for (const s of ctx.db.sessions.all()) if (s.userId === userId && s.id !== exceptId) ctx.db.sessions.delete(s.id)
}

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS'])
/** Allowed while a user still has to change password / enrol MFA. */
const GATE_OK = ['/api/auth/me', '/api/auth/logout', '/api/auth/password', '/api/auth/totp/setup', '/api/auth/totp/enable']

/** Resolves the session cookie, enforces idle/absolute timeouts, CSRF (token + Origin) and forced-setup gates. */
export const authenticate = (ctx: Ctx) => (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = parseCookies(req.headers.cookie)[COOKIE]
    if (!token) throw new AppError(401, 'Authentication required')
    const s = ctx.db.sessions.byIdx('token_idx', sidIdx(token))
    const now = Date.now()
    if (!s || now - s.createdAt > config.sessionMaxMs || now - s.lastSeen > config.sessionIdleMs) {
      if (s) ctx.db.sessions.delete(s.id)
      res.clearCookie(COOKIE, { path: '/' })
      throw new AppError(401, 'Session expired')
    }
    const user = ctx.db.users.get(s.userId) as User | undefined
    if (!user || !user.active) throw new AppError(401, 'Authentication required')

    if (!SAFE.has(req.method)) {
      const origin = req.headers.origin
      const expected = config.allowedOrigin ?? `${req.protocol}://${req.get('host')}`
      if (origin && origin !== expected) throw forbidden('Bad origin')
      const sent = String(req.headers['x-csrf-token'] ?? '')
      if (!sent || !safeEqual(sent, s.csrf)) throw forbidden('Invalid CSRF token')
    }
    if (now - s.lastSeen > 60_000) ctx.db.sessions.update(s.id, { ...s, lastSeen: now }, { token_idx: sidIdx(token) })

    const gated = user.mustChangePassword || (config.requireMfa && !user.totpSecret)
    if (gated && !GATE_OK.includes(req.originalUrl.split('?')[0])) {
      throw new AppError(403, user.mustChangePassword ? 'Password change required' : 'MFA setup required', user.mustChangePassword ? 'password_change_required' : 'mfa_setup_required')
    }
    req.user = user
    req.sessionId = s.id
    req.csrf = s.csrf
    next()
  } catch (e) {
    next(e)
  }
}

/** Passes if the user holds ANY of the listed permissions (super admins always pass). */
export const requirePerm = (...perms: string[]) => (req: Request, _res: Response, next: NextFunction) => {
  const u = req.user
  if (!u) return next(new AppError(401, 'Authentication required'))
  if (u.role === 'super_admin' || perms.some((p) => u.permissions.includes(p))) return next()
  next(forbidden('You do not have permission to do this'))
}
export const requireSuper = (req: Request, _res: Response, next: NextFunction) =>
  req.user?.role === 'super_admin' ? next() : next(forbidden('Super admin only'))
