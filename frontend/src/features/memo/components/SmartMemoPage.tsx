import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import {
  createMemoRow,
  deleteMemoRow,
  fetchMemoRows,
  searchMemoItems,
  updateMemoRow,
} from '../api/memoApi'
import type { MemoRowRecord, MemoSearchResultItem } from '../types'
import { useApiConfig } from '@/hooks/useApiConfig'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type DotItemDotProps,
  type TooltipContentProps,
} from 'recharts'

interface SmartMemoPageProps {
  onOpenHistory: (payload: {
    receiptId: string
    receiptDate: string
    itemName: string
  }) => void
}

type MemoRowState = {
  id: string
  query: string
  sortOrder: number
  results: MemoSearchResultItem[]
  excludedItemNames: string[]
  isLoading: boolean
  hasSearched: boolean
  isCreating?: boolean
}

type ChartPoint = {
  id: string
  date: string
  price: number
  store: string
  name: string
  isTransition: boolean
}

const CompactPriceTooltip = ({
  active,
  payload,
}: TooltipContentProps): React.ReactElement | null => {
  if (!active || !payload || payload.length === 0) return null
  const rawValue = payload[0]?.value
  const numeric =
    typeof rawValue === 'number' ? rawValue : Number(rawValue ?? 0)
  return (
    <div className="rounded-md bg-gray-900/90 px-2.5 py-1 text-xs lg:text-sm font-bold text-white shadow-md">
      ¥{numeric.toLocaleString()}
    </div>
  )
}

type ChartInteractionState = {
  activeTooltipIndex?: number | string | null
}

const toRowState = (row: MemoRowRecord): MemoRowState => ({
  id: row.id,
  query: row.query,
  sortOrder: row.sort_order,
  results: [],
  excludedItemNames: [],
  isLoading: false,
  hasSearched: false,
  isCreating: false,
})

