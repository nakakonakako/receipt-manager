import { apiClient } from '@/lib/apiClient'
import type { Receipt } from '../types'

interface ReceiptResponse {
  receipts: Receipt[]
}

export const analyzeReceipt = async (
  files: File[],
  headers: Record<string, string>
): Promise<ReceiptResponse> => {
  const formData = new FormData()
  files.forEach((file) => {
    formData.append('files', file)
  })

  const response = await apiClient.post<ReceiptResponse>('/analyze', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
      ...headers,
    },
  })

  return response.data
}

export const saveTransaction = async (
  data: Receipt,
  headers: Record<string, string>
) => {
  return apiClient.post('/save', data, { headers })
}
