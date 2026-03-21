import React from 'react'
import { NumberInput } from '@/components/ui/NumberInput'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import type { HistoryReceipt, HistoryReceiptItem } from '../types'

const MAIN_CATEGORIES = [
  '食費',
  '日用品',
  '交通・通信',
  '衣服・美容',
  '趣味・娯楽',
  '医療・健康',
  '住居・家具',
  'その他',
]

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
          item_name: '',
          price: 0,
          main_category: 'その他',
          is_comparable: false,
        } as HistoryReceiptItem,
      ],
    })
  }

  return (
    <div>
      <div className="flex justify-between items-end mb-4 border-b border-gray-200 pb-2">
        <h3 className="font-extrabold text-gray-700">購入品目</h3>
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-gray-700">合計金額:</span>
          <NumberInput
            value={receiptTarget.total_amount}
            onChange={(val) =>
              setEditTarget({
                ...receiptTarget,
                total_amount: val === '' || val === '-' ? 0 : Number(val),
              })
            }
            className="w-32 text-right font-extrabold text-xl !py-1 !px-2 h-9 bg-gray-50 focus:bg-white border-gray-300 shadow-sm"
          />
        </div>
      </div>

      <div className="hidden md:block overflow-x-auto border border-gray-200 rounded-lg shadow-sm mb-4">
        <table className="w-full text-left border-collapse">
          <thead className="bg-gray-50">
            <tr>
              <th className="p-3 text-xs font-bold text-gray-600 border-b min-w-[150px]">
                商品名
              </th>
              <th className="p-3 text-xs font-bold text-gray-600 border-b w-32">
                カテゴリ
              </th>
              <th className="p-3 text-xs font-bold text-gray-600 border-b w-28 text-right">
                金額
              </th>
              <th className="p-3 text-xs font-bold text-gray-600 border-b w-24 text-center">
                相場推移
              </th>
              <th className="p-3 text-xs font-bold text-gray-600 border-b w-16 text-center">
                削除
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {receiptTarget.receipt_items.map((item, index) => (
              <tr key={index} className="hover:bg-gray-50 transition-colors">
                <td className="p-2">
                  <Input
                    value={item.item_name}
                    onChange={(e) =>
                      handleItemChange(index, 'item_name', e.target.value)
                    }
                    className="w-full border-gray-200 font-medium"
                  />
                </td>
                <td className="p-2">
                  <select
                    value={item.main_category || 'その他'}
                    onChange={(e) =>
                      handleItemChange(index, 'main_category', e.target.value)
                    }
                    className="w-full p-2 border border-gray-200 rounded text-sm bg-white"
                  >
                    {MAIN_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
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
                    className="w-full text-right border-gray-200 font-bold"
                  />
                </td>
                <td className="p-2 text-center">
                  <button
                    onClick={() =>
                      handleItemChange(
                        index,
                        'is_comparable',
                        !item.is_comparable
                      )
                    }
                    className={`px-2 py-1.5 text-xs font-bold rounded-md transition-colors w-full ${
                      item.is_comparable
                        ? 'bg-blue-100 text-blue-700 border border-blue-200'
                        : 'bg-gray-100 text-gray-400 border border-gray-200 hover:bg-gray-200'
                    }`}
                  >
                    {item.is_comparable ? '📊 ON' : 'OFF'}
                  </button>
                </td>
                <td className="p-2 text-center">
                  <Button
                    variant="danger"
                    onClick={() => handleDeleteItem(index)}
                    className="px-3 py-1.5"
                  >
                    ✕
                  </Button>
                </td>
              </tr>
            ))}
            {adjustmentAmount !== 0 && (
              <tr className="bg-blue-50">
                <td
                  colSpan={2}
                  className="p-3 text-sm font-bold text-blue-700 pl-4"
                >
                  🔒 消費税・自動調整額
                </td>
                <td
                  className={`p-3 text-right font-bold pr-4 ${adjustmentAmount < 0 ? 'text-red-500' : 'text-gray-800'}`}
                >
                  {adjustmentAmount > 0 ? '+' : ''}
                  {adjustmentAmount.toLocaleString()}
                </td>
                <td colSpan={2}></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="block md:hidden space-y-2.5 mb-4">
        {receiptTarget.receipt_items.map((item, index) => (
          <div
            key={index}
            className="bg-white border border-gray-200 rounded-xl p-3 shadow-sm relative"
          >
            <div className="flex justify-between items-center mb-2 border-b border-gray-100 pb-2">
              <label className="block text-sm font-bold text-gray-700">
                商品名
              </label>
              <Button
                variant="danger"
                onClick={() => handleDeleteItem(index)}
                className="px-2.5 py-1 text-xs font-bold shadow-sm flex items-center gap-1 !bg-white !text-red-500 border border-red-200 hover:!bg-red-50"
              >
                ✕ 削除
              </Button>
            </div>
            <div className="mb-2.5">
              <Input
                value={item.item_name}
                onChange={(e) =>
                  handleItemChange(index, 'item_name', e.target.value)
                }
                className="w-full text-base py-1.5 border-gray-300 font-medium"
              />
            </div>
            <div className="flex flex-col gap-2 bg-gray-50 p-2.5 rounded-lg border border-gray-200">
              <div className="flex justify-between items-center">
                <select
                  value={item.main_category || 'その他'}
                  onChange={(e) =>
                    handleItemChange(index, 'main_category', e.target.value)
                  }
                  className="p-1.5 border border-gray-300 rounded text-sm bg-white font-medium shadow-sm flex-1 mr-3"
                >
                  {MAIN_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
                <NumberInput
                  value={item.price}
                  onChange={(val) =>
                    handleItemChange(
                      index,
                      'price',
                      val === '' || val === '-' ? 0 : Number(val)
                    )
                  }
                  className="w-28 text-right text-base py-1.5 font-bold border-gray-300 bg-white shadow-sm"
                />
              </div>
              <div className="flex justify-between items-center pt-1 border-t border-gray-200 mt-1">
                <span className="text-xs font-bold text-gray-500">
                  推移グラフ（買い物メモ用）
                </span>
                <button
                  onClick={() =>
                    handleItemChange(
                      index,
                      'is_comparable',
                      !item.is_comparable
                    )
                  }
                  className={`px-3 py-1 text-xs font-bold rounded-full transition-colors ${
                    item.is_comparable
                      ? 'bg-blue-100 text-blue-700 border border-blue-200'
                      : 'bg-gray-200 text-gray-500 border border-gray-300'
                  }`}
                >
                  {item.is_comparable ? '📊 ON' : 'OFF'}
                </button>
              </div>
            </div>
          </div>
        ))}
        {adjustmentAmount !== 0 && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex justify-between items-center shadow-inner">
            <span className="text-sm font-bold text-blue-700">
              🔒 消費税・調整額
            </span>
            <span
              className={`text-base font-bold pr-1 ${adjustmentAmount < 0 ? 'text-red-500' : 'text-gray-800'}`}
            >
              {adjustmentAmount > 0 ? '+' : ''}
              {adjustmentAmount.toLocaleString()}
            </span>
          </div>
        )}
      </div>

      {receiptTarget.receipt_items.length === 0 && (
        <div className="text-center py-6 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300 text-gray-400 text-sm font-bold mb-4">
          購入品目がありません。
        </div>
      )}

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
