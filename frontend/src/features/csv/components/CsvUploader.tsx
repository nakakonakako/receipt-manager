import React, { useState, useRef } from 'react'
import axios from 'axios'
import { analyzeCsv, saveCsv } from '../api/csvApi'
import { type ParsedTransaction } from '../types'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { NumberInput } from '@/components/ui/NumberInput'
import { useApiConfig } from '@/hooks/useApiConfig'

type EditingTransaction = Omit<ParsedTransaction, 'price'> & {
  price: number | ''
}

export const CsvUploader: React.FC = () => {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [csvText, setCsvText] = useState<string>('')
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false)
  const [parsedData, setParsedData] = useState<EditingTransaction[]>([])
  const [isSaving, setIsSaving] = useState<boolean>(false)
  const [isWaiting, setIsWaiting] = useState<boolean>(false)
  const [waitTime, setWaitTime] = useState<number>(0)
  const [progress, setProgress] = useState({ current: 0, total: 0 })

  const { getHeaders } = useApiConfig()

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0]
      setParsedData([])

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
      const result = await analyzeCsv(csvText)
      setParsedData(result.transactions)
    } catch (error) {
      console.error('Error analyzing CSV:', error)
    } finally {
      setIsAnalyzing(false)
    }
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
      setParsedData([])
      setCsvText('')

      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
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

      {csvText && parsedData.length === 0 && (
        <div className="bg-gray-50 p-4 rounded border">
          <h3 className="font-bold mb-2 text-gray-700">📄 送信データの確認</h3>
          <p className="text-sm text-gray-600 mb-2">
            以下のCSVデータをAIに送信し、フォーマットを自動解析して一覧表示します。
          </p>
          <pre className="bg-gray-800 text-white p-3 text-xs overflow-x-auto rounded max-h-40 overflow-y-auto mb-4">
            {csvText}
          </pre>

          <Button
            onClick={handleAnalyze}
            disabled={isAnalyzing}
            variant="primary"
          >
            {isAnalyzing ? 'パース処理を実行中...' : 'この内容で解析する'}
          </Button>
        </div>
      )}

      {parsedData.length > 0 && (
        <div className="space-y-4">
          <div className="bg-green-50 p-4 rounded border border-green-200">
            <h3 className="font-bold text-green-800 mb-1">
              ✅ 解析完了 ({parsedData.length} 件)
            </h3>
            <p className="text-sm text-green-700">
              内容を確認してください。クリックすると直接編集できます。不要な行は削除してください。
            </p>
          </div>

          <div className="border border-gray-200 rounded overflow-hidden bg-white max-h-[60vh] overflow-y-auto">
            <table className="w-full text-sm text-left text-gray-500">
              <thead className="text-xs text-gray-700 uppercase bg-gray-50 sticky top-0 shadow-sm">
                <tr>
                  <th className="px-4 py-3 w-2/12">日付</th>
                  <th className="px-4 py-3 w-6/12">店名</th>
                  <th className="px-4 py-3 w-3/12">金額</th>
                  <th className="px-4 py-3 w-1/12 text-center">削除</th>
                </tr>
              </thead>
              <tbody>
                {parsedData.map((row, i) => (
                  <tr key={i} className="bg-white border-b hover:bg-gray-50">
                    <td className="px-2 py-2">
                      <Input
                        type="date"
                        value={row.date}
                        onChange={(e) =>
                          handleDataChange(i, 'date', e.target.value)
                        }
                        className={`w-full ${!row.date ? 'border-red-500 bg-red-50' : ''}`}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <Input
                        value={row.store}
                        onChange={(e) =>
                          handleDataChange(i, 'store', e.target.value)
                        }
                        className="w-full"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <NumberInput
                        value={row.price}
                        onChange={(val) => handleDataChange(i, 'price', val)}
                        className="w-full"
                      />
                    </td>
                    <td className="px-2 py-2 text-center">
                      <Button
                        variant="danger"
                        onClick={() => handleDeleteRow(i)}
                      >
                        ✕
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {isSaving && (
            <div
              className={`p-4 rounded border text-center font-bold ${isWaiting ? 'bg-red-50 border-red-200 text-red-600' : 'bg-blue-50 border-blue-200 text-blue-800'}`}
            >
              {isWaiting ? (
                <p className="animate-pulse">
                  ⚠️ API制限に到達しました。安全に書き込むため {waitTime}{' '}
                  秒待機しています...
                </p>
              ) : (
                <p>
                  保存中... ({progress.current} / {progress.total} ヶ月分 完了)
                </p>
              )}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4">
            <Button
              variant="secondary"
              onClick={() => {
                setParsedData([])
                setCsvText('')
                if (fileInputRef.current) fileInputRef.current.value = ''
              }}
            >
              やり直す
            </Button>
            <Button
              variant="primary"
              onClick={handleSaveClick}
              disabled={isSaving}
            >
              {isSaving ? '保存中...' : `全 ${parsedData.length} 件を保存する`}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
