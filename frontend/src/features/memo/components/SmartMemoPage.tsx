import React, { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { MemoRow } from './MemoRow'

export const SmartMemoPage: React.FC = () => {
  const [rowIds, setRowIds] = useState<number[]>(() => [Date.now()])

  const handleAddRow = () => {
    setRowIds([...rowIds, Date.now()])
  }

  const handleRemoveRow = (id: number) => {
    setRowIds(rowIds.filter((rowId) => rowId !== id))
  }

  return (
    <div className="bg-gray-50 rounded-xl min-h-[600px] flex flex-col max-w-4xl mx-auto p-4 sm:p-6">
      <div className="flex justify-between items-center border-b border-gray-200 pb-3 mb-6">
        <h2 className="text-xl font-bold text-gray-800">スマート買い物メモ</h2>
        <Button
          variant="primary"
          onClick={handleAddRow}
          className="px-4 font-bold shadow-sm"
        >
          ＋ メモを追加
        </Button>
      </div>

      <div className="space-y-4">
        {rowIds.length === 0 && (
          <div className="text-center py-20 text-gray-400 font-bold border-2 border-dashed rounded-xl border-gray-300 bg-white shadow-sm">
            「＋ メモを追加」ボタンから買い物の予定を追加してください。
          </div>
        )}

        {rowIds.map((id) => (
          <MemoRow key={id} onRemove={() => handleRemoveRow(id)} />
        ))}
      </div>
    </div>
  )
}
