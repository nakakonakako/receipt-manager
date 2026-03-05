import React from 'react'
import { Button } from '@/components/ui/Button'
import { useHistory } from '../hooks/useHistory'
import { HistoryEditModal } from './HistoryEditModal'

export const HistoryPage: React.FC = () => {
  const {
    activeTab,
    setActiveTab,
    isLoading,
    expandedReceiptId,
    toggleAccordion,
    currentMonth,
    setCurrentMonth,
    allMonths,
    currentIndex,
    formattedCurrentMonth,
    handlePrevMonth,
    handleNextMonth,
    searchQuery,
    setSearchQuery,
    sortOrder,
    setSortOrder,
    filteredReceipts,
    receiptTotal,
    filteredCsv,
    csvTotal,
    deleteTarget,
    setDeleteTarget,
    requestDeleteReceipt,
    requestDeleteCsv,
    executeDelete,
    isDeleting,
    editTarget,
    setEditTarget,
    editType,
    openEditReceipt,
    openEditCsv,
    executeEdit,
    isSaving,
    isMonthDropdownOpen,
    setIsMonthDropdownOpen,
  } = useHistory()

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
          className={`pb-2 px-4 font-bold text-sm transition-colors ${activeTab === 'receipts' ? 'border-b-2 border-blue-600 text-blue-700' : 'text-gray-400 hover:text-gray-600'}`}
        >
          🧾 レシート
        </button>
        <button
          onClick={() => setActiveTab('csv')}
          className={`pb-2 px-4 font-bold text-sm transition-colors ${activeTab === 'csv' ? 'border-b-2 border-green-600 text-green-700' : 'text-gray-400 hover:text-gray-600'}`}
        >
          💳 キャッシュレス
        </button>
      </div>

      <div className="flex items-center justify-between bg-blue-50 p-4 rounded-xl mb-6 shadow-inner relative z-20">
        <button
          onClick={handlePrevMonth}
          disabled={currentIndex >= allMonths.length - 1}
          className="px-4 py-2 bg-white border border-gray-200 rounded-lg shadow-sm hover:bg-gray-50 hover:shadow-md font-bold disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          ◀️
        </button>

        <div className="text-center relative">
          <div className="relative inline-block">
            <button
              onClick={() => setIsMonthDropdownOpen(!isMonthDropdownOpen)}
              className={`text-xl font-extrabold text-gray-800 bg-white border border-gray-200 px-4 py-2 transition-all flex items-center justify-between w-[220px] relative z-50 ${
                isMonthDropdownOpen
                  ? 'rounded-t-2xl border-b-transparent shadow-none'
                  : 'rounded-full shadow-sm hover:border-blue-300'
              }`}
            >
              <span className="w-5"></span>
              <span className="flex-1 text-center">
                {formattedCurrentMonth}
              </span>
              <span
                className={`text-gray-400 text-sm w-5 text-right transition-transform duration-200 ${isMonthDropdownOpen ? 'rotate-180' : ''}`}
              >
                ▼
              </span>
            </button>

            {isMonthDropdownOpen && (
              <>
                <div
                  className="fixed inset-0 z-30"
                  onClick={() => setIsMonthDropdownOpen(false)}
                ></div>

                <div className="absolute top-full left-0 w-full bg-white border border-gray-200 border-t-0 rounded-b-2xl shadow-xl z-40 overflow-hidden -mt-[1px]">
                  <ul className="max-h-60 overflow-y-auto pb-2 pt-1">
                    {allMonths.map((m) => {
                      const [y, mo] = m.split('-')
                      const isSelected = m === currentMonth
                      return (
                        <li key={m} className="px-2 py-0.5">
                          <button
                            onClick={() => {
                              setCurrentMonth(m)
                              setIsMonthDropdownOpen(false)
                            }}
                            className={`w-full text-center px-4 py-2 rounded-lg text-lg transition-colors ${
                              isSelected
                                ? 'bg-blue-100 text-blue-700 font-extrabold'
                                : 'text-gray-700 hover:bg-gray-100 font-bold'
                            }`}
                          >
                            {`${y}年 ${parseInt(mo)}月`}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              </>
            )}
          </div>

          <p className="text-sm font-bold text-gray-600 mt-2">
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
          disabled={currentIndex <= 0}
          className="px-4 py-2 bg-white border border-gray-200 rounded-lg shadow-sm hover:bg-gray-50 hover:shadow-md font-bold disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          ▶️
        </button>
      </div>

      {activeTab === 'receipts' && (
        <div className="space-y-3 flex-1 overflow-y-auto pr-2">
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
                  className="flex items-center p-3 bg-white hover:bg-gray-50 cursor-pointer transition-colors"
                >
                  <div className="text-xs text-gray-400 w-24 shrink-0">
                    {receipt.date}
                  </div>
                  <div className="font-bold text-gray-800 flex-1 truncate pr-4">
                    {receipt.store_name}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-bold text-blue-700 w-20 text-right pr-2">
                      ¥{receipt.total_amount.toLocaleString()}
                    </span>
                    <button
                      onClick={(e) => openEditReceipt(receipt, e)}
                      className="p-1.5 text-blue-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                      title="編集"
                    >
                      ✏️
                    </button>
                    <button
                      onClick={(e) => requestDeleteReceipt(receipt.id, e)}
                      className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                      title="削除"
                    >
                      🗑️
                    </button>
                    <span className="text-gray-400 text-xs w-3 text-center ml-1">
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
                            key={item.id || item.item_name}
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
        <div className="space-y-3 flex-1 overflow-y-auto pr-2">
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
                    onClick={() => openEditCsv(csv)}
                    className="p-1.5 text-blue-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                    title="編集"
                  >
                    ✏️
                  </button>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 backdrop-blur-sm px-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6 text-center">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-3xl">🗑️</span>
            </div>
            <h3 className="text-xl font-bold text-gray-800 mb-2">
              本当に削除しますか？
            </h3>
            <p className="text-sm text-gray-500 mb-6">
              この操作は取り消せません。
            </p>
            <div className="flex gap-3">
              <Button
                variant="secondary"
                onClick={() => setDeleteTarget(null)}
                disabled={isDeleting}
                className="flex-1 py-2.5"
              >
                キャンセル
              </Button>
              <Button
                variant="primary"
                onClick={executeDelete}
                disabled={isDeleting}
                className="flex-1 py-2.5 !bg-red-600 hover:!bg-red-700 shadow-sm border-none"
              >
                {isDeleting ? '削除中...' : '削除する'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {editTarget && editType && (
        <HistoryEditModal
          editTarget={editTarget}
          editType={editType}
          isSaving={isSaving}
          setEditTarget={setEditTarget}
          onClose={() => setEditTarget(null)}
          onSave={executeEdit}
        />
      )}
    </div>
  )
}
