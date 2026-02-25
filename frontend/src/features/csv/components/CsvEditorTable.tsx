import React from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { NumberInput } from '@/components/ui/NumberInput'
import { type CsvEditorTableProps } from '../types'

export const CsvEditorTable: React.FC<CsvEditorTableProps> = ({
  parsedData,
  onDataChange,
  onDeleteRow,
  newPresetName,
  onNewPresetNameChange,
  onSavePreset,
  isSaving,
  isWaiting,
  waitTime,
  progress,
  onReset,
  onSaveClick,
}) => {
  return (
    <div className="space-y-4">
      <div className="bg-green-50 p-4 rounded border border-green-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h3 className="font-bold text-green-800 mb-1">
            ✅ 解析完了 ({parsedData.length} 件)
          </h3>
          <p className="text-sm text-green-700">
            不要な行は削除し、必要に応じて修正してください。
          </p>
        </div>

        <div className="flex gap-2 bg-white p-2 rounded shadow-sm border border-green-200">
          <Input
            value={newPresetName}
            onChange={(e) => onNewPresetNameChange(e.target.value)}
            placeholder="例: PayPay明細"
            className="w-40 text-sm"
          />
          <Button
            variant="secondary"
            onClick={onSavePreset}
            className="text-sm px-3 whitespace-nowrap"
          >
            ルールをクラウド保存
          </Button>
        </div>
      </div>

      <div className="border border-gray-200 rounded overflow-hidden bg-white max-h-[60vh] overflow-y-auto">
        <table className="w-full text-sm text-left text-gray-500">
          <thead className="text-xs text-gray-700 uppercase bg-gray-50 sticky top-0 shadow-sm z-10">
            <tr>
              <th className="px-4 py-3 w-2/12">日付</th>
              <th className="px-4 py-3 w-6/12">店名</th>
              <th className="px-4 py-3 w-3/12">金額</th>
              <th className="px-4 py-3 w-1/12 text-center">削除</th>
            </tr>
          </thead>
          <tbody>
            {parsedData.map((row, i) => (
              <tr key={i} className="bg-white border-b hover:bg-gray-50">
                <td className="px-2 py-2">
                  <Input
                    type="date"
                    value={row.date}
                    onChange={(e) => onDataChange(i, 'date', e.target.value)}
                    className={`w-full ${!row.date ? 'border-red-500 bg-red-50' : ''}`}
                  />
                </td>
                <td className="px-2 py-2">
                  <Input
                    value={row.store}
                    onChange={(e) => onDataChange(i, 'store', e.target.value)}
                    className="w-full"
                  />
                </td>
                <td className="px-2 py-2">
                  <NumberInput
                    value={row.price}
                    onChange={(val) => onDataChange(i, 'price', val)}
                    className="w-full"
                  />
                </td>
                <td className="px-2 py-2 text-center">
                  <Button variant="danger" onClick={() => onDeleteRow(i)}>
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
