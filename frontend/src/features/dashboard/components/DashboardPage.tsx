import React, { useState, useEffect, useEffectEvent, useMemo } from 'react'
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
  const getHeadersForEffect = useEffectEvent(getHeaders)

  useEffect(() => {
    const initLoad = async () => {
      setIsLoading(true)
      const headers = await getHeadersForEffect()
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
      const headers = await getHeadersForEffect()
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
    <div className="rm-card p-4 sm:p-5 min-h-[600px] flex flex-col max-w-4xl mx-auto">
      <div className="flex flex-wrap justify-between items-center gap-3 border-b border-[var(--rm-border-subtle)] pb-3 mb-6">
        <h2 className="text-xl sm:text-2xl font-bold text-[var(--rm-text-primary)]">
          統計ダッシュボード
        </h2>

        {allMonths.length > 0 && (
          <select
            value={currentMonth}
            onChange={(e) => setCurrentMonth(e.target.value)}
            aria-label="対象月"
            className="rm-field max-w-full px-3 py-2 text-sm sm:text-base font-medium hover:border-[var(--rm-text-muted)]"
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
        <div
          role="status"
          aria-label="月のデータを読み込み中"
          className="text-center py-20"
        >
          <span className="w-8 h-8 border-4 border-[var(--rm-receipt)] border-t-transparent rounded-full animate-spin inline-block"></span>
        </div>
      ) : chartData.length === 0 ? (
        <div className="text-center py-20 px-4 text-[var(--rm-text-secondary)] font-semibold border border-dashed rounded-[var(--rm-radius-panel)] border-[var(--rm-border)] bg-[var(--rm-surface-subtle)]">
          この月のデータはありません。
        </div>
      ) : (
        <div className="space-y-8">
          <div className="text-center bg-[var(--rm-surface-muted)] rounded-[var(--rm-radius-panel)] p-5 sm:p-6 border border-[var(--rm-border-subtle)]">
            <p className="text-sm font-semibold text-[var(--rm-text-secondary)] mb-1">
              月間合計支出
            </p>
            <p className="text-2xl sm:text-4xl font-bold tracking-tight tabular-nums whitespace-nowrap text-[var(--rm-text-primary)]">
              ¥{totalAmount.toLocaleString()}
            </p>
          </div>

          <div className="h-[340px] w-full min-w-0 sm:h-[300px]">
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
                    color: 'var(--rm-text-primary)',
                    backgroundColor: 'var(--rm-surface)',
                    border: '1px solid var(--rm-border-subtle)',
                    borderRadius: 'var(--rm-radius-control)',
                    boxShadow: 'var(--rm-shadow-popover)',
                  }}
                  labelStyle={{ color: 'var(--rm-text-secondary)' }}
                  itemStyle={{ color: 'var(--rm-text-primary)', fontWeight: 600 }}
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
                  formatter={(value) => (
                    <span className="text-[var(--rm-text-secondary)]">
                      {value}
                    </span>
                  )}
                  wrapperStyle={{
                    color: 'var(--rm-text-secondary)',
                    fontWeight: 600,
                    fontSize: '12px',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="space-y-2">
            <h3 className="font-bold text-[var(--rm-text-primary)] mb-3 border-b border-[var(--rm-border-subtle)] pb-2">
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
                  className="flex min-w-0 justify-between items-center gap-3 p-3 bg-[var(--rm-surface)] border border-[var(--rm-border-subtle)] rounded-[var(--rm-radius-card)] hover:bg-[var(--rm-surface-subtle)] transition-colors"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <span
                      className="w-3 h-3 shrink-0 rounded-full"
                      style={{
                        backgroundColor:
                          CATEGORY_COLORS[item.name] || '#CBD5E1',
                      }}
                    ></span>
                    <span className="min-w-0 break-words font-semibold text-[var(--rm-text-primary)]">
                      {item.name}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-3 sm:gap-4">
                    <span className="text-[var(--rm-text-secondary)] text-sm font-semibold w-12 text-right tabular-nums">
                      {percentage}%
                    </span>
                    <span className="text-right text-[13px] sm:text-base font-bold tabular-nums whitespace-nowrap text-[var(--rm-text-primary)]">
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
