import React, { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/Button'

export const Auth: React.FC = () => {
  const [isLoading, setIsLoading] = useState(false)

  const handleGoogleLogin = async () => {
    setIsLoading(true)
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/`,
        },
      })

      if (error) throw error
    } catch (error) {
      console.error('Login error:', error)
      alert('ログインに失敗しました。もう一度お試しください。')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-4">
      <div className="bg-white p-8 rounded shadow-md text-center max-w-sm w-full">
        <h2 className="text-2xl font-bold mb-6 text-gray-800">
          Receipt Manager
        </h2>
        <p className="text-sm text-gray-600 mb-6">
          レシートを記録・管理するためにログインしてください。
        </p>
        <Button
          onClick={handleGoogleLogin}
          disabled={isLoading}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white"
        >
          {isLoading ? '処理中...' : 'Googleでログイン'}
        </Button>
      </div>
    </div>
  )
}
