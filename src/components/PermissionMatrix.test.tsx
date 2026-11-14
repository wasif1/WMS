import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PermDef } from '@/lib/types'
import PermissionMatrix from './PermissionMatrix'

const post = vi.fn(async () => ({ user: { email: 'new@x.com' }, temporaryPassword: 'Temp-1234' }))
const patch = vi.fn(async () => ({}))
vi.mock('@/lib/api', async (orig) => ({ ...(await orig<typeof import('@/lib/api')>()), post: (...a: unknown[]) => (post as any)(...a), patch: (...a: unknown[]) => (patch as any)(...a) }))
import { ToastProvider } from '@/components/ui'
import { UserForm } from '@/pages/Users'

const PERMS: PermDef[] = [
  { key: 'products.view', label: 'View products & product pages', module: 'Products' },
  { key: 'products.create', label: 'Add new products', module: 'Products' },
  { key: 'inbound.view', label: 'View inbound orders', module: 'Inbound' },
  { key: 'inbound.approve', label: 'Approve inbound orders', module: 'Inbound', sensitive: true },
  { key: 'logs.view', label: 'View activity log', module: 'Administration', sensitive: true },
]

function Harness({ start = [] as string[] }) {
  const [sel, setSel] = useState(new Set(start))
  return <><PermissionMatrix perms={PERMS} sel={sel} onChange={setSel} /><output data-testid="sel">{[...sel].sort().join(',')}</output></>
}

const tone = (name: string) => screen.getByRole('radio', { name }).parentElement!.querySelector('[data-tone]')?.getAttribute('data-tone') ?? null

describe('permission table', () => {
  it('always shows the column names; the details of a head show only once it is opened', async () => {
    render(<Harness />)
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['What this person can do', 'None', 'View', 'View & Edit', 'Admin'])
    expect(screen.getByRole('button', { name: /Products/ })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Add new products')).toBeNull() // detail row hidden
    expect(screen.getByRole('radio', { name: 'Products: None' })).toBeChecked() // the head itself has radios
    await userEvent.click(screen.getByRole('button', { name: /Products/ }))
    expect(screen.getByText('Add new products')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Products/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getAllByRole('columnheader')).toHaveLength(5) // still the same single header
  })

  it('a head sets all of its features at once: View, View & Edit, Admin, None', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('radio', { name: 'Inbound: View' }))
    expect(screen.getByTestId('sel')).toHaveTextContent(/^inbound.view$/)
    await userEvent.click(screen.getByRole('radio', { name: 'Inbound: Admin' }))
    expect(screen.getByTestId('sel')).toHaveTextContent('inbound.approve,inbound.view') // everything incl. the sensitive one
    expect(screen.queryByRole('radio', { name: 'Products: Admin' })).toBeNull() // no sensitive feature there -> no Admin choice
    await userEvent.click(screen.getByRole('radio', { name: 'Products: View & Edit' }))
    expect(screen.getByTestId('sel')).toHaveTextContent('inbound.approve,inbound.view,products.create,products.view')
    await userEvent.click(screen.getByRole('radio', { name: 'Inbound: None' }))
    expect(screen.getByTestId('sel')).toHaveTextContent('products.create,products.view')
  })

  it('each detailed feature is None or its own level; picking one changes that permission only', async () => {
    render(<Harness start={['products.view']} />)
    await userEvent.click(screen.getByRole('button', { name: /Products/ }))
    expect(screen.getByRole('radio', { name: 'View products & product pages: View' })).toBeChecked()
    expect(screen.queryByRole('radio', { name: 'View products & product pages: View & Edit' })).toBeNull() // no meaningless option
    await userEvent.click(screen.getByRole('radio', { name: 'Add new products: View & Edit' }))
    expect(screen.getByTestId('sel')).toHaveTextContent('products.create,products.view')
    await userEvent.click(screen.getByRole('radio', { name: 'View products & product pages: None' }))
    expect(screen.getByTestId('sel')).toHaveTextContent(/^products.create$/)
  })

  it('a head that matches none of its levels shows "Custom" with no level picked', async () => {
    render(<Harness start={['products.create']} />)
    expect(screen.getByRole('button', { name: /Products/ })).toHaveTextContent('Custom')
    for (const lv of ['None', 'View', 'View & Edit']) expect(screen.getByRole('radio', { name: `Products: ${lv}` })).not.toBeChecked()
  })

  it('dots: grey = default, blue = access given, red = sensitive', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: /Inbound/ }))
    expect(tone('Inbound: None')).toBe('grey'); expect(tone('Approve inbound orders: None')).toBe('grey')
    await userEvent.click(screen.getByRole('radio', { name: 'View inbound orders: View' }))
    expect(tone('View inbound orders: View')).toBe('blue'); expect(tone('Inbound: View')).toBe('blue')
    await userEvent.click(screen.getByRole('radio', { name: 'Approve inbound orders: Admin' }))
    expect(tone('Approve inbound orders: Admin')).toBe('red')
    expect(screen.getByText('1 sensitive')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: 'Inbound: Admin' })); expect(tone('Inbound: Admin')).toBe('red')
  })

  it('summarises each head', async () => {
    render(<Harness start={['inbound.view']} />)
    expect(screen.getByRole('button', { name: /Inbound/ })).toHaveTextContent('1 of 2 allowed')
    expect(screen.getByRole('button', { name: /Products/ })).toHaveTextContent('No access')
  })
})

