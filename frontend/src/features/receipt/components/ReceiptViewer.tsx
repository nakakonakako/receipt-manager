import React, { useState, useRef, useEffect } from 'react'
import type { ReceiptViewerProps } from '../types'

export const ReceiptViewer: React.FC<ReceiptViewerProps> = ({ urls }) => {
  const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)

  const dragStartRef = useRef({ x: 0, y: 0 })
  const containerRef = useRef<HTMLDivElement>(null)

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
        const newScale = Math.min(Math.max(0.5, prev.scale * delta), 5)
        const ratio = newScale / prev.scale

        const newX = mouseX - ratio * (mouseX - prev.x)
        const newY = mouseY - ratio * (mouseY - prev.y)

        return { scale: newScale, x: newX, y: newY }
      })
    }

    container.addEventListener('wheel', handleNativeWheel, { passive: false })
    return () => container.removeEventListener('wheel', handleNativeWheel)
  }, [])

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
          {urls.map((url, index) => (
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
  )
}
