import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PermDef } from '@/lib/types'
import PermissionMatrix from './PermissionMatrix'

const post = vi.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({ user: { email: 'new@x.com' }, temporaryPassword: 'Temp-1234' }))
const patch = vi.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({}))
const PLACES = [{ id: 1, name: 'Karachi', address: '', active: true }, { id: 2, name: 'Dubai', address: '', active: true }]
vi.mock('@/lib/api', async (orig) => ({ ...(await orig<typeof import('@/lib/api')>()), get: async (path: string) => (path === '/locations' ? PLACES : []), post: (...a: unknown[]) => (post as any)(...a), patch: (...a: unknown[]) => (patch as any)(...a) }))
import { ToastProvider } from '@/components/ui'
import { UserForm } from '@/pages/Users'

const PERMS: PermDef[] = [
  { key: 'products.view', label: 'View products & product pages', module: 'Products' },
  { key: 'products.create', label: 'Add new products', module: 'Products' },
  { key: 'inbound.view', label: 'View inbound orders', module: 'Inbound' },
  { key: 'inbound.approve', label: 'Approve inbound orders', module: 'Inbound', sensitive: true },
  { key: 'logs.view', label: 'View activity log', module: 'Administration', sensitive: true },
  { key: 'locations.view', label: 'View locations', module: 'Locations' },
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

const places = [{ id: 1, name: 'Karachi' }, { id: 2, name: 'Dubai' }]
function PlacesHarness({ start = [] as number[], unrestricted = false }) {
  const [sel, setSel] = useState(new Set<string>()); const [ps, setPs] = useState(new Set(start))
  return <><PermissionMatrix perms={PERMS} sel={sel} onChange={setSel} places={places} placeSel={ps} onPlaceChange={setPs} unrestricted={unrestricted} /><output data-testid="places">{[...ps].sort().join(',')}</output></>
}

describe('location access rows (under the Locations head)', () => {
  it('lists every location once the head is opened, so one location can be given on its own', async () => {
    render(<PlacesHarness />)
    expect(screen.getByRole('button', { name: /Locations/ })).toHaveTextContent('No locations')
    expect(screen.queryByRole('radio', { name: 'Karachi: View & Edit' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /Locations/ }))
    expect(screen.getByText('Location access')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: 'Karachi: View & Edit' }))
    expect(screen.getByTestId('places')).toHaveTextContent(/^1$/) // Dubai is NOT included
    expect(screen.getByRole('radio', { name: 'Dubai: None' })).toBeChecked()
    expect(screen.getByRole('button', { name: /Locations/ })).toHaveTextContent('1 of 2 locations')
    expect(tone('Karachi: View & Edit')).toBe('blue')
  })

  it('"All locations" gives or removes every location at once', async () => {
    render(<PlacesHarness start={[2]} />)
    await userEvent.click(screen.getByRole('button', { name: /Locations/ }))
    await userEvent.click(screen.getByRole('radio', { name: 'All locations: View & Edit' }))
    expect(screen.getByTestId('places')).toHaveTextContent('1,2')
    await userEvent.click(screen.getByRole('radio', { name: 'All locations: None' }))
    expect(screen.getByTestId('places')).toHaveTextContent(/^$/)
  })

  it('says so when a person has no restriction yet (older accounts)', async () => {
    render(<PlacesHarness start={[1, 2]} unrestricted />)
    expect(screen.getByRole('button', { name: /Locations/ })).toHaveTextContent('All locations')
    await userEvent.click(screen.getByRole('button', { name: /Locations/ }))
    expect(screen.getByText(/can use every location, including new ones/)).toBeInTheDocument()
  })

  it('has no location rows at all when the screen does not pass any (other modules unaffected)', () => {
    render(<Harness />)
    expect(screen.queryByText('Location access')).toBeNull()
  })
})

describe('add / edit user: what is sent for location access', () => {
  beforeEach(() => { post.mockClear(); patch.mockClear() })
  const renderForm = (user?: any) => render(<QueryClientProvider client={new QueryClient()}><ToastProvider><UserForm user={user} perms={PERMS} onClose={vi.fn()} onCreated={vi.fn()} /></ToastProvider></QueryClientProvider>)
  const open = async () => { await userEvent.click(await screen.findByRole('button', { name: /Locations/ })) }

  it('a new person starts with NO locations, and exactly the ones ticked are sent', async () => {
    renderForm()
    await userEvent.type(screen.getByLabelText('Full name'), 'Omar'); await userEvent.type(screen.getByLabelText('Email'), 'o@x.com')
    await userEvent.click(screen.getByRole('button', { name: 'Create user' }))
    expect(post).toHaveBeenLastCalledWith('/users', expect.objectContaining({ locationIds: [] }))
    post.mockClear(); await open()
    await userEvent.click(await screen.findByRole('radio', { name: 'Dubai: View & Edit' }))
    await userEvent.click(screen.getByRole('button', { name: 'Create user' }))
    expect(post).toHaveBeenLastCalledWith('/users', expect.objectContaining({ locationIds: [2] }))
  })

  it('an older user with no restriction is left alone unless the locations are changed', async () => {
    renderForm({ id: 7, name: 'Old', email: 'old@x.com', role: 'user', active: true, permissions: [], simpleScreen: false })
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(patch.mock.calls.at(-1)![1]).not.toHaveProperty('locationIds') // stays unrestricted, including future locations
    patch.mockClear(); await open()
    await userEvent.click(await screen.findByRole('radio', { name: 'Dubai: None' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(patch.mock.calls.at(-1)![1]).toMatchObject({ locationIds: [1] }) // now explicit: Karachi only
  })

  it('a super admin form sends no locations (super admins always have every one)', async () => {
    renderForm({ id: 1, name: 'Boss', email: 'b@x.com', role: 'super_admin', active: true, permissions: [], simpleScreen: false })
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(patch.mock.calls.at(-1)![1]).not.toHaveProperty('locationIds')
  })
})
