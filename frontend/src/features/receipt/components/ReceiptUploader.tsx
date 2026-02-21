import React, { useState } from 'react'
import { type Receipt } from '../types'
import { analyzeReceipt, saveTransaction } from '../api/receiptApi'
import { ReceiptEditor } from './ReceiptEditor'
import axios from 'axios'

interface UploadTask {
  id: string
  file: File
  previewUrl: string
  status: 'idle' | 'analyzing' | 'success' | 'error'
  results: Receipt[]
}

export const ReceiptUploader: React.FC = () => {
  const [tasks, setTasks] = useState<UploadTask[]>([])
  const [editingState, setEditingState] = useState<{
    taskId: string
    resultIndex: number
  } | null>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const newFiles = Array.from(e.target.files)

      const newTasks: UploadTask[] = newFiles.map((file) => ({
        id: crypto.randomUUID(),
        file: file,
        previewUrl: URL.createObjectURL(file),
        status: 'idle',
        results: [],
      }))

      setTasks((prev) => [...prev, ...newTasks])

      e.target.value = ''
    }
  }

  const processTask = async (taskId: string) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status: 'analyzing' } : t))
    )

    const t = tasks.find((t) => t.id === taskId)
    if (!t) return

    try {
      const data = await analyzeReceipt(t.file)

      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId
            ? { ...t, status: 'success', results: data.receipts }
            : t
        )
      )
    } catch (error) {
      console.error(error)
      if (
        axios.isAxiosError(error) &&
        (error.response?.status === 401 || error.response?.status === 403)
      ) {
        alert('認証エラーが発生しました。ログイン状態を確認してください。')
        window.location.reload()
        return
      }
    }
  }

  const handleStartAll = () => {
    tasks.forEach((t) => {
      if (t.status === 'idle') {
        processTask(t.id)
      }
    })
  }

  const handleStartEdit = (taskId: string) => {
    setEditingState({ taskId, resultIndex: 0 })
  }

  const handleSaveCurrent = async (data: Receipt) => {
    if (!editingState) return
    const { taskId, resultIndex } = editingState
    const currentTask = tasks.find((t) => t.id === taskId)

    try {
      await saveTransaction(data)
      alert(
        `${data.purchase_date}/${data.store_name} のレシートを保存しました。`
      )

      if (currentTask && resultIndex < currentTask.results.length - 1) {
        setEditingState({ taskId, resultIndex: resultIndex + 1 })
      } else {
        setTasks((prev) => prev.filter((t) => t.id !== taskId))
        setEditingState(null)
      }
    } catch (error) {
      console.error(error)
      alert('レシートの保存中にエラーが発生しました。')
    }
  }

  const handleSkipCurrent = () => {
    if (!editingState) return
    const { taskId, resultIndex } = editingState
    const currentTask = tasks.find((t) => t.id === taskId)

    alert('このレシートの登録をスキップしました。')

    if (currentTask && resultIndex < currentTask.results.length - 1) {
      setEditingState({ taskId, resultIndex: resultIndex + 1 })
    } else {
      setTasks((prev) => prev.filter((t) => t.id !== taskId))
      setEditingState(null)
    }
  }

  if (editingState) {
    const task = tasks.find((t) => t.id === editingState.taskId)
    if (task && task.results[editingState.resultIndex]) {
      const currentReceipt = task.results[editingState.resultIndex]
      const totalInTask = task.results.length

      return (
        <div>
          <div className="max-w-2xl mx-auto mb-2 flex justify-between items-end px-2">
            <span className="text-sm font-bold text-gray-500">
              レシート確認中 ({task.file.name})
            </span>
            <span className="text-xl font-bold text-blue-600">
              {editingState.resultIndex + 1}
              <span className="text-sm text-gray-400">/ {totalInTask}</span>
            </span>
          </div>

          <ReceiptEditor
            key={`${editingState.taskId}-${editingState.resultIndex}`}
            initialData={currentReceipt}
            onSave={handleSaveCurrent}
            onCancel={handleSkipCurrent}
          />
        </div>
      )
    }
  }

  return (
    <div className="p-4 max-w-2xl mx-auto space-y-6">
      <h2 className="text-xl font-bold text-center text-gray-800">
        レシート一括登録
      </h2>

      <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 bg-gray-50 text-center">
        <label className="cursor-pointer block">
          <span className="text-gray-500 font-bold block mb-2">
            ここをタップして画像を選択、または画像をドラッグ＆ドロップ
          </span>
          <span className="text-xs text-gray-400 block mb-4">
            (まとめて複数選択できます)
          </span>
          <input
            type="file"
            multiple
            accept="image/*"
            onChange={handleFileChange}
            className="hidden"
          />
          <div className="bg-blue-100 text-blue-600 py-2 px-4 rounded-full inline-block font-bold">
            📸 画像を追加
          </div>
        </label>
      </div>

      {tasks.some((t) => t.status === 'idle') && (
        <div className="flex justify-end">
          <button
            onClick={handleStartAll}
            className="bg-green-600 text-white font-bold py-2 px-6 rounded shadow hover:bg-green-700 transition"
          >
            🚀 まとめて解析開始
          </button>
        </div>
      )}

      <div className="space-y-3">
        {tasks.map((task) => (
          <div
            key={task.id}
            className="flex items-center bg-white p-3 rounded shadow-sm border border-gray-100"
          >
            <img
              src={task.previewUrl}
              alt="preview"
              className="w-16 h-16 object-cover rounded mr-4"
            />

            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-gray-700 truncate">
                {task.file.name}
              </div>

              <div className="text-sm mt-1">
                {task.status === 'idle' && (
                  <span className="text-gray-400">待機中...</span>
                )}
                {task.status === 'analyzing' && (
                  <span className="text-blue-600 font-bold animate-pulse">
                    解析中... ⏳
                  </span>
                )}
                {task.status === 'success' && (
                  <span className="text-green-600 font-bold">
                    解析完了！ ({task.results.length}枚検出)
                  </span>
                )}
                {task.status === 'error' && (
                  <span className="text-red-600 font-bold">失敗 ❌</span>
                )}
              </div>
            </div>

            <div className="ml-2 shrink-0">
              {task.status === 'idle' && (
                <button
                  onClick={() =>
                    setTasks((prev) => prev.filter((t) => t.id !== task.id))
                  }
                >
                  削除
                </button>
              )}

              {task.status === 'success' && (
                <button
                  onClick={() => handleStartEdit(task.id)}
                  className="bg-blue-600 text-white text-sm font-bold py-2 px-4 rounded hover:bg-blue-700"
                >
                  確認・登録
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
