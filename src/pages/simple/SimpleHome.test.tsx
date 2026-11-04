import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state: { perms: string[]; role: string } = { perms: [], role: 'user' }
vi.mock('@/auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 3, name: 'Omar Operator', role: state.role, permissions: state.perms, simpleScreen: true }, can: (...p: string[]) => state.role === 'super_admin' || p.some((x) => state.perms.includes(x)), logout: vi.fn() }),
}))
const products = [
  { id: 1, sku: 'COT-BLA-L-0001', name: 'Cotton T-Shirt', color: 'Black', size: 'L', caseSize: 24, uom: 'unit', reorderLevel: 0, active: true },
  { id: 2, sku: 'RIC-5KG-0001', name: 'Basmati Rice', weight: '5 kg', caseSize: 4, uom: 'unit', reorderLevel: 0, active: true },
  { id: 3, sku: 'STE-SIL-15KG-0001', name: 'Steel Wire Roll', color: 'Silver', weight: '1.5 kg', uom: 'kg', reorderLevel: 0, active: true },
]
const routes: Record<string, unknown> = {
  '/products': products, '/locations': [{ id: 1, name: 'Karachi Main', active: true }, { id: 2, name: 'Lahore Hub', active: true }],
  '/stock': [{ productId: 1, locationId: 1, onHand: 100, reserved: 30, available: 70 }, { productId: 1, locationId: 2, onHand: 50, reserved: 0, available: 50 }, { productId: 2, locationId: 1, onHand: 0, reserved: 0, available: 0 }, { productId: 3, locationId: 2, onHand: 12, reserved: 0, available: 12 }],
  '/transfers?status=in_transit': [{ id: 4, fromLocationId: 1, toLocationId: 2, status: 'in_transit', lines: [{ productId: 1, cases: 0, loose: 20, qty: 20 }], createdBy: { name: 'x', at: new Date().toISOString() } }],
  '/transfers?status=draft': [{ id: 6, fromLocationId: 2, toLocationId: 1, status: 'draft', lines: [{ productId: 2, cases: 0, loose: 8, qty: 8 }], createdBy: { name: 'x', at: new Date().toISOString() } }],
  '/inbound?status=pending': [{ id: 11, reference: 'MSKU-9', status: 'pending', locationId: 1, lines: [{ productId: 1, cases: 0, loose: 30, qty: 30 }], enteredBy: { userId: 3, name: 'Omar Operator', at: new Date().toISOString() } }, { id: 12, status: 'pending', locationId: 1, lines: [{ productId: 1, cases: 0, loose: 5, qty: 5 }], enteredBy: { userId: 99, name: 'Someone Else', at: new Date().toISOString() } }],
  '/approvals': { items: [{ type: 'product', id: 9, status: 'rejected', title: 'Brass Fitting', summary: 'no case pack', decisionComment: 'Duplicate of an existing item', submittedBy: { name: 'Omar', at: new Date().toISOString() } }, { type: 'adjustment', id: 5, status: 'pending', title: 'Cotton at Karachi', summary: 'Add 10', submittedBy: { name: 'Omar', at: new Date().toISOString() } }] },
  '/dashboard?period=week': { kpis: { inbound: 3, outbound: 2, transfers: 1, pending: 4 } },
}
vi.mock('@/lib/api', async (orig) => ({ ...(await orig<typeof import('@/lib/api')>()), get: vi.fn(async (p: string) => { if (!(p in routes)) throw new Error('unexpected request ' + p); return routes[p] }) }))
import SimpleHome from './SimpleHome'

const renderHome = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><SimpleHome /></MemoryRouter></QueryClientProvider>)
beforeEach(() => { state.perms = []; state.role = 'user' })

