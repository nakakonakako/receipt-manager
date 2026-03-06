import React from 'react'
import { NumberInput } from '@/components/ui/NumberInput'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import type {
  HistoryReceipt,
  HistoryCsvTransaction,
  HistoryReceiptItem,
  HistoryEditModalProps,
} from '../types'

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60 backdrop-blur-sm p-4 sm:p-6">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-full flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 bg-white flex justify-between items-center shrink-0">
          <h3 className="text-xl font-extrabold text-gray-800">
            {editType === 'receipt' ? '🧾 内容の確認・修正' : '💳 履歴を編集'}
          </h3>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-800 transition"
          >
            ✕
          </button>
        </div>

        <div className="p-5 sm:p-6 overflow-y-auto flex-1 custom-scrollbar">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 mb-8">
            <div className="flex flex-col">
              <label className="block text-sm font-bold text-gray-700 mb-1">
                購入日
              </label>
              <Input
                type="date"
                value={editTarget.date}
                onChange={(e) =>
                  setEditTarget({ ...editTarget, date: e.target.value } as
                    | HistoryReceipt
                    | HistoryCsvTransaction)
                }
                className="w-full"
              />
            </div>

            {receiptTarget && (
              <div className="flex flex-col">
                <label className="block text-sm font-bold text-gray-700 mb-1">
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
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none h-[42px] bg-white font-medium"
                >
                  <option value="unknown">不明</option>
                  <option value="cash">現金</option>
                  <option value="cashless">キャッシュレス</option>
                </select>
              </div>
            )}

            {csvTarget && (
              <div className="flex flex-col">
                <label className="block text-sm font-bold text-gray-700 mb-1">
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
                  className="w-full h-[42px] font-bold text-lg"
                />
              </div>
            )}

            <div className="md:col-span-2 flex flex-col">
              <label className="block text-sm font-bold text-gray-700 mb-1">
                店舗名
              </label>
              <Input
                type="text"
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
                className="w-full font-bold"
              />
            </div>
          </div>

          {receiptTarget &&
            (() => {
              const itemsSum = receiptTarget.receipt_items.reduce(
                (sum, item) => sum + Number(item.price || 0),
                0
              )
              const finalTotal = receiptTarget.total_amount || 0
              const adjustmentAmount =
                finalTotal > 0 ? finalTotal - itemsSum : 0

              return (
                <div>
                  <div className="flex justify-between items-end mb-4 border-b border-gray-200 pb-2">
                    <h3 className="font-extrabold text-gray-700">購入品目</h3>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-gray-700">
                        合計金額:
                      </span>
                      <NumberInput
                        value={receiptTarget.total_amount}
                        onChange={(val) =>
                          setEditTarget({
                            ...receiptTarget,
                            total_amount:
                              val === '' || val === '-' ? 0 : Number(val),
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
                        {receiptTarget.receipt_items.map((item, index) => (
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
                                className="w-full border-gray-200 font-medium"
                              />
                            </td>
                            <td className="p-2">
                              <NumberInput
                                value={item.price}
                                onChange={(val) => {
                                  const numVal =
                                    val === '' || val === '-' ? 0 : Number(val)
                                  const newItems = [
                                    ...receiptTarget.receipt_items,
                                  ]
                                  newItems[index].price = numVal
                                  setEditTarget({
                                    ...receiptTarget,
                                    receipt_items: newItems,
                                  })
                                }}
                                className="w-full text-right border-gray-200 font-bold"
                              />
                            </td>
                            <td className="p-2 text-center">
                              <Button
                                variant="danger"
                                onClick={() => {
                                  const newItems =
                                    receiptTarget.receipt_items.filter(
                                      (_, i) => i !== index
                                    )
                                  setEditTarget({
                                    ...receiptTarget,
                                    receipt_items: newItems,
                                  })
                                }}
                                className="px-3 py-1.5"
                              >
                                ✕
                              </Button>
                            </td>
                          </tr>
                        ))}
                        {adjustmentAmount !== 0 && (
                          <tr className="bg-blue-50">
                            <td className="p-3 text-sm font-bold text-blue-700 pl-4">
                              🔒 消費税・自動調整額
                            </td>
                            <td
                              className={`p-3 text-right font-bold pr-4 ${adjustmentAmount < 0 ? 'text-red-500' : 'text-gray-800'}`}
                            >
                              {adjustmentAmount > 0 ? '+' : ''}
                              {adjustmentAmount.toLocaleString()}
                            </td>
                            <td></td>
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
                            onClick={() => {
                              const newItems =
                                receiptTarget.receipt_items.filter(
                                  (_, i) => i !== index
                                )
                              setEditTarget({
                                ...receiptTarget,
                                receipt_items: newItems,
                              })
                            }}
                            className="px-2.5 py-1 text-xs font-bold shadow-sm flex items-center gap-1 !bg-white !text-red-500 border border-red-200 hover:!bg-red-50"
                          >
                            ✕ 削除
                          </Button>
                        </div>
                        <div className="mb-2.5">
                          <Input
                            value={item.item_name}
                            onChange={(e) => {
                              const newItems = [...receiptTarget.receipt_items]
                              newItems[index].item_name = e.target.value
                              setEditTarget({
                                ...receiptTarget,
                                receipt_items: newItems,
                              })
                            }}
                            className="w-full text-base py-1.5 border-gray-300 font-medium"
                          />
                        </div>
                        <div className="flex justify-between items-center bg-gray-50 p-2 rounded-lg border border-gray-200">
                          <label className="text-sm font-bold text-gray-700 pl-1">
                            金額
                          </label>
                          <NumberInput
                            value={item.price}
                            onChange={(val) => {
                              const numVal =
                                val === '' || val === '-' ? 0 : Number(val)
                              const newItems = [...receiptTarget.receipt_items]
                              newItems[index].price = numVal
                              setEditTarget({
                                ...receiptTarget,
                                receipt_items: newItems,
                              })
                            }}
                            className="w-32 text-right text-base py-1.5 font-bold border-gray-300 bg-white shadow-sm"
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
                  </div>

                  {receiptTarget.receipt_items.length === 0 && (
                    <div className="text-center py-6 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300 text-gray-400 text-sm font-bold mb-4">
                      購入品目がありません。
                    </div>
                  )}

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
                      className="py-2.5 px-4 shadow-sm"
                    >
                      ＋ 商品を追加する
                    </Button>
                  </div>
                </div>
              )
            })()}
        </div>

        <div className="p-4 sm:p-5 border-t border-gray-100 bg-gray-50 flex justify-end gap-3 shrink-0">
          <Button
            variant="secondary"
            onClick={onClose}
            disabled={isSaving}
            className="px-5 font-bold"
          >
            キャンセル
          </Button>
          <Button
            variant="primary"
            onClick={onSave}
            disabled={isSaving}
            className="px-8 font-bold shadow-sm flex items-center justify-center gap-2"
          >
            {isSaving ? (
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
            ) : null}
            {isSaving ? '保存中...' : '保存する'}
          </Button>
        </div>
      </div>
    </div>
  )
}
