import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from './api'
import { describeError, errorLine } from './errors'

const E = (status: number, message = '', code?: string, fields?: any[], requestId?: string) => new ApiError(status, message, code, fields, requestId)

describe('describeError: every failure becomes a title + a sentence a person can act on', () => {
  it('network and timeout (request never reached the server)', () => {
    expect(describeError(E(0, 'Network error', 'network'))).toMatchObject({ kind: 'network', title: "Can't reach the server", retryable: true })
    expect(describeError(E(0, 'x', 'network')).message).toMatch(/internet connection/); expect(describeError(E(0, 'x', 'network')).message).toMatch(/Nothing was saved/)
    expect(describeError(E(0, 'Request timed out', 'timeout'))).toMatchObject({ kind: 'timeout', retryable: true })
    expect(describeError(E(0, '', 'timeout')).message).toMatch(/not saved twice/)
  })
  it('sign-in, session, permission, not found, conflict, size, rate limit', () => {
    expect(describeError(E(401, 'Incorrect email or password.', 'invalid_credentials'))).toMatchObject({ kind: 'credentials', title: 'Sign-in failed', message: 'Incorrect email or password.' })
    expect(describeError(E(401, 'Your session has expired for security. Please sign in again.', 'session_expired'))).toMatchObject({ kind: 'session', title: 'Please sign in again' })
    expect(describeError(E(403, 'Your session is out of date. Please reload the page and try again.', 'csrf'))).toMatchObject({ kind: 'session', retryable: true })
    expect(describeError(E(403, '', 'forbidden'))).toMatchObject({ kind: 'permission', title: 'Not allowed' })
    expect(describeError(E(403, '', 'forbidden')).message).toMatch(/Ask a super admin/)
    expect(describeError(E(404, '', 'not_found')).message).toMatch(/may have been removed/)
    expect(describeError(E(409, 'Not enough available stock: X has 6.', 'insufficient_stock'))).toMatchObject({ kind: 'conflict', title: 'Stock is short', message: 'Not enough available stock: X has 6.' })
    expect(describeError(E(409, 'dup', 'duplicate')).title).toBe('Already exists')
    expect(describeError(E(413, '', 'too_large')).kind).toBe('toolarge')
    expect(describeError(E(429, '', 'rate_limited'))).toMatchObject({ kind: 'ratelimit', retryable: true })
  })
  it('validation: one problem = one sentence, many = a list', () => {
    const one = describeError(E(400, 'Reason must be at least 3 characters.', 'validation', [{ field: 'reason', message: 'Reason must be at least 3 characters' }]))
    expect(one).toMatchObject({ kind: 'validation', title: 'Please check this', message: 'Reason must be at least 3 characters.' })
    const many = describeError(E(400, 'Please fix 2 things: …', 'validation', [{ field: 'a', message: 'Product is required' }, { field: 'b', message: 'Location is required' }]))
    expect(many).toMatchObject({ title: 'Please fix these', message: '' }); expect(many.fields).toHaveLength(2)
  })
  it('server faults show a reference and hide technical detail, even if the body was empty or HTML', () => {
    const d = describeError(E(500, 'Something went wrong on our side. Please try again in a moment.', 'server_error', undefined, 'a1b2c3d4e5'))
    expect(d).toMatchObject({ kind: 'server', title: 'Something went wrong on our side', requestId: 'a1b2c3d4e5', retryable: true })
    expect(describeError(E(502, '')).message).toBe('Please try again in a moment. If it keeps happening, contact support.')
    expect(describeError(E(500, '<html>nginx</html>')).message).not.toMatch(/html|nginx/i)
  })
  it('never shows raw browser or unknown errors', () => {
    expect(describeError(new TypeError('Failed to fetch')).title).toBe('Something unexpected happened')
    expect(describeError('boom').message).toMatch(/try again/i)
    expect(describeError(E(400, 'Failed to fetch')).message).not.toMatch(/Failed to fetch/)
    expect(describeError(E(400, 'Password must be at least 12 characters long.', 'weak_password'))).toMatchObject({ title: 'Please check this', message: 'Password must be at least 12 characters long.' })
  })
  it('errorLine is toast-sized', () => {
    expect(errorLine(E(409, 'X has only 6 available.', 'insufficient_stock'))).toBe('Stock is short. X has only 6 available.')
    expect(errorLine(E(400, '', 'validation', [{ field: 'a', message: 'A is required' }, { field: 'b', message: 'B is required' }]))).toBe('Please fix these: A is required; B is required')
  })
})

describe('api(): failures that never reach the server', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })
  it('a dropped connection becomes a "network" ApiError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(api('GET', '/products')).rejects.toMatchObject({ status: 0, code: 'network' })
  })
  it('a hung request is aborted after 30s and reported as a timeout', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_u: string, init: RequestInit) => new Promise((_res, rej) => init.signal!.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))))))
    const p = api('GET', '/products').catch((e) => e)
    await vi.advanceTimersByTimeAsync(30_001)
    expect(await p).toMatchObject({ status: 0, code: 'timeout' })
  })
  it('server JSON errors keep message, code, fields and the request id', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Reason must be at least 3 characters.', code: 'validation', fields: [{ field: 'reason', message: 'x' }] }), { status: 400, headers: { 'content-type': 'application/json', 'x-request-id': 'abc123' } })))
    const e = await api('POST', '/adjustments', {}).catch((x) => x)
    expect(e).toBeInstanceOf(ApiError); expect(e).toMatchObject({ status: 400, code: 'validation', requestId: 'abc123', message: 'Reason must be at least 3 characters.' }); expect(e.fields).toHaveLength(1)
  })
  it('an HTML error page from a proxy is never surfaced as text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html><body>502 Bad Gateway</body></html>', { status: 502, headers: { 'content-type': 'text/html' } })))
    const e = await api('GET', '/x').catch((x) => x)
    expect(e.message).toBe(''); expect(describeError(e).message).not.toMatch(/html|Bad Gateway/i)
  })
  it('a 401 on a normal call signs the user out with a reason; a failed login does not', async () => {
    const { setUnauthorizedHandler } = await import('./api')
    const out = vi.fn(); setUnauthorizedHandler(out)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Your session has expired for security. Please sign in again.', code: 'session_expired' }), { status: 401, headers: { 'content-type': 'application/json' } })))
    await api('GET', '/products').catch(() => {}); expect(out).toHaveBeenCalledWith('Your session has expired for security. Please sign in again.', 'session_expired')
    out.mockClear(); await api('POST', '/auth/login', {}).catch(() => {}); await api('GET', '/auth/me').catch(() => {}); expect(out).not.toHaveBeenCalled()
  })
})
