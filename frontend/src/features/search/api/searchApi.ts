import { apiClient } from '@/lib/apiClient'

interface SearchResponse {
  answer: string
}

export const searchReceipts = async (
  query: string,
  headers: Record<string, string>
) => {
  const response = await apiClient.post<SearchResponse>(
    '/search',
    { query },
    { headers }
  )
  return response.data.answer
}
