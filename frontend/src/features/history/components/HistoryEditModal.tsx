import React from 'react'
import { NumberInput } from '@/components/ui/NumberInput'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { HistoryReceiptItems } from './HistoryReceiptItems'
import type {
  HistoryReceipt,
  HistoryCsvTransaction,
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
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl sm:max-w-3xl max-h-full flex flex-col overflow-hidden">
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
                  maxLength={7}
                  className="w-[6.75rem] h-[42px] font-bold text-lg text-right tabular-nums"
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

          {receiptTarget && (
            <HistoryReceiptItems
              receiptTarget={receiptTarget}
              setEditTarget={(newTarget) => setEditTarget(newTarget)}
            />
          )}
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
