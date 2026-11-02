import crypto from 'node:crypto'
import type { Db } from './db.js'
import { keys } from './config.js'

export interface LogEntry {
  at: string
  userId: number | null
  userName: string
  action: string
  entity?: string
  entityId?: number
  detail?: string
  ip?: string
  prev: string
  hash: string
}

/** Append-only activity log. Each entry carries an HMAC chained to the previous one, so tampering/deletion is detectable. */
export class Audit {
  constructor(private db: Db) {}
  private hashOf(e: Omit<LogEntry, 'hash'>) {
    return crypto.createHmac('sha256', keys.audit).update(JSON.stringify(e)).digest('hex')
  }
  log(user: { id: number; name: string } | null, action: string, o: { entity?: string; entityId?: number; detail?: string; ip?: string } = {}) {
    this.db.tx(() => {
      const prev = this.db.audit_logs.last()?.hash ?? 'GENESIS'
      const base = { at: new Date().toISOString(), userId: user?.id ?? null, userName: user?.name ?? 'anonymous', action, ...o, prev }
      this.db.audit_logs.insert({ ...base, hash: this.hashOf(base) })
    })
  }
  verify(): { ok: boolean; checked: number; brokenAtId?: number } {
    let prev = 'GENESIS'
    const rows = this.db.audit_logs.all()
    for (const r of rows) {
      const { hash, ...rest } = r as LogEntry & { id: number }
      const { id, ...base } = rest as any
      if (base.prev !== prev || this.hashOf(base) !== hash) return { ok: false, checked: rows.length, brokenAtId: id }
      prev = hash
    }
    return { ok: true, checked: rows.length }
  }
  list(limit: number, offset: number) {
    const all = this.db.audit_logs.all().reverse()
    return { total: all.length, items: all.slice(offset, offset + limit) }
  }
}
