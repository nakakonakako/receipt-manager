import React from 'react'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'

interface CsvPresetRenameModalProps {
  isOpen: boolean
  currentName: string
  editName: string
  onNameChange: (val: string) => void
  onClose: () => void
  onSave: () => void
}

export const CsvPresetRenameModal: React.FC<CsvPresetRenameModalProps> = ({
  isOpen,
  currentName,
  editName,
  onNameChange,
  onClose,
  onSave,
}) => {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex justify-center items-center p-4">
      <div className="bg-white rounded-xl shadow-2xl p-6 max-w-md w-full animate-in fade-in zoom-in duration-200">
        <h2 className="text-xl font-bold text-gray-800 mb-6">
          ✏️ プリセット名の変更
        </h2>

        <div className="mb-6">
          <label className="block text-sm font-bold text-gray-700 mb-2">
            新しい名前
          </label>
          <Input
            value={editName}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="新しい名前を入力..."
            className="w-full text-lg p-3"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSave()
            }}
          />
        </div>

        <div className="flex justify-end gap-3 mt-4">
          <Button variant="secondary" onClick={onClose}>
            キャンセル
          </Button>
          <Button
            variant="primary"
            onClick={onSave}
            disabled={!editName.trim() || editName === currentName}
          >
            変更を保存
          </Button>
        </div>
      </div>
    </div>
  )
}
