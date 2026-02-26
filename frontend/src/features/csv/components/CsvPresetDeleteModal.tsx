import React from 'react'
import { Button } from '@/components/ui/Button'

interface CsvPresetDeleteModalProps {
  isOpen: boolean
  targetName: string
  onClose: () => void
  onDelete: () => void
}

export const CsvPresetDeleteModal: React.FC<CsvPresetDeleteModalProps> = ({
  isOpen,
  targetName,
  onClose,
  onDelete,
}) => {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex justify-center items-center p-4">
      <div className="bg-white rounded-xl shadow-2xl p-6 max-w-md w-full animate-in fade-in zoom-in duration-200">
        <h2 className="text-xl font-bold text-red-600 mb-2">⚠️ 削除の確認</h2>
        <p className="text-sm text-gray-600 mb-6">
          本当にプリセット「
          <strong className="text-gray-800">{targetName}</strong>
          」を削除してもよろしいですか？
          <br />
          この操作は元に戻せません。
        </p>

        <div className="flex justify-end gap-3 mt-4">
          <Button variant="secondary" onClick={onClose}>
            キャンセル
          </Button>
          <Button variant="danger" onClick={onDelete}>
            削除する
          </Button>
        </div>
      </div>
    </div>
  )
}
