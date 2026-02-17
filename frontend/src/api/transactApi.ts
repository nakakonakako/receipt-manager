import { apiClient } from '@/lib/apiClient'
import { type Receipt } from '@/types'

export const saveTransaction = async (data: Receipt) => {
  return apiClient.post('/save', data)
}
