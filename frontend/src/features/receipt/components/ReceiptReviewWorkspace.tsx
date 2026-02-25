import React from 'react'
import { type Receipt, type ReceiptReviewWorkspaceProps } from '../types'
import { ReceiptEditor } from './ReceiptEditor'
import { ReceiptViewer } from './ReceiptViewer'

export const ReceiptReviewWorkspace: React.FC<ReceiptReviewWorkspaceProps> = ({
  task,
  resultIndex,
  onSave,
  onCancel,
}) => {
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
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex justify-center items-center p-2 sm:p-6">
      <div className="bg-gray-50 w-full max-w-[1400px] h-[95vh] rounded-xl shadow-2xl flex flex-col overflow-hidden">
        <div className="flex justify-between items-center bg-white px-6 py-4 border-b border-gray-200 shrink-0">
          <div className="flex flex-col">
            <span className="font-bold text-gray-800 text-lg">
              レシート確認・修正
            </span>
            <span className="text-sm text-gray-500 mt-1">
              ファイル:{' '}
              {task.files.length > 1
                ? `${task.files[0].name} ほか ${task.files.length - 1}件`
                : task.files[0].name}
            </span>
          </div>
          <div className="flex items-center gap-6">
            <span className="text-2xl font-bold text-blue-600">
              {resultIndex + 1}
              <span className="text-lg text-gray-400"> / {totalInTask}</span>
            </span>
            <button
              onClick={handleCancel}
              className="w-10 h-10 flex items-center justify-center rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-red-500 transition"
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

        <div className="flex flex-col lg:flex-row h-full overflow-hidden p-4 lg:p-6 gap-6">
          <ReceiptViewer urls={task.previewUrls} />

          <div className="w-full lg:w-1/2 h-full overflow-y-auto custom-scrollbar pr-2">
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
