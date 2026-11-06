import React, { useRef } from 'react'
import { Button } from '@/components/ui/Button'
import { useHistory } from '../hooks/useHistory'
import { HistoryEditModal } from './HistoryEditModal'

export const HistoryPage: React.FC = () => {
  const receiptCardRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const touchStartXRef = useRef<number | null>(null)
  const touchStartYRef = useRef<number | null>(null)

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
    searchScope,
    setSearchScope,
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
      <div
        role="status"
        className="text-center py-20 text-[var(--rm-text-secondary)] font-semibold flex flex-col items-center gap-3"
      >
        <span className="w-8 h-8 border-4 border-[var(--rm-receipt)] border-t-transparent rounded-full animate-spin"></span>
        データを読み込み中...
      </div>
    )
  }

  return (
    <div className="rm-card p-4 min-h-[600px] flex flex-col max-w-4xl mx-auto">
      <div className="flex gap-2 mb-3">
        <button
          onClick={() => setSearchScope('current')}
          className={`min-h-11 flex-1 py-2 text-sm font-semibold rounded-md border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
            searchScope === 'current'
              ? 'bg-[var(--rm-receipt-subtle)] text-[var(--rm-receipt)] border-[var(--rm-receipt)]'
              : 'bg-[var(--rm-surface)] text-[var(--rm-text-secondary)] border-[var(--rm-border)] hover:bg-[var(--rm-surface-subtle)]'
          }`}
        >
          この月だけ検索
        </button>
        <button
          onClick={() => setSearchScope('all')}
          className={`min-h-11 flex-1 py-2 text-sm font-semibold rounded-md border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
            searchScope === 'all'
              ? 'bg-[var(--rm-receipt-subtle)] text-[var(--rm-receipt)] border-[var(--rm-receipt)]'
              : 'bg-[var(--rm-surface)] text-[var(--rm-text-secondary)] border-[var(--rm-border)] hover:bg-[var(--rm-surface-subtle)]'
          }`}
        >
          全期間検索
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <span
            aria-hidden="true"
            className="absolute left-3 top-2.5 text-[var(--rm-text-muted)]"
          >
            ⌕
          </span>
          <input
            type="text"
            placeholder="店名や商品名で検索..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="店名や商品名で検索"
            className="rm-field w-full pl-9 pr-3 py-2.5"
          />
        </div>
        <button
          onClick={() =>
            setSortOrder((prev) => (prev === 'desc' ? 'asc' : 'desc'))
          }
          className="min-h-11 flex justify-center items-center gap-2 px-5 py-2.5 bg-[var(--rm-surface)] hover:bg-[var(--rm-surface-subtle)] border border-[var(--rm-border)] text-[var(--rm-text-secondary)] font-semibold rounded-md transition-colors w-full sm:w-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          <span
            className={`transition-transform duration-300 ${sortOrder === 'asc' ? 'rotate-180' : ''}`}
          >
            ↓
          </span>
          {sortOrder === 'desc' ? '新しい順' : '古い順'}
        </button>
      </div>

      <div className="flex bg-stone-100 border border-stone-200 p-1 rounded-xl mb-6">
        <button
          onClick={() => setActiveTab('receipts')}
          className={`min-h-11 sm:min-h-10 flex-1 py-2.5 text-sm font-semibold rounded-lg transition-colors duration-150 flex justify-center items-center gap-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
            activeTab === 'receipts'
              ? 'bg-[var(--rm-surface)] text-[var(--rm-receipt)] shadow-sm'
              : 'text-[var(--rm-text-secondary)] hover:text-[var(--rm-text-primary)] hover:bg-stone-200/70'
          }`}
        >
          <span aria-hidden="true">▤</span> レシート
        </button>
        <button
          onClick={() => setActiveTab('csv')}
          className={`min-h-11 sm:min-h-10 flex-1 py-2.5 text-sm font-semibold rounded-lg transition-colors duration-150 flex justify-center items-center gap-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
            activeTab === 'csv'
              ? 'bg-[var(--rm-surface)] text-[var(--rm-csv)] shadow-sm'
              : 'text-[var(--rm-text-secondary)] hover:text-[var(--rm-text-primary)] hover:bg-stone-200/70'
          }`}
        >
          <span aria-hidden="true">▤</span> キャッシュレス
        </button>
      </div>

      {searchScope === 'current' && (
        <div className="flex items-center justify-between bg-[var(--rm-surface-subtle)] p-3 sm:p-4 rounded-[var(--rm-radius-panel)] mb-6 border border-[var(--rm-border-subtle)] relative z-20">
          <button
            onClick={handlePrevMonth}
            disabled={currentIndex >= allMonths.length - 1}
            aria-label="前の月"
            className="min-h-11 px-3 sm:px-4 py-2 bg-[var(--rm-surface)] border border-[var(--rm-border)] rounded-md shadow-sm hover:bg-[var(--rm-surface-subtle)] font-semibold text-[var(--rm-text-secondary)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            ‹
          </button>

          <div className="text-center relative flex-1 mx-2 sm:mx-4">
            <div className="relative inline-block w-full sm:w-auto">
              <button
                onClick={() => setIsMonthDropdownOpen(!isMonthDropdownOpen)}
                aria-label="表示する月を選択"
                className={`min-h-11 text-lg sm:text-xl font-bold text-[var(--rm-text-primary)] bg-[var(--rm-surface)] border border-[var(--rm-border)] px-3 sm:px-4 py-2 transition-all flex items-center justify-between w-full sm:w-[220px] relative z-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
                  isMonthDropdownOpen
                    ? 'rounded-t-[var(--rm-radius-panel)] border-b-transparent shadow-none'
                    : 'rounded-md shadow-sm hover:border-[var(--rm-focus)]'
                }`}
              >
                <span className="w-5 hidden sm:block"></span>
                <span className="flex-1 text-center whitespace-nowrap">
                  {formattedCurrentMonth}
                </span>
                <span
                  className={`text-[var(--rm-text-muted)] text-sm w-5 text-right transition-transform duration-200 ${isMonthDropdownOpen ? 'rotate-180' : ''}`}
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
                  <div className="absolute top-full left-0 w-full bg-[var(--rm-surface)] border border-[var(--rm-border)] border-t-0 rounded-b-[var(--rm-radius-panel)] shadow-[var(--rm-shadow-popover)] z-40 overflow-hidden -mt-[1px]">
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
                                  ? 'bg-[var(--rm-receipt-subtle)] text-[var(--rm-receipt)] font-bold'
                                  : 'text-[var(--rm-text-secondary)] hover:bg-[var(--rm-surface-subtle)] font-semibold'
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
            <p className="text-xs sm:text-sm font-semibold text-[var(--rm-text-secondary)] mt-2">
              合計:{' '}
              <span
                className={`text-base sm:text-lg ${activeTab === 'receipts' ? 'text-[var(--rm-receipt)]' : 'text-[var(--rm-csv)]'}`}
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
            aria-label="次の月"
            className="min-h-11 px-3 sm:px-4 py-2 bg-[var(--rm-surface)] border border-[var(--rm-border)] rounded-md shadow-sm hover:bg-[var(--rm-surface-subtle)] font-semibold text-[var(--rm-text-secondary)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            ›
          </button>
        </div>
      )}

      <div
        className="flex-1 min-h-0"
        onTouchStart={(e) => {
          if (window.matchMedia('(min-width: 640px)').matches) return
          const touch = e.touches[0]
          touchStartXRef.current = touch?.clientX ?? null
          touchStartYRef.current = touch?.clientY ?? null
        }}
        onTouchEnd={(e) => {
          if (window.matchMedia('(min-width: 640px)').matches) return
          const touch = e.changedTouches[0]
          if (!touch) return
          const startX = touchStartXRef.current
          const startY = touchStartYRef.current
          touchStartXRef.current = null
          touchStartYRef.current = null
          if (startX == null || startY == null) return

          const diffX = touch.clientX - startX
          const diffY = touch.clientY - startY
          if (Math.abs(diffX) < 50 || Math.abs(diffY) > 40) return

          if (diffX < 0 && activeTab === 'receipts') {
            setActiveTab('csv')
          } else if (diffX > 0 && activeTab === 'csv') {
            setActiveTab('receipts')
          }
        }}
      >
        {activeTab === 'receipts' && (
          <div className="space-y-3 h-full overflow-y-auto pr-1">
            {isFetchingMonth ? (
              <div
                role="status"
                className="text-center py-16 flex flex-col items-center gap-3 text-[var(--rm-text-secondary)] font-semibold border border-dashed rounded-[var(--rm-radius-panel)] border-[var(--rm-border)] bg-[var(--rm-surface-subtle)]"
              >
                <span className="w-8 h-8 border-4 border-[var(--rm-receipt)] border-t-transparent rounded-full animate-spin"></span>
                データを取得中...
              </div>
            ) : filteredReceipts.length === 0 ? (
              <p className="text-center text-[var(--rm-text-secondary)] font-semibold py-16 border border-dashed rounded-[var(--rm-radius-panel)] border-[var(--rm-border)] bg-[var(--rm-surface-subtle)]">
                該当するレシートがありません。
              </p>
            ) : (
              filteredReceipts.map((receipt) => (
                <div
                  key={receipt.id}
                  ref={(el) => {
                    receiptCardRefs.current[receipt.id] = el
                  }}
                  className={`border rounded-[var(--rm-radius-card)] overflow-hidden bg-[var(--rm-surface)] shadow-sm hover:shadow-md transition-shadow ${
                    expandedReceiptId === receipt.id && searchQuery
                      ? 'border-[var(--rm-receipt)] ring-2 ring-[var(--rm-receipt-subtle)]'
                      : 'border-[var(--rm-border-subtle)]'
                  }`}
                >
                  <div
                    onClick={() => toggleAccordion(receipt.id)}
                    className="flex flex-col sm:flex-row sm:items-center p-3 sm:p-4 cursor-pointer gap-2 sm:gap-4"
                  >
                    <div className="flex justify-between items-center w-full sm:w-auto shrink-0">
                      <span className="text-xs font-semibold text-[var(--rm-text-secondary)] bg-[var(--rm-surface-muted)] px-2.5 py-1 rounded-md">
                        {receipt.date}
                      </span>
                      <span className="sm:hidden font-bold text-[var(--rm-receipt)] text-lg">
                        ¥{receipt.total_amount.toLocaleString()}
                      </span>
                    </div>

                    <div className="font-semibold text-[var(--rm-text-primary)] flex-1 truncate text-base sm:text-sm">
                      {receipt.store_name}
                    </div>

                    <div className="flex items-center justify-end gap-3 shrink-0 mt-1 sm:mt-0">
                      <span className="hidden sm:block font-bold text-[var(--rm-receipt)] w-24 text-right text-lg">
                        ¥{receipt.total_amount.toLocaleString()}
                      </span>
                      <div className="flex gap-2">
                        <button
                          onClick={(e) => openEditReceipt(receipt, e)}
                          aria-label={`${receipt.store_name}を編集`}
                          className="min-h-11 min-w-11 p-2 text-[var(--rm-receipt)] hover:bg-[var(--rm-receipt-subtle)] rounded-md transition-colors border border-[var(--rm-border)] shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                        >
                          ✎
                        </button>
                        <button
                          onClick={(e) => requestDeleteReceipt(receipt.id, e)}
                          aria-label={`${receipt.store_name}を削除`}
                          className="min-h-11 min-w-11 p-2 text-[var(--rm-danger)] hover:bg-[var(--rm-danger-subtle)] rounded-md transition-colors border border-[var(--rm-border)] shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700"
                        >
                          ×
                        </button>
                      </div>
                      <span
                        className={`text-[var(--rm-text-muted)] text-xs w-4 text-center transition-transform duration-300 ${expandedReceiptId === receipt.id ? 'rotate-180' : ''}`}
                      >
                        ▼
                      </span>
                    </div>
                  </div>

                  {expandedReceiptId === receipt.id &&
                    receipt.receipt_items.length > 0 && (
                      <div className="p-4 bg-[var(--rm-surface-subtle)] border-t border-[var(--rm-border-subtle)] text-sm">
                        <ul className="space-y-2">
                          {receipt.receipt_items.map((item) => (
                            <li
                              key={item.id || item.item_name}
                              className={`flex justify-between font-bold border-b border-[var(--rm-border-subtle)] pb-1 last:border-0 last:pb-0 ${
                                expandedReceiptId === receipt.id &&
                                searchQuery === item.item_name
                                  ? 'text-[var(--rm-receipt)] bg-[var(--rm-receipt-subtle)] -mx-2 px-2 py-1 rounded-md'
                                  : 'text-[var(--rm-text-secondary)]'
                              }`}
                            >
                              <span className="truncate pr-4">
                                ・{item.item_name}
                              </span>
                              <span className="shrink-0 text-[var(--rm-text-primary)]">
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
          <div className="space-y-3 h-full overflow-y-auto pr-1">
            {isFetchingMonth ? (
              <div
                role="status"
                className="text-center py-16 flex flex-col items-center gap-3 text-[var(--rm-text-secondary)] font-semibold border border-dashed rounded-[var(--rm-radius-panel)] border-[var(--rm-border)] bg-[var(--rm-surface-subtle)]"
              >
                <span className="w-8 h-8 border-4 border-[var(--rm-csv)] border-t-transparent rounded-full animate-spin"></span>
                データを取得中...
              </div>
            ) : filteredCsv.length === 0 ? (
              <p className="text-center text-[var(--rm-text-secondary)] font-semibold py-16 border border-dashed rounded-[var(--rm-radius-panel)] border-[var(--rm-border)] bg-[var(--rm-surface-subtle)]">
                該当する履歴がありません。
              </p>
            ) : (
              filteredCsv.map((csv) => (
                <div
                  key={csv.id}
                  className="border border-[var(--rm-border-subtle)] rounded-[var(--rm-radius-card)] overflow-hidden bg-[var(--rm-surface)] shadow-sm hover:shadow-md transition-shadow"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center p-3 sm:p-4 gap-2 sm:gap-4">
                    <div className="flex justify-between items-center w-full sm:w-auto shrink-0">
                      <span className="text-xs font-semibold text-[var(--rm-text-secondary)] bg-[var(--rm-surface-muted)] px-2.5 py-1 rounded-md">
                        {csv.date}
                      </span>
                      <span className="sm:hidden font-bold text-[var(--rm-csv)] text-lg">
                        ¥{csv.price.toLocaleString()}
                      </span>
                    </div>

                    <div className="font-semibold text-[var(--rm-text-primary)] flex-1 truncate text-base sm:text-sm">
                      {csv.store}
                    </div>

                    <div className="flex items-center justify-end gap-3 shrink-0 mt-1 sm:mt-0">
                      <span className="hidden sm:block font-bold text-[var(--rm-csv)] w-24 text-right text-lg">
                        ¥{csv.price.toLocaleString()}
                      </span>
                      <div className="flex gap-2">
                        <button
                          onClick={() => openEditCsv(csv)}
                          aria-label={`${csv.store}を編集`}
                          className="min-h-11 min-w-11 p-2 text-[var(--rm-csv)] hover:bg-[var(--rm-csv-subtle)] rounded-md transition-colors border border-[var(--rm-border)] shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                        >
                          ✎
                        </button>
                        <button
                          onClick={() => requestDeleteCsv(csv.id)}
                          aria-label={`${csv.store}を削除`}
                          className="min-h-11 min-w-11 p-2 text-[var(--rm-danger)] hover:bg-[var(--rm-danger-subtle)] rounded-md transition-colors border border-[var(--rm-border)] shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {searchScope === 'current' && (
        <div className="flex items-center justify-between bg-[var(--rm-surface-subtle)] p-2.5 rounded-[var(--rm-radius-panel)] mt-4 border border-[var(--rm-border-subtle)]">
          <Button
            variant="secondary"
            onClick={handlePrevMonth}
            disabled={currentIndex >= allMonths.length - 1}
            className="px-3 py-1.5"
          >
            ‹
          </Button>
          <span className="text-sm font-semibold text-[var(--rm-text-secondary)]">
            {formattedCurrentMonth}
          </span>
          <Button
            variant="secondary"
            onClick={handleNextMonth}
            disabled={currentIndex <= 0}
            className="px-3 py-1.5"
          >
            ›
          </Button>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/50 backdrop-blur-sm px-4">
          <div className="bg-[var(--rm-surface)] rounded-[var(--rm-radius-panel)] shadow-[var(--rm-shadow-popover)] w-full max-w-sm p-6 text-center transform transition-all border border-[var(--rm-border-subtle)]">
            <div className="w-16 h-16 bg-[var(--rm-danger-subtle)] rounded-full flex items-center justify-center mx-auto mb-4">
              <span
                aria-hidden="true"
                className="text-3xl text-[var(--rm-danger)]"
              >
                ×
              </span>
            </div>
            <h3 className="text-xl font-bold text-[var(--rm-text-primary)] mb-2">
              本当に削除しますか？
            </h3>
            <p className="text-sm text-[var(--rm-text-muted)] mb-6">
              この操作は取り消せません。
            </p>
            <div className="flex gap-3">
              <Button
                variant="secondary"
                onClick={() => setDeleteTarget(null)}
                disabled={isDeleting}
                className="flex-1 py-3 border-[var(--rm-border)] font-semibold"
              >
                キャンセル
              </Button>
              <Button
                variant="primary"
                onClick={executeDelete}
                disabled={isDeleting}
                className="flex-1 py-3 !bg-[var(--rm-danger)] hover:!bg-red-800 font-semibold shadow-sm border-none flex items-center justify-center gap-2 focus-visible:outline-red-700"
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
