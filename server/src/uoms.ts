import type { Db } from './db.js'

/** A unit a product can be counted in. Built-ins are fixed; the super admin can add more. */
export interface Uom { key: string; label: string; short: string; decimals: boolean; builtin: boolean }

export const BUILTIN_UOMS: Uom[] = [
  { key: 'unit', label: 'Units (whole)', short: 'units', decimals: false, builtin: true },
  { key: 'kg', label: 'Weight (kg)', short: 'kg', decimals: true, builtin: true },
  { key: 'm', label: 'Length (m)', short: 'm', decimals: true, builtin: true },
  { key: 'bundle', label: 'Bundles', short: 'bundles', decimals: false, builtin: true },
]

type Row = { id: number; uoms: Omit<Uom, 'builtin'>[] }
const row = (db: Db) => (db.settings.all() as any[]).find((s) => 'uoms' in s) as Row | undefined
/** Stored rows only (no `builtin` flag). */
export const customUoms = (db: Db): Omit<Uom, 'builtin'>[] => row(db)?.uoms ?? []
export const listUoms = (db: Db): Uom[] => [...BUILTIN_UOMS, ...customUoms(db).map((u) => ({ ...u, builtin: false }))]
export const uomOf = (db: Db, key: string) => listUoms(db).find((u) => u.key === key)
export function saveCustomUoms(db: Db, list: Omit<Uom, 'builtin'>[]) {
  const r = row(db)
  if (r) db.settings.update(r.id, { uoms: list }, { key_idx: 'uoms' }); else db.settings.insert({ uoms: list }, { key_idx: 'uoms' })
}
/** URL-safe key from the name; stays unique and never collides with a built-in. */
export function uomKey(db: Db, name: string) {
  const base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'unit'
  const taken = new Set(listUoms(db).map((u) => u.key))
  let key = base, n = 2
  while (taken.has(key)) key = `${base}-${n++}`
  return key
}
