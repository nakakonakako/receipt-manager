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
    isCameraModalOpen,
    handleCameraCapture,
    handleContinueCamera,
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
    <div className="mx-auto max-w-2xl space-y-6 p-1 sm:p-2">
      <h2 className="text-center text-xl font-bold tracking-tight text-[var(--rm-text-primary)] sm:text-2xl">
        レシート一括登録
      </h2>

      <div className="flex items-center gap-3 rounded-lg border border-[var(--rm-border-subtle)] bg-[var(--rm-surface-subtle)] p-3">
        <label className="flex min-h-11 cursor-pointer items-center">
          <div className="relative">
            <input
              type="checkbox"
              className="peer sr-only"
              checked={isCombineMode}
              onChange={() => setIsCombineMode(!isCombineMode)}
            />
            <div
              className={`block h-7 w-12 rounded-full transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--rm-focus)] ${isCombineMode ? 'bg-[var(--rm-receipt)]' : 'bg-stone-300'}`}
            ></div>
            <div
              className={`absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow-sm transition-transform ${isCombineMode ? 'translate-x-5' : ''}`}
            ></div>
          </div>
          <div className="ml-3 text-sm font-semibold text-[var(--rm-text-secondary)]">
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
          className={`flex min-h-36 flex-1 flex-col items-center justify-center gap-2 rounded-xl border p-5 text-center text-[var(--rm-receipt)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rm-focus)] ${isCombineMode ? 'border-[var(--rm-receipt)] bg-[var(--rm-receipt-subtle)] hover:bg-blue-100' : 'border-[var(--rm-border)] bg-[var(--rm-surface)] hover:bg-[var(--rm-surface-subtle)]'}`}
        >
          <svg aria-hidden="true" className="h-9 w-9" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" d="M3 8.5A1.5 1.5 0 0 1 4.5 7h2l1.2-2h8.6l1.2 2h2A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5v-9Z" />
            <circle cx="12" cy="12.5" r="3.5" strokeWidth="1.7" />
          </svg>
          <span className="font-semibold text-[var(--rm-text-primary)]">カメラで撮影</span>
          <span className="text-xs text-[var(--rm-text-muted)]">
            {isCombineMode ? '続けて撮ると1枚に結合' : '1枚ずつ別々に解析'}
          </span>
        </button>

        <label
          className={`flex min-h-36 flex-1 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-5 text-center transition-colors focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--rm-focus)] ${isCombineMode ? 'border-[var(--rm-receipt)] bg-[var(--rm-receipt-subtle)] hover:bg-blue-100' : 'border-[var(--rm-border)] bg-[var(--rm-surface)] hover:bg-[var(--rm-surface-subtle)]'}`}
        >
          <svg aria-hidden="true" className="h-9 w-9 text-[var(--rm-text-secondary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" d="M3 7.5A1.5 1.5 0 0 1 4.5 6h5l2 2h8A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5v-10Z" />
          </svg>
          <span className="font-semibold text-[var(--rm-text-primary)]">ファイルを選択</span>
          <span className="text-xs text-[var(--rm-text-muted)] text-center px-2">
            JPEG / PNG / WebP・10枚まで・合計12MiB
          </span>
          <input
            type="file"
            multiple
            accept="image/*"
            onChange={handleFileChange}
            className="sr-only"
          />
        </label>
      </div>

      {tasks.some((t) => t.status === 'idle') && (
        <div className="flex justify-center border-t border-[var(--rm-border-subtle)] pt-4 sm:justify-end">
          <button
            onClick={handleStartAll}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-[var(--rm-receipt)] px-6 py-3 text-base font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rm-focus)] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
          >
            まとめて解析開始
          </button>
        </div>
      )}

      <div className="space-y-3">
        {tasks.map((task) => (
          <div
            key={task.id}
            className="flex min-w-0 flex-col gap-3 rounded-lg border border-[var(--rm-border-subtle)] bg-[var(--rm-surface)] p-3 transition-shadow hover:shadow-sm sm:flex-row sm:items-center sm:gap-0 sm:p-4"
          >
            <div className="flex items-center flex-1 min-w-0">
              <div className="relative mr-3 sm:mr-4 shrink-0">
                <img
                  src={task.previewUrls[0]}
                  alt="preview"
                  className="h-14 w-14 rounded-lg border border-[var(--rm-border-subtle)] object-cover sm:h-16 sm:w-16"
                />
                {task.previewUrls.length > 1 && (
                  <span className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full border-2 border-[var(--rm-surface)] bg-[var(--rm-receipt)] text-xs font-semibold text-white shadow-sm">
                    {task.previewUrls.length}
                  </span>
                )}
              </div>

              <div className="flex-1 min-w-0 pr-2">
                <div className="truncate text-sm font-semibold text-[var(--rm-text-primary)]">
                  {task.files.length > 1
                    ? `${task.files[0].name} ほか ${task.files.length - 1}件`
                    : task.files[0].name}
                </div>

                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {task.status === 'idle' && (
                    <span className="inline-block whitespace-nowrap rounded-md bg-[var(--rm-surface-muted)] px-2 py-0.5 text-xs font-semibold text-[var(--rm-text-secondary)]">
                      解析待ち
                    </span>
                  )}
                  {task.status === 'analyzing' && (
                    <span className="inline-block whitespace-nowrap rounded-md bg-[var(--rm-receipt-subtle)] px-2 py-0.5 text-xs font-semibold text-[var(--rm-receipt)]">
                      解析中...
                    </span>
                  )}
                  {task.status === 'success' && (
                    <span className="inline-block whitespace-nowrap rounded-md bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-900">
                      解析完了 ({task.results.length}枚検出)
                    </span>
                  )}
                  {task.status === 'error' && (
                    <span className="inline-block whitespace-nowrap rounded-md bg-[var(--rm-danger-subtle)] px-2 py-0.5 text-xs font-semibold text-[var(--rm-danger)]">
                      失敗
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex shrink-0 justify-end border-t border-[var(--rm-border-subtle)] pt-3 sm:ml-3 sm:border-0 sm:pt-0">
              {(task.status === 'idle' || task.status === 'error') && (
                <button
                  onClick={() => handleDeleteTask(task.id)}
                  className="min-h-11 w-full rounded-md bg-[var(--rm-surface-muted)] px-4 py-2 text-center text-sm font-semibold text-[var(--rm-text-secondary)] transition-colors hover:bg-[var(--rm-danger-subtle)] hover:text-[var(--rm-danger)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rm-focus)] sm:w-auto"
                >
                  削除
                </button>
              )}

              {task.status === 'success' && (
                <button
                  onClick={() => handleStartEdit(task.id)}
                  className="flex min-h-11 w-full items-center justify-center gap-1 rounded-md bg-[var(--rm-receipt)] px-4 py-2.5 text-center text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rm-focus)] sm:w-auto"
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
          <div className="rm-card flex w-full max-w-sm flex-col items-center p-6 shadow-[var(--rm-shadow-popover)]">

            <h3 className="mb-6 text-xl font-bold text-[var(--rm-text-primary)]">
              撮影できました！
            </h3>

            <div className="flex flex-col gap-3 w-full">
              <button
                onClick={() => {
                  handleContinueCamera()
                  setTimeout(() => cameraInputRef.current?.click(), 100)
                }}
                className="flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-[var(--rm-receipt)] py-3.5 text-base font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rm-focus)]"
              >
                <svg aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" d="M3 8.5A1.5 1.5 0 0 1 4.5 7h2l1.2-2h8.6l1.2 2h2A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5v-9Z" />
                  <circle cx="12" cy="12.5" r="3.5" strokeWidth="1.7" />
                </svg>
                続けて撮影
              </button>

              <button
                onClick={handleFinishCamera}
                className="flex min-h-12 w-full items-center justify-center gap-2 rounded-md border border-[var(--rm-border)] bg-[var(--rm-surface)] py-3.5 text-base font-semibold text-[var(--rm-text-primary)] transition-colors hover:bg-[var(--rm-surface-subtle)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rm-focus)]"
              >
                <svg aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="m5 12 4.5 4.5L19 7" />
                </svg>
                撮影を終了
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
