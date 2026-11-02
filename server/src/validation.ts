import { z } from 'zod'
import type { Request } from 'express'
import { bad } from './errors.js'

export function parse<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data)
  if (!r.success) throw bad(r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '))
  return r.data
}
export const idParam = (req: Request, name = 'id') => {
  const n = Number(req.params[name])
  if (!Number.isInteger(n) || n < 1) throw bad('Invalid id')
  return n
}
export const str = (max = 200) => z.string().trim().min(1).max(max)
export const optStr = (max = 500) => z.string().trim().max(max).optional().default('')
export const qty = z.number().finite().nonnegative().max(1_000_000_000)
export const lineInput = z
  .object({ productId: z.number().int().positive(), cases: qty.optional(), loose: qty.optional() })
  .strict()
export const lines = z.array(lineInput).min(1).max(500)
export const emails = z.array(z.string().trim().email().max(254)).max(20)

const password = z.string().min(12, 'Password must be at least 12 characters').max(128)
const COMMON = ['password1234', '123456789012', 'qwertyuiopas', 'letmein12345', 'welcome12345', 'administrator', 'warehouse1234']
export function checkPassword(pw: string, ctx: { email?: string; name?: string } = {}) {
  parse(password, pw)
  const lower = pw.toLowerCase()
  if (COMMON.some((c) => lower.includes(c))) throw bad('Password is too common')
  const local = ctx.email?.split('@')[0]?.toLowerCase()
  if (local && local.length >= 4 && lower.includes(local)) throw bad('Password must not contain your email name')
  if (new Set(pw).size < 6) throw bad('Password is too repetitive')
  if (!/[a-z]/i.test(pw) || !/[0-9\W_]/.test(pw)) throw bad('Use letters plus at least one number or symbol')
}
