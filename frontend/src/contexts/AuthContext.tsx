/* eslint-disable react-refresh/only-export-components */

import React, { createContext, useContext, useState, useEffect } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

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
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setIsLoading(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      setIsLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [])

  const logout = async () => {
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