describe('operator single-page screen', () => {
  it('shows only the buttons the person may use, and no side menu', async () => {
    state.perms = ['products.view', 'inbound.create', 'outbound.create', 'adjustments.create']
    renderHome()
    expect(await screen.findByRole('heading', { name: /Good (morning|afternoon|evening), Omar/ })).toBeInTheDocument()
    const jobs = screen.getByRole('region', { name: 'Do a job' }) // section labelled by its heading
    expect(within(jobs).getAllByRole('button').map((b) => b.textContent)).toEqual([expect.stringContaining('Receive stock'), expect.stringContaining('Send out to a customer'), expect.stringContaining('Fix a stock number')])
    for (const hidden of ['Move stock', 'Count the stock', 'Add a new product', 'Add a new warehouse', 'Stock list & reports']) expect(screen.queryByText(hidden)).toBeNull()
    expect(screen.queryByRole('navigation')).toBeNull()
  })
  it('a dashboard-only person gets just the overview - no buttons, no search', async () => {
    state.perms = ['dashboard.view']; renderHome()
    expect(await screen.findByText('Received')).toBeInTheDocument(); expect(screen.getByText('Sent out')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Do a job' })).toBeNull(); expect(screen.queryByLabelText('Search products')).toBeNull()
  })
  it('search finds by name AND by code, shows stock per warehouse, and explains empty results', async () => {
    state.perms = ['products.view']; renderHome()
    const box = await screen.findByLabelText('Search products')
    expect(screen.queryByText('Cotton T-Shirt')).toBeNull() // nothing until the person searches
    await userEvent.click(screen.getByRole('button', { name: 'Show all products' })); expect(await screen.findByText('Cotton T-Shirt')).toBeInTheDocument()
    await userEvent.type(box, 'rice'); expect(screen.getByText('Basmati Rice')).toBeInTheDocument(); expect(screen.queryByText('Cotton T-Shirt')).toBeNull()
    await userEvent.clear(box); await userEvent.type(box, 'cot-bla-l'); expect(screen.getByText('Cotton T-Shirt')).toBeInTheDocument(); expect(screen.getByText('Code: COT-BLA-L-0001')).toBeInTheDocument()
    expect(screen.getByText('Karachi Main:')).toBeInTheDocument(); expect(screen.getByText('120')).toBeInTheDocument(); expect(screen.getByText(/≈ 5 boxes/)).toBeInTheDocument()
    await userEvent.clear(box); await userEvent.type(box, 'black cotton'); expect(screen.getByText('Cotton T-Shirt')).toBeInTheDocument()
    await userEvent.clear(box); await userEvent.type(box, 'zzzz'); expect(screen.getByText(/Nothing found/)).toBeInTheDocument()
  })
  it('"only what is in stock" and the warehouse filter work', async () => {
    state.perms = ['products.view']; renderHome()
    await userEvent.click(await screen.findByRole('button', { name: 'Show all products' }))
    await screen.findByText('Basmati Rice')
    await userEvent.click(screen.getByLabelText('Only show what is in stock')); expect(screen.queryByText('Basmati Rice')).toBeNull(); expect(screen.getByText('Steel Wire Roll')).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('Warehouse'), 'Karachi Main'); expect(screen.queryByText('Steel Wire Roll')).toBeNull(); expect(screen.getByText('Cotton T-Shirt')).toBeInTheDocument()
  })
  it('lists work waiting for the person (goods to receive) and the answers to their requests', async () => {
    state.perms = ['transfers.view', 'transfers.receive', 'products.create', 'adjustments.create']; renderHome()
    expect(await screen.findByText(/Goods arriving: Karachi Main\s*\S\s*Lahore Hub/)).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Receive' })).toBeInTheDocument()
    expect(await screen.findByText('Not approved')).toBeInTheDocument(); expect(screen.getByText(/Owner says: “Duplicate of an existing item”/)).toBeInTheDocument(); expect(screen.getByText('Waiting for the owner')).toBeInTheDocument()
  })
  it('does not ask the server for things the person has no right to see', async () => {
    state.perms = ['inbound.create']; renderHome()
    await screen.findByText('Receive stock')
    const { get } = await import('@/lib/api'); const urls = (get as any).mock.calls.map((c: any[]) => c[0])
    expect(urls).not.toContain('/transfers?status=in_transit'); expect(urls).not.toContain('/approvals'); expect(urls).not.toContain('/dashboard?period=week')
  })
  it('a saved transfer draft shows up under "Waiting for you" with a Send it button', async () => {
    state.perms = ['transfers.view', 'transfers.create']; renderHome()
    expect(await screen.findByText(/Ready to send: Lahore Hub\s*\S\s*Karachi Main/)).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Send it' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Send it' }))
    expect(within(await screen.findByRole('dialog', { name: 'Transfer #6' })).getByRole('button', { name: 'Send it' })).toBeInTheDocument()
  })
  it('deliveries the person entered show as waiting for a manager; other people\'s do not', async () => {
    state.perms = ['inbound.view', 'inbound.create']; renderHome()
    expect(await screen.findByText(/Delivery #11/)).toBeInTheDocument(); expect(screen.getByText('Waiting for a manager')).toBeInTheDocument(); expect(screen.queryByText(/Delivery #12/)).toBeNull()
  })
  it('forms opened from a big button speak plain language and show numbered steps', async () => {
    state.perms = ['inbound.create']; renderHome()
    await userEvent.click(await screen.findByRole('button', { name: /Receive stock/ }))
    const dlg = await screen.findByRole('dialog', { name: 'Receive stock' })
    expect(within(dlg).getByRole('list', { name: 'How to fill this in' })).toHaveTextContent('Choose the warehouse where the goods arrived.')
    expect(within(dlg).getByRole('button', { name: 'Send for checking' })).toBeInTheDocument(); expect(dlg).not.toHaveTextContent(/packing list/i)
  })
  it('opens the help window in plain words', async () => {
    state.perms = ['products.view']; renderHome()
    await userEvent.click(await screen.findByRole('button', { name: /How do I use this screen/ }))
    expect(await screen.findByRole('dialog', { name: 'How to use this screen' })).toHaveTextContent('big coloured buttons')
  })
})
