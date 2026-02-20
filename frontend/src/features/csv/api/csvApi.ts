import { apiClient } from '@/lib/apiClient'
import { type ParsedTransaction } from '../types'

interface CsvParseResponse {
  transactions: ParsedTransaction[]
}

export const analyzeCsv = async (
  csvText: string
): Promise<CsvParseResponse> => {
  const response = await apiClient.post<CsvParseResponse>('/analyze_csv', {
    csv_text: csvText,
  })

  return response.data
}

export const saveCsv = async (transactions: ParsedTransaction[]) => {
  const response = await apiClient.post('/save_csv', {
    transactions,
  })
  return response.data
}
