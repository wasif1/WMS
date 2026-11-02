/** Small fetch wrapper: same-origin cookies (httpOnly session), CSRF header on writes, typed errors. */
export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message) }
}

let csrf = ''
export const setCsrf = (t: string) => { csrf = t }
let onUnauthorized: (() => void) | null = null
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn }

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(method !== 'GET' ? { 'X-CSRF-Token': csrf } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (res.status === 401 && !path.startsWith('/auth/login')) onUnauthorized?.()
  const ct = res.headers.get('content-type') ?? ''
  const data = ct.includes('json') ? await res.json().catch(() => null) : await res.text()
  if (!res.ok) throw new ApiError(res.status, (data && (data as any).error) || res.statusText, (data as any)?.code)
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
