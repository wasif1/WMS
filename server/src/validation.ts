import { z } from 'zod'
import type { Request } from 'express'
import { bad, type FieldError } from './errors.js'

const LABELS: Record<string, string> = {
  productId: 'Product', locationId: 'Location', fromLocationId: 'Source location', toLocationId: 'Destination location', clientId: 'Client',
  newQty: 'Correct physical quantity', reason: 'Reason', comment: 'Comment', comments: 'Comments', note: 'Note', name: 'Name', email: 'Email',
  password: 'Password', currentPassword: 'Current password', newPassword: 'New password', caseSize: 'Case pack', reorderLevel: 'Reorder level',
  cases: 'Cases', loose: 'Loose units', lines: 'Products', counts: 'Counts', counted: 'Count', address: 'Address', contact: 'Contact', role: 'Role',
  permissions: 'Permissions', uom: 'Measured by', weight: 'Weight', size: 'Size', color: 'Colour', description: 'Details', reference: 'Reference',
  notifyEmails: 'Notification emails', auditEmails: 'Audit emails', code: 'Code', period: 'Period', status: 'Status', type: 'Type',
}
const humanize = (k: string) => LABELS[k] ?? k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase())

/** "lines.0.loose" -> "Products, line 1, Loose units" */
export function fieldLabel(path: ReadonlyArray<PropertyKey>): string {
  const parts: string[] = []
  for (const seg of path) parts.push(typeof seg === 'number' ? `line ${seg + 1}` : humanize(String(seg)))
  return parts.join(', ') || 'Request'
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

/** Turn one zod issue into a plain sentence fragment: "must be at least 3 characters". */
function describe(i: any): string {
  switch (i.code) {
    case 'invalid_type': {
      if (/received undefined|received null|Required/i.test(i.message ?? '')) return 'is required'
      const t: Record<string, string> = { string: 'text', number: 'a number', boolean: 'yes or no', array: 'a list', object: 'an object' }
      return `must be ${t[i.expected] ?? i.expected}`
    }
    case 'too_small':
      if (i.origin === 'string') return i.minimum === 1 ? 'cannot be empty' : `must be at least ${plural(Number(i.minimum), 'character')}`
      if (i.origin === 'array') return i.minimum === 1 ? 'needs at least one item' : `needs at least ${plural(Number(i.minimum), 'item')}`
      return i.inclusive === false ? `must be greater than ${i.minimum}` : `must be ${i.minimum} or more`
    case 'too_big':
      if (i.origin === 'string') return `must be at most ${plural(Number(i.maximum), 'character')}`
      if (i.origin === 'array') return `can have at most ${plural(Number(i.maximum), 'item')}`
      return i.inclusive === false ? `must be less than ${i.maximum}` : `must be ${i.maximum} or less`
    case 'invalid_format': return i.format === 'email' ? 'must be a valid email address' : 'is not in the expected format'
    case 'invalid_value': return Array.isArray(i.values) ? `must be one of: ${i.values.join(', ')}` : 'has an invalid choice'
    case 'unrecognized_keys': return `contains fields that are not allowed (${(i.keys ?? []).join(', ')})`
    case 'not_multiple_of': return `must be a multiple of ${i.divisor}`
    default: return i.message ?? 'is not valid'
  }
}

export function zodToFields(err: z.ZodError): FieldError[] {
  return err.issues.map((i) => {
    const label = fieldLabel(i.path)
    const text = describe(i)
    // keep sentences natural: "Reason must be at least 3 characters." / "Request contains fields that are not allowed (x)."
    return { field: i.path.map(String).join('.') || 'request', message: `${label} ${text}` }
  })
}

export function validationError(err: z.ZodError) {
  const fields = zodToFields(err)
  const summary = fields.length === 1 ? `${fields[0].message}.` : `Please fix ${fields.length} things: ${fields.map((f) => f.message).join('; ')}.`
  return bad(summary, 'validation', fields)
}

export function parse<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data)
  if (!r.success) throw validationError(r.error)
  return r.data
}
export const idParam = (req: Request, name = 'id') => {
  const n = Number(req.params[name])
  if (!Number.isInteger(n) || n < 1) throw bad('That link is not valid. Go back and try again.', 'bad_id')
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
  const field = (m: string) => bad(m, 'weak_password', [{ field: 'newPassword', message: m }])
  if (!password.safeParse(pw).success) throw field(pw.length > 128 ? 'Password must be 128 characters or fewer.' : 'Password must be at least 12 characters long.')
  const lower = pw.toLowerCase()
  if (COMMON.some((c) => lower.includes(c))) throw field('That password is too easy to guess. Choose something less common.')
  const local = ctx.email?.split('@')[0]?.toLowerCase()
  if (local && local.length >= 4 && lower.includes(local)) throw field('Your password should not contain your email name.')
  if (new Set(pw).size < 6) throw field('That password repeats the same characters too much. Use a wider mix.')
  if (!/[a-z]/i.test(pw) || !/[0-9\W_]/.test(pw)) throw field('Use letters plus at least one number or symbol.')
}
