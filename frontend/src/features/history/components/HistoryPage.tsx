import React, { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { useHistory } from '../hooks/useHistory'
import { HistoryEditModal } from './HistoryEditModal'

const MonthChevron: React.FC<{ direction: 'left' | 'right' }> = ({
  direction,
}) => (
  <svg
    aria-hidden="true"
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d={direction === 'left' ? 'm15 18-6-6 6-6' : 'm9 18 6-6-6-6'} />
  </svg>
)

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
    submittedQuery,
    clearSearch,
    viewStatus,
    retryLoad,
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

  const [selectedYear, setSelectedYear] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus()
  }, [searchOpen])
  const years = [...new Set(allMonths.map((month) => month.slice(0, 4)))]
  const displayedYear = years.includes(selectedYear)
    ? selectedYear
    : currentMonth?.slice(0, 4) || years[0] || ''

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
      {searchScope === 'current' ? (
        <p className="flex flex-col text-xs font-semibold text-[var(--rm-text-secondary)] text-center">
          {formattedCurrentMonth}の
          {activeTab === 'receipts' ? 'レシート' : 'キャッシュレス'}合計
          <span
            className={`text-2xl font-bold ${activeTab === 'receipts' ? 'text-[var(--rm-receipt)]' : 'text-[var(--rm-csv)]'}`}
          >
            {viewStatus === 'ready'
              ? `¥${(activeTab === 'receipts' ? receiptTotal : csvTotal).toLocaleString()}`
              : viewStatus === 'error'
                ? '取得できません'
                : '読み込み中'}
          </span>
        </p>
      ) : (
        <p className="min-h-11 flex items-center justify-center text-sm font-semibold text-[var(--rm-text-secondary)]">
          全期間の検索
        </p>
      )}
      <div
        aria-hidden="true"
        className="border-t border-[var(--rm-border-subtle)] mt-2"
      />
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] items-center gap-2 my-2">
        <div className="flex bg-stone-100 border border-stone-200 p-1 sm:p-0.5 sm:h-9 rounded-xl w-full sm:w-auto lg:w-fit shrink-0 whitespace-nowrap">
          <button
            onClick={() => setActiveTab('receipts')}
            className={`min-h-11 sm:min-h-0 sm:h-full flex-1 lg:flex-none px-3 py-1.5 text-sm font-semibold rounded-lg transition-colors duration-150 flex justify-center items-center gap-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
              activeTab === 'receipts'
                ? 'bg-[var(--rm-surface)] text-[var(--rm-receipt)] shadow-sm'
                : 'text-[var(--rm-text-secondary)] hover:text-[var(--rm-text-primary)] hover:bg-stone-200/70'
            }`}
          >
            レシート
          </button>
          <button
            onClick={() => setActiveTab('csv')}
            className={`min-h-11 sm:min-h-0 sm:h-full flex-1 lg:flex-none px-3 py-1.5 text-sm font-semibold rounded-lg transition-colors duration-150 flex justify-center items-center gap-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
              activeTab === 'csv'
                ? 'bg-[var(--rm-surface)] text-[var(--rm-csv)] shadow-sm'
                : 'text-[var(--rm-text-secondary)] hover:text-[var(--rm-text-primary)] hover:bg-stone-200/70'
            }`}
          >
            キャッシュレス
          </button>
        </div>
        {searchScope === 'current' && (
          <div className="flex items-center justify-center gap-2 relative z-20">
            <button
              onClick={handlePrevMonth}
              disabled={currentIndex >= allMonths.length - 1}
              aria-label="前の月"
              className="inline-flex items-center justify-center min-h-11 min-w-11 sm:min-h-9 sm:min-w-9 px-2 py-1 bg-[var(--rm-surface)] border border-[var(--rm-border)] rounded-md shadow-sm hover:bg-[var(--rm-surface-subtle)] text-2xl leading-none font-semibold text-[var(--rm-text-secondary)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
            >
              <MonthChevron direction="left" />
            </button>

            <div className="text-center relative">
              <div className="relative inline-block">
                <button
                  onClick={() => {
                    setSelectedYear(currentMonth?.slice(0, 4) || years[0] || '')
                    setIsMonthDropdownOpen(!isMonthDropdownOpen)
                  }}
                  aria-expanded={isMonthDropdownOpen}
                  aria-label="表示する月を選択"
                  className={`min-h-11 sm:min-h-9 text-sm font-bold text-[var(--rm-text-primary)] bg-[var(--rm-surface)] border border-[var(--rm-border)] px-3 py-1.5 transition-all flex items-center justify-center w-full sm:w-auto relative z-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
                    isMonthDropdownOpen
                      ? 'rounded-t-[var(--rm-radius-panel)] border-b-transparent shadow-none'
                      : 'rounded-md shadow-sm hover:border-[var(--rm-focus)]'
                  }`}
                >
                  <span className="text-center whitespace-nowrap">
                    {formattedCurrentMonth}
                  </span>
                </button>

                {isMonthDropdownOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-30"
                      onClick={() => setIsMonthDropdownOpen(false)}
                    ></div>
                    <div className="absolute top-full left-1/2 -translate-x-1/2 w-60 bg-[var(--rm-surface)] border border-[var(--rm-border)] rounded-[var(--rm-radius-panel)] shadow-[var(--rm-shadow-popover)] z-40 p-3 mt-1">
                      <label
                        className="block text-xs font-semibold text-[var(--rm-text-secondary)] mb-1"
                        htmlFor="history-year"
                      >
                        年
                      </label>
                      <div className="relative mb-2">
                        <select
                          id="history-year"
                          value={displayedYear}
                          onChange={(e) => setSelectedYear(e.target.value)}
                          className="rm-field w-full min-h-11 appearance-none text-center px-10"
                        >
                          {years.map((year) => (
                            <option key={year} value={year}>
                              {year}年
                            </option>
                          ))}
                        </select>
                        <span
                          aria-hidden="true"
                          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--rm-text-secondary)]"
                        >
                          ▼
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-1">
                        {allMonths
                          .filter((month) =>
                            month.startsWith(`${displayedYear}-`)
                          )
                          .map((month) => (
                            <button
                              key={month}
                              onClick={() => {
                                setCurrentMonth(month)
                                setIsMonthDropdownOpen(false)
                              }}
                              className={`min-h-11 rounded-lg text-sm font-semibold ${month === currentMonth ? 'bg-[var(--rm-receipt-subtle)] text-[var(--rm-receipt)]' : 'text-[var(--rm-text-secondary)] hover:bg-[var(--rm-surface-subtle)]'}`}
                            >
                              {parseInt(month.slice(5), 10)}月
                            </button>
                          ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            <button
              onClick={handleNextMonth}
              disabled={currentIndex <= 0}
              aria-label="次の月"
              className="inline-flex items-center justify-center min-h-11 min-w-11 sm:min-h-9 sm:min-w-9 px-2 py-1 bg-[var(--rm-surface)] border border-[var(--rm-border)] rounded-md shadow-sm hover:bg-[var(--rm-surface-subtle)] text-2xl leading-none font-semibold text-[var(--rm-text-secondary)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
            >
              <MonthChevron direction="right" />
            </button>
          </div>
        )}
        <div className="flex justify-end gap-2 lg:col-start-3">
          <button
            type="button"
            onClick={() => {
              if (searchOpen) clearSearch()
              setSearchOpen(!searchOpen)
            }}
            aria-label="検索"
            aria-expanded={searchOpen}
            aria-controls="history-search"
            className={`inline-flex h-11 w-11 sm:h-9 sm:w-9 items-center justify-center rounded-md border border-[var(--rm-border)] hover:bg-[var(--rm-surface-subtle)] ${searchOpen ? 'bg-stone-100 text-stone-900' : 'text-[var(--rm-text-secondary)]'}`}
          >
            <svg
              aria-hidden="true"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m16 16 4 4" />
            </svg>
          </button>
          <button
            onClick={() =>
              setSortOrder((prev) => (prev === 'desc' ? 'asc' : 'desc'))
            }
            className="inline-flex items-center justify-center w-[104px] min-h-11 sm:min-h-9 px-2 text-sm rounded-md border border-[var(--rm-border)] text-[var(--rm-text-secondary)] font-semibold hover:bg-[var(--rm-surface-subtle)]"
          >
            {sortOrder === 'desc' ? '↓ 新しい順' : '↑ 古い順'}
          </button>
        </div>
      </div>
      {searchOpen && (
        <div id="history-search" className="mb-3">
          <input
            ref={searchInputRef}
            type="search"
            placeholder="過去の履歴を検索"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            aria-label="過去の履歴を検索"
            className="rm-field w-full min-h-11 px-3"
          />
        </div>
      )}
      {submittedQuery && (
        <div
          className="mb-3 text-sm font-semibold text-[var(--rm-text-secondary)]"
          role="status"
        >
          {`「${submittedQuery}」の全期間検索${viewStatus === 'ready' ? ` · ${activeTab === 'receipts' ? filteredReceipts.length : filteredCsv.length}件` : ''}`}
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
            {viewStatus === 'error' ? (
              <div
                role="alert"
                className="text-center py-12 text-[var(--rm-danger)]"
              >
                取得に失敗しました。{' '}
                <button onClick={retryLoad} className="underline min-h-11">
                  再試行
                </button>
              </div>
            ) : isFetchingMonth ? (
              <div
                role="status"
                className="text-center py-16 flex flex-col items-center gap-3 text-[var(--rm-text-secondary)] font-semibold border border-dashed rounded-[var(--rm-radius-panel)] border-[var(--rm-border)] bg-[var(--rm-surface-subtle)]"
              >
                <span className="w-8 h-8 border-4 border-[var(--rm-receipt)] border-t-transparent rounded-full animate-spin"></span>
                {submittedQuery ? '全期間の検索...' : 'データを取得中...'}
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
                    expandedReceiptId === receipt.id && submittedQuery
                      ? 'border-[var(--rm-receipt)] ring-2 ring-[var(--rm-receipt-subtle)]'
                      : 'border-[var(--rm-border-subtle)]'
                  }`}
                >
                  <div
                    onClick={() => toggleAccordion(receipt.id)}
                    className="flex flex-col sm:flex-row sm:items-center p-3 sm:px-3 sm:py-2 cursor-pointer gap-2 sm:gap-3"
                  >
                    <div className="flex flex-wrap gap-1 justify-between items-center w-full sm:w-auto shrink-0">
                      <span className="text-sm font-semibold text-[var(--rm-text-primary)] bg-[var(--rm-surface-muted)] px-2.5 py-1 rounded-md">
                        {receipt.date}
                      </span>
                      <span className="sm:hidden font-bold text-[var(--rm-receipt)] text-xl">
                        ¥{receipt.total_amount.toLocaleString()}
                      </span>
                    </div>

                    <div className="font-semibold text-[var(--rm-text-primary)] min-w-0 flex-1 truncate text-base sm:text-sm">
                      {receipt.store_name}
                    </div>

                    <div className="flex items-center justify-end gap-3 sm:gap-2 shrink-0 mt-1 sm:mt-0">
                      <span className="hidden sm:block font-bold text-[var(--rm-receipt)] min-w-24 w-auto whitespace-nowrap text-right text-xl">
                        ¥{receipt.total_amount.toLocaleString()}
                      </span>
                      <div className="flex gap-2 sm:gap-1">
                        <button
                          onClick={(e) => openEditReceipt(receipt, e)}
                          aria-label={`${receipt.store_name}を編集`}
                          className="min-h-11 min-w-11 sm:min-h-9 sm:min-w-9 p-2 text-[var(--rm-text-secondary)] hover:bg-[var(--rm-receipt-subtle)] rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                        >
                          ✎
                        </button>
                        <button
                          onClick={(e) => requestDeleteReceipt(receipt.id, e)}
                          aria-label={`${receipt.store_name}を削除`}
                          className="min-h-11 min-w-11 sm:min-h-9 sm:min-w-9 p-2 text-[var(--rm-text-secondary)] hover:bg-[var(--rm-danger-subtle)] rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700"
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
                                submittedQuery === item.item_name
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
            {viewStatus === 'error' ? (
              <div
                role="alert"
                className="text-center py-12 text-[var(--rm-danger)]"
              >
                取得に失敗しました。{' '}
                <button onClick={retryLoad} className="underline min-h-11">
                  再試行
                </button>
              </div>
            ) : isFetchingMonth ? (
              <div
                role="status"
                className="text-center py-16 flex flex-col items-center gap-3 text-[var(--rm-text-secondary)] font-semibold border border-dashed rounded-[var(--rm-radius-panel)] border-[var(--rm-border)] bg-[var(--rm-surface-subtle)]"
              >
                <span className="w-8 h-8 border-4 border-[var(--rm-csv)] border-t-transparent rounded-full animate-spin"></span>
                {submittedQuery ? '全期間の検索...' : 'データを取得中...'}
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
                  <div className="flex flex-col sm:flex-row sm:items-center p-3 sm:px-3 sm:py-2 gap-2 sm:gap-3">
                    <div className="flex flex-wrap gap-1 justify-between items-center w-full sm:w-auto shrink-0">
                      <span className="text-sm font-semibold text-[var(--rm-text-primary)] bg-[var(--rm-surface-muted)] px-2.5 py-1 rounded-md">
                        {csv.date}
                      </span>
                      <span className="sm:hidden font-bold text-[var(--rm-csv)] text-xl">
                        ¥{csv.price.toLocaleString()}
                      </span>
                    </div>

                    <div className="font-semibold text-[var(--rm-text-primary)] min-w-0 flex-1 truncate text-base sm:text-sm">
                      {csv.store}
                    </div>

                    <div className="flex items-center justify-end gap-3 sm:gap-2 shrink-0 mt-1 sm:mt-0">
                      <span className="hidden sm:block font-bold text-[var(--rm-csv)] min-w-24 w-auto whitespace-nowrap text-right text-xl">
                        ¥{csv.price.toLocaleString()}
                      </span>
                      <div className="flex gap-2 sm:gap-1">
                        <button
                          onClick={() => openEditCsv(csv)}
                          aria-label={`${csv.store}を編集`}
                          className="min-h-11 min-w-11 sm:min-h-9 sm:min-w-9 p-2 text-[var(--rm-text-secondary)] hover:bg-[var(--rm-csv-subtle)] rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                        >
                          ✎
                        </button>
                        <button
                          onClick={() => requestDeleteCsv(csv.id)}
                          aria-label={`${csv.store}を削除`}
                          className="min-h-11 min-w-11 sm:min-h-9 sm:min-w-9 p-2 text-[var(--rm-text-secondary)] hover:bg-[var(--rm-danger-subtle)] rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700"
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
            aria-label="前の月"
            className="px-3 py-1.5"
          >
            <MonthChevron direction="left" />
          </Button>
          <span className="text-sm font-semibold text-[var(--rm-text-secondary)]">
            {formattedCurrentMonth}
          </span>
          <Button
            variant="secondary"
            onClick={handleNextMonth}
            disabled={currentIndex <= 0}
            aria-label="次の月"
            className="px-3 py-1.5"
          >
            <MonthChevron direction="right" />
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
