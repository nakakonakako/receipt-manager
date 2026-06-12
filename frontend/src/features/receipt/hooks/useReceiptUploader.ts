import React, { useState } from 'react'
import axios from 'axios'
import { useApiConfig } from '@/hooks/useApiConfig'
import { type Receipt, type UploadTask } from '../types'
import { analyzeReceipt, saveTransaction } from '../api/receiptApi'
import { toast } from 'sonner'

type EditingState = {
  taskId: string
  resultIndex: number
} | null

type ReceiptUploaderStateCache = {
  tasks: UploadTask[]
  editingState: EditingState
  isCombineMode: boolean
  cameraFiles: File[]
  cameraDraftTaskId: string | null
}

type ReceiptUploaderGlobal = typeof globalThis & {
  __receiptUploaderStateCache?: ReceiptUploaderStateCache
}

const getReceiptUploaderStateCache = (): ReceiptUploaderStateCache => {
  const globalState = globalThis as ReceiptUploaderGlobal
  if (!globalState.__receiptUploaderStateCache) {
    globalState.__receiptUploaderStateCache = {
      tasks: [],
      editingState: null,
      isCombineMode: false,
      cameraFiles: [],
      cameraDraftTaskId: null,
    }
  }
  return globalState.__receiptUploaderStateCache
}

