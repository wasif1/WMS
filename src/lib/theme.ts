import { useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'
const KEY = 'wms-theme'
const read = (): Theme => {
  try { const v = localStorage.getItem(KEY); if (v === 'light' || v === 'dark') return v } catch { /* storage blocked */ }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}
const apply = (t: Theme) => document.documentElement.classList.toggle('dark', t === 'dark')
export const initTheme = () => apply(read())

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(read)
  useEffect(() => { apply(theme); try { localStorage.setItem(KEY, theme) } catch { /* ignore */ } }, [theme])
  return { theme, toggle: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')) }
}

const SIZE_KEY = 'wms-textsize'
const readSize = (): 'normal' | 'large' => { try { return localStorage.getItem(SIZE_KEY) === 'large' ? 'large' : 'normal' } catch { return 'normal' } }
const applySize = (v: 'normal' | 'large') => { document.documentElement.style.fontSize = v === 'large' ? '19px' : '' }
export const initTextSize = () => applySize(readSize())
/** "Bigger text" switch: scales the whole screen (all sizes are rem-based). */
export function useTextSize() {
  const [size, setSize] = useState<'normal' | 'large'>(readSize)
  useEffect(() => { applySize(size); try { localStorage.setItem(SIZE_KEY, size) } catch { /* ignore */ } }, [size])
  return { large: size === 'large', toggle: () => setSize((s) => (s === 'large' ? 'normal' : 'large')) }
}
