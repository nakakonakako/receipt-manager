import React, { useState } from 'react'
import { useApiConfig } from '@/hooks/useApiConfig'
import { type Receipt, type UploadTask } from '../types'
import { analyzeReceipt, saveTransaction } from '../api/receiptApi'
import { ReceiptReviewWorkspace } from './ReceiptReviewWorkspace'

import axios from 'axios'

export const ReceiptUploader: React.FC = () => {
  const { getHeaders } = useApiConfig()

  const [tasks, setTasks] = useState<UploadTask[]>([])
  const [editingState, setEditingState] = useState<{
    taskId: string
    resultIndex: number
  } | null>(null)
  const [isCombineMode, setIsCombineMode] = useState(false)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const newFiles = Array.from(e.target.files)

      if (isCombineMode) {
        const newTask: UploadTask = {
          id: crypto.randomUUID(),
          files: newFiles,
          previewUrls: newFiles.map((f) => URL.createObjectURL(f)),
          status: 'idle',
          results: [],
        }
        setTasks((prev) => [...prev, newTask])
      } else {
        const newTasks: UploadTask[] = newFiles.map((file) => ({
          id: crypto.randomUUID(),
          files: [file],
          previewUrls: [URL.createObjectURL(file)],
          status: 'idle',
          results: [],
        }))
        setTasks((prev) => [...prev, ...newTasks])
      }

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
      const data = await analyzeReceipt(t.files)

      if (!data || !data.receipts || data.receipts.length === 0) {
        alert(
          'レシートの解析に失敗しました。画像が鮮明か、レシート全体が写っているか確認してください。'
        )
        setTasks((prev) =>
          prev.map((t) => (t.id === taskId ? { ...t, status: 'error' } : t))
        )
        return
      }

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
    const headers = await getHeaders()
    if (!headers) return

    if (!editingState) return
    const { taskId, resultIndex } = editingState
    const currentTask = tasks.find((t) => t.id === taskId)

    try {
      await saveTransaction(data, headers)
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
    if (task) {
      return (
        <ReceiptReviewWorkspace
          key={`${editingState.taskId}-${editingState.resultIndex}`}
          task={task}
          resultIndex={editingState.resultIndex}
          onSave={handleSaveCurrent}
          onCancel={handleSkipCurrent}
        />
      )
    }
  }

  return (
    <div className="p-4 max-w-2xl mx-auto space-y-6">
      <h2 className="text-xl font-bold text-center text-gray-800">
        レシート一括登録
      </h2>

      <div className="flex items-center justify-center gap-2 mb-4">
        <label className="flex items-center cursor-pointer">
          <div className="relative">
            <input
              type="checkbox"
              className="sr-only"
              checked={isCombineMode}
              onChange={() => setIsCombineMode(!isCombineMode)}
            />
            <div
              className={`block w-14 h-8 rounded-full transition-colors ${isCombineMode ? 'bg-blue-500' : 'bg-gray-300'}`}
            ></div>
            <div
              className={`dot absolute left-1 top-1 bg-white w-6 h-6 rounded-full transition-transform ${isCombineMode ? 'transform translate-x-6' : ''}`}
            ></div>
          </div>
          <div className="ml-3 font-bold text-sm text-gray-700">
            複数画像を1枚のレシートとして結合する
          </div>
        </label>
      </div>

      <div
        className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${isCombineMode ? 'border-blue-400 bg-blue-50' : 'border-gray-300 bg-gray-50'}`}
      >
        <label className="cursor-pointer block">
          <span className="text-gray-500 font-bold block mb-2">
            ここをタップして画像を選択、または画像をドラッグ＆ドロップ
          </span>
          <span className="text-xs text-gray-400 block mb-4">
            (
            {isCombineMode
              ? '選んだ画像がすべて1つのレシートになります'
              : 'まとめて複数選択できます'}
            )
          </span>
          <input
            type="file"
            multiple
            accept="image/*"
            onChange={handleFileChange}
            className="hidden"
          />
          <div
            className={`py-2 px-4 rounded-full inline-block font-bold ${isCombineMode ? 'bg-blue-600 text-white shadow' : 'bg-blue-100 text-blue-600'}`}
          >
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
            <div className="relative mr-4">
              <img
                src={task.previewUrls[0]}
                alt="preview"
                className="w-16 h-16 object-cover rounded"
              />
              {task.previewUrls.length > 1 && (
                <span className="absolute -top-2 -right-2 bg-blue-600 text-white text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full border-2 border-white">
                  {task.previewUrls.length}
                </span>
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-gray-700 truncate">
                {task.files.length > 1
                  ? `${task.files[0].name} ほか ${task.files.length - 1}件`
                  : task.files[0].name}
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
              {task.status === 'idle' ||
                (task.status === 'error' && (
                  <button
                    onClick={() =>
                      setTasks((prev) => prev.filter((t) => t.id !== task.id))
                    }
                  >
                    削除
                  </button>
                ))}

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
