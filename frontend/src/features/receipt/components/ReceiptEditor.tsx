import React, { useState } from 'react'
import { type Receipt, type ReceiptItem } from '../api/receiptService'
import { Button } from '../../../components/ui/Button'
import { Input } from '../../../components/ui/Input'

interface ReceiptEditorProps {
  initialData: Receipt
  onSave: (data: Receipt) => void
  onCancel: () => void
}

export const ReceiptEditor: React.FC<ReceiptEditorProps> = ({
  initialData,
  onSave,
  onCancel,
}) => {
  const [date, setDate] = useState(initialData.purchase_date || '')
  const [store, setStore] = useState(initialData.store_name || '')
  const [items, setItems] = useState<ReceiptItem[]>(initialData.items || [])

  const totalAmount = items.reduce((sum, item) => sum + item.price, 0)

  const handleItemChange = (
    index: number,
    field: keyof ReceiptItem,
    value: string | number
  ) => {
    const newItems = [...items]
    if (field === 'price') {
      newItems[index] = { ...newItems[index], [field]: Number(value) }
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

  const handleSaveClick = () => {
    const savedData: Receipt = {
      purchase_date: date,
      store_name: store,
      items: items,
    }
    onSave(savedData)
  }

  return (
    <div className="bg-white p-6 rounded-lg shadow-lg max-w-2xl mx-auto">
      <h2 className="text-2xl font-bold mb-6 text-gray-800 border-b pb-2">
        レシート内容の確認・修正
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <Input
          label="購入日"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 outline-none"
        />
        <Input
          label="店舗名"
          type="text"
          placeholder="店舗名を入力"
          value={store}
          onChange={(e) => setStore(e.target.value)}
        />
      </div>

      <div className="mb-6">
        <div className="flex justify-between items-center mb-2">
          <label className="block text-sm font-medium text-gray-700">
            購入品目
          </label>
          <span className="text-sm font-bold text-gray-600">
            合計: ¥{totalAmount.toLocaleString()}
          </span>
        </div>

        <div className="border border-gray-200 rounded overflow-hidden">
          <table className="w-full text-sm text-left text-gray-500">
            <thead className="text-xs text-gray-700 uppercase bg-gray-50">
              <tr>
                <th className="px-4 py-3 w-8/12">商品名</th>
                <th className="px-4 py-3 w-3/12">金額 (税込)</th>
                <th className="px-4 py-3 w-1/12 text-center">削除</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => (
                <tr key={index} className="bg-white border-b hover:bg-gray-50">
                  <td className="px-2 py-2">
                    <Input
                      className="w-full"
                      value={item.item_name}
                      onChange={(e) =>
                        handleItemChange(index, 'item_name', e.target.value)
                      }
                    />
                  </td>
                  <td className="px-2 py-2">
                    <Input
                      className="w-full text-right"
                      type="number"
                      value={item.price}
                      onChange={(e) =>
                        handleItemChange(index, 'price', e.target.value)
                      }
                    />
                  </td>
                  <td className="px-2 py-2 text-center">
                    <Button
                      variant="danger"
                      onClick={() => handleDeleteItem(index)}
                    >
                      ✕
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-2">
          <Button variant="icon" onClick={handleAddItem}>
            ＋ 商品を追加する
          </Button>
        </div>
      </div>

      <div className="flex justify-end gap-3 mt-8">
        <Button variant="secondary" onClick={onCancel}>
          キャンセル
        </Button>
        <Button variant="primary" onClick={handleSaveClick}>
          保存する
        </Button>
      </div>
    </div>
  )
}
