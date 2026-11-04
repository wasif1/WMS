import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import ProductPicker from './ProductPicker'
import type { Product } from '@/lib/types'

const mk = (id: number, o: Partial<Product>): Product => ({ id, sku: `SKU-SECRET-${id}`, uom: 'unit', reorderLevel: 0, active: true, ...o })
const products = [mk(1, { name: 'Cotton T-Shirt', color: 'Black', size: 'L' }), mk(2, { name: 'Cotton T-Shirt', color: 'White', size: 'M' }), mk(3, { name: 'Steel Wire Roll', color: 'Silver', weight: '1.5 kg' }), mk(4, { name: 'Retired', active: false })]

describe('ProductPicker (adjustments search)', () => {
  it('searches by product name and shows colour/size variation', async () => {
    const onChange = vi.fn(); render(<ProductPicker products={products} value="" onChange={onChange} />)
    await userEvent.click(screen.getByRole('combobox'))
    await userEvent.type(screen.getByRole('combobox'), 'cotton')
    expect(screen.getAllByRole('option')).toHaveLength(2)
    expect(screen.getByText('Black · L')).toBeInTheDocument(); expect(screen.getByText('White · M')).toBeInTheDocument()
    await userEvent.click(screen.getAllByRole('option')[0].querySelector('button')!)
    expect(onChange).toHaveBeenCalledWith(1)
  })
  it('narrows by variation words and never matches or shows the SKU', async () => {
    render(<ProductPicker products={products} value="" onChange={() => {}} />)
    await userEvent.click(screen.getByRole('combobox'))
    await userEvent.type(screen.getByRole('combobox'), 'cotton white')
    expect(screen.getAllByRole('option')).toHaveLength(1)
    await userEvent.clear(screen.getByRole('combobox')); await userEvent.type(screen.getByRole('combobox'), 'SKU-SECRET')
    expect(screen.queryAllByRole('option')).toHaveLength(0); expect(screen.getByText(/No products match/)).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('SKU-SECRET-1')
  })
  it('hides inactive products', async () => {
    render(<ProductPicker products={products} value="" onChange={() => {}} />)
    await userEvent.click(screen.getByRole('combobox')); await userEvent.type(screen.getByRole('combobox'), 'retired')
    expect(screen.queryAllByRole('option')).toHaveLength(0)
  })
})
