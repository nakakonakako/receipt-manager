import { apiClient } from '@/lib/apiClient'
import type { TransactionsResponse } from '../types'

export const fetchTransactions = async (
  headers: Record<string, string>
): Promise<TransactionsResponse> => {
  const response = await apiClient.get<TransactionsResponse>('/transactions', {
    headers,
  })
  return response.data
}
