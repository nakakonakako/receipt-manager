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

  const totalAmount = items.reduce(
    (sum, item) => sum + Number(item.price || 0),
    0
  )

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
      total_amount: initialData.total_amount || 0,
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
          <div className="text-lg font-bold text-gray-800">
            合計: ¥{totalAmount.toLocaleString()}
          </div>
        </div>

        <div className="overflow-x-auto border border-gray-200 rounded-lg shadow-sm mb-3">
          <table className="w-full text-left border-collapse">
            <thead className="bg-gray-50">
              <tr>
                <th className="p-3 text-xs font-bold text-gray-600 border-b min-w-[200px]">
                  商品名 <span className="text-red-500">*</span>
                </th>
                <th className="p-3 text-xs font-bold text-gray-600 border-b w-32 text-right">
                  金額 (税込)
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
            </tbody>
          </table>

          {items.length === 0 && (
            <div className="text-center py-6 text-gray-400 text-sm">
              購入品目がありません。下のボタンから追加してください。
            </div>
          )}
        </div>

        <div className="flex justify-start">
          <Button variant="icon" onClick={handleAddItem} className="py-2">
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
