import React from 'react'
import { NumberInput } from '@/components/ui/NumberInput'
import { Button } from '@/components/ui/Button'
import { ReceiptItemEditorCard } from '@/features/receipt/components/ReceiptItemEditorCard'
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

      <div className="space-y-2.5 mb-4">
        {receiptTarget.receipt_items.map((item, index) => (
          <ReceiptItemEditorCard
            key={item.id || `line-${index}`}
            lineNumber={index + 1}
            itemName={item.item_name}
            price={item.price}
            mainCategory={item.main_category ?? 'その他'}
            subCategory={item.sub_category ?? ''}
            onMainCategoryChange={(v) =>
              handleItemChange(index, 'main_category', v)
            }
            onSubCategoryChange={(v) =>
              handleItemChange(index, 'sub_category', v)
            }
            searchTagsDisplay={formatSearchTagsForInput(item.search_tags)}
            isComparable={item.is_comparable ?? true}
            onItemNameChange={(v: string) =>
              handleItemChange(index, 'item_name', v)
            }
            onSearchTagsChange={(v: string) => handleSearchTagsChange(index, v)}
            onPriceChange={(val: number | string) =>
              handleItemChange(
                index,
                'price',
                val === '' || val === '-' ? 0 : Number(val)
              )
            }
            onComparableToggle={() =>
              handleItemChange(
                index,
                'is_comparable',
                !(item.is_comparable ?? true)
              )
            }
            onDelete={() => handleDeleteItem(index)}
          />
        ))}

        {adjustmentAmount !== 0 && (
          <div className="flex flex-wrap justify-between items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm">
            <span className="font-bold text-blue-800">
              🔒 消費税・自動調整額
            </span>
            <span
              className={`font-extrabold tabular-nums ${adjustmentAmount < 0 ? 'text-red-500' : 'text-gray-800'}`}
            >
              {adjustmentAmount > 0 ? '+' : ''}
              {adjustmentAmount.toLocaleString()} 円
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
