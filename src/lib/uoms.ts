import { useQuery } from '@tanstack/react-query'
import { t } from '@/i18n'
import { useAuth } from '@/auth/AuthContext'
import { get } from './api'

import { BUILTIN_UOMS, type Uom } from './uomList'
export { BUILTIN_UOMS, type Uom }

// Module cache so plain functions (labels, approval sentences) can look units up; the hook below keeps it fresh.
let cache: Uom[] = BUILTIN_UOMS
export const setUoms = (list: Uom[]) => { cache = list }
const info = (key: string) => cache.find((u) => u.key === key)
/** Built-ins are translated; names the super admin typed are shown exactly as typed. */
export const uomLabel = (key: string) => { const u = info(key); return u ? (u.builtin ? t(u.label) : u.label) : key }
export const uomShort = (key: string) => { const u = info(key); return u ? (u.builtin ? t(u.short) : u.short) : key }
export const uomDecimals = (key: string) => info(key)?.decimals ?? false

/** Loads the unit list (built-in + custom). Only for people who can see products, same rule as the server. */
export function useUoms() {
  const { can } = useAuth()
  return useQuery({
    queryKey: ['uoms'], staleTime: 60_000,
    enabled: can('products.view', 'products.create', 'inbound.create', 'inbound.view', 'transfers.create', 'reserves.create', 'outbound.create', 'adjustments.create', 'adjustments.view', 'audits.view', 'reports.inventory', 'reports.orders', 'dashboard.view'),
    queryFn: async () => { const list = await get<Uom[]>('/uoms'); setUoms(list); return list },
  })
}
