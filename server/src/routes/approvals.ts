import { Router, type Request } from 'express'
import { T, statusWord } from '../i18n/index.js'
import { z } from 'zod'
import type { Ctx } from '../context.js'
import { hasPerm, requirePerm } from '../auth.js'
import { blindIndex } from '../crypto.js'
import { conflict, notFound } from '../errors.js'
import { ip, nowIso, wrap } from '../http.js'
import type { Actor, Location, Product, User } from '../models.js'
import { Inventory } from '../inventory.js'
import { idParam, optStr, parse } from '../validation.js'
import { productLabel } from '../catalog.js'

type Kind = 'product' | 'location' | 'adjustment' | 'audit'
const KINDS: Kind[] = ['product', 'location', 'adjustment', 'audit']

/**
 * Owner approval queue. The team submits; nothing goes live (no product, no location, no stock change)
 * until someone holding `approvals.manage` approves it here.
 */
export function approvalRoutes(ctx: Ctx, inv: Inventory) {
  const r = Router()
  const actor = (u: User): Actor => ({ userId: u.id, name: u.name, at: nowIso() })
  const store = (k: Kind) => ({ product: ctx.db.products, location: ctx.db.locations, adjustment: ctx.db.adjustments, audit: ctx.db.audits })[k]
  const locName = (id: number) => (ctx.db.locations.get(id) as Location | undefined)?.name ?? `#${id}`
  const prodLabel = (id: number) => { const p = ctx.db.products.get(id) as Product | undefined; return p ? productLabel(p) : `#${id}` }
  const statusOf = (kind: Kind, o: any): string => {
    if (kind === 'audit') return o.status === 'submitted' ? 'pending' : o.status === 'counting' ? 'draft' : o.status
    return o.status ?? 'approved'
  }
  const submitter = (kind: Kind, o: any): Actor | undefined => (kind === 'adjustment' ? o.by : kind === 'audit' ? o.submittedBy : o.submittedBy)

  /** Structured data only - the screen builds the sentences, so they can be shown in any language. */
  const present = (kind: Kind, o: any) => {
    const base = { type: kind, id: o.id, status: statusOf(kind, o), submittedBy: submitter(kind, o), decidedBy: o.decidedBy, decisionComment: o.decisionComment }
    switch (kind) {
      case 'product': return { ...base, title: productLabel(o), details: { sku: o.sku, description: o.description, color: o.color, size: o.size, weight: o.weight, caseSize: o.caseSize, uom: o.uom } }
      case 'location': return { ...base, title: o.name, details: { address: o.address } }
      case 'adjustment': return { ...base, title: `${prodLabel(o.productId)} @ ${locName(o.locationId)}`, details: { before: o.before, delta: o.delta, newQty: o.newQty, reason: o.reason } }
      case 'audit': {
        const diffs = (o.lines as any[]).filter((l) => l.counted != null && l.counted !== l.system).map((l) => ({ product: prodLabel(l.productId), location: locName(l.locationId), system: l.system, counted: l.counted, delta: l.counted - l.system }))
        return { ...base, title: o.name, details: { differences: diffs, lineCount: o.lines.length } }
      }
    }
  }

  const canSee = requirePerm('approvals.manage', 'products.create', 'locations.manage', 'adjustments.create', 'audits.create', 'audits.count')
  r.get('/approvals', canSee, wrap((req, res) => {
    const q = z.object({ status: z.enum(['pending', 'approved', 'rejected']).optional(), type: z.enum(['product', 'location', 'adjustment', 'audit']).optional() }).parse(req.query)
    const owner = hasPerm(req.user!, 'approvals.manage')
    const out: any[] = []
    for (const k of KINDS) {
      if (q.type && q.type !== k) continue
      for (const o of store(k).all() as any[]) {
        const st = statusOf(k, o)
        if (st === 'draft') continue
        if (q.status && st !== q.status) continue
        if (!owner && submitter(k, o)?.userId !== req.user!.id) continue // team members only see their own requests
        out.push(present(k, o))
      }
    }
    out.sort((a, b) => String(b.submittedBy?.at).localeCompare(String(a.submittedBy?.at)))
    res.json({ owner, pending: out.filter((o) => o.status === 'pending').length, items: out })
  }))

  const decide = (approve: boolean) => wrap((req: Request, res) => {
    const kind = req.params.kind as Kind
    if (!KINDS.includes(kind)) throw notFound('That kind of request')
    const id = idParam(req)
    const o = store(kind).get(id) as any
    if (!o) throw notFound('Request')
    if (statusOf(kind, o) !== 'pending') throw conflict(T("This request has already been decided. Refresh the page to see the latest."), 'already_processed')
    const b = parse(z.object({ comment: approve ? optStr(1000) : z.string().trim().min(1, 'A reason is required').max(1000) }).strict(), req.body)
    const u = req.user!
    const decidedBy = actor(u)
    ctx.db.tx(() => {
      if (approve) {
        if (kind === 'adjustment') {
          // apply the requested CHANGE (not an absolute overwrite) so movements made since the request are not lost
          inv.apply(o.productId, o.locationId, { onHand: o.delta }, { type: 'adjustment', userId: u.id, refType: 'adjustment', refId: id, note: o.reason })
        }
        if (kind === 'audit') {
          const changes: any[] = []
          for (const l of o.lines) {
            const delta = Math.round((l.counted - l.system) * 1000) / 1000
            if (delta !== 0) { inv.apply(l.productId, l.locationId, { onHand: delta }, { type: 'audit', userId: u.id, refType: 'audit', refId: id }); changes.push({ productId: l.productId, locationId: l.locationId, system: l.system, counted: l.counted, delta }) }
          }
          o.changes = changes
        }
      }
      const next = { ...o, decidedBy, decisionComment: b.comment || undefined }
      next.status = kind === 'audit' ? (approve ? 'approved' : 'rejected') : approve ? 'approved' : 'rejected'
      // blind-index columns must be preserved on update
      const idx: Record<string, string> = kind === 'product' ? { sku_idx: blindIndex(o.sku, 'sku') } : {}
      store(kind).update(id, next, idx)
    })
    ctx.audit.log(u, `${kind}.${approve ? 'approve' : 'reject'}`, { entity: kind, entityId: id, detail: b.comment || undefined, ip: ip(req) })
    if (kind === 'audit' && approve) {
      const s = ctx.db.settings.all().find((x: any) => 'auditEmails' in x) as any
      ctx.mailer.send([...(s?.auditEmails ?? []), u.email], `Inventory audit "${o.name}" approved`, `Audit "${o.name}" was approved by ${u.name} (${nowIso()}).\n\n${(store('audit').get(id) as any).changes.map((c: any) => `  - ${prodLabel(c.productId)} @ ${locName(c.locationId)}: system ${c.system} -> counted ${c.counted} (${c.delta > 0 ? '+' : ''}${c.delta})`).join('\n') || 'No differences.'}\n`)
    }
    res.json(present(kind, store(kind).get(id)))
  })
  r.post('/approvals/:kind/:id/approve', requirePerm('approvals.manage'), decide(true))
  r.post('/approvals/:kind/:id/reject', requirePerm('approvals.manage'), decide(false))
  return r
}
