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
      <div className="bg-stone-100 border border-stone-200 p-1 rounded-xl flex">
        <button
          onClick={() => setInputType('camera')}
          className={`min-h-11 sm:min-h-10 flex-1 py-2 text-sm font-semibold rounded-lg transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
            inputType === 'camera'
              ? 'bg-white text-blue-700 shadow-sm'
              : 'text-stone-600 hover:text-stone-900 hover:bg-stone-200/70'
          }`}
        >
          レシート撮影
        </button>
        <button
          onClick={() => setInputType('manual')}
          className={`min-h-11 sm:min-h-10 flex-1 py-2 text-sm font-semibold rounded-lg transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
            inputType === 'manual'
              ? 'bg-white text-blue-700 shadow-sm'
              : 'text-stone-600 hover:text-stone-900 hover:bg-stone-200/70'
          }`}
        >
          手動入力
        </button>

        <button
          onClick={() => setInputType('csv')}
          className={`min-h-11 sm:min-h-10 flex-1 py-2 text-sm font-semibold rounded-lg transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
            inputType === 'csv'
              ? 'bg-white text-green-700 shadow-sm'
              : 'text-stone-600 hover:text-stone-900 hover:bg-stone-200/70'
          }`}
        >
          CSV読込
        </button>
      </div>

      <div className="rm-card p-4">
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
