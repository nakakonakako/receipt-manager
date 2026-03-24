import React, { useState } from 'react'
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

export const SmartMemoPage: React.FC = () => {
  const { getHeaders } = useApiConfig()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<MemoSearchResultItem[]>([])
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

  const isComparable = results.some((item) => item.is_comparable)

  const chartData = results.map((item) => ({
    date: item.receipts.date,
    price: item.price,
    store: item.receipts.store_name,
    name: item.item_name,
  }))

  const minPrice =
    results.length > 0 ? Math.min(...results.map((i) => i.price)) : 0
  const avgPrice =
    results.length > 0
      ? results.reduce((sum, i) => sum + i.price, 0) / results.length
      : 0

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 min-h-[600px] flex flex-col max-w-4xl mx-auto">
      <div className="border-b pb-3 mb-6">
        <h2 className="text-xl font-bold text-gray-800">スマート買い物メモ</h2>
      </div>

      <div className="flex gap-3 mb-6">
        <Input
          type="text"
          placeholder="買いたい商品名を入力 (例: キャベツ, コップ)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          className="flex-1 text-lg py-2"
        />
        <Button
          variant="primary"
          onClick={handleSearch}
          disabled={isLoading}
          className="px-6 font-bold"
        >
          {isLoading ? '検索中...' : '検索'}
        </Button>
      </div>

      {!hasSearched && (
        <div className="text-center py-20 text-gray-400 font-bold border-2 border-dashed rounded-xl border-gray-200 bg-gray-50">
          買いたい商品名を入力して検索してください。
        </div>
      )}

      {hasSearched && results.length === 0 && !isLoading && (
        <div className="text-center py-20 text-gray-400 font-bold border-2 border-dashed rounded-xl border-gray-200 bg-gray-50">
          過去の購入履歴が見つかりませんでした。
        </div>
      )}

      {hasSearched && results.length > 0 && !isLoading && (
        <div className="space-y-6">
          {isComparable && (
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-5 shadow-sm">
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="bg-white p-4 rounded-lg shadow-sm text-center border border-gray-100">
                  <div className="text-sm font-bold text-gray-500 mb-1">
                    最安値
                  </div>
                  <div className="text-2xl font-extrabold text-blue-700">
                    ¥{minPrice.toLocaleString()}
                  </div>
                </div>
                <div className="bg-white p-4 rounded-lg shadow-sm text-center border border-gray-100">
                  <div className="text-sm font-bold text-gray-500 mb-1">
                    平均価格
                  </div>
                  <div className="text-2xl font-extrabold text-gray-800">
                    ¥{avgPrice.toLocaleString()}
                  </div>
                </div>
              </div>

              <div className="h-[250px] bg-white p-4 rounded-lg shadow-sm border border-gray-100">
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
                      tick={{ fontSize: 12, fill: '#6B7280' }}
                      tickMargin={10}
                    />
                    <YAxis
                      tick={{ fontSize: 12, fill: '#6B7280' }}
                      tickMargin={10}
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
                        name: string | number | undefined,
                        props: { payload?: { [key: string]: unknown } }
                      ) => {
                        const numericValue =
                          typeof value === 'number' ? value : Number(value || 0)
                        const storeName = props.payload?.store
                          ? String(props.payload.store)
                          : ''
                        return [
                          `¥${numericValue.toLocaleString()} (${storeName})`,
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
            <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
              <h3 className="font-extrabold text-gray-700">購入履歴リスト</h3>
            </div>
            <ul className="divide-y divide-gray-100">
              {results
                .slice()
                .reverse()
                .map((item) => (
                  <li
                    key={item.id}
                    className="p-4 hover:bg-gray-50 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                  >
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-gray-500 mb-1">
                        {item.receipts.date}
                      </span>
                      <span className="text-sm font-extrabold text-gray-800">
                        {item.item_name}
                      </span>
                      <span className="text-xs text-gray-500 mt-1">
                        {item.receipts.store_name}
                      </span>
                    </div>
                    <div className="text-lg font-extrabold text-gray-800 text-right">
                      ¥{item.price.toLocaleString()}
                    </div>
                  </li>
                ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
