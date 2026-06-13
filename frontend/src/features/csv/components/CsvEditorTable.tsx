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
      <div className="bg-green-50 p-4 rounded border border-green-200">
        <h3 className="font-bold text-green-800 mb-1">
          ✅ 解析完了 ({parsedData.length} 件)
        </h3>
        <p className="text-sm text-green-700">必要に応じて修正してください。</p>
      </div>

      <pre className="bg-gray-800 text-white p-3 text-xs overflow-x-auto rounded max-h-40 overflow-y-auto">
        {csvText}
      </pre>

      <div className="border border-gray-200 rounded overflow-hidden bg-white max-h-[60vh] overflow-y-auto">
        <table className="w-full table-fixed text-sm text-left text-gray-500">
          <thead className="text-xs text-gray-700 uppercase bg-gray-50 sticky top-0 shadow-sm z-10">
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
              <tr key={i} className="bg-white border-b hover:bg-gray-50">
                <td className="pl-2 pr-3 md:px-2 py-2 overflow-hidden">
                  <Input
                    type="date"
                    value={row.date}
                    onChange={(e) => onDataChange(i, 'date', e.target.value)}
                    className={`w-full min-w-0 max-w-full px-1 text-xs md:text-sm md:px-1.5 ${!row.date ? 'border-red-500 bg-red-50' : ''}`}
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
              ? 'bg-red-50 border-red-200 text-red-600'
              : 'bg-blue-50 border-blue-200 text-blue-800'
          }`}
        >
          {isWaiting ? (
            <p className="animate-pulse">
              ⚠️ API制限に到達しました。安全に書き込むため {waitTime}{' '}
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
        <Button variant="primary" onClick={onSaveClick} disabled={isSaving}>
          {isSaving ? '保存中...' : `全 ${parsedData.length} 件を保存する`}
        </Button>
      </div>
    </div>
  )
}
