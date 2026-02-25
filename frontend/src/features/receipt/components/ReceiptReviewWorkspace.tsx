import React, { useState, useRef, useEffect } from 'react'
import { type Receipt, type ReceiptReviewWorkspaceProps } from '../types'
import { ReceiptEditor } from './ReceiptEditor'

export const ReceiptReviewWorkspace: React.FC<ReceiptReviewWorkspaceProps> = ({
  task,
  resultIndex,
  onSave,
  onCancel,
}) => {
  const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)

  const dragStartRef = useRef({ x: 0, y: 0 })
  const containerRef = useRef<HTMLDivElement>(null)

  const currentReceipt = task.results[resultIndex]
  const totalInTask = task.results.length

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleNativeWheel = (e: WheelEvent) => {
      e.preventDefault()

      const rect = container.getBoundingClientRect()

      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top

      const delta = e.deltaY > 0 ? 0.9 : 1.1

      setTransform((prev) => {
        const newScale = Math.min(Math.max(0.1, prev.scale * delta), 5)
        const ratio = newScale / prev.scale

        const newX = mouseX - ratio * (mouseX - prev.x)
        const newY = mouseY - ratio * (mouseY - prev.y)

        return { scale: newScale, x: newX, y: newY }
      })
    }

    container.addEventListener('wheel', handleNativeWheel, { passive: false })
    return () => container.removeEventListener('wheel', handleNativeWheel)
  }, [])

  if (!currentReceipt) return null

  const handleSave = async (data: Receipt) => {
    await onSave(data)
  }

  const handleCancel = () => {
    onCancel()
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
    dragStartRef.current = {
      x: e.clientX - transform.x,
      y: e.clientY - transform.y,
    }
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return
    e.preventDefault()
    setTransform((prev) => ({
      ...prev,
      x: e.clientX - dragStartRef.current.x,
      y: e.clientY - dragStartRef.current.y,
    }))
  }

  const handleMouseUp = () => {
    setIsDragging(false)
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
          <div className="w-full lg:w-1/2 bg-white rounded-lg shadow-sm border border-gray-200 flex flex-col h-[40vh] lg:h-full shrink-0">
            <div className="flex justify-between items-center p-3 border-b bg-gray-50">
              <span className="text-sm font-bold text-gray-700">
                📸 画像プレビュー
              </span>
              <span className="text-xs font-bold text-gray-600 bg-white px-2 py-1 rounded border shadow-sm">
                {Math.round(transform.scale * 100)}%
              </span>
            </div>

            <div
              ref={containerRef}
              className={`relative flex-1 overflow-hidden bg-gray-100 cursor-${isDragging ? 'grabbing' : 'grab'}`}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            >
              <div
                style={{
                  transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
                  transformOrigin: '0 0',
                }}
                className="absolute top-0 left-0 flex flex-col items-center p-4 gap-2 origin-top-left"
              >
                {task.previewUrls.map((url, index) => (
                  <img
                    key={index}
                    src={url}
                    alt={`receipt preview ${index + 1}`}
                    className="max-w-full h-auto object-contain shadow-sm pointer-events-none"
                  />
                ))}
              </div>
            </div>
          </div>

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
