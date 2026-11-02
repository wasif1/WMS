import { Router } from 'express'
import { z } from 'zod'
import type { Ctx } from '../context.js'
import { requirePerm, requireSuper } from '../auth.js'
import { config } from '../config.js'
import { runBackup, listBackups } from '../backup.js'
import { ip, page, wrap } from '../http.js'
import { emails, parse } from '../validation.js'

export function adminRoutes(ctx: Ctx) {
  const r = Router()
  r.get('/logs', requirePerm('logs.view'), wrap((req, res) => { const p = page(req); res.json(ctx.audit.list(p.limit, p.offset)) }))
  r.get('/logs/verify', requirePerm('logs.view'), wrap((_req, res) => res.json(ctx.audit.verify())))

  const settingRow = () => (ctx.db.settings.all() as any[]).find((s) => 'auditEmails' in s)
  r.get('/settings', requireSuper, wrap((_req, res) => res.json({ auditEmails: settingRow()?.auditEmails ?? [], backupCron: config.backupCron, backupKeep: config.backupKeep, mfaRequired: config.requireMfa, smtpConfigured: !!config.smtpUrl })))
  r.put('/settings', requireSuper, wrap((req, res) => {
    const b = parse(z.object({ auditEmails: emails }).strict(), req.body)
    const row = settingRow()
    if (row) ctx.db.settings.update(row.id, { auditEmails: b.auditEmails }); else ctx.db.settings.insert({ auditEmails: b.auditEmails }, { key_idx: 'audit-emails' })
    ctx.audit.log(req.user!, 'settings.update', { ip: ip(req) })
    res.json({ ok: true })
  }))
  r.get('/outbox', requireSuper, wrap((_req, res) => res.json((ctx.db.outbox.all() as any[]).reverse().slice(0, 100))))

  r.get('/backups', requireSuper, wrap((_req, res) => res.json({ cron: config.backupCron, keep: config.backupKeep, items: listBackups() })))
  r.post('/backups', requireSuper, wrap(async (req, res) => {
    const b = await runBackup(ctx.db)
    ctx.audit.log(req.user!, 'backup.manual', { detail: b.file, ip: ip(req) })
    res.status(201).json(b)
  }))
  return r
}
