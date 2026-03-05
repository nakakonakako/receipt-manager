import React from 'react'
import { NumberInput } from '@/components/ui/NumberInput'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import type {
  HistoryReceipt,
  HistoryCsvTransaction,
  HistoryReceiptItem,
} from '../types'

interface HistoryEditModalProps {
  editTarget: HistoryReceipt | HistoryCsvTransaction
  editType: 'receipt' | 'csv'
  isSaving: boolean
  setEditTarget: (target: HistoryReceipt | HistoryCsvTransaction | null) => void
  onClose: () => void
  onSave: () => void
}

export const HistoryEditModal: React.FC<HistoryEditModalProps> = ({
  editTarget,
  editType,
  isSaving,
  setEditTarget,
  onClose,
  onSave,
}) => {
  const receiptTarget =
    editType === 'receipt' ? (editTarget as HistoryReceipt) : null
  const csvTarget =
    editType === 'csv' ? (editTarget as HistoryCsvTransaction) : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 backdrop-blur-sm px-4 py-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-full flex flex-col overflow-hidden">
        <div className="p-4 border-b bg-gray-50 flex justify-between items-center">
          <h3 className="text-lg font-bold text-gray-800">
            {editType === 'receipt'
              ? '🧾 レシート内容の確認・修正'
              : '💳 履歴を編集'}
          </h3>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-800 font-bold"
          >
            ✕
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 mb-8">
            <Input
              type="date"
              label="購入日"
              value={editTarget.date}
              onChange={(e) =>
                setEditTarget({ ...editTarget, date: e.target.value } as
                  | HistoryReceipt
                  | HistoryCsvTransaction)
              }
            />

            {receiptTarget && (
              <div className="flex flex-col">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  支払い方法
                </label>
                <select
                  value={receiptTarget.payment_method || 'unknown'}
                  onChange={(e) =>
                    setEditTarget({
                      ...receiptTarget,
                      payment_method: e.target.value,
                    })
                  }
                  className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 outline-none h-[42px] bg-white"
                >
                  <option value="unknown">不明</option>
                  <option value="cash">現金</option>
                  <option value="cashless">キャッシュレス</option>
                </select>
              </div>
            )}

            {csvTarget && (
              <div className="flex flex-col">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  金額
                </label>
                <NumberInput
                  value={csvTarget.price}
                  onChange={(val) =>
                    setEditTarget({
                      ...csvTarget,
                      price: val === '' || val === '-' ? 0 : Number(val),
                    })
                  }
                  className="w-full h-[42px]"
                />
              </div>
            )}

            <div className="md:col-span-2">
              <Input
                type="text"
                label="店舗名"
                value={
                  receiptTarget
                    ? receiptTarget.store_name
                    : csvTarget?.store || ''
                }
                onChange={(e) => {
                  if (receiptTarget)
                    setEditTarget({
                      ...receiptTarget,
                      store_name: e.target.value,
                    })
                  else if (csvTarget)
                    setEditTarget({ ...csvTarget, store: e.target.value })
                }}
              />
            </div>

            {receiptTarget && (
              <div className="md:col-span-2 flex flex-col">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  合計金額
                </label>
                <NumberInput
                  value={receiptTarget.total_amount}
                  onChange={(val) =>
                    setEditTarget({
                      ...receiptTarget,
                      total_amount: val === '' || val === '-' ? 0 : Number(val),
                    })
                  }
                  className="w-full h-[42px]"
                />
              </div>
            )}
          </div>

          {receiptTarget &&
            (() => {
              const itemsSum = receiptTarget.receipt_items.reduce(
                (sum: number, item: HistoryReceiptItem) =>
                  sum + Number(item.price || 0),
                0
              )
              const finalTotal = receiptTarget.total_amount || 0
              const adjustmentAmount =
                finalTotal > 0 ? finalTotal - itemsSum : 0

              return (
                <div>
                  <div className="flex justify-between items-end mb-3 border-b pb-2">
                    <h3 className="font-bold text-gray-700">購入品目</h3>
                    <div className="text-lg font-bold text-gray-800">
                      合計: ¥{finalTotal.toLocaleString()}
                    </div>
                  </div>

                  <div className="overflow-x-auto border border-gray-200 rounded-lg shadow-sm mb-3">
                    <table className="w-full text-left border-collapse">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="p-3 text-xs font-bold text-gray-600 border-b min-w-[200px]">
                            商品名
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
                        {receiptTarget.receipt_items.map(
                          (item: HistoryReceiptItem, index: number) => (
                            <tr
                              key={index}
                              className="hover:bg-gray-50 transition-colors"
                            >
                              <td className="p-2">
                                <Input
                                  value={item.item_name}
                                  onChange={(e) => {
                                    const newItems = [
                                      ...receiptTarget.receipt_items,
                                    ]
                                    newItems[index].item_name = e.target.value
                                    setEditTarget({
                                      ...receiptTarget,
                                      receipt_items: newItems,
                                    })
                                  }}
                                  placeholder="商品名を入力"
                                  className="w-full border-transparent hover:border-gray-300 focus:border-blue-500"
                                />
                              </td>
                              <td className="p-2">
                                <NumberInput
                                  value={item.price}
                                  onChange={(val) => {
                                    const numVal =
                                      val === '' || val === '-'
                                        ? 0
                                        : Number(val)
                                    const newItems = [
                                      ...receiptTarget.receipt_items,
                                    ]
                                    newItems[index].price = numVal
                                    setEditTarget({
                                      ...receiptTarget,
                                      receipt_items: newItems,
                                    })
                                  }}
                                  className="w-full text-right border-transparent hover:border-gray-300 focus:border-blue-500"
                                  placeholder="0"
                                />
                              </td>
                              <td className="p-2 text-center">
                                <Button
                                  variant="danger"
                                  onClick={() => {
                                    const newItems =
                                      receiptTarget.receipt_items.filter(
                                        (_: HistoryReceiptItem, i: number) =>
                                          i !== index
                                      )
                                    setEditTarget({
                                      ...receiptTarget,
                                      receipt_items: newItems,
                                    })
                                  }}
                                  className="px-3 py-1"
                                >
                                  ✕
                                </Button>
                              </td>
                            </tr>
                          )
                        )}

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
                            <td className="p-2"></td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex justify-start">
                    <Button
                      variant="icon"
                      onClick={() =>
                        setEditTarget({
                          ...receiptTarget,
                          receipt_items: [
                            ...receiptTarget.receipt_items,
                            { item_name: '', price: 0 } as HistoryReceiptItem,
                          ],
                        })
                      }
                      className="py-2"
                    >
                      ＋ 商品を追加する
                    </Button>
                  </div>
                </div>
              )
            })()}
        </div>

        <div className="p-4 border-t bg-gray-50 flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose} disabled={isSaving}>
            キャンセル
          </Button>
          <Button variant="primary" onClick={onSave} disabled={isSaving}>
            {isSaving ? '保存中...' : '保存する'}
          </Button>
        </div>
      </div>
    </div>
  )
}
