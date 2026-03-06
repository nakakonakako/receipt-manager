import React, { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
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
  const [isFetchingHistory, setIsFetchingHistory] = useState(true)
  const [historyQueries, setHistoryQueries] = useState<string[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [dataType, setDataType] = useState('all')
  const [period, setPeriod] = useState('3months')

  useEffect(() => {
    const fetchHistory = async () => {
      if (!session?.user?.id) return

      setIsFetchingHistory(true)

      const { data, error } = await supabase
        .from('chat_messages')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(30)

      if (error) {
        console.error('履歴の取得に失敗しました:', error)
        setIsFetchingHistory(false)
        return
      }

      if (data) {
        const chronologicalData = data.reverse()

        setMessages(
          chronologicalData.map((d) => ({
            role: d.role as 'user' | 'assistant',
            content: d.content,
          }))
        )

        const userQueries = chronologicalData
          .filter((d) => d.role === 'user')
          .map((d) => d.content)
        setHistoryQueries(Array.from(new Set(userQueries)))
      }

      setIsFetchingHistory(false)
    }

    fetchHistory()
  }, [session])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = async () => {
    const headers = await getHeaders()
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
    <div className="flex flex-col h-[600px] bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden relative">
      <div className="bg-blue-600 p-4 text-white font-extrabold flex justify-between items-center shrink-0 shadow-sm z-10">
        <span>家計簿AIチャット 🤖</span>
      </div>

      <div className="bg-blue-50 border-b border-blue-100 p-3 flex flex-col sm:flex-row gap-3 text-sm shrink-0">
        <div className="flex items-center gap-2 flex-1">
          <span className="text-gray-600 font-bold text-xs whitespace-nowrap">
            対象データ:
          </span>
          <select
            value={dataType}
            onChange={(e) => setDataType(e.target.value)}
            className="flex-1 bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-gray-700 outline-none focus:border-blue-500 font-medium shadow-sm"
          >
            <option value="all">すべて</option>
            <option value="receipt">レシート詳細のみ</option>
            <option value="log">決済履歴のみ</option>
          </select>
        </div>
        <div className="flex items-center gap-2 flex-1">
          <span className="text-gray-600 font-bold text-xs whitespace-nowrap">
            対象期間:
          </span>
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="flex-1 bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-gray-700 outline-none focus:border-blue-500 font-medium shadow-sm"
          >
            <option value="3months">過去3ヶ月</option>
            <option value="1month">今月のみ</option>
            <option value="all">全期間</option>
          </select>
        </div>
      </div>

      <div className="flex-1 p-4 overflow-y-auto space-y-5 bg-gray-50/50 custom-scrollbar relative">
        {isFetchingHistory ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-3">
            <span className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></span>
            <span className="font-bold text-sm">履歴を読み込み中...</span>
          </div>
        ) : messages.length === 0 && !isLoading ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-2">
            <span className="text-4xl mb-2">👋</span>
            <span className="font-bold text-sm text-center">
              こんにちは！
              <br />
              過去のデータから何でも検索できます。
            </span>
          </div>
        ) : (
          messages.map((msg, index) => (
            <div
              key={index}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] sm:max-w-[75%] rounded-2xl p-3.5 whitespace-pre-wrap shadow-sm ${
                  msg.role === 'user'
                    ? 'bg-blue-600 text-white rounded-br-sm'
                    : 'bg-white text-gray-800 border border-gray-100 rounded-bl-sm prose prose-sm max-w-none'
                }`}
              >
                {msg.role === 'assistant' ? (
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[rehypeRaw, rehypeSanitize]}
                  >
                    {msg.content}
                  </ReactMarkdown>
                ) : (
                  <span className="font-medium">{msg.content}</span>
                )}
              </div>
            </div>
          ))
        )}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-white border border-gray-100 shadow-sm rounded-2xl rounded-bl-sm p-4 flex gap-1.5 items-center">
              <div
                className="w-2 h-2 bg-blue-400 rounded-full animate-bounce"
                style={{ animationDelay: '0ms' }}
              ></div>
              <div
                className="w-2 h-2 bg-blue-400 rounded-full animate-bounce"
                style={{ animationDelay: '150ms' }}
              ></div>
              <div
                className="w-2 h-2 bg-blue-400 rounded-full animate-bounce"
                style={{ animationDelay: '300ms' }}
              ></div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="p-3 sm:p-4 bg-white border-t border-gray-200 flex flex-col relative shrink-0">
        {showSuggestions && query.trim() && filteredSuggestions.length > 0 && (
          <div className="absolute bottom-full left-0 mb-2 w-full bg-white border border-gray-200 rounded-xl shadow-2xl z-20 max-h-48 overflow-y-auto custom-scrollbar">
            <div className="text-xs text-gray-500 bg-gray-50 px-4 py-2 border-b font-bold sticky top-0">
              過去の質問から検索
            </div>
            {filteredSuggestions.map((suggestion, index) => (
              <div
                key={index}
                onClick={() => {
                  setQuery(suggestion)
                  setShowSuggestions(false)
                }}
                className="px-4 py-3 text-sm font-medium text-gray-700 hover:bg-blue-50 cursor-pointer border-b last:border-0 transition-colors"
              >
                🔍 {suggestion}
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2 items-end">
          <div className="flex-1 relative">
            <Input
              placeholder="質問を入力..."
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
              className="w-full bg-gray-50 border-gray-200 focus:bg-white pr-10"
            />
          </div>
          <Button
            onClick={handleSend}
            disabled={isLoading || !query.trim()}
            className="px-5 py-2.5 shadow-sm font-bold flex items-center gap-1"
          >
            送信
          </Button>
        </div>
      </div>
    </div>
  )
}
