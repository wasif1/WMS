import type { Db } from './db.js'
import type { Line, Movement, Product, Stock } from './models.js'
import { blindIndex } from './crypto.js'
import { bad, conflict, notFound } from './errors.js'
import { isApproved, productLabel } from './catalog.js'

export const stockKey = (p: number, l: number) => blindIndex(`${p}:${l}`, 'stock')
const r3 = (n: number) => Math.round(n * 1000) / 1000

export class Inventory {
  constructor(private db: Db) {}

  getStock(productId: number, locationId: number): Stock {
    const k = stockKey(productId, locationId)
    return (
      this.db.stock.byIdx('key_idx', k) ??
      this.db.stock.insert({ productId, locationId, onHand: 0, reserved: 0 }, { key_idx: k })
    )
  }

  /** Apply deltas atomically, enforcing 0 <= reserved <= onHand, and write an immutable movement row. */
  apply(
    productId: number, locationId: number, d: { onHand?: number; reserved?: number },
    m: { type: Movement['type']; userId: number; refType?: string; refId?: number; note?: string },
  ) {
    return this.db.tx(() => {
      const s = this.getStock(productId, locationId)
      const onHand = r3(s.onHand + (d.onHand ?? 0))
      const reserved = r3(s.reserved + (d.reserved ?? 0))
      if (onHand < 0) throw conflict('Insufficient stock on hand')
      if (reserved < 0) throw conflict('Reserved quantity cannot be negative')
      if (reserved > onHand) throw conflict('Insufficient available stock (reserved would exceed on hand)')
      this.db.stock.update(s.id, { ...s, onHand, reserved }, { key_idx: stockKey(productId, locationId) })
      this.db.movements.insert(
        {
          productId, locationId, type: m.type, onHandDelta: d.onHand ?? 0, reservedDelta: d.reserved ?? 0,
          onHandAfter: onHand, refType: m.refType, refId: m.refId, userId: m.userId, note: m.note, at: new Date().toISOString(),
        },
        { product_idx: blindIndex(productId, 'movement') },
      )
    })
  }

  available(productId: number, locationId: number) {
    const s = this.getStock(productId, locationId)
    return r3(s.onHand - s.reserved)
  }

  /** Validates raw line input against products (units must be whole numbers) and computes quantities. */
  buildLines(input: { productId: number; cases?: number; loose?: number }[], allowZero = false): Line[] {
    if (!input.length) throw bad('At least one line is required')
    const seen = new Set<number>()
    return input.map((l) => {
      const p = this.db.products.get(l.productId) as Product | undefined
      if (!p) throw notFound(`Product ${l.productId}`)
      if (!isApproved(p)) throw bad(`${productLabel(p)} is not approved yet`)
      if (!p.active) throw bad(`${productLabel(p)} is inactive`)
      if (seen.has(p.id)) throw bad(`Product ${p.sku} appears twice - merge the lines`)
      seen.add(p.id)
      const cases = l.cases ?? 0, loose = l.loose ?? 0
      if (cases > 0 && !p.caseSize) throw bad(`${productLabel(p)} has no case pack - enter loose quantity only`)
      const qty = r3(cases * (p.caseSize ?? 0) + loose)
      if (qty < 0 || (qty === 0 && !allowZero)) throw bad(`Quantity for ${productLabel(p)} must be greater than zero`)
      if ((p.uom === 'unit' || p.uom === 'bundle') && (!Number.isInteger(qty) || !Number.isInteger(cases))) throw bad(`${productLabel(p)} must be in whole numbers`)
      return { productId: p.id, cases, loose, qty }
    })
  }

  /** Totals per product across all locations. */
  totals() {
    const out = new Map<number, { onHand: number; reserved: number }>()
    for (const s of this.db.stock.all() as Stock[]) {
      const t = out.get(s.productId) ?? { onHand: 0, reserved: 0 }
      t.onHand += s.onHand; t.reserved += s.reserved
      out.set(s.productId, t)
    }
    return out
  }

  inTransit() {
    const out = new Map<number, number>()
    for (const t of this.db.transfer_orders.all()) {
      if (t.status !== 'in_transit') continue
      for (const l of t.lines as Line[]) out.set(l.productId, (out.get(l.productId) ?? 0) + l.qty)
    }
    return out
  }
}
