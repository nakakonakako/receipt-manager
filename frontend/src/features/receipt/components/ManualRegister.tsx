import React, { useState } from 'react'
import { ReceiptEditor } from './ReceiptEditor'
import { saveTransaction } from '../api/receiptApi'
import { useApiConfig } from '@/hooks/useApiConfig'
import { type Receipt } from '../types'

export const ManualRegister: React.FC = () => {
  const { getHeaders } = useApiConfig()

  const [resetKey, setResetKey] = useState(0)

  const getTodayString = () => {
    const d = new Date()
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  const emptyReceipt: Receipt = {
    purchase_date: getTodayString(),
    store_name: '',
    items: [],
    total_amount: 0,
    payment_method: 'unknown',
  }

  const handleSave = async (data: Receipt) => {
    const headers = getHeaders()
    if (!headers) return

    try {
      await saveTransaction(data, headers)
      alert(`${data.store_name}のレシートを保存しました！`)
      setResetKey((prev) => prev + 1)
    } catch (error) {
      console.error('レシートの保存に失敗しました:', error)
      alert('レシートの保存に失敗しました。再度お試しください。')
    }
  }

  const handleCancel = () => {
    if (confirm('入力中の内容を全てクリアしますか？')) {
      setResetKey((prev) => prev + 1)
    }
  }

  return (
    <div className="max-w-2xl mx-auto py-2">
      <div className="mb-4 text-center">
        <p className="text-sm font-bold text-gray-500">
          📝 レシート情報を手動で入力して登録します
        </p>
      </div>

      <ReceiptEditor
        key={resetKey}
        initialData={emptyReceipt}
        onSave={handleSave}
        onCancel={handleCancel}
      />
    </div>
  )
}
