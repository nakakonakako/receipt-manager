import React from 'react'
import { NumberInput } from '@/components/ui/NumberInput'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { MAIN_CATEGORIES } from '@/features/receipt/constants/categories'
import {
  formatSearchTagsForInput,
  parseCommaSeparatedTags,
} from '@/features/receipt/utils/searchTags'
import type { HistoryReceipt, HistoryReceiptItem } from '../types'

interface HistoryReceiptItemsProps {
  receiptTarget: HistoryReceipt
  setEditTarget: (target: HistoryReceipt) => void
}

export const HistoryReceiptItems: React.FC<HistoryReceiptItemsProps> = ({
  receiptTarget,
  setEditTarget,
}) => {
  const itemsSum = receiptTarget.receipt_items.reduce(
    (sum, item) => sum + Number(item.price || 0),
    0
  )
  const finalTotal = receiptTarget.total_amount || 0
  const adjustmentAmount = finalTotal > 0 ? finalTotal - itemsSum : 0

  const handleItemChange = <K extends keyof HistoryReceiptItem>(
    index: number,
    field: K,
    value: HistoryReceiptItem[K]
  ) => {
    const newItems = [...receiptTarget.receipt_items]
    newItems[index] = { ...newItems[index], [field]: value }
    setEditTarget({ ...receiptTarget, receipt_items: newItems })
  }

  const handleSearchTagsChange = (index: number, raw: string) => {
    const newItems = [...receiptTarget.receipt_items]
    newItems[index] = {
      ...newItems[index],
      search_tags: parseCommaSeparatedTags(raw),
    }
    setEditTarget({ ...receiptTarget, receipt_items: newItems })
  }

  const handleDeleteItem = (index: number) => {
    const newItems = receiptTarget.receipt_items.filter((_, i) => i !== index)
    setEditTarget({ ...receiptTarget, receipt_items: newItems })
  }

  const handleAddItem = () => {
    setEditTarget({
      ...receiptTarget,
      receipt_items: [
        ...receiptTarget.receipt_items,
        {
          id: '',
          item_name: '',
          price: 0,
          main_category: '食費',
          sub_category: 'その他',
          search_tags: [],
          is_comparable: true,
        },
      ],
    })
  }

  return (
    <div>
      <div className="flex flex-wrap justify-between items-end gap-2 mb-4 border-b border-gray-200 pb-2">
        <div>
          <h3 className="font-extrabold text-gray-700">購入品目</h3>
          <p className="text-[10px] text-gray-500 font-medium mt-0.5">
            大／小分類・検索タグ・相場（商品名の右の
            ON/OFF）を修正できます。相場は既定オンです。
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-sm font-bold text-gray-700 whitespace-nowrap">
            合計金額
          </span>
          <NumberInput
            value={receiptTarget.total_amount}
            onChange={(val) =>
              setEditTarget({
                ...receiptTarget,
                total_amount: val === '' || val === '-' ? 0 : Number(val),
              })
            }
            maxLength={7}
            className="w-[6.75rem] text-right font-extrabold text-lg tabular-nums !py-1.5 !px-2 h-9 bg-gray-50 focus:bg-white border-gray-300 shadow-sm"
          />
          <span className="text-xs font-bold text-gray-400">円</span>
        </div>
      </div>

      <div className="overflow-x-auto border border-gray-200 rounded-lg shadow-sm mb-4">
        <table className="w-full text-left border-collapse">
          <thead className="bg-gray-50">
            <tr>
              <th className="p-3 text-xs font-bold text-gray-600 border-b min-w-[220px]">
                商品名 <span className="text-red-500">*</span>
              </th>
              <th className="p-3 text-xs font-bold text-gray-600 border-b w-[120px] text-center">
                相場グラフ
              </th>
              <th className="p-3 text-xs font-bold text-gray-600 border-b min-w-[120px]">
                大分類
              </th>
              <th className="p-3 text-xs font-bold text-gray-600 border-b min-w-[110px]">
                小分類
              </th>
              <th className="p-3 text-xs font-bold text-gray-600 border-b min-w-[220px]">
                検索タグ
              </th>
              <th className="p-3 text-xs font-bold text-gray-600 border-b w-[120px] text-right">
                金額
              </th>
              <th className="p-3 text-xs font-bold text-gray-600 border-b w-[72px] text-center">
                削除
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {receiptTarget.receipt_items.map((item, index) => (
              <tr key={item.id || `line-${index}`} className="hover:bg-gray-50">
                <td className="p-2">
                  <Input
                    value={item.item_name}
                    onChange={(e) =>
                      handleItemChange(index, 'item_name', e.target.value)
                    }
                    placeholder="商品名"
                    className="w-full border-gray-200"
                  />
                </td>
                <td className="p-2 text-center">
                  <button
                    type="button"
                    onClick={() =>
                      handleItemChange(
                        index,
                        'is_comparable',
                        !(item.is_comparable ?? true)
                      )
                    }
                    className={`h-10 min-w-[92px] px-2 text-xs font-bold rounded-lg border ${
                      (item.is_comparable ?? true)
                        ? 'bg-blue-100 text-blue-800 border-blue-200 hover:bg-blue-200/90'
                        : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    {(item.is_comparable ?? true) ? 'ON' : 'OFF'}
                  </button>
                </td>
                <td className="p-2">
                  <select
                    value={item.main_category ?? 'その他'}
                    onChange={(e) =>
                      handleItemChange(index, 'main_category', e.target.value)
                    }
                    className="h-10 w-full px-2 border border-gray-200 rounded-lg text-sm bg-white"
                  >
                    {MAIN_CATEGORIES.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="p-2">
                  <Input
                    value={item.sub_category ?? ''}
                    onChange={(e) =>
                      handleItemChange(index, 'sub_category', e.target.value)
                    }
                    placeholder="小分類"
                    className="w-full border-gray-200"
                  />
                </td>
                <td className="p-2">
                  <Input
                    value={formatSearchTagsForInput(item.search_tags)}
                    onChange={(e) =>
                      handleSearchTagsChange(index, e.target.value)
                    }
                    placeholder="ねぎ, 青ねぎ"
                    className="w-full border-gray-200"
                  />
                </td>
                <td className="p-2">
                  <NumberInput
                    value={item.price}
                    onChange={(val) =>
                      handleItemChange(
                        index,
                        'price',
                        val === '' || val === '-' ? 0 : Number(val)
                      )
                    }
                    maxLength={7}
                    className="w-full text-right font-bold tabular-nums border-gray-200"
                    placeholder="0"
                  />
                </td>
                <td className="p-2 text-center">
                  <Button
                    variant="danger"
                    onClick={() => handleDeleteItem(index)}
                    className="px-2.5 py-1 text-xs font-bold !bg-white !text-red-600 border border-red-200 hover:!bg-red-50"
                  >
                    ✕
                  </Button>
                </td>
              </tr>
            ))}

            {adjustmentAmount !== 0 && (
              <tr className="bg-gray-50">
                <td
                  colSpan={5}
                  className="p-2 text-sm font-bold text-gray-500 pl-4"
                >
                  🔒 消費税・自動調整額
                </td>
                <td
                  className={`p-2 text-right font-bold pr-4 tabular-nums ${
                    adjustmentAmount < 0 ? 'text-red-500' : 'text-gray-700'
                  }`}
                >
                  {adjustmentAmount > 0 ? '+' : ''}
                  {adjustmentAmount.toLocaleString()} 円
                </td>
                <td className="p-2"></td>
              </tr>
            )}
          </tbody>
        </table>

        {receiptTarget.receipt_items.length === 0 && (
          <div className="text-center py-6 text-gray-400 text-sm font-bold">
            購入品目がありません。下のボタンから追加してください。
          </div>
        )}
      </div>

      <div className="flex justify-start">
        <Button
          variant="icon"
          onClick={handleAddItem}
          className="py-2.5 px-4 shadow-sm"
        >
          ＋ 商品を追加する
        </Button>
      </div>
    </div>
  )
}
