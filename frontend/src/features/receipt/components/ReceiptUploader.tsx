import React, { useRef } from 'react'
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
    cameraFiles,
    isCameraModalOpen,
    setIsCameraModalOpen,
    handleCameraCapture,
    handleFinishCamera,
  } = useReceiptUploader()

  const cameraInputRef = useRef<HTMLInputElement>(null)

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
      <h2 className="text-2xl font-extrabold text-center text-gray-800 tracking-tight">
        🧾 レシート一括登録
      </h2>

      <div className="flex items-center justify-center gap-2 mb-4 bg-white p-3 rounded-lg shadow-sm border border-gray-100">
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

      <input
        type="file"
        accept="image/*"
        capture="environment"
        ref={cameraInputRef}
        style={{ display: 'none' }}
        onChange={handleCameraCapture}
      />

      <div className="flex flex-col sm:flex-row gap-4">
        <button
          onClick={() => cameraInputRef.current?.click()}
          className={`flex-1 flex flex-col items-center justify-center gap-2 py-6 rounded-xl border-2 transition-all shadow-sm ${isCombineMode ? 'border-blue-400 bg-blue-50 hover:bg-blue-100' : 'border-gray-300 bg-white hover:bg-gray-50'}`}
        >
          <span className="text-4xl">📸</span>
          <span className="font-bold text-gray-700">カメラで撮影</span>
          <span className="text-xs text-gray-500">
            {isCombineMode ? '続けて撮ると1枚に結合' : '1枚ずつ別々に解析'}
          </span>
        </button>

        <label
          className={`flex-1 flex flex-col items-center justify-center gap-2 py-6 rounded-xl border-2 border-dashed cursor-pointer transition-all ${isCombineMode ? 'border-blue-400 bg-blue-50/50 hover:bg-blue-50' : 'border-gray-300 bg-white hover:bg-gray-50'}`}
        >
          <span className="text-4xl">📂</span>
          <span className="font-bold text-gray-700">ファイルを選択</span>
          <span className="text-xs text-gray-500">(複数選択OK)</span>
          <input
            type="file"
            multiple
            accept="image/*"
            onChange={handleFileChange}
            className="hidden"
          />
        </label>
      </div>

      {tasks.some((t) => t.status === 'idle') && (
        <div className="flex justify-end pt-4 border-t">
          <button
            onClick={handleStartAll}
            className="bg-green-600 text-white text-lg font-bold py-3 px-8 rounded-xl shadow-md hover:bg-green-700 transition flex items-center gap-2"
          >
            <span>🚀</span>
            まとめて解析開始
          </button>
        </div>
      )}

      <div className="space-y-3">
        {tasks.map((task) => (
          <div
            key={task.id}
            className="flex items-center bg-white p-4 rounded-xl shadow-sm border border-gray-100 transition-all hover:shadow-md"
          >
            <div className="relative mr-4 shrink-0">
              <img
                src={task.previewUrls[0]}
                alt="preview"
                className="w-16 h-16 object-cover rounded-lg border border-gray-200"
              />
              {task.previewUrls.length > 1 && (
                <span className="absolute -top-2 -right-2 bg-blue-600 text-white text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full border-2 border-white shadow-sm">
                  {task.previewUrls.length}
                </span>
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-gray-800 truncate">
                {task.files.length > 1
                  ? `${task.files[0].name} ほか ${task.files.length - 1}件`
                  : task.files[0].name}
              </div>

              <div className="text-sm mt-1">
                {task.status === 'idle' && (
                  <span className="text-gray-500 bg-gray-100 px-2 py-0.5 rounded text-xs font-bold">
                    待機中...
                  </span>
                )}
                {task.status === 'analyzing' && (
                  <span className="text-blue-600 font-bold animate-pulse">
                    解析中... ⏳
                  </span>
                )}
                {task.status === 'success' && (
                  <span className="text-green-600 font-bold bg-green-50 px-2 py-0.5 rounded text-xs">
                    解析完了！ ({task.results.length}枚検出)
                  </span>
                )}
                {task.status === 'error' && (
                  <span className="text-red-600 font-bold bg-red-50 px-2 py-0.5 rounded text-xs">
                    失敗 ❌
                  </span>
                )}
              </div>
            </div>

            <div className="ml-3 shrink-0 flex flex-col gap-2">
              {(task.status === 'idle' || task.status === 'error') && (
                <button
                  onClick={() => handleDeleteTask(task.id)}
                  className="text-gray-400 hover:text-red-600 text-sm font-bold px-3 py-1.5 transition-colors bg-gray-50 hover:bg-red-50 rounded-lg"
                >
                  削除
                </button>
              )}

              {task.status === 'success' && (
                <button
                  onClick={() => handleStartEdit(task.id)}
                  className="bg-blue-600 text-white text-sm font-bold py-2 px-4 rounded-lg hover:bg-blue-700 shadow-sm"
                >
                  確認・登録
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {isCameraModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60 backdrop-blur-sm px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 flex flex-col items-center transform transition-all">
            <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4 text-5xl">
              ✅
            </div>

            <h3 className="text-xl font-extrabold text-gray-800 mb-2">
              {cameraFiles.length}枚目が撮れました！
            </h3>
            <p className="text-sm text-gray-600 mb-6 text-center leading-relaxed">
              {isCombineMode
                ? '「続けて撮影」すると、これらの画像が1つのタスクとして結合されます。'
                : '「続けて撮影」すると、新しいタスクとして追加されます。'}
            </p>

            <div className="flex flex-col gap-3 w-full">
              <button
                onClick={() => {
                  setIsCameraModalOpen(false)
                  setTimeout(() => cameraInputRef.current?.click(), 100)
                }}
                className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-lg font-extrabold flex items-center justify-center gap-2 shadow-sm transition-colors"
              >
                <span>📸</span>
                続けて撮影（{cameraFiles.length + 1}枚目）
              </button>

              <button
                onClick={handleFinishCamera}
                className="w-full py-3.5 bg-white border-2 border-gray-200 hover:bg-gray-50 text-gray-800 rounded-xl text-lg font-bold flex items-center justify-center gap-2 transition-colors"
              >
                <span>📥</span>
                撮影を終了（タスク一覧へ）
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
