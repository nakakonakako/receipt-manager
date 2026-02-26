import React from 'react'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'

interface CsvPresetSaveModalProps {
  isOpen: boolean
  presetName: string
  onNameChange: (val: string) => void
  onSkip: () => void
  onSave: () => void
}

export const CsvPresetSaveModal: React.FC<CsvPresetSaveModalProps> = ({
  isOpen,
  presetName,
  onNameChange,
  onSkip,
  onSave,
}) => {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex justify-center items-center p-4">
      <div className="bg-white rounded-xl shadow-2xl p-6 max-w-md w-full animate-in fade-in zoom-in duration-200">
        <h2 className="text-xl font-bold text-gray-800 mb-2">
          ✨ 抽出ルールの保存
        </h2>
        <p className="text-sm text-gray-600 mb-6">
          このCSVのフォーマットを「プリセット」として保存しておくと、次回からAI解析をスキップして一瞬で読み込めるようになります！
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

        <div className="flex justify-end gap-3 mt-4">
          <Button variant="secondary" onClick={onSkip}>
            今回は保存しない
          </Button>
          <Button
            variant="primary"
            onClick={onSave}
            disabled={!presetName.trim()}
          >
            ルールを保存して完了
          </Button>
        </div>
      </div>
    </div>
  )
}
