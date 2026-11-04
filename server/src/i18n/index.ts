import { ur } from './ur.js'

export type Lang = 'en' | 'ur'
/** A translatable message: an English template with {placeholders} and their values. Values may be nested messages or lists. */
export interface Msg { tpl: string; params?: Record<string, MsgValue> }
export interface MsgList { items: Array<string | Msg>; sep: ', ' | '; ' }
export type MsgValue = string | number | Msg | MsgList | Array<string | Msg>
/** A joined list inside a message (comma or semicolon, in the right script for the language). */
export const list = (items: Array<string | Msg>, sep: ', ' | '; ' = '; '): MsgList => ({ items, sep })
export const isMsg = (m: unknown): m is Msg => typeof m === 'object' && m !== null && 'tpl' in m && typeof (m as Msg).tpl === 'string'

/** Mark a message for translation. The English template is the dictionary key. */
export const T = (tpl: string, params?: Record<string, MsgValue>): Msg => ({ tpl, params })

const SEP = { en: { ', ': ', ', '; ': '; ' }, ur: { ', ': '، ', '; ': '؛ ' } } as const
const val = (v: MsgValue, lang: Lang): string => {
  if (typeof v === 'string' || typeof v === 'number') return String(v)
  if (Array.isArray(v)) return v.map((x) => render(x, lang)).join(SEP[lang]['; '])
  if ('items' in v) return v.items.map((x) => render(x, lang)).join(SEP[lang][v.sep])
  return render(v, lang)
}

/** Render a message (or plain string) in a language. Unknown templates fall back to English. */
export function render(m: Msg | string, lang: Lang): string {
  if (typeof m === 'string') return m
  const tpl = lang === 'ur' ? ur[m.tpl] ?? m.tpl : m.tpl
  return m.params ? tpl.replace(/\{(\w+)\}/g, (full, k) => (k in m.params! ? val(m.params![k], lang) : full)) : tpl
}

export const langOf = (header: unknown): Lang => (String(header ?? '').trim().toLowerCase().startsWith('ur') ? 'ur' : 'en')

/** Order/audit/etc. status words used inside messages. */
const STATUS: Record<string, Msg> = {
  pending: T('awaiting approval'), submitted: T('awaiting approval'), approved: T('approved'), rejected: T('rejected'), draft: T('draft'), in_transit: T('in transit'),
  received: T('received'), cancelled: T('cancelled'), active: T('active'), converted: T('converted'), saved: T('saved'), confirmed: T('confirmed'), counting: T('counting'),
}
export const statusWord = (s: string): Msg => STATUS[s] ?? T(String(s).replace('_', ' '))
