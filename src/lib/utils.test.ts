import { describe, expect, it } from 'vitest'
import { cn, fmt } from './utils'
import { lineQty, toPayload } from '@/components/LinesEditor'

describe('utils', () => {
  it('merges tailwind classes', () => expect(cn('p-2', 'p-4', undefined)).toBe('p-4'))
  it('formats numbers', () => { expect(fmt(1234.5)).toMatch(/1.?234\.5/); expect(fmt(undefined)).toBe('0') })
  it('computes line quantity from case pack + loose units', () => {
    const p = { id: 1, caseSize: 12 } as any
    expect(lineQty({ productId: 1, cases: 3, loose: 5 }, p)).toBe(41)
    expect(toPayload([{ productId: '', cases: 1, loose: 1 }, { productId: 2, cases: 1, loose: 0 }])).toEqual([{ productId: 2, cases: 1, loose: 0 }])
  })
})

import { productLabel, variationOf } from './catalog'
describe('catalog labels', () => {
  it('builds "name - colour · size" and never needs the SKU', () => {
    expect(productLabel({ name: 'Cotton T-Shirt', color: 'Black', size: 'L', sku: 'X' })).toBe('Cotton T-Shirt - Black · L')
    expect(variationOf({ color: 'Silver' })).toBe('Silver')
    expect(productLabel({ sku: 'PRD-0001' })).toBe('PRD-0001')
    expect(productLabel({})).toBe('Unnamed product')
  })
})
