export interface FieldError { field: string; message: string }

/**
 * Every error the API sends has the same shape: { error: <sentence a person can act on>, code: <stable id>, fields?: [...] }.
 * `code` lets the UI react (e.g. sign the user out on `session_expired`) without parsing text.
 */
export class AppError extends Error {
  constructor(public status: number, message: string, public code?: string, public fields?: FieldError[]) {
    super(message)
  }
}
export const bad = (m: string, code = 'bad_request', fields?: FieldError[]) => new AppError(400, m, code, fields)
export const notFound = (what = 'That item') => new AppError(404, `${what} could not be found. It may have been removed - refresh the page and try again.`, 'not_found')
export const conflict = (m: string, code = 'conflict') => new AppError(409, m, code)
export const forbidden = (m = "You don't have permission to do this. Ask a super admin to grant you access.", code = 'forbidden') => new AppError(403, m, code)
export const unauthenticated = (m = 'Please sign in to continue.', code = 'unauthenticated') => new AppError(401, m, code)

/** Extra detail attached to unexpected (5xx) errors so support can find the matching log line. */
export const SERVER_ERROR_MESSAGE = 'Something went wrong on our side. Please try again in a moment. If it keeps happening, contact support and quote the reference below.'
