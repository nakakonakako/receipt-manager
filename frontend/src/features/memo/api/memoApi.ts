import { apiClient } from '@/lib/apiClient'
import type { MemoSearchResultItem } from '../types'

export const searchMemoItems = async (
  query: string,
  headers: Record<string, string>
): Promise<MemoSearchResultItem[]> => {
  const response = await apiClient.get<{ items: MemoSearchResultItem[] }>(
    `/memo/search?query=${encodeURIComponent(query)}`,
    { headers }
  )
  return response.data.items
}
