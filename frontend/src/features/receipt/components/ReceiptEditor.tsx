import React, { useState } from 'react'
import {
  type Receipt,
  type ReceiptItem,
  type ReceiptEditorProps,
  type EditingItem,
} from '../types'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { NumberInput } from '@/components/ui/NumberInput'

export const ReceiptEditor: React.FC<ReceiptEditorProps> = ({
  initialData,
  onSave,
  onCancel,
}) => {
  const [date, setDate] = useState(initialData.purchase_date || '')
  const [store, setStore] = useState(initialData.store_name || '')
  const [items, setItems] = useState<EditingItem[]>(initialData.items || [])
  const [paymentMethod, setPaymentMethod] = useState(
    initialData.payment_method || 'unknown'
  )
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [totalAmount, setTotalAmount] = useState(initialData.total_amount || 0)

  const itemsSum = items.reduce((sum, item) => sum + Number(item.price || 0), 0)
  const adjustmentAmount = totalAmount > 0 ? totalAmount - itemsSum : 0

  const handleItemChange = (
    index: number,
    field: keyof ReceiptItem,
    value: string | number
  ) => {
    const newItems = [...items]
    if (field === 'price') {
      const newValue = value === '' ? '' : Number(value)
      newItems[index] = { ...newItems[index], [field]: newValue }
    } else {
      newItems[index] = { ...newItems[index], [field]: value as string }
    }
    setItems(newItems)
  }

  const handleDeleteItem = (index: number) => {
    const newItems = items.filter((_, i) => i !== index)
    setItems(newItems)
  }

  const handleAddItem = () => {
    setItems([...items, { item_name: '', price: 0 }])
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

    const newItems: ReceiptItem[] = items.map((item) => ({
      ...item,
      price: item.price === '' ? 0 : item.price,
    }))

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
    <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 w-full">
      <div className="border-b pb-3 mb-6">
        <h2 className="text-xl font-bold text-gray-800">
          レシート内容の確認・修正
        </h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 mb-8">
        <div className="flex flex-col">
          <label className="block text-sm font-bold text-gray-700 mb-1">
            購入日
          </label>
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full"
          />
        </div>

        <div className="flex flex-col">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            支払い方法
          </label>
          <select
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value)}
            className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 outline-none h-[42px] bg-white"
          >
            <option value="unknown">不明</option>
            <option value="cash">現金</option>
            <option value="cashless">キャッシュレス</option>
          </select>
        </div>

        <div className="md:col-span-2 flex flex-col">
          <label
            htmlFor="store"
            className="block text-sm font-bold text-gray-700 mb-1"
          >
            店舗名 <span className="text-red-500 text-xs ml-1">必須</span>
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
        <div className="flex justify-between items-end mb-3 border-b pb-2">
          <h3 className="font-bold text-gray-700">購入品目</h3>
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-gray-700">合計金額:</span>
            <NumberInput
              value={totalAmount}
              onChange={(val) =>
                setTotalAmount(val === '' || val === '-' ? 0 : Number(val))
              }
              className="w-32 text-right font-bold text-lg !py-1 !px-2 h-9 bg-gray-50 focus:bg-white border-gray-300 transition-colors shadow-sm"
            />
          </div>
        </div>

        <div className="hidden md:block overflow-x-auto border border-gray-200 rounded-lg shadow-sm mb-3">
          <table className="w-full text-left border-collapse">
            <thead className="bg-gray-50">
              <tr>
                <th className="p-3 text-xs font-bold text-gray-600 border-b min-w-[200px]">
                  商品名 <span className="text-red-500">*</span>
                </th>
                <th className="p-3 text-xs font-bold text-gray-600 border-b w-32 text-right">
                  金額
                </th>
                <th className="p-3 text-xs font-bold text-gray-600 border-b w-16 text-center">
                  削除
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {items.map((item, index) => (
                <tr key={index} className="hover:bg-gray-50 transition-colors">
                  <td className="p-2">
                    <Input
                      value={item.item_name}
                      onChange={(e) =>
                        handleItemChange(index, 'item_name', e.target.value)
                      }
                      placeholder="商品名を入力"
                      className="w-full border-gray-200"
                    />
                  </td>
                  <td className="p-2">
                    <NumberInput
                      value={item.price}
                      onChange={(value) =>
                        handleItemChange(index, 'price', value)
                      }
                      className="w-full text-right border-gray-200"
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
                <tr className="bg-gray-50">
                  <td className="p-2 text-sm font-bold text-gray-500 pl-4">
                    🔒 消費税・自動調整額
                  </td>
                  <td
                    className={`p-2 text-right font-bold pr-4 ${adjustmentAmount < 0 ? 'text-red-500' : 'text-gray-600'}`}
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
            <div className="text-center py-6 text-gray-400 text-sm">
              購入品目がありません。下のボタンから追加してください。
            </div>
          )}
        </div>

        <div className="block md:hidden space-y-2.5 mb-4">
          {items.map((item, index) => (
            <div
              key={index}
              className="bg-white border border-gray-200 rounded-xl p-3 shadow-sm relative transition-all"
            >
              <div className="flex justify-between items-center mb-2 border-b border-gray-100 pb-2">
                <label className="block text-sm font-bold text-gray-700">
                  商品名 <span className="text-red-500">*</span>
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
                  placeholder="商品名"
                  className="w-full text-base py-1.5 border-gray-300"
                />
              </div>

              <div className="flex justify-between items-center bg-gray-50 p-2 rounded-lg border border-gray-200">
                <label className="text-sm font-bold text-gray-700 pl-1">
                  金額
                </label>
                <NumberInput
                  value={item.price}
                  onChange={(value) => handleItemChange(index, 'price', value)}
                  className="w-32 text-right text-base py-1.5 font-bold border-gray-300 bg-white shadow-sm"
                  placeholder="0"
                />
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

          {items.length === 0 && (
            <div className="text-center py-6 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300 text-gray-400 text-sm font-bold">
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

      <div className="flex justify-end gap-3 mt-8 pt-4 border-t">
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
