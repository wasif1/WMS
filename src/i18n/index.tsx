import { Fragment, useSyncExternalStore, type ReactNode } from 'react'
import { ur } from './ur'

export type Lang = 'en' | 'ur'
export const LANGS: { id: Lang; label: string; native: string }[] = [{ id: 'en', label: 'English', native: 'English' }, { id: 'ur', label: 'Urdu', native: 'اردو' }]
const KEY = 'wms-lang'

const read = (): Lang => { try { const v = localStorage.getItem(KEY); if (v === 'ur' || v === 'en') return v } catch { /* storage blocked */ } return 'en' }
let current: Lang = typeof localStorage === 'undefined' ? 'en' : read()
const listeners = new Set<() => void>()

export const getLang = () => current
export const isRtl = () => current === 'ur'

function applyDocument() {
  if (typeof document === 'undefined') return
  const el = document.documentElement
  el.lang = current; el.dir = current === 'ur' ? 'rtl' : 'ltr'
}
export function setLang(l: Lang) {
  if (l === current) return
  current = l
  try { localStorage.setItem(KEY, l) } catch { /* ignore */ }
  applyDocument(); listeners.forEach((f) => f())
}
export const initLang = () => applyDocument()
export const subscribeLang = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f) } }
export const useLang = () => useSyncExternalStore(subscribeLang, getLang, () => 'en' as Lang)

type Vars = Record<string, string | number>
const fill = (s: string, vars?: Vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s)

/** Translate an English UI string (the English text IS the key). Placeholders look like {name}. Unknown strings fall back to English. */
export function t(key: string, vars?: Vars): string {
  return fill(current === 'ur' ? ur[key] ?? key : key, vars)
}
/** Marks a string for translation without translating it now (use for data tables); translate at the point of use with t(). */
export const ts = <S extends string>(key: S): S => key

/** Like t() but placeholders may be React nodes: <Trans k="Total {n} units" vars={{ n: <b>5</b> }} />. */
export function Trans({ k, vars }: { k: string; vars?: Record<string, ReactNode> }) {
  const tpl = current === 'ur' ? ur[k] ?? k : k
  const parts = tpl.split(/(\{\w+\})/g)
  return <>{parts.map((p, i) => { const m = /^\{(\w+)\}$/.exec(p); return m && vars && m[1] in vars ? <Fragment key={i}>{vars[m[1]]}</Fragment> : <Fragment key={i}>{p}</Fragment> })}</>
}

/** Locale for numbers/dates. Latin digits in both languages (what Pakistani business software normally uses). */
export const locale = () => (current === 'ur' ? 'ur-PK-u-nu-latn' : 'en-US')
