/**
 * ============================================================
 * APEX AI — Supabase Client (DISABLED — Local Auth Mode)
 * Supabase dependency removed. All auth uses localStorage.
 * This stub keeps imports working across the codebase.
 * ============================================================
 */

export const SUPABASE_CONFIGURED = false

// Full null-safe stub — every method returns safe no-ops
export const supabase = {
  auth: {
    getSession:            async () => ({ data: { session: null }, error: null }),
    getUser:               async () => ({ data: { user: null },    error: null }),
    signInWithPassword:    async () => ({ data: null, error: { message: 'Local auth mode — use localAuthService' } }),
    signUp:                async () => ({ data: null, error: { message: 'Local auth mode — use localAuthService' } }),
    signOut:               async () => ({ error: null }),
    resetPasswordForEmail: async () => ({ error: null }),
    updateUser:            async () => ({ data: null, error: null }),
    onAuthStateChange: (cb) => {
      Promise.resolve().then(() => cb('INITIAL_SESSION', null))
      return { data: { subscription: { unsubscribe: () => {} } } }
    },
  },
  from: () => ({
    select: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }),
    insert: () => Promise.resolve({ data: null, error: null }),
    update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
    delete: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
    upsert: () => Promise.resolve({ data: null, error: null }),
  }),
  channel: () => ({
    on:          function() { return this },
    subscribe:   function(cb) { cb?.('SUBSCRIBED'); return this },
    unsubscribe: () => {},
    track:       async () => {},
  }),
  removeChannel: () => {},
}

export default supabase
