import type { Product } from './models.js'

/** Records created before the approval workflow existed have no status and are treated as approved. */
export const isApproved = (x: { status?: string }) => (x.status ?? 'approved') === 'approved'
export const variationOf = (p: Pick<Product, 'color' | 'size'>) => [p.color, p.size].filter(Boolean).join(' · ')
/** Human label used everywhere instead of the SKU: "Cotton T-Shirt - Black · L". */
export const productLabel = (p: Partial<Product>) => {
  const v = variationOf(p as Product)
  return [p.name || p.sku || 'Unnamed product', v].filter(Boolean).join(' - ')
}
