import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import type { Product, StockRow } from '@/lib/types'
import LinesEditor from './LinesEditor'

vi.mock('@/auth/AuthContext', () => ({ useAuth: () => ({ can: () => false }) }))
const P: Product = { id: 1, sku: 'X-1', name: 'Cotton T-Shirt', caseSize: 4, uom: 'unit', reorderLevel: 0, active: true }
const stock = (available: number): StockRow[] => [{ productId: 1, locationId: 1, onHand: available, reserved: 0, available }]
const show = (lines: { productId: number | ''; cases: number; loose: number }[], s: StockRow[]) =>
  render(<QueryClientProvider client={new QueryClient()}><LinesEditor lines={lines} onChange={vi.fn()} products={[P]} stock={s} /></QueryClientProvider>)

describe('helper text under a product: "Case pack 4 · units · available here: 300"', () => {
  it('shows the case pack and the available quantity as bold numbers', () => {
    show([{ productId: 1, cases: 0, loose: 0 }], stock(300))
    const hint = screen.getByText(/Case pack/).closest('p')!
    expect(hint).toHaveTextContent('Case pack 4 · units · available here: 300')
    for (const n of ['4', '300']) { const b = screen.getByText(n, { selector: 'b' }); expect(b).toHaveClass('font-bold', 'text-slate-900'); expect(hint).toContainElement(b) }
    expect(hint.querySelectorAll('b')).toHaveLength(2) // only the numbers are bold, not the words
  })

  it('keeps the red warning when more is entered than is available', () => {
    show([{ productId: 1, cases: 0, loose: 500 }], stock(300))
    const hint = screen.getByText(/Case pack/).closest('p')!
    expect(hint.querySelector('.text-red-600')).toHaveTextContent('available here: 300')
    expect(hint.querySelectorAll('b')).toHaveLength(1) // the case-pack number; the warning number stays red
  })
})
