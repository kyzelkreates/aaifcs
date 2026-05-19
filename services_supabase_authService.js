/**
 * ============================================================
 * APEX AI — Local Auth Service (No Supabase)
 * All credentials stored in localStorage.
 * First-run creates accounts; subsequent logins validate them.
 *
 * Storage keys:
 *   apex:accounts        — array of { id, username, email, password, role, fullName, avatar }
 *   apex:session         — { userId, role, email, username, fullName, expiresAt }
 *   apex:setup_complete  — 'true' once initial accounts are created
 * ============================================================
 */

import { useAuthStore } from './core_storage'

// ─── Storage Keys ─────────────────────────────────────────────
const KEYS = {
  ACCOUNTS:       'apex:accounts',
  SESSION:        'apex:session',
  SETUP_COMPLETE: 'apex:setup_complete',
}

// ─── User Roles ───────────────────────────────────────────────
export const USER_ROLES = {
  SUPER_ADMIN:   'super_admin',
  FLEET_ADMIN:   'fleet_admin',
  FLEET_MANAGER: 'fleet_manager',
  DISPATCHER:    'dispatcher',
  COMPLIANCE:    'compliance',
  DRIVER:        'driver',
  VIEWER:        'viewer',
}

export const ROLE_LABELS = {
  super_admin:    'Super Admin',
  fleet_admin:    'Fleet Admin',
  fleet_manager:  'Fleet Manager',
  dispatcher:     'Dispatcher',
  compliance:     'Compliance Officer',
  driver:         'Driver',
  viewer:         'Viewer',
}

export const ROLE_HIERARCHY = [
  USER_ROLES.VIEWER,
  USER_ROLES.DRIVER,
  USER_ROLES.COMPLIANCE,
  USER_ROLES.DISPATCHER,
  USER_ROLES.FLEET_MANAGER,
  USER_ROLES.FLEET_ADMIN,
  USER_ROLES.SUPER_ADMIN,
]

export const hasPermission = (userRole, requiredRole) => {
  const ui = ROLE_HIERARCHY.indexOf(userRole)
  const ri = ROLE_HIERARCHY.indexOf(requiredRole)
  return ui >= ri
}

// ─── Helpers ──────────────────────────────────────────────────
const getAccounts = () => {
  try { return JSON.parse(localStorage.getItem(KEYS.ACCOUNTS) || '[]') }
  catch { return [] }
}

const saveAccounts = (accounts) => {
  localStorage.setItem(KEYS.ACCOUNTS, JSON.stringify(accounts))
}

const getStoredSession = () => {
  try {
    const raw = localStorage.getItem(KEYS.SESSION)
    if (!raw) return null
    const session = JSON.parse(raw)
    if (session.expiresAt && Date.now() > session.expiresAt) {
      localStorage.removeItem(KEYS.SESSION)
      return null
    }
    return session
  } catch { return null }
}

const saveSession = (session) => {
  localStorage.setItem(KEYS.SESSION, JSON.stringify({
    ...session,
    expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 days
  }))
}

const sessionToUser = (session) => ({
  id:       session.userId,
  email:    session.email,
  username: session.username,
  user_metadata: {
    role:      session.role,
    full_name: session.fullName,
    username:  session.username,
  }
})

// ─── Setup status ─────────────────────────────────────────────
export const isSetupComplete = () =>
  localStorage.getItem(KEYS.SETUP_COMPLETE) === 'true'

export const getAccounts_public = () => getAccounts()

// ─── Auth Service (same API as old Supabase authService) ──────
export const authService = {

  /**
   * First-run: create admin + driver accounts from setup form.
   */
  setupAccounts({ adminUsername, adminPassword, adminEmail,
                  driverUsername, driverPassword, driverEmail }) {
    const accounts = [
      {
        id:       'usr_admin_01',
        username: adminUsername.trim(),
        email:    (adminEmail || adminUsername).trim().toLowerCase(),
        password: adminPassword,
        role:     USER_ROLES.FLEET_ADMIN,
        fullName: 'Fleet Administrator',
      },
      {
        id:       'usr_driver_01',
        username: driverUsername.trim(),
        email:    (driverEmail || driverUsername).trim().toLowerCase(),
        password: driverPassword,
        role:     USER_ROLES.DRIVER,
        fullName: 'Driver',
      },
    ]
    saveAccounts(accounts)
    localStorage.setItem(KEYS.SETUP_COMPLETE, 'true')
    return { error: null }
  },

  /**
   * Sign in with username or email + password.
   */
  async signIn(emailOrUsername, password) {
    const accounts = getAccounts()
    const needle   = emailOrUsername.trim().toLowerCase()
    const account  = accounts.find(
      a => a.email.toLowerCase() === needle ||
           a.username.toLowerCase() === needle
    )

    if (!account) {
      return { user: null, session: null, error: { message: 'Account not found.' } }
    }
    if (account.password !== password) {
      return { user: null, session: null, error: { message: 'Incorrect password.' } }
    }

    const session = {
      userId:   account.id,
      email:    account.email,
      username: account.username,
      role:     account.role,
      fullName: account.fullName,
    }
    saveSession(session)

    const user = sessionToUser(session)
    useAuthStore.getState().setSession(session)
    useAuthStore.getState().setUser(user)
    useAuthStore.getState().setRole(account.role)

    return { user, session, error: null }
  },

  /**
   * Sign out.
   */
  async signOut() {
    localStorage.removeItem(KEYS.SESSION)
    useAuthStore.getState().clearAuth()
    return { error: null }
  },

  /**
   * Restore session from localStorage on app load.
   */
  async getSession() {
    const session = getStoredSession()
    if (session) {
      const user = sessionToUser(session)
      useAuthStore.getState().setSession(session)
      useAuthStore.getState().setUser(user)
      useAuthStore.getState().setRole(session.role)
      return { session, error: null }
    }
    return { session: null, error: null }
  },

  async getUser() {
    const session = getStoredSession()
    if (!session) return { user: null, error: null }
    return { user: sessionToUser(session), error: null }
  },

  /**
   * Change password for current user.
   */
  async updatePassword(userId, currentPassword, newPassword) {
    const accounts = getAccounts()
    const idx = accounts.findIndex(a => a.id === userId)
    if (idx === -1) return { error: { message: 'Account not found.' } }
    if (accounts[idx].password !== currentPassword) {
      return { error: { message: 'Current password incorrect.' } }
    }
    accounts[idx].password = newPassword
    saveAccounts(accounts)
    return { error: null }
  },

  async updateProfile(payload) {
    return { user: null, error: null }
  },

  async resetPassword(email) {
    return { error: { message: 'Password reset not available in local mode. Contact your administrator.' } }
  },

  /**
   * No-op — local auth doesn't need a real listener.
   */
  onAuthStateChange(callback) {
    return () => {}
  },
}

export default authService
