import { apiClient } from '@/lib/apiClient'

export interface SearchResponse {
  answer: string
}

export const searchReceipts = async (query: string): Promise<string> => {
  const response = await apiClient.post<SearchResponse>('/search', {
    query,
  })
  return response.data.answer
}
