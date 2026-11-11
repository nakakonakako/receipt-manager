import React from 'react'
import { NumberInput } from '@/components/ui/NumberInput'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { DateInput } from '@/components/ui/DateInput'
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/50 backdrop-blur-sm p-4 sm:p-6">
      <div className="bg-[var(--rm-surface)] rounded-[var(--rm-radius-panel)] shadow-[var(--rm-shadow-popover)] w-full max-w-[96vw] lg:max-w-6xl max-h-full flex flex-col overflow-hidden border border-[var(--rm-border-subtle)]">
        <div className="px-5 py-4 border-b border-[var(--rm-border-subtle)] bg-[var(--rm-surface)] flex justify-between items-center shrink-0">
          <h3 className="text-xl font-bold text-[var(--rm-text-primary)]">
            {editType === 'receipt' ? '内容の確認・修正' : '履歴を編集'}
          </h3>
          <button
            onClick={onClose}
            aria-label="編集を閉じる"
            className="min-h-11 min-w-11 flex items-center justify-center rounded-md bg-[var(--rm-surface-muted)] text-[var(--rm-text-secondary)] hover:bg-stone-200 hover:text-[var(--rm-text-primary)] transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            ✕
          </button>
        </div>

        <div className="p-5 sm:p-6 overflow-y-auto flex-1 custom-scrollbar">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 mb-8">
            <div className="flex flex-col">
              <label className="block text-sm font-semibold text-[var(--rm-text-secondary)] mb-1">
                購入日
              </label>
              <DateInput
                aria-label="購入日"
                value={editTarget.date}
                onChange={(e) =>
                  setEditTarget({ ...editTarget, date: e.target.value } as
                    HistoryReceipt | HistoryCsvTransaction)
                }
                className="w-full"
              />
            </div>

            {receiptTarget && (
              <div className="flex flex-col">
                <label className="block text-sm font-semibold text-[var(--rm-text-secondary)] mb-1">
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
                  className="rm-field w-full px-3 py-2 focus:border-blue-600 h-[42px] font-medium"
                >
                  <option value="unknown">不明</option>
                  <option value="cash">現金</option>
                  <option value="cashless">キャッシュレス</option>
                </select>
              </div>
            )}

            {csvTarget && (
              <div className="flex flex-col">
                <label className="block text-sm font-semibold text-[var(--rm-text-secondary)] mb-1">
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
              <label className="block text-sm font-semibold text-[var(--rm-text-secondary)] mb-1">
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

        <div className="p-4 sm:p-5 border-t border-[var(--rm-border-subtle)] bg-[var(--rm-surface-subtle)] flex justify-end gap-3 shrink-0">
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
