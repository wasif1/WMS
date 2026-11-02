import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const env = process.env
export const isProd = env.NODE_ENV === 'production'
export const isTest = env.NODE_ENV === 'test'

const dataDir = path.resolve(env.WMS_DATA_DIR ?? path.join(here, '..', 'data'))
fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 })

/** Master key: 32 random bytes, base64. MUST come from a secret manager in production. */
function loadMasterKey(): Buffer {
  if (env.WMS_MASTER_KEY) {
    const k = Buffer.from(env.WMS_MASTER_KEY, 'base64')
    if (k.length !== 32) throw new Error('WMS_MASTER_KEY must be 32 bytes, base64 encoded')
    return k
  }
  if (isProd) throw new Error('WMS_MASTER_KEY is required in production')
  // Development / test only: persist a throw-away key so a dev database stays readable.
  if (isTest) return crypto.randomBytes(32)
  const keyFile = path.join(dataDir, 'dev-master.key')
  if (fs.existsSync(keyFile)) return Buffer.from(fs.readFileSync(keyFile, 'utf8').trim(), 'base64')
  const k = crypto.randomBytes(32)
  fs.writeFileSync(keyFile, k.toString('base64'), { mode: 0o600 })
  console.warn('[config] DEV master key generated at', keyFile, '- never use this in production')
  return k
}

const master = loadMasterKey()
const derive = (info: string) =>
  Buffer.from(crypto.hkdfSync('sha256', master, Buffer.from('wms-v1'), Buffer.from(info), 32))

export const keys = {
  data: derive('data-encryption'),
  index: derive('blind-index'),
  backup: derive('backup-encryption'),
  audit: derive('audit-chain'),
}

export const config = {
  port: Number(env.PORT ?? 4000),
  dataDir,
  dbPath: path.resolve(env.WMS_DB_PATH ?? path.join(dataDir, 'wms.db')),
  backupDir: path.resolve(env.WMS_BACKUP_DIR ?? path.join(dataDir, 'backups')),
  backupKeep: Number(env.WMS_BACKUP_KEEP ?? 3),
  // Weekly, Sunday 02:00 server time. Set to e.g. "0 2 1 * *" for monthly or "0 2 * * *" for daily.
  backupCron: env.WMS_BACKUP_CRON ?? '0 2 * * 0',
  backupEnabled: env.WMS_BACKUP_ENABLED !== 'false' && !isTest,
  allowedOrigin: env.WMS_ORIGIN, // e.g. https://wms.example.com (also used for CSRF origin check)
  trustProxy: env.WMS_TRUST_PROXY ? Number(env.WMS_TRUST_PROXY) : 0,
  secureCookies: isProd || env.WMS_SECURE_COOKIES === 'true',
  sessionIdleMs: Number(env.WMS_SESSION_IDLE_MIN ?? 30) * 60_000,
  sessionMaxMs: Number(env.WMS_SESSION_MAX_HOURS ?? 8) * 3_600_000,
  requireMfa: env.WMS_REQUIRE_MFA === 'true',
  smtpUrl: env.WMS_SMTP_URL,
  mailFrom: env.WMS_MAIL_FROM ?? 'WMS <no-reply@localhost>',
  staticDir: path.resolve(env.WMS_STATIC_DIR ?? path.join(here, '..', '..', 'dist')),
}
