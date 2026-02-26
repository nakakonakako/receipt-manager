import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'

export const useApiConfig = () => {
  const { session } = useAuth()

  const getHeaders = async () => {
    const providerToken = session?.provider_token

    let spreadsheetId = null
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (user) {
      const { data } = await supabase
        .from('user_settings')
        .select('spreadsheet_id')
        .eq('user_id', user.id)
        .single()

      spreadsheetId = data?.spreadsheet_id
    }

    if (!spreadsheetId) {
      alert(
        '右上の「⚙️ 設定」から、連携するスプレッドシートIDを登録してください。'
      )
      return null
    }

    if (!providerToken) {
      alert('認証情報が見つかりませんでした。再度ログインしてください。')
      return null
    }

    return {
      'x-access-token': providerToken,
      'x-spreadsheet-id': spreadsheetId,
    }
  }

  return { getHeaders }
}
