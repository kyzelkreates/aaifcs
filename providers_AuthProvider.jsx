/**
 * ============================================================
 * APEX AI — Auth Provider (Local Auth Mode)
 * Restores session from localStorage on app mount.
 * No Supabase dependency.
 * ============================================================
 */

import { useEffect } from 'react'
import { authService } from './services_supabase_authService'
import { useAuthStore } from './core_storage'

export default function AuthProvider({ children }) {
  const setLoading = useAuthStore(s => s.setLoading)

  useEffect(() => {
    setLoading(true)
    authService.getSession().finally(() => setLoading(false))
  }, [])

  return children
}
