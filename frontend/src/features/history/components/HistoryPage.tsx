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
    isFetchingMonth,
  } = useHistory()

  if (isLoading) {
    return (
      <div className="text-center py-20 text-gray-500 font-bold animate-pulse flex flex-col items-center gap-3">
        <span className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></span>
        データを読み込み中...
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 min-h-[600px] flex flex-col max-w-4xl mx-auto">
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <span className="absolute left-3 top-2.5 text-gray-400">🔍</span>
          <input
            type="text"
            placeholder="店名や商品名で検索..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <button
          onClick={() =>
            setSortOrder((prev) => (prev === 'desc' ? 'asc' : 'desc'))
          }
          className="flex justify-center items-center gap-2 px-5 py-2.5 bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-700 font-bold rounded-xl transition-all w-full sm:w-auto shadow-sm"
        >
          <span
            className={`transition-transform duration-300 ${sortOrder === 'asc' ? 'rotate-180' : ''}`}
          >
            ⬇️
          </span>
          {sortOrder === 'desc' ? '新しい順' : '古い順'}
        </button>
      </div>

      <div className="flex bg-gray-100 p-1.5 rounded-xl mb-6 shadow-inner">
        <button
          onClick={() => setActiveTab('receipts')}
          className={`flex-1 py-2.5 text-sm font-extrabold rounded-lg transition-all duration-300 flex justify-center items-center gap-2 ${
            activeTab === 'receipts'
              ? 'bg-white text-blue-700 shadow-sm scale-100'
              : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200/50 scale-95'
          }`}
        >
          <span>🧾</span> レシート
        </button>
        <button
          onClick={() => setActiveTab('csv')}
          className={`flex-1 py-2.5 text-sm font-extrabold rounded-lg transition-all duration-300 flex justify-center items-center gap-2 ${
            activeTab === 'csv'
              ? 'bg-white text-green-700 shadow-sm scale-100'
              : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200/50 scale-95'
          }`}
        >
          <span>💳</span> キャッシュレス
        </button>
      </div>

      <div className="flex items-center justify-between bg-blue-50 p-3 sm:p-4 rounded-xl mb-6 shadow-inner relative z-20">
        <button
          onClick={handlePrevMonth}
          disabled={currentIndex >= allMonths.length - 1}
          className="px-3 sm:px-4 py-2 bg-white border border-gray-200 rounded-lg shadow-sm hover:bg-gray-50 font-bold disabled:opacity-50 transition-all shrink-0"
        >
          ◀️
        </button>

        <div className="text-center relative flex-1 mx-2 sm:mx-4">
          <div className="relative inline-block w-full sm:w-auto">
            <button
              onClick={() => setIsMonthDropdownOpen(!isMonthDropdownOpen)}
              className={`text-lg sm:text-xl font-extrabold text-gray-800 bg-white border border-gray-200 px-3 sm:px-4 py-2 transition-all flex items-center justify-between w-full sm:w-[220px] relative z-50 ${
                isMonthDropdownOpen
                  ? 'rounded-t-2xl border-b-transparent shadow-none'
                  : 'rounded-full shadow-sm hover:border-blue-300'
              }`}
            >
              <span className="w-5 hidden sm:block"></span>
              <span className="flex-1 text-center whitespace-nowrap">
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
                      return (
                        <li key={m} className="px-2 py-0.5">
                          <button
                            onClick={() => {
                              setCurrentMonth(m)
                              setIsMonthDropdownOpen(false)
                            }}
                            className={`w-full text-center px-4 py-2 rounded-lg text-lg transition-colors ${
                              m === currentMonth
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
          <p className="text-xs sm:text-sm font-bold text-gray-600 mt-2">
            合計:{' '}
            <span
              className={`text-base sm:text-lg ${activeTab === 'receipts' ? 'text-blue-700' : 'text-green-700'}`}
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
          className="px-3 sm:px-4 py-2 bg-white border border-gray-200 rounded-lg shadow-sm hover:bg-gray-50 font-bold disabled:opacity-50 transition-all shrink-0"
        >
          ▶️
        </button>
      </div>

      {activeTab === 'receipts' && (
        <div className="space-y-3 flex-1 overflow-y-auto pr-1">
          {isFetchingMonth ? (
            <div className="text-center py-16 flex flex-col items-center gap-3 text-gray-500 font-bold border-2 border-dashed rounded-xl border-gray-200 bg-gray-50">
              <span className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></span>
              データを取得中...
            </div>
          ) : filteredReceipts.length === 0 ? (
            <p className="text-center text-gray-400 font-bold py-16 border-2 border-dashed rounded-xl border-gray-200 bg-gray-50">
              該当するレシートがありません。
            </p>
          ) : (
            filteredReceipts.map((receipt) => (
              <div
                key={receipt.id}
                className="border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm hover:shadow-md transition-shadow"
              >
                <div
                  onClick={() => toggleAccordion(receipt.id)}
                  className="flex flex-col sm:flex-row sm:items-center p-3 sm:p-4 cursor-pointer gap-2 sm:gap-4"
                >
                  <div className="flex justify-between items-center w-full sm:w-auto shrink-0">
                    <span className="text-xs font-bold text-gray-500 bg-gray-100 px-2.5 py-1 rounded-md">
                      {receipt.date}
                    </span>
                    <span className="sm:hidden font-extrabold text-blue-700 text-lg">
                      ¥{receipt.total_amount.toLocaleString()}
                    </span>
                  </div>

                  <div className="font-extrabold text-gray-800 flex-1 truncate text-base sm:text-sm">
                    {receipt.store_name}
                  </div>

                  <div className="flex items-center justify-end gap-3 shrink-0 mt-1 sm:mt-0">
                    <span className="hidden sm:block font-extrabold text-blue-700 w-24 text-right text-lg">
                      ¥{receipt.total_amount.toLocaleString()}
                    </span>
                    <div className="flex gap-2">
                      <button
                        onClick={(e) => openEditReceipt(receipt, e)}
                        className="p-2 text-blue-500 hover:bg-blue-50 rounded-lg transition-colors border border-gray-200 shadow-sm"
                      >
                        ✏️
                      </button>
                      <button
                        onClick={(e) => requestDeleteReceipt(receipt.id, e)}
                        className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors border border-gray-200 shadow-sm"
                      >
                        🗑️
                      </button>
                    </div>
                    <span
                      className={`text-gray-400 text-xs w-4 text-center transition-transform duration-300 ${expandedReceiptId === receipt.id ? 'rotate-180' : ''}`}
                    >
                      ▼
                    </span>
                  </div>
                </div>

                {expandedReceiptId === receipt.id &&
                  receipt.receipt_items.length > 0 && (
                    <div className="p-4 bg-gray-50 border-t border-gray-100 text-sm">
                      <ul className="space-y-2">
                        {receipt.receipt_items.map((item) => (
                          <li
                            key={item.id || item.item_name}
                            className="flex justify-between text-gray-600 font-bold border-b border-gray-200/50 pb-1 last:border-0 last:pb-0"
                          >
                            <span className="truncate pr-4">
                              ・{item.item_name}
                            </span>
                            <span className="shrink-0 text-gray-800">
                              ¥{item.price.toLocaleString()}
                            </span>
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
        <div className="space-y-3 flex-1 overflow-y-auto pr-1">
          {isFetchingMonth ? (
            <div className="text-center py-16 flex flex-col items-center gap-3 text-gray-500 font-bold border-2 border-dashed rounded-xl border-gray-200 bg-gray-50">
              <span className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin"></span>
              データを取得中...
            </div>
          ) : filteredCsv.length === 0 ? (
            <p className="text-center text-gray-400 font-bold py-16 border-2 border-dashed rounded-xl border-gray-200 bg-gray-50">
              該当する履歴がありません。
            </p>
          ) : (
            filteredCsv.map((csv) => (
              <div
                key={csv.id}
                className="border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="flex flex-col sm:flex-row sm:items-center p-3 sm:p-4 gap-2 sm:gap-4">
                  <div className="flex justify-between items-center w-full sm:w-auto shrink-0">
                    <span className="text-xs font-bold text-gray-500 bg-gray-100 px-2.5 py-1 rounded-md">
                      {csv.date}
                    </span>
                    <span className="sm:hidden font-extrabold text-green-700 text-lg">
                      ¥{csv.price.toLocaleString()}
                    </span>
                  </div>

                  <div className="font-extrabold text-gray-800 flex-1 truncate text-base sm:text-sm">
                    {csv.store}
                  </div>

                  <div className="flex items-center justify-end gap-3 shrink-0 mt-1 sm:mt-0">
                    <span className="hidden sm:block font-extrabold text-green-700 w-24 text-right text-lg">
                      ¥{csv.price.toLocaleString()}
                    </span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => openEditCsv(csv)}
                        className="p-2 text-blue-500 hover:bg-blue-50 rounded-lg transition-colors border border-gray-200 shadow-sm"
                      >
                        ✏️
                      </button>
                      <button
                        onClick={() => requestDeleteCsv(csv.id)}
                        className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors border border-gray-200 shadow-sm"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60 backdrop-blur-sm px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center transform transition-all">
            <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-4xl">🗑️</span>
            </div>
            <h3 className="text-xl font-extrabold text-gray-800 mb-2">
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
                className="flex-1 py-3 border-gray-200 font-bold"
              >
                キャンセル
              </Button>
              <Button
                variant="primary"
                onClick={executeDelete}
                disabled={isDeleting}
                className="flex-1 py-3 !bg-red-600 hover:!bg-red-700 font-bold shadow-sm border-none flex items-center justify-center gap-2"
              >
                {isDeleting ? (
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                ) : null}
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
