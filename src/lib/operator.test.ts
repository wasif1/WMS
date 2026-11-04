import { describe, expect, it } from 'vitest'
import { hasOwnerWorkflow, matchProduct, summarizeStock, TILES, tilesFor } from './operator'
import type { Product, StockRow } from './types'

const canOf = (...granted: string[]) => (...p: string[]) => p.some((x) => granted.includes(x))
const ids = (...granted: string[]) => tilesFor(canOf(...granted)).map((t) => t.id)
const prod = (o: Partial<Product>): Product => ({ id: 1, sku: 'COT-BLA-L-0001', uom: 'unit', reorderLevel: 0, active: true, ...o })

describe('operator buttons follow permissions exactly', () => {
  it('shows nothing the person cannot do', () => {
    expect(ids()).toEqual([]); expect(ids('dashboard.view', 'products.view')).toEqual([])
    expect(ids('inbound.create')).toEqual(['inbound']); expect(ids('inbound.view', 'transfers.view')).toEqual([])
  })
  it('each permission maps to its own plain-language button', () => {
    expect(ids('transfers.create')).toEqual(['transfer']); expect(ids('reserves.create')).toEqual(['reserve']); expect(ids('outbound.create')).toEqual(['outbound'])
    expect(ids('audits.create')).toEqual(['count']); expect(ids('adjustments.create')).toEqual(['fix']); expect(ids('products.create')).toEqual(['newProduct'])
    expect(ids('locations.manage')).toEqual(['newLocation']); expect(ids('reports.inventory')).toEqual(['reports']); expect(ids('reports.orders')).toEqual(['reports'])
  })
  it('a fully trained operator sees all buttons, in a stable order', () => {
    const all = TILES.flatMap((t) => t.perms)
    expect(tilesFor(canOf(...all)).map((t) => t.id)).toEqual(TILES.map((t) => t.id))
  })
  it('button text is short, plain words (no jargon)', () => {
    for (const t of TILES) { expect(t.title.length).toBeLessThan(32); expect(t.help.length).toBeLessThan(60); expect(`${t.title} ${t.help}`).not.toMatch(/SKU|UOM|inbound|outbound|transfer order|adjustment|audit/i) }
  })
  it('"My requests" appears only when the person can submit something that needs approval', () => {
    expect(hasOwnerWorkflow(canOf('inbound.create'))).toBe(false); expect(hasOwnerWorkflow(canOf('products.create'))).toBe(true); expect(hasOwnerWorkflow(canOf('audits.count'))).toBe(true)
  })
})

describe('matchProduct: search by name, code and anything else people type', () => {
  const p = prod({ name: 'Cotton T-Shirt', color: 'Black', size: 'L', weight: '200 g', description: 'Plain cotton tee' })
  it('matches by name, colour, size, weight, details and SKU - any word, any order, any case', () => {
    for (const q of ['cotton', 'COTTON t-shirt', 'black', 'black cotton', 'l black', '200 g', 'plain tee', 'COT-BLA', 'cot-bla-l-0001', '0001', '']) expect(matchProduct(p, q), q).toBe(true)
  })
  it('does not match things that are not there; every word must match', () => {
    for (const q of ['red', 'cotton red', 'xyz', 'wool']) expect(matchProduct(p, q), q).toBe(false)
  })
  it('works for products with no name at all (found by code)', () => { expect(matchProduct(prod({ sku: 'PRD-0007' }), 'prd-0007')).toBe(true) })
})

describe('summarizeStock', () => {
  const rows: StockRow[] = [{ productId: 1, locationId: 1, onHand: 100, reserved: 30, available: 70 }, { productId: 1, locationId: 2, onHand: 50, reserved: 0, available: 50 }, { productId: 2, locationId: 1, onHand: 9, reserved: 0, available: 9 }]
  it('totals available units across places, boxes from the case pack, and per-place chips', () => {
    const s = summarizeStock(prod({ caseSize: 24 }), rows)
    expect(s).toMatchObject({ available: 120, onHand: 150, boxes: 5 }); expect(s.byLocation).toEqual([{ locationId: 1, available: 70 }, { locationId: 2, available: 50 }])
  })
  it('can be limited to one warehouse; loose products have no boxes', () => {
    expect(summarizeStock(prod({ caseSize: 24 }), rows, 2)).toMatchObject({ available: 50, boxes: 3 })
    expect(summarizeStock(prod({}), rows).boxes).toBeNull()
  })
})
