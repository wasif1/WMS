import { ts } from '@/i18n'

/** A unit a product can be counted in. The four built-ins are fixed; the super admin can add more. */
export interface Uom { key: string; label: string; short: string; decimals: boolean; builtin: boolean }

export const BUILTIN_UOMS: Uom[] = [
  { key: 'unit', label: ts('Units (whole)'), short: ts('units'), decimals: false, builtin: true },
  { key: 'kg', label: ts('Weight (kg)'), short: ts('kg'), decimals: true, builtin: true },
  { key: 'm', label: ts('Length (m)'), short: ts('m'), decimals: true, builtin: true },
  { key: 'bundle', label: ts('Bundles'), short: ts('bundles'), decimals: false, builtin: true },
]
