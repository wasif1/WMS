import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { setLang, t } from '@/i18n'
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
  /** shown on the sign-in page after an automatic sign-out (e.g. session expired) */
  notice: string | null
  clearNotice: () => void
}
const Ctx = createContext<AuthState | null>(null)
export const useAuth = () => { const c = useContext(Ctx); if (!c) throw new Error('AuthProvider missing'); return c }

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<string | null>(null)
  const qc = useQueryClient()

  const clear = useCallback(() => { setUser(null); setCsrf(''); qc.clear() }, [qc])
  const refresh = useCallback(async () => {
    try { const r = await get<{ user: Me; csrf: string }>('/auth/me'); setCsrf(r.csrf); setUser(r.user); if (r.user.language) setLang(r.user.language) }
    catch (e) { if (!(e instanceof ApiError)) throw e; clear() }
  }, [clear])

  useEffect(() => {
    setUnauthorizedHandler((message, code) => { setNotice(code === 'account_disabled' ? message ?? t('Your account is not active.') : t('Your session has ended, so we signed you out to keep your data safe. Please sign in again - anything you were typing was not saved.')); clear() })
    refresh().finally(() => setLoading(false))
  }, [clear, refresh])

  const value = useMemo<AuthState>(() => ({
    user, loading, notice, clearNotice: () => setNotice(null),
    can: (...perms) => !!user && (user.role === 'super_admin' || perms.some((p) => user.permissions.includes(p))),
    login: async (email, password) => {
      const r = await post('/auth/login', { email, password })
      if (r.mfaRequired) return { mfaToken: r.mfaToken as string }
      setCsrf(r.csrf); setUser(r.user); setNotice(null); if (r.user.language) setLang(r.user.language); return {}
    },
    loginMfa: async (mfaToken, code) => { const r = await post('/auth/login/mfa', { mfaToken, code }); setCsrf(r.csrf); setUser(r.user); if (r.user.language) setLang(r.user.language) },
    logout: async () => { try { await post('/auth/logout') } catch { /* already signed out or offline - still sign out locally */ } finally { setNotice(null); clear() } },
    refresh,
  }), [user, loading, notice, clear, refresh])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
