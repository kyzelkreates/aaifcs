/**
 * APEX AI — System Status Hook (Local Mode)
 * Monitors localStorage availability and sets system status.
 * No Supabase dependency.
 */

import { useEffect, useRef } from 'react'
import { useAppStore } from './core_storage'

export function useSystemStatus() {
  const setSystemStatus = useAppStore(s => s.setSystemStatus)
  const intervalRef     = useRef(null)

  useEffect(() => {
    const check = () => {
      try {
        // Lightweight localStorage ping
        localStorage.setItem('apex:heartbeat', Date.now().toString())
        localStorage.removeItem('apex:heartbeat')
        setSystemStatus('online')
      } catch {
        setSystemStatus('degraded')
      }
    }

    check()
    intervalRef.current = setInterval(check, 30000)
    return () => clearInterval(intervalRef.current)
  }, [setSystemStatus])
}

export default useSystemStatus
