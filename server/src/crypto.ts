import crypto from 'node:crypto'
import { keys } from './config.js'

/**
 * Field/row encryption: AES-256-GCM, random 96-bit IV per write.
 * Layout: [ver 1B][keyId 1B][iv 12B][tag 16B][ciphertext]
 * `aad` binds ciphertext to its table+row so rows cannot be swapped around by someone with file access.
 */
const VER = 1
const KEY_ID = 1

export function encrypt(plain: Buffer | string, aad: string): Buffer {
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', keys.data, iv)
  c.setAAD(Buffer.from(aad))
  const ct = Buffer.concat([c.update(plain), c.final()])
  return Buffer.concat([Buffer.from([VER, KEY_ID]), iv, c.getAuthTag(), ct])
}

export function decrypt(blob: Uint8Array, aad: string): Buffer {
  const b = Buffer.from(blob)
  if (b[0] !== VER || b[1] !== KEY_ID) throw new Error('unsupported ciphertext version/key')
  const d = crypto.createDecipheriv('aes-256-gcm', keys.data, b.subarray(2, 14))
  d.setAAD(Buffer.from(aad))
  d.setAuthTag(b.subarray(14, 30))
  return Buffer.concat([d.update(b.subarray(30)), d.final()])
}

export const encryptJson = (v: unknown, aad: string) => encrypt(JSON.stringify(v), aad)
export const decryptJson = <T>(blob: Uint8Array, aad: string): T =>
  JSON.parse(decrypt(blob, aad).toString('utf8')) as T

/** Deterministic keyed hash so we can look rows up (email, token, SKU) without storing them in clear. */
export const blindIndex = (value: string | number, scope = ''): string =>
  crypto.createHmac('sha256', keys.index).update(`${scope}\0${String(value).trim().toLowerCase()}`).digest('hex')

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url')

export function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest()
  const hb = crypto.createHash('sha256').update(b).digest()
  return crypto.timingSafeEqual(ha, hb)
}

// ---- Password hashing: scrypt (OWASP-accepted), N=2^17 -------------------------------------
const SCRYPT = { N: 1 << 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }
const scrypt = (pw: string, salt: Buffer, opts = SCRYPT) =>
  new Promise<Buffer>((res, rej) =>
    crypto.scrypt(pw.normalize('NFKC'), salt, 64, opts, (e, k) => (e ? rej(e) : res(k))),
  )

export async function hashPassword(pw: string): Promise<string> {
  const salt = crypto.randomBytes(16)
  const dk = await scrypt(pw, salt)
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${dk.toString('base64')}`
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, N, r, p, salt, hash] = stored.split('$')
  if (alg !== 'scrypt') return false
  const dk = await scrypt(pw, Buffer.from(salt, 'base64'), { N: +N, r: +r, p: +p, maxmem: SCRYPT.maxmem })
  const want = Buffer.from(hash, 'base64')
  return dk.length === want.length && crypto.timingSafeEqual(dk, want)
}

// A real hash of a random password, used to equalise timing for unknown users.
export const dummyHash = hashPassword(randomToken())

// ---- TOTP (RFC 6238, SHA-1, 6 digits, 30s) ---------------------------------------------------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
export function base32Encode(buf: Buffer): string {
  let bits = 0, val = 0, out = ''
  for (const byte of buf) {
    val = (val << 8) | byte; bits += 8
    while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5 }
  }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31]
  return out
}
export function base32Decode(s: string): Buffer {
  let bits = 0, val = 0
  const out: number[] = []
  for (const ch of s.replace(/=+$/, '').toUpperCase()) {
    const i = B32.indexOf(ch)
    if (i < 0) throw new Error('bad base32')
    val = (val << 5) | i; bits += 5
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8 }
  }
  return Buffer.from(out)
}
export const newTotpSecret = () => base32Encode(crypto.randomBytes(20))
function hotp(secret: string, counter: number): string {
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(counter))
  const h = crypto.createHmac('sha1', base32Decode(secret)).update(msg).digest()
  const o = h[h.length - 1] & 15
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]
  return String(n % 1_000_000).padStart(6, '0')
}
/** Returns the matched time-step (for replay protection) or null. */
export function verifyTotp(secret: string, code: string, now = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null
  const step = Math.floor(now / 30_000)
  for (const d of [0, -1, 1]) if (safeEqual(hotp(secret, step + d), code)) return step + d
  return null
}
export const totpNow = (secret: string, now = Date.now()) => hotp(secret, Math.floor(now / 30_000))
