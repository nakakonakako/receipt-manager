import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  MAX_CSV_FILE_BYTES,
  MAX_CSV_LOGICAL_ROWS,
  countLogicalCsvRecords,
  decodeCsvBytes,
  encodedCsvRequestBytes,
  groupTransactionsByMonth,
} from '../src/features/csv/utils/csvLimits.ts'

describe('CSV logical rows, encodings, and monthly save groups', () => {
  it('counts quoted newlines as one logical record and enforces 20,000', () => {
    assert.equal(countLogicalCsvRecords(''), 0)
    assert.equal(countLogicalCsvRecords('a\n'.repeat(3)), 3)
    assert.equal(countLogicalCsvRecords('a\n\n'), 2)
    assert.equal(countLogicalCsvRecords('a,b'), 1)
    assert.equal(countLogicalCsvRecords('"a\nb",c\n'), 1)
    assert.equal(countLogicalCsvRecords('"a\r\nb",c\r\n'), 1)
    assert.equal(countLogicalCsvRecords('a"b\nc'), 2)
    assert.equal(
      countLogicalCsvRecords('x\n'.repeat(MAX_CSV_LOGICAL_ROWS)),
      MAX_CSV_LOGICAL_ROWS
    )
    assert.equal(
      countLogicalCsvRecords('"a\nb",c\n'.repeat(MAX_CSV_LOGICAL_ROWS + 1)),
      MAX_CSV_LOGICAL_ROWS + 1
    )
  })

  it('decodes UTF-8 and falls back to Shift-JIS', () => {
    const utf8 = new TextEncoder().encode('日付,店,金額\n2020-01-01,店,100\n')
    assert.equal(
      decodeCsvBytes(utf8.buffer),
      '日付,店,金額\n2020-01-01,店,100\n'
    )

    const shiftJisHiraganaA = new Uint8Array([0x82, 0xa0])
    assert.equal(decodeCsvBytes(shiftJisHiraganaA.buffer), 'あ')

    const shiftJisDate = new Uint8Array([0x93, 0xfa, 0x95, 0x74])
    assert.equal(decodeCsvBytes(shiftJisDate.buffer), '日付')
  })

  it('keeps the encoded request inside the 20MiB nginx body limit', () => {
    const csvText = 'a'.repeat(MAX_CSV_FILE_BYTES)
    assert.ok(encodedCsvRequestBytes(csvText, undefined) > MAX_CSV_FILE_BYTES)

    const small = '2020-01-01,店,100\n'
    assert.ok(encodedCsvRequestBytes(small, undefined) < MAX_CSV_FILE_BYTES)
  })

  it('saves multi-year rows through the existing per-month groups', () => {
    const groups = groupTransactionsByMonth([
      { date: '2018-02-03', store: '古い店', price: 120 },
      { date: '2026-11-30', store: '新しい店', price: 340 },
      { date: '2018-02-20', store: '古い店', price: 50 },
    ])

    assert.deepEqual(
      groups.map((group) => group.map((row) => row.date)),
      [['2018-02-03', '2018-02-20'], ['2026-11-30']]
    )
    assert.equal(groups.length, 2)
  })
})
