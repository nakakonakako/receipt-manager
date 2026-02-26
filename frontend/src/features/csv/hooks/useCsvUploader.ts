import { useState, useRef, useEffect } from 'react'
import axios from 'axios'
import { analyzeCsv, saveCsv } from '../api/csvApi'
import {
  type ParsedTransaction,
  type EditingTransaction,
  type CsvPreset,
  type CsvMapping,
} from '../types'
import { useApiConfig } from '@/hooks/useApiConfig'
import { supabase } from '@/lib/supabase'

export const useCsvUploader = () => {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [csvText, setCsvText] = useState<string>('')
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false)
  const [parsedData, setParsedData] = useState<EditingTransaction[]>([])

  const [isSaving, setIsSaving] = useState<boolean>(false)
  const [isWaiting, setIsWaiting] = useState<boolean>(false)
  const [waitTime, setWaitTime] = useState<number>(0)
  const [progress, setProgress] = useState({ current: 0, total: 0 })

  const [presets, setPresets] = useState<CsvPreset[]>([])
  const [selectedPresetId, setSelectedPresetId] = useState<string>('')
  const [currentMapping, setCurrentMapping] = useState<CsvMapping | null>(null)
  const [isLoadingPresets, setIsLoadingPresets] = useState<boolean>(true)
  const [showPresetSaveModal, setShowPresetSaveModal] = useState<boolean>(false)
  const [newPresetName, setNewPresetName] = useState<string>('')

  const [renameTarget, setRenameTarget] = useState<{
    id: string
    name: string
  } | null>(null)
  const [editPresetName, setEditPresetName] = useState<string>('')
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string
    name: string
  } | null>(null)

  const { getHeaders } = useApiConfig()

  useEffect(() => {
    const fetchPresets = async () => {
      setIsLoadingPresets(true)

      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        setIsLoadingPresets(false)
        return
      }

      const { data, error } = await supabase
        .from('csv_presets')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true })

      if (data && !error) setPresets(data)

      setIsLoadingPresets(false)
    }
    fetchPresets()
  }, [])

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0]
      handleReset()

      const buffer = await selectedFile.arrayBuffer()
      let text = ''

      try {
        const utf8Decoder = new TextDecoder('utf-8', { fatal: true })
        text = utf8Decoder.decode(buffer)
      } catch {
        const sjisDecoder = new TextDecoder('shift_jis')
        text = sjisDecoder.decode(buffer)
      }

      setCsvText(text)
    }
  }

  const handleAnalyze = async () => {
    if (!csvText) return
    setIsAnalyzing(true)

    try {
      const preset = presets.find((p) => p.id === selectedPresetId)
      const result = await analyzeCsv(csvText, preset?.mapping)

      if (result.transactions.length === 0) {
        alert(
          'CSVから取引データが抽出できませんでした。\nプリセットが異なっている可能性があります。'
        )
        return
      }

      setParsedData(result.transactions)
      setCurrentMapping(result.mapping)
    } catch (error) {
      console.error('Error analyzing CSV:', error)
      alert('CSVの解析中にエラーが発生しました')
    } finally {
      setIsAnalyzing(false)
    }
  }

  const handleSavePreset = async () => {
    const trimmedName = newPresetName.trim()
    if (!trimmedName || !currentMapping) return

    if (presets.some((p) => p.name === trimmedName)) {
      alert('同名のプリセットが存在します。別の名前を指定してください。')
    }

    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      alert('ユーザーが認証されていません')
      return
    }

    const newPreset = {
      user_id: user.id,
      name: newPresetName,
      mapping: currentMapping,
    }

    const { data, error } = await supabase
      .from('csv_presets')
      .insert([newPreset])
      .select()

    if (error) {
      alert('プリセットの保存中にエラーが発生しました')
      return
    }

    if (data && data.length > 0) {
      setPresets([...presets, data[0]])

      setShowPresetSaveModal(false)
      setNewPresetName('')
      handleReset()
    }
  }

  const handleSkipPresetSave = () => {
    setShowPresetSaveModal(false)
    setNewPresetName('')
    handleReset()
  }

  const openRenameModal = (id: string, currentName: string) => {
    setRenameTarget({ id, name: currentName })
    setEditPresetName(currentName)
  }

  const closeRenameModal = () => {
    setRenameTarget(null)
    setEditPresetName('')
  }

  const executeRenamePreset = async () => {
    if (!renameTarget) return
    const trimmedName = editPresetName.trim()

    if (!trimmedName || trimmedName === renameTarget.name) {
      closeRenameModal()
      return
    }

    if (
      presets.some((p) => p.id !== renameTarget.id && p.name === trimmedName)
    ) {
      alert('同名のプリセットが存在します。別の名前を指定してください。')
      return
    }

    const { error } = await supabase
      .from('csv_presets')
      .update({ name: trimmedName })
      .eq('id', renameTarget.id)
    if (error) {
      alert('プリセットの名前変更中にエラーが発生しました')
      return
    }

    setPresets((prev) =>
      prev.map((p) =>
        p.id === renameTarget.id ? { ...p, name: trimmedName } : p
      )
    )
    closeRenameModal()
  }

  const openDeleteModal = (id: string, name: string) => {
    setDeleteTarget({ id, name })
  }

  const closeDeleteModal = () => {
    setDeleteTarget(null)
  }

  const executeDeletePreset = async () => {
    if (!deleteTarget) return
    const { error } = await supabase
      .from('csv_presets')
      .delete()
      .eq('id', deleteTarget.id)

    if (error) {
      alert('プリセットの削除中にエラーが発生しました')
      return
    }

    setPresets((prev) => prev.filter((p) => p.id !== deleteTarget.id))
    if (selectedPresetId === deleteTarget.id) setSelectedPresetId('')
    closeDeleteModal()
  }

  const handleDataChange = (
    index: number,
    field: keyof ParsedTransaction,
    value: string | number
  ) => {
    const newData = [...parsedData]
    newData[index] = { ...newData[index], [field]: value }
    setParsedData(newData)
  }

  const handleDeleteRow = (index: number) => {
    const newData = parsedData.filter((_, i) => i !== index)
    setParsedData(newData)
  }

  const handleReset = () => {
    setParsedData([])
    setCsvText('')
    setCurrentMapping(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleSaveClick = async () => {
    const headers = await getHeaders()
    if (!headers) return

    setIsSaving(true)
    setProgress({ current: 0, total: 0 })
    const finalData: ParsedTransaction[] = parsedData.map((row) => ({
      ...row,
      price: row.price === '' ? 0 : row.price,
    }))

    const groupedByMonth: Record<string, ParsedTransaction[]> = {}
    finalData.forEach((t) => {
      const month = t.date.substring(0, 7)
      if (!groupedByMonth[month]) {
        groupedByMonth[month] = []
      }
      groupedByMonth[month].push(t)
    })

    const months = Object.keys(groupedByMonth)
    setProgress({ current: 0, total: months.length })

    let currentIdx = 0

    while (currentIdx < months.length) {
      const targetMonth = months[currentIdx]
      const dataToSend = groupedByMonth[targetMonth]

      try {
        await saveCsv(dataToSend, headers)

        currentIdx++
        setProgress({ current: currentIdx, total: months.length })
      } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 429) {
          setIsWaiting(true)

          for (let i = 90; i >= 0; i--) {
            setWaitTime(i)
            await new Promise((resolve) => setTimeout(resolve, 1000))
          }

          setIsWaiting(false)
        } else {
          console.error('Error saving CSV:', error)
          alert(
            'データの保存中にエラーが発生しました。コンソールを確認してください。'
          )
          break
        }
      }
    }

    if (currentIdx === months.length) {
      alert('全てのデータを保存しました！')

      if (selectedPresetId === '' && currentMapping) {
        setShowPresetSaveModal(true)
      } else {
        handleReset()
      }
    }

    setIsSaving(false)
  }

  return {
    fileInputRef,
    isLoadingPresets,
    csvText,
    isAnalyzing,
    parsedData,
    isSaving,
    isWaiting,
    waitTime,
    progress,
    presets,
    selectedPresetId,
    newPresetName,
    showPresetSaveModal,
    renameTarget,
    editPresetName,
    deleteTarget,
    setSelectedPresetId,
    setNewPresetName,
    setEditPresetName,
    handleFileChange,
    handleAnalyze,
    handleSavePreset,
    handleSkipPresetSave,
    openRenameModal,
    closeRenameModal,
    executeRenamePreset,
    openDeleteModal,
    closeDeleteModal,
    executeDeletePreset,
    handleDataChange,
    handleDeleteRow,
    handleReset,
    handleSaveClick,
  }
}
