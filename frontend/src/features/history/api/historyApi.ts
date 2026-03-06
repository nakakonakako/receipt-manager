import { apiClient } from '@/lib/apiClient'
import type {
  TransactionsResponse,
  HistoryReceipt,
  HistoryCsvTransaction,
} from '../types'

export const fetchAvailableMonths = async (
  headers: Record<string, string>
): Promise<{ receipts: string[]; csv: string[] }> => {
  const response = await apiClient.get<{ receipts: string[]; csv: string[] }>(
    '/available_months',
    {
      headers,
    }
  )
  return response.data
}

export const fetchTransactions = async (
  month: string,
  headers: Record<string, string>
): Promise<TransactionsResponse> => {
  const response = await apiClient.get<TransactionsResponse>(
    `/transactions?month=${month}`,
    {
      headers,
    }
  )
  return response.data
}

export const updateReceipt = async (
  id: string,
  data: HistoryReceipt,
  headers: Record<string, string>
): Promise<void> => {
  await apiClient.put(`/receipts/${id}`, data, { headers })
}

export const updateCsvTransaction = async (
  id: string,
  data: HistoryCsvTransaction,
  headers: Record<string, string>
): Promise<void> => {
  await apiClient.put(`/csv_transactions/${id}`, data, { headers })
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
