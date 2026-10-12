/* eslint-disable react-refresh/only-export-components */

import React, { createContext, useContext, useState, useEffect } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { receiptUploaderStateCache } from '../features/receipt/hooks/receiptUploaderStateCache'

type AuthContextType = {
  session: Session | null
  isLoading: boolean
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  isLoading: true,
  logout: async () => {},
})

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [session, setSession] = useState<Session | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let isActive = true
    let authEventVersion = 0
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      authEventVersion += 1
      receiptUploaderStateCache.setOwner(session?.user.id ?? null)
      setSession(session)
      setIsLoading(false)
    })

    const initialAuthEventVersion = authEventVersion
    void supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (!isActive || authEventVersion !== initialAuthEventVersion) return
        receiptUploaderStateCache.setOwner(session?.user.id ?? null)
        setSession(session)
        setIsLoading(false)
      })
      .catch((error: unknown) => {
        if (!isActive || authEventVersion !== initialAuthEventVersion) return
        receiptUploaderStateCache.setOwner(null)
        console.error('Failed to restore authentication session:', error)
        setIsLoading(false)
      })

    return () => {
      isActive = false
      subscription.unsubscribe()
    }
  }, [])

  const logout = async () => {
    receiptUploaderStateCache.setOwner(null)
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider value={{ session, isLoading, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => {
  return useContext(AuthContext)
}
