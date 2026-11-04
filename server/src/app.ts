import express from 'express'
import { ZodError } from 'zod'
import crypto from 'node:crypto'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.js'
import type { Db } from './db.js'
import type { Ctx } from './context.js'
import { Audit } from './audit.js'
import { Mailer } from './mailer.js'
import { Inventory } from './inventory.js'
import { authenticate } from './auth.js'
import { AppError, SERVER_ERROR_MESSAGE } from './errors.js'
import { T, langOf, render } from './i18n/index.js'
import { validationError } from './validation.js'
import { authRoutes } from './routes/auth.js'
import { userRoutes } from './routes/users.js'
import { masterRoutes } from './routes/masters.js'
import { orderRoutes } from './routes/orders.js'
import { insightRoutes } from './routes/insights.js'
import { adminRoutes } from './routes/admin.js'
import { approvalRoutes } from './routes/approvals.js'

export function createApp(db: Db) {
  const ctx: Ctx = { db, mailer: new Mailer(db), audit: new Audit(db) }
  const inv = new Inventory(db)
  const app = express()
  app.disable('x-powered-by')
  app.use((req, res, next) => { const id = crypto.randomBytes(5).toString('hex'); (req as any).rid = id; res.setHeader('X-Request-Id', id); (req as any).lang = langOf(req.headers['accept-language']); next() })
  app.set('trust proxy', config.trustProxy)
  app.use(helmet({
    contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"], objectSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'self'"], formAction: ["'self'"] } },
    hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },
    referrerPolicy: { policy: 'no-referrer' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
  }))
  app.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()'); next() })
  app.use(express.json({ limit: '200kb', strict: true, type: 'application/json' }))
  app.use('/api', rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: true, legacyHeaders: false, handler: (req, res) => { res.status(429).json({ error: render(T("You're doing that too quickly. Please wait a moment and try again."), (req as any).lang ?? 'en'), code: 'rate_limited' }) } }))

  const auth = authenticate(ctx)
  app.get('/api/health', (_req, res) => res.json({ ok: true }))
  app.use('/api/auth', authRoutes(ctx))
  app.use('/api/users', auth, userRoutes(ctx))
  app.use('/api', auth, masterRoutes(ctx), orderRoutes(ctx, inv), approvalRoutes(ctx, inv), insightRoutes(ctx, inv))
  app.use('/api/admin', auth, adminRoutes(ctx))
  app.use('/api', (_req, _res, next) => next(new AppError(404, T("That page or action doesn't exist."), 'not_found')))

  // Built single-page app (production): same origin => SameSite=Strict cookies and a tight CSP just work.
  if (fs.existsSync(path.join(config.staticDir, 'index.html'))) {
    app.use(express.static(config.staticDir, { index: false, maxAge: '1h', setHeaders: (res, p) => { if (p.endsWith('index.html')) res.setHeader('Cache-Control', 'no-store') } }))
    app.get('*', (_req, res) => res.sendFile(path.join(config.staticDir, 'index.html')))
  }

  app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const lang = (req as any).lang ?? 'en'
    if (err instanceof AppError) return void res.status(err.status).json(err.body(lang))
    if (err instanceof ZodError) { const e = validationError(err); return void res.status(400).json(e.body(lang)) }
    if (err?.type === 'entity.parse.failed') return void res.status(400).json({ error: render(T("We couldn't read that request. Please reload the page and try again."), lang), code: 'bad_request' })
    if (err?.type === 'entity.too.large') return void res.status(413).json({ error: render(T('That request is too large to process. Try sending less at once.'), lang), code: 'too_large' })
    const requestId = (req as any).rid as string
    console.error(`[error] ref=${requestId} ${req.method} ${req.originalUrl.split('?')[0]} - ${err?.message}`) // details stay in the server log, never in the response
    res.status(500).json({ error: render(SERVER_ERROR_MESSAGE, lang), code: 'server_error', requestId })
  })
  return { app, ctx, inv }
}
