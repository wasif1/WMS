import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api'
import { ErrorBox, OfflineBanner, ToastProvider, toastError } from './ui'
import ErrorBoundary from './ErrorBoundary'

describe('ErrorBox', () => {
  it('shows a title, the explanation, each problem, and a reference for server faults', () => {
    const { rerender } = render(<ErrorBox error={new ApiError(400, 'x', 'validation', [{ field: 'a', message: 'Product is required' }, { field: 'b', message: 'Reason must be at least 3 characters' }])} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Please fix these'); expect(screen.getByText('Product is required.')).toBeInTheDocument(); expect(screen.getByText('Reason must be at least 3 characters.')).toBeInTheDocument()
    rerender(<ErrorBox error={new ApiError(500, 'Something went wrong on our side.', 'server_error', undefined, 'ab12cd34ef')} />)
    expect(screen.getByText('ab12cd34ef')).toBeInTheDocument(); expect(screen.getByRole('alert')).not.toHaveTextContent(/stack|undefined|500/)
  })
  it('offers "Try again" only when retrying makes sense', async () => {
    const retry = vi.fn()
    const { rerender } = render(<ErrorBox error={new ApiError(0, 'Network error', 'network')} onRetry={retry} />)
    await userEvent.click(screen.getByRole('button', { name: /try again/i })); expect(retry).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('alert')).toHaveTextContent("Can't reach the server")
    rerender(<ErrorBox error={new ApiError(403, '', 'forbidden')} onRetry={retry} />)
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull(); expect(screen.getByRole('alert')).toHaveTextContent('Ask a super admin')
  })
  it('renders nothing without an error', () => { const { container } = render(<ErrorBox error={undefined} />); expect(container).toBeEmptyDOMElement() })
})

describe('toastError (load failures from the data layer)', () => {
  it('toasts a load failure when nothing on the page shows it, but not when an inline ErrorBox already does', async () => {
    vi.useFakeTimers()
    const err = (m: string) => new ApiError(0, m, 'network')
    const { unmount } = render(<ToastProvider><p>page</p></ToastProvider>)
    await act(async () => { toastError(err('one')); await vi.advanceTimersByTimeAsync(300) })
    expect(screen.getByText(/Can't reach the server/)).toBeInTheDocument(); unmount()

    render(<ToastProvider><ErrorBox error={err('two')} /></ToastProvider>)
    await act(async () => { toastError(new ApiError(500, 'x', 'server_error')); await vi.advanceTimersByTimeAsync(300) })
    expect(screen.getAllByText(/Can't reach the server/)).toHaveLength(1) // only the inline one; no "Something went wrong" toast
    expect(screen.queryByText(/Something went wrong on our side\./)).toBeNull()
    vi.useRealTimers()
  })
})

describe('ErrorBoundary', () => {
  afterEach(() => vi.restoreAllMocks())
  const Boom = ({ boom }: { boom: boolean }) => { if (boom) throw new Error('secret internal detail'); return <p>all good</p> }
  it('replaces a crashed page with an explanation and a way out - no technical text', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { rerender } = render(<ErrorBoundary><Boom boom /></ErrorBoundary>)
    expect(screen.getByRole('alert')).toHaveTextContent('This page ran into a problem'); expect(screen.getByRole('alert')).toHaveTextContent('Your data is safe')
    expect(document.body.textContent).not.toContain('secret internal detail')
    expect(screen.getByRole('button', { name: /go to dashboard/i })).toBeInTheDocument()
    rerender(<ErrorBoundary><Boom boom={false} /></ErrorBoundary>)
    await userEvent.click(screen.getByRole('button', { name: /try again/i })); expect(screen.getByText('all good')).toBeInTheDocument()
  })
})

describe('ErrorBoundary: page code failed to download', () => {
  it('explains it is a connection/version problem and offers Reload (a retry cannot work for a cached failed import)', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const Chunk = () => { throw new TypeError('Failed to fetch dynamically imported module: http://x/assets/Audits-abc.js') }
    render(<ErrorBoundary><Chunk /></ErrorBoundary>)
    expect(screen.getByRole('alert')).toHaveTextContent("We couldn't load this page"); expect(screen.getByRole('alert')).toHaveTextContent('internet connection may have dropped')
    expect(screen.getByRole('button', { name: /reload the page/i })).toBeInTheDocument(); expect(screen.queryByRole('button', { name: /try again/i })).toBeNull()
    expect(document.body.textContent).not.toMatch(/dynamically imported|assets\/Audits/)
  })
})

describe('OfflineBanner', () => {
  it('appears when the browser goes offline and disappears when it returns', () => {
    render(<OfflineBanner />); expect(screen.queryByRole('status')).toBeNull()
    act(() => { window.dispatchEvent(new Event('offline')) }); expect(screen.getByRole('status')).toHaveTextContent("You're offline")
    act(() => { window.dispatchEvent(new Event('online')) }); expect(screen.queryByRole('status')).toBeNull()
  })
})
