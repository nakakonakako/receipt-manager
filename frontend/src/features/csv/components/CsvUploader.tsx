import React, { useState, useRef, useEffect } from 'react'
import axios from 'axios'
import { analyzeCsv, saveCsv } from '../api/csvApi'
import {
  type CsvMapping,
  type ParsedTransaction,
  type EditingTransaction,
  type CsvPreset,
} from '../types'
import { useApiConfig } from '@/hooks/useApiConfig'
import { supabase } from '@/lib/supabase'
import { CsvAnalysisForm } from './CsvAnalysisForm'
import { CsvEditorTable } from './CsvEditorTable'

export const CsvUploader: React.FC = () => {
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
  const [newPresetName, setNewPresetName] = useState<string>('')

  const { getHeaders } = useApiConfig()

  useEffect(() => {
    const fetchPresets = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return

      const { data, error } = await supabase
        .from('csv_presets')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true })

      if (data && !error) setPresets(data)
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
        console.log('UTF-8デコードに失敗したため、Shift_JISで再試行します...')
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
      const preset = presets.find((p) => p.name === selectedPresetId)
      const result = await analyzeCsv(csvText, preset?.mapping)

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
    if (!newPresetName.trim() || !currentMapping) return

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
      setNewPresetName('')
      alert(`プリセット「${newPresetName}」を保存しました！`)
    }
  }

  const handleRenamePreset = async (id: string) => {
    const preset = presets.find((p) => p.id === id)
    if (!preset) return

    const newName = window.prompt(
      '新しいプリセット名を入力してください',
      preset.name
    )

    if (!newName || newName.trim() === '' || newName === preset.name) return

    const { error } = await supabase
      .from('csv_presets')
      .update({ name: newName.trim() })
      .eq('id', id)

    if (error) {
      alert('プリセットの名前変更中にエラーが発生しました')
      return
    }

    setPresets((prev) =>
      prev.map((p) => (p.id === id ? { ...p, name: newName.trim() } : p))
    )
  }

  const handleDeletePreset = async (id: string) => {
    if (!window.confirm('このプリセットを削除してもよろしいですか？')) return

    const { error } = await supabase.from('csv_presets').delete().eq('id', id)

    if (error) {
      alert('プリセットの削除中にエラーが発生しました')
      return
    }

    setPresets((prev) => prev.filter((p) => p.id !== id))

    if (selectedPresetId === id) setSelectedPresetId('')
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
      handleReset()
    }

    setIsSaving(false)
  }

  return (
    <div className="p-4 space-y-6 max-w-4xl mx-auto">
      <div className="border-2 border-dashed border-gray-300 rounded p-6 text-center bg-white">
        <input
          type="file"
          accept=".csv"
          ref={fileInputRef}
          onChange={handleFileChange}
          className="w-full"
        />
      </div>

      {!csvText && presets.length > 0 && (
        <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm mt-6">
          <h3 className="font-bold text-gray-700 mb-3">
            ⚙️ 保存済みの抽出ルール管理
          </h3>
          <div className="space-y-2">
            {presets.map((p) => (
              <div
                key={p.id}
                className="flex justify-between items-center p-3 bg-gray-50 rounded border border-gray-200"
              >
                <span className="font-bold text-sm text-gray-700">
                  ☁️ {p.name}
                </span>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => handleRenamePreset(p.id!)}
                    className="text-sm px-3 py-1 bg-white border border-gray-300 rounded text-blue-600 hover:bg-blue-50 transition-colors"
                  >
                    ✏️ 名前変更
                  </button>
                  <button
                    onClick={() => handleDeletePreset(p.id!)}
                    className="text-sm px-3 py-1 bg-white border border-gray-300 rounded text-red-600 hover:bg-red-50 transition-colors"
                  >
                    🗑️ 削除
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {csvText && parsedData.length === 0 && (
        <CsvAnalysisForm
          csvText={csvText}
          presets={presets}
          selectedPresetId={selectedPresetId}
          onSelectPreset={setSelectedPresetId}
          isAnalyzing={isAnalyzing}
          onAnalyze={handleAnalyze}
        />
      )}

      {parsedData.length > 0 && (
        <CsvEditorTable
          parsedData={parsedData}
          onDataChange={handleDataChange}
          onDeleteRow={handleDeleteRow}
          newPresetName={newPresetName}
          onNewPresetNameChange={setNewPresetName}
          onSavePreset={handleSavePreset}
          isSaving={isSaving}
          isWaiting={isWaiting}
          waitTime={waitTime}
          progress={progress}
          onReset={handleReset}
          onSaveClick={handleSaveClick}
        />
      )}
    </div>
  )
}
