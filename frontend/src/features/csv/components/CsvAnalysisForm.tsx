import React from 'react'
import { Button } from '@/components/ui/Button'
import { type CsvAnalysisFormProps } from '../types'
import { resolvePresetIcon } from '../utils/emoji'

export const CsvAnalysisForm: React.FC<CsvAnalysisFormProps> = ({
  csvText,
  presets,
  selectedPresetId,
  onSelectPreset,
  isAnalyzing,
  onAnalyze,
  onReset,
}) => {
  return (
    <div className="bg-gray-50 p-4 rounded border">
      <h3 className="font-bold mb-4 text-gray-700">📄 解析方法の選択</h3>

      <div className="mb-4 flex flex-col sm:flex-row sm:items-center gap-3 bg-white p-3 rounded shadow-sm border border-gray-200">
        <label className="text-sm font-bold text-gray-600 shrink-0">
          プリセット設定:
        </label>

        <div className="flex-1 flex items-center gap-2">
          <select
            value={selectedPresetId}
            onChange={(e) => onSelectPreset(e.target.value)}
            className="p-2 border border-gray-300 rounded flex-1 outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="">新規フォーマットのCSVを解析</option>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {resolvePresetIcon(p.icon)} {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <pre className="bg-gray-800 text-white p-3 text-xs overflow-x-auto rounded max-h-40 overflow-y-auto mb-4">
        {csvText}
      </pre>

      <div className="flex flex-col sm:flex-row sm:justify-end gap-3">
        <Button
          variant="secondary"
          onClick={onReset}
          disabled={isAnalyzing}
          className="w-full sm:w-auto"
        >
          ファイルを選び直す
        </Button>
        <Button
          onClick={onAnalyze}
          disabled={isAnalyzing}
          variant="primary"
          className="w-full sm:w-auto"
        >
          {isAnalyzing
            ? '解析処理を実行中...'
            : selectedPresetId
              ? 'プリセットを使って解析する'
              : '解析を開始する'}
        </Button>
      </div>
    </div>
  )
}
