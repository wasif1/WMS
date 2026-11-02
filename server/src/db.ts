import { createRequire } from 'node:module'
import type { DatabaseSync as DB } from 'node:sqlite'
// loaded via require: bundlers (vite/vitest) do not yet know the `node:sqlite` builtin
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite')
type DatabaseSync = DB
import fs from 'node:fs'
import { config } from './config.js'
import { decryptJson, encryptJson } from './crypto.js'

/**
 * Every business table has the same shape: an integer id, an AES-256-GCM encrypted JSON `data` blob,
 * and optionally keyed-hash ("blind index") columns for equality lookups. No business value is stored in clear.
 */
const TABLES: Record<string, string[]> = {
  users: ['email_idx'],
  sessions: ['token_idx'],
  locations: [],
  products: ['sku_idx'],
  clients: [],
  stock: ['key_idx'],
  movements: ['product_idx'],
  inbound_orders: [],
  transfer_orders: [],
  reserve_orders: [],
  outbound_orders: [],
  adjustments: [],
  audits: [],
  audit_logs: [],
  outbox: [],
  settings: ['key_idx'],
}

class Store<T extends object = any> {
  constructor(private sql: DatabaseSync, public table: string) {}
  private aad(id: number | bigint) { return `${this.table}:${id}` }
  private get cols() { return TABLES[this.table] }
  insert(obj: T, idx: Record<string, string> = {}): T & { id: number } {
    const names = this.cols.filter((c) => c in idx)
    const placeholders = ['?', ...names.map(() => '?')].join(',')
    const r = this.sql
      .prepare(`INSERT INTO ${this.table} (${['data', ...names].join(',')}) VALUES (${placeholders})`)
      .run(Buffer.alloc(0), ...names.map((c) => idx[c]))
    const id = Number(r.lastInsertRowid)
    this.sql.prepare(`UPDATE ${this.table} SET data = ? WHERE id = ?`).run(encryptJson(obj, this.aad(id)), id)
    return { ...obj, id }
  }
  update(id: number, obj: T, idx: Record<string, string> = {}) {
    const names = this.cols.filter((c) => c in idx)
    this.sql
      .prepare(`UPDATE ${this.table} SET ${['data = ?', ...names.map((c) => `${c} = ?`)].join(', ')} WHERE id = ?`)
      .run(encryptJson(obj, this.aad(id)), ...names.map((c) => idx[c]), id)
  }
  private row(r: { id: number; data: Uint8Array }): T & { id: number } {
    return { ...decryptJson<T>(r.data, this.aad(r.id)), id: r.id }
  }
  get(id: number) {
    const r = this.sql.prepare(`SELECT id, data FROM ${this.table} WHERE id = ?`).get(id) as any
    return r ? this.row(r) : undefined
  }
  byIdx(col: string, val: string) {
    if (!this.cols.includes(col)) throw new Error('not an index column')
    const r = this.sql.prepare(`SELECT id, data FROM ${this.table} WHERE ${col} = ?`).get(val) as any
    return r ? this.row(r) : undefined
  }
  allByIdx(col: string, val: string) {
    if (!this.cols.includes(col)) throw new Error('not an index column')
    return (this.sql.prepare(`SELECT id, data FROM ${this.table} WHERE ${col} = ? ORDER BY id`).all(val) as any[]).map((r) => this.row(r))
  }
  all() {
    return (this.sql.prepare(`SELECT id, data FROM ${this.table} ORDER BY id`).all() as any[]).map((r) => this.row(r))
  }
  last() {
    const r = this.sql.prepare(`SELECT id, data FROM ${this.table} ORDER BY id DESC LIMIT 1`).get() as any
    return r ? this.row(r) : undefined
  }
  delete(id: number) {
    this.sql.prepare(`DELETE FROM ${this.table} WHERE id = ?`).run(id)
  }
  count() {
    return (this.sql.prepare(`SELECT COUNT(*) c FROM ${this.table}`).get() as any).c as number
  }
}


export type TableName = 'users'|'sessions'|'locations'|'products'|'clients'|'stock'|'movements'|'inbound_orders'|'transfer_orders'|'reserve_orders'|'outbound_orders'|'adjustments'|'audits'|'audit_logs'|'outbox'|'settings'
export type Db = ReturnType<typeof openDb>

export function openDb(path = config.dbPath) {
  if (path !== ':memory:' && !fs.existsSync(path)) fs.closeSync(fs.openSync(path, 'a', 0o600))
  const sql = new DatabaseSync(path)
  sql.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA secure_delete = ON;')
  for (const [t, idx] of Object.entries(TABLES)) {
    const cols = idx.map((c) => `, ${c} TEXT`).join('')
    sql.exec(`CREATE TABLE IF NOT EXISTS ${t} (id INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL${cols})`)
    for (const c of idx) sql.exec(`CREATE ${c === 'product_idx' ? '' : 'UNIQUE'} INDEX IF NOT EXISTS ${t}_${c} ON ${t}(${c})`)
  }

  const stores = Object.fromEntries(Object.keys(TABLES).map((t) => [t, new Store<any>(sql, t)])) as Record<TableName, Store<any>>

  let depth = 0
  /** Run fn atomically. Nested calls join the outer transaction. node:sqlite is synchronous so this is race-free. */
  function tx<R>(fn: () => R): R {
    if (depth > 0) return fn()
    sql.exec('BEGIN IMMEDIATE')
    depth++
    try {
      const r = fn()
      sql.exec('COMMIT')
      return r
    } catch (e) {
      sql.exec('ROLLBACK')
      throw e
    } finally {
      depth--
    }
  }

  return { sql, ...stores, tx }
}
