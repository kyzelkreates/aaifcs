/**
 * ============================================================
 * APEX AI — useAuth Hook
 * /src/hooks/useAuth.js
 *
 * Convenient hook for reading auth state from SSOT.
 * Components use this instead of importing the store directly.
 * ============================================================
 */

import { useAuthStore } from './core_storage'
import { authService, hasPermission, USER_ROLES, ROLE_LABELS } from './services_supabase_authService'

export function useAuth() {
  const { user, role, session, isAuthenticated, isLoading } = useAuthStore(s => ({
    user:            s.user,
    role:            s.role,
    session:         s.session,
    isAuthenticated: s.isAuthenticated,
    isLoading:       s.isLoading
  }))

  return {
    user,
    role,
    session,
    isAuthenticated,
    isLoading,
    roleLabel:  ROLE_LABELS[role] || role,
    can:        (requiredRole) => hasPermission(role, requiredRole),
    isDriver:   role === USER_ROLES.DRIVER,
    isAdmin:    hasPermission(role, USER_ROLES.FLEET_ADMIN),
    isSuperAdmin: role === USER_ROLES.SUPER_ADMIN,
    signOut:    authService.signOut.bind(authService)
  }
}

export default useAuth
