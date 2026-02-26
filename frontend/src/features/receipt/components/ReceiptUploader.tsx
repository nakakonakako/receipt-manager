import React from 'react'
import { ReceiptReviewWorkspace } from './ReceiptReviewWorkspace'
import { useReceiptUploader } from '../hooks/useReceiptUploader'

export const ReceiptUploader: React.FC = () => {
  const {
    tasks,
    editingState,
    isCombineMode,
    setIsCombineMode,
    handleFileChange,
    handleStartAll,
    handleStartEdit,
    handleSaveCurrent,
    handleSkipCurrent,
    handleDeleteTask,
  } = useReceiptUploader()

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
              {(task.status === 'idle' || task.status === 'error') && (
                <button
                  onClick={() => handleDeleteTask(task.id)}
                  className="text-gray-500 hover:text-red-600 font-bold px-2 py-1 transition-colors"
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
