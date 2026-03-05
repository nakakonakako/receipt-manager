import React, { useState, useEffect, useMemo } from 'react'
import { useApiConfig } from '@/hooks/useApiConfig'
import {
  fetchTransactions,
  deleteCsvTransaction,
  deleteReceipt,
} from '../api/historyApi'
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
  const [currentMonth, setCurrentMonth] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
  const [searchQuery, setSearchQuery] = useState('')
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc')
  const [deleteTarget, setDeleteTarget] = useState<{
    type: 'receipt' | 'csv'
    id: string
  } | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

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

  const handlePrevMonth = () => {
    const [year, month] = currentMonth.split('-').map(Number)
    const d = new Date(year, month - 2)
    setCurrentMonth(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    )
  }

  const handleNextMonth = () => {
    const [year, month] = currentMonth.split('-').map(Number)
    const d = new Date(year, month)
    setCurrentMonth(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    )
  }

  const requestDeleteReceipt = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setDeleteTarget({ type: 'receipt', id })
  }

  const requestDeleteCsv = (id: string) => {
    setDeleteTarget({ type: 'csv', id })
  }

  const executeDelete = async () => {
    if (!deleteTarget) return
    setIsDeleting(true)

    const headers = await getHeaders()
    if (!headers) {
      setIsDeleting(false)
      return
    }

    try {
      if (deleteTarget.type === 'receipt') {
        await deleteReceipt(deleteTarget.id, headers)
        setReceipts((prev) => prev.filter((r) => r.id !== deleteTarget.id))
      } else {
        await deleteCsvTransaction(deleteTarget.id, headers)
        setCsvData((prev) => prev.filter((c) => c.id !== deleteTarget.id))
      }
      setDeleteTarget(null)
    } catch (error) {
      console.error('削除に失敗しました:', error)
      alert('削除に失敗しました。もう一度お試しください。')
    } finally {
      setIsDeleting(false)
    }
  }

  const formattedCurrentMonth = `${currentMonth.split('-')[0]}年 ${parseInt(currentMonth.split('-')[1])}月`

  const { filteredReceipts, receiptTotal } = useMemo(() => {
    let filtered = receipts.filter((r) => r.date.startsWith(currentMonth))

    if (searchQuery) {
      filtered = filtered.filter(
        (r) =>
          r.store_name.includes(searchQuery) ||
          r.receipt_items.some((item) => item.item_name.includes(searchQuery))
      )
    }

    filtered.sort((a, b) =>
      sortOrder === 'desc'
        ? b.date.localeCompare(a.date)
        : a.date.localeCompare(b.date)
    )
    const total = filtered.reduce((sum, r) => sum + r.total_amount, 0)

    return { filteredReceipts: filtered, receiptTotal: total }
  }, [receipts, currentMonth, searchQuery, sortOrder])

  const { filteredCsv, csvTotal } = useMemo(() => {
    let filtered = csvData.filter((c) => c.date.startsWith(currentMonth))

    if (searchQuery) {
      filtered = filtered.filter((c) => c.store.includes(searchQuery))
    }

    filtered.sort((a, b) =>
      sortOrder === 'desc'
        ? b.date.localeCompare(a.date)
        : a.date.localeCompare(b.date)
    )
    const total = filtered.reduce((sum, c) => sum + c.price, 0)

    return { filteredCsv: filtered, csvTotal: total }
  }, [csvData, currentMonth, searchQuery, sortOrder])

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

  return (
    <div className="bg-white rounded-lg shadow p-4 min-h-[600px] flex flex-col">
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <span className="absolute left-3 top-2 text-gray-400">🔍</span>
          <input
            type="text"
            placeholder="店名や商品名で検索..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <button
          onClick={() =>
            setSortOrder((prev) => (prev === 'desc' ? 'asc' : 'desc'))
          }
          className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-lg transition-colors whitespace-nowrap"
        >
          {sortOrder === 'desc' ? '🔽 新しい順' : '🔼 古い順'}
        </button>
      </div>

      <div className="flex border-b border-gray-200 mb-6">
        <button
          onClick={() => setActiveTab('receipts')}
          className={`pb-2 px-4 font-bold text-sm transition-colors ${
            activeTab === 'receipts'
              ? 'border-b-2 border-blue-600 text-blue-700'
              : 'text-gray-400 hover:text-gray-600'
          }`}
        >
          🧾 レシート
        </button>
        <button
          onClick={() => setActiveTab('csv')}
          className={`pb-2 px-4 font-bold text-sm transition-colors ${
            activeTab === 'csv'
              ? 'border-b-2 border-green-600 text-green-700'
              : 'text-gray-400 hover:text-gray-600'
          }`}
        >
          💳 キャッシュレス
        </button>
      </div>

      <div className="flex items-center justify-between bg-blue-50 p-4 rounded-lg mb-6">
        <button
          onClick={handlePrevMonth}
          className="px-3 py-1 bg-white border border-gray-300 rounded hover:bg-gray-100 font-bold"
        >
          ◀️
        </button>
        <div className="text-center">
          <h2 className="text-xl font-extrabold text-gray-800">
            {formattedCurrentMonth}
          </h2>
          <p className="text-sm font-bold text-gray-600 mt-1">
            合計:{' '}
            <span
              className={`text-lg ${activeTab === 'receipts' ? 'text-blue-700' : 'text-green-700'}`}
            >
              ¥
              {(activeTab === 'receipts'
                ? receiptTotal
                : csvTotal
              ).toLocaleString()}
            </span>
          </p>
        </div>
        <button
          onClick={handleNextMonth}
          className="px-3 py-1 bg-white border border-gray-300 rounded hover:bg-gray-100 font-bold"
        >
          ▶️
        </button>
      </div>

      {activeTab === 'receipts' && (
        <div className="space-y-3 flex-1 overflow-y-auto">
          {filteredReceipts.length === 0 ? (
            <p className="text-center text-gray-500 py-10">
              該当するレシートがありません。
            </p>
          ) : (
            filteredReceipts.map((receipt) => (
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

                    <button
                      onClick={(e) => requestDeleteReceipt(receipt.id, e)}
                      className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                      title="削除"
                    >
                      🗑️
                    </button>

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
            ))
          )}
        </div>
      )}

      {activeTab === 'csv' && (
        <div className="space-y-3 flex-1 overflow-y-auto">
          {filteredCsv.length === 0 ? (
            <p className="text-center text-gray-500 py-10">
              該当する履歴がありません。
            </p>
          ) : (
            filteredCsv.map((csv) => (
              <div
                key={csv.id}
                className="flex items-center p-3 border rounded-md bg-white hover:bg-gray-50 transition-colors"
              >
                <div className="text-xs text-gray-400 w-24 shrink-0">
                  {csv.date}
                </div>

                <div className="font-bold text-gray-800 flex-1 truncate pr-4">
                  {csv.store}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-bold text-green-700 w-20 text-right pr-2">
                    ¥{csv.price.toLocaleString()}
                  </span>

                  <button
                    onClick={() => requestDeleteCsv(csv.id)}
                    className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                    title="削除"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 backdrop-blur-sm px-4 transition-opacity">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden transform transition-all">
            <div className="p-6 text-center">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-3xl">🗑️</span>
              </div>
              <h3 className="text-xl font-bold text-gray-800 mb-2">
                本当に削除しますか？
              </h3>
              <p className="text-sm text-gray-500 mb-6">
                {deleteTarget.type === 'receipt'
                  ? 'このレシートと、関連する商品の明細がすべて削除されます。この操作は取り消せません。'
                  : 'このキャッシュレス履歴が削除されます。この操作は取り消せません。'}
              </p>

              <div className="flex gap-3">
                <button
                  onClick={() => setDeleteTarget(null)}
                  disabled={isDeleting}
                  className="flex-1 py-2.5 px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-lg transition-colors disabled:opacity-50"
                >
                  キャンセル
                </button>
                <button
                  onClick={executeDelete}
                  disabled={isDeleting}
                  className="flex-1 py-2.5 px-4 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg shadow-sm transition-colors flex items-center justify-center disabled:opacity-50"
                >
                  {isDeleting ? (
                    <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                  ) : (
                    '削除する'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
