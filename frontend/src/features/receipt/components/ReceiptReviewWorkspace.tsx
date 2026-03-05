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
      <div className="bg-gray-50 w-full h-full sm:h-[95vh] sm:max-w-[1400px] sm:rounded-xl shadow-2xl flex flex-col overflow-hidden">
        <div className="flex justify-between items-center bg-white px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-200 shrink-0">
          <div className="flex flex-col">
            <span className="font-bold text-gray-800 text-base sm:text-lg">
              レシート確認・修正
            </span>
            <span className="text-xs sm:text-sm text-gray-500 mt-0.5">
              ファイル:{' '}
              {task.files.length > 1
                ? `${task.files[0].name} ほか ${task.files.length - 1}件`
                : task.files[0].name}
            </span>
          </div>
          <div className="flex items-center gap-4 sm:gap-6">
            <span className="text-xl sm:text-2xl font-bold text-blue-600">
              {resultIndex + 1}
              <span className="text-sm sm:text-lg text-gray-400">
                {' '}
                / {totalInTask}
              </span>
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

        <div className="flex lg:hidden bg-white border-b border-gray-200 shrink-0">
          <button
            onClick={() => setActiveTab('edit')}
            className={`flex-1 py-3.5 text-sm font-bold flex justify-center items-center gap-2 transition-colors ${activeTab === 'edit' ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/30' : 'text-gray-500 hover:bg-gray-50'}`}
          >
            ✏️ 内容の確認・修正
          </button>
          <button
            onClick={() => setActiveTab('image')}
            className={`flex-1 py-3.5 text-sm font-bold flex justify-center items-center gap-2 transition-colors ${activeTab === 'image' ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/30' : 'text-gray-500 hover:bg-gray-50'}`}
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
