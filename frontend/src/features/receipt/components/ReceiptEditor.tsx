import React, { useState } from 'react'
import {
  type Receipt,
  type ReceiptItem,
  type ReceiptEditorProps,
  type EditingItem,
} from '../types'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { DateInput } from '@/components/ui/DateInput'
import { NumberInput } from '@/components/ui/NumberInput'
import { getReceiptAdjustment, getReceiptTotal, updateReceiptTotal } from '../utils/receiptTotal'
import { emptyLineItem, toSavedItem } from '../utils/receiptItems'

function normalizeEditingItem(item: ReceiptItem): EditingItem {
  return {
    ...item,
    price: item.price,
    main_category: item.main_category ?? 'その他',
    sub_category: item.sub_category ?? 'その他',
    search_tags: item.search_tags ?? [],
  }
}

export const ReceiptEditor: React.FC<ReceiptEditorProps> = ({
  initialData,
  mode = 'ocr',
  onSave,
  onCancel,
}) => {
  const [date, setDate] = useState(initialData.purchase_date || '')
  const [store, setStore] = useState(initialData.store_name || '')
  const [items, setItems] = useState<EditingItem[]>(() =>
    (initialData.items || []).map(normalizeEditingItem)
  )
  const [paymentMethod, setPaymentMethod] = useState(
    initialData.payment_method || 'unknown'
  )
  const [isSubmitting, setIsSubmitting] = useState(false)
  // Manual mode stores only the adjustment; OCR mode stores the extracted total.
  const [amount, setAmount] = useState(mode === 'manual' ? 0 : initialData.total_amount || 0)

  const itemsSum = items.reduce((sum, item) => sum + Number(item.price || 0), 0)
  const totalAmount = getReceiptTotal(mode, itemsSum, amount)
  const adjustmentAmount = getReceiptAdjustment(mode, itemsSum, amount)

  const handleItemChange = (
    index: number,
    field: 'item_name' | 'price',
    value: string | number
  ) => {
    const newItems = [...items]
    if (field === 'price') {
      const newValue = value === '' || value === '-' ? '' : Number(value)
      newItems[index] = { ...newItems[index], price: newValue }
    } else {
      newItems[index] = { ...newItems[index], item_name: value as string }
    }
    setItems(newItems)
  }

  const handleDeleteItem = (index: number) => {
    const newItems = items.filter((_, i) => i !== index)
    setItems(newItems)
  }

  const handleAddItem = () => {
    setItems([...items, emptyLineItem()])
  }

  const handleSaveClick = async () => {
    if (!store.trim()) {
      alert('店舗名を入力してください')
      return
    }
    if (items.length === 0) {
      alert('少なくとも1つの購入品目を追加してください')
      return
    }
    const hasEmptyItem = items.some((item) => !item.item_name.trim())
    if (hasEmptyItem) {
      alert('商品名が空欄の項目があります')
      return
    }

    const newItems = items.map(toSavedItem)

    const savedData: Receipt = {
      purchase_date: date,
      store_name: store,
      items: newItems,
      total_amount: totalAmount,
      payment_method: paymentMethod || '',
    }

    setIsSubmitting(true)
    try {
      await onSave(savedData)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="rm-card w-full p-4 sm:p-6">
      <div className="mb-6 border-b border-[var(--rm-border-subtle)] pb-3">
        <h2 className="text-xl font-bold text-[var(--rm-text-primary)]">
          レシート内容の確認・修正
        </h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 mb-8">
        <div className="flex flex-col">
          <label className="mb-1 block text-sm font-semibold text-[var(--rm-text-secondary)]">
            購入日
          </label>
          <DateInput
            aria-label="購入日"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full"
          />
        </div>

        <div className="flex flex-col">
          <label className="mb-1 block text-sm font-semibold text-[var(--rm-text-secondary)]">
            支払い方法
          </label>
          <select
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value)}
            className="rm-field w-full px-3 py-2 focus:border-blue-600"
          >
            <option value="unknown">不明</option>
            <option value="cash">現金</option>
            <option value="cashless">キャッシュレス</option>
          </select>
        </div>

        <div className="md:col-span-2 flex flex-col">
          <label
            htmlFor="store"
            className="mb-1 block text-sm font-semibold text-[var(--rm-text-secondary)]"
          >
            店舗名 <span className="text-red-700 text-xs ml-1">必須</span>
          </label>
          <Input
            id="store"
            value={store}
            onChange={(e) => setStore(e.target.value)}
            placeholder="例: スーパーABC"
            className="w-full"
          />
        </div>
      </div>

      <div>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3 border-b border-[var(--rm-border-subtle)] pb-2">
          <h3 className="font-bold text-[var(--rm-text-primary)]">購入品目</h3>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-[var(--rm-text-secondary)]">合計金額:</span>
          <NumberInput
              aria-label="合計金額"
              value={totalAmount}
              onChange={(val) =>
                setAmount(updateReceiptTotal(mode, itemsSum, val === '' || val === '-' ? 0 : Number(val)))
              }
              className="h-9 w-32 bg-[var(--rm-surface-subtle)] px-2 py-1 text-right text-lg font-bold shadow-sm focus:bg-white"
            />
          </div>
        </div>

        <div className="mb-3 hidden overflow-x-auto rounded-lg border border-[var(--rm-border-subtle)] md:block">
          <table className="w-full text-left border-collapse">
            <thead className="bg-[var(--rm-surface-muted)]">
              <tr>
                <th className="min-w-[200px] border-b border-[var(--rm-border-subtle)] p-3 text-xs font-semibold text-[var(--rm-text-secondary)]">
                  商品名 <span className="text-red-700">*</span>
                </th>
                <th className="w-32 border-b border-[var(--rm-border-subtle)] p-3 text-right text-xs font-semibold text-[var(--rm-text-secondary)]">
                  金額
                </th>
                <th className="w-16 border-b border-[var(--rm-border-subtle)] p-3 text-center text-xs font-semibold text-[var(--rm-text-secondary)]">
                  削除
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--rm-border-subtle)] bg-[var(--rm-surface)]">
              {items.map((item, index) => (
                <tr key={index} className="transition-colors hover:bg-[var(--rm-surface-subtle)]">
                  <td className="p-2">
                    <Input
                      value={item.item_name}
                      onChange={(e) =>
                        handleItemChange(index, 'item_name', e.target.value)
                      }
                      placeholder="商品名を入力"
                      className="w-full"
                    />
                  </td>
                  <td className="p-2">
                    <NumberInput
                      value={item.price}
                      onChange={(value) =>
                        handleItemChange(index, 'price', value)
                      }
                      className="w-full text-right"
                      placeholder="0"
                    />
                  </td>
                  <td className="p-2 text-center">
                    <Button
                      variant="danger"
                      onClick={() => handleDeleteItem(index)}
                      className="px-3"
                    >
                      ✕
                    </Button>
                  </td>
                </tr>
              ))}

              {adjustmentAmount !== 0 && (
                <tr className="bg-[var(--rm-surface-muted)]">
                  <td className="p-2 text-sm font-bold text-[var(--rm-text-muted)] pl-4">
                    🔒 消費税・自動調整額
                  </td>
                  <td
                    className={`p-2 pr-4 text-right font-bold ${adjustmentAmount < 0 ? 'text-[var(--rm-danger)]' : 'text-[var(--rm-text-secondary)]'}`}
                  >
                    {adjustmentAmount > 0 ? '+' : ''}
                    {adjustmentAmount.toLocaleString()}
                  </td>
                  <td className="p-2 text-center"></td>
                </tr>
              )}
            </tbody>
          </table>

          {items.length === 0 && (
            <div className="py-6 text-center text-sm text-[var(--rm-text-muted)]">
              購入品目がありません。下のボタンから追加してください。
            </div>
          )}
        </div>

        <div className="block md:hidden space-y-2.5 mb-4">
          {items.map((item, index) => (
            <div
              key={index}
              className="relative rounded-lg border border-[var(--rm-border-subtle)] bg-[var(--rm-surface)] p-3 shadow-sm transition-shadow"
            >
              <div className="mb-2 flex items-center justify-between border-b border-[var(--rm-border-subtle)] pb-2">
                <label className="block text-sm font-semibold text-[var(--rm-text-secondary)]">
                  商品名 <span className="text-red-700">*</span>
                </label>

                <Button
                  variant="danger"
                  onClick={() => handleDeleteItem(index)}
                  className="flex items-center gap-1 border border-red-200 bg-white px-2.5 py-1 text-xs font-bold text-red-700 shadow-sm hover:bg-red-50"
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
                  placeholder="商品名"
                  className="w-full py-1.5 text-base"
                />
              </div>

              <div className="flex items-center justify-between rounded-lg border border-[var(--rm-border-subtle)] bg-[var(--rm-surface-subtle)] p-2">
                <label className="pl-1 text-sm font-semibold text-[var(--rm-text-secondary)]">
                  金額
                </label>
                <NumberInput
                  value={item.price}
                  onChange={(value) => handleItemChange(index, 'price', value)}
                  className="w-32 bg-white py-1.5 text-right text-base font-bold shadow-sm"
                  placeholder="0"
                />
              </div>
            </div>
          ))}

          {adjustmentAmount !== 0 && (
            <div className="flex items-center justify-between rounded-lg border border-blue-200 bg-[var(--rm-receipt-subtle)] p-3">
              <span className="text-sm font-semibold text-blue-800">
                🔒 消費税・調整額
              </span>
              <span
                className={`pr-1 text-base font-bold ${adjustmentAmount < 0 ? 'text-[var(--rm-danger)]' : 'text-[var(--rm-text-primary)]'}`}
              >
                {adjustmentAmount > 0 ? '+' : ''}
                {adjustmentAmount.toLocaleString()}
              </span>
            </div>
          )}

          {items.length === 0 && (
            <div className="rounded-lg border border-dashed border-[var(--rm-border)] bg-[var(--rm-surface-subtle)] py-6 text-center text-sm font-semibold text-[var(--rm-text-muted)]">
              購入品目がありません。
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

      <div className="mt-8 flex justify-end gap-3 border-t border-[var(--rm-border-subtle)] pt-4">
        <Button variant="secondary" onClick={onCancel} disabled={isSubmitting}>
          キャンセル
        </Button>
        <Button
          variant="primary"
          onClick={handleSaveClick}
          disabled={isSubmitting}
          className={isSubmitting ? 'opacity-75 cursor-wait' : ''}
        >
          {isSubmitting ? '保存中...' : '保存する'}
        </Button>
      </div>
    </div>
  )
}
