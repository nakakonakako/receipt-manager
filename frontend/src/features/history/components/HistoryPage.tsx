import React, { useState, useEffect } from 'react'
import { useApiConfig } from '@/hooks/useApiConfig'
import { fetchTransactions } from '../api/historyApi'
import type { HistoryReceipt, HistoryCsvTransaction } from '../types'

export const HistoryPage: React.FC = () => {
  const { getHeaders } = useApiConfig()
  const [activeTab, setActiveTab] = useState<'receipts' | 'csv'>('receipts')

  const [receipts, setReceipts] = useState<HistoryReceipt[]>([])
  const [csvData, setCsvData] = useState<HistoryCsvTransaction[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const [expandedReceiptId, setExpandedReceiptId] = useState<string | null>(
    null
  )

  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true)
      const headers = await getHeaders()
      if (headers) {
        try {
          const data = await fetchTransactions(headers)
          setReceipts(data.receipts || [])
          setCsvData(data.csv_transactions || [])
        } catch (error) {
          console.error('データの取得に失敗しました:', error)
        }
      }
      setIsLoading(false)
    }
    loadData()
  }, [])

  const groupByMonth = <T,>(data: T[], dateKey: keyof T) => {
    return data.reduce(
      (acc, item) => {
        const dateStr = String(item[dateKey])
        const month = dateStr.substring(0, 7)
        if (!acc[month]) acc[month] = []
        acc[month].push(item)
        return acc
      },
      {} as Record<string, T[]>
    )
  }

  const formatMonth = (monthStr: string) => {
    const [year, month] = monthStr.split('-')
    return `${year}年 ${parseInt(month)}月`
  }

  const toggleAccordion = (id: string) => {
    setExpandedReceiptId((prev) => (prev === id ? null : id))
  }

  if (isLoading) {
    return (
      <div className="text-center py-10 text-gray-500 font-bold animate-pulse">
        データを読み込み中...
      </div>
    )
  }

  const groupedReceipts = groupByMonth(receipts, 'date')
  const groupedCsv = groupByMonth(csvData, 'date')

  return (
    <div className="bg-white rounded-lg shadow p-4 min-h-[500px]">
      <div className="flex border-b border-gray-200 mb-6">
        <button
          onClick={() => setActiveTab('receipts')}
          className={`pb-2 px-4 font-bold text-sm transition-colors ${
            activeTab === 'receipts'
              ? 'border-b-2 border-blue-600 text-blue-700'
              : 'text-gray-400 hover:text-gray-600'
          }`}
        >
          🧾 レシート ({receipts.length}件)
        </button>
        <button
          onClick={() => setActiveTab('csv')}
          className={`pb-2 px-4 font-bold text-sm transition-colors ${
            activeTab === 'csv'
              ? 'border-b-2 border-green-600 text-green-700'
              : 'text-gray-400 hover:text-gray-600'
          }`}
        >
          💳 キャッシュレス ({csvData.length}件)
        </button>
      </div>

      {activeTab === 'receipts' && (
        <div className="space-y-8">
          {Object.keys(groupedReceipts).length === 0 ? (
            <p className="text-center text-gray-500">
              レシートの履歴がありません。
            </p>
          ) : (
            Object.keys(groupedReceipts)
              .sort((a, b) => b.localeCompare(a))
              .map((month) => (
                <div key={month} className="space-y-3">
                  <h3 className="text-lg font-bold text-gray-800 border-b pb-1">
                    {formatMonth(month)}
                  </h3>
                  {groupedReceipts[month].map((receipt) => (
                    <div
                      key={receipt.id}
                      className="border rounded-md overflow-hidden bg-gray-50"
                    >
                      <div
                        onClick={() => toggleAccordion(receipt.id)}
                        className="flex justify-between items-center p-3 bg-white hover:bg-gray-50 cursor-pointer transition-colors"
                      >
                        <div>
                          <span className="text-xs text-gray-500 mr-2">
                            {receipt.date}
                          </span>
                          <span className="font-bold text-gray-800">
                            {receipt.store_name}
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="font-bold text-blue-700">
                            ¥{receipt.total_amount.toLocaleString()}
                          </span>
                          <span className="text-gray-400 text-xs">
                            {expandedReceiptId === receipt.id ? '▲' : '▼'}
                          </span>
                        </div>
                      </div>

                      {expandedReceiptId === receipt.id &&
                        receipt.receipt_items.length > 0 && (
                          <div className="p-3 bg-gray-100 border-t border-gray-200 text-sm">
                            <ul className="space-y-1">
                              {receipt.receipt_items.map((item) => (
                                <li
                                  key={item.id}
                                  className="flex justify-between text-gray-700"
                                >
                                  <span>・{item.item_name}</span>
                                  <span>¥{item.price.toLocaleString()}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                    </div>
                  ))}
                </div>
              ))
          )}
        </div>
      )}

      {activeTab === 'csv' && (
        <div className="space-y-8">
          {Object.keys(groupedCsv).length === 0 ? (
            <p className="text-center text-gray-500">
              キャッシュレスの履歴がありません。
            </p>
          ) : (
            Object.keys(groupedCsv)
              .sort((a, b) => b.localeCompare(a))
              .map((month) => (
                <div key={month} className="space-y-3">
                  <h3 className="text-lg font-bold text-gray-800 border-b pb-1">
                    {formatMonth(month)}
                  </h3>
                  {groupedCsv[month].map((csv) => (
                    <div
                      key={csv.id}
                      className="flex justify-between items-center p-3 border rounded-md bg-white"
                    >
                      <div>
                        <span className="text-xs text-gray-500 mr-2">
                          {csv.date}
                        </span>
                        <span className="font-bold text-gray-800">
                          {csv.store}
                        </span>
                      </div>
                      <span className="font-bold text-green-700">
                        ¥{csv.price.toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              ))
          )}
        </div>
      )}
    </div>
  )
}
