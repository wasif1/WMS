import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createRequire } from 'node:module'
import type { DatabaseSync as DB } from 'node:sqlite'
// loaded via require: bundlers (vite/vitest) do not yet know the `node:sqlite` builtin
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite')
type DatabaseSync = DB
import cron from 'node-cron'
import { config, keys } from './config.js'
import type { Db } from './db.js'
import type { Audit } from './audit.js'

const MAGIC = Buffer.from('WMSBK1')
const NAME = /^wms-\d{8}-\d{6}\.db\.enc$/

/** Encrypts `src` to `dest`: MAGIC | iv(12) | AES-256-GCM ciphertext | tag(16). Uses a key separate from the data key. */
export async function encryptFile(src: string, dest: string) {
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', keys.backup, iv)
  c.setAAD(MAGIC)
  const out = fs.createWriteStream(dest, { mode: 0o600 })
  out.write(Buffer.concat([MAGIC, iv]))
  await new Promise<void>((res, rej) => {
    const rs = fs.createReadStream(src)
    rs.on('error', rej); c.on('error', rej); out.on('error', rej)
    c.on('end', () => out.end(c.getAuthTag()))
    out.on('finish', () => res())
    rs.pipe(c).pipe(out, { end: false })
  })
}

export async function decryptFile(src: string, dest: string) {
  const size = fs.statSync(src).size
  if (size < MAGIC.length + 28) throw new Error('Backup file is truncated')
  const fd = fs.openSync(src, 'r')
  const head = Buffer.alloc(MAGIC.length + 12), tag = Buffer.alloc(16)
  fs.readSync(fd, head, 0, head.length, 0)
  fs.readSync(fd, tag, 0, 16, size - 16)
  fs.closeSync(fd)
  if (!head.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Not a WMS backup')
  const d = crypto.createDecipheriv('aes-256-gcm', keys.backup, head.subarray(MAGIC.length))
  d.setAAD(MAGIC); d.setAuthTag(tag)
  await pipeline(fs.createReadStream(src, { start: head.length, end: size - 17 }), d, fs.createWriteStream(dest, { mode: 0o600 }))
}

export function listBackups() {
  if (!fs.existsSync(config.backupDir)) return []
  return fs.readdirSync(config.backupDir).filter((f) => NAME.test(f)).sort().reverse()
    .map((f) => { const s = fs.statSync(path.join(config.backupDir, f)); return { file: f, bytes: s.size, createdAt: s.mtime.toISOString() } })
}

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)

/** Consistent snapshot (VACUUM INTO) -> encrypt -> verify by decrypting + integrity_check -> prune to the newest N. */
export async function runBackup(db: Db): Promise<{ file: string; bytes: number }> {
  fs.mkdirSync(config.backupDir, { recursive: true, mode: 0o700 })
  const tmp = path.join(config.backupDir, `.tmp-${crypto.randomUUID()}`)
  const file = `wms-${stamp()}.db.enc`
  const dest = path.join(config.backupDir, file)
  try {
    db.sql.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`)
    await encryptFile(tmp, dest)
    const check = tmp + '.chk'
    await decryptFile(dest, check)
    const v = new DatabaseSync(check, { readOnly: true })
    const res = (v.prepare('PRAGMA integrity_check').get() as any).integrity_check
    v.close()
    fs.rmSync(check, { force: true })
    if (res !== 'ok') throw new Error('Backup failed integrity check: ' + res)
  } catch (e) {
    fs.rmSync(dest, { force: true })
    throw e
  } finally {
    fs.rmSync(tmp, { force: true })
  }
  for (const old of listBackups().slice(config.backupKeep)) fs.rmSync(path.join(config.backupDir, old.file), { force: true })
  return { file, bytes: fs.statSync(dest).size }
}

export function scheduleBackups(db: Db, audit: Audit) {
  if (!config.backupEnabled) return
  if (!cron.validate(config.backupCron)) throw new Error('Invalid WMS_BACKUP_CRON')
  cron.schedule(config.backupCron, () => {
    runBackup(db)
      .then((b) => { console.log('[backup] created', b.file); audit.log(null, 'backup.scheduled', { detail: b.file }) })
      .catch((e) => { console.error('[backup] FAILED', e); audit.log(null, 'backup.failed', { detail: String(e?.message).slice(0, 200) }) })
  })
  console.log(`[backup] scheduled "${config.backupCron}", keeping last ${config.backupKeep}`)
}
