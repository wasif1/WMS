import express from 'express'
import { ZodError } from 'zod'
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
import { AppError } from './errors.js'
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
  app.set('trust proxy', config.trustProxy)
  app.use(helmet({
    contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"], objectSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'self'"], formAction: ["'self'"] } },
    hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },
    referrerPolicy: { policy: 'no-referrer' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
  }))
  app.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()'); next() })
  app.use(express.json({ limit: '200kb', strict: true, type: 'application/json' }))
  app.use('/api', rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: true, legacyHeaders: false }))

  const auth = authenticate(ctx)
  app.get('/api/health', (_req, res) => res.json({ ok: true }))
  app.use('/api/auth', authRoutes(ctx))
  app.use('/api/users', auth, userRoutes(ctx))
  app.use('/api', auth, masterRoutes(ctx), orderRoutes(ctx, inv), approvalRoutes(ctx, inv), insightRoutes(ctx, inv))
  app.use('/api/admin', auth, adminRoutes(ctx))
  app.use('/api', (_req, _res, next) => next(new AppError(404, 'Not found')))

  // Built single-page app (production): same origin => SameSite=Strict cookies and a tight CSP just work.
  if (fs.existsSync(path.join(config.staticDir, 'index.html'))) {
    app.use(express.static(config.staticDir, { index: false, maxAge: '1h', setHeaders: (res, p) => { if (p.endsWith('index.html')) res.setHeader('Cache-Control', 'no-store') } }))
    app.get('*', (_req, res) => res.sendFile(path.join(config.staticDir, 'index.html')))
  }

  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof AppError) return void res.status(err.status).json({ error: err.message, code: err.code })
    if (err instanceof ZodError) return void res.status(400).json({ error: err.issues.map((i) => `${i.path.join('.') || 'request'}: ${i.message}`).join('; ') })
    if (err?.type === 'entity.parse.failed') return void res.status(400).json({ error: 'Malformed JSON' })
    if (err?.type === 'entity.too.large') return void res.status(413).json({ error: 'Payload too large' })
    console.error('[error]', err?.message) // never leak internals / stack to clients
    res.status(500).json({ error: 'Internal server error' })
  })
  return { app, ctx, inv }
}
