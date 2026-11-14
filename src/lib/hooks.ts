import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { get } from './api'
import { useToast } from '@/components/ui'
import { errorLine } from './errors'
import type { Client, Location, Product } from './types'

export const useLocations = (enabled = true) => useQuery({ queryKey: ['locations'], queryFn: () => get<Location[]>('/locations'), enabled })
/** Names of every active location, for NAMING where a transfer goes (the normal list only has the places a person may use). */
export const useDestinations = (enabled = true) => useQuery({ queryKey: ['destinations'], queryFn: () => get<{ id: number; name: string }[]>('/locations/destinations'), enabled })
export const useProducts = (enabled = true) => useQuery({ queryKey: ['products'], queryFn: () => get<Product[]>('/products'), enabled })
export const useClients = (enabled = true) => useQuery({ queryKey: ['clients'], queryFn: () => get<Client[]>('/clients'), enabled })

/** Mutation that toasts success/failure and invalidates the given query-key prefixes. */
export function useAction<V, R = any>(fn: (v: V) => Promise<R>, opts: { ok?: string; invalidate?: string[]; onSuccess?: (r: R) => void; /** also pop a toast on failure - for buttons that have no inline <ErrorBox> */ toastError?: boolean } = {}) {
  const qc = useQueryClient(); const toast = useToast()
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => { if (opts.ok) toast('ok', opts.ok); opts.invalidate?.forEach((k) => qc.invalidateQueries({ queryKey: [k] })); opts.onSuccess?.(r) },
    onError: (e: Error) => { if (opts.toastError) toast('err', errorLine(e)) },
  })
}
