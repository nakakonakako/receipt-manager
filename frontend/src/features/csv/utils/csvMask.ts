const DATE_REGEX = /\d{4}[/\-年]\d{1,2}[/\-月]\d{1,2}/
const MONEY_REGEX = /^[-\d,¥￥.]+$/

export const maskCsvData = (
  rawCsv: string,
  rowsToProcess: number = 5
): string => {
  const lines = rawCsv.split(/\r\n|\n|\r/).filter((line) => line.trim() !== '')

  if (lines.length === 0) return ''

  const headers = lines[0]
  const targetLines = lines.slice(1, rowsToProcess + 1)

  const maskedLines = targetLines.map((line) => {
    const columns = line.split(',')

    const maskedColumns = columns.map((col) => {
      const val = col.trim()

      // 日付形式のマスク
      if (DATE_REGEX.test(val)) {
        return val.replace(/\d/g, '1')
      }

      // 金額形式のマスク
      if (MONEY_REGEX.test(val)) {
        return val.replace(/\d/g, '9')
      }

      return 'Sample_Text'
    })

    return maskedColumns.join(',')
  })

  return [headers, ...maskedLines].join('\n')
}
