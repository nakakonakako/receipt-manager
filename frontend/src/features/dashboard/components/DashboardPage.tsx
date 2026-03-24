import React, { useState, useEffect, useMemo } from 'react'
import { PieChart, Pie, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { useApiConfig } from '@/hooks/useApiConfig'
import {
  fetchAvailableMonths,
  fetchTransactions,
} from '@/features/history/api/historyApi'
import type {
  HistoryReceipt,
  HistoryCsvTransaction,
} from '@/features/history/types'

const CATEGORY_COLORS: { [key: string]: string } = {
  食費: '#EF4444',
  日用品: '#3B82F6',
  '交通・通信': '#F59E0B',
  '衣服・美容': '#8B5CF6',
  '趣味・娯楽': '#EC4899',
  '医療・健康': '#10B981',
  '住居・家具': '#F97316',
  その他: '#6B7280',
  '消費税・調整額': '#94A3B8',
  'キャッシュレス（未分類）': '#14B8A6',
}

export const DashboardPage: React.FC = () => {
  const { getHeaders } = useApiConfig()
  const [allMonths, setAllMonths] = useState<string[]>([])
  const [currentMonth, setCurrentMonth] = useState<string>('')
  const [receipts, setReceipts] = useState<HistoryReceipt[]>([])
  const [csvData, setCsvData] = useState<HistoryCsvTransaction[]>([])
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    const initLoad = async () => {
      setIsLoading(true)
      const headers = await getHeaders()
      if (headers) {
        try {
          const monthsData = await fetchAvailableMonths(headers)
          const mergedMonths = Array.from(
            new Set([...monthsData.receipts, ...monthsData.csv])
          )
            .sort()
            .reverse()

          setAllMonths(mergedMonths)

          if (mergedMonths.length > 0) {
            setCurrentMonth(mergedMonths[0])
          }
        } catch (error) {
          console.error('月の取得に失敗しました', error)
        }
      }
      setIsLoading(false)
    }
    initLoad()
  }, [])

  useEffect(() => {
    const loadTransactions = async () => {
      if (!currentMonth) return
      setIsLoading(true)
      const headers = await getHeaders()
      if (headers) {
        try {
          const data = await fetchTransactions(currentMonth, headers)
          setReceipts(data.receipts || [])
          setCsvData(data.csv_transactions || [])
        } catch (error) {
          console.error('データの取得に失敗しました', error)
        }
      }
      setIsLoading(false)
    }
    loadTransactions()
  }, [currentMonth])

  const chartData = useMemo(() => {
    const categoryMap: Record<string, number> = {}

    receipts.forEach((receipt) => {
      let itemsSum = 0
      receipt.receipt_items.forEach((item) => {
        const cat = item.main_category || 'その他'
        categoryMap[cat] = (categoryMap[cat] || 0) + item.price
        itemsSum += item.price
      })

      const adjustment = receipt.total_amount - itemsSum
      if (adjustment !== 0) {
        categoryMap['消費税・調整額'] =
          (categoryMap['消費税・調整額'] || 0) + adjustment
      }
    })

    csvData.forEach((csv) => {
      categoryMap['キャッシュレス（未分類）'] =
        (categoryMap['キャッシュレス（未分類）'] || 0) + csv.price
    })

    return Object.entries(categoryMap)
      .map(([name, value]) => ({
        name,
        value,
        fill: CATEGORY_COLORS[name] || '#CBD5E1',
      }))
      .sort((a, b) => b.value - a.value)
  }, [receipts, csvData])

  const totalAmount = chartData.reduce((sum, item) => sum + item.value, 0)

  if (isLoading && allMonths.length === 0) {
    return (
      <div className="text-center py-20 text-gray-500 font-bold flex flex-col items-center gap-3">
        <span className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></span>
        データを読み込み中...
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 min-h-[600px] flex flex-col max-w-4xl mx-auto">
      <div className="flex justify-between items-center border-b pb-3 mb-6">
        <h2 className="text-xl font-bold text-gray-800">統計ダッシュボード</h2>

        {allMonths.length > 0 && (
          <select
            value={currentMonth}
            onChange={(e) => setCurrentMonth(e.target.value)}
            className="p-2 border border-gray-300 rounded-lg bg-gray-50 font-bold text-gray-700 outline-none focus:ring-2 focus:ring-blue-500"
          >
            {allMonths.map((m) => {
              const [y, mo] = m.split('-')
              return (
                <option key={m} value={m}>
                  {`${y}年 ${parseInt(mo)}月`}
                </option>
              )
            })}
          </select>
        )}
      </div>

      {isLoading ? (
        <div className="text-center py-20">
          <span className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin inline-block"></span>
        </div>
      ) : chartData.length === 0 ? (
        <div className="text-center py-20 text-gray-400 font-bold border-2 border-dashed rounded-xl border-gray-200 bg-gray-50">
          この月のデータはありません。
        </div>
      ) : (
        <div className="space-y-8">
          <div className="text-center bg-gray-50 rounded-xl p-6 border border-gray-100">
            <p className="text-sm font-bold text-gray-500 mb-1">月間合計支出</p>
            <p className="text-4xl font-extrabold text-gray-800">
              ¥{totalAmount.toLocaleString()}
            </p>
          </div>

          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  innerRadius={70}
                  outerRadius={110}
                  paddingAngle={2}
                  dataKey="value"
                />
                <Tooltip
                  contentStyle={{
                    borderRadius: '8px',
                    border: 'none',
                    boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                  }}
                  itemStyle={{ fontWeight: 'bold' }}
                  formatter={(
                    value:
                      | number
                      | string
                      | readonly (number | string)[]
                      | undefined
                  ) => {
                    const numericValue =
                      typeof value === 'number' ? value : Number(value || 0)
                    return [`¥${numericValue.toLocaleString()}`, '金額']
                  }}
                />
                <Legend
                  wrapperStyle={{ fontWeight: 'bold', fontSize: '12px' }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="space-y-2">
            <h3 className="font-extrabold text-gray-700 mb-3 border-b pb-2">
              カテゴリ別内訳
            </h3>
            {chartData.map((item) => {
              const percentage =
                totalAmount > 0
                  ? ((item.value / totalAmount) * 100).toFixed(1)
                  : '0.0'
              return (
                <div
                  key={item.name}
                  className="flex justify-between items-center p-3 bg-white border border-gray-100 shadow-sm rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className="w-3 h-3 rounded-full"
                      style={{
                        backgroundColor:
                          CATEGORY_COLORS[item.name] || '#CBD5E1',
                      }}
                    ></span>
                    <span className="font-bold text-gray-700">{item.name}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-gray-500 text-sm font-bold w-12 text-right">
                      {percentage}%
                    </span>
                    <span className="font-extrabold text-gray-800 w-24 text-right">
                      ¥{item.value.toLocaleString()}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
