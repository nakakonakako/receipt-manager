import React, { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useApiConfig } from '@/hooks/useApiConfig'
import { searchReceipts } from '../api/searchApi'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { type Message } from '../types'

export const ChatInterface: React.FC = () => {
  const { getHeaders } = useApiConfig()

  const [query, setQuery] = useState('')
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: 'こんにちは！レシートに関する質問があればどうぞ。',
    },
  ])
  const [isLoading, setIsLoading] = useState(false)

  const handleSend = async () => {
    const headers = getHeaders()
    if (!headers) return

    if (!query.trim()) return

    const userMessage: Message = { role: 'user', content: query }
    setMessages((prev) => [...prev, userMessage])
    setQuery('')
    setIsLoading(true)

    try {
      const answer = await searchReceipts(userMessage.content, headers)
      const assistantMessage: Message = { role: 'assistant', content: answer }
      setMessages((prev) => [...prev, assistantMessage])
    } catch (error) {
      console.error('Error fetching answer:', error)
      const errorMessage: Message = {
        role: 'assistant',
        content: '申し訳ありませんが、質問の処理中にエラーが発生しました。',
      }
      setMessages((prev) => [...prev, errorMessage])
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-[600px] bg-gray-50 rounded-xl shadow-md overflow-hidden">
      {/* ヘッダー */}
      <div className="bg-blue-600 p-4 text-white font-bold">
        家計簿AIチャット 🤖
      </div>

      {/* チャットエリア (スクロール可能) */}
      <div className="flex-1 p-4 overflow-y-auto space-y-4">
        {messages.map((msg, index) => (
          <div
            key={index}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-lg p-3 whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-blue-500 text-white rounded-br-none'
                  : 'bg-white text-gray-800 shadow rounded-bl-none prose prose-sm max-w-none'
              }`}
            >
              {msg.role === 'assistant' ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {msg.content}
                </ReactMarkdown>
              ) : (
                msg.content
              )}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-gray-200 text-gray-500 rounded-lg p-3 text-sm animate-pulse">
              考え中...
            </div>
          </div>
        )}
      </div>

      {/* 入力エリア */}
      <div className="p-4 bg-white border-t border-gray-200 flex gap-2 items-end">
        <div className="flex-1">
          <Input
            placeholder="質問を入力..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) =>
              e.key === 'Enter' && !e.nativeEvent.isComposing && handleSend()
            }
          />
        </div>
        <Button onClick={handleSend} disabled={isLoading || !query.trim()}>
          送信
        </Button>
      </div>
    </div>
  )
}
