import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ApiError, get, post, setCsrf, setUnauthorizedHandler } from '@/lib/api'
import type { Me } from '@/lib/types'

interface AuthState {
  user: Me | null
  loading: boolean
  can: (...perms: string[]) => boolean
  login: (email: string, password: string) => Promise<{ mfaToken?: string }>
  loginMfa: (mfaToken: string, code: string) => Promise<void>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}
const Ctx = createContext<AuthState | null>(null)
export const useAuth = () => { const c = useContext(Ctx); if (!c) throw new Error('AuthProvider missing'); return c }

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)
  const qc = useQueryClient()

  const clear = useCallback(() => { setUser(null); setCsrf(''); qc.clear() }, [qc])
  const refresh = useCallback(async () => {
    try { const r = await get<{ user: Me; csrf: string }>('/auth/me'); setCsrf(r.csrf); setUser(r.user) }
    catch (e) { if (!(e instanceof ApiError)) throw e; clear() }
  }, [clear])

  useEffect(() => { setUnauthorizedHandler(clear); refresh().finally(() => setLoading(false)) }, [clear, refresh])

  const value = useMemo<AuthState>(() => ({
    user, loading,
    can: (...perms) => !!user && (user.role === 'super_admin' || perms.some((p) => user.permissions.includes(p))),
    login: async (email, password) => {
      const r = await post('/auth/login', { email, password })
      if (r.mfaRequired) return { mfaToken: r.mfaToken as string }
      setCsrf(r.csrf); setUser(r.user); return {}
    },
    loginMfa: async (mfaToken, code) => { const r = await post('/auth/login/mfa', { mfaToken, code }); setCsrf(r.csrf); setUser(r.user) },
    logout: async () => { try { await post('/auth/logout') } finally { clear() } },
    refresh,
  }), [user, loading, clear, refresh])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
