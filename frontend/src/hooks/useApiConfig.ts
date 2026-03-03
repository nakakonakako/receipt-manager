import { useAuth } from '../contexts/AuthContext'

export const useApiConfig = () => {
  const { session } = useAuth()

  const getHeaders = async () => {
    const token = session?.access_token

    if (!token) {
      alert('認証情報が見つかりませんでした。再度ログインしてください。')
      return null
    }

    return {
      'x-supabase-token': token,
    }
  }

  return { getHeaders }
}
