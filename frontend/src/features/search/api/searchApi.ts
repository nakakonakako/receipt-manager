import { apiClient } from '@/lib/apiClient'

interface SearchResponse {
  answer: string
}

export const searchReceipts = async (
  query: string,
  dataType: string,
  period: string,
  headers: Record<string, string>
) => {
  const response = await apiClient.post<SearchResponse>(
    '/search',
    { query, dataType: dataType, period },
    { headers }
  )
  return response.data.answer
}
