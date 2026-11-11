import axios, { type AxiosError } from 'axios'

const DAILY_LIMIT_DETAIL =
  '本日のAI利用回数の上限に達しました。明日再度お試しください。'
const CONCURRENCY_LIMIT_DETAIL =
  'ほかのAI処理が実行中です。時間をおいて再度お試しください。'

export const RECEIPT_ANALYSIS_DAILY_LIMIT_MESSAGE =
  '本日のレシート解析回数の上限に達しました。明日改めてお試しください。'

export const RECEIPT_ANALYSIS_CONCURRENCY_LIMIT_MESSAGE =
  '同時に解析できる件数の上限に達しました。ほかの解析の完了を待ってから、もう一度お試しください。'

export const RECEIPT_ANALYSIS_RATE_LIMIT_MESSAGE =
  'AIの利用が一時的に制限されています。時間をおいてもう一度お試しください。'

export type ReceiptAnalysisFailure =
  | { kind: 'validation'; message: string }
  | { kind: 'auth' }
  | { kind: 'rate_limit'; message: string }
  | { kind: 'unavailable'; message: string }
  | { kind: 'generic' }

const rateLimitMessage = (error: AxiosError): string => {
  const data: unknown = error.response?.data
  const detail =
    typeof data === 'object' && data !== null && 'detail' in data
      ? data.detail
      : undefined
  if (detail === DAILY_LIMIT_DETAIL) return RECEIPT_ANALYSIS_DAILY_LIMIT_MESSAGE
  if (detail === CONCURRENCY_LIMIT_DETAIL) {
    return RECEIPT_ANALYSIS_CONCURRENCY_LIMIT_MESSAGE
  }
  return RECEIPT_ANALYSIS_RATE_LIMIT_MESSAGE
}

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
    return { kind: 'rate_limit', message: rateLimitMessage(error) }
  }
  if (status === 503) {
    return {
      kind: 'unavailable',
      message: '現在AI機能を利用できません。時間をおいて再度お試しください。',
    }
  }
  if (status === 502 || status === 504) {
    return {
      kind: 'unavailable',
      message:
        'サーバーとの通信に失敗しました。時間をおいて再度お試しください。',
    }
  }
  if (
    !error.response &&
    (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT')
  ) {
    return {
      kind: 'unavailable',
      message: '解析がタイムアウトしました。時間をおいて再度お試しください。',
    }
  }
  if (!error.response && error.code === 'ERR_NETWORK') {
    return {
      kind: 'unavailable',
      message: '通信できませんでした。ネットワーク接続を確認してください。',
    }
  }
  return { kind: 'generic' }
}
