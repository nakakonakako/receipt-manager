import React from 'react'
import { Button } from '@/components/ui/Button'
import { CsvIconPicker } from './CsvIconPicker'

interface CsvPresetIconModalProps {
  isOpen: boolean
  presetName: string
  value: string
  onChange: (icon: string) => void
  onClose: () => void
  onSave: () => void
}

export const CsvPresetIconModal: React.FC<CsvPresetIconModalProps> = ({
  isOpen,
  presetName,
  value,
  onChange,
  onClose,
  onSave,
}) => {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex justify-center items-center p-4">
      <div className="bg-white rounded-xl shadow-2xl p-6 max-w-md w-full animate-in fade-in zoom-in duration-200">
        <h2 className="text-xl font-bold text-gray-800 mb-1">アイコンを設定</h2>
        <p className="text-sm text-gray-600 mb-5 truncate">「{presetName}」</p>

        <div className="mb-6">
          <CsvIconPicker value={value} onChange={onChange} />
        </div>

        <div className="flex justify-end gap-3 mt-4">
          <Button variant="secondary" onClick={onClose}>
            キャンセル
          </Button>
          <Button variant="primary" onClick={onSave}>
            保存する
          </Button>
        </div>
      </div>
    </div>
  )
}
