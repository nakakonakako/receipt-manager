import { apiClient } from '@/lib/apiClient'
import type { Receipt } from '@/types'

interface ReceiptResponse {
  receipts: Receipt[]
}

export const analyzeReceipt = async (file: File): Promise<ReceiptResponse> => {
  const formData = new FormData()
  formData.append('file', file)

  const response = await apiClient.post<ReceiptResponse>('/analyze', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  })

  return response.data
}

export const saveTransaction = async (data: Receipt) => {
  return apiClient.post('/save', data)
}
