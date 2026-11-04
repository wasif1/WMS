import { ApiError } from './api'

export interface FieldIssue { field: string; message: string }
export interface Described {
  kind: 'network' | 'timeout' | 'session' | 'credentials' | 'permission' | 'notfound' | 'validation' | 'conflict' | 'toolarge' | 'ratelimit' | 'server' | 'unknown'
  title: string
  message: string
  fields: FieldIssue[]
  requestId?: string
  /** worth showing a "Try again" button */
  retryable: boolean
}

/**
 * The single place that decides what a person sees when something fails.
 * The server already sends a plain-language `error`; we add a short title, handle failures that never reach the
 * server (offline, timeout) and make sure nothing technical (stack traces, "undefined", raw JSON) is shown.
 */
export function describeError(e: unknown): Described {
  if (!(e instanceof ApiError)) {
    return { kind: 'unknown', title: 'Something unexpected happened', message: 'Please try again. If it keeps happening, reload the page.', fields: [], retryable: true }
  }
  const fields = e.fields ?? []
  const text = e.message && !/^(Failed to fetch|NetworkError|Load failed)/i.test(e.message) ? e.message : ''
  if (e.code === 'network') return { kind: 'network', title: "Can't reach the server", message: "Check your internet connection and try again. Nothing was saved.", fields, retryable: true }
  if (e.code === 'timeout') return { kind: 'timeout', title: 'The server is taking too long', message: 'It may be busy. Wait a few seconds and try again. If you were saving something, check the list first so it is not saved twice.', fields, retryable: true }
  switch (true) {
    case e.status === 401 && e.code === 'invalid_credentials': return { kind: 'credentials', title: 'Sign-in failed', message: text, fields, retryable: false }
    case e.status === 401 && (e.code === 'invalid_code' || e.code === 'mfa_expired' || e.code === 'mfa_failed'): return { kind: 'credentials', title: 'Verification failed', message: text, fields, retryable: false }
    case e.status === 401: return { kind: 'session', title: 'Please sign in again', message: text || 'Your session has ended.', fields, retryable: false }
    case e.status === 403 && e.code === 'csrf': return { kind: 'session', title: 'Page out of date', message: text, fields, retryable: true }
    case e.status === 403: return { kind: 'permission', title: 'Not allowed', message: text || "You don't have permission to do this. Ask a super admin to grant you access.", fields, retryable: false }
    case e.status === 404: return { kind: 'notfound', title: 'Not found', message: text || 'That item could not be found. It may have been removed - refresh and try again.', fields, retryable: false }
    case e.status === 409: return { kind: 'conflict', title: e.code === 'insufficient_stock' ? 'Stock is short' : e.code === 'duplicate' ? 'Already exists' : "That can't be done right now", message: text, fields, retryable: false }
    case e.status === 413: return { kind: 'toolarge', title: 'Too much at once', message: text || 'That request is too large. Try sending less at once.', fields, retryable: false }
    case e.status === 429: return { kind: 'ratelimit', title: 'Slow down a little', message: text || "You're doing that too quickly. Please wait a moment and try again.", fields, retryable: true }
    case e.status >= 500: return { kind: 'server', title: 'Something went wrong on our side', message: text && e.code === 'server_error' ? text : 'Please try again in a moment. If it keeps happening, contact support.', fields, requestId: e.requestId, retryable: true }
    case e.status === 400 && ['weak_password', 'wrong_password', 'invalid_code', 'duplicate'].includes(e.code ?? ''): return { kind: 'validation', title: 'Please check this', message: text, fields, retryable: false }
    case e.status === 400 && e.code === 'validation': return { kind: 'validation', title: fields.length > 1 ? 'Please fix these' : 'Please check this', message: fields.length > 1 ? '' : text, fields, retryable: false }
    default: return { kind: 'validation', title: "That didn't work", message: text || 'Please check what you entered and try again.', fields, retryable: false }
  }
}

/** One line suitable for a toast. */
export function errorLine(e: unknown): string {
  const d = describeError(e)
  if (d.fields.length > 1) return `${d.title}: ${d.fields.map((f) => f.message).join('; ')}`
  return d.message ? `${d.title}. ${d.message}` : d.title
}
