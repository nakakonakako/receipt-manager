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
}

const toRowState = (row: MemoRowRecord): MemoRowState => ({
  id: row.id,
  query: row.query,
  sortOrder: row.sort_order,
  results: [],
  excludedItemNames: [],
  isLoading: false,
  hasSearched: false,
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
    const headers = await getHeaders()
    if (!headers) return
    try {
      const row = await createMemoRow(
        { query: '', sortOrder: rows.length },
        headers
      )
      const nextRow = toRowState(row)
      setRows((prev) => [...prev, nextRow])
      setActiveRowId(nextRow.id)
    } catch (error) {
      console.error('メモ作成エラー:', error)
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

    const headers = await getHeaders()
    if (!headers) return
    try {
      await deleteMemoRow(id, headers)
      setRows((prev) => {
        const next = prev
          .filter((row) => row.id !== id)
          .map((row, index) => ({ ...row, sortOrder: index }))
        if (next.length > 0 && activeRowId === id) {
          setActiveRowId(next[0].id)
        }
        if (next.length === 0) {
          setActiveRowId(null)
        }
        return next
      })
    } catch (error) {
      console.error('メモ削除エラー:', error)
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
        const savedRows = await fetchMemoRows(headers)
        if (savedRows.length === 0) {
          const createdRow = await createMemoRow(
            { query: '', sortOrder: 0 },
            headers
          )
          const nextRow = toRowState(createdRow)
          setRows([nextRow])
          setActiveRowId(nextRow.id)
        } else {
          const mappedRows = savedRows.map(toRowState)
          setRows(mappedRows)
          setActiveRowId(mappedRows[0].id)
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

  const filteredResults =
    activeRow?.results.filter(
      (item) => !activeRow.excludedItemNames.includes(item.item_name)
    ) ?? []
  const uniqueItemNames = activeRow
    ? Array.from(new Set(activeRow.results.map((item) => item.item_name)))
    : []
  const isComparable = filteredResults.some((item) => item.is_comparable)
  const chartData = filteredResults.map((item) => ({
    date: item.receipts.date,
    price: item.price,
    store: item.receipts.store_name,
    name: item.item_name,
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

  return (
    <div className="bg-gray-50 rounded-xl min-h-[620px] flex flex-col w-full max-w-none p-4 sm:p-6">
      <div className="flex justify-between items-center border-b border-gray-200 pb-3 mb-6">
        <h2 className="text-xl font-bold text-gray-800">スマート買い物メモ</h2>
        <Button
          variant="primary"
          onClick={handleAddRow}
          className="px-4 font-bold shadow-sm"
        >
          ＋ メモを追加
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4 flex-1 min-h-0">
        <section className="bg-white border border-gray-200 rounded-xl shadow-sm p-3 sm:p-4 min-h-[280px]">
          <h3 className="text-sm font-bold text-gray-700 mb-3">メモ一覧</h3>
          <div className="space-y-2.5 max-h-[65vh] overflow-y-auto pr-1">
            {isBootstrapping && (
              <div className="text-center py-10 text-gray-400 font-bold border-2 border-dashed rounded-xl border-gray-300 bg-gray-50">
                読み込み中...
              </div>
            )}
            {!isBootstrapping && rows.length === 0 && (
              <div className="text-center py-10 text-gray-400 font-bold border-2 border-dashed rounded-xl border-gray-300 bg-gray-50">
                「＋ メモを追加」でメモを作成してください。
              </div>
            )}
            {rows.map((row, index) => (
              <div
                key={row.id}
                onClick={() => setActiveRowId(row.id)}
                className={`w-full text-left border rounded-xl p-3 transition cursor-pointer ${
                  activeRowId === row.id
                    ? 'border-blue-300 bg-blue-50/70'
                    : 'border-gray-200 bg-white hover:bg-gray-50'
                }`}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <span className="text-xs font-bold text-gray-600">
                    メモ {index + 1}
                  </span>
                  <Button
                    variant="danger"
                    onClick={(e) => {
                      e.stopPropagation()
                      void handleRemoveRow(row.id)
                    }}
                    className="px-2 py-1 text-[11px] font-bold"
                  >
                    削除
                  </Button>
                </div>
                <Input
                  type="text"
                  placeholder="商品名を入力 (例: ねぎ 白)"
                  value={row.query}
                  onChange={(e) => handleQueryChange(row.id, e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  className="w-full text-sm py-1.5"
                />
                <div className="mt-2 text-[11px] text-gray-500 font-medium">
                  {row.isLoading
                    ? '検索中...'
                    : row.hasSearched
                      ? `${row.results.length} 件`
                      : 'キーワード待ち'}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-white border border-gray-200 rounded-xl shadow-sm p-4 sm:p-5 min-h-[280px]">
          {!activeRow && (
            <div className="h-full flex items-center justify-center text-gray-400 font-bold border-2 border-dashed rounded-xl border-gray-300 bg-gray-50">
              左側からメモを選択してください。
            </div>
          )}

          {activeRow && (
            <div className="space-y-4">
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
                  <div className="text-center py-6 text-gray-400 font-bold border-2 border-dashed rounded-lg border-gray-200 bg-gray-50">
                    過去の購入履歴が見つかりませんでした。
                  </div>
                )}

              {activeRow.hasSearched &&
                activeRow.results.length > 0 &&
                !activeRow.isLoading && (
                  <div className="space-y-4">
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
                            onClick={() => toggleExclude(activeRow.id, name)}
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
                      <div className="space-y-4">
                        {isComparable && (
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

                            <div className="h-[220px] bg-white p-3 rounded-lg shadow-sm border border-gray-100">
                              <ResponsiveContainer width="100%" height="100%">
                                <LineChart
                                  data={chartData}
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
                                    tick={{ fontSize: 10, fill: '#6B7280' }}
                                    tickMargin={8}
                                  />
                                  <YAxis
                                    tick={{ fontSize: 10, fill: '#6B7280' }}
                                    tickMargin={8}
                                  />
                                  <Tooltip
                                    contentStyle={{
                                      borderRadius: '8px',
                                      border: 'none',
                                      boxShadow:
                                        '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                                    }}
                                    labelStyle={{
                                      fontWeight: 'bold',
                                      color: '#374151',
                                      marginBottom: '4px',
                                    }}
                                    formatter={(
                                      value:
                                        | number
                                        | string
                                        | readonly (number | string)[]
                                        | undefined,
                                      _name: string | number | undefined,
                                      props: {
                                        payload?: { [key: string]: unknown }
                                      }
                                    ) => {
                                      const numericValue =
                                        typeof value === 'number'
                                          ? value
                                          : Number(value || 0)
                                      const storeName = props.payload?.store
                                        ? String(props.payload.store)
                                        : ''
                                      const itemName = props.payload?.name
                                        ? String(props.payload.name)
                                        : ''
                                      return [
                                        `¥${numericValue.toLocaleString()} (${storeName} / ${itemName})`,
                                        '価格',
                                      ]
                                    }}
                                  />
                                  <Line
                                    type="monotone"
                                    dataKey="price"
                                    stroke="#1D4ED8"
                                    strokeWidth={3}
                                    dot={{
                                      r: 4,
                                      fill: '#1D4ED8',
                                      strokeWidth: 2,
                                      stroke: '#fff',
                                    }}
                                    activeDot={{ r: 6 }}
                                  />
                                </LineChart>
                              </ResponsiveContainer>
                            </div>
                          </div>
                        )}

                        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                          <div className="bg-gray-50 px-3 py-2 border-b border-gray-200">
                            <h3 className="font-extrabold text-gray-700 text-sm">
                              対象の購入履歴
                            </h3>
                          </div>
                          <ul className="divide-y divide-gray-100 max-h-64 overflow-y-auto">
                            {filteredResults
                              .slice()
                              .reverse()
                              .map((item) => (
                                <li
                                  key={item.id}
                                  className="p-3 hover:bg-gray-50 transition-colors flex justify-between items-center gap-2"
                                >
                                  <div className="flex flex-col">
                                    <span className="text-[10px] font-bold text-gray-500">
                                      {item.receipts.date} |{' '}
                                      {item.receipts.store_name}
                                    </span>
                                    <span className="text-sm font-extrabold text-gray-800">
                                      {item.item_name}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-3 shrink-0">
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
                        </div>
                      </div>
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
      </div>
    </div>
  )
}
