import { apiClient } from '@/lib/apiClient'
import type { MemoRowRecord, MemoSearchResultItem } from '../types'

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

export const fetchMemoRows = async (
  headers: Record<string, string>
): Promise<MemoRowRecord[]> => {
  const response = await apiClient.get<{ rows: MemoRowRecord[] }>(
    '/memo/rows',
    {
      headers,
    }
  )
  return response.data.rows
}

export const createMemoRow = async (
  payload: { query: string; sortOrder: number },
  headers: Record<string, string>
): Promise<MemoRowRecord> => {
  const response = await apiClient.post<{ row: MemoRowRecord }>(
    '/memo/rows',
    {
      query: payload.query,
      sort_order: payload.sortOrder,
    },
    { headers }
  )
  return response.data.row
}

export const updateMemoRow = async (
  rowId: string,
  payload: { query: string; sortOrder: number },
  headers: Record<string, string>
): Promise<MemoRowRecord> => {
  const response = await apiClient.put<{ row: MemoRowRecord }>(
    `/memo/rows/${rowId}`,
    {
      query: payload.query,
      sort_order: payload.sortOrder,
    },
    { headers }
  )
  return response.data.row
}

export const deleteMemoRow = async (
  rowId: string,
  headers: Record<string, string>
): Promise<void> => {
  await apiClient.delete(`/memo/rows/${rowId}`, { headers })
}