export const SmartMemoPage: React.FC<SmartMemoPageProps> = ({
  onOpenHistory,
}) => {
  const { getHeaders } = useApiConfig()
  const [rows, setRows] = useState<MemoRowState[]>([])
  const [activeRowId, setActiveRowId] = useState<string | null>(null)
  const [isBootstrapping, setIsBootstrapping] = useState(true)
  const searchDebounceTimersRef = useRef<
    Record<string, ReturnType<typeof setTimeout>>
  >({})
  const saveDebounceTimersRef = useRef<
    Record<string, ReturnType<typeof setTimeout>>
  >({})
  const requestSequenceRef = useRef<Record<string, number>>({})

  const activeRow = useMemo(
    () => rows.find((row) => row.id === activeRowId) ?? null,
    [rows, activeRowId]
  )

  const [highlightedItemId, setHighlightedItemId] = useState<string | null>(
    null
  )
  const historyItemRefs = useRef<Record<string, HTMLLIElement | null>>({})
  const memoListScrollRef = useRef<HTMLDivElement>(null)
  const memoRowRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const pendingScrollRowIdRef = useRef<string | null>(null)
  const [isDesktopLayout, setIsDesktopLayout] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia('(min-width: 1024px)').matches
  })

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mediaQuery = window.matchMedia('(min-width: 1024px)')
    const handleChange = (event: MediaQueryListEvent) => {
      setIsDesktopLayout(event.matches)
    }
    setIsDesktopLayout(mediaQuery.matches)
    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [])

  useEffect(() => {
    setHighlightedItemId(null)
  }, [activeRowId])

  const handleSelectChartPoint = (
    itemId: string,
    scrollIntoHistory = false
  ) => {
    setHighlightedItemId(itemId)
    if (scrollIntoHistory) {
      historyItemRefs.current[itemId]?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      })
    }
  }

  const renderChartDot = (props: DotItemDotProps): React.ReactElement => {
    const { cx, cy, index } = props
    const point = props.payload as ChartPoint
    const key = `dot-${point?.id ?? index}`

    if (cx == null || cy == null) {
      return <g key={key} />
    }

    const isSelected = highlightedItemId === point.id

    // 値段が変動した点（と起点）だけを目立たせる。選択中はさらに強調する。
    if (!point?.isTransition) {
      return (
        <circle
          key={key}
          cx={cx}
          cy={cy}
          r={isSelected ? 5 : 2.5}
          fill={isSelected ? '#1D4ED8' : '#93C5FD'}
          stroke={isSelected ? '#fff' : undefined}
          strokeWidth={isSelected ? 2 : 0}
        />
      )
    }

    return (
      <circle
        key={key}
        cx={cx}
        cy={cy}
        r={isSelected ? 7 : 5}
        fill={isSelected ? '#1E3A8A' : '#1D4ED8'}
        stroke="#fff"
        strokeWidth={2}
      />
    )
  }

  const wait = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms))

  const getHeadersWithRetry = async (
    maxRetries = 4,
    delayMs = 120
  ): Promise<Record<string, string> | null> => {
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const headers = await getHeaders()
      if (headers) return headers
      if (attempt < maxRetries) {
        await wait(delayMs)
      }
    }
    return null
  }

  const scheduleSaveRow = (rowId: string, query: string, sortOrder: number) => {
    if (saveDebounceTimersRef.current[rowId]) {
      clearTimeout(saveDebounceTimersRef.current[rowId])
    }
    saveDebounceTimersRef.current[rowId] = setTimeout(async () => {
      const headers = await getHeaders()
      if (!headers) return
      try {
        await updateMemoRow(rowId, { query, sortOrder }, headers)
      } catch (error) {
        console.error('メモ保存エラー:', error)
      }
    }, 400)
  }

  const handleAddRow = async () => {
    const optimisticId = `tmp-${crypto.randomUUID()}`
    const optimisticRow: MemoRowState = {
      id: optimisticId,
      query: '',
      sortOrder: rows.length,
      results: [],
      excludedItemNames: [],
      isLoading: false,
      hasSearched: false,
      isCreating: true,
    }

    setRows((prev) => [...prev, optimisticRow])
    setActiveRowId(optimisticId)
    pendingScrollRowIdRef.current = optimisticId

    const headers = await getHeadersWithRetry()
    if (!headers) {
      let fallbackId: string | null = null
      setRows((prev) => {
        const next = prev.filter((row) => row.id !== optimisticId)
        fallbackId = next[0]?.id ?? null
        return next
      })
      setActiveRowId((prev) => (prev === optimisticId ? fallbackId : prev))
      return
    }

    try {
      const row = await createMemoRow(
        { query: '', sortOrder: rows.length },
        headers
      )
      setRows((prev) =>
        prev.map((current) =>
          current.id === optimisticId
            ? {
                ...current,
                id: row.id,
                query: row.query,
                sortOrder: row.sort_order,
                isCreating: false,
              }
            : current
        )
      )
      setActiveRowId((prev) => (prev === optimisticId ? row.id : prev))
      pendingScrollRowIdRef.current = row.id
    } catch (error) {
      console.error('メモ作成エラー:', error)
      let fallbackId: string | null = null
      setRows((prev) => {
        const next = prev.filter((current) => current.id !== optimisticId)
        fallbackId = next[0]?.id ?? null
        return next
      })
      setActiveRowId((prev) => (prev === optimisticId ? fallbackId : prev))
    }
  }

  const handleRemoveRow = async (id: string) => {
    if (searchDebounceTimersRef.current[id]) {
      clearTimeout(searchDebounceTimersRef.current[id])
      delete searchDebounceTimersRef.current[id]
    }
    if (saveDebounceTimersRef.current[id]) {
      clearTimeout(saveDebounceTimersRef.current[id])
      delete saveDebounceTimersRef.current[id]
    }

    const wasActive = activeRowId === id
    let removedRow: MemoRowState | null = null
    let removedIndex = -1
    let nextFirstId: string | null = null

    setRows((prev) => {
      removedIndex = prev.findIndex((row) => row.id === id)
      if (removedIndex < 0) return prev
      removedRow = prev[removedIndex]
      const next = prev
        .filter((row) => row.id !== id)
        .map((row, index) => ({ ...row, sortOrder: index }))
      nextFirstId = next[0]?.id ?? null
      return next
    })
    if (wasActive) {
      setActiveRowId(nextFirstId)
    }

    // サーバー作成前の行はローカル削除だけで完了
    if (id.startsWith('tmp-')) {
      return
    }

    const rollbackDelete = () => {
      if (!removedRow || removedIndex < 0) return
      setRows((prev) => {
        const insertAt = Math.min(Math.max(removedIndex, 0), prev.length)
        const restored = [
          ...prev.slice(0, insertAt),
          removedRow as MemoRowState,
          ...prev.slice(insertAt),
        ]
        return restored.map((row, index) => ({ ...row, sortOrder: index }))
      })
      if (wasActive) {
        setActiveRowId((removedRow as MemoRowState).id)
      }
    }

    const headers = await getHeadersWithRetry()
    if (!headers) {
      rollbackDelete()
      return
    }

    try {
      await deleteMemoRow(id, headers)
    } catch (error) {
      console.error('メモ削除エラー:', error)
      rollbackDelete()
    }
  }

  const runSearch = async (rowId: string, query: string) => {
    const trimmed = query.trim()
    if (!trimmed) {
      setRows((prev) =>
        prev.map((row) =>
          row.id === rowId
            ? {
                ...row,
                results: [],
                excludedItemNames: [],
                isLoading: false,
                hasSearched: false,
              }
            : row
        )
      )
      return
    }

    const requestId = (requestSequenceRef.current[rowId] ?? 0) + 1
    requestSequenceRef.current[rowId] = requestId

    setRows((prev) =>
      prev.map((row) =>
        row.id === rowId ? { ...row, isLoading: true, hasSearched: true } : row
      )
    )

    const headers = await getHeaders()
    if (!headers) {
      setRows((prev) =>
        prev.map((row) =>
          row.id === rowId ? { ...row, isLoading: false } : row
        )
      )
      return
    }

    try {
      const data = await searchMemoItems(trimmed, headers)
      const sortedData = data.sort((a, b) =>
        a.receipts.date.localeCompare(b.receipts.date)
      )

      if (requestSequenceRef.current[rowId] !== requestId) return

      setRows((prev) =>
        prev.map((row) =>
          row.id === rowId
            ? {
                ...row,
                results: sortedData,
                excludedItemNames: [],
                isLoading: false,
              }
            : row
        )
      )
    } catch (error) {
      console.error('検索エラー:', error)
      if (requestSequenceRef.current[rowId] !== requestId) return
      setRows((prev) =>
        prev.map((row) =>
          row.id === rowId ? { ...row, isLoading: false } : row
        )
      )
    }
  }

  const handleQueryChange = (rowId: string, nextQuery: string) => {
    setRows((prev) => {
      const updated = prev.map((row) =>
        row.id === rowId ? { ...row, query: nextQuery } : row
      )
      const targetRow = updated.find((row) => row.id === rowId)
      if (targetRow) {
        scheduleSaveRow(rowId, nextQuery, targetRow.sortOrder)
      }
      return updated
    })

    if (searchDebounceTimersRef.current[rowId]) {
      clearTimeout(searchDebounceTimersRef.current[rowId])
    }
    searchDebounceTimersRef.current[rowId] = setTimeout(() => {
      void runSearch(rowId, nextQuery)
    }, 250)
  }

  const toggleExclude = (rowId: string, itemName: string) => {
    setRows((prev) =>
      prev.map((row) => {
        if (row.id !== rowId) return row
        const exists = row.excludedItemNames.includes(itemName)
        return {
          ...row,
          excludedItemNames: exists
            ? row.excludedItemNames.filter((name) => name !== itemName)
            : [...row.excludedItemNames, itemName],
        }
      })
    )
  }

  useEffect(() => {
    const initializeRows = async () => {
      const headers = await getHeaders()
      if (!headers) {
        setIsBootstrapping(false)
        return
      }
      try {
        const shouldAutoFocusFirstRowOnOpen =
          typeof window === 'undefined' ||
          window.matchMedia('(min-width: 640px)').matches

        const savedRows = await fetchMemoRows(headers)
        if (savedRows.length === 0) {
          const createdRow = await createMemoRow(
            { query: '', sortOrder: 0 },
            headers
          )
          const nextRow = toRowState(createdRow)
          setRows([nextRow])
          setActiveRowId(shouldAutoFocusFirstRowOnOpen ? nextRow.id : null)
        } else {
          const mappedRows = savedRows.map(toRowState)
          setRows(mappedRows)
          setActiveRowId(
            shouldAutoFocusFirstRowOnOpen ? mappedRows[0].id : null
          )
        }
      } catch (error) {
        console.error('メモ初期化エラー:', error)
      } finally {
        setIsBootstrapping(false)
      }
    }

    void initializeRows()

    return () => {
      Object.values(searchDebounceTimersRef.current).forEach((timer) =>
        clearTimeout(timer)
      )
      Object.values(saveDebounceTimersRef.current).forEach((timer) =>
        clearTimeout(timer)
      )
    }
  }, [])

  useEffect(() => {
    if (!activeRow || activeRow.hasSearched || activeRow.isLoading) return
    if (!activeRow.query.trim()) return
    void runSearch(activeRow.id, activeRow.query)
  }, [activeRow])

  useEffect(() => {
    const rowId = pendingScrollRowIdRef.current
    if (!rowId) return

    const rowElement = memoRowRefs.current[rowId]
    if (!rowElement) return

    rowElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    const input = rowElement.querySelector('input')
    if (input instanceof HTMLInputElement) {
      input.focus()
    }
    pendingScrollRowIdRef.current = null
  }, [rows, activeRowId])

  const filteredResults =
    activeRow?.results.filter(
      (item) => !activeRow.excludedItemNames.includes(item.item_name)
    ) ?? []
  const uniqueItemNames = activeRow
    ? Array.from(new Set(activeRow.results.map((item) => item.item_name)))
    : []
  const isComparable = filteredResults.some(
    (item) => item.is_comparable ?? true
  )
  const chartData: ChartPoint[] = filteredResults.map((item, index, arr) => ({
    id: item.id,
    date: item.receipts.date,
    price: item.price,
    store: item.receipts.store_name,
    name: item.item_name,
    isTransition: index === 0 || item.price !== arr[index - 1].price,
  }))
  const minPrice =
    filteredResults.length > 0
      ? Math.min(...filteredResults.map((item) => item.price))
      : 0
  const avgPrice =
    filteredResults.length > 0
      ? Math.round(
          filteredResults.reduce((sum, item) => sum + item.price, 0) /
            filteredResults.length
        )
      : 0

  const resolveChartPoint = (
    state: ChartInteractionState
  ): ChartPoint | null => {
    const rawIndex = state.activeTooltipIndex
    if (rawIndex == null) return null
    const index = typeof rawIndex === 'number' ? rawIndex : Number(rawIndex)
    if (!Number.isInteger(index) || index < 0 || index >= chartData.length) {
      return null
    }
    return chartData[index] ?? null
  }

  const handleChartInteraction = (
    state: ChartInteractionState,
    scrollIntoHistory: boolean
  ) => {
    const point = resolveChartPoint(state)
    if (!point) return
    handleSelectChartPoint(point.id, scrollIntoHistory)
  }

  return (
    <div className="bg-gray-50 rounded-xl min-h-[620px] flex flex-col w-full max-w-none p-4 sm:p-6 lg:text-[15px]">
      <div className="text-center border-b border-gray-200 pb-3 mb-6">
        <h2 className="text-xl lg:text-2xl font-bold text-gray-800">
          スマート買い物メモ
        </h2>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(280px,360px)_minmax(0,1fr)_minmax(0,1fr)] gap-4 flex-1 min-h-0">
        <section className="bg-white border border-gray-200 rounded-xl shadow-sm p-3 sm:p-4 lg:p-5 min-h-[280px]">
          <div className="flex items-center justify-between gap-2 mb-3">
            <h3 className="text-sm lg:text-base font-bold text-gray-700">
              メモ一覧
            </h3>
            <Button
              variant="primary"
              onClick={() => void handleAddRow()}
              className="px-3 lg:px-4 py-1.5 lg:py-2 text-sm lg:text-base font-bold shadow-sm shrink-0"
            >
              ＋ メモを追加
            </Button>
          </div>
          <div
            ref={memoListScrollRef}
            className="space-y-2.5 max-h-[65vh] overflow-y-auto pr-1"
          >
            {isBootstrapping && (
              <div className="text-center py-10 text-gray-400 font-bold border-2 border-dashed rounded-xl border-gray-300 bg-gray-50">
                読み込み中...
              </div>
            )}
            {!isBootstrapping && rows.length === 0 && (
              <div className="text-center py-10 text-gray-400 font-bold border-2 border-dashed rounded-xl border-gray-300 bg-gray-50">
                「＋ メモを追加」で
                <br />
                メモを作成してください。
              </div>
            )}
            {rows.map((row, index) => (
              <React.Fragment key={row.id}>
                <div
                  ref={(el) => {
                    memoRowRefs.current[row.id] = el
                  }}
                  onClick={() =>
                    setActiveRowId((prev) =>
                      isDesktopLayout ? row.id : prev === row.id ? null : row.id
                    )
                  }
                  className={`w-full text-left border rounded-xl p-3 lg:p-4 transition cursor-pointer ${
                    activeRowId === row.id
                      ? 'border-blue-300 bg-blue-50/70'
                      : 'border-gray-200 bg-white hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <span className="text-xs lg:text-sm font-bold text-gray-600">
                      メモ {index + 1}
                    </span>
                    <Button
                      variant="danger"
                      onClick={(e) => {
                        e.stopPropagation()
                        void handleRemoveRow(row.id)
                      }}
                      disabled={row.isCreating}
                      className="px-2 py-1 text-[11px] lg:text-xs font-bold"
                    >
                      {row.isCreating ? '作成中' : '削除'}
                    </Button>
                  </div>
                  <Input
                    type="text"
                    placeholder="商品名を入力 (例: ねぎ 白)"
                    value={row.query}
                    onChange={(e) => handleQueryChange(row.id, e.target.value)}
                    onClick={(e) => {
                      e.stopPropagation()
                      setActiveRowId(row.id)
                    }}
                    onFocus={() => setActiveRowId(row.id)}
                    disabled={row.isCreating}
                    className="w-full text-sm lg:text-base py-1.5 lg:py-2"
                  />
                  <div className="mt-2 text-xs lg:text-sm text-gray-500 font-medium">
                    {row.isCreating
                      ? '作成中...'
                      : row.isLoading
                        ? '検索中...'
                        : row.hasSearched
                          ? `${row.results.length} 件`
                          : 'キーワード待ち'}
                  </div>
                </div>

                {!isDesktopLayout && activeRowId === row.id && activeRow && (
                  <div className="mt-3 space-y-3">
                    <section className="bg-white border border-gray-200 rounded-xl shadow-sm p-4">
                      <div>
                        <h3 className="text-lg font-extrabold text-gray-800">
                          メモ詳細
                        </h3>
                        <p className="text-xs text-gray-500 mt-1">
                          入力のたびに自動で検索し、内容を自動保存します。
                        </p>
                      </div>

                      {activeRow.hasSearched &&
                        activeRow.results.length === 0 &&
                        !activeRow.isLoading && (
                          <div className="text-center py-6 mt-4 text-gray-400 font-bold border-2 border-dashed rounded-lg border-gray-200 bg-gray-50">
                            過去の購入履歴が見つかりませんでした。
                          </div>
                        )}

                      {activeRow.hasSearched &&
                        activeRow.results.length > 0 &&
                        !activeRow.isLoading && (
                          <div className="space-y-4 mt-4">
                            <div className="flex flex-wrap gap-2 bg-gray-50 p-3 rounded-lg border border-gray-100">
                              <span className="text-xs font-bold text-gray-500 w-full mb-1">
                                表示する商品を選択:
                              </span>
                              {uniqueItemNames.map((name) => {
                                const isExcluded =
                                  activeRow.excludedItemNames.includes(name)
                                return (
                                  <button
                                    key={name}
                                    onClick={() =>
                                      toggleExclude(activeRow.id, name)
                                    }
                                    className={`px-3 py-1 text-xs font-bold rounded-full transition-colors border ${
                                      isExcluded
                                        ? 'bg-white text-gray-400 border-gray-300 hover:bg-gray-100'
                                        : 'bg-blue-100 text-blue-700 border-blue-200 hover:bg-blue-200'
                                    }`}
                                  >
                                    {isExcluded ? '＋' : '✓'} {name}
                                  </button>
                                )
                              })}
                            </div>

                            {filteredResults.length > 0 ? (
                              isComparable ? (
                                <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 shadow-sm">
                                  <div className="grid grid-cols-2 gap-4 mb-4">
                                    <div className="bg-white p-3 rounded-lg shadow-sm text-center border border-gray-100">
                                      <div className="text-xs font-bold text-gray-500 mb-1">
                                        最安値
                                      </div>
                                      <div className="text-xl font-extrabold text-blue-700">
                                        ¥{minPrice.toLocaleString()}
                                      </div>
                                    </div>
                                    <div className="bg-white p-3 rounded-lg shadow-sm text-center border border-gray-100">
                                      <div className="text-xs font-bold text-gray-500 mb-1">
                                        平均価格
                                      </div>
                                      <div className="text-xl font-extrabold text-gray-800">
                                        ¥{avgPrice.toLocaleString()}
                                      </div>
                                    </div>
                                  </div>

                                  <div
                                    className="h-[220px] bg-white p-3 rounded-lg shadow-sm border border-gray-100 [&_*:focus]:outline-none [&_*:focus-visible]:outline-none"
                                    onMouseLeave={() =>
                                      setHighlightedItemId(null)
                                    }
                                  >
                                    <ResponsiveContainer
                                      width="100%"
                                      height="100%"
                                    >
                                      <LineChart
                                        data={chartData}
                                        onMouseMove={(state) =>
                                          handleChartInteraction(state, false)
                                        }
                                        onClick={(state) =>
                                          handleChartInteraction(state, true)
                                        }
                                        margin={{
                                          top: 10,
                                          right: 10,
                                          left: -20,
                                          bottom: 0,
                                        }}
                                      >
                                        <CartesianGrid
                                          strokeDasharray="3 3"
                                          vertical={false}
                                          stroke="#E5E7EB"
                                        />
                                        <XAxis
                                          dataKey="date"
                                          tick={{
                                            fontSize: 12,
                                            fill: '#6B7280',
                                          }}
                                          tickMargin={8}
                                        />
                                        <YAxis
                                          tick={{
                                            fontSize: 12,
                                            fill: '#6B7280',
                                          }}
                                          tickMargin={8}
                                        />
                                        <Tooltip
                                          content={CompactPriceTooltip}
                                          cursor={{ stroke: '#93C5FD' }}
                                        />
                                        <Line
                                          type="monotone"
                                          dataKey="price"
                                          stroke="#1D4ED8"
                                          strokeWidth={3}
                                          dot={renderChartDot}
                                          activeDot={{ r: 6 }}
                                        />
                                      </LineChart>
                                    </ResponsiveContainer>
                                  </div>
                                </div>
                              ) : (
                                <div className="text-center py-6 text-gray-500 font-bold border border-dashed rounded-lg border-gray-200 bg-gray-50 text-sm">
                                  価格比較グラフは表示できません。
                                </div>
                              )
                            ) : (
                              <div className="text-center py-6 text-gray-400 font-bold border-2 border-dashed rounded-lg border-gray-200 bg-gray-50">
                                表示する商品が選択されていません。
                              </div>
                            )}
                          </div>
                        )}
                    </section>

                    <section className="bg-white border border-gray-200 rounded-xl shadow-sm min-h-[280px] flex flex-col overflow-hidden">
                      <div className="bg-gray-50 px-4 py-3 border-b border-gray-200 shrink-0">
                        <h3 className="font-extrabold text-gray-700 text-sm">
                          対象の購入履歴
                        </h3>
                      </div>

                      {activeRow.hasSearched &&
                        activeRow.results.length === 0 &&
                        !activeRow.isLoading && (
                          <div className="flex-1 flex items-center justify-center text-gray-400 font-bold border-2 border-dashed rounded-lg border-gray-200 bg-gray-50 m-4 text-center text-sm px-4">
                            過去の購入履歴が見つかりませんでした。
                          </div>
                        )}

                      {activeRow.hasSearched &&
                        activeRow.results.length > 0 &&
                        !activeRow.isLoading &&
                        (filteredResults.length > 0 ? (
                          <ul className="divide-y divide-gray-100 flex-1 overflow-y-auto max-h-64">
                            {filteredResults
                              .slice()
                              .reverse()
                              .map((item) => (
                                <li
                                  key={item.id}
                                  ref={(el) => {
                                    historyItemRefs.current[item.id] = el
                                  }}
                                  className={`p-3 transition-colors flex justify-between items-center gap-2 ${
                                    highlightedItemId === item.id
                                      ? 'bg-blue-50 ring-2 ring-inset ring-blue-300'
                                      : 'hover:bg-gray-50'
                                  }`}
                                >
                                  <div className="flex flex-col min-w-0">
                                    <span className="text-xs font-bold text-gray-500 truncate">
                                      {item.receipts.date} |{' '}
                                      {item.receipts.store_name}
                                    </span>
                                    <span className="text-sm font-extrabold text-gray-800 truncate">
                                      {item.item_name}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2 shrink-0">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        onOpenHistory({
                                          receiptId: item.receipt_id,
                                          receiptDate: item.receipts.date,
                                          itemName: item.item_name,
                                        })
                                      }
                                      className="text-xs font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2.5 py-1 rounded-md hover:bg-blue-100 transition-colors"
                                    >
                                      履歴へ
                                    </button>
                                    <div className="text-base font-extrabold text-gray-800 text-right">
                                      ¥{item.price.toLocaleString()}
                                    </div>
                                  </div>
                                </li>
                              ))}
                          </ul>
                        ) : (
                          <div className="flex-1 flex items-center justify-center text-gray-400 font-bold border-2 border-dashed rounded-lg border-gray-200 bg-gray-50 m-4 text-center text-sm px-4">
                            表示する商品が選択されていません。
                          </div>
                        ))}
                    </section>
                  </div>
                )}
              </React.Fragment>
            ))}
          </div>
        </section>

        {isDesktopLayout && (
          <>
            <section className="bg-white border border-gray-200 rounded-xl shadow-sm p-4 sm:p-5 lg:p-6 min-h-[280px]">
              {!activeRow && (
                <div className="h-full flex items-center justify-center text-gray-400 font-bold border-2 border-dashed rounded-xl border-gray-300 bg-gray-50 text-sm lg:text-base">
                  左側からメモを選択してください。
                </div>
              )}

              {activeRow && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-lg lg:text-xl font-extrabold text-gray-800">
                      メモ詳細
                    </h3>
                    <p className="text-xs lg:text-sm text-gray-500 mt-1">
                      入力のたびに自動で検索し、内容を自動保存します。
                    </p>
                  </div>

                  {activeRow.hasSearched &&
                    activeRow.results.length === 0 &&
                    !activeRow.isLoading && (
                      <div className="text-center py-6 text-gray-400 font-bold border-2 border-dashed rounded-lg border-gray-200 bg-gray-50">
                        過去の購入履歴が見つかりませんでした。
                      </div>
                    )}

                  {activeRow.hasSearched &&
                    activeRow.results.length > 0 &&
                    !activeRow.isLoading && (
                      <div className="space-y-4">
                        <div className="flex flex-wrap gap-2 bg-gray-50 p-3 rounded-lg border border-gray-100">
                          <span className="text-xs lg:text-sm font-bold text-gray-500 w-full mb-1">
                            表示する商品を選択:
                          </span>
                          {uniqueItemNames.map((name) => {
                            const isExcluded =
                              activeRow.excludedItemNames.includes(name)
                            return (
                              <button
                                key={name}
                                onClick={() =>
                                  toggleExclude(activeRow.id, name)
                                }
                                className={`px-3 py-1 text-xs lg:text-sm font-bold rounded-full transition-colors border ${
                                  isExcluded
                                    ? 'bg-white text-gray-400 border-gray-300 hover:bg-gray-100'
                                    : 'bg-blue-100 text-blue-700 border-blue-200 hover:bg-blue-200'
                                }`}
                              >
                                {isExcluded ? '＋' : '✓'} {name}
                              </button>
                            )
                          })}
                        </div>

                        {filteredResults.length > 0 ? (
                          isComparable ? (
                            <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 shadow-sm">
                              <div className="grid grid-cols-2 gap-4 mb-4">
                                <div className="bg-white p-3 rounded-lg shadow-sm text-center border border-gray-100">
                                  <div className="text-xs lg:text-sm font-bold text-gray-500 mb-1">
                                    最安値
                                  </div>
                                  <div className="text-xl lg:text-2xl font-extrabold text-blue-700">
                                    ¥{minPrice.toLocaleString()}
                                  </div>
                                </div>
                                <div className="bg-white p-3 rounded-lg shadow-sm text-center border border-gray-100">
                                  <div className="text-xs lg:text-sm font-bold text-gray-500 mb-1">
                                    平均価格
                                  </div>
                                  <div className="text-xl lg:text-2xl font-extrabold text-gray-800">
                                    ¥{avgPrice.toLocaleString()}
                                  </div>
                                </div>
                              </div>

                              <div
                                className="h-[220px] lg:h-[300px] bg-white p-3 rounded-lg shadow-sm border border-gray-100 [&_*:focus]:outline-none [&_*:focus-visible]:outline-none"
                                onMouseLeave={() => setHighlightedItemId(null)}
                              >
                                <ResponsiveContainer width="100%" height="100%">
                                  <LineChart
                                    data={chartData}
                                    onMouseMove={(state) =>
                                      handleChartInteraction(state, false)
                                    }
                                    onClick={(state) =>
                                      handleChartInteraction(state, true)
                                    }
                                    margin={{
                                      top: 10,
                                      right: 10,
                                      left: -20,
                                      bottom: 0,
                                    }}
                                  >
                                    <CartesianGrid
                                      strokeDasharray="3 3"
                                      vertical={false}
                                      stroke="#E5E7EB"
                                    />
                                    <XAxis
                                      dataKey="date"
                                      tick={{ fontSize: 12, fill: '#6B7280' }}
                                      tickMargin={8}
                                    />
                                    <YAxis
                                      tick={{ fontSize: 12, fill: '#6B7280' }}
                                      tickMargin={8}
                                    />
                                    <Tooltip
                                      content={CompactPriceTooltip}
                                      cursor={{ stroke: '#93C5FD' }}
                                    />
                                    <Line
                                      type="monotone"
                                      dataKey="price"
                                      stroke="#1D4ED8"
                                      strokeWidth={3}
                                      dot={renderChartDot}
                                      activeDot={{ r: 6 }}
                                    />
                                  </LineChart>
                                </ResponsiveContainer>
                              </div>
                            </div>
                          ) : (
                            <div className="text-center py-6 text-gray-500 font-bold border border-dashed rounded-lg border-gray-200 bg-gray-50 text-sm lg:text-base">
                              価格比較グラフは表示できません。
                            </div>
                          )
                        ) : (
                          <div className="text-center py-6 text-gray-400 font-bold border-2 border-dashed rounded-lg border-gray-200 bg-gray-50">
                            表示する商品が選択されていません。
                          </div>
                        )}
                      </div>
                    )}
                </div>
              )}
            </section>

            <section className="bg-white border border-gray-200 rounded-xl shadow-sm min-h-[280px] flex flex-col overflow-hidden">
              <div className="bg-gray-50 px-4 py-3 lg:px-5 lg:py-4 border-b border-gray-200 shrink-0">
                <h3 className="font-extrabold text-gray-700 text-sm lg:text-base">
                  対象の購入履歴
                </h3>
              </div>

              {activeRow &&
                activeRow.hasSearched &&
                activeRow.results.length === 0 &&
                !activeRow.isLoading && (
                  <div className="flex-1 flex items-center justify-center text-gray-400 font-bold border-2 border-dashed rounded-lg border-gray-200 bg-gray-50 m-4 text-center text-sm px-4">
                    過去の購入履歴が見つかりませんでした。
                  </div>
                )}

              {activeRow &&
                activeRow.hasSearched &&
                activeRow.results.length > 0 &&
                !activeRow.isLoading &&
                (filteredResults.length > 0 ? (
                  <ul className="divide-y divide-gray-100 flex-1 overflow-y-auto max-h-64 lg:max-h-none">
                    {filteredResults
                      .slice()
                      .reverse()
                      .map((item) => (
                        <li
                          key={item.id}
                          ref={(el) => {
                            historyItemRefs.current[item.id] = el
                          }}
                          className={`p-3 lg:p-4 transition-colors flex justify-between items-center gap-2 ${
                            highlightedItemId === item.id
                              ? 'bg-blue-50 ring-2 ring-inset ring-blue-300'
                              : 'hover:bg-gray-50'
                          }`}
                        >
                          <div className="flex flex-col min-w-0">
                            <span className="text-xs lg:text-sm font-bold text-gray-500 truncate">
                              {item.receipts.date} | {item.receipts.store_name}
                            </span>
                            <span className="text-sm lg:text-base font-extrabold text-gray-800 truncate">
                              {item.item_name}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() =>
                                onOpenHistory({
                                  receiptId: item.receipt_id,
                                  receiptDate: item.receipts.date,
                                  itemName: item.item_name,
                                })
                              }
                              className="text-xs lg:text-sm font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2.5 py-1 lg:px-3 lg:py-1.5 rounded-md hover:bg-blue-100 transition-colors"
                            >
                              履歴へ
                            </button>
                            <div className="text-base lg:text-lg font-extrabold text-gray-800 text-right">
                              ¥{item.price.toLocaleString()}
                            </div>
                          </div>
                        </li>
                      ))}
                  </ul>
                ) : (
                  <div className="flex-1 flex items-center justify-center text-gray-400 font-bold border-2 border-dashed rounded-lg border-gray-200 bg-gray-50 m-4 text-center text-sm px-4">
                    表示する商品が選択されていません。
                  </div>
                ))}
            </section>
          </>
        )}
      </div>
    </div>
  )
}
