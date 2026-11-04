import { T, isMsg, render, type Msg, type Lang } from './i18n/index.js'

export interface FieldError { field: string; message: string | Msg }

/**
 * Every error the API sends has the same shape: { error: <sentence a person can act on>, code: <stable id>, fields?: [...] }.
 * `code` lets the UI react (e.g. sign the user out on `session_expired`) without parsing text.
 * Messages are templates (see i18n) so the same error can be shown in English or Urdu.
 */
export class AppError extends Error {
  public msg: Msg | string
  constructor(public status: number, message: Msg | string, public code?: string, public fields?: FieldError[]) {
    super(isMsg(message) ? render(message, 'en') : message)
    this.msg = message
  }
  /** JSON body in the caller's language. */
  body(lang: Lang) {
    return { error: render(this.msg, lang), code: this.code ?? 'error', ...(this.fields ? { fields: this.fields.map((f) => ({ field: f.field, message: render(f.message, lang) })) } : {}) }
  }
}
const asMsg = (m: Msg | string): Msg | string => (typeof m === 'string' ? T(m) : m)
export const bad = (m: Msg | string, code = 'bad_request', fields?: FieldError[]) => new AppError(400, asMsg(m), code, fields)
export const notFound = (what: Msg | string = 'That item') => new AppError(404, T('{what} could not be found. It may have been removed - refresh the page and try again.', { what: asMsg(what) as Msg }), 'not_found')
export const conflict = (m: Msg | string, code = 'conflict') => new AppError(409, asMsg(m), code)
export const forbidden = (m: Msg | string = "You don't have permission to do this. Ask a super admin to grant you access.", code = 'forbidden') => new AppError(403, asMsg(m), code)
export const unauthenticated = (m: Msg | string = 'Please sign in to continue.', code = 'unauthenticated') => new AppError(401, asMsg(m), code)

/** Extra detail attached to unexpected (5xx) errors so support can find the matching log line. */
export const SERVER_ERROR_MESSAGE = T('Something went wrong on our side. Please try again in a moment. If it keeps happening, contact support and quote the reference below.')
