import React from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { NumberInput } from '@/components/ui/NumberInput'
import { type CsvEditorTableProps } from '../types'

export const CsvEditorTable: React.FC<CsvEditorTableProps> = ({
  csvText,
  parsedData,
  onDataChange,
  onDeleteRow,
  isSaving,
  isWaiting,
  waitTime,
  progress,
  onReset,
  onSaveClick,
}) => {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-green-200 bg-green-50 p-4">
        <h3 className="mb-1 font-semibold text-green-900">
          解析完了 ({parsedData.length} 件)
        </h3>
        <p className="text-sm text-green-700">必要に応じて修正してください。</p>
      </div>

      <pre className="max-h-40 overflow-auto rounded-md bg-stone-800 p-3 text-xs text-stone-50">
        {csvText}
      </pre>

      <div className="max-h-[60vh] overflow-auto rounded-lg border border-[var(--rm-border-subtle)] bg-[var(--rm-surface)]">
        <table className="w-full table-fixed text-sm text-left text-[var(--rm-text-muted)]">
          <thead className="sticky top-0 z-10 bg-[var(--rm-surface-muted)] text-xs uppercase text-[var(--rm-text-secondary)] shadow-sm">
            <tr>
              <th className="pl-2 pr-3 md:px-2 py-3 w-[36%] md:w-[27%] whitespace-nowrap">
                日付
              </th>
              <th className="pl-3 pr-2 md:px-2 py-3 w-[31%] md:w-[40%] whitespace-nowrap">
                店名
              </th>
              <th className="px-2 py-3 w-[20%] md:w-[22%] whitespace-nowrap">
                金額
              </th>
              <th className="px-1 py-3 w-[13%] md:w-[11%] text-center whitespace-nowrap">
                削除
              </th>
            </tr>
          </thead>
          <tbody>
            {parsedData.map((row, i) => (
              <tr key={i} className="border-b border-[var(--rm-border-subtle)] bg-[var(--rm-surface)] hover:bg-[var(--rm-surface-subtle)]">
                <td className="pl-2 pr-3 md:px-2 py-2 overflow-hidden">
                  <Input
                    type="date"
                    value={row.date}
                    onChange={(e) => onDataChange(i, 'date', e.target.value)}
                    className={`w-full min-w-0 max-w-full px-1 text-xs md:px-1.5 md:text-sm ${!row.date ? 'border-red-500 bg-red-50' : ''}`}
                  />
                </td>
                <td className="pl-3 pr-2 md:px-2 py-2">
                  <Input
                    value={row.store}
                    onChange={(e) => onDataChange(i, 'store', e.target.value)}
                    className="w-full min-w-0"
                  />
                </td>
                <td className="px-2 py-2">
                  <NumberInput
                    value={row.price}
                    onChange={(val) => onDataChange(i, 'price', val)}
                    className="w-full min-w-0"
                  />
                </td>
                <td className="px-1 py-2 text-center">
                  <Button
                    variant="danger"
                    onClick={() => onDeleteRow(i)}
                    className="px-2"
                  >
                    ✕
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isSaving && (
        <div
          className={`p-4 rounded border text-center font-bold ${
            isWaiting
              ? 'border-amber-300 bg-amber-50 text-amber-900'
              : 'border-blue-200 bg-blue-50 text-blue-900'
          }`}
        >
          {isWaiting ? (
            <p className="animate-pulse">
              API制限に到達しました。安全に書き込むため {waitTime}{' '}
              秒待機しています...
            </p>
          ) : (
            <p>
              保存中... ({progress.current} / {progress.total} ヶ月分 完了)
            </p>
          )}
        </div>
      )}

      <div className="flex justify-end gap-3 pt-4">
        <Button variant="secondary" onClick={onReset}>
          やり直す
        </Button>
          <Button
            variant="primary"
            onClick={onSaveClick}
            disabled={isSaving}
            className="bg-[var(--rm-csv)] hover:bg-green-800 active:bg-green-900"
          >
          {isSaving ? '保存中...' : `全 ${parsedData.length} 件を保存する`}
        </Button>
      </div>
    </div>
  )
}
