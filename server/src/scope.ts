import { T } from './i18n/index.js'
import { forbidden } from './errors.js'
import type { User } from './models.js'

/** Which locations a person may use: null = all of them (super admins, and anyone a super admin has not restricted). */
export const scopeOf = (u: User): Set<number> | null => (u.role === 'super_admin' || !u.locationIds ? null : new Set(u.locationIds))
export const canLoc = (u: User, id?: number): boolean => { const s = scopeOf(u); return !s || (id !== undefined && s.has(id)) }
export const assertLoc = (u: User, id?: number) => {
  if (!canLoc(u, id)) throw forbidden(T("You don't have access to this location. Ask a super admin to give you access."), 'location_denied')
}
/** An audit covers many lines; a restricted person can only work with one whose every line is at a location they may use. */
export const canAudit = (u: User, a: { lines: { locationId: number }[] }) => { const s = scopeOf(u); return !s || a.lines.every((l) => s.has(l.locationId)) }
