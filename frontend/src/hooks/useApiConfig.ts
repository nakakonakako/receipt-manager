import { useAuth } from '../contexts/AuthContext'

export const useApiConfig = () => {
  const { session } = useAuth()

  const getHeaders = () => {
    const spreadsheetId = localStorage.getItem('spreadsheetId')
    const providerToken = session?.provider_token

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
