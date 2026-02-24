import React, { useState } from 'react'
import { type Receipt, type ReceiptReviewWorkspaceProps } from '../types'
import { ReceiptEditor } from './ReceiptEditor'

export const ReceiptReviewWorkspace: React.FC<ReceiptReviewWorkspaceProps> = ({
  task,
  resultIndex,
  onSave,
  onCancel,
}) => {
  const [zoomLevel, setZoomLevel] = useState(100)

  const currentReceipt = task.results[resultIndex]
  const totalInTask = task.results.length

  if (!currentReceipt) return null

  const handleSave = (data: Receipt) => {
    onSave(data)
    setZoomLevel(100)
  }

  const handleCancel = () => {
    onCancel()
    setZoomLevel(100)
  }

  return (
    <div className="max-w-7xl mx-auto px-2">
      <div className="mb-4 flex justify-between items-end bg-white p-3 rounded-lg shadow-sm border border-gray-100">
        <span className="text-sm font-bold text-gray-600 flex items-center gap-2">
          <span>レシート確認・修正</span>
          <span className="text-xs font-normal text-gray-400 bg-gray-100 px-2 py-1 rounded">
            ファイル: {task.file.name}
          </span>
        </span>
        <span className="text-xl font-bold text-blue-600">
          {resultIndex + 1}
          <span className="text-sm text-gray-400"> / {totalInTask}</span>
        </span>
      </div>

      <div className="flex flex-col lg:flex-row gap-6 items-start">
        <div className="w-full lg:w-5/12 bg-white rounded-lg shadow-sm border border-gray-200 p-3 flex flex-col sticky top-4">
          <div className="flex justify-between items-center mb-3">
            <span className="text-sm font-bold text-gray-700">
              📸 画像プレビュー
            </span>

            <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-lg">
              <button
                onClick={() => setZoomLevel((prev) => Math.max(50, prev - 25))}
                className="w-8 h-8 flex items-center justify-center bg-white rounded shadow-sm text-gray-600 hover:bg-gray-50 font-bold"
              >
                -
              </button>
              <span className="text-xs font-bold w-12 text-center text-gray-600">
                {zoomLevel}%
              </span>
              <button
                onClick={() => setZoomLevel((prev) => Math.min(300, prev + 25))}
                className="w-8 h-8 flex items-center justify-center bg-white rounded shadow-sm text-gray-600 hover:bg-gray-50 font-bold"
              >
                +
              </button>
            </div>
          </div>

          <div className="relative w-full h-[50vh] lg:h-[70vh] overflow-auto bg-gray-50 border border-gray-200 rounded-lg flex justify-center items-start p-2 custom-scrollbar">
            <img
              src={task.previewUrl}
              alt="receipt preview"
              style={{
                width: `${zoomLevel}%`,
                maxWidth: 'none',
                transition: 'width 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
              }}
              className="h-auto object-contain origin-top shadow-sm"
            />
          </div>
        </div>

        <div className="w-full lg:w-7/12">
          <ReceiptEditor
            key={`${task.id}-${resultIndex}`}
            initialData={currentReceipt}
            onSave={handleSave}
            onCancel={handleCancel}
          />
        </div>
      </div>
    </div>
  )
}
