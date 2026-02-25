import { apiClient } from '@/lib/apiClient'
import { type CsvMapping, type ParsedTransaction } from '../types'

interface CsvParseResponse {
  transactions: ParsedTransaction[]
  mapping: CsvMapping
}

export const analyzeCsv = async (
  csvText: string,
  mapping?: CsvMapping
): Promise<CsvParseResponse> => {
  const response = await apiClient.post<CsvParseResponse>('/analyze_csv', {
    csv_text: csvText,
    mapping: mapping,
  })

  return response.data
}

export const saveCsv = async (
  transactions: ParsedTransaction[],
  headers: Record<string, string>
) => {
  const response = await apiClient.post(
    '/save_csv',
    { transactions },
    { headers }
  )
  return response.data
}
