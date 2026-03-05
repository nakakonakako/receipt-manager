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

export const deleteReceipt = async (
  id: string,
  headers: Record<string, string>
): Promise<void> => {
  await apiClient.delete(`/receipts/${id}`, { headers })
}

export const deleteCsvTransaction = async (
  id: string,
  headers: Record<string, string>
): Promise<void> => {
  await apiClient.delete(`/csv_transactions/${id}`, { headers })
}
