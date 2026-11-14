import type { Product } from './types'

export const variationOf = (p: Pick<Product, 'color' | 'size'>) => [p.color, p.size].filter(Boolean).join(' · ')
/** Staff search and pick products by NAME + variation. The SKU is only for records and analysis. */
export const productLabel = (p: Partial<Product>) => [p.name || p.sku || 'Unnamed product', variationOf(p as Product)].filter(Boolean).join(' - ')
