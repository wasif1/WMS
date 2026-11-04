import { z } from 'zod'
import type { Request } from 'express'
import { bad, type FieldError } from './errors.js'
import { T, list, type Msg } from './i18n/index.js'

const LABELS: Record<string, string> = {
  productId: 'Product', locationId: 'Location', fromLocationId: 'Source location', toLocationId: 'Destination location', clientId: 'Client',
  newQty: 'Correct physical quantity', reason: 'Reason', comment: 'Comment', comments: 'Comments', note: 'Note', name: 'Name', email: 'Email',
  password: 'Password', currentPassword: 'Current password', newPassword: 'New password', caseSize: 'Case pack', reorderLevel: 'Reorder level',
  cases: 'Cases', loose: 'Loose units', lines: 'Products', counts: 'Counts', counted: 'Count', address: 'Address', contact: 'Contact', role: 'Role',
  permissions: 'Permissions', uom: 'Measured by', weight: 'Weight', size: 'Size', color: 'Colour', description: 'Details', reference: 'Reference',
  notifyEmails: 'Notification emails', language: 'Language', auditEmails: 'Audit emails', code: 'Code', period: 'Period', status: 'Status', type: 'Type',
}
const humanize = (k: string) => LABELS[k] ?? k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase())

/** "lines.0.loose" -> "Products, line 1, Loose units" */
/** "lines.0.loose" -> Msg "Products, line 1, Loose units" */
export function fieldLabel(path: ReadonlyArray<PropertyKey>): Msg {
  if (!path.length) return T('Request')
  return T('{list}', { list: list(path.map((seg) => (typeof seg === 'number' ? T('line {n}', { n: seg + 1 }) : T(humanize(String(seg))))), ', ') })
}

const plural = (n: number, one: string, many: string) => T(n === 1 ? one : many, { n })

/** Turn one zod issue into a message: "{label} must be at least 3 characters". */
function describe(i: any, label: Msg): Msg {
  switch (i.code) {
    case 'invalid_type': {
      if (/received undefined|received null|Required/i.test(i.message ?? '')) return T('{label} is required', { label })
      switch (i.expected) {
        case 'string': return T('{label} must be text', { label })
        case 'number': return T('{label} must be a number', { label })
        case 'boolean': return T('{label} must be yes or no', { label })
        case 'array': return T('{label} must be a list', { label })
        case 'object': return T('{label} must be an object', { label })
        default: return T('{label} is not valid', { label })
      }
    }
    case 'too_small':
      if (i.origin === 'string') return i.minimum === 1 ? T('{label} cannot be empty', { label }) : T('{label} must be at least {n} characters', { label, n: Number(i.minimum) })
      if (i.origin === 'array') return i.minimum === 1 ? T('{label} needs at least one item', { label }) : T('{label} needs at least {n} items', { label, n: Number(i.minimum) })
      return i.inclusive === false ? T('{label} must be greater than {n}', { label, n: String(i.minimum) }) : T('{label} must be {n} or more', { label, n: String(i.minimum) })
    case 'too_big':
      if (i.origin === 'string') return T('{label} must be at most {n} characters', { label, n: Number(i.maximum) })
      if (i.origin === 'array') return T('{label} can have at most {n} items', { label, n: Number(i.maximum) })
      return i.inclusive === false ? T('{label} must be less than {n}', { label, n: String(i.maximum) }) : T('{label} must be {n} or less', { label, n: String(i.maximum) })
    case 'invalid_format': return i.format === 'email' ? T('{label} must be a valid email address', { label }) : T('{label} is not in the expected format', { label })
    case 'invalid_value': return Array.isArray(i.values) ? T('{label} must be one of: {list}', { label, list: list(i.values.map(String), ', ') }) : T('{label} has an invalid choice', { label })
    case 'unrecognized_keys': return T('{label} contains fields that are not allowed ({list})', { label, list: list((i.keys ?? []).map(String), ', ') })
    case 'not_multiple_of': return T('{label} must be a multiple of {n}', { label, n: String(i.divisor) })
    default: return T('{label} is not valid', { label })
  }
}
void plural

export function zodToFields(err: z.ZodError): FieldError[] {
  return err.issues.map((i) => ({ field: i.path.map(String).join('.') || 'request', message: describe(i, fieldLabel(i.path)) }))
}

export function validationError(err: z.ZodError) {
  const fields = zodToFields(err)
  const summary = fields.length === 1 ? T('{msg}.', { msg: fields[0].message as Msg }) : T('Please fix {n} things: {list}.', { n: fields.length, list: list(fields.map((f) => f.message as Msg), '; ') })
  return bad(summary, 'validation', fields)
}

export function parse<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data)
  if (!r.success) throw validationError(r.error)
  return r.data
}
export const idParam = (req: Request, name = 'id') => {
  const n = Number(req.params[name])
  if (!Number.isInteger(n) || n < 1) throw bad(T('That link is not valid. Go back and try again.'), 'bad_id')
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
  const weak = (m: Msg) => bad(m, 'weak_password', [{ field: 'newPassword', message: m }])
  if (!password.safeParse(pw).success) throw weak(pw.length > 128 ? T('Password must be 128 characters or fewer.') : T('Password must be at least 12 characters long.'))
  const lower = pw.toLowerCase()
  if (COMMON.some((c) => lower.includes(c))) throw weak(T('That password is too easy to guess. Choose something less common.'))
  const local = ctx.email?.split('@')[0]?.toLowerCase()
  if (local && local.length >= 4 && lower.includes(local)) throw weak(T('Your password should not contain your email name.'))
  if (new Set(pw).size < 6) throw weak(T('That password repeats the same characters too much. Use a wider mix.'))
  if (!/[a-z]/i.test(pw) || !/[0-9\W_]/.test(pw)) throw weak(T('Use letters plus at least one number or symbol.'))
}
