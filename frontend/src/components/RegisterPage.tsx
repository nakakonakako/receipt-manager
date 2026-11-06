import { useState } from 'react'
import { ReceiptUploader } from '@/features/receipt/components/ReceiptUploader'
import { CsvUploader } from '@/features/csv/components/CsvUploader'
import { ManualRegister } from '@/features/receipt/components/ManualRegister'

export const RegisterPage = () => {
  const [inputType, setInputType] = useState<'camera' | 'csv' | 'manual'>(
    'camera'
  )

  return (
    <div className="space-y-6">
      <div className="flex rounded-xl border border-[var(--rm-border)] bg-[var(--rm-surface-muted)] p-1 shadow-sm">
        <button
          onClick={() => setInputType('camera')}
          aria-pressed={inputType === 'camera'}
          className={`min-h-11 flex-1 rounded-lg px-2 py-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rm-focus)] ${
            inputType === 'camera'
              ? 'bg-[var(--rm-surface)] text-[var(--rm-receipt)] shadow-sm'
              : 'text-[var(--rm-text-secondary)] hover:bg-white/70 hover:text-[var(--rm-text-primary)]'
          }`}
        >
          レシート撮影
        </button>
        <button
          onClick={() => setInputType('manual')}
          aria-pressed={inputType === 'manual'}
          className={`min-h-11 flex-1 rounded-lg px-2 py-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rm-focus)] ${
            inputType === 'manual'
              ? 'bg-[var(--rm-surface)] text-[var(--rm-receipt)] shadow-sm'
              : 'text-[var(--rm-text-secondary)] hover:bg-white/70 hover:text-[var(--rm-text-primary)]'
          }`}
        >
          手動入力
        </button>

        <button
          onClick={() => setInputType('csv')}
          aria-pressed={inputType === 'csv'}
          className={`min-h-11 flex-1 rounded-lg px-2 py-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rm-focus)] ${
            inputType === 'csv'
              ? 'bg-[var(--rm-surface)] text-[var(--rm-csv)] shadow-sm'
              : 'text-[var(--rm-text-secondary)] hover:bg-white/70 hover:text-[var(--rm-text-primary)]'
          }`}
        >
          CSV読込
        </button>
      </div>

      <div className="rm-card min-w-0 p-3 sm:p-5">
        {inputType === 'camera' ? (
          <ReceiptUploader />
        ) : inputType === 'csv' ? (
          <CsvUploader />
        ) : (
          <ManualRegister />
        )}
      </div>

      <p className="text-center text-sm text-[var(--rm-text-muted)]">
        {inputType === 'camera' && (
          <>
            カメラで撮影したレシート画像から
            <br />
            自動でデータを抽出して登録できます。
          </>
        )}
        {inputType === 'manual' && 'レシートの内容を直接入力して登録できます。'}
        {inputType === 'csv' &&
          'CSVファイルから取引データを一括で登録できます。'}
      </p>
    </div>
  )
}
