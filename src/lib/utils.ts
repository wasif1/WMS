import { locale } from '@/i18n'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export const cn = (...i: ClassValue[]) => twMerge(clsx(i))
export const fmt = (n: number | undefined | null) => (n ?? 0).toLocaleString(locale(), { maximumFractionDigits: 3 })
export const fmtDate = (iso?: string) => (iso ? new Date(iso).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short', hourCycle: 'h23' }) : '-')
