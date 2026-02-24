import React, { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useApiConfig } from '@/hooks/useApiConfig'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase'
import { searchReceipts } from '../api/searchApi'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { type Message } from '../types'

export const ChatInterface: React.FC = () => {
  const { getHeaders } = useApiConfig()
  const { session } = useAuth()

  const messagesEndRef = useRef<HTMLDivElement>(null)

  const [query, setQuery] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [historyQueries, setHistoryQueries] = useState<string[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [dataType, setDataType] = useState('all')
  const [period, setPeriod] = useState('3months')

  useEffect(() => {
    const fetchHistory = async () => {
      if (!session?.user?.id) return

      const { data, error } = await supabase
        .from('chat_messages')
        .select('*')
        .order('created_at', { ascending: true })

      if (error) {
        console.error('履歴の取得に失敗しました:', error)
        return
      }

      if (data) {
        setMessages(
          data.map((d) => ({
            role: d.role as 'user' | 'assistant',
            content: d.content,
          }))
        )

        const userQueries = data
          .filter((d) => d.role === 'user')
          .map((d) => d.content)
        setHistoryQueries(Array.from(new Set(userQueries)))
      }
    }

    fetchHistory()
  }, [session])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'auto' })
  }, [messages])

  const handleSend = async () => {
    const headers = getHeaders()
    if (!headers || !query.trim() || !session?.user?.id) return

    const currentQuery = query
    const userMessage: Message = { role: 'user', content: currentQuery }

    setMessages((prev) => [...prev, userMessage])
    setQuery('')
    setShowSuggestions(false)
    setIsLoading(true)

    try {
      await supabase.from('chat_messages').insert({
        user_id: session.user.id,
        role: 'user',
        content: currentQuery,
      })

      const answer = await searchReceipts(
        currentQuery,
        dataType,
        period,
        headers
      )
      const assistantMessage: Message = { role: 'assistant', content: answer }

      setMessages((prev) => [...prev, assistantMessage])

      await supabase.from('chat_messages').insert({
        user_id: session.user.id,
        role: 'assistant',
        content: answer,
      })

      if (!historyQueries.includes(currentQuery)) {
        setHistoryQueries((prev) => [...prev, currentQuery])
      }
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

  const filteredSuggestions = historyQueries.filter(
    (q) => q.toLowerCase().includes(query.toLowerCase()) && q !== query
  )

  return (
    <div className="flex flex-col h-[600px] bg-gray-50 rounded-xl shadow-md overflow-hidden relative">
      <div className="bg-blue-600 p-4 text-white font-bold flex justify-between items-center">
        <span>家計簿AIチャット 🤖</span>
      </div>

      <div className="bg-blue-50 border-b border-blue-100 px-4 py-2 flex gap-4 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-gray-600 font-medium text-xs">対象データ:</span>
          <select
            value={dataType}
            onChange={(e) => setDataType(e.target.value)}
            className="bg-white border border-gray-300 rounded px-2 py-1 text-gray-700 outline-none focus:border-blue-500"
          >
            <option value="all">すべて</option>
            <option value="receipt">レシート詳細のみ</option>
            <option value="log">決済履歴のみ</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-gray-600 font-medium text-xs">対象期間:</span>
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="bg-white border border-gray-300 rounded px-2 py-1 text-gray-700 outline-none focus:border-blue-500"
          >
            <option value="3months">過去3ヶ月</option>
            <option value="1month">今月のみ</option>
            <option value="all">全期間</option>
          </select>
        </div>
      </div>

      <div className="flex-1 p-4 overflow-y-auto space-y-4">
        {messages.length === 0 && !isLoading && (
          <div className="text-center text-gray-400 mt-10">
            こんにちは！過去のデータから何でも検索できます。
          </div>
        )}

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

        <div ref={messagesEndRef} />
      </div>

      <div className="p-4 bg-white border-t border-gray-200 flex flex-col relative">
        {showSuggestions && query.trim() && filteredSuggestions.length > 0 && (
          <div className="absolute bottom-full left-0 mb-2 w-full bg-white border border-gray-200 rounded-lg shadow-xl z-20 max-h-48 overflow-y-auto">
            <div className="text-xs text-gray-500 bg-gray-50 px-3 py-2 border-b font-bold">
              過去の質問から検索
            </div>
            {filteredSuggestions.map((suggestion, index) => (
              <div
                key={index}
                onClick={() => {
                  setQuery(suggestion)
                  setShowSuggestions(false)
                }}
                className="px-4 py-3 text-sm text-gray-700 hover:bg-blue-50 cursor-pointer border-b last:border-0 transition-colors"
              >
                🔍 {suggestion}
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <Input
              placeholder="質問を入力... (過去の質問も検索できます)"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setShowSuggestions(true)
              }}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
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
    </div>
  )
}