describe('add / edit user: sensitive access is confirmed before saving', () => {
  beforeEach(() => { post.mockClear(); patch.mockClear() })
  const renderForm = (user?: any) => render(<QueryClientProvider client={new QueryClient()}><ToastProvider><UserForm user={user} perms={PERMS} onClose={vi.fn()} onCreated={vi.fn()} /></ToastProvider></QueryClientProvider>)
  const fill = async () => { await userEvent.type(screen.getByLabelText('Full name'), 'Mia'); await userEvent.type(screen.getByLabelText('Email'), 'mia@x.com') }

  it('asks first, names the sensitive feature, and saves only after "Yes"', async () => {
    renderForm(); await fill()
    await userEvent.click(screen.getByRole('radio', { name: 'Inbound: Admin' })) // the head: everything in Inbound incl. the sensitive approve
    await userEvent.click(screen.getByRole('button', { name: 'Create user' }))
    const dlg = await screen.findByRole('dialog', { name: 'Give sensitive access?' })
    expect(within(dlg).getByText('Approve inbound orders')).toBeInTheDocument(); expect(within(dlg).getByText(/Mia/)).toBeInTheDocument()
    expect(post).not.toHaveBeenCalled()
    await userEvent.click(within(dlg).getByRole('button', { name: 'Cancel' }))
    expect(post).not.toHaveBeenCalled(); expect(screen.queryByRole('dialog', { name: 'Give sensitive access?' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Create user' }))
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Give sensitive access?' })).getByRole('button', { name: 'Yes, give access and save' }))
    expect(post).toHaveBeenCalledWith('/users', expect.objectContaining({ permissions: expect.arrayContaining(['inbound.approve', 'dashboard.view']) }))
  })

  it('does not interrupt when nothing sensitive is being given', async () => {
    renderForm(); await fill()
    await userEvent.click(screen.getByRole('button', { name: 'Create user' }))
    expect(screen.queryByRole('dialog', { name: 'Give sensitive access?' })).toBeNull()
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('on edit, only NEWLY granted sensitive features are asked about', async () => {
    renderForm({ id: 7, name: 'Omar', email: 'o@x.com', role: 'user', active: true, permissions: ['inbound.approve'], simpleScreen: false })
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(screen.queryByRole('dialog', { name: 'Give sensitive access?' })).toBeNull(); expect(patch).toHaveBeenCalledTimes(1) // already had it
    patch.mockClear()
    await userEvent.click(screen.getByRole('button', { name: /Administration/ }))
    await userEvent.click(screen.getByRole('radio', { name: 'View activity log: Admin' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    const dlg = await screen.findByRole('dialog', { name: 'Give sensitive access?' })
    expect(within(dlg).getByText('View activity log')).toBeInTheDocument(); expect(within(dlg).queryByText('Approve inbound orders')).toBeNull()
    expect(patch).not.toHaveBeenCalled()
  })
})
