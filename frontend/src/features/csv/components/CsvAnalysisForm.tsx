import React from 'react'
import { Button } from '@/components/ui/Button'
import { type CsvAnalysisFormProps } from '../types'
import { resolvePresetIcon } from '../utils/emoji'
import {
  formatPresetLastUsedLabel,
  formatPresetLastUsedShort,
} from '../utils/date'

export const CsvAnalysisForm: React.FC<CsvAnalysisFormProps> = ({
  csvText,
  presets,
  selectedPresetId,
  onSelectPreset,
  isAnalyzing,
  onAnalyze,
  onReset,
}) => {
  const selectedPreset = presets.find((p) => p.id === selectedPresetId)

  const selectedDisplayText = selectedPreset
    ? `${resolvePresetIcon(selectedPreset.icon)} ${selectedPreset.name}`
    : '新規フォーマットのCSVを解析'

  return (
    <div className="rounded-lg border border-[var(--rm-border-subtle)] bg-[var(--rm-surface-subtle)] p-4">
      <h3 className="mb-4 font-bold text-[var(--rm-text-primary)]">解析方法の選択</h3>

      <div className="mb-4 flex flex-col sm:flex-row sm:items-center gap-3 bg-white p-3 rounded shadow-sm border border-gray-200 overflow-hidden">
        <label className="shrink-0 text-sm font-semibold text-[var(--rm-text-secondary)]">
          プリセット設定:
        </label>

        <div className="relative flex-1 min-w-0 w-full">
          <select
            value={selectedPresetId}
            onChange={(e) => onSelectPreset(e.target.value)}
            aria-label="プリセット設定"
            className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rm-focus)]"
          >
            <option value="">新規フォーマットのCSVを解析</option>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {resolvePresetIcon(p.icon)} {p.name}（最終使用:{' '}
                {formatPresetLastUsedShort(p.last_used_at)}）
              </option>
            ))}
          </select>
          <div
            className="pointer-events-none flex min-h-[42px] items-center rounded-md border border-[var(--rm-border)] bg-[var(--rm-surface)] px-3 py-2 pr-8 text-sm text-[var(--rm-text-primary)]"
            aria-hidden="true"
          >
            <span className="truncate">{selectedDisplayText}</span>
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--rm-text-muted)] text-xs">
              ▼
            </span>
          </div>
        </div>
      </div>

      {selectedPreset && (
        <p className="text-xs text-[var(--rm-text-muted)] mb-4 -mt-2 px-1">
          {formatPresetLastUsedLabel(selectedPreset.last_used_at)}
        </p>
      )}

      <pre className="mb-4 max-h-40 overflow-auto rounded-md bg-stone-800 p-3 text-xs text-stone-50">
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
