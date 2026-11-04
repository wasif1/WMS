/** Small fetch wrapper: same-origin cookies (httpOnly session), CSRF header on writes, typed errors. */
export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string, public fields?: { field: string; message: string }[], public requestId?: string) { super(message) }
}

let csrf = ''
export const setCsrf = (t: string) => { csrf = t }
let onUnauthorized: ((message?: string, code?: string) => void) | null = null
export const setUnauthorizedHandler = (fn: (message?: string, code?: string) => void) => { onUnauthorized = fn }

const TIMEOUT_MS = 30_000

export const DEMO = import.meta.env.VITE_DEMO === 'true'

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  if (DEMO) {
    try { return (await (await import('./demo')).demoHandle(method, path, body)) as T }
    catch (e) { if (e instanceof ApiError && e.status === 401 && !path.startsWith('/auth/login') && !path.startsWith('/auth/me')) onUnauthorized?.(e.message, e.code); throw e }
  }
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      signal: ctl.signal,
      headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(method !== 'GET' ? { 'X-CSRF-Token': csrf } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch (e) {
    // the request never got an answer: offline, DNS, server down, or our own timeout
    if ((e as Error)?.name === 'AbortError') throw new ApiError(0, 'Request timed out', 'timeout')
    throw new ApiError(0, 'Network error', 'network')
  } finally { clearTimeout(timer) }
  const ct = res.headers.get('content-type') ?? ''
  const data: any = ct.includes('json') ? await res.json().catch(() => null) : await res.text().catch(() => '')
  if (!res.ok) {
    // proxies / hosting can answer with HTML or empty bodies; never show that to a person
    const json = data && typeof data === 'object'
    const err = new ApiError(res.status, json && data.error ? String(data.error) : '', json ? data.code : undefined, json ? data.fields : undefined, json ? data.requestId ?? res.headers.get('x-request-id') ?? undefined : res.headers.get('x-request-id') ?? undefined)
    if (res.status === 401 && !path.startsWith('/auth/login') && !path.startsWith('/auth/me')) onUnauthorized?.(err.message, err.code)
    throw err
  }
  return data as T
}
export const get = <T = any>(p: string) => api<T>('GET', p)
export const post = <T = any>(p: string, b?: unknown) => api<T>('POST', p, b ?? {})
export const put = <T = any>(p: string, b: unknown) => api<T>('PUT', p, b)
export const patch = <T = any>(p: string, b: unknown) => api<T>('PATCH', p, b)

/** Authenticated CSV download (cookie auth, so no token in the URL). */
export async function downloadCsv(path: string, filename: string) {
  const blob = new Blob([await get<string>(path)], { type: 'text/csv' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob); a.download = filename; a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
