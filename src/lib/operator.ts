import type { Product, StockRow } from './types'
import { productLabel, variationOf } from './catalog'

export type TileId = 'inbound' | 'transfer' | 'reserve' | 'outbound' | 'count' | 'fix' | 'newProduct' | 'newLocation' | 'reports'
export interface Tile { id: TileId; title: string; help: string; tone: 'green' | 'sky' | 'amber' | 'indigo' | 'teal' | 'rose' | 'violet' | 'slate' | 'cyan'; perms: string[]; icon: string }

/**
 * The big buttons on the operator screen. Words are deliberately plain and short.
 * A button is shown ONLY if the user holds at least one of its permissions - the server enforces the same rules again.
 */
export const TILES: Tile[] = [
  { id: 'inbound', title: 'Receive stock', help: 'Goods have arrived? Add them here.', tone: 'green', perms: ['inbound.create'], icon: 'download' },
  { id: 'transfer', title: 'Move stock', help: 'Send goods to another warehouse.', tone: 'sky', perms: ['transfers.create'], icon: 'transfer' },
  { id: 'reserve', title: 'Keep stock for a customer', help: 'Put goods aside so nobody else sells them.', tone: 'amber', perms: ['reserves.create'], icon: 'archive' },
  { id: 'outbound', title: 'Send out to a customer', help: 'Goods are leaving the warehouse.', tone: 'indigo', perms: ['outbound.create'], icon: 'outbound' },
  { id: 'count', title: 'Count the stock', help: 'Count what is on the shelves and check it.', tone: 'teal', perms: ['audits.create'], icon: 'count' },
  { id: 'fix', title: 'Fix a stock number', help: 'A number is wrong? Tell us the right one.', tone: 'rose', perms: ['adjustments.create'], icon: 'fix' },
  { id: 'newProduct', title: 'Add a new product', help: 'A product is missing from the list.', tone: 'violet', perms: ['products.create'], icon: 'product' },
  { id: 'newLocation', title: 'Add a new warehouse', help: 'A place is missing from the list.', tone: 'slate', perms: ['locations.manage'], icon: 'place' },
  { id: 'reports', title: 'Stock list & reports', help: 'See and download what we have.', tone: 'cyan', perms: ['reports.inventory', 'reports.orders'], icon: 'report' },
]

export const tilesFor = (can: (...p: string[]) => boolean) => TILES.filter((t) => can(...t.perms))
/** Anything that lets the person submit something the owner must approve -> show "My requests". */
export const SUBMIT_PERMS = ['products.create', 'locations.manage', 'adjustments.create', 'audits.create', 'audits.count']
export const hasOwnerWorkflow = (can: (...p: string[]) => boolean) => can('approvals.manage', ...SUBMIT_PERMS)

/** Search that works the way people think: any word, any order, in name, colour, size, weight, details OR the product code (SKU). */
export function matchProduct(p: Product, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const hay = `${p.name ?? ''} ${variationOf(p)} ${p.weight ?? ''} ${p.description ?? ''} ${p.sku}`.toLowerCase()
  return words.every((w) => hay.includes(w))
}

export interface StockSummary { available: number; onHand: number; boxes: number | null; byLocation: { locationId: number; available: number }[] }
export function summarizeStock(p: Product, rows: StockRow[], locationId?: number): StockSummary {
  const mine = rows.filter((r) => r.productId === p.id && (!locationId || r.locationId === locationId))
  const available = mine.reduce((a, r) => a + r.available, 0)
  return { available, onHand: mine.reduce((a, r) => a + r.onHand, 0), boxes: p.caseSize ? Math.ceil(available / p.caseSize) : null, byLocation: mine.filter((r) => r.available > 0 || r.onHand > 0).map((r) => ({ locationId: r.locationId, available: r.available })) }
}

export { productLabel }
