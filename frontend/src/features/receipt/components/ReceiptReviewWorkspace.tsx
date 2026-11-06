import React, { useState } from 'react'
import { type Receipt, type ReceiptReviewWorkspaceProps } from '../types'
import { ReceiptEditor } from './ReceiptEditor'
import { ReceiptViewer } from './ReceiptViewer'

export const ReceiptReviewWorkspace: React.FC<ReceiptReviewWorkspaceProps> = ({
  task,
  resultIndex,
  onSave,
  onCancel,
}) => {
  const [activeTab, setActiveTab] = useState<'edit' | 'image'>('edit')

  const currentReceipt = task.results[resultIndex]
  const totalInTask = task.results.length

  if (!currentReceipt) return null

  const handleSave = async (data: Receipt) => {
    await onSave(data)
  }

  const handleCancel = () => {
    onCancel()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex justify-center items-center p-0 sm:p-6">
      <div className="flex h-full w-full flex-col overflow-hidden bg-[var(--rm-surface-subtle)] shadow-2xl sm:h-[95vh] sm:max-w-[1400px] sm:rounded-xl">
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--rm-border-subtle)] bg-[var(--rm-surface)] px-4 py-3 sm:px-6 sm:py-4">
          <div className="flex flex-col">
            <span className="text-base font-bold text-[var(--rm-text-primary)] sm:text-lg">
              レシート確認・修正
            </span>
            <span className="text-xs sm:text-sm text-[var(--rm-text-muted)] mt-0.5">
              ファイル:{' '}
              {task.files.length > 1
                ? `${task.files[0].name} ほか ${task.files.length - 1}件`
                : task.files[0].name}
            </span>
          </div>
          <div className="flex items-center gap-4 sm:gap-6">
            <span className="text-xl sm:text-2xl font-bold text-blue-600">
              {resultIndex + 1}
              <span className="text-sm sm:text-lg text-[var(--rm-text-muted)]">
                {' '}
                / {totalInTask}
              </span>
            </span>
            <button
              onClick={handleCancel}
              aria-label="確認画面を閉じる"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--rm-surface-muted)] text-[var(--rm-text-secondary)] transition-colors hover:bg-[var(--rm-danger-subtle)] hover:text-[var(--rm-danger)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rm-focus)]"
            >
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M6 18L18 6M6 6l12 12"
                ></path>
              </svg>
            </button>
          </div>
        </div>

        <div className="flex shrink-0 border-b border-[var(--rm-border-subtle)] bg-[var(--rm-surface)] lg:hidden">
          <button
            onClick={() => setActiveTab('edit')}
            aria-pressed={activeTab === 'edit'}
            className={`min-h-11 flex-1 border-b-2 py-3.5 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--rm-focus)] ${activeTab === 'edit' ? 'border-[var(--rm-receipt)] bg-[var(--rm-receipt-subtle)] text-[var(--rm-receipt)]' : 'border-transparent text-[var(--rm-text-secondary)] hover:bg-[var(--rm-surface-subtle)]'}`}
          >
            ✏️ 内容の確認・修正
          </button>
          <button
            onClick={() => setActiveTab('image')}
            aria-pressed={activeTab === 'image'}
            className={`min-h-11 flex-1 border-b-2 py-3.5 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--rm-focus)] ${activeTab === 'image' ? 'border-[var(--rm-receipt)] bg-[var(--rm-receipt-subtle)] text-[var(--rm-receipt)]' : 'border-transparent text-[var(--rm-text-secondary)] hover:bg-[var(--rm-surface-subtle)]'}`}
          >
            📸 レシート画像
          </button>
        </div>

        <div className="flex flex-col lg:flex-row flex-1 overflow-hidden p-0 sm:p-4 lg:p-6 gap-0 lg:gap-6">
          <div
            className={`${activeTab === 'image' ? 'flex' : 'hidden'} lg:flex w-full lg:w-1/2 h-full flex-col`}
          >
            <ReceiptViewer urls={task.previewUrls} />
          </div>

          <div
            className={`${activeTab === 'edit' ? 'flex' : 'hidden'} lg:flex w-full lg:w-1/2 h-full flex-col overflow-y-auto custom-scrollbar p-4 lg:p-0`}
          >
            <ReceiptEditor
              key={`${task.id}-${resultIndex}`}
              initialData={currentReceipt}
              onSave={handleSave}
              onCancel={handleCancel}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
