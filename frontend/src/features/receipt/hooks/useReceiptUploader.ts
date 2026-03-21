import React, { useState } from 'react'
import axios from 'axios'
import { useApiConfig } from '@/hooks/useApiConfig'
import { type Receipt, type UploadTask } from '../types'
import { analyzeReceipt, saveTransaction } from '../api/receiptApi'
import { toast } from 'sonner'

export const useReceiptUploader = () => {
  const { getHeaders } = useApiConfig()

  const [tasks, setTasks] = useState<UploadTask[]>([])
  const [editingState, setEditingState] = useState<{
    taskId: string
    resultIndex: number
  } | null>(null)
  const [isCombineMode, setIsCombineMode] = useState(false)

  const [cameraFiles, setCameraFiles] = useState<File[]>([])
  const [isCameraModalOpen, setIsCameraModalOpen] = useState(false)

  const handleCameraCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0]
      setCameraFiles((prev) => [...prev, file])
      setIsCameraModalOpen(true)
      e.target.value = ''
    }
  }

  const handleFinishCamera = () => {
    if (cameraFiles.length === 0) return

    if (isCombineMode) {
      const newTask: UploadTask = {
        id: crypto.randomUUID(),
        files: cameraFiles,
        previewUrls: cameraFiles.map((f) => URL.createObjectURL(f)),
        status: 'idle',
        results: [],
      }
      setTasks((prev) => [...prev, newTask])
    } else {
      const newTasks: UploadTask[] = cameraFiles.map((file) => ({
        id: crypto.randomUUID(),
        files: [file],
        previewUrls: [URL.createObjectURL(file)],
        status: 'idle',
        results: [],
      }))
      setTasks((prev) => [...prev, ...newTasks])
    }

    setCameraFiles([])
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
    const headers = await getHeaders()
    if (!headers) return

    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status: 'analyzing' } : t))
    )

    const t = tasks.find((t) => t.id === taskId)
    if (!t) return

    try {
      const data = await analyzeReceipt(t.files, headers)

      if (!data || !data.receipts || data.receipts.length === 0) {
        alert(
          '画像からレシートを読み取れませんでした。別の画像でお試しください。'
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
      setTasks((prev) =>
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
      toast.success(
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
      toast.error('レシートの保存中にエラーが発生しました。')
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
  const handleDeleteTask = (taskId: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== taskId))
  }

  return {
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
  }
}
