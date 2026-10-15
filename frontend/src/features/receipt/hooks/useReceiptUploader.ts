import React, { useState, useSyncExternalStore } from 'react'
import { toast } from 'sonner'
import { useApiConfig } from '@/hooks/useApiConfig'
import { useAuth } from '@/contexts/AuthContext'
import { type Receipt, type UploadTask } from '../types'
import { analyzeReceipt, saveTransaction } from '../api/receiptApi'
import {
  formatReceiptImagePreflightToast,
  validateReceiptImageSelection,
} from '../utils/receiptImageLimits'
import { classifyReceiptAnalysisError } from './receiptAnalysisError'
import { selectIdleTaskIds } from './receiptAnalysisQueue'
import {
  receiptUploaderStateCache,
  revokeReceiptUploaderPreviewUrls,
  type ReceiptUploaderEditingState,
  type ReceiptUploaderRequestContext,
  type ReceiptUploaderState,
} from './receiptUploaderStateCache'

const sameEditingState = (
  left: ReceiptUploaderEditingState,
  right: ReceiptUploaderEditingState
) => left?.taskId === right?.taskId && left?.resultIndex === right?.resultIndex

export const useReceiptUploader = () => {
  const { getHeaders } = useApiConfig()
  const { session } = useAuth()
  const ownerUserId = session?.user.id ?? null
  const snapshot = useSyncExternalStore(
    receiptUploaderStateCache.subscribe,
    receiptUploaderStateCache.getSnapshot,
    receiptUploaderStateCache.getSnapshot
  )
  const ownedSnapshot = snapshot.ownerUserId === ownerUserId ? snapshot : null
  const tasks = ownedSnapshot?.tasks ?? []
  const editingState = ownedSnapshot?.editingState ?? null
  const isCombineMode = ownedSnapshot?.isCombineMode ?? false
  const cameraFiles = ownedSnapshot?.cameraFiles ?? []
  const cameraDraftTaskId = ownedSnapshot?.cameraDraftTaskId ?? null
  const requestContext = ownerUserId
    ? receiptUploaderStateCache.getRequestContext(ownerUserId)
    : null

  const [isCameraModalOpen, setIsCameraModalOpen] = useState(false)

  const updateCache = (
    context: ReceiptUploaderRequestContext | null,
    updater: (state: ReceiptUploaderState) => ReceiptUploaderState
  ) => (context ? receiptUploaderStateCache.update(context, updater) : false)

  const updateTasks = (
    updater: (previous: UploadTask[]) => UploadTask[],
    context = requestContext
  ) =>
    updateCache(context, (state) => ({
      ...state,
      tasks: updater(state.tasks),
    }))

  const setEditingStateWithCache = (
    next: ReceiptUploaderEditingState,
    context = requestContext
  ) => updateCache(context, (state) => ({ ...state, editingState: next }))

  const setIsCombineModeWithCache = (next: boolean) =>
    updateCache(requestContext, (state) => ({ ...state, isCombineMode: next }))

  const setCameraFilesWithCache = (next: File[], context = requestContext) =>
    updateCache(context, (state) => ({ ...state, cameraFiles: next }))

  const setCameraDraftTaskIdWithCache = (
    next: string | null,
    context = requestContext
  ) => updateCache(context, (state) => ({ ...state, cameraDraftTaskId: next }))

  const getOwnedSnapshot = (context: ReceiptUploaderRequestContext) =>
    receiptUploaderStateCache.isCurrent(context)
      ? receiptUploaderStateCache.getSnapshot()
      : null

  const rejectInvalidReceiptFiles = async (
    files: File[],
    combineMode: boolean
  ): Promise<boolean> => {
    const result = await validateReceiptImageSelection(files, { combineMode })
    if (!result.ok) {
      toast.error(formatReceiptImagePreflightToast(result))
      return false
    }
    return true
  }

  const appendTasks = (newTasks: UploadTask[], context = requestContext) => {
    if (!updateTasks((previous) => [...previous, ...newTasks], context)) {
      revokeReceiptUploaderPreviewUrls(
        newTasks.flatMap((task) => task.previewUrls)
      )
    }
  }

  const commitCameraFilesToCombineTask = (
    filesToCommit: File[],
    context = requestContext
  ) => {
    if (filesToCommit.length === 0 || !context) return
    const current = getOwnedSnapshot(context)
    if (!current) return

    const previewUrls = filesToCommit.map((file) => URL.createObjectURL(file))
    const draftTask = current.cameraDraftTaskId
      ? current.tasks.find((task) => task.id === current.cameraDraftTaskId)
      : undefined

    if (draftTask) {
      const didUpdate = updateTasks(
        (previous) =>
          previous.map((task) =>
            task.id === draftTask.id
              ? {
                  ...task,
                  files: [...task.files, ...filesToCommit],
                  previewUrls: [...task.previewUrls, ...previewUrls],
                }
              : task
          ),
        context
      )
      if (!didUpdate) revokeReceiptUploaderPreviewUrls(previewUrls)
      return
    }

    const newTask: UploadTask = {
      id: crypto.randomUUID(),
      files: filesToCommit,
      previewUrls,
      status: 'idle',
      results: [],
    }
    appendTasks([newTask], context)
    setCameraDraftTaskIdWithCache(newTask.id, context)
  }

  const combineCommittedCount =
    (cameraDraftTaskId
      ? tasks.find((task) => task.id === cameraDraftTaskId)?.files.length
      : 0) ?? 0
  const cameraCapturedCount = isCombineMode
    ? combineCommittedCount + cameraFiles.length
    : cameraFiles.length

  const handleCameraCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (
      !requestContext ||
      !receiptUploaderStateCache.isCurrent(requestContext)
    ) {
      e.target.value = ''
      return
    }
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0]
      void (async () => {
        const current = getOwnedSnapshot(requestContext)
        if (!current) return

        const pendingCombineFiles = current.isCombineMode
          ? [
              ...(current.cameraDraftTaskId
                ? (current.tasks.find((task) => task.id === current.cameraDraftTaskId)
                    ?.files ?? [])
                : []),
              ...current.cameraFiles,
              file,
            ]
          : [file]

        if (
          !(await rejectInvalidReceiptFiles(
            pendingCombineFiles,
            current.isCombineMode
          ))
        ) {
          return
        }

        const didUpdate = updateCache(requestContext, (state) => ({
          ...state,
          cameraFiles: [...state.cameraFiles, file],
        }))
        if (didUpdate) setIsCameraModalOpen(true)
      })()
      e.target.value = ''
    }
  }

  const handleContinueCamera = () => {
    if (!requestContext) return
    const current = getOwnedSnapshot(requestContext)
    if (!current) return

    if (current.cameraFiles.length > 0) {
      if (current.isCombineMode) {
        commitCameraFilesToCombineTask(current.cameraFiles, requestContext)
      } else {
        const newTasks = current.cameraFiles.map((file) => ({
          id: crypto.randomUUID(),
          files: [file],
          previewUrls: [URL.createObjectURL(file)],
          status: 'idle' as const,
          results: [],
        }))
        appendTasks(newTasks, requestContext)
      }
      setCameraFilesWithCache([], requestContext)
    }
    setIsCameraModalOpen(false)
  }

  const handleFinishCamera = () => {
    if (!requestContext) return
    const current = getOwnedSnapshot(requestContext)
    if (!current) return

    if (current.cameraFiles.length === 0) {
      setIsCameraModalOpen(false)
      return
    }

    if (current.isCombineMode) {
      const committedCount = current.cameraDraftTaskId
        ? (current.tasks.find((task) => task.id === current.cameraDraftTaskId)
            ?.files.length ?? 0)
        : 0
      const totalCount = committedCount + current.cameraFiles.length
      commitCameraFilesToCombineTask(current.cameraFiles, requestContext)
      setCameraDraftTaskIdWithCache(null, requestContext)
      setCameraFilesWithCache([], requestContext)
      setIsCameraModalOpen(false)
      toast.success(`${totalCount}枚の画像をタスクに追加しました！`)
      return
    }

    const newTasks = current.cameraFiles.map((file) => ({
      id: crypto.randomUUID(),
      files: [file],
      previewUrls: [URL.createObjectURL(file)],
      status: 'idle' as const,
      results: [],
    }))
    appendTasks(newTasks, requestContext)

    setCameraFilesWithCache([], requestContext)
    setCameraDraftTaskIdWithCache(null, requestContext)
    setIsCameraModalOpen(false)
    toast.success('画像をタスクに追加しました！')
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (
      !requestContext ||
      !receiptUploaderStateCache.isCurrent(requestContext)
    ) {
      e.target.value = ''
      return
    }
    if (e.target.files && e.target.files.length > 0) {
      const newFiles = Array.from(e.target.files)
      const current = getOwnedSnapshot(requestContext)
      if (!current) {
        e.target.value = ''
        return
      }

      void (async () => {
        if (
          !(await rejectInvalidReceiptFiles(newFiles, current.isCombineMode))
        ) {
          return
        }

        if (current.isCombineMode) {
          appendTasks(
            [
              {
                id: crypto.randomUUID(),
                files: newFiles,
                previewUrls: newFiles.map((file) => URL.createObjectURL(file)),
                status: 'idle',
                results: [],
              },
            ],
            requestContext
          )
        } else {
          appendTasks(
            newFiles.map((file) => ({
              id: crypto.randomUUID(),
              files: [file],
              previewUrls: [URL.createObjectURL(file)],
              status: 'idle' as const,
              results: [],
            })),
            requestContext
          )
        }
      })()

      e.target.value = ''
    }
  }

  const processTask = async (
    taskId: string,
    context: ReceiptUploaderRequestContext | null = requestContext
  ) => {
    if (!context) return
    const startingState = getOwnedSnapshot(context)
    const startingTask = startingState?.tasks.find((task) => task.id === taskId)
    if (!startingTask || startingTask.status !== 'idle') return

    try {
      const headers = await getHeaders()
      if (!headers || !receiptUploaderStateCache.isCurrent(context)) return

      const currentTask = receiptUploaderStateCache
        .getSnapshot()
        .tasks.find((task) => task.id === taskId)
      if (
        !currentTask ||
        currentTask.status !== 'idle' ||
        currentTask.files !== startingTask.files
      ) {
        return
      }

      if (
        !updateTasks(
          (previous) =>
            previous.map((task) =>
              task.id === taskId ? { ...task, status: 'analyzing' } : task
            ),
          context
        )
      ) {
        return
      }

      const preflight = await validateReceiptImageSelection(startingTask.files, {
        combineMode: true,
      })
      if (!preflight.ok) {
        toast.error(formatReceiptImagePreflightToast(preflight))
        updateTasks(
          (previous) =>
            previous.map((task) =>
              task.id === taskId ? { ...task, status: 'error' } : task
            ),
          context
        )
        return
      }

      const data = await analyzeReceipt(startingTask.files, headers)
      if (!receiptUploaderStateCache.isCurrent(context)) return

      if (!data || !data.receipts || data.receipts.length === 0) {
        alert(
          '画像からレシートを読み取れませんでした。別の画像でお試しください。'
        )
        updateTasks(
          (previous) =>
            previous.map((task) =>
              task.id === taskId ? { ...task, status: 'error' } : task
            ),
          context
        )
        return
      }

      const didUpdate = updateTasks(
        (previous) =>
          previous.map((task) =>
            task.id === taskId
              ? { ...task, status: 'success', results: data.receipts }
              : task
          ),
        context
      )
      if (didUpdate) {
        toast.success(`${data.receipts.length}枚のレシートを検出しました！`)
      }
    } catch (error) {
      if (!receiptUploaderStateCache.isCurrent(context)) return
      const failure = classifyReceiptAnalysisError(error)
      if (failure.kind === 'validation') {
        toast.error(failure.message)
        updateTasks(
          (previous) =>
            previous.map((task) =>
              task.id === taskId ? { ...task, status: 'error' } : task
            ),
          context
        )
        return
      }
      if (failure.kind === 'auth') {
        toast.error(
          '認証エラーが発生しました。ログイン状態を確認してください。'
        )
        window.location.reload()
        return
      }
      const didUpdate = updateTasks(
        (previous) =>
          previous.map((task) =>
            task.id === taskId ? { ...task, status: 'error' } : task
          ),
        context
      )
      if (didUpdate) {
        toast.error(
          failure.kind === 'rate_limit'
            ? failure.message
            : 'レシートの解析中にエラーが発生しました。もう一度お試しください。'
        )
      }
    }
  }

  const handleStartAll = () => {
    if (!requestContext) return
    receiptUploaderStateCache.startAnalysisQueue(
      requestContext,
      selectIdleTaskIds(tasks),
      (taskId, context) => processTask(taskId, context)
    )
  }

  const handleStartEdit = (taskId: string) => {
    setEditingStateWithCache({ taskId, resultIndex: 0 })
  }

  const getNextDetectedTask = (
    currentTaskId: string,
    context: ReceiptUploaderRequestContext
  ) => {
    const current = getOwnedSnapshot(context)
    const nextTask = current?.tasks.find(
      (task) =>
        task.id !== currentTaskId &&
        task.status === 'success' &&
        task.results.length > 0
    )

    if (!nextTask) return null
    return {
      taskId: nextTask.id,
      resultIndex: 0,
    }
  }

  const handleSaveCurrent = async (data: Receipt) => {
    if (!requestContext || !editingState) return
    const context = requestContext
    const startingEditingState = editingState
    const startingState = getOwnedSnapshot(context)
    const startingTask = startingState?.tasks.find(
      (task) => task.id === startingEditingState.taskId
    )
    if (!startingTask) return

    try {
      const headers = await getHeaders()
      if (!headers || !receiptUploaderStateCache.isCurrent(context)) return

      const currentBeforeSave = receiptUploaderStateCache.getSnapshot()
      const taskBeforeSave = currentBeforeSave.tasks.find(
        (task) => task.id === startingEditingState.taskId
      )
      if (
        !taskBeforeSave ||
        taskBeforeSave.files !== startingTask.files ||
        !sameEditingState(currentBeforeSave.editingState, startingEditingState)
      ) {
        return
      }

      await saveTransaction(data, headers)
      if (!receiptUploaderStateCache.isCurrent(context)) return

      const currentAfterSave = receiptUploaderStateCache.getSnapshot()
      const currentTask = currentAfterSave.tasks.find(
        (task) => task.id === startingEditingState.taskId
      )
      if (
        !currentTask ||
        !sameEditingState(currentAfterSave.editingState, startingEditingState)
      ) {
        return
      }

      toast.success(
        `${data.purchase_date}/${data.store_name} のレシートを保存しました。`
      )

      const { taskId, resultIndex } = startingEditingState
      if (resultIndex < currentTask.results.length - 1) {
        setEditingStateWithCache(
          { taskId, resultIndex: resultIndex + 1 },
          context
        )
      } else {
        const nextEditingState = getNextDetectedTask(taskId, context)
        updateTasks(
          (previous) => previous.filter((task) => task.id !== taskId),
          context
        )
        if (
          receiptUploaderStateCache.getSnapshot().cameraDraftTaskId === taskId
        ) {
          setCameraDraftTaskIdWithCache(null, context)
        }
        setEditingStateWithCache(nextEditingState, context)
      }
    } catch {
      if (
        !receiptUploaderStateCache.isCurrent(context) ||
        !sameEditingState(
          receiptUploaderStateCache.getSnapshot().editingState,
          startingEditingState
        )
      ) {
        return
      }
      toast.error('レシートの保存中にエラーが発生しました。')
    }
  }

  const handleSkipCurrent = () => {
    if (!requestContext || !editingState) return
    const current = getOwnedSnapshot(requestContext)
    if (!current) return

    const { taskId, resultIndex } = editingState
    const currentTask = current.tasks.find((task) => task.id === taskId)
    if (!currentTask) return

    alert('このレシートの登録をスキップしました。')

    if (resultIndex < currentTask.results.length - 1) {
      setEditingStateWithCache({ taskId, resultIndex: resultIndex + 1 })
    } else {
      const nextEditingState = getNextDetectedTask(taskId, requestContext)
      updateTasks((previous) => previous.filter((task) => task.id !== taskId))
      if (
        receiptUploaderStateCache.getSnapshot().cameraDraftTaskId === taskId
      ) {
        setCameraDraftTaskIdWithCache(null)
      }
      setEditingStateWithCache(nextEditingState)
    }
  }

  const handleDeleteTask = (taskId: string) => {
    if (!requestContext) return
    updateTasks((previous) => previous.filter((task) => task.id !== taskId))
    if (receiptUploaderStateCache.getSnapshot().cameraDraftTaskId === taskId) {
      setCameraDraftTaskIdWithCache(null)
    }
  }

  return {
    tasks,
    editingState,
    isCombineMode,
    setIsCombineMode: setIsCombineModeWithCache,
    handleFileChange,
    handleStartAll,
    handleStartEdit,
    handleSaveCurrent,
    handleSkipCurrent,
    handleDeleteTask,
    cameraFiles,
    cameraCapturedCount,
    isCameraModalOpen,
    setIsCameraModalOpen,
    handleCameraCapture,
    handleContinueCamera,
    handleFinishCamera,
  }
}
