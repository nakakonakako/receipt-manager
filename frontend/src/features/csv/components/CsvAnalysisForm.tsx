import React from 'react'
import { Button } from '@/components/ui/Button'
import { type CsvAnalysisFormProps } from '../types'

export const CsvAnalysisForm: React.FC<CsvAnalysisFormProps> = ({
  csvText,
  presets,
  selectedPresetId,
  onSelectPreset,
  isAnalyzing,
  onAnalyze,
}) => {
  const selectedName = presets.find((p) => p.id === selectedPresetId)?.name

  return (
    <div className="bg-gray-50 p-4 rounded border">
      <h3 className="font-bold mb-4 text-gray-700">📄 抽出方法の選択</h3>

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
            <option value="">
              ✨ AIに自動解析させる（新規フォーマット用）
            </option>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                ☁️ {p.name} (クラウド保存)
              </option>
            ))}
          </select>
        </div>
      </div>

      <pre className="bg-gray-800 text-white p-3 text-xs overflow-x-auto rounded max-h-40 overflow-y-auto mb-4">
        {csvText}
      </pre>

      <div className="flex justify-end">
        <Button onClick={onAnalyze} disabled={isAnalyzing} variant="primary">
          {isAnalyzing
            ? 'パース処理を実行中...'
            : selectedPresetId
              ? `「${selectedName}」の設定を使ってパースする`
              : 'AIで自動解析してパースする'}
        </Button>
      </div>
    </div>
  )
}