export const useReceiptUploader = () => {
  const { getHeaders } = useApiConfig()
  const stateCache = getReceiptUploaderStateCache()

  const [tasks, setTasks] = useState<UploadTask[]>(stateCache.tasks)
  const [editingState, setEditingState] = useState<EditingState>(
    stateCache.editingState
  )
  const [isCombineMode, setIsCombineMode] = useState(stateCache.isCombineMode)

  const [cameraFiles, setCameraFiles] = useState<File[]>(stateCache.cameraFiles)
  const [isCameraModalOpen, setIsCameraModalOpen] = useState(false)
  const [cameraDraftTaskId, setCameraDraftTaskId] = useState<string | null>(
    stateCache.cameraDraftTaskId
  )

  const setEditingStateWithCache = (next: EditingState) => {
    stateCache.editingState = next
    setEditingState(next)
  }

  const setIsCombineModeWithCache = (next: boolean) => {
    stateCache.isCombineMode = next
    setIsCombineMode(next)
  }

  const setCameraFilesWithCache = (next: File[]) => {
    stateCache.cameraFiles = next
    setCameraFiles(next)
  }

  const setCameraDraftTaskIdWithCache = (next: string | null) => {
    stateCache.cameraDraftTaskId = next
    setCameraDraftTaskId(next)
  }

  const syncTasks = (nextTasks: UploadTask[]) => {
    stateCache.tasks = nextTasks
    setTasks(nextTasks)
  }

  const updateTasks = (updater: (prev: UploadTask[]) => UploadTask[]) => {
    const nextTasks = updater(stateCache.tasks)
    syncTasks(nextTasks)
  }

  const commitCameraFilesToCombineTask = (filesToCommit: File[]) => {
    if (filesToCommit.length === 0) return

    const previewUrls = filesToCommit.map((f) => URL.createObjectURL(f))

    if (cameraDraftTaskId) {
      updateTasks((prev) =>
        prev.map((task) =>
          task.id === cameraDraftTaskId
            ? {
                ...task,
                files: [...task.files, ...filesToCommit],
                previewUrls: [...task.previewUrls, ...previewUrls],
              }
            : task
        )
      )
      return
    }

    const newTask: UploadTask = {
      id: crypto.randomUUID(),
      files: filesToCommit,
      previewUrls,
      status: 'idle',
      results: [],
    }
    updateTasks((prev) => [...prev, newTask])
    setCameraDraftTaskIdWithCache(newTask.id)
  }

  const combineCommittedCount =
    (cameraDraftTaskId
      ? tasks.find((task) => task.id === cameraDraftTaskId)?.files.length
      : 0) ?? 0
  const cameraCapturedCount = isCombineMode
    ? combineCommittedCount + cameraFiles.length
    : cameraFiles.length

  const handleCameraCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0]
      setCameraFilesWithCache([...cameraFiles, file])
      setIsCameraModalOpen(true)
      e.target.value = ''
    }
  }

  const handleContinueCamera = () => {
    if (cameraFiles.length > 0) {
      if (isCombineMode) {
        commitCameraFilesToCombineTask(cameraFiles)
      } else {
        const newTasks: UploadTask[] = cameraFiles.map((file) => ({
          id: crypto.randomUUID(),
          files: [file],
          previewUrls: [URL.createObjectURL(file)],
          status: 'idle',
          results: [],
        }))
        updateTasks((prev) => [...prev, ...newTasks])
      }
      setCameraFilesWithCache([])
    }
    setIsCameraModalOpen(false)
  }

  const handleFinishCamera = () => {
    if (cameraFiles.length === 0) {
      setIsCameraModalOpen(false)
      return
    }

    if (isCombineMode) {
      const totalCount = cameraCapturedCount
      setCameraDraftTaskIdWithCache(null)
      setCameraFilesWithCache([])
      setIsCameraModalOpen(false)
      toast.success(`${totalCount}枚の画像をタスクに追加しました！`)
      return
    }

    const newTasks: UploadTask[] = cameraFiles.map((file) => ({
      id: crypto.randomUUID(),
      files: [file],
      previewUrls: [URL.createObjectURL(file)],
      status: 'idle',
      results: [],
    }))
    updateTasks((prev) => [...prev, ...newTasks])

    setCameraFilesWithCache([])
    setCameraDraftTaskIdWithCache(null)
    setIsCameraModalOpen(false)
    toast.success(`${cameraFiles.length}枚の画像をタスクに追加しました！`)
  }

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
        updateTasks((prev) => [...prev, newTask])
      } else {
        const newTasks: UploadTask[] = newFiles.map((file) => ({
          id: crypto.randomUUID(),
          files: [file],
          previewUrls: [URL.createObjectURL(file)],
          status: 'idle',
          results: [],
        }))
        updateTasks((prev) => [...prev, ...newTasks])
      }

      e.target.value = ''
    }
  }

  const processTask = async (taskId: string) => {
    const headers = await getHeaders()
    if (!headers) return

    updateTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status: 'analyzing' } : t))
    )

    const t = stateCache.tasks.find((task) => task.id === taskId)
    if (!t) return

    try {
      const data = await analyzeReceipt(t.files, headers)

      if (!data || !data.receipts || data.receipts.length === 0) {
        alert(
          '画像からレシートを読み取れませんでした。別の画像でお試しください。'
        )
        updateTasks((prev) =>
          prev.map((t) => (t.id === taskId ? { ...t, status: 'error' } : t))
        )
        return
      }

      updateTasks((prev) =>
        prev.map((t) =>
          t.id === taskId
            ? { ...t, status: 'success', results: data.receipts }
            : t
        )
      )
      toast.success(`${data.receipts.length}枚のレシートを検出しました！`)
    } catch (error) {
      console.error(error)
      if (
        axios.isAxiosError(error) &&
        (error.response?.status === 401 || error.response?.status === 403)
      ) {
        toast.error(
          '認証エラーが発生しました。ログイン状態を確認してください。'
        )
        window.location.reload()
        return
      }
      updateTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, status: 'error' } : t))
      )
      toast.error(
        'レシートの解析中にエラーが発生しました。もう一度お試しください。'
      )
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
    setEditingStateWithCache({ taskId, resultIndex: 0 })
  }

  const getNextDetectedTask = (currentTaskId: string) => {
    const nextTask = stateCache.tasks.find(
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
    const headers = await getHeaders()
    if (!headers) return

    if (!editingState) return
    const { taskId, resultIndex } = editingState
    const currentTask = stateCache.tasks.find((t) => t.id === taskId)

    try {
      await saveTransaction(data, headers)
      toast.success(
        `${data.purchase_date}/${data.store_name} のレシートを保存しました。`
      )

      if (currentTask && resultIndex < currentTask.results.length - 1) {
        setEditingStateWithCache({ taskId, resultIndex: resultIndex + 1 })
      } else {
        const nextEditingState = getNextDetectedTask(taskId)
        updateTasks((prev) => prev.filter((t) => t.id !== taskId))
        if (cameraDraftTaskId === taskId) {
          setCameraDraftTaskIdWithCache(null)
        }
        setEditingStateWithCache(nextEditingState)
      }
    } catch (error) {
      console.error(error)
      toast.error('レシートの保存中にエラーが発生しました。')
    }
  }

  const handleSkipCurrent = () => {
    if (!editingState) return
    const { taskId, resultIndex } = editingState
    const currentTask = stateCache.tasks.find((t) => t.id === taskId)

    alert('このレシートの登録をスキップしました。')

    if (currentTask && resultIndex < currentTask.results.length - 1) {
      setEditingStateWithCache({ taskId, resultIndex: resultIndex + 1 })
    } else {
      const nextEditingState = getNextDetectedTask(taskId)
      updateTasks((prev) => prev.filter((t) => t.id !== taskId))
      if (cameraDraftTaskId === taskId) {
        setCameraDraftTaskIdWithCache(null)
      }
      setEditingStateWithCache(nextEditingState)
    }
  }

  const handleDeleteTask = (taskId: string) => {
    updateTasks((prev) => prev.filter((t) => t.id !== taskId))
    if (cameraDraftTaskId === taskId) {
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
