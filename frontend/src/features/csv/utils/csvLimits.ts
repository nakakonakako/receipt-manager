import {
  type CsvMapping,
  type LegacyCsvMapping,
  type ParsedTransaction,
} from '../types/index.ts'

export const MAX_CSV_FILE_BYTES = 20 * 1024 * 1024
export const MAX_CSV_LOGICAL_ROWS = 20_000

export const CSV_ROW_LIMIT_MESSAGE = 'CSVは20,000行以内にしてください。'
export const CSV_SIZE_LIMIT_MESSAGE =
  'CSVファイルが大きすぎます。20MiB以下のファイルを選択してください。'
export const CSV_REQUEST_SIZE_LIMIT_MESSAGE =
  'CSVファイルまたは送信内容が大きすぎます。20MiB以下のCSVを選択してください。'

export function decodeCsvBytes(bytes: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('shift_jis').decode(bytes)
  }
}

export function countLogicalCsvRecords(csvText: string): number {
  if (csvText.length === 0) return 0

  let rows = 0
  let inQuotes = false
  let fieldStart = true
  let recordHasContent = false
  let index = 0

  while (index < csvText.length) {
    const character = csvText[index]

    if (inQuotes) {
      recordHasContent = true
      if (character === '"') {
        if (csvText[index + 1] === '"') {
          index += 2
          continue
        }
        inQuotes = false
        fieldStart = false
      }
      index += 1
      continue
    }

    if (fieldStart && character === '"') {
      inQuotes = true
      recordHasContent = true
      fieldStart = false
      index += 1
      continue
    }

    if (character === ',') {
      fieldStart = true
      recordHasContent = true
      index += 1
      continue
    }

    if (character === '\n' || character === '\r') {
      rows += 1
      fieldStart = true
      recordHasContent = false
      index += character === '\r' && csvText[index + 1] === '\n' ? 2 : 1
      continue
    }

    recordHasContent = true
    fieldStart = false
    index += 1
  }

  if (recordHasContent || inQuotes) rows += 1
  return rows
}

export function encodedCsvRequestBytes(
  csvText: string,
  mapping: CsvMapping | LegacyCsvMapping | undefined
): number {
  const payload =
    mapping === undefined
      ? { csv_text: csvText }
      : { csv_text: csvText, mapping }
  return new TextEncoder().encode(JSON.stringify(payload)).length
}

export function groupTransactionsByMonth(
  transactions: readonly ParsedTransaction[]
): ParsedTransaction[][] {
  const groups: ParsedTransaction[][] = []
  const indexByMonth = new Map<string, number>()

  for (const transaction of transactions) {
    const month = transaction.date.substring(0, 7)
    const existingIndex = indexByMonth.get(month)
    if (existingIndex === undefined) {
      indexByMonth.set(month, groups.length)
      groups.push([transaction])
    } else {
      groups[existingIndex].push(transaction)
    }
  }

  return groups
}
