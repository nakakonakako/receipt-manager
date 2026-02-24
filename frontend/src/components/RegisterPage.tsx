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
      <div className="bg-gray-200 p-1 rounded-lg flex">
        <button
          onClick={() => setInputType('camera')}
          className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${
            inputType === 'camera'
              ? 'bg-white text-blue-600 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          レシート撮影
        </button>
        <button
          onClick={() => setInputType('manual')}
          className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${
            inputType === 'manual'
              ? 'bg-white text-blue-600 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          手動入力
        </button>

        <button
          onClick={() => setInputType('csv')}
          className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${
            inputType === 'csv'
              ? 'bg-white text-blue-600 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          CSV読込
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
        {inputType === 'camera' ? (
          <ReceiptUploader />
        ) : inputType === 'csv' ? (
          <CsvUploader />
        ) : (
          <ManualRegister />
        )}
      </div>

      <p className="text-center text-xs text-gray-400">
        {inputType === 'camera' &&
          'カメラで撮影したレシート画像から自動でデータを抽出して登録できます。'}
        {inputType === 'manual' && 'レシートの内容を直接入力して登録できます。'}
        {inputType === 'csv' &&
          'CSVファイルから取引データを一括で登録できます。'}
      </p>
    </div>
  )
}
