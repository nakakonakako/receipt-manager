import axios, { type AxiosError } from 'axios'

export const RECEIPT_ANALYSIS_RATE_LIMIT_MESSAGE =
  '同時に解析できる件数の上限に達しました。ほかの解析の完了を待ってから、もう一度お試しください。'

export type ReceiptAnalysisFailure =
  | { kind: 'validation'; message: string }
  | { kind: 'auth' }
  | { kind: 'rate_limit'; message: string }
  | { kind: 'generic' }

const validationMessage = (error: AxiosError): string | null => {
  const data: unknown = error.response?.data
  if (
    typeof data === 'object' &&
    data !== null &&
    'detail' in data &&
    typeof data.detail === 'string'
  ) {
    return data.detail
  }
  return null
}

export const classifyReceiptAnalysisError = (
  error: unknown
): ReceiptAnalysisFailure => {
  if (!axios.isAxiosError(error)) return { kind: 'generic' }
  const status = error.response?.status
  if (status === 422) {
    const message = validationMessage(error)
    if (message !== null) return { kind: 'validation', message }
  }
  if (status === 401 || status === 403) return { kind: 'auth' }
  if (status === 429) {
    return {
      kind: 'rate_limit',
      message: RECEIPT_ANALYSIS_RATE_LIMIT_MESSAGE,
    }
  }
  return { kind: 'generic' }
}
