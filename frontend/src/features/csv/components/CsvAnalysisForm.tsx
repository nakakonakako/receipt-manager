import React from 'react'
import { Button } from '@/components/ui/Button'
import { type CsvAnalysisFormProps } from '../types'

export const CsvAnalysisForm: React.FC<CsvAnalysisFormProps> = ({
  csvText,
  presets,
  selectedPreset,
  onSelectPreset,
  isAnalyzing,
  onAnalyze,
}) => {
  return (
    <div className="bg-gray-50 p-4 rounded border">
      <h3 className="font-bold mb-4 text-gray-700">📄 抽出方法の選択</h3>

      <div className="mb-4 flex items-center gap-3 bg-white p-3 rounded shadow-sm border">
        <label className="text-sm font-bold text-gray-600">
          プリセット設定:
        </label>
        <select
          value={selectedPreset}
          onChange={(e) => onSelectPreset(e.target.value)}
          className="p-2 border rounded flex-1 outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">✨ AIに自動解析させる（新規フォーマット用）</option>
          {presets.map((p, i) => (
            <option key={p.id || i} value={p.name}>
              ☁️ {p.name} (クラウド保存)
            </option>
          ))}
        </select>
      </div>

      <pre className="bg-gray-800 text-white p-3 text-xs overflow-x-auto rounded max-h-40 overflow-y-auto mb-4">
        {csvText}
      </pre>

      <Button onClick={onAnalyze} disabled={isAnalyzing} variant="primary">
        {isAnalyzing
          ? 'パース処理を実行中...'
          : selectedPreset
            ? `「${selectedPreset}」の設定でパースする (高速)`
            : 'AIで自動解析してパースする'}
      </Button>
    </div>
  )
}
