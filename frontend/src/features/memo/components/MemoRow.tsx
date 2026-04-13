import React, { useState, useMemo } from 'react'
import { searchMemoItems } from '../api/memoApi'
import type { MemoSearchResultItem } from '../types'
import { useApiConfig } from '@/hooks/useApiConfig'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'

interface MemoRowProps {
  onRemove: () => void
}

export const MemoRow: React.FC<MemoRowProps> = ({ onRemove }) => {
  const { getHeaders } = useApiConfig()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<MemoSearchResultItem[]>([])
  const [excludedItemNames, setExcludedItemNames] = useState<Set<string>>(
    new Set()
  )
  const [isLoading, setIsLoading] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)

  const handleSearch = async () => {
    if (!query.trim()) return
    setIsLoading(true)
    setHasSearched(true)
    const headers = await getHeaders()
    if (headers) {
      try {
        const data = await searchMemoItems(query, headers)
        const sortedData = data.sort((a, b) =>
          a.receipts.date.localeCompare(b.receipts.date)
        )
        setResults(sortedData)
        setExcludedItemNames(new Set())
      } catch (error) {
        console.error('検索エラー:', error)
      }
    }
    setIsLoading(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSearch()
    }
  }

  const toggleExclude = (itemName: string) => {
    setExcludedItemNames((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(itemName)) {
        newSet.delete(itemName)
      } else {
        newSet.add(itemName)
      }
      return newSet
    })
  }

  const filteredResults = useMemo(() => {
    return results.filter((item) => !excludedItemNames.has(item.item_name))
  }, [results, excludedItemNames])

  const uniqueItemNames = useMemo(() => {
    return Array.from(new Set(results.map((item) => item.item_name)))
  }, [results])

  const isComparable = filteredResults.some((item) => item.is_comparable)

  const chartData = useMemo(() => {
    return filteredResults.map((item) => ({
      date: item.receipts.date,
      price: item.price,
      store: item.receipts.store_name,
      name: item.item_name,
    }))
  }, [filteredResults])

  const minPrice =
    filteredResults.length > 0
      ? Math.min(...filteredResults.map((i) => i.price))
      : 0

  const avgPrice =
    filteredResults.length > 0
      ? Math.round(
          filteredResults.reduce((sum, i) => sum + i.price, 0) /
            filteredResults.length
        )
      : 0

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm mb-4 relative">
      <div className="flex flex-wrap gap-2 sm:gap-3 mb-4 items-center">
        <Input
          type="text"
          placeholder="商品名を入力 (例: ねぎ 白)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          className="flex-1 min-w-0 text-base py-1.5"
        />
        <div className="flex gap-2 shrink-0 items-stretch sm:items-center">
          <Button
            variant="primary"
            onClick={handleSearch}
            disabled={isLoading}
            className="px-4 font-bold"
          >
            {isLoading ? '検索中...' : '検索'}
          </Button>
          <Button
            variant="danger"
            onClick={onRemove}
            className="px-2 py-1.5 text-xs font-bold"
          >
            ✕ 削除
          </Button>
        </div>
      </div>

      {hasSearched && results.length === 0 && !isLoading && (
        <div className="text-center py-6 text-gray-400 font-bold border-2 border-dashed rounded-lg border-gray-200 bg-gray-50">
          過去の購入履歴が見つかりませんでした。
        </div>
      )}

      {hasSearched && results.length > 0 && !isLoading && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2 bg-gray-50 p-3 rounded-lg border border-gray-100">
            <span className="text-xs font-bold text-gray-500 w-full mb-1">
              表示する商品を選択:
            </span>
            {uniqueItemNames.map((name) => {
              const isExcluded = excludedItemNames.has(name)
              return (
                <button
                  key={name}
                  onClick={() => toggleExclude(name)}
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

                  <div className="h-[200px] bg-white p-3 rounded-lg shadow-sm border border-gray-100">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart
                        data={chartData}
                        margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
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
                            boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
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
                            props: { payload?: { [key: string]: unknown } }
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
                <ul className="divide-y divide-gray-100 max-h-40 overflow-y-auto">
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
                            {item.receipts.date} | {item.receipts.store_name}
                          </span>
                          <span className="text-sm font-extrabold text-gray-800">
                            {item.item_name}
                          </span>
                        </div>
                        <div className="text-base font-extrabold text-gray-800 text-right">
                          ¥{item.price.toLocaleString()}
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
  )
}
