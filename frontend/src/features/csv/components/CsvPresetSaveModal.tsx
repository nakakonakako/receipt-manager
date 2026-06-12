import React from 'react'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { CsvIconPicker } from './CsvIconPicker'

interface CsvPresetSaveModalProps {
  isOpen: boolean
  presetName: string
  presetIcon: string
  onNameChange: (val: string) => void
  onIconChange: (val: string) => void
  onSkip: () => void
  onSave: () => void
}

export const CsvPresetSaveModal: React.FC<CsvPresetSaveModalProps> = ({
  isOpen,
  presetName,
  presetIcon,
  onNameChange,
  onIconChange,
  onSkip,
  onSave,
}) => {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex justify-center items-center p-4">
      <div className="bg-white rounded-xl shadow-2xl p-6 max-w-md w-full animate-in fade-in zoom-in duration-200">
        <h2 className="text-xl font-bold text-gray-800 mb-2">
          ✨ 解析ルールの保存
        </h2>
        <p className="text-sm text-gray-600 mb-6">
          保存することで同じフォーマットのCSVを次回から瞬時に読み込めるようになります！
        </p>

        <div className="mb-6">
          <label className="block text-sm font-bold text-gray-700 mb-2">
            プリセットの名前{' '}
            <span className="text-red-500 text-xs ml-1">必須</span>
          </label>
          <Input
            value={presetName}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="例: PayPay明細"
            className="w-full text-lg p-3"
            autoFocus
          />
        </div>

        <div className="mb-6">
          <label className="block text-sm font-bold text-gray-700 mb-2">
            アイコン
          </label>
          <CsvIconPicker value={presetIcon} onChange={onIconChange} />
        </div>

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 mt-4">
          <Button
            variant="secondary"
            onClick={onSkip}
            className="w-full sm:w-auto"
          >
            今回は保存しない
          </Button>
          <Button
            variant="primary"
            onClick={onSave}
            disabled={!presetName.trim()}
            className="w-full sm:w-auto"
          >
            ルールを保存して完了
          </Button>
        </div>
      </div>
    </div>
  )
}
